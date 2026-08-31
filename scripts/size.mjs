#!/usr/bin/env node
/**
 * What each entry point actually costs a consumer, and a check that the
 * optional areas have not leaked back into the viewer.
 *
 * The package is meant to be embedded, so a page that only renders a diagram
 * must not end up carrying the preset catalogue or any of the optional tools.
 * `tests/boundaries.test.ts` guards that at the source level; this guards the
 * built output, where a bundler's chunking can undo it.
 *
 *   npm run size
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every built file an entry pulls in, by following its imports. */
function graph(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, 'utf8').matchAll(/from\s*['"]([^'"]+)['"]/g)) {
      if (m[1].startsWith('.')) queue.push(join(dirname(file), m[1]));
    }
  }
  return [...seen];
}

function weigh(files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const bytes = readFileSync(file);
    raw += bytes.length;
    gzip += gzipSync(bytes).length;
  }
  return { raw, gzip };
}

const entries = ['index', 'react', 'presets', 'lint', 'diff', 'panel', 'import', 'abml', 'veritas', 'chem']
  .map((name) => ({ name, file: resolve(root, `dist/${name}.js`) }))
  .filter((e) => existsSync(e.file));

if (entries.length === 0) {
  console.error('No build found. Run `npm run build` first.');
  process.exit(1);
}

console.log('entry        raw      gzip    chunks');
for (const entry of entries) {
  const files = graph(entry.file);
  const { raw, gzip } = weigh(files);
  const names = files.map((f) => f.slice(f.lastIndexOf('/') + 1)).join(' + ');
  console.log(
    `${entry.name.padEnd(11)}${String(raw).padStart(7)}${String(gzip).padStart(9)}    ${names}`,
  );
}

const core = graph(resolve(root, 'dist/index.js'));
const coreText = core.map((file) => readFileSync(file, 'utf8')).join('\n');
const optionalMarkers = [
  ['react', 'antibody-sequence'],
  ['presets', 'VH(CD3)'],
  ['lint', 'igg4-fab-arm-exchange'],
  ['diff', 'chain-removed'],
  ['panel', 'dn-panel'],
  ['import', 'IgBLAST called'],
  ['abml', 'AbML'],
  ['veritas', 'VERITAS'],
  ['chem', 'dn-depiction'],
];

const stale = optionalMarkers.filter(([name, marker]) => {
  const entry = entries.find((candidate) => candidate.name === name);
  return !entry || !graph(entry.file).some((file) => readFileSync(file, 'utf8').includes(marker));
});
if (stale.length > 0) {
  console.error(`\nOptional-boundary markers need updating: ${stale.map(([name]) => name).join(', ')}`);
  process.exit(1);
}

const leaked = optionalMarkers.filter(([, marker]) => coreText.includes(marker));

if (leaked.length > 0) {
  console.error(
    `\nThe viewer entry is carrying optional areas again (${leaked
      .map(([name]) => name)
      .join(', ')}).\n` +
      'Check `manualChunks` in vite.config.ts and the re-exports in src/index.ts.',
  );
  process.exit(1);
}

const CORE_GZIP_BUDGET = 32 * 1024;
const coreWeight = weigh(core);
if (coreWeight.gzip > CORE_GZIP_BUDGET) {
  console.error(
    `\nViewer entry is ${coreWeight.gzip} bytes gzipped; budget is ${CORE_GZIP_BUDGET}.`,
  );
  process.exit(1);
}
console.log(
  `\nViewer entry is clear of all optional areas and within its ${CORE_GZIP_BUDGET}-byte gzip budget.`,
);
