#!/usr/bin/env node
/**
 * Writes `examples/panel.html`: a format panel, a parent/variant comparison and
 * the design findings for each. Run `npm run panel-demo`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { parseDSL } = await import(resolve(root, 'dist/index.js'));
const { getPreset } = await import(resolve(root, 'dist/presets.js'));
const { renderPanel, renderComparison } = await import(resolve(root, 'dist/panel.js'));
const { lint } = await import(resolve(root, 'dist/lint.js'));

const FORMATS = ['igg-kih', 'crossmab-ch1cl', 'duobody', 'dvd-ig', 'dart-fc', 'scfv-fc-kih'];

const panel = renderPanel(
  FORMATS.map((name) => ({ construct: getPreset(name), label: name })),
  { columns: 3, title: 'Bispecific formats, one palette' },
);

// A parent and the variant that answers what the linter says about it.
const parent = getPreset('igg-kih');
const variant = parseDSL(`
  @name IgG(kih), fixed
  HC1: VH(CD3)-CL[crossmab-ch1cl]-h-CH2[lala-pg]-CH3[knob]
  LC1: VL(CD3)-CH1[crossmab-ch1cl]
  HC2: VH(HER2)-CH1-h-CH2[lala-pg]-CH3[hole]
  LC2: VL(HER2)-CL
`);
const comparison = renderComparison(parent, variant, {
  labels: ['parent', 'CrossMab + silenced Fc'],
  title: 'What changed',
});

const findings = (construct) => {
  const list = lint(construct);
  if (list.length === 0) return '<li class="clean">Nothing to flag.</li>';
  return list
    .map(
      (f) =>
        `<li class="${f.level}"><b>${f.rule}</b> — ${f.message}${
          f.hint ? `<span class="hint">${f.hint}</span>` : ''
        }</li>`,
    )
    .join('');
};

const html = `<!doctype html>
<meta charset="utf-8">
<title>deneb — panels, diffs and design checks</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #f6f7f9; font: 14px/1.55 ui-sans-serif, system-ui, sans-serif; color: #1c222b; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .lede { margin: 0 0 20px; max-width: 74ch; color: #4b5563; font-size: 13px; }
  .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .card h2 { font-size: 13px; margin: 0 0 10px; }
  .figure { overflow-x: auto; }
  .columns { display: grid; grid-template-columns: 1fr minmax(280px, 380px); gap: 20px; align-items: start; }
  ul { list-style: none; margin: 0; padding: 0; font-size: 12px; }
  li { padding: 7px 9px; border-radius: 6px; margin-bottom: 5px; background: #fafbfc; }
  li.warning { color: #92400e; background: #fdf6e3; }
  li.info { color: #4b5563; }
  li.clean { color: #15803d; }
  .hint { display: block; opacity: .8; margin-top: 3px; }
  .changes b { font-weight: 600; }
</style>
<h1>Panels, diffs and design checks</h1>
<p class="lede">
  A panel assigns colours once across the whole figure, so a target is the same colour in
  every cell — rendered one at a time, each construct numbers its targets from scratch and
  the second cell's CD3 comes out the colour of the first cell's HER2. The design checks
  come from <code>deneb/lint</code>; every finding carries the domains it is about
  in the form the diagram's <code>highlight</code> takes.
</p>

<div class="card">
  <h2>renderPanel</h2>
  <div class="figure">${panel.svg}</div>
</div>

<div class="card columns">
  <div>
    <h2>renderComparison</h2>
    <div class="figure">${comparison.svg}</div>
  </div>
  <div>
    <h2>Changes</h2>
    <ul class="changes">${comparison.changes
      .map((c) => `<li><b>${c.kind}</b> — ${c.summary}</li>`)
      .join('')}</ul>
  </div>
</div>

<div class="card columns">
  <div>
    <h2>Design check — parent</h2>
    <ul>${findings(parent)}</ul>
  </div>
  <div>
    <h2>…and the variant</h2>
    <ul>${findings(variant)}</ul>
  </div>
</div>
`;

mkdirSync(resolve(root, 'examples'), { recursive: true });
writeFileSync(resolve(root, 'examples/panel.html'), html);
console.log('Wrote examples/panel.html');
