import { describe, it, expect } from 'vitest';
import {
  BenchmarkLoadError,
  BenchmarkFormatError,
  BenchmarkValidationError,
  KineticError,
} from '@agentix-e/micro-kinetic-core';

describe('BenchmarkLoadError', () => {
  it('should create with datasetId only', () => {
    const err = new BenchmarkLoadError('rcaeval-re1');
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('BenchmarkLoadError');
    expect(err.errorCode).toBe('BENCHMARK_LOAD_ERROR');
    expect(err.message).toContain('rcaeval-re1');
  });

  it('should create with datasetId and cause', () => {
    const err = new BenchmarkLoadError('aiops2025', 'Network timeout');
    expect(err.message).toContain('aiops2025');
    expect(err.message).toContain('Network timeout');
  });

  it('should chain correctly', () => {
    const err = new BenchmarkLoadError('rca100');
    expect(err instanceof KineticError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('BenchmarkFormatError', () => {
  it('should create with datasetId and details', () => {
    const err = new BenchmarkFormatError('rcaeval-re2', 'Missing metrics field');
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('BenchmarkFormatError');
    expect(err.errorCode).toBe('BENCHMARK_FORMAT_ERROR');
    expect(err.message).toContain('rcaeval-re2');
    expect(err.message).toContain('Missing metrics field');
  });

  it('should chain correctly', () => {
    const err = new BenchmarkFormatError('rcaeval-re1', 'Bad schema');
    expect(err instanceof KineticError).toBe(true);
  });
});

describe('BenchmarkValidationError', () => {
  it('should create with datasetId, metric, expected, actual', () => {
    const err = new BenchmarkValidationError('rcaeval-re1', 'avgAt1', 0.8, 0.75);
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('BenchmarkValidationError');
    expect(err.errorCode).toBe('BENCHMARK_VALIDATION_ERROR');
    expect(err.datasetId).toBe('rcaeval-re1');
    expect(err.metric).toBe('avgAt1');
    expect(err.expected).toBe(0.8);
    expect(err.actual).toBe(0.75);
  });

  it('should include all info in message', () => {
    const err = new BenchmarkValidationError('aiops2025', 'accuracy', 0.9, 0.88);
    expect(err.message).toContain('aiops2025');
    expect(err.message).toContain('accuracy');
    expect(err.message).toContain('0.9');
    expect(err.message).toContain('0.88');
  });

  it('should handle where actual meets expected', () => {
    const err = new BenchmarkValidationError('rca100', 'avgAt5', 0.95, 0.95);
    expect(err.actual).toBe(err.expected);
  });

  it('should handle metric with special characters', () => {
    const err = new BenchmarkValidationError('rcaeval-re3', 'comp_Δt_score', 100, 95);
    expect(err.metric).toBe('comp_Δt_score');
  });

  it('should chain correctly', () => {
    const err = new BenchmarkValidationError('rca100', 'metric', 1, 0.5);
    expect(err instanceof KineticError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
