import { describe, it, expect } from 'vitest';
import { DEFAULTS } from '../../../src/di/defaults.js';

describe('DEFAULTS', () => {
  it('should have PRUNE_EPSILON defined', () => {
    expect(DEFAULTS.PRUNE_EPSILON).toBeDefined();
    expect(typeof DEFAULTS.PRUNE_EPSILON).toBe('number');
  });

  it('should have CRITICAL_LOAD_THRESHOLD between 0 and 1', () => {
    expect(DEFAULTS.CRITICAL_LOAD_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULTS.CRITICAL_LOAD_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it('should have DEFAULT_TOP_K as positive integer', () => {
    expect(DEFAULTS.DEFAULT_TOP_K).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULTS.DEFAULT_TOP_K)).toBe(true);
  });

  it('should have MAX_PROPAGATION_DEPTH as positive', () => {
    expect(DEFAULTS.MAX_PROPAGATION_DEPTH).toBeGreaterThan(0);
  });

  it('should have COUPLING_SPARSITY_THRESHOLD between 0 and 1', () => {
    expect(DEFAULTS.COUPLING_SPARSITY_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULTS.COUPLING_SPARSITY_THRESHOLD).toBeLessThanOrEqual(1);
  });

  it('should have BBGKY_TRUNCATION_ETA between 0 and 1', () => {
    expect(DEFAULTS.BBGKY_TRUNCATION_ETA).toBeGreaterThan(0);
    expect(DEFAULTS.BBGKY_TRUNCATION_ETA).toBeLessThan(1);
  });

  it('should have WAVE_DECAY_TIME_CONSTANT as positive', () => {
    expect(DEFAULTS.WAVE_DECAY_TIME_CONSTANT).toBeGreaterThan(0);
  });

  it('should have WAVE_CASCADE_THRESHOLD between 0 and 1', () => {
    expect(DEFAULTS.WAVE_CASCADE_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULTS.WAVE_CASCADE_THRESHOLD).toBeLessThan(1);
  });

  it('should have all expected properties', () => {
    expect(Object.keys(DEFAULTS).length).toBe(8);
  });
});
