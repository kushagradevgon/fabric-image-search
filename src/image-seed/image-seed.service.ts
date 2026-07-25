// image-seed/image-seed.service.ts
import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import * as Bull from 'bull';
import { DataSource } from 'typeorm';
import { SEED_BATCH_SIZE, SEED_BATCH_SIZE_MAX, SEED_QUEUE } from './seed-queue.constants';
import type { SeedJobPayload } from './seed-queue.processor';

@Injectable()
export class ImageSeedService {
  private readonly logger = new Logger(ImageSeedService.name);
  private readonly baseUrl = process.env.STRAPI_BASE_URL?.replace(/\/$/, '') ?? '';

  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue(SEED_QUEUE) private readonly seedQueue: Bull.Queue,
  ) {}

  /**
   * Enqueue up to `batchSize` fabric/knit images that are not already in image_metadata.
   * One manual call = one batch; does not auto-start the next batch.
   */
  async seed(batchSize = SEED_BATCH_SIZE) {
    const limit = Math.min(
      Math.max(1, Number.isFinite(batchSize) ? Math.floor(batchSize) : SEED_BATCH_SIZE),
      SEED_BATCH_SIZE_MAX,
    );

    const query = `
      SELECT DISTINCT ON (frm.related_type, frm.related_id)
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
        AND sc.name ILIKE '%yarn-dyed%'
        AND f.url IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM image_metadata im
          WHERE im."entityType" = 'FABRIC'
            AND im."entityId" = frm.related_id::text
        )
      ORDER BY frm.related_type, frm.related_id DESC
      LIMIT $1;
    `;

    this.logger.log(`Fetching up to ${limit} unindexed fabric image records from DB...`);
    const records = await this.dataSource.query(query, [limit]);
    this.logger.log(`Found ${records.length} record(s)`);

    let queued = 0;
    let skippedInvalid = 0;
    let skippedDuplicateJob = 0;
    const total = records.length;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const candidate = this.getBestImage(record.file_url, record.formats);

      if (!this.isValidUrl(candidate)) {
        this.logger.log(
          `[${i + 1}/${total}] skipped entity_id=${record.entity_id} (invalid URL: ${String(candidate).slice(0, 60)}...)`,
        );
        skippedInvalid++;
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

      // Stable jobId: re-running seed won't enqueue the same entity twice while job exists.
      const jobId = `fabric-${entityId}`;
      try {
        await this.seedQueue.add(payload, {
          jobId,
          removeOnComplete: true,
          removeOnFail: false,
        });
        this.logger.log(`[${i + 1}/${total}] queued entity_id=${entityId} url=${candidate}`);
        queued++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already exists|JobId/i.test(msg)) {
          skippedDuplicateJob++;
          this.logger.log(`[${i + 1}/${total}] skipped entity_id=${entityId} (already in queue)`);
        } else {
          throw err;
        }
      }
    }

    this.logger.log(
      `Seed enqueue complete: queued=${queued} skippedInvalid=${skippedInvalid} ` +
        `skippedDuplicateJob=${skippedDuplicateJob} fetched=${total} batchSize=${limit}`,
    );
    return {
      batchSize: limit,
      fetched: total,
      queued,
      skippedInvalid,
      skippedDuplicateJob,
      skipped: skippedInvalid + skippedDuplicateJob,
    };
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

  private parseFormats(formats: unknown): Record<string, { url?: string }> | null {
    if (!formats) return null;
    if (typeof formats === 'string') {
      try {
        return JSON.parse(formats) as Record<string, { url?: string }>;
      } catch {
        return null;
      }
    }
    if (typeof formats === 'object') return formats as Record<string, { url?: string }>;
    return null;
  }

  private resolveImageUrl(path: string): string {
    if (!path?.trim()) return path;
    try {
      const u = new URL(path);
      if (u.protocol === 'http:' || u.protocol === 'https:') return path;
    } catch {
      // relative path — prepend STRAPI_BASE_URL
    }
    if (!this.baseUrl) return path;
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private getBestImage(fileUrl: string, formats: unknown) {
    const parsed = this.parseFormats(formats);
    const raw =
      parsed?.large?.url ??
      parsed?.medium?.url ??
      parsed?.small?.url ??
      parsed?.thumbnail?.url ??
      fileUrl;
    return this.resolveImageUrl(raw);
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
