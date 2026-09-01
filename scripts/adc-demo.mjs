#!/usr/bin/env node
/**
 * Renders `examples/adc.html`: a set of antibody–drug conjugate formats, with
 * the payload's chemical structure drawn next to the molecule.
 *
 * The linker artwork comes from scripts/lib/linkers.mjs, which loads PubChem
 * connectivity through OpenChemLib — a devDependency of this repo only — and
 * retains a complete 2D record or curated scaffold where one is recorded.
 *
 *   npm run adc-demo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structureFor } from './lib/linkers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderSVG, renderLinear } = await import(resolve(root, 'dist/index.js'));

const { parseDSL } = await import(resolve(root, 'dist/index.js'));

/**
 * Everything but the artwork is written in the DSL — including cleavability,
 * the shape and colour of the payload glyph, and the empty `attachment` that
 * says the drawing carries its own atom. The chemical structure is the one
 * thing the notation cannot hold, so it is attached afterwards.
 */
const withStructure = (source, moiety) => {
  const construct = parseDSL(source);
  const { structure, attachment } = structureFor(moiety, { side: 'right', size: 200 });
  for (const chain of construct.chains) {
    for (const domain of chain.domains) {
      for (const m of domain.modifications ?? []) {
        if (!m.payload) continue;
        m.payload.structure = structure;
        m.payload.attachment = attachment;
      }
    }
  }
  return construct;
};

const cases = [
  {
    label: 'Interchain cysteine, cleavable dipeptide linker',
    note: 'The classic vc-MMAE architecture: a heterogeneous DAR 4 average, conjugated at the interchain cysteines below the hinge.',
    options: {},
    construct: withStructure(
      `
        @name anti-HER2 vc-MMAE (DAR 4)
        HC: VH(HER2)-CH1-h-CH2[drug=MMAE/mc-vc-PAB/4/2/interchain cysteine/cleavable]-CH3 *2
        LC: VL(HER2)-CL *2
      `,
      'vedotin',
    ),
  },
  {
    label: 'Lysine conjugation, non-cleavable linker',
    note: 'A broken stalk marks the non-cleavable linker; the payload is released only on catabolism of the antibody.',
    options: {},
    construct: withStructure(
      `
        @name anti-CD30 SMCC-DM1 (DAR 3.5)
        HC: VH(CD30)-CH1-h-CH2[drug=DM1/SMCC/3.5/1/surface lysine/noncleavable/shape=diamond/color=#7c3aed]-CH3 *2
        LC: VL(CD30)-CL *2
      `,
      'emtansine',
    ),
  },
  {
    label: 'Site-specific, engineered cysteine',
    note: 'Two marks tell the story: the engineered cysteine that was introduced, and what was attached to it.',
    options: {},
    construct: withStructure(
      `
        @name THIOMAB DXd (DAR 2)
        HC: VH(TROP2)-CH1-h-CH2[thiomab=A114C, drug=DXd/GGFG tetrapeptide/2/site=THIOMAB A114C/cleavable/shape=circle]-CH3 *2
        LC: VL(TROP2)-CL *2
      `,
      'deruxtecan',
    ),
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
<title>deneb — ADC payloads</title>
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
  deneb draws the conjugation — the linker stalk, the payload glyph, the DAR
  and the site — and will place a chemical structure you supply. It depicts no
  chemistry itself. Below, each structure uses PubChem connectivity loaded by
  OpenChemLib (a devDependency of this repo, not of the library) and then passes
  through <code>deneb/chem</code>, which preserves a supplied 2D drawing or can
  orient a generated layout so the conjugated atom faces the antibody. The
  bond from the antibody then lands on the exact atom that carries it — the
  sulfur of a thiosuccinimide, the nitrogen of a lysine amide — and carries
  straight on into the molecule rather than meeting it at an angle.
  <strong>Each drawing contains the complete linker-payload moiety</strong>,
  including the warhead. KADCYLA and TRODELVY retain complete PubChem 2D records;
  an optional scaffold template remains available when no complete drawing is
  supplied. Replace the molecule, drawing record, or coordinate template and the
  pictures follow.
</p>
<div class="grid">${[...cases, inlineCase].map(card).join('')}</div>
<pre>// Everything but the drawing is notation.
HC: VH(HER2)-CH1-h-CH2[drug=MMAE/mc-vc-PAB/4/2/interchain cysteine]-CH3 *2
LC: VL(HER2)-CL *2

// The drawing is the one thing the notation cannot hold.
import { Molecule } from 'openchemlib';
import { structureFromMolecule } from 'deneb/chem';

// The SMILES starts at the atom the antibody is bonded to, so that is atom 0,
// and the linker is in its conjugated form: the maleimide already opened by
// the thiol.
payload.structure = structureFromMolecule(
  Molecule.fromSmiles('SC2CC(=O)N(CCCCCC(=O)N…)C2=O'),
  { attachAtom: 0, caption: 'mc-Val-Cit-PAB' },
);</pre>
`;

mkdirSync(resolve(root, 'examples'), { recursive: true });
writeFileSync(resolve(root, 'examples/adc.html'), html);
console.log('Wrote examples/adc.html');
