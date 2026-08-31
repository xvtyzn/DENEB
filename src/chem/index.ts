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
  addAtom?(atomicNo: number): number;
  addBond?(atom1: number, atom2: number): number;
  inventCoordinates?(): void;
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
  /** Margin left around the drawing, in the toolkit's units. Default 6. */
  pad?: number;
}

const DEFAULT_DEPICTION = {
  // The wedges stay -- they are the stereochemistry. What goes is the toolkit's
  // commentary on it: the "abs" enhanced-stereo marker, the R/S labels and the
  // "this enantiomer" caption, none of which belong on a schematic.
  suppressChiralText: true,
  suppressESR: true,
  suppressCIPParity: true,
  noStereoProblem: true,
  fontWeight: 'normal',
};

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
  const inner = bodyNeighbour(molecule, attachAtom, options.attachTo);
  const prepared = withExternalBond(molecule, attachAtom, inner);
  const coordinates = snapshotCoordinates(prepared.molecule);
  orient(
    prepared.molecule,
    prepared.anchorAtom,
    prepared.attachAtom,
    options.side ?? 'left',
  );

  const canvas = options.renderSize ?? { width: 420, height: 290 };
  const id = `dn-depiction`;
  let full: string;
  try {
    full = prepared.molecule.toSVG(canvas.width, canvas.height, id, {
      ...DEFAULT_DEPICTION,
      ...options.depiction,
    });
  } finally {
    restoreCoordinates(prepared.molecule, coordinates);
  }
  // The toolkit's own <svg> wrapper is dropped: the diagram supplies one, sized
  // to the box it reserves and cropped to the drawing, so the bond meets the
  // molecule rather than a margin.
  const identifiedMarkup = full.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
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
  if (prepared.attachAtom != null) {
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
): PreparedMolecule {
  const copy = molecule.getCompactCopy?.();
  if (copy?.addAtom && copy.addBond && copy.inventCoordinates) {
    const anchorAtom = copy.addAtom(6);
    copy.addBond(anchorAtom, attachAtom);
    copy.inventCoordinates();
    // Coordinate invention knows the new bond exists but not which branch the
    // caller considers the body. Put its remote endpoint opposite that branch
    // so `attachTo` retains its documented meaning for multi-connected atoms.
    if (inner != null) {
      const dx = copy.getAtomX(attachAtom) - copy.getAtomX(inner);
      const dy = copy.getAtomY(attachAtom) - copy.getAtomY(inner);
      const bodyLength = Math.hypot(dx, dy);
      const anchorLength =
        Math.hypot(
          copy.getAtomX(anchorAtom) - copy.getAtomX(attachAtom),
          copy.getAtomY(anchorAtom) - copy.getAtomY(attachAtom),
        ) || bodyLength;
      if (bodyLength > 0 && anchorLength > 0) {
        copy.setAtomX(anchorAtom, copy.getAtomX(attachAtom) + (dx / bodyLength) * anchorLength);
        copy.setAtomY(anchorAtom, copy.getAtomY(attachAtom) + (dy / bodyLength) * anchorLength);
      }
    }
    return { molecule: copy, anchorAtom, attachAtom };
  }
  return { molecule, anchorAtom: attachAtom, attachAtom: inner };
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
