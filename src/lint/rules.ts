import { FC_TYPES, MODIFICATION_CATALOG, VARIABLE_TYPES } from '../model/catalog';
import type {
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
  about: 'An IgG4 hinge that has not been stabilised.',
  check(c) {
    const hits: RuleHit[] = [];
    for (const chain of c.chains) {
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
];
