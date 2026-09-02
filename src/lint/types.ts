import type {
  Construct,
  Diagnostic,
  DiagnosticLevel,
  DomainRef,
  NormalizedConstruct,
} from '../model/types';

/**
 * What a rule is for.
 *
 * `design` rules are about the molecule: things that are expressible, drawable
 * and wrong in the laboratory. `completeness` rules are about the notation:
 * things the description has not said yet. An editor needs the second kind,
 * because a half-made construct is a normal state to be in and the useful
 * question is what is still missing.
 */
export type LintCategory = 'design' | 'completeness';

export interface LintFinding extends Diagnostic {
  /** The rule that produced it, for filtering and for `disable`. */
  rule: string;
  /** What to do about it, in one sentence. */
  hint?: string;
  /**
   * Domains the finding is about, in the form `renderSVG`'s `highlight` takes,
   * so a UI can light up exactly what the message is talking about.
   */
  refs: DomainRef[];
}

/** What a rule reports; the runner fills in `rule` and `level`. */
export interface RuleHit {
  message: string;
  hint?: string;
  refs: DomainRef[];
}

export interface LintRule {
  name: string;
  level: DiagnosticLevel;
  category: LintCategory;
  /** One line on what the rule is for, surfaced by `LINT_RULES`. */
  about: string;
  /**
   * True when the rule reads something other than the structure — a target's
   * name, say. Those are worth knowing about because they can misfire.
   */
  heuristic?: boolean;
  /**
   * `source` is the construct as written, before shorthand expansion. Rules
   * that need it — anything about a macro or a `copies` count — sit out when
   * the caller handed in an already-normalized construct.
   */
  check(construct: NormalizedConstruct, source?: Construct): RuleHit[];
}

export interface LintOptions {
  /** Rule names to skip. */
  disable?: string[];
  /** Raise or lower individual rules. */
  severity?: Record<string, DiagnosticLevel>;
  /** Which kinds of rule to run. Defaults to all of them. */
  categories?: readonly LintCategory[];
  /**
   * Fold `construct.diagnostics` in as findings, under `normalize/<code>`, so
   * an app has one list to show rather than two.
   */
  includeDiagnostics?: boolean;
}
