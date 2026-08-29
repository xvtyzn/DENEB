import type { Construct, NormalizedConstruct } from '../model/types';
import type { LayoutResult } from '../layout/types';
import { buildScene, type SceneOptions } from './scene';
import type { Scene, SceneNode } from './scene-types';

export interface RenderResult {
  svg: string;
  scene: Scene;
  layout: LayoutResult;
}

/**
 * Render a construct to a standalone SVG string. Pure — it touches no DOM, so
 * it works in Node for server-side rendering, static gallery generation and
 * snapshot tests.
 */
export function renderSVG(
  input: Construct | NormalizedConstruct | LayoutResult,
  options: SceneOptions = {},
): RenderResult {
  const { scene, layout } = buildScene(input, options);
  return { svg: toSVGString(scene), scene, layout };
}

export function toSVGString(scene: Scene): string {
  const { x, y, width, height } = scene.viewBox;
  const body: string[] = [];
  if (scene.title) body.push(`<title>${esc(scene.title)}</title>`);
  if (scene.description) body.push(`<desc>${esc(scene.description)}</desc>`);
  if (scene.background) {
    body.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${esc(scene.background)}"/>`,
    );
  }
  for (const child of scene.children) body.push(serialize(child));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}"`,
    ` width="${scene.width}" height="${scene.height}"`,
    ` role="img" class="antibody-viewer">`,
    body.join(''),
    `</svg>`,
  ].join('');
}

function serialize(node: SceneNode): string {
  const attrs = attributesOf(node);
  const attrString = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join('');
  if (node.kind === 'group') {
    const inner = (node.title ? `<title>${esc(node.title)}</title>` : '') +
      node.children.map(serialize).join('');
    return `<g${attrString}>${inner}</g>`;
  }
  if (node.kind === 'text') {
    const inner = (node.title ? `<title>${esc(node.title)}</title>` : '') + esc(node.text);
    return `<text${attrString}>${inner}</text>`;
  }
  if (node.kind === 'embed') {
    // Caller-supplied markup goes in untouched; see PayloadStructure.
    if (node.markup != null) return `<svg${attrString}>${node.markup}</svg>`;
    return `<image${attrString}/>`;
  }
  const tag = node.kind;
  return `<${tag}${attrString}/>`;
}

/** Shared with the React emitter so both produce identical attribute sets. */
export function attributesOf(node: SceneNode): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const put = (k: string, v: string | number | undefined): void => {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  };

  switch (node.kind) {
    case 'path':
      put('d', node.d);
      break;
    case 'rect':
      put('x', num(node.x));
      put('y', num(node.y));
      put('width', num(node.width));
      put('height', num(node.height));
      put('rx', node.rx != null ? num(node.rx) : undefined);
      break;
    case 'circle':
      put('cx', num(node.cx));
      put('cy', num(node.cy));
      put('r', num(node.r));
      break;
    case 'line':
      put('x1', num(node.x1));
      put('y1', num(node.y1));
      put('x2', num(node.x2));
      put('y2', num(node.y2));
      break;
    case 'embed':
      put('x', num(node.x));
      put('y', num(node.y));
      put('width', num(node.width));
      put('height', num(node.height));
      put('viewBox', node.viewBox);
      put('preserveAspectRatio', node.preserveAspectRatio);
      if (node.markup == null) put('href', node.href);
      break;
    case 'text':
      put('x', num(node.x));
      put('y', num(node.y));
      put('font-size', num(node.fontSize));
      put('font-family', node.fontFamily);
      put('font-weight', node.fontWeight);
      put('text-anchor', node.anchor);
      put('dominant-baseline', node.baseline);
      break;
    default:
      break;
  }

  put('id', node.id);
  put('class', node.className);
  put('transform', node.transform);
  put('fill', node.fill);
  put('stroke', node.stroke);
  put('stroke-width', node.strokeWidth != null ? num(node.strokeWidth) : undefined);
  put('stroke-dasharray', node.strokeDasharray);
  put('stroke-linecap', node.strokeLinecap);
  put('stroke-linejoin', node.strokeLinejoin);
  put('opacity', node.opacity != null ? num(node.opacity) : undefined);
  put('pointer-events', node.pointerEvents);
  put('role', node.role);
  put('aria-label', node.ariaLabel);
  for (const [k, v] of Object.entries(node.data ?? {})) put(`data-${k}`, v);
  return out;
}

function num(n: number): number {
  return Math.round(n * 100) / 100;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
