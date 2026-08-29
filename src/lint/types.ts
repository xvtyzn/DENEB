import type {
  Diagnostic,
  DiagnosticLevel,
  DomainRef,
  NormalizedConstruct,
} from '../model/types';

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
  /** One line on what the rule is for, surfaced by `LINT_RULES`. */
  about: string;
  /**
   * True when the rule reads something other than the structure — a target's
   * name, say. Those are worth knowing about because they can misfire.
   */
  heuristic?: boolean;
  check(construct: NormalizedConstruct): RuleHit[];
}

export interface LintOptions {
  /** Rule names to skip. */
  disable?: string[];
  /** Raise or lower individual rules. */
  severity?: Record<string, DiagnosticLevel>;
}
