/**
 * The linker–payload moieties of marketed ADCs, as artwork the diagram can bond
 * to.
 *
 * deneb depicts no chemistry itself. This module produces the drawings the
 * examples use: each moiety is fetched by its INN suffix from PubChem — the
 * `-vedotin` of brentuximab vedotin *is* mc-Val-Cit-PAB-MMAE — run through
 * OpenChemLib (a devDependency of this repo, never of the library), joined to
 * the antibody the way its own chemistry joins, and handed to `deneb/chem`.
 *
 * The SMILES below are recorded verbatim from PubChem with their CIDs, and each
 * entry carries the molecular formula PubChem gives so that a transcription
 * error fails here rather than reaching a picture. Nothing is written from
 * memory.
 *
 * Shared by scripts/adc-demo.mjs, scripts/adc-approved.mjs and
 * scripts/readme-images.mjs.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OCL from 'openchemlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { structureFromMolecule } = await import(resolve(root, 'dist/chem.js'));

/**
 * How each moiety joins the antibody.
 *
 * - `maleimide` — the thiol of a cysteine adds across the maleimide double
 *   bond. The ring is opened here and the sulfur that arrives is the antibody's
 *   own, which is why it becomes the atom the bond lands on.
 * - `nhs-ester` — the succinimidyl ester acylates a lysine. The leaving group
 *   goes and the bond lands on the carbonyl it leaves behind.
 * - `carboxyl` — the free acid does the same thing, so the hydroxyl goes.
 * - `amide` — the moiety is already drawn as the amide, and the nitrogen in it
 *   is the lysine's own.
 */
import moieties from './moieties.json' with { type: 'json' };

/**
 * The moieties themselves are fetched, not typed in: `node
 * scripts/fetch-moieties.mjs` writes scripts/lib/moieties.json from PubChem,
 * with each record's CID and the formula its own InChI agrees with. A long
 * SMILES is exactly the kind of string that goes wrong when it passes through
 * a pair of hands, so it passes through none.
 */
export const MOIETIES = moieties.moieties;
export const FETCHED = moieties.fetched;

const { Molecule } = OCL;

/**
 * Element counts, so the check does not turn on how a toolkit orders them —
 * OpenChemLib puts the halogen last where PubChem puts it in Hill order.
 */
function elements(formula) {
  const counts = {};
  for (const [, symbol, n] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (symbol) counts[symbol] = (counts[symbol] ?? 0) + Number(n || 1);
  }
  return counts;
}

function sameFormula(a, b) {
  const [x, y] = [elements(a), elements(b)];
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => x[k] === y[k]);
}

/** Carbon of a `C(=O)-O-` group whose single-bonded oxygen leads where asked. */
function acylCarbon(molecule, wanted) {
  const hits = [];
  for (let atom = 0; atom < molecule.getAllAtoms(); atom++) {
    if (molecule.getAtomLabel(atom) !== 'C') continue;
    let doubleO = -1;
    let singleO = -1;
    let others = 0;
    for (let i = 0; i < molecule.getAllConnAtoms(atom); i++) {
      const n = molecule.getConnAtom(atom, i);
      const order = molecule.getConnBondOrder(atom, i);
      if (molecule.getAtomLabel(n) === 'O' && order === 2) doubleO = n;
      else if (molecule.getAtomLabel(n) === 'O' && order === 1) singleO = n;
      else others++;
    }
    if (doubleO < 0 || singleO < 0 || others !== 1) continue;
    const beyond = [];
    for (let i = 0; i < molecule.getAllConnAtoms(singleO); i++) {
      beyond.push(molecule.getAtomLabel(molecule.getConnAtom(singleO, i)));
    }
    if (beyond.sort().join('') === wanted) hits.push({ atom, singleO });
  }
  if (hits.length !== 1) {
    throw new Error(`expected one ${wanted} acyl group, found ${hits.length}`);
  }
  return hits[0];
}

/** Every atom reachable from `start` without going back through `blocked`. */
function reachableFrom(molecule, start, blocked) {
  const seen = new Set([blocked, start]);
  const queue = [start];
  while (queue.length > 0) {
    const atom = queue.pop();
    for (let i = 0; i < molecule.getAllConnAtoms(atom); i++) {
      const n = molecule.getConnAtom(atom, i);
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  seen.delete(blocked);
  return [...seen];
}

/** Join the moiety to the antibody the way its own chemistry does. */
function conjugate(molecule, join) {
  if (join === 'maleimide') {
    molecule.ensureHelperArrays(Molecule.cHelperRings);
    const rings = molecule.getRingSet();
    const isCarbonyl = (atom) => {
      for (let i = 0; i < molecule.getAllConnAtoms(atom); i++) {
        const n = molecule.getConnAtom(atom, i);
        if (molecule.getAtomLabel(n) === 'O' && molecule.getConnBondOrder(atom, i) === 2) {
          return true;
        }
      }
      return false;
    };
    let alkene = null;
    for (let r = 0; r < rings.getSize(); r++) {
      const atoms = rings.getRingAtoms(r);
      if (atoms.length !== 5) continue;
      if (atoms.filter((a) => molecule.getAtomLabel(a) === 'N').length !== 1) continue;
      if (atoms.filter(isCarbonyl).length !== 2) continue;
      const bond = rings
        .getRingBonds(r)
        .find(
          (b) =>
            molecule.getBondOrder(b) === 2 &&
            [0, 1].every((e) => {
              const atom = molecule.getBondAtom(e, b);
              return molecule.getAtomLabel(atom) === 'C' && !isCarbonyl(atom);
            }),
        );
      if (bond != null) {
        alkene = { bond, carbon: molecule.getBondAtom(0, bond) };
        break;
      }
    }
    if (!alkene) throw new Error('no maleimide found');
    // The cysteine's thiol adds across the double bond: +H2S, and the sulfur it
    // brings is the atom the antibody's bond lands on.
    molecule.setBondOrder(alkene.bond, 1);
    const sulfur = molecule.addAtom(16);
    molecule.addBond(alkene.carbon, sulfur);
    molecule.ensureHelperArrays(Molecule.cHelperNeighbours);
    molecule.inventCoordinates();
    return { attachAtom: sulfur, attachment: '' };
  }

  if (join === 'nhs-ester' || join === 'carboxyl') {
    // The succinimidyl ester, or the free acid, acylates a lysine: the leaving
    // group goes and the bond lands on the carbonyl behind it.
    const { atom, singleO } = acylCarbon(molecule, join === 'nhs-ester' ? 'CN' : 'C');
    const leaving = reachableFrom(molecule, singleO, atom);
    const carbonyl = atom - leaving.filter((a) => a < atom).length;
    for (const a of [...leaving].sort((x, y) => y - x)) molecule.deleteAtom(a);
    molecule.ensureHelperArrays(Molecule.cHelperNeighbours);
    if (molecule.getAtomLabel(carbonyl) !== 'C') {
      throw new Error(`the carbonyl moved: found ${molecule.getAtomLabel(carbonyl)}`);
    }
    molecule.inventCoordinates();
    return { attachAtom: carbonyl, attachment: 'NH' };
  }

  if (join === 'amide') {
    // Already drawn as the amide; the nitrogen in it is the lysine's own.
    for (let a = 0; a < molecule.getAllAtoms(); a++) {
      if (molecule.getAtomLabel(a) !== 'N' || molecule.getAllConnAtoms(a) !== 1) continue;
      const carbon = molecule.getConnAtom(a, 0);
      if (molecule.getAtomLabel(carbon) !== 'C') continue;
      for (let i = 0; i < molecule.getAllConnAtoms(carbon); i++) {
        const n = molecule.getConnAtom(carbon, i);
        if (molecule.getAtomLabel(n) === 'O' && molecule.getConnBondOrder(carbon, i) === 2) {
          molecule.inventCoordinates();
          return { attachAtom: a, attachment: '' };
        }
      }
    }
    throw new Error('no primary amide found');
  }

  throw new Error(`unknown join "${join}"`);
}

/** A moiety, drawn and ready for `payload.structure`. */
export function structureFor(name, { side = 'right', size = 260 } = {}) {
  const entry = MOIETIES[name];
  if (!entry) {
    throw new Error(`no moiety "${name}"; one of ${Object.keys(MOIETIES).join(', ')}`);
  }
  const molecule = Molecule.fromSmiles(entry.smiles);
  const parsed = molecule.getMolecularFormula().formula;
  if (!sameFormula(parsed, entry.formula)) {
    throw new Error(`${name}: SMILES parses as ${parsed}, PubChem says ${entry.formula}`);
  }
  const { attachAtom, attachment } = conjugate(molecule, entry.join);
  const structure = structureFromMolecule(molecule, {
    attachAtom,
    side,
    size,
    caption: `${name} — ${entry.what}, PubChem CID ${entry.cid}`,
  });
  return { structure, attachment };
}
