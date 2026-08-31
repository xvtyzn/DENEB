import type { Link, NChain, NDomain } from '../model/types';
import { DOMAIN_CATALOG } from '../model/catalog';
import { add, rotate, scale } from './geometry';
import type { Connector, PlacedDomain, Point } from './types';

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function length(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Unit normal of a->b, rotated 90° clockwise. */
function normal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/**
 * Connect consecutive domains of every chain. Domains that were not given a
 * slot of their own — hinges and the linker inside an scFv head — are skipped
 * over, and the connector that bridges them is drawn as a curve instead of a
 * straight backbone segment.
 */
/** Is `p` inside the glyph, allowing a small margin for the stroke? */
export function insideGlyph(p: Point, d: PlacedDomain, margin = 0.3): boolean {
  const a = (-d.rotation * Math.PI) / 180;
  const dx = p.x - d.center.x;
  const dy = p.y - d.center.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  // Fusion partners are drawn as circles; testing them as squares would call
  // the clear space at their corners a collision.
  if (DOMAIN_CATALOG[d.domain.type].glyph === 'globule') {
    return Math.hypot(lx / (d.width / 2 + margin), ly / (d.height / 2 + margin)) < 1;
  }
  return Math.abs(lx) < d.width / 2 + margin && Math.abs(ly) < d.height / 2 + margin;
}

export function pointOn(a: Point, b: Point, via: Point[] | undefined, t: number): Point {
  const u = 1 - t;
  if (!via || via.length === 0) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  if (via.length === 1) {
    const c = via[0]!;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    };
  }
  const [c1, c2] = via as [Point, Point];
  return {
    x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x,
    y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y,
  };
}

/**
 * Does this route stay clear?
 *
 * `others` must be avoided along the whole path. `ends` are the two domains the
 * strand joins: it obviously touches them where it leaves and arrives, so only
 * the middle of the path is checked against those — a strand lying across the
 * face of its own domain is just as wrong as one lying across anyone else's.
 */
function isClear(
  a: Point,
  b: Point,
  via: Point[] | undefined,
  others: PlacedDomain[],
  ends: PlacedDomain[],
): boolean {
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = pointOn(a, b, via, t);
    for (const d of others) if (insideGlyph(p, d)) return false;
    if (t > 0.1 && t < 0.9) {
      for (const d of ends) if (insideGlyph(p, d)) return false;
    }
  }
  return true;
}

/**
 * Bow a linker until it clears every domain it is not attached to.
 *
 * A cross-paired format — a diabody, a DART, a TandAb — has strands that must
 * reach past the domain sitting between their two ends. Drawing them straight
 * buries the strand under a glyph; the arc is opened up until it passes clear,
 * keeping the preferred side and the smallest curve that works.
 */
/** Rough arc length, used to prefer the tightest route that still gets through. */
function pathLength(a: Point, b: Point, via: Point[]): number {
  let total = 0;
  let previous = a;
  for (let i = 1; i <= 16; i++) {
    const p = pointOn(a, b, via, i / 16);
    total += length(previous, p);
    previous = p;
  }
  return total;
}

/**
 * Pick the shortest route that stays clear. Candidates are generated wide, then
 * sorted by how much strand they actually use, so the drawing threads between
 * the glyphs wherever it can and only swings out when it has to.
 */
function shortestClear(
  a: Point,
  b: Point,
  candidates: Point[][],
  others: PlacedDomain[],
  ends: PlacedDomain[],
): Point[] {
  const ranked = candidates
    .map((via) => ({ via, cost: pathLength(a, b, via) }))
    .sort((x, y) => x.cost - y.cost);
  for (const { via } of ranked) {
    if (isClear(a, b, via, others, ends)) return via;
  }
  return ranked[ranked.length - 1]?.via ?? [];
}

function routeLinker(
  a: Point,
  b: Point,
  preferred: 1 | -1,
  others: PlacedDomain[],
  ends: PlacedDomain[],
): Point[] {
  const m = mid(a, b);
  const n = normal(a, b);
  const span = length(a, b);
  const candidates: Point[][] = [];
  for (const side of [preferred, -preferred as 1 | -1]) {
    for (const k of [0.16, 0.28, 0.45, 0.65, 0.9]) {
      candidates.push([add(m, scale(n, side * Math.min(span * k, 26)))]);
    }
  }
  return shortestClear(a, b, candidates, others, ends);
}

/**
 * The strand between two domains that stand level and side by side — the two
 * halves of a single-chain Fv, or two Fv heads in a tandem.
 *
 * Every domain is drawn N-terminus up, so the C-terminal face of one and the
 * N-terminal face of the other end up at opposite corners. The strand needs a
 * cubic to leave downwards and arrive downwards; where it runs — up the gap
 * between the two, or right over the top when something sits in the way — comes
 * out of trying the tighter routes first.
 */
function routeLevelPair(
  prev: PlacedDomain,
  next: PlacedDomain,
  others: PlacedDomain[],
  ends: PlacedDomain[],
): Point[] {
  const local = rotate(
    { x: next.center.x - prev.center.x, y: next.center.y - prev.center.y },
    -prev.rotation,
  );
  const toWorld = (p: Point): Point => add(prev.center, rotate(p, prev.rotation));
  // Start and finish where the anchors actually are: for a linker-joined pair
  // those have been pulled onto the facing corners.
  const a = prev.cAnchor;
  const b = next.nAnchor;
  const localA = rotate(
    { x: a.x - prev.center.x, y: a.y - prev.center.y },
    -prev.rotation,
  );
  const localB = rotate(
    { x: b.x - prev.center.x, y: b.y - prev.center.y },
    -prev.rotation,
  );
  const midX = (localA.x + localB.x) * 0.5;
  const forward = Math.sign(local.x) || 1;

  const candidates: Point[][] = [];
  const h = prev.height;

  // Up the gap between the two. The tighter the gap, the deeper the strand has
  // to dip before it can turn up into it without grazing a corner.
  for (const d of [0.2, 0.3, 0.45, 0.62, 0.85, 1.05, 1.3, 1.7, 2.2]) {
    candidates.push([
      { x: midX, y: localA.y + h * d },
      { x: midX, y: localB.y - h * d },
    ]);
  }
  // Under the row, then up whichever gap is nearest the far end — this is what
  // lets a long strand thread between the glyphs instead of arcing over them.
  for (const fx of [0.55, 0.7, 0.82]) {
    for (const d of [0.3, 0.5, 0.8]) {
      for (const r of [0.12, 0.3, 0.55]) {
        candidates.push([
          { x: localA.x + (localB.x - localA.x) * (1 - fx) * 0.5, y: localA.y + h * d },
          { x: localA.x + (localB.x - localA.x) * fx, y: localB.y - h * r },
        ]);
      }
    }
  }
  // Last resort: drop clear of the near domain and sweep over the top.
  for (const back of [1.2, 2.2, 3.0]) {
    for (const k of [0.9, 1.5, 2.2, 3.2, 4.2]) {
      candidates.push([
        { x: localA.x - forward * prev.width * back, y: localA.y + h * 0.5 },
        { x: midX, y: localB.y - h * k },
      ]);
    }
  }

  return shortestClear(
    a,
    b,
    candidates.map((control) => control.map(toWorld)),
    others,
    ends,
  );
}

/** Are the two glyphs shoulder to shoulder, as the halves of an Fv head are? */
function isBesidePair(prev: PlacedDomain, next: PlacedDomain): boolean {
  if (Math.abs(prev.rotation - next.rotation) > 1) return false;
  const local = rotate(
    { x: next.center.x - prev.center.x, y: next.center.y - prev.center.y },
    -prev.rotation,
  );
  // Shoulder to shoulder means immediately adjacent. Two domains further apart
  // along the row have something between them, and their strand has to be routed
  // around rather than up the gap.
  return Math.abs(local.y) < prev.height * 0.35 && Math.abs(local.x) > prev.width * 0.5;
}

export function chainConnectors(
  chains: NChain[],
  byId: Map<string, PlacedDomain>,
  center: Point,
): Connector[] {
  const out: Connector[] = [];
  for (const chain of chains) {
    let prev: PlacedDomain | undefined;
    let skipped: NDomain[] = [];
    for (const domain of chain.domains) {
      const placed = byId.get(domain.id);
      if (!placed) {
        skipped.push(domain);
        continue;
      }
      if (prev) {
        const a = prev.cAnchor;
        const b = placed.nAnchor;
        const isLinker = skipped.some((d) => d.type === 'linker');
        const isHinge = skipped.some((d) => d.type === 'hinge');
        const connector: Connector = {
          kind: isLinker ? 'linker' : isHinge ? 'hinge' : 'backbone',
          a,
          b,
          domainA: prev.domain.id,
          domainB: placed.domain.id,
        };
        if (skipped.length > 0) connector.skipped = skipped.map((d) => d.id);
        const span = length(a, b);
        const glyphs = [...byId.values()].filter(
          (d) => DOMAIN_CATALOG[d.domain.type].glyph !== 'linker',
        );
        const others = glyphs.filter((d) => d !== prev && d !== placed);
        const ends = [prev, placed];
        if (isLinker && isBesidePair(prev, placed)) {
          connector.via = routeLevelPair(prev, placed, others, ends);
        } else if (isLinker && span > 4) {
          // Bow away from the two glyphs it joins, then open the arc further if
          // that path would run through anything else.
          const m = mid(a, b);
          const bodies = mid(prev.center, placed.center);
          const from = Math.hypot(m.x - bodies.x, m.y - bodies.y) > 1 ? bodies : center;
          const n = normal(a, b);
          const away: 1 | -1 =
            (m.x - from.x) * n.x + (m.y - from.y) * n.y >= 0 ? 1 : -1;
          connector.via = routeLinker(a, b, away, others, ends);
        }
        out.push(connector);
      }
      prev = placed;
      skipped = [];
    }
  }
  return out;
}

/** Explicit disulfide/pairing links from the construct, plus hinge disulfides. */
export function structuralConnectors(
  links: Link[],
  byId: Map<string, PlacedDomain>,
  resolve: (ref: string) => NDomain | undefined,
): Connector[] {
  const out: Connector[] = [];
  for (const link of links) {
    // Pairing is drawn from the partner graph instead, which every route into
    // the model feeds -- an explicit `pair` link sets `partner` too, so reading
    // both here would draw the same contact twice.
    if (link.type !== 'disulfide') continue;
    const da = resolve(link.a);
    const db = resolve(link.b);
    if (!da || !db) continue;
    const pa = byId.get(da.id);
    const pb = byId.get(db.id);
    if (!pa || !pb) continue;
    out.push({
      kind: 'disulfide',
      a: pa.center,
      b: pb.center,
      domainA: da.id,
      domainB: db.id,
    });
  }
  return out;
}

/** Are these two glyphs drawn as one head -- level, and about a lane apart? */
function drawnAsPair(a: PlacedDomain, b: PlacedDomain): boolean {
  if (Math.abs(a.rotation - b.rotation) > 1) return false;
  const local = rotate({ x: b.center.x - a.center.x, y: b.center.y - a.center.y }, -a.rotation);
  return Math.abs(local.y) < a.height * 0.35 && Math.abs(local.x) < a.width + b.width;
}

/** Where the line from `p`'s centre towards `to` leaves `p`'s glyph. */
function edgePoint(p: PlacedDomain, to: Point): Point {
  const local = rotate({ x: to.x - p.center.x, y: to.y - p.center.y }, -p.rotation);
  const limits = [
    Math.abs(local.x) > 1e-6 ? p.width / 2 / Math.abs(local.x) : Infinity,
    Math.abs(local.y) > 1e-6 ? p.height / 2 / Math.abs(local.y) : Infinity,
  ];
  const k = Math.min(...limits);
  if (!Number.isFinite(k)) return p.center;
  return add(p.center, rotate({ x: local.x * k, y: local.y * k }, p.rotation));
}

/**
 * Contacts between partners the layout could not put side by side.
 *
 * Domains that pair normally share a slot and stand shoulder to shoulder, and
 * their position alone says so. A crossed format cannot have that both ways at
 * once: CODV-Ig runs VH-A/VH-B down the heavy chain against VL-B/VL-A down the
 * light chain, so whichever way round the ladder is built its partners end up
 * diagonal. Drawing the contact is then the only thing separating it from a
 * DVD-Ig, whose pairs really are in line.
 */
export function pairingConnectors(
  chains: NChain[],
  byId: Map<string, PlacedDomain>,
): Connector[] {
  const out: Connector[] = [];
  const seen = new Set<string>();
  for (const chain of chains) {
    for (const domain of chain.domains) {
      if (!domain.partner) continue;
      const key = [domain.id, domain.partner].sort().join('\u0000');
      if (seen.has(key)) continue;
      seen.add(key);
      const a = byId.get(domain.id);
      const b = byId.get(domain.partner);
      if (!a || !b || drawnAsPair(a, b)) continue;
      out.push({
        kind: 'pairing',
        a: edgePoint(a, b.center),
        b: edgePoint(b, a.center),
        domainA: a.domain.id,
        domainB: b.domain.id,
      });
    }
  }
  return out;
}

/**
 * Inter-chain disulfides at the hinge: drawn between the two backbone segments
 * that descend into the Fc, which is where the figure convention puts them.
 */
export function hingeDisulfides(connectors: Connector[]): Connector[] {
  const hinges = connectors.filter((c) => c.kind === 'hinge');
  if (hinges.length < 2) return [];
  const [a, b] = [hinges[0]!, hinges[1]!];
  const out: Connector[] = [];
  for (const t of [0.5, 0.75]) {
    out.push({
      kind: 'disulfide',
      a: { x: a.a.x + (a.b.x - a.a.x) * t, y: a.a.y + (a.b.y - a.a.y) * t },
      b: { x: b.a.x + (b.b.x - b.a.x) * t, y: b.a.y + (b.b.y - b.a.y) * t },
    });
  }
  return out;
}
