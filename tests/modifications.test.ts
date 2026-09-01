import { describe, expect, it } from 'vitest';
import { layout, normalize, parseDSL, renderSVG, resolveModification } from '../src/index';
import { DOMAIN_CATALOG, MODIFICATION_CATALOG } from '../src/model/catalog';
import { getPreset } from '../src/presets/index';
import type { ModificationType, PayloadStructure } from '../src/model/types';
import { cornersOf, polygonsOverlap, rotate } from '../src/layout/geometry';
import type { LayoutResult, Point } from '../src/layout/types';
import { structureTurn } from '../src/render/markers';

describe('conjugated payloads', () => {
  it('parses the compound, linker, DAR, copy count and site from the DSL', () => {
    const c = parseDSL('HC: CL[drug=MMAE/vc-PAB/4/2/interchain cysteine]');
    expect(c.chains[0]!.domains[0]!.modifications).toEqual([
      {
        type: 'drug',
        payload: {
          name: 'MMAE',
          linker: 'vc-PAB',
          dar: 4,
          count: 2,
          site: 'interchain cysteine',
        },
      },
    ]);
  });

  it('accepts a bare compound name', () => {
    const c = parseDSL('HC: CL[drug=MMAE]');
    expect(c.chains[0]!.domains[0]!.modifications![0]!.payload).toEqual({ name: 'MMAE' });
  });

  it('draws one payload glyph per copy, with a single shared name', () => {
    const { svg } = renderSVG(getPreset('adc-igg'));
    // Two light chains, two copies each.
    expect((svg.match(/data-payload="MMAE"/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((svg.match(/class="dn-payload-label"/g) ?? []).length).toBe(2);
    expect(svg).toContain('>MMAE<');
  });

  it('summarises the conjugation in its own legend section', () => {
    const { svg } = renderSVG(getPreset('adc-igg'));
    expect(svg).toContain('Conjugation');
    expect(svg).toContain('MMAE · vc-PAB · DAR 4 · interchain cysteine');
  });

  it('breaks the stalk for a non-cleavable linker', () => {
    const cleavable = renderSVG(parseDSL('C1: VH(x)~VL(x)'), {}).svg;
    const nonCleavable = renderSVG(
      {
        chains: [
          {
            id: 'C1',
            domains: [
              {
                type: 'VHH',
                specificity: 'x',
                modifications: [
                  { type: 'drug', payload: { name: 'DM1', cleavable: false } },
                ],
              },
            ],
          },
        ],
      },
      {},
    ).svg;
    expect(nonCleavable).toContain('stroke-dasharray');
    expect(cleavable).not.toContain('dn-payload-label');
  });

  it('honours the payload shape and colour', () => {
    const { svg } = renderSVG({
      chains: [
        {
          id: 'C1',
          domains: [
            {
              type: 'VHH',
              specificity: 'x',
              modifications: [
                { type: 'drug', payload: { name: 'Tc-99m', shape: 'triangle', color: '#00aa88' } },
              ],
            },
          ],
        },
      ],
    });
    expect(svg).toContain('#00aa88');
    expect(svg).toContain('>Tc-99m<');
  });

  it('can suppress payload names', () => {
    const { svg } = renderSVG(getPreset('adc-igg'), { showPayloadNames: false });
    expect(svg).not.toContain('dn-payload-label');
    expect(svg).toContain('data-payload="MMAE"');
  });
});

describe('payload structures', () => {
  const structure = { svg: '<circle cx="5" cy="5" r="4"/>', viewBox: '0 0 10 10' };
  const construct = {
    chains: [
      {
        id: 'C1',
        domains: [
          {
            type: 'VHH' as const,
            specificity: 'X',
            modifications: [
              { type: 'drug' as const, payload: { name: 'MMAE', count: 3, structure } },
            ],
          },
        ],
      },
    ],
  };

  const withStructure = (s: PayloadStructure) => ({
    chains: [
      {
        id: 'C1',
        domains: [
          {
            type: 'VHH' as const,
            specificity: 'X',
            modifications: [{ type: 'drug' as const, payload: { name: 'MMAE', structure: s } }],
          },
        ],
      },
    ],
  });

  /** A drawing whose open bond points out to the right, at a given size. */
  const drawing = (width: number, height: number): PayloadStructure => ({
    svg: '<circle cx="50" cy="30" r="28"/>',
    viewBox: '0 0 100 60',
    width,
    height,
    attach: { x: 96, y: 30 },
    attachFrom: { x: 60, y: 30 },
  });

  /** An IgG with a drawing conjugated to one domain type. */
  const renderConjugate = (type: 'CH1' | 'CH3', s: PayloadStructure) => {
    const construct = parseDSL('HC: VH(A)-CH1-h-CH2-CH3 *2\nLC: VL(A)-CL *2');
    for (const chain of construct.chains) {
      for (const d of chain.domains) {
        if (d.type !== type) continue;
        d.modifications = [
          { type: 'drug', payload: { name: 'X', attachment: '', structure: s } },
        ];
      }
    }
    return renderSVG(construct, { showStructures: 'inline' });
  };

  /** Length of the longest bond drawn off a conjugation site. */
  const bondLength = (svg: string): number =>
    Math.max(
      0,
      ...[
        ...svg.matchAll(
          /<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"[^>]*class="dn-marker"/g,
        ),
      ].map((m) => Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2]))),
    );

  /** The drawing's box, in world coordinates. */
  const structureCorners = (svg: string, result: LayoutResult): Point[] => {
    const site = result.domains.find((p) => p.domain.modifications.length > 0)!;
    const panel =
      /class="dn-payload-structure" transform="translate\(([-\d.]+),([-\d.]+)\)/.exec(svg)!;
    const local = { x: Number(panel[1]), y: Number(panel[2]) };
    const turned = rotate(local, site.rotation);
    const tip = { x: site.center.x + turned.x, y: site.center.y + turned.y };
    const embed =
      /<svg x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"[^>]*class="dn-structure"/.exec(
        svg,
      )!;
    const [bx, by, bw, bh] = embed.slice(1).map(Number) as [number, number, number, number];
    return [
      { x: tip.x + bx, y: tip.y + by },
      { x: tip.x + bx + bw, y: tip.y + by },
      { x: tip.x + bx + bw, y: tip.y + by + bh },
      { x: tip.x + bx, y: tip.y + by + bh },
    ];
  };

  it('draws a captioned thumbnail in the legend by default', () => {
    const { svg } = renderSVG(construct);
    expect(svg).toContain('Structures');
    expect(svg).toContain('dn-structure-frame');
    expect(svg).toContain('<circle cx="5" cy="5" r="4"/>');
    expect(svg).toContain('viewBox="0 0 10 10"');
    // The payload glyph still marks the conjugation site on the molecule.
    expect((svg.match(/class="dn-marker"/g) ?? []).length).toBeGreaterThan(0);
  });

  it('replaces the payload glyph with a framed panel on the linker', () => {
    const { svg } = renderSVG(construct, { showStructures: 'inline' });
    expect(svg).toContain('dn-payload-structure');
    // One drawing however many copies are conjugated.
    expect((svg.match(/class="dn-structure"/g) ?? []).length).toBe(1);
    // The panel is counter-rotated so the chemistry stays upright.
    expect(svg).toMatch(/dn-payload-structure[^>]*rotate\(/);
  });

  it('turns the drawing so the bond runs straight into it', () => {
    // The artwork's own bond points down (attach below attachFrom); the drawing
    // has to be turned a quarter circle for it to meet a horizontal bond.
    const turned = {
      ...structure,
      attach: { x: 5, y: 9 },
      attachFrom: { x: 5, y: 1 },
    };
    const { svg } = renderSVG(withStructure(turned), { showStructures: 'inline' });
    const turn = /class="dn-structure-turn" transform="rotate\(([-\d.]+)\)"/.exec(svg);
    expect(turn, 'the drawing should be turned').not.toBeNull();
    expect(Math.abs(Number(turn![1]))).toBeCloseTo(90, 0);
  });

  it('leaves a drawing alone when its bond already points the right way', () => {
    const aligned = {
      ...structure,
      attach: { x: 9, y: 5 },
      attachFrom: { x: 1, y: 5 },
    };
    const { svg } = renderSVG(withStructure(aligned), { showStructures: 'inline' });
    expect(svg).not.toContain('dn-structure-turn');
  });

  it('keeps atom labels upright through the turn', () => {
    const labelled = {
      svg: '<text x="4" y="6" font-size="3">S</text><circle cx="5" cy="5" r="4"/>',
      viewBox: '0 0 10 10',
      attach: { x: 5, y: 9 },
      attachFrom: { x: 5, y: 1 },
    };
    const { svg } = renderSVG(withStructure(labelled), { showStructures: 'inline' });
    const outer = Number(
      /class="dn-structure-turn" transform="rotate\(([-\d.]+)\)"/.exec(svg)![1],
    );
    const label = /<text x="4" y="6"[^>]*transform="rotate\(([-\d.]+),4,6\)"/.exec(svg);
    expect(label, 'the label should be turned back').not.toBeNull();
    expect(Number(label![1])).toBeCloseTo(-outer, 5);
  });

  it('does not flip a drawing that says which way round it goes', () => {
    // A flip inverts stereochemistry; turning cannot, so naming the neighbouring
    // atom supersedes `mirror`.
    const both = {
      ...structure,
      attach: { x: 9, y: 5 },
      attachFrom: { x: 1, y: 5 },
      mirror: true,
    };
    const { svg } = renderSVG(withStructure(both), { showStructures: 'inline' });
    expect(svg).not.toContain('dn-structure-mirror');
  });

  it('hangs a surface mark off the side away from the body of the molecule', () => {
    // Not "away from the pairing partner": a CH1's partner is its CL, which is
    // the outboard half of the arm, so that rule pointed the mark into the
    // crook of the Y — the least solvent-exposed direction there is. Only one
    // arm carries the drug, so there is no doubt which site the panel belongs
    // to.
    const construct = parseDSL(`
      HC1: VH(A)-CH1-h-CH2-CH3[knob]
      LC1: VL(A)-CL
      HC2: VH(B)-CH1-h-CH2-CH3[hole]
      LC2: VL(B)-CL
    `);
    construct.chains[0]!.domains[1]!.modifications = [
      { type: 'drug', payload: { name: 'X', attachment: '', structure: drawing(40, 24) } },
    ];
    const { svg, layout: result } = renderSVG(construct, { showStructures: 'inline' });
    const site = result.byDomainId.get('HC1:1')!;
    const panel =
      /class="dn-payload-structure" transform="translate\(([-\d.]+),([-\d.]+)\)/.exec(svg)!;
    const out = rotate({ x: Number(panel[1]), y: Number(panel[2]) }, site.rotation);
    // HC1 is the left arm, so away from the body is further left.
    expect(site.center.x).toBeLessThan(0);
    expect(out.x).toBeLessThan(0);
  });

  it('reaches further out when the drawing would otherwise lie on the molecule', () => {
    // A compound is bigger than the domain it hangs off, so on a Fab arm it can
    // still lie back across the antibody even leaving from the outer edge. The
    // bond is what gives way.
    const big = drawing(170, 102);
    const crowded = bondLength(renderConjugate('CH1', big).svg);
    const open = bondLength(renderConjugate('CH3', big).svg);
    expect(crowded).toBeGreaterThan(open);
  });

  it('leaves the bond short where the drawing already has room', () => {
    // A small drawing below the Fc has nothing in its way.
    expect(bondLength(renderConjugate('CH3', drawing(60, 36)).svg)).toBeCloseTo(14, 0);
  });

  it('draws the bond the whole way to what it carries', () => {
    // Both are in the glyph's own frame, so they compare directly: the line has
    // to end where the drawing starts, or a long reach leaves a floating
    // compound with nothing joining it to the protein.
    const { svg } = renderConjugate('CH1', drawing(170, 102));
    const line = /<line x1="([-\d.]+)" y1="[-\d.]+" x2="([-\d.]+)"[^>]*class="dn-marker"/.exec(svg);
    const panel = /class="dn-payload-structure"[^>]*transform="translate\(([-\d.]+),/.exec(svg);
    expect(line).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(Number(line![2])).toBeCloseTo(Number(panel![1]), 1);
  });

  it('keeps the drawing clear of every glyph', () => {
    const { svg, layout: result } = renderConjugate('CH1', drawing(170, 102));
    const box = structureCorners(svg, result);
    for (const p of result.domains) {
      const glyph = cornersOf(p.center, p.width, p.height, p.rotation);
      expect(polygonsOverlap(box, glyph), `${p.domain.id} is under the drawing`).toBe(false);
    }
  });

  it('keeps oversized artwork clear of its own carrier and the rest of the molecule', () => {
    const { svg, layout: result } = renderConjugate('CH1', drawing(900, 540));
    const box = structureCorners(svg, result);
    for (const p of result.domains) {
      const glyph = cornersOf(p.center, p.width, p.height, p.rotation);
      expect(polygonsOverlap(box, glyph), `${p.domain.id} is under the drawing`).toBe(false);
    }
    expect(bondLength(svg)).toBeGreaterThan(68);
  });

  it('uses the nested SVG meet scaling when calculating structure rotation', () => {
    const diagonal: PayloadStructure = {
      svg: '<circle cx="50" cy="50" r="45"/>',
      viewBox: '0 0 100 100',
      attach: { x: 100, y: 100 },
      attachFrom: { x: 0, y: 0 },
    };
    expect(structureTurn(diagonal, 200, 100, false)).toBeCloseTo(-45, 5);
  });

  it('can be turned off entirely', () => {
    const { svg } = renderSVG(construct, { showStructures: 'none' });
    expect(svg).not.toContain('dn-structure');
    expect(svg).toContain('data-payload="MMAE"');
  });

  it('keeps an inline structure inside the viewBox', () => {
    const wide = { ...structure, width: 120, height: 90 };
    const { scene, layout: result } = renderSVG(
      {
        chains: [
          {
            id: 'C1',
            domains: [
              {
                type: 'VHH' as const,
                specificity: 'X',
                modifications: [
                  { type: 'drug' as const, payload: { name: 'MMAE', structure: wide } },
                ],
              },
            ],
          },
        ],
      },
      { showStructures: 'inline', showLegend: false },
    );
    expect(result.domains).toHaveLength(1);
    expect(scene.viewBox.width).toBeGreaterThan(wide.width);
  });

  it('lands the bond on the atom named by `attach`, in the artwork\'s own units', () => {
    const { svg } = renderSVG(
      {
        chains: [
          {
            id: 'C1',
            domains: [
              {
                type: 'VHH' as const,
                specificity: 'X',
                modifications: [
                  {
                    type: 'drug' as const,
                    payload: {
                      name: 'P',
                      site: 'interchain cysteine',
                      // The conjugated atom sits at the far right of a 200-wide
                      // drawing, a quarter of the way down.
                      structure: {
                        svg: '<circle cx="5" cy="5" r="4"/>',
                        viewBox: '0 0 200 100',
                        width: 80,
                        height: 40,
                        attach: { x: 200, y: 25 },
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      { showStructures: 'inline' },
    );
    // Placed so that atom lands on the origin of the counter-rotated panel:
    // 80 units to its left, 10 above (a quarter of 40).
    expect(svg).toContain('x="-80"');
    expect(svg).toContain('y="-10"');
    // The drawing carries its own sulfur, so no second atom label is added.
    expect(svg).not.toContain('dn-attachment-label');
  });

  it('writes the attachment atom on the bond when there is no structure', () => {
    const { svg } = renderSVG({
      chains: [
        {
          id: 'C1',
          domains: [
            {
              type: 'VHH' as const,
              specificity: 'X',
              modifications: [
                { type: 'drug' as const, payload: { name: 'P', site: 'surface lysine' } },
              ],
            },
          ],
        },
      ],
    });
    expect(svg).toContain('dn-attachment-label');
    expect(svg).toContain('>NH<');
  });

  it('brackets the linker-payload with the drug-to-antibody ratio', () => {
    const withDar = (dar?: number) =>
      renderSVG(
        {
        chains: [
          {
            id: 'C1',
            domains: [
              {
                type: 'VHH' as const,
                specificity: 'X',
                modifications: [
                  {
                    type: 'drug' as const,
                    payload: {
                      name: 'P',
                      ...(dar == null ? {} : { dar }),
                      structure: { svg: '<circle cx="5" cy="5" r="4"/>', viewBox: '0 0 10 10' },
                    },
                  },
                ],
              },
            ],
          },
        ],
        },
        { showStructures: 'inline', showLegend: false },
      );
    const labelled = withDar(8);
    expect((labelled.svg.match(/class="dn-payload-bracket"/g) ?? []).length).toBe(2);
    expect(labelled.svg).toContain('>n = 8<');
    expect(labelled.scene.viewBox.width).toBeGreaterThan(withDar().scene.viewBox.width);
  });

  it('spells the chemistry out at one site and marks the rest with glyphs', () => {
    const twoSites = {
      chains: [
        {
          id: 'HC',
          copies: 2,
          domains: [
            { type: 'VH' as const, specificity: 'X' },
            { type: 'CH1' as const },
            { type: 'hinge' as const },
            {
              type: 'CH2' as const,
              modifications: [
                { type: 'drug' as const, payload: { name: 'P', structure } },
              ],
            },
            { type: 'CH3' as const },
          ],
        },
        { id: 'LC', copies: 2, domains: [{ type: 'VL' as const, specificity: 'X' }, { type: 'CL' as const }] },
      ],
    };
    const once = renderSVG(twoSites, { showStructures: 'inline', showLegend: false });
    expect((once.svg.match(/class="dn-structure"/g) ?? []).length).toBe(1);
    // The other site still shows where the conjugation is.
    expect((once.svg.match(/data-modification-type="drug"/g) ?? []).length).toBeGreaterThan(1);

    const both = renderSVG(twoSites, {
      showStructures: 'inline',
      repeatStructures: true,
      showLegend: false,
    });
    expect((both.svg.match(/class="dn-structure"/g) ?? []).length).toBe(2);
  });

  it('keeps atom labels readable when a mirrored drawing is asked for', () => {
    const labelled = {
      svg: '<text x="100" y="50" font-size="14">N</text><text x="109" y="50" font-size="14">H</text><text x="118" y="54" font-size="9">2</text>',
      viewBox: '0 0 200 100',
      width: 60,
      height: 30,
      attach: { x: 200, y: 50 },
      mirror: true,
    };
    const { svg } = renderSVG(
      {
        chains: [
          {
            id: 'HC',
            copies: 2,
            domains: [
              { type: 'VH' as const, specificity: 'X' },
              { type: 'CH1' as const },
              { type: 'hinge' as const },
              {
                type: 'CH2' as const,
                modifications: [
                  { type: 'drug' as const, payload: { name: 'P', structure: labelled } },
                ],
              },
              { type: 'CH3' as const },
            ],
          },
          { id: 'LC', copies: 2, domains: [{ type: 'VL' as const, specificity: 'X' }, { type: 'CL' as const }] },
        ],
      },
      { showStructures: 'inline', repeatStructures: true, showLegend: false },
    );
    // Each glyph is flipped back about its own anchor, so nothing reads backwards.
    const flipped = [...svg.matchAll(/<text[^>]*transform="translate\(([-\d.]+),0\) scale\(-1,1\)"/g)];
    expect(flipped.length).toBe(3);
    expect(svg).toContain('text-anchor="end"');
    // And the run is re-laid so N, H, 2 still read in that order once mirrored:
    // after the outer flip, x descends across the sequence.
    const xs = [
      ...svg.matchAll(
        /<text[^>]*\sx="([-\d.]+)"[^>]*scale\(-1,1\)"[^>]*>([NH2])<\/text>/g,
      ),
    ].map((m) => ({ glyph: m[2]!, x: Number(m[1]) }));
    const at = (glyph: string) => xs.find((g) => g.glyph === glyph)!.x;
    expect(at('N')).toBeGreaterThan(at('H'));
    expect(at('H')).toBeGreaterThan(at('2'));
  });

  it('accepts an image reference instead of markup', () => {
    const { svg } = renderSVG(
      {
        chains: [
          {
            id: 'C1',
            domains: [
              {
                type: 'VHH' as const,
                specificity: 'X',
                modifications: [
                  {
                    type: 'drug' as const,
                    payload: {
                      name: 'DM1',
                      structure: { href: 'data:image/png;base64,AAA', caption: 'DM1 (maytansinoid)' },
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {},
    );
    expect(svg).toContain('<image');
    expect(svg).toContain('href="data:image/png;base64,AAA"');
    expect(svg).toContain('DM1 (maytansinoid)');
  });
});

describe('modification catalog', () => {
  it('gives every type a marker, a legend label and an edge', () => {
    for (const [type, spec] of Object.entries(MODIFICATION_CATALOG)) {
      expect(spec.label, type).toBeTruthy();
      expect(spec.marker, type).toBeTruthy();
      expect(['interface', 'surface'], type).toContain(spec.side);
    }
  });

  it('draws every catalog entry without error and lists it once in the legend', () => {
    for (const type of Object.keys(MODIFICATION_CATALOG) as ModificationType[]) {
      const { svg } = renderSVG({
        chains: [
          {
            id: 'HC',
            domains: [
              { type: 'VH', specificity: 'X' },
              { type: 'CH1' },
              { type: 'hinge' },
              { type: 'CH2' },
              { type: 'CH3', modifications: [{ type }] },
            ],
          },
          { id: 'LC', domains: [{ type: 'VL', specificity: 'X' }, { type: 'CL' }] },
        ],
      });
      expect(svg, type).toContain(`data-modification-type="${type}"`);
      expect((svg.match(/class="dn-legend-marker"/g) ?? []).length, type).toBe(1);
    }
  });

  it('puts interface marks towards the partner and surface marks away from it', () => {
    // CH2 pairs across the axis, so its glycan must hang outwards while the
    // Fc-silencing dots sit on the interface between the two CH2 domains.
    const result = layout(
      parseDSL('HC: VH(X)-CH1-h-CH2[lala, glycan]-CH3 *2\nLC: VL(X)-CL *2'),
    );
    const { svg } = renderSVG(result);
    // The legend draws its own copy at the origin; only the two on the molecule
    // carry an offset.
    const dots = [...svg.matchAll(/<circle cx="(-?[\d.]+)"[^>]*data-modification-type="lala"/g)]
      .map(([, x]) => Number(x))
      .filter((x) => x !== 0);
    expect(dots.length).toBe(2);
    expect(svg).toContain('data-modification-type="glycan"');
    // Interface marks sit inboard of the domain's own half-width.
    for (const x of dots) expect(Math.abs(x)).toBeLessThan(5);
  });

  it('resolves aliases and keeps catalog residues', () => {
    const r = resolveModification({ type: 'knob' }, 'd');
    expect(r.residues).toEqual(['T366W']);
    expect(parseDSL('HC: CH2[n297]').chains[0]!.domains[0]!.modifications).toEqual([
      { type: 'glycan' },
    ]);
    expect(parseDSL('HC: CH2[de]').chains[0]!.domains[0]!.modifications).toEqual([
      { type: 'adcc-enhanced' },
    ]);
  });
});

describe('single-chain Fv direction', () => {
  const vhvl = 'C1: VH(X)~VL(X)';
  const vlvh = 'C1: VL(X)~VH(X)';

  it('draws VH~VL and VL~VH the other way round, not as the same picture', () => {
    const order = (dsl: string): 'VH-first' | 'VL-first' => {
      const { domains } = layout(parseDSL(dsl));
      const vh = domains.find((d) => d.domain.type === 'VH')!;
      const vl = domains.find((d) => d.domain.type === 'VL')!;
      return vh.center.x < vl.center.x ? 'VH-first' : 'VL-first';
    };
    expect(order(vhvl)).toBe('VH-first');
    expect(order(vlvh)).toBe('VL-first');
    expect(renderSVG(parseDSL(vhvl)).svg).not.toBe(renderSVG(parseDSL(vlvh)).svg);
  });

  it('runs the linker from one domain\'s C-terminal face to the next one\'s N-terminal face', () => {
    const { domains, connectors } = layout(parseDSL(vhvl));
    const vh = domains.find((d) => d.domain.type === 'VH')!;
    const vl = domains.find((d) => d.domain.type === 'VL')!;
    const linker = connectors.find((c) => c.kind === 'linker')!;
    // Every domain is drawn N-terminus up, so the strand leaves the bottom of
    // VH and arrives at the top of VL...
    expect(linker.a.y).toBeGreaterThan(vh.center.y);
    expect(linker.b.y).toBeLessThan(vl.center.y);
    // ...while the two domains stay level and side by side, the way an Fv packs.
    expect(vh.center.y).toBeCloseTo(vl.center.y, 5);
    // Which takes a cubic: the strand has to leave downwards and arrive downwards.
    expect(linker.via).toHaveLength(2);
  });

  it('gives a linker-joined pair more daylight than a natively paired one', () => {
    const gapOf = (dsl: string) => {
      const { domains } = layout(parseDSL(dsl));
      const vh = domains.find((d) => d.domain.type === 'VH')!;
      const vl = domains.find((d) => d.domain.type === 'VL')!;
      return Math.abs(vh.center.x - vl.center.x);
    };
    expect(gapOf('C1: VH(X)~VL(X)')).toBeGreaterThan(gapOf('HC: VH(X)-CH1\nLC: VL(X)-CL'));
  });

  it('marks the free termini when asked', () => {
    const plain = renderSVG(parseDSL(vhvl)).svg;
    const marked = renderSVG(parseDSL(vhvl), { showTermini: true }).svg;
    expect(plain).not.toContain('dn-terminus');
    expect(marked).toContain('data-terminus="N"');
    expect(marked).toContain('data-terminus="C"');
  });
});

describe('glyph style', () => {
  it('draws every domain as a box, with no labels by default', () => {
    const { svg } = renderSVG(getPreset('igg-kih'));
    expect(svg).not.toContain('dn-domain-label');
    expect(renderSVG(getPreset('igg-kih'), { showLabels: true }).svg).toContain('dn-domain-label');
  });

  it('tells variable from constant domains by corner radius, not by outline shape', () => {
    expect(DOMAIN_CATALOG.VH.glyph).toBe('variable');
    expect(DOMAIN_CATALOG.CH1.glyph).toBe('constant');
    expect(DOMAIN_CATALOG.VH.corner).toBeGreaterThan(DOMAIN_CATALOG.CH1.corner);
    // Both outlines are the same closed rounded box.
    const { svg } = renderSVG(normalize(getPreset('igg-kih')));
    for (const d of [...svg.matchAll(/<path d="(M[^"]*Z)"/g)].map(([, d]) => d!)) {
      expect(d.includes('Q') || d.includes('A')).toBe(true);
    }
  });
});

describe('modifications on a domain with no glyph', () => {
  // A hinge and an scFv's internal linker are drawn as connectors, not glyphs.
  // Anything attached to one used to be dropped without a word — which hid
  // S228P on every IgG4 and made an interchain-cysteine ADC, the commonest
  // conjugation chemistry there is, render as a bare antibody.
  const conjugate = () => {
    const construct = parseDSL('HC: VH(HER2)-CH1-h-CH2-CH3 *2\nLC: VL(HER2)-CL *2');
    construct.chains[0]!.domains[2]!.modifications = [
      { type: 'drug', payload: { name: 'MMAE', linker: 'vc-PAB', dar: 4, attachment: 'S' } },
    ];
    return construct;
  };

  it('draws a payload conjugated to the hinge', () => {
    const svg = renderSVG(conjugate()).svg;
    expect(svg).toContain('MMAE');
    expect(svg).toContain('data-domain-type="hinge"');
  });

  it('draws a hinge mutation, and lists it in the legend', () => {
    const svg = renderSVG(getPreset('igg4-s228p')).svg;
    expect(svg).toContain('S228P');
  });

  it('gives the hinge the same identifiers as any other domain', () => {
    // The diagram, the sequence view and `highlight` all address domains by id,
    // so a hinge that only exists as a connector still has to carry one.
    const svg = renderSVG(conjugate()).svg;
    const group = /<g id="[^"]*" class="dn-domain dn-domain-implicit"[^>]*>/.exec(svg);
    expect(group?.[0]).toContain('data-domain-id="HC:2"');
    expect(group?.[0]).toContain('data-chain-id="HC"');
    expect(group?.[0]).toContain('data-modifications="drug"');
  });

  it('leaves an unmodified hinge as a bare connector', () => {
    const svg = renderSVG(getPreset('igg1')).svg;
    expect(svg).not.toContain('dn-domain-implicit');
  });

  it('grows the viewBox to fit what hangs off the hinge', () => {
    // Without the legend, whose own width would otherwise set the floor.
    const bare = { showLegend: false } as const;
    const plain = renderSVG(parseDSL('HC: VH(HER2)-CH1-h-CH2-CH3 *2\nLC: VL(HER2)-CL *2'), bare);
    const drawn = renderSVG(conjugate(), bare);
    expect(drawn.scene.width).toBeGreaterThan(plain.scene.width);
  });
});
