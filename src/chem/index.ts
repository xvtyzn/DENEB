import type { PayloadStructure } from '../model/types';

/**
 * Turning a compound into artwork the diagram can bond to.
 *
 * DENEB depicts no chemistry of its own; it draws the artwork you give it. This
 * is the piece in between. Hand it a molecule from a depiction toolkit and say
 * which atom the antibody is conjugated to, and it turns the molecule so that
 * atom faces the protein, renders it, and reports exactly where that atom and
 * the one behind it ended up. The diagram then bonds to a real atom, and the
 * linker and the compound read as one chain rather than two pieces meeting at
 * an angle.
 *
 * The toolkit is passed in rather than imported: the viewer keeps no chemistry
 * dependency, and you keep whichever version of OpenChemLib you already have.
 *
 * ```ts
 * import { Molecule } from 'openchemlib';
 * import { structureFromMolecule } from 'deneb/chem';
 *
 * const structure = structureFromMolecule(
 *   Molecule.fromSmiles('SC2CC(=O)N(CCCCCC(=O)N…)C2=O'),
 *   { attachAtom: 0, caption: 'mc-Val-Cit-PAB' },
 * );
 * ```
 */

/** The part of an OpenChemLib `Molecule` this needs. */
export interface DepictableMolecule {
  getAllAtoms(): number;
  getAtomX(atom: number): number;
  getAtomY(atom: number): number;
  setAtomX(atom: number, x: number): void;
  setAtomY(atom: number, y: number): void;
  getAllConnAtoms(atom: number): number;
  getConnAtom(atom: number, index: number): number;
  toSVG(width: number, height: number, id?: string, options?: Record<string, unknown>): string;
  /** OpenChemLib-compatible helpers used to account for the antibody bond. */
  getCompactCopy?(): DepictableMolecule;
  ensureHelperArrays?(level: number): void;
  getAtomicNo?(atom: number): number;
  addAtom?(atomicNo: number): number;
  addBond?(atom1: number, atom2: number): number;
  deleteAtom?(atom: number): void;
  setAtomCustomLabel?(atom: number, label: string | null): void;
  setAtomMarker?(atom: number, marked: boolean): void;
  inventCoordinates?(options?: {
    keepMarkedAtomCoordinates?: boolean;
    preferMarkedAtomCoordinates?: boolean;
  }): void;
}

export type CoordinateMode = 'invent' | 'preserve';
export type StereoAnnotations = 'full' | 'compact';
export type DepictionOrientation = 'bond' | 'drawing';

/** Fixed coordinates for a recognisable scaffold or an entire curated drawing. */
export interface CoordinateTemplate {
  /** Positions keyed by the atom indices of the caller's molecule. */
  positions: Readonly<Record<number, { x: number; y: number }>>;
  /** `keep` fixes them; `prefer` lets the inventor move them as a last resort. */
  strength?: 'keep' | 'prefer';
}

/** A linear atom path to replace with conventional bracket-and-count notation. */
export interface RepeatUnit {
  /** Ordered or unordered atom indices forming one unbranched path. */
  atoms: readonly number[];
  /** Text inside the brackets, e.g. `–O–CH₂–CH₂–`. */
  unit: string;
  /** Repeat count written after the closing bracket. */
  count: number | string;
  /** Minimum label size in the toolkit SVG. Default 9. */
  fontSize?: number;
  /** Distance between the two retained ends when preserving coordinates. */
  span?: number;
}

export interface DepictionOptions {
  /**
   * Index of the atom the antibody is bonded to, as numbered by the toolkit —
   * atom 0 for a SMILES written to start at the conjugated atom. Default 0.
   */
  attachAtom?: number;
  /**
   * Which of that atom's neighbours counts as the body of the molecule, when it
   * has more than one. Default: the first, which is the one the SMILES
   * continues into.
   */
  attachTo?: number;
  /**
   * Which side of the antibody the drawing will sit on. The molecule is turned
   * so it runs away from the protein either way; naming the side it will be
   * drawn on means it needs no further turning, and the toolkit lays the atom
   * labels out upright for the angle it ends up at. Default `'left'`.
   */
  side?: 'left' | 'right';
  /**
   * Longest side of the drawing, in diagram units. Default 150. The other side
   * follows from the shape of the molecule, so a compound that happens to be
   * laid out tall does not come out twice the height of the antibody.
   */
  size?: number;
  /** Caption under the drawing. */
  caption?: string;
  /** Size the toolkit renders at, before cropping. Larger is finer, not bigger. */
  renderSize?: { width: number; height: number };
  /** Passed through to the toolkit's own renderer, over these defaults. */
  depiction?: Record<string, unknown>;
  /**
   * Rebuild all 2D coordinates, or retain coordinates supplied by a Molfile,
   * editor or other curated source. Default `'invent'`.
   */
  coordinateMode?: CoordinateMode;
  /** Align the attachment bond, or retain the source drawing's orientation. */
  orientation?: DepictionOrientation;
  /**
   * Pin a scaffold to curated coordinates while the toolkit lays out the rest.
   * Atom indices refer to the molecule passed by the caller.
   */
  coordinateTemplate?: CoordinateTemplate;
  /**
   * Linear paths rendered as bracketed repeat units rather than every atom.
   * Useful for PEG, polysarcosine and other intentionally abbreviated chains.
   */
  repeatUnits?: readonly RepeatUnit[];
  /** Show `abs` and CIP labels, or retain wedges alone. Default `'full'`. */
  stereoAnnotations?: StereoAnnotations;
  /** Margin left around the drawing, in the toolkit's units. Default 6. */
  pad?: number;
}

const BASE_DEPICTION = {
  // The free-standing "this enantiomer" / "unknown chirality" caption is not
  // an atom annotation. Wedges, ESR groups and CIP labels are handled below.
  suppressChiralText: true,
  noStereoProblem: true,
  fontWeight: 'normal',
};

/** OpenChemLib's public helper level for adjacency tables. */
const HELPER_NEIGHBOURS = 1;

export class DepictionError extends Error {}

/**
 * Render a molecule into a `payload.structure`, turned so the conjugated atom
 * faces the antibody.
 */
export function structureFromMolecule(
  molecule: DepictableMolecule,
  options: DepictionOptions = {},
): PayloadStructure {
  const attachAtom = options.attachAtom ?? 0;
  if (attachAtom < 0 || attachAtom >= molecule.getAllAtoms()) {
    throw new DepictionError(`atom ${attachAtom} is not in this molecule`);
  }
  const prepared = prepareMolecule(molecule, attachAtom, options);
  const coordinates = snapshotCoordinates(prepared.molecule);
  if ((options.orientation ?? 'bond') === 'bond') {
    orient(
      prepared.molecule,
      prepared.anchorAtom,
      prepared.attachAtom,
      options.side ?? 'left',
    );
  }

  const canvas = options.renderSize ?? { width: 420, height: 290 };
  const id = `dn-depiction`;
  let full: string;
  try {
    full = prepared.molecule.toSVG(canvas.width, canvas.height, id, {
      ...BASE_DEPICTION,
      suppressESR: options.stereoAnnotations === 'compact',
      suppressCIPParity: options.stereoAnnotations === 'compact',
      ...options.depiction,
    });
  } finally {
    restoreCoordinates(prepared.molecule, coordinates);
  }
  // The toolkit's own <svg> wrapper is dropped: the diagram supplies one, sized
  // to the box it reserves and cropped to the drawing, so the bond meets the
  // molecule rather than a margin.
  let identifiedMarkup = full.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  identifiedMarkup = polishStereoLabels(identifiedMarkup, options.stereoAnnotations ?? 'full');
  identifiedMarkup = polishRepeatLabels(identifiedMarkup, options.repeatUnits ?? []);
  const box = tightBox(identifiedMarkup, options.pad ?? 6);

  const attach = atomPoint(identifiedMarkup, id, prepared.anchorAtom);
  const size = options.size ?? 150;
  const scale = size / Math.max(box.width, box.height);
  const structure: PayloadStructure = {
    // Hit-target IDs are only needed while locating atoms. Keeping the fixed
    // OpenChemLib namespace would duplicate IDs when a structure is repeated.
    svg: stripDepictionIds(identifiedMarkup, id),
    viewBox: `${round(box.x)} ${round(box.y)} ${round(box.width)} ${round(box.height)}`,
    width: Math.round(box.width * scale),
    height: Math.round(box.height * scale),
    attach,
  };
  if (prepared.attachAtom != null && (options.orientation ?? 'bond') === 'bond') {
    structure.attachFrom = atomPoint(identifiedMarkup, id, prepared.attachAtom);
  }
  if (options.caption) structure.caption = options.caption;
  return structure;
}

interface PreparedMolecule {
  molecule: DepictableMolecule;
  /** Where DENEB's bond ends. */
  anchorAtom: number;
  /** The real atom in the compound that the antibody bond enters. */
  attachAtom: number | null;
}

/** Work on a copy, then add display-only topology and arrange its coordinates. */
function prepareMolecule(
  source: DepictableMolecule,
  sourceAttachAtom: number,
  options: DepictionOptions,
): PreparedMolecule {
  const sourceInner = bodyNeighbour(source, sourceAttachAtom, options.attachTo);
  const copy = source.getCompactCopy?.();
  const molecule = copy ?? source;
  const atomMap = collapseRepeatUnits(
    molecule,
    source.getAllAtoms(),
    options.repeatUnits ?? [],
    Boolean(copy),
    sourceAttachAtom,
    options.coordinateMode === 'preserve',
  );
  const attachAtom = mappedAtom(atomMap, sourceAttachAtom, 'attachment');
  const inner = sourceInner == null ? null : mappedAtom(atomMap, sourceInner, 'attachment neighbour');
  const prepared = withExternalBond(molecule, attachAtom, inner, Boolean(copy));
  arrangeCoordinates(prepared.molecule, atomMap, options);
  return prepared;
}

function mappedAtom(atomMap: number[], atom: number, role: string): number {
  const mapped = atomMap[atom];
  if (mapped == null || mapped < 0) {
    throw new DepictionError(`${role} atom ${atom} was removed by a repeat abbreviation`);
  }
  return mapped;
}

/**
 * Give the renderer the external bond that is absent from an isolated reagent.
 *
 * OpenChemLib otherwise completes a terminal sulfur or nitrogen with hydrogen,
 * producing SH or NH2. An unlabeled carbon is used only as the remote endpoint
 * of the antibody bond; its line continues DENEB's stalk and makes the toolkit
 * reserve the correct valence and label clearance at the real attachment atom.
 */
function withExternalBond(
  molecule: DepictableMolecule,
  attachAtom: number,
  inner: number | null,
  mayMutate: boolean,
): PreparedMolecule {
  if (mayMutate && molecule.addAtom && molecule.addBond) {
    const anchorAtom = molecule.addAtom(6);
    molecule.addBond(anchorAtom, attachAtom);
    // Coordinate invention knows the new bond exists but not which branch the
    // caller considers the body. Put its remote endpoint opposite that branch
    // so `attachTo` retains its documented meaning for multi-connected atoms.
    if (inner != null) {
      const dx = molecule.getAtomX(attachAtom) - molecule.getAtomX(inner);
      const dy = molecule.getAtomY(attachAtom) - molecule.getAtomY(inner);
      const length = Math.hypot(dx, dy) || 1;
      if (Number.isFinite(dx) && Number.isFinite(dy)) {
        molecule.setAtomX(anchorAtom, molecule.getAtomX(attachAtom) + dx / length);
        molecule.setAtomY(anchorAtom, molecule.getAtomY(attachAtom) + dy / length);
      }
    } else {
      molecule.setAtomX(anchorAtom, molecule.getAtomX(attachAtom) - 1);
      molecule.setAtomY(anchorAtom, molecule.getAtomY(attachAtom));
    }
    return { molecule, anchorAtom, attachAtom };
  }
  return { molecule, anchorAtom: attachAtom, attachAtom: inner };
}

function arrangeCoordinates(
  molecule: DepictableMolecule,
  atomMap: number[],
  options: DepictionOptions,
): void {
  const template = options.coordinateTemplate;
  if (template) {
    if (!molecule.inventCoordinates || !molecule.setAtomMarker) {
      throw new DepictionError('coordinateTemplate requires OpenChemLib-compatible coordinate helpers');
    }
    const marked: number[] = [];
    for (const [rawAtom, point] of Object.entries(template.positions)) {
      const sourceAtom = Number(rawAtom);
      const atom = mappedAtom(atomMap, sourceAtom, 'coordinate template');
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new DepictionError(`coordinate template for atom ${sourceAtom} is not finite`);
      }
      molecule.setAtomX(atom, point.x);
      molecule.setAtomY(atom, point.y);
      molecule.setAtomMarker(atom, true);
      marked.push(atom);
    }
    if (marked.length === 0) throw new DepictionError('coordinateTemplate has no positions');
    try {
      molecule.inventCoordinates({
        keepMarkedAtomCoordinates: template.strength !== 'prefer',
        preferMarkedAtomCoordinates: template.strength === 'prefer',
      });
    } finally {
      for (const atom of marked) molecule.setAtomMarker(atom, false);
    }
    return;
  }
  if ((options.coordinateMode ?? 'invent') === 'invent') {
    molecule.inventCoordinates?.();
  }
}

/** Collapse caller-selected linear paths into custom-labelled pseudo atoms. */
function collapseRepeatUnits(
  molecule: DepictableMolecule,
  originalAtomCount: number,
  repeats: readonly RepeatUnit[],
  mayMutate: boolean,
  sourceAttachAtom: number,
  preserveCoordinates: boolean,
): number[] {
  const atomMap = Array.from({ length: originalAtomCount }, (_, atom) => atom);
  if (repeats.length === 0) return atomMap;
  if (
    !mayMutate ||
    !molecule.ensureHelperArrays ||
    !molecule.getAtomicNo ||
    !molecule.deleteAtom ||
    !molecule.addAtom ||
    !molecule.addBond ||
    !molecule.setAtomCustomLabel
  ) {
    throw new DepictionError('repeatUnits requires an OpenChemLib-compatible mutable copy');
  }

  const claimed = new Set<number>();
  for (const repeat of repeats) {
    // OpenChemLib compact copies deliberately omit their cached adjacency
    // tables; mutations also invalidate them between multiple abbreviations.
    molecule.ensureHelperArrays(HELPER_NEIGHBOURS);
    if (repeat.atoms.length < 2) throw new DepictionError('a repeat abbreviation needs at least two atoms');
    if (typeof repeat.count === 'number' && (!Number.isFinite(repeat.count) || repeat.count <= 0)) {
      throw new DepictionError(`repeat count must be positive; got ${repeat.count}`);
    }
    if (String(repeat.count).trim() === '') throw new DepictionError('repeat count must not be empty');
    if (repeat.unit.trim() === '') throw new DepictionError('repeat unit must not be empty');
    if (
      repeat.fontSize != null &&
      (!Number.isFinite(repeat.fontSize) || repeat.fontSize <= 0)
    ) {
      throw new DepictionError(`repeat font size must be positive; got ${repeat.fontSize}`);
    }
    if (repeat.span != null && (!Number.isFinite(repeat.span) || repeat.span <= 0)) {
      throw new DepictionError(`repeat span must be positive; got ${repeat.span}`);
    }
    const sourceAtoms = [...new Set(repeat.atoms)];
    if (sourceAtoms.length !== repeat.atoms.length) {
      throw new DepictionError('a repeat abbreviation contains the same atom twice');
    }
    for (const atom of sourceAtoms) {
      if (!Number.isInteger(atom) || atom < 0 || atom >= originalAtomCount) {
        throw new DepictionError(`repeat atom ${atom} is not in this molecule`);
      }
      if (claimed.has(atom)) {
        throw new DepictionError(`repeat atom ${atom} belongs to two abbreviations`);
      }
      claimed.add(atom);
    }

    const atoms = sourceAtoms.map((atom) => mappedAtom(atomMap, atom, 'repeat'));
    const inside = new Set(atoms);
    const outside: number[] = [];
    let internalEdges = 0;
    for (const atom of atoms) {
      let insideDegree = 0;
      for (let i = 0; i < molecule.getAllConnAtoms(atom); i++) {
        const neighbour = molecule.getConnAtom(atom, i);
        if (molecule.getAtomicNo(neighbour) === 1) continue;
        if (inside.has(neighbour)) {
          insideDegree++;
          if (atom < neighbour) internalEdges++;
        } else {
          outside.push(neighbour);
        }
      }
      if (insideDegree > 2) throw new DepictionError('repeat atoms must form an unbranched path');
    }
    if (internalEdges !== atoms.length - 1 || outside.length !== 2 || outside[0] === outside[1]) {
      throw new DepictionError('repeat atoms must form one path with two external bonds');
    }

    const deleted = [...atoms].sort((a, b) => b - a);
    for (const atom of deleted) molecule.deleteAtom(atom);
    const ascending = [...deleted].sort((a, b) => a - b);
    const shifted = (atom: number): number =>
      atom - ascending.filter((removed) => removed < atom).length;
    for (let sourceAtom = 0; sourceAtom < atomMap.length; sourceAtom++) {
      const current = atomMap[sourceAtom]!;
      if (inside.has(current)) atomMap[sourceAtom] = -1;
      else atomMap[sourceAtom] = shifted(current);
    }

    const left = shifted(outside[0]!);
    const right = shifted(outside[1]!);
    if (preserveCoordinates) {
      const attachment = mappedAtom(atomMap, sourceAttachAtom, 'attachment');
      closeRepeatGap(molecule, left, right, attachment, repeat.span);
    }
    const pseudo = molecule.addAtom(6);
    molecule.setAtomX(pseudo, (molecule.getAtomX(left) + molecule.getAtomX(right)) / 2);
    molecule.setAtomY(pseudo, (molecule.getAtomY(left) + molecule.getAtomY(right)) / 2);
    molecule.setAtomCustomLabel(pseudo, repeatLabel(repeat));
    molecule.addBond(left, pseudo);
    molecule.addBond(pseudo, right);
  }
  return atomMap;
}

/** Close the space left by a collapsed path without redrawing either retained fragment. */
function closeRepeatGap(
  molecule: DepictableMolecule,
  left: number,
  right: number,
  attachment: number,
  requestedSpan?: number,
): void {
  molecule.ensureHelperArrays?.(HELPER_NEIGHBOURS);
  const leftComponent = connectedAtoms(molecule, left);
  const rightComponent = connectedAtoms(molecule, right);
  if (leftComponent.has(right)) return;

  let fixed = left;
  let moved = right;
  let movingAtoms = rightComponent;
  if (rightComponent.has(attachment)) {
    fixed = right;
    moved = left;
    movingAtoms = leftComponent;
  }

  const dx = molecule.getAtomX(moved) - molecule.getAtomX(fixed);
  const dy = molecule.getAtomY(moved) - molecule.getAtomY(fixed);
  const distance = Math.hypot(dx, dy);
  const unitX = distance === 0 ? 1 : dx / distance;
  const unitY = distance === 0 ? 0 : dy / distance;
  const span = requestedSpan ?? typicalBondLength(molecule) * 4;
  const shiftX = molecule.getAtomX(fixed) + unitX * span - molecule.getAtomX(moved);
  const shiftY = molecule.getAtomY(fixed) + unitY * span - molecule.getAtomY(moved);
  for (const atom of movingAtoms) {
    molecule.setAtomX(atom, molecule.getAtomX(atom) + shiftX);
    molecule.setAtomY(atom, molecule.getAtomY(atom) + shiftY);
  }
}

function connectedAtoms(molecule: DepictableMolecule, start: number): Set<number> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const atom = queue.pop()!;
    for (let i = 0; i < molecule.getAllConnAtoms(atom); i++) {
      const neighbour = molecule.getConnAtom(atom, i);
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      queue.push(neighbour);
    }
  }
  return seen;
}

function typicalBondLength(molecule: DepictableMolecule): number {
  const lengths: number[] = [];
  for (let atom = 0; atom < molecule.getAllAtoms(); atom++) {
    for (let i = 0; i < molecule.getAllConnAtoms(atom); i++) {
      const neighbour = molecule.getConnAtom(atom, i);
      if (neighbour <= atom) continue;
      const length = Math.hypot(
        molecule.getAtomX(neighbour) - molecule.getAtomX(atom),
        molecule.getAtomY(neighbour) - molecule.getAtomY(atom),
      );
      if (Number.isFinite(length) && length > 0) lengths.push(length);
    }
  }
  if (lengths.length === 0) return 1;
  lengths.sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)]!;
}

function repeatLabel(repeat: RepeatUnit): string {
  return `[${repeat.unit}]${subscript(String(repeat.count))}`;
}

function subscript(value: string): string {
  const glyphs: Record<string, string> = {
    '0': '₀',
    '1': '₁',
    '2': '₂',
    '3': '₃',
    '4': '₄',
    '5': '₅',
    '6': '₆',
    '7': '₇',
    '8': '₈',
    '9': '₉',
    n: 'ₙ',
  };
  return [...value].map((character) => glyphs[character] ?? character).join('');
}

/** Keep enhanced stereo legible without repeating one global `abs` group at every centre. */
function polishStereoLabels(markup: string, mode: StereoAnnotations): string {
  if (mode === 'compact') return markup;
  let sawAbsoluteGroup = false;
  return markup.replace(
    /^[ \t]*<text\b[^>]*\bfill="rgb\(160,0,0\)"[^>]*>([^<]*)<\/text>/gm,
    (element, label: string) => {
      if (label === 'abs') {
        if (sawAbsoluteGroup) return '';
        sawAbsoluteGroup = true;
      }
      return addSvgClass(element, 'dn-stereo-annotation');
    },
  );
}

/** Give conventional repeat notation enough clearance to remain readable after scaling. */
function polishRepeatLabels(markup: string, repeats: readonly RepeatUnit[]): string {
  if (repeats.length === 0) return markup;
  const fontSizes = new Map(
    repeats.map((repeat) => [repeatLabel(repeat), repeat.fontSize ?? 9]),
  );
  return markup.replace(/<text\b[^>]*>([^<]*)<\/text>/g, (element, label: string) => {
    const fontSize = fontSizes.get(label);
    if (fontSize == null) return element;
    let polished = setSvgAttribute(element, 'font-size', String(fontSize));
    polished = setSvgAttribute(polished, 'stroke', '#fff');
    polished = setSvgAttribute(polished, 'stroke-width', '2.4');
    polished = setSvgAttribute(polished, 'paint-order', 'stroke fill');
    return addSvgClass(polished, 'dn-repeat-label');
  });
}

function setSvgAttribute(element: string, name: string, value: string): string {
  const attribute = new RegExp(`\\s${escapeRe(name)}="[^"]*"`);
  if (attribute.test(element)) return element.replace(attribute, ` ${name}="${value}"`);
  return element.replace('<text', `<text ${name}="${value}"`);
}

function addSvgClass(element: string, className: string): string {
  const existing = /\sclass="([^"]*)"/.exec(element);
  if (existing) {
    const classes = new Set(existing[1]!.split(/\s+/).filter(Boolean));
    classes.add(className);
    return element.replace(existing[0], ` class="${[...classes].join(' ')}"`);
  }
  return element.replace('<text', `<text class="${className}"`);
}

function snapshotCoordinates(molecule: DepictableMolecule): Array<{ x: number; y: number }> {
  return Array.from({ length: molecule.getAllAtoms() }, (_, atom) => ({
    x: molecule.getAtomX(atom),
    y: molecule.getAtomY(atom),
  }));
}

function restoreCoordinates(
  molecule: DepictableMolecule,
  coordinates: Array<{ x: number; y: number }>,
): void {
  coordinates.forEach(({ x, y }, atom) => {
    molecule.setAtomX(atom, x);
    molecule.setAtomY(atom, y);
  });
}

function stripDepictionIds(markup: string, id: string): string {
  const pattern = new RegExp(`\\s+id="${escapeRe(id)}:[^"]*"`, 'g');
  return markup.replace(pattern, '');
}

/** The neighbour that stands for the rest of the molecule. */
function bodyNeighbour(
  molecule: DepictableMolecule,
  atom: number,
  requested?: number,
): number | null {
  const count = molecule.getAllConnAtoms(atom);
  if (count === 0) return null;
  if (requested == null) return molecule.getConnAtom(atom, 0);
  for (let i = 0; i < count; i++) {
    if (molecule.getConnAtom(atom, i) === requested) return requested;
  }
  throw new DepictionError(`atom ${requested} is not bonded to atom ${attachLabel(atom)}`);
}

function attachLabel(atom: number): string {
  return String(atom);
}

/**
 * Turn the molecule about its conjugated atom until the bond into the body of
 * the molecule lies along the x axis, with the body away from the antibody.
 *
 * That is the orientation a conjugation scheme is drawn in — protein, bond,
 * then the compound running away from it — and doing it here, on coordinates,
 * means the toolkit lays the atom labels out upright for the final angle rather
 * than the diagram having to correct them afterwards.
 */
function orient(
  molecule: DepictableMolecule,
  atom: number,
  inner: number | null,
  side: 'left' | 'right',
): void {
  if (inner == null) return;
  const ax = molecule.getAtomX(atom);
  const ay = molecule.getAtomY(atom);
  const dx = ax - molecule.getAtomX(inner);
  const dy = ay - molecule.getAtomY(inner);
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  // Rotate so the bond out to the conjugated atom points at the antibody: +x
  // when the drawing sits to its left, -x when it sits to its right.
  const facing = side === 'right' ? -1 : 1;
  const cos = (facing * dx) / length;
  const sin = (-facing * dy) / length;
  for (let i = 0; i < molecule.getAllAtoms(); i++) {
    const x = molecule.getAtomX(i) - ax;
    const y = molecule.getAtomY(i) - ay;
    molecule.setAtomX(i, ax + x * cos - y * sin);
    molecule.setAtomY(i, ay + x * sin + y * cos);
  }
}

/**
 * Where an atom ended up in the rendered drawing.
 *
 * OpenChemLib marks every atom with an invisible hit-target circle carrying its
 * index, so the position is read straight off rather than inferred from the
 * labels — which only exist for hetero atoms, and never for the carbon a linker
 * is often conjugated through.
 */
function atomPoint(markup: string, id: string, atom: number): { x: number; y: number } {
  const pattern = new RegExp(
    `<circle[^>]*\\bid="${escapeRe(id)}:Atom:${atom}"[^>]*>`,
    'i',
  );
  const tag = pattern.exec(markup)?.[0];
  const cx = tag ? /\bcx="([-\d.]+)"/.exec(tag)?.[1] : undefined;
  const cy = tag ? /\bcy="([-\d.]+)"/.exec(tag)?.[1] : undefined;
  if (cx == null || cy == null) {
    throw new DepictionError(
      `the depiction carries no position for atom ${atom}; ` +
        `this needs a toolkit that marks atoms in its SVG output`,
    );
  }
  return { x: Number(cx), y: Number(cy) };
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Bounding box of everything actually drawn, so the artwork has no dead margin. */
function tightBox(
  markup: string,
  pad: number,
): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  const push = (x: number, y: number): void => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  };
  for (const m of markup.matchAll(
    /x1="([-\d.]+)"\s*y1="([-\d.]+)"\s*x2="([-\d.]+)"\s*y2="([-\d.]+)"/g,
  )) {
    push(Number(m[1]), Number(m[2]));
    push(Number(m[3]), Number(m[4]));
  }
  for (const m of markup.matchAll(/points="([^"]+)"/g)) {
    const nums = (m[1] ?? '').trim().split(/[\s,]+/).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) push(nums[i]!, nums[i + 1]!);
  }
  for (const m of markup.matchAll(/<text[^>]*\sx="([-\d.]+)"[^>]*\sy="([-\d.]+)"/g)) {
    push(Number(m[1]), Number(m[2]));
  }
  if (xs.length === 0) return { x: 0, y: 0, width: 420, height: 290 };
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) - x + pad, height: Math.max(...ys) - y + pad };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
