import type { DomainType } from '../model/types';

/**
 * Human constant regions, used to name the part of a chain that a V-region
 * caller leaves unannotated.
 *
 * GENERATED — do not edit by hand. Sequences and the CH1 / hinge / CH2 / CH3
 * boundaries come from the UniProt entries named below; regenerate with
 * `node scripts/fetch-constant-regions.mjs`. Fetched 2026-08-29.
 *
 * Each sequence is the secreted form: it stops at the end of the last constant
 * domain, so the membrane anchor of the heavy chains is not included.
 */
export interface ConstantSegment {
  type: DomainType;
  /** 1-based, inclusive, within `sequence`. */
  start: number;
  end: number;
}

export interface ConstantReference {
  isotype: string;
  kind: 'heavy' | 'light';
  accession: string;
  uniProtId: string;
  sequence: string;
  segments: ConstantSegment[];
}

export const CONSTANT_REFERENCES: readonly ConstantReference[] = [
  {
    isotype: 'IgG1',
    kind: 'heavy',
    accession: 'P01857',
    uniProtId: 'IGHG1_HUMAN',
    sequence:
      'ASTKGPSVFPLAPSSKSTSGGTAALGCLVKDYFPEPVTVSWNSGALTSGVHTFPAVLQSSGLYSLSSVVTVPSSSLGTQTYICNVNHKPSNTKVDKKVEPKSCDKTHTCPPCPAPELLGGPSVFLFPPKPKDTLMISRTPEVTCVVVDVSHEDPEVKFNWYVDGVEVHNAKTKPREEQYNSTYRVVSVLTVLHQDWLNGKEYKCKVSNKALPAPIEKTISKAKGQPREPQVYTLPPSRDELTKNQVSLTCLVKGFYPSDIAVEWESNGQPENNYKTTPPVLDSDGSFFLYSKLTVDKSRWQQGNVFSCSVMHEALHNHYTQKSLSLSP',
    segments: [
      { type: 'CH1', start: 1, end: 98 },
      { type: 'hinge', start: 99, end: 114 },
      { type: 'CH2', start: 115, end: 224 },
      { type: 'CH3', start: 225, end: 328 },
    ],
  },
  {
    isotype: 'IgG2',
    kind: 'heavy',
    accession: 'P01859',
    uniProtId: 'IGHG2_HUMAN',
    sequence:
      'ASTKGPSVFPLAPCSRSTSESTAALGCLVKDYFPEPVTVSWNSGALTSGVHTFPAVLQSSGLYSLSSVVTVPSSNFGTQTYTCNVDHKPSNTKVDKTVERKCCVECPPCPAPPVAGPSVFLFPPKPKDTLMISRTPEVTCVVVDVSHEDPEVQFNWYVDGVEVHNAKTKPREEQFNSTFRVVSVLTVVHQDWLNGKEYKCKVSNKGLPAPIEKTISKTKGQPREPQVYTLPPSREEMTKNQVSLTCLVKGFYPSDISVEWESNGQPENNYKTTPPMLDSDGSFFLYSKLTVDKSRWQQGNVFSCSVMHEALHNHYTQKSLSLSP',
    segments: [
      { type: 'CH1', start: 1, end: 98 },
      { type: 'hinge', start: 99, end: 109 },
      { type: 'CH2', start: 110, end: 218 },
      { type: 'CH3', start: 219, end: 324 },
    ],
  },
  {
    isotype: 'IgG4',
    kind: 'heavy',
    accession: 'P01861',
    uniProtId: 'IGHG4_HUMAN',
    sequence:
      'ASTKGPSVFPLAPCSRSTSESTAALGCLVKDYFPEPVTVSWNSGALTSGVHTFPAVLQSSGLYSLSSVVTVPSSSLGTKTYTCNVDHKPSNTKVDKRVESKYGPPCPSCPAPEFLGGPSVFLFPPKPKDTLMISRTPEVTCVVVDVSQEDPEVQFNWYVDGVEVHNAKTKPREEQFNSTYRVVSVLTVLHQDWLNGKEYKCKVSNKGLPSSIEKTISKAKGQPREPQVYTLPPSQEEMTKNQVSLTCLVKGFYPSDIAVEWESNGQPENNYKTTPPVLDSDGSFFLYSRLTVDKSRWQEGNVFSCSVMHEALHNHYTQKSLSLSL',
    segments: [
      { type: 'CH1', start: 1, end: 98 },
      { type: 'hinge', start: 99, end: 111 },
      { type: 'CH2', start: 112, end: 220 },
      { type: 'CH3', start: 221, end: 325 },
    ],
  },
  {
    isotype: 'kappa',
    kind: 'light',
    accession: 'P01834',
    uniProtId: 'IGKC_HUMAN',
    sequence:
      'RTVAAPSVFIFPPSDEQLKSGTASVVCLLNNFYPREAKVQWKVDNALQSGNSQESVTEQDSKDSTYSLSSTLTLSKADYEKHKVYACEVTHQGLSSPVTKSFNRGEC',
    segments: [
      { type: 'CL', start: 1, end: 107 },
    ],
  },
  {
    isotype: 'lambda',
    kind: 'light',
    accession: 'P0CG04',
    uniProtId: 'IGLC1_HUMAN',
    sequence:
      'GQPKANPTVTLFPPSSEELQANKATLVCLISDFYPGAVTVAWKADGSPVKAGVETTKPSKQSNNKYAASSYLSLTPEQWKSHRSYSCQVTHEGSTVEKTVAPTECS',
    segments: [
      { type: 'CL', start: 1, end: 106 },
    ],
  },
];
