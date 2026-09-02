import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from 'react';
import { buildScene, type SceneOptions } from '../render/scene';
import { toSVGString } from '../render/svg';
import type { LayoutResult } from '../layout/types';
import { SceneSvg } from './toReactElements';
import type { Point } from '../layout/types';
import type { DomainRef } from '../model/types';
import { useConstruct, type ConstructSource } from './useConstruct';
import {
  domainFromEvent,
  modificationFromEvent,
  type DomainEventInfo,
  type ModificationEventInfo,
} from './events';

export interface AntibodyViewerProps extends ConstructSource, SceneOptions {
  className?: string;
  style?: CSSProperties;
  onDomainClick?: (info: DomainEventInfo, event: React.MouseEvent) => void;
  /** Called with the domain under the pointer, and with `null` on leave. */
  onDomainHover?: (info: DomainEventInfo | null, event: React.MouseEvent) => void;
  onModificationClick?: (info: ModificationEventInfo, event: React.MouseEvent) => void;
  /** Custom tooltip content. Returning `null` suppresses the tooltip. */
  renderTooltip?: (info: DomainEventInfo) => ReactNode;
  /** Receives the SVG string for the current render, e.g. for export buttons. */
  onRender?: (svg: string, layout: LayoutResult) => void;
  /**
   * Domains to ring, on top of anything `highlight` already names. Kept
   * separate so an editor's selection and a lint result can be shown at once
   * without either overwriting the other.
   */
  selection?: DomainRef[];
  /** Called with the clicked domain's id, or `null` for a click on the ground. */
  onSelectionChange?: (ref: DomainRef | null, event: React.MouseEvent) => void;
  /**
   * The `<svg>` itself, for measuring, exporting, or attaching a listener this
   * component does not offer.
   */
  svgRef?: Ref<SVGSVGElement>;
  onContextMenu?: (event: React.MouseEvent) => void;
  onPointerDown?: (event: React.PointerEvent) => void;
  tabIndex?: number;
  /**
   * What the molecule is translated by inside the viewBox. Handed over on every
   * render so an overlay — insertion handles, say — can put layout coordinates
   * in the right place.
   */
  onTransform?: (transform: Point) => void;
}

const TOOLTIP_STYLE: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'none',
  zIndex: 10,
  background: 'rgba(20,24,31,0.94)',
  color: '#fff',
  padding: '4px 8px',
  borderRadius: 5,
  fontSize: 11,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  transform: 'translate(-50%, calc(-100% - 8px))',
};

/**
 * Cartoon view of an antibody format.
 *
 * The drawing is emitted as real React elements, so pointer events reach the
 * `<g data-domain-id>` groups directly and no HTML is injected.
 */
export function AntibodyViewer(props: AntibodyViewerProps): ReactNode {
  const {
    construct: constructProp,
    dsl,
    className,
    style,
    onDomainClick,
    onDomainHover,
    onModificationClick,
    renderTooltip,
    onRender,
    selection,
    onSelectionChange,
    svgRef,
    onContextMenu,
    onPointerDown,
    tabIndex,
    onTransform,
    ...sceneOptions
  } = props;

  const source = useConstruct({ construct: constructProp, dsl });
  const wrapper = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ info: DomainEventInfo; x: number; y: number } | null>(
    null,
  );

  // The selection rides on `highlight`, which already speaks this vocabulary.
  const options: SceneOptions = useMemo(
    () =>
      selection && selection.length > 0
        ? { ...sceneOptions, highlight: [...(sceneOptions.highlight ?? []), ...selection] }
        : sceneOptions,
    [JSON.stringify(sceneOptions), JSON.stringify(selection)],
  );

  const { scene, layout, transform } = useMemo(
    () => buildScene(source, options),
    [source, JSON.stringify(options)],
  );
  const renderedSvg = useMemo(() => toSVGString(scene), [scene]);

  useEffect(() => {
    if (onRender) onRender(renderedSvg, layout);
  }, [renderedSvg, layout, onRender]);

  useEffect(() => {
    if (onTransform) onTransform(transform);
  }, [transform.x, transform.y, onTransform]);

  const handleMove = useCallback(
    (event: React.MouseEvent) => {
      const info = domainFromEvent(event.target, layout.construct);
      if (onDomainHover) onDomainHover(info, event);
      if (!renderTooltip) return;
      if (!info) {
        setTooltip(null);
        return;
      }
      const box = wrapper.current?.getBoundingClientRect();
      setTooltip({
        info,
        x: event.clientX - (box?.left ?? 0),
        y: event.clientY - (box?.top ?? 0),
      });
    },
    [layout, onDomainHover, renderTooltip],
  );

  const handleLeave = useCallback(
    (event: React.MouseEvent) => {
      setTooltip(null);
      if (onDomainHover) onDomainHover(null, event);
    },
    [onDomainHover],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const mod = modificationFromEvent(event.target, layout.construct);
      if (mod && onModificationClick) onModificationClick(mod, event);
      const info = domainFromEvent(event.target, layout.construct);
      if (info && onDomainClick) onDomainClick(info, event);
      if (onSelectionChange) onSelectionChange(info?.domain.id ?? null, event);
    },
    [layout, onDomainClick, onModificationClick, onSelectionChange],
  );

  const tooltipNode = tooltip && renderTooltip ? renderTooltip(tooltip.info) : null;

  return (
    <div
      ref={wrapper}
      className={className}
      style={{ position: 'relative', display: 'inline-block', ...style }}
    >
      <SceneSvg
        scene={scene}
        svgRef={svgRef}
        tabIndex={tabIndex}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
      />
      {tooltipNode ? (
        <div style={{ ...TOOLTIP_STYLE, left: tooltip!.x, top: tooltip!.y }}>{tooltipNode}</div>
      ) : null}
    </div>
  );
}
