import { describe, expect, it } from 'vitest';
import { parseDSL } from '../src/dsl/parse';
import { normalize } from '../src/model/normalize';
import { layout } from '../src/layout/skeleton';
import { renderSVG } from '../src/render/svg';
import { getPreset, getTemplate, presetNames, TEMPLATE_NAMES } from '../src/presets/index';
import { lint } from '../src/lint/index';
import { applyEdit, expandForEditing, insertionAnchors, editTargets, resolvePairing } from '../src/edit/index';
import type { Construct } from '../src/model/types';
import type { Edit } from '../src/edit/ops';

/** The pairing graph, as a stable string. */
const graphOf = (c: ReturnType<typeof normalize>): string =>
  c.chains
    .flatMap((chain) => chain.domains)
    .map((d) => `${d.id}->${d.partner ?? '-'}`)
    .sort()
    .join('\n');

const strict = (construct: Construct) => {
  const n = normalize(construct, { pairing: 'explicit' });
  const report = resolvePairing(n);
  return { construct: n, report };
};

/**
 * The molecule this whole module exists for: an IgG with a Fab appended after
 * the Fc, which needs four light chains.
 */
const CTERM_FAB = `
  HC: VH(A)-CH1-h-CH2-CH3-VH(B)-CH1 *2
  LC1: VL(A)-CL *2
  LC2: VL(B)-CL *2
`;

describe('expandForEditing', () => {
  it.each(presetNames())('%s expands to exactly the same picture', (name) => {
    const preset = getPreset(name);
    expect(renderSVG(expandForEditing(preset)).svg).toBe(renderSVG(preset).svg);
  });

  it.each(presetNames())('%s is idempotent', (name) => {
    const once = expandForEditing(getPreset(name));
    expect(expandForEditing(once)).toEqual(once);
  });

  it.each(presetNames())('%s still resolves strictly after expansion', (name) => {
    // The stronger form of the test above: rendering uses the old inference,
    // which would paper over anything expansion dropped. This asks whether the
    // expanded document still *says* what the shorthand said — which is how a
    // shared light chain quietly lost the arm it belonged to.
    const inferred = normalize(getPreset(name));
    const expanded = normalize(expandForEditing(getPreset(name)), { pairing: 'explicit' });
    const report = resolvePairing(expanded);
    expect(graphOf(expanded)).toBe(graphOf(inferred));
    expect(report.ambiguous).toEqual([]);
    expect(report.unresolved).toEqual([]);
  });

  it('leaves a shared light chain shared', () => {
    // The copy that serves the second arm exists because a light chain was
    // *missing*, not because a shorthand asked for one. Writing it out would
    // let the two arms drift apart under editing and quietly stop being a
    // common light chain — and it makes "add an arm, then add its light chain"
    // produce three light chains.
    const expanded = expandForEditing(getPreset('common-lc-kih'));
    const lights = expanded.chains.filter((c) => c.kind === 'light');
    expect(lights).toHaveLength(1);
    expect(lights[0]!.domains.map((d) => d.type)).toEqual(['VL', 'CL']);
  });

  it('lets an arm and its light chain be added one after the other', () => {
    let construct = expandForEditing(getPreset('fab'));
    construct = applyEdit(construct, {
      op: 'add-chain',
      chain: { id: 'HC', kind: 'heavy', domains: [
        { type: 'VH', specificity: 'HER2' }, { type: 'CH1' }] },
    }).construct;
    construct = applyEdit(construct, {
      op: 'add-chain',
      chain: { id: 'LC', kind: 'light', domains: [
        { type: 'VL', specificity: 'HER2' }, { type: 'CL' }] },
    }).construct;
    expect(construct.chains.filter((c) => c.kind === 'light')).toHaveLength(2);
    const { report } = strict(construct);
    expect(report.unresolved).toEqual([]);
    expect(report.ambiguous).toEqual([]);
  });

  it('gives every domain an explicit id', () => {
    const expanded = expandForEditing(getPreset('igg1'));
    for (const chain of expanded.chains) {
      for (const domain of chain.domains) expect(domain.id).toBeTruthy();
    }
  });

  it('materialises copies into real chains', () => {
    const expanded = expandForEditing(getPreset('igg1'));
    expect(expanded.chains.map((c) => c.id)).toEqual(['HC', 'HC(2)', 'LC', 'LC(2)']);
    expect(expanded.chains.every((c) => c.copies == null)).toBe(true);
  });
});

describe('resolvePairing decides only what the construct determines', () => {
  it.each(presetNames())('%s resolves to exactly what inference gives', (name) => {
    const inferred = normalize(getPreset(name));
    const { construct, report } = strict(getPreset(name));
    expect(graphOf(construct)).toBe(graphOf(inferred));
    expect(report.ambiguous).toEqual([]);
    expect(construct.layout.armMode).toBe(inferred.layout.armMode);
  });

  it('pairs a C-terminal Fab correctly, where inference does not', () => {
    // Inference hands the first light chain to the second heavy chain and then
    // runs out, orphaning six constant domains.
    const inferred = normalize(parseDSL(CTERM_FAB));
    const orphans = inferred.chains
      .flatMap((c) => c.domains)
      .filter((d) => !d.partner && (d.type === 'CH1' || d.type === 'CL'));
    expect(orphans).toHaveLength(6);

    const { construct, report } = strict(parseDSL(CTERM_FAB));
    expect(report.ambiguous).toEqual([]);
    expect(report.unresolved).toEqual([]);
    expect(construct.byId.get('HC:1')?.partner).toBe('LC1:1');
    expect(construct.byId.get('HC:6')?.partner).toBe('LC2:1');
    expect(construct.byId.get('HC(2):1')?.partner).toBe('LC1(2):1');
    expect(construct.byId.get('HC(2):6')?.partner).toBe('LC2(2):1');
  });

  it('makes no choice when the notation has not made one', () => {
    const { construct, report } = strict(
      parseDSL(`
        HC: VH-CH1-h-CH2-CH3-VH-CH1 *2
        LC1: VL-CL *2
        LC2: VL-CL *2
      `),
    );
    expect(report.ambiguous.length).toBeGreaterThan(0);
    expect(report.suggestions[0]?.hint).toMatch(/^@pair /);
    // Nothing invented: the only pairs are the Fc contact, which is structure
    // rather than a guess about which chain goes with which.
    expect(report.resolved.every((id) => /CH[234]/.test(construct.byId.get(id)!.type))).toBe(true);
  });

  it('leaves an appended VH unpaired rather than conjuring a VL', () => {
    const { construct, report } = strict(
      parseDSL(`
        HC: VH(A)-CH1-h-CH2-CH3 *2
        LC: VL(A)-CL-VH(B) *2
      `),
    );
    expect(report.unresolved).toContain('LC:2');
    expect(construct.byId.get('LC:2')?.partner).toBeUndefined();
    expect(construct.chains).toHaveLength(4); // no light chain was added
  });
});

describe('layout places every domain exactly once', () => {
  it.each(presetNames())('%s draws each domain once', (name) => {
    const result = layout(getPreset(name));
    const ids = result.domains.map((p) => p.domain.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.diagnostics.filter((d) => d.code === 'domain-placed-twice')).toEqual([]);
  });

  it('used to draw a light chain twice when two arms both claimed it', () => {
    // The guard catches it even under the old inference, which still mispairs.
    const result = layout(normalize(parseDSL(CTERM_FAB)));
    const ids = result.domains.map((p) => p.domain.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.diagnostics.some((d) => d.code === 'domain-placed-twice')).toBe(true);
  });

  it('puts a C-terminal Fab light chain beside its own partners', () => {
    const { construct } = strict(parseDSL(CTERM_FAB));
    const result = layout(construct);
    const at = (id: string) => result.byDomainId.get(id)!.center;
    // Same rung as its partner, not up on the arm.
    expect(Math.abs(at('LC2:0').y - at('HC:5').y)).toBeLessThan(20);
    expect(Math.abs(at('LC2:1').y - at('HC:6').y)).toBeLessThan(20);
    // Below the Fc, not above it.
    expect(at('LC2:0').y).toBeGreaterThan(at('HC:4').y);
    // And so no long dashed pairing lines are needed at all.
    expect(result.connectors.filter((c) => c.kind === 'pairing')).toEqual([]);
  });
});

describe('applyEdit holds the edit and nothing more', () => {
  it('does not touch the construct it was given', () => {
    const before = getPreset('igg1');
    const snapshot = structuredClone(before);
    applyEdit(before, { op: 'append-fab', chain: 'HC', specificity: 'CD3', mirror: true });
    expect(before).toEqual(snapshot);
  });

  it('appends a Fab with its own light chain on every copy', () => {
    const { construct } = applyEdit(getPreset('igg1'), {
      op: 'append-fab',
      chain: 'HC',
      specificity: 'CD3',
      mirror: true,
    });
    const { report } = strict(construct);
    expect(report.ambiguous).toEqual([]);
    expect(report.unresolved).toEqual([]);
    expect(construct.chains).toHaveLength(6);
  });

  it('adds a domain without adding its partner', () => {
    const { construct, touched } = applyEdit(getPreset('igg1'), {
      op: 'insert-domain',
      at: { chain: 'LC', index: 2 },
      domain: { type: 'VH', specificity: 'CD3' },
    });
    expect(touched).toHaveLength(1);
    expect(construct.chains.find((c) => c.id === 'LC')!.domains).toHaveLength(3);
    // Nothing was paired with it, and lint says so rather than the picture
    // quietly finding it a partner.
    const resolved = strict(construct).construct;
    expect(resolved.byId.get(touched[0]!)?.partner).toBeUndefined();
    expect(lint(resolved).map((f) => f.rule)).toContain('unpaired-variable-domain');
  });

  it('keeps an explicit pair pointing at the same domains after an insertion', () => {
    let construct = expandForEditing(getPreset('igg1'));
    construct = applyEdit(construct, { op: 'set-pair', a: 'HC:1', b: 'LC:1' }).construct;
    construct = applyEdit(construct, {
      op: 'insert-domain',
      at: { chain: 'HC', index: 0 },
      domain: { type: 'VHH', specificity: 'CD3' },
    }).construct;
    const { construct: resolved } = strict(construct);
    expect(resolved.byId.get('HC:1')?.type).toBe('CH1');
    expect(resolved.byId.get('HC:1')?.partner).toBe('LC:1');
  });

  it('appends to the C-terminus of every mirrored chain', () => {
    // index === length is a real place — the end of the chain — and mirroring
    // used to drop it, so "add a domain here" silently did nothing.
    const { construct, touched } = applyEdit(getPreset('igg1'), {
      op: 'insert-domain',
      at: { chain: 'LC', index: 2 },
      domain: { type: 'VH', specificity: 'CD3' },
      mirror: true,
    });
    expect(touched).toHaveLength(2);
    for (const chain of construct.chains.filter((c) => c.kind === 'light')) {
      expect(chain.domains.map((d) => d.type)).toEqual(['VL', 'CL', 'VH']);
    }
  });

  it("holds a domain the notation cannot yet pair, and says so", () => {
    // The case that started this: a VH added to a light chain's C-terminus.
    let construct = applyEdit(getPreset('igg1'), {
      op: 'insert-domain',
      at: { chain: 'LC', index: 2 },
      domain: { type: 'VH', specificity: 'CD3' },
      mirror: true,
    }).construct;
    let { report } = strict(construct);
    expect(report.unresolved).toHaveLength(2);
    expect(lint(strict(construct).construct).map((f) => f.rule)).toContain(
      'unpaired-variable-domain',
    );

    // Complete it, and the complaint goes away on its own.
    construct = applyEdit(construct, {
      op: 'insert-domain',
      at: { chain: 'LC', index: 3 },
      domain: { type: 'VL', specificity: 'CD3' },
      mirror: true,
    }).construct;
    ({ report } = strict(construct));
    expect(report.unresolved).toEqual([]);
    expect(report.ambiguous).toEqual([]);
  });

  it('adds a conjugation site with nothing on it yet', () => {
    const { construct } = applyEdit(getPreset('igg1'), {
      op: 'add-conjugation',
      ref: 'HC:3',
      mirror: true,
    });
    expect(() => renderSVG(construct)).not.toThrow();
    const rules = lint(construct).map((f) => f.rule);
    expect(rules).toContain('conjugation-underspecified');
  });

  it('states an interchain disulfide, and takes it back', () => {
    let construct = expandForEditing(getPreset('igg1'));
    construct = applyEdit(construct, { op: 'set-disulfide', a: 'HC:1', b: 'LC:1' }).construct;
    const drawn = layout(strict(construct).construct).connectors.filter(
      (c) => c.kind === 'disulfide',
    );
    expect(drawn.length).toBeGreaterThan(1); // the hinge's, plus the new one
    construct = applyEdit(construct, { op: 'clear-disulfide', ref: 'HC:1' }).construct;
    expect((construct.links ?? []).filter((l) => l.type === 'disulfide')).toEqual([]);
  });

  it('drops links that pointed at a removed domain', () => {
    let construct = expandForEditing(getPreset('igg1'));
    construct = applyEdit(construct, { op: 'set-pair', a: 'HC:0', b: 'LC:0' }).construct;
    construct = applyEdit(construct, { op: 'remove-domain', ref: 'LC:0' }).construct;
    expect(construct.links ?? []).toEqual([]);
  });
});

/** What molecule this is, independent of what the chains happen to be called. */
function moleculeOf(c: ReturnType<typeof normalize>): string {
  const tag = (d: (typeof c.chains)[number]['domains'][number]) =>
    `${d.type}${d.specificity ? `(${d.specificity})` : ''}` +
    (d.modifications.length
      ? `[${d.modifications
          .map((m) =>
            m.payload
              ? `drug:${m.payload.name}/${m.payload.linker ?? ''}/${m.payload.dar ?? ''}`
              : `${m.type}${m.residues?.length ? `=${m.residues.join('/')}` : ''}`,
          )
          .sort()
          .join(',')}]`
      : '');
  const chains = c.chains.map((chain) => chain.domains.map(tag).join('-')).sort();
  const seen = new Set<string>();
  const pairs: string[] = [];
  for (const chain of c.chains) {
    for (const d of chain.domains) {
      if (!d.partner || seen.has(d.id)) continue;
      seen.add(d.id);
      seen.add(d.partner);
      pairs.push([tag(d), tag(c.byId.get(d.partner)!)].sort().join('~'));
    }
  }
  return JSON.stringify({ chains, pairs: pairs.sort() });
}

describe('a format can be built out of edits alone', () => {
  const from = (name: Parameters<typeof getTemplate>[0], edits: Edit[]): Construct => {
    let construct = expandForEditing(getTemplate(name));
    for (const edit of edits) construct = applyEdit(construct, edit).construct;
    return construct;
  };

  const cases: Array<[string, Construct]> = [
    [
      'igg-kih',
      from('igg1', [
        { op: 'set-specificity', ref: 'HC:0', specificity: 'CD3' },
        { op: 'set-specificity', ref: 'LC:0', specificity: 'CD3' },
        { op: 'set-specificity', ref: 'HC(2):0', specificity: 'HER2' },
        { op: 'set-specificity', ref: 'LC(2):0', specificity: 'HER2' },
        { op: 'add-modification', ref: 'HC:4', modification: { type: 'knob' } },
        { op: 'add-modification', ref: 'HC(2):4', modification: { type: 'hole' } },
      ]),
    ],
    [
      'adc-igg',
      from('igg1', [
        { op: 'set-specificity', ref: 'HC:0', specificity: 'HER2', mirror: true },
        { op: 'set-specificity', ref: 'LC:0', specificity: 'HER2', mirror: true },
        {
          op: 'add-conjugation',
          ref: 'LC:1',
          mirror: true,
          payload: {
            name: 'MMAE',
            linker: 'vc-PAB',
            dar: 4,
            count: 2,
            site: 'interchain cysteine',
          },
        },
      ]),
    ],
    [
      'dvd-ig',
      from('igg1', [
        { op: 'set-specificity', ref: 'HC:0', specificity: 'IL17', mirror: true },
        { op: 'set-specificity', ref: 'LC:0', specificity: 'IL17', mirror: true },
        { op: 'insert-domain', at: { chain: 'HC', index: 0 }, domain: { type: 'VH', specificity: 'TNF' }, mirror: true },
        { op: 'insert-domain', at: { chain: 'HC', index: 1 }, domain: { type: 'linker' }, mirror: true },
        { op: 'insert-domain', at: { chain: 'LC', index: 0 }, domain: { type: 'VL', specificity: 'TNF' }, mirror: true },
        { op: 'insert-domain', at: { chain: 'LC', index: 1 }, domain: { type: 'linker' }, mirror: true },
      ]),
    ],
    [
      'igg-lc-scfv',
      from('igg1', [
        { op: 'set-specificity', ref: 'HC:0', specificity: 'HER2', mirror: true },
        { op: 'set-specificity', ref: 'LC:0', specificity: 'HER2', mirror: true },
        { op: 'insert-domain', at: { chain: 'LC', index: 2 }, domain: { type: 'linker' }, mirror: true },
        { op: 'insert-domain', at: { chain: 'LC', index: 3 }, domain: { type: 'VH', specificity: 'CD3' }, mirror: true },
        { op: 'insert-domain', at: { chain: 'LC', index: 4 }, domain: { type: 'linker' }, mirror: true },
        { op: 'insert-domain', at: { chain: 'LC', index: 5 }, domain: { type: 'VL', specificity: 'CD3' }, mirror: true },
      ]),
    ],
    [
      'bite',
      from('scfv', [
        { op: 'set-specificity', ref: 'C1:0', specificity: 'CD19' },
        { op: 'set-specificity', ref: 'C1:2', specificity: 'CD19' },
        { op: 'insert-domain', at: { chain: 'C1', index: 3 }, domain: { type: 'linker' } },
        { op: 'insert-domain', at: { chain: 'C1', index: 4 }, domain: { type: 'VH', specificity: 'CD3' } },
        { op: 'insert-domain', at: { chain: 'C1', index: 5 }, domain: { type: 'linker' } },
        { op: 'insert-domain', at: { chain: 'C1', index: 6 }, domain: { type: 'VL', specificity: 'CD3' } },
      ]),
    ],
  ];

  it.each(cases)('reaches %s, and settles with nothing left over', (name, built) => {
    const { construct, report } = strict(built);
    expect(moleculeOf(construct)).toBe(moleculeOf(normalize(getPreset(name))));
    expect(report.ambiguous).toEqual([]);
    expect(report.unresolved).toEqual([]);
  });
});

describe('editTargets and insertionAnchors', () => {
  it('offers insertions, removal and pairing at a domain', () => {
    const construct = expandForEditing(getPreset('igg1'));
    const groups = new Set(editTargets(construct, 'HC:1').map((t) => t.group));
    expect(groups).toEqual(new Set(['insert', 'remove', 'modify', 'conjugate', 'pair']));
  });

  it('offers only insertions at a gap', () => {
    const construct = expandForEditing(getPreset('igg1'));
    const targets = editTargets(construct, { chain: 'HC', index: 0 });
    expect(targets.every((t) => t.group === 'insert')).toBe(true);
    expect(targets.length).toBeGreaterThan(0);
  });

  it('gives an anchor for every gap in every chain', () => {
    const result = layout(getPreset('igg1'));
    const anchors = insertionAnchors(result);
    const chain = result.construct.chains.find((c) => c.id === 'HC')!;
    const forHC = anchors.filter((a) => a.at.chain === 'HC');
    expect(forHC).toHaveLength(chain.domains.length + 1);
    for (const a of anchors) {
      expect(Number.isFinite(a.point.x)).toBe(true);
      expect(Number.isFinite(a.point.y)).toBe(true);
    }
  });
});

describe('templates', () => {
  it.each(TEMPLATE_NAMES)('%s is a real preset and comes back unshared', (name) => {
    const a = getTemplate(name);
    const b = getTemplate(name);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a).not.toBe(getPreset(name));
  });
});
