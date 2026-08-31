/**
 * Linker artwork for the ADC examples.
 *
 * deneb depicts no chemistry itself — it draws the artwork you supply. This
 * module shows the usual way to produce one: run the linker's SMILES through a
 * toolkit (OpenChemLib here, a devDependency of this repo only) and hand the
 * result to `deneb/chem`, which turns the molecule so its conjugated atom faces
 * the antibody and reports where that atom ended up.
 *
 * Shared by scripts/adc-demo.mjs and scripts/readme-images.mjs.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OCL from 'openchemlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { structureFromMolecule } = await import(resolve(root, 'dist/chem.js'));

/**
 * The linkers below, each in its **conjugated** form — the maleimide already
 * opened by a thiol, the NHS ester already displaced by a lysine — so the atom
 * the antibody hangs from is a real atom of the drawing rather than a label
 * floating beside it. `attachAtom` is that atom's index in the SMILES, which is
 * atom 0 in every case here. The warhead itself is left off, which is why each
 * caption says "linker".
 */
export const LINKERS = {
  'mc-Val-Cit-PAB': {
    smiles:
      'SC2CC(=O)N(CCCCCC(=O)NC(C(C)C)C(=O)NC(CCCNC(N)=O)C(=O)Nc1ccc(CO)cc1)C2=O',
    attachAtom: 0,
    caption: 'mc-Val-Cit-PAB, thiosuccinimide (payload omitted)',
  },
  SMCC: {
    smiles: 'NC(=O)C1CCC(CN2C(=O)C=CC2=O)CC1',
    attachAtom: 0,
    caption: 'SMCC, lysine amide (payload omitted)',
  },
  GGFG: {
    smiles: 'SC2CC(=O)N(CCCCCC(=O)NCC(=O)NCC(=O)NC(Cc1ccccc1)C(=O)NCC(=O)O)C2=O',
    attachAtom: 0,
    caption: 'mc-GGFG, thiosuccinimide (payload omitted)',
  },
};

/** SMILES -> the `structure` object deneb draws. */
export function structureFor(name, size = 150) {
  const entry = LINKERS[name];
  if (!entry) return undefined;
  return structureFromMolecule(OCL.Molecule.fromSmiles(entry.smiles), {
    attachAtom: entry.attachAtom,
    caption: entry.caption,
    size,
  });
}
