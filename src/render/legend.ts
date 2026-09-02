import type { Construct, NormalizedConstruct, SpecificityDecl } from '../model/types';
import { normalize } from '../model/normalize';
import { resolveTheme, type Theme } from '../theme/theme';
import { domainPath } from './glyphs';
import {
  STRUCTURE_SIZE,
  legendMarker,
  resolveModification,
  structureNode,
  type ResolvedModification,
} from './markers';
import type { Scene, SceneNode } from './scene-types';
import { toSVGString } from './svg';

export interface LegendResult {
  nodes: SceneNode[];
  height: number;
  /** Widest point actually used, which a caption can push past the budget. */
  width: number;
}

const ROW_HEIGHT = 15;
const SWATCH = 16;
const GAP = 18;

function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.56;
}

/** Targets first, then engineering modifications, flowed into rows. */
export interface LegendOptions {
  /** Append framed thumbnails of any supplied chemical structures. */
  structures?: boolean;
}

export function buildLegend(
  specificities: Required<SpecificityDecl>[],
  modifications: ResolvedModification[],
  theme: Theme,
  widthBudget: number,
  options: LegendOptions = {},
): LegendResult {
  const nodes: SceneNode[] = [];
  let y = 0;
  let used = 0;

  const section = (heading: string): void => {
    if (y > 0) y += 5;
    nodes.push({
      kind: 'text',
      x: 0,
      y: y + theme.legendSize * 0.9,
      text: heading,
      fontSize: theme.legendSize - 0.5,
      fontFamily: theme.fontFamily,
      fontWeight: 600,
      fill: theme.labelColor,
      opacity: 0.65,
      className: 'dn-legend-heading',
    });
    y += ROW_HEIGHT;
  };

  const flow = (
    entries: { label: string; draw: (x: number, y: number) => SceneNode[] }[],
  ): void => {
    let x = 0;
    for (const entry of entries) {
      const w = SWATCH + 4 + textWidth(entry.label, theme.legendSize) + GAP;
      if (x > 0 && x + w > widthBudget) {
        x = 0;
        y += ROW_HEIGHT;
      }
      nodes.push(...entry.draw(x, y + ROW_HEIGHT / 2));
      nodes.push({
        kind: 'text',
        x: x + SWATCH + 4,
        y: y + ROW_HEIGHT / 2,
        text: entry.label,
        fontSize: theme.legendSize,
        fontFamily: theme.fontFamily,
        fill: theme.labelColor,
        baseline: 'central',
        className: 'dn-legend-label',
      });
      x += w;
      used = Math.max(used, x - GAP);
    }
    y += ROW_HEIGHT;
  };

  if (specificities.length > 0) {
    section('Targets');
    flow(
      specificities.map((s) => ({
        label: s.label,
        draw: (x: number, cy: number): SceneNode[] => [
          {
            kind: 'path',
            d: domainPath(9, 13, 3.5),
            transform: `translate(${x + SWATCH / 2},${cy})`,
            fill: s.color,
            stroke: theme.outline,
            strokeWidth: theme.outlineWidth,
            data: { specificity: s.name },
            className: 'dn-legend-swatch',
          },
        ],
      })),
    );
  }

  // Conjugated chemistry gets its own heading: an ADC's payload, linker and DAR
  // are the point of the drawing, not a footnote to the protein engineering.
  const engineering = modifications.filter((m) => m.group !== 'conjugation');
  const conjugation = modifications.filter((m) => m.group === 'conjugation');

  const entryFor = (m: ResolvedModification) => ({
    label: m.payload && m.detail ? `${m.label} · ${m.detail}` : m.label,
    draw: (x: number, cy: number): SceneNode[] => [
      {
        kind: 'group',
        transform: `translate(${x + SWATCH / 2},${cy})`,
        children: legendMarker(m),
        data: {
          'modification-type': m.type,
          ...(m.payload?.name ? { payload: m.payload.name } : {}),
        },
        className: 'dn-legend-marker',
        ...(m.detail ? { title: m.detail } : {}),
      },
    ],
  });

  if (engineering.length > 0) {
    section('Engineering');
    flow(engineering.map(entryFor));
  }

  if (conjugation.length > 0) {
    section('Conjugation');
    flow(conjugation.map(entryFor));
  }

  if (options.structures) {
    const withStructures = modifications.filter(
      (m) => m.payload?.structure?.svg != null || m.payload?.structure?.href,
    );
    if (withStructures.length > 0) {
      section('Structures');
      const block = drawStructures(withStructures, theme, widthBudget, y, nodes);
      y += block.height;
      used = Math.max(used, block.width);
    }
  }

  return { nodes, height: y, width: Math.max(used, 0) };
}

const STRUCTURE_GAP = 12;

/** Framed thumbnails, wrapped into rows, each captioned with its compound. */
function drawStructures(
  items: ResolvedModification[],
  theme: Theme,
  widthBudget: number,
  top: number,
  nodes: SceneNode[],
): { height: number; width: number } {
  const captionHeight = theme.legendSize + 5;
  let x = 0;
  let y = top;
  let rowHeight = 0;
  let used = 0;

  for (const item of items) {
    const structure = item.payload!.structure!;
    const width = structure.width ?? STRUCTURE_SIZE.width;
    const height = structure.height ?? STRUCTURE_SIZE.height;
    const caption = structure.caption ?? item.payload?.name ?? '';
    // A caption longer than its thumbnail widens the slot, so it is never
    // clipped by the edge of the drawing.
    const slot = Math.max(width, textWidth(caption, theme.legendSize - 0.5));
    if (x > 0 && x + slot > widthBudget) {
      x = 0;
      y += rowHeight + captionHeight + STRUCTURE_GAP;
      rowHeight = 0;
    }
    const frameX = x + (slot - width) / 2;
    nodes.push({
      kind: 'rect',
      x: frameX,
      y,
      width,
      height,
      rx: 4,
      fill: 'none',
      stroke: theme.constantStroke,
      strokeWidth: 0.8,
      opacity: 0.5,
      className: 'dn-structure-frame',
    });
    const drawing = structureNode(item, frameX, y, width, height);
    if (drawing) nodes.push(drawing);
    nodes.push({
      kind: 'text',
      x: x + slot / 2,
      y: y + height + captionHeight / 2,
      text: caption,
      fontSize: theme.legendSize - 0.5,
      fontFamily: theme.fontFamily,
      fill: theme.labelColor,
      anchor: 'middle',
      baseline: 'central',
      className: 'dn-structure-caption',
    });
    x += slot + STRUCTURE_GAP;
    used = Math.max(used, x - STRUCTURE_GAP);
    rowHeight = Math.max(rowHeight, height);
  }
  return { height: y - top + rowHeight + captionHeight, width: used };
}

export interface LegendSceneOptions {
  theme?: Partial<Theme>;
  /** Width budget for wrapping entries. Default 320. */
  width?: number;
  background?: string | null;
  /** Append framed thumbnails of any supplied chemical structures. Default true. */
  showStructures?: boolean;
}

/** A key that only merges modifications with the same legend meaning. */
export function modificationLegendKey(modification: ResolvedModification): string {
  const structure = modification.payload?.structure;
  const structureKey = structure
    ? [
        structure.svg ?? '',
        structure.href ?? '',
        structure.viewBox ?? '',
        structure.width ?? null,
        structure.height ?? null,
        structure.caption ?? '',
        structure.attach ? [structure.attach.x, structure.attach.y] : null,
        structure.attachFrom ? [structure.attachFrom.x, structure.attachFrom.y] : null,
        structure.mirror ?? false,
      ]
    : null;
  return JSON.stringify([
    modification.type,
    modification.label,
    // Catalogued engineering pairs such as DuoBody deliberately use one
    // shared label for their complementary residues. Payload details, on the
    // other hand, are the chemistry and must remain distinct.
    modification.payload ? modification.detail : '',
    modification.marker,
    modification.color,
    structureKey,
  ]);
}

/** Every distinct modification in the construct, in first-appearance order. */
export function collectModifications(construct: NormalizedConstruct): ResolvedModification[] {
  const seen = new Map<string, ResolvedModification>();
  for (const chain of construct.chains) {
    for (const domain of chain.domains) {
      for (const m of domain.modifications) {
        const r = resolveModification(m, domain.id);
        const key = modificationLegendKey(r);
        if (!seen.has(key)) seen.set(key, r);
      }
    }
  }
  return [...seen.values()];
}

/** A standalone legend, for placing beside a diagram rendered without one. */
export function buildLegendScene(
  input: Construct | NormalizedConstruct,
  options: LegendSceneOptions = {},
): Scene {
  const theme = resolveTheme(options.theme);
  const construct: NormalizedConstruct =
    'byId' in input ? input : normalize(input, { theme: options.theme });
  const width = options.width ?? 320;
  const legend = buildLegend(
    construct.specificities,
    collectModifications(construct),
    theme,
    width,
    { structures: options.showStructures ?? true },
  );
  return {
    viewBox: { x: 0, y: 0, width: width + theme.padding * 2, height: legend.height + 8 },
    width: width + theme.padding * 2,
    height: legend.height + 8,
    background: options.background !== undefined ? options.background : theme.background,
    children: [
      {
        kind: 'group',
        className: 'dn-legend',
        transform: `translate(${theme.padding},4)`,
        children: legend.nodes,
      },
    ],
  };
}

export function renderLegend(
  input: Construct | NormalizedConstruct,
  options: LegendSceneOptions = {},
): { svg: string; scene: Scene } {
  const scene = buildLegendScene(input, options);
  return { svg: toSVGString(scene), scene };
}
