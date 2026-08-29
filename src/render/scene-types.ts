/**
 * A tiny declarative description of an SVG fragment.
 *
 * Both output paths — the `toSVGString` serializer, which runs anywhere
 * including Node, and the React element emitter, which attaches real event
 * handlers — consume this same tree, so the two renderers cannot drift apart.
 */
export interface NodeStyle {
  id?: string;
  className?: string;
  transform?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';
  opacity?: number;
  pointerEvents?: 'none' | 'auto' | 'all' | 'visiblePainted';
  /** Rendered as `data-*` attributes. */
  data?: Record<string, string>;
  role?: string;
  ariaLabel?: string;
}

export interface PathNode extends NodeStyle {
  kind: 'path';
  d: string;
}

export interface RectNode extends NodeStyle {
  kind: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
}

export interface CircleNode extends NodeStyle {
  kind: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface LineNode extends NodeStyle {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextNode extends NodeStyle {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: number | string;
  anchor?: 'start' | 'middle' | 'end';
  baseline?: 'auto' | 'middle' | 'central' | 'hanging';
  /** Optional tooltip rendered as a nested <title>. */
  title?: string;
}

/**
 * Externally supplied artwork — a chemical structure depiction. `markup` is
 * placed inside a nested `<svg>` verbatim; `href` becomes an `<image>`.
 */
export interface EmbedNode extends NodeStyle {
  kind: 'embed';
  x: number;
  y: number;
  width: number;
  height: number;
  viewBox?: string;
  preserveAspectRatio?: string;
  markup?: string;
  href?: string;
}

export interface GroupNode extends NodeStyle {
  kind: 'group';
  children: SceneNode[];
  /** Optional tooltip rendered as a nested <title>. */
  title?: string;
}

export type SceneNode =
  | PathNode
  | RectNode
  | CircleNode
  | LineNode
  | TextNode
  | EmbedNode
  | GroupNode;

export interface Scene {
  /** viewBox in user units. */
  viewBox: { x: number; y: number; width: number; height: number };
  /** Rendered width/height attributes. */
  width: number;
  height: number;
  background: string | null;
  children: SceneNode[];
  title?: string;
  description?: string;
}
