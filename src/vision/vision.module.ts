import { Module } from '@nestjs/common';
import { GeminiVisionService } from './gemini-vision.service';
import { GeminiEmbeddingService } from './gemini-embedding.service';

@Module({
  providers: [GeminiVisionService, GeminiEmbeddingService],
  exports: [GeminiVisionService, GeminiEmbeddingService],
})
export class VisionModule {}
