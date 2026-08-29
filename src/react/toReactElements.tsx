import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';
import { attributesOf } from '../render/svg';
import type { Scene, SceneNode } from '../render/scene-types';

/** DOM attribute name -> React prop name for everything the serializer emits. */
const PROP_NAMES: Record<string, string> = {
  class: 'className',
  'font-size': 'fontSize',
  'font-family': 'fontFamily',
  'font-weight': 'fontWeight',
  'text-anchor': 'textAnchor',
  'dominant-baseline': 'dominantBaseline',
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'pointer-events': 'pointerEvents',
};

function toProps(node: SceneNode, key: number): Record<string, unknown> {
  const attrs = attributesOf(node);
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(attrs)) {
    // data-* and aria-* are passed through verbatim; React understands them.
    props[PROP_NAMES[name] ?? name] = value;
  }
  return props;
}

/**
 * Emit the same scene the string serializer produces, as React elements, so
 * event handlers and refs attach natively instead of going through
 * dangerouslySetInnerHTML.
 */
export function toReactElements(nodes: SceneNode[]): ReactElement[] {
  return nodes.map((node, i) => {
    const props = toProps(node, i);
    if (node.kind === 'group') {
      const children: ReactNode[] = [];
      if (node.title) children.push(createElement('title', { key: 'title' }, node.title));
      children.push(...toReactElements(node.children));
      return createElement('g', props, children);
    }
    if (node.kind === 'embed') {
      // The only place raw markup enters the tree, and only when the caller
      // handed us a structure depiction to draw.
      if (node.markup != null) {
        return createElement('svg', {
          ...props,
          dangerouslySetInnerHTML: { __html: node.markup },
        });
      }
      return createElement('image', props);
    }
    if (node.kind === 'text') {
      const children: ReactNode[] = [];
      if (node.title) children.push(createElement('title', { key: 'title' }, node.title));
      children.push(node.text);
      return createElement('text', props, children);
    }
    return createElement(node.kind, props);
  });
}

export interface SceneSvgProps {
  scene: Scene;
  className?: string;
  style?: React.CSSProperties;
  svgRef?: React.Ref<SVGSVGElement>;
  [key: string]: unknown;
}

/** Render a `Scene` as an `<svg>` element tree. */
export function SceneSvg({ scene, className, style, svgRef, ...rest }: SceneSvgProps): ReactElement {
  const { x, y, width, height } = scene.viewBox;
  const children: ReactNode[] = [];
  if (scene.title) children.push(createElement('title', { key: 'title' }, scene.title));
  if (scene.description) children.push(createElement('desc', { key: 'desc' }, scene.description));
  if (scene.background) {
    children.push(
      createElement('rect', {
        key: 'bg',
        x,
        y,
        width,
        height,
        fill: scene.background,
      }),
    );
  }
  children.push(createElement(Fragment, { key: 'body' }, toReactElements(scene.children)));

  return createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: `${x} ${y} ${width} ${height}`,
      width: scene.width,
      height: scene.height,
      role: 'img',
      className: ['antibody-viewer', className].filter(Boolean).join(' '),
      style,
      ref: svgRef,
      ...rest,
    },
    children,
  );
}
