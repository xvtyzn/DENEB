import type { NChain, NDomain, NormalizedConstruct } from '../model/types';
import { resolveModification, type ResolvedModification } from '../render/markers';

export interface DomainEventInfo {
  domain: NDomain;
  chain: NChain | undefined;
  modifications: ResolvedModification[];
  /** The `<g data-domain-id>` element the event came from. */
  element: SVGElement;
}

export interface ModificationEventInfo {
  modification: ResolvedModification;
  domain: NDomain | undefined;
  element: SVGElement;
}

interface ClosestCapable {
  closest(selector: string): unknown;
  getAttribute(name: string): string | null;
}

/**
 * Duck-typed rather than `instanceof Element` so the helpers keep working when
 * the event originates in another realm (an iframe, a portal, jsdom).
 */
function isElementLike(value: unknown): value is ClosestCapable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ClosestCapable).closest === 'function' &&
    typeof (value as ClosestCapable).getAttribute === 'function'
  );
}

function closestWith(target: EventTarget | null, attr: string): SVGElement | null {
  if (!isElementLike(target)) return null;
  return (target.closest(`[${attr}]`) as SVGElement | null) ?? null;
}

export function domainFromEvent(
  target: EventTarget | null,
  construct: NormalizedConstruct,
): DomainEventInfo | null {
  const element = closestWith(target, 'data-domain-id');
  const id = element?.getAttribute('data-domain-id');
  if (!element || !id) return null;
  const domain = construct.byId.get(id);
  if (!domain) return null;
  return {
    domain,
    chain: construct.chains.find((c) => c.id === domain.chainId),
    modifications: domain.modifications.map((m) => resolveModification(m, domain.id)),
    element,
  };
}

export function modificationFromEvent(
  target: EventTarget | null,
  construct: NormalizedConstruct,
): ModificationEventInfo | null {
  const element = closestWith(target, 'data-modification-type');
  const type = element?.getAttribute('data-modification-type');
  if (!element || !type) return null;
  const domainId =
    element.getAttribute('data-domain-id') ??
    closestWith(element, 'data-domain-id')?.getAttribute('data-domain-id') ??
    null;
  const domain = domainId ? construct.byId.get(domainId) : undefined;
  const raw = domain?.modifications.find((m) => m.type === type) ?? { type: type as never };
  return { modification: resolveModification(raw, domainId ?? ''), domain, element };
}
