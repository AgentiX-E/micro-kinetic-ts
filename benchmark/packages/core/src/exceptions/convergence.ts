/**
 * Convergence-related exceptions.
 *
 * @module exceptions/convergence
 */

import { KineticError } from './base.js';

/** Thrown when the induction proof fails to converge. */
export class InductionError extends KineticError {
  /** The step at which induction failed */
  readonly failedStep: number;
  /** The accumulated error at failure */
  readonly accumulatedError: number;
  /** The global tolerance */
  readonly tolerance: number;

  constructor(failedStep: number, accumulatedError: number, tolerance: number) {
    super(
      `Induction failed at step ${failedStep}: accumulated error ${accumulatedError} > tolerance ${tolerance}`,
      'INDUCTION_ERROR',
    );
    this.name = 'InductionError';
    this.failedStep = failedStep;
    this.accumulatedError = accumulatedError;
    this.tolerance = tolerance;
  }
}

/** Thrown when convergence takes too long. */
export class ConvergenceTimeoutError extends KineticError {
  /** Steps attempted before timeout */
  readonly stepsAttempted: number;

  constructor(stepsAttempted: number, maxSteps: number) {
    super(
      `Convergence timeout: ${stepsAttempted} steps attempted, max ${maxSteps}`,
      'CONVERGENCE_TIMEOUT',
    );
    this.name = 'ConvergenceTimeoutError';
    this.stepsAttempted = stepsAttempted;
  }
}

/** Thrown when cutting windows are invalid. */
export class InvalidWindowError extends KineticError {
  constructor(message: string) {
    super(message, 'INVALID_WINDOW');
    this.name = 'InvalidWindowError';
  }
}
