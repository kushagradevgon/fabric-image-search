import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ImageMetadataService } from '../image-metadata/image-metadata.service';
import { GeminiVisionService } from '../vision/gemini-vision.service';
import { GeminiEmbeddingService } from '../vision/gemini-embedding.service';
import { EmbeddingCacheService } from '../cache/embedding-cache.service';

const MIN_CONFIDENCE = 0.65;

interface UploadedImageFile {
  buffer?: Buffer;
}

@Controller('search')
export class SearchController {
  constructor(
    private readonly imageMetadataService: ImageMetadataService,
    private readonly geminiVisionService: GeminiVisionService,
    private readonly geminiEmbeddingService: GeminiEmbeddingService,
    private readonly embeddingCache: EmbeddingCacheService,
  ) {}

  @Post('image')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('image'))
  async searchByImage(@UploadedFile() file: UploadedImageFile) {
    if (!file?.buffer) {
      throw new BadRequestException('No image file uploaded');
    }
    const buffer = Buffer.isBuffer(file.buffer)
      ? file.buffer
      : Buffer.from(file.buffer);

    const classification =
      await this.geminiVisionService.classifyFabric(buffer);

    if (classification.confidence < MIN_CONFIDENCE) {
      throw new BadRequestException('Low confidence image');
    }

    const imageHash = this.geminiVisionService.generateHash(buffer);
    let embedding = await this.embeddingCache.get(imageHash);
    if (!embedding) {
      const text =
        this.geminiEmbeddingService.buildTextFromClassification(classification);
      embedding = await this.geminiEmbeddingService.embed(text);
      await this.embeddingCache.set(imageHash, embedding);
    }

    const results = await this.imageMetadataService.vectorSearch(
      embedding,
      classification.pattern,
      classification.weave,
    );

    return {
      query: {
        pattern: classification.pattern,
        weave: classification.weave,
        fabricType: classification.fabricType,
        colors: classification.colors,
      },
      matchScore: results[0]?.similarity ?? null,
      results: results.map((r) => ({
        fabricId: r.entityId,
        imageUrl: r.imageUrl,
        score: r.similarity,
        pattern: r.pattern,
        weave: r.weave,
        fabricType: r.fabricType,
        colors: r.colors,
      })),
    };
  }
}
