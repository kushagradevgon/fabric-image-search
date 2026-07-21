import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import {
  PATTERN_PRIMARY_ENUM,
  WEAVE_PRIMARY_ENUM,
  STRIPE_WIDTH_ENUM,
  FABRIC_TYPE_ENUM,
  isPatternPrimary,
  isWeavePrimary,
  isStripeWidth,
  isFabricType,
  mapToPatternPrimary,
  mapToWeavePrimary,
} from '../constants/fabric-visual.enums';
import { ImagePreprocessingService } from './image-preprocessing.service';

const DEFAULT_GEMINI_VISION_MODEL = 'gemini-3.6-flash';

export const FABRIC_COVERAGE_SKIP = 0.15;
export const FABRIC_COVERAGE_LOW = 0.4;

export interface FabricClassification {
  patternPrimary: string;
  patternDetail: string;
  weavePrimary: string;
  weaveDetail: string;
  stripeWidth: string;
  fabricType: string;
  isFabricVisible: boolean;
  fabricCoverage: number;
  confidence: number;
}

interface GeminiClassificationResponse {
  patternPrimary?: string;
  patternDetail?: string;
  weavePrimary?: string;
  weaveDetail?: string;
  stripeWidth?: string;
  fabricType?: string;
  isFabricVisible?: boolean;
  fabricCoverage?: number;
  confidence?: number;
}

const SYSTEM = `You are a textile classification AI. Use the controlled primary lists for patternPrimary, weavePrimary, stripeWidth, fabricType. For any pattern not exactly in the list, map to the CLOSEST primary and put the specific name in patternDetail (e.g. "windowpane check" → patternPrimary "checked", patternDetail "windowpane check"). Never return "unknown". Return strict JSON only.`;

function buildClassificationPrompt(): string {
  return `Allowed patternPrimary (pick closest): ${PATTERN_PRIMARY_ENUM.join(', ')}
Allowed weavePrimary (pick closest): ${WEAVE_PRIMARY_ENUM.join(', ')}
Allowed stripeWidth: ${STRIPE_WIDTH_ENUM.join(', ')}
Allowed fabricType: ${FABRIC_TYPE_ENUM.join(', ')}

From this image extract:
- patternPrimary: one from the list (closest match)
- patternDetail: free text describing the exact pattern if not exactly in list (e.g. "windowpane check", "pin stripe")
- weavePrimary: one from the list (closest match)
- weaveDetail: free text for weave detail if needed
- stripeWidth: "none" | "thin" | "medium" | "broad" (only if stripes visible)
- fabricType: one from the list
- isFabricVisible: true if fabric/textile is visible in the image
- fabricCoverage: 0-1 estimated fraction of image that shows fabric (0=none, 1=full frame fabric)
- confidence: 0-1

Return JSON only (no colors):
{
  "patternPrimary": string,
  "patternDetail": string,
  "weavePrimary": string,
  "weaveDetail": string,
  "stripeWidth": string,
  "fabricType": string,
  "isFabricVisible": boolean,
  "fabricCoverage": number,
  "confidence": number
}`;
}

function parseFabricCoverage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  const normalized = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, normalized));
}

function parseFabricVisible(raw: unknown): boolean {
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false;
  return true;
}

@Injectable()
export class GeminiVisionService {
  private readonly logger = new Logger(GeminiVisionService.name);
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly modelName =
    process.env.GEMINI_VISION_MODEL?.trim() || DEFAULT_GEMINI_VISION_MODEL;

  constructor(private readonly preprocessing: ImagePreprocessingService) {}

  private getModel() {
    if (!this.apiKey?.trim()) throw new Error('GEMINI_API_KEY is not set');
    const client = new GoogleGenerativeAI(this.apiKey);
    return client.getGenerativeModel({
      model: this.modelName,
      systemInstruction: SYSTEM,
      generationConfig: { responseMimeType: 'application/json' },
    });
  }

  generateHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private async callGemini(imageBuffer: Buffer, userPrompt: string): Promise<string> {
    const base64 = imageBuffer.toString('base64');
    try {
      const result = await this.getModel().generateContent([
        userPrompt,
        { inlineData: { mimeType: 'image/jpeg', data: base64 } },
      ]);
      const text = result.response.text()?.trim() ?? '';
      if (!text) {
        const finishReason = result.response.candidates?.[0]?.finishReason ?? 'unknown';
        throw new Error(`Empty response from Gemini (finishReason=${finishReason})`);
      }
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Gemini API error (model=${this.modelName}): ${msg}`);
      throw new Error(`Gemini API error: ${msg}`);
    }
  }

  private parseJson<T>(text: string, label: string): T {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (e) {
      this.logger.warn(`Invalid JSON (${label}): ${cleaned.slice(0, 200)}`);
      throw new Error(`Invalid JSON in ${label} response`);
    }
  }

  /**
   * Classify from FULL image only. Returns patternPrimary, patternDetail, weavePrimary, weaveDetail,
   * stripeWidth, fabricType, isFabricVisible, fabricCoverage, confidence.
   * Colors are NOT from Gemini – use pixel extraction.
   * Do NOT reject on small blur; only skip if isFabricVisible = false.
   */
  async classifyFabric(buffer: Buffer): Promise<FabricClassification> {
    const { full } = await this.preprocessing.prepare(buffer);
    const responseText = await this.callGemini(full, buildClassificationPrompt());
    const parsed = this.parseJson<GeminiClassificationResponse>(responseText, 'classification');

    const fields = parsed as GeminiClassificationResponse & {
      is_fabric_visible?: boolean;
      fabric_coverage?: number;
    };
    const isFabricVisible = parseFabricVisible(fields.isFabricVisible ?? fields.is_fabric_visible);
    const fabricCoverage = parseFabricCoverage(fields.fabricCoverage ?? fields.fabric_coverage);
    const confidence = Math.max(0, Math.min(1, Number.isFinite(Number(fields.confidence)) ? Number(fields.confidence) : 0));

    const patternPrimaryRaw = String(parsed.patternPrimary ?? 'solid').toLowerCase().trim();
    const patternPrimary = isPatternPrimary(patternPrimaryRaw) ? patternPrimaryRaw : mapToPatternPrimary(patternPrimaryRaw);
    const patternDetail = String(parsed.patternDetail ?? '').trim().slice(0, 200) || patternPrimaryRaw;

    const weavePrimaryRaw = String(parsed.weavePrimary ?? 'plain weave').toLowerCase().trim();
    const weavePrimary = isWeavePrimary(weavePrimaryRaw) ? weavePrimaryRaw : mapToWeavePrimary(weavePrimaryRaw);
    const weaveDetail = String(parsed.weaveDetail ?? '').trim().slice(0, 200);

    const stripeWidthRaw = String(parsed.stripeWidth ?? 'none').toLowerCase().trim();
    const stripeWidth = isStripeWidth(stripeWidthRaw) ? stripeWidthRaw : 'none';

    const fabricTypeRaw = String(parsed.fabricType ?? 'blend').toLowerCase().trim();
    const fabricType = isFabricType(fabricTypeRaw) ? fabricTypeRaw : 'blend';

    this.logger.log(
      `Classification (${this.modelName}): patternPrimary=${patternPrimary} isFabricVisible=${isFabricVisible} fabricCoverage=${fabricCoverage} confidence=${confidence}`,
    );

    return {
      patternPrimary,
      patternDetail,
      weavePrimary,
      weaveDetail,
      stripeWidth,
      fabricType,
      isFabricVisible,
      fabricCoverage,
      confidence,
    };
  }

  async prepareFullForEmbedding(buffer: Buffer): Promise<Buffer> {
    const { full } = await this.preprocessing.prepare(buffer);
    return full;
  }
}
