import type { NChain, NDomain, NormalizedConstruct } from '../model/types';
import { DOMAIN_CATALOG, FC_TYPES } from '../model/catalog';

/**
 * A unit is what occupies one slot of a ladder: a single domain, or two domains
 * side by side (an Fv head, a CH1/CL pair, a CH3/CH3' dimer, or just two
 * linkers that happen to run alongside each other).
 */
export interface Unit {
  /** One or two domains. `members[0]` takes the inner lane. */
  members: NDomain[];
  /** Linker joining the two members of an intra-chain scFv head. */
  linker?: NDomain;
  /** True when the members are actual binding partners. */
  paired: boolean;
  /** Extent along the ladder axis, including any stagger. */
  height: number;
  /** Extent across the ladder axis. */
  width: number;
  /**
   * True when the two members are joined by a linker within one chain, as an
   * scFv's VH and VL are. They still sit level and side by side the way a paired
   * Fv does; the flag only buys the strand a wider gap to run up.
   */
  linked: boolean;
  /**
   * Swap which lane the members take. Only slots whose two halves are
   * interchangeable are ever turned round; see `orientUnits`.
   */
  flip?: boolean;
}

export function domainHeight(d: NDomain): number {
  return DOMAIN_CATALOG[d.type].height;
}

export function domainWidth(d: NDomain): number {
  return DOMAIN_CATALOG[d.type].width;
}

/** Extra separation between two domains that a linker has to run between. */
export const LINKED_SPREAD = 3;

export function isLinkedPair(members: NDomain[]): boolean {
  return members.length === 2 && members[0]!.chainId === members[1]!.chainId;
}

function makeUnit(members: NDomain[], paired: boolean, linker?: NDomain): Unit {
  const linked = paired && isLinkedPair(members);
  const unit: Unit = {
    members,
    paired,
    linked,
    height: Math.max(...members.map(domainHeight)),
    width: Math.max(...members.map(domainWidth)),
  };
  if (linker) unit.linker = linker;
  return unit;
}

/**
 * Collapse an ordered domain list into units, merging intra-chain partners
 * (an scFv's VH and VL, optionally with the linker between them) into one slot.
 */
export function unitsOfList(list: NDomain[]): Unit[] {
  const out: Unit[] = [];
  const used = new Set<string>();
  for (let k = 0; k < list.length; k++) {
    const d = list[k]!;
    if (used.has(d.id)) continue;
    const next = list[k + 1];
    const afterLinker = list[k + 2];
    // `members[0]` takes the inner lane, and the list is walked from the end of
    // the ladder that attaches to the rest of the molecule. So the domain that
    // carries the chain onward lands against the axis, which is what keeps an
    // scFv-Fc's hinge vertical — and swapping the construct to `VL~VH` still
    // swaps the two halves of the head.
    if (next && d.partner === next.id) {
      used.add(next.id);
      out.push(makeUnit([d, next], true));
      continue;
    }
    if (next?.type === 'linker' && afterLinker && d.partner === afterLinker.id) {
      used.add(next.id);
      used.add(afterLinker.id);
      out.push(makeUnit([d, afterLinker], true, next));
      continue;
    }
    out.push(makeUnit([d], false));
  }
  return out;
}

/** Which lane a member takes, as a multiple of the ladder's `laneSign`. */
export function relativeLane(unit: Unit, index: number): 1 | -1 {
  const primary: 1 | -1 = unit.flip ? -1 : 1;
  if (unit.members.length < 2) return primary;
  return index === 0 ? primary : ((-primary) as 1 | -1);
}

/** The two members a strand actually runs between, for two adjacent slots. */
function junction(a: Unit, b: Unit): { from: number; to: number } | undefined {
  let best: { from: number; to: number; gap: number } | undefined;
  a.members.forEach((am, from) => {
    b.members.forEach((bm, to) => {
      if (am.chainId !== bm.chainId) return;
      const gap = Math.abs(am.index - bm.index);
      if (!best || gap < best.gap) best = { from, to, gap };
    });
  });
  if (!best) return undefined;
  return { from: best.from, to: best.to };
}

/**
 * Can this slot be turned round without changing what the picture says?
 *
 * An scFv head reads the same either way round -- VH left of VL or right of it
 * is a drawing choice, not a claim about the molecule. A linker occupies a slot
 * but draws no glyph, so it may sit in either lane too. Everything else is
 * fixed: an Fv head shared with a light chain has to keep the heavy half inside,
 * or a CrossMab's hinge starts running across the Fc.
 */
function flippable(unit: Unit): boolean {
  if (unit.linked) return true;
  return unit.members.length === 1 && unit.members[0]!.type === 'linker';
}

/**
 * Turn slots round so the strand between them runs along the ladder instead of
 * across it.
 *
 * Units are built walking out from the base, so by default the half nearest the
 * base takes the inner lane. That is right for the first slot and wrong for the
 * next one: a tandem of two scFv heads then hands the strand off from the outer
 * half of one head to the inner half of the next, and it cuts diagonally across
 * the whole width. Choosing each lane by where the strand arrives instead puts
 * the C-terminus of one head directly above the N-terminus of the one below.
 */
export function orientUnits(units: Unit[]): void {
  for (let k = 1; k < units.length; k++) {
    const unit = units[k]!;
    if (!flippable(unit)) continue;
    const link = junction(units[k - 1]!, unit);
    if (!link) continue;
    const arrives = relativeLane(units[k - 1]!, link.from);
    const natural = unit.members.length < 2 ? 1 : link.to === 0 ? 1 : -1;
    unit.flip = natural !== arrives;
  }
}

function partnersOf(unit: Unit): string[] {
  return unit.members.map((m) => m.partner).filter((p): p is string => Boolean(p));
}

/**
 * Interleave a heavy chain's units with its light chain's so that partners land
 * in the same slot. Domains with no counterpart keep their own slot, which is
 * what makes DVD-Ig's linkers line up and CrossMab's swapped domains stay put.
 */
export function mergeLadders(heavy: Unit[], light: Unit[]): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  let j = 0;
  while (i < heavy.length || j < light.length) {
    const hu = heavy[i];
    const lu = light[j];
    if (hu && !lu) {
      out.push(hu);
      i++;
      continue;
    }
    if (lu && !hu) {
      out.push(lu);
      j++;
      continue;
    }
    if (!hu || !lu) break;

    const hIds = hu.members.map((m) => m.id);
    const lIds = lu.members.map((m) => m.id);
    const partnered = partnersOf(hu).some((p) => lIds.includes(p));
    if (partnered) {
      // The heavy ladder always supplies the inner member. Going by domain type
      // instead would swap the lanes of a CrossMab arm, whose heavy chain
      // carries CL rather than CH1, and leave its hinge running diagonally
      // across the Fc.
      out.push(makeUnit([hu.members[0]!, lu.members[0]!], true, hu.linker ?? lu.linker));
      i++;
      j++;
      continue;
    }
    const heavyWantsLater = partnersOf(hu).some((p) =>
      light.slice(j + 1).some((u) => u.members.some((m) => m.id === p)),
    );
    const lightWantsLater = partnersOf(lu).some((p) =>
      heavy.slice(i + 1).some((u) => u.members.some((m) => m.id === p)),
    );
    if (heavyWantsLater && !lightWantsLater) {
      out.push(lu);
      j++;
    } else if (lightWantsLater && !heavyWantsLater) {
      out.push(hu);
      i++;
    } else if (hu.paired || lu.paired || hIds.length > 1 || lIds.length > 1) {
      // Both sides already hold a full slot; keep them apart rather than
      // stacking four domains into one rung.
      out.push(hu);
      i++;
    } else {
      out.push(makeUnit([hu.members[0]!, lu.members[0]!], false));
      i++;
      j++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chain partitioning for the Y skeleton
// ---------------------------------------------------------------------------

export interface HeavyPartition {
  /** Everything N-terminal to the hinge/Fc, in N->C order. */
  nTerm: NDomain[];
  /** The hinge domain, if the chain has one. */
  hinge?: NDomain;
  /** The contiguous CH2/CH3/CH4 run. */
  fc: NDomain[];
  /** Everything C-terminal to the Fc, in N->C order. */
  cTerm: NDomain[];
}

export function partitionHeavy(chain: NChain): HeavyPartition {
  const domains = chain.domains;
  const fcStart = domains.findIndex((d) => FC_TYPES.has(d.type));
  if (fcStart < 0) {
    const hingeIdx = domains.findIndex((d) => d.type === 'hinge');
    if (hingeIdx < 0) return { nTerm: domains, fc: [], cTerm: [] };
    return {
      nTerm: domains.slice(0, hingeIdx),
      hinge: domains[hingeIdx],
      fc: [],
      cTerm: domains.slice(hingeIdx + 1),
    };
  }
  let fcEnd = fcStart;
  while (fcEnd < domains.length && FC_TYPES.has(domains[fcEnd]!.type)) fcEnd++;

  let nEnd = fcStart;
  let hinge: NDomain | undefined;
  // The hinge (and any linker immediately before the Fc) belongs to the joint,
  // not to the arm.
  while (nEnd > 0 && (domains[nEnd - 1]!.type === 'hinge' || domains[nEnd - 1]!.type === 'linker')) {
    if (domains[nEnd - 1]!.type === 'hinge') hinge = domains[nEnd - 1];
    nEnd--;
  }

  const partition: HeavyPartition = {
    nTerm: domains.slice(0, nEnd),
    fc: domains.slice(fcStart, fcEnd),
    cTerm: domains.slice(fcEnd),
  };
  if (hinge) partition.hinge = hinge;
  return partition;
}

/** Chains that anchor the Y: they carry an Fc, or at least a CH1/hinge. */
export function armChains(construct: NormalizedConstruct): NChain[] {
  const withFc = construct.chains.filter((c) => c.domains.some((d) => FC_TYPES.has(d.type)));
  if (withFc.length > 0) return withFc;
  return construct.chains.filter((c) =>
    c.domains.some((d) => d.type === 'CH1' || d.type === 'hinge'),
  );
}

/** Light chains associated with a given heavy chain, via the pairing graph. */
export function lightChainsFor(construct: NormalizedConstruct, heavy: NChain): NChain[] {
  const ids = new Set(heavy.domains.map((d) => d.partner).filter(Boolean) as string[]);
  return construct.chains.filter(
    (c) => c !== heavy && c.kind === 'light' && c.domains.some((d) => ids.has(d.id)),
  );
}
