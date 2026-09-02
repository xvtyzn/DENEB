import { DOMAIN_CATALOG, FC_TYPES, MODIFICATION_CATALOG, VARIABLE_TYPES } from '../model/catalog';
import type {
  Construct,
  ModificationType,
  NChain,
  NDomain,
  NormalizedConstruct,
} from '../model/types';
import type { LintRule, RuleHit } from './types';

// --- shared helpers ---------------------------------------------------------

const allDomains = (c: NormalizedConstruct): NDomain[] => c.chains.flatMap((x) => x.domains);

const hasMod = (d: NDomain, ...types: ModificationType[]): boolean =>
  d.modifications.some((m) => types.includes(m.type));

const withMod = (c: NormalizedConstruct, ...types: ModificationType[]): NDomain[] =>
  allDomains(c).filter((d) => hasMod(d, ...types));

const inGroup = (c: NormalizedConstruct, group: string): NDomain[] =>
  allDomains(c).filter((d) =>
    d.modifications.some((m) => MODIFICATION_CATALOG[m.type]?.group === group),
  );

const heavyChains = (c: NormalizedConstruct): NChain[] => c.chains.filter((x) => x.kind === 'heavy');
const lightChains = (c: NormalizedConstruct): NChain[] => c.chains.filter((x) => x.kind === 'light');

const hasType = (chain: NChain, type: NDomain['type']): boolean =>
  chain.domains.some((d) => d.type === type);

/** What a chain binds and in what order — two chains matching this are the same. */
const signature = (chain: NChain): string =>
  chain.domains.map((d) => `${d.type}:${d.specificity ?? ''}`).join('-');

// --- rules ------------------------------------------------------------------

const homodimerRisk: LintRule = {
  name: 'homodimer-risk',
  level: 'warning',
  category: 'design',
  about: 'Two different heavy chains that dimerise with nothing to make them prefer each other.',
  check(c) {
    const withCh3 = heavyChains(c).filter((chain) => hasType(chain, 'CH3'));
    if (withCh3.length < 2) return [];
    if (new Set(withCh3.map(signature)).size < 2) return []; // a real homodimer
    if (inGroup(c, 'heterodimerization').length > 0) return [];
    return [
      {
        message:
          'The heavy chains differ but their CH3 domains carry no heterodimerization design, so the two homodimers will form as readily as the heterodimer.',
        hint: 'Add knob-into-hole, charge pairs, DuoBody, SEED or an equivalent CH3 interface.',
        refs: withCh3.flatMap((chain) =>
          chain.domains.filter((d) => d.type === 'CH3').map((d) => d.id),
        ),
      },
    ];
  },
};

const knobWithoutHole: LintRule = {
  name: 'knob-without-hole',
  level: 'warning',
  category: 'design',
  about: 'A knob with no hole to go into, or both on the same chain.',
  check(c) {
    const knobs = withMod(c, 'knob');
    const holes = withMod(c, 'hole');
    const hits: RuleHit[] = [];
    if (knobs.length > 0 && holes.length === 0) {
      hits.push({
        message: 'A knob is present but no hole; both chains carry the same CH3 interface.',
        hint: 'Put the matching hole (T366S/L368A/Y407V) on the partner chain.',
        refs: knobs.map((d) => d.id),
      });
    }
    if (holes.length > 0 && knobs.length === 0) {
      hits.push({
        message: 'A hole is present but no knob.',
        hint: 'Put the matching knob (T366W) on the partner chain.',
        refs: holes.map((d) => d.id),
      });
    }
    for (const knob of knobs) {
      const partner = knob.partner ? c.byId.get(knob.partner) : undefined;
      if (partner && hasMod(partner, 'knob')) {
        hits.push({
          message: 'Both halves of the CH3 dimer carry a knob.',
          hint: 'One chain takes the knob, the other the hole.',
          refs: [knob.id, partner.id],
        });
      }
    }
    return hits;
  },
};

const chargePairUnbalanced: LintRule = {
  name: 'charge-pair-unbalanced',
  level: 'warning',
  category: 'design',
  about: 'A charge pair needs both halves to work.',
  check(c) {
    const plus = withMod(c, 'charge+');
    const minus = withMod(c, 'charge-');
    if (plus.length > 0 && minus.length === 0) {
      return [
        {
          message: 'A positive charge pair is present with no negative counterpart.',
          hint: 'Charge-pair heterodimerization needs complementary mutations on both chains.',
          refs: plus.map((d) => d.id),
        },
      ];
    }
    if (minus.length > 0 && plus.length === 0) {
      return [
        {
          message: 'A negative charge pair is present with no positive counterpart.',
          hint: 'Charge-pair heterodimerization needs complementary mutations on both chains.',
          refs: minus.map((d) => d.id),
        },
      ];
    }
    return [];
  },
};

const PAIRING_FIXES: ModificationType[] = [
  'crossmab-fab',
  'crossmab-ch1cl',
  'crossmab-vhvl',
  'orthogonal-fab',
  'disulfide',
];

const lightChainMispairing: LintRule = {
  name: 'light-chain-mispairing',
  level: 'warning',
  category: 'design',
  about: 'Two distinct light chains with nothing steering each to its own heavy chain.',
  check(c) {
    const lights = lightChains(c).filter((chain) => !chain.cloneOf);
    if (lights.length < 2) return []; // one light chain, or a common one
    if (new Set(lights.map(signature)).size < 2) return [];
    if (withMod(c, ...PAIRING_FIXES).length > 0) return [];
    // A DuoBody is assembled by exchanging arms between two separately
    // expressed parentals, so each light chain never meets the other heavy
    // chain and cannot mispair.
    if (withMod(c, 'duobody').length > 0) return [];
    return [
      {
        message:
          'Two different light chains can pair with either heavy chain, so most of the product will be mispaired.',
        hint: 'Use a CrossMab, an orthogonal Fab interface, an engineered CH1–CL disulfide, or a common light chain.',
        refs: lights.flatMap((chain) => chain.domains.map((d) => d.id)),
      },
    ];
  },
};

const SILENCED: ModificationType[] = ['lala', 'lala-pg', 'aglycosyl'];

const effectorActiveEngager: LintRule = {
  name: 'effector-active-engager',
  level: 'warning',
  category: 'design',
  heuristic: true,
  about: 'A T-cell engager whose Fc can still recruit effector cells.',
  check(c) {
    const recruits = c.specificities.filter((s) => /\bcd3\b|tcr/i.test(s.name));
    if (recruits.length === 0) return [];
    const ch2 = allDomains(c).filter((d) => d.type === 'CH2');
    if (ch2.length === 0) return [];
    if (withMod(c, ...SILENCED).length > 0) return [];
    return [
      {
        message: `Targets ${recruits
          .map((s) => s.name)
          .join(', ')} through an Fc that has not been silenced.`,
        hint: 'T-cell engagers usually carry LALA, LALA-PG or an aglycosyl Fc to avoid cytokine release from FcγR engagement.',
        refs: ch2.map((d) => d.id),
      },
    ];
  },
};

const igg4FabArmExchange: LintRule = {
  name: 'igg4-fab-arm-exchange',
  level: 'warning',
  category: 'design',
  about: 'An IgG4 hinge that has not been stabilised.',
  check(c) {
    const hits: RuleHit[] = [];
    for (const chain of c.chains) {
      // A copy of a chain is the same design, and saying it twice for a
      // homodimer — four times counting the light chains — buries the point.
      if (chain.cloneOf) continue;
      const igg4 = chain.domains.filter((d) => /igg4/i.test(d.isotype ?? ''));
      if (igg4.length === 0) continue;
      if (chain.domains.some((d) => hasMod(d, 's228p'))) continue;
      hits.push({
        message: `Chain "${chain.id}" is IgG4 without hinge stabilisation, so it will exchange Fab arms in vivo.`,
        hint: 'Add S228P.',
        refs: igg4.map((d) => d.id),
      });
    }
    return hits;
  },
};

const scfvUnstabilised: LintRule = {
  name: 'scfv-unstabilised',
  level: 'info',
  category: 'design',
  about: 'A single-chain Fv without an engineered disulfide.',
  check(c) {
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    for (const domain of allDomains(c)) {
      if (!VARIABLE_TYPES.has(domain.type) || !domain.partner || seen.has(domain.id)) continue;
      const partner = c.byId.get(domain.partner);
      if (!partner || partner.chainId !== domain.chainId) continue;
      seen.add(domain.id);
      seen.add(partner.id);
      if (hasMod(domain, 'disulfide') || hasMod(partner, 'disulfide')) continue;
      hits.push({
        message: `The single-chain Fv on "${domain.chainId}" has no engineered disulfide.`,
        hint: 'A VH44–VL100 disulfide is the usual way to stop an scFv from aggregating.',
        refs: [domain.id, partner.id],
      });
    }
    return hits;
  },
};

const darOutOfRange: LintRule = {
  name: 'dar-out-of-range',
  level: 'warning',
  category: 'design',
  heuristic: true,
  about: 'A non-positive drug-to-antibody ratio or one above the built-in screening range.',
  check(c) {
    const hits: RuleHit[] = [];
    for (const domain of allDomains(c)) {
      for (const m of domain.modifications) {
        const dar = m.payload?.dar;
        if (dar == null || (dar > 0 && dar <= 8)) continue;
        const message =
          dar <= 0
            ? `DAR ${dar} on ${domain.id} must be greater than zero.`
            : `DAR ${dar} on ${domain.id} is above the built-in 0-8 screening range.`;
        hits.push({
          message,
          hint: 'Confirm the value against the conjugation chemistry, or disable this heuristic for a supported design.',
          refs: [domain.id],
        });
      }
    }
    return hits;
  },
};

const missingHinge: LintRule = {
  name: 'missing-hinge',
  level: 'info',
  category: 'design',
  about: 'A heavy chain that jumps from CH1 straight to the Fc.',
  check(c) {
    return heavyChains(c)
      .filter(
        (chain) =>
          hasType(chain, 'CH1') &&
          chain.domains.some((d) => FC_TYPES.has(d.type)) &&
          !hasType(chain, 'hinge'),
      )
      .map((chain) => ({
        message: `Chain "${chain.id}" has CH1 and an Fc but no hinge between them.`,
        hint: 'Add a hinge so the interchain disulfides and the Fab arms are drawn where they belong.',
        refs: chain.domains.filter((d) => d.type === 'CH1').map((d) => d.id),
      }));
  },
};

const unpairedVariableDomain: LintRule = {
  name: 'unpaired-variable-domain',
  level: 'warning',
  category: 'design',
  about: 'A variable domain with no partner to form a binding site with.',
  check(c) {
    return allDomains(c)
      .filter(
        (d) =>
          (d.type === 'VH' || d.type === 'VL' || d.type === 'TCRa' || d.type === 'TCRb') &&
          !d.partner,
      )
      .map((d) => ({
        message: `${d.type} ${d.id} has no partner, so it forms no paratope on its own.`,
        hint: 'Pair it with its counterpart, or say so explicitly with an @pair link.',
        refs: [d.id],
      }));
  },
};


// --- completeness -----------------------------------------------------------
//
// These are about the description rather than the molecule. A construct being
// assembled is half-finished by definition, and the useful thing to say about
// it is what has not been said yet — out loud, rather than by quietly filling
// the gap with a guess that the picture then presents as fact.

const pairable = (d: NDomain): boolean =>
  (DOMAIN_CATALOG[d.type] ?? DOMAIN_CATALOG.custom).pairs;

/** `HC(2)` and `HC` are the same chain; `HC` and `LC` are not. */
const chainFamily = (domainId: string): string =>
  domainId.slice(0, domainId.lastIndexOf(':')).replace(/\((\d+)\)$/, '');
const copyIndex = (domainId: string): string =>
  domainId.slice(0, domainId.lastIndexOf(':')).match(/\((\d+)\)$/)?.[1] ?? '1';

const unpairedConstantDomain: LintRule = {
  name: 'unpaired-constant-domain',
  level: 'info',
  category: 'completeness',
  about: 'A constant domain left with no partner.',
  check(c) {
    return allDomains(c)
      .filter((d) => pairable(d) && !VARIABLE_TYPES.has(d.type) && !d.partner)
      .map((d) => ({
        message: `${d.type} ${d.id} has no partner, so it is drawn on its own.`,
        hint: 'Add the domain it pairs with, or say which one it is with an @pair link.',
        refs: [d.id],
      }));
  },
};

const ambiguousPairing: LintRule = {
  name: 'ambiguous-pairing',
  level: 'warning',
  category: 'completeness',
  about:
    'A domain with more than one thing it could pair with. Reported only after ' +
    "`deneb/edit`'s resolvePairing has run; silent otherwise.",
  check(c) {
    return allDomains(c)
      .filter((d) => d.pairing?.state === 'ambiguous' && (d.pairing.candidates?.length ?? 0) > 0)
      .map((d) => {
        const candidates = d.pairing!.candidates!;
        return {
          message: `${d.type} ${d.id} could pair with ${candidates.join(' or ')}; nothing says which.`,
          hint: `Settle it with an explicit link, e.g. @pair ${d.id} ${candidates[0]}.`,
          refs: [d.id, ...candidates],
        };
      });
  },
};

const pairingCrossesCopies: LintRule = {
  name: 'pairing-crosses-copies',
  level: 'warning',
  category: 'completeness',
  about: 'One copy of a chain paired with a different copy of another chain.',
  check(c) {
    const hits: RuleHit[] = [];
    const seen = new Set<string>();
    // Only families that actually have several copies can be confused with one
    // another. A common light chain cloned for two *different* heavy chains is
    // not a mix-up, and neither is a chain that exists once.
    const size = new Map<string, number>();
    for (const chain of c.chains) {
      const family = chain.id.replace(/\((\d+)\)$/, '');
      size.set(family, (size.get(family) ?? 0) + 1);
    }
    const repeated = (id: string): boolean => (size.get(chainFamily(id)) ?? 1) > 1;
    for (const d of allDomains(c)) {
      if (!d.partner || seen.has(d.id)) continue;
      seen.add(d.id);
      seen.add(d.partner);
      if (chainFamily(d.id) === chainFamily(d.partner)) continue; // an Fc dimer
      if (!repeated(d.id) || !repeated(d.partner)) continue;
      if (copyIndex(d.id) === copyIndex(d.partner)) continue;
      hits.push({
        message:
          `${d.id} is paired with ${d.partner}, which belongs to a different copy of its chain. ` +
          `One arm has taken the other arm's partner.`,
        hint: 'Name the pairs you mean with @pair, one per arm.',
        refs: [d.id, d.partner],
      });
    }
    return hits;
  },
};

const lightChainCountMismatch: LintRule = {
  name: 'light-chain-count-mismatch',
  level: 'info',
  category: 'completeness',
  about: 'More Fab heavy halves than light halves, or the other way round.',
  check(c) {
    const domains = allDomains(c);
    const ch1 = domains.filter((d) => d.type === 'CH1').length;
    const cl = domains.filter((d) => d.type === 'CL').length;
    if (ch1 === cl) return [];
    return [
      {
        message: `${ch1} CH1 domain(s) but ${cl} CL domain(s); some Fab is missing a half.`,
        hint:
          ch1 > cl
            ? 'Add a light chain for the unmatched CH1, or remove it.'
            : 'Add the heavy half, or remove the spare light chain.',
        refs: domains.filter((d) => d.type === 'CH1' || d.type === 'CL').map((d) => d.id),
      },
    ];
  },
};

const conjugationUnderspecified: LintRule = {
  name: 'conjugation-underspecified',
  level: 'info',
  category: 'completeness',
  about: 'A conjugation site with fields still blank.',
  check(c) {
    const hits: RuleHit[] = [];
    for (const d of allDomains(c)) {
      for (const m of d.modifications) {
        if (!m.payload) continue;
        const missing: string[] = [];
        if (!m.payload.name) missing.push('compound');
        if (!m.payload.linker) missing.push('linker');
        if (!m.payload.site) missing.push('site');
        if (m.payload.dar == null) missing.push('DAR');
        if (missing.length === 0) continue;
        hits.push({
          message: `The conjugation on ${d.id} does not say its ${missing.join(', ')}.`,
          hint: 'Fill the fields in, or leave them out deliberately — the legend reads what is there.',
          refs: [d.id],
        });
      }
    }
    return hits;
  },
};

const conjugationHandleUnused: LintRule = {
  name: 'conjugation-handle-unused',
  level: 'info',
  category: 'completeness',
  about: 'An engineered conjugation cysteine with nothing attached anywhere.',
  check(c) {
    const domains = allDomains(c);
    if (domains.some((d) => d.modifications.some((m) => m.payload))) return [];
    // Only `thiomab`, not `tag`: a purification tag is an end in itself, while
    // an engineered cysteine exists to carry something.
    const handles = domains.filter((d) => hasMod(d, 'thiomab'));
    if (handles.length === 0) return [];
    return [
      {
        message: 'An engineered conjugation handle is present but nothing is conjugated to it.',
        hint: 'Add the payload, or drop the handle if the molecule is not a conjugate.',
        refs: handles.map((d) => d.id),
      },
    ];
  },
};

const darBelowDrawnSites: LintRule = {
  name: 'dar-below-drawn-sites',
  level: 'info',
  category: 'completeness',
  about: 'More payload copies drawn than the stated DAR allows.',
  check(c) {
    const domains = allDomains(c);
    const hits: RuleHit[] = [];
    const counted = new Set<string>();
    for (const d of domains) {
      for (const m of d.modifications) {
        const name = m.payload?.name;
        if (!name || m.payload?.dar == null || counted.has(name)) continue;
        counted.add(name);
        const drawn = domains.reduce(
          (total, x) =>
            total +
            x.modifications
              .filter((y) => y.payload?.name === name)
              .reduce((sub, y) => sub + (y.payload?.count ?? 1), 0),
          0,
        );
        if (m.payload.dar >= drawn) continue;
        hits.push({
          message: `${name} is drawn ${drawn} times but the DAR is ${m.payload.dar}.`,
          hint: 'Set `copies` on each site, or correct the DAR.',
          refs: domains
            .filter((x) => x.modifications.some((y) => y.payload?.name === name))
            .map((x) => x.id),
        });
      }
    }
    return hits;
  },
};

const domainNotDrawn: LintRule = {
  name: 'domain-not-drawn',
  level: 'info',
  category: 'completeness',
  about: 'A chain made only of connectors, which have no glyph of their own.',
  check(c) {
    return c.chains
      .filter(
        (chain) =>
          chain.domains.length > 0 &&
          chain.domains.every((d) => d.type === 'hinge' || d.type === 'linker'),
      )
      .map((chain) => ({
        message:
          `Chain "${chain.id}" holds only hinges and linkers, which are drawn as the line ` +
          `between two domains. With nothing either side, it does not appear in the picture.`,
        hint: 'Add the domains it joins.',
        refs: chain.domains.map((d) => d.id),
      }));
  },
};

const fabMacroUnderCopies: LintRule = {
  name: 'fab-macro-under-copies',
  level: 'warning',
  category: 'completeness',
  about: 'The `Fab` shorthand on a repeated chain, which yields only one light chain.',
  check(c, source) {
    if (!source) return [];
    const hits: RuleHit[] = [];
    for (const chain of source.chains ?? []) {
      if ((chain.copies ?? 1) < 2) continue;
      if (!(chain.domains ?? []).some((d) => d.type === 'Fab')) continue;
      const clones = c.chains.filter((x) => x.cloneOf === chain.id);
      hits.push({
        message:
          `Chain "${chain.id}" uses the Fab shorthand and is repeated, but the shorthand makes ` +
          `one light chain however many copies there are, so the other copies have none.`,
        hint: 'Write the Fab out as VH-CH1 and give each copy its own light chain.',
        refs: clones.flatMap((x) => x.domains.filter((d) => !d.partner).map((d) => d.id)),
      });
    }
    return hits;
  },
};

export const LINT_RULES: readonly LintRule[] = [
  homodimerRisk,
  knobWithoutHole,
  chargePairUnbalanced,
  lightChainMispairing,
  effectorActiveEngager,
  igg4FabArmExchange,
  scfvUnstabilised,
  darOutOfRange,
  missingHinge,
  unpairedVariableDomain,
  unpairedConstantDomain,
  ambiguousPairing,
  pairingCrossesCopies,
  lightChainCountMismatch,
  conjugationUnderspecified,
  conjugationHandleUnused,
  darBelowDrawnSites,
  domainNotDrawn,
  fabMacroUnderCopies,
];
