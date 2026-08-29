import { describe, expect, it } from 'vitest';
import { normalize, parseDSL } from '../src/index';
import { getPreset } from '../src/presets/index';

const of = (dsl: string) => normalize(parseDSL(dsl));

function partnerType(dsl: string, chainId: string, index: number): string | undefined {
  const n = of(dsl);
  const domain = n.chains.find((c) => c.id === chainId)!.domains[index]!;
  return domain.partner ? n.byId.get(domain.partner)?.type : undefined;
}

describe('chain kind inference', () => {
  it('marks Fc-bearing chains heavy and their partners light', () => {
    const n = of(`
      HC: VH(A)-CH1-h-CH2-CH3
      LC: VL(A)-CL
    `);
    expect(n.chains.map((c) => c.kind)).toEqual(['heavy', 'light']);
  });

  it('calls a CrossMab light chain light even though it carries CH1', () => {
    const n = normalize(getPreset('crossmab-ch1cl'));
    expect(n.chains.find((c) => c.id === 'LC1')!.kind).toBe('light');
    expect(n.chains.filter((c) => c.kind === 'heavy').map((c) => c.id)).toEqual(['HC1', 'HC2']);
  });

  it('falls back to CH1 vs CL when nothing carries an Fc', () => {
    const n = of(`
      HC: VH(A)-CH1
      LC: VL(A)-CL
    `);
    expect(n.chains.map((c) => c.kind)).toEqual(['heavy', 'light']);
  });

  it('treats a linker-only fragment chain as single', () => {
    expect(of('C1: VH(A)~VL(A)').chains[0]!.kind).toBe('single');
  });
});

describe('pairing inference', () => {
  it('pairs VH with VL and CH1 with CL across a heavy/light pair', () => {
    const dsl = `
      HC: VH(A)-CH1-h-CH2-CH3
      LC: VL(A)-CL
    `;
    expect(partnerType(dsl, 'HC', 0)).toBe('VL');
    expect(partnerType(dsl, 'HC', 1)).toBe('CL');
  });

  it('pairs an scFv inside one chain', () => {
    expect(partnerType('C1: VH(A)~VL(A)', 'C1', 0)).toBe('VL');
  });

  it('does not pair adjacent variable domains of different specificity', () => {
    // A diabody's chain carries VH_a and VL_b, which must pair across chains.
    const n = normalize(getPreset('diabody'));
    const a0 = n.chains[0]!.domains[0]!;
    expect(n.byId.get(a0.partner!)!.chainId).toBe('B');
  });

  it('respects explicit @pair links over the heuristics', () => {
    const n = normalize(getPreset('tandab'));
    for (const chain of n.chains) {
      for (const d of chain.domains) {
        if (d.type === 'VH' || d.type === 'VL') {
          expect(n.byId.get(d.partner!)!.chainId, d.id).not.toBe(chain.id);
        }
      }
    }
  });

  it('dimerises the two CH3 domains', () => {
    const n = normalize(getPreset('igg-kih'));
    const ch3 = n.chains.find((c) => c.id === 'HC1')!.domains.find((d) => d.type === 'CH3')!;
    expect(n.byId.get(ch3.partner!)!.chainId).toBe('HC2');
  });

  it('lines up both variable domain pairs of a DVD-Ig', () => {
    const n = normalize(getPreset('dvd-ig'));
    const hc = n.chains.find((c) => c.id === 'HC')!;
    const outer = hc.domains.find((d) => d.specificity === 'TNF')!;
    const inner = hc.domains.find((d) => d.specificity === 'IL17')!;
    expect(n.byId.get(outer.partner!)!.specificity).toBe('TNF');
    expect(n.byId.get(inner.partner!)!.specificity).toBe('IL17');
  });
});

describe('chain materialisation', () => {
  it('expands `copies` into real chains and pairs them one to one', () => {
    const n = of(`
      HC: VH(A)-CH1-h-CH2-CH3 *2
      LC: VL(A)-CL *2
    `);
    expect(n.chains.map((c) => c.id)).toEqual(['HC', 'HC(2)', 'LC', 'LC(2)']);
    const hc2 = n.chains[1]!;
    expect(n.byId.get(hc2.domains[0]!.partner!)!.chainId).toBe('LC(2)');
  });

  it('clones a common light chain for every heavy chain', () => {
    const n = normalize(getPreset('common-lc-kih'));
    expect(n.chains.filter((c) => c.kind === 'light')).toHaveLength(2);
    const hc1 = n.chains.find((c) => c.id === 'HC1')!;
    expect(hc1.domains[0]!.partner).toBeDefined();
  });

  it('expands the Fab shorthand into a heavy stub and a light chain', () => {
    const n = of('HC: Fab(A)-h-CH2-CH3');
    expect(n.chains.map((c) => c.id)).toEqual(['HC', 'HC-L']);
    expect(n.chains[0]!.domains.map((d) => d.type)).toEqual([
      'VH',
      'CH1',
      'hinge',
      'CH2',
      'CH3',
    ]);
  });
});

describe('diagnostics', () => {
  it('never throws on an unknown domain type', () => {
    const n = normalize({ chains: [{ id: 'C', domains: [{ type: 'Nonsense' as never }] }] });
    expect(n.diagnostics.some((d) => d.code === 'unknown-domain-type')).toBe(true);
    expect(n.chains[0]!.domains[0]!.type).toBe('custom');
  });

  it('flags a residue range that runs past the sequence', () => {
    const n = normalize({
      chains: [
        { id: 'C', sequence: 'ACDEFGHIKL', domains: [{ type: 'VH', start: 1, end: 400 }] },
      ],
    });
    expect(n.diagnostics.some((d) => d.code === 'range-out-of-bounds')).toBe(true);
  });
});

describe('specificity colours', () => {
  it('assigns palette colours in first-appearance order', () => {
    const n = normalize(getPreset('igg-kih'));
    expect(n.specificities.map((s) => s.name)).toEqual(['CD3', 'HER2']);
    expect(n.specificities[0]!.color).not.toBe(n.specificities[1]!.color);
  });

  it('honours an explicitly declared colour', () => {
    const n = normalize(parseDSL('@color A=#123456\nC1: VH(A)~VL(A)'));
    expect(n.specificities[0]!.color).toBe('#123456');
  });
});
