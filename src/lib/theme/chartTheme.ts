import type { EntityColorRegistry } from '../../types/sales';

/**
 * Extended Categorical Palette — Dark Theme (exact order, wrap only after 10).
 */
export const EXTENDED_CATEGORICAL_DARK = [
  '#26E6D0', // 0: Teal (brand primary)
  '#B740DE', // 1: Purple (brand secondary)
  '#FFB547', // 2: Amber
  '#4D9DFF', // 3: Sky Blue
  '#FF6B9D', // 4: Rose Pink
  '#8BE04E', // 5: Lime Green
  '#FF7A59', // 6: Coral Orange
  '#6C63FF', // 7: Indigo
  '#F2E94E', // 8: Soft Yellow
  '#A0AEC0', // 9: Cool Slate
] as const;

/**
 * Extended Categorical Palette — Light Theme (~12-15% darkened for WCAG AA contrast).
 */
export const EXTENDED_CATEGORICAL_LIGHT = [
  '#0FB8A5', // 0: Darkened Teal
  '#9928BF', // 1: Darkened Purple
  '#D9911E', // 2: Darkened Amber
  '#297CE0', // 3: Darkened Sky Blue
  '#DF447A', // 4: Darkened Rose Pink
  '#65BA2A', // 5: Darkened Lime Green
  '#DF5736', // 6: Darkened Coral Orange
  '#4F46E5', // 7: Darkened Indigo
  '#C4BA1D', // 8: Darkened Soft Yellow
  '#718096', // 9: Darkened Cool Slate
] as const;

export const OTHER_SLICE_COLOR = '#64748B';

export const SEMANTIC_COLORS = {
  dark: {
    positive: '#2ED573',
    negative: '#FF5C7A',
    warning: '#FFB547',
    neutral: '#A0AEC0',
  },
  light: {
    positive: '#1FA958',
    negative: '#D93858',
    warning: '#D48A18',
    neutral: '#64748B',
  },
} as const;

export const SURFACE_COLORS = {
  dark: '#16314D',
  light: '#FFFFFF',
} as const;

export const CANVAS_COLORS = {
  dark: '#0F2238',
  light: '#F4F7FA',
} as const;

export const MARKER_SHAPES = [
  'circle',
  'square',
  'triangle',
  'diamond',
  'star',
  'cross',
  'wye',
] as const;

export type MarkerShape = (typeof MARKER_SHAPES)[number];

export function getCategoricalPalette(theme: 'dark' | 'light'): readonly string[] {
  return theme === 'dark' ? EXTENDED_CATEGORICAL_DARK : EXTENDED_CATEGORICAL_LIGHT;
}

export function getPaletteColor(index: number, theme: 'dark' | 'light'): string {
  const palette = getCategoricalPalette(theme);
  return palette[((index % palette.length) + palette.length) % palette.length];
}

export function getSemanticColors(theme: 'dark' | 'light') {
  return SEMANTIC_COLORS[theme];
}

export function getSurfaceColor(theme: 'dark' | 'light'): string {
  return SURFACE_COLORS[theme];
}

/**
 * Returns '#0F2238' or '#FFFFFF' depending on which achieves higher WCAG AA contrast against hex.
 */
export function getContrastingLabelColor(hex: string): '#0F2238' | '#FFFFFF' {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#FFFFFF';
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  // Contrast against white (L=1) vs #0F2238 (L≈0.017)
  const contrastWhite = (1.0 + 0.05) / (lum + 0.05);
  const contrastNavy = (lum + 0.05) / (0.017 + 0.05);
  return contrastNavy >= contrastWhite ? '#0F2238' : '#FFFFFF';
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function lerpHex(hexA: string, hexB: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(hexA);
  const [r2, g2, b2] = hexToRgb(hexB);
  const f = Math.max(0, Math.min(1, t));
  return rgbToHex(r1 + (r2 - r1) * f, g1 + (g2 - g1) * f, b1 + (b2 - b1) * f);
}

/**
 * Sequential Scale for Heatmaps & Choropleth Maps:
 * #16314D (low) -> #26E6D0 (mid) -> #B740DE (high)
 * Light theme uses slightly darkened mid/high for AA legibility.
 */
export function getSequentialScaleColor(
  ratio: number,
  theme: 'dark' | 'light' = 'dark'
): { fill: string; text: '#0F2238' | '#FFFFFF' } {
  const clamped = Math.max(0, Math.min(1, ratio));
  const low = theme === 'dark' ? '#16314D' : '#DCE7F3';
  const mid = theme === 'dark' ? '#26E6D0' : '#0FB8A5';
  const high = theme === 'dark' ? '#B740DE' : '#9928BF';

  const fill = clamped <= 0.5 ? lerpHex(low, mid, clamped / 0.5) : lerpHex(mid, high, (clamped - 0.5) / 0.5);
  return { fill, text: getContrastingLabelColor(fill) };
}

/**
 * Diverging Scale for Variance Charts:
 * #FF5C7A (negative) <- #A0AEC0 (zero/neutral) -> #26E6D0 (positive)
 */
export function getDivergingScaleColor(
  normalizedValue: number, // -1 to +1
  theme: 'dark' | 'light' = 'dark'
): string {
  const neg = theme === 'dark' ? '#FF5C7A' : '#D93858';
  const mid = theme === 'dark' ? '#A0AEC0' : '#718096';
  const pos = theme === 'dark' ? '#26E6D0' : '#0FB8A5';
  const clamped = Math.max(-1, Math.min(1, normalizedValue));
  if (clamped < 0) {
    return lerpHex(mid, neg, Math.abs(clamped));
  }
  return lerpHex(mid, pos, clamped);
}

/**
 * Fixed entity color lookup backed by persisted EntityColorRegistry.
 * Ensures every Category, Store, Province, and Salesperson keeps the same color everywhere.
 */
export function getEntityColor(
  registry: EntityColorRegistry,
  dimension: keyof EntityColorRegistry,
  entityName: string,
  theme: 'dark' | 'light'
): string {
  if (entityName === 'Other') return OTHER_SLICE_COLOR;
  const idx = registry[dimension]?.[entityName];
  if (typeof idx === 'number') {
    return getPaletteColor(idx, theme);
  }
  // Stable deterministic fallback hash if entity not yet registered
  let hash = 0;
  for (let i = 0; i < entityName.length; i++) {
    hash = (hash * 31 + entityName.charCodeAt(i)) >>> 0;
  }
  return getPaletteColor(hash % 10, theme);
}

export function getEntityColorIndex(
  registry: EntityColorRegistry,
  dimension: keyof EntityColorRegistry,
  entityName: string
): number {
  const idx = registry[dimension]?.[entityName];
  if (typeof idx === 'number') return idx % 10;
  let hash = 0;
  for (let i = 0; i < entityName.length; i++) {
    hash = (hash * 31 + entityName.charCodeAt(i)) >>> 0;
  }
  return hash % 10;
}

/**
 * Assigns stable palette indices (0..9) for any new entities while preserving existing assignments.
 */
export function reconcileEntityColors(
  current: EntityColorRegistry,
  entities: {
    categories: string[];
    stores: string[];
    provinces: string[];
    salespeople: string[];
  }
): { registry: EntityColorRegistry; changed: boolean } {
  let changed = false;
  const next: EntityColorRegistry = {
    categories: { ...(current.categories ?? {}) },
    stores: { ...(current.stores ?? {}) },
    provinces: { ...(current.provinces ?? {}) },
    salespeople: { ...(current.salespeople ?? {}) },
  };

  (Object.keys(entities) as Array<keyof EntityColorRegistry>).forEach((dim) => {
    const map = next[dim];
    let nextIdx = Object.keys(map).length;
    for (const name of [...entities[dim]].sort()) {
      if (name && map[name] === undefined) {
        map[name] = nextIdx % 10;
        nextIdx += 1;
        changed = true;
      }
    }
  });

  return { registry: next, changed };
}

/**
 * Groups items into at most `maxSlices` (default 8) plus a single "Other" bucket (#64748B) if needed.
 */
export function groupTopSlicesWithOther<T extends { sales: number }>(
  items: T[],
  getLabel: (item: T) => string,
  maxSlices = 8
): Array<{ label: string; sales: number; sharePct: number; isOther: boolean; count: number }> {
  const total = items.reduce((acc, item) => acc + item.sales, 0);
  const sorted = [...items].sort((a, b) => b.sales - a.sales);
  if (sorted.length <= maxSlices) {
    return sorted.map((item) => ({
      label: getLabel(item),
      sales: item.sales,
      sharePct: total > 0 ? item.sales / total : 0,
      isOther: false,
      count: 1,
    }));
  }

  const head = sorted.slice(0, maxSlices).map((item) => ({
    label: getLabel(item),
    sales: item.sales,
    sharePct: total > 0 ? item.sales / total : 0,
    isOther: false,
    count: 1,
  }));
  const tail = sorted.slice(maxSlices);
  const otherSales = tail.reduce((acc, item) => acc + item.sales, 0);
  head.push({
    label: 'Other',
    sales: Number(otherSales.toFixed(2)),
    sharePct: total > 0 ? otherSales / total : 0,
    isOther: true,
    count: tail.length,
  });
  return head;
}

/**
 * Returns pattern ID for colour-blind safe bar/slice fills when > 6 series share a chart.
 */
export function getPatternId(prefix: string, index: number): string {
  return `${prefix}-pat-${index % 10}`;
}

export function getMarkerShape(index: number): MarkerShape {
  return MARKER_SHAPES[index % MARKER_SHAPES.length];
}
