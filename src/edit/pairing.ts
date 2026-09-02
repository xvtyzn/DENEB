import { DOMAIN_CATALOG, FC_TYPES, VARIABLE_TYPES, canPair, pairSide } from '../model/catalog';
import { partitionHeavy } from '../model/segments';
import type {
  Diagnostic,
  DomainRef,
  NChain,
  NDomain,
  NormalizedConstruct,
  PairingRule,
} from '../model/types';

export interface PairingSuggestion {
  /** The domain that could not be settled. */
  ref: DomainRef;
  /** What it could legitimately pair with. */
  candidates: DomainRef[];
  /** The line that would settle it, ready to paste. */
  hint: string;
}

export interface PairingReport {
  resolved: DomainRef[];
  ambiguous: DomainRef[];
  /** Pairable domains with nothing at all to pair with. */
  unresolved: DomainRef[];
  diagnostics: Diagnostic[];
  /** Offered, never applied. */
  suggestions: PairingSuggestion[];
}

const openPairable = (d: NDomain): boolean =>
  (DOMAIN_CATALOG[d.type] ?? DOMAIN_CATALOG.custom).pairs && !d.partner;

/** What a chain is, ignoring which copy of it this is. */
function signatureOf(chain: NChain): string {
  return chain.domains
    .map(
      (d) =>
        `${d.type}:${d.specificity ?? ''}:${d.isotype ?? ''}:` +
        d.modifications
          .map((m) => m.type)
          .sort()
          .join('+'),
    )
    .join('-');
}

/**
 * Two chains that are identical in every respect the model records are not a
 * choice about the molecule — they are the same chain written twice. Ranking
 * them lets a candidate set of "LC1:1 or LC1(2):1" collapse to one answer
 * instead of being reported as a decision the author has to make.
 */
class Interchange {
  private readonly signature = new Map<string, string>();
  private readonly rank = new Map<string, number>();
  private readonly chainById = new Map<string, NChain>();

  constructor(construct: NormalizedConstruct) {
    const seen = new Map<string, number>();
    for (const chain of construct.chains) {
      this.chainById.set(chain.id, chain);
      const sig = signatureOf(chain);
      this.signature.set(chain.id, sig);
      const n = seen.get(sig) ?? 0;
      this.rank.set(chain.id, n);
      seen.set(sig, n + 1);
    }
  }

  chain(id: string): NChain | undefined {
    return this.chainById.get(id);
  }

  /** A key that is equal for domains that stand in the same structural place. */
  slot(d: NDomain): string {
    return `${this.signature.get(d.chainId) ?? d.chainId}#${d.index}`;
  }

  rankOf(d: NDomain): number {
    return this.rank.get(d.chainId) ?? 0;
  }

  /**
   * One answer, or none. Candidates in a single slot are interchangeable, so
   * the one whose copy matches `from`'s is the only sensible reading.
   */
  collapse(from: NDomain, candidates: NDomain[]): NDomain | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0]!;
    const slots = new Set(candidates.map((c) => this.slot(c)));
    if (slots.size > 1) return null;
    const wanted = this.rankOf(from);
    return candidates.find((c) => this.rankOf(c) === wanted) ?? null;
  }
}

function specificityCompatible(a: NDomain, b: NDomain): boolean {
  return !a.specificity || !b.specificity || a.specificity === b.specificity;
}

/** Everything `a` could pair with, anywhere in the molecule. */
function candidatesFor(a: NDomain, all: NDomain[]): NDomain[] {
  return all.filter(
    (b) => b !== a && openPairable(b) && canPair(a.type, b.type) && specificityCompatible(a, b),
  );
}

function join(a: NDomain, b: NDomain, by: PairingRule, candidates: NDomain[]): void {
  a.partner = b.id;
  b.partner = a.id;
  const refs = candidates.map((c) => c.id);
  a.pairing = { state: 'resolved', by, ...(refs.length > 1 ? { candidates: refs } : {}) };
  b.pairing = { state: 'resolved', by, ...(refs.length > 1 ? { candidates: refs } : {}) };
}

/**
 * Decide the pairing graph from what the construct actually says, and report
 * everything it does not say.
 *
 * Hand it a construct normalized with `{ pairing: 'explicit' }` — the author's
 * `@pair` lines and the Fc contact will already be in place, and nothing will
 * have been guessed on top of them.
 *
 * The difference from the inference in `normalize()` is not strictness for its
 * own sake. That walk assigns greedily in listing order, and a greedy
 * assignment destroys the options that would have led to the right answer: on
 * an IgG with a C-terminal Fab it hands the first light chain to the second
 * heavy chain and then has nothing left for the rest, orphaning six constant
 * domains. Deciding from a clean slate reaches the answer the author would
 * have written by hand — and where there genuinely is a choice, it makes none
 * and says so.
 *
 * Fills `partner` and `pairing` on the construct you pass in.
 */
export function resolvePairing(construct: NormalizedConstruct): PairingReport {
  const all = construct.chains.flatMap((c) => c.domains);
  const interchange = new Interchange(construct);
  const diagnostics: Diagnostic[] = [];

  // Whatever already has a partner came from an `@pair` line or from the Fc
  // contact; both are statements, not guesses.
  for (const d of all) {
    if (!d.partner) continue;
    d.pairing = { state: 'resolved', by: FC_TYPES.has(d.type) ? 'fc' : 'explicit' };
  }
  const fcChains = construct.chains.filter((c) => c.domains.some((x) => FC_TYPES.has(x.type)));
  if (fcChains.length > 2) {
    for (const d of all) {
      if (FC_TYPES.has(d.type) && d.pairing?.by === 'fc') d.pairing.state = 'ambiguous';
    }
  }

  // --- 1. Fv pairs formed inside one chain (scFv) --------------------------
  //
  // A linker between two pairable domains is there to hold them together, so
  // adjacency across one is evidence in its own right and does not need a
  // target to back it up. What it cannot settle on its own is which of *two*
  // linked neighbours a domain belongs to — a tandem `VH~VL~VH'` reads both
  // ways — so only another adjacency competes with this one. A domain on some
  // other chain does not.
  const linkedNeighbours = (chain: NChain, d: NDomain): NDomain[] => {
    const out: NDomain[] = [];
    for (const other of chain.domains) {
      if (other === d || !openPairable(other) || !canPair(d.type, other.type)) continue;
      const [lo, hi] = d.index < other.index ? [d, other] : [other, d];
      if (chain.domains.slice(lo.index + 1, hi.index).every((x) => x.type === 'linker')) {
        out.push(other);
      }
    }
    return out;
  };

  /**
   * The one neighbour this domain belongs to, or nothing.
   *
   * A shared target beats mere adjacency, which is what tells a tandem scFv
   * (`VH_a~VL_a~VH_b~VL_b`, where the middle VL touches both VHs) from a chain
   * where the answer really is open.
   */
  const preferred = (chain: NChain, d: NDomain): NDomain | null => {
    const neighbours = linkedNeighbours(chain, d).filter((n) => specificityCompatible(d, n));
    const named = d.specificity
      ? neighbours.filter((n) => n.specificity === d.specificity)
      : [];
    if (named.length === 1) return named[0]!;
    if (named.length > 1) return null;
    return neighbours.length === 1 ? neighbours[0]! : null;
  };

  for (const chain of construct.chains) {
    for (const a of chain.domains) {
      if (!openPairable(a)) continue;
      const b = preferred(chain, a);
      // Both halves have to agree, or it is not a pair — it is one domain's
      // opinion about another that has somewhere better to be.
      if (b && preferred(chain, b) === a) join(a, b, 'intra-chain', [b]);
    }
  }

  // --- 2. Variable domains across chains, by target ------------------------
  for (const a of all) {
    if (!openPairable(a) || !a.specificity || !pairSide(a.type)) continue;
    const candidates = candidatesFor(a, all).filter(
      (b) => b.chainId !== a.chainId && b.specificity === a.specificity,
    );
    const pick = interchange.collapse(a, candidates);
    if (pick) join(a, pick, 'specificity', candidates);
  }

  // --- 3. Light chains, anchored to a heavy chain and to one of its segments
  const heavies = construct.chains.filter((c) => c.kind === 'heavy');
  for (const light of construct.chains.filter((c) => c.kind === 'light')) {
    const open = light.domains.filter(openPairable);
    if (open.length === 0) continue;

    // Ownership comes from a pair already settled, never from listing order.
    const anchors = light.domains
      .map((d) => (d.partner ? construct.byId.get(d.partner) : undefined))
      .filter((d): d is NDomain => !!d && d.chainId !== light.id);
    const owners = new Set(anchors.map((d) => d.chainId));

    let owner: NChain | undefined;
    if (owners.size === 1) owner = interchange.chain([...owners][0]!);
    else if (owners.size === 0 && light.partnerChain) owner = interchange.chain(light.partnerChain);
    else if (owners.size === 0 && heavies.length === 1) owner = heavies[0];

    if (!owner) {
      diagnostics.push({
        level: 'warning',
        code: 'light-chain-unanchored',
        message:
          `Light chain "${light.id}" is not tied to a heavy chain by any settled pair, ` +
          `so which one it belongs to is a choice the notation has not made.`,
        ref: open[0]!.id,
      });
      continue;
    }

    const part = partitionHeavy(owner);
    const anchorIds = new Set(anchors.filter((d) => d.chainId === owner!.id).map((d) => d.id));
    const inN = part.nTerm.some((d) => anchorIds.has(d.id));
    const inC = part.cTerm.some((d) => anchorIds.has(d.id));

    // Fc domains are pairable in the catalogue (CH3 dimerizes), so leaving them
    // in the walk is what puts it out of step: a CL is offered a CH2, `canPair`
    // says no, and every domain after it is misaligned.
    const openIn = (list: NDomain[]): NDomain[] =>
      list.filter((d) => openPairable(d) && !FC_TYPES.has(d.type));

    let segment: NDomain[] | null = null;
    if (inC && !inN) segment = openIn(part.cTerm);
    else if (inN && !inC) segment = openIn(part.nTerm);
    else if (!inN && !inC) {
      const n = openIn(part.nTerm);
      const c = openIn(part.cTerm);
      if (n.length > 0 && c.length === 0) segment = n;
      else if (c.length > 0 && n.length === 0) segment = c;
    }

    if (!segment) {
      diagnostics.push({
        level: 'warning',
        code: 'light-chain-segment-ambiguous',
        message:
          `Light chain "${light.id}" could sit on either end of "${owner.id}"; ` +
          `say which with an @pair line.`,
        ref: open[0]!.id,
      });
      continue;
    }

    // N->C, and stop at the first mismatch rather than skipping past it: a walk
    // that steps over a domain it cannot use has already lost its place.
    for (let i = 0; i < Math.min(open.length, segment.length); i++) {
      const l = open[i]!;
      const h = segment[i]!;
      if (l.partner || h.partner) break;
      if (!canPair(h.type, l.type)) break;
      join(h, l, 'heavy-light', [l]);
    }
  }

  // --- what is left ---------------------------------------------------------
  const resolved: DomainRef[] = [];
  const ambiguous: DomainRef[] = [];
  const unresolved: DomainRef[] = [];
  const suggestions: PairingSuggestion[] = [];

  for (const d of all) {
    if (!(DOMAIN_CATALOG[d.type] ?? DOMAIN_CATALOG.custom).pairs) continue;
    if (d.partner) {
      if (d.pairing?.state === 'ambiguous') ambiguous.push(d.id);
      else resolved.push(d.id);
      continue;
    }
    const candidates = candidatesFor(d, all);
    if (candidates.length === 0) {
      d.pairing = { state: 'none' };
      unresolved.push(d.id);
      continue;
    }
    const refs = candidates.map((c) => c.id);
    d.pairing = { state: 'ambiguous', candidates: refs };
    ambiguous.push(d.id);
    suggestions.push({
      ref: d.id,
      candidates: refs,
      hint: `@pair ${d.id} ${refs[0]}`,
    });
    diagnostics.push({
      level: 'warning',
      code: 'ambiguous-pairing',
      message:
        `${d.type} ${d.id} could pair with ${refs.join(' or ')}; ` +
        `nothing in the notation says which, so it was left unpaired.`,
      ref: d.id,
    });
  }

  construct.diagnostics.push(...diagnostics);
  construct.layout.armMode = inferArmMode(construct);
  return { resolved, ambiguous, unresolved, diagnostics, suggestions };
}

/**
 * Re-derived here because `normalize` computed it before this pass had decided
 * anything, so under `pairing: 'explicit'` its answer was drawn from an empty
 * graph.
 */
function inferArmMode(construct: NormalizedConstruct): 'splayed' | 'crossed' {
  const chainOf = new Map(construct.chains.map((c) => [c.id, c] as const));
  const crossed = construct.chains.some(
    (c) =>
      c.kind !== 'light' &&
      c.domains.some((d) => {
        if (!VARIABLE_TYPES.has(d.type) || !d.partner) return false;
        const other = construct.byId.get(d.partner);
        if (!other || other.chainId === c.id) return false;
        return chainOf.get(other.chainId)?.kind !== 'light';
      }),
  );
  return crossed ? 'crossed' : 'splayed';
}
