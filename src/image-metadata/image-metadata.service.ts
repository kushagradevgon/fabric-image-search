import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import pgvector from "pgvector";
import { ImageMetadata } from "./image-metadata.entity";

const MIN_SIMILARITY = 0.55;
const SEARCH_LIMIT = 20;

export interface FabricSearchResult {
  entityId: string;
  imageUrl: string;
  similarity: number;
  pattern: string;
  weave: string;
  fabricType: string;
  colors: string[];
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
    await this.repo.query("CREATE EXTENSION IF NOT EXISTS vector");
  }

  async saveFabricMetadata(
    fabricId: string,
    imageUrl: string,
    tags: string[],
    rawLabels: any,
    providerMetadata?: {
      pattern: string;
      weave: string;
      colors: string[];
      fabricType?: string;
      confidence?: number;
      hash?: string;
    } | null,
    embedding?: number[],
  ) {
    this.logger.log(`saveFabricMetadata fabricId=${fabricId} imageUrl=${imageUrl} tags=${JSON.stringify(tags)} embedding=${embedding ? embedding.length : 0}`);

    const exists = await this.repo.findOne({
      where: { entityType: "FABRIC", entityId: fabricId },
    });

    const row = {
      entityType: "FABRIC" as const,
      entityId: fabricId,
      imageUrl,
      tags,
      rawLabels,
      provider_metadata: providerMetadata ?? null,
      embedding: embedding ?? null,
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

  async vectorSearch(
    embedding: number[],
    queryPattern: string,
    queryWeave: string,
  ): Promise<FabricSearchResult[]> {
    const embeddingSql = pgvector.toSql(embedding);
    const raw = await this.repo.query<
      Array<{
        entityId: string;
        imageUrl: string;
        similarity: string;
        provider_metadata: { pattern?: string; weave?: string; fabricType?: string; colors?: string[] } | null;
      }>
    >(
      `SELECT "entityId", "imageUrl",
       1 - (embedding <=> $1::vector) AS similarity,
       provider_metadata
       FROM image_metadata
       WHERE "entityType" = 'FABRIC' AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embeddingSql, SEARCH_LIMIT],
    );

    const meta = (r: (typeof raw)[0]) => r.provider_metadata ?? {};
    const results: FabricSearchResult[] = raw
      .map((r) => ({
        entityId: r.entityId,
        imageUrl: r.imageUrl,
        similarity: parseFloat(r.similarity),
        pattern: meta(r).pattern ?? "",
        weave: meta(r).weave ?? "",
        fabricType: meta(r).fabricType ?? "unknown",
        colors: meta(r).colors ?? [],
      }))
      .filter((r) => r.similarity >= MIN_SIMILARITY)
      .map((r) => {
        let score = r.similarity;
        const patternMatch =
          queryPattern !== "unknown" &&
          queryPattern.toLowerCase() === r.pattern.toLowerCase();
        const weaveMatch =
          queryWeave !== "unknown" &&
          queryWeave.toLowerCase() === r.weave.toLowerCase();
        if (patternMatch) score += 0.1;
        if (weaveMatch) score += 0.1;
        return { ...r, similarity: Math.min(1, score) };
      })
      .sort((a, b) => b.similarity - a.similarity);

    this.logger.debug(
      `vectorSearch returned ${results.length} results (min similarity ${MIN_SIMILARITY})`,
    );
    return results;
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
      select: ['id', 'entityId', 'entityType', 'imageUrl', 'tags', 'provider_metadata', 'createdAt'],
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
