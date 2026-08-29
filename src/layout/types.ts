import type { Diagnostic, NDomain, NormalizedConstruct } from '../model/types';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedDomain {
  domain: NDomain;
  /** Centre of the glyph in world coordinates. */
  center: Point;
  /** Clockwise rotation in degrees; the glyph's local "up" is its N-terminus. */
  rotation: number;
  width: number;
  height: number;
  /** Midpoint of the N-terminal edge, in world coordinates. */
  nAnchor: Point;
  /** Midpoint of the C-terminal edge, in world coordinates. */
  cAnchor: Point;
  /** -1 inner, +1 outer, 0 centred — used when drawing interface markers. */
  lane: number;
  /** Unit vector pointing from the C-terminus to the N-terminus. */
  axis: Point;
}

export type ConnectorKind = 'backbone' | 'linker' | 'disulfide' | 'pairing' | 'hinge';

export interface Connector {
  kind: ConnectorKind;
  a: Point;
  b: Point;
  /** Quadratic/cubic control points. */
  via?: Point[];
  domainA?: string;
  domainB?: string;
  /**
   * Domains this connector stands in for — a hinge or an scFv linker, which
   * get no glyph of their own. Anything attached to one is drawn against the
   * connector instead, so a modification on a hinge is not lost.
   */
  skipped?: string[];
}

export interface LayoutResult {
  construct: NormalizedConstruct;
  domains: PlacedDomain[];
  connectors: Connector[];
  bbox: Rect;
  byDomainId: Map<string, PlacedDomain>;
  diagnostics: Diagnostic[];
}
