/**
 * Core data model.
 *
 * A `Construct` is the declarative description of one antibody molecule: a list
 * of polypeptide chains, each an ordered N->C list of domains, plus optional
 * explicit links between domains and metadata about the targets ("specificities")
 * the molecule binds.
 *
 * The model is deliberately close to what a domain-annotation pipeline (HMM /
 * ML) would emit: every domain may carry the residue range it occupies in its
 * chain's sequence, so annotations can round-trip without loss.
 */

/** Immunoglobulin and non-Ig building blocks the renderer knows how to draw. */
export type DomainType =
  // variable domains
  | 'VH'
  | 'VL'
  | 'VHH'
  // constant domains
  | 'CH1'
  | 'CL'
  | 'hinge'
  | 'CH2'
  | 'CH3'
  | 'CH4'
  | 'CH5'
  // composite shorthands, expanded by normalize()
  | 'scFv'
  | 'Fab'
  // T-cell receptor domains (ImmTAC and friends)
  | 'TCRa'
  | 'TCRb'
  // connectors and non-Ig partners
  | 'linker'
  | 'albumin'
  | 'cytokine'
  | 'toxin'
  | 'payload'
  | 'ECD'
  | 'custom';

export type ModificationType =
  // heavy-chain heterodimerization
  | 'knob'
  | 'hole'
  | 'charge+'
  | 'charge-'
  | 'seed'
  | 'ew-rvt'
  | 'ha-tf'
  | 'duobody'
  // correct chain pairing
  | 'crossmab-fab'
  | 'crossmab-ch1cl'
  | 'crossmab-vhvl'
  | 'orthogonal-fab'
  | 'disulfide'
  // effector function
  | 'lala'
  | 'lala-pg'
  | 'aglycosyl'
  | 'glycan'
  | 'afucosyl'
  | 'adcc-enhanced'
  | 's228p'
  // half-life
  | 'yte'
  | 'ls'
  // conjugation
  | 'drug'
  | 'thiomab'
  | 'peg'
  | 'tag'
  | 'custom';

/** How a modification is drawn on or beside its domain. */
export type MarkerShape =
  | 'knob'
  | 'notch'
  | 'dot'
  | 'star'
  | 'bar'
  | 'plus'
  | 'minus'
  | 'cross'
  | 'ss'
  | 'thiol'
  | 'glycan'
  | 'squiggle'
  | 'tab'
  | 'drug';

/** Outline used for a conjugated small molecule. */
export type PayloadShape = 'hexagon' | 'circle' | 'triangle' | 'diamond' | 'square' | 'star';

/**
 * A depiction of a compound's chemical structure.
 *
 * Rendering a structure from a SMILES string needs a chemistry toolkit, which
 * this library deliberately does not carry. Generate the artwork with whatever
 * you already use — RDKit, OpenChemLib, Ketcher, ChemDraw — and hand the result
 * over here.
 */
export interface PayloadStructure {
  /**
   * Inline SVG markup for the depiction, placed verbatim inside a nested
   * `<svg>`. It is not sanitised, so pass only markup you trust; `href` is the
   * safer route for anything user-supplied.
   */
  svg?: string;
  /** An image URL or data URI — including a `data:image/svg+xml;base64,…` one. */
  href?: string;
  /** Coordinate system of the supplied artwork, e.g. `'0 0 300 200'`. */
  viewBox?: string;
  /** Drawn size in diagram units. Defaults to 76 x 56. */
  width?: number;
  height?: number;
  /** Caption under the drawing. Defaults to the payload's name. */
  caption?: string;
  /**
   * The atom the antibody is conjugated to, in the artwork's own coordinates —
   * the same system as `viewBox`, so a depiction toolkit's atom position can be
   * passed straight through. Without a `viewBox` it is read as a fraction of the
   * drawn box instead. The artwork is positioned so this point lands exactly on
   * the end of the bond coming off the antibody, which is what makes the
   * drawing say *which* atom of the linker carries the conjugation rather than
   * merely gesturing at the molecule. Defaults to the edge nearest the antibody.
   */
  attach?: { x: number; y: number };
  /**
   * Allow the artwork to be flipped horizontally when its attachment point would
   * otherwise face away from the antibody. Off by default: a mirrored depiction
   * reverses the reading order of multi-glyph labels, and inverts wedge
   * stereochemistry. Drawing the structure at one site only — which is the
   * default — avoids needing it at all.
   */
  mirror?: boolean;
}

/**
 * A chemical entity conjugated to the antibody — the warhead of an ADC, a PEG
 * chain, a radionuclide chelator. Everything here is drawn: the payload glyph
 * hangs off the domain on a stalk standing for the chemical linker, and the
 * details land in the legend.
 */
export interface Payload {
  /** Compound name, e.g. 'MMAE'. Drawn beside the glyph. */
  name: string;
  /** Chemical linker, e.g. 'vc-PAB', 'SMCC'. */
  linker?: string;
  /** Drug-to-antibody ratio for the whole molecule. */
  dar?: number;
  /** Conjugation chemistry or site, e.g. 'interchain cysteine', 'THIOMAB S239C'. */
  site?: string;
  /**
   * The atom or group written on the bond between the antibody and the linker —
   * `'S'` for a cysteine thiol, `'NH'` for a lysine amide — the way ADC schemes
   * write `mAb—S—linker—payload`. Derived from `site` when omitted; pass `''`
   * to leave the bond bare.
   */
  attachment?: string;
  /** Whether the linker releases the payload inside the cell. */
  cleavable?: boolean;
  /** Default 'hexagon', the usual mark for a small molecule. */
  shape?: PayloadShape;
  color?: string;
  /** Copies drawn on this domain. Default 1. */
  count?: number;
  /** Chemical structure, drawn when `showStructures` asks for it. */
  structure?: PayloadStructure;
}

export interface Modification {
  type: ModificationType;
  /** Legend text. Defaults to the catalog entry for `type`. */
  label?: string;
  /** Residue changes in the usual EU/Kabat shorthand, e.g. ['L234A','L235A']. */
  residues?: string[];
  /** Absolute 1-based positions in the owning chain's sequence. */
  positions?: number[];
  /** Overrides the catalog's default marker shape. */
  marker?: MarkerShape;
  /** Overrides the catalog's default marker colour. */
  color?: string;
  /** For `type: 'drug'` (and any other conjugation) — what is attached. */
  payload?: Payload;
}

/**
 * A stretch inside a domain — a CDR or a framework region.
 *
 * Numbering schemes disagree about where the loops start and stop, so the
 * scheme travels with the range rather than being assumed.
 */
export interface Region {
  /** `'CDR1'`, `'CDR2'`, `'CDR3'`, `'FR1'` … */
  name: string;
  /** 1-based inclusive, in the chain's sequence, like `Domain.start`. */
  start: number;
  end: number;
  scheme?: 'imgt' | 'kabat' | 'chothia' | 'north' | (string & {});
}

export interface Domain {
  /** Stable id. Auto-assigned as `${chainId}:${index}` when omitted. */
  id?: string;
  type: DomainType;
  /** Display text. Defaults to the catalog label for `type`. */
  label?: string;
  /** Target this domain contributes to binding; drives colour. */
  specificity?: string;
  /** 1-based inclusive residue range within the chain's sequence. */
  start?: number;
  end?: number;
  /** e.g. 'IgG1' | 'IgG4' | 'kappa' | 'lambda'. Informational. */
  isotype?: string;
  /** CDRs and frameworks, when a numbering tool supplied them. */
  regions?: Region[];
  /**
   * Anything worth keeping that has no field of its own — the free-text
   * comments a notation carries, for instance. Shown in the domain's tooltip.
   */
  notes?: string[];
  modifications?: Modification[];
}

/** `"HC1:CH3"` (chain id + domain type) or a `Domain.id`. */
export type DomainRef = string;

export type LinkType = 'pair' | 'disulfide' | 'dimer' | 'linker';

export interface Link {
  type: LinkType;
  a: DomainRef;
  b: DomainRef;
  /** How many bonds, where that is known — two hinge disulfides, say. */
  count?: number;
}

export type ChainKind = 'heavy' | 'light' | 'single' | 'other';

export interface Chain {
  id: string;
  /** Inferred from the domain composition when omitted. */
  kind?: ChainKind;
  sequence?: string;
  domains: Domain[];
  /**
   * Number of identical polypeptides. `copies: 2` on a single heavy chain is the
   * shorthand for a symmetric homodimer; the extra copies are materialised
   * during normalization so the layout sees real chains.
   */
  copies?: number;
}

export interface SpecificityDecl {
  name: string;
  /** Explicit colour; otherwise assigned from the palette by first appearance. */
  color?: string;
  label?: string;
}

export type SkeletonKind = 'y' | 'row';

export interface LayoutHints {
  /** Overrides skeleton inference. */
  skeleton?: SkeletonKind;
  /** Half-angle between the two Fab arms, in degrees. Default 32. */
  armAngle?: number;
  /** For `y`: whether arms splay apart or stand upright side by side. */
  armMode?: 'splayed' | 'crossed';
}

export interface Construct {
  name?: string;
  chains: Chain[];
  links?: Link[];
  specificities?: SpecificityDecl[];
  layout?: LayoutHints;
}

// ---------------------------------------------------------------------------
// Normalized form
// ---------------------------------------------------------------------------

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface Diagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  /** Chain or domain the diagnostic refers to, when applicable. */
  ref?: string;
}

/** A domain after normalization: every optional field the layout needs is filled. */
export interface NDomain {
  id: string;
  chainId: string;
  /** Index within the chain, after shorthand expansion. */
  index: number;
  type: DomainType;
  label: string;
  specificity?: string;
  start?: number;
  end?: number;
  isotype?: string;
  regions?: Region[];
  notes?: string[];
  modifications: Modification[];
  /** Domain id this one is non-covalently paired with (VH<->VL, CH1<->CL, CH3<->CH3'). */
  partner?: string;
}

export interface NChain {
  id: string;
  kind: ChainKind;
  sequence?: string;
  domains: NDomain[];
  /** Set when this chain was materialised from another (homodimer / common LC). */
  cloneOf?: string;
  /** Heavy chain this light chain associates with, when known unambiguously. */
  partnerChain?: string;
}

export interface NormalizedConstruct {
  name?: string;
  chains: NChain[];
  links: Link[];
  /** All specificities in first-appearance order, with resolved colours. */
  specificities: Required<SpecificityDecl>[];
  layout: Required<LayoutHints>;
  /** Fast lookup by domain id. */
  byId: Map<string, NDomain>;
  diagnostics: Diagnostic[];
}
