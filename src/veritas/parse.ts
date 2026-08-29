import type { Chain, Construct, Diagnostic, Domain, DomainType, Modification } from '../model/types';
import {
  CENTERS,
  CENTER_MUTATIONS,
  CENTER_NAMES,
  MODULES,
  MODULE_NAMES,
} from './vocabulary';

export interface VeritasParseResult {
  construct: Construct;
  /** What was assumed or not understood — never thrown. */
  diagnostics: Diagnostic[];
}

export class VeritasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VeritasError';
  }
}

/** One module as written: `(HER2)scFv`. */
interface Module {
  name: string;
  target?: string;
}

/**
 * Read a VERITAS format name.
 *
 * The name is deliberately coarser than the molecule: the paper gives it no
 * notation for linker lengths, the hinge, isotype or residue numbers. What
 * comes back is the architecture with this library's defaults filled in, and
 * everything that had to be assumed is reported rather than passed off as read.
 *
 * VERITAS, Biswas et al., mAbs 15:1 (2023), doi:10.1080/19420862.2023.2207232
 */
export function parseVeritas(source: string): VeritasParseResult {
  const diagnostics: Diagnostic[] = [];
  const text = source.trim();
  if (text === '') throw new VeritasError('the name is empty.');

  const segments = splitOn(text, (c) => /[-–—]/.test(c));
  const centerAt = pickCenter(segments);
  if (centerAt < 0) return centreless(text, diagnostics);

  const center = readCenter(segments[centerAt]!)!;
  const spec = CENTERS[center.name]!;
  const slots = spec.chains.length;

  // Everything on one side of the centre is one continuous chain per slot, so
  // the segments are rejoined before the `:` pairings are read out of them.
  const before = perSlot(segments.slice(0, centerAt), slots, diagnostics);
  const after = perSlot(segments.slice(centerAt + 1), slots, diagnostics);

  const chains: Chain[] = [];
  let lights = 0;
  const addChain = (domains: Domain[]): void => {
    if (domains.length > 0) chains.push({ id: `L${++lights}`, domains });
  };
  const asChain = (group: Module[]): Domain[] =>
    group.flatMap((module) => expand(module, diagnostics, addChain));

  spec.chains.forEach((centerChain, slot) => {
    const domains: Domain[] = [];
    const nGroups = groupsOf(before[slot]!);
    const cGroups = groupsOf(after[slot]!);

    // A `:` names a noncovalent pair, and the module nearest the centre is the
    // one on this chain; the rest arrive as chains of their own.
    for (const group of nGroups.slice(0, -1)) addChain(asChain(group));
    for (const module of nGroups[nGroups.length - 1] ?? []) {
      domains.push(...expand(module, diagnostics, addChain));
    }
    // An Fd runs straight into the hinge — that is a Fab, not something linked
    // on. An scFab also ends in a constant domain, but that one is the light
    // half, so it is genuinely linked.
    const lastModule = nGroups[nGroups.length - 1]?.slice(-1)[0]?.name;
    const continuous =
      centerChain[0] === 'hinge' &&
      ['Fab', 'Fd', 'CH1', 'CL'].some((m) => m.toLowerCase() === lastModule?.toLowerCase());
    if (domains.length > 0 && !continuous) domains.push({ type: 'linker' });

    for (const type of centerChain) domains.push(withTarget(type, center.target));
    if (spec.pairedLight) addChain(spec.pairedLight.map((t) => withTarget(t, center.target)));

    if ((cGroups[0] ?? []).length > 0) {
      domains.push({ type: 'linker' });
      for (const module of cGroups[0]!) domains.push(...expand(module, diagnostics, addChain));
    }
    for (const group of cGroups.slice(1)) addChain(asChain(group));

    chains.push({ id: slots === 1 ? 'HC' : `HC${slot + 1}`, domains });
  });

  applyStrategies(chains, center.strategies, slots, diagnostics);

  if (!spec.hetero && slots > 1 && (asymmetric(before) || asymmetric(after))) {
    diagnostics.push({
      level: 'warning',
      code: 'asymmetric-homo-center',
      message: `The two chains carry different appendages, which calls for ${
        center.name === 'IgG' ? 'heteroIgG' : 'heteroFc'
      } rather than ${center.name}.`,
    });
  }

  diagnostics.push({
    level: 'info',
    code: 'veritas-defaults',
    message:
      'A VERITAS name carries no linker lengths, hinge, isotype or residue numbers; those are this library’s defaults rather than anything the name stated.',
  });

  return { construct: { name: text, chains }, diagnostics };
}

/**
 * A name with no centre — a BiTE, a diabody, a bare VHH.
 *
 * VERITAS builds names around a multimerization centre, but plenty of formats
 * have none and are still written as their modules. `[a*b]` gives one chain per
 * entry; anything else is a single chain.
 */
function centreless(text: string, diagnostics: Diagnostic[]): VeritasParseResult {
  const bracketed = /^\[([\s\S]*)\]$/.exec(text);
  const entries = bracketed ? bracketed[1]!.split('*').map((s) => s.trim()) : [text];
  const chains: Chain[] = [];
  let lights = 0;
  const addChain = (domains: Domain[]): void => {
    if (domains.length > 0) chains.push({ id: `L${++lights}`, domains });
  };
  entries.forEach((entry, i) => {
    const groups = groupsOf([entry]);
    const domains: Domain[] = [];
    groups.forEach((group, g) => {
      if (g > 0) {
        addChain(group.flatMap((m) => expand(m, diagnostics, addChain)));
        return;
      }
      for (const module of group) {
        if (domains.length > 0) domains.push({ type: 'linker' });
        domains.push(...expand(module, diagnostics, addChain));
      }
    });
    if (domains.length > 0) chains.push({ id: `C${i + 1}`, domains });
  });
  if (chains.length === 0) {
    throw new VeritasError(
      `no multimerization center and no modules found. Expected a centre from ${CENTER_NAMES.join(', ')}, or a module composition.`,
    );
  }
  diagnostics.push({
    level: 'info',
    code: 'no-center',
    message:
      'The name has no multimerization centre, so it was read as a module composition — one chain per entry.',
  });
  return { construct: { name: text, chains }, diagnostics };
}

const VARIABLE = new Set<DomainType>(['VH', 'VL', 'VHH']);

function withTarget(type: DomainType, target?: string): Domain {
  return target && VARIABLE.has(type) ? { type, specificity: target } : { type };
}

function expand(
  module: Module,
  diagnostics: Diagnostic[],
  addChain: (domains: Domain[]) => void,
): Domain[] {
  const name = canonical(module.name);
  const spec = MODULES[name];
  if (!spec) {
    diagnostics.push({
      level: 'info',
      code: 'unknown-module',
      message: `"${module.name}" is not one of the VERITAS modules; it was kept as a named domain.`,
    });
    return [
      {
        type: 'custom',
        label: module.name,
        ...(module.target ? { specificity: module.target } : {}),
      },
    ];
  }
  if (spec.partnerDomains) addChain(spec.partnerDomains.map((t) => withTarget(t, module.target)));
  const out = spec.domains.map((type) => withTarget(type, module.target));
  // `protein` is the generic module; a name of its own is worth keeping.
  if (name === 'protein' && module.name.toLowerCase() !== 'protein') out[0]!.label = module.name;
  return out;
}

function canonical(name: string): string {
  return MODULE_NAMES.find((m) => m.toLowerCase() === name.toLowerCase()) ?? name;
}

interface Center {
  name: string;
  strategies: string[];
  target?: string;
}

function readCenter(segment: string): Center | undefined {
  const match = /^(?:\(([^)]*)\))?\s*([A-Za-z0-9 ]+?)\s*(?:\(([^)]*)\))?$/.exec(segment.trim());
  if (!match) return undefined;
  const name = CENTER_NAMES.find((c) => c.toLowerCase() === match[2]!.trim().toLowerCase());
  if (!name) return undefined;
  return {
    name,
    strategies: match[3] ? match[3].split(/[,/+]/).map((s) => s.trim()).filter(Boolean) : [],
    ...(match[1] ? { target: match[1] } : {}),
  };
}

/**
 * Which segment is the centre.
 *
 * `Fab`, `CH3` and `protein` are both modules and centres, so a name like
 * `Fab-heteroFc-…` has two candidates. An unambiguous centre wins; otherwise
 * the last candidate does, since appendages are written outermost-first.
 */
function pickCenter(segments: string[]): number {
  const candidates = segments
    .map((s, i) => [i, readCenter(s)] as const)
    .filter((entry): entry is readonly [number, Center] => entry[1] !== undefined);
  if (candidates.length === 0) return -1;
  const unambiguous = candidates.filter(([, c]) => !(c.name in MODULES));
  const pool = unambiguous.length > 0 ? unambiguous : candidates;
  return pool[pool.length - 1]![0];
}

/** Split on a delimiter, ignoring anything inside brackets or parentheses. */
function splitOn(text: string, is: (c: string) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (depth === 0 && is(ch)) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * The token text each chain of the centre carries on one side.
 *
 * A bare segment applies to every chain; `[a*b]` gives one entry per chain,
 * and an empty entry means that chain carries nothing there.
 */
function perSlot(segments: string[], slots: number, diagnostics: Diagnostic[]): string[][] {
  const out: string[][] = Array.from({ length: slots }, () => []);
  for (const segment of segments) {
    const bracketed = /^\[([\s\S]*)\]$/.exec(segment);
    if (!bracketed) {
      for (const slot of out) slot.push(segment);
      continue;
    }
    const entries = splitOn(bracketed[1]!, (c) => c === '*');
    const written = bracketed[1]!.split('*').length;
    if (written !== slots) {
      diagnostics.push({
        level: 'warning',
        code: 'chain-count-mismatch',
        message: `"${segment}" describes ${written} chain(s) but the ${slots}-chain centre needs ${slots}.`,
      });
    }
    // splitOn drops empty entries, so an `[scFab*]` is read back positionally.
    const positional = bracketed[1]!.split('*').map((s) => s.trim());
    for (let i = 0; i < slots; i++) {
      const entry = positional[i];
      if (entry) out[i]!.push(entry);
    }
    void entries;
  }
  return out;
}

/** `scFv-LC:Fd` → [[scFv, LC], [Fd]] */
function groupsOf(segments: string[]): Module[][] {
  if (segments.length === 0) return [[]];
  return segments
    .join('-')
    .split(':')
    .map((group) =>
      splitOn(group, (c) => /[-–—]/.test(c)).map((token) => {
        const match = /^(?:\(([^)]*)\))?\s*([A-Za-z0-9_ -]+?)\s*$/.exec(token);
        if (!match) return { name: token };
        return match[1] ? { name: match[2]!, target: match[1] } : { name: match[2]! };
      }),
    );
}

function applyStrategies(
  chains: Chain[],
  strategies: string[],
  slots: number,
  diagnostics: Diagnostic[],
): void {
  const heavies = chains.filter((c) => c.id.startsWith('HC'));
  for (const written of strategies) {
    const pair = CENTER_MUTATIONS[written.toUpperCase().replace(/[^A-Z]/g, '')];
    if (!pair) {
      diagnostics.push({
        level: 'info',
        code: 'unknown-strategy',
        message: `"${written}" is not one of the abbreviations the paper names; it was kept as written.`,
      });
      for (const chain of heavies) markLast(chain, { type: 'custom', label: written });
      continue;
    }
    if (slots < 2) continue;
    pair.forEach((type, i) => {
      const chain = heavies[i];
      if (chain) markLast(chain, { type } as Modification);
    });
  }
}

/** Put a heterodimerization mark on the chain's last CH3. */
function markLast(chain: Chain, modification: Modification): void {
  for (let i = chain.domains.length - 1; i >= 0; i--) {
    const domain = chain.domains[i]!;
    if (domain.type !== 'CH3') continue;
    domain.modifications = [...(domain.modifications ?? []), modification];
    return;
  }
}

function asymmetric(perChain: string[][]): boolean {
  return new Set(perChain.map((s) => s.join('-'))).size > 1;
}
