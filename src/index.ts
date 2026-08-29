export type {
  Chain,
  ChainKind,
  Construct,
  Diagnostic,
  DiagnosticLevel,
  Domain,
  DomainRef,
  DomainType,
  LayoutHints,
  Link,
  LinkType,
  MarkerShape,
  Modification,
  ModificationType,
  NChain,
  NDomain,
  NormalizedConstruct,
  Payload,
  PayloadShape,
  PayloadStructure,
  Region,
  SkeletonKind,
  SpecificityDecl,
} from './model/types';

export {
  DOMAIN_CATALOG,
  MODIFICATION_CATALOG,
  MODIFICATION_ALIASES,
  type DomainSpec,
  type ModificationSpec,
} from './model/catalog';

export { normalize, resolveRef, type NormalizeOptions } from './model/normalize';

export { parseDSL, DslError } from './dsl/parse';
export { stringifyDSL } from './dsl/stringify';
export { tokenize, type Token } from './dsl/tokenize';

export { layout, type LayoutOptions } from './layout/skeleton';
export type {
  Connector,
  ConnectorKind,
  LayoutResult,
  PlacedDomain,
  Point,
  Rect,
} from './layout/types';

export {
  buildScene,
  resolveHighlight,
  type SceneOptions,
  type BuiltScene,
  type StructureMode,
} from './render/scene';
export { renderSVG, toSVGString, attributesOf, type RenderResult } from './render/svg';
export { renderLinear, type LinearOptions } from './render/linear';
export {
  buildLegend,
  buildLegendScene,
  type LegendOptions,
  renderLegend,
  collectModifications,
  type LegendSceneOptions,
} from './render/legend';
export {
  attachmentLabel,
  decorate,
  resolveModification,
  structureNode,
  STRUCTURE_SIZE,
  type ResolvedModification,
} from './render/markers';
export type {
  CircleNode,
  EmbedNode,
  GroupNode,
  LineNode,
  NodeStyle,
  PathNode,
  RectNode,
  Scene,
  SceneNode,
  TextNode,
} from './render/scene-types';

export {
  defaultTheme,
  resolveTheme,
  tint,
  shade,
  DEFAULT_PALETTE,
  type Theme,
} from './theme/theme';
export {
  createColorResolver,
  assignSpecificityColors,
  type ColorMode,
  type ColorResolver,
} from './theme/palette';

// Presets are NOT re-exported here on purpose. They are ~7 kB of format
// definitions that a page embedding the viewer has no reason to carry; import
// them from "deneb/presets" when you want them.

export { svgToPngDataUrl, downloadSVG, downloadPNG } from './export/png';
