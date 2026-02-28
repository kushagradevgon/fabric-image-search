import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { ImageMetadataModule } from '../image-metadata/image-metadata.module';
import { VisionModule } from '../vision/vision.module';
import { CacheModule } from '../cache/cache.module';
import { BusinessCategoryMapperService } from '../modules/search/business-category-mapper.service';

@Module({
  imports: [ImageMetadataModule, VisionModule, CacheModule],
  controllers: [SearchController],
  providers: [BusinessCategoryMapperService],
})
export class SearchModule {}
