import { Module } from '@nestjs/common';
import { GeminiVisionService } from './gemini-vision.service';
import { GeminiEmbeddingService } from './gemini-embedding.service';
import { ImagePreprocessingService } from './image-preprocessing.service';
import { ColorExtractionService } from '../modules/vision/color-extraction.service';

@Module({
  providers: [
    ImagePreprocessingService,
    GeminiVisionService,
    GeminiEmbeddingService,
    ColorExtractionService,
  ],
  exports: [
    ImagePreprocessingService,
    GeminiVisionService,
    GeminiEmbeddingService,
    ColorExtractionService,
  ],
})
export class VisionModule {}
