import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import sharp from 'sharp';
import crypto from 'crypto';

export interface FabricClassification {
  pattern: string;
  weave: string;
  colors: string[];
  fabricType: string;
  confidence: number;
}

const CROP_POSITIONS = [
  { name: 'center', left: 0.25, top: 0.25 },
  { name: 'top-left', left: 0, top: 0 },
  { name: 'bottom-right', left: 0.5, top: 0.5 },
] as const;

const STRICT_JSON_SCHEMA = `
{
  "pattern": string (one of: "plain","striped","checked","plaid","floral","geometric","abstract","herringbone","paisley","solid","printed","polka dot","unknown"),
  "weave": string (one of: "twill","plain weave","satin","knit","jacquard","denim","chiffon","linen weave","canvas","rib knit","unknown"),
  "colors": string[] (dominant colors, lowercase),
  "fabricType": string (e.g. "cotton","silk","linen","polyester","wool","blend","unknown"),
  "confidence": number (0-1)
}`;

const GEMINI_VISION_MODEL = 'gemini-2.5-flash';

@Injectable()
export class GeminiVisionService {
  private readonly logger = new Logger(GeminiVisionService.name);
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private get baseUrl(): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;
  }

  generateHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async preprocessCrops(buffer: Buffer): Promise<Buffer[]> {
    const resized = await sharp(buffer)
      .resize(512, 512, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();

    const metadata = await sharp(resized).metadata();
    const w = metadata.width ?? 512;
    const h = metadata.height ?? 512;
    const cropSize = Math.min(w, h, 512);
    const crops: Buffer[] = [];

    for (const pos of CROP_POSITIONS) {
      const left = Math.floor((w - cropSize) * pos.left);
      const top = Math.floor((h - cropSize) * pos.top);
      const crop = await sharp(resized)
        .extract({
          left: Math.max(0, left),
          top: Math.max(0, top),
          width: Math.min(cropSize, w - Math.max(0, left)),
          height: Math.min(cropSize, h - Math.max(0, top)),
        })
        .resize(512, 512, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toBuffer();
      crops.push(crop);
    }

    return crops;
  }

  async classifyFabric(buffer: Buffer): Promise<FabricClassification> {
    const crops = await this.preprocessCrops(buffer);
    const results: Array<FabricClassification & { raw?: string }> = [];

    const prompt = `You are a textile classification AI. Return STRICT JSON only, no markdown, no explanation.
Schema: ${STRICT_JSON_SCHEMA}
Output a single JSON object matching the schema above.`;

    for (let i = 0; i < crops.length; i++) {
      const base64 = crops[i].toString('base64');
      try {
        if (!this.apiKey?.trim()) {
          throw new Error('GEMINI_API_KEY is not set');
        }
        const response = await axios.post(
          `${this.baseUrl}?key=${this.apiKey}`,
          {
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inline_data: {
                      mime_type: 'image/jpeg',
                      data: base64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
            },
          },
          { timeout: 30_000, validateStatus: () => true },
        );

        if (response.status === 403) {
          const msg =
            response.data?.error?.message ??
            response.data?.message ??
            JSON.stringify(response.data ?? response.statusText);
          this.logger.warn(
            `Gemini 403 (crop ${i + 1}): ${msg}. Check GEMINI_API_KEY and model "${GEMINI_VISION_MODEL}".`,
          );
          continue;
        }
        if (response.status !== 200) {
          this.logger.warn(
            `Gemini ${response.status} (crop ${i + 1}): ${JSON.stringify(response.data?.error ?? response.data ?? response.statusText)}`,
          );
          continue;
        }

        const text =
          response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
        if (!text) continue;
        const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
        const parsed = JSON.parse(cleaned) as FabricClassification;
        if (
          typeof parsed.pattern === 'string' &&
          typeof parsed.weave === 'string' &&
          typeof parsed.confidence === 'number'
        ) {
          results.push({
            pattern: String(parsed.pattern).toLowerCase(),
            weave: String(parsed.weave).toLowerCase(),
            colors: Array.isArray(parsed.colors)
              ? parsed.colors.map((c) => String(c).toLowerCase())
              : [],
            fabricType: typeof parsed.fabricType === 'string' ? parsed.fabricType.toLowerCase() : 'unknown',
            confidence: Math.max(0, Math.min(1, Number(parsed.confidence))),
          });
        }
      } catch (err) {
        this.logger.warn(
          `Crop ${i + 1}/${crops.length} classification failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (results.length === 0) {
      this.logger.warn('No valid classification from any crop');
      return {
        pattern: 'unknown',
        weave: 'unknown',
        colors: [],
        fabricType: 'unknown',
        confidence: 0,
      };
    }

    return this.majorityVote(results);
  }

  private majorityVote(
    results: Array<{ pattern: string; weave: string; colors: string[]; fabricType: string; confidence: number }>,
  ): FabricClassification {
    const patternVotes: Record<string, number> = {};
    const weaveVotes: Record<string, number> = {};
    const fabricTypeVotes: Record<string, number> = {};
    const colorCounts: Record<string, number> = {};
    let totalConfidence = 0;

    for (const r of results) {
      patternVotes[r.pattern] = (patternVotes[r.pattern] ?? 0) + 1;
      weaveVotes[r.weave] = (weaveVotes[r.weave] ?? 0) + 1;
      fabricTypeVotes[r.fabricType] = (fabricTypeVotes[r.fabricType] ?? 0) + 1;
      for (const c of r.colors ?? []) {
        colorCounts[c] = (colorCounts[c] ?? 0) + 1;
      }
      totalConfidence += r.confidence;
    }

    const pattern =
      Object.entries(patternVotes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
    const weave =
      Object.entries(weaveVotes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
    const fabricType =
      Object.entries(fabricTypeVotes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
    const colors = Object.entries(colorCounts)
      .filter(([, count]) => count >= 2)
      .map(([c]) => c);
    const confidence = totalConfidence / results.length;

    return {
      pattern,
      weave,
      colors,
      fabricType,
      confidence,
    };
  }
}
