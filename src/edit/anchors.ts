import type { LayoutResult, Point } from '../layout/types';
import type { DomainRef } from '../model/types';
import type { InsertPoint } from './ops';

export interface InsertionAnchor {
  at: InsertPoint;
  /** Where to draw the handle, in the layout's world coordinates. */
  point: Point;
  /** The domains either side of the gap; `null` at a chain terminus. */
  between: [DomainRef | null, DomainRef | null];
}

const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Every place a domain could be inserted, with somewhere to put the handle.
 *
 * Derived from the placed glyphs rather than computed inside the layout, so the
 * drawing engine carries none of this and a viewer that never edits pays
 * nothing for it. Hinges and linkers have no glyph of their own, so a gap next
 * to one is anchored on the nearest domain that does.
 *
 * The coordinates are the layout's, not the SVG's — add `BuiltScene.transform`
 * to put them in the viewBox.
 */
export function insertionAnchors(layout: LayoutResult): InsertionAnchor[] {
  const out: InsertionAnchor[] = [];

  for (const chain of layout.construct.chains) {
    const placed = chain.domains.map((d) => layout.byDomainId.get(d.id) ?? null);
    if (placed.every((p) => p === null)) continue;

    for (let i = 0; i <= chain.domains.length; i++) {
      let before: number | null = null;
      for (let j = i - 1; j >= 0; j--) if (placed[j]) { before = j; break; }
      let after: number | null = null;
      for (let j = i; j < placed.length; j++) if (placed[j]) { after = j; break; }
      if (before === null && after === null) continue;

      const b = before === null ? null : placed[before]!;
      const a = after === null ? null : placed[after]!;
      const point = b && a ? mid(b.cAnchor, a.nAnchor) : b ? b.cAnchor : a!.nAnchor;

      out.push({
        at: { chain: chain.id, index: i },
        point,
        between: [
          i > 0 ? (chain.domains[i - 1]!.id ?? null) : null,
          i < chain.domains.length ? (chain.domains[i]!.id ?? null) : null,
        ],
      });
    }
  }

  return out;
}
