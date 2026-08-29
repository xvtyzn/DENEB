import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { normalize, tint } from '../src/index';
import { AntibodySequence } from '../src/react/index';
import { CONSTANT_REFERENCES } from '../src/import/index';

const igg1 = CONSTANT_REFERENCES.find((r) => r.isotype === 'IgG1')!;
const kappa = CONSTANT_REFERENCES.find((r) => r.isotype === 'kappa')!;
const V_HEAVY = 'QVQLVQSGAEVKKPGASVKVSCKAS'.repeat(5).slice(0, 120);
const V_LIGHT = 'DIQMTQSPSSLSASVGDRVTITCRAS'.repeat(5).slice(0, 108);

const construct = {
  chains: [
    {
      id: 'HC',
      sequence: V_HEAVY + igg1.sequence,
      domains: [
        {
          type: 'VH' as const,
          specificity: 'HER2',
          start: 1,
          end: 120,
          regions: [{ name: 'CDR3', start: 97, end: 109, scheme: 'imgt' as const }],
        },
        { type: 'CH1' as const, start: 121, end: 218 },
        { type: 'hinge' as const, start: 219, end: 234 },
        {
          type: 'CH2' as const,
          start: 235,
          end: 344,
          modifications: [{ type: 'lala' as const, positions: [240] }],
        },
        { type: 'CH3' as const, start: 345, end: 448 },
      ],
    },
    {
      id: 'LC',
      sequence: V_LIGHT + kappa.sequence,
      domains: [
        { type: 'VL' as const, specificity: 'HER2', start: 1, end: 108 },
        { type: 'CL' as const, start: 109, end: 215 },
      ],
    },
  ],
};

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<AntibodySequence construct={construct} {...props} />);

describe('AntibodySequence', () => {
  it('lays out every residue of every chain', () => {
    const markup = render();
    const text = markup.replace(/<[^>]+>/g, '').replace(/[\s\d–]/g, '');
    for (const chain of construct.chains) {
      expect(text).toContain(chain.sequence.slice(0, 40));
    }
  });

  it('colours residues by the domain they fall in, as the diagram does', () => {
    const n = normalize(construct);
    const her2 = n.specificities.find((s) => s.name === 'HER2')!;
    const markup = render();
    // Residues are washed with the domain's colour so the text stays readable.
    expect(markup).toContain(tint(her2.color, 0.45));
    // …and a constant domain is not painted in a target's colour.
    expect(markup).not.toContain(`background:${her2.color};`);
    expect(markup).toContain('data-domain-type="CH1"');
  });

  it('tags residues the way the diagram tags domains, so events line up', () => {
    const markup = render();
    expect(markup).toContain('data-domain-id="HC:0"');
    expect(markup).toContain('data-chain-id="LC"');
    expect(markup).toContain('data-position="1"');
  });

  it('underlines the regions a numbering tool supplied', () => {
    expect(render()).toContain('text-decoration:underline');
    expect(render({ showRegions: false })).not.toContain('text-decoration:underline');
  });

  it('takes the same highlight vocabulary as the diagram', () => {
    expect(render({ highlight: ['HC:CH3'] })).toContain('outline:2px solid');
    expect(render({ highlight: ['spec:HER2'] })).toContain('outline:2px solid');
    expect(render()).not.toContain('outline:2px solid');
  });

  it('breaks lines and numbers them where asked', () => {
    const markup = render({ residuesPerLine: 30 });
    const text = markup.replace(/<[^>]+>/g, '');
    // Each line is bracketed by its first and last residue number.
    expect(text).toContain('  31 ');
    expect(text).toContain(' 30');
    expect(text).toContain(' 448');
  });

  it('groups residues into blocks that can be turned off', () => {
    expect(render({ groupSize: 0 })).not.toContain('&#x27; &#x27;');
  });

  it('says so rather than breaking when a chain has no sequence', () => {
    const markup = renderToStaticMarkup(
      <AntibodySequence construct={{ chains: [{ id: 'HC', domains: [{ type: 'VH' as const }] }] }} />,
    );
    expect(markup).toContain('no sequence');
  });

  it('accepts DSL like the other components', () => {
    expect(renderToStaticMarkup(<AntibodySequence dsl="C1: VH(X)~VL(X)" />)).toContain('C1');
  });
});
