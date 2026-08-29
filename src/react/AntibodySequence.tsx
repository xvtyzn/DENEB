import { useCallback, useMemo, type CSSProperties, type ReactNode } from 'react';
import { normalize } from '../model/normalize';
import type { NChain, NDomain, Region } from '../model/types';
import { resolveHighlight } from '../render/scene';
import { createColorResolver, type ColorMode } from '../theme/palette';
import { resolveTheme, tint, type Theme } from '../theme/theme';
import { domainFromEvent, type DomainEventInfo } from './events';
import { useConstruct, type ConstructSource } from './useConstruct';

export interface ResidueInfo {
  chainId: string;
  /** 1-based, in the chain's own sequence. */
  position: number;
  code: string;
  domain?: NDomain;
  regions: Region[];
}

export interface AntibodySequenceProps extends ConstructSource {
  colorMode?: ColorMode;
  theme?: Partial<Theme>;
  /** Residues per line. Default 60. */
  residuesPerLine?: number;
  /** Residues per group within a line. Default 10; 0 runs them together. */
  groupSize?: number;
  /** Underline CDRs and frameworks a numbering tool supplied. Default true. */
  showRegions?: boolean;
  /** Same vocabulary as the diagram: `'HC1:CH3'`, `'spec:CD3'`, `'mod:knob'`. */
  highlight?: string[];
  className?: string;
  style?: CSSProperties;
  onDomainHover?: (info: DomainEventInfo | null, event: React.MouseEvent) => void;
  onDomainClick?: (info: DomainEventInfo, event: React.MouseEvent) => void;
  onResidueClick?: (residue: ResidueInfo, event: React.MouseEvent) => void;
}

/** One run of residues that share everything worth styling. */
interface Run {
  text: string;
  start: number;
  domain?: NDomain;
  inRegion: boolean;
  highlighted: boolean;
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Roboto Mono', monospace";

/**
 * The sequence, coloured the way the diagram is.
 *
 * Same `highlight` vocabulary and the same `data-domain-id` attributes as the
 * cartoon, so pointing at a domain in one lights it up in the other without
 * either component knowing about the other.
 */
export function AntibodySequence(props: AntibodySequenceProps): ReactNode {
  const {
    construct: constructProp,
    dsl,
    colorMode = 'specificity',
    theme: themeOverride,
    residuesPerLine = 60,
    groupSize = 10,
    showRegions = true,
    highlight = [],
    className,
    style,
    onDomainHover,
    onDomainClick,
    onResidueClick,
  } = props;

  const source = useConstruct({ construct: constructProp, dsl });
  const theme = resolveTheme(themeOverride);

  const { construct, colors, lit } = useMemo(() => {
    const normalized = 'byId' in source ? source : normalize(source, { theme: themeOverride });
    return {
      construct: normalized,
      colors: createColorResolver(
        normalized.specificities,
        normalized.chains,
        theme,
        colorMode,
      ),
      lit: resolveHighlight(highlight, normalized),
    };
  }, [source, colorMode, JSON.stringify(themeOverride), JSON.stringify(highlight)]);

  const handleMove = useCallback(
    (event: React.MouseEvent) => {
      if (onDomainHover) onDomainHover(domainFromEvent(event.target, construct), event);
    },
    [construct, onDomainHover],
  );

  const handleLeave = useCallback(
    (event: React.MouseEvent) => {
      if (onDomainHover) onDomainHover(null, event);
    },
    [onDomainHover],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      const info = domainFromEvent(target, construct);
      if (info && onDomainClick) onDomainClick(info, event);
      if (!onResidueClick) return;
      const residue = residueFromEvent(target, construct);
      if (residue) onResidueClick(residue, event);
    },
    [construct, onDomainClick, onResidueClick],
  );

  return (
    <div
      className={['antibody-sequence', className].filter(Boolean).join(' ')}
      style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1.7, color: theme.labelColor, ...style }}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onClick={handleClick}
    >
      {construct.chains.map((chain) => (
        <ChainBlock
          key={chain.id}
          chain={chain}
          colors={colors}
          theme={theme}
          lit={lit}
          residuesPerLine={residuesPerLine}
          groupSize={groupSize}
          showRegions={showRegions}
        />
      ))}
    </div>
  );
}

function ChainBlock({
  chain,
  colors,
  theme,
  lit,
  residuesPerLine,
  groupSize,
  showRegions,
}: {
  chain: NChain;
  colors: ReturnType<typeof createColorResolver>;
  theme: Theme;
  lit: Set<string>;
  residuesPerLine: number;
  groupSize: number;
  showRegions: boolean;
}): ReactNode {
  const sequence = chain.sequence;
  const gutter = Math.max(4, String(sequence?.length ?? 0).length);

  if (!sequence) {
    return (
      <div style={{ marginBottom: 10 }} data-chain-id={chain.id}>
        <strong>{chain.id}</strong>{' '}
        <span style={{ opacity: 0.6 }}>— no sequence on this chain</span>
      </div>
    );
  }

  const lines: ReactNode[] = [];
  for (let offset = 0; offset < sequence.length; offset += residuesPerLine) {
    const from = offset + 1;
    const to = Math.min(offset + residuesPerLine, sequence.length);
    lines.push(
      <div key={from} style={{ whiteSpace: 'pre' }}>
        <span style={{ opacity: 0.55 }}>{String(from).padStart(gutter, ' ')} </span>
        {runsFor(chain, sequence, from, to, lit, showRegions).map((run, i) => (
          <ResidueRun
            key={`${run.start}-${i}`}
            run={run}
            chain={chain}
            colors={colors}
            theme={theme}
            groupSize={groupSize}
            lineStart={from}
          />
        ))}
        <span style={{ opacity: 0.55 }}> {to}</span>
      </div>,
    );
  }

  return (
    <div style={{ marginBottom: 14 }} data-chain-id={chain.id}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{chain.id}</div>
      {lines}
    </div>
  );
}

/**
 * Break a line into runs that share a domain, a region and a highlight state, so
 * a 450-residue chain is a few dozen elements rather than a few hundred.
 */
function runsFor(
  chain: NChain,
  sequence: string,
  from: number,
  to: number,
  lit: Set<string>,
  showRegions: boolean,
): Run[] {
  const runs: Run[] = [];
  for (let position = from; position <= to; position++) {
    const domain = domainAt(chain, position);
    const inRegion = showRegions && regionsAt(domain, position).length > 0;
    const highlighted = domain ? lit.has(domain.id) : false;
    const last = runs[runs.length - 1];
    if (last && last.domain === domain && last.inRegion === inRegion && last.highlighted === highlighted) {
      last.text += sequence[position - 1];
    } else {
      runs.push({ text: sequence[position - 1]!, start: position, domain, inRegion, highlighted });
    }
  }
  return runs;
}

function ResidueRun({
  run,
  chain,
  colors,
  theme,
  groupSize,
  lineStart,
}: {
  run: Run;
  chain: NChain;
  colors: ReturnType<typeof createColorResolver>;
  theme: Theme;
  groupSize: number;
  lineStart: number;
}): ReactNode {
  const background = run.domain ? tint(colors.fill(run.domain), 0.45) : 'transparent';
  const style: CSSProperties = {
    background,
    borderRadius: 2,
    ...(run.inRegion ? { textDecoration: 'underline', textDecorationThickness: 2 } : {}),
    ...(run.highlighted
      ? { outline: `2px solid ${theme.highlight}`, outlineOffset: -1 }
      : {}),
  };

  // Space every `groupSize` residues, counted from the start of the line.
  const pieces: ReactNode[] = [];
  let text = '';
  for (let i = 0; i < run.text.length; i++) {
    const position = run.start + i;
    text += run.text[i];
    const boundary = groupSize > 0 && (position - lineStart + 1) % groupSize === 0;
    if (boundary || i === run.text.length - 1) {
      pieces.push(text);
      text = '';
      if (boundary && position !== run.start + run.text.length - 1) pieces.push(' ');
    }
  }
  // A gap after the run, when it ends exactly on a group boundary.
  const trailing =
    groupSize > 0 && (run.start + run.text.length - 1 - lineStart + 1) % groupSize === 0 ? ' ' : '';

  return (
    <>
      <span
        style={style}
        title={run.domain ? describe(chain, run.domain) : undefined}
        {...(run.domain
          ? { 'data-domain-id': run.domain.id, 'data-domain-type': run.domain.type }
          : {})}
        data-chain-id={chain.id}
        data-position={run.start}
      >
        {pieces}
      </span>
      {trailing}
    </>
  );
}

const domainAt = (chain: NChain, position: number): NDomain | undefined =>
  chain.domains.find((d) => d.start != null && d.end != null && position >= d.start && position <= d.end);

const regionsAt = (domain: NDomain | undefined, position: number): Region[] =>
  (domain?.regions ?? []).filter((r) => position >= r.start && position <= r.end);

function describe(chain: NChain, domain: NDomain): string {
  const parts = [`${chain.id} · ${domain.label || domain.type}`];
  if (domain.specificity) parts.push(`anti-${domain.specificity}`);
  if (domain.start != null && domain.end != null) parts.push(`${domain.start}–${domain.end}`);
  return parts.join(' · ');
}

function residueFromEvent(
  target: HTMLElement,
  construct: ReturnType<typeof normalize>,
): ResidueInfo | null {
  const span = target.closest?.('[data-position]') as HTMLElement | null;
  const chainId = span?.getAttribute('data-chain-id');
  if (!span || !chainId) return null;
  const chain = construct.chains.find((c) => c.id === chainId);
  if (!chain?.sequence) return null;

  // The run knows where it starts; the offset within it comes from the text.
  const runStart = Number(span.getAttribute('data-position'));
  const position = Number.isFinite(runStart) ? runStart : NaN;
  if (!Number.isFinite(position)) return null;

  const domain = domainAt(chain, position);
  return {
    chainId,
    position,
    code: chain.sequence[position - 1] ?? '',
    ...(domain ? { domain } : {}),
    regions: regionsAt(domain, position),
  };
}
