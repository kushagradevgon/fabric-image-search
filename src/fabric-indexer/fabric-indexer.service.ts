import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { ImageMetadataService } from '../image-metadata/image-metadata.service';
import { GeminiVisionService } from '../vision/gemini-vision.service';
import { GeminiEmbeddingService } from '../vision/gemini-embedding.service';

const MIN_CONFIDENCE = 0.65;

@Injectable()
export class FabricIndexerService {
  private readonly logger = new Logger(FabricIndexerService.name);

  constructor(
    private readonly imageMetadataService: ImageMetadataService,
    private readonly geminiVisionService: GeminiVisionService,
    private readonly geminiEmbeddingService: GeminiEmbeddingService,
  ) {}

  async indexFabric(entityId: string | number, imageUrl: string) {
    const id = String(entityId);
    this.logger.log(`indexFabric start entityId=${id} imageUrl=${imageUrl}`);

    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);
    this.logger.log(`  downloaded bytes=${imageBuffer.length}`);

    const classification =
      await this.geminiVisionService.classifyFabric(imageBuffer);
    this.logger.log(
      `  classification: pattern=${classification.pattern} weave=${classification.weave} fabricType=${classification.fabricType} confidence=${classification.confidence}`,
    );

    if (classification.confidence < MIN_CONFIDENCE) {
      this.logger.log(
        `  skip: confidence ${classification.confidence} < ${MIN_CONFIDENCE}`,
      );
      return {
        entityId: id,
        skipped: true,
        reason: 'low_confidence',
        confidence: classification.confidence,
      };
    }

    const text =
      this.geminiEmbeddingService.buildTextFromClassification(classification);
    const embedding = await this.geminiEmbeddingService.embed(text);
    this.logger.log(`  embedding length=${embedding.length}`);

    const providerMetadata = {
      pattern: classification.pattern,
      weave: classification.weave,
      colors: classification.colors ?? [],
      confidence: classification.confidence,
      fabricType: classification.fabricType,
      hash: this.geminiVisionService.generateHash(imageBuffer),
    };
    const tags = [...new Set([classification.pattern, classification.weave, classification.fabricType, ...(classification.colors ?? [])])];

    await this.imageMetadataService.ensureVectorExtension();
    await this.imageMetadataService.saveFabricMetadata(
      id,
      imageUrl,
      tags,
      null,
      providerMetadata,
      embedding,
    );

    this.logger.log(
      `indexFabric done entityId=${id} pattern=${classification.pattern} weave=${classification.weave}`,
    );
    return {
      entityId: id,
      tags,
      providerMetadata,
      skipped: false,
    };
  }
}
