/**
 * Argument rules shared by the benchmark CLI scripts.
 *
 * A runner is a dispatcher's interface to the engine, and every flag it accepts is
 * a second way to state a configuration the engine already has a default for. Two
 * runners parsing the same kind of flag with two different rules is therefore the
 * same defect as two owners of a constant: both files stay green while the value a
 * dispatch produced depends on which script it reached.
 *
 * @module benchmarks/cli-args
 */

import { MAX_FIELD_DECIMALS } from '../../packages/kinetic/src/benchmarks/index.js';

/**
 * Whether `argv[index]` is a VALUE rather than the next flag.
 *
 * A flag must not swallow the next flag, and the chains used to test only `index < argv.length`:
 * `--log-weight --log-mode count` consumed `--log-mode` as the weight. `parseWeight` fell back to
 * the shipped default, `count` was left as a stray token, and the run used the shipped log mode —
 * so a dispatcher who forgot one value had their whole request replaced by two defaults, with
 * nothing in the artifact to say the flags had been asked for at all.
 *
 * A value never begins with `--` in these CLIs: every value is a number, a mode name, a path or a
 * comma-separated list. The rule is therefore exact rather than a heuristic, and a flag left
 * without a value is reported at the flag rather than silently defaulted.
 *
 * @param argv - The argument vector.
 * @param index - The position being tested as a value.
 * @returns `true` when the token exists and is not itself a flag.
 */
export function hasValue(argv: readonly string[], index: number): boolean {
  const next = argv[index];
  return next !== undefined && !next.startsWith('--');
}

/**
 * Parse one weight from a flag's raw value.
 *
 * The parse is STRICT and the fallback is the caller's SHIPPED value, for the same
 * reason the FSE'26 CLI is: a malformed value must reproduce a published
 * configuration rather than invent one. `Number('')` is `0`, so an inline parse
 * turns an empty flag into whatever zero means for that field — and once a field
 * ships non-zero, zero is its ABLATION, i.e. a dispatch that meant to leave a value
 * alone silently measures the "signal off" configuration instead. A negative weight
 * is rejected for the same reason it is meaningless: it would invert the term.
 *
 * @param raw - The flag value as written on the command line.
 * @param shipped - The value the runner would have used had the flag been absent.
 * @returns `raw` when it is a finite, non-negative number; `shipped` otherwise.
 */
export function parseWeight(raw: string, shipped: number): number {
  if (raw.trim() === '') return shipped;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : shipped;
}

/**
 * Parse one render precision from a flag's raw value.
 *
 * The same strictness as {@link parseWeight} and one extra bound, because this flag's failure mode is
 * different in kind: a wrong weight answers wrongly, while a wrong precision makes the RUN die.
 * `Number.prototype.toFixed` accepts `0` to {@link MAX_FIELD_DECIMALS} digits and raises `RangeError`
 * outside that, so an unguarded parse turns `--diagnose-decimals 200` into a crash on the first
 * rendered case — after a suite has been loaded and benchmarked. The bound is taken from the module
 * that calls `toFixed` rather than restated, so the two cannot drift.
 *
 * A non-integer is refused rather than rounded: `4.5` digits is not a request the renderer can
 * satisfy, and rounding it would silently produce one of two legal artifacts, neither of which the
 * dispatch named. An explicit `0` is KEPT — integer rendering is a legal artifact and the coarsest box
 * a reader can be handed — so "coarsen this dump" stays reachable through the CLI.
 *
 * @param raw - The flag value as written on the command line.
 * @param shipped - The precision the runner would have used had the flag been absent.
 * @returns `raw` when it is an integer the renderer can express; `shipped` otherwise.
 */
export function parseFieldDecimals(raw: string, shipped: number): number {
  if (raw.trim() === '') return shipped;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_FIELD_DECIMALS) return shipped;
  return value;
}
