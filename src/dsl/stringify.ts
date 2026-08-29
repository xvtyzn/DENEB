import type { Chain, Construct, Domain, DomainType, Modification } from '../model/types';
import { MODIFICATION_CATALOG } from '../model/catalog';

const TYPE_TOKEN: Partial<Record<DomainType, string>> = {
  hinge: 'h',
  linker: 'L',
};

function domainToken(d: Domain): string {
  return TYPE_TOKEN[d.type] ?? (d.type === 'custom' ? (d.label ?? 'custom') : d.type);
}

function modToken(m: Modification): string {
  const name = m.type === 'custom' && m.label ? m.label : m.type;
  if (m.payload) {
    const fields = [m.payload.name];
    if (m.payload.linker) fields.push(m.payload.linker);
    if (m.payload.dar != null) fields.push(String(m.payload.dar));
    if (m.payload.count != null) fields.push(String(m.payload.count));
    if (m.payload.site) fields.push(m.payload.site);
    return `${name}=${fields.join('/')}`;
  }
  const catalog = MODIFICATION_CATALOG[m.type];
  const defaults = catalog?.residues;
  const custom =
    m.residues && (!defaults || m.residues.join('/') !== defaults.join('/'))
      ? `=${m.residues.join('/')}`
      : '';
  return `${name}${custom}`;
}

function suffix(d: Domain): string {
  let out = '';
  if (d.specificity) out += `(${d.specificity})`;
  if (d.modifications && d.modifications.length > 0) {
    out += `[${d.modifications.map(modToken).join(',')}]`;
  }
  return out;
}

function chainToDSL(chain: Chain): string {
  const parts: string[] = [];
  const domains = chain.domains ?? [];
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i]!;
    // A bare linker between two domains is written as the `~` operator.
    if (
      d.type === 'linker' &&
      !d.specificity &&
      !d.modifications?.length &&
      i > 0 &&
      i < domains.length - 1 &&
      domains[i - 1]!.type !== 'linker' &&
      domains[i + 1]!.type !== 'linker'
    ) {
      parts.push('~');
      continue;
    }
    if (parts.length > 0 && parts[parts.length - 1] !== '~') parts.push('-');
    parts.push(domainToken(d) + suffix(d));
  }
  const copies = chain.copies && chain.copies > 1 ? ` *${chain.copies}` : '';
  return `${chain.id}: ${parts.join('')}${copies}`;
}

/**
 * Render a construct back to the DSL. `parseDSL(stringifyDSL(c))` reproduces
 * `c` for anything the DSL can express, which is what the round-trip test uses.
 */
export function stringifyDSL(construct: Construct): string {
  const lines: string[] = [];
  if (construct.name) lines.push(`@name ${construct.name}`);
  if (construct.layout?.skeleton) lines.push(`@skeleton ${construct.layout.skeleton}`);
  if (construct.layout?.armAngle != null) lines.push(`@arm ${construct.layout.armAngle}`);
  if (construct.layout?.armMode) lines.push(`@armmode ${construct.layout.armMode}`);
  for (const s of construct.specificities ?? []) {
    if (s.color) lines.push(`@color ${s.name}=${s.color}`);
  }
  for (const chain of construct.chains ?? []) lines.push(chainToDSL(chain));
  for (const l of construct.links ?? []) {
    if (l.type === 'pair') lines.push(`@pair ${l.a} ${l.b}`);
    else if (l.type === 'disulfide') lines.push(`@ss ${l.a} ${l.b}`);
  }
  return lines.join('\n');
}
