import { useMemo } from 'react';
import type { Construct, NormalizedConstruct } from '../model/types';
import { parseDSL } from '../dsl/parse';

/**
 * Where a component gets its molecule.
 *
 * There is deliberately no `preset` name here: resolving one would tie every
 * page that renders a diagram to the whole preset catalogue. Pass the construct
 * instead — `construct={getPreset('igg-kih')}` from `antibody-viewer/presets` —
 * and pages that never touch the presets never load them.
 */
export interface ConstructSource {
  /** A structured construct, the canonical input. */
  construct?: Construct | NormalizedConstruct;
  /** Compact DSL notation; parsed on change. */
  dsl?: string;
}

export class ConstructSourceError extends Error {}

export function resolveSource(source: ConstructSource): Construct | NormalizedConstruct {
  if (source.construct) return source.construct;
  if (source.dsl != null) return parseDSL(source.dsl);
  throw new ConstructSourceError(
    'Provide `construct` or `dsl`. For a bundled format, import getPreset from "antibody-viewer/presets".',
  );
}

export function useConstruct(source: ConstructSource): Construct | NormalizedConstruct {
  return useMemo(() => resolveSource(source), [source.construct, source.dsl]);
}
