/**
 * Linker artwork for the ADC examples.
 *
 * antibody-viewer does not depict chemistry itself — it takes a drawing you
 * supply. This module shows the usual way to produce one: run the linker's
 * SMILES through a toolkit (OpenChemLib here, a devDependency of this repo
 * only) and hand the resulting SVG to `payload.structure`.
 *
 * Shared by scripts/adc-demo.mjs and scripts/readme-images.mjs.
 */
import OCL from 'openchemlib';

/**
 * The linkers below, each in its **conjugated** form — the maleimide
 * already opened by a thiol, the NHS ester already displaced by a lysine — so
 * the atom the antibody hangs from is a real atom of the drawing rather than a
 * label floating beside it. `attachAtom` is that atom's index in the SMILES,
 * which is atom 0 in every case here. The warhead itself is left off, which is
 * why each caption says "linker".
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

/** SMILES -> the `structure` object antibody-viewer draws. */
export function structureFor(name, width = 150, height = 104) {
  const entry = LINKERS[name];
  if (!entry) return undefined;
  const molecule = OCL.Molecule.fromSmiles(entry.smiles);
  const svg = molecule.toSVG(420, 290, `ocl-${name.replace(/\W/g, '')}`, {
    suppressChiralText: true,
    noStereoProblem: true,
    fontWeight: 'normal',
  });
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  const box = tightBox(inner);
  return {
    // Strip the toolkit's own <svg> wrapper: antibody-viewer supplies one sized
    // to the box it reserves in the diagram, cropped to the drawing so the bond
    // meets the molecule rather than a margin.
    svg: inner,
    viewBox: `${box.x} ${box.y} ${box.width} ${box.height}`,
    width,
    height: Math.round(width * (box.height / box.width)),
    caption: entry.caption,
    // The exact atom the antibody is bonded to, in the drawing's own coordinates.
    attach: atomPosition(molecule, inner, entry.attachAtom),
  };
}

/**
 * Where a given atom ended up in the rendered SVG.
 *
 * OpenChemLib labels every hetero atom with a `<text>`, so the atom is found by
 * matching the labels of its element against the molecule's own coordinates:
 * both are ordered the same way along x and y, so the n-th such atom in the
 * molecule is the n-th such label in the drawing.
 */
function atomPosition(molecule, markup, index) {
  const symbol = molecule.getAtomLabel(index);
  const sameElement = [];
  for (let i = 0; i < molecule.getAllAtoms(); i++) {
    if (molecule.getAtomLabel(i) === symbol) {
      sameElement.push({ i, x: molecule.getAtomX(i), y: molecule.getAtomY(i) });
    }
  }
  const order = (a, b) => a.x - b.x || a.y - b.y;
  sameElement.sort(order);
  const rank = sameElement.findIndex((a) => a.i === index);

  const labels = [...markup.matchAll(/<text[^>]*\sx="([-\d.]+)"[^>]*\sy="([-\d.]+)"[^>]*>([^<]*)<\/text>/g)]
    .map((m) => ({ x: +m[1], y: +m[2], text: m[3].trim() }))
    .filter((l) => l.text === symbol)
    .sort(order);

  const hit = labels[rank] ?? labels[0];
  if (!hit) throw new Error(`No "${symbol}" label found for atom ${index}`);
  return { x: hit.x, y: hit.y };
}

/** Bounding box of everything actually drawn, so the artwork has no dead margin. */
function tightBox(markup, pad = 6) {
  const xs = [];
  const ys = [];
  const push = (x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  };
  for (const m of markup.matchAll(/x1="([-\d.]+)"\s*y1="([-\d.]+)"\s*x2="([-\d.]+)"\s*y2="([-\d.]+)"/g)) {
    push(+m[1], +m[2]);
    push(+m[3], +m[4]);
  }
  for (const m of markup.matchAll(/points="([^"]+)"/g)) {
    const nums = m[1].trim().split(/[\s,]+/).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) push(nums[i], nums[i + 1]);
  }
  for (const m of markup.matchAll(/<text[^>]*\sx="([-\d.]+)"[^>]*\sy="([-\d.]+)"/g)) {
    push(+m[1], +m[2]);
  }
  if (xs.length === 0) return { x: 0, y: 0, width: 420, height: 290 };
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, width: Math.max(...xs) - x + pad, height: Math.max(...ys) - y + pad };
}
