#!/usr/bin/env node
/**
 * Fetch the Thera-SAbDab download and report what `fromTheraSAbDab` can draw.
 *
 * The database is the WHO's list of antibody therapeutics, and its `Format`
 * column is the closest thing the field has to a controlled vocabulary for
 * architecture. It is not vendored here: it is someone else's dataset, it is
 * revised as new INNs are proposed, and a snapshot inside the package would go
 * quietly stale. This fetches it, measures the coverage, and writes the small
 * sample the tests run against.
 *
 *   node scripts/fetch-thera.mjs [--sample]
 *
 * Source: https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/therasabdab/
 * Cite:   Raybould et al., Nucleic Acids Research 48:D383 (2020).
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URL_CSV =
  'https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/static/downloads/TheraSAbDab_SeqStruc_OnlineDownload.csv';

const { parseTheraSAbDabCsv, fromTheraSAbDab, THERA_FORMATS } = await import(
  resolve(root, 'dist/import.js')
);
const { normalize } = await import(resolve(root, 'dist/index.js'));

const response = await fetch(URL_CSV);
if (!response.ok) {
  console.error(`Could not fetch the download: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const csv = await response.text();
const rows = parseTheraSAbDabCsv(csv);
console.log(`Fetched ${rows.length} therapeutics on ${new Date().toISOString().slice(0, 10)}.\n`);

const drawn = [];
const unread = new Map();
let threw = 0;
for (const row of rows) {
  const { construct } = fromTheraSAbDab(row);
  if (construct.chains.length === 0) {
    unread.set(row.Format, (unread.get(row.Format) ?? 0) + 1);
    continue;
  }
  try {
    normalize(construct);
    drawn.push(row);
  } catch (error) {
    threw++;
    console.error(`  ${row.Therapeutic}: ${error.message}`);
  }
}

const pct = (n) => `${n}/${rows.length} (${((100 * n) / rows.length).toFixed(1)}%)`;
console.log(`drawable      ${pct(drawn.length)}   from ${THERA_FORMATS.length} format rules`);
console.log(`not covered   ${pct(rows.length - drawn.length - threw)}`);
if (threw) console.log(`failed        ${threw}`);

const stage = {};
for (const row of drawn) {
  const key = Object.keys(row).find((k) => k.startsWith('Highest_Clin_Trial'));
  stage[row[key]] = (stage[row[key]] ?? 0) + 1;
}
console.log('\nby highest clinical stage:');
for (const [k, v] of Object.entries(stage).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k || '(blank)'}`);
}

console.log('\nthe formats left unread, by how many rows each accounts for:');
for (const [format, n] of [...unread].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(n).padStart(5)}  ${format}`);
}
const tail = [...unread.values()].filter((n) => n === 1).length;
console.log(`  ${String(tail).padStart(5)}  …of which describe exactly one molecule each`);

if (process.argv.includes('--sample')) {
  // One row per covered format, plus a few the reader declines, so the tests
  // exercise the table against the real column values rather than invented ones.
  const header = Object.keys(rows[0]);
  const wanted = new Set(THERA_FORMATS);
  const picked = [];
  for (const row of rows) {
    if (wanted.has(row.Format)) (wanted.delete(row.Format), picked.push(row));
  }
  for (const row of rows) {
    if (picked.length < THERA_FORMATS.length + 3 && !THERA_FORMATS.includes(row.Format)) {
      picked.push(row);
    }
  }
  const quote = (v) => (/[",\n]/.test(v ?? '') ? `"${(v ?? '').replace(/"/g, '""')}"` : (v ?? ''));
  const out = [header.join(','), ...picked.map((r) => header.map((h) => quote(r[h])).join(','))];
  const path = resolve(root, 'tests/fixtures/thera-sample.csv');
  writeFileSync(path, out.join('\n') + '\n');
  console.log(`\nWrote ${picked.length} rows to tests/fixtures/thera-sample.csv`);
}
