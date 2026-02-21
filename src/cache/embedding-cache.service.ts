import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const TTL_SECONDS = 3600; // 1 hour
const KEY_PREFIX = 'embed:';

@Injectable()
export class EmbeddingCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingCacheService.name);
  private client: Redis | null = null;

  private getClient(): Redis | null {
    if (this.client) return this.client;
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);
    try {
      this.client = new Redis(port, host, { maxRetriesPerRequest: 2 });
      this.client.on('error', (err) =>
        this.logger.warn(`Redis embedding cache error: ${err.message}`),
      );
      return this.client;
    } catch (err) {
      this.logger.warn(
        `Redis not available for embedding cache: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async get(imageHash: string): Promise<number[] | null> {
    const redis = this.getClient();
    if (!redis) return null;
    try {
      const raw = await redis.get(KEY_PREFIX + imageHash);
      if (!raw) return null;
      const arr = JSON.parse(raw) as number[];
      return Array.isArray(arr) && arr.length === 768 ? arr : null;
    } catch {
      return null;
    }
  }

  async set(imageHash: string, embedding: number[]): Promise<void> {
    const redis = this.getClient();
    if (!redis || embedding.length !== 768) return;
    try {
      await redis.setex(
        KEY_PREFIX + imageHash,
        TTL_SECONDS,
        JSON.stringify(embedding),
      );
    } catch (err) {
      this.logger.debug(
        `Embedding cache set failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}
