import { describe, it, expect } from 'vitest';
import {
  KineticError,
  KineticValidationError,
  KineticConfigError,
  KineticTimeoutError,
  KineticPrecisionError,
} from '@agentix-e/micro-kinetic-core';

describe('KineticError', () => {
  it('should create with default error code', () => {
    const err = new KineticError('Something went wrong');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('KineticError');
    expect(err.message).toBe('Something went wrong');
    expect(err.errorCode).toBe('KINETIC_ERROR');
  });

  it('should create with custom error code', () => {
    const err = new KineticError('Custom error', 'CUSTOM_CODE');
    expect(err.errorCode).toBe('CUSTOM_CODE');
  });

  it('should have errorCode as readonly', () => {
    const err = new KineticError('test');
    // Verify it's a string property
    expect(typeof err.errorCode).toBe('string');
  });

  it('should be instance of Error', () => {
    const err = new KineticError('test');
    expect(err instanceof Error).toBe(true);
  });
});

describe('KineticValidationError', () => {
  it('should create without field name', () => {
    const err = new KineticValidationError('Invalid input');
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('KineticValidationError');
    expect(err.message).toBe('Invalid input');
    expect(err.errorCode).toBe('VALIDATION_ERROR');
    expect(err.field).toBeUndefined();
  });

  it('should create with field name', () => {
    const err = new KineticValidationError('Invalid value', 'temperature');
    expect(err.field).toBe('temperature');
  });

  it('should chain correctly to KineticError', () => {
    const err = new KineticValidationError('Bad input', 'count');
    expect(err instanceof KineticError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('KineticConfigError', () => {
  it('should create with message', () => {
    const err = new KineticConfigError('Invalid config: timeout must be positive');
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('KineticConfigError');
    expect(err.message).toBe('Invalid config: timeout must be positive');
    expect(err.errorCode).toBe('CONFIG_ERROR');
  });

  it('should chain correctly', () => {
    const err = new KineticConfigError('Bad config');
    expect(err instanceof KineticError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('KineticTimeoutError', () => {
  it('should create with timeoutMs', () => {
    const err = new KineticTimeoutError(5000);
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('KineticTimeoutError');
    expect(err.message).toContain('5000');
    expect(err.errorCode).toBe('TIMEOUT_ERROR');
    expect(err.timeoutMs).toBe(5000);
  });

  it('should include timeout in message format', () => {
    const err = new KineticTimeoutError(30000);
    expect(err.message).toBe('Computation timed out after 30000ms');
  });

  it('should handle zero timeout', () => {
    const err = new KineticTimeoutError(0);
    expect(err.timeoutMs).toBe(0);
    expect(err.message).toContain('0ms');
  });
});

describe('KineticPrecisionError', () => {
  it('should create with expected and actual precision', () => {
    const err = new KineticPrecisionError(16, 8);
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('KineticPrecisionError');
    expect(err.errorCode).toBe('PRECISION_ERROR');
    expect(err.expectedPrecision).toBe(16);
    expect(err.actualPrecision).toBe(8);
  });

  it('should include precision values in message', () => {
    const err = new KineticPrecisionError(10, 5);
    expect(err.message).toContain('10');
    expect(err.message).toContain('5');
  });

  it('should handle precision loss to zero', () => {
    const err = new KineticPrecisionError(16, 0);
    expect(err.actualPrecision).toBe(0);
  });
});
