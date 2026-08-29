import type { Point, Rect } from './types';

export const DEG = Math.PI / 180;

/** Unit vector for a ladder direction angle (0 = up, positive = clockwise). */
export function dirOf(angleDeg: number): Point {
  const a = angleDeg * DEG;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** The direction rotated 90° clockwise. */
export function perpOf(dir: Point): Point {
  return { x: -dir.y, y: dir.x };
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(p: Point, k: number): Point {
  return { x: p.x * k, y: p.y * k };
}

/** Rotate a point about the origin by `angleDeg` clockwise in screen coordinates. */
export function rotate(p: Point, angleDeg: number): Point {
  const a = angleDeg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function boundsOf(points: Point[], pad = 0): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/** The four corners of a rotated glyph, for bounding-box accumulation. */
export function cornersOf(center: Point, width: number, height: number, rotation: number): Point[] {
  const hw = width / 2;
  const hh = height / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => add(center, rotate(p, rotation)));
}
