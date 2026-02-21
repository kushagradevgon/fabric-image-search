import { Module } from '@nestjs/common';
import { FabricIndexerService } from './fabric-indexer.service';
import { ImageMetadataModule } from '../image-metadata/image-metadata.module';
import { VisionModule } from '../vision/vision.module';

@Module({
  imports: [ImageMetadataModule, VisionModule],
  providers: [FabricIndexerService],
  exports: [FabricIndexerService],
})
export class FabricIndexerModule {}
