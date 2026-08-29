import { describe, expect, it } from 'vitest';
import { normalize } from '../src/index';
import { CONSTANT_REFERENCES, fromANARCI, fromIgBLAST, identifyConstantRegion } from '../src/import/index';

const igg1 = CONSTANT_REFERENCES.find((r) => r.isotype === 'IgG1')!;
const kappa = CONSTANT_REFERENCES.find((r) => r.isotype === 'kappa')!;

/** A stand-in variable domain: the importers only care about its length. */
const V_HEAVY = 'QVQLVQSGAEVKKPGASVKVSCKAS'.repeat(5).slice(0, 120);
const V_LIGHT = 'DIQMTQSPSSLSASVGDRVTITCRAS'.repeat(5).slice(0, 108);

const HEAVY = V_HEAVY + igg1.sequence;
const LIGHT = V_LIGHT + kappa.sequence;

/**
 * An ANARCI CSV for one domain.
 *
 * The numbering is simplified — residues are given consecutive IMGT positions
 * rather than a real alignment — because what is under test is how the columns
 * map back to residue ranges, not ANARCI itself.
 */
function anarciCsv(rows: { id: string; chainType: string; start: number; end: number }[]): string {
  const positions = Array.from({ length: 128 }, (_, i) => String(i + 1));
  const header = [
    'Id', 'domain_no', 'hmm_species', 'chain_type', 'e-value', 'score',
    'seqstart_index', 'seqend_index', 'identity_species', 'v_gene', 'v_identity',
    'j_gene', 'j_identity', ...positions,
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    const residues = Array.from({ length: row.end - row.start + 1 }, () => 'A');
    const cells = positions.map((_, i) => residues[i] ?? '-');
    lines.push(
      [row.id, '0', 'human', row.chainType, '1e-60', '150', String(row.start), String(row.end),
       'human', 'IGHV3-23*01', '0.95', 'IGHJ4*02', '0.9', ...cells].join(','),
    );
  }
  return lines.join('\n');
}

describe('fromANARCI', () => {
  const csv = anarciCsv([
    { id: 'HC', chainType: 'H', start: 0, end: V_HEAVY.length - 1 },
    { id: 'LC', chainType: 'K', start: 0, end: V_LIGHT.length - 1 },
  ]);
  const result = fromANARCI(csv, { sequences: { HC: HEAVY, LC: LIGHT } });

  it('converts ANARCI zero-based indices into residue numbers', () => {
    const hc = result.construct.chains.find((c) => c.id === 'HC')!;
    expect(hc.domains[0]).toMatchObject({ type: 'VH', start: 1, end: V_HEAVY.length });
  });

  it('reads the chain type', () => {
    expect(result.construct.chains.map((c) => c.domains[0]!.type)).toEqual(['VH', 'VL']);
  });

  it('names the constant region it was never given', () => {
    const hc = result.construct.chains.find((c) => c.id === 'HC')!;
    expect(hc.domains.map((d) => d.type)).toEqual(['VH', 'CH1', 'hinge', 'CH2', 'CH3']);
    // Contiguous, and covering the whole sequence.
    expect(hc.domains[1]!.start).toBe(V_HEAVY.length + 1);
    expect(hc.domains[hc.domains.length - 1]!.end).toBe(HEAVY.length);
    expect(hc.domains[1]!.isotype).toBe('IgG1');

    const lc = result.construct.chains.find((c) => c.id === 'LC')!;
    expect(lc.domains.map((d) => d.type)).toEqual(['VL', 'CL']);
  });

  it('says where the constant region came from', () => {
    const note = result.diagnostics.find((d) => d.code === 'constant-region-identified')!;
    expect(note.message).toContain('IGHG1_HUMAN');
    expect(note.message).toContain('P01857');
    expect(note.message).toContain('100.0%');
  });

  it('marks out the CDRs from the IMGT columns', () => {
    const hc = result.construct.chains.find((c) => c.id === 'HC')!;
    const regions = hc.domains[0]!.regions!;
    expect(regions.map((r) => r.name)).toEqual(['CDR1', 'CDR2', 'CDR3']);
    expect(regions[0]).toMatchObject({ start: 27, end: 38, scheme: 'imgt' });
    for (const region of regions) {
      expect(region.start).toBeGreaterThanOrEqual(hc.domains[0]!.start!);
      expect(region.end).toBeLessThanOrEqual(hc.domains[0]!.end!);
    }
  });

  it('leaves regions out rather than guess them for another scheme', () => {
    const kabat = fromANARCI(csv, { sequences: { HC: HEAVY }, scheme: 'kabat' });
    expect(kabat.construct.chains[0]!.domains[0]!.regions).toBeUndefined();
    expect(kabat.diagnostics.some((d) => d.code === 'regions-skipped')).toBe(true);
  });

  it('reports an unfamiliar chain type instead of throwing', () => {
    const odd = fromANARCI(anarciCsv([{ id: 'X', chainType: 'Z', start: 0, end: 10 }]));
    expect(odd.construct.chains).toEqual([]);
    expect(odd.diagnostics[0]!.code).toBe('unknown-chain-type');
  });

  it('produces something the rest of the library can draw', () => {
    const n = normalize(result.construct);
    expect(n.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(n.chains.find((c) => c.id === 'HC')!.kind).toBe('heavy');
    // The VH found its VL across the two chains.
    const vh = n.chains.find((c) => c.id === 'HC')!.domains[0]!;
    expect(n.byId.get(vh.partner!)?.type).toBe('VL');
  });
});

describe('constant region identification', () => {
  it('still recognises a mutated constant region, and says how close it is', () => {
    const mutated = V_HEAVY + igg1.sequence.slice(0, 50) + 'W' + igg1.sequence.slice(51);
    const match = identifyConstantRegion(mutated, V_HEAVY.length + 1, 'heavy')!;
    expect(match.reference.isotype).toBe('IgG1');
    expect(match.identity).toBeLessThan(1);
    expect(match.identity).toBeGreaterThan(0.99);
  });

  it('tells IgG1 from IgG4', () => {
    const igg4 = CONSTANT_REFERENCES.find((r) => r.isotype === 'IgG4')!;
    const match = identifyConstantRegion(V_HEAVY + igg4.sequence, V_HEAVY.length + 1, 'heavy')!;
    expect(match.reference.isotype).toBe('IgG4');
  });

  it('refuses to name something that is not a constant region', () => {
    const nonsense = V_HEAVY + 'G'.repeat(300);
    expect(identifyConstantRegion(nonsense, V_HEAVY.length + 1, 'heavy')).toBeNull();
  });

  it('hands an unmatched tail over with its range rather than dropping it', () => {
    const csv = anarciCsv([{ id: 'HC', chainType: 'H', start: 0, end: V_HEAVY.length - 1 }]);
    const odd = fromANARCI(csv, { sequences: { HC: V_HEAVY + 'G'.repeat(300) } });
    const domains = odd.construct.chains[0]!.domains;
    expect(domains.map((d) => d.type)).toEqual(['VH', 'custom']);
    expect(domains[1]).toMatchObject({ start: V_HEAVY.length + 1, end: V_HEAVY.length + 300 });
    expect(odd.diagnostics.some((d) => d.code === 'constant-region-unmatched')).toBe(true);
  });

  it('every reference is contiguous and ends where its sequence ends', () => {
    for (const reference of CONSTANT_REFERENCES) {
      let expected = 1;
      for (const segment of reference.segments) {
        expect(segment.start, reference.isotype).toBe(expected);
        expected = segment.end + 1;
      }
      expect(expected - 1, reference.isotype).toBe(reference.sequence.length);
    }
  });
});

describe('fromIgBLAST', () => {
  const airr = [
    ['sequence_id', 'sequence', 'locus', 'productive', 'v_call',
     'fwr1_start', 'fwr1_end', 'cdr1_start', 'cdr1_end', 'fwr2_start', 'fwr2_end',
     'cdr2_start', 'cdr2_end', 'fwr3_start', 'fwr3_end', 'cdr3_start', 'cdr3_end',
     'fwr4_start', 'fwr4_end'].join('\t'),
    ['HC', HEAVY, 'IGH', 'T', 'IGHV3-23*01',
     '1', '25', '26', '33', '34', '50', '51', '58', '59', '96', '97', '109', '110', '120'].join('\t'),
  ].join('\n');

  const result = fromIgBLAST(airr);

  it('takes coordinates as 1-based, the way AIRR gives them', () => {
    const hc = result.construct.chains[0]!;
    expect(hc.domains[0]).toMatchObject({ type: 'VH', start: 1, end: 120 });
  });

  it('keeps every framework and CDR the row carried', () => {
    const regions = result.construct.chains[0]!.domains[0]!.regions!;
    expect(regions.map((r) => r.name)).toEqual([
      'FWR1', 'CDR1', 'FWR2', 'CDR2', 'FWR3', 'CDR3', 'FWR4',
    ]);
    expect(regions.find((r) => r.name === 'CDR3')).toMatchObject({ start: 97, end: 109 });
  });

  it('names the constant region from the sequence in the row', () => {
    expect(result.construct.chains[0]!.domains.map((d) => d.type)).toEqual([
      'VH', 'CH1', 'hinge', 'CH2', 'CH3',
    ]);
  });

  it('notes an unproductive rearrangement but still imports it', () => {
    const unproductive = airr.replace('\tT\t', '\tF\t');
    const out = fromIgBLAST(unproductive);
    expect(out.construct.chains).toHaveLength(1);
    expect(out.diagnostics.some((d) => d.code === 'unproductive-rearrangement')).toBe(true);
  });

  it('reports an unfamiliar locus instead of throwing', () => {
    const out = fromIgBLAST(airr.replace('\tIGH\t', '\tXXX\t'));
    expect(out.construct.chains).toEqual([]);
    expect(out.diagnostics[0]!.code).toBe('unknown-locus');
  });
});
