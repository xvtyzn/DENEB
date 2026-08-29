import type {
  Chain,
  Construct,
  Diagnostic,
  Domain,
  DomainRef,
  DomainType,
  Link,
  NChain,
  NDomain,
  NormalizedConstruct,
} from './types';
import {
  DOMAIN_CATALOG,
  FC_TYPES,
  MODIFICATION_ALIASES,
  VARIABLE_TYPES,
  canPair,
  pairSide,
} from './catalog';
import { assignSpecificityColors } from '../theme/palette';
import { resolveTheme, type Theme } from '../theme/theme';

export interface NormalizeOptions {
  theme?: Partial<Theme>;
}

/**
 * Fill in defaults, expand composite domains, infer inter-chain pairing and
 * validate. Never throws: anything ambiguous or malformed is reported through
 * `diagnostics` and a best-effort structure is still returned, so a partially
 * annotated construct coming out of a domain-calling pipeline still renders.
 */
export function normalize(construct: Construct, options: NormalizeOptions = {}): NormalizedConstruct {
  const diagnostics: Diagnostic[] = [];
  const theme = resolveTheme(options.theme);

  const expanded = expandChains(construct.chains ?? [], diagnostics);
  const explicitKinds = new Set(expanded.filter((c) => c.kind).map((c) => c.id));
  const chains: NChain[] = expanded.flatMap((c) => buildChains(c, diagnostics));
  assignChainKinds(chains, explicitKinds);
  materializeCommonLightChain(chains, diagnostics);

  const byId = new Map<string, NDomain>();
  for (const chain of chains) {
    for (const d of chain.domains) {
      if (byId.has(d.id)) {
        diagnostics.push({
          level: 'warning',
          code: 'duplicate-domain-id',
          message: `Duplicate domain id "${d.id}"; the later one was renamed.`,
          ref: d.id,
        });
        d.id = `${d.id}#${chain.domains.indexOf(d)}`;
      }
      byId.set(d.id, d);
    }
  }

  const links: Link[] = [...(construct.links ?? [])];
  applyExplicitPairs(links, chains, byId, diagnostics);
  pairIntraChain(chains);
  pairAcrossVariableDomains(chains);
  pairHeavyLight(chains, diagnostics);
  const dimerLinks = pairFc(chains);
  links.push(...dimerLinks);

  const order: string[] = [];
  for (const chain of chains) {
    for (const d of chain.domains) {
      if (d.specificity && !order.includes(d.specificity)) order.push(d.specificity);
    }
  }

  reportUnpaired(chains, diagnostics);

  return {
    name: construct.name,
    chains,
    links,
    specificities: assignSpecificityColors(construct.specificities, order, theme),
    layout: {
      skeleton: construct.layout?.skeleton ?? inferSkeleton(chains),
      armAngle: construct.layout?.armAngle ?? theme.armAngle,
      armMode: construct.layout?.armMode ?? inferArmMode(chains),
    },
    byId,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Shorthand expansion
// ---------------------------------------------------------------------------

function expandChains(input: Chain[], diagnostics: Diagnostic[]): Chain[] {
  const out: Chain[] = [];
  for (const chain of input) {
    const domains: Domain[] = [];
    const companions: Domain[] = [];
    for (const d of chain.domains ?? []) {
      if (!DOMAIN_CATALOG[d.type]) {
        diagnostics.push({
          level: 'warning',
          code: 'unknown-domain-type',
          message: `Unknown domain type "${d.type}" in chain "${chain.id}"; drawn as a custom domain.`,
          ref: chain.id,
        });
        domains.push({ ...d, type: 'custom', label: d.label ?? String(d.type) });
        continue;
      }
      if (d.type === 'scFv') {
        const { modifications, ...rest } = d;
        domains.push({ ...rest, id: undefined, type: 'VH' });
        domains.push({ type: 'linker' });
        domains.push({ ...rest, id: undefined, type: 'VL', modifications });
      } else if (d.type === 'Fab') {
        const { modifications, ...rest } = d;
        domains.push({ ...rest, id: undefined, type: 'VH' });
        domains.push({ ...rest, id: undefined, type: 'CH1', modifications });
        companions.push({ ...rest, id: undefined, type: 'VL' });
        companions.push({ ...rest, id: undefined, type: 'CL' });
      } else {
        domains.push(d);
      }
    }
    out.push({ ...chain, domains });
    if (companions.length > 0) {
      out.push({ id: `${chain.id}-L`, kind: 'light', domains: companions });
    }
  }
  return out;
}

/** One `Chain` becomes `copies` normalized chains (default 1). */
function buildChains(chain: Chain, diagnostics: Diagnostic[]): NChain[] {
  const copies = Math.max(1, Math.floor(chain.copies ?? 1));
  const first = buildChain(chain, chain.id, diagnostics);
  if (copies === 1) return [first];
  const out = [first];
  for (let i = 2; i <= copies; i++) {
    const clone = buildChain(chain, `${chain.id}(${i})`, diagnostics);
    clone.cloneOf = first.id;
    out.push(clone);
  }
  return out;
}

function buildChain(chain: Chain, chainId: string, diagnostics: Diagnostic[]): NChain {
  const id = chainId || chain.id || `chain${diagnostics.length}`;
  const domains: NDomain[] = (chain.domains ?? []).map((d, index) => {
    const spec = DOMAIN_CATALOG[d.type] ?? DOMAIN_CATALOG.custom;
    // A fusion partner is better identified by what it is (`IL-2`) than by its
    // generic class (`cytokine`), and the generic name rarely fits the circle.
    const fallbackLabel =
      spec.glyph === 'globule' && d.specificity ? d.specificity : spec.label;
    return {
      id: d.id ?? `${id}:${index}`,
      chainId: id,
      index,
      type: d.type,
      label: d.label ?? fallbackLabel,
      specificity: d.specificity,
      start: d.start,
      end: d.end,
      isotype: d.isotype,
      regions: d.regions,
      notes: d.notes,
      modifications: (d.modifications ?? []).map((m) => ({
        ...m,
        type: MODIFICATION_ALIASES[String(m.type).toLowerCase()] ?? m.type,
      })),
    };
  });

  if (chain.sequence) {
    for (const d of domains) {
      if (d.start != null && d.end != null && (d.start < 1 || d.end > chain.sequence.length)) {
        diagnostics.push({
          level: 'warning',
          code: 'range-out-of-bounds',
          message: `Domain ${d.id} range ${d.start}-${d.end} falls outside the ${chain.sequence.length}-residue sequence.`,
          ref: d.id,
        });
      }
    }
  }

  return { id, kind: chain.kind ?? 'single', sequence: chain.sequence, domains };
}

function isHeavyBackbone(chain: NChain): boolean {
  return chain.domains.some((d) => FC_TYPES.has(d.type) || d.type === 'hinge');
}

function hasType(chain: NChain, type: DomainType): boolean {
  return chain.domains.some((d) => d.type === type);
}

/**
 * Heavy/light assignment has to be made relative to the whole molecule, not
 * chain by chain: a CrossMab light chain carries CH1 rather than CL, so
 * composition alone would call it heavy. An Fc or a hinge marks a heavy chain;
 * once any exists, every other chain carrying a Fab constant domain is light.
 * Molecules with no Fc at all (a bare Fab) fall back to CH1 vs CL.
 */
function assignChainKinds(chains: NChain[], explicit: Set<string>): void {
  const backbone = chains.filter(isHeavyBackbone);
  for (const chain of chains) {
    if (explicit.has(chain.id)) continue;
    const structural = chain.domains.filter((d) => d.type !== 'linker');
    if (
      structural.length > 0 &&
      structural.every((d) => DOMAIN_CATALOG[d.type].glyph === 'globule')
    ) {
      chain.kind = 'other';
      continue;
    }
    if (isHeavyBackbone(chain)) {
      chain.kind = 'heavy';
      continue;
    }
    const fabConstant = hasType(chain, 'CH1') || hasType(chain, 'CL');
    if (backbone.length > 0) {
      chain.kind = fabConstant ? 'light' : 'single';
      continue;
    }
    if (hasType(chain, 'CH1')) chain.kind = 'heavy';
    else if (hasType(chain, 'CL')) chain.kind = 'light';
    else chain.kind = 'single';
  }
}

/**
 * A common-light-chain design lists one light chain for several heavy chains.
 * Each heavy chain still needs its own light chain in the picture, so the
 * shared one is cloned up to the heavy-chain count.
 *
 * Only heavy chains that have somewhere to put one count. An scFv-Fc arm has
 * no CH1, so cloning a light chain onto it would invent a chain the molecule
 * does not have — which is exactly the shape of a one-armed asymmetric format.
 */
function materializeCommonLightChain(chains: NChain[], diagnostics: Diagnostic[]): void {
  const heavies = chains.filter(
    (c) => c.kind === 'heavy' && c.domains.some((d) => d.type === 'CH1' || d.type === 'CL'),
  );
  const lights = chains.filter((c) => c.kind === 'light');
  if (lights.length !== 1 || heavies.length < 2) return;
  const source = lights[0]!;
  source.partnerChain = heavies[0]!.id;
  for (let i = 2; i <= heavies.length; i++) {
    const clone: NChain = {
      id: `${source.id}(${i})`,
      kind: source.kind,
      sequence: source.sequence,
      cloneOf: source.id,
      partnerChain: heavies[i - 1]!.id,
      domains: source.domains.map((d) => ({
        ...d,
        id: `${source.id}(${i}):${d.index}`,
        chainId: `${source.id}(${i})`,
        modifications: d.modifications.map((m) => ({ ...m })),
      })),
    };
    chains.push(clone);
  }
  diagnostics.push({
    level: 'info',
    code: 'common-light-chain-cloned',
    message: `Common light chain "${source.id}" was cloned for ${heavies.length} heavy chains.`,
    ref: source.id,
  });
}

// ---------------------------------------------------------------------------
// Pairing inference
// ---------------------------------------------------------------------------

function link(a: NDomain, b: NDomain): void {
  a.partner = b.id;
  b.partner = a.id;
}

/** `"HC1:CH3"`, `"HC1:2"` or a bare domain id. */
export function resolveRef(
  ref: DomainRef,
  chains: NChain[],
  byId: Map<string, NDomain>,
): NDomain | undefined {
  const direct = byId.get(ref);
  if (direct) return direct;
  const sep = ref.lastIndexOf(':');
  if (sep < 0) return undefined;
  const chainId = ref.slice(0, sep);
  const key = ref.slice(sep + 1);
  const chain = chains.find((c) => c.id === chainId);
  if (!chain) return undefined;
  const asIndex = Number(key);
  if (Number.isInteger(asIndex)) return chain.domains[asIndex];
  return chain.domains.find((d) => d.type === (key as DomainType));
}

function applyExplicitPairs(
  links: Link[],
  chains: NChain[],
  byId: Map<string, NDomain>,
  diagnostics: Diagnostic[],
): void {
  for (const l of links) {
    if (l.type !== 'pair' && l.type !== 'dimer') continue;
    const a = resolveRef(l.a, chains, byId);
    const b = resolveRef(l.b, chains, byId);
    if (!a || !b) {
      diagnostics.push({
        level: 'warning',
        code: 'unresolved-link',
        message: `Link ${l.a} <-> ${l.b} could not be resolved.`,
      });
      continue;
    }
    link(a, b);
  }
}

/**
 * Fv pairs formed inside one chain (scFv). Only fires when the two domains
 * agree on specificity — this is what keeps a DART/diabody (VH_a~VL_b) from
 * being mistaken for a plain scFv.
 */
function pairIntraChain(chains: NChain[]): void {
  for (const chain of chains) {
    const variables = chain.domains.filter((d) => DOMAIN_CATALOG[d.type].pairs && !d.partner);
    for (let i = 0; i < variables.length - 1; i++) {
      const a = variables[i]!;
      const b = variables[i + 1]!;
      if (a.partner || b.partner) continue;
      if (!canPair(a.type, b.type)) continue;
      const compatible =
        !a.specificity || !b.specificity || a.specificity === b.specificity;
      if (!compatible) continue;
      const between = chain.domains.slice(a.index + 1, b.index);
      if (!between.every((d) => d.type === 'linker')) continue;
      link(a, b);
    }
  }
}

/** Remaining variable domains pair across chains by matching specificity. */
function pairAcrossVariableDomains(chains: NChain[]): void {
  const open = chains.flatMap((c) =>
    c.domains.filter((d) => DOMAIN_CATALOG[d.type].pairs && !d.partner && pairSide(d.type)),
  );
  for (const a of open) {
    if (a.partner || !a.specificity) continue;
    const side = pairSide(a.type);
    const match = open.find(
      (b) =>
        !b.partner &&
        b !== a &&
        b.chainId !== a.chainId &&
        b.specificity === a.specificity &&
        pairSide(b.type) !== side &&
        canPair(a.type, b.type),
    );
    if (match) link(a, match);
  }
}

/**
 * Classic heavy/light association: each heavy chain claims the light chains
 * listed after it (or the single light chain of a common-LC design), then the
 * two chains' still-unpaired pairable domains are matched in N->C order. This
 * handles CrossMab swaps for free because matching is by position, not by type.
 */
function pairHeavyLight(chains: NChain[], diagnostics: Diagnostic[]): void {
  const heavies = chains.filter((c) => c.kind === 'heavy');
  const lights = chains.filter((c) => c.kind === 'light');
  if (heavies.length === 0 || lights.length === 0) return;

  const groups = new Map<NChain, NChain[]>();
  for (const h of heavies) groups.set(h, []);

  // Explicit association wins (common-LC clones carry it); otherwise a light
  // chain belongs to the most recent heavy chain listed before it.
  let current: NChain | null = null;
  for (const c of chains) {
    if (c.kind === 'heavy') {
      current = c;
      continue;
    }
    if (c.kind !== 'light') continue;
    const explicit = c.partnerChain ? heavies.find((h) => h.id === c.partnerChain) : undefined;
    const owner = explicit ?? current;
    if (owner) groups.get(owner)!.push(c);
  }

  // Symmetric molecules written as `copies: 2` produce H,H',L,L' in that order,
  // which the sequential rule would lump onto the second heavy chain. When the
  // counts match one-to-one, pair them by index instead.
  if (lights.length === heavies.length && heavies.some((h) => groups.get(h)!.length === 0)) {
    heavies.forEach((h, i) => groups.set(h, [lights[i]!]));
  }

  const commonLc = lights.length === 1 ? lights[0]! : null;
  for (const h of heavies) {
    let partners = groups.get(h)!;
    if (partners.length === 0 && commonLc) {
      partners = [commonLc];
      diagnostics.push({
        level: 'info',
        code: 'common-light-chain',
        message: `Chain "${h.id}" was paired with the single light chain "${commonLc.id}".`,
        ref: h.id,
      });
    }
    for (const l of partners) {
      const hOpen = h.domains.filter((d) => DOMAIN_CATALOG[d.type].pairs && !d.partner);
      const lOpen = l.domains.filter((d) => DOMAIN_CATALOG[d.type].pairs && !d.partner);
      const n = Math.min(hOpen.length, lOpen.length);
      for (let i = 0; i < n; i++) {
        const a = hOpen[i]!;
        const b = lOpen[i]!;
        if (canPair(a.type, b.type)) link(a, b);
      }
    }
  }
}

/** CH2/CH3/CH4 of the first two heavy chains dimerize. */
function pairFc(chains: NChain[]): Link[] {
  const fcChains = chains.filter((c) => c.domains.some((d) => FC_TYPES.has(d.type)));
  const links: Link[] = [];
  if (fcChains.length < 2) return links;
  const [a, b] = [fcChains[0]!, fcChains[1]!];
  for (const type of ['CH2', 'CH3', 'CH4'] as DomainType[]) {
    const da = a.domains.find((d) => d.type === type);
    const db = b.domains.find((d) => d.type === type);
    if (da && db) {
      link(da, db);
      links.push({ type: 'dimer', a: da.id, b: db.id });
    }
  }
  const ha = a.domains.find((d) => d.type === 'hinge');
  const hb = b.domains.find((d) => d.type === 'hinge');
  if (ha && hb) links.push({ type: 'disulfide', a: ha.id, b: hb.id });
  return links;
}

function reportUnpaired(chains: NChain[], diagnostics: Diagnostic[]): void {
  for (const chain of chains) {
    for (const d of chain.domains) {
      if (!DOMAIN_CATALOG[d.type].pairs || d.partner) continue;
      if (d.type === 'VH' || d.type === 'VL') {
        diagnostics.push({
          level: 'info',
          code: 'unpaired-variable-domain',
          message: `${d.type} ${d.id} has no partner; drawn as a single domain.`,
          ref: d.id,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Skeleton inference
// ---------------------------------------------------------------------------

function inferSkeleton(chains: NChain[]): 'y' | 'row' {
  const hasFc = chains.filter((c) => c.domains.some((d) => FC_TYPES.has(d.type))).length >= 1;
  const hasCh1 = chains.some((c) => c.domains.some((d) => d.type === 'CH1' || d.type === 'CL'));
  return hasFc || hasCh1 ? 'y' : 'row';
}

/**
 * A DART-like module — two chains whose variable domains cross-pair — is drawn
 * as one upright head cluster rather than two splayed arms.
 */
function inferArmMode(chains: NChain[]): 'splayed' | 'crossed' {
  const chainOf = new Map<string, string>();
  for (const c of chains) for (const d of c.domains) chainOf.set(d.id, c.id);

  // Cross-pairing means a *variable* domain on one chain pairs with a variable
  // domain on another chain that also contributes variable domains of its own
  // (diabody / DART / TandAb). CH3 dimerization is not crossing.
  return chains.some((c) =>
    c.domains.some((d) => {
      if (!VARIABLE_TYPES.has(d.type) || !d.partner) return false;
      const other = chainOf.get(d.partner);
      if (!other || other === c.id) return false;
      const otherChain = chains.find((x) => x.id === other);
      if (!otherChain || otherChain.kind === 'light') return false;
      return c.kind !== 'light';
    }),
  )
    ? 'crossed'
    : 'splayed';
}
