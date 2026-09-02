import { normalize } from '../model/normalize';
import type { Construct, NormalizedConstruct } from '../model/types';
import { LINT_RULES } from './rules';
import type { LintCategory, LintFinding, LintOptions } from './types';

export { LINT_RULES } from './rules';
export type { LintCategory, LintFinding, LintOptions, LintRule, RuleHit } from './types';

const ALL_CATEGORIES: readonly LintCategory[] = ['design', 'completeness'];

/**
 * Check a format against the things that commonly go wrong when it is expressed.
 *
 * These are design checks, not drawing checks: nothing here affects how a
 * molecule renders. Each finding carries `refs` in the form `highlight` takes,
 * so a UI can point at the domains the message is about.
 *
 * Rules that read something other than the structure — a target's name, say —
 * are marked `heuristic` in `LINT_RULES` and can be turned off individually.
 *
 * Two kinds of rule live here. `design` rules are about the molecule;
 * `completeness` rules are about what the description has not said yet, which
 * is what an editor needs while a format is still being assembled.
 *
 * `ambiguous-pairing` reads a field that only `deneb/edit`'s `resolvePairing`
 * fills in, so pass the construct it returned rather than a raw one — `lint`
 * re-normalizes anything raw, and that would throw the answer away.
 */
export function lint(
  input: Construct | NormalizedConstruct,
  options: LintOptions = {},
): LintFinding[] {
  const construct: NormalizedConstruct = 'byId' in input ? input : normalize(input);
  const source: Construct | undefined = 'byId' in input ? undefined : input;
  const disabled = new Set(options.disable ?? []);
  const categories = new Set(options.categories ?? ALL_CATEGORIES);

  const findings: LintFinding[] = [];
  if (options.includeDiagnostics) {
    for (const d of construct.diagnostics) {
      findings.push({
        level: d.level,
        code: d.code,
        rule: `normalize/${d.code}`,
        message: d.message,
        refs: d.ref && construct.byId.has(d.ref) ? [d.ref] : [],
        ...(d.ref ? { ref: d.ref } : {}),
      });
    }
  }
  for (const rule of LINT_RULES) {
    if (disabled.has(rule.name) || !categories.has(rule.category)) continue;
    for (const hit of rule.check(construct, source)) {
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
