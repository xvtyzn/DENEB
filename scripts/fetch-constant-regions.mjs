#!/usr/bin/env node
/**
 * Regenerate `src/import/constant-regions.ts` from UniProt.
 *
 * The constant regions are reference data, not something to type from memory:
 * this fetches the sequences and the CH1 / hinge / CH2 / CH3 boundaries from the
 * entries themselves so the file can always be traced back and rebuilt.
 *
 *   node scripts/fetch-constant-regions.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ENTRIES = [
  { accession: 'P01857', isotype: 'IgG1', kind: 'heavy' },
  { accession: 'P01859', isotype: 'IgG2', kind: 'heavy' },
  { accession: 'P01861', isotype: 'IgG4', kind: 'heavy' },
  { accession: 'P01834', isotype: 'kappa', kind: 'light' },
  { accession: 'P0CG04', isotype: 'lambda', kind: 'light' },
];

/** UniProt marks CH2 as starting a few residues after the hinge ends, and its
 * IgG2 regions overlap by one. Segments are made contiguous so a sequence can
 * be split without gaps: each runs to the residue before the next one starts. */
function segmentsFor(features, sequenceLength, kind) {
  if (kind === 'light') return [{ type: 'CL', start: 1, end: sequenceLength }];

  const wanted = { CH1: 'CH1', Hinge: 'hinge', CH2: 'CH2', CH3: 'CH3' };
  const found = [];
  for (const f of features) {
    if (f.type !== 'Region') continue;
    const name = (f.description ?? '').split(';')[0].trim();
    if (!(name in wanted)) continue;
    found.push({ type: wanted[name], start: f.location.start.value, end: f.location.end.value });
  }
  found.sort((a, b) => a.start - b.start);

  return found.map((seg, i) => ({
    type: seg.type,
    start: seg.start,
    end: i < found.length - 1 ? found[i + 1].start - 1 : seg.end,
  }));
}

const references = [];
for (const entry of ENTRIES) {
  const url = `https://rest.uniprot.org/uniprotkb/${entry.accession}.json?fields=accession,id,sequence,ft_region`;
  const data = await (await fetch(url)).json();
  const full = data.sequence.value;
  const segments = segmentsFor(data.features ?? [], full.length, entry.kind);
  // Everything past the last segment is the membrane-anchored tail, which a
  // secreted antibody does not have.
  const end = segments[segments.length - 1].end;
  references.push({
    ...entry,
    uniProtId: data.uniProtkbId,
    sequence: full.slice(0, end),
    segments,
  });
}

const body = references
  .map(
    (r) => `  {
    isotype: '${r.isotype}',
    kind: '${r.kind}',
    accession: '${r.accession}',
    uniProtId: '${r.uniProtId}',
    sequence:
      '${r.sequence}',
    segments: [
${r.segments.map((s) => `      { type: '${s.type}', start: ${s.start}, end: ${s.end} },`).join('\n')}
    ],
  },`,
  )
  .join('\n');

writeFileSync(
  resolve(root, 'src/import/constant-regions.ts'),
  `import type { DomainType } from '../model/types';

/**
 * Human constant regions, used to name the part of a chain that a V-region
 * caller leaves unannotated.
 *
 * GENERATED — do not edit by hand. Sequences and the CH1 / hinge / CH2 / CH3
 * boundaries come from the UniProt entries named below; regenerate with
 * \`node scripts/fetch-constant-regions.mjs\`. Fetched ${new Date().toISOString().slice(0, 10)}.
 *
 * Each sequence is the secreted form: it stops at the end of the last constant
 * domain, so the membrane anchor of the heavy chains is not included.
 */
export interface ConstantSegment {
  type: DomainType;
  /** 1-based, inclusive, within \`sequence\`. */
  start: number;
  end: number;
}

export interface ConstantReference {
  isotype: string;
  kind: 'heavy' | 'light';
  accession: string;
  uniProtId: string;
  sequence: string;
  segments: ConstantSegment[];
}

export const CONSTANT_REFERENCES: readonly ConstantReference[] = [
${body}
];
`,
);

console.log(
  `Wrote src/import/constant-regions.ts (${references
    .map((r) => `${r.isotype} ${r.sequence.length} aa`)
    .join(', ')})`,
);
