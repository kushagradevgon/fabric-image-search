import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const EMBED_DIM = 768;
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`;

@Injectable()
export class GeminiEmbeddingService {
  private readonly logger = new Logger(GeminiEmbeddingService.name);
  private readonly apiKey = process.env.GEMINI_API_KEY;

  /**
   * Build searchable text from classification (pattern + weave + colors + fabricType).
   * Used for both indexing and query embedding; never color-only.
   */
  buildTextFromClassification(classification: {
    pattern: string;
    weave: string;
    colors: string[];
    fabricType: string;
  }): string {
    const parts = [
      classification.pattern && classification.pattern !== 'unknown'
        ? `pattern ${classification.pattern}`
        : '',
      classification.weave && classification.weave !== 'unknown'
        ? `weave ${classification.weave}`
        : '',
      classification.fabricType && classification.fabricType !== 'unknown'
        ? `fabric ${classification.fabricType}`
        : '',
      (classification.colors?.length ?? 0) > 0
        ? `colors ${classification.colors.join(' ')}`
        : '',
    ].filter(Boolean);
    return parts.join('. ') || 'fabric textile';
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not set');
    }

    const response = await axios.post<{
      embedding?: { values?: number[] };
    }>(
      `${EMBED_URL}?key=${this.apiKey}`,
      {
        content: {
          parts: [{ text }],
        },
        outputDimensionality: EMBED_DIM,
      },
      { timeout: 15_000 },
    );

    const values = response.data?.embedding?.values;
    if (!Array.isArray(values) || values.length !== EMBED_DIM) {
      this.logger.error(
        `Unexpected embedding shape: length=${values?.length ?? 0}, expected ${EMBED_DIM}`,
      );
      throw new Error('Invalid embedding response');
    }

    return this.normalizeL2(values);
  }

  private normalizeL2(vec: number[]): number[] {
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    return vec.map((v) => v / norm);
  }
}
