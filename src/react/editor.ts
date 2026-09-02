/**
 * The React half of `deneb/edit`.
 *
 * Its own entry point rather than part of `deneb/react`, because a page that
 * only shows a diagram should not download the linter and the edit engine to
 * do it: importing this costs about 11 kB gzipped that a viewer never pays.
 */
import { useCallback, useMemo, useState } from 'react';
import { normalize } from '../model/normalize';
import type { Construct, DomainRef, NormalizedConstruct } from '../model/types';
import { expandForEditing } from '../edit/expand';
import { applyEdit, type Edit } from '../edit/ops';
import { resolvePairing, type PairingReport } from '../edit/pairing';
import { lint, type LintFinding, type LintOptions } from '../lint/index';

export interface ConstructEditorOptions {
  initial: Construct;
  /** Passed through to `lint`. */
  lint?: LintOptions;
  /** Called after every applied edit. */
  onChange?: (construct: Construct) => void;
}

export interface ConstructEditor {
  /** The document, expanded and with explicit ids. */
  construct: Construct;
  /** The same thing, with pairing decided and reported. */
  resolved: NormalizedConstruct;
  pairing: PairingReport;
  /** Everything still missing, design and completeness together, in one list. */
  findings: LintFinding[];
  apply: (edit: Edit) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selection: DomainRef[];
  select: (refs: DomainRef[] | DomainRef | null) => void;
  /** Replace the document outright — loading a template, say. */
  reset: (construct: Construct) => void;
}

/**
 * Editing state, with no opinion about how any of it looks.
 *
 * The loop it implements is the point of `deneb/edit`: apply exactly the edit
 * asked for, decide only the pairing the construct actually determines, and
 * hand back the rest as findings for the interface to show. A half-finished
 * molecule is a normal thing to be holding, and this never tidies one up
 * behind the user's back.
 */
export function useConstructEditor(options: ConstructEditorOptions): ConstructEditor {
  const [history, setHistory] = useState<Construct[]>(() => [expandForEditing(options.initial)]);
  const [at, setAt] = useState(0);
  const [selection, setSelection] = useState<DomainRef[]>([]);

  const construct = history[at]!;

  const { resolved, pairing } = useMemo(() => {
    const normalized = normalize(construct, { pairing: 'explicit' });
    return { resolved: normalized, pairing: resolvePairing(normalized) };
  }, [construct]);

  const findings = useMemo(
    () => lint(resolved, { includeDiagnostics: true, ...options.lint }),
    [resolved, JSON.stringify(options.lint)],
  );

  const push = useCallback(
    (next: Construct) => {
      setHistory((past) => [...past.slice(0, at + 1), next]);
      setAt((n) => n + 1);
      options.onChange?.(next);
    },
    [at, options],
  );

  const apply = useCallback(
    (edit: Edit) => {
      push(applyEdit(construct, edit).construct);
    },
    [construct, push],
  );

  return {
    construct,
    resolved,
    pairing,
    findings,
    apply,
    undo: () => setAt((n) => Math.max(0, n - 1)),
    redo: () => setAt((n) => Math.min(history.length - 1, n + 1)),
    canUndo: at > 0,
    canRedo: at < history.length - 1,
    selection,
    select: (refs) =>
      setSelection(refs == null ? [] : Array.isArray(refs) ? refs : [refs]),
    reset: (next) => {
      const expanded = expandForEditing(next);
      setHistory([expanded]);
      setAt(0);
      setSelection([]);
      options.onChange?.(expanded);
    },
  };
}
