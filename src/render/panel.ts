import { diff } from '../diff/index';
import { normalize } from '../model/normalize';
import type { Construct, NormalizedConstruct, SpecificityDecl } from '../model/types';
import { resolveTheme, type Theme } from '../theme/theme';
import { assignSpecificityColors, type ColorMode } from '../theme/palette';
import { buildLegend, collectModifications } from './legend';
import { buildScene, type SceneOptions } from './scene';
import type { Scene, SceneNode } from './scene-types';
import { toSVGString } from './svg';
import type { ResolvedModification } from './markers';

export interface PanelItem {
  construct: Construct | NormalizedConstruct;
  /** Caption under the cell. */
  label?: string;
  /** Per-cell overrides; the legend and title are always handled by the panel. */
  options?: Omit<SceneOptions, 'showLegend' | 'showTitle' | 'theme' | 'colorMode'>;
}

export interface PanelOptions {
  /** Cells per row. Defaults to something close to square. */
  columns?: number;
  theme?: Partial<Theme>;
  colorMode?: ColorMode;
  /** One legend for the whole figure rather than one per cell. Default true. */
  sharedLegend?: boolean;
  /** Draw every molecule at the same size. Default true. */
  uniformScale?: boolean;
  /** Heading above the figure. */
  title?: string;
  background?: string | null;
  scale?: number;
}

export interface PanelResult {
  svg: string;
  scene: Scene;
}

const CELL_GAP = 16;
const LABEL_HEIGHT = 18;

/**
 * Lay several molecules out as one figure.
 *
 * The point of doing this here rather than placing several `<svg>` elements
 * side by side is that a panel has to be internally consistent: the same target
 * must be the same colour in every cell, and the molecules must be drawn at one
 * scale so their sizes can be compared. Colours are assigned once across the
 * whole set — left to itself, each construct numbers its targets from scratch
 * and the second cell's CD3 comes out the colour of the first cell's HER2.
 */
export function renderPanel(items: PanelItem[], options: PanelOptions = {}): PanelResult {
  const theme = resolveTheme(options.theme);
  const colorMode = options.colorMode ?? 'specificity';
  const shared = sharedSpecificities(items, theme);

  const scenes = items.map((item) => {
    const construct = withSpecificities(item.construct, shared);
    return buildScene(construct, {
      ...item.options,
      theme: options.theme,
      colorMode,
      showLegend: false,
      showTitle: false,
    });
  });

  const cellWidth = Math.max(...scenes.map((s) => s.scene.viewBox.width), 1);
  const cellHeight = Math.max(...scenes.map((s) => s.scene.viewBox.height), 1);
  const labelled = items.some((item) => item.label);
  const rowHeight = cellHeight + (labelled ? LABEL_HEIGHT : 0);

  const columns = Math.max(1, options.columns ?? Math.ceil(Math.sqrt(items.length)));
  const rows = Math.ceil(items.length / columns);

  const titleHeight = options.title ? theme.titleSize + 12 : 0;
  const children: SceneNode[] = [];

  if (options.title) {
    children.push({
      kind: 'text',
      x: (columns * cellWidth + (columns - 1) * CELL_GAP) / 2 + theme.padding,
      y: theme.titleSize + 2,
      text: options.title,
      fontSize: theme.titleSize,
      fontFamily: theme.fontFamily,
      fontWeight: 600,
      fill: theme.labelColor,
      anchor: 'middle',
      className: 'av-panel-title',
    });
  }

  scenes.forEach(({ scene }, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = theme.padding + column * (cellWidth + CELL_GAP);
    const y = titleHeight + row * (rowHeight + CELL_GAP);

    // Uniform scale keeps sizes comparable; otherwise each cell fills its box.
    const fit = options.uniformScale === false
      ? Math.min(cellWidth / scene.viewBox.width, cellHeight / scene.viewBox.height)
      : 1;
    const drawnWidth = scene.viewBox.width * fit;
    const drawnHeight = scene.viewBox.height * fit;
    const offsetX = x + (cellWidth - drawnWidth) / 2;
    const offsetY = y + (cellHeight - drawnHeight) / 2;

    children.push({
      kind: 'group',
      className: 'av-panel-cell',
      data: { 'panel-index': String(index) },
      transform: `translate(${round(offsetX)},${round(offsetY)}) scale(${round(fit)})`,
      children: scene.children,
    });

    const label = items[index]?.label;
    if (label) {
      children.push({
        kind: 'text',
        x: x + cellWidth / 2,
        y: y + cellHeight + LABEL_HEIGHT / 2,
        text: label,
        fontSize: theme.legendSize + 0.5,
        fontFamily: theme.fontFamily,
        fontWeight: 600,
        fill: theme.labelColor,
        anchor: 'middle',
        baseline: 'central',
        className: 'av-panel-label',
      });
    }
  });

  const gridWidth = columns * cellWidth + (columns - 1) * CELL_GAP;
  const gridBottom = titleHeight + rows * rowHeight + (rows - 1) * CELL_GAP;

  let height = gridBottom + theme.padding;
  if (options.sharedLegend !== false) {
    const modifications = unionModifications(items);
    const legend = buildLegend(shared, modifications, theme, gridWidth, { structures: false });
    if (legend.height > 0) {
      children.push({
        kind: 'group',
        className: 'av-legend',
        transform: `translate(${theme.padding},${round(gridBottom + CELL_GAP)})`,
        children: legend.nodes,
      });
      height = gridBottom + CELL_GAP + legend.height + theme.padding;
    }
  }

  const width = gridWidth + theme.padding * 2;
  const scale = options.scale ?? 1;
  const scene: Scene = {
    viewBox: { x: 0, y: 0, width: round(width), height: round(height) },
    width: round(width * scale),
    height: round(height * scale),
    background: options.background !== undefined ? options.background : theme.background,
    children,
    ...(options.title ? { title: options.title } : {}),
    description: `Panel of ${items.length} antibody format${items.length === 1 ? '' : 's'}.`,
  };

  return { svg: toSVGString(scene), scene };
}

/**
 * A parent and a variant side by side, with everything that differs lit up.
 */
export function renderComparison(
  before: Construct | NormalizedConstruct,
  after: Construct | NormalizedConstruct,
  options: PanelOptions & { labels?: [string, string] } = {},
): PanelResult & { changes: ReturnType<typeof diff>['changes'] } {
  const result = diff(before, after);
  const [beforeLabel, afterLabel] = options.labels ?? ['before', 'after'];
  const panel = renderPanel(
    [
      { construct: before, label: beforeLabel, options: { highlight: result.highlightBefore } },
      { construct: after, label: afterLabel, options: { highlight: result.highlightAfter } },
    ],
    { columns: 2, ...options },
  );
  return { ...panel, changes: result.changes };
}

// ---------------------------------------------------------------------------

/** One colour per target across the whole figure, in order of first appearance. */
function sharedSpecificities(items: PanelItem[], theme: Theme): Required<SpecificityDecl>[] {
  const order: string[] = [];
  const declared: SpecificityDecl[] = [];
  for (const item of items) {
    const construct = 'byId' in item.construct ? item.construct : normalize(item.construct);
    for (const chain of construct.chains) {
      for (const domain of chain.domains) {
        if (domain.specificity && !order.includes(domain.specificity)) order.push(domain.specificity);
      }
    }
    for (const s of item.construct.specificities ?? []) {
      if (s.color && !declared.some((d) => d.name === s.name)) declared.push(s);
    }
  }
  return assignSpecificityColors(declared, order, theme);
}

function withSpecificities(
  input: Construct | NormalizedConstruct,
  specificities: Required<SpecificityDecl>[],
): Construct {
  const base: Construct =
    'byId' in input
      ? { name: input.name, chains: input.chains, links: input.links, layout: input.layout }
      : input;
  return { ...base, specificities };
}

function unionModifications(items: PanelItem[]): ResolvedModification[] {
  const seen = new Map<string, ResolvedModification>();
  for (const item of items) {
    const construct = 'byId' in item.construct ? item.construct : normalize(item.construct);
    for (const m of collectModifications(construct)) {
      const key = `${m.type}|${m.label}`;
      if (!seen.has(key)) seen.set(key, m);
    }
  }
  return [...seen.values()];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
