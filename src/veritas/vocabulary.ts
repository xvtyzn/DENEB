import type { DomainType, ModificationType } from '../model/types';

/**
 * VERITAS — Verified Taxonomy for Antibodies.
 *
 * Biswas, Belouski, Graham, Hortter, Mock, Tinberg & Russell,
 * "VERITAS: Harnessing the power of nomenclature in biologic discovery",
 * mAbs 15:1 (2023), doi:10.1080/19420862.2023.2207232
 *
 * A VERITAS name describes a format as
 * `[N-terminal appendages]–multimerization center–[C-terminal appendages]`.
 * It is a *name*, not a construct: it says nothing about linker length,
 * hinges, isotype or residue numbers, and the paper gives it no notation for
 * any of them. What it does carry — the architecture and, optionally, the
 * targets — is what this module reads and writes.
 */

/** A building block, and the domains it stands for. */
export interface ModuleSpec {
  /** Domains on the chain, N to C. */
  domains: DomainType[];
  /** A second chain this module brings with it, paired to the first. */
  partnerDomains?: DomainType[];
  /** Human name for a diagnostic. */
  label: string;
}

/**
 * Appendage modules. Longer names are matched first, so `scFab` is not read as
 * `scFv` and `VHH` is not read as `VH`.
 */
export const MODULES: Record<string, ModuleSpec> = {
  scFab: { domains: ['VH', 'CH1', 'linker', 'VL', 'CL'], label: 'single-chain Fab' },
  scFv: { domains: ['VH', 'linker', 'VL'], label: 'single-chain Fv' },
  VHH: { domains: ['VHH'], label: 'heavy-chain-only variable domain' },
  dAb: { domains: ['VHH'], label: 'single-domain antibody' },
  Fab: { domains: ['VH', 'CH1'], partnerDomains: ['VL', 'CL'], label: 'Fab' },
  Fd: { domains: ['VH', 'CH1'], label: 'Fd (VH–CH1)' },
  LC: { domains: ['VL', 'CL'], label: 'light chain' },
  VH: { domains: ['VH'], label: 'heavy variable domain' },
  VL: { domains: ['VL'], label: 'light variable domain' },
  CH1: { domains: ['CH1'], label: 'CH1' },
  CH2: { domains: ['CH2'], label: 'CH2' },
  CL: { domains: ['CL'], label: 'CL' },
  protein: { domains: ['custom'], label: 'generic protein module' },
};

/** A multimerization center, and the chains it contributes. */
export interface CenterSpec {
  /** One entry per chain of the center. */
  chains: DomainType[][];
  /** A light chain paired to each center chain, where the center has one. */
  pairedLight?: DomainType[];
  /** The two halves are meant to differ. */
  hetero: boolean;
  label: string;
}

export const CENTERS: Record<string, CenterSpec> = {
  heteroIgG: {
    chains: [
      ['VH', 'CH1', 'hinge', 'CH2', 'CH3'],
      ['VH', 'CH1', 'hinge', 'CH2', 'CH3'],
    ],
    pairedLight: ['VL', 'CL'],
    hetero: true,
    label: 'heterodimeric IgG',
  },
  IgG: {
    chains: [
      ['VH', 'CH1', 'hinge', 'CH2', 'CH3'],
      ['VH', 'CH1', 'hinge', 'CH2', 'CH3'],
    ],
    pairedLight: ['VL', 'CL'],
    hetero: false,
    label: 'IgG',
  },
  heteroFc: {
    chains: [
      ['hinge', 'CH2', 'CH3'],
      ['hinge', 'CH2', 'CH3'],
    ],
    hetero: true,
    label: 'heterodimeric Fc',
  },
  Fc: {
    chains: [
      ['hinge', 'CH2', 'CH3'],
      ['hinge', 'CH2', 'CH3'],
    ],
    hetero: false,
    label: 'Fc',
  },
  CH3: { chains: [['CH3'], ['CH3']], hetero: false, label: 'paired CH3' },
  Fab: { chains: [['VH', 'CH1']], pairedLight: ['VL', 'CL'], hetero: false, label: 'Fab' },
};

/**
 * Heterodimerization strategies written after the center, as `heteroFc(KiH)`.
 *
 * The paper names KiH and CPM and says the set is open, so an unrecognised
 * abbreviation is kept as a custom modification rather than rejected.
 */
export const CENTER_MUTATIONS: Record<string, [ModificationType, ModificationType]> = {
  KIH: ['knob', 'hole'],
  CPM: ['charge+', 'charge-'],
};

/** Written back out for a pair of modifications the center carries. */
export const MUTATION_NAMES: [ModificationType, ModificationType, string][] = [
  ['knob', 'hole', 'KiH'],
  ['charge+', 'charge-', 'CPM'],
];

/** Any dash the notation might be typed with, including the paper's en dash. */
export const DASH = /[-–—]/;

/** Module names longest-first, so a prefix never wins over a longer match. */
export const MODULE_NAMES = Object.keys(MODULES).sort((a, b) => b.length - a.length);
export const CENTER_NAMES = Object.keys(CENTERS).sort((a, b) => b.length - a.length);
