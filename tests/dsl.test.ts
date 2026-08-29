import { describe, expect, it } from 'vitest';
import { DslError, parseDSL, stringifyDSL } from '../src/index';
import { PRESET_SOURCES, getPreset, presetNames } from '../src/presets/index';

describe('parseDSL', () => {
  it('parses chains, specificities and modifications', () => {
    const c = parseDSL(`
      @name Test
      HC1: VH(CD3)-CH1-h-CH2-CH3[knob, lala]
      LC1: VL(CD3)-CL
    `);
    expect(c.name).toBe('Test');
    expect(c.chains).toHaveLength(2);
    expect(c.chains[0]!.domains.map((d) => d.type)).toEqual([
      'VH',
      'CH1',
      'hinge',
      'CH2',
      'CH3',
    ]);
    expect(c.chains[0]!.domains[0]!.specificity).toBe('CD3');
    expect(c.chains[0]!.domains[4]!.modifications).toEqual([{ type: 'knob' }, { type: 'lala' }]);
  });

  it('turns `~` into a linker domain', () => {
    const c = parseDSL('C1: VH(A)~VL(A)');
    expect(c.chains[0]!.domains.map((d) => d.type)).toEqual(['VH', 'linker', 'VL']);
  });

  it('expands the Fc macro', () => {
    const c = parseDSL('HC: VH(A)-CH1-h-Fc');
    expect(c.chains[0]!.domains.map((d) => d.type)).toEqual(['VH', 'CH1', 'hinge', 'CH2', 'CH3']);
  });

  it('reads `*n` as a chain copy count', () => {
    expect(parseDSL('HC: VH(A)-CH1 *2').chains[0]!.copies).toBe(2);
  });

  it('accepts residue overrides and modification aliases', () => {
    const c = parseDSL('HC: CH3[kih, duobody=K409R]');
    expect(c.chains[0]!.domains[0]!.modifications).toEqual([
      { type: 'knob' },
      { type: 'duobody', residues: ['K409R'] },
    ]);
  });

  it('keeps unknown modification names as custom entries rather than failing', () => {
    const c = parseDSL('HC: CH3[SomeNovelMutation]');
    expect(c.chains[0]!.domains[0]!.modifications).toEqual([
      { type: 'custom', label: 'SomeNovelMutation' },
    ]);
  });

  it('records @pair and @ss as explicit links', () => {
    const c = parseDSL(`
      A: VH(x)~VL(y)
      B: VH(y)~VL(x)
      @pair A:0 B:2
      @ss A:2 B:0
    `);
    expect(c.links).toEqual([
      { type: 'pair', a: 'A:0', b: 'B:2' },
      { type: 'disulfide', a: 'A:2', b: 'B:0' },
    ]);
  });

  it('names unlabelled chains and strips comments', () => {
    const c = parseDSL('VH(A)~VL(A) # a comment');
    expect(c.chains[0]!.id).toBe('C1');
  });

  it('reports the position of a syntax error', () => {
    expect(() => parseDSL('HC: VH(A')).toThrow(DslError);
    expect(() => parseDSL('@skeleton nope')).toThrow(/@skeleton/);
    expect(() => parseDSL('HC: VH(A)--CL')).toThrow(DslError);
  });
});

describe('stringifyDSL', () => {
  it('round-trips every preset', () => {
    for (const name of presetNames()) {
      const original = getPreset(name);
      const reparsed = parseDSL(stringifyDSL(original));
      expect(reparsed, name).toEqual(original);
    }
  });

  it('writes linkers back as `~`', () => {
    expect(stringifyDSL(parseDSL('C1: VH(A)~VL(A)'))).toBe('C1: VH(A)~VL(A)');
  });

  it('keeps every preset source parseable', () => {
    for (const [name, source] of Object.entries(PRESET_SOURCES)) {
      expect(() => parseDSL(source), name).not.toThrow();
    }
  });
});
