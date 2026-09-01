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

function labels(svg: string): string {
  return [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((match) => match[1]).join('|');
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
    // ...and the remote endpoint of the antibody bond is nearest the antibody.
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

  it('carries the caption through, and fits the drawing to the size asked for', () => {
    const s = structureFromMolecule(molecule(), { caption: 'SMCC', size: 90 });
    expect(s.caption).toBe('SMCC');
    // The longest side is the one that is set: a tall compound must not come
    // out taller than the antibody it hangs off.
    expect(Math.max(s.width!, s.height!)).toBe(90);
  });

  it('accounts for the antibody bond when rendering terminal sulfur and nitrogen', () => {
    const sulfur = structureFromMolecule(molecule('SCC'));
    const nitrogen = structureFromMolecule(molecule('NC(=O)C'));

    expect(labels(sulfur.svg!)).not.toContain('H');
    expect(labels(nitrogen.svg!)).toContain('N|H');
    expect(labels(nitrogen.svg!)).not.toContain('N|2|H');
  });

  it('shows absolute and CIP stereochemistry by default, with an explicit compact mode', () => {
    const chiral = molecule('N[C@H](F)[C@@H](Cl)C(=O)O');
    const full = labels(structureFromMolecule(chiral).svg!);
    const compact = labels(
      structureFromMolecule(chiral, { stereoAnnotations: 'compact' }).svg!,
    );

    expect(full).toContain('abs');
    expect(full.match(/(^|\|)abs(\||$)/g)).toHaveLength(1);
    expect(full.match(/(^|\|)[RS](?=\||$)/g)).toHaveLength(2);
    expect(compact).not.toContain('abs');
    expect(compact).not.toMatch(/(^|\|)[RS](\||$)/);
  });

  it('can preserve curated coordinates instead of replacing them', () => {
    const input = molecule('NCCCCN');
    const positions = [
      [0, 0],
      [1, 0],
      [1, 5],
      [2, 5],
      [2, 10],
      [3, 10],
    ];
    positions.forEach(([x, y], atom) => {
      input.setAtomX(atom, x!);
      input.setAtomY(atom, y!);
    });

    const preserved = structureFromMolecule(input, { coordinateMode: 'preserve' });
    const invented = structureFromMolecule(input, { coordinateMode: 'invent' });
    expect(preserved.height! / preserved.width!).toBeGreaterThan(1.5);
    expect(invented.width! / invented.height!).toBeGreaterThan(1.5);
  });

  it('can retain the source drawing direction instead of rotating its attachment bond', () => {
    const input = molecule('NCCCCN');
    const positions = [
      [0, 0],
      [0, 1],
      [2, 1],
      [4, 1],
      [6, 1],
      [8, 1],
    ];
    positions.forEach(([x, y], atom) => {
      input.setAtomX(atom, x!);
      input.setAtomY(atom, y!);
    });

    const drawing = structureFromMolecule(input, {
      coordinateMode: 'preserve',
      orientation: 'drawing',
    });
    const bond = structureFromMolecule(input, {
      coordinateMode: 'preserve',
      orientation: 'bond',
    });
    expect(drawing.width! / drawing.height!).toBeGreaterThan(2);
    expect(bond.height! / bond.width!).toBeGreaterThan(2);
    expect(drawing.attachFrom).toBeUndefined();
  });

  it('pins caller-selected scaffold coordinates while laying out the remainder', () => {
    const input = molecule('NCCCCN');
    const templated = structureFromMolecule(input, {
      coordinateTemplate: {
        positions: {
          2: { x: 1, y: 5 },
          3: { x: 2, y: 5 },
        },
      },
    });
    expect(templated.svg).toContain('<line');
  });

  it('abbreviates a selected linear repeat without changing the source molecule', () => {
    const input = molecule('NCCOCCOCCOCCN');
    const atomCount = input.getAllAtoms();
    const abbreviated = structureFromMolecule(input, {
      repeatUnits: [
        {
          atoms: [3, 4, 5, 6, 7, 8, 9, 10, 11],
          unit: '–O–CH₂–CH₂–',
          count: 3,
        },
      ],
    });

    expect(labels(abbreviated.svg!)).toContain('[–O–CH₂–CH₂–]₃');
    expect(abbreviated.svg).toContain('class="dn-repeat-label"');
    expect(abbreviated.svg).toContain('font-size="9"');
    expect(abbreviated.svg).toContain('paint-order="stroke fill"');
    expect(input.getAllAtoms()).toBe(atomCount);
  });

  it('closes a preserved-coordinate repeat to the requested span', () => {
    const input = molecule('NCCOCCOCCOCCN');
    for (let atom = 0; atom < input.getAllAtoms(); atom++) {
      input.setAtomX(atom, atom * 2);
      input.setAtomY(atom, 0);
    }
    const depict = (span: number) =>
      structureFromMolecule(input, {
        coordinateMode: 'preserve',
        orientation: 'drawing',
        repeatUnits: [
          {
            atoms: [3, 4, 5, 6, 7, 8, 9, 10, 11],
            unit: '–O–CH₂–CH₂–',
            count: 3,
            span,
          },
        ],
      });

    const narrow = depict(2);
    const wide = depict(12);
    const endDistance = (svg: string) => {
      const xs = [...svg.matchAll(/<text x="([-\d.]+)"[^>]*>N<\/text>/g)].map((match) =>
        Number(match[1]),
      );
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(endDistance(wide.svg!)).toBeGreaterThan(endDistance(narrow.svg!));
  });

  it('rejects attachment and template atoms removed by a repeat abbreviation', () => {
    const input = molecule('NCCOCCOCCOCCN');
    const repeatUnits = [
      { atoms: [3, 4, 5, 6, 7, 8, 9, 10, 11], unit: '–O–CH₂–CH₂–', count: 3 },
    ];
    expect(() => structureFromMolecule(input, { attachAtom: 3, repeatUnits })).toThrow(
      /removed by a repeat abbreviation/,
    );
    expect(() =>
      structureFromMolecule(input, {
        repeatUnits,
        coordinateTemplate: { positions: { 6: { x: 0, y: 0 } } },
      }),
    ).toThrow(/removed by a repeat abbreviation/);
  });

  it('does not mutate caller-owned coordinates', () => {
    const input = molecule();
    const before = Array.from({ length: input.getAllAtoms() }, (_, atom) => ({
      x: input.getAtomX(atom),
      y: input.getAtomY(atom),
    }));
    structureFromMolecule(input, { side: 'right' });
    const after = Array.from({ length: input.getAllAtoms() }, (_, atom) => ({
      x: input.getAtomX(atom),
      y: input.getAtomY(atom),
    }));
    expect(after).toEqual(before);
  });

  it('removes toolkit hit-target IDs from reusable artwork', () => {
    const s = structureFromMolecule(molecule());
    expect(s.svg).not.toContain('id="dn-depiction:');
  });
});
