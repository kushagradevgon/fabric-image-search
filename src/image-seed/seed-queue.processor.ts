import { InjectQueue, Processor, Process } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import * as Bull from 'bull';
import { FabricIndexerService } from '../fabric-indexer/fabric-indexer.service';
import { SEED_QUEUE } from './seed-queue.constants';

export interface SeedJobPayload {
  entityId: string;
  imageUrl: string;
  categoryId?: string;
  subcategoryId?: string;
  index: number;
  total: number;
}

@Processor(SEED_QUEUE)
export class SeedQueueProcessor implements OnModuleInit {
  private readonly logger = new Logger(SeedQueueProcessor.name);

  constructor(
    private readonly fabricIndexerService: FabricIndexerService,
    @InjectQueue(SEED_QUEUE) private readonly queue: Bull.Queue<SeedJobPayload>,
  ) {}

  onModuleInit() {
    this.logger.log(`Processor registered for queue "${SEED_QUEUE}". Jobs will be processed when Redis has jobs.`);

    this.queue.on('completed', (job: Bull.Job<SeedJobPayload>, result: unknown) => {
      const { entityId, imageUrl, index, total } = job.data;
      const finishedAt = job.finishedOn ? new Date(job.finishedOn) : null;
      const durationMs = job.processedOn && job.finishedOn ? job.finishedOn - job.processedOn : null;
      this.logger.log(
        `[queue:completed] jobId=${job.id} entity_id=${entityId} [${index}/${total}] ` +
          `result=${JSON.stringify(result)}` +
          (durationMs != null ? ` durationMs=${durationMs}` : '') +
          (finishedAt ? ` finishedAt=${finishedAt.toISOString()}` : ''),
      );
    });

    this.queue.on('failed', (job: Bull.Job<SeedJobPayload> | undefined, err: Error) => {
      const entityId = job?.data?.entityId ?? 'unknown';
      const index = job?.data?.index;
      const total = job?.data?.total;
      const attempt = job ? job.attemptsMade + 1 : '?';
      const msg = err?.message ?? String(err);
      const stack = err?.stack;
      this.logger.error(
        `[queue:failed] jobId=${job?.id ?? 'unknown'} entity_id=${entityId} [${index ?? '?'}/${total ?? '?'}] ` +
          `attempt=${attempt} error=${msg}`,
        stack,
      );
    });

    this.queue.on('error', (err: Error) => {
      this.logger.error(`[queue:error] ${err.message}`, err.stack);
    });

    this.queue.on('stalled', (jobId: string) => {
      this.logger.warn(`[queue:stalled] jobId=${jobId}`);
    });
  }

  @Process({ concurrency: 5 })
  async handleSeedJob(job: Bull.Job<SeedJobPayload>) {
    const { entityId, imageUrl, categoryId, subcategoryId, index, total } = job.data;

    this.logger.log(
      `[job ${job.id}] [${index}/${total}] Processing entity_id=${entityId} url=${imageUrl} (attempt ${job.attemptsMade + 1}/${job.opts.attempts ?? 1})`,
    );

    try {
      await this.fabricIndexerService.indexFabric(entityId, imageUrl, { categoryId, subcategoryId });
      this.logger.log(
        `[job ${job.id}] [${index}/${total}] Success entity_id=${entityId} indexed`,
      );
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
