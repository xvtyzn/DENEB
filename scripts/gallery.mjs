#!/usr/bin/env node
/**
 * Render every preset to SVG and write a single HTML page for eyeballing the
 * output against the published format figures. Run `npm run gallery`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const { renderSVG, renderLinear } = await import(resolve(root, 'dist/index.js'));
const { getPreset, presetNames } = await import(resolve(root, 'dist/presets.js'));

const cards = [];
let warnings = 0;

for (const name of presetNames()) {
  const construct = getPreset(name);
  const { svg, layout } = renderSVG(construct, { showLegend: true });
  const linear = renderLinear(construct, { trackWidth: 290, showTitle: false, showLegend: false });
  const diagnostics = layout.diagnostics.filter((d) => d.level !== 'info');
  warnings += diagnostics.length;
  cards.push(`
    <figure class="card">
      <div class="cartoon">${svg}</div>
      <div class="linear">${linear.svg}</div>
      <figcaption>
        <code>${name}</code>
        ${diagnostics
          .map((d) => `<span class="diag ${d.level}">${d.level}: ${escapeHtml(d.message)}</span>`)
          .join('')}
      </figcaption>
    </figure>`);
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>antibody-viewer gallery</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #f6f7f9; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #1c222b; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { margin: 0 0 24px; color: #6b7280; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }
  .card { margin: 0; background: #fff; border: 1px solid #e3e6ea; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .cartoon { display: flex; justify-content: center; align-items: flex-end; min-height: 210px; overflow-x: auto; }
  .linear { overflow-x: auto; border-top: 1px dashed #e3e6ea; padding-top: 8px; }
  figcaption { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  code { background: #eef1f4; padding: 1px 5px; border-radius: 4px; align-self: flex-start; }
  .diag { font-size: 11px; }
  .diag.warning { color: #a16207; }
  .diag.error { color: #b91c1c; }
</style>
<h1>antibody-viewer — preset gallery</h1>
<p class="sub">${presetNames().length} formats · ${warnings} non-info diagnostics</p>
<div class="grid">${cards.join('')}</div>
`;

mkdirSync(resolve(root, 'examples'), { recursive: true });
writeFileSync(resolve(root, 'examples/gallery.html'), html);
console.log(`Wrote examples/gallery.html (${presetNames().length} presets, ${warnings} warnings)`);

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
