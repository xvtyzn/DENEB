import { normalize, resolveRef } from '../model/normalize';
import type {
  Construct,
  Modification,
  NDomain,
  NormalizedConstruct,
} from '../model/types';
import { MODIFICATION_CATALOG } from '../model/catalog';
import {
  DOMAIN_SYMBOLS,
  MOD_FOR_MODIFICATION,
  SYMBOL_FOR_MODIFICATION,
} from './vocabulary';

export interface AbmlStringifyOptions {
  /** Put each chain on its own line. Default true. */
  multiline?: boolean;
  /**
   * Write `[ANTI:…]` on the first domain of each specificity so the target's
   * real name survives the letters AbML uses. Default true.
   */
  includeTargetNames?: boolean;
}

/**
 * Write a construct as AbML v1.06.
 *
 * The specification identifies domains by number and lists which ones interact,
 * so this states the pairing outright rather than leaving a reader to infer it.
 * A round trip preserves the structure — chains, domain order, specificities,
 * modifications and the pairing graph — but not the original text: identifiers
 * are renumbered from one, and a modification this library knows by name is
 * written with its AbML symbol or MOD keyword.
 */
export function toAbML(
  input: Construct | NormalizedConstruct,
  options: AbmlStringifyOptions = {},
): string {
  const construct: NormalizedConstruct = 'byId' in input ? input : normalize(input);

  const ids = new Map<string, number>();
  let next = 1;
  for (const chain of construct.chains) {
    for (const domain of chain.domains) ids.set(domain.id, next++);
  }

  // A specificity that is already a bare AbML letter keeps it, so a string read
  // in and written back out does not silently relabel its targets.
  const letters = new Map<string, string>();
  const taken = new Set<string>();
  for (const s of construct.specificities) {
    if (/^[a-z]$/.test(s.name) && !taken.has(s.name)) {
      letters.set(s.name, s.name);
      taken.add(s.name);
    }
  }
  let nextLetter = 0;
  for (const s of construct.specificities) {
    if (letters.has(s.name)) continue;
    while (taken.has(String.fromCharCode(97 + nextLetter))) nextLetter++;
    const letter = String.fromCharCode(97 + (nextLetter % 26));
    letters.set(s.name, letter);
    taken.add(letter);
    nextLetter++;
  }
  const namedAlready = new Set<string>();

  const partners = interactionMap(construct);
  const disulfides = disulfideMap(construct);

  const chains = construct.chains.map((chain) =>
    chain.domains
      .map((domain) =>
        writeDomain(domain, {
          ids,
          letters,
          namedAlready,
          partners,
          disulfides,
          includeTargetNames: options.includeTargetNames !== false,
        }),
      )
      .join('-'),
  );

  return chains.join(options.multiline === false ? ' | ' : ' |\n');
}

interface WriteContext {
  ids: Map<string, number>;
  letters: Map<string, string>;
  namedAlready: Set<string>;
  partners: Map<string, Set<string>>;
  disulfides: Map<string, number>;
  includeTargetNames: boolean;
}

function writeDomain(domain: NDomain, ctx: WriteContext): string {
  // Anything without a symbol of its own — a fusion partner, a payload — is an
  // Extra Domain, and says what it is in a TYPE comment.
  const symbol = DOMAIN_SYMBOLS[domain.type] ?? 'X';
  let out = symbol;

  const comments: string[] = [];
  const modifications = domain.modifications ?? [];

  // The specification writes the general marker first: `VH*@+.a`.
  let symbols = '';
  for (const modification of modifications) {
    const shorthand = SYMBOL_FOR_MODIFICATION[modification.type];
    if (shorthand) {
      symbols += shorthand;
      continue;
    }
    out += '*';
    if (modification.label !== 'modified') comments.push(`MOD:${modKeyword(modification)}`);
  }
  out += symbols;

  if (domain.specificity) {
    const letter = ctx.letters.get(domain.specificity) ?? 'a';
    out += `.${letter}`;
    // A specificity that is only a letter is what AbML already writes; naming
    // it would just restate the letter.
    const isPlainLetter = /^[a-z]$/.test(domain.specificity);
    if (ctx.includeTargetNames && !isPlainLetter && !ctx.namedAlready.has(domain.specificity)) {
      ctx.namedAlready.add(domain.specificity);
      comments.unshift(`ANTI:${domain.specificity}`);
    }
  }

  const id = ctx.ids.get(domain.id);
  const interactions = [...(ctx.partners.get(domain.id) ?? [])]
    .map((other) => ctx.ids.get(other))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  if (id != null) {
    out += interactions.length > 0 ? `(${id}:${interactions.join(',')})` : `(${id})`;
  }

  const bonds = ctx.disulfides.get(domain.id);
  if (bonds != null && interactions.length > 0) out += `{${bonds}}`;

  if ((symbol === 'X' || symbol === 'C') && domain.label) comments.push(`TYPE:${domain.label}`);
  if (domain.isotype) comments.push(`CLASS:${domain.isotype}`);
  for (const note of domain.notes ?? []) {
    comments.push(/^[A-Z]+:/.test(note) ? note : `NOTE:${note}`);
  }
  // NOTE is free text and the specification puts it last.
  comments.sort((a, b) => Number(a.startsWith('NOTE:')) - Number(b.startsWith('NOTE:')));

  if (comments.length > 0) out += `[${comments.join(',')}]`;
  return out;
}

/** The MOD keyword for a modification, or its own wording when there is none. */
function modKeyword(modification: Modification): string {
  const reserved = MOD_FOR_MODIFICATION[modification.type];
  if (reserved) return reserved;
  const label = modification.label ?? MODIFICATION_CATALOG[modification.type]?.label;
  return label ? label.toUpperCase().replace(/[^A-Z0-9]+/g, '') || 'OTHER' : 'OTHER';
}

/**
 * Who interacts with whom: the inferred partner plus any explicit pairing.
 *
 * A disulphide counts as an interaction — AbML's `{n}` says how many bonds a
 * domain forms *with its interacting partner*, so a hinge written without one
 * would drop the count and leave the two heavy chains unconnected.
 */
function interactionMap(construct: NormalizedConstruct): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string): void => {
    if (a === b) return;
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };

  for (const chain of construct.chains) {
    for (const domain of chain.domains) {
      if (domain.partner) {
        add(domain.id, domain.partner);
        add(domain.partner, domain.id);
      }
    }
  }
  for (const link of construct.links) {
    if (link.type !== 'pair' && link.type !== 'dimer' && link.type !== 'disulfide') continue;
    const a = resolveRef(link.a, construct.chains, construct.byId);
    const b = resolveRef(link.b, construct.chains, construct.byId);
    if (a && b) {
      add(a.id, b.id);
      add(b.id, a.id);
    }
  }
  return map;
}

/**
 * How many disulphides each domain forms with its partner.
 *
 * Only a stated count is written. Normalization pairs a hinge without saying
 * how many bonds hold it, and an IgG1 hinge has two — so defaulting to `{1}`
 * would put a number in the string that nothing in the input claimed. The
 * interaction still says the chains are joined.
 */
function disulfideMap(construct: NormalizedConstruct): Map<string, number> {
  const map = new Map<string, number>();
  for (const link of construct.links) {
    if (link.type !== 'disulfide' || link.count == null) continue;
    const a = resolveRef(link.a, construct.chains, construct.byId);
    const b = resolveRef(link.b, construct.chains, construct.byId);
    for (const domain of [a, b]) if (domain) map.set(domain.id, link.count);
  }
  return map;
}
