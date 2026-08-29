import { normalize } from '../model/normalize';
import type { Construct, NormalizedConstruct } from '../model/types';
import { LINT_RULES } from './rules';
import type { LintFinding, LintOptions } from './types';

export { LINT_RULES } from './rules';
export type { LintFinding, LintOptions, LintRule, RuleHit } from './types';

/**
 * Check a format against the things that commonly go wrong when it is expressed.
 *
 * These are design checks, not drawing checks: nothing here affects how a
 * molecule renders. Each finding carries `refs` in the form `highlight` takes,
 * so a UI can point at the domains the message is about.
 *
 * Rules that read something other than the structure — a target's name, say —
 * are marked `heuristic` in `LINT_RULES` and can be turned off individually.
 */
export function lint(
  input: Construct | NormalizedConstruct,
  options: LintOptions = {},
): LintFinding[] {
  const construct: NormalizedConstruct = 'byId' in input ? input : normalize(input);
  const disabled = new Set(options.disable ?? []);

  const findings: LintFinding[] = [];
  for (const rule of LINT_RULES) {
    if (disabled.has(rule.name)) continue;
    for (const hit of rule.check(construct)) {
      findings.push({
        level: options.severity?.[rule.name] ?? rule.level,
        code: rule.name,
        rule: rule.name,
        message: hit.message,
        ...(hit.hint ? { hint: hit.hint } : {}),
        refs: hit.refs,
        ...(hit.refs[0] ? { ref: hit.refs[0] } : {}),
      });
    }
  }
  return findings;
}
