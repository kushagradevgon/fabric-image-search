import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import pgvector from "pgvector";
import { ImageMetadata } from "./image-metadata.entity";
import { isColorMatch, type LabColor } from "../utils/color-lab.util";

const MIN_SIMILARITY = 0.75;
const SEARCH_LIMIT = 20;

/** Strict search: lowered threshold; exact image always wins. */
const STRICT_MIN_SIMILARITY = 0.72;
const EXACT_HASH_BOOST = 0.4;
const METADATA_BOOST = 0.1;

export interface FabricSearchResult {
  entityId: string;
  imageUrl: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  similarity: number;
  finalScore?: number;
  isExactHash?: boolean;
  hash?: string;
  pattern: string;
  pattern_detail?: string;
  weave: string;
  weave_detail?: string;
  stripe_width?: string;
  fabricType: string;
  fabric_coverage?: number;
  colors: string[];
  dominant_colors_lab?: LabColor[] | null;
  dominantColor?: string;
  baseColor?: string;
  accentColor?: string;
  palette?: string[];
  tags?: string[];
}

export interface FabricQuery {
  pattern: string;
  weave: string;
  colors: string[];
}

export interface ScoredFabric extends ImageMetadata {
  score: number;
}

/** Score from pattern + weave only. Never rely on color alone for search. */
function calculateScore(
  query: FabricQuery,
  fabric: ImageMetadata & { provider_metadata: NonNullable<ImageMetadata['provider_metadata']> },
): number {
  const meta = fabric.provider_metadata;
  const pattern = (meta.pattern ?? '').toLowerCase();
  const weave = (meta.weave ?? '').toLowerCase();
  const queryPattern = (query.pattern ?? '').toLowerCase();
  const queryWeave = (query.weave ?? '').toLowerCase();

  let score = 0;
  if (queryPattern !== 'unknown' && queryPattern === pattern) score += 0.5;
  if (queryWeave !== 'unknown' && queryWeave === weave) score += 0.3;
  return score;
}

// image-metadata/image-metadata.service.ts
@Injectable()
export class ImageMetadataService {
  private readonly logger = new Logger(ImageMetadataService.name);

  constructor(
    @InjectRepository(ImageMetadata)
    private repo: Repository<ImageMetadata>,
  ) {}

  async ensureVectorExtension(): Promise<void> {
    await this.repo.query('CREATE EXTENSION IF NOT EXISTS vector');
  }

  /** Create HNSW index for cosine distance and run ANALYZE. */
  async ensureVectorIndex(): Promise<void> {
    await this.ensureVectorExtension();
    await this.repo.query(`
      CREATE INDEX IF NOT EXISTS image_metadata_embedding_hnsw_idx
      ON image_metadata
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
    `);
    await this.repo.query('ANALYZE image_metadata');
  }

  /** Returns existing fabric metadata if already indexed (has embedding) or rejected. Used to skip re-fetch and avoid retry loops. */
  async findFabricByEntityId(entityId: string): Promise<ImageMetadata | null> {
    const row = await this.repo.findOne({
      where: { entityType: "FABRIC", entityId },
    });
    if (!row) return null;
    if (row.embedding != null) return row;
    if ((row.provider_metadata as { indexStatus?: string } | null)?.indexStatus === 'rejected_not_fabric') return row;
    return null;
  }

  async saveFabricMetadata(
    fabricId: string,
    imageUrl: string,
    tags: string[],
    rawLabels: any,
    categoryId?: string | null,
    subcategoryId?: string | null,
    providerMetadata?: {
      pattern?: string;
      pattern_detail?: string;
      weave?: string;
      weave_detail?: string;
      stripe_width?: string;
      fabricType?: string;
      fabric_coverage?: number;
      colors?: string[];
      dominantColor?: string;
      baseColor?: string;
      accentColor?: string;
      palette?: string[];
      distribution?: Record<string, number>;
      confidence?: number;
      hash?: string;
      indexStatus?: 'indexed' | 'rejected_not_fabric';
    } | null,
    embedding?: number[],
    dominantColorsRgb?: { r: number; g: number; b: number }[] | null,
    dominantColorsLab?: { l: number; a: number; b: number }[] | null,
  ) {
    this.logger.log(`saveFabricMetadata fabricId=${fabricId} imageUrl=${imageUrl} tags=${JSON.stringify(tags)} embedding=${embedding ? embedding.length : 0}`);

    const exists = await this.repo.findOne({
      where: { entityType: "FABRIC", entityId: fabricId },
    });

    const row = {
      entityType: "FABRIC" as const,
      entityId: fabricId,
      imageUrl,
      categoryId: categoryId ?? null,
      subcategoryId: subcategoryId ?? null,
      tags,
      rawLabels,
      provider_metadata: providerMetadata ?? null,
      embedding: embedding ?? null,
      dominant_colors_rgb: dominantColorsRgb ?? null,
      dominant_colors_lab: dominantColorsLab ?? null,
    };

    if (exists) {
      await this.repo.update(exists.id, row);
      this.logger.log(`  updated id=${exists.id} entityId=${fabricId}`);
      return this.repo.findOne({ where: { id: exists.id } }) as Promise<ImageMetadata>;
    }

    this.logger.log(`  saving entityType=FABRIC entityId=${fabricId} imageUrl=${imageUrl} provider_metadata=${providerMetadata ? "present" : "null"}`);
    const saved = await this.repo.save(row);
    this.logger.log(`  saved id=${saved.id} entityId=${saved.entityId}`);
    return saved;
  }

  /** Strong similarity threshold; only return results >= this. */
  static readonly STRONG_SIMILARITY = 0.8;

  /**
   * DEBUG: Pure embedding search (no filters). Use to verify same-image similarity >= 0.95.
   */
  async debugEmbeddingSearch(queryEmbedding: number[]): Promise<Array<{ id: string; similarity: number }>> {
    const embeddingSql = pgvector.toSql(queryEmbedding);
    const raw = await this.repo.query<Array<{ id: string; similarity: string }>>(
      `SELECT id,
              (1 - (embedding <=> $1::vector)) AS similarity
       FROM image_metadata
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 5`,
      [embeddingSql],
    );
    const rows = raw.map((r) => ({ id: r.id, similarity: parseFloat(r.similarity) }));
    this.logger.debug(`DEBUG EMBEDDING RESULTS: ${JSON.stringify(rows)}`);
    return rows;
  }

  /**
   * Safe strict filter: pattern + stripe only in SQL (no color in SQL).
   * LIMIT 50. Application layer: LAB color match, then priority boost (hash, pattern, stripe), filter similarity >= 0.75, sort by finalScore, return top 20.
   */
  async strictFilterSearch(
    patternPrimary: string,
    stripeWidth: string,
    queryLabColors: LabColor[],
    embedding: number[],
    queryHash?: string,
    categoryId?: string,
    subcategoryId?: string,
  ): Promise<FabricSearchResult[]> {
    const embeddingSql = pgvector.toSql(embedding);
    const categoryFilter = categoryId?.trim() || null;
    const subcategoryFilter = subcategoryId?.trim() || null;
    type Row = {
      entityId: string;
      imageUrl: string;
      categoryId: string | null;
      subcategoryId: string | null;
      similarity: string;
      tags: string[] | null;
      provider_metadata: ImageMetadata['provider_metadata'];
      dominant_colors_lab: LabColor[] | null;
    };
    const raw = await this.repo.query<Row[]>(
      `SELECT "entityId", "imageUrl", "categoryId", "subcategoryId", tags,
       (1 - (embedding <=> $3::vector)) AS similarity,
       provider_metadata,
       dominant_colors_lab
       FROM image_metadata
       WHERE embedding IS NOT NULL
       AND LOWER(TRIM(COALESCE(provider_metadata->>'pattern', ''))) = LOWER(TRIM($1))
       AND (
         LOWER(TRIM($1)) != 'striped'
         OR COALESCE(LOWER(TRIM(provider_metadata->>'stripe_width')), 'none')
            = COALESCE(LOWER(TRIM($2)), 'none')
       )
       AND ($4::text IS NULL OR TRIM("categoryId") = TRIM($4))
       AND ($5::text IS NULL OR TRIM("subcategoryId") = TRIM($5))
       ORDER BY embedding <=> $3::vector
       LIMIT 50`,
      [patternPrimary ?? '', stripeWidth ?? 'none', embeddingSql, categoryFilter, subcategoryFilter],
    );

    const meta = (r: Row) => r.provider_metadata ?? {};
    const parseLab = (v: unknown): LabColor[] | null => {
      if (!v || !Array.isArray(v)) return null;
      return v.map((x) => {
        if (x && typeof x === 'object' && 'l' in x && 'a' in x && 'b' in x) {
          return { l: Number((x as LabColor).l), a: Number((x as LabColor).a), b: Number((x as LabColor).b) };
        }
        return null;
      }).filter((x): x is LabColor => x !== null);
    };

    const results: FabricSearchResult[] = raw.map((r) => {
      const similarity = parseFloat(r.similarity);
      const m = meta(r);
      const rowColors = (m.colors ?? []).map((c) => (c ?? '').trim().toLowerCase());
      const lab = parseLab(r.dominant_colors_lab);
      return {
        entityId: r.entityId,
        imageUrl: r.imageUrl,
        categoryId: r.categoryId,
        subcategoryId: r.subcategoryId,
        similarity,
        hash: m.hash,
        pattern: m.pattern ?? '',
        pattern_detail: m.pattern_detail,
        weave: m.weave ?? '',
        weave_detail: m.weave_detail,
        stripe_width: m.stripe_width,
        fabricType: m.fabricType ?? '',
        fabric_coverage: m.fabric_coverage,
        colors: rowColors,
        dominant_colors_lab: lab,
        dominantColor: m.dominantColor,
        baseColor: m.baseColor,
        accentColor: m.accentColor,
        palette: m.palette ?? [],
        tags: r.tags ?? undefined,
      };
    });

    const candidates = results.filter((r) => isColorMatch(queryLabColors, r.dominant_colors_lab));

    const ranked = candidates.map((r) => {
      let score = r.similarity;
      const isExactHash = Boolean(queryHash && r.hash === queryHash);

      if (isExactHash) {
        score += EXACT_HASH_BOOST;
      }
      const patternNorm = (r.pattern ?? '').trim().toLowerCase();
      if (patternNorm === patternPrimary) {
        score += METADATA_BOOST;
      }
      const stripeNorm = (r.stripe_width ?? 'none').trim().toLowerCase();
      if (stripeNorm === stripeWidth) {
        score += 0.05;
      }
      return { ...r, finalScore: score, isExactHash };
    });

    const filtered = ranked
      .filter((r) => r.isExactHash || r.similarity >= STRICT_MIN_SIMILARITY)
      .sort((a, b) => (b.finalScore ?? b.similarity) - (a.finalScore ?? a.similarity));

    this.logger.debug(
      JSON.stringify({
        queryPattern: patternPrimary,
        queryStripeWidth: stripeWidth,
        queryCategoryId: categoryFilter,
        querySubcategoryId: subcategoryFilter,
        totalRows: results.length,
        afterLabMatch: candidates.length,
        afterThreshold: filtered.length,
      }),
    );

    return filtered.length > 0 ? filtered.slice(0, 20) : [];
  }

  /**
   * Vector search: ORDER BY embedding <=> $1 (cosine distance), LIMIT 20.
   * Returns only results with similarity > MIN_SIMILARITY (0.75).
   */
  async vectorSearch(embedding: number[]): Promise<FabricSearchResult[]> {
    const embeddingSql = pgvector.toSql(embedding);
    type Row = {
      entityId: string;
      imageUrl: string;
      distance: string;
      tags: string[] | null;
      provider_metadata: ImageMetadata['provider_metadata'];
    };
    const raw = await this.repo.query<Row[]>(
      `SELECT "entityId", "imageUrl", tags,
       embedding <=> $1::vector AS distance,
       provider_metadata
       FROM image_metadata
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embeddingSql, SEARCH_LIMIT],
    );

    const meta = (r: Row) => r.provider_metadata ?? {};
    const results: FabricSearchResult[] = raw.map((r) => {
      const distance = parseFloat(r.distance);
      const similarity = 1 - distance;
      return {
        entityId: r.entityId,
        imageUrl: r.imageUrl,
        similarity,
        pattern: meta(r).pattern ?? '',
        pattern_detail: meta(r).pattern_detail,
        weave: meta(r).weave ?? '',
        weave_detail: meta(r).weave_detail,
        stripe_width: meta(r).stripe_width,
        fabricType: meta(r).fabricType ?? '',
        fabric_coverage: meta(r).fabric_coverage,
        colors: meta(r).colors ?? [],
        dominantColor: meta(r).dominantColor,
        baseColor: meta(r).baseColor,
        accentColor: meta(r).accentColor,
        palette: meta(r).palette ?? [],
        tags: r.tags ?? undefined,
      };
    });

    const filtered = results.filter((r) => r.similarity > MIN_SIMILARITY);
    if (filtered.length === 0) {
      this.logger.debug(`vectorSearch returning [] (no results with similarity > ${MIN_SIMILARITY})`);
      return [];
    }
    this.logger.debug(`vectorSearch returned ${filtered.length} results`);
    return filtered;
  }

  async searchByWeightedScore(
    query: FabricQuery,
    minScore = 0.55,
  ): Promise<ScoredFabric[]> {
    const records = await this.repo.find({
      where: { entityType: 'FABRIC' },
    });

    const withScores: ScoredFabric[] = records
      .filter(
        (r): r is ImageMetadata & { provider_metadata: NonNullable<ImageMetadata['provider_metadata']> } =>
          r.provider_metadata != null &&
          (r.provider_metadata.pattern != null || r.provider_metadata.weave != null),
      )
      .map((fabric) => ({
        ...fabric,
        score: calculateScore(query, fabric),
      }))
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score);

    return withScores;
  }

  async searchByTags(tags: string[]) {
    const records = await this.repo
      .createQueryBuilder('meta')
      .where('meta.tags ?| array[:...tags]', { tags })
      .getMany();

    return records;
  }

  /** For debugging: confirm table name, row count, sample, and which DB this process is using. */
  async getTableSummary(limit = 10) {
    const opts = this.repo.manager.connection.options as { database?: string; host?: string };
    const count = await this.repo.count();
    const sample = await this.repo.find({
      take: limit,
      order: { createdAt: 'DESC' },
      select: ['id', 'entityId', 'entityType', 'imageUrl', 'categoryId', 'subcategoryId', 'tags', 'provider_metadata', 'createdAt'],
    });
    return {
      table: 'image_metadata',
      count,
      sample,
      database: opts.database ?? null,
      host: opts.host ?? null,
    };
  }
}
