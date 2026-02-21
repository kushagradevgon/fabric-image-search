import { Test, TestingModule } from '@nestjs/testing';
import { ImageSeedService } from './image-seed.service';

describe('ImageSeedService', () => {
  let service: ImageSeedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ImageSeedService],
    }).compile();

    service = module.get<ImageSeedService>(ImageSeedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
