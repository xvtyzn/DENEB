import type { Chain, Construct, Domain, DomainType, Modification } from '../model/types';
import { MODIFICATION_CATALOG } from '../model/catalog';

const TYPE_TOKEN: Partial<Record<DomainType, string>> = {
  hinge: 'h',
  linker: 'L',
};

function domainToken(d: Domain): string {
  return TYPE_TOKEN[d.type] ?? (d.type === 'custom' ? (d.label ?? 'custom') : d.type);
}

/**
 * A payload's fields, written so they read back as themselves.
 *
 * The shorthand places bare values by what they are — first string the linker,
 * second the site; first number the DAR, second the copies — so a value can only
 * be written bare when everything before it is there too. Anything else is
 * named, which is also the only way to say the fields the shorthand has no room
 * for.
 */
function payloadFields(payload: NonNullable<Modification['payload']>): string[] {
  const fields = [payload.name];
  if (payload.linker) fields.push(payload.linker);
  if (payload.dar != null) fields.push(String(payload.dar));
  if (payload.count != null) {
    fields.push(payload.dar != null ? String(payload.count) : `copies=${payload.count}`);
  }
  if (payload.site) fields.push(payload.linker ? payload.site : `site=${payload.site}`);
  if (payload.cleavable != null) fields.push(payload.cleavable ? 'cleavable' : 'noncleavable');
  if (payload.attachment != null) fields.push(`attachment=${payload.attachment}`);
  if (payload.shape) fields.push(`shape=${payload.shape}`);
  if (payload.color) fields.push(`color=${payload.color}`);
  return fields;
}

function modToken(m: Modification): string {
  const name = m.type === 'custom' && m.label ? m.label : m.type;
  if (m.payload) {
    return `${name}=${payloadFields(m.payload).join('/')}`;
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
  for (const chain of construct.chains ?? []) {
    lines.push(chainToDSL(chain));
    // Written out only when the whole chain agrees, which is the only shape the
    // directive can express.
    const isotypes = new Set((chain.domains ?? []).map((d) => d.isotype));
    const [only] = [...isotypes];
    if (isotypes.size === 1 && only) lines.push(`@isotype ${chain.id}=${only}`);
  }
  for (const l of construct.links ?? []) {
    if (l.type === 'pair') lines.push(`@pair ${l.a} ${l.b}`);
    else if (l.type === 'disulfide') lines.push(`@ss ${l.a} ${l.b}`);
  }
  return lines.join('\n');
}
