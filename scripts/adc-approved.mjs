#!/usr/bin/env node
/**
 * Renders `examples/adc-approved.html`: marketed antibody–drug conjugates, each
 * written in the DSL, with the notation printed beside the picture.
 *
 * Every fact below is taken from a cited source, and nothing that the sources
 * do not state is written down. In particular the drug-to-antibody ratio and
 * the conjugation site are given for two of these products only, because those
 * are the two the sources state them for; for the rest the notation simply
 * leaves those fields out. Where the mark sits on the diagram is a drawing
 * choice, not a claim about which residue carries the linker.
 *
 *   npm run adc-approved
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structureFor } from './lib/linkers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderSVG, parseDSL } = await import(resolve(root, 'dist/index.js'));

const SOURCES = {
  antibodies2023:
    '<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10660735/">Antibodies 2023, Table 1</a>',
  pharmaceutics2023:
    '<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC10458257/">Pharmaceutics 2023</a>',
  kadcylaLabel:
    '<a href="https://api.fda.gov/drug/label.json?search=openfda.brand_name:%22KADCYLA%22">FDA label, DESCRIPTION</a>',
  belantamab:
    '<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8805802/">Ann Pharmacother 2022 (afucosylation)</a>',
  gemtuzumab:
    '<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6661897/">Ther Adv Hematol 2019 (IgG4)</a>',
  inotuzumab:
    '<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC6458768/">Ther Adv Hematol 2019 (IgG4)</a>',
  pubchem: '<a href="https://pubchem.ncbi.nlm.nih.gov/">PubChem</a>',
};

/**
 * Payload glyphs by class, so the picture separates a microtubule inhibitor
 * from a topoisomerase inhibitor from a DNA-damaging agent at a glance. This is
 * presentation, and says nothing the sources did not.
 */
const CLASS_GLYPH = {
  auristatin: 'shape=hexagon',
  maytansinoid: 'shape=diamond/color=#7c3aed',
  topoisomerase: 'shape=circle/color=#0d9488',
  dna: 'shape=star/color=#b45309',
};

const PRODUCTS = [
  {
    brand: 'Kadcyla',
    inn: 'ado-trastuzumab emtansine',
    note:
      'The one product here whose label states the numbers: humanized anti-HER2 IgG1, ' +
      'MCC linker, an average of 3.5 DM1 per antibody, conjugated to lysines. ' +
      'The NHS ester is gone in the drawing — it is what acylated the lysine.',
    cite: [SOURCES.kadcylaLabel, SOURCES.pharmaceutics2023],
    moiety: 'emtansine',
    dsl: `
      @name Kadcyla (ado-trastuzumab emtansine)
      HC: VH(HER2)-CH1-h-CH2[drug=DM1/MCC/3.5/1/lysine/noncleavable/${CLASS_GLYPH.maytansinoid}]-CH3 *2
      LC: VL(HER2)-CL *2
    `,
  },
  {
    brand: 'Adcetris',
    inn: 'brentuximab vedotin',
    note: 'Anti-CD30, the mc-Val-Cit-PABC dipeptide linker, MMAE. Cleavable.',
    cite: [SOURCES.antibodies2023, SOURCES.pharmaceutics2023],
    moiety: 'vedotin',
    dsl: `
      @name Adcetris (brentuximab vedotin)
      HC: VH(CD30)-CH1-h-CH2[drug=MMAE/mc-Val-Cit-PABC/cleavable/${CLASS_GLYPH.auristatin}]-CH3 *2
      LC: VL(CD30)-CL *2
    `,
  },
  {
    brand: 'Enhertu',
    inn: 'fam-trastuzumab deruxtecan',
    note: 'Anti-HER2, a cleavable GGFG tetrapeptide linker, the topoisomerase I inhibitor DXd.',
    cite: [SOURCES.antibodies2023, SOURCES.pharmaceutics2023],
    moiety: 'deruxtecan',
    dsl: `
      @name Enhertu (fam-trastuzumab deruxtecan)
      HC: VH(HER2)-CH1-h-CH2[drug=DXd/GGFG tetrapeptide/cleavable/${CLASS_GLYPH.topoisomerase}]-CH3 *2
      LC: VL(HER2)-CL *2
    `,
  },
  {
    brand: 'Trodelvy',
    inn: 'sacituzumab govitecan',
    note: 'Anti-TROP-2, the cleavable CL2A carbonate linker, SN-38.',
    cite: [SOURCES.antibodies2023, SOURCES.pharmaceutics2023],
    moiety: 'govitecan',
    dsl: `
      @name Trodelvy (sacituzumab govitecan)
      HC: VH(TROP-2)-CH1-h-CH2[drug=SN-38/CL2A carbonate/cleavable/${CLASS_GLYPH.topoisomerase}]-CH3 *2
      LC: VL(TROP-2)-CL *2
    `,
  },
  {
    brand: 'Padcev',
    inn: 'enfortumab vedotin',
    note: 'Anti-Nectin-4, mc-Val-Cit-PABC, MMAE — the same chemistry as Adcetris on a different target.',
    cite: [SOURCES.antibodies2023, SOURCES.pharmaceutics2023],
    moiety: 'vedotin',
    dsl: `
      @name Padcev (enfortumab vedotin)
      HC: VH(Nectin-4)-CH1-h-CH2[drug=MMAE/mc-Val-Cit-PABC/cleavable/${CLASS_GLYPH.auristatin}]-CH3 *2
      LC: VL(Nectin-4)-CL *2
    `,
  },
  {
    brand: 'Polivy',
    inn: 'polatuzumab vedotin',
    note: 'Anti-CD79b, mc-Val-Cit-PABC, MMAE.',
    cite: [SOURCES.antibodies2023, SOURCES.pharmaceutics2023],
    moiety: 'vedotin',
    dsl: `
      @name Polivy (polatuzumab vedotin)
      HC: VH(CD79b)-CH1-h-CH2[drug=MMAE/mc-Val-Cit-PABC/cleavable/${CLASS_GLYPH.auristatin}]-CH3 *2
      LC: VL(CD79b)-CL *2
    `,
  },
  {
    brand: 'Tivdak',
    inn: 'tisotumab vedotin',
    note: 'Anti-tissue-factor, mc-Val-Cit-PABC, MMAE.',
    cite: [SOURCES.antibodies2023],
    moiety: 'vedotin',
    dsl: `
      @name Tivdak (tisotumab vedotin)
      HC: VH(Tissue factor)-CH1-h-CH2[drug=MMAE/mc-Val-Cit-PABC/cleavable/${CLASS_GLYPH.auristatin}]-CH3 *2
      LC: VL(Tissue factor)-CL *2
    `,
  },
  {
    brand: 'Blenrep',
    inn: 'belantamab mafodotin',
    note:
      'Anti-BCMA, a non-cleavable maleimidocaproyl linker and MMAF. The antibody is ' +
      'engineered too: it is <strong>afucosylated</strong>, which raises its affinity for ' +
      'FcγRIIIa and so its ADCC — the branched stub on the Fc.',
    cite: [SOURCES.antibodies2023, SOURCES.belantamab],
    moiety: 'mafodotin',
    dsl: `
      @name Blenrep (belantamab mafodotin)
      HC: VH(BCMA)-CH1-h-CH2[afucosyl, drug=MMAF/maleimidocaproyl/noncleavable/${CLASS_GLYPH.auristatin}]-CH3 *2
      LC: VL(BCMA)-CL *2
    `,
  },
  {
    brand: 'Elahere',
    inn: 'mirvetuximab soravtansine',
    note: 'Anti-folate-receptor-α, the cleavable hydrophilic disulfide sulfo-SPDB, DM4.',
    cite: [SOURCES.antibodies2023, SOURCES.pharmaceutics2023],
    moiety: 'soravtansine',
    dsl: `
      @name Elahere (mirvetuximab soravtansine)
      HC: VH(FRalpha)-CH1-h-CH2[drug=DM4/sulfo-SPDB/cleavable/${CLASS_GLYPH.maytansinoid}]-CH3 *2
      LC: VL(FRalpha)-CL *2
    `,
  },
  {
    brand: 'Zynlonta',
    inn: 'loncastuximab tesirine',
    note: 'Anti-CD19, a cleavable Val-Ala dipeptide, the pyrrolobenzodiazepine dimer SG3199 — a DNA cross-linker, not a tubulin binder.',
    cite: [SOURCES.antibodies2023, SOURCES.pharmaceutics2023],
    moiety: 'tesirine',
    dsl: `
      @name Zynlonta (loncastuximab tesirine)
      HC: VH(CD19)-CH1-h-CH2[drug=PBD dimer/Val-Ala/cleavable/${CLASS_GLYPH.dna}]-CH3 *2
      LC: VL(CD19)-CL *2
    `,
  },
  {
    brand: 'Mylotarg',
    inn: 'gemtuzumab ozogamicin',
    note:
      'Anti-CD33 with a hydrazone linker and N-acetyl-γ-calicheamicin, lysine-conjugated, ' +
      'DAR 3. The antibody is a humanized <strong>IgG4</strong> — chosen so it does not ' +
      'recruit effector function. The lint rule flags what comes with that: an IgG4 ' +
      'without S228P can exchange Fab arms.',
    cite: [SOURCES.antibodies2023, SOURCES.gemtuzumab],
    moiety: 'ozogamicin',
    dsl: `
      @name Mylotarg (gemtuzumab ozogamicin)
      HC: VH(CD33)-CH1-h-CH2[drug=calicheamicin/hydrazone/3/1/lysine/cleavable/${CLASS_GLYPH.dna}]-CH3 *2
      LC: VL(CD33)-CL *2
      @isotype HC=IgG4
    `,
  },
  {
    brand: 'Besponsa',
    inn: 'inotuzumab ozogamicin',
    note: 'Anti-CD22, the same hydrazone / N-acetyl-γ-calicheamicin chemistry, and a humanized <strong>IgG4</strong> again.',
    cite: [SOURCES.antibodies2023, SOURCES.inotuzumab],
    moiety: 'ozogamicin',
    dsl: `
      @name Besponsa (inotuzumab ozogamicin)
      HC: VH(CD22)-CH1-h-CH2[drug=calicheamicin/hydrazone/cleavable/${CLASS_GLYPH.dna}]-CH3 *2
      LC: VL(CD22)-CL *2
      @isotype HC=IgG4
    `,
  },
];

const trim = (dsl) => dsl.trim().split('\n').map((l) => l.trim()).join('\n');

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const build = (product) => {
  const construct = parseDSL(product.dsl);
  // Drawn to the right of the antibody, always, so the twelve can be read
  // against each other: same place, same direction, same bond.
  const { structure, attachment } = structureFor(product.moiety, { side: 'right' });
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

const card = (product) => `
  <figure class="card">
    <h2>${product.brand} <span class="inn">${product.inn}</span></h2>
    <p>${product.note}</p>
    <div class="cartoon">${renderSVG(build(product), { scale: 1.15, showStructures: 'inline' }).svg}</div>
    <pre>${escape(trim(product.dsl))}</pre>
    <p class="cite">${product.cite.join(' · ')}</p>
  </figure>`;

const html = `<!doctype html>
<meta charset="utf-8">
<title>deneb — marketed ADCs</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #f6f7f9; font: 14px/1.55 ui-sans-serif, system-ui, sans-serif; color: #1c222b; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .lede { margin: 0 0 20px; max-width: 76ch; color: #4b5563; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 16px; }
  .card { margin: 0; background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 14px; }
  .card h2 { font-size: 13px; margin: 0 0 4px; }
  .inn { font-weight: 400; color: #6b7280; }
  .card p { margin: 0 0 10px; font-size: 12px; color: #6b7280; }
  .cartoon { display: flex; justify-content: center; overflow-x: auto; }
  .cite { margin: 8px 0 0; font-size: 11px; color: #9099a5; }
  .cite a { color: inherit; }
  code, pre { background: #eef1f4; border-radius: 4px; }
  code { padding: 1px 5px; }
  pre { padding: 10px; font-size: 11.5px; margin: 10px 0 0; line-height: 1.55;
        white-space: pre-wrap; overflow-wrap: anywhere;
        padding-left: 3em; text-indent: -2em; }
  .caveat { border-left: 3px solid #d1d5db; padding-left: 12px; margin: 0 0 20px; max-width: 76ch; font-size: 12.5px; color: #4b5563; }
</style>
<h1>Marketed ADCs, written in the notation</h1>
<p class="lede">
  Each of these is one <code>parseDSL</code> string, printed under its own
  picture, with the linker-payload drawn out to the right of the antibody and
  bonded to the atom that actually carries it. The moieties are the INN suffixes
  — the <code>-vedotin</code> of brentuximab vedotin is mc-Val-Cit-PAB-MMAE —
  fetched from ${SOURCES.pubchem} by CID, then joined to the antibody the way
  their own chemistry joins: a maleimide is opened by a cysteine thiol and the
  sulfur that arrives carries the bond; a succinimidyl ester and a free acid
  lose their leaving group and acylate a lysine. Target, linker, payload and
  cleavability come from the sources cited on each card.
</p>
<p class="caveat">
  <strong>What is deliberately missing.</strong> The drug-to-antibody ratio and
  the conjugation site appear on two cards only — Kadcyla and Mylotarg — because
  those are the two the cited sources state them for. Everywhere else the
  notation leaves those fields out rather than assert a number. For the same
  reason the drug mark is drawn on CH2 throughout: that is where the diagram puts
  it, not a claim about which residue carries the linker. Fill in
  <code>dar=</code> and <code>site=</code> from the product's own label when you
  need them. Two of the twelve carry engineering on the antibody as well —
  Blenrep is afucosylated, Mylotarg and Besponsa are IgG4 — and those are cited
  where they appear.
</p>
<div class="grid">${PRODUCTS.map(card).join('')}</div>
<pre>// The shape of the antibody, the payload, the linker, the DAR, the number of
// copies, the site, whether it is cleavable, and the glyph — all notation:
HC: VH(HER2)-CH1-h-CH2[drug=DM1/SMCC/3.5/1/lysine/noncleavable/shape=diamond]-CH3 *2
LC: VL(HER2)-CL *2

// The chemical drawing is the one thing it cannot hold; that is attached to the
// parsed construct, from a toolkit, through deneb/chem.</pre>
`;

mkdirSync(resolve(root, 'examples'), { recursive: true });
writeFileSync(resolve(root, 'examples/adc-approved.html'), html);
console.log(`Wrote examples/adc-approved.html (${PRODUCTS.length} products)`);
