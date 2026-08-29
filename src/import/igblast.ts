import type { Chain, Diagnostic, Domain, DomainType, Region } from '../model/types';
import { completeChain } from './anarci';
import type { ImportOptions, ImportResult } from './types';

const LOCUS_TYPES: Record<string, DomainType> = {
  IGH: 'VH',
  IGK: 'VL',
  IGL: 'VL',
  TRA: 'TCRa',
  TRB: 'TCRb',
};

const REGION_COLUMNS = ['fwr1', 'cdr1', 'fwr2', 'cdr2', 'fwr3', 'cdr3', 'fwr4'] as const;

/**
 * Read IgBLAST AIRR output (`-outfmt 19`).
 *
 * AIRR carries the sequence and the framework/CDR coordinates in the row, so
 * unlike ANARCI nothing extra has to be supplied and the regions come out
 * whatever numbering was used. Coordinates are already 1-based.
 */
export function fromIgBLAST(tsv: string, options: ImportOptions = {}): ImportResult {
  const diagnostics: Diagnostic[] = [];
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { construct: { chains: [] }, diagnostics };

  const header = lines[0]!.split('\t').map((h) => h.trim());
  const chains: Chain[] = [];

  for (const line of lines.slice(1)) {
    const values = line.split('\t');
    const cell = (name: string): string => values[header.indexOf(name)]?.trim() ?? '';

    const id = cell('sequence_id');
    if (!id) continue;
    if (cell('productive') === 'F') {
      diagnostics.push({
        level: 'warning',
        code: 'unproductive-rearrangement',
        message: `IgBLAST called "${id}" unproductive; it was imported anyway.`,
        ref: id,
      });
    }

    const locus = cell('locus') || cell('v_call').slice(0, 3);
    const type = LOCUS_TYPES[locus.toUpperCase()];
    if (!type) {
      diagnostics.push({
        level: 'warning',
        code: 'unknown-locus',
        message: `Locus "${locus}" on "${id}" is not one this reads.`,
        ref: id,
      });
      continue;
    }

    const sequence = cell('sequence') || options.sequences?.[id];
    const regions: Region[] = [];
    for (const name of REGION_COLUMNS) {
      const start = Number(cell(`${name}_start`));
      const end = Number(cell(`${name}_end`));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) continue;
      regions.push({ name: name.toUpperCase(), start, end, ...(options.scheme ? { scheme: options.scheme } : {}) });
    }

    const bounds = variableBounds(regions, cell);
    if (!bounds) {
      diagnostics.push({
        level: 'warning',
        code: 'no-variable-region',
        message: `No variable region coordinates on "${id}"; the row was skipped.`,
        ref: id,
      });
      continue;
    }

    const variable: Domain = { type, start: bounds.start, end: bounds.end };
    if (regions.length > 0) variable.regions = regions;

    const chain: Chain = { id, domains: [variable], ...(sequence ? { sequence } : {}) };
    completeChain(chain, options, diagnostics);
    chains.push(chain);
  }

  return { construct: { chains }, diagnostics };
}

/** The variable domain runs from the first framework to the last one IgBLAST found. */
function variableBounds(
  regions: Region[],
  cell: (name: string) => string,
): { start: number; end: number } | null {
  if (regions.length > 0) {
    return {
      start: Math.min(...regions.map((r) => r.start)),
      end: Math.max(...regions.map((r) => r.end)),
    };
  }
  const start = Number(cell('v_sequence_start'));
  const end = Number(cell('j_sequence_end')) || Number(cell('v_sequence_end'));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) return null;
  return { start, end };
}
