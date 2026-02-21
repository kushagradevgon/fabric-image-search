import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { ImageMetadataModule } from '../image-metadata/image-metadata.module';
import { VisionModule } from '../vision/vision.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [ImageMetadataModule, VisionModule, CacheModule],
  controllers: [SearchController],
})
export class SearchModule {}
