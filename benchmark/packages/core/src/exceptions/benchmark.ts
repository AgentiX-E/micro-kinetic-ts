/**
 * Benchmark-related exceptions.
 *
 * @module exceptions/benchmark
 */

import { KineticError } from './base.js';

/** Thrown when benchmark data fails to load. */
export class BenchmarkLoadError extends KineticError {
  constructor(datasetId: string, cause?: string) {
    super(
      `Failed to load benchmark dataset: ${datasetId}${cause ? ` — ${cause}` : ''}`,
      'BENCHMARK_LOAD_ERROR',
    );
    this.name = 'BenchmarkLoadError';
  }
}

/** Thrown when benchmark data format is invalid. */
export class BenchmarkFormatError extends KineticError {
  constructor(datasetId: string, details: string) {
    super(`Invalid benchmark format in ${datasetId}: ${details}`, 'BENCHMARK_FORMAT_ERROR');
    this.name = 'BenchmarkFormatError';
  }
}

/** Thrown when benchmark validation fails. */
export class BenchmarkValidationError extends KineticError {
  readonly datasetId: string;
  readonly metric: string;
  readonly expected: number;
  readonly actual: number;

  constructor(datasetId: string, metric: string, expected: number, actual: number) {
    super(
      `Benchmark validation failed for ${datasetId}/${metric}: expected ≥${expected}, got ${actual}`,
      'BENCHMARK_VALIDATION_ERROR',
    );
    this.name = 'BenchmarkValidationError';
    this.datasetId = datasetId;
    this.metric = metric;
    this.expected = expected;
    this.actual = actual;
  }
}
