import type { DomainType, ModificationType } from '../model/types';

/**
 * The AbML v1.06 vocabulary.
 *
 * Antibody Markup Language, Sweet-Jones, Ahmad & Martin, mAbs 14:1 (2022),
 * doi:10.1080/19420862.2022.2101183. Everything below is taken from the format
 * description shipped with abYdraw rather than inferred from example strings.
 */

/** Longest first, so `CH1` is not read as `C` followed by `H1`. */
export const DOMAIN_TOKENS: readonly [string, DomainType][] = [
  ['VHH', 'VHH'],
  ['CH1', 'CH1'],
  ['CH2', 'CH2'],
  ['CH3', 'CH3'],
  ['CH4', 'CH4'],
  ['CH5', 'CH5'],
  ['VH', 'VH'],
  ['VL', 'VL'],
  ['CL', 'CL'],
  ['H', 'hinge'],
  ['L', 'linker'],
  // An Extra Domain has no counterpart of its own; what it is comes from its
  // TYPE comment and becomes the label. A Chemical Moiety maps onto the
  // globule this model already draws for a chemical entity in a chain — note
  // that an ADC's warhead is a modification here, not a domain, so the two
  // never collide.
  ['X', 'custom'],
  ['C', 'payload'],
];

/** Written back out; the inverse of the table above where one exists. */
export const DOMAIN_SYMBOLS: Partial<Record<DomainType, string>> = {
  VH: 'VH',
  VL: 'VL',
  VHH: 'VHH',
  CH1: 'CH1',
  CH2: 'CH2',
  CH3: 'CH3',
  CH4: 'CH4',
  CH5: 'CH5',
  CL: 'CL',
  hinge: 'H',
  linker: 'L',
  payload: 'C',
};

/** Modification symbols, which sit immediately after the domain type. */
export const MODIFICATION_SYMBOLS: Record<string, ModificationType> = {
  '^': 'drug', // a specific ADC site
  '>': 'knob',
  '@': 'hole',
  '+': 'charge+',
  _: 'charge-',
  '!': 'aglycosyl', // after CH2: not glycosylated
};

export const SYMBOL_FOR_MODIFICATION: Partial<Record<ModificationType, string>> = {
  drug: '^',
  knob: '>',
  hole: '@',
  'charge+': '+',
  'charge-': '_',
  aglycosyl: '!',
};

/**
 * `MOD:` keywords.
 *
 * Four have an exact counterpart here and are mapped to it; the rest become a
 * custom modification carrying the specification's own wording, which keeps the
 * meaning without pretending it is a mutation this library knows.
 */
export const MOD_KEYWORDS: Record<string, { type: ModificationType; label?: string }> = {
  DISULPHIDE: { type: 'disulfide' },
  DISULFIDE: { type: 'disulfide' },
  NOGLYCOS: { type: 'aglycosyl' },
  STRANDEXCHANGE: { type: 'seed' },
  CONJUGATION: { type: 'drug' },
  ENHANCEFCRN: { type: 'custom', label: 'enhanced FcRn binding' },
  ENHANCEADCC: { type: 'custom', label: 'enhanced ADCC' },
  PI: { type: 'custom', label: 'altered isoelectric point' },
  HEXAMER: { type: 'custom', label: 'hexamer formation' },
  NOFCGR: { type: 'custom', label: 'reduced FcRn binding' },
  NOPROTEINA: { type: 'custom', label: 'reduced protein A binding' },
  NOOX: { type: 'custom', label: 'reduced oxidation' },
  NOADCC: { type: 'custom', label: 'reduced ADCC' },
  NOCDC: { type: 'custom', label: 'reduced CDC' },
  NOADCP: { type: 'custom', label: 'reduced ADCP' },
  NOADCCCDC: { type: 'custom', label: 'reduced ADCC and CDC' },
  NOADE: { type: 'custom', label: 'reduced antibody-dependent enhancement' },
  NOAGG: { type: 'custom', label: 'reduced aggregation' },
  NOPROT: { type: 'custom', label: 'reduced proteolysis' },
  REMCYS: { type: 'custom', label: 'free cysteine removed' },
  STABILIZATION: { type: 'custom', label: 'stabilised' },
  AFFINITY: { type: 'custom', label: 'altered affinity' },
  OTHER: { type: 'custom', label: 'modification' },
};

/** `MOD:` keyword for a modification on the way back out, where one exists. */
export const MOD_FOR_MODIFICATION: Partial<Record<ModificationType, string>> = {
  disulfide: 'DISULPHIDE',
  seed: 'STRANDEXCHANGE',
  'lala': 'NOADCCCDC',
  'lala-pg': 'NOADCCCDC',
  yte: 'ENHANCEFCRN',
  ls: 'ENHANCEFCRN',
  'adcc-enhanced': 'ENHANCEADCC',
  thiomab: 'CONJUGATION',
  duobody: 'STRANDEXCHANGE',
  'ew-rvt': 'STRANDEXCHANGE',
  'ha-tf': 'STRANDEXCHANGE',
};

export const COMMENT_KEYWORDS = ['ANTI', 'MOD', 'TYPE', 'LENGTH', 'CLASS', 'NOTE'] as const;
export type CommentKeyword = (typeof COMMENT_KEYWORDS)[number];

/** `CLASS:` values, which map onto the model's isotype field. */
export const CLASS_KEYWORDS = ['IgG', 'IgE', 'IgA', 'IgD', 'IgM', 'OTHER'] as const;
