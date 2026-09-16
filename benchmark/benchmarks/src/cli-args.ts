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
