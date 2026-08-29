import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { buildScene, type SceneOptions } from '../render/scene';
import { toSVGString } from '../render/svg';
import type { LayoutResult } from '../layout/types';
import { SceneSvg } from './toReactElements';
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
    ...sceneOptions
  } = props;

  const source = useConstruct({ construct: constructProp, dsl });
  const wrapper = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ info: DomainEventInfo; x: number; y: number } | null>(
    null,
  );

  const { scene, layout } = useMemo(
    () => buildScene(source, sceneOptions),
    [source, JSON.stringify(sceneOptions)],
  );
  const renderedSvg = useMemo(() => toSVGString(scene), [scene]);

  useEffect(() => {
    if (onRender) onRender(renderedSvg, layout);
  }, [renderedSvg, layout, onRender]);

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
    },
    [layout, onDomainClick, onModificationClick],
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
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
      />
      {tooltipNode ? (
        <div style={{ ...TOOLTIP_STYLE, left: tooltip!.x, top: tooltip!.y }}>{tooltipNode}</div>
      ) : null}
    </div>
  );
}
