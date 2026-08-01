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
export function invariant(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new KineticValidationError(message);
  }
}

/**
 * Assert that a value is a finite number.
 */
export function invariantFinite(
  value: number,
  label: string,
): asserts value is number {
  if (!Number.isFinite(value)) {
    throw new KineticValidationError(
      `Expected ${label} to be finite, got ${value}`,
      label,
    );
  }
}

/**
 * Assert that a value is within [min, max].
 */
export function invariantRange(
  value: number,
  min: number,
  max: number,
  label: string,
): void {
  if (value < min || value > max) {
    throw new KineticValidationError(
      `Expected ${label} in [${min}, ${max}], got ${value}`,
      label,
    );
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
export function invariantPositiveInt(
  value: number,
  label: string,
): asserts value is number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new KineticValidationError(
      `Expected ${label} to be a positive integer, got ${value}`,
      label,
    );
  }
}
