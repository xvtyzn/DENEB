#!/usr/bin/env node
/**
 * Fetches the DESCRIPTION section of every marketed ADC's US label.
 *
 * Section 11 of a prescribing information is where the facts a diagram needs
 * actually live: the isotype, the linker, the payload, and how many of them are
 * attached. openFDA serves it as text — about 1.5 kB per product — so this is a
 * fetch rather than a scrape, and what is written to disk is the label's own
 * words. Everything the gallery asserts is quoted from here.
 *
 * The brand list is the one thing no API gives: openFDA has no "list the ADCs"
 * query. It was seeded by asking for labels whose DESCRIPTION says
 * "antibody-drug conjugate", "drug-to-antibody" and similar, and then read.
 * Products marketed only outside the US (disitamab vedotin, cetuximab
 * sarotalocan) are not here, because this API does not have them.
 *
 *   npm run adc-labels
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BRANDS = [
  'ADCETRIS',
  'BESPONSA',
  'BLENREP',
  'DATROWAY',
  'DECNUPAZ',
  'ELAHERE',
  'EMRELIS',
  'ENHERTU',
  'KADCYLA',
  'LUMOXITI',
  'MYLOTARG',
  'PADCEV',
  'POLIVY',
  'TIVDAK',
  'TRODELVY',
  'ZEVALIN',
  'ZYNLONTA',
];

const out = {
  fetched: new Date().toISOString().slice(0, 10),
  source: 'openFDA drug/label.json, section 11 DESCRIPTION',
  labels: {},
};

for (const brand of BRANDS) {
  const url =
    'https://api.fda.gov/drug/label.json?search=openfda.brand_name:' +
    `%22${encodeURIComponent(brand)}%22&limit=1`;
  const response = await fetch(url);
  if (!response.ok) {
    console.log(`${brand.padEnd(10)} no record (HTTP ${response.status})`);
    continue;
  }
  const record = (await response.json()).results?.[0];
  const description = (record?.description ?? []).join(' ').trim();
  if (!description) {
    console.log(`${brand.padEnd(10)} no DESCRIPTION section`);
    continue;
  }
  out.labels[brand] = {
    generic: (record.openfda?.generic_name ?? ['?'])[0],
    sponsor: (record.openfda?.manufacturer_name ?? ['?'])[0],
    effective: record.effective_time ?? null,
    description,
  };
  console.log(`${brand.padEnd(10)} ${String(description.length).padStart(5)} chars`);
}

writeFileSync(resolve(root, 'scripts/lib/adc-labels.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nWrote scripts/lib/adc-labels.json (${Object.keys(out.labels).length} labels)`);
