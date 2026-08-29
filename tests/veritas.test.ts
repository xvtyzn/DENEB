import { describe, expect, it } from 'vitest';
import { parseVeritas, toVeritas, VeritasError } from '../src/veritas/index';
import { normalize, renderSVG } from '../src/index';
import { getPreset, presetNames } from '../src/presets/index';

/**
 * VERITAS — Biswas, Belouski, Graham, Hortter, Mock, Tinberg & Russell,
 * mAbs 15:1 (2023), doi:10.1080/19420862.2023.2207232.
 *
 * The names below are either written for these tests or are the worked
 * examples the paper itself prints.
 */

const chains = (name: string) =>
  normalize(parseVeritas(name).construct).chains.map((c) => c.domains.map((d) => d.type).join('-'));

describe('parseVeritas', () => {
  it('expands a bare IgG centre into two heavy and two light chains', () => {
    const n = normalize(parseVeritas('IgG').construct);
    expect(n.chains.filter((c) => c.kind === 'heavy')).toHaveLength(2);
    expect(n.chains.filter((c) => c.kind === 'light')).toHaveLength(2);
  });

  it('puts a symmetric appendage on both chains of the centre', () => {
    // The paper's example of a format written without brackets.
    expect(chains('scFv-Fc-scFv')).toEqual([
      'VH-linker-VL-linker-hinge-CH2-CH3-linker-VH-linker-VL',
      'VH-linker-VL-linker-hinge-CH2-CH3-linker-VH-linker-VL',
    ]);
  });

  it('gives each chain its own appendage inside brackets', () => {
    const heavy = chains('[Fab*scFv]-heteroFc').filter((c) => c.includes('CH3'));
    expect(heavy).toEqual([
      'VH-CH1-hinge-CH2-CH3',
      'VH-linker-VL-linker-hinge-CH2-CH3',
    ]);
  });

  it('reads an empty position as a chain with no appendage', () => {
    const heavy = chains('[scFab*]-heteroFc').filter((c) => c.includes('CH3'));
    expect(heavy).toEqual(['VH-CH1-linker-VL-CL-linker-hinge-CH2-CH3', 'hinge-CH2-CH3']);
  });

  it('reads a colon as a noncovalent pair, with the centre-side module on the chain', () => {
    // scFv-LC:Fd-Fc — the Fd is on the Fc chain, the scFv rides on the light one.
    const all = chains('scFv-LC:Fd-Fc');
    expect(all).toContain('VH-CH1-hinge-CH2-CH3');
    expect(all).toContain('VH-linker-VL-VL-CL');
  });

  it('turns the heterodimerization abbreviation into knob and hole', () => {
    const n = normalize(parseVeritas('[Fab*scFv]-heteroFc(KiH)').construct);
    const marks = n.chains
      .filter((c) => c.kind === 'heavy')
      .map((c) => c.domains.flatMap((d) => d.modifications.map((m) => m.type)));
    expect(marks).toEqual([['knob'], ['hole']]);
  });

  it('reads charge-pair mutations too', () => {
    const n = normalize(parseVeritas('heteroFc(CPM)').construct);
    const types = n.chains.flatMap((c) => c.domains.flatMap((d) => d.modifications.map((m) => m.type)));
    expect(types).toEqual(['charge+', 'charge-']);
  });

  it('keeps an abbreviation the paper does not name, and says so', () => {
    const { construct, diagnostics } = parseVeritas('heteroFc(SEEDbody)');
    expect(diagnostics.map((d) => d.code)).toContain('unknown-strategy');
    const labels = normalize(construct).chains.flatMap((c) =>
      c.domains.flatMap((d) => d.modifications.map((m) => m.label)),
    );
    expect(labels).toContain('SEEDbody');
  });

  it('attaches a target written before a module', () => {
    const n = normalize(parseVeritas('[(HER2)Fab*(CD3)Fab]-heteroFc').construct);
    expect(new Set(n.chains.flatMap((c) => c.domains.map((d) => d.specificity).filter(Boolean)))).toEqual(
      new Set(['HER2', 'CD3']),
    );
  });

  it('does not linker a Fab onto the hinge', () => {
    // CH1 runs straight into the hinge; only a real appendage needs a linker.
    expect(chains('[Fab*Fab]-heteroFc')).toContain('VH-CH1-hinge-CH2-CH3');
  });

  it('picks the unambiguous centre when a module shares its name', () => {
    // `Fab` is both a module and a centre; here heteroFc is the centre.
    expect(chains('Fab-heteroFc').filter((c) => c.includes('CH3'))).toEqual([
      'VH-CH1-hinge-CH2-CH3',
      'VH-CH1-hinge-CH2-CH3',
    ]);
  });

  it('reads a name with no centre as a module composition', () => {
    const { construct, diagnostics } = parseVeritas('scFv-scFv');
    expect(diagnostics.map((d) => d.code)).toContain('no-center');
    expect(construct.chains).toHaveLength(1);
    expect(chains('scFv-scFv')).toEqual(['VH-linker-VL-linker-VH-linker-VL']);
  });

  it('keeps a module it does not know as a named domain', () => {
    const { construct, diagnostics } = parseVeritas('(HER2)DARPin-Fc');
    expect(diagnostics.map((d) => d.code)).toContain('unknown-module');
    const custom = construct.chains[0]!.domains.find((d) => d.type === 'custom');
    expect(custom?.label).toBe('DARPin');
    expect(custom?.specificity).toBe('HER2');
  });

  it('always says what the name could not have told it', () => {
    expect(parseVeritas('IgG').diagnostics.map((d) => d.code)).toContain('veritas-defaults');
  });

  it('rejects an empty name', () => {
    expect(() => parseVeritas('  ')).toThrow(VeritasError);
  });
});

describe('toVeritas', () => {
  it('names a plain IgG', () => {
    expect(toVeritas(getPreset('igg1')).name).toBe('IgG');
  });

  it('writes a bispecific the way the paper does', () => {
    // `[(TargetA)Fab*(TargetB)Fab]–heteroFc` is the paper's own worked example.
    expect(toVeritas(getPreset('igg-kih')).name).toBe('[(CD3)Fab*(HER2)Fab]-heteroFc(KiH)');
  });

  it('drops back to an unbracketed name when the chains match', () => {
    expect(toVeritas(getPreset('scfv-fc')).name).toBe('(EGFR)scFv-Fc');
  });

  it('expands an arm whose light chain carries an appendage', () => {
    // Naming this `IgG` would claim a format it is not.
    expect(toVeritas(getPreset('igg-lc-scfv')).name).toBe('(HER2)LC-(CD3)scFv:(HER2)Fd-Fc');
  });

  it('does not read two heavy variable domains as an Fv', () => {
    // A DVD-Ig stacks VH on VH; an scFv is one heavy and one light domain.
    expect(toVeritas(getPreset('dvd-ig')).name).toBe('(TNF)VL-(IL17)LC:(TNF)VH-(IL17)Fd-Fc');
  });

  it('names a molecule with no centre by its modules', () => {
    const { name, notes } = toVeritas(getPreset('bite'));
    expect(name).toBe('(CD19)scFv-(CD3)scFv');
    expect(notes.join(' ')).toContain('No multimerization centre');
  });

  it('reports what the notation cannot carry', () => {
    expect(toVeritas(getPreset('adc-igg')).notes.join(' ')).toContain('drug');
    expect(toVeritas(getPreset('igg4-s228p')).notes.join(' ')).toContain('hinge');
  });

  it('omits targets when asked', () => {
    expect(toVeritas(getPreset('igg-kih'), { includeTargets: false }).name).toBe('heteroIgG(KiH)');
  });

  it('names every bundled format, and reads each name back', () => {
    for (const preset of presetNames()) {
      const { name } = toVeritas(getPreset(preset));
      expect(name, preset).not.toBe('');
      const construct = parseVeritas(name).construct;
      normalize(construct);
      renderSVG(construct);
      // The name a construct is given must survive being read back in.
      expect(toVeritas(construct).name, preset).toBe(name);
    }
  });
});
