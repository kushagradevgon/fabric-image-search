// image-seed/image-seed.controller.ts
import { Body, Controller, Get, Post, HttpCode, HttpStatus, Logger } from "@nestjs/common";
import { ImageSeedService } from "./image-seed.service";
import { ImageMetadataService } from "../image-metadata/image-metadata.service";
import { FabricIndexerService } from "../fabric-indexer/fabric-indexer.service";

@Controller('image-seed')
export class ImageSeedController {
  private readonly logger = new Logger(ImageSeedController.name);

  constructor(
    private readonly seedService: ImageSeedService,
    private readonly metadataService: ImageMetadataService,
    private readonly fabricIndexer: FabricIndexerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async seed() {
    const result = await this.seedService.seed();
    this.logger.log(`Seed finished: ${JSON.stringify(result)}`);
    const queueStats = await this.seedService.getQueueStats();
    return {
      status: 'ok',
      ...result,
      queue: queueStats,
      hint: 'Jobs process in background. Check GET /image-seed/queue for progress, GET /queues for Bull Board.',
    };
  }

  @Get('metadata')
  async metadataTableSummary() {
    return this.metadataService.getTableSummary(15);
  }

  /**
   * Seed a single fabric image (for testing).
   * POST body: { "entityId": "45", "imageUrl": "https://..." }
   * Example: curl -X POST http://localhost:3000/image-seed/index-one -H "Content-Type: application/json" -d '{"entityId":"45","imageUrl":"https://vidhaan-images-01.s3.ap-south-1.amazonaws.com/large_1614_SS_1447_ac1c65cd35.JPG"}'
   */
  @Post('index-one')
  @HttpCode(HttpStatus.OK)
  async indexOne(
    @Body() body: { entityId: string; imageUrl: string; categoryId?: string; subcategoryId?: string },
  ) {
    const { entityId, imageUrl, categoryId, subcategoryId } = body;
    if (!entityId || !imageUrl) {
      return { ok: false, error: 'Missing entityId or imageUrl' };
    }
    await this.fabricIndexer.indexFabric(String(entityId), imageUrl, { categoryId, subcategoryId });
    const summary = await this.metadataService.getTableSummary(5);
    return { ok: true, entityId: String(entityId), imageUrl, tableAfter: summary };
  }

  /** Example payload for POST /image-seed/index-one (single-image seed for testing). */
  @Get('index-one/sample')
  getIndexOneSample() {
    return {
      description: 'Use this payload for POST /image-seed/index-one to seed a single fabric for testing.',
      method: 'POST',
      url: '/image-seed/index-one',
      body: {
        entityId: '45',
        imageUrl: 'https://vidhaan-images-01.s3.ap-south-1.amazonaws.com/large_1614_SS_1447_ac1c65cd35.JPG',
      },
    };
  }

  @Get('queue')
  async queueStats() {
    const stats = await this.seedService.getQueueStats();
    let hint: string | undefined;
    if (stats.waiting > 0 && stats.active === 0) {
      hint = 'Jobs are waiting. Ensure Redis is running (redis-cli ping) and this app is the same process that enqueued them.';
    } else if (stats.waiting === 0 && stats.active === 0 && (stats.completed > 0 || stats.failed > 0)) {
      hint = 'Waiting and Active are empty because jobs have finished. In Bull Board (http://localhost:3000/queues) open the "fabric-seed" queue and use the Completed or Failed tab to see them.';
    }
    return { ...stats, hint };
  }

  @Post('retry-failed')
  async retryFailed() {
    return this.seedService.retryFailed();
  }

  @Post('empty-queue')
  async emptyQueue() {
    return this.seedService.emptyQueue();
  }
}
