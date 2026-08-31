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

// A string that only exists in the preset definitions.
const PRESET_MARKER = 'VH(CD3)';
const core = graph(resolve(root, 'dist/index.js'));
const leaked = core.filter((f) => readFileSync(f, 'utf8').includes(PRESET_MARKER));

if (leaked.length > 0) {
  console.error(
    `\nThe viewer entry is carrying the preset catalogue again (${leaked
      .map((f) => f.slice(f.lastIndexOf('/') + 1))
      .join(', ')}).\n` +
      'Check `manualChunks` in vite.config.ts and the re-exports in src/index.ts.',
  );
  process.exit(1);
}
console.log('\nViewer entry is clear of the optional areas.');
