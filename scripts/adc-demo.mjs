#!/usr/bin/env node
/**
 * Renders `examples/adc.html`: a set of antibody–drug conjugate formats, with
 * the payload's chemical structure drawn next to the molecule.
 *
 * The linker artwork comes from scripts/lib/linkers.mjs, which runs each
 * SMILES through OpenChemLib — a devDependency of this repo only, since
 * antibody-viewer draws the chemistry you supply rather than depicting it.
 *
 *   npm run adc-demo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structureFor } from './lib/linkers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderSVG, renderLinear } = await import(resolve(root, 'dist/index.js'));

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
<pre>import { structureFor } from './lib/linkers.mjs';

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
