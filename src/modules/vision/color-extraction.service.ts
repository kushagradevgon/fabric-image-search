import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

export const COLOR_BUCKETS = [
  'black',
  'white',
  'grey',
  'red',
  'maroon',
  'orange',
  'yellow',
  'green',
  'olive',
  'blue',
  'navy',
  'purple',
  'pink',
  'brown',
  'beige',
  'cream',
] as const;

export type ColorBucket = (typeof COLOR_BUCKETS)[number];

export interface RgbTriple {
  r: number;
  g: number;
  b: number;
}

export interface ColorExtractionResult {
  /** Top 3 dominant colors (normalized names) from histogram clustering via sharp pixel stats */
  dominantColors: [string, string, string];
  /** Top 3 dominant colors as RGB for LAB conversion and storage */
  dominantColorsRGB: RgbTriple[];
  dominantColor: string;
  baseColor: string;
  accentColor: string;
  palette: string[];
  distribution: Record<string, number>;
}

/** HSL: H 0-360, S 0-100, L 0-100 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * Map HSL to one of COLOR_BUCKETS.
 * Order matters: black/white/grey first, then chromatic with luminance variants.
 */
function hslToBucket(h: number, s: number, l: number): ColorBucket {
  if (l <= 12) return 'black';
  if (l >= 92) return 'white';
  if (s <= 12) return 'grey';

  // Red zone (0-15, 345-360)
  const isRed = h <= 15 || h >= 345;
  if (isRed) {
    if (l <= 35) return 'maroon';
    if (l >= 75) return 'pink';
    return 'red';
  }

  // Orange 15-45
  if (h > 15 && h <= 45) {
    if (l <= 45) return 'brown';
    if (s <= 30 && l >= 60 && l < 88) return 'beige';
    return 'orange';
  }

  // Yellow 45-70
  if (h > 45 && h <= 70) {
    if (s <= 25 && l >= 88) return 'cream';
    if (s <= 30 && l >= 60 && l < 88) return 'beige';
    return 'yellow';
  }

  // Green 70-170
  if (h > 70 && h <= 170) {
    if (l <= 45) return 'olive';
    return 'green';
  }

  // Blue 200-260
  if (h > 200 && h <= 260) {
    if (l <= 40) return 'navy';
    return 'blue';
  }

  // Purple 260-300
  if (h > 260 && h <= 300) return 'purple';

  // Pink 300-345
  if (h > 300 && h < 345) return 'pink';

  // Fallback by hue band
  if (h > 170 && h <= 200) return 'blue';
  return 'grey';
}

const PALETTE_SIZE = 6;

@Injectable()
export class ColorExtractionService {
  /**
   * Resize image to 100x100, get raw pixels, convert RGB to HSL,
   * bucket into COLOR_BUCKETS, return dominant color, palette, and distribution.
   */
  async extract(imageBuffer: Buffer): Promise<ColorExtractionResult> {
    const raw = await sharp(imageBuffer)
      .resize(100, 100, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = raw;
    const counts: Record<string, number> = {};
    const sums: Record<string, { sumR: number; sumG: number; sumB: number }> = {};
    for (const b of COLOR_BUCKETS) {
      counts[b] = 0;
      sums[b] = { sumR: 0, sumG: 0, sumB: 0 };
    }

    const pixelCount = (info.width ?? 100) * (info.height ?? 100);
    const channels = info.channels ?? 4;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { h, s, l } = rgbToHsl(r, g, b);
      const bucket = hslToBucket(h, s, l);
      counts[bucket]++;
      sums[bucket].sumR += r;
      sums[bucket].sumG += g;
      sums[bucket].sumB += b;
    }

    const total = pixelCount;
    const distribution: Record<string, number> = {};
    for (const b of COLOR_BUCKETS) {
      distribution[b] = total > 0 ? counts[b] / total : 0;
    }

    const sorted = [...COLOR_BUCKETS].sort((a, b) => counts[b] - counts[a]);
    const dominantColor = sorted[0];
    const withCount = sorted.filter((c) => counts[c] > 0);
    const baseColor = withCount[1] ?? dominantColor;
    const accentColor = withCount[2] ?? baseColor;
    const top3: [string, string, string] = [
      withCount[0] ?? 'grey',
      withCount[1] ?? withCount[0] ?? 'grey',
      withCount[2] ?? withCount[1] ?? withCount[0] ?? 'grey',
    ];
    const dominantColorsRGB: RgbTriple[] = [];
    for (let i = 0; i < 3; i++) {
      const bucket = withCount[i];
      if (!bucket || !counts[bucket]) break;
      const s = sums[bucket];
      const n = counts[bucket];
      dominantColorsRGB.push({
        r: Math.round(s.sumR / n),
        g: Math.round(s.sumG / n),
        b: Math.round(s.sumB / n),
      });
    }
    const palette = [
      ...new Set([
        dominantColor,
        ...withCount.slice(0, PALETTE_SIZE),
      ]),
    ].slice(0, PALETTE_SIZE);

    return {
      dominantColors: top3,
      dominantColorsRGB,
      dominantColor,
      baseColor,
      accentColor,
      palette,
      distribution,
    };
  }
}
