import { describe, expect, it } from 'vitest';
import { DOMAIN_CATALOG, defaultTheme, layout, normalize, parseDSL } from '../src/index';
import { getPreset, presetNames } from '../src/presets/index';
import { cornersOf } from '../src/layout/geometry';
import { insideGlyph, pointOn } from '../src/layout/links';
import type { Connector, PlacedDomain, Point } from '../src/layout/types';

/** Linkers and hinges are strokes, not boxes, so they may sit close to a glyph. */
function boxes(placed: PlacedDomain[]): PlacedDomain[] {
  return placed.filter((p) => {
    const glyph = DOMAIN_CATALOG[p.domain.type].glyph;
    return glyph === 'variable' || glyph === 'constant' || glyph === 'globule';
  });
}

/** Points along a connector — straight, quadratic or cubic, as drawn. */
function samplePath(c: Connector, steps = 26): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => pointOn(c.a, c.b, c.via, i / steps));
}

/** Separating-axis test over the two rotated glyph rectangles. */
function overlaps(a: PlacedDomain, b: PlacedDomain): boolean {
  const boxA = cornersOf(a.center, a.width, a.height, a.rotation);
  const boxB = cornersOf(b.center, b.width, b.height, b.rotation);
  const axes = [...edgeNormals(boxA), ...edgeNormals(boxB)];
  // A gap on any axis proves they are apart; a hair of contact is not overlap.
  return !axes.some((axis) => {
    const [minA, maxA] = project(boxA, axis);
    const [minB, maxB] = project(boxB, axis);
    return maxA <= minB + 0.01 || maxB <= minA + 0.01;
  });
}

function edgeNormals(box: Point[]): Point[] {
  return [0, 1].map((i) => {
    const p = box[i]!;
    const q = box[i + 1]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
  });
}

function project(box: Point[], axis: Point): [number, number] {
  const values = box.map((p) => p.x * axis.x + p.y * axis.y);
  return [Math.min(...values), Math.max(...values)];
}

describe('layout invariants', () => {
  it.each(presetNames())('%s gives every structural domain its own slot', (name) => {
    const result = layout(getPreset(name));
    const all = normalize(getPreset(name)).chains.flatMap((c) => c.domains);
    const placedIds = new Set(result.domains.map((d) => d.domain.id));
    expect(placedIds.size).toBe(result.domains.length);
    // Hinges, and linkers the layout folded into a curve, are drawn as
    // connectors instead of glyphs; nothing else may be dropped.
    const missing = all.filter((d) => !placedIds.has(d.id));
    expect(missing.map((d) => d.type).filter((t) => t !== 'hinge' && t !== 'linker')).toEqual([]);
  });

  it.each(presetNames())('%s draws no two domain glyphs on top of each other', (name) => {
    const placed = boxes(layout(getPreset(name)).domains);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        expect(overlaps(a, b), `${name}: ${a.domain.id} vs ${b.domain.id}`).toBe(false);
      }
    }
  });

  it.each(presetNames())('%s produces a finite bounding box that contains every glyph', (name) => {
    const { bbox, domains } = layout(getPreset(name));
    expect(Number.isFinite(bbox.width) && bbox.width > 0).toBe(true);
    for (const d of domains) {
      const r = Math.max(d.width, d.height) / 2;
      expect(d.center.x - r).toBeGreaterThanOrEqual(bbox.x);
      expect(d.center.x + r).toBeLessThanOrEqual(bbox.x + bbox.width);
      expect(d.center.y - r).toBeGreaterThanOrEqual(bbox.y);
      expect(d.center.y + r).toBeLessThanOrEqual(bbox.y + bbox.height);
    }
  });

  it.each(presetNames())('%s routes every linker clear of the other domains', (name) => {
    const { connectors, domains } = layout(getPreset(name));
    const glyphs = boxes(domains);
    for (const c of connectors.filter((k) => k.kind === 'linker')) {
      const obstacles = glyphs.filter(
        (d) => d.domain.id !== c.domainA && d.domain.id !== c.domainB,
      );
      for (const d of obstacles) {
        const buried = samplePath(c).filter((p) => insideGlyph(p, d, -1)).length;
        expect(buried, `${name}: ${c.domainA}->${c.domainB} runs through ${d.domain.id}`).toBe(0);
      }
      // Nor across the faces of the two it joins, apart from leaving and arriving.
      const ends = [c.domainA, c.domainB]
        .map((id) => glyphs.find((d) => d.domain.id === id))
        .filter((d): d is (typeof glyphs)[number] => Boolean(d));
      const path = samplePath(c);
      const skip = Math.ceil(path.length * 0.12);
      const middle = path.slice(skip, -skip);
      for (const d of ends) {
        expect(
          middle.filter((p) => insideGlyph(p, d, -1)).length,
          `${name}: ${c.domainA}->${c.domainB} lies across ${d.domain.id}`,
        ).toBe(0);
      }
    }
  });

  it.each(presetNames())('%s never lays one connector along another', (name) => {
    const { connectors } = layout(getPreset(name));
    const drawn = connectors.filter((c) => c.kind !== 'disulfide');
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        const a = samplePath(drawn[i]!);
        const b = samplePath(drawn[j]!);
        // Crossing is fine — a diabody's strands have to cross. Running along
        // one another for any distance is not.
        const together = a.filter((p) =>
          b.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1.5),
        ).length;
        expect(together / a.length, name).toBeLessThan(0.35);
      }
    }
  });

  it('is deterministic', () => {
    for (const name of presetNames()) {
      const a = layout(getPreset(name));
      const b = layout(getPreset(name));
      expect(a.domains.map((d) => d.center)).toEqual(b.domains.map((d) => d.center));
    }
  });

  it('lays a symmetric IgG out symmetrically', () => {
    const { domains } = layout(getPreset('igg1'));
    const xs = domains.map((d) => Math.round(d.center.x * 100) / 100).sort((a, b) => a - b);
    const mirrored = xs.map((x) => -x).sort((a, b) => a - b);
    expect(xs).toEqual(mirrored);
  });
});

describe('skeleton selection', () => {
  it('uses the Y skeleton whenever an Fc or a Fab constant domain is present', () => {
    expect(layout(getPreset('igg1')).construct.layout.skeleton).toBe('y');
    expect(layout(getPreset('fab')).construct.layout.skeleton).toBe('y');
  });

  it('uses the row skeleton for variable-domain-only fragments', () => {
    expect(layout(getPreset('bite')).construct.layout.skeleton).toBe('row');
    expect(layout(getPreset('vhh')).construct.layout.skeleton).toBe('row');
  });

  it('detects the crossed arm mode of a DART-Fc', () => {
    expect(layout(getPreset('dart-fc')).construct.layout.armMode).toBe('crossed');
    expect(layout(getPreset('igg-kih')).construct.layout.armMode).toBe('splayed');
  });

  it('honours an explicit skeleton override', () => {
    const forced = layout(parseDSL('@skeleton row\nHC: VH(A)-CH1-h-CH2-CH3\nLC: VL(A)-CL'));
    expect(forced.construct.layout.skeleton).toBe('row');
    expect(new Set(forced.domains.map((d) => d.rotation))).toEqual(new Set([0]));
  });
});

describe('Y geometry', () => {
  it('puts the Fab arms above the Fc and on opposite sides', () => {
    const { byDomainId } = layout(getPreset('igg-kih'));
    const ch2 = byDomainId.get(
      normalize(getPreset('igg-kih')).chains[0]!.domains.find((d) => d.type === 'CH2')!.id,
    )!;
    const left = byDomainId.get('HC1:0')!;
    const right = byDomainId.get('HC2:0')!;
    expect(left.center.y).toBeLessThan(ch2.center.y);
    expect(left.center.x).toBeLessThan(0);
    expect(right.center.x).toBeGreaterThan(0);
  });

  it('keeps the hinge a short vertical stub between CH1 and CH2', () => {
    const { connectors } = layout(getPreset('igg-kih'));
    const hinges = connectors.filter((c) => c.kind === 'hinge');
    expect(hinges).toHaveLength(2);
    for (const h of hinges) {
      expect(Math.abs(h.a.x - h.b.x), 'hinge should not run diagonally').toBeLessThan(1);
      expect(Math.abs(h.a.y - h.b.y)).toBeLessThanOrEqual(defaultTheme.hingeGap + 0.01);
    }
    // One hinge per side, in the same lanes the Fc occupies.
    const xs = hinges.map((h) => Math.round(h.b.x * 100) / 100).sort((a, b) => a - b);
    expect(xs).toEqual([-defaultTheme.laneGap / 2, defaultTheme.laneGap / 2]);
  });

  it('lays a CrossMab arm the same way round as an ordinary one', () => {
    // HC1 carries CL where HC2 carries CH1; the heavy chain has to stay on the
    // inner lane in both arms or the hinge runs across the stem.
    const result = layout(getPreset('crossmab-ch1cl'));
    const at = (id: string) => result.byDomainId.get(id)!.center.x;
    expect(at('HC1:1')).toBeCloseTo(-at('HC2:1'), 5);
    expect(at('LC1:1')).toBeCloseTo(-at('LC2:1'), 5);
    expect(Math.abs(at('HC1:1'))).toBeLessThan(Math.abs(at('LC1:1')));
  });

  it('drops a C-terminal fusion out of the bottom of the CH3 it leaves', () => {
    const result = layout(getPreset('trispecific-igg-scfv'));
    const ch3 = result.byDomainId.get('HC1:4')!;
    const appended = result.domains.find((d) => d.domain.chainId === 'HC1' && d.domain.index > 4)!;
    expect(appended.center.x).toBeCloseTo(ch3.center.x, 5);
    expect(appended.center.y).toBeGreaterThan(ch3.center.y);
  });

  it('starts an appended module under the face it leaves, not half a lane over', () => {
    // The branch is a two-lane ladder, so its first glyph sits off to one side
    // of its own axis. What has to line up with the CH3 is the point the strand
    // actually leaves from.
    const result = layout(getPreset('igg-hc-scfv'));
    const ch3 = result.byDomainId.get('HC:4')!;
    const linker = result.byDomainId.get('HC:5')!;
    expect(linker.nAnchor.x).toBeCloseTo(ch3.cAnchor.x, 5);
    expect(linker.nAnchor.y).toBeGreaterThan(ch3.cAnchor.y);
  });

  it('turns an appended scFv so the half that carries the chain sits inside', () => {
    const result = layout(getPreset('igg-hc-scfv'));
    const vh = result.byDomainId.get('HC:6')!;
    const vl = result.byDomainId.get('HC:8')!;
    expect(Math.abs(vh.center.x)).toBeLessThan(Math.abs(vl.center.x));
  });

  it('drops a light-chain fusion out of the CL that carries it', () => {
    const result = layout(getPreset('igg-lc-scfv'));
    const cl = result.byDomainId.get('LC:1')!;
    const linker = result.byDomainId.get('LC:2')!;
    expect(linker.nAnchor.x).toBeCloseTo(cl.cAnchor.x, 5);
    const vh = result.byDomainId.get('LC:3')!;
    const vl = result.byDomainId.get('LC:5')!;
    expect(Math.abs(vh.center.x)).toBeLessThan(Math.abs(vl.center.x));
  });

  it('stacks tandem scFv heads so the strand between them runs up the ladder', () => {
    // The C-terminus of the upper head has to sit directly above the
    // N-terminus of the lower one. Left to the default lanes the strand hands
    // off from the outer half of one head to the inner half of the next and
    // cuts across the full width of both.
    const result = layout(
      parseDSL(`
        HC1: VH(CD3)~VL(CD3)~VH(CD28)~VL(CD28)~VH(HER2)-CH1-h-CH2-CH3[knob]
        LC1: VL(HER2)-CL
        HC2: VH(CD20)-CH1-h-CH2-CH3[hole]
        LC2: VL(CD20)-CL
      `),
    );
    const upper = result.byDomainId.get('HC1:2')!;
    const lower = result.byDomainId.get('HC1:4')!;
    expect(upper.lane).toBe(lower.lane);
    const delta = { x: lower.nAnchor.x - upper.cAnchor.x, y: lower.nAnchor.y - upper.cAnchor.y };
    const across = delta.x * -upper.axis.y + delta.y * upper.axis.x;
    expect(Math.abs(across), 'the junction should not run across the head').toBeLessThan(1);
  });

  it('hangs a C-terminal fusion below the Fc', () => {
    const result = layout(getPreset('igg-hc-scfv'));
    const ch3 = result.domains.find((d) => d.domain.type === 'CH3')!;
    const appended = result.domains.filter(
      (d) => d.domain.specificity === 'CD3' && d.domain.type === 'VH',
    );
    expect(appended.length).toBeGreaterThan(0);
    for (const d of appended) expect(d.center.y).toBeGreaterThan(ch3.center.y);
  });
});
