import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImageMetadata } from './image-metadata.entity';
import { ImageMetadataService } from './image-metadata.service';

@Module({
  imports: [TypeOrmModule.forFeature([ImageMetadata])],
  providers: [ImageMetadataService],
  exports: [TypeOrmModule, ImageMetadataService],
})
export class ImageMetadataModule {}
