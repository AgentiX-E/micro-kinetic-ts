import { describe, it, expect } from 'vitest';
import {
  invariant,
  invariantFinite,
  invariantRange,
  invariantNonEmpty,
  invariantPositiveInt,
  KineticValidationError,
} from '@agentix-e/micro-kinetic-core';

describe('invariant', () => {
  it('should not throw when condition is truthy', () => {
    expect(() => invariant(true, 'should pass')).not.toThrow();
  });

  it('should not throw for non-zero number', () => {
    expect(() => invariant(42, 'should pass')).not.toThrow();
  });

  it('should not throw for non-empty string', () => {
    expect(() => invariant('hello', 'should pass')).not.toThrow();
  });

  it('should not throw for object', () => {
    expect(() => invariant({}, 'should pass')).not.toThrow();
  });

  it('should not throw for array', () => {
    expect(() => invariant([], 'should pass')).not.toThrow();
  });

  it('should throw KineticValidationError when condition is false', () => {
    expect(() => invariant(false, 'condition must be true')).toThrow(KineticValidationError);
  });

  it('should throw KineticValidationError when condition is 0', () => {
    expect(() => invariant(0, 'condition must be truthy')).toThrow(KineticValidationError);
  });

  it('should throw KineticValidationError when condition is empty string', () => {
    expect(() => invariant('', 'condition must be truthy')).toThrow(KineticValidationError);
  });

  it('should throw KineticValidationError when condition is null', () => {
    expect(() => invariant(null, 'condition must be truthy')).toThrow(KineticValidationError);
  });

  it('should throw KineticValidationError when condition is undefined', () => {
    expect(() => invariant(undefined, 'condition must be truthy')).toThrow(KineticValidationError);
  });

  it('should include message in thrown error', () => {
    expect(() => invariant(false, 'custom error message')).toThrow('custom error message');
  });

  it('should throw error with VALIDATION_ERROR code', () => {
    try {
      invariant(false, 'test');
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as KineticValidationError;
      expect(err.errorCode).toBe('VALIDATION_ERROR');
    }
  });
});

describe('invariantFinite', () => {
  it('should not throw for finite integers', () => {
    expect(() => invariantFinite(42, 'value')).not.toThrow();
  });

  it('should not throw for finite floats', () => {
    expect(() => invariantFinite(3.14, 'pi')).not.toThrow();
  });

  it('should not throw for zero', () => {
    expect(() => invariantFinite(0, 'zero')).not.toThrow();
  });

  it('should not throw for negative finite numbers', () => {
    expect(() => invariantFinite(-100, 'neg')).not.toThrow();
  });

  it('should not throw for very large numbers', () => {
    expect(() => invariantFinite(1e308, 'large')).not.toThrow();
  });

  it('should not throw for very small numbers', () => {
    expect(() => invariantFinite(1e-308, 'small')).not.toThrow();
  });

  it('should throw KineticValidationError for NaN', () => {
    expect(() => invariantFinite(NaN, 'nan_value')).toThrow(KineticValidationError);
  });

  it('should throw KineticValidationError for Infinity', () => {
    expect(() => invariantFinite(Infinity, 'inf_value')).toThrow(KineticValidationError);
  });

  it('should throw KineticValidationError for -Infinity', () => {
    expect(() => invariantFinite(-Infinity, 'neg_inf')).toThrow(KineticValidationError);
  });

  it('should include label in NaN error message', () => {
    expect(() => invariantFinite(NaN, 'temperature')).toThrow('temperature');
  });

  it('should include label in Infinity error message', () => {
    expect(() => invariantFinite(Infinity, 'count')).toThrow('count');
  });

  it('should include label in -Infinity error message', () => {
    expect(() => invariantFinite(-Infinity, 'offset')).toThrow('offset');
  });

  it('should set field on error', () => {
    try {
      invariantFinite(NaN, 'myField');
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as KineticValidationError;
      expect(err.field).toBe('myField');
    }
  });
});

describe('invariantRange', () => {
  it('should not throw when value equals min', () => {
    expect(() => invariantRange(0, 0, 10, 'val')).not.toThrow();
  });

  it('should not throw when value equals max', () => {
    expect(() => invariantRange(10, 0, 10, 'val')).not.toThrow();
  });

  it('should not throw when value is inside range', () => {
    expect(() => invariantRange(5, 0, 10, 'val')).not.toThrow();
  });

  it('should throw when value is below min', () => {
    expect(() => invariantRange(-1, 0, 10, 'score')).toThrow(KineticValidationError);
  });

  it('should throw when value is above max', () => {
    expect(() => invariantRange(11, 0, 10, 'score')).toThrow(KineticValidationError);
  });

  it('should include range in error message for below-min', () => {
    expect(() => invariantRange(-5, 0, 100, 'percent')).toThrow('[0, 100]');
  });

  it('should include range in error message for above-max', () => {
    expect(() => invariantRange(200, 0, 100, 'percent')).toThrow('[0, 100]');
  });

  it('should include label in error message', () => {
    expect(() => invariantRange(999, 0, 100, 'temperature')).toThrow('temperature');
  });

  it('should handle negative ranges', () => {
    expect(() => invariantRange(-5, -10, 10, 'val')).not.toThrow();
    expect(() => invariantRange(-15, -10, 10, 'val')).toThrow();
  });

  it('should handle zero-range (min equals max)', () => {
    expect(() => invariantRange(5, 5, 5, 'val')).not.toThrow();
    expect(() => invariantRange(4, 5, 5, 'val')).toThrow();
  });
});

describe('invariantNonEmpty', () => {
  it('should not throw for non-empty array', () => {
    expect(() => invariantNonEmpty([1], 'arr')).not.toThrow();
  });

  it('should not throw for array with multiple elements', () => {
    expect(() => invariantNonEmpty([1, 2, 3], 'arr')).not.toThrow();
  });

  it('should not throw for non-empty Float64Array', () => {
    expect(() => invariantNonEmpty(new Float64Array([1.0]), 'f64')).not.toThrow();
  });

  it('should not throw for string (has length property)', () => {
    expect(() => invariantNonEmpty('hello', 'str')).not.toThrow();
  });

  it('should throw for empty array', () => {
    expect(() => invariantNonEmpty([], 'empty_arr')).toThrow(KineticValidationError);
  });

  it('should throw for empty Float64Array', () => {
    expect(() => invariantNonEmpty(new Float64Array(0), 'empty_f64')).toThrow(KineticValidationError);
  });

  it('should include label in error message for empty array', () => {
    expect(() => invariantNonEmpty([], 'myData')).toThrow('myData must not be empty');
  });

  it('should include label in error message for empty Float64Array', () => {
    expect(() => invariantNonEmpty(new Float64Array(0), 'myBuffer')).toThrow('myBuffer must not be empty');
  });

  it('should not throw for Int32Array with elements', () => {
    expect(() => invariantNonEmpty(new Int32Array([1, 2]), 'i32')).not.toThrow();
  });

  it('should throw for empty Int32Array', () => {
    expect(() => invariantNonEmpty(new Int32Array(0), 'empty_i32')).toThrow(KineticValidationError);
  });

  it('should not throw for Uint8Array with elements', () => {
    expect(() => invariantNonEmpty(new Uint8Array([1]), 'u8')).not.toThrow();
  });
});

describe('invariantPositiveInt', () => {
  it('should not throw for positive integer 1', () => {
    expect(() => invariantPositiveInt(1, 'count')).not.toThrow();
  });

  it('should not throw for large positive integer', () => {
    expect(() => invariantPositiveInt(999999, 'count')).not.toThrow();
  });

  it('should not throw for MAX_SAFE_INTEGER', () => {
    expect(() => invariantPositiveInt(Number.MAX_SAFE_INTEGER, 'big')).not.toThrow();
  });

  it('should throw for zero', () => {
    expect(() => invariantPositiveInt(0, 'count')).toThrow(KineticValidationError);
  });

  it('should throw for negative integer', () => {
    expect(() => invariantPositiveInt(-1, 'count')).toThrow(KineticValidationError);
  });

  it('should throw for negative large integer', () => {
    expect(() => invariantPositiveInt(-100, 'count')).toThrow(KineticValidationError);
  });

  it('should throw for float (non-integer)', () => {
    expect(() => invariantPositiveInt(3.14, 'count')).toThrow(KineticValidationError);
  });

  it('should throw for 0.5', () => {
    expect(() => invariantPositiveInt(0.5, 'ratio')).toThrow(KineticValidationError);
  });

  it('should include label in error message', () => {
    expect(() => invariantPositiveInt(-5, 'port')).toThrow('port');
  });

  it('should include value in error message', () => {
    expect(() => invariantPositiveInt(-5, 'count')).toThrow('-5');
  });

  it('should mention "positive integer" in error message', () => {
    expect(() => invariantPositiveInt(0, 'count')).toThrow('positive integer');
  });
});
