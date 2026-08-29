import type { MarkerShape, Modification, NDomain, Payload } from '../model/types';
import { MODIFICATION_CATALOG } from '../model/catalog';
import type { Theme } from '../theme/theme';
import type { SceneNode } from './scene-types';
import {
  domainPath,
  glycanNodes,
  glycanPath,
  payloadPath,
  squigglePath,
  starPath,
  type EdgeFeature,
} from './glyphs';

export interface ResolvedModification {
  type: Modification['type'];
  label: string;
  residues: string[];
  marker: MarkerShape;
  color: string;
  group: string;
  side: 'interface' | 'surface';
  payload?: Payload;
  /** One-line summary for the legend: residues, or the payload's details. */
  detail: string;
  domainId: string;
}

export function resolveModification(m: Modification, domainId: string): ResolvedModification {
  const catalog = MODIFICATION_CATALOG[m.type] ?? MODIFICATION_CATALOG.custom;
  const residues = m.residues ?? catalog.residues ?? [];
  const payload = m.payload;
  const resolved: ResolvedModification = {
    type: m.type,
    label: payload?.name ? `${payload.name}` : (m.label ?? catalog.label),
    residues,
    marker: m.marker ?? catalog.marker,
    color: m.color ?? payload?.color ?? catalog.color,
    group: catalog.group,
    side: catalog.side,
    detail: payload ? describePayload(payload) : residues.join('/'),
    domainId,
  };
  if (payload) resolved.payload = payload;
  return resolved;
}

/**
 * The residue a conjugation leaves behind on the antibody. ADC schemes name the
 * attachment atom on the bond, so a site of "interchain cysteine" is drawn as
 * `mAb—S—`, and lysine chemistry as `mAb—NH—`.
 */
export function attachmentLabel(p: Payload | undefined, hasStructure = false): string {
  if (!p) return '';
  if (p.attachment != null) return p.attachment;
  // A depiction of the conjugated linker already draws the attachment atom and
  // the bond it makes, so adding another one alongside would double it up.
  if (hasStructure) return '';
  const site = (p.site ?? '').toLowerCase();
  if (/cys|thiol|thiomab|maleimid/.test(site)) return 'S';
  if (/lys|amine|nhs/.test(site)) return 'NH';
  if (/glycan|azide|click|transglutaminase|sortase/.test(site)) return 'N';
  return '';
}

function describePayload(p: Payload): string {
  const parts: string[] = [];
  if (p.linker) {
    parts.push(p.cleavable === false ? `${p.linker}, non-cleavable` : p.linker);
  } else if (p.cleavable != null) {
    parts.push(p.cleavable ? 'cleavable linker' : 'non-cleavable linker');
  }
  if (p.dar != null) parts.push(`DAR ${p.dar}`);
  if (p.site) parts.push(p.site);
  return parts.join(' · ');
}

/** Default drawn size of a structure depiction, in diagram units. */
export const STRUCTURE_SIZE = { width: 96, height: 68 };

/** The nested <svg>/<image> for one structure, drawn into the given box. */
export function structureNode(
  r: ResolvedModification,
  x: number,
  y: number,
  width: number,
  height: number,
  mirror = false,
): SceneNode | null {
  const structure = r.payload?.structure;
  if (!structure || (structure.svg == null && !structure.href)) return null;
  const node: SceneNode = {
    kind: 'embed',
    x,
    y,
    width,
    height,
    preserveAspectRatio: 'xMidYMid meet',
    className: 'dn-structure',
    data: { 'modification-type': r.type, ...(r.payload?.name ? { payload: r.payload.name } : {}) },
    // An aria-label rather than a nested <title>: raw markup fills the element's
    // children, leaving no room for one.
    ariaLabel: structure.caption ?? r.payload?.name,
  };
  if (structure.viewBox) node.viewBox = structure.viewBox;
  if (structure.svg != null) node.markup = mirror ? unmirrorLabels(structure.svg) : structure.svg;
  else node.href = structure.href;
  if (!mirror) return node;
  return {
    kind: 'group',
    transform: `translate(${round(2 * x + width)},0) scale(-1,1)`,
    children: [node],
    className: 'dn-structure-mirror',
  };
}

export interface DecorateContext {
  /** Glyph-local x direction facing the binding partner: +1 or -1. */
  interfaceSign: 1 | -1;
  /** Glyph-local x direction facing solvent, away from the partner and body. */
  surfaceSign: 1 | -1;
  width: number;
  height: number;
  /** Clockwise rotation applied to the glyph, so labels can be levelled. */
  rotation: number;
  theme: Theme;
  /** Draw the payload's name beside its glyph. */
  showPayloadNames: boolean;
  /** Put the structure depiction at the end of the stalk instead of the glyph. */
  inlineStructures: boolean;
}

export interface DomainDecorations {
  /** Cut into the domain outline itself. */
  feature?: EdgeFeature;
  /** Drawn in the glyph's local coordinate system. */
  nodes: SceneNode[];
  resolved: ResolvedModification[];
  /**
   * Extent of the glyph plus its marks, in the glyph's own coordinates. The
   * layout only knows about domain boxes, so the scene transforms this and
   * widens its bounding box to keep a payload — or a whole structure depiction
   * — inside the viewBox.
   */
  extent: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Turn a domain's modifications into drawable marks.
 *
 * `knob`/`hole` reshape the outline so the two CH3 domains interlock. Interface
 * engineering stacks along the edge facing the partner domain, the way the
 * black Fc-silencing dots are drawn in the format literature. Anything attached
 * to the surface — an N-glycan, a conjugated payload, PEG, a tag — hangs off
 * the solvent-facing edge on a stalk, so an ADC reads as an antibody carrying
 * drug molecules rather than an antibody with extra dots on it.
 */
export function decorate(domain: NDomain, ctx: DecorateContext): DomainDecorations {
  const resolved = domain.modifications.map((m) => resolveModification(m, domain.id));
  const nodes: SceneNode[] = [];
  let feature: EdgeFeature | undefined;

  for (const r of resolved) {
    if (r.marker === 'knob') feature = { shape: 'knob', size: 4 };
    if (r.marker === 'notch') feature = { shape: 'notch', size: 4 };
  }

  const shaped = (r: ResolvedModification) => r.marker !== 'knob' && r.marker !== 'notch';
  stack(
    resolved.filter((r) => shaped(r) && r.side === 'interface'),
    ctx,
    'interface',
    nodes,
  );
  stack(
    resolved.filter((r) => shaped(r) && r.side === 'surface'),
    ctx,
    'surface',
    nodes,
  );

  const out: DomainDecorations = { nodes, resolved, extent: extentOf(resolved, ctx) };
  if (feature) out.feature = feature;
  return out;
}

/**
 * How much room the glyph and its marks take, in glyph coordinates. Marks sit on
 * one edge, so the box grows to that side only — an isotropic radius would pad a
 * structure depiction's width onto the height as well and leave the molecule
 * adrift in the middle of an oversized canvas.
 */
function extentOf(
  resolved: ResolvedModification[],
  ctx: DecorateContext,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const box = {
    minX: -ctx.width / 2,
    maxX: ctx.width / 2,
    minY: -ctx.height / 2,
    maxY: ctx.height / 2,
  };
  const grow = (dir: 1 | -1, out: number, across: number): void => {
    if (dir > 0) box.maxX = Math.max(box.maxX, ctx.width / 2 + out);
    else box.minX = Math.min(box.minX, -ctx.width / 2 - out);
    box.minY = Math.min(box.minY, -across);
    box.maxY = Math.max(box.maxY, across);
  };

  for (const r of resolved) {
    if (r.marker === 'knob' || r.marker === 'notch') continue;
    const dir = r.side === 'interface' ? ctx.interfaceSign : ctx.surfaceSign;
    const structure = ctx.inlineStructures ? r.payload?.structure : undefined;
    if (structure) {
      const w = structure.width ?? STRUCTURE_SIZE.width;
      const h = structure.height ?? STRUCTURE_SIZE.height;
      // The depiction is drawn upright whatever the domain's angle, so reserve
      // the same room in every direction from where the bond ends.
      // The bond, the attachment atom, the drawing, its brackets and the
      // "n = DAR" that follows them all have to fit.
      const span = Math.max(w, h);
      grow(dir, 34 + span, span / 2 + (ctx.showPayloadNames ? 22 : 12));
    } else if (r.marker === 'drug') {
      const name = ctx.showPayloadNames ? (r.payload?.name.length ?? 0) * 5 + 6 : 0;
      grow(dir, 24 + name, 10);
    } else {
      grow(dir, 14, 10);
    }
  }
  return box;
}

/** Lay a group of marks along one edge, centred on the domain. */
function stack(
  items: ResolvedModification[],
  ctx: DecorateContext,
  side: 'interface' | 'surface',
  nodes: SceneNode[],
): void {
  if (items.length === 0) return;
  const entries = items.flatMap((r) => {
    // A structure depiction is drawn once however many copies are conjugated;
    // repeating it would just stack overlapping drawings.
    const inlined = ctx.inlineStructures && r.payload?.structure;
    const copies = inlined ? 1 : Math.max(1, r.payload?.count ?? 1);
    return Array.from({ length: copies }, () => r);
  });
  const dir: 1 | -1 = side === 'interface' ? ctx.interfaceSign : ctx.surfaceSign;
  const edgeX = dir * (side === 'interface' ? ctx.width / 2 - 3.2 : ctx.width / 2);
  const step = side === 'interface' ? 6 : 8;
  const top = -((entries.length - 1) * step) / 2;
  // Repeated copies of one payload share a single name label, on the middle one.
  const labelled = Math.floor((entries.length - 1) / 2);
  entries.forEach((r, i) => {
    nodes.push(
      ...markerNodes(r, edgeX, top + i * step, dir, ctx, i === labelled || r.marker !== 'drug'),
    );
  });
}

function markerNodes(
  r: ResolvedModification,
  x: number,
  y: number,
  dir: 1 | -1,
  ctx: DecorateContext,
  withName = true,
): SceneNode[] {
  const data: Record<string, string> = { 'modification-type': r.type };
  if (r.payload?.name) data['payload'] = r.payload.name;
  const common = { className: 'dn-marker', data, pointerEvents: 'none' as const };

  switch (r.marker) {
    case 'dot':
      return [{ kind: 'circle', cx: x, cy: y, r: 2.1, fill: r.color, ...common }];
    case 'star':
      return [
        {
          kind: 'path',
          d: starPath(3),
          transform: `translate(${round(x + dir * 3)},${round(y)})`,
          fill: r.color,
          ...common,
        },
      ];
    case 'bar':
      return [
        {
          kind: 'rect',
          x: x - 1.6,
          y: y - 4.5,
          width: 3.2,
          height: 9,
          rx: 1.4,
          fill: r.color,
          ...common,
        },
      ];
    case 'plus':
    case 'minus': {
      const arms: SceneNode[] = [
        {
          kind: 'line',
          x1: x - 2.6,
          y1: y,
          x2: x + 2.6,
          y2: y,
          stroke: r.color,
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          ...common,
        },
      ];
      if (r.marker === 'plus') {
        arms.push({
          kind: 'line',
          x1: x,
          y1: y - 2.6,
          x2: x,
          y2: y + 2.6,
          stroke: r.color,
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          ...common,
        });
      }
      return arms;
    }
    case 'cross':
      return [
        {
          kind: 'path',
          d: `M${round(x - 2.8)},${round(y - 2.8)}L${round(x + 2.8)},${round(y + 2.8)}M${round(x + 2.8)},${round(y - 2.8)}L${round(x - 2.8)},${round(y + 2.8)}`,
          stroke: r.color,
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          fill: 'none',
          ...common,
        },
      ];
    case 'ss':
      return [
        {
          kind: 'line',
          x1: x - 3,
          y1: y,
          x2: x + 3,
          y2: y,
          stroke: r.color,
          strokeWidth: 1.5,
          strokeDasharray: '1.6 1.4',
          ...common,
        },
      ];
    case 'thiol':
      // A free sulfhydryl waiting for a linker: a short stem with an open head.
      return [
        {
          kind: 'line',
          x1: x,
          y1: y,
          x2: x + dir * 4,
          y2: y,
          stroke: r.color,
          strokeWidth: 1.3,
          ...common,
        },
        {
          kind: 'circle',
          cx: x + dir * 5.8,
          cy: y,
          r: 2,
          fill: '#ffffff',
          stroke: r.color,
          strokeWidth: 1.3,
          ...common,
        },
      ];
    case 'glycan': {
      const length = 9;
      return [
        {
          kind: 'path',
          d: glycanPath(length),
          transform: `translate(${round(x)},${round(y)}) scale(${dir},1)`,
          fill: 'none',
          stroke: r.color,
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          ...common,
        },
        ...glycanNodes(length).map<SceneNode>((n) => ({
          kind: 'rect',
          x: x + dir * n.x - 1.5,
          y: y + n.y - 1.5,
          width: 3,
          height: 3,
          rx: 0.6,
          fill: r.color,
          ...common,
        })),
      ];
    }
    case 'squiggle':
      return [
        {
          kind: 'path',
          d: squigglePath(12),
          transform: `translate(${round(x)},${round(y)}) scale(${dir},1)`,
          fill: 'none',
          stroke: r.color,
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          ...common,
        },
      ];
    case 'tab':
      return [
        {
          kind: 'rect',
          x: dir > 0 ? x : x - 8,
          y: y - 2.6,
          width: 8,
          height: 5.2,
          rx: 1.6,
          fill: r.color,
          ...common,
        },
      ];
    case 'drug':
      return payloadNodes(r, x, y, dir, ctx, common, withName);
    default:
      return [{ kind: 'circle', cx: x, cy: y, r: 2.1, fill: ctx.theme.labelColor, ...common }];
  }
}

/** Stalk (the chemical linker) plus the payload glyph and its name. */
function payloadNodes(
  r: ResolvedModification,
  x: number,
  y: number,
  dir: 1 | -1,
  ctx: DecorateContext,
  common: { className: string; data: Record<string, string>; pointerEvents: 'none' },
  withName: boolean,
): SceneNode[] {
  const payload = r.payload;
  const structure = ctx.inlineStructures ? r.payload?.structure : undefined;
  const boxWidth = structure?.width ?? STRUCTURE_SIZE.width;
  const boxHeight = structure?.height ?? STRUCTURE_SIZE.height;
  const label = attachmentLabel(payload, Boolean(structure));
  const lead = structure ? 7 : 5;
  const labelSpan = label ? 9 : 0;
  const trail = structure ? 7 : 3;
  const stalk = lead + labelSpan + trail;
  const radius = 3.4;
  const tipX = x + dir * (stalk + radius);
  const dashed = payload?.cleavable === false ? { strokeDasharray: '1.8 1.4' } : {};
  const bond = (from: number, to: number): SceneNode => ({
    kind: 'line',
    x1: x + dir * from,
    y1: y,
    x2: x + dir * to,
    y2: y,
    stroke: r.color,
    strokeWidth: 1.3,
    // A non-cleavable linker is drawn as a broken bond.
    ...dashed,
    ...common,
  });

  const nodes: SceneNode[] = [
    { kind: 'circle', cx: x, cy: y, r: 1.9, fill: r.color, ...common },
    bond(0, lead),
  ];
  if (label) {
    nodes.push({
      kind: 'group',
      transform: `translate(${round(x + dir * (lead + labelSpan / 2))},${round(y)}) rotate(${round(-ctx.rotation)})`,
      children: [
        {
          kind: 'text',
          x: 0,
          y: 0,
          text: label,
          fontSize: ctx.theme.legendSize,
          fontFamily: ctx.theme.fontFamily,
          fill: r.color,
          anchor: 'middle',
          baseline: 'central',
          className: 'dn-attachment-label',
          pointerEvents: 'none',
        },
      ],
      className: 'dn-attachment',
      data: common.data,
      pointerEvents: 'none',
    });
    nodes.push(bond(lead + labelSpan, stalk));
  }

  if (structure) {
    // Bond the compound onto the conjugation site the way an ADC scheme does:
    // a bond off the antibody, the atom the chemistry leaves behind, then the
    // linker-payload. The depiction is counter-rotated, because a structure has
    // to stay upright even when its domain is on a tilted arm, and flipped when
    // its reactive end would otherwise point away from the antibody.
    const tipLocalX = x + dir * stalk;
    const worldOut = dirWorldX(dir, ctx.rotation);
    const extendRight = worldOut >= 0;
    const attach = attachFraction(structure, extendRight);
    const mirror = (structure.mirror ?? false) && (extendRight ? attach.x > 0.5 : attach.x < 0.5);
    const attachX = (mirror ? 1 - attach.x : attach.x) * boxWidth;
    const attachY = attach.y * boxHeight;
    // Position the box so that the attachment point lands on the bond's end.
    const boxX = -attachX;
    const boxY = -attachY;

    const panel: SceneNode[] = [];
    const drawing = structureNode(r, boxX, boxY, boxWidth, boxHeight, mirror);
    if (drawing) panel.push(drawing);
    // Square brackets with the drug-to-antibody ratio, as ADC schemes bracket
    // the repeating linker-payload unit.
    if (payload?.dar != null) {
      const far = extendRight ? 1 : -1;
      const left = boxX - 3;
      const right = boxX + boxWidth + 3;
      const top = boxY - 3;
      const bottom = boxY + boxHeight + 3;
      panel.push(
        bracket(left, top, bottom, 1, r.color),
        bracket(right, top, bottom, -1, r.color),
        {
          kind: 'text',
          x: (far > 0 ? right : left) + far * 3,
          y: bottom - 1,
          text: `n = ${payload.dar}`,
          fontSize: ctx.theme.legendSize - 1.5,
          fontFamily: ctx.theme.fontFamily,
          fill: r.color,
          anchor: far > 0 ? 'start' : 'end',
          baseline: 'central',
          className: 'dn-payload-dar',
          pointerEvents: 'none',
        },
      );
    }
    if (ctx.showPayloadNames && payload?.name) {
      panel.push({
        kind: 'text',
        x: boxX + boxWidth / 2,
        y: boxY + boxHeight + 10,
        text: payload.name,
        fontSize: ctx.theme.legendSize - 0.5,
        fontFamily: ctx.theme.fontFamily,
        fill: r.color,
        fontWeight: 600,
        anchor: 'middle',
        baseline: 'central',
        className: 'dn-payload-label',
        pointerEvents: 'none',
      });
    }
    nodes.push({
      kind: 'group',
      transform: `translate(${round(tipLocalX)},${round(y)}) rotate(${round(-ctx.rotation)})`,
      children: panel,
      data: common.data,
      className: 'dn-payload-structure',
      pointerEvents: 'none',
    });
    return nodes;
  }

  nodes.push({
    kind: 'path',
    d: payloadPath(payload?.shape ?? 'hexagon', radius),
    transform: `translate(${round(tipX)},${round(y)})`,
    fill: r.color,
    stroke: ctx.theme.outline,
    strokeWidth: 0.8,
    ...common,
  });

  if (withName && ctx.showPayloadNames && payload?.name) {
    // Counter-rotate so the compound name stays level whatever angle the arm
    // the domain sits on happens to be at.
    const worldOut = Math.cos((ctx.rotation * Math.PI) / 180) * 0 + dirWorldX(dir, ctx.rotation);
    const anchor = worldOut >= 0 ? 'start' : 'end';
    nodes.push({
      kind: 'group',
      transform: `translate(${round(tipX + dir * (radius + 1))},${round(y)}) rotate(${round(-ctx.rotation)})`,
      children: [
        {
          kind: 'text',
          x: worldOut >= 0 ? 3 : -3,
          y: 0,
          text: payload.name,
          fontSize: ctx.theme.legendSize - 1,
          fontFamily: ctx.theme.fontFamily,
          fill: r.color,
          fontWeight: 600,
          anchor,
          baseline: 'central',
          className: 'dn-payload-label',
          pointerEvents: 'none',
        },
      ],
      data: common.data,
      className: 'dn-payload-name',
      pointerEvents: 'none',
    });
  }
  return nodes;
}

/** World-space x component of the glyph-local direction `dir`. */
function dirWorldX(dir: 1 | -1, rotation: number): number {
  return dir * Math.cos((rotation * Math.PI) / 180);
}

/**
 * Where the bond meets the drawing, as a fraction of the drawn box. `attach` is
 * given in the artwork's own coordinates when a `viewBox` says what those are,
 * so an atom position from a depiction toolkit needs no conversion by the caller.
 */
export function attachFraction(
  structure: NonNullable<Payload['structure']>,
  extendRight: boolean,
): { x: number; y: number } {
  if (!structure.attach) return { x: extendRight ? 0 : 1, y: 0.5 };
  const box = structure.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (box && box.length === 4 && box[2] && box[3]) {
    return {
      x: (structure.attach.x - box[0]!) / box[2],
      y: (structure.attach.y - box[1]!) / box[3],
    };
  }
  return structure.attach;
}

/**
 * Which way a drawing wants to extend: away from the atom the antibody holds.
 * `null` when the caller named no atom, in which case either side works.
 */
export function preferredSide(
  structure: NonNullable<Payload['structure']> | undefined,
): boolean | null {
  if (!structure?.attach) return null;
  return attachFraction(structure, true).x < 0.5;
}

interface TextGlyph {
  tag: string;
  x: number;
  y: number;
  size: number;
}

/**
 * Flip a depiction horizontally without turning its atom labels into mirror
 * writing.
 *
 * Each `<text>` is flipped back about its own anchor so the glyph reads the
 * right way round, and the glyphs of one label are re-laid so they still read
 * left to right: a depiction toolkit writes `NH2` as three separate elements,
 * and mirroring their positions alone would leave `2HN`.
 */
function unmirrorLabels(markup: string): string {
  const glyphs: TextGlyph[] = [];
  for (const m of markup.matchAll(/<text\b([^>]*)>/g)) {
    const attrs = m[1] ?? '';
    const x = /\sx="([-\d.]+)"/.exec(attrs);
    const y = /\sy="([-\d.]+)"/.exec(attrs);
    if (!x?.[1] || !y?.[1] || /\stransform="/.test(attrs)) continue;
    glyphs.push({
      tag: m[0],
      x: Number(x[1]),
      y: Number(y[1]),
      size: Number(/font-size="([\d.]+)"/.exec(attrs)?.[1] ?? 12),
    });
  }
  if (glyphs.length === 0) return markup;

  const placed = new Map<string, number>();
  for (const run of labelRuns(glyphs)) {
    // Widths come from the spacing the toolkit used; only the last glyph of a
    // run has to be estimated.
    const widths = run.map((g, i) =>
      i < run.length - 1 ? run[i + 1]!.x - g.x : g.size * 0.62,
    );
    const total = widths.reduce((sum, w) => sum + w, 0);
    let offset = 0;
    run.forEach((g, i) => {
      placed.set(g.tag, run[0]!.x + total - offset - widths[i]!);
      offset += widths[i]!;
    });
  }

  return markup.replace(/<text\b([^>]*)>/g, (tag, attrs: string) => {
    const at = placed.get(tag);
    if (at === undefined) return tag;
    const anchor = /text-anchor="(\w+)"/.exec(attrs)?.[1] ?? 'start';
    const flipped = anchor === 'middle' ? 'middle' : anchor === 'end' ? 'start' : 'end';
    const cleaned = attrs
      .replace(/\stext-anchor="\w+"/, '')
      .replace(/\sx="[-\d.]+"/, ` x="${round(at)}"`);
    return `<text${cleaned} text-anchor="${flipped}" transform="translate(${round(at * 2)},0) scale(-1,1)">`;
  });
}

/**
 * Glyphs set solid on one line, i.e. the pieces of one atom label. A subscript
 * sits on its own baseline a little below the letters, so the band is allowed to
 * be about half a glyph deep rather than exactly flat.
 */
function labelRuns(glyphs: TextGlyph[]): TextGlyph[][] {
  const bands: TextGlyph[][] = [];
  for (const g of [...glyphs].sort((a, b) => a.y - b.y)) {
    const band = bands[bands.length - 1];
    const depth = Math.max(...(band ?? [g]).map((b) => b.size), g.size) * 0.6;
    if (band && g.y - band[0]!.y < depth) band.push(g);
    else bands.push([g]);
  }

  const runs: TextGlyph[][] = [];
  for (const band of bands) {
    let run: TextGlyph[] = [];
    for (const g of band.sort((a, b) => a.x - b.x)) {
      const last = run[run.length - 1];
      const gap = last ? g.x - last.x : Infinity;
      if (last && gap > 0 && gap < Math.max(last.size, g.size) * 1.6) run.push(g);
      else {
        if (run.length > 0) runs.push(run);
        run = [g];
      }
    }
    if (run.length > 0) runs.push(run);
  }
  return runs;
}

/** One half of a square bracket: a stem with ticks turned towards `facing`. */
function bracket(x: number, top: number, bottom: number, facing: 1 | -1, color: string): SceneNode {
  const tick = 3.5;
  return {
    kind: 'path',
    d: `M${round(x + facing * tick)},${round(top)}H${round(x)}V${round(bottom)}H${round(x + facing * tick)}`,
    fill: 'none',
    stroke: color,
    strokeWidth: 0.9,
    className: 'dn-payload-bracket',
    pointerEvents: 'none',
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The marker used in the legend, drawn centred on (0,0). */
export function legendMarker(r: ResolvedModification): SceneNode[] {
  switch (r.marker) {
    case 'knob':
      return [
        {
          kind: 'path',
          d: domainPath(9, 12, 2, { shape: 'knob', size: 3 }),
          fill: '#c3c8cf',
          stroke: r.color,
          strokeWidth: 1,
        },
      ];
    case 'notch':
      return [
        {
          kind: 'path',
          d: domainPath(9, 12, 2, { shape: 'notch', size: 3 }),
          fill: '#c3c8cf',
          stroke: r.color,
          strokeWidth: 1,
        },
      ];
    case 'drug':
      return [
        {
          kind: 'line',
          x1: -6,
          y1: 0,
          x2: -2,
          y2: 0,
          stroke: r.color,
          strokeWidth: 1.3,
          ...(r.payload?.cleavable === false ? { strokeDasharray: '1.8 1.4' } : {}),
        },
        {
          kind: 'path',
          d: payloadPath(r.payload?.shape ?? 'hexagon', 3.4),
          transform: 'translate(1.5,0)',
          fill: r.color,
          stroke: '#333a45',
          strokeWidth: 0.8,
        },
      ];
    case 'glycan':
      return [
        {
          kind: 'path',
          d: glycanPath(9),
          transform: 'translate(-5,0)',
          fill: 'none',
          stroke: r.color,
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        },
        ...glycanNodes(9).map<SceneNode>((n) => ({
          kind: 'rect',
          x: -5 + n.x - 1.5,
          y: n.y - 1.5,
          width: 3,
          height: 3,
          rx: 0.6,
          fill: r.color,
        })),
      ];
    case 'squiggle':
      return [
        {
          kind: 'path',
          d: squigglePath(12),
          transform: 'translate(-6,0)',
          fill: 'none',
          stroke: r.color,
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        },
      ];
    case 'thiol':
      return [
        { kind: 'line', x1: -6, y1: 0, x2: -2, y2: 0, stroke: r.color, strokeWidth: 1.3 },
        {
          kind: 'circle',
          cx: 0,
          cy: 0,
          r: 2,
          fill: '#ffffff',
          stroke: r.color,
          strokeWidth: 1.3,
        },
      ];
    case 'tab':
      return [{ kind: 'rect', x: -4, y: -2.6, width: 8, height: 5.2, rx: 1.6, fill: r.color }];
    case 'ss':
      return [
        {
          kind: 'path',
          d: 'M-5,0 L5,0',
          stroke: r.color,
          strokeWidth: 1.6,
          strokeDasharray: '1.6 1.4',
        },
      ];
    default:
      return markerNodes(r, 0, 0, 1, {
        interfaceSign: 1,
        surfaceSign: -1,
        width: 0,
        height: 0,
        rotation: 0,
        showPayloadNames: false,
        inlineStructures: false,
        theme: { labelColor: r.color } as Theme,
      });
  }
}
