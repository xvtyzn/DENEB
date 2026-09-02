#!/usr/bin/env node
/**
 * Draw the approved antibody therapeutics straight out of Thera-SAbDab.
 *
 * Nothing here knows anything about any particular drug: every diagram is the
 * database's own `Format`, `CH1 Isotype`, `VD LC` and `Target` columns put
 * through `fromTheraSAbDab`. What the source does not say is printed under each
 * molecule rather than drawn as if it did.
 *
 *   node scripts/thera-gallery.mjs [--stage Approved] [--limit 60]
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

const { parseTheraSAbDabCsv, fromTheraSAbDab } = await import(resolve(root, 'dist/import.js'));
const { renderSVG } = await import(resolve(root, 'dist/index.js'));
const { lint } = await import(resolve(root, 'dist/lint.js'));

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const stage = arg('stage', 'Approved');
const limit = Number(arg('limit', '60'));

const response = await fetch(URL_CSV);
if (!response.ok) {
  console.error(`Could not fetch the download: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const fetched = new Date().toISOString().slice(0, 10);
const rows = parseTheraSAbDabCsv(await response.text());
const stageKey = Object.keys(rows[0]).find((k) => k.startsWith('Highest_Clin_Trial'));

const escape = (s) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const cards = [];
let skipped = 0;
for (const row of rows) {
  if (!row[stageKey]?.startsWith(stage)) continue;
  const { construct, diagnostics } = fromTheraSAbDab(row);
  if (construct.chains.length === 0) {
    skipped++;
    continue;
  }
  if (cards.length >= limit) continue;
  const { svg } = renderSVG(construct, { showLegend: true, scale: 1.15, showTitle: false });
  const notStated = diagnostics.filter((d) => d.code === 'thera-not-stated');
  const findings = lint(construct).filter((f) => f.level !== 'info');
  cards.push(`
    <figure class="card">
      <div class="art">${svg}</div>
      <figcaption>
        <b>${escape(row.Therapeutic)}</b>
        <span class="fmt">${escape(row.Format)}</span>
        <span class="meta">${escape(row.Target)}</span>
        ${notStated.map((d) => `<span class="note">${escape(d.message)}</span>`).join('')}
        ${findings.map((f) => `<span class="lint">${escape(f.rule)} — ${escape(f.message)}</span>`).join('')}
      </figcaption>
    </figure>`);
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>deneb — Thera-SAbDab</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #f6f7f9; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #1c222b; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { margin: 0 0 20px; color: #6b7280; max-width: 60em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
  .card { margin: 0; background: #fff; border: 1px solid #e3e6ea; border-radius: 8px; padding: 12px; }
  .art { display: flex; justify-content: center; min-height: 150px; }
  figcaption { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; font-size: 12px; }
  .fmt { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #374151; }
  .meta { color: #6b7280; }
  .note { color: #8a6d1f; }
  .lint { color: #9a3412; }
  a { color: inherit; }
</style>
<h1>Antibody therapeutics, drawn from Thera-SAbDab</h1>
<p class="sub">
  ${cards.length} of the ${stage.toLowerCase()} therapeutics, drawn by
  <code>fromTheraSAbDab</code> from the database's own <code>Format</code>,
  <code>CH1 Isotype</code>, <code>VD LC</code> and <code>Target</code> columns —
  ${skipped} more are recorded in a free-text format this reader declines rather
  than guesses at. Amber notes are what the source does not state; red are
  <code>deneb/lint</code> findings, which here mostly say that the database
  records that a molecule is bispecific without recording how its chains were
  made to pair. Fetched ${fetched} from
  <a href="https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/therasabdab/">Thera-SAbDab</a>
  (Raybould et al., <i>Nucleic Acids Research</i> 48:D383, 2020).
</p>
<div class="grid">${cards.join('')}</div>
`;

writeFileSync(resolve(root, 'examples/thera.html'), html);
console.log(`Wrote examples/thera.html (${cards.length} drawn, ${skipped} declined, stage "${stage}")`);
