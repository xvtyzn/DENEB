import type { PayloadShape } from '../model/types';
import type { Point } from '../layout/types';

const fmt = (n: number): string => (Math.abs(n) < 1e-6 ? '0' : String(Math.round(n * 100) / 100));

export interface EdgeFeature {
  /** 'knob' bulges outward on the +x edge, 'notch' carves inward. */
  shape: 'knob' | 'notch';
  size: number;
}

/**
 * Every domain is the same rounded box, centred on the origin with its
 * N-to-C axis running vertically. Variable and constant domains are told apart
 * by fill and corner radius rather than by outline shape, which keeps a chain
 * of mixed domains reading as one strand.
 *
 * A knob-into-hole pair is cut straight into the +x edge so the two CH3
 * domains visibly interlock instead of carrying a badge.
 */
export function domainPath(
  width: number,
  height: number,
  radius: number,
  feature?: EdgeFeature,
): string {
  const w = width / 2;
  const h = height / 2;
  const r = Math.max(0, Math.min(radius, w, h));
  const p: string[] = [];
  p.push(`M${fmt(-w + r)},${fmt(-h)}`);
  p.push(`L${fmt(w - r)},${fmt(-h)}`);
  if (r > 0) p.push(`Q${fmt(w)},${fmt(-h)} ${fmt(w)},${fmt(-h + r)}`);
  if (feature) {
    const k = Math.min(feature.size, h - r);
    // Sweep 0 bulges away from the body (knob); sweep 1 carves into it (hole).
    const sweep = feature.shape === 'knob' ? 0 : 1;
    p.push(`L${fmt(w)},${fmt(-k)}`);
    p.push(`A${fmt(k)},${fmt(k)} 0 0 ${sweep} ${fmt(w)},${fmt(k)}`);
  }
  p.push(`L${fmt(w)},${fmt(h - r)}`);
  if (r > 0) p.push(`Q${fmt(w)},${fmt(h)} ${fmt(w - r)},${fmt(h)}`);
  p.push(`L${fmt(-w + r)},${fmt(h)}`);
  if (r > 0) p.push(`Q${fmt(-w)},${fmt(h)} ${fmt(-w)},${fmt(h - r)}`);
  p.push(`L${fmt(-w)},${fmt(-h + r)}`);
  if (r > 0) p.push(`Q${fmt(-w)},${fmt(-h)} ${fmt(-w + r)},${fmt(-h)}`);
  p.push('Z');
  return p.join('');
}

/** A placed linker: a short flexible strand drawn along the chain axis. */
export function linkerPath(height: number): string {
  const h = height / 2;
  return `M0,${fmt(-h)} C${fmt(2.6)},${fmt(-h / 3)} ${fmt(-2.6)},${fmt(h / 3)} 0,${fmt(h)}`;
}

/** A hinge glyph, when one is placed rather than drawn as a connector. */
export function hingePath(height: number): string {
  const h = height / 2;
  return `M0,${fmt(-h)} L0,${fmt(h)}`;
}

export function starPath(r: number): string {
  const pts: Point[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
  }
  return `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)},${fmt(p.y)}`).join('')}Z`;
}

/** Straight, quadratic or cubic, depending on how many control points there are. */
export function curve(a: Point, b: Point, via?: Point[]): string {
  const start = `M${fmt(a.x)},${fmt(a.y)}`;
  if (!via || via.length === 0) return `${start} L${fmt(b.x)},${fmt(b.y)}`;
  if (via.length === 1) {
    const c = via[0]!;
    return `${start} Q${fmt(c.x)},${fmt(c.y)} ${fmt(b.x)},${fmt(b.y)}`;
  }
  const [c1, c2] = via as [Point, Point];
  return `${start} C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(b.x)},${fmt(b.y)}`;
}

export { fmt };

/** Outline for a conjugated small molecule, centred on the origin. */
export function payloadPath(shape: PayloadShape, r: number): string {
  switch (shape) {
    case 'circle':
      return `M${fmt(-r)},0 A${fmt(r)},${fmt(r)} 0 1 0 ${fmt(r)},0 A${fmt(r)},${fmt(r)} 0 1 0 ${fmt(-r)},0Z`;
    case 'square':
      return `M${fmt(-r)},${fmt(-r)}H${fmt(r)}V${fmt(r)}H${fmt(-r)}Z`;
    case 'diamond':
      return `M0,${fmt(-r)}L${fmt(r)},0L0,${fmt(r)}L${fmt(-r)},0Z`;
    case 'triangle':
      return `M0,${fmt(-r)}L${fmt(r * 0.87)},${fmt(r * 0.5)}L${fmt(-r * 0.87)},${fmt(r * 0.5)}Z`;
    case 'star':
      return starPath(r);
    case 'hexagon':
    default: {
      const points = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${fmt(Math.cos(a) * r)},${fmt(Math.sin(a) * r)}`;
      });
      return `M${points.join('L')}Z`;
    }
  }
}

/**
 * An N-linked glycan, drawn as the branched stub used in antibody schematics:
 * a stem off the domain surface splitting into two antennae.
 */
export function glycanPath(length: number): string {
  const stem = length * 0.55;
  const arm = length * 0.45;
  return [
    `M0,0L${fmt(stem)},0`,
    `M${fmt(stem)},0L${fmt(stem + arm)},${fmt(-arm * 0.8)}`,
    `M${fmt(stem)},0L${fmt(stem + arm)},${fmt(arm * 0.8)}`,
  ].join('');
}

/** The nodes capping a glycan's antennae. */
export function glycanNodes(length: number): { x: number; y: number }[] {
  const stem = length * 0.55;
  const arm = length * 0.45;
  return [
    { x: stem, y: 0 },
    { x: stem + arm, y: -arm * 0.8 },
    { x: stem + arm, y: arm * 0.8 },
  ];
}

/** A PEG chain: a short sine wave running away from the domain. */
export function squigglePath(length: number, amplitude = 2.2): string {
  const step = length / 3;
  return [
    'M0,0',
    `q${fmt(step / 2)},${fmt(-amplitude)} ${fmt(step)},0`,
    `q${fmt(step / 2)},${fmt(amplitude)} ${fmt(step)},0`,
    `q${fmt(step / 2)},${fmt(-amplitude)} ${fmt(step)},0`,
  ].join(' ');
}
