import { DOMAIN_CATALOG } from '../model/catalog';
import type { Theme } from '../theme/theme';
import { add, dirOf, perpOf, rotate, scale } from './geometry';
import { LINKED_SPREAD, domainWidth, type Unit } from './modules';
import type { PlacedDomain, Point } from './types';

export interface LadderOptions {
  origin: Point;
  /** Direction of increasing slot index (0 = up, positive = clockwise). */
  dirAngle: number;
  /** Rotation applied to every glyph; the glyph's local "up" is its N-terminus. */
  glyphAngle: number;
  /** Which lane `members[0]` occupies: +1 or -1. */
  laneSign: 1 | -1;
  laneGap: number;
  slotGap: number;
  /** Lay single-member slots on the primary lane instead of centring them. */
  forceLane?: boolean;
}

export interface LadderResult {
  placed: PlacedDomain[];
  /** Far end of the ladder, on the axis. */
  end: Point;
  /** Widest slot, across the axis. */
  width: number;
  length: number;
}

/** Stack units along an axis, two lanes wide. */
export function placeLadder(units: Unit[], opts: LadderOptions): LadderResult {
  const dir = dirOf(opts.dirAngle);
  const perp = perpOf(dir);
  const placed: PlacedDomain[] = [];
  const useLane = opts.forceLane ?? units.some((u) => u.members.length > 1);

  let cursor = 0;
  let width = 0;
  for (const unit of units) {
    const centerU = cursor + unit.height / 2;
    unit.members.forEach((domain, idx) => {
      const spec = DOMAIN_CATALOG[domain.type];
      const lane =
        unit.members.length > 1 || useLane ? (idx === 0 ? opts.laneSign : -opts.laneSign) : 0;
      // A linker-joined pair sits level like any other, just further apart, so
      // the strand between them has somewhere to run.
      const laneGap = opts.laneGap + (unit.linked ? LINKED_SPREAD : 0);
      const center = add(
        add(opts.origin, scale(dir, centerU)),
        scale(perp, (lane * laneGap) / 2),
      );
      const half = spec.height / 2;
      // The N-terminal edge is "up" in glyph space, which is `axis` in world space.
      const nAnchor = add(center, scale(rotate({ x: 0, y: -half }, opts.glyphAngle), 1));
      const cAnchor = add(center, scale(rotate({ x: 0, y: half }, opts.glyphAngle), 1));
      placed.push({
        domain,
        center,
        rotation: opts.glyphAngle,
        width: spec.width,
        height: spec.height,
        nAnchor,
        cAnchor,
        lane,
        axis: rotate({ x: 0, y: -1 }, opts.glyphAngle),
      });
      width = Math.max(width, spec.width + (lane === 0 ? 0 : laneGap));
    });
    tieLinkedPair(unit, placed.slice(-unit.members.length));
    cursor += unit.height + opts.slotGap;
  }

  return {
    placed,
    end: add(opts.origin, scale(dir, Math.max(0, cursor - opts.slotGap))),
    width,
    length: Math.max(0, cursor - opts.slotGap),
  };
}

/** Place units left to right, every glyph upright — used by the `row` skeleton. */
export function placeRow(
  units: Unit[],
  origin: Point,
  theme: Theme,
): { placed: PlacedDomain[]; width: number } {
  const placed: PlacedDomain[] = [];
  let x = origin.x;
  for (const unit of units) {
    unit.members.forEach((domain, idx) => {
      const spec = DOMAIN_CATALOG[domain.type];
      const cx = x + spec.width / 2;
      const center = { x: cx, y: origin.y };
      placed.push({
        domain,
        center,
        rotation: 0,
        width: spec.width,
        height: spec.height,
        nAnchor: { x: cx, y: center.y - spec.height / 2 },
        cAnchor: { x: cx, y: center.y + spec.height / 2 },
        lane: unit.members.length > 1 ? (idx === 0 ? -1 : 1) : 0,
        axis: { x: 0, y: -1 },
      });
      // A linker-joined pair needs daylight for its strand; a natively paired
      // one sits flush, the way an Fv actually packs.
      const innerGap = unit.linked ? LINKED_SPREAD : 1;
      x += spec.width + (idx < unit.members.length - 1 ? innerGap : 0);
    });
    tieLinkedPair(unit, placed.slice(-unit.members.length));
    x += theme.headGap;
  }
  return { placed, width: x - origin.x - theme.headGap };
}

/**
 * Pull the two termini a linker joins towards each other, off the middle of
 * their faces and onto the inner corners. The strand then only has to cross the
 * gap between the pair rather than the full width of a domain, which is what
 * keeps it short enough to thread a narrow gap.
 */
function tieLinkedPair(unit: Unit, members: PlacedDomain[]): void {
  if (!unit.linked || members.length !== 2) return;
  const [first, second] = members as [PlacedDomain, PlacedDomain];
  const nTerm = first.domain.index <= second.domain.index ? first : second;
  const cTerm = nTerm === first ? second : first;
  // The N-terminal domain hands the strand on from its C-terminal face, and the
  // other picks it up on its N-terminal face.
  nTerm.cAnchor = nudgeToward(nTerm, cTerm, nTerm.cAnchor);
  cTerm.nAnchor = nudgeToward(cTerm, nTerm, cTerm.nAnchor);
}

function nudgeToward(p: PlacedDomain, other: PlacedDomain, anchor: Point): Point {
  const localX = rotate({ x: 1, y: 0 }, p.rotation);
  const delta = { x: other.center.x - p.center.x, y: other.center.y - p.center.y };
  const sign = delta.x * localX.x + delta.y * localX.y >= 0 ? 1 : -1;
  return add(anchor, scale(localX, sign * p.width * 0.3));
}

/** Shift a set of already-placed glyphs. */
export function translatePlaced(placed: PlacedDomain[], dx: number, dy: number): PlacedDomain[] {
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  return placed.map((p) => ({
    ...p,
    center: shift(p.center),
    nAnchor: shift(p.nAnchor),
    cAnchor: shift(p.cAnchor),
  }));
}

export function unitWidth(unit: Unit, laneGap: number): number {
  if (unit.members.length > 1) {
    return laneGap + (unit.linked ? LINKED_SPREAD : 0) + Math.max(...unit.members.map(domainWidth));
  }
  return domainWidth(unit.members[0]!);
}
