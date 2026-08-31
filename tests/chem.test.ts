import { describe, expect, it } from 'vitest';
import { Molecule } from 'openchemlib';
import { DepictionError, structureFromMolecule } from '../src/chem/index';
import type { DepictableMolecule } from '../src/chem/index';

/** The SMILES starts at the atom the antibody is conjugated to. */
const SMCC = 'NC(=O)C1CCC(CN2C(=O)C=CC2=O)CC1';
const molecule = (smiles = SMCC): DepictableMolecule =>
  Molecule.fromSmiles(smiles) as unknown as DepictableMolecule;

/** A point, as a fraction of the drawn box. */
function fraction(structure: ReturnType<typeof structureFromMolecule>, point: { x: number; y: number }) {
  const [x, y, w, h] = structure.viewBox!.split(' ').map(Number) as [number, number, number, number];
  return { x: (point.x - x) / w, y: (point.y - y) / h };
}

describe('structureFromMolecule', () => {
  it('turns the molecule so its open bond runs straight out of the drawing', () => {
    // The whole point: the diagram bonds horizontally, so the bond inside the
    // artwork has to be horizontal too, or the linker and the compound meet at
    // an angle and stop reading as one chain.
    const s = structureFromMolecule(molecule());
    const a = fraction(s, s.attach!);
    const from = fraction(s, s.attachFrom!);
    const angle =
      (Math.atan2((a.y - from.y) * s.height!, (a.x - from.x) * s.width!) * 180) / Math.PI;
    expect(Math.abs(angle)).toBeLessThan(0.5);
    // ...and the conjugated atom is the end nearest the antibody.
    expect(a.x).toBeGreaterThan(from.x);
  });

  it('reports both atoms in the artwork’s own coordinates', () => {
    const s = structureFromMolecule(molecule());
    const [x, y, w, h] = s.viewBox!.split(' ').map(Number) as [number, number, number, number];
    for (const point of [s.attach!, s.attachFrom!]) {
      expect(point.x).toBeGreaterThanOrEqual(x);
      expect(point.x).toBeLessThanOrEqual(x + w);
      expect(point.y).toBeGreaterThanOrEqual(y);
      expect(point.y).toBeLessThanOrEqual(y + h);
    }
  });

  it('crops to the drawing, so the bond meets the molecule and not a margin', () => {
    const s = structureFromMolecule(molecule());
    const [, , w, h] = s.viewBox!.split(' ').map(Number) as [number, number, number, number];
    // The toolkit renders into 420x290; a tight box is smaller in at least one
    // direction, and keeps the drawn aspect ratio.
    expect(Math.min(w, h)).toBeLessThan(290);
    expect(s.height! / s.width!).toBeCloseTo(h / w, 1);
  });

  it('follows the atom that was asked for', () => {
    // Atom 3 is the ring carbon; conjugating through it points the drawing the
    // other way round.
    const first = structureFromMolecule(molecule());
    const other = structureFromMolecule(molecule(), { attachAtom: 3 });
    expect(other.attach).not.toEqual(first.attach);
  });

  it('refuses an atom that is not in the molecule', () => {
    expect(() => structureFromMolecule(molecule(), { attachAtom: 99 })).toThrow(DepictionError);
  });

  it('carries the caption and the drawn width through', () => {
    const s = structureFromMolecule(molecule(), { caption: 'SMCC', width: 90 });
    expect(s.caption).toBe('SMCC');
    expect(s.width).toBe(90);
  });
});
