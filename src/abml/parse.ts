import type {
  Chain,
  Construct,
  Diagnostic,
  Domain,
  DomainType,
  Link,
  Modification,
} from '../model/types';
import {
  DOMAIN_TOKENS,
  MOD_KEYWORDS,
  MODIFICATION_SYMBOLS,
} from './vocabulary';

export interface AbmlParseResult {
  construct: Construct;
  /** What was assumed, renamed or not understood — never thrown. */
  diagnostics: Diagnostic[];
}

export class AbmlError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`at character ${position + 1}: ${message}`);
    this.name = 'AbmlError';
  }
}

interface ParsedComment {
  keyword: string;
  value: string;
}

interface ParsedDomain {
  token: string;
  type: DomainType;
  symbols: string[];
  specificity: string[];
  id?: number;
  interactions: number[];
  disulfides?: number;
  comments: ParsedComment[];
  chainIndex: number;
  position: number;
}

/**
 * Read an AbML v1.06 expression.
 *
 * AbML numbers its domains and states which ones interact, so the pairing this
 * library would otherwise infer is given outright — that is what makes it worth
 * reading rather than approximating. Whitespace is insignificant and everything
 * but comment text is case-insensitive, both as the specification says.
 *
 * Antibody Markup Language, Sweet-Jones, Ahmad & Martin, mAbs 14:1 (2022),
 * doi:10.1080/19420862.2022.2101183
 */
export function parseAbML(source: string): AbmlParseResult {
  const diagnostics: Diagnostic[] = [];
  const parsed: ParsedDomain[] = [];

  if (source.trim() === '') throw new AbmlError('the expression is empty.', 0);

  const text = source;
  let at = 0;
  let chainIndex = 0;

  const skipSpace = (): void => {
    while (at < text.length && /\s/.test(text[at]!)) at++;
  };

  skipSpace();
  while (at < text.length) {
    if (text[at] === '|') {
      chainIndex++;
      at++;
      skipSpace();
      continue;
    }
    if (text[at] === '-') {
      at++;
      skipSpace();
      continue;
    }
    parsed.push(readDomain());
    skipSpace();
  }

  function readDomain(): ParsedDomain {
    const position = at;
    const rest = text.slice(at);
    const match = DOMAIN_TOKENS.find(([token]) =>
      rest.slice(0, token.length).toUpperCase() === token,
    );
    if (!match) throw new AbmlError(`expected a domain type, found "${rest.slice(0, 8)}"`, at);
    const [token, type] = match;
    at += token.length;

    const symbols: string[] = [];
    while (at < text.length && '^>@+_!*'.includes(text[at]!)) symbols.push(text[at++]!);

    const specificity: string[] = [];
    if (text[at] === '.') {
      at++;
      let letters = '';
      while (at < text.length && /[A-Za-z0-9]/.test(text[at]!)) letters += text[at++]!;
      if (letters === '') throw new AbmlError('a "." must be followed by a specificity', at);
      // `.ab` is one domain with two specificities.
      specificity.push(...letters.toLowerCase().split(''));
    }

    let id: number | undefined;
    const interactions: number[] = [];
    if (text[at] === '(') {
      const close = text.indexOf(')', at);
      if (close < 0) throw new AbmlError('unterminated "("', at);
      const inner = text.slice(at + 1, close);
      at = close + 1;
      const [own, others] = inner.split(':');
      id = Number(own?.trim());
      if (!Number.isInteger(id)) throw new AbmlError(`"${inner}" is not a domain identifier`, position);
      for (const other of (others ?? '').split(',')) {
        // `Number('')` is 0, so a bare `(2)` would otherwise claim to interact
        // with a domain numbered zero.
        if (other.trim() === '') continue;
        const value = Number(other.trim());
        if (Number.isInteger(value)) interactions.push(value);
        else {
          diagnostics.push({
            level: 'warning',
            code: 'bad-interaction',
            message: `"${other.trim()}" is not a domain identifier.`,
          });
        }
      }
    }

    let disulfides: number | undefined;
    if (text[at] === '{') {
      const close = text.indexOf('}', at);
      if (close < 0) throw new AbmlError('unterminated "{"', at);
      disulfides = Number(text.slice(at + 1, close).trim());
      at = close + 1;
    }

    const comments: ParsedComment[] = [];
    while (text[at] === '[') {
      const close = text.indexOf(']', at);
      if (close < 0) throw new AbmlError('unterminated "["', at);
      comments.push(...readComments(text.slice(at + 1, close)));
      at = close + 1;
    }

    return { token, type, symbols, specificity, id, interactions, disulfides, comments, chainIndex, position };
  }

  // --- turn what was read into a construct ---------------------------------

  // `[ANTI:CD3]` names a specificity letter for the whole molecule, so the
  // letters are resolved once rather than domain by domain.
  const named = new Map<string, string>();
  for (const domain of parsed) {
    const anti = domain.comments.find((c) => c.keyword === 'ANTI');
    if (anti && domain.specificity.length === 1) named.set(domain.specificity[0]!, anti.value);
  }

  const chains: Chain[] = [];
  const idToDomainId = new Map<number, string[]>();

  for (const item of parsed) {
    while (chains.length <= item.chainIndex) {
      chains.push({ id: `C${chains.length + 1}`, domains: [] });
    }
    const chain = chains[item.chainIndex]!;
    const domainId = `${chain.id}:${chain.domains.length}`;
    if (item.id != null) {
      if (!idToDomainId.has(item.id)) idToDomainId.set(item.id, []);
      idToDomainId.get(item.id)!.push(domainId);
    }
    chain.domains.push(toDomain(item, named, domainId, diagnostics));
  }

  const links: Link[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (item.id == null) continue;
    const self = idToDomainId.get(item.id)?.[0];
    if (!self) continue;

    for (const other of item.interactions) {
      const target = idToDomainId.get(other)?.[0];
      if (!target) {
        diagnostics.push({
          level: 'warning',
          code: 'unknown-interaction',
          message: `Domain ${item.id} interacts with ${other}, which is not in the expression.`,
        });
        continue;
      }
      const key = [self, target].sort().join('~');
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ type: 'pair', a: self, b: target });
      if (item.disulfides != null && item.disulfides > 0) {
        links.push({ type: 'disulfide', a: self, b: target, count: item.disulfides });
      }
    }

    // The same identifier used in several chains is one shared domain, as in a
    // dock-and-lock format; each occurrence is drawn and tied to the first.
    const occurrences = idToDomainId.get(item.id) ?? [];
    if (occurrences.length > 1 && occurrences[0] === self) {
      diagnostics.push({
        level: 'info',
        code: 'shared-domain',
        message: `Domain ${item.id} appears in ${occurrences.length} chains; the copies were linked.`,
      });
      for (const copy of occurrences.slice(1)) {
        links.push({ type: 'pair', a: self, b: copy });
      }
    }
  }

  const specificities = [...new Set(parsed.flatMap((d) => d.specificity))]
    .map((letter) => ({ name: named.get(letter) ?? letter }))
    .filter((s) => s.name !== '');

  return {
    construct: {
      chains,
      ...(links.length > 0 ? { links } : {}),
      ...(specificities.length > 0 ? { specificities } : {}),
    },
    diagnostics,
  };
}

function toDomain(
  item: ParsedDomain,
  named: Map<string, string>,
  _domainId: string,
  diagnostics: Diagnostic[],
): Domain {
  const domain: Domain = { type: item.type };

  const specificity = item.specificity.map((letter) => named.get(letter) ?? letter).join('+');
  if (specificity) domain.specificity = specificity;

  const modifications: Modification[] = [];
  // Each `*` is one general modification, which a MOD comment may explain.
  const explanations = item.comments.filter((c) => c.keyword === 'MOD');
  let explained = 0;
  for (const symbol of item.symbols) {
    if (symbol === '*') {
      const comment = explanations[explained++];
      if (!comment) {
        modifications.push({ type: 'custom', label: 'modified' });
        continue;
      }
      const known = MOD_KEYWORDS[comment.value.toUpperCase()];
      if (known) {
        modifications.push(
          known.label ? { type: known.type, label: known.label } : { type: known.type },
        );
      } else {
        modifications.push({ type: 'custom', label: comment.value });
        diagnostics.push({
          level: 'info',
          code: 'unreserved-mod',
          message: `MOD:${comment.value} is not one of the reserved keywords; it was kept as written.`,
        });
      }
      continue;
    }
    const type = MODIFICATION_SYMBOLS[symbol];
    if (type) modifications.push({ type });
  }

  const notes: string[] = [];
  for (const comment of item.comments) {
    switch (comment.keyword) {
      case 'MOD':
        break; // already paired with a `*` above
      case 'TYPE':
        // X and C say what they are here, so it becomes the label.
        domain.label = comment.value;
        break;
      case 'CLASS':
        domain.isotype = comment.value;
        break;
      case 'ANTI':
        break; // already resolved into the specificity
      case 'NOTE':
        notes.push(comment.value);
        break;
      default:
        // LENGTH and anything else keeps its keyword so it can be written back.
        notes.push(`${comment.keyword}:${comment.value}`);
    }
  }

  // A MOD comment with no `*` to explain still says something was modified.
  for (const extra of explanations.slice(explained)) {
    const known = MOD_KEYWORDS[extra.value.toUpperCase()];
    modifications.push(
      known
        ? known.label
          ? { type: known.type, label: known.label }
          : { type: known.type }
        : { type: 'custom', label: extra.value },
    );
  }

  if (modifications.length > 0) domain.modifications = modifications;
  if (notes.length > 0) domain.notes = notes;

  return domain;
}

/** `[ANTI:CD3,MOD:PI]` — comma-separated, and NOTE runs to the end. */
function readComments(body: string): ParsedComment[] {
  const comments: ParsedComment[] = [];
  let rest = body;
  while (rest.trim() !== '') {
    const match = /^\s*(ANTI|MOD|TYPE|LENGTH|CLASS|NOTE)\s*:/i.exec(rest);
    if (!match) {
      comments.push({ keyword: 'NOTE', value: rest.trim() });
      break;
    }
    const keyword = match[1]!.toUpperCase();
    rest = rest.slice(match[0].length);
    if (keyword === 'NOTE') {
      // Free text, and the specification puts it last, so it takes the rest.
      comments.push({ keyword, value: rest.trim() });
      break;
    }
    const comma = rest.indexOf(',');
    const value = (comma < 0 ? rest : rest.slice(0, comma)).trim();
    comments.push({ keyword, value });
    rest = comma < 0 ? '' : rest.slice(comma + 1);
  }
  return comments;
}
