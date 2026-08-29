export interface Theme {
  /** Colours assigned to specificities, in order. */
  palette: string[];
  /** Fill for constant (non-coloured) domains. */
  constantFill: string;
  constantStroke: string;
  /** Fill for a domain with no specificity that would otherwise be coloured. */
  unknownFill: string;
  /** Stroke used for every glyph outline. */
  outline: string;
  outlineWidth: number;
  /** Backbone (hinge / linker / chain trace) colour. */
  backbone: string;
  backboneWidth: number;
  /** Colour of the disulfide ticks. */
  disulfide: string;
  /** Text. */
  fontFamily: string;
  labelSize: number;
  titleSize: number;
  legendSize: number;
  labelColor: string;
  /** Geometry. */
  laneGap: number;
  slotGap: number;
  hingeGap: number;
  armAngle: number;
  headGap: number;
  padding: number;
  /** Highlight ring. */
  highlight: string;
  highlightWidth: number;
  /** Page background written into the root <svg>; `null` leaves it transparent. */
  background: string | null;
}

/**
 * Okabe–Ito derived, colour-vision-deficiency safe. The first two entries are
 * blue and red so that the canonical two-target bispecific matches the
 * convention used throughout the literature.
 */
export const DEFAULT_PALETTE = [
  '#2f6fb5', // blue
  '#c0392b', // red
  '#2e9e5b', // green
  '#e08a1e', // orange
  '#7d4bab', // purple
  '#17a2b8', // teal
  '#c2185b', // magenta
  '#8d6e3a', // brown
];

export const defaultTheme: Theme = {
  palette: DEFAULT_PALETTE,
  constantFill: '#c3c8cf',
  constantStroke: '#5b6472',
  unknownFill: '#e6e8eb',
  outline: '#333a45',
  outlineWidth: 1,
  backbone: '#4a5261',
  backboneWidth: 1.6,
  disulfide: '#3d4450',
  fontFamily:
    "ui-sans-serif, -apple-system, 'Helvetica Neue', 'Hiragino Sans', 'Noto Sans JP', Arial, sans-serif",
  labelSize: 7,
  titleSize: 12,
  legendSize: 9,
  labelColor: '#1c222b',
  laneGap: 17,
  slotGap: 1.5,
  hingeGap: 10,
  armAngle: 32,
  headGap: 13,
  padding: 16,
  highlight: '#f2b705',
  highlightWidth: 3,
  background: null,
};

export function resolveTheme(theme?: Partial<Theme>): Theme {
  return theme ? { ...defaultTheme, ...theme } : defaultTheme;
}

/** Lighten a hex colour towards white by `amount` (0..1). Used for VL tints. */
export function tint(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `#${((mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).padStart(6, '0')}`;
}

/** Darken a hex colour towards black by `amount` (0..1). Used for outlines. */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const mix = (c: number) => Math.round(c * (1 - amount));
  return `#${((mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).padStart(6, '0')}`;
}
