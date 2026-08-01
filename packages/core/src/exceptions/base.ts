/**
 * Base exception types for @agentix-e/micro-kinetic.
 *
 * All exceptions extend KineticError to enable catch-and-classify
 * in pipeline orchestration.
 *
 * @module exceptions/base
 */

/** Base error class for all kinetic-related errors. */
export class KineticError extends Error {
  /** Error code for categorization. */
  readonly errorCode: string;

  constructor(message: string, errorCode = 'KINETIC_ERROR') {
    super(message);
    this.name = 'KineticError';
    this.errorCode = errorCode;
  }
}

/** Thrown when input validation fails. */
export class KineticValidationError extends KineticError {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'KineticValidationError';
    this.field = field;
  }
}

/** Thrown when a configuration parameter is invalid. */
export class KineticConfigError extends KineticError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'KineticConfigError';
  }
}

/** Thrown when a computation exceeds its time budget. */
export class KineticTimeoutError extends KineticError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Computation timed out after ${timeoutMs}ms`, 'TIMEOUT_ERROR');
    this.name = 'KineticTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when a numeric computation loses significance. */
export class KineticPrecisionError extends KineticError {
  readonly expectedPrecision: number;
  readonly actualPrecision: number;

  constructor(expected: number, actual: number) {
    super(
      `Precision loss: expected ${expected} digits, got ${actual}`,
      'PRECISION_ERROR',
    );
    this.name = 'KineticPrecisionError';
    this.expectedPrecision = expected;
    this.actualPrecision = actual;
  }
}
