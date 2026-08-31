import type { Construct, NDomain, NormalizedConstruct } from '../model/types';
import { normalize, resolveRef } from '../model/normalize';
import { DOMAIN_CATALOG } from '../model/catalog';
import { resolveTheme, type Theme } from '../theme/theme';
import { boundsOf, cornersOf } from './geometry';
import {
  chainConnectors,
  hingeDisulfides,
  pairingConnectors,
  structuralConnectors,
} from './links';
import {
  armChains,
  lightChainsFor,
  mergeLadders,
  isLinkedPair,
  partitionHeavy,
  unitsOfList,
  type Unit,
} from './modules';
import { placeLadder, placeRow, translatePlaced } from './place';
import type { Connector, LayoutResult, PlacedDomain, Point } from './types';

export interface LayoutOptions {
  theme?: Partial<Theme>;
}

export function layout(
  input: Construct | NormalizedConstruct,
  options: LayoutOptions = {},
): LayoutResult {
  const theme = resolveTheme(options.theme);
  const construct: NormalizedConstruct =
    'byId' in input ? input : normalize(input, { theme: options.theme });

  const built =
    construct.layout.skeleton === 'row'
      ? { placed: layoutRow(construct, theme), extra: [] as Connector[] }
      : layoutY(construct, theme);

  const placed = built.placed;
  const byDomainId = new Map(placed.map((p) => [p.domain.id, p]));
  const centroid = centerOf(placed);

  const connectors: Connector[] = [...chainConnectors(construct.chains, byDomainId, centroid)];
  connectors.push(...built.extra);
  connectors.push(...hingeDisulfides(connectors));
  connectors.push(
    ...structuralConnectors(construct.links, byDomainId, (ref) =>
      resolveRef(ref, construct.chains, construct.byId),
    ),
  );
  connectors.push(...pairingConnectors(construct.chains, byDomainId));

  const points: Point[] = [];
  for (const p of placed) points.push(...cornersOf(p.center, p.width, p.height, p.rotation));
  for (const c of connectors) {
    points.push(c.a, c.b);
    if (c.via) points.push(...c.via);
  }

  return {
    construct,
    domains: placed,
    connectors,
    bbox: boundsOf(points, theme.padding),
    byDomainId,
    diagnostics: construct.diagnostics,
  };
}

/** Half-width of a glyph's footprint on the x axis, after its rotation. */
function horizontalExtent(p: PlacedDomain): number {
  const radians = (p.rotation * Math.PI) / 180;
  return (
    Math.abs((p.width / 2) * Math.cos(radians)) + Math.abs((p.height / 2) * Math.sin(radians))
  );
}

function centerOf(placed: PlacedDomain[]): Point {
  if (placed.length === 0) return { x: 0, y: 0 };
  const sum = placed.reduce((acc, p) => ({ x: acc.x + p.center.x, y: acc.y + p.center.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / placed.length, y: sum.y / placed.length };
}

interface Built {
  placed: PlacedDomain[];
  extra: Connector[];
}

/**
 * Line a branch up under the terminus it grows from.
 *
 * The strand has to leave that face and drop straight into the branch, so what
 * must sit under the anchor is the branch's own N-terminal anchor -- not the
 * centre of whichever glyph is placed first, which is half a lane to one side.
 * Aligning the centre is what made an appended scFv's linker set off sideways
 * before it turned back down.
 */
function alignBranch(
  nodes: PlacedDomain[],
  first: NDomain | undefined,
  anchor: Point,
): PlacedDomain[] {
  const head = first ? nodes.find((p) => p.domain.id === first.id) : undefined;
  if (!head) return nodes;
  return translatePlaced(nodes, anchor.x - head.nAnchor.x, 0);
}

// ---------------------------------------------------------------------------
// Y skeleton: Fc stem, Fab arms, optional C-terminal branches
// ---------------------------------------------------------------------------

function layoutY(construct: NormalizedConstruct, theme: Theme): Built {
  const heavies = armChains(construct).slice(0, 2);
  if (heavies.length === 0) return { placed: layoutRow(construct, theme), extra: [] };

  const partitions = heavies.map(partitionHeavy);
  const placed: PlacedDomain[] = [];
  const extra: Connector[] = [];

  // --- stem (Fc) ---------------------------------------------------------
  const stemUnits = mergeLadders(
    unitsOfList(partitions[0]!.fc),
    unitsOfList(partitions[1]?.fc ?? []),
  );
  const stem = placeLadder(stemUnits, {
    origin: { x: 0, y: 0 },
    dirAngle: 180,
    glyphAngle: 0,
    laneSign: 1,
    laneGap: theme.laneGap,
    slotGap: theme.slotGap,
  });
  placed.push(...stem.placed);

  const apex: Point = { x: 0, y: -theme.hingeGap };
  const crossed = construct.layout.armMode === 'crossed';

  if (crossed) {
    // Cross-paired variable domains (DART / diabody module) read best as a row
    // of upright Fv heads sitting on top of the Fc, not as two splayed arms.
    const domains = heavies.flatMap((h, s) => [
      ...partitions[s]!.nTerm,
      ...lightChainsFor(construct, h).flatMap((c) => c.domains),
    ]);
    const units = rowUnits(domains);
    const row = placeRow(units, { x: 0, y: 0 }, theme);
    const tallest = Math.max(0, ...row.placed.map((p) => p.height));
    placed.push(...translatePlaced(row.placed, -row.width / 2, apex.y - tallest / 2));
  } else {
    // A light chain that carries its own C-terminal fusion is split: the paired
    // part shares the arm ladder, and whatever hangs off its C-terminus becomes
    // a branch. Left inline it would sit between the Fab and the Fc and drag
    // the hinge across the stem.
    const lightCores: NDomain[][] = [];
    const lightTails: NDomain[][] = [];
    const armUnits = heavies.map((heavy, s) => {
      const core: NDomain[] = [];
      const tail: NDomain[] = [];
      for (const chain of lightChainsFor(construct, heavy)) {
        // The core is everything up to the last domain that pairs with the
        // heavy chain. A trailing scFv pairs with itself, which is exactly what
        // makes it a fusion rather than part of the Fab.
        const lastPaired = chain.domains.reduce((at, d, i) => {
          const partner = d.partner ? construct.byId.get(d.partner) : undefined;
          return partner && partner.chainId !== chain.id ? i : at;
        }, -1);
        core.push(...chain.domains.slice(0, lastPaired + 1));
        tail.push(...chain.domains.slice(lastPaired + 1));
      }
      lightCores[s] = core;
      lightTails[s] = tail;
      return mergeLadders(
        unitsOfList([...partitions[s]!.nTerm].reverse()),
        unitsOfList([...core].reverse()),
      );
    });
    // A single populated arm stands upright; two arms splay apart.
    const populated = armUnits.filter((u) => u.length > 0).length;
    const armAngle = populated < 2 ? 0 : construct.layout.armAngle;

    armUnits.forEach((units, s) => {
      if (units.length === 0) return;
      const dirAngle = s === 0 ? -armAngle : armAngle;
      const arm = placeLadder(units, {
        origin: apex,
        dirAngle,
        glyphAngle: dirAngle,
        laneSign: s === 0 ? 1 : -1,
        laneGap: theme.laneGap,
        slotGap: theme.slotGap,
      });
      let arms = arm.placed;
      const lane = (s === 0 ? -1 : 1) * (theme.laneGap / 2);

      // Move the arm until the domain that continues into the hinge leaves from
      // a point directly above its own Fc lane, one hinge-length up. Without
      // this the lane offset — which is perpendicular to a tilted arm, so it has
      // a vertical component — drags the hinge into a longer diagonal.
      const tail = partitions[s]!.nTerm[partitions[s]!.nTerm.length - 1];
      const tailPlaced = tail ? arms.find((p) => p.domain.id === tail.id) : undefined;
      if (tailPlaced && stemUnits.length > 0) {
        // Levelling the hinge is only safe when that domain is the base of the
        // arm. If the chain continues past it — a light chain carrying its own
        // C-terminal scFv, say — pulling it down would push that module into
        // the Fc, so only the sideways alignment applies.
        const atBase = units[0]!.members.some((d) => d.id === tail!.id);
        arms = translatePlaced(
          arms,
          lane - tailPlaced.cAnchor.x,
          atBase ? apex.y - tailPlaced.cAnchor.y : 0,
        );
      }

      // A tilted glyph reaches further sideways than its own half-width, so
      // check the real footprint and push the arm clear if the two would meet.
      if (populated === 2 && arms.length > 0) {
        const base = arms[0]!;
        const inner =
          s === 0
            ? base.center.x + horizontalExtent(base)
            : base.center.x - horizontalExtent(base);
        const slack = s === 0 ? -1 - inner : 1 - inner;
        if ((s === 0 && slack < 0) || (s === 1 && slack > 0)) {
          arms = translatePlaced(arms, slack, 0);
        }
      }
      placed.push(...arms);

      const lcTail = lightTails[s]!;
      const core = lightCores[s]!;
      const joint = core[core.length - 1];
      const jointPlaced = joint ? arms.find((p) => p.domain.id === joint.id) : undefined;
      if (lcTail.length > 0 && jointPlaced) {
        const branchAngle = 180 + (s === 0 ? 35 : -35);
        const branch = placeLadder(unitsOfList(lcTail), {
          origin: jointPlaced.cAnchor,
          dirAngle: branchAngle,
          glyphAngle: branchAngle - 180,
          laneSign: s === 0 ? -1 : 1,
          laneGap: theme.laneGap,
          slotGap: theme.slotGap,
        });
        placed.push(...alignBranch(branch.placed, lcTail[0], jointPlaced.cAnchor));
      }
    });
  }

  // --- hinge stubs when there is no Fc to descend into (F(ab')2) ---------
  const byId = new Map(placed.map((p) => [p.domain.id, p]));
  const stubTip: Point = { x: 0, y: apex.y + theme.hingeGap };
  heavies.forEach((heavy, s) => {
    const part = partitions[s]!;
    if (part.fc.length > 0 || !part.hinge) return;
    const base = part.nTerm[part.nTerm.length - 1];
    const placedBase = base ? byId.get(base.id) : undefined;
    if (!placedBase) return;
    extra.push({ kind: 'hinge', a: placedBase.cAnchor, b: stubTip, domainA: base!.id });
  });

  // --- C-terminal branches ----------------------------------------------
  const branching = partitions.filter((p) => p.cTerm.length > 0).length;
  // Two appended modules have to diverge to stay clear of each other; a single
  // one hangs straight down from its own CH3.
  const splay = branching > 1 ? 24 : 0;
  heavies.forEach((heavy, s) => {
    const part = partitions[s]!;
    if (part.cTerm.length === 0) return;
    const anchorDomain = part.fc[part.fc.length - 1];
    const anchor = anchorDomain ? byId.get(anchorDomain.id)?.cAnchor : stem.end;
    const dirAngle = 180 + (s === 0 ? splay : -splay);
    const branch = placeLadder(unitsOfList(part.cTerm), {
      origin: anchor ?? stem.end,
      dirAngle,
      glyphAngle: dirAngle - 180,
      // The half that carries the chain on from the Fc takes the inner lane, so
      // the linker drops straight down out of the CH3 instead of reaching around
      // an appended scFv to its far side. Whatever that half is paired with then
      // sits outwards, away from the other branch.
      laneSign: s === 0 ? -1 : 1,
      laneGap: theme.laneGap,
      slotGap: theme.slotGap,
    });
    // Start the branch directly under the CH3 it leaves, so the linker drops out
    // of the bottom of that domain rather than off one of its corners.
    let nodes = anchor ? alignBranch(branch.placed, part.cTerm[0], anchor) : branch.placed;

    // Only if the two branches still meet does either get pushed off the axis.
    if (branching > 1 && nodes.length > 0) {
      const edge =
        s === 0
          ? Math.max(...nodes.map((n) => n.center.x + horizontalExtent(n)))
          : Math.min(...nodes.map((n) => n.center.x - horizontalExtent(n)));
      const slack = (s === 0 ? -1 : 1) - edge;
      if ((s === 0 && slack < 0) || (s === 1 && slack > 0)) {
        nodes = translatePlaced(nodes, slack, 0);
      }
    }
    placed.push(...nodes);
  });

  // --- chains that belong to no arm (separate fusion partners) ----------
  const used = new Set(placed.map((p) => p.domain.chainId));
  const leftovers = construct.chains.filter((c) => !used.has(c.id) && c.domains.length > 0);
  if (leftovers.length > 0) {
    const right = Math.max(...placed.map((p) => p.center.x + p.width), 0);
    const units = rowUnits(leftovers.flatMap((c) => c.domains));
    const row = placeRow(units, { x: right + theme.headGap * 2, y: 0 }, theme);
    placed.push(...row.placed);
  }

  return { placed, extra };
}

// ---------------------------------------------------------------------------
// Row skeleton: fragments laid left to right, every glyph upright
// ---------------------------------------------------------------------------

function layoutRow(construct: NormalizedConstruct, theme: Theme): PlacedDomain[] {
  const units = rowUnits(construct.chains.flatMap((c) => c.domains));
  return placeRow(units, { x: 0, y: 0 }, theme).placed;
}

/**
 * Group domains into upright units, pairing partners wherever they live. This
 * is what makes a diabody's cross-paired chains come out as two Fv heads rather
 * than two disconnected strands.
 */
export function rowUnits(domains: NDomain[]): Unit[] {
  const byId = new Map(domains.map((d) => [d.id, d]));
  const consumed = new Set<string>();
  const units: Unit[] = [];
  for (const domain of domains) {
    if (domain.type === 'linker' || domain.type === 'hinge' || consumed.has(domain.id)) continue;
    consumed.add(domain.id);
    const partner = domain.partner ? byId.get(domain.partner) : undefined;
    if (partner && !consumed.has(partner.id) && DOMAIN_CATALOG[partner.type].pairs) {
      consumed.add(partner.id);
      const [a, b] = orderForRow(domain, partner);
      units.push({
        members: [a, b],
        paired: true,
        linked: isLinkedPair([a, b]),
        height: Math.max(DOMAIN_CATALOG[a.type].height, DOMAIN_CATALOG[b.type].height),
        width: DOMAIN_CATALOG[a.type].width + DOMAIN_CATALOG[b.type].width,
      });
    } else {
      units.push({
        members: [domain],
        paired: false,
        linked: false,
        height: DOMAIN_CATALOG[domain.type].height,
        width: DOMAIN_CATALOG[domain.type].width,
      });
    }
  }
  return units;
}

/** Inside a row head, the domain that comes first in its chain is drawn first. */
function orderForRow(a: NDomain, b: NDomain): [NDomain, NDomain] {
  if (a.chainId === b.chainId) return a.index <= b.index ? [a, b] : [b, a];
  return [a, b];
}
