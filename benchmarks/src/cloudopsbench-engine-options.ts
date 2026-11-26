/**
 * What a Cloud-OpsBench run will ACTUALLY configure the engine with.
 *
 * Kept out of `run-cloudopsbench.ts` because that module is a runner entry point: the coverage census
 * (`__tests__/coverage-scope.test.ts`) holds that a `run-*.ts` module cannot be imported by a test, so a testable
 * surface living there is excluded from the denominator and its own coverage is never required. This projection has a
 * testable surface — it is the answer to "which configuration is this run" — so it lives where a test can reach it.
 *
 * ## Why the projection exists at all
 *
 * The label prior is the one option whose VALUE decides what the runner has to prepare before scoring: at a non-zero
 * weight the term reads a per-case history that must be attached to the cases, and at `0` it reads nothing and a
 * history would be a corpus read no ranking can use. The runner therefore has to answer "is this term priced?" before
 * it scores anything, and until iteration 370 it answered from the RAW command line (`(args.labelPriorWeight ?? 0)`).
 * That agreed with the engine only while the shipped weight was `0`. At the enrolled `0.1` a bare run reached the
 * engine with weight `0.1` and attached no history, so every `p(v)` was absent, the term was skipped, and the report
 * printed `shipped default (0, the ablation)` beside a ranking that was no longer the shipped configuration.
 *
 * One resolution, two uses: this module produces the option object the engine receives, and the same object answers
 * whether a history is needed. A configuration claim has to be DERIVED from the configuration, not restated beside it.
 *
 * @module benchmarks/cloudopsbench-engine-options
 */

import { parseRCAEvalArgs, type CliOptions } from './rcaeval-cli.js';
import { buildRCAEvalEngineOptions, type RCAEvalEngineOptions } from './rcaeval-engine-options.js';

/**
 * The engine options an ablation arm may move, as a subset of the RCAEval parser's own object.
 *
 * A named object rather than positional parameters: three arms arrived in three iterations (`--topology`,
 * `--dual-family-weight`, `--dual-family-gate`), and a fourth positional argument is the shape where a caller passes
 * `undefined` in the wrong slot and gets the shipped engine while believing it moved something. Every field is
 * optional and an absent field leaves the parser's value untouched, so the shipped arm stays byte-identical to the
 * anchor fingerprint's by construction.
 */
export type EngineOverrides = Partial<
  Pick<
    CliOptions,
    | 'dualFamilyWeight'
    | 'dualFamilyGate'
    | 'dualFamilyGateMode'
    | 'labelPriorWeight'
    | 'labelPriorMarginGate'
    | 'labelPriorJurisdiction'
  >
>;

/**
 * The engine options a Cloud-OpsBench run will actually run with: the RCAEval parser's shipped values, with the flags
 * this runner forwards laid over them.
 *
 * @param overrides - The flags this runner accepts, as parsed. Absent fields leave the shipped values untouched.
 * @returns The exact object the engine's constructor receives.
 */
export function resolveEngineOptions(overrides: EngineOverrides = {}): RCAEvalEngineOptions {
  const parsed = parseRCAEvalArgs([]);
  // Drop the absent keys rather than spreading an object whose fields may be `undefined`: `{...parsed, x: undefined}`
  // would overwrite a shipped value with `undefined`, which the engine reads as an invalid number and defaults — a
  // different object from the one the anchor fingerprint hashes.
  const named = Object.entries(overrides).filter(([, value]) => value !== undefined);
  return buildRCAEvalEngineOptions(
    named.length === 0 ? parsed : { ...parsed, ...Object.fromEntries(named) },
  );
}

/**
 * Whether this run will PRICE the label prior, asked of the resolved options rather than of the flag.
 *
 * The pair is not a coincidence to be re-derived per caller: the number that prices the term is the number that
 * decides whether the per-case history is built, and there is exactly one place it is read.
 *
 * @param engine - The options {@link resolveEngineOptions} produced.
 * @returns Whether a label history must be attached to the cases before they are scored.
 */
export function pricesLabelPrior(engine: RCAEvalEngineOptions): boolean {
  return engine.signals.labelPriorWeight !== 0;
}
