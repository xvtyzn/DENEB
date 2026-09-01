#!/usr/bin/env node
/**
 * Renders the figures the READMEs embed, into docs/images/.
 *
 * Each one is written as SVG — that is what the library produces — and then
 * rasterised to PNG, because the READMEs point at the PNGs: GitHub renders
 * them identically on every theme, whereas its SVG sanitiser is a moving
 * target for a file this size.
 *
 * Rasterising needs a browser. Playwright is not a dependency of this repo, so
 * if it is missing the SVGs are still written and the PNGs are left alone —
 * install it (`npm i -D playwright && npx playwright install chromium`) when
 * you need to regenerate them.
 *
 *   npm run readme-images
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structureFor } from './lib/linkers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs/images');
mkdirSync(out, { recursive: true });

const { renderSVG, renderLinear, parseDSL } = await import(resolve(root, 'dist/index.js'));
const { getPreset } = await import(resolve(root, 'dist/presets.js'));
const { renderPanel, renderComparison } = await import(resolve(root, 'dist/panel.js'));

/** A spread of formats wide enough to show that one palette runs through them. */
const HERO = ['igg-kih', 'crossmab-ch1cl', 'dvd-ig', 'bite', 'dart-fc', 'vhh-igg-kih'];

const adc = parseDSL(`
  @name Anti-HER2 ADC, interchain-cysteine conjugate
  HC: VH(HER2)-CH1-h-CH2-CH3 *2
  LC: VL(HER2)-CL *2
`);
// The interchain cysteines a cleavable mc-vc linker is conjugated to sit in the
// hinge, so that is the domain the bond leaves from. The depiction goes in the
// legend rather than inline: at full size it would run through the Fab arms.
adc.chains[0].domains[2].modifications = [
  {
    type: 'drug',
    payload: {
      name: 'MMAE',
      linker: 'mc-Val-Cit-PAB',
      site: 'interchain cysteine',
      cleavable: true,
      dar: 4,
      count: 1,
      attachment: 'S',
      structure: structureFor('vedotin', { side: 'right', size: 180 }).structure,
    },
  },
];

const marketedAdc = (dsl, moiety) => {
  const construct = parseDSL(dsl);
  const { structure, attachment } = structureFor(moiety, { side: 'right' });
  for (const chain of construct.chains) {
    for (const domain of chain.domains) {
      for (const modification of domain.modifications ?? []) {
        if (!modification.payload) continue;
        modification.payload.structure = structure;
        modification.payload.attachment = attachment;
      }
    }
  }
  return construct;
};

const kadcyla = marketedAdc(
  `
    @name KADCYLA (ado-trastuzumab emtansine)
    HC: VH(HER2)-CH1-h-CH2[drug=DM1/MCC/3.5/1/noncleavable]-CH3 *2
    LC: VL(HER2)-CL *2
    @isotype HC=IgG1
  `,
  'emtansine',
);

const trodelvy = marketedAdc(
  `
    @name TRODELVY (sacituzumab govitecan)
    HC: VH(TROP-2)-CH1-h-CH2[drug=SN-38/CL2A carbonate/7.5/1/cleavable]-CH3 *2
    LC: VL(TROP-2)-CL *2
    @isotype HC=IgG1
  `,
  'govitecan',
);

// The parent, and the variant that answers what the linter says about it.
const parent = getPreset('igg-kih');
const fixed = parseDSL(`
  @name IgG(kih), fixed
  HC1: VH(CD3)-CL[crossmab-ch1cl]-h-CH2[lala-pg]-CH3[knob]
  LC1: VL(CD3)-CH1[crossmab-ch1cl]
  HC2: VH(HER2)-CH1-h-CH2[lala-pg]-CH3[hole]
  LC2: VL(HER2)-CL
`);

const FIGURES = [
  {
    name: 'formats',
    svg: renderPanel(
      HERO.map((name) => ({ construct: getPreset(name), label: name })),
      { columns: 3, title: 'One palette across a figure' },
    ).svg,
  },
  {
    name: 'bispecific',
    svg: renderSVG(getPreset('igg-kih'), { scale: 2.4 }).svg,
  },
  {
    name: 'adc',
    svg: renderSVG(adc, { scale: 2.2 }).svg,
  },
  {
    name: 'adc-layouts',
    svg: renderPanel(
      [
        {
          construct: kadcyla,
          label: 'KADCYLA · MCC–DM1',
          options: { showStructures: 'inline' },
        },
        {
          construct: trodelvy,
          label: 'TRODELVY · CL2A–SN-38',
          options: { showStructures: 'inline' },
        },
      ],
      { columns: 2, title: 'Preserved 2D coordinates and repeat notation', sharedLegend: false },
    ).svg,
  },
  {
    name: 'linear',
    svg: renderLinear(getPreset('trispecific-igg-scfv'), { showLabels: true }).svg,
  },
  {
    name: 'diff',
    svg: renderComparison(parent, fixed, {
      labels: ['parent', 'CrossMab + silenced Fc'],
      title: 'What changed',
    }).svg,
  },
];

for (const figure of FIGURES) {
  writeFileSync(join(out, `${figure.name}.svg`), figure.svg);
}
console.log(`Wrote ${FIGURES.length} SVGs to docs/images/`);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('Playwright is not installed; PNGs left as they are.');
  process.exit(0);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const figure of FIGURES) {
    // A white ground and a little padding, so the figure reads the same in a
    // dark README as in a light one.
    await page.setContent(
      `<body style="margin:0;background:#fff">
         <div id="f" style="display:inline-block;padding:14px;background:#fff">${figure.svg}</div>
       </body>`,
    );
    await page.locator('#f').screenshot({ path: join(out, `${figure.name}.png`) });
  }
  console.log(`Wrote ${FIGURES.length} PNGs at 2x`);
} finally {
  await browser.close();
}
