import { describe, expect, it } from 'vitest';
import { parseAbML, toAbML, AbmlError } from '../src/abml/index';
import { normalize } from '../src/index';
import type { Construct } from '../src/model/types';

/**
 * AbML v1.06 — Sweet-Jones, Ahmad & Martin, mAbs 14:1 (2022),
 * doi:10.1080/19420862.2022.2101183.
 *
 * The strings below are written for these tests, apart from the canonical IgG,
 * which the specification itself presents as its worked example.
 */
const IGG =
  'VH.a(1:6)-CH1(2:7){1}-H(3:10){2}-CH2(4:11)-CH3(5:12) | ' +
  'VL.a(6:1)-CL(7:2){1} | ' +
  'VH.a(8:13)-CH1(9:14){1}-H(10:3){2}-CH2(11:4)-CH3(12:5) | ' +
  'VL.a(13:8)-CL(14:9){1}';

/** The molecule, ignoring the identifiers used to express it. */
function shape(construct: Construct) {
  const n = normalize(construct);
  const index = new Map<string, string>();
  n.chains.forEach((chain, i) =>
    chain.domains.forEach((domain, j) => index.set(domain.id, `${i}.${j}`)),
  );
  return n.chains.map((chain) =>
    chain.domains.map((domain) => ({
      type: domain.type,
      specificity: domain.specificity ?? null,
      modifications: domain.modifications.map((m) => m.type).sort(),
      partner: domain.partner ? index.get(domain.partner) : null,
    })),
  );
}

const compact = (s: string) => s.replace(/\s+/g, '');

describe('parseAbML', () => {
  it('reads the specification’s IgG example', () => {
    const { construct, diagnostics } = parseAbML(IGG);
    expect(diagnostics).toEqual([]);
    expect(construct.chains).toHaveLength(4);
    expect(construct.chains[0]!.domains.map((d) => d.type)).toEqual([
      'VH',
      'CH1',
      'hinge',
      'CH2',
      'CH3',
    ]);
    expect(construct.chains[1]!.domains.map((d) => d.type)).toEqual(['VL', 'CL']);
  });

  it('pairs domains through their interaction identifiers', () => {
    const n = normalize(parseAbML(IGG).construct);
    const vh = n.chains[0]!.domains[0]!;
    const vl = n.chains[1]!.domains[0]!;
    expect(vh.partner).toBe(vl.id);
    expect(vl.partner).toBe(vh.id);
  });

  it('reads a hinge disulphide count', () => {
    const { construct } = parseAbML(IGG);
    const hinge = construct.links!.find((l) => l.type === 'disulfide' && l.count === 2);
    expect(hinge).toBeDefined();
  });

  it('gives each specificity letter its own declaration', () => {
    const { construct } = parseAbML('VH.a(1:3)-L(2)-VL.b(3:1) | VH.b(4:6)-L(5)-VL.a(6:4)');
    expect(construct.specificities?.map((s) => s.name)).toEqual(['a', 'b']);
  });

  it('names a target from an ANTI comment throughout the molecule', () => {
    const { construct } = parseAbML('VH.a(1:3)[ANTI:HER2]-L(2)-VL.a(3:1) | VH.a(4)');
    const names = construct.chains.flatMap((c) => c.domains.map((d) => d.specificity));
    expect(new Set(names.filter(Boolean))).toEqual(new Set(['HER2']));
  });

  it('reads the modification symbols', () => {
    const { construct } = parseAbML('CH3>(1) | CH3@(2) | CH3+(3) | CH3_(4) | CH2!(5) | CL^(6)');
    const types = construct.chains.map((c) => c.domains[0]!.modifications![0]!.type);
    expect(types).toEqual(['knob', 'hole', 'charge+', 'charge-', 'aglycosyl', 'drug']);
  });

  it('explains a general modification with its MOD comment', () => {
    const { construct } = parseAbML('CH3*(1)[MOD:STRANDEXCHANGE]');
    expect(construct.chains[0]!.domains[0]!.modifications).toEqual([{ type: 'seed' }]);
  });

  it('keeps a general modification that nothing explains', () => {
    const { construct } = parseAbML('CH3*(1)');
    expect(construct.chains[0]!.domains[0]!.modifications).toEqual([
      { type: 'custom', label: 'modified' },
    ]);
  });

  it('keeps an unreserved MOD keyword as written, and says so', () => {
    const { construct, diagnostics } = parseAbML('CH2*(1)[MOD:AFUCOSYLATED]');
    expect(construct.chains[0]!.domains[0]!.modifications).toEqual([
      { type: 'custom', label: 'AFUCOSYLATED' },
    ]);
    expect(diagnostics.map((d) => d.code)).toContain('unreserved-mod');
  });

  it('labels an extra domain from its TYPE comment and keeps its notes', () => {
    const { construct } = parseAbML('X(1)[TYPE:ALBUMIN][NOTE:half-life extension]');
    const domain = construct.chains[0]!.domains[0]!;
    expect(domain.type).toBe('custom');
    expect(domain.label).toBe('ALBUMIN');
    expect(domain.notes).toEqual(['half-life extension']);
  });

  it('reads a chemical moiety as a distinct token from an extra domain', () => {
    const { construct } = parseAbML('CH3(1)-L(2)-C(3)[TYPE:OPDM] | X(4)[TYPE:ZIPPER]');
    expect(construct.chains[0]!.domains[2]!.type).toBe('payload');
    expect(construct.chains[1]!.domains[0]!.type).toBe('custom');
  });

  it('reads VHH before VH so a nanobody is not split', () => {
    const { construct } = parseAbML('VHH.a(1)-H(2:5){2}-CH2(3)-CH3(4)');
    expect(construct.chains[0]!.domains[0]!.type).toBe('VHH');
  });

  it('reports an interaction that points nowhere', () => {
    const { diagnostics } = parseAbML('VH.a(1:99)');
    expect(diagnostics.map((d) => d.code)).toContain('unknown-interaction');
  });

  it('rejects an empty expression', () => {
    expect(() => parseAbML('   ')).toThrow(AbmlError);
  });

  it('rejects an unknown domain token', () => {
    expect(() => parseAbML('VH.a(1)-ZZ(2)')).toThrow(AbmlError);
  });
});

describe('toAbML', () => {
  it('writes the specification’s IgG example back byte for byte', () => {
    const { construct } = parseAbML(IGG);
    expect(compact(toAbML(construct, { multiline: false }))).toBe(compact(IGG));
  });

  it('puts each chain on its own line by default', () => {
    const { construct } = parseAbML(IGG);
    expect(toAbML(construct).split('\n')).toHaveLength(4);
  });

  it('writes the general marker before the specific symbols', () => {
    const source = 'CH3*>(1:2){1}[MOD:DISULPHIDE] | CH3@(2:1){1}';
    const { construct } = parseAbML(source);
    expect(compact(toAbML(construct))).toBe(compact(source));
  });

  it('keeps a specificity letter the source already used', () => {
    const source = 'VH.b(1:3)-L(2)-VL.b(3:1)';
    const { construct } = parseAbML(source);
    expect(compact(toAbML(construct))).toBe(compact(source));
  });

  it('writes a real target name as an ANTI comment on its first domain', () => {
    const { construct } = parseAbML('VH.a(1:3)[ANTI:HER2]-L(2)-VL.a(3:1)');
    const out = toAbML(construct, { multiline: false });
    expect(out).toContain('[ANTI:HER2]');
    expect(out.match(/ANTI:HER2/g)).toHaveLength(1);
  });

  it('omits target names when asked to', () => {
    const { construct } = parseAbML('VH.a(1:3)[ANTI:HER2]-L(2)-VL.a(3:1)');
    expect(toAbML(construct, { includeTargetNames: false })).not.toContain('ANTI');
  });

  it('renumbers identifiers from one', () => {
    const construct: Construct = {
      chains: [{ id: 'HC', domains: [{ type: 'VH' }, { type: 'CH1' }] }],
    };
    expect(compact(toAbML(construct))).toBe('VH(1)-CH1(2)');
  });

  it('preserves the molecule through parse → write → parse', () => {
    const cases = [
      IGG,
      'VH.a(1:3)-L(2)-VL.a(3:1){1}-L(4)-VH.b(5:7)-L(6)-VL.b(7:5)',
      'VHH.a(1)-H(2:6){2}-CH2(3:7)-CH3>(4:8) | VHH.b(5)-H(6:2){2}-CH2(7:3)-CH3@(8:4)',
      'VH.a(1:5)-CH1(2:6){1}-H(3:8){2}-CH2(4:9)-C(10)[TYPE:SMCC] | VL.a(5:1)-CL(6:2){1}',
      'X(1)[TYPE:ALBUMIN]-L(2)-VH.a(3:5)-L(4)-VL.a(5:3)',
      'VH.a(1:5)-CH1(2:6){1}-H(3){2}-CH2*(4)[MOD:NOADCCCDC]-CH3>(5) | VL.a(5:1)-CL(6:2){1}',
    ];
    for (const source of cases) {
      const first = parseAbML(source).construct;
      const second = parseAbML(toAbML(first, { multiline: false })).construct;
      expect(shape(second), source).toEqual(shape(first));
    }
  });

  it('round-trips a construct this library built, not only ones it read', () => {
    const construct: Construct = {
      specificities: [{ name: 'CD3' }, { name: 'HER2' }],
      chains: [
        {
          id: 'HC1',
          domains: [
            { type: 'VH', specificity: 'HER2' },
            { type: 'CH1' },
            { type: 'hinge' },
            { type: 'CH3', modifications: [{ type: 'knob' }] },
          ],
        },
        { id: 'LC1', domains: [{ type: 'VL', specificity: 'HER2' }, { type: 'CL' }] },
      ],
    };
    const out = toAbML(construct, { multiline: false });
    expect(out).toContain('[ANTI:HER2]');
    expect(out).toContain('CH3>');
    expect(shape(parseAbML(out).construct)).toEqual(shape(construct));
  });

  it('writes a named Fc mutation as the effect AbML can express', () => {
    // AbML has no LALA keyword — it records what a modification does, not which
    // residues were changed — so the name does not survive the round trip and
    // the effect keyword takes its place rather than inventing residue numbers.
    const construct: Construct = {
      chains: [{ id: 'HC', domains: [{ type: 'CH2', modifications: [{ type: 'lala' }] }] }],
    };
    const out = toAbML(construct);
    expect(compact(out)).toBe('CH2*(1)[MOD:NOADCCCDC]');
    expect(parseAbML(out).construct.chains[0]!.domains[0]!.modifications).toEqual([
      { type: 'custom', label: 'reduced ADCC and CDC' },
    ]);
  });
});
