import { useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import { renderLinear, type LinearOptions } from '../render/linear';
import { SceneSvg } from './toReactElements';
import { useConstruct, type ConstructSource } from './useConstruct';
import { domainFromEvent, type DomainEventInfo } from './events';

export interface AntibodyLinearProps extends ConstructSource, LinearOptions {
  className?: string;
  style?: CSSProperties;
  onDomainClick?: (info: DomainEventInfo, event: React.MouseEvent) => void;
  onDomainHover?: (info: DomainEventInfo | null, event: React.MouseEvent) => void;
}

/** Domain-architecture track view, drawn to residue scale where ranges exist. */
export function AntibodyLinear(props: AntibodyLinearProps): ReactNode {
  const {
    construct: constructProp,
    dsl,
    className,
    style,
    onDomainClick,
    onDomainHover,
    ...options
  } = props;

  const source = useConstruct({ construct: constructProp, dsl });
  const { scene, construct } = useMemo(
    () => renderLinear(source, options),
    [source, JSON.stringify(options)],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const info = domainFromEvent(event.target, construct);
      if (info && onDomainClick) onDomainClick(info, event);
    },
    [construct, onDomainClick],
  );

  const handleMove = useCallback(
    (event: React.MouseEvent) => {
      if (onDomainHover) onDomainHover(domainFromEvent(event.target, construct), event);
    },
    [construct, onDomainHover],
  );

  const handleLeave = useCallback(
    (event: React.MouseEvent) => {
      if (onDomainHover) onDomainHover(null, event);
    },
    [onDomainHover],
  );

  return (
    <SceneSvg
      scene={scene}
      className={className}
      style={style}
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    />
  );
}
