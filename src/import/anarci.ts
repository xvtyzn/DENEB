import type { Chain, Diagnostic, Domain, DomainType, Region } from '../model/types';
import { identifyConstantRegion } from './identify';
import type { ImportOptions, ImportResult } from './types';

/** ANARCI writes these before the numbering columns. */
const META_COLUMNS = new Set([
  'Id',
  'domain_no',
  'hmm_species',
  'chain_type',
  'e-value',
  'score',
  'seqstart_index',
  'seqend_index',
  'identity_species',
  'v_gene',
  'v_identity',
  'j_gene',
  'j_identity',
]);

const CHAIN_TYPES: Record<string, DomainType> = {
  H: 'VH',
  K: 'VL',
  L: 'VL',
  A: 'TCRa',
  B: 'TCRb',
};

/**
 * CDR positions in IMGT numbering, which are fixed by the scheme itself.
 *
 * Only IMGT is read here. Kabat and Chothia place their loops differently and
 * differently again per chain type; rather than encode ranges from memory and
 * quietly mislabel someone's CDRs, anything else imports the variable domain
 * and says why the regions were left out.
 */
const IMGT_CDRS: { name: string; from: number; to: number }[] = [
  { name: 'CDR1', from: 27, to: 38 },
  { name: 'CDR2', from: 56, to: 65 },
  { name: 'CDR3', from: 105, to: 117 },
];

/**
 * Read `ANARCI --csv` output.
 *
 * ANARCI numbers variable domains and stops there, so the rest of each chain is
 * named by matching it against the human constant regions — see
 * `identifyConstantRegion`. Nothing is invented: a stretch that matches nothing
 * is handed over as an unnamed segment with its residue range intact.
 */
export function fromANARCI(csv: string, options: ImportOptions = {}): ImportResult {
  const diagnostics: Diagnostic[] = [];
  const rows = parseCsv(csv);
  if (rows.length === 0) return { construct: { chains: [] }, diagnostics };

  const header = rows[0]!;
  const positions = header
    .map((name, index) => ({ name, index }))
    .filter((c) => !META_COLUMNS.has(c.name) && c.name !== '');

  const scheme = options.scheme ?? 'imgt';
  if (scheme !== 'imgt') {
    diagnostics.push({
      level: 'info',
      code: 'regions-skipped',
      message: `CDR positions are only read for IMGT numbering; "${scheme}" domains were imported without regions.`,
    });
  }

  const byChain = new Map<string, Chain>();
  for (const row of rows.slice(1)) {
    const cell = (name: string): string => row[header.indexOf(name)] ?? '';
    const id = cell('Id');
    if (!id) continue;

    const sequence = options.sequences?.[id];
    const type = CHAIN_TYPES[cell('chain_type')];
    if (!type) {
      diagnostics.push({
        level: 'warning',
        code: 'unknown-chain-type',
        message: `Chain type "${cell('chain_type')}" on "${id}" is not one this reads.`,
        ref: id,
      });
      continue;
    }

    // ANARCI indexes the sequence from zero; the model counts residues from one.
    const start = Number(cell('seqstart_index')) + 1;
    const end = Number(cell('seqend_index')) + 1;
    const variable: Domain = { type, start, end };
    if (scheme === 'imgt') {
      const regions = imgtRegions(row, positions, header, start);
      if (regions.length > 0) variable.regions = regions;
    }

    const chain: Chain =
      byChain.get(id) ?? { id, domains: [], ...(sequence ? { sequence } : {}) };
    chain.domains.push(variable);
    byChain.set(id, chain);
  }

  const chains = [...byChain.values()];
  for (const chain of chains) completeChain(chain, options, diagnostics);
  return { construct: { chains }, diagnostics };
}

/**
 * Map IMGT positions back to residue ranges.
 *
 * A numbering column is blank where the scheme's position is not used by this
 * sequence, so a loop's extent has to be read off the columns that are filled
 * rather than assumed from the scheme's bounds.
 */
function imgtRegions(
  row: string[],
  positions: { name: string; index: number }[],
  header: string[],
  start: number,
): Region[] {
  // Walk the numbering columns in order; each filled one is the next residue.
  let offset = 0;
  const at = new Map<number, number[]>();
  for (const column of positions) {
    const value = row[column.index];
    if (!value || value === '-') continue;
    const number = parseInt(column.name, 10);
    if (Number.isNaN(number)) continue;
    if (!at.has(number)) at.set(number, []);
    at.get(number)!.push(start + offset);
    offset++;
  }
  void header;

  const regions: Region[] = [];
  for (const cdr of IMGT_CDRS) {
    const residues: number[] = [];
    for (let n = cdr.from; n <= cdr.to; n++) residues.push(...(at.get(n) ?? []));
    if (residues.length === 0) continue;
    regions.push({
      name: cdr.name,
      start: Math.min(...residues),
      end: Math.max(...residues),
      scheme: 'imgt',
    });
  }
  return regions;
}

/**
 * Name whatever follows the variable domain, and keep the rest as-is.
 *
 * Shared by both importers: they differ in how they find the variable domain,
 * not in what to do with the remainder.
 */
export function completeChain(
  chain: Chain,
  options: ImportOptions,
  diagnostics: Diagnostic[],
): void {
  const sequence = chain.sequence;
  if (!sequence) return;

  chain.domains.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const last = chain.domains[chain.domains.length - 1];
  const tailStart = (last?.end ?? 0) + 1;
  if (tailStart > sequence.length) return;

  const kind = chain.domains.some((d) => d.type === 'VH') ? 'heavy' : 'light';
  if (options.identifyConstantRegions !== false) {
    const match = identifyConstantRegion(
      sequence,
      tailStart,
      kind,
      options.minIdentity ?? 0.7,
    );
    if (match) {
      chain.domains.push(...match.domains);
      chain.kind = kind;
      diagnostics.push({
        level: 'info',
        code: 'constant-region-identified',
        message: `Chain "${chain.id}" matches ${match.reference.uniProtId} (${match.reference.accession}) at ${(
          match.identity * 100
        ).toFixed(1)}% identity.`,
        ref: chain.id,
      });
      const covered = match.domains[match.domains.length - 1]?.end ?? tailStart - 1;
      if (covered < sequence.length) {
        chain.domains.push(unnamed(covered + 1, sequence.length));
      }
      return;
    }
    diagnostics.push({
      level: 'info',
      code: 'constant-region-unmatched',
      message: `Residues ${tailStart}–${sequence.length} of "${chain.id}" match no reference constant region and were left unnamed.`,
      ref: chain.id,
    });
  }
  chain.domains.push(unnamed(tailStart, sequence.length));
}

const unnamed = (start: number, end: number): Domain => ({
  type: 'custom',
  label: '?',
  start,
  end,
});

/** A CSV reader that handles quoted fields; ANARCI's gene names contain commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field.trim());
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field.trim());
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}
