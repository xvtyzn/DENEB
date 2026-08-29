import { normalize } from '../model/normalize';
import type {
  Construct,
  DomainRef,
  Modification,
  NChain,
  NDomain,
  NormalizedConstruct,
} from '../model/types';

export type ChangeKind =
  | 'chain-added'
  | 'chain-removed'
  | 'domain-added'
  | 'domain-removed'
  | 'domain-changed'
  | 'modification-added'
  | 'modification-removed'
  | 'sequence-changed';

export interface Change {
  kind: ChangeKind;
  /** One sentence on what changed. */
  summary: string;
  /** Point substitutions, written `L234A` against sequential numbering. */
  residues?: string[];
  before?: DomainRef;
  after?: DomainRef;
}

export interface DiffResult {
  changes: Change[];
  /** What to light up on the parent, in the form `highlight` takes. */
  highlightBefore: DomainRef[];
  /** …and on the variant. */
  highlightAfter: DomainRef[];
}

/**
 * Compare two constructs — a parent and a variant, two designs in a panel.
 *
 * Chains are matched by id first and by composition second, so renaming a chain
 * does not read as a chain being replaced. Sequences are compared position by
 * position when they are the same length; when they are not, only the change in
 * length is reported, because guessing an alignment would invent mutations that
 * are not there.
 */
export function diff(before: Construct | NormalizedConstruct, after: Construct | NormalizedConstruct): DiffResult {
  const a = 'byId' in before ? before : normalize(before);
  const b = 'byId' in after ? after : normalize(after);

  const changes: Change[] = [];
  const highlightBefore: DomainRef[] = [];
  const highlightAfter: DomainRef[] = [];

  const { pairs, onlyBefore, onlyAfter } = matchChains(a.chains, b.chains);

  for (const chain of onlyBefore) {
    changes.push({
      kind: 'chain-removed',
      summary: `Chain "${chain.id}" (${composition(chain)}) is gone.`,
      before: `chain:${chain.id}`,
    });
    highlightBefore.push(`chain:${chain.id}`);
  }
  for (const chain of onlyAfter) {
    changes.push({
      kind: 'chain-added',
      summary: `Chain "${chain.id}" (${composition(chain)}) is new.`,
      after: `chain:${chain.id}`,
    });
    highlightAfter.push(`chain:${chain.id}`);
  }

  for (const [left, right] of pairs) {
    compareDomains(left, right, changes, highlightBefore, highlightAfter);
    compareSequences(left, right, changes, highlightBefore, highlightAfter);
  }

  return { changes, highlightBefore, highlightAfter };
}

// ---------------------------------------------------------------------------

const composition = (chain: NChain): string =>
  chain.domains
    .filter((d) => d.type !== 'linker')
    .map((d) => d.type)
    .join('-');

/** Ignores ids, so a renamed but otherwise identical chain still matches. */
const shape = (chain: NChain): string =>
  chain.domains.map((d) => `${d.type}:${d.specificity ?? ''}`).join('|');

function matchChains(
  before: NChain[],
  after: NChain[],
): { pairs: [NChain, NChain][]; onlyBefore: NChain[]; onlyAfter: NChain[] } {
  const pairs: [NChain, NChain][] = [];
  const leftOver = [...before];
  const remaining = [...after];

  const take = (predicate: (l: NChain, r: NChain) => boolean): void => {
    for (let i = leftOver.length - 1; i >= 0; i--) {
      const left = leftOver[i]!;
      const j = remaining.findIndex((right) => predicate(left, right));
      if (j < 0) continue;
      pairs.push([left, remaining[j]!]);
      leftOver.splice(i, 1);
      remaining.splice(j, 1);
    }
  };

  take((l, r) => l.id === r.id);
  take((l, r) => shape(l) === shape(r));
  // Same length and role: most likely the same chain with something swapped in.
  take((l, r) => l.kind === r.kind && l.domains.length === r.domains.length);

  return { pairs, onlyBefore: leftOver, onlyAfter: remaining };
}

function compareDomains(
  before: NChain,
  after: NChain,
  changes: Change[],
  highlightBefore: DomainRef[],
  highlightAfter: DomainRef[],
): void {
  const count = Math.max(before.domains.length, after.domains.length);
  for (let i = 0; i < count; i++) {
    const left = before.domains[i];
    const right = after.domains[i];

    if (left && !right) {
      changes.push({
        kind: 'domain-removed',
        summary: `${label(left)} is gone from "${before.id}".`,
        before: left.id,
      });
      highlightBefore.push(left.id);
      continue;
    }
    if (right && !left) {
      changes.push({
        kind: 'domain-added',
        summary: `${label(right)} was added to "${after.id}".`,
        after: right.id,
      });
      highlightAfter.push(right.id);
      continue;
    }
    if (!left || !right) continue;

    const differences: string[] = [];
    if (left.type !== right.type) differences.push(`${left.type} became ${right.type}`);
    if (left.specificity !== right.specificity) {
      differences.push(
        `binds ${right.specificity ?? 'nothing named'} instead of ${left.specificity ?? 'nothing named'}`,
      );
    }
    if (left.isotype !== right.isotype && (left.isotype || right.isotype)) {
      differences.push(`isotype ${left.isotype ?? '—'} → ${right.isotype ?? '—'}`);
    }
    if (differences.length > 0) {
      changes.push({
        kind: 'domain-changed',
        summary: `${label(left)} in "${before.id}": ${differences.join('; ')}.`,
        before: left.id,
        after: right.id,
      });
      highlightBefore.push(left.id);
      highlightAfter.push(right.id);
    }

    compareModifications(left, right, changes, highlightBefore, highlightAfter);
  }
}

const label = (d: NDomain): string => (d.specificity ? `${d.type} (${d.specificity})` : d.type);

/** Identity of a modification for set comparison: what it is, and where. */
const modKey = (m: Modification): string =>
  [m.type, (m.residues ?? []).join('/'), m.payload?.name ?? ''].join('|');

function compareModifications(
  before: NDomain,
  after: NDomain,
  changes: Change[],
  highlightBefore: DomainRef[],
  highlightAfter: DomainRef[],
): void {
  const left = new Map(before.modifications.map((m) => [modKey(m), m]));
  const right = new Map(after.modifications.map((m) => [modKey(m), m]));

  for (const [key, m] of left) {
    if (right.has(key)) continue;
    changes.push({
      kind: 'modification-removed',
      summary: `${describe(m)} was removed from ${label(before)} in "${before.chainId}".`,
      before: before.id,
    });
    highlightBefore.push(before.id);
  }
  for (const [key, m] of right) {
    if (left.has(key)) continue;
    changes.push({
      kind: 'modification-added',
      summary: `${describe(m)} was added to ${label(after)} in "${after.chainId}".`,
      after: after.id,
    });
    highlightAfter.push(after.id);
  }
}

function describe(m: Modification): string {
  if (m.payload?.name) return `${m.payload.name} conjugation`;
  const residues = m.residues && m.residues.length > 0 ? ` (${m.residues.join('/')})` : '';
  return `${m.label ?? m.type}${residues}`;
}

function compareSequences(
  before: NChain,
  after: NChain,
  changes: Change[],
  highlightBefore: DomainRef[],
  highlightAfter: DomainRef[],
): void {
  const from = before.sequence;
  const to = after.sequence;
  if (!from || !to || from === to) return;

  if (from.length !== to.length) {
    changes.push({
      kind: 'sequence-changed',
      summary: `Chain "${after.id}" changed length, ${from.length} to ${to.length} residues; positions were not compared.`,
      before: `chain:${before.id}`,
      after: `chain:${after.id}`,
    });
    highlightBefore.push(`chain:${before.id}`);
    highlightAfter.push(`chain:${after.id}`);
    return;
  }

  const residues: string[] = [];
  const touched = new Set<string>();
  for (let i = 0; i < from.length; i++) {
    if (from[i] === to[i]) continue;
    residues.push(`${from[i]}${i + 1}${to[i]}`);
    const domain = after.domains.find((d) => d.start != null && d.end != null && i + 1 >= d.start && i + 1 <= d.end);
    if (domain) touched.add(domain.id);
  }
  if (residues.length === 0) return;

  changes.push({
    kind: 'sequence-changed',
    summary: `Chain "${after.id}" carries ${residues.length} substitution${
      residues.length === 1 ? '' : 's'
    } (sequential numbering).`,
    residues,
    before: `chain:${before.id}`,
    after: `chain:${after.id}`,
  });
  for (const id of touched) {
    highlightBefore.push(id);
    highlightAfter.push(id);
  }
  if (touched.size === 0) {
    highlightBefore.push(`chain:${before.id}`);
    highlightAfter.push(`chain:${after.id}`);
  }
}
