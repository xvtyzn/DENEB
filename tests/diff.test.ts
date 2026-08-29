import { describe, expect, it } from 'vitest';
import { normalize, parseDSL } from '../src/index';
import { diff } from '../src/diff/index';
import { getPreset } from '../src/presets/index';

const kinds = (a: string, b: string) => diff(parseDSL(a), parseDSL(b)).changes.map((c) => c.kind);

describe('diff', () => {
  it('says nothing about a construct compared with itself', () => {
    for (const name of ['igg-kih', 'dvd-ig', 'bite', 'adc-igg']) {
      const result = diff(getPreset(name), getPreset(name));
      expect(result.changes, name).toEqual([]);
      expect(result.highlightBefore, name).toEqual([]);
    }
  });

  it('reports a removed modification, and points at the domain', () => {
    const before = getPreset('igg-kih');
    const after = parseDSL(`
      HC1: VH(CD3)-CH1-h-CH2-CH3[knob]
      LC1: VL(CD3)-CL
      HC2: VH(HER2)-CH1-h-CH2-CH3
      LC2: VL(HER2)-CL
    `);
    const result = diff(before, after);
    expect(result.changes.map((c) => c.kind)).toEqual(['modification-removed']);
    expect(result.changes[0]!.summary).toContain('hole');
    const { byId } = normalize(before);
    expect(byId.has(result.highlightBefore[0]!)).toBe(true);
  });

  it('reports a swapped binding domain', () => {
    const changes = diff(
      parseDSL('HC: VH(HER2)-CH1-h-CH2-CH3\nLC: VL(HER2)-CL'),
      parseDSL('HC: VHH(EGFR)-CH1-h-CH2-CH3\nLC: VL(HER2)-CL'),
    ).changes;
    const changed = changes.find((c) => c.kind === 'domain-changed')!;
    expect(changed.summary).toContain('VH became VHH');
    expect(changed.summary).toContain('EGFR');
  });

  it('reports added and removed chains', () => {
    expect(kinds('HC: VH(X)-CH1\nLC: VL(X)-CL', 'HC: VH(X)-CH1')).toContain('chain-removed');
    expect(kinds('HC: VH(X)-CH1', 'HC: VH(X)-CH1\nLC: VL(X)-CL')).toContain('chain-added');
  });

  it('matches a renamed chain by its composition rather than calling it replaced', () => {
    const changes = kinds('HC1: VH(X)-CH1\nLC1: VL(X)-CL', 'heavy: VH(X)-CH1\nlight: VL(X)-CL');
    expect(changes).toEqual([]);
  });

  it('lists point substitutions when the sequences line up', () => {
    const parent = { id: 'HC', sequence: 'ACDEFGHIKL', domains: [{ type: 'VH' as const, specificity: 'X', start: 1, end: 10 }] };
    const variant = { id: 'HC', sequence: 'ACDEFGHIKA', domains: [{ type: 'VH' as const, specificity: 'X', start: 1, end: 10 }] };
    const result = diff({ chains: [parent] }, { chains: [variant] });
    const change = result.changes.find((c) => c.kind === 'sequence-changed')!;
    expect(change.residues).toEqual(['L10A']);
    // …and the substitution is attributed to the domain it falls in.
    expect(result.highlightAfter).toEqual(['HC:0']);
  });

  it('refuses to invent an alignment when the lengths differ', () => {
    const result = diff(
      { chains: [{ id: 'HC', sequence: 'ACDEFG', domains: [{ type: 'VH' as const }] }] },
      { chains: [{ id: 'HC', sequence: 'ACDEFGH', domains: [{ type: 'VH' as const }] }] },
    );
    const change = result.changes.find((c) => c.kind === 'sequence-changed')!;
    expect(change.residues).toBeUndefined();
    expect(change.summary).toContain('not compared');
  });

  it('reports an added conjugation by its compound', () => {
    const changes = diff(
      { chains: [{ id: 'HC', domains: [{ type: 'CH2' as const }] }] },
      {
        chains: [
          {
            id: 'HC',
            domains: [
              {
                type: 'CH2' as const,
                modifications: [{ type: 'drug' as const, payload: { name: 'MMAE', dar: 4 } }],
              },
            ],
          },
        ],
      },
    ).changes;
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('modification-added');
    expect(changes[0]!.summary).toContain('MMAE');
  });
});
