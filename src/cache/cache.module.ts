import { Module } from '@nestjs/common';
import { EmbeddingCacheService } from './embedding-cache.service';

@Module({
  providers: [EmbeddingCacheService],
  exports: [EmbeddingCacheService],
})
export class CacheModule {}
