/**
 * Dynamic category expansion – primary enums only. Detail fields are free text.
 */

export const PATTERN_PRIMARY_ENUM = [
  'solid',
  'striped',
  'checked',
  'plaid',
  'floral',
  'geometric',
  'abstract',
  'paisley',
  'herringbone',
  'ikat',
  'animal print',
  'textured',
  'embroidered',
  'printed',
  'quilted',
  'lace',
  'tie-dye',
] as const;

export const WEAVE_PRIMARY_ENUM = [
  'plain weave',
  'twill',
  'satin',
  'knit',
  'rib knit',
  'jacquard',
  'denim',
  'chiffon',
  'linen weave',
  'canvas',
  'crepe',
  'velvet',
  'corduroy',
  'georgette',
  'organza',
  'dobby',
] as const;

export const STRIPE_WIDTH_ENUM = ['none', 'thin', 'medium', 'broad'] as const;

export const FABRIC_TYPE_ENUM = [
  'cotton',
  'linen',
  'silk',
  'wool',
  'polyester',
  'viscose',
  'rayon',
  'lycra',
  'spandex',
  'blend',
] as const;

export type PatternPrimaryType = (typeof PATTERN_PRIMARY_ENUM)[number];
export type WeavePrimaryType = (typeof WEAVE_PRIMARY_ENUM)[number];
export type StripeWidthType = (typeof STRIPE_WIDTH_ENUM)[number];
export type FabricType = (typeof FABRIC_TYPE_ENUM)[number];

export function isPatternPrimary(value: string): value is PatternPrimaryType {
  return (PATTERN_PRIMARY_ENUM as readonly string[]).includes(value);
}

export function isWeavePrimary(value: string): value is WeavePrimaryType {
  return (WEAVE_PRIMARY_ENUM as readonly string[]).includes(value);
}

export function isStripeWidth(value: string): value is StripeWidthType {
  return (STRIPE_WIDTH_ENUM as readonly string[]).includes(value);
}

export function isFabricType(value: string): value is FabricType {
  return (FABRIC_TYPE_ENUM as readonly string[]).includes(value);
}

/** Map unknown pattern string to closest primary (never return "unknown"). */
export function mapToPatternPrimary(value: string): PatternPrimaryType {
  const v = (value ?? '').toLowerCase().trim();
  if (isPatternPrimary(v)) return v as PatternPrimaryType;
  if (/strip|stripe/i.test(v)) return 'striped';
  if (/check|plaid|grid|windowpane/i.test(v)) return 'checked';
  if (/plaid|tartan/i.test(v)) return 'plaid';
  if (/floral|flower/i.test(v)) return 'floral';
  if (/geometric|dot|polka/i.test(v)) return 'geometric';
  if (/abstract|print/i.test(v)) return 'abstract';
  if (/paisley/i.test(v)) return 'paisley';
  if (/herringbone/i.test(v)) return 'herringbone';
  if (/ikat/i.test(v)) return 'ikat';
  if (/animal|leopard|zebra/i.test(v)) return 'animal print';
  if (/texture|nubby|rough/i.test(v)) return 'textured';
  if (/embroider/i.test(v)) return 'embroidered';
  if (/print/i.test(v)) return 'printed';
  if (/quilt/i.test(v)) return 'quilted';
  if (/lace|eyelet/i.test(v)) return 'lace';
  if (/tie-dye|dye/i.test(v)) return 'tie-dye';
  return 'solid';
}

/** Map unknown weave string to closest primary. */
export function mapToWeavePrimary(value: string): WeavePrimaryType {
  const v = (value ?? '').toLowerCase().trim();
  if (isWeavePrimary(v)) return v as WeavePrimaryType;
  if (/twill/i.test(v)) return 'twill';
  if (/satin/i.test(v)) return 'satin';
  if (/knit|jersey/i.test(v)) return 'knit';
  if (/rib/i.test(v)) return 'rib knit';
  if (/jacquard/i.test(v)) return 'jacquard';
  if (/denim/i.test(v)) return 'denim';
  if (/chiffon/i.test(v)) return 'chiffon';
  if (/linen/i.test(v)) return 'linen weave';
  if (/canvas/i.test(v)) return 'canvas';
  if (/crepe/i.test(v)) return 'crepe';
  if (/velvet/i.test(v)) return 'velvet';
  if (/corduroy/i.test(v)) return 'corduroy';
  if (/georgette/i.test(v)) return 'georgette';
  if (/organza/i.test(v)) return 'organza';
  if (/dobby/i.test(v)) return 'dobby';
  return 'plain weave';
}
