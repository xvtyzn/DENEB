import type { Construct, NDomain, NormalizedConstruct, Payload } from '../model/types';
import { DOMAIN_CATALOG } from '../model/catalog';
import { layout as runLayout } from '../layout/skeleton';
import type { Connector, LayoutResult, PlacedDomain, Point, Rect } from '../layout/types';
import { cornersOf, polygonsOverlap, rotate } from '../layout/geometry';
import { pointOn } from '../layout/links';
import { createColorResolver, type ColorMode } from '../theme/palette';
import { resolveTheme, type Theme } from '../theme/theme';
import { curve, domainPath, hingePath, linkerPath } from './glyphs';
import { buildLegend, modificationLegendKey } from './legend';
import {
  decorate,
  preferredSide,
  resolveModification,
  type DomainDecorations,
  type ResolvedModification,
} from './markers';
import type { GroupNode, Scene, SceneNode } from './scene-types';

/** Where a conjugated payload's chemical structure is drawn, if supplied. */
export type StructureMode = 'none' | 'legend' | 'inline';

export interface SceneOptions {
  theme?: Partial<Theme>;
  colorMode?: ColorMode;
  /** Draw the target / engineering legend below the molecule. Default true. */
  showLegend?: boolean;
  /** Draw the domain name inside each glyph. Off by default: the boxes are
   * narrow, and the shapes plus the legend usually carry enough. */
  showLabels?: boolean;
  /** Write the name of a conjugated payload next to its glyph. Default true. */
  showPayloadNames?: boolean;
  /**
   * Mark the free N- and C-termini of each chain. Useful when the direction of
   * a single-chain construct matters — a `VH~VL` scFv versus a `VL~VH` one.
   */
  showTermini?: boolean;
  /**
   * Where to draw a conjugated payload's chemical structure, when one was
   * supplied. `'legend'` (the default) puts framed thumbnails under the legend;
   * `'inline'` replaces the payload glyph on the molecule with the drawing.
   */
  showStructures?: StructureMode;
  /**
   * Draw an inline structure at every conjugation site rather than just one.
   * Off by default: a schematic reads better with the chemistry spelled out once
   * and the other sites left as payload glyphs, and repeating it forces the
   * drawing to be mirrored on the far side.
   */
  repeatStructures?: boolean;
  /** Draw `construct.name` above the molecule. Default true when a name exists. */
  showTitle?: boolean;
  title?: string;
  /**
   * Domains to ring in the highlight colour. Accepts domain ids, `"HC1:CH3"`
   * refs, `"chain:HC1"`, `"spec:CD3"` and `"mod:lala"`.
   */
  highlight?: string[];
  /** Explicit output size; defaults to the intrinsic size times `scale`. */
  width?: number;
  height?: number;
  scale?: number;
  background?: string | null;
  /** Prefix for generated element ids, for pages hosting several diagrams. */
  idPrefix?: string;
}

export interface BuiltScene {
  scene: Scene;
  layout: LayoutResult;
}

export function buildScene(
  input: Construct | NormalizedConstruct | LayoutResult,
  options: SceneOptions = {},
): BuiltScene {
  const theme = resolveTheme(options.theme);
  const result: LayoutResult =
    'byDomainId' in input ? input : runLayout(input, { theme: options.theme });
  const construct = result.construct;
  const colors = createColorResolver(
    construct.specificities,
    construct.chains,
    theme,
    options.colorMode ?? 'specificity',
  );

  const showLabels = options.showLabels ?? false;
  const showStructures: StructureMode = options.showStructures ?? 'legend';
  const highlighted = resolveHighlight(options.highlight ?? [], construct);
  const centroid = centerOf(result.domains);
  const prefix = options.idPrefix ? `${options.idPrefix}-` : '';

  // Outlines of everything already on the page, so a conjugate's drawing can be
  // set far enough out to stay off them.
  const glyphs: GlyphOutline[] = result.domains.map((p) => ({
    id: p.domain.id,
    corners: cornersOf(p.center, p.width, p.height, p.rotation),
  }));

  const usedModifications = new Map<string, ResolvedModification>();
  const reachPoints: Point[] = [];
  const surfaceSigns = new Map<string, 1 | -1>();
  for (const p of result.domains) {
    surfaceSigns.set(p.domain.id, (-sideToward(p, centroid)) as 1 | -1);
  }
  // A hinge or an scFv linker has no glyph, so anything attached to one is
  // drawn against the connector that stands in for it. Those frames are built
  // here rather than at the point of use, so a domain without a glyph takes
  // part in choosing where an inline structure goes -- an ADC conjugated to the
  // interchain cysteines is conjugated to a hinge, and leaving it out of that
  // choice drew the depiction at every site at once, across the molecule.
  const skipped: Array<{ domain: NDomain; frame: PlacedDomain }> = [];
  for (const connector of result.connectors) {
    for (const id of connector.skipped ?? []) {
      const domain = construct.byId.get(id);
      if (!domain || domain.modifications.length === 0) continue;
      const frame = skippedFrame(domain, connector);
      skipped.push({ domain, frame });
      surfaceSigns.set(domain.id, (-sideToward(frame, centroid)) as 1 | -1);
    }
  }

  const inlineAt =
    showStructures === 'inline'
      ? chooseStructureSites(
          [...result.domains, ...skipped.map((s) => s.frame)],
          surfaceSigns,
          options.repeatStructures ?? false,
        )
      : new Set<string>();

  // A connector whose two ends coincide — a branch that starts exactly on the
  // face it leaves — would draw as a round dot rather than nothing at all.
  const connectorNodes: SceneNode[] = result.connectors
    .filter((c) => c.via?.length || Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) > 0.05)
    .map((c) => connectorNode(c, theme));

  const domainNodes: SceneNode[] = result.domains.map((p) => {
    const node = domainNode(p, {
      theme,
      colors,
      showLabels,
      showPayloadNames: options.showPayloadNames ?? true,
      showStructures,
      inlineAt,
      surfaceSigns,
      highlighted,
      centroid,
      byDomainId: result.byDomainId,
      prefix,
      glyphs,
    });
    for (const m of p.domain.modifications) {
      const r = resolveModification(m, p.domain.id);
      const key = modificationLegendKey(r);
      if (!usedModifications.has(key)) usedModifications.set(key, r);
    }
    const { minX, minY, maxX, maxY } = node.extent;
    for (const corner of [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ]) {
      reachPoints.push({
        x: p.center.x + rotate(corner, p.rotation).x,
        y: p.center.y + rotate(corner, p.rotation).y,
      });
    }
    return node.node;
  });

  for (const { domain, frame } of skipped) {
    const node = skippedDomainNode(domain, frame, {
      theme,
      showPayloadNames: options.showPayloadNames ?? true,
      inlineStructures: showStructures === 'inline' && inlineAt.has(domain.id),
      centroid,
      prefix,
      highlighted,
      glyphs,
    });
    domainNodes.push(node.node);
    for (const m of domain.modifications) {
      const r = resolveModification(m, domain.id);
      const key = modificationLegendKey(r);
      if (!usedModifications.has(key)) usedModifications.set(key, r);
    }
    reachPoints.push(...node.reach);
  }

  const bbox = expand(result.bbox, reachPoints, theme.padding);
  const title = options.title ?? construct.name;
  const showTitle = (options.showTitle ?? true) && Boolean(title);
  const titleHeight = showTitle ? theme.titleSize + 10 : 0;

  const legendBudget = Math.max(bbox.width - theme.padding * 2, 240);
  const legend =
    (options.showLegend ?? true)
      ? buildLegend(construct.specificities, [...usedModifications.values()], theme, legendBudget, {
          structures: showStructures === 'legend',
        })
      : { nodes: [], height: 0, width: 0 };

  const width =
    legend.height > 0
      ? Math.max(bbox.width, Math.max(legendBudget, legend.width) + theme.padding * 2)
      : bbox.width;
  const height = titleHeight + bbox.height + (legend.height > 0 ? legend.height + 8 : 0);

  const children: SceneNode[] = [];
  if (showTitle && title) {
    children.push({
      kind: 'text',
      x: width / 2,
      y: theme.titleSize + 2,
      text: title,
      fontSize: theme.titleSize,
      fontFamily: theme.fontFamily,
      fontWeight: 600,
      fill: theme.labelColor,
      anchor: 'middle',
      className: 'dn-title',
    });
  }

  const moleculeChildren: SceneNode[] = [
    { kind: 'group', className: 'dn-connectors', children: connectorNodes },
    { kind: 'group', className: 'dn-domains', children: domainNodes },
  ];
  if (options.showTermini) {
    moleculeChildren.push({
      kind: 'group',
      className: 'dn-termini',
      children: terminusNodes(result, theme, centroid),
    });
  }

  children.push({
    kind: 'group',
    className: 'dn-molecule',
    transform: `translate(${round(-bbox.x + (width - bbox.width) / 2)},${round(-bbox.y + titleHeight)})`,
    children: moleculeChildren,
  });

  if (legend.height > 0) {
    children.push({
      kind: 'group',
      className: 'dn-legend',
      transform: `translate(${round(theme.padding)},${round(titleHeight + bbox.height + 4)})`,
      children: legend.nodes,
    });
  }

  const scale = options.scale ?? 1;
  const scene: Scene = {
    viewBox: { x: 0, y: 0, width: round(width), height: round(height) },
    width: options.width ?? round(width * scale),
    height: options.height ?? round(height * scale),
    background: options.background !== undefined ? options.background : theme.background,
    children,
    ...(title ? { title } : {}),
    description: describe(construct),
  };

  return { scene, layout: result };
}

// ---------------------------------------------------------------------------

interface DomainContext {
  theme: Theme;
  colors: ReturnType<typeof createColorResolver>;
  showLabels: boolean;
  showPayloadNames: boolean;
  showStructures: StructureMode;
  /** Domains allowed to draw their payload's structure inline. */
  inlineAt: Set<string>;
  surfaceSigns: Map<string, 1 | -1>;
  highlighted: Set<string>;
  centroid: Point;
  byDomainId: Map<string, PlacedDomain>;
  prefix: string;
  /** Every glyph on the page, for keeping a drawing clear of them. */
  glyphs: GlyphOutline[];
}

interface GlyphOutline {
  id: string;
  corners: Point[];
}

/**
 * Decide where an inline structure is drawn.
 *
 * A schematic reads better with the chemistry spelled out once, so by default
 * each distinct depiction is drawn at a single conjugation site — and, where the
 * caller named the conjugated atom, at the site whose outward direction lets the
 * molecule extend away from the antibody. That is what removes the need to
 * mirror the drawing, and with it the risk of mirror-written atom labels.
 */
function chooseStructureSites(
  carriers: PlacedDomain[],
  surfaceSigns: Map<string, 1 | -1>,
  repeat: boolean,
): Set<string> {
  const chosen = new Set<string>();
  const claimed = new Set<Payload['structure']>();

  for (const placed of carriers) {
    for (const m of placed.domain.modifications) {
      const structure = m.payload?.structure;
      if (!structure || (structure.svg == null && !structure.href)) continue;
      if (repeat) {
        chosen.add(placed.domain.id);
        continue;
      }
      if (claimed.has(structure)) continue;
      const wants = preferredSide(structure);
      const candidates = carriers.filter((d) =>
        d.domain.modifications.some((other) => other.payload?.structure === structure),
      );
      const fits = candidates.find((d) => {
        if (wants === null) return true;
        const sign = surfaceSigns.get(d.domain.id) ?? 1;
        return sign * Math.cos((d.rotation * Math.PI) / 180) >= 0 === wants;
      });
      const site = fits ?? candidates[0];
      if (site) {
        chosen.add(site.domain.id);
        claimed.add(structure);
      }
    }
  }
  return chosen;
}

/** Grow a box to contain extra points, keeping the original padding. */
function expand(bbox: Rect, points: Point[], padding: number): Rect {
  if (points.length === 0) return bbox;
  let { x, y } = bbox;
  let right = bbox.x + bbox.width;
  let bottom = bbox.y + bbox.height;
  for (const p of points) {
    x = Math.min(x, p.x - padding);
    y = Math.min(y, p.y - padding);
    right = Math.max(right, p.x + padding);
    bottom = Math.max(bottom, p.y + padding);
  }
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Keep a conjugate's drawing off the protein.
 *
 * A compound is a good deal bigger than the domain it hangs from, so leaving
 * from the right edge is not on its own enough — on a tilted Fab arm the drawing
 * can still lie back across the molecule. The bond that carries it is what
 * gives way: it is drawn longer until the drawing is in the clear, the way a
 * conjugation scheme sets the compound out to one side.
 */
function clearanceTest(glyphs: GlyphOutline[]): (corners: Point[]) => boolean {
  return (corners) => !glyphs.some((g) => polygonsOverlap(corners, g.corners));
}

function domainNode(
  p: PlacedDomain,
  ctx: DomainContext,
): { node: GroupNode; extent: DomainDecorations['extent'] } {
  const { theme, colors } = ctx;
  const spec = DOMAIN_CATALOG[p.domain.type];
  const partner = p.domain.partner ? ctx.byDomainId.get(p.domain.partner) : undefined;
  // Interface engineering faces the partner domain; anything attached to the
  // surface faces away from it, falling back to "away from the molecule" for a
  // domain that has no partner at all.
  const interfaceSign = sideToward(p, partner?.center ?? ctx.centroid);
  const surfaceSign = ctx.surfaceSigns.get(p.domain.id) ?? 1;
  const decorations = decorate(p.domain, {
    interfaceSign,
    surfaceSign,
    width: p.width,
    height: p.height,
    rotation: p.rotation,
    theme,
    showPayloadNames: ctx.showPayloadNames,
    inlineStructures: ctx.showStructures === 'inline' && ctx.inlineAt.has(p.domain.id),
    center: p.center,
    clears: clearanceTest(ctx.glyphs),
  });
  const fill = colors.fill(p.domain);
  const children: SceneNode[] = [];

  const outline: SceneNode[] = [];
  if (spec.glyph === 'globule') {
    outline.push({
      kind: 'circle',
      cx: 0,
      cy: 0,
      r: p.width / 2,
      fill,
      stroke: theme.outline,
      strokeWidth: theme.outlineWidth,
    });
  } else if (spec.glyph === 'linker') {
    outline.push({
      kind: 'path',
      d: linkerPath(p.height),
      fill: 'none',
      stroke: theme.backbone,
      strokeWidth: theme.backboneWidth,
      strokeLinecap: 'round',
    });
  } else if (spec.glyph === 'hinge') {
    outline.push({
      kind: 'path',
      d: hingePath(p.height),
      fill: 'none',
      stroke: theme.backbone,
      strokeWidth: theme.backboneWidth + 0.4,
      strokeLinecap: 'round',
    });
  } else {
    outline.push({
      kind: 'path',
      d: domainPath(p.width, p.height, spec.corner, decorations.feature),
      fill,
      stroke: theme.outline,
      strokeWidth: theme.outlineWidth,
      strokeLinejoin: 'round',
      // The outline is symmetric, so mirroring it only moves the knob/notch to
      // the interface-facing edge.
      ...(interfaceSign === -1 ? { transform: 'scale(-1,1)' } : {}),
    });
  }

  if (ctx.highlighted.has(p.domain.id)) {
    const halo = { ...(outline[0] as SceneNode) } as SceneNode;
    children.push({
      ...halo,
      fill: 'none',
      stroke: theme.highlight,
      strokeWidth: theme.highlightWidth + theme.outlineWidth * 2,
      strokeLinejoin: 'round',
      className: 'dn-highlight',
      pointerEvents: 'none',
    } as SceneNode);
  }
  children.push(...outline);
  children.push(...decorations.nodes);

  if (ctx.showLabels && p.domain.label && spec.glyph !== 'linker' && spec.glyph !== 'hinge') {
    // Counter-rotate: a domain on a tilted arm, or a C-terminal fusion whose
    // glyph is flipped to point its paratope outwards, must not carry
    // upside-down text.
    children.push({
      kind: 'group',
      transform: `rotate(${round(-p.rotation)})`,
      className: 'dn-domain-label',
      pointerEvents: 'none',
      children: [
        {
          kind: 'text',
          x: 0,
          y: 0,
          text: p.domain.label,
          fontSize: theme.labelSize,
          fontFamily: theme.fontFamily,
          fill: theme.labelColor,
          anchor: 'middle',
          baseline: 'central',
          pointerEvents: 'none',
        },
      ],
    });
  }

  const data: Record<string, string> = {
    'domain-id': p.domain.id,
    'chain-id': p.domain.chainId,
    'domain-type': p.domain.type,
  };
  if (p.domain.specificity) data['specificity'] = p.domain.specificity;
  if (p.domain.start != null) data['start'] = String(p.domain.start);
  if (p.domain.end != null) data['end'] = String(p.domain.end);
  if (decorations.resolved.length > 0) {
    data['modifications'] = decorations.resolved.map((m) => m.type).join(' ');
  }

  return {
    extent: decorations.extent,
    node: {
    kind: 'group',
    id: `${ctx.prefix}${p.domain.id.replace(/[^\w:-]/g, '_')}`,
    className: 'dn-domain',
    transform: `translate(${round(p.center.x)},${round(p.center.y)}) rotate(${round(p.rotation)})`,
    data,
    role: 'img',
    ariaLabel: describeDomain(p.domain),
    title: describeDomain(p.domain),
    children,
    },
  };
}

/**
 * Decorations for a domain the layout gave no glyph, placed on the connector
 * that replaced it.
 *
 * The frame is the one a glyph would have had: centred on the middle of the
 * connector, with its local "up" along the chain, so a marker or a conjugation
 * stalk leaves the hinge the same way it leaves any other domain.
 */
/**
 * The frame a glyph-less domain would have occupied: the middle of the
 * connector standing in for it, turned to follow the strand. Decorations are
 * hung on this, and it is what lets such a domain take part in choosing where
 * an inline structure is drawn.
 */
export function skippedFrame(domain: NDomain, connector: Connector): PlacedDomain {
  const spec = DOMAIN_CATALOG[domain.type];
  const mid = pointOn(connector.a, connector.b, connector.via, 0.5);
  const tail = pointOn(connector.a, connector.b, connector.via, 0.35);
  const head = pointOn(connector.a, connector.b, connector.via, 0.65);
  const rotation = (Math.atan2(head.y - tail.y, head.x - tail.x) * 180) / Math.PI - 90;
  return {
    domain,
    center: mid,
    rotation,
    width: spec.width,
    height: spec.height,
  } as PlacedDomain;
}

function skippedDomainNode(
  domain: NDomain,
  frame: PlacedDomain,
  ctx: {
    theme: Theme;
    showPayloadNames: boolean;
    inlineStructures: boolean;
    centroid: Point;
    prefix: string;
    highlighted: Set<string>;
    glyphs: GlyphOutline[];
  },
): { node: SceneNode; reach: Point[] } {
  const spec = DOMAIN_CATALOG[domain.type];
  const mid = frame.center;
  const rotation = frame.rotation;
  // Nothing pairs with a hinge, so "interface" and "surface" both mean the
  // side away from the body of the molecule.
  const away = (-sideToward(frame, ctx.centroid)) as 1 | -1;

  const decorations = decorate(domain, {
    interfaceSign: away,
    surfaceSign: away,
    width: spec.width,
    height: spec.height,
    rotation,
    theme: ctx.theme,
    showPayloadNames: ctx.showPayloadNames,
    inlineStructures: ctx.inlineStructures,
    center: mid,
    clears: clearanceTest(ctx.glyphs),
  });

  const { minX, minY, maxX, maxY } = decorations.extent;
  const reach = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((corner) => ({
    x: mid.x + rotate(corner, rotation).x,
    y: mid.y + rotate(corner, rotation).y,
  }));

  const data: Record<string, string> = {
    'domain-id': domain.id,
    'chain-id': domain.chainId,
    'domain-type': domain.type,
    modifications: decorations.resolved.map((m) => m.type).join(' '),
  };

  return {
    reach,
    node: {
      kind: 'group',
      id: `${ctx.prefix}${domain.id.replace(/[^\w:-]/g, '_')}`,
      className: 'dn-domain dn-domain-implicit',
      transform: `translate(${round(mid.x)},${round(mid.y)}) rotate(${round(rotation)})`,
      data,
      role: 'img',
      ariaLabel: describeDomain(domain),
      title: describeDomain(domain),
      children: decorations.nodes,
    },
  };
}

function connectorNode(c: Connector, theme: Theme): SceneNode {
  const base = {
    kind: 'path' as const,
    d: curve(c.a, c.b, c.via),
    fill: 'none',
    strokeLinecap: 'round' as const,
    className: `dn-connector dn-connector-${c.kind}`,
    pointerEvents: 'none' as const,
    data: {
      'connector-kind': c.kind,
      ...(c.domainA ? { 'domain-a': c.domainA } : {}),
      ...(c.domainB ? { 'domain-b': c.domainB } : {}),
    },
  };
  switch (c.kind) {
    case 'disulfide':
      return { ...base, stroke: theme.disulfide, strokeWidth: 1.2 };
    case 'pairing':
      // A contact, not a covalent bond, so it is drawn broken -- and thinner
      // than the disulfide it would otherwise be mistaken for.
      return {
        ...base,
        stroke: theme.outline,
        strokeWidth: 0.9,
        strokeDasharray: '2 1.7',
      };
    case 'linker':
      return { ...base, stroke: theme.backbone, strokeWidth: theme.backboneWidth - 0.4 };
    case 'hinge':
      return { ...base, stroke: theme.backbone, strokeWidth: theme.backboneWidth + 0.6 };
    default:
      return { ...base, stroke: theme.backbone, strokeWidth: theme.backboneWidth };
  }
}

/**
 * Small N / C letters at the free ends of every chain. The N-terminus is what
 * distinguishes a `VH~VL` single-chain Fv from a `VL~VH` one once the domain
 * labels are turned off.
 */
function terminusNodes(result: LayoutResult, theme: Theme, centroid: Point): SceneNode[] {
  const nodes: SceneNode[] = [];
  for (const chain of result.construct.chains) {
    const placed = chain.domains
      .map((d) => result.byDomainId.get(d.id))
      .filter((p): p is PlacedDomain => Boolean(p));
    const first = placed[0];
    const last = placed[placed.length - 1];
    if (first) nodes.push(terminusLabel('N', first.nAnchor, centroid, theme, chain.id));
    if (last) nodes.push(terminusLabel('C', last.cAnchor, centroid, theme, chain.id));
  }
  return nodes;
}

function terminusLabel(
  text: string,
  at: Point,
  centroid: Point,
  theme: Theme,
  chainId: string,
): SceneNode {
  // Nudge the letter away from the molecule so it never lands on a glyph.
  const away = { x: at.x - centroid.x, y: at.y - centroid.y };
  const length = Math.hypot(away.x, away.y) || 1;
  const offset = 6;
  return {
    kind: 'text',
    x: at.x + (away.x / length) * offset,
    y: at.y + (away.y / length) * offset,
    text,
    fontSize: theme.legendSize - 1.5,
    fontFamily: theme.fontFamily,
    fill: theme.labelColor,
    opacity: 0.75,
    fontWeight: 600,
    anchor: 'middle',
    baseline: 'central',
    className: 'dn-terminus',
    data: { terminus: text, 'chain-id': chainId },
    pointerEvents: 'none',
  };
}

/** Which side of a glyph, in glyph-local x, faces the given point. */
function sideToward(p: PlacedDomain, target: Point): 1 | -1 {
  const localX = rotate({ x: 1, y: 0 }, p.rotation);
  const delta = { x: target.x - p.center.x, y: target.y - p.center.y };
  return delta.x * localX.x + delta.y * localX.y >= 0 ? 1 : -1;
}

function centerOf(placed: PlacedDomain[]): Point {
  if (placed.length === 0) return { x: 0, y: 0 };
  const sum = placed.reduce((a, p) => ({ x: a.x + p.center.x, y: a.y + p.center.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / placed.length, y: sum.y / placed.length };
}

function describeDomain(d: NDomain): string {
  const parts = [d.label || d.type];
  if (d.specificity) parts.push(`anti-${d.specificity}`);
  if (d.start != null && d.end != null) parts.push(`${d.start}–${d.end}`);
  for (const m of d.modifications) {
    const r = resolveModification(m, d.id);
    parts.push(r.residues.length > 0 ? `${r.label} [${r.residues.join('/')}]` : r.label);
  }
  return `${d.chainId} · ${parts.join(' · ')}`;
}

function describe(construct: NormalizedConstruct): string {
  const targets = construct.specificities.map((s) => s.label).join(', ');
  const chains = construct.chains.length;
  return `Antibody format diagram: ${chains} chain${chains === 1 ? '' : 's'}${
    targets ? `, targets ${targets}` : ''
  }.`;
}

/** Expand highlight references into a set of domain ids. */
export function resolveHighlight(refs: string[], construct: NormalizedConstruct): Set<string> {
  const out = new Set<string>();
  for (const ref of refs) {
    if (construct.byId.has(ref)) {
      out.add(ref);
      continue;
    }
    if (ref.startsWith('spec:')) {
      const name = ref.slice(5);
      for (const c of construct.chains) {
        for (const d of c.domains) if (d.specificity === name) out.add(d.id);
      }
      continue;
    }
    if (ref.startsWith('mod:')) {
      const type = ref.slice(4);
      for (const c of construct.chains) {
        for (const d of c.domains) {
          if (d.modifications.some((m) => m.type === type)) out.add(d.id);
        }
      }
      continue;
    }
    if (ref.startsWith('chain:')) {
      const id = ref.slice(6);
      for (const c of construct.chains) {
        if (c.id === id) for (const d of c.domains) out.add(d.id);
      }
      continue;
    }
    const sep = ref.lastIndexOf(':');
    if (sep > 0) {
      const chainId = ref.slice(0, sep);
      const key = ref.slice(sep + 1);
      for (const c of construct.chains) {
        if (c.id !== chainId) continue;
        for (const d of c.domains) {
          if (d.type === key || String(d.index) === key) out.add(d.id);
        }
      }
    }
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
