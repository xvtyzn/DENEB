import type { Construct, NChain, NDomain, NormalizedConstruct } from '../model/types';
import { DOMAIN_CATALOG } from '../model/catalog';
import { normalize } from '../model/normalize';
import { createColorResolver, type ColorMode } from '../theme/palette';
import { resolveTheme, type Theme } from '../theme/theme';
import { buildLegend } from './legend';
import { payloadPath } from './glyphs';
import { resolveModification, type ResolvedModification } from './markers';
import { resolveHighlight } from './scene';
import type { Scene, SceneNode } from './scene-types';
import { toSVGString } from './svg';

export interface LinearOptions {
  theme?: Partial<Theme>;
  colorMode?: ColorMode;
  /** Width of the track area in user units. Default 560. */
  trackWidth?: number;
  /** Height of one chain's bar. Default 22. */
  trackHeight?: number;
  showLegend?: boolean;
  showLabels?: boolean;
  /** Append framed thumbnails of any supplied chemical structures. Default true. */
  showStructures?: boolean;
  showTitle?: boolean;
  title?: string;
  /** Draw a residue-position ruler under each chain that has a sequence. */
  showRuler?: boolean;
  highlight?: string[];
  width?: number;
  height?: number;
  scale?: number;
  background?: string | null;
}

export interface LinearResult {
  svg: string;
  scene: Scene;
  construct: NormalizedConstruct;
}

const LABEL_COLUMN = 54;
const ROW_GAP = 16;

/**
 * Domain-architecture view: one horizontal bar per chain, in the style of a
 * Pfam/InterPro track. When domains carry residue ranges the bars are drawn to
 * scale, which is the view to use for placing point mutations exactly.
 */
export function renderLinear(
  input: Construct | NormalizedConstruct,
  options: LinearOptions = {},
): LinearResult {
  const theme = resolveTheme(options.theme);
  const construct: NormalizedConstruct =
    'byId' in input ? input : normalize(input, { theme: options.theme });
  const colors = createColorResolver(
    construct.specificities,
    construct.chains,
    theme,
    options.colorMode ?? 'specificity',
  );

  const trackWidth = options.trackWidth ?? 560;
  const trackHeight = options.trackHeight ?? 22;
  const showLabels = options.showLabels ?? true;
  const showRuler = options.showRuler ?? true;
  const highlighted = resolveHighlight(options.highlight ?? [], construct);

  const title = options.title ?? construct.name;
  const showTitle = (options.showTitle ?? true) && Boolean(title);
  const titleHeight = showTitle ? theme.titleSize + 10 : 0;

  const usedModifications = new Map<string, ResolvedModification>();
  const children: SceneNode[] = [];
  const hasConjugate = construct.chains.some((c) =>
    c.domains.some((d) => d.modifications.some((m) => m.payload)),
  );
  // A conjugate glyph stands above its track, so the rows need extra clearance.
  const rowGap = ROW_GAP + (hasConjugate ? 12 : 0);
  let y = titleHeight + theme.padding + (hasConjugate ? 12 : 0);

  for (const chain of construct.chains) {
    const rowHeight = trackHeight + (showRuler && hasRanges(chain) ? 12 : 0);
    children.push({
      kind: 'text',
      x: theme.padding + LABEL_COLUMN - 8,
      y: y + trackHeight / 2,
      text: chain.id,
      fontSize: theme.legendSize,
      fontFamily: theme.fontFamily,
      fill: theme.labelColor,
      anchor: 'end',
      baseline: 'central',
      className: 'dn-linear-chain-label',
    });

    const x0 = theme.padding + LABEL_COLUMN;
    const segments = segmentsOf(chain, trackWidth);

    children.push({
      kind: 'line',
      x1: x0,
      y1: y + trackHeight / 2,
      x2: x0 + trackWidth,
      y2: y + trackHeight / 2,
      stroke: theme.backbone,
      strokeWidth: 1,
      opacity: 0.5,
      className: 'dn-linear-backbone',
    });

    for (const seg of segments) {
      const d = seg.domain;
      const spec = DOMAIN_CATALOG[d.type];
      if (spec.glyph === 'linker') continue;
      const data: Record<string, string> = {
        'domain-id': d.id,
        'chain-id': d.chainId,
        'domain-type': d.type,
      };
      if (d.specificity) data['specificity'] = d.specificity;
      if (d.start != null) data['start'] = String(d.start);
      if (d.end != null) data['end'] = String(d.end);

      const box: SceneNode = {
        kind: 'rect',
        x: x0 + seg.x,
        y,
        width: seg.width,
        height: trackHeight,
        rx: spec.glyph === 'variable' ? 8 : 3,
        fill: colors.fill(d),
        stroke: theme.outline,
        strokeWidth: theme.outlineWidth,
      };
      const group: SceneNode = {
        kind: 'group',
        className: 'dn-linear-domain',
        data,
        title: describeLinear(d),
        children: [
          ...(highlighted.has(d.id)
            ? [
                {
                  ...box,
                  fill: 'none',
                  stroke: theme.highlight,
                  strokeWidth: theme.highlightWidth + 1,
                  pointerEvents: 'none' as const,
                  className: 'dn-highlight',
                } as SceneNode,
              ]
            : []),
          box,
          ...(showLabels && seg.width > 16
            ? [
                {
                  kind: 'text' as const,
                  x: x0 + seg.x + seg.width / 2,
                  y: y + trackHeight / 2,
                  text: d.label,
                  fontSize: theme.labelSize + 0.5,
                  fontFamily: theme.fontFamily,
                  fill: theme.labelColor,
                  anchor: 'middle' as const,
                  baseline: 'central' as const,
                  pointerEvents: 'none' as const,
                },
              ]
            : []),
        ],
      };
      children.push(group);

      // Modification ticks sit above the bar, at their residue position when
      // one is known and centred on the domain otherwise.
      d.modifications.forEach((m, i) => {
        const r = resolveModification(m, d.id);
        const key = `${r.type}|${r.label}`;
        if (!usedModifications.has(key)) usedModifications.set(key, r);
        const px =
          m.positions && m.positions.length > 0 && chain.sequence
            ? x0 + (m.positions[0]! / chain.sequence.length) * trackWidth
            : x0 + seg.x + seg.width / 2 + (i - (d.modifications.length - 1) / 2) * 6;
        const data: Record<string, string> = {
          'modification-type': r.type,
          'domain-id': d.id,
        };
        if (r.payload?.name) data['payload'] = r.payload.name;
        children.push({
          kind: 'line',
          x1: px,
          y1: y - (r.payload ? 9 : 4),
          x2: px,
          y2: y + 2,
          stroke: r.color,
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          ...(r.payload?.cleavable === false ? { strokeDasharray: '1.8 1.4' } : {}),
          className: 'dn-linear-modification',
          data,
        });
        // A conjugate gets its compound glyph on the stalk, matching the cartoon.
        if (r.payload) {
          children.push({
            kind: 'path',
            d: payloadPath(r.payload.shape ?? 'hexagon', 3.2),
            transform: `translate(${Math.round(px * 100) / 100},${y - 12})`,
            fill: r.color,
            stroke: theme.outline,
            strokeWidth: 0.8,
            className: 'dn-linear-payload',
            data,
          });
        }
      });
    }

    if (showRuler && chain.sequence) {
      const len = chain.sequence.length;
      children.push({
        kind: 'text',
        x: x0 + trackWidth,
        y: y + trackHeight + 9,
        text: `${len} aa`,
        fontSize: theme.legendSize - 1,
        fontFamily: theme.fontFamily,
        fill: theme.labelColor,
        opacity: 0.6,
        anchor: 'end',
        className: 'dn-linear-ruler',
      });
    }

    y += rowHeight + rowGap;
  }

  const legendBudget = trackWidth + LABEL_COLUMN;
  const legend =
    (options.showLegend ?? true)
      ? buildLegend(construct.specificities, [...usedModifications.values()], theme, legendBudget, {
          structures: options.showStructures ?? true,
        })
      : { nodes: [], height: 0, width: 0 };

  if (legend.height > 0) {
    children.push({
      kind: 'group',
      className: 'dn-legend',
      transform: `translate(${theme.padding},${y - rowGap + 10})`,
      children: legend.nodes,
    });
    y += legend.height;
  }

  const width = Math.max(
    theme.padding * 2 + LABEL_COLUMN + trackWidth,
    theme.padding * 2 + legend.width,
  );
  const height = y - rowGap + theme.padding;

  if (showTitle && title) {
    children.unshift({
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

  const scale = options.scale ?? 1;
  const scene: Scene = {
    viewBox: { x: 0, y: 0, width, height },
    width: options.width ?? Math.round(width * scale),
    height: options.height ?? Math.round(height * scale),
    background: options.background !== undefined ? options.background : theme.background,
    children,
    ...(title ? { title } : {}),
  };

  return { svg: toSVGString(scene), scene, construct };
}

interface Segment {
  domain: NDomain;
  x: number;
  width: number;
}

function hasRanges(chain: NChain): boolean {
  return Boolean(chain.sequence) || chain.domains.some((d) => d.start != null && d.end != null);
}

/**
 * Position domains by residue range when the annotation provides one, and fall
 * back to equal shares of the track otherwise.
 */
function segmentsOf(chain: NChain, trackWidth: number): Segment[] {
  const drawable = chain.domains.filter((d) => DOMAIN_CATALOG[d.type].glyph !== 'linker');
  const ranged = drawable.filter((d) => d.start != null && d.end != null);
  if (ranged.length === drawable.length && drawable.length > 0) {
    const max =
      chain.sequence?.length ?? Math.max(...ranged.map((d) => d.end!));
    return drawable.map((d) => ({
      domain: d,
      x: ((d.start! - 1) / max) * trackWidth,
      width: Math.max(4, ((d.end! - d.start! + 1) / max) * trackWidth),
    }));
  }
  const unit = trackWidth / Math.max(1, drawable.length);
  return drawable.map((d, i) => ({ domain: d, x: i * unit + 1, width: unit - 2 }));
}

function describeLinear(d: NDomain): string {
  const parts = [d.label || d.type];
  if (d.specificity) parts.push(`anti-${d.specificity}`);
  if (d.start != null && d.end != null) parts.push(`${d.start}–${d.end}`);
  for (const m of d.modifications) {
    const r = resolveModification(m, d.id);
    parts.push(r.residues.length > 0 ? `${r.label} [${r.residues.join('/')}]` : r.label);
  }
  return `${d.chainId} · ${parts.join(' · ')}`;
}
