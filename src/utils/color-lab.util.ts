// eslint-disable-next-line @typescript-eslint/no-require-imports
const convert = require('color-convert') as { rgb: { lab: (r: number, g: number, b: number) => [number, number, number] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DeltaE = require('delta-e') as { getDeltaE00: (a: { L: number; A: number; B: number }, b: { L: number; A: number; B: number }) => number };

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function rgbToLab(r: number, g: number, b: number): LabColor {
  const [l, a, b2] = convert.rgb.lab(r, g, b);
  return { l, a, b: b2 };
}

const MIN_COLOR_RATIO = 0.5;
const DELTA_E_THRESHOLD = 15;

/**
 * Compare query LAB colors to DB LAB colors using Delta E 2000.
 * Match if at least MIN_COLOR_RATIO of query colors have a DB color within DELTA_E_THRESHOLD.
 */
export function isColorMatch(
  queryLabColors: LabColor[],
  dbLabColors: LabColor[] | null | undefined,
): boolean {
  if (!queryLabColors?.length) return true;
  if (!dbLabColors?.length) return false;

  let matchCount = 0;
  for (const q of queryLabColors) {
    for (const d of dbLabColors) {
      const delta = DeltaE.getDeltaE00(
        { L: q.l, A: q.a, B: q.b },
        { L: d.l, A: d.a, B: d.b },
      );
      if (delta <= DELTA_E_THRESHOLD) {
        matchCount++;
        break;
      }
    }
  }
  const ratio = matchCount / queryLabColors.length;
  return ratio >= MIN_COLOR_RATIO;
}
