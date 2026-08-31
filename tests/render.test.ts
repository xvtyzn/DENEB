import { describe, expect, it } from 'vitest';
import { normalize, parseDSL, renderLegend, renderLinear, renderSVG } from '../src/index';
import { getPreset, presetNames } from '../src/presets/index';

function sameNamedConjugates() {
  return {
    chains: [
      {
        id: 'HC',
        domains: [
          {
            type: 'CH2' as const,
            modifications: [
              {
                type: 'drug' as const,
                payload: { name: 'MMAE', linker: 'vc-PAB', dar: 2, site: 'site A' },
              },
            ],
          },
          {
            type: 'CH3' as const,
            modifications: [
              {
                type: 'drug' as const,
                payload: { name: 'MMAE', linker: 'PEG', dar: 4, site: 'site B' },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('renderSVG', () => {
  it.each(presetNames())('%s matches its snapshot', (name) => {
    expect(renderSVG(getPreset(name)).svg).toMatchSnapshot();
  });

  it('emits a well-formed, self-contained document', () => {
    const { svg } = renderSVG(getPreset('igg-kih'));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).not.toContain('undefined');
    expect(svg).not.toContain('NaN');
    // No external references: everything must be inline for a portable file.
    expect(svg).not.toMatch(/xlink:href|<image|url\(/);
  });

  it('tags every domain with data attributes for hit-testing', () => {
    const { svg, layout } = renderSVG(getPreset('igg-kih'));
    for (const placed of layout.domains) {
      expect(svg).toContain(`data-domain-id="${placed.domain.id}"`);
    }
    expect(svg).toContain('data-domain-type="CH3"');
    expect(svg).toContain('data-specificity="CD3"');
    expect(svg).toContain('data-modifications="knob"');
  });

  it('colours variable domains by specificity and leaves constants neutral', () => {
    const construct = normalize(getPreset('igg-kih'));
    const [cd3, her2] = construct.specificities;
    const { svg } = renderSVG(construct);
    expect(svg).toContain(cd3!.color);
    expect(svg).toContain(her2!.color);
    // CH1/CL keep the neutral constant fill.
    expect(svg).toContain('#c3c8cf');
  });

  it('carves a knob and a matching hole into the two CH3 domains', () => {
    const withKih = renderSVG(getPreset('igg-kih')).svg;
    const without = renderSVG(getPreset('igg1')).svg;
    const arcs = (s: string) => (s.match(/A4,4 0 0 [01]/g) ?? []).length;
    expect(arcs(withKih)).toBe(2);
    expect(arcs(without)).toBe(0);
    expect(withKih).toContain('A4,4 0 0 0'); // knob, bulging outward
    expect(withKih).toContain('A4,4 0 0 1'); // hole, carved inward
  });

  it('draws one legend entry per target and per distinct modification', () => {
    const { svg } = renderSVG(getPreset('igg-kih-lala'));
    expect(svg).toContain('>CD3<');
    expect(svg).toContain('>HER2<');
    expect(svg).toContain('LALA-PG (Fc-silenced)');
    expect(svg).toContain('knob (T366W)');
    // knob, hole and LALA-PG appear once each even though four domains carry them.
    expect((svg.match(/class="dn-legend-marker"/g) ?? []).length).toBe(3);
    expect((svg.match(/class="dn-legend-swatch"/g) ?? []).length).toBe(2);
  });

  it('keeps same-named conjugates separate when their chemistry differs', () => {
    for (const svg of [
      renderSVG(sameNamedConjugates()).svg,
      renderLinear(sameNamedConjugates()).svg,
      renderLegend(sameNamedConjugates()).svg,
    ]) {
      expect(svg).toContain('MMAE · vc-PAB · DAR 2 · site A');
      expect(svg).toContain('MMAE · PEG · DAR 4 · site B');
      expect((svg.match(/class="dn-legend-marker"/g) ?? []).length).toBe(2);
    }
  });

  it('omits the legend and title when asked', () => {
    const { svg } = renderSVG(getPreset('igg-kih'), { showLegend: false, showTitle: false });
    expect(svg).not.toContain('dn-legend');
    expect(svg).not.toContain('dn-title');
  });

  it('rings highlighted domains', () => {
    const plain = renderSVG(getPreset('igg-kih'));
    const lit = renderSVG(getPreset('igg-kih'), { highlight: ['spec:CD3'] });
    expect(plain.svg).not.toContain('dn-highlight');
    const rings = (lit.svg.match(/dn-highlight/g) ?? []).length;
    expect(rings).toBe(2); // VH and VL of the CD3 arm
  });

  it('accepts every highlight reference form', () => {
    const forms = ['HC1:CH3', 'chain:LC1', 'mod:knob', 'spec:HER2'];
    for (const form of forms) {
      const { svg } = renderSVG(getPreset('igg-kih'), { highlight: [form] });
      expect(svg, form).toContain('dn-highlight');
    }
  });

  it('is stable across runs', () => {
    expect(renderSVG(getPreset('dvd-ig')).svg).toBe(renderSVG(getPreset('dvd-ig')).svg);
  });

  it('escapes text coming from the construct', () => {
    const { svg } = renderSVG(parseDSL('@name A & B <script>\nC1: VH(x)~VL(x)'));
    expect(svg).toContain('A &amp; B &lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });
});

describe('renderLinear', () => {
  it.each(presetNames())('%s matches its snapshot', (name) => {
    expect(renderLinear(getPreset(name)).svg).toMatchSnapshot();
  });

  it('scales bars to residue ranges when the annotation supplies them', () => {
    const { svg } = renderLinear({
      chains: [
        {
          id: 'HC',
          sequence: 'A'.repeat(200),
          domains: [
            { type: 'VH', start: 1, end: 100, specificity: 'X' },
            { type: 'CH1', start: 101, end: 200 },
          ],
        },
      ],
    });
    // Two equal halves of the 560-unit track.
    expect(svg).toContain('width="280"');
    expect(svg).toContain('200 aa');
  });

  it('places a modification tick at its residue position', () => {
    const { svg } = renderLinear({
      chains: [
        {
          id: 'HC',
          sequence: 'A'.repeat(100),
          domains: [
            {
              type: 'CH2',
              start: 1,
              end: 100,
              modifications: [{ type: 'lala', positions: [50] }],
            },
          ],
        },
      ],
      layout: { skeleton: 'y' },
    });
    expect(svg).toContain('class="dn-linear-modification"');
  });

  it('falls back to equal shares without residue ranges', () => {
    const { svg } = renderLinear(getPreset('bite'), { trackWidth: 400 });
    expect(svg).toContain('class="dn-linear-domain"');
    expect(svg).not.toContain('aa<');
  });
});

describe('renderLegend', () => {
  it('renders targets and modifications on their own', () => {
    const { svg } = renderLegend(getPreset('igg-kih-lala'));
    expect(svg).toContain('Targets');
    expect(svg).toContain('Engineering');
    expect(svg).toContain('LALA-PG (Fc-silenced)');
  });
});
