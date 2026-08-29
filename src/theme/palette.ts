import type { NDomain, SpecificityDecl } from '../model/types';
import { DOMAIN_CATALOG } from '../model/catalog';
import { type Theme, tint } from './theme';

export type ColorMode = 'specificity' | 'chain' | 'domain';

export interface ColorResolver {
  fill(domain: NDomain): string;
  stroke(domain: NDomain): string;
  /** Colour shown in the legend for a specificity. */
  specificityColor(name: string): string;
}

/** Variable heavy-side domains keep full saturation; light-side get a tint. */
function isLightSide(type: NDomain['type']): boolean {
  return type === 'VL' || type === 'CL' || type === 'TCRa';
}

export function createColorResolver(
  specificities: Required<SpecificityDecl>[],
  chains: { id: string }[],
  theme: Theme,
  mode: ColorMode,
): ColorResolver {
  const specColor = new Map<string, string>();
  specificities.forEach((s) => specColor.set(s.name, s.color));

  const chainColor = new Map<string, string>();
  chains.forEach((c, i) => chainColor.set(c.id, theme.palette[i % theme.palette.length]!));

  const domainTypeColor = new Map<string, string>();

  function base(domain: NDomain): string | null {
    if (mode === 'chain') return chainColor.get(domain.chainId) ?? theme.unknownFill;
    if (mode === 'domain') {
      if (!domainTypeColor.has(domain.type)) {
        domainTypeColor.set(
          domain.type,
          theme.palette[domainTypeColor.size % theme.palette.length]!,
        );
      }
      return domainTypeColor.get(domain.type)!;
    }
    if (!domain.specificity) return null;
    return specColor.get(domain.specificity) ?? theme.unknownFill;
  }

  return {
    fill(domain) {
      const spec = DOMAIN_CATALOG[domain.type];
      const c = base(domain);
      if (c === null) return spec.colored ? theme.unknownFill : theme.constantFill;
      if (mode === 'specificity' && !spec.colored) return theme.constantFill;
      return isLightSide(domain.type) ? tint(c, 0.45) : c;
    },
    stroke() {
      return theme.outline;
    },
    specificityColor(name) {
      return specColor.get(name) ?? theme.unknownFill;
    },
  };
}

/** Assign palette colours to specificities in first-appearance order. */
export function assignSpecificityColors(
  declared: SpecificityDecl[] | undefined,
  order: string[],
  theme: Theme,
): Required<SpecificityDecl>[] {
  const declaredMap = new Map((declared ?? []).map((d) => [d.name, d]));
  const names = [...order];
  for (const d of declared ?? []) if (!names.includes(d.name)) names.push(d.name);

  let next = 0;
  return names.map((name) => {
    const d = declaredMap.get(name);
    const color = d?.color ?? theme.palette[next++ % theme.palette.length]!;
    return { name, color, label: d?.label ?? name };
  });
}
