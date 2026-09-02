import type { DomainType, MarkerShape, ModificationType } from './types';

/** How a domain type is drawn and how much room it takes in the layout. */
export interface DomainSpec {
  /** Display label. */
  label: string;
  /** Glyph family used by the renderer. */
  glyph: 'variable' | 'constant' | 'hinge' | 'linker' | 'globule';
  /** Extent perpendicular to the chain axis. */
  width: number;
  /** Extent along the chain axis. */
  height: number;
  /** Variable domains carry the specificity colour; constants stay neutral. */
  colored: boolean;
  /** Variable domains pair up into an Fv head. */
  pairs: boolean;
  /** Corner radius; variable domains are rounder so they read apart from constants. */
  corner: number;
}

const V = (label: string): DomainSpec => ({
  label,
  glyph: 'variable',
  width: 15,
  height: 28,
  colored: true,
  pairs: true,
  corner: 6,
});

const C = (label: string): DomainSpec => ({
  label,
  glyph: 'constant',
  width: 15,
  height: 26,
  colored: false,
  pairs: true,
  corner: 2.5,
});

const G = (label: string, size: number): DomainSpec => ({
  label,
  glyph: 'globule',
  width: size,
  height: size,
  colored: true,
  pairs: false,
  corner: size / 2,
});

export const DOMAIN_CATALOG: Record<DomainType, DomainSpec> = {
  VH: V('VH'),
  VL: V('VL'),
  VHH: { ...V('VHH'), pairs: false },
  CH1: C('CH1'),
  CL: C('CL'),
  CH2: C('CH2'),
  CH3: C('CH3'),
  CH4: C('CH4'),
  CH5: C('CH5'),
  TCRa: { ...V('TCRα'), pairs: true },
  TCRb: { ...V('TCRβ'), pairs: true },
  hinge: {
    label: 'hinge',
    glyph: 'hinge',
    width: 15,
    height: 13,
    colored: false,
    pairs: false,
    corner: 0,
  },
  linker: {
    label: '',
    glyph: 'linker',
    width: 15,
    height: 11,
    colored: false,
    pairs: false,
    corner: 0,
  },
  albumin: G('HSA', 34),
  cytokine: G('cytokine', 26),
  toxin: G('toxin', 26),
  payload: G('payload', 22),
  // Neither pairs: `canPair` has no combination that accepts them, so leaving
  // them marked pairable only produced a "has no partner" note that nothing
  // could ever satisfy — and put the positional heavy/light walk out of step by
  // offering it a slot it could never fill.
  ECD: { ...C('ECD'), colored: true, pairs: false },
  custom: { ...C(''), colored: true, pairs: false },
  // composite shorthands; expanded by normalize() and never laid out directly
  scFv: V('scFv'),
  Fab: C('Fab'),
};

export const VARIABLE_TYPES: ReadonlySet<DomainType> = new Set<DomainType>([
  'VH',
  'VL',
  'VHH',
  'TCRa',
  'TCRb',
]);

export const FC_TYPES: ReadonlySet<DomainType> = new Set<DomainType>(['CH2', 'CH3', 'CH4']);

export const GLOBULE_TYPES: ReadonlySet<DomainType> = new Set<DomainType>([
  'albumin',
  'cytokine',
  'toxin',
  'payload',
]);

/** Which "half" of a pair a variable domain plays. */
export function pairSide(type: DomainType): 'heavy' | 'light' | null {
  switch (type) {
    case 'VH':
    case 'VHH':
    case 'CH1':
    case 'TCRb':
      return 'heavy';
    case 'VL':
    case 'CL':
    case 'TCRa':
      return 'light';
    default:
      return null;
  }
}

/** Types that can pair with each other. */
export function canPair(a: DomainType, b: DomainType): boolean {
  const set = new Set([a, b]);
  const has = (x: DomainType, y: DomainType) => set.has(x) && set.has(y) && a !== b;
  return has('VH', 'VL') || has('CH1', 'CL') || has('TCRa', 'TCRb') || (a === 'CH3' && b === 'CH3');
}

// ---------------------------------------------------------------------------
// Modifications
// ---------------------------------------------------------------------------

export interface ModificationSpec {
  label: string;
  marker: MarkerShape;
  color: string;
  /** Default residues shown in the legend when the caller gives none. */
  residues?: string[];
  /** Grouped in the legend under this heading. */
  group: 'heterodimerization' | 'effector' | 'pairing' | 'half-life' | 'conjugation' | 'other';
  /**
   * Which edge of the domain the mark sits on. Interface engineering belongs on
   * the edge facing the partner domain; anything attached to the surface —
   * glycans, conjugated payloads, PEG, tags — hangs off the solvent-facing edge.
   */
  side: 'interface' | 'surface';
}

export const MODIFICATION_CATALOG: Record<ModificationType, ModificationSpec> = {
  // --- heavy-chain heterodimerization ------------------------------------
  knob: {
    label: 'knob (T366W)',
    marker: 'knob',
    color: '#1f2937',
    residues: ['T366W'],
    group: 'heterodimerization',
    side: 'interface',
  },
  hole: {
    label: 'hole (T366S/L368A/Y407V)',
    marker: 'notch',
    color: '#1f2937',
    residues: ['T366S', 'L368A', 'Y407V'],
    group: 'heterodimerization',
    side: 'interface',
  },
  'charge+': {
    label: 'charge pair (+)',
    marker: 'plus',
    color: '#b91c1c',
    group: 'heterodimerization',
    side: 'interface',
  },
  'charge-': {
    label: 'charge pair (−)',
    marker: 'minus',
    color: '#1d4ed8',
    group: 'heterodimerization',
    side: 'interface',
  },
  duobody: {
    label: 'DuoBody (K409R / F405L)',
    marker: 'bar',
    color: '#7c3aed',
    residues: ['K409R', 'F405L'],
    group: 'heterodimerization',
    side: 'interface',
  },
  seed: {
    label: 'SEEDbody (IgG/IgA CH3)',
    marker: 'bar',
    color: '#0f766e',
    group: 'heterodimerization',
    side: 'interface',
  },
  'ew-rvt': {
    label: 'EW-RVT CH3 interface',
    marker: 'bar',
    color: '#0f766e',
    residues: ['K360E', 'K409W', 'Q347R', 'D399V', 'F405T'],
    group: 'heterodimerization',
    side: 'interface',
  },
  'ha-tf': {
    label: 'HA-TF CH3 interface',
    marker: 'bar',
    color: '#0f766e',
    residues: ['S364H', 'F405A', 'Y349T', 'T394F'],
    group: 'heterodimerization',
    side: 'interface',
  },

  // --- correct chain pairing ---------------------------------------------
  'crossmab-fab': {
    label: 'CrossMab (Fab crossover)',
    marker: 'cross',
    color: '#111827',
    group: 'pairing',
    side: 'interface',
  },
  'crossmab-ch1cl': {
    label: 'CrossMab CH1–CL',
    marker: 'cross',
    color: '#111827',
    group: 'pairing',
    side: 'interface',
  },
  'crossmab-vhvl': {
    label: 'CrossMab VH–VL',
    marker: 'cross',
    color: '#111827',
    group: 'pairing',
    side: 'interface',
  },
  'orthogonal-fab': {
    label: 'orthogonal Fab interface',
    marker: 'bar',
    color: '#a16207',
    group: 'pairing',
    side: 'interface',
  },
  disulfide: {
    label: 'engineered disulfide',
    marker: 'ss',
    color: '#a16207',
    group: 'pairing',
    side: 'interface',
  },

  // --- effector function ---------------------------------------------------
  lala: {
    label: 'LALA (Fc-silenced)',
    marker: 'dot',
    color: '#111827',
    residues: ['L234A', 'L235A'],
    group: 'effector',
    side: 'interface',
  },
  'lala-pg': {
    label: 'LALA-PG (Fc-silenced)',
    marker: 'dot',
    color: '#111827',
    residues: ['L234A', 'L235A', 'P329G'],
    group: 'effector',
    side: 'interface',
  },
  s228p: {
    label: 'IgG4 hinge stabilisation (S228P)',
    marker: 'bar',
    color: '#4b5563',
    residues: ['S228P'],
    group: 'effector',
    side: 'interface',
  },
  glycan: {
    label: 'N-glycan (N297)',
    marker: 'glycan',
    color: '#0f766e',
    group: 'effector',
    side: 'surface',
  },
  afucosyl: {
    label: 'afucosylated glycan (ADCC-enhanced)',
    marker: 'glycan',
    color: '#b45309',
    group: 'effector',
    side: 'surface',
  },
  aglycosyl: {
    label: 'aglycosyl (N297A)',
    marker: 'star',
    color: '#6b7280',
    residues: ['N297A'],
    group: 'effector',
    side: 'surface',
  },
  'adcc-enhanced': {
    label: 'ADCC-enhanced Fc (S239D/I332E)',
    marker: 'star',
    color: '#b91c1c',
    residues: ['S239D', 'I332E'],
    group: 'effector',
    side: 'surface',
  },

  // --- half-life ------------------------------------------------------------
  yte: {
    label: 'YTE (extended half-life)',
    marker: 'star',
    color: '#b45309',
    residues: ['M252Y', 'S254T', 'T256E'],
    group: 'half-life',
    side: 'surface',
  },
  ls: {
    label: 'LS (extended half-life)',
    marker: 'star',
    color: '#b45309',
    residues: ['M428L', 'N434S'],
    group: 'half-life',
    side: 'surface',
  },

  // --- conjugation ----------------------------------------------------------
  drug: {
    label: 'conjugated payload',
    marker: 'drug',
    color: '#be123c',
    group: 'conjugation',
    side: 'surface',
  },
  thiomab: {
    label: 'engineered cysteine (site-specific conjugation)',
    marker: 'thiol',
    color: '#0891b2',
    group: 'conjugation',
    side: 'surface',
  },
  peg: {
    label: 'PEGylation',
    marker: 'squiggle',
    color: '#6366f1',
    group: 'conjugation',
    side: 'surface',
  },
  tag: {
    label: 'affinity / epitope tag',
    marker: 'tab',
    color: '#475569',
    group: 'conjugation',
    side: 'surface',
  },

  custom: {
    label: 'modification',
    marker: 'dot',
    color: '#111827',
    group: 'other',
    side: 'interface',
  },
};

/** Aliases accepted in the DSL's `[...]` block and in `Modification.type`. */
export const MODIFICATION_ALIASES: Record<string, ModificationType> = {
  kih: 'knob',
  knobs: 'knob',
  holes: 'hole',
  'charge+': 'charge+',
  'charge-': 'charge-',
  chargeplus: 'charge+',
  chargeminus: 'charge-',
  crossmab: 'crossmab-ch1cl',
  'ch1cl': 'crossmab-ch1cl',
  'vhvl': 'crossmab-vhvl',
  lalapg: 'lala-pg',
  'lala_pg': 'lala-pg',
  n297a: 'aglycosyl',
  ss: 'disulfide',
  adc: 'drug',
  payload: 'drug',
  warhead: 'drug',
  cys: 'thiomab',
  fucose: 'afucosyl',
  defucosylated: 'afucosyl',
  glycosylation: 'glycan',
  n297: 'glycan',
  de: 'adcc-enhanced',
  sdie: 'adcc-enhanced',
  adcc: 'adcc-enhanced',
  pegylation: 'peg',
  his: 'tag',
  'his-tag': 'tag',
  flag: 'tag',
  strep: 'tag',
  igg4: 's228p',
  orthogonal: 'orthogonal-fab',
};
