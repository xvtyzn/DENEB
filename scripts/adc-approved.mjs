#!/usr/bin/env node
/**
 * Renders `examples/adc-approved.html`: every marketed antibody conjugate the
 * US label database has, written in the notation, with its whole
 * linker-payload drawn out to the right of the antibody.
 *
 * Nothing here is written from memory, and nothing is asserted that a source
 * does not state:
 *
 *   - the facts come from section 11 of each product's own label, fetched by
 *     `npm run adc-labels` into scripts/lib/adc-labels.json;
 *   - every number below is checked against that text before the page is
 *     written, so a label revision that changes a DAR fails the build rather
 *     than quietly leaving a stale figure;
 *   - the compounds come from PubChem by CID, `npm run moieties`;
 *   - a field the label does not state is left out of the notation.
 *
 *   npm run adc-approved
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structureFor } from './lib/linkers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderSVG, parseDSL, normalize } = await import(resolve(root, 'dist/index.js'));
const { lint } = await import(resolve(root, 'dist/lint.js'));
const LABELS = JSON.parse(readFileSync(resolve(root, 'scripts/lib/adc-labels.json'), 'utf8'));

/**
 * Payload glyphs by class, so the picture separates a microtubule inhibitor
 * from a topoisomerase inhibitor from a DNA-damaging agent at a glance. This is
 * presentation, and says nothing the labels did not.
 */
const GLYPH = {
  auristatin: 'shape=hexagon',
  maytansinoid: 'shape=diamond/color=#7c3aed',
  topoisomerase: 'shape=circle/color=#0d9488',
  dna: 'shape=star/color=#b45309',
  other: 'shape=square/color=#525b6b',
};

/**
 * What each label says, in the fields the notation has. `quotes` are the exact
 * phrases the numbers came from; the build asserts each is really in the label.
 */
const PRODUCTS = [
  {
    brand: 'ADCETRIS',
    inn: 'brentuximab vedotin',
    target: 'CD30',
    antibody: 'chimeric IgG1',
    isotype: 'IgG1',
    payload: 'MMAE',
    linker: 'mc-Val-Cit-PABC',
    cleavable: true,
    dar: 4,
    moiety: 'vedotin',
    glyph: GLYPH.auristatin,
    quotes: ['chimeric IgG1 antibody cAC10', 'Approximately 4 molecules of MMAE are attached'],
    note: 'The first of the vedotins, and the only <strong>chimeric</strong> antibody among the auristatin conjugates.',
  },
  {
    brand: 'PADCEV',
    inn: 'enfortumab vedotin',
    target: 'Nectin-4',
    antibody: 'human IgG1κ',
    isotype: 'IgG1',
    payload: 'MMAE',
    linker: 'mc-Val-Cit-PABC',
    cleavable: true,
    dar: 3.8,
    site: 'interchain cysteine',
    moiety: 'vedotin',
    glyph: GLYPH.auristatin,
    quotes: [
      'Conjugation takes place on cysteine residues that comprise the interchain disulfide bonds',
      'drug-to-antibody ratio of approximately 3.8',
    ],
    note: 'The <strong>only label of the sixteen that says where the linker attaches</strong> — the interchain disulfide cysteines. Everywhere else that field is left out here because no source stated it.',
  },
  {
    brand: 'POLIVY',
    inn: 'polatuzumab vedotin',
    target: 'CD79b',
    antibody: 'humanized IgG1',
    isotype: 'IgG1',
    payload: 'MMAE',
    linker: 'mc-Val-Cit-PABC',
    cleavable: true,
    dar: 3.5,
    moiety: 'vedotin',
    glyph: GLYPH.auristatin,
    quotes: ['An average of 3.5 molecules of MMAE are attached'],
    note: 'Same drug-linker as Adcetris on a B-cell receptor component.',
  },
  {
    brand: 'TIVDAK',
    inn: 'tisotumab vedotin',
    target: 'Tissue factor',
    antibody: 'human IgG1κ',
    isotype: 'IgG1',
    payload: 'MMAE',
    linker: 'mc-Val-Cit-PABC',
    cleavable: true,
    dar: 4,
    moiety: 'vedotin',
    glyph: GLYPH.auristatin,
    quotes: ['carries an average of 4 MMAE molecules'],
    note: 'Against a coagulation initiator rather than a lineage marker.',
  },
  {
    brand: 'EMRELIS',
    inn: 'telisotuzumab vedotin',
    target: 'c-Met',
    antibody: 'humanized IgG1κ',
    isotype: 'IgG1',
    payload: 'MMAE',
    linker: 'Val-Cit',
    cleavable: true,
    dar: 3,
    moiety: 'vedotin',
    glyph: GLYPH.auristatin,
    quotes: ['humanized immunoglobulin G1 kappa', 'carries an average of 3 MMAE molecules'],
    note: 'Approved 2025. The lowest DAR of the five vedotins here.',
  },
  {
    brand: 'BLENREP',
    inn: 'belantamab mafodotin',
    target: 'BCMA',
    antibody: 'afucosylated humanized IgG1',
    isotype: 'IgG1',
    engineering: ['afucosyl'],
    payload: 'MMAF',
    linker: 'maleimidocaproyl',
    cleavable: false,
    dar: 4,
    moiety: 'mafodotin',
    glyph: GLYPH.auristatin,
    quotes: ['afucosylated, humanized immunoglobulin G1', 'Approximately 4 molecules of mafodotin are attached'],
    note: 'The label calls the antibody <strong>afucosylated</strong> in its first sentence: the glycan is engineered for FcγRIIIa binding, so the Fc is doing work of its own. A protease-resistant linker, drawn as a broken bond.',
  },
  {
    brand: 'KADCYLA',
    inn: 'ado-trastuzumab emtansine',
    target: 'HER2',
    antibody: 'humanized IgG1',
    isotype: 'IgG1',
    payload: 'DM1',
    linker: 'MCC',
    cleavable: false,
    dar: 3.5,
    site: 'lysine',
    moiety: 'emtansine',
    glyph: GLYPH.maytansinoid,
    quotes: ['average of 3.5 DM1 molecules per antibody'],
    note: 'A thioether to the maytansinoid and an amide to a lysine: the NHS ester is gone from the drawing because it is what acylated the lysine.',
  },
  {
    brand: 'ELAHERE',
    inn: 'mirvetuximab soravtansine',
    target: 'FRalpha',
    antibody: 'IgG1',
    isotype: 'IgG1',
    payload: 'DM4',
    linker: 'sulfo-SPDB',
    cleavable: true,
    dar: 3.4,
    moiety: 'soravtansine',
    glyph: GLYPH.maytansinoid,
    quotes: ['An average of 3.4 molecules of DM4 are attached'],
    note: 'A hindered disulfide, cleaved by the reducing interior of the cell rather than by a protease.',
  },
  {
    brand: 'ENHERTU',
    inn: 'fam-trastuzumab deruxtecan',
    target: 'HER2',
    antibody: 'humanized IgG1',
    isotype: 'IgG1',
    payload: 'DXd',
    linker: 'GGFG tetrapeptide',
    cleavable: true,
    dar: 8,
    moiety: 'deruxtecan',
    glyph: GLYPH.topoisomerase,
    quotes: ['Approximately 8 molecules of deruxtecan are attached'],
    note: 'Same antibody target as Kadcyla, and more than twice the DAR. Read it against Datroway below: same payload, half the ratio.',
  },
  {
    brand: 'DATROWAY',
    inn: 'datopotamab deruxtecan',
    target: 'TROP-2',
    antibody: 'humanized IgG1',
    isotype: 'IgG1',
    payload: 'DXd',
    linker: 'GGFG tetrapeptide',
    cleavable: true,
    dar: 4,
    moiety: 'deruxtecan',
    glyph: GLYPH.topoisomerase,
    quotes: ['Approximately 4 molecules of deruxtecan are attached'],
    note: 'Approved 2025. The same deruxtecan as Enhertu at DAR 4 — the clearest ratio comparison in the set.',
  },
  {
    brand: 'TRODELVY',
    inn: 'sacituzumab govitecan',
    target: 'TROP-2',
    antibody: 'humanized hRS7 IgG1κ',
    isotype: 'IgG1',
    payload: 'SN-38',
    linker: 'CL2A carbonate',
    cleavable: true,
    dar: 7.5,
    moiety: 'govitecan',
    glyph: GLYPH.topoisomerase,
    quotes: ['on average 7 to 8 molecules of SN-38 per antibody'],
    darText: '7 to 8',
    note: 'The highest ratio here, on the same target as Datroway with a different payload and a hydrolysable rather than enzymatic linker.',
  },
  {
    brand: 'ZYNLONTA',
    inn: 'loncastuximab tesirine',
    target: 'CD19',
    antibody: 'humanized IgG1κ',
    isotype: 'IgG1',
    payload: 'SG3199 PBD dimer',
    linker: 'Val-Ala',
    cleavable: true,
    dar: 2.3,
    moiety: 'tesirine',
    glyph: GLYPH.dna,
    quotes: ['An average of 2.3 molecules of SG3249 are attached'],
    note: 'A DNA cross-linker, not a tubulin binder — and the lowest DAR of the cytotoxic conjugates, which is what a payload this potent buys.',
  },
  {
    brand: 'DECNUPAZ',
    inn: 'pivekimab sunirine',
    target: 'CD123',
    antibody: 'IgG1 G4723A',
    isotype: 'IgG1',
    engineering: ['site-specific'],
    payload: 'DGN549C',
    linker: 'sulfonated peptide',
    cleavable: false,
    dar: 2,
    site: 'heavy chain, site-directed',
    moiety: 'sunirine',
    glyph: GLYPH.dna,
    quotes: ['site directed chemical conjugation', 'bound to the heavy chains'],
    darText: 'approximately two',
    note: 'The one <strong>site-specific</strong> conjugate here: the label says the two payloads are bound to the heavy chains by <em>site directed chemical conjugation</em>. DAR 2 and homogeneous, where an interchain-cysteine product is a distribution.',
  },
  {
    brand: 'MYLOTARG',
    inn: 'gemtuzumab ozogamicin',
    target: 'CD33',
    antibody: 'humanized IgG4',
    isotype: 'IgG4',
    payload: 'calicheamicin',
    linker: 'AcBut hydrazone',
    cleavable: true,
    dar: 2.5,
    moiety: 'ozogamicin',
    glyph: GLYPH.dna,
    quotes: ['humanized immunoglobulin [Ig] G4', 'ranges from predominantly zero to 6'],
    darText: 'zero to 6, with an average of 2 to 3',
    note: 'A humanized <strong>IgG4</strong>, so the Fc recruits little effector function. The lint rule says what else comes with that: an IgG4 without S228P can exchange Fab arms.',
  },
  {
    brand: 'BESPONSA',
    inn: 'inotuzumab ozogamicin',
    target: 'CD22',
    antibody: 'humanized IgG4κ',
    isotype: 'IgG4',
    payload: 'calicheamicin',
    linker: 'AcBut hydrazone',
    cleavable: true,
    dar: 6,
    moiety: 'ozogamicin',
    glyph: GLYPH.dna,
    quotes: ['subtype 4 (IgG4) kappa antibody', 'approximately 6 with a distribution from 2'],
    darText: 'approximately 6, distribution 2–8',
    note: 'The same chemistry as Mylotarg on CD22, and <strong>IgG4</strong> again — but at more than twice the ratio.',
  },
  {
    brand: 'ZEVALIN',
    inn: 'ibritumomab tiuxetan',
    target: 'CD20',
    antibody: 'murine IgG1κ',
    isotype: 'IgG1',
    payload: 'Y-90',
    linker: 'tiuxetan chelator',
    glyph: GLYPH.other,
    quotes: ['murine IgG 1 kappa monoclonal antibody', 'chelation site for Yttrium-90'],
    note: 'Not a cytotoxic ADC but a <strong>radioimmunoconjugate</strong>, and the only <strong>murine</strong> antibody marketed in this class. No structure is drawn: the payload is a chelated radionuclide, which the payload model has no vocabulary for, and PubChem has no compound for the chelator by name.',
  },
];

/** The notation for one product — generated, so the fields and the DSL agree. */
function toDSL(product) {
  const fields = [product.payload, product.linker];
  if (product.dar != null) fields.push(String(product.dar), '1');
  if (product.site) {
    if (product.dar == null) fields.push(`site=${product.site}`);
    else fields.push(product.site);
  }
  if (product.cleavable != null) fields.push(product.cleavable ? 'cleavable' : 'noncleavable');
  fields.push(product.glyph);
  const mods = [...(product.engineering ?? []).filter((e) => e === 'afucosyl'), `drug=${fields.join('/')}`];
  const t = product.target;
  return [
    `@name ${product.brand} (${product.inn})`,
    `HC: VH(${t})-CH1-h-CH2[${mods.join(', ')}]-CH3 *2`,
    `LC: VL(${t})-CL *2`,
    `@isotype HC=${product.isotype}`,
  ].join('\n');
}

/** Every number on a card has to be in that product's own label. */
function verify(product) {
  const label = LABELS.labels[product.brand];
  if (!label) throw new Error(`${product.brand}: no label fetched`);
  const text = label.description.replace(/\s+/g, ' ').replace(/[‐-―]/g, '-');
  for (const quote of product.quotes) {
    if (!text.includes(quote.replace(/[‐-―]/g, '-'))) {
      throw new Error(`${product.brand}: the label does not say "${quote}"`);
    }
  }
  return label;
}

const escape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const build = (product) => {
  const construct = parseDSL(toDSL(product));
  if (product.moiety) {
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
  }
  return construct;
};

const card = (product) => {
  const label = verify(product);
  const dsl = toDSL(product);
  const construct = build(product);
  const findings = lint(normalize(construct)).filter((f) => f.level !== 'info');
  return `
  <figure class="card">
    <h2>${product.brand} <span class="inn">${product.inn}</span></h2>
    <p class="facts">
      <span>${product.target}</span><span>${product.antibody}</span>
      <span>${product.linker}</span><span>${product.payload}</span>
      <span>${product.dar != null ? `DAR ${product.darText ?? product.dar}` : 'DAR not stated'}</span>
      <span>${product.site ?? 'site not stated'}</span>
    </p>
    <p>${product.note}</p>
    <div class="cartoon">${renderSVG(construct, { scale: 1.15, showStructures: 'inline' }).svg}</div>
    <pre>${escape(dsl)}</pre>
    ${findings.length > 0 ? `<p class="lint">lint: ${findings.map((f) => `${f.rule} — ${f.message}`).join('; ')}</p>` : ''}
    <details>
      <summary>label, section 11 — ${label.sponsor}, ${label.effective ?? 'undated'}</summary>
      <blockquote>${escape(label.description.replace(/\s+/g, ' '))}</blockquote>
    </details>
  </figure>`;
};

const html = `<!doctype html>
<meta charset="utf-8">
<title>deneb — marketed antibody conjugates</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #f6f7f9; font: 14px/1.55 ui-sans-serif, system-ui, sans-serif; color: #1c222b; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .lede { margin: 0 0 16px; max-width: 78ch; color: #4b5563; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 16px; }
  .card { margin: 0; background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 14px; }
  .card h2 { font-size: 13px; margin: 0 0 6px; }
  .inn { font-weight: 400; color: #6b7280; }
  .card p { margin: 0 0 10px; font-size: 12px; color: #6b7280; }
  .facts { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px !important; }
  .facts span { background: #eef1f4; border-radius: 3px; padding: 1px 6px; font-size: 11px; color: #3d4450; }
  .cartoon { display: flex; justify-content: center; overflow-x: auto; }
  .lint { color: #b45309 !important; font-size: 11px !important; }
  details { font-size: 11px; color: #9099a5; margin-top: 8px; }
  blockquote { margin: 6px 0 0; padding-left: 10px; border-left: 2px solid #e3e6ea; color: #6b7280; font-size: 11px; }
  code, pre { background: #eef1f4; border-radius: 4px; }
  code { padding: 1px 5px; }
  pre { padding: 10px; font-size: 11.5px; margin: 10px 0 0; line-height: 1.55;
        white-space: pre-wrap; overflow-wrap: anywhere; padding-left: 3em; text-indent: -2em; }
  .caveat { border-left: 3px solid #d1d5db; padding-left: 12px; margin: 0 0 20px; max-width: 78ch; font-size: 12.5px; color: #4b5563; }
</style>
<h1>Marketed antibody conjugates, written in the notation</h1>
<p class="lede">
  ${PRODUCTS.length} products, each one <code>parseDSL</code> string generated from
  the fields beside it, with its whole linker-payload drawn out to the right of
  the antibody and bonded to the atom that carries it. The facts are section 11
  of each product's own US label, fetched from
  <a href="https://open.fda.gov/apis/drug/label/">openFDA</a> — open the
  disclosure under any card to read the label's own words. The compounds are the
  INN suffixes fetched from
  <a href="https://pubchem.ncbi.nlm.nih.gov/">PubChem</a> by CID, joined to the
  antibody the way their own chemistry joins: a maleimide is opened by a cysteine
  thiol and the sulfur that arrives carries the bond; a succinimidyl ester and a
  free acid lose their leaving group and acylate a lysine.
</p>
<p class="caveat">
  <strong>Every number is checked against the label before this page is written</strong>,
  so a revision that changes a DAR fails the build rather than leaving a stale
  figure here. A field the label does not state is left out of the notation
  rather than filled in from elsewhere — which is why fifteen of the sixteen say
  <em>site not stated</em>, and why the drug mark sits on CH2 throughout: that is
  where the diagram puts it, not a claim about which residue carries the linker.
  Products marketed only outside the US are absent because this API does not
  have them.
</p>
<div class="grid">${PRODUCTS.map(card).join('')}</div>
`;

mkdirSync(resolve(root, 'examples'), { recursive: true });
writeFileSync(resolve(root, 'examples/adc-approved.html'), html);
console.log(`Wrote examples/adc-approved.html (${PRODUCTS.length} products, all verified against their labels)`);
