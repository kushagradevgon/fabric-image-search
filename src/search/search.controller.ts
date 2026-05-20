import {
  Body,
  Controller,
  Logger,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ImageMetadataService } from '../image-metadata/image-metadata.service';
import { GeminiVisionService } from '../vision/gemini-vision.service';
import { GeminiEmbeddingService } from '../vision/gemini-embedding.service';
import { ColorExtractionService } from '../modules/vision/color-extraction.service';
import { EmbeddingCacheService } from '../cache/embedding-cache.service';
import { rgbToLab } from '../utils/color-lab.util';

interface UploadedImageFile {
  buffer?: Buffer;
}

@Controller('search')
export class SearchController {
  private readonly logger = new Logger(SearchController.name);

  constructor(
    private readonly imageMetadataService: ImageMetadataService,
    private readonly geminiVisionService: GeminiVisionService,
    private readonly geminiEmbeddingService: GeminiEmbeddingService,
    private readonly colorExtractionService: ColorExtractionService,
    private readonly embeddingCache: EmbeddingCacheService,
  ) {}

  @Post('image')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('image'))
  async searchByImage(
    @UploadedFile() file: UploadedImageFile,
    @Body('categoryId') categoryId?: string,
    @Body('subcategoryId') subcategoryId?: string,
  ) {
    const totalStart = performance.now();

    if (!file?.buffer) {
      this.logger.warn('Search: no image file uploaded');
      return this.invalidResponse(totalStart);
    }
    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);

    try {
      const classification = await this.geminiVisionService.classifyFabric(buffer);
      if (!classification.isFabricVisible) {
        this.logger.warn('Search: isFabricVisible=false');
        return this.invalidResponse(totalStart);
      }

      const queryHash = this.geminiVisionService.generateHash(buffer);
      const colorResult = await this.colorExtractionService.extract(buffer);
      let embedding = await this.embeddingCache.get(queryHash);
      if (!embedding) {
        const text = this.geminiEmbeddingService.buildTextFromClassification(
          classification,
          colorResult.dominantColor,
        );
        embedding = await this.geminiEmbeddingService.embed(text);
        await this.embeddingCache.set(queryHash, embedding);
      }
      if (!embedding?.length) {
        return this.invalidResponse(totalStart);
      }

      const patternPrimary = (classification.patternPrimary ?? '').trim().toLowerCase();
      const stripeWidth = (classification.stripeWidth ?? 'none').trim().toLowerCase();
      const dominantColorsRGB = colorResult.dominantColorsRGB ?? [];
      const queryLabColors = dominantColorsRGB.map((c) => rgbToLab(c.r, c.g, c.b));
      const colors = (colorResult.dominantColors
        ? [...colorResult.dominantColors]
        : [colorResult.dominantColor, colorResult.baseColor, colorResult.accentColor].filter(Boolean) as string[]
      ).map((c) => (c ?? '').trim().toLowerCase());

      const results = await this.imageMetadataService.strictFilterSearch(
        patternPrimary,
        stripeWidth,
        queryLabColors,
        embedding,
        queryHash,
        categoryId,
        subcategoryId,
      );

      if (results.length === 0) {
        const totalDuration = performance.now() - totalStart;
        this.logger.log(`Total search request took ${totalDuration.toFixed(2)} ms`);
        return { valid: true, query: null, matchScore: null, results: [] };
      }

      const totalDuration = performance.now() - totalStart;
      this.logger.log(`Total search request took ${totalDuration.toFixed(2)} ms`);

      return {
        valid: true,
        query: {
          patternPrimary,
          patternDetail: classification.patternDetail,
          weavePrimary: classification.weavePrimary,
          weaveDetail: classification.weaveDetail,
          fabricType: classification.fabricType,
          colors,
          categoryId: categoryId?.trim() || null,
          subcategoryId: subcategoryId?.trim() || null,
        },
        matchScore: results[0]?.finalScore ?? results[0]?.similarity ?? null,
        results: results.map((r) => ({
          fabricId: r.entityId,
          imageUrl: r.imageUrl,
          categoryId: r.categoryId,
          subcategoryId: r.subcategoryId,
          score: r.finalScore ?? r.similarity,
          patternPrimary: r.pattern,
          patternDetail: r.pattern_detail,
          weavePrimary: r.weave,
          weaveDetail: r.weave_detail,
          fabricType: r.fabricType,
          colors: r.colors,
        })),
      };
    } catch (err) {
      this.logger.warn(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      return this.invalidResponse(totalStart);
    }
  }

  private invalidResponse(totalStart: number) {
    const totalDuration = performance.now() - totalStart;
    this.logger.log(`Total search request took ${totalDuration.toFixed(2)} ms`);
    return {
      valid: false,
      query: null,
      matchScore: null,
      results: [],
    };
  }
}
