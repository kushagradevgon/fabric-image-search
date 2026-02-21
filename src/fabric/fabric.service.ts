import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import pgvector from 'pgvector';
import { Fabric } from './fabric.entity';

const MIN_SIMILARITY = 0.55;
const SEARCH_LIMIT = 20;

export interface FabricSearchResult extends Fabric {
  similarity: number;
}

@Injectable()
export class FabricService {
  private readonly logger = new Logger(FabricService.name);

  constructor(
    @InjectRepository(Fabric)
    private readonly repo: Repository<Fabric>,
  ) {}

  async ensureVectorExtension(): Promise<void> {
    await this.repo.query('CREATE EXTENSION IF NOT EXISTS vector');
  }

  async upsert(data: {
    entityId: string;
    imageUrl: string;
    pattern: string;
    weave: string;
    colors: string[];
    fabricType: string;
    confidence: number;
    embedding: number[];
  }): Promise<Fabric> {
    const existing = await this.repo.findOne({ where: { entityId: data.entityId } });
    const payload = {
      entityId: data.entityId,
      imageUrl: data.imageUrl,
      pattern: data.pattern,
      weave: data.weave,
      colors: data.colors,
      fabricType: data.fabricType,
      confidence: data.confidence,
      embedding: data.embedding,
    };
    if (existing) {
      await this.repo.update(existing.id, payload);
      return this.repo.findOne({ where: { id: existing.id } }) as Promise<Fabric>;
    }
    return this.repo.save(payload);
  }

  async vectorSearch(
    embedding: number[],
    queryPattern: string,
    queryWeave: string,
  ): Promise<FabricSearchResult[]> {
    const embeddingSql = pgvector.toSql(embedding);
    const raw = await this.repo.query<Array<Fabric & { similarity: string }>>(
      `SELECT *,
       1 - (embedding <=> $1::vector) AS similarity
       FROM fabric
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embeddingSql, SEARCH_LIMIT],
    );

    const results: FabricSearchResult[] = raw
      .map((row) => ({
        ...row,
        similarity: parseFloat(row.similarity),
      }))
      .filter((r) => r.similarity >= MIN_SIMILARITY)
      .map((r) => {
        let score = r.similarity;
        const patternMatch =
          queryPattern !== 'unknown' &&
          queryPattern.toLowerCase() === (r.pattern ?? '').toLowerCase();
        const weaveMatch =
          queryWeave !== 'unknown' &&
          queryWeave.toLowerCase() === (r.weave ?? '').toLowerCase();
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
}
