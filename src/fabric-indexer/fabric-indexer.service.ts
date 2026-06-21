import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ImageMetadataService } from '../image-metadata/image-metadata.service';
import { GeminiVisionService, FABRIC_COVERAGE_SKIP, FABRIC_COVERAGE_LOW } from '../vision/gemini-vision.service';
import { GeminiEmbeddingService } from '../vision/gemini-embedding.service';
import { ColorExtractionService } from '../modules/vision/color-extraction.service';
import { rgbToLab } from '../utils/color-lab.util';

const INDEX_CONCURRENCY = 5;

/** Run at most `concurrency` promises at a time (p-limit style). */
function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise((resolve, reject) => {
      const next = () => {
        active--;
        if (queue.length > 0) queue.shift()!();
      };
      const runOne = async () => {
        active++;
        try {
          const result = await fn();
          resolve(result);
        } catch (e) {
          reject(e);
        } finally {
          next();
        }
      };
      if (active < concurrency) runOne();
      else queue.push(() => runOne());
    });
  };
  return run;
}

@Injectable()
export class FabricIndexerService {
  private readonly logger = new Logger(FabricIndexerService.name);

  constructor(
    private readonly imageMetadataService: ImageMetadataService,
    private readonly geminiVisionService: GeminiVisionService,
    private readonly geminiEmbeddingService: GeminiEmbeddingService,
    private readonly colorExtractionService: ColorExtractionService,
  ) {}

  /**
   * Index a single fabric image. Hard no-image policy: no fallback to text search.
   * Returns skipped result if imageUrl missing, download fails, classification rejected, or embedding null.
   */
  async indexFabric(
    entityId: string | number,
    imageUrl: string,
    opts?: { categoryId?: string; subcategoryId?: string },
  ): Promise<{
    entityId: string;
    skipped: boolean;
    reason?: string;
    tags?: string[];
    providerMetadata?: Record<string, unknown>;
  }> {
    const id = String(entityId);

    if (!imageUrl?.trim()) {
      this.logger.warn(`indexFabric skip entityId=${id}: imageUrl missing`);
      return { entityId: id, skipped: true, reason: 'no_image' };
    }

    this.logger.log(`indexFabric start entityId=${id} imageUrl=${imageUrl}`);

    const existing = await this.imageMetadataService.findFabricByEntityId(id);
    if (existing) {
      if (opts?.categoryId !== undefined || opts?.subcategoryId !== undefined) {
        await this.imageMetadataService.updateCategoryIds(id, opts?.categoryId, opts?.subcategoryId);
      }
      const status = (existing.provider_metadata as { indexStatus?: string } | null)?.indexStatus;
      this.logger.log(`  skip: already in DB entityId=${id}${status === 'rejected_not_fabric' ? ' (rejected)' : ''}`);
      return {
        entityId: id,
        skipped: true,
        reason: status === 'rejected_not_fabric' ? 'rejected_not_fabric' : 'already_indexed',
      };
    }

    let imageBuffer: Buffer;
    try {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30_000 });
      imageBuffer = Buffer.from(response.data);
    } catch (err) {
      this.logger.warn(`indexFabric skip entityId=${id}: download failed - ${err instanceof Error ? err.message : String(err)}`);
      return { entityId: id, skipped: true, reason: 'download_failed' };
    }
    this.logger.log(`  downloaded bytes=${imageBuffer.length}`);

    let classification;
    try {
      classification = await this.geminiVisionService.classifyFabric(imageBuffer);
    } catch (err) {
      this.logger.warn(
        `Classification failed (rejecting): ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.imageMetadataService.ensureVectorExtension();
      await this.imageMetadataService.saveFabricMetadata(
        id,
        imageUrl,
        [],
        null,
        opts?.categoryId ?? null,
        opts?.subcategoryId ?? null,
        { indexStatus: 'rejected_not_fabric' },
        undefined,
      );
      return { entityId: id, skipped: true, reason: 'rejected_not_fabric' };
    }

    if (!classification.isFabricVisible) {
      this.logger.warn(`  isFabricVisible=false - skip indexing`);
      await this.imageMetadataService.ensureVectorExtension();
      await this.imageMetadataService.saveFabricMetadata(
        id,
        imageUrl,
        [],
        null,
        opts?.categoryId ?? null,
        opts?.subcategoryId ?? null,
        { indexStatus: 'rejected_not_fabric' },
        undefined,
      );
      return { entityId: id, skipped: true, reason: 'fabric_not_visible' };
    }

    if (classification.fabricCoverage < FABRIC_COVERAGE_SKIP) {
      this.logger.warn(`  fabricCoverage ${classification.fabricCoverage} < ${FABRIC_COVERAGE_SKIP} - skip indexing`);
      await this.imageMetadataService.ensureVectorExtension();
      await this.imageMetadataService.saveFabricMetadata(
        id,
        imageUrl,
        [],
        null,
        opts?.categoryId ?? null,
        opts?.subcategoryId ?? null,
        { indexStatus: 'rejected_not_fabric' },
        undefined,
      );
      return { entityId: id, skipped: true, reason: 'fabric_coverage_too_low' };
    }

    const lowConfidenceWeight = classification.fabricCoverage >= FABRIC_COVERAGE_LOW ? 1 : Math.max(0.3, classification.fabricCoverage / FABRIC_COVERAGE_LOW);
    const effectiveConfidence = classification.confidence * lowConfidenceWeight;

    this.logger.log(
      `  classification: patternPrimary=${classification.patternPrimary} weavePrimary=${classification.weavePrimary} fabricType=${classification.fabricType} stripeWidth=${classification.stripeWidth} fabricCoverage=${classification.fabricCoverage} confidence=${classification.confidence} effectiveConfidence=${effectiveConfidence}`,
    );

    const colorResult = await this.colorExtractionService.extract(imageBuffer);
    const dominantColorsRGB = colorResult.dominantColorsRGB ?? [];
    const dominantColorsLAB = dominantColorsRGB.map((c) => rgbToLab(c.r, c.g, c.b));
    this.logger.log(
      `  color: dominant=${colorResult.dominantColor} base=${colorResult.baseColor} accent=${colorResult.accentColor} palette=${colorResult.palette.join(', ')}`,
    );

    const text = this.geminiEmbeddingService.buildTextFromClassification(
      classification,
      colorResult.dominantColor,
    );
    let embedding: number[];
    try {
      embedding = await this.geminiEmbeddingService.embed(text);
    } catch (err) {
      this.logger.warn(`indexFabric skip entityId=${id}: embedding failed - ${err instanceof Error ? err.message : String(err)}`);
      return { entityId: id, skipped: true, reason: 'embedding_failed' };
    }
    if (!embedding?.length) {
      this.logger.warn(`indexFabric skip entityId=${id}: embedding null or empty`);
      return { entityId: id, skipped: true, reason: 'embedding_null' };
    }
    this.logger.log(`  embedding length=${embedding.length}`);

    const top3 = colorResult.dominantColors ?? [
      colorResult.dominantColor,
      colorResult.baseColor,
      colorResult.accentColor,
    ].filter(Boolean) as [string, string, string];
    const colors = [...top3, ...colorResult.palette.filter((c) => !top3.includes(c))];
    const providerMetadata = {
      pattern: classification.patternPrimary,
      pattern_detail: classification.patternDetail || undefined,
      weave: classification.weavePrimary,
      weave_detail: classification.weaveDetail || undefined,
      stripe_width: classification.stripeWidth,
      fabricType: classification.fabricType,
      fabric_coverage: classification.fabricCoverage,
      colors,
      dominantColor: colorResult.dominantColor,
      baseColor: colorResult.baseColor,
      accentColor: colorResult.accentColor,
      palette: colorResult.palette,
      distribution: colorResult.distribution,
      confidence: effectiveConfidence,
      hash: this.geminiVisionService.generateHash(imageBuffer),
      indexStatus: 'indexed' as const,
    };
    const tags = [
      ...new Set([
        classification.patternPrimary,
        classification.weavePrimary,
        classification.fabricType,
        ...colors,
      ]),
    ];

    await this.imageMetadataService.ensureVectorIndex();
    await this.imageMetadataService.saveFabricMetadata(
      id,
      imageUrl,
      tags,
      null,
      opts?.categoryId ?? null,
      opts?.subcategoryId ?? null,
      providerMetadata,
      embedding,
      dominantColorsRGB.length > 0 ? dominantColorsRGB : undefined,
      dominantColorsLAB.length > 0 ? dominantColorsLAB : undefined,
    );

    this.logger.log(
      `indexFabric done entityId=${id} patternPrimary=${classification.patternPrimary} weavePrimary=${classification.weavePrimary}`,
    );
    return {
      entityId: id,
      tags,
      providerMetadata,
      skipped: false,
    };
  }

  /**
   * Index multiple fabric images with concurrency limit (5). Uses Promise.allSettled.
   */
  async indexFabricBatch(
    entities: Array<{ entityId: string; imageUrl: string; categoryId?: string; subcategoryId?: string }>,
  ): Promise<Array<{ entityId: string; skipped: boolean; reason?: string; tags?: string[]; providerMetadata?: Record<string, unknown> }>> {
    const limit = pLimit(INDEX_CONCURRENCY);
    const settled = await Promise.allSettled(
      entities.map((e) =>
        limit(() =>
          this.indexFabric(e.entityId, e.imageUrl, {
            categoryId: e.categoryId,
            subcategoryId: e.subcategoryId,
          }),
        ),
      ),
    );
    return settled.map((s, i) =>
      s.status === 'fulfilled' ? s.value : { entityId: entities[i]?.entityId ?? 'unknown', skipped: true, reason: 'batch_error' },
    );
  }
}
