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

  it('reads a conjugated payload in the positional shorthand', () => {
    const c = parseDSL('HC: CH2[drug=MMAE/mc-vc-PAB/4/2/interchain cysteine]');
    expect(c.chains[0]!.domains[0]!.modifications![0]!.payload).toEqual({
      name: 'MMAE',
      linker: 'mc-vc-PAB',
      dar: 4,
      count: 2,
      site: 'interchain cysteine',
    });
  });

  it('takes cleavability as a word of its own', () => {
    const c = parseDSL('HC: CH2[drug=DM1/SMCC/3.5/1/surface lysine/noncleavable]');
    expect(c.chains[0]!.domains[0]!.modifications![0]!.payload!.cleavable).toBe(false);
  });

  it('names a field the shorthand has no room for, or no place to put', () => {
    // A site with no linker would land in the linker's slot; shape and colour
    // the shorthand cannot say at all.
    const c = parseDSL('HC: CH2[drug=DM1/site=surface lysine/shape=diamond/color=#7c3aed]');
    expect(c.chains[0]!.domains[0]!.modifications![0]!.payload).toEqual({
      name: 'DM1',
      site: 'surface lysine',
      shape: 'diamond',
      color: '#7c3aed',
    });
  });

  it('takes an empty attachment, which is how a bond is left bare', () => {
    const c = parseDSL('HC: CH2[drug=DXd/GGFG/2/1/THIOMAB A114C/attachment=]');
    expect(c.chains[0]!.domains[0]!.modifications![0]!.payload!.attachment).toBe('');
  });

  it('refuses a value with nowhere to go rather than overwriting one', () => {
    // Before, a sixth field silently replaced the site.
    expect(() => parseDSL('HC: CH2[drug=MMAE/vc-PAB/4/2/a site/and another]')).toThrow(
      /nowhere to go/,
    );
    expect(() => parseDSL('HC: CH2[drug=MMAE/vc-PAB/4/2/3]')).toThrow(/nowhere to go/);
  });

  it('refuses a field or a shape it does not know', () => {
    expect(() => parseDSL('HC: CH2[drug=MMAE/fizz=1]')).toThrow(/unknown payload field/);
    expect(() => parseDSL('HC: CH2[drug=MMAE/shape=blob]')).toThrow(/unknown payload shape/);
    expect(() => parseDSL('HC: CH2[drug=name=MMAE]')).toThrow(/name comes first/);
  });

  it('refuses duplicate or invalid payload quantities', () => {
    expect(() => parseDSL('HC: CH2[drug=DM1/4/dar=8]')).toThrow(/dar.*more than once/);
    expect(() => parseDSL('HC: CH2[drug=DM1/count=2/copies=3]')).toThrow(
      /count.*more than once/,
    );
    expect(() => parseDSL('HC: CH2[drug=DM1/dar=-1]')).toThrow(/greater than zero/);
    expect(() => parseDSL('HC: CH2[drug=DM1/count=-2]')).toThrow(/positive integer/);
    expect(() => parseDSL('HC: CH2[drug=DM1/count=1.5]')).toThrow(/positive integer/);
  });

  it('accepts case-insensitive boolean payload fields', () => {
    const payload = parseDSL('HC: CH2[drug=DM1/cleavable=TRUE]').chains[0]!.domains[0]!
      .modifications![0]!.payload;
    expect(payload?.cleavable).toBe(true);
  });

  it('refuses non-positive or fractional chain copy counts', () => {
    expect(() => parseDSL('HC: CH2 *0')).toThrow(/positive integer/);
    expect(() => parseDSL('HC: CH2 *1.5')).toThrow(DslError);
  });

  it('records the isotype of a chain', () => {
    // A chain-level fact the model keeps on its domains. It reads either way
    // round, so the directive may come before or after the chain it names.
    for (const source of [
      'HC: VH(A)-CH1-h-CH2-CH3\n@isotype HC=IgG4',
      '@isotype HC=IgG4\nHC: VH(A)-CH1-h-CH2-CH3',
    ]) {
      const c = parseDSL(source);
      expect(c.chains[0]!.domains.every((d) => d.isotype === 'IgG4'), source).toBe(true);
    }
  });

  it('refuses an isotype for a chain that is not there', () => {
    expect(() => parseDSL('HC: VH(A)-CH1\n@isotype LC=IgG4')).toThrow(/names no chain/);
    expect(() => parseDSL('HC: VH(A)-CH1\n@isotype HC')).toThrow(/CHAIN=IgG1/);
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

  it('round-trips a payload with every field set', () => {
    const source =
      'C1: CH2[drug=DM1/SMCC/3.5/1/surface lysine/noncleavable/attachment=NH/' +
      'shape=diamond/color=#7c3aed]';
    expect(stringifyDSL(parseDSL(source))).toBe(source);
  });

  it('names a field back when the shorthand could not carry it', () => {
    // Bare values are placed by what they are, so a site with no linker in
    // front of it has to be written out.
    expect(stringifyDSL(parseDSL('C1: CH2[drug=DM1/site=lysine/copies=2]'))).toBe(
      'C1: CH2[drug=DM1/copies=2/site=lysine]',
    );
  });

  it('round-trips an isotype', () => {
    expect(stringifyDSL(parseDSL('C1: CH2-CH3\n@isotype C1=IgG4'))).toBe(
      'C1: CH2-CH3\n@isotype C1=IgG4',
    );
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
