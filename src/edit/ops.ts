import { DOMAIN_CATALOG } from '../model/catalog';
import type {
  Chain,
  Construct,
  Domain,
  DomainRef,
  DomainType,
  Link,
  Modification,
  Payload,
} from '../model/types';
import { expandForEditing } from './expand';

/** A place between two domains, or at either end of a chain. */
export interface InsertPoint {
  chain: string;
  /** 0 puts the domain at the N-terminus; `domains.length` at the C-terminus. */
  index: number;
}

/**
 * `mirror` applies the same edit to every structurally identical chain.
 *
 * An expanded IgG has two real heavy chains rather than a `*2` shorthand, which
 * is what makes an edit addressable at all — but it also means "add a domain to
 * the heavy chain" is two edits. `mirror: true` says the two arms are meant to
 * stay the same.
 */
interface Mirrorable {
  mirror?: boolean;
}

export type Edit =
  | ({ op: 'insert-domain'; at: InsertPoint; domain: Domain } & Mirrorable)
  | ({ op: 'remove-domain'; ref: DomainRef } & Mirrorable)
  | ({ op: 'replace-domain'; ref: DomainRef; domain: Partial<Domain> } & Mirrorable)
  | ({ op: 'append-fab'; chain: string; specificity?: string; end?: 'N' | 'C' } & Mirrorable)
  | ({ op: 'add-modification'; ref: DomainRef; modification: Modification } & Mirrorable)
  | ({ op: 'remove-modification'; ref: DomainRef; index: number } & Mirrorable)
  | ({ op: 'add-conjugation'; ref: DomainRef; payload?: Partial<Payload> } & Mirrorable)
  | ({ op: 'set-specificity'; ref: DomainRef; specificity?: string } & Mirrorable)
  | { op: 'add-chain'; chain: Chain }
  | { op: 'remove-chain'; id: string }
  | { op: 'set-pair'; a: DomainRef; b: DomainRef }
  | { op: 'clear-pair'; ref: DomainRef }
  | { op: 'set-disulfide'; a: DomainRef; b: DomainRef }
  | { op: 'clear-disulfide'; ref: DomainRef }
  | { op: 'rename'; name?: string };

export interface EditResult {
  /** A new construct. The one you passed in is untouched. */
  construct: Construct;
  /** What the edit affected, in the form `highlight` takes. */
  touched: DomainRef[];
}

// --- addressing -------------------------------------------------------------

interface Site {
  chain: Chain;
  index: number;
}

function chainSignature(chain: Chain): string {
  return chain.domains
    .map(
      (d) =>
        `${d.type}:${d.specificity ?? ''}:${d.isotype ?? ''}:` +
        (d.modifications ?? [])
          .map((m) => m.type)
          .sort()
          .join('+'),
    )
    .join('-');
}

function siteOf(construct: Construct, ref: DomainRef): Site | null {
  for (const chain of construct.chains) {
    const index = chain.domains.findIndex((d) => d.id === ref);
    if (index >= 0) return { chain, index };
  }
  // `HC:2` / `HC:CH1` for a construct that has not been expanded.
  const cut = ref.lastIndexOf(':');
  if (cut < 0) return null;
  const chain = construct.chains.find((c) => c.id === ref.slice(0, cut));
  if (!chain) return null;
  const tail = ref.slice(cut + 1);
  const n = Number(tail);
  if (Number.isInteger(n) && n >= 0 && n < chain.domains.length) return { chain, index: n };
  const index = chain.domains.findIndex((d) => d.type === tail);
  return index >= 0 ? { chain, index } : null;
}

/**
 * The same position on every chain that is a copy of this one.
 *
 * `gap` says the index names a place *between* domains rather than a domain,
 * so the C-terminus — index === length — is a real position. Without it,
 * appending to the end of a chain matched nothing and quietly did nothing.
 */
function mirrorSites(
  construct: Construct,
  site: Site,
  mirror: boolean | undefined,
  gap = false,
): Site[] {
  if (!mirror) return [site];
  const signature = chainSignature(site.chain);
  const fits = (c: Chain): boolean =>
    gap ? site.index <= c.domains.length : site.index < c.domains.length;
  return construct.chains
    .filter((c) => chainSignature(c) === signature && fits(c))
    .map((c) => ({ chain: c, index: site.index }));
}

let counter = 0;
/** An id no positional form can collide with: `Number('n7')` is not a number. */
function freshId(construct: Construct, chainId: string): string {
  const taken = new Set(construct.chains.flatMap((c) => c.domains.map((d) => d.id)));
  let id: string;
  do {
    id = `${chainId}:n${++counter}`;
  } while (taken.has(id));
  return id;
}

function freeChainId(construct: Construct, base: string): string {
  const taken = new Set(construct.chains.map((c) => c.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

const linkTouches = (link: Link, ids: Set<string>): boolean => ids.has(link.a) || ids.has(link.b);

// --- the edits --------------------------------------------------------------

/**
 * Apply one edit and hand back a new construct.
 *
 * Two promises, and they are the whole point of this module:
 *
 * - **It holds the edit.** Nothing is inserted, paired or completed that the
 *   edit did not ask for. Adding a VH does not conjure a VL; adding a
 *   conjugation site does not invent a compound. What is missing afterwards is
 *   for `lint` to say, not for this to quietly fix.
 * - **It keeps its footing.** The construct is expanded first, so every domain
 *   carries an explicit id and an insertion cannot renumber the domains after
 *   it — which is how an `@pair` line silently comes to mean two different
 *   domains before and after an edit.
 */
export function applyEdit(input: Construct, edit: Edit): EditResult {
  const construct = expandForEditing(input);
  const touched: string[] = [];

  const domainSites = (ref: DomainRef, mirror?: boolean): Site[] => {
    const site = siteOf(construct, ref);
    return site ? mirrorSites(construct, site, mirror) : [];
  };

  switch (edit.op) {
    case 'insert-domain': {
      const anchor = construct.chains.find((c) => c.id === edit.at.chain);
      if (!anchor) break;
      const index = Math.max(0, Math.min(edit.at.index, anchor.domains.length));
      for (const site of mirrorSites(construct, { chain: anchor, index }, edit.mirror, true)) {
        const id = edit.domain.id && site.chain === anchor
          ? edit.domain.id
          : freshId(construct, site.chain.id);
        const domain: Domain = { ...edit.domain, id };
        site.chain.domains.splice(Math.min(site.index, site.chain.domains.length), 0, domain);
        touched.push(id);
      }
      break;
    }

    case 'remove-domain': {
      const gone = new Set<string>();
      for (const site of domainSites(edit.ref, edit.mirror)) {
        const [removed] = site.chain.domains.splice(site.index, 1);
        if (removed?.id) gone.add(removed.id);
      }
      if (construct.links) construct.links = construct.links.filter((l) => !linkTouches(l, gone));
      break;
    }

    case 'replace-domain': {
      for (const site of domainSites(edit.ref, edit.mirror)) {
        const current = site.chain.domains[site.index]!;
        site.chain.domains[site.index] = { ...current, ...edit.domain, id: current.id };
        touched.push(current.id!);
      }
      break;
    }

    case 'set-specificity': {
      for (const site of domainSites(edit.ref, edit.mirror)) {
        const current = site.chain.domains[site.index]!;
        const next: Domain = { ...current };
        if (edit.specificity == null) delete next.specificity;
        else next.specificity = edit.specificity;
        site.chain.domains[site.index] = next;
        touched.push(current.id!);
      }
      break;
    }

    case 'add-modification':
    case 'add-conjugation': {
      for (const site of domainSites(edit.ref, edit.mirror)) {
        const current = site.chain.domains[site.index]!;
        const modification: Modification =
          edit.op === 'add-modification'
            ? edit.modification
            : // A conjugation site with no compound on it yet is a legitimate
              // half-made thing; `lint` reports what is still blank.
              { type: 'drug', payload: { ...(edit.payload ?? {}) } };
        site.chain.domains[site.index] = {
          ...current,
          modifications: [...(current.modifications ?? []), modification],
        };
        touched.push(current.id!);
      }
      break;
    }

    case 'remove-modification': {
      for (const site of domainSites(edit.ref, edit.mirror)) {
        const current = site.chain.domains[site.index]!;
        const mods = [...(current.modifications ?? [])];
        if (edit.index < 0 || edit.index >= mods.length) continue;
        mods.splice(edit.index, 1);
        site.chain.domains[site.index] = { ...current, modifications: mods };
        touched.push(current.id!);
      }
      break;
    }

    case 'append-fab': {
      const anchor = construct.chains.find((c) => c.id === edit.chain);
      if (!anchor) break;
      const heavies = edit.mirror
        ? construct.chains.filter((c) => chainSignature(c) === chainSignature(anchor))
        : [anchor];
      const links = (construct.links ??= []);
      for (const heavy of heavies) {
        const spec = edit.specificity;
        const vh: Domain = { id: freshId(construct, heavy.id), type: 'VH' };
        const ch1: Domain = { id: freshId(construct, heavy.id), type: 'CH1' };
        if (spec) vh.specificity = spec;
        const lightId = freeChainId(construct, 'LC');
        const vl: Domain = { id: `${lightId}:0`, type: 'VL' };
        const cl: Domain = { id: `${lightId}:1`, type: 'CL' };
        if (spec) vl.specificity = spec;
        if (edit.end === 'N') heavy.domains.unshift(vh, ch1);
        else heavy.domains.push(vh, ch1);
        construct.chains.push({ id: lightId, kind: 'light', domains: [vl, cl] });
        // The light chain is the other half of what "a Fab" means, so it comes
        // with one. Which heavy chain it belongs to is stated rather than left
        // to be worked out, because a second Fab is exactly the situation the
        // positional walk gets wrong.
        links.push({ type: 'pair', a: vh.id!, b: vl.id! });
        links.push({ type: 'pair', a: ch1.id!, b: cl.id! });
        touched.push(vh.id!, ch1.id!, vl.id!, cl.id!);
      }
      break;
    }

    case 'add-chain': {
      const id = freeChainId(construct, edit.chain.id || 'C');
      const domains = edit.chain.domains.map((d, i) => ({ ...d, id: d.id ?? `${id}:${i}` }));
      construct.chains.push({ ...edit.chain, id, domains });
      touched.push(...domains.map((d) => d.id!));
      break;
    }

    case 'remove-chain': {
      const chain = construct.chains.find((c) => c.id === edit.id);
      if (!chain) break;
      const gone = new Set(chain.domains.map((d) => d.id!).filter(Boolean));
      construct.chains = construct.chains.filter((c) => c !== chain);
      if (construct.links) construct.links = construct.links.filter((l) => !linkTouches(l, gone));
      break;
    }

    case 'set-pair': {
      const ends = new Set([edit.a, edit.b]);
      const links = (construct.links ?? []).filter(
        (l) => !(l.type === 'pair' && linkTouches(l, ends)),
      );
      links.push({ type: 'pair', a: edit.a, b: edit.b });
      construct.links = links;
      touched.push(edit.a, edit.b);
      break;
    }

    case 'clear-pair': {
      const ends = new Set([edit.ref]);
      construct.links = (construct.links ?? []).filter(
        (l) => !(l.type === 'pair' && linkTouches(l, ends)),
      );
      touched.push(edit.ref);
      break;
    }

    case 'set-disulfide': {
      const ends = new Set([edit.a, edit.b]);
      const links = (construct.links ?? []).filter(
        (l) => !(l.type === 'disulfide' && linkTouches(l, ends)),
      );
      links.push({ type: 'disulfide', a: edit.a, b: edit.b });
      construct.links = links;
      touched.push(edit.a, edit.b);
      break;
    }

    case 'clear-disulfide': {
      const ends = new Set([edit.ref]);
      construct.links = (construct.links ?? []).filter(
        (l) => !(l.type === 'disulfide' && linkTouches(l, ends)),
      );
      touched.push(edit.ref);
      break;
    }

    case 'rename': {
      if (edit.name == null) delete construct.name;
      else construct.name = edit.name;
      break;
    }

    default: {
      // Every op is handled. If a new one is added and forgotten, this stops
      // compiling rather than silently doing nothing — which, for an editor,
      // is the difference between a bug and a mystery.
      const unreachable: never = edit;
      void unreachable;
    }
  }

  if (construct.links?.length === 0) delete construct.links;
  return { construct, touched };
}

/** Domain types that can stand on their own in a chain, for a menu. */
export const INSERTABLE_TYPES: readonly DomainType[] = (
  Object.keys(DOMAIN_CATALOG) as DomainType[]
).filter((t) => t !== 'scFv' && t !== 'Fab');
