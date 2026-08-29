/**
 * Type-check a throwaway consumer against every subpath this package declares.
 *
 * `npm test` proves the source is sound and `npm run size` proves the entries
 * stay separate, but neither touches the `exports` map — a wrong path or a
 * missing declaration file only shows up in someone else's project. This
 * builds one and compiles it under NodeNext + strict, which is the resolution
 * mode most likely to reject a malformed map.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'antibody-viewer-consumer-'));

const TS = `
import { renderSVG, parseDSL, normalize, type Construct } from 'antibody-viewer';
import { getPreset, presetNames } from 'antibody-viewer/presets';
import { lint } from 'antibody-viewer/lint';
import { diff } from 'antibody-viewer/diff';
import { renderPanel, renderComparison } from 'antibody-viewer/panel';
import { fromANARCI, fromIgBLAST } from 'antibody-viewer/import';
import { parseAbML, toAbML } from 'antibody-viewer/abml';

const construct: Construct = getPreset(presetNames()[0]!);
renderSVG(construct);
normalize(parseDSL('HC: VH-CH1'));
lint(construct);
diff(construct, construct);
renderPanel([{ construct }]);
renderComparison(construct, construct);
fromANARCI('');
fromIgBLAST('');
parseAbML(toAbML(construct));
`;

const TSX = `
import { AntibodyViewer, AntibodyLinear, AntibodyLegend, AntibodySequence, SceneSvg } from 'antibody-viewer/react';
export const App = () => (
  <>
    <AntibodyViewer dsl="HC: VH-CH1" />
    <AntibodyLinear dsl="HC: VH-CH1" />
    <AntibodyLegend dsl="HC: VH-CH1" />
    <AntibodySequence dsl="HC: VH-CH1" />
    <SceneSvg scene={{ width: 1, height: 1, children: [] }} />
  </>
);
`;

try {
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        strict: true, noEmit: true, target: 'ES2022',
        module: 'NodeNext', moduleResolution: 'NodeNext',
        jsx: 'react-jsx', skipLibCheck: true, lib: ['ES2022', 'DOM'],
      },
      include: ['src'],
    }),
  );
  writeFileSync(join(dir, 'src/main.ts'), TS);
  writeFileSync(join(dir, 'src/app.tsx'), TSX);
  symlinkSync(root, join(dir, 'node_modules/antibody-viewer'), 'dir');
  for (const dep of ['react', 'react-dom', '@types']) {
    symlinkSync(join(root, 'node_modules', dep), join(dir, 'node_modules', dep), 'dir');
  }

  execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(dir, 'tsconfig.json')], {
    stdio: 'inherit',
  });
  console.log('All subpaths resolve from a consumer under NodeNext + strict.');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
