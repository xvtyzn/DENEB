#!/usr/bin/env node
/**
 * Renders `examples/adc.html`: a set of antibody–drug conjugate formats, with
 * the payload's chemical structure drawn next to the molecule.
 *
 * antibody-viewer does not depict chemistry itself — it takes a drawing you
 * supply. This script shows the usual way to produce one: run the payload's
 * SMILES through a toolkit (OpenChemLib here, a devDependency of this repo
 * only) and hand the resulting SVG to `payload.structure`.
 *
 *   npm run adc-demo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import OCL from 'openchemlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderSVG, renderLinear } = await import(resolve(root, 'dist/index.js'));

/**
 * The linkers drawn below, each in its **conjugated** form — the maleimide
 * already opened by a thiol, the NHS ester already displaced by a lysine — so
 * the atom the antibody hangs from is a real atom of the drawing rather than a
 * label floating beside it. `attachAtom` is that atom's index in the SMILES,
 * which is atom 0 in every case here. The warhead itself is left off, which is
 * why each caption says "linker".
 */
const LINKERS = {
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
function structureFor(name, width = 150, height = 104) {
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

const igg = (specificity, extra = {}) => [
  {
    id: 'HC',
    copies: 2,
    domains: [
      { type: 'VH', specificity },
      { type: 'CH1' },
      { type: 'hinge' },
      { type: 'CH2', modifications: extra.ch2 ?? [] },
      { type: 'CH3' },
    ],
  },
  {
    id: 'LC',
    copies: 2,
    domains: [
      { type: 'VL', specificity },
      { type: 'CL', modifications: extra.cl ?? [] },
    ],
  },
];

const cases = [
  {
    label: 'Interchain cysteine, cleavable dipeptide linker',
    note: 'The classic vc-MMAE architecture: a heterogeneous DAR 4 average, conjugated at the interchain cysteines below the hinge.',
    options: {},
    construct: {
      name: 'anti-HER2 vc-MMAE (DAR 4)',
      chains: igg('HER2', {
        ch2: [
          {
            type: 'drug',
            payload: {
              name: 'MMAE',
              linker: 'mc-vc-PAB',
              cleavable: true,
              dar: 4,
              count: 2,
              site: 'interchain cysteine',
              // The drawing carries its own sulfur, so no extra atom label.
              attachment: '',
              structure: structureFor('mc-Val-Cit-PAB'),
            },
          },
        ],
      }),
    },
  },
  {
    label: 'Lysine conjugation, non-cleavable linker',
    note: 'A broken stalk marks the non-cleavable linker; the payload is released only on catabolism of the antibody.',
    options: {},
    construct: {
      name: 'anti-CD30 SMCC-DM1 (DAR 3.5)',
      chains: igg('CD30', {
        ch2: [
          {
            type: 'drug',
            payload: {
              name: 'DM1',
              linker: 'SMCC',
              cleavable: false,
              dar: 3.5,
              site: 'surface lysine',
              attachment: '',
              shape: 'diamond',
              color: '#7c3aed',
              structure: structureFor('SMCC'),
            },
          },
        ],
      }),
    },
  },
  {
    label: 'Site-specific, engineered cysteine',
    note: 'Two marks tell the story: the engineered cysteine that was introduced, and what was attached to it.',
    options: {},
    construct: {
      name: 'THIOMAB DXd (DAR 2)',
      chains: igg('TROP2', {
        ch2: [
          { type: 'thiomab', residues: ['A114C'] },
          {
            type: 'drug',
            payload: {
              name: 'DXd',
              linker: 'GGFG tetrapeptide',
              cleavable: true,
              dar: 2,
              site: 'THIOMAB A114C',
              attachment: '',
              shape: 'circle',
              structure: structureFor('GGFG'),
            },
          },
        ],
      }),
    },
  },
];

const inlineCase = {
  label: "showStructures: 'inline'",
  note: 'The same conjugate with the depiction on the end of the linker rather than in the legend.',
  options: { showStructures: 'inline', showLegend: false },
  construct: cases[0].construct,
};

const card = ({ label, note, construct, options }) => `
  <figure class="card">
    <h2>${label}</h2>
    <p>${note}</p>
    <div class="cartoon">${renderSVG(construct, { scale: 1.5, ...options }).svg}</div>
    <div class="linear">${renderLinear(construct, { trackWidth: 320, showTitle: false, showLegend: false }).svg}</div>
  </figure>`;

const html = `<!doctype html>
<meta charset="utf-8">
<title>antibody-viewer — ADC payloads</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #f6f7f9; font: 14px/1.55 ui-sans-serif, system-ui, sans-serif; color: #1c222b; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .lede { margin: 0 0 20px; max-width: 70ch; color: #4b5563; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  .card { margin: 0; background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 14px; }
  .card h2 { font-size: 13px; margin: 0 0 4px; }
  .card p { margin: 0 0 10px; font-size: 12px; color: #6b7280; }
  .cartoon { display: flex; justify-content: center; overflow-x: auto; }
  .linear { margin-top: 10px; border-top: 1px dashed #e3e6ea; padding-top: 10px; overflow-x: auto; }
  code, pre { background: #eef1f4; border-radius: 4px; }
  code { padding: 1px 5px; }
  pre { padding: 12px; overflow-x: auto; font-size: 12px; margin: 16px 0 0; }
</style>
<h1>ADC payloads</h1>
<p class="lede">
  antibody-viewer draws the conjugation — the linker stalk, the payload glyph, the DAR
  and the site — and will place a chemical structure you supply. It does not depict
  chemistry itself. Below, each structure was generated from a SMILES string with
  OpenChemLib (a devDependency of this repo, not of the library) in
  <code>scripts/adc-demo.mjs</code>. Each linker is drawn in its conjugated form,
  and the bond from the antibody lands on the exact atom that carries it — the
  sulfur of a thiosuccinimide, the nitrogen of a lysine amide — rather than on the
  edge of a box. <strong>What is drawn is the linker chemistry; the warhead itself
  is left off</strong> — replace the SMILES in that file with your own
  linker-payload and the pictures follow.
</p>
<div class="grid">${[...cases, inlineCase].map(card).join('')}</div>
<pre>import OCL from 'openchemlib';

const molecule = OCL.Molecule.fromSmiles(smiles);
const svg = molecule.toSVG(300, 190, 'payload');

payload.structure = {
  svg: svg.replace(/^[\\s\\S]*?&lt;svg[^&gt;]*&gt;/, '').replace(/&lt;\\/svg&gt;\\s*$/, ''),
  viewBox: '0 0 300 190',
  width: 104,
  height: 66,
};</pre>
`;

mkdirSync(resolve(root, 'examples'), { recursive: true });
writeFileSync(resolve(root, 'examples/adc.html'), html);
console.log('Wrote examples/adc.html');
