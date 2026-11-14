/**
 * Lightweight invariant assertion utility.
 *
 * Zero-dependency replacement for the invariant npm package.
 * Used for runtime assertion of preconditions and invariants.
 *
 * @module utils/invariant
 */

import { KineticValidationError } from '../exceptions/base.js';

/**
 * Assert that a condition is truthy.
 * Throws KineticValidationError if condition is falsy.
 *
 * @param condition - The condition to check
 * @param message - Error message if condition fails
 */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new KineticValidationError(message);
  }
}

/**
 * Assert that a value is a finite number.
 */
export function invariantFinite(value: number, label: string): asserts value is number {
  if (!Number.isFinite(value)) {
    throw new KineticValidationError(`Expected ${label} to be finite, got ${value}`, label);
  }
}

/**
 * Assert that a value is within [min, max].
 *
 * ## Why NaN is rejected explicitly
 *
 * A range check is two comparisons, and NaN answers `false` to both — so the one value that poisons every
 * number it touches was the one value the guard reported as "in range". The consequence is not theoretical:
 * `boundToConfidence` guards `score` with `invariantRange(score, 0, 1)`, and a NaN score came out of it as a
 * NaN confidence stamped on a root-cause row, while the check that was supposed to catch it reported success.
 * `packages/tree/src/causal/topo-deduction.ts` had already found this and worked around it locally with a
 * preceding `invariantFinite`; the workaround was right and the tool was wrong, so both callers and the tool
 * now agree.
 *
 * `Infinity` is deliberately NOT rejected here: `[0, Infinity]` is a range in use (`latencyMs`), and
 * `Infinity > Infinity` is false, so an infinite value has always been admitted by that upper bound. Rejecting
 * it would be a different rule, decided by a different argument — reach for {@link invariantFinite} when the
 * value must be a real number.
 *
 * @param value - The value to check.
 * @param min - Inclusive lower bound.
 * @param max - Inclusive upper bound.
 * @param label - Name used in the error message.
 * @throws KineticValidationError when the value is NaN, below `min`, or above `max`.
 */
export function invariantRange(value: number, min: number, max: number, label: string): void {
  if (Number.isNaN(value) || value < min || value > max) {
    throw new KineticValidationError(`Expected ${label} in [${min}, ${max}], got ${value}`, label);
  }
}

/**
 * Assert that an array or typed array is non-empty.
 */
export function invariantNonEmpty<T extends { readonly length: number }>(
  arr: T,
  label: string,
): void {
  if (arr.length === 0) {
    throw new KineticValidationError(`${label} must not be empty`, label);
  }
}

/**
 * Assert that a value is a positive integer.
 */
export function invariantPositiveInt(value: number, label: string): asserts value is number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new KineticValidationError(
      `Expected ${label} to be a positive integer, got ${value}`,
      label,
    );
  }
}
