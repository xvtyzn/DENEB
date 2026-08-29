import type { Domain } from '../model/types';
import { CONSTANT_REFERENCES, type ConstantReference } from './constant-regions';

export interface ConstantMatch {
  reference: ConstantReference;
  /** Fraction of compared residues that agree, 0–1. */
  identity: number;
  /** The named constant domains, positioned in the chain's own numbering. */
  domains: Domain[];
}

/** How much of the reference has to be covered before a match is believable. */
const MIN_COVERAGE = 0.6;
/** How far into the chain the constant region is allowed to start. */
const MAX_LEAD_IN = 20;

/**
 * Name the constant part of a chain by matching it against the human references.
 *
 * V-region callers annotate the variable domain and stop, leaving the rest of
 * the chain unlabelled. Comparison here is ungapped: constant regions are close
 * to germline, and an aligner that could open gaps would happily "find" a match
 * in something that is not a constant region at all. Anything below
 * `minIdentity` is left unnamed rather than guessed at.
 */
export function identifyConstantRegion(
  chainSequence: string,
  from: number,
  kind: 'heavy' | 'light',
  minIdentity = 0.7,
): ConstantMatch | null {
  const tail = chainSequence.slice(from - 1);
  if (tail.length === 0) return null;

  let best: ConstantMatch | null = null;
  for (const reference of CONSTANT_REFERENCES) {
    if (reference.kind !== kind) continue;
    for (let lead = 0; lead <= Math.min(MAX_LEAD_IN, tail.length - 1); lead++) {
      const compared = Math.min(reference.sequence.length, tail.length - lead);
      if (compared < reference.sequence.length * MIN_COVERAGE) break;

      let matches = 0;
      for (let i = 0; i < compared; i++) {
        if (tail[lead + i] === reference.sequence[i]) matches++;
      }
      const identity = matches / compared;
      if (identity < minIdentity || (best && identity <= best.identity)) continue;

      const start = from + lead;
      best = {
        reference,
        identity,
        domains: reference.segments
          .map((segment) => ({
            type: segment.type,
            start: start + segment.start - 1,
            end: Math.min(start + segment.end - 1, chainSequence.length),
            isotype: reference.isotype,
          }))
          .filter((d) => d.start <= chainSequence.length && d.end >= d.start),
      };
    }
  }
  return best;
}

export { CONSTANT_REFERENCES } from './constant-regions';
export type { ConstantReference, ConstantSegment } from './constant-regions';
