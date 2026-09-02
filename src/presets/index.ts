import type { Construct } from '../model/types';
import { parseDSL } from '../dsl/parse';

/**
 * Ready-made specs for formats that have been reduced to practice. They double
 * as the engine's regression corpus: every entry is rendered by the snapshot
 * test and by `scripts/gallery.mjs`.
 */
export const PRESET_SOURCES = {
  // --- canonical -------------------------------------------------------
  igg1: `
    @name IgG1
    HC: VH(Target)-CH1-h-CH2-CH3 *2
    LC: VL(Target)-CL *2
  `,
  'igg1-lala': `
    @name IgG1 LALA (Fc-silenced)
    HC: VH(Target)-CH1-h-CH2[lala]-CH3 *2
    LC: VL(Target)-CL *2
  `,

  // --- Fc-based IgG heterodimers ---------------------------------------
  'igg-kih': `
    @name IgG(kih) 1+1 bispecific
    HC1: VH(CD3)-CH1-h-CH2-CH3[knob]
    LC1: VL(CD3)-CL
    HC2: VH(HER2)-CH1-h-CH2-CH3[hole]
    LC2: VL(HER2)-CL
  `,
  'igg-kih-lala': `
    @name IgG(kih), Fc-silenced
    HC1: VH(CD3)-CH1-h-CH2[lala-pg]-CH3[knob]
    LC1: VL(CD3)-CL
    HC2: VH(HER2)-CH1-h-CH2[lala-pg]-CH3[hole]
    LC2: VL(HER2)-CL
  `,
  'common-lc-kih': `
    @name IgG(kih), common light chain
    HC1: VH(CD3)-CH1-h-CH2-CH3[knob]
    HC2: VH(HER2)-CH1-h-CH2-CH3[hole]
    LC: VL-CL
  `,
  'crossmab-ch1cl': `
    @name CrossMab CH1-CL
    HC1: VH(CD3)-CL[crossmab-ch1cl]-h-CH2-CH3[knob]
    LC1: VL(CD3)-CH1[crossmab-ch1cl]
    HC2: VH(HER2)-CH1-h-CH2-CH3[hole]
    LC2: VL(HER2)-CL
  `,
  'crossmab-fab': `
    @name CrossMab Fab
    HC1: VL(CD3)-CL[crossmab-fab]-h-CH2-CH3[knob]
    LC1: VH(CD3)-CH1
    HC2: VH(HER2)-CH1-h-CH2-CH3[hole]
    LC2: VL(HER2)-CL
  `,
  duobody: `
    @name DuoBody (controlled Fab-arm exchange)
    HC1: VH(CD3)-CH1-h-CH2-CH3[duobody=F405L]
    LC1: VL(CD3)-CL
    HC2: VH(CD20)-CH1-h-CH2-CH3[duobody=K409R]
    LC2: VL(CD20)-CL
  `,
  'charge-pair-igg': `
    @name IgG with CH3 charge pairs
    HC1: VH(CD3)-CH1-h-CH2-CH3[charge+]
    LC1: VL(CD3)-CL
    HC2: VH(HER2)-CH1-h-CH2-CH3[charge-]
    LC2: VL(HER2)-CL
  `,
  duetmab: `
    @name DuetMab (engineered CH1-CL disulfide)
    HC1: VH(CD3)-CH1[disulfide]-h-CH2-CH3[knob]
    LC1: VL(CD3)-CL[disulfide]
    HC2: VH(HER2)-CH1-h-CH2-CH3[hole]
    LC2: VL(HER2)-CL
  `,
  'two-in-one-igg': `
    @name Two-in-one IgG (DAF)
    HC: VH(HER2 + VEGF)-CH1-h-CH2-CH3 *2
    LC: VL(HER2 + VEGF)-CL *2
  `,
  'adc-igg': `
    @name ADC (interchain-cysteine conjugate)
    HC: VH(HER2)-CH1-h-CH2-CH3 *2
    LC: VL(HER2)-CL[drug=MMAE/vc-PAB/4/2/interchain cysteine] *2
  `,
  'adc-thiomab': `
    @name THIOMAB ADC (site-specific, DAR 2)
    HC1: VH(HER2)-CH1-h-CH2[thiomab]-CH3[knob]
    LC1: VL(HER2)-CL
    HC2: VH(HER2)-CH1-h-CH2[drug=DM1/SMCC/2/THIOMAB A114C]-CH3[hole]
    LC2: VL(HER2)-CL
  `,
  'adc-noncleavable': `
    @name ADC (non-cleavable linker, lysine-conjugated)
    HC: VH(CD30)-CH1-h-CH2[drug=DM1/SMCC/3.5/lysine]-CH3 *2
    LC: VL(CD30)-CL *2
  `,
  'igg-glycan': `
    @name IgG1 with N297 glycan
    HC: VH(Target)-CH1-h-CH2[glycan]-CH3 *2
    LC: VL(Target)-CL *2
  `,
  'igg-afucosyl': `
    @name Afucosylated IgG1 (ADCC-enhanced)
    HC: VH(CCR4)-CH1-h-CH2[afucosyl, adcc-enhanced]-CH3 *2
    LC: VL(CCR4)-CL *2
  `,
  'igg-long-half-life': `
    @name IgG1 with extended half-life
    HC: VH(RSV F)-CH1-h-CH2[lala]-CH3[yte] *2
    LC: VL(RSV F)-CL *2
  `,
  'igg4-s228p': `
    @name IgG4 (S228P hinge-stabilised)
    HC: VH(PD1)-CH1-h[s228p]-CH2-CH3 *2
    LC: VL(PD1)-CL *2
  `,
  'pegylated-fab': `
    @name PEGylated Fab
    HC: VH(TNF)-CH1[peg]
    LC: VL(TNF)-CL
  `,
  'tagged-scfv': `
    @name scFv with purification tag
    C1: VH(EGFR)~VL(EGFR)[tag]
  `,

  // --- fragments -------------------------------------------------------
  fab: `
    @name Fab
    HC: VH(HER2)-CH1
    LC: VL(HER2)-CL
  `,
  fab2: `
    @name F(ab')2
    HC1: VH(HER2)-CH1-h
    LC1: VL(HER2)-CL
    HC2: VH(HER2)-CH1-h
    LC2: VL(HER2)-CL
  `,
  scfv: `
    @name scFv
    C1: VH(HER2)~VL(HER2)
  `,
  bite: `
    @name BiTE (tandem scFv)
    C1: VH(CD19)~VL(CD19)~VH(CD3)~VL(CD3)
  `,
  'hle-bite': `
    @name HLE-BiTE (scFv2-Fc)
    HC1: VH(CD19)~VL(CD19)~VH(CD3)~VL(CD3)-h-CH2-CH3[knob]
    HC2: h-CH2-CH3[hole]
  `,
  diabody: `
    @name Diabody
    A: VH(CD3)~VL(CD19)
    B: VH(CD19)~VL(CD3)
  `,
  dart: `
    @name DART (disulfide-stabilised diabody)
    A: VH(CD3)~VL(CD19)[disulfide]
    B: VH(CD19)~VL(CD3)[disulfide]
  `,
  'dart-fc': `
    @name DART-Fc
    A: VH(CD3)~VL(CD19)-h-CH2-CH3[knob]
    B: VH(CD19)~VL(CD3)-h-CH2-CH3[hole]
  `,
  tandab: `
    @name TandAb (tetravalent tandem diabody)
    A: VH(CD3)~VL(CD19)~VH(CD19)~VL(CD3)
    B: VH(CD3)~VL(CD19)~VH(CD19)~VL(CD3)
    @pair A:0 B:6
    @pair A:2 B:4
    @pair A:4 B:2
    @pair A:6 B:0
  `,
  vhh: `
    @name VHH (nanobody)
    C1: VHH(EGFR)
  `,
  'tandem-vhh': `
    @name Tandem VHH (trispecific)
    C1: VHH(EGFR)~VHH(CD3)~VHH(HSA)
  `,
  'biparatopic-vhh-fc': `
    @name Biparatopic VHH-Fc
    HC: VHH(HER2 ep1)~VHH(HER2 ep2)-h-CH2-CH3 *2
  `,

  // --- Fc fusions ------------------------------------------------------
  'scfv-fc': `
    @name scFv-Fc
    HC: VH(EGFR)~VL(EGFR)-h-CH2-CH3 *2
  `,
  'scfv-fc-kih': `
    @name scFv-Fc(kih) bispecific
    HC1: VH(CD3)~VL(CD3)-h-CH2-CH3[knob]
    HC2: VH(HER2)~VL(HER2)-h-CH2-CH3[hole]
  `,

  // --- appended IgG ----------------------------------------------------
  'dvd-ig': `
    @name DVD-Ig
    HC: VH(TNF)~VH(IL17)-CH1-h-CH2-CH3 *2
    LC: VL(TNF)~VL(IL17)-CL *2
  `,
  'tvd-ig': `
    @name TVD-Ig
    HC: VH(TNF)~VH(IL17)~VH(IL23)-CH1-h-CH2-CH3 *2
    LC: VL(TNF)~VL(IL17)~VL(IL23)-CL *2
  `,
  'codv-ig': `
    @name CODV-Ig (cross-over dual variable)
    HC: VH(TNF)~VH(IL17)-CH1-h-CH2-CH3 *2
    LC: VL(IL17)~VL(TNF)-CL *2
    # The cross-over is the whole format, so it is stated rather than left to
    # be inferred from the target names.
    @pair HC:0 LC:2
    @pair HC:2 LC:0
  `,
  'igg-hc-scfv': `
    @name IgG-HC-scFv (2+2)
    HC: VH(HER2)-CH1-h-CH2-CH3~VH(CD3)~VL(CD3) *2
    LC: VL(HER2)-CL *2
  `,
  'igg-lc-scfv': `
    @name IgG-scFv(LC) (2+2)
    HC: VH(HER2)-CH1-h-CH2-CH3 *2
    LC: VL(HER2)-CL~VH(CD3)~VL(CD3) *2
  `,
  'vhh-igg': `
    @name VHH-IgG (N-terminal VHH, 2+2 bispecific)
    HC: VHH(CD3)~VH(HER2)-CH1-h-CH2-CH3 *2
    LC: VL(HER2)-CL *2
  `,
  'vhh-igg-kih': `
    @name VHH-IgG(kih) (2+1, one N-terminal VHH)
    HC1: VHH(CD3)~VH(HER2)-CH1-h-CH2-CH3[knob]
    LC1: VL(HER2)-CL
    HC2: VH(HER2)-CH1-h-CH2-CH3[hole]
    LC2: VL(HER2)-CL
  `,
  'scfv-igg-kih': `
    @name scFv-IgG(kih) (N-terminal scFv, trispecific)
    HC1: VH(CD3)~VL(CD3)~VH(HER2)-CH1-h-CH2-CH3[knob]
    LC1: VL(HER2)-CL
    HC2: VH(CD20)-CH1-h-CH2-CH3[hole]
    LC2: VL(CD20)-CL
  `,
  'vhh-lc-igg': `
    @name VHH on both chains (tetraspecific IgG)
    HC: VHH(CD3)~VH(HER2)-CH1-h-CH2-CH3 *2
    LC: VHH(EGFR)~VL(HER2)-CL *2
  `,
  'scfv4-ig': `
    @name scFv4-Ig
    HC: VH(CD3)~VL(CD3)~VH(HER2)-CH1-h-CH2-CH3 *2
    LC: VL(HER2)-CL *2
  `,
  'trispecific-igg-scfv': `
    @name Trispecific IgG(kih)-scFv
    HC1: VH(CD3)-CH1-h-CH2-CH3[knob]~VH(CD28)~VL(CD28)
    LC1: VL(CD3)-CL
    HC2: VH(HER2)-CH1-h-CH2-CH3[hole]
    LC2: VL(HER2)-CL
  `,

  // --- non-Ig fusions and payloads -------------------------------------
  'scfv2-albumin': `
    @name scFv2-albumin fusion
    C1: VH(CD3)~VL(CD3)~VH(EGFR)~VL(EGFR)~HSA
  `,
  'scfv-toxin': `
    @name Immunotoxin (scFv-toxin)
    C1: VH(CD22)~VL(CD22)~toxin
  `,
  immtac: `
    @name ImmTAC (soluble TCR - anti-CD3 scFv)
    A: TCRa(pMHC)
    B: TCRb(pMHC)~VH(CD3)~VL(CD3)
  `,
  'igg-cytokine': `
    @name Immunocytokine (IgG-IL2)
    HC: VH(PD1)-CH1-h-CH2-CH3~cytokine(IL-2) *2
    LC: VL(PD1)-CL *2
  `,
} as const satisfies Record<string, string>;

export type PresetName = keyof typeof PRESET_SOURCES;

const cache = new Map<string, Construct>();

/** Parse a preset by name. Results are memoised; the returned object is shared. */
export function getPreset(name: PresetName | string): Construct {
  const cached = cache.get(name);
  if (cached) return cached;
  const source = (PRESET_SOURCES as Record<string, string | undefined>)[name];
  if (!source) throw new Error(`Unknown preset "${name}". See presetNames().`);
  const parsed = parseDSL(source);
  cache.set(name, parsed);
  return parsed;
}

export function presetNames(): PresetName[] {
  return Object.keys(PRESET_SOURCES) as PresetName[];
}

/**
 * Formats worth starting from, rather than every format there is.
 *
 * An editor needs a short list of scaffolds a person recognises — the whole
 * catalogue is a reference, not a menu. These are ordinary presets; the only
 * thing that makes them templates is that someone is likely to build on one.
 */
export const TEMPLATE_NAMES = [
  'igg1',
  'igg1-lala',
  'igg-kih',
  'fab',
  'scfv',
  'bite',
  'vhh',
  'adc-igg',
] as const satisfies readonly PresetName[];

export type TemplateName = (typeof TEMPLATE_NAMES)[number];

/**
 * A starting point, ready to edit.
 *
 * Unlike `getPreset`, this hands back a construct of your own rather than the
 * shared cached one, so editing it cannot poison the catalogue for everyone
 * else on the page.
 */
export function getTemplate(name: TemplateName): Construct {
  return structuredClone(getPreset(name));
}

/** Lazy map view: `presets['igg-kih']` parses on first access. */
export const presets: Record<PresetName, Construct> = new Proxy(
  {} as Record<PresetName, Construct>,
  {
    get: (_t, prop: string) => getPreset(prop),
    has: (_t, prop: string) => prop in PRESET_SOURCES,
    ownKeys: () => Object.keys(PRESET_SOURCES),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);
