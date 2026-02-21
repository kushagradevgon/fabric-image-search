import { Processor, Process } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import * as Bull from 'bull';
import { FabricIndexerService } from '../fabric-indexer/fabric-indexer.service';
import { SEED_QUEUE } from './seed-queue.constants';

export interface SeedJobPayload {
  entityId: string;
  imageUrl: string;
  index: number;
  total: number;
}

@Processor(SEED_QUEUE)
export class SeedQueueProcessor implements OnModuleInit {
  private readonly logger = new Logger(SeedQueueProcessor.name);

  constructor(private readonly fabricIndexerService: FabricIndexerService) {}

  onModuleInit() {
    this.logger.log(`Processor registered for queue "${SEED_QUEUE}". Jobs will be processed when Redis has jobs.`);
  }

  @Process()
  async handleSeedJob(job: Bull.Job<SeedJobPayload>) {
    const { entityId, imageUrl, index, total } = job.data;

    this.logger.log(
      `[job ${job.id}] [${index}/${total}] Processing entity_id=${entityId} url=${imageUrl} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );

    try {
      await this.fabricIndexerService.indexFabric(entityId, imageUrl);
      this.logger.log(`[job ${job.id}] [${index}/${total}] Done entity_id=${entityId}`);
      return { entityId, imageUrl, ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `[job ${job.id}] [${index}/${total}] Failed entity_id=${entityId}: ${msg}`,
        stack,
      );
      throw err;
    }
  }
}
