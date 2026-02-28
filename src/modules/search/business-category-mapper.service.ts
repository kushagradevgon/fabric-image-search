import { Injectable, Logger } from '@nestjs/common';

export interface AIClassificationResult {
  patternPrimary: string;
  patternDetail?: string;
  weavePrimary: string;
  weaveDetail?: string;
  stripeWidth?: string;
  colors: string[];
  dominantColor?: string;
  dominantColors?: [string, string, string];
  baseColor?: string;
  palette?: string[];
}

export interface DbSearchItem {
  entityId: string;
  imageUrl: string;
  similarity: number;
  pattern: string;
  pattern_detail?: string;
  weave: string;
  weave_detail?: string;
  stripe_width?: string;
  fabricType: string;
  colors: string[];
  dominantColor?: string;
  baseColor?: string;
  palette?: string[];
  tags?: string[];
}

export interface ScoredItem extends DbSearchItem {
  similarity: number;
}

const WEIGHT_EMBEDDING = 0.5;
const WEIGHT_PATTERN_PRIMARY = 0.2;
const WEIGHT_PATTERN_DETAIL = 0.1;
const WEIGHT_WEAVE_PRIMARY = 0.1;
const WEIGHT_COLOR = 0.1;

/**
 * Simple patternDetail similarity: token overlap 0-1.
 * Normalize and split on spaces; score = shared tokens / max length.
 */
function patternDetailSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return na === nb ? 1 : 0;
  const setA = new Set(na.split(/\s+/).filter(Boolean));
  const setB = new Set(nb.split(/\s+/).filter(Boolean));
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap++;
  }
  const maxSize = Math.max(setA.size, setB.size, 1);
  return overlap / maxSize;
}

@Injectable()
export class BusinessCategoryMapperService {
  private readonly logger = new Logger(BusinessCategoryMapperService.name);

  /**
   * Final score = 0.5 * embedding + 0.2 * patternPrimary match + 0.1 * patternDetail similarity + 0.1 * weavePrimary match + 0.1 * color overlap.
   */
  scoreBusinessMatch(aiResult: AIClassificationResult, dbItem: DbSearchItem): { score: number; colorOverlap: number } {
    const patternPrimaryMatch = normalize(aiResult.patternPrimary) === normalize(dbItem.pattern);
    const patternDetailSim = patternDetailSimilarity(aiResult.patternDetail ?? '', dbItem.pattern_detail ?? '');
    const weavePrimaryMatch = normalize(aiResult.weavePrimary) === normalize(dbItem.weave);

    const queryColors = new Set(
      (aiResult.dominantColors ?? [aiResult.dominantColor, aiResult.baseColor].filter(Boolean) as string[]).map(
        normalize,
      ),
    );
    const dbColors = new Set((dbItem.colors ?? [dbItem.dominantColor, dbItem.baseColor].filter(Boolean)).map(normalize));
    let colorOverlap = 0;
    for (const c of queryColors) {
      if (dbColors.has(c)) colorOverlap += 1;
    }
    colorOverlap = queryColors.size > 0 ? colorOverlap / Math.max(1, queryColors.size) : 0;

    const score =
      WEIGHT_EMBEDDING * dbItem.similarity +
      WEIGHT_PATTERN_PRIMARY * (patternPrimaryMatch ? 1 : 0) +
      WEIGHT_PATTERN_DETAIL * patternDetailSim +
      WEIGHT_WEAVE_PRIMARY * (weavePrimaryMatch ? 1 : 0) +
      WEIGHT_COLOR * Math.min(1, colorOverlap);

    return { score: Math.min(1, score), colorOverlap };
  }

  reRank(aiResult: AIClassificationResult, results: DbSearchItem[]): ScoredItem[] {
    const scored = results.map((dbItem) => {
      const { score } = this.scoreBusinessMatch(aiResult, dbItem);
      return { ...dbItem, similarity: score };
    });
    return scored.sort((a, b) => b.similarity - a.similarity);
  }
}

function normalize(s: string): string {
  return (s ?? '').toLowerCase().trim();
}
