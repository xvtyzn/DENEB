import { normalize } from '../model/normalize';
import { DOMAIN_CATALOG } from '../model/catalog';
import type { Chain, Construct, Domain, Link, NDomain } from '../model/types';

/**
 * The label `normalize` would have supplied, so an expanded document does not
 * bake a redundant one into every domain.
 */
function defaultLabel(d: NDomain): string {
  const spec = DOMAIN_CATALOG[d.type] ?? DOMAIN_CATALOG.custom;
  return spec.glyph === 'globule' && d.specificity ? d.specificity : spec.label;
}

function toDomain(d: NDomain): Domain {
  const out: Domain = { id: d.id, type: d.type };
  if (d.label !== defaultLabel(d)) out.label = d.label;
  if (d.specificity != null) out.specificity = d.specificity;
  if (d.start != null) out.start = d.start;
  if (d.end != null) out.end = d.end;
  if (d.isotype != null) out.isotype = d.isotype;
  if (d.regions) out.regions = d.regions;
  if (d.notes) out.notes = d.notes;
  if (d.modifications.length > 0) out.modifications = d.modifications;
  return out;
}

/** The links `pairFc` synthesises, which are structure rather than authorship. */
function isDerived(link: Link, hinges: Set<string>): boolean {
  if (link.type === 'dimer') return true;
  return link.type === 'disulfide' && hinges.has(link.a) && hinges.has(link.b);
}

/**
 * Materialise everything a shorthand stands for, so an edit has something
 * concrete to attach to.
 *
 * `copies: 2`, the `Fab`/`scFv` macros and the common-light-chain rule are all
 * ways of saying "and another one like that". They are excellent notation and
 * hopeless to edit: an insertion into `HC *2` is ambiguous about which arm it
 * means, and a domain with no `id` is addressed by its position, so inserting
 * anything renumbers every domain after it and silently re-points the `@pair`
 * lines that referred to them.
 *
 * Expansion resolves both at once. Every chain becomes a real chain and every
 * domain gets the explicit id it would otherwise have been given implicitly —
 * the very same string, so **the picture does not change**, links keep meaning
 * what they meant, and `resolveRef` finds them by id rather than by counting.
 *
 * Idempotent, and safe to call on anything: a construct that is already
 * expanded comes back unchanged.
 */
export function expandForEditing(construct: Construct): Construct {
  const n = normalize(construct, { pairing: 'explicit' });
  const hinges = new Set(
    n.chains.flatMap((c) => c.domains.filter((d) => d.type === 'hinge').map((d) => d.id)),
  );

  // Copies that exist because a shorthand said so are materialised; copies that
  // exist because something was *missing* are not. A single light chain serving
  // two arms is the second kind: writing it out as two chains would let the two
  // drift apart under editing and quietly stop being a common light chain.
  const chains: Chain[] = n.chains.filter((c) => !c.inferredCopy).map((c) => {
    const chain: Chain = { id: c.id, kind: c.kind, domains: c.domains.map(toDomain) };
    if (c.sequence != null) chain.sequence = c.sequence;
    // A common light chain written once and shared is materialised into one
    // chain per arm. Which arm each copy belongs to is the whole content of
    // that shorthand, so it is written down rather than left to be guessed
    // again from two now-identical chains.
    if (c.partnerChain != null) chain.partnerChain = c.partnerChain;
    return chain;
  });

  const out: Construct = { chains };
  if (construct.name != null) out.name = construct.name;
  const links = n.links.filter((l) => !isDerived(l, hinges));
  if (links.length > 0) out.links = links;
  if (construct.specificities) out.specificities = construct.specificities.map((s) => ({ ...s }));
  if (construct.layout) out.layout = { ...construct.layout };
  return out;
}
