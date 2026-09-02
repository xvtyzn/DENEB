import { DOMAIN_CATALOG, MODIFICATION_CATALOG, canPair } from '../model/catalog';
import type { Construct, Domain, DomainRef, DomainType, ModificationType } from '../model/types';
import { INSERTABLE_TYPES, type Edit, type InsertPoint } from './ops';

export interface EditTarget {
  /** Menu text. */
  label: string;
  /** For grouping a menu; the app decides how to present it. */
  group: 'insert' | 'remove' | 'modify' | 'conjugate' | 'pair';
  /** The catalogue group a modification belongs to, for sub-menus. */
  tag?: string;
  edit: Edit;
}

export interface TargetOptions {
  /** Offer edits that also apply to structurally identical chains. */
  mirror?: boolean;
  /** Domain types to offer for insertion. Defaults to everything drawable. */
  types?: readonly DomainType[];
}

function findDomain(
  construct: Construct,
  ref: DomainRef,
): { chainId: string; index: number; domain: Domain } | null {
  for (const chain of construct.chains) {
    const index = chain.domains.findIndex((d) => d.id === ref);
    if (index >= 0) return { chainId: chain.id, index, domain: chain.domains[index]! };
  }
  return null;
}

const isInsertPoint = (at: DomainRef | InsertPoint): at is InsertPoint =>
  typeof at === 'object' && at !== null && 'chain' in at;

/**
 * What can be done at the thing the user just clicked.
 *
 * Built from the catalogues rather than from a list written out here, so an
 * app never has to hard-code which domains exist, and a new entry in
 * `DOMAIN_CATALOG` shows up in the menu without anyone remembering to add it.
 */
export function editTargets(
  construct: Construct,
  at: DomainRef | InsertPoint,
  options: TargetOptions = {},
): EditTarget[] {
  const mirror = options.mirror;
  const types = options.types ?? INSERTABLE_TYPES;
  const out: EditTarget[] = [];

  const insertsAt = (point: InsertPoint, where: string): void => {
    for (const type of types) {
      const spec = DOMAIN_CATALOG[type];
      if (!spec) continue;
      out.push({
        label: `${where}: ${spec.label || type}`,
        group: 'insert',
        edit: { op: 'insert-domain', at: point, domain: { type }, mirror },
      });
    }
  };

  if (isInsertPoint(at)) {
    insertsAt(at, 'Insert');
    return out;
  }

  const found = findDomain(construct, at);
  if (!found) return out;
  const { chainId, index, domain } = found;
  const spec = DOMAIN_CATALOG[domain.type] ?? DOMAIN_CATALOG.custom;

  insertsAt({ chain: chainId, index }, 'Insert before');
  insertsAt({ chain: chainId, index: index + 1 }, 'Insert after');

  out.push({
    label: `Remove ${spec.label || domain.type}`,
    group: 'remove',
    edit: { op: 'remove-domain', ref: at, mirror },
  });

  out.push({
    label: 'Append a Fab to this chain',
    group: 'insert',
    edit: { op: 'append-fab', chain: chainId, mirror },
  });

  for (const [type, entry] of Object.entries(MODIFICATION_CATALOG) as Array<
    [ModificationType, (typeof MODIFICATION_CATALOG)[ModificationType]]
  >) {
    if (type === 'drug') continue; // offered as a conjugation site below
    out.push({
      label: entry.label,
      group: 'modify',
      tag: entry.group,
      edit: { op: 'add-modification', ref: at, modification: { type }, mirror },
    });
  }

  // A site with no compound on it yet is a legitimate thing to have made.
  out.push({
    label: 'Add a conjugation site',
    group: 'conjugate',
    edit: { op: 'add-conjugation', ref: at, mirror },
  });

  (domain.modifications ?? []).forEach((m, i) => {
    out.push({
      label: `Remove ${MODIFICATION_CATALOG[m.type]?.label ?? m.type}`,
      group: 'remove',
      edit: { op: 'remove-modification', ref: at, index: i, mirror },
    });
  });

  if (spec.pairs) {
    for (const chain of construct.chains) {
      for (const other of chain.domains) {
        if (!other.id || other.id === at) continue;
        if (!canPair(domain.type, other.type)) continue;
        out.push({
          label: `Pair with ${other.type} ${other.id}`,
          group: 'pair',
          edit: { op: 'set-pair', a: at, b: other.id },
        });
        out.push({
          label: `Disulfide to ${other.type} ${other.id}`,
          group: 'pair',
          edit: { op: 'set-disulfide', a: at, b: other.id },
        });
      }
    }
    out.push({ label: 'Clear pairing', group: 'pair', edit: { op: 'clear-pair', ref: at } });
    out.push({
      label: 'Clear disulfides',
      group: 'pair',
      edit: { op: 'clear-disulfide', ref: at },
    });
  }

  return out;
}
