import { BullBoardModule } from '@bull-board/nestjs';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { ImageSeedController } from './image-seed.controller';
import { ImageSeedService } from './image-seed.service';
import { FabricIndexerModule } from '../fabric-indexer/fabric-indexer.module';
import { ImageMetadataModule } from '../image-metadata/image-metadata.module';
import { SeedQueueProcessor } from './seed-queue.processor';
import {
  SEED_QUEUE,
  SEED_JOB_ATTEMPTS,
  SEED_JOB_BACKOFF_MS,
} from './seed-queue.constants';

@Module({
  imports: [
    FabricIndexerModule,
    ImageMetadataModule,
    BullModule.registerQueue({
      name: SEED_QUEUE,
      defaultJobOptions: {
        attempts: SEED_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: SEED_JOB_BACKOFF_MS },
        removeOnComplete: 500,
      },
    }),
    BullBoardModule.forFeature({
      name: SEED_QUEUE,
      adapter: BullAdapter,
    }),
  ],
  controllers: [ImageSeedController],
  providers: [ImageSeedService, SeedQueueProcessor],
})
export class ImageSeedModule {}
