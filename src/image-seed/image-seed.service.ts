// image-seed/image-seed.service.ts
import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import * as Bull from 'bull';
import { DataSource } from 'typeorm';
import { SEED_QUEUE } from './seed-queue.constants';
import type { SeedJobPayload } from './seed-queue.processor';

@Injectable()
export class ImageSeedService {
  private readonly logger = new Logger(ImageSeedService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(SEED_QUEUE) private readonly seedQueue: Bull.Queue,
  ) {}

  async seed() {
    const query = `
      SELECT
          frm.related_type,
          f.url AS file_url,
          f.formats,
          frm.related_id AS entity_id,
          sc.id AS subcategory_id,
          sc.name AS subcategory,
          cat.id AS category_id,
          cat.name AS category
      FROM files_related_morphs frm
      LEFT JOIN files f
          ON f.id = frm.file_id

      -- Fabrics
      LEFT JOIN fabrics fab
          ON frm.related_type = 'api::fabric.fabric' AND frm.related_id = fab.id
      LEFT JOIN fabrics_sub_category_links fsl
          ON fab.id = fsl.fabric_id
      LEFT JOIN fabrics_category_links fcl
          ON fab.id = fcl.fabric_id

      -- Knits
      LEFT JOIN knites knit
          ON frm.related_type = 'api::knit.knit' AND frm.related_id = knit.id
      LEFT JOIN knites_sub_category_links ksl
          ON knit.id = ksl.knit_id
      LEFT JOIN knites_category_links kcl
          ON knit.id = kcl.knit_id

      -- Common category/subcategory tables
      LEFT JOIN sub_categories sc
          ON sc.id = COALESCE(fsl.sub_category_id, ksl.sub_category_id)
      LEFT JOIN categories cat
          ON cat.id = COALESCE(fcl.category_id, kcl.category_id)

      WHERE frm.field = 'image'
        AND frm.related_type IN ('api::fabric.fabric', 'api::knit.knit')
      ORDER BY random();
    `;

    this.logger.log('Fetching fabric image records from DB...');
    const records = await this.dataSource.query(query);
    this.logger.log(`Found ${records.length} record(s)`);

    let queued = 0;
    let skipped = 0;
    const total = records.length;
    const runId = Date.now();

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const candidate = this.getBestImage(record.file_url, record.formats);

      if (!this.isValidUrl(candidate)) {
        this.logger.log(
          `[${i + 1}/${total}] skipped entity_id=${record.entity_id} (invalid URL: ${String(candidate).slice(0, 60)}...)`,
        );
        skipped++;
        continue;
      }

      const entityId = String(record.entity_id);
      const categoryId = record.category_id != null ? String(record.category_id) : undefined;
      const subcategoryId = record.subcategory_id != null ? String(record.subcategory_id) : undefined;
      const payload: SeedJobPayload = {
        entityId,
        imageUrl: candidate,
        categoryId,
        subcategoryId,
        index: i + 1,
        total,
      };
      await this.seedQueue.add(payload, { jobId: `fabric-${entityId}-${i}-${runId}` });
      this.logger.log(`[${i + 1}/${total}] queued entity_id=${record.entity_id} url=${candidate}`);
      queued++;
    }

    this.logger.log(`Seed enqueue complete: queued=${queued} skipped=${skipped} total=${total}`);
    return { total, queued, skipped };
  }

  async getQueueStats() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.seedQueue.getWaitingCount(),
      this.seedQueue.getActiveCount(),
      this.seedQueue.getCompletedCount(),
      this.seedQueue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }

  async retryFailed() {
    const failed = await this.seedQueue.getFailed();
    let retried = 0;
    for (const job of failed) {
      await job.retry();
      retried++;
      this.logger.log(`Retrying failed job id=${job.id} entity_id=${job.data.entityId}`);
    }
    return { retried, total: failed.length };
  }

  async emptyQueue() {
    await this.seedQueue.empty();
    await this.seedQueue.clean(0, 'completed');
    await this.seedQueue.clean(0, 'failed');
    this.logger.log('Queue emptied (waiting, completed, failed cleared). Active jobs left to finish.');
    return this.getQueueStats();
  }

  private getBestImage(fileUrl: string, formats: any) {
    if (formats?.large?.url) return formats.large.url;
    if (formats?.medium?.url) return formats.medium.url;
    if (formats?.small?.url) return formats.small.url;
    if (formats?.thumbnail?.url) return formats.thumbnail.url;
    return fileUrl;
  }

  private isValidUrl(value: string | null | undefined): value is string {
    if (!value || typeof value !== 'string') return false;
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
