import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

const MAX_SIZE = 512;
const JPEG_QUALITY = 95;

export interface PreprocessedImages {
  full: Buffer;
  center40: Buffer;
  zoom60: Buffer;
  edge: Buffer;
}

/**
 * Shared pipeline: resize to max 512px, normalize, sharpen, modulate.
 * All crops use this pipeline.
 */
function pipeline(s: sharp.Sharp): sharp.Sharp {
  return s
    .resize(MAX_SIZE, null, { withoutEnlargement: true })
    .normalize()
    .sharpen()
    .modulate({ brightness: 1, saturation: 1.1 })
    .jpeg({ quality: JPEG_QUALITY });
}

@Injectable()
export class ImagePreprocessingService {
  /**
   * Multi-scale preprocessing for Phase 3:
   * - full: no crop
   * - center40: center crop 40% of width/height
   * - zoom60: center crop 60%
   * - edge: small edge crop for background detection only
   */
  async prepare(buffer: Buffer): Promise<PreprocessedImages> {
    const full = await pipeline(sharp(buffer)).toBuffer();
    const meta = await sharp(full).metadata();
    const width = meta.width ?? MAX_SIZE;
    const height = meta.height ?? MAX_SIZE;

    const crop40W = Math.max(1, Math.floor(width * 0.4));
    const crop40H = Math.max(1, Math.floor(height * 0.4));
    const left40 = Math.floor((width - crop40W) / 2);
    const top40 = Math.floor((height - crop40H) / 2);
    const center40 = await pipeline(
      sharp(full).extract({
        left: Math.max(0, left40),
        top: Math.max(0, top40),
        width: Math.min(crop40W, width - left40),
        height: Math.min(crop40H, height - top40),
      }),
    ).toBuffer();

    const crop60W = Math.max(1, Math.floor(width * 0.6));
    const crop60H = Math.max(1, Math.floor(height * 0.6));
    const left60 = Math.floor((width - crop60W) / 2);
    const top60 = Math.floor((height - crop60H) / 2);
    const zoom60 = await pipeline(
      sharp(full).extract({
        left: Math.max(0, left60),
        top: Math.max(0, top60),
        width: Math.min(crop60W, width - left60),
        height: Math.min(crop60H, height - top60),
      }),
    ).toBuffer();

    const edgeSize = Math.min(64, Math.floor(width * 0.15), Math.floor(height * 0.15));
    const edgeW = Math.max(1, edgeSize);
    const edgeH = Math.max(1, edgeSize);
    const edge = await pipeline(
      sharp(full).extract({ left: 0, top: 0, width: edgeW, height: edgeH }),
    ).toBuffer();

    return { full, center40, zoom60, edge };
  }
}
