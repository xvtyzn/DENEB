import type {
  Chain,
  Construct,
  Domain,
  DomainType,
  Link,
  Modification,
  Payload,
  PayloadShape,
  SpecificityDecl,
} from '../model/types';
import { MODIFICATION_ALIASES, MODIFICATION_CATALOG } from '../model/catalog';
import { DslError, tokenize, type Token } from './tokenize';

/** Case-insensitive DSL name -> domain type. */
const DOMAIN_ALIASES: Record<string, DomainType> = {
  vh: 'VH',
  vl: 'VL',
  vhh: 'VHH',
  nb: 'VHH',
  sdab: 'VHH',
  dab: 'VHH',
  ch1: 'CH1',
  cl: 'CL',
  ch2: 'CH2',
  ch3: 'CH3',
  ch4: 'CH4',
  h: 'hinge',
  hinge: 'hinge',
  l: 'linker',
  linker: 'linker',
  gs: 'linker',
  scfv: 'scFv',
  fab: 'Fab',
  tcra: 'TCRa',
  tcrb: 'TCRb',
  albumin: 'albumin',
  hsa: 'albumin',
  cytokine: 'cytokine',
  toxin: 'toxin',
  payload: 'payload',
  ecd: 'ECD',
};

/** Names that stand for more than one domain. */
const DOMAIN_MACROS: Record<string, DomainType[]> = {
  fc: ['CH2', 'CH3'],
};

export interface ParseResult {
  construct: Construct;
}

/**
 * Parse the compact chain notation.
 *
 * ```
 * @name  1+1 CrossMab
 * HC1: VH(CD3)-CH1-h-CH2-CH3[knob, lala]
 * LC1: VL(CD3)-CL
 * HC2: VH(HER2)-CL-h-CH2-CH3[hole, lala]
 * LC2: VH(HER2)-CH1
 * ```
 *
 * `-` concatenates domains, `~` inserts a flexible linker, `(...)` names the
 * target the domain binds, `[...]` lists engineering modifications and a
 * trailing `*n` repeats the chain (symmetric homodimers). Lines may also be
 * separated by `;` so the whole thing fits in one string.
 */
export function parseDSL(source: string): Construct {
  const chains: Chain[] = [];
  const specificities: SpecificityDecl[] = [];
  const links: Link[] = [];
  const isotypes: Array<{ chain: string; isotype: string; line: number }> = [];
  const construct: Construct = { chains };

  const rawLines = source
    .split(/[\n;]/)
    // `#` starts a comment only at a word boundary, so `@color A=#1f77b4` survives.
    .map((l) => l.replace(/(^|\s)#.*$/, '$1').trim())
    .map((l, index) => ({ text: l, no: index + 1 }))
    .filter((l) => l.text.length > 0);

  let auto = 0;
  for (const { text, no } of rawLines) {
    if (text.startsWith('@')) {
      applyDirective(text.slice(1), construct, specificities, links, isotypes, no);
      continue;
    }
    const colon = splitChainLabel(text);
    const label = colon.label ?? defaultChainId(auto);
    auto++;
    chains.push(parseChain(label, colon.body, no));
  }

  if (specificities.length > 0) construct.specificities = specificities;
  if (links.length > 0) construct.links = links;
  // Applied after every line has been read, so the directive may come before or
  // after the chain it names.
  for (const { chain: id, isotype, line } of isotypes) {
    const chain = chains.find((c) => c.id === id);
    if (!chain) throw new DslError(`@isotype names no chain "${id}"`, line, 0);
    for (const domain of chain.domains) domain.isotype = isotype;
  }
  return construct;
}

function defaultChainId(index: number): string {
  return `C${index + 1}`;
}

/** `HC1: ...` — but not the `:` inside a group, which never reaches here. */
function splitChainLabel(text: string): { label: string | null; body: string } {
  const m = /^([A-Za-z_][A-Za-z0-9_\-()]*)\s*:\s*(.*)$/.exec(text);
  if (!m || !m[1] || m[2] === undefined) return { label: null, body: text };
  return { label: m[1], body: m[2] };
}

function applyDirective(
  text: string,
  construct: Construct,
  specificities: SpecificityDecl[],
  links: Link[],
  isotypes: Array<{ chain: string; isotype: string; line: number }>,
  lineNo: number,
): void {
  const m = /^(\w+)\s*(.*)$/.exec(text.trim());
  if (!m || !m[1]) throw new DslError(`malformed directive "@${text}"`, lineNo, 0);
  const key = m[1].toLowerCase();
  const rest = (m[2] ?? '').trim();
  switch (key) {
    case 'name':
      construct.name = rest;
      break;
    case 'skeleton':
      if (rest !== 'y' && rest !== 'row') {
        throw new DslError(`@skeleton expects "y" or "row", got "${rest}"`, lineNo, 0);
      }
      construct.layout = { ...construct.layout, skeleton: rest };
      break;
    case 'arm': {
      const angle = Number(rest);
      if (!Number.isFinite(angle)) throw new DslError(`@arm expects a number`, lineNo, 0);
      construct.layout = { ...construct.layout, armAngle: angle };
      break;
    }
    case 'armmode':
      if (rest !== 'splayed' && rest !== 'crossed') {
        throw new DslError(`@armmode expects "splayed" or "crossed"`, lineNo, 0);
      }
      construct.layout = { ...construct.layout, armMode: rest };
      break;
    case 'pair':
    case 'ss': {
      const refs = rest.split(/\s+/).filter(Boolean);
      if (refs.length !== 2 || !refs[0] || !refs[1]) {
        throw new DslError(`@${key} expects two domain references`, lineNo, 0);
      }
      links.push({ type: key === 'pair' ? 'pair' : 'disulfide', a: refs[0], b: refs[1] });
      break;
    }
    case 'isotype': {
      // A chain-level fact the model keeps on its domains, which is what the
      // lint rules and the diff read.
      const eq = rest.indexOf('=');
      if (eq < 0) throw new DslError(`@isotype expects CHAIN=IgG1`, lineNo, 0);
      isotypes.push({
        chain: rest.slice(0, eq).trim(),
        isotype: rest.slice(eq + 1).trim(),
        line: lineNo,
      });
      break;
    }
    case 'color': {
      const eq = rest.indexOf('=');
      if (eq < 0) throw new DslError(`@color expects NAME=#rrggbb`, lineNo, 0);
      specificities.push({ name: rest.slice(0, eq).trim(), color: rest.slice(eq + 1).trim() });
      break;
    }
    default:
      throw new DslError(`unknown directive "@${key}"`, lineNo, 0);
  }
}

function parseChain(id: string, body: string, lineNo: number): Chain {
  const tokens = tokenize(body, lineNo);
  const domains: Domain[] = [];
  let copies: number | undefined;
  let i = 0;

  const peek = (): Token => tokens[i]!;

  const readDomain = (): void => {
    const t = peek();
    if (t.kind !== 'name') {
      throw new DslError(`expected a domain name, got "${t.value || 'end of line'}"`, lineNo, t.pos);
    }
    i++;
    const key = t.value.toLowerCase();
    let specificity: string | undefined;
    let modifications: Modification[] | undefined;
    if (peek().kind === 'group') {
      specificity = peek().value || undefined;
      i++;
    }
    if (peek().kind === 'mods') {
      modifications = parseModifications(peek().value, lineNo, peek().pos);
      i++;
    }

    const macro = DOMAIN_MACROS[key];
    const types: DomainType[] = macro ?? [DOMAIN_ALIASES[key] ?? 'custom'];
    types.forEach((type, n) => {
      const domain: Domain = { type };
      if (type === 'custom') domain.label = t.value;
      if (specificity) domain.specificity = specificity;
      // A modification block written once on a macro lands on its last domain.
      if (modifications && n === types.length - 1) domain.modifications = modifications;
      domains.push(domain);
    });
  };

  readDomain();
  while (peek().kind !== 'eof') {
    const t = peek();
    if (t.kind === 'dash') {
      i++;
      readDomain();
    } else if (t.kind === 'tilde') {
      i++;
      domains.push({ type: 'linker' });
      readDomain();
    } else if (t.kind === 'star') {
      i++;
      const n = peek();
      if (n.kind !== 'number') throw new DslError(`"*" must be followed by a count`, lineNo, n.pos);
      copies = Number(n.value);
      if (!Number.isInteger(copies) || copies < 1) {
        throw new DslError(`chain copy count must be a positive integer`, lineNo, n.pos);
      }
      i++;
    } else {
      throw new DslError(`unexpected "${t.value}"`, lineNo, t.pos);
    }
  }

  const chain: Chain = { id, domains };
  if (copies != null) chain.copies = copies;
  return chain;
}

function parseModifications(raw: string, lineNo: number, pos: number): Modification[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf('=');
      const rawName = (eq < 0 ? entry : entry.slice(0, eq)).trim();
      const key = rawName.toLowerCase();
      const type = MODIFICATION_ALIASES[key] ?? (key in MODIFICATION_CATALOG ? key : null);
      if (!type) {
        // Unknown names are preserved as a custom modification rather than failing,
        // so novel engineering shorthand still shows up in the drawing and legend.
        return { type: 'custom', label: rawName } as Modification;
      }
      const mod: Modification = { type: type as Modification['type'] };
      if (eq >= 0) {
        const fields = entry
          .slice(eq + 1)
          .split('/')
          .map((r) => r.trim())
          .filter(Boolean);
        if (fields.length === 0) throw new DslError(`empty modification value`, lineNo, pos);
        if (type === 'drug') {
          // `drug=MMAE/vc-PAB/4` — compound, then linker and DAR in any order.
          mod.payload = parsePayload(fields, lineNo, pos);
        } else {
          mod.residues = fields;
        }
      }
      return mod;
    });
}

const PAYLOAD_SHAPES = new Set<PayloadShape>([
  'hexagon',
  'circle',
  'triangle',
  'diamond',
  'square',
  'star',
]);

/** Whether the linker releases its payload inside the cell. */
const CLEAVABILITY: Record<string, boolean> = {
  cleavable: true,
  noncleavable: false,
  'non-cleavable': false,
  uncleavable: false,
};

/**
 * `MMAE`, `MMAE/vc-PAB`, `MMAE/vc-PAB/4/2/interchain cysteine` — after the
 * compound's name the fields are read by what they are: the first string is the
 * linker and the second the conjugation site, the first number is the DAR and
 * the second how many glyphs to draw here. `cleavable` and `noncleavable` are
 * words in their own right.
 *
 * That shorthand covers the common case and cannot say everything: a site with
 * no linker named would land in the linker's place, and there is no room in it
 * at all for the payload's shape or colour. So any field may also be written
 * `key=value`, and a value that cannot be placed is an error rather than a
 * quiet overwrite.
 */
function parsePayload(fields: string[], lineNo: number, pos: number): Payload {
  const [name, ...rest] = fields;
  if (!name) throw new DslError(`a conjugated payload needs a name`, lineNo, pos);
  if (name.includes('=')) {
    throw new DslError(`a conjugated payload's name comes first, not "${name}"`, lineNo, pos);
  }
  const payload: Payload = { name };
  const assigned = new Set<string>();

  const set = (key: string, value: string): void => {
    const canonical = key === 'copies' ? 'count' : key;
    if (assigned.has(canonical)) {
      throw new DslError(`payload field "${canonical}" is given more than once`, lineNo, pos);
    }
    if (value.length === 0 && key !== 'attachment') {
      throw new DslError(`payload field "${key}" cannot be empty`, lineNo, pos);
    }
    assigned.add(canonical);
    switch (key) {
      case 'linker':
        payload.linker = value;
        return;
      case 'site':
        payload.site = value;
        return;
      case 'dar':
      case 'copies':
      case 'count': {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          throw new DslError(`${key} expects a number, got "${value}"`, lineNo, pos);
        }
        if (key === 'dar') {
          if (n <= 0) throw new DslError(`dar must be greater than zero`, lineNo, pos);
          payload.dar = n;
        } else {
          if (!Number.isInteger(n) || n < 1) {
            throw new DslError(`count must be a positive integer`, lineNo, pos);
          }
          payload.count = n;
        }
        return;
      }
      case 'cleavable': {
        const normalized = value.toLowerCase();
        const flag = CLEAVABILITY[normalized];
        if (flag == null && normalized !== 'true' && normalized !== 'false') {
          throw new DslError(`cleavable expects true or false, got "${value}"`, lineNo, pos);
        }
        payload.cleavable = flag ?? normalized === 'true';
        return;
      }
      case 'attachment':
        // Deliberately allows the empty string: that is how a bond is left bare.
        payload.attachment = value;
        return;
      case 'shape':
        if (!PAYLOAD_SHAPES.has(value as PayloadShape)) {
          throw new DslError(
            `unknown payload shape "${value}"; one of ${[...PAYLOAD_SHAPES].join(', ')}`,
            lineNo,
            pos,
          );
        }
        payload.shape = value as PayloadShape;
        return;
      case 'color':
        payload.color = value;
        return;
      default:
        throw new DslError(
          `unknown payload field "${key}"; one of linker, site, dar, copies, ` +
            `cleavable, attachment, shape, color`,
          lineNo,
          pos,
        );
    }
  };

  for (const field of rest) {
    const eq = field.indexOf('=');
    if (eq > 0) {
      set(field.slice(0, eq).trim().toLowerCase(), field.slice(eq + 1).trim());
      continue;
    }
    const flag = CLEAVABILITY[field.toLowerCase()];
    if (flag != null) {
      set('cleavable', field);
      continue;
    }
    const asNumber = Number(field);
    if (Number.isFinite(asNumber)) {
      if (!assigned.has('dar')) set('dar', field);
      else if (!assigned.has('count')) set('count', field);
      else {
        throw new DslError(
          `"${field}" has nowhere to go: dar and copies are already given. ` +
            `Write dar=${field} or copies=${field} to say which you mean`,
          lineNo,
          pos,
        );
      }
      continue;
    }
    if (!assigned.has('linker')) set('linker', field);
    else if (!assigned.has('site')) set('site', field);
    else {
      throw new DslError(
        `"${field}" has nowhere to go: linker and site are already given. ` +
          `Write site="${field}" to say which you mean`,
        lineNo,
        pos,
      );
    }
  }
  return payload;
}

export { DslError };
