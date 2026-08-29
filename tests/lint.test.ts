import { describe, expect, it } from 'vitest';
import { normalize, parseDSL } from '../src/index';
import { LINT_RULES, lint } from '../src/lint/index';
import { PRESET_SOURCES, getPreset, presetNames } from '../src/presets/index';

/** The DSL a preset is written in, so a test can vary it. */
const sourceOf = (name: string): string => (PRESET_SOURCES as Record<string, string>)[name]!;

const rulesFor = (dsl: string, options?: Parameters<typeof lint>[1]) =>
  lint(parseDSL(dsl), options).map((f) => f.rule);

describe('lint catches what it should', () => {
  it('flags two different heavy chains with no way to prefer each other', () => {
    expect(
      rulesFor(`
        HC1: VH(CD3)-CH1-h-CH2-CH3
        LC1: VL(CD3)-CL
        HC2: VH(HER2)-CH1-h-CH2-CH3
        LC2: VL(HER2)-CL
      `),
    ).toContain('homodimer-risk');
    // …and stops once they can.
    expect(rulesFor(sourceOf('igg-kih'))).not.toContain('homodimer-risk');
  });

  it('leaves a real homodimer alone', () => {
    expect(
      rulesFor(`
        HC: VH(X)-CH1-h-CH2-CH3 *2
        LC: VL(X)-CL *2
      `),
    ).not.toContain('homodimer-risk');
  });

  it('flags a knob with no hole, and a knob facing a knob', () => {
    expect(rulesFor('HC1: CH3[knob]\nHC2: CH3')).toContain('knob-without-hole');
    expect(rulesFor('HC1: CH3[knob]\nHC2: CH3[knob]')).toContain('knob-without-hole');
    expect(rulesFor('HC1: CH3[knob]\nHC2: CH3[hole]')).not.toContain('knob-without-hole');
  });

  it('flags a half-finished charge pair', () => {
    expect(rulesFor('HC1: CH3[charge+]\nHC2: CH3')).toContain('charge-pair-unbalanced');
    expect(rulesFor('HC1: CH3[charge+]\nHC2: CH3[charge-]')).not.toContain(
      'charge-pair-unbalanced',
    );
  });

  it('flags two distinct light chains with nothing steering them', () => {
    expect(rulesFor(sourceOf('igg-kih'))).toContain('light-chain-mispairing');
  });

  it.each(['crossmab-ch1cl', 'crossmab-fab', 'duetmab', 'common-lc-kih', 'duobody'])(
    '%s solves the pairing problem, so it is not flagged',
    (preset) => {
      expect(lint(getPreset(preset)).map((f) => f.rule)).not.toContain(
        'light-chain-mispairing',
      );
    },
  );

  it('flags an unsilenced Fc on a CD3 engager, and can be turned off', () => {
    const engager = sourceOf('igg-kih');
    expect(rulesFor(engager)).toContain('effector-active-engager');
    expect(rulesFor(engager, { disable: ['effector-active-engager'] })).not.toContain(
      'effector-active-engager',
    );
    // Silencing the Fc settles it.
    expect(lint(getPreset('igg-kih-lala')).map((f) => f.rule)).not.toContain(
      'effector-active-engager',
    );
  });

  it('flags an unstabilised IgG4 hinge', () => {
    const igg4 = {
      chains: [
        {
          id: 'HC',
          domains: [
            { type: 'VH' as const, specificity: 'X' },
            { type: 'CH1' as const },
            { type: 'hinge' as const, isotype: 'IgG4' },
            { type: 'CH2' as const },
            { type: 'CH3' as const },
          ],
        },
        { id: 'LC', domains: [{ type: 'VL' as const, specificity: 'X' }, { type: 'CL' as const }] },
      ],
    };
    expect(lint(igg4).map((f) => f.rule)).toContain('igg4-fab-arm-exchange');
    igg4.chains[0]!.domains[2] = {
      type: 'hinge' as const,
      isotype: 'IgG4',
      modifications: [{ type: 's228p' as const }],
    } as never;
    expect(lint(igg4).map((f) => f.rule)).not.toContain('igg4-fab-arm-exchange');
  });

  it('flags a DAR outside the built-in screening range without making a chemistry claim', () => {
    const withDar = (dar: number) => ({
      chains: [
        {
          id: 'HC',
          domains: [
            {
              type: 'CH2' as const,
              modifications: [{ type: 'drug' as const, payload: { name: 'P', dar } }],
            },
          ],
        },
      ],
    });
    const high = lint(withDar(12)).find((f) => f.rule === 'dar-out-of-range');
    expect(high?.message).toContain('built-in 0-8 screening range');
    expect(lint(withDar(0)).map((f) => f.rule)).toContain('dar-out-of-range');
    expect(lint(withDar(3.5)).map((f) => f.rule)).not.toContain('dar-out-of-range');
  });

  it('flags a heavy chain that skips the hinge', () => {
    expect(rulesFor('HC: VH(X)-CH1-CH2-CH3\nLC: VL(X)-CL')).toContain('missing-hinge');
  });

  it('flags a variable domain with no partner', () => {
    expect(rulesFor('C1: VH(X)')).toContain('unpaired-variable-domain');
    expect(rulesFor('C1: VH(X)~VL(X)')).not.toContain('unpaired-variable-domain');
  });

  it('notes an scFv with no engineered disulfide', () => {
    expect(rulesFor('C1: VH(X)~VL(X)')).toContain('scfv-unstabilised');
    expect(rulesFor('C1: VH(X)~VL(X)[disulfide]')).not.toContain('scfv-unstabilised');
  });
});

describe('lint findings are usable', () => {
  it('points at domains in the form highlight takes', () => {
    const construct = getPreset('igg-kih');
    const finding = lint(construct).find((f) => f.rule === 'light-chain-mispairing')!;
    expect(finding.refs.length).toBeGreaterThan(0);
    // Every ref resolves to a real domain.
    const { byId } = normalize(construct);
    for (const ref of finding.refs) expect(byId.has(ref)).toBe(true);
    expect(finding.hint).toBeTruthy();
  });

  it('lets individual rules be re-levelled', () => {
    const raised = lint(getPreset('scfv'), { severity: { 'scfv-unstabilised': 'error' } });
    expect(raised.find((f) => f.rule === 'scfv-unstabilised')?.level).toBe('error');
  });

  it('marks rules that rely on heuristic assumptions', () => {
    const heuristics = LINT_RULES.filter((r) => r.heuristic).map((r) => r.name);
    expect(heuristics).toEqual(['effector-active-engager', 'dar-out-of-range']);
    for (const rule of LINT_RULES) expect(rule.about, rule.name).toBeTruthy();
  });

  it('says nothing about a plain IgG1', () => {
    expect(lint(getPreset('igg1'))).toEqual([]);
  });

  it('never throws on any bundled format', () => {
    for (const name of presetNames()) {
      expect(() => lint(getPreset(name)), name).not.toThrow();
    }
  });
});
