import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest runs from the project root.
const root = process.cwd();

/**
 * Every module reachable from an entry point by following its imports.
 *
 * The package is meant to be embedded, so what an entry pulls in is part of its
 * contract: a page that only renders a diagram should not end up carrying the
 * preset catalogue, the linter or the bioinformatics importers. Tree-shaking
 * might remove them, but "might" is not a guarantee — the module graph is.
 */
function reachableFrom(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    const specifiers = [
      ...source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g),
    ].map((m) => m[1]!);

    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue; // node_modules / peer deps
      const target = resolveModule(resolve(dirname(file), specifier));
      if (target) queue.push(target);
    }
  }

  return [...seen].map((f) => relative(root, f));
}

function resolveModule(base: string): string | null {
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      // A directory exists at `base` for `./layout`; only files count.
      if (candidate === base && !/\.tsx?$/.test(candidate)) continue;
      return candidate;
    }
  }
  return null;
}

/** Directories the viewer entry must never pull in. */
const OPTIONAL_AREAS = [
  'src/presets/',
  'src/edit/',
  'src/lint/',
  'src/diff/',
  'src/import/',
  'src/react/',
  'src/abml/',
  'src/veritas/',
  'src/chem/',
];

describe('entry point boundaries', () => {
  const core = reachableFrom('src/index.ts');

  it('the viewer entry carries only the viewer', () => {
    const leaked = core.filter((f) => OPTIONAL_AREAS.some((area) => f.startsWith(area)));
    expect(leaked, 'these are behind their own subpath exports').toEqual([]);
  });

  it('the viewer entry does reach what it needs', () => {
    for (const area of ['src/model/', 'src/dsl/', 'src/layout/', 'src/render/', 'src/theme/']) {
      expect(core.some((f) => f.startsWith(area)), area).toBe(true);
    }
  });

  it('the React entry does not drag in the presets', () => {
    const react = reachableFrom('src/react/index.ts');
    expect(react.filter((f) => f.startsWith('src/presets/'))).toEqual([]);
  });

  it('the React entry does not drag in the editor or the linter', () => {
    // A page that only shows a diagram should not download the edit engine to
    // do it. `deneb/react/editor` is where that lives.
    const react = reachableFrom('src/react/index.ts');
    for (const area of ['src/edit/', 'src/lint/']) {
      expect(react.filter((f) => f.startsWith(area)), area).toEqual([]);
    }
  });

  it('the editor entry does not drag in the renderer', () => {
    const edit = reachableFrom('src/edit/index.ts');
    for (const area of ['src/render/', 'src/react/', 'src/presets/']) {
      expect(edit.filter((f) => f.startsWith(area)), area).toEqual([]);
    }
    // `insertionAnchors` is typed in terms of a `LayoutResult`, but only in
    // terms of it: this walk counts `import type`, which erases, so the file
    // shows up here while nothing of the layout ships. `npm run size` reads the
    // built graph and is the check that this stays true.
    expect(edit.filter((f) => f.startsWith('src/layout/'))).toEqual(['src/layout/types.ts']);
  });

  it.each([
    ['src/presets/index.ts', ['src/render/', 'src/layout/', 'src/react/']],
  ])('%s stays clear of %s', (entry, forbidden) => {
    if (!existsSync(resolve(root, entry))) return;
    const reached = reachableFrom(entry);
    for (const area of forbidden) {
      expect(reached.filter((f) => f.startsWith(area)), `${entry} -> ${area}`).toEqual([]);
    }
  });
});
