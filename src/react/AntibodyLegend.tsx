import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { buildLegendScene, type LegendSceneOptions } from '../render/legend';
import { SceneSvg } from './toReactElements';
import { useConstruct, type ConstructSource } from './useConstruct';

export interface AntibodyLegendProps extends ConstructSource, LegendSceneOptions {
  className?: string;
  style?: CSSProperties;
}

/** The target / engineering legend on its own, for placing beside a diagram. */
export function AntibodyLegend(props: AntibodyLegendProps): ReactNode {
  const { construct: constructProp, dsl, className, style, ...options } = props;
  const source = useConstruct({ construct: constructProp, dsl });
  const scene = useMemo(() => buildLegendScene(source, options), [source, JSON.stringify(options)]);
  return <SceneSvg scene={scene} className={className} style={style} />;
}
