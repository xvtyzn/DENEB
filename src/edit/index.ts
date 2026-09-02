/**
 * Editing an antibody format, one held edit at a time.
 *
 * The viewer infers a great deal — which domains pair, which light chain
 * belongs to which arm — and that inference is what makes the notation short.
 * It is also what makes the notation hard to edit: a guess that was right
 * before an edit can be wrong after it, and nothing says so. The picture just
 * changes.
 *
 * This module takes the other position. `expandForEditing` makes every
 * shorthand concrete so an edit has something to hold on to; `applyEdit` adds
 * exactly what was asked for and nothing else; `resolvePairing` decides only
 * what the construct actually determines and reports the rest. What is missing
 * is then `deneb/lint`'s to say — out loud, next to the drawing, rather than
 * silently in the geometry.
 */
export { expandForEditing } from './expand';
export {
  applyEdit,
  INSERTABLE_TYPES,
  type Edit,
  type EditResult,
  type InsertPoint,
} from './ops';
export { editTargets, type EditTarget, type TargetOptions } from './targets';
export {
  resolvePairing,
  type PairingReport,
  type PairingSuggestion,
} from './pairing';
export { insertionAnchors, type InsertionAnchor } from './anchors';
