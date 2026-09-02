import type { NChain, NDomain } from './types';
import { FC_TYPES } from './catalog';

/**
 * Where a heavy chain's domains sit relative to its Fc.
 *
 * The layout uses this to decide what goes on an arm and what hangs off the
 * bottom; `deneb/edit` uses the same split to decide which segment a light
 * chain belongs to. One definition, so the two can never disagree about where
 * the C-terminus starts.
 */
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
