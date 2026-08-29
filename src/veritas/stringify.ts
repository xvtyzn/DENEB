import type { Construct, NDomain, NChain, NormalizedConstruct } from '../model/types';
import { normalize } from '../model/normalize';
import { MUTATION_NAMES } from './vocabulary';

export interface VeritasNameOptions {
  /** Write `(Target)` before each module that binds one. Default true. */
  includeTargets?: boolean;
  /** Write the heterodimerization strategy after the centre. Default true. */
  includeStrategy?: boolean;
}

export interface VeritasName {
  name: string;
  /** What the name could not say about this molecule. */
  notes: string[];
}

/**
 * Name a construct in VERITAS.
 *
 * The name says what the architecture is, not what the molecule is: linker
 * lengths, hinges, isotype, conjugation and residue-level engineering have no
 * notation in the scheme, so anything of that kind that the construct carries
 * is reported in `notes` instead of being silently dropped.
 *
 * VERITAS, Biswas et al., mAbs 15:1 (2023), doi:10.1080/19420862.2023.2207232
 */
export function toVeritas(
  input: Construct | NormalizedConstruct,
  options: VeritasNameOptions = {},
): VeritasName {
  const construct = 'byId' in input ? input : normalize(input);
  const notes: string[] = [];
  const includeTargets = options.includeTargets ?? true;

  const heavies = construct.chains.filter((c) => c.kind === 'heavy');
  let centre = findCentre(construct, heavies);
  if (!centre) {
    // VERITAS builds a name around a centre. A molecule with none — a BiTE, a
    // diabody, a bare VHH — still has modules worth naming, so the chains are
    // written out and the absence is stated rather than refused.
    const written = construct.chains.map((c) => describe(c.domains, construct, includeTargets, false));
    return {
      name: written.length > 1 ? `[${written.join('*')}]` : (written[0] ?? ''),
      notes: [
        'No multimerization centre: VERITAS names formats around one, so this is the module composition rather than a centred name.',
      ],
    };
  }

  // A light chain that carries appendages of its own cannot hide inside a
  // "Fab": the paper expands such an arm to `…-LC:Fd-…` and drops back to an
  // Fc centre, because otherwise the name would claim a plain IgG.
  const isIgGCentre = centre.name.endsWith('IgG');
  const dressed = isIgGCentre
    ? centre.chains.map((chain) => appendedLight(chain, construct) !== undefined)
    : centre.chains.map(() => false);
  // The paper writes a bispecific's targets on its Fabs — `[(A)Fab*(B)Fab]–
  // heteroFc` — which means stepping out of the IgG centre, since an IgG has
  // nowhere to put them.
  const armTargets = centre.chains.map((chain) => fabTarget(chain, construct));
  const targetsDiffer = includeTargets && new Set(armTargets).size > 1;
  const expand = isIgGCentre && (dressed.some(Boolean) || targetsDiffer);
  if (expand) {
    // Two arms that bind different targets are a heterodimer whatever else
    // distinguishes them, so the centre is named as one.
    const hetero = centre.name === 'heteroIgG' || targetsDiffer;
    centre = {
      ...centre,
      name: hetero ? 'heteroFc' : 'Fc',
      spanOf: (chain) => {
        const at = chain.domains.findIndex((d) => d.type === 'hinge' || d.type === 'CH2');
        const last = chain.domains.map((d) => d.type).lastIndexOf('CH3');
        return [at < 0 ? 0 : at, last + 1];
      },
    };
  }

  const arms = centre.chains.map((chain, slot) => {
    const [from, to] = centre.spanOf(chain);
    const split = expand && dressed[slot] === true;
    const heavy = describe(chain.domains.slice(0, from), construct, includeTargets, split);
    const light = split ? lightChainOf(chain, construct) : undefined;
    return {
      n: light ? `${describeLight(light, construct, includeTargets)}:${heavy}` : heavy,
      c: describe(chain.domains.slice(to), construct, includeTargets, false),
    };
  });

  // The paper's tie-break: more appendages first, then more at the N terminus,
  // then more at the C terminus, then alphabetical from the N terminus.
  const order = arms
    .map((arm, i) => ({ arm, i }))
    .sort((a, b) => {
      const total = (x: typeof a) => (x.arm.n ? 1 : 0) + (x.arm.c ? 1 : 0);
      return (
        total(b) - total(a) ||
        (b.arm.n ? 1 : 0) - (a.arm.n ? 1 : 0) ||
        (b.arm.c ? 1 : 0) - (a.arm.c ? 1 : 0) ||
        `${a.arm.n}${a.arm.c}`.localeCompare(`${b.arm.n}${b.arm.c}`)
      );
    })
    .map((x) => x.arm);

  const symmetric =
    new Set(order.map((a) => a.n)).size === 1 && new Set(order.map((a) => a.c)).size === 1;

  let name = centre.name;
  if (options.includeStrategy !== false) {
    const strategy = strategyOf(centre.chains);
    if (strategy) name += `(${strategy})`;
  }

  const nBlock = symmetric ? order[0]!.n : block(order.map((a) => a.n));
  const cBlock = symmetric ? order[0]!.c : block(order.map((a) => a.c));
  if (nBlock) name = `${nBlock}-${name}`;
  if (cBlock) name = `${name}-${cBlock}`;

  const strategy = new Set(MUTATION_NAMES.flatMap(([a, b]) => [a, b]));
  const unnamed = new Set(
    construct.chains.flatMap((c) =>
      c.domains.flatMap((d) => d.modifications.map((m) => m.type).filter((t) => !strategy.has(t))),
    ),
  );
  if (unnamed.size > 0) {
    notes.push(
      `VERITAS names architecture, not residue-level engineering: ${[...unnamed].join(', ')} ${unnamed.size === 1 ? 'is' : 'are'} not in the name.`,
    );
  }
  if (construct.chains.some((c) => c.domains.some((d) => d.type === 'hinge'))) {
    notes.push('VERITAS has no notation for the hinge or the isotype.');
  }
  if (construct.chains.some((c) => c.domains.some((d) => d.type === 'linker'))) {
    notes.push('Linker composition and length are not part of a VERITAS name.');
  }

  return { name, notes: [...new Set(notes)] };
}

interface Centre {
  name: string;
  chains: NChain[];
  /** Index range [start, end) of the centre's own domains within a chain. */
  spanOf(chain: NChain): [number, number];
}

function findCentre(construct: NormalizedConstruct, heavies: NChain[]): Centre | undefined {
  const fcChains = heavies.filter((c) => c.domains.some((d) => d.type === 'CH3'));
  if (fcChains.length >= 2) {
    const span = (chain: NChain): [number, number] => {
      const domains = chain.domains;
      const first = domains.findIndex((d) => d.type === 'hinge' || d.type === 'CH2');
      const last = domains.map((d) => d.type).lastIndexOf('CH3');
      // An IgG centre reaches back over the Fab that belongs to it.
      const fab = igGStart(domains, first);
      return [fab ?? (first < 0 ? 0 : first), last + 1];
    };
    // Every arm must end in a Fab that has its light chain present. A CrossMab
    // arm carries CL where CH1 would be, so the test is on the shape, not the
    // domain name.
    const isIgG =
      fcChains.every(
        (c) => igGStart(c.domains, c.domains.findIndex((d) => d.type === 'hinge')) != null,
      ) && construct.chains.filter((c) => c.kind === 'light').length >= fcChains.length;
    const hetero = differ(fcChains, span);
    const base = isIgG ? 'IgG' : 'Fc';
    return { name: hetero ? `hetero${base}` : base, chains: fcChains, spanOf: span };
  }

  const ch3Only = heavies.filter(
    (c) => c.domains.some((d) => d.type === 'CH3') && !c.domains.some((d) => d.type === 'CH2'),
  );
  if (ch3Only.length >= 2) {
    const span = (chain: NChain): [number, number] => {
      const at = chain.domains.map((d) => d.type).lastIndexOf('CH3');
      return [at, at + 1];
    };
    return { name: 'CH3', chains: ch3Only, spanOf: span };
  }

  const fab = heavies.find((c) => c.domains.some((d) => d.type === 'CH1'));
  if (fab) {
    const span = (chain: NChain): [number, number] => {
      const at = chain.domains.map((d) => d.type).lastIndexOf('CH1');
      return [at - 1, at + 1];
    };
    return { name: 'Fab', chains: [fab], spanOf: span };
  }
  return undefined;
}

/** Where the Fab that belongs to an IgG centre starts, if there is one. */
function igGStart(domains: NDomain[], hingeAt: number): number | undefined {
  if (hingeAt < 2) return undefined;
  const [vh, ch1] = [domains[hingeAt - 2], domains[hingeAt - 1]];
  const variable = vh?.type === 'VH' || vh?.type === 'VL';
  const constant = ch1?.type === 'CH1' || ch1?.type === 'CL';
  return variable && constant ? hingeAt - 2 : undefined;
}

function differ(chains: NChain[], span: (c: NChain) => [number, number]): boolean {
  const shape = chains.map((c) => {
    const [from, to] = span(c);
    return [
      c.domains.slice(0, from).map((d) => d.type).join(),
      c.domains.slice(to).map((d) => d.type).join(),
      c.domains
        .slice(from, to)
        .flatMap((d) => d.modifications.map((m) => m.type))
        .sort()
        .join(),
    ].join('|');
  });
  return new Set(shape).size > 1;
}

/** `[a*b]`, with an empty position for a chain that carries nothing. */
function block(entries: string[]): string {
  return entries.every((e) => e === '') ? '' : `[${entries.join('*')}]`;
}

function strategyOf(chains: NChain[]): string | undefined {
  const types = new Set(
    chains.flatMap((c) => c.domains.flatMap((d) => d.modifications.map((m) => m.type))),
  );
  for (const [a, b, name] of MUTATION_NAMES) {
    if (types.has(a) && types.has(b)) return name;
  }
  return undefined;
}

/**
 * Read a run of domains back as VERITAS modules.
 *
 * The runs are matched longest-first so a `VH-linker-VL` becomes one `scFv`
 * rather than two variable domains, which is the whole point of the notation.
 */
/** The light chain paired to this arm, when it carries more than its own VL–CL. */
function appendedLight(chain: NChain, construct: NormalizedConstruct): NChain | undefined {
  const light = lightChainOf(chain, construct);
  if (!light) return undefined;
  // A plain light chain is exactly a variable and a constant domain; anything
  // more is an appendage the name has to show.
  return light.domains.filter((d) => d.type !== 'linker').length > 2 ? light : undefined;
}

/** What the Fab of this arm binds, if the arm has one. */
function fabTarget(chain: NChain, construct: NormalizedConstruct): string {
  void construct;
  const hinge = chain.domains.findIndex((d) => d.type === 'hinge' || d.type === 'CH2');
  const at = igGStart(chain.domains, hinge);
  return at == null ? '' : (chain.domains[at]!.specificity ?? '');
}

function lightChainOf(chain: NChain, construct: NormalizedConstruct): NChain | undefined {
  for (const domain of chain.domains) {
    const partner = domain.partner ? construct.byId.get(domain.partner) : undefined;
    if (!partner) continue;
    const owner = construct.chains.find((c) => c.id === partner.chainId);
    if (owner && owner.kind === 'light') return owner;
  }
  return undefined;
}

/** `scFv-LC`, `LC-scFv` — the light chain written as a module of its own. */
function describeLight(
  chain: NChain,
  construct: NormalizedConstruct,
  includeTargets: boolean,
): string {
  const types = chain.domains.map((d) => d.type);
  const end = Math.max(types.lastIndexOf('CL'), types.lastIndexOf('CH1'));
  const at = end - 1;
  if (end < 1 || !(types[at] === 'VL' || types[at] === 'VH')) {
    return describe(chain.domains, construct, includeTargets, true);
  }
  const target = includeTargets && chain.domains[at]!.specificity ? `(${chain.domains[at]!.specificity})` : '';
  return [
    describe(chain.domains.slice(0, at), construct, includeTargets, true),
    `${target}LC`,
    describe(chain.domains.slice(end + 1), construct, includeTargets, true),
  ]
    .filter(Boolean)
    .join('-');
}

function describe(
  domains: NDomain[],
  construct: NormalizedConstruct,
  includeTargets: boolean,
  splitFab: boolean,
): string {
  const parts: string[] = [];
  let i = 0;
  const type = (n: number) => domains[i + n]?.type;
  const paired = (n: number) => {
    const partner = domains[i + n]?.partner;
    return partner ? construct.byId.get(partner) : undefined;
  };

  while (i < domains.length) {
    const target = (n: number) => {
      const value = domains[i + n]?.specificity;
      return includeTargets && value ? `(${value})` : '';
    };
    if (type(0) === 'linker' || type(0) === 'hinge') {
      i += 1;
      continue;
    }
    const variable = (n: number) => type(n) === 'VH' || type(n) === 'VL';
    const constant = (n: number) => type(n) === 'CH1' || type(n) === 'CL';
    // An Fv is one heavy and one light variable domain. Two of a kind — the
    // tandem VH of a DVD-Ig — is not an scFv and must not be named as one.
    const complementary = (a: number, b: number) => variable(a) && variable(b) && type(a) !== type(b);
    if (complementary(0, 3) && constant(1) && type(2) === 'linker' && constant(4)) {
      parts.push(`${target(0)}scFab`);
      i += 5;
      continue;
    }
    if (complementary(0, 2) && type(1) === 'linker') {
      parts.push(`${target(0)}scFv`);
      i += 3;
      continue;
    }
    if (variable(0) && constant(1)) {
      // An Fd whose light chain is present is a whole Fab — unless that light
      // chain is being written separately, which is what `splitFab` means.
      const whole = !splitFab && paired(0) && paired(1);
      parts.push(`${target(0)}${whole ? 'Fab' : 'Fd'}`);
      i += 2;
      continue;
    }
    if (type(0) === 'VHH') {
      parts.push(`${target(0)}VHH`);
      i += 1;
      continue;
    }
    const domain = domains[i]!;
    parts.push(`${target(0)}${domain.type === 'custom' ? domain.label ?? 'protein' : domain.type}`);
    i += 1;
  }
  return parts.join('-');
}
