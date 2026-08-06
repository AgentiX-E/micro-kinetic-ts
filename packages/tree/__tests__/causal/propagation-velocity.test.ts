/**
 * Unit tests for propagation velocity model.
 *
 * Tests the MAD-based onset detection (default) and BOCPD mode.
 * Data must have sufficient variance for MAD to produce non-zero thresholds.
 */

import { describe, it, expect } from 'vitest';
import { computePropagationVelocity } from '../../src/causal/propagation-velocity.js';

describe('computePropagationVelocity — basic cases', () => {
  it('should detect forward propagation (source fails first)', () => {
    // Source: baseline with variance, then sustained spike
    const source = new Float64Array(30);
    for (let i = 0; i < 10; i++) source[i] = 10 + (Math.random() - 0.5) * 2;
    for (let i = 10; i < 30; i++) source[i] = 100 + Math.random() * 5;

    // Target: baseline with variance, then later spike
    const target = new Float64Array(30);
    for (let i = 0; i < 20; i++) target[i] = 10 + (Math.random() - 0.5) * 2;
    for (let i = 20; i < 30; i++) target[i] = 100 + Math.random() * 5;

    const result = computePropagationVelocity(source, target, {
      expectedDirectLatency: 10,
      useBOCPD: false,
    });

    expect(result.sourceOnsetIndex).toBeGreaterThan(-1);
    expect(result.targetOnsetIndex).toBeGreaterThan(-1);
    expect(result.sourceOnsetIndex).toBeLessThan(result.targetOnsetIndex);
    expect(result.propagationProbability).toBeGreaterThan(0);
  });

  it('should return zero propagation for reverse causality', () => {
    // Source: anomaly LATER than target
    const source = new Float64Array(30);
    for (let i = 0; i < 20; i++) source[i] = 10 + (Math.random() - 0.5) * 2;
    for (let i = 20; i < 30; i++) source[i] = 100 + Math.random() * 5;

    const target = new Float64Array(30);
    for (let i = 0; i < 10; i++) target[i] = 10 + (Math.random() - 0.5) * 2;
    for (let i = 10; i < 30; i++) target[i] = 100 + Math.random() * 5;

    const result = computePropagationVelocity(source, target, {
      useBOCPD: false,
    });

    expect(result.propagationProbability).toBe(0);
    expect(result.isDirectPropagation).toBe(false);
  });

  it('should handle both onsets detected (same data, same timing)', () => {
    const values = new Float64Array(20);
    for (let i = 0; i < 10; i++) values[i] = 10 + (Math.random() - 0.5) * 2;
    for (let i = 10; i < 20; i++) values[i] = 100 + Math.random() * 5;

    const result = computePropagationVelocity(values, values, {
      useBOCPD: false,
    });

    // Same data → same onset
    expect(result.sourceOnsetIndex).toBe(result.targetOnsetIndex);
  });
});

describe('computePropagationVelocity — edge cases', () => {
  it('should handle no anomaly in source (returns neutral)', () => {
    const source = new Float64Array(20);
    for (let i = 0; i < 20; i++) source[i] = 10 + Math.random() * 0.1;

    const target = new Float64Array(20);
    for (let i = 0; i < 10; i++) target[i] = 10 + (Math.random() - 0.5) * 2;
    for (let i = 10; i < 20; i++) target[i] = 100 + Math.random() * 5;

    const result = computePropagationVelocity(source, target, { useBOCPD: false });

    // No onset in source → neutral propagation probability
    expect(result.propagationProbability).toBe(0.5);
  });

  it('should handle no anomaly in target (returns neutral)', () => {
    const source = new Float64Array(20);
    for (let i = 0; i < 10; i++) source[i] = 10 + (Math.random() - 0.5) * 2;
    for (let i = 10; i < 20; i++) source[i] = 100 + Math.random() * 5;

    const target = new Float64Array(20);
    for (let i = 0; i < 20; i++) target[i] = 10 + Math.random() * 0.1;

    const result = computePropagationVelocity(source, target, { useBOCPD: false });

    expect(result.propagationProbability).toBe(0.5);
  });

  it('should handle empty data', () => {
    const result = computePropagationVelocity(
      new Float64Array([]),
      new Float64Array([]),
      { useBOCPD: false },
    );
    expect(result.propagationProbability).toBe(0.5);
    expect(result.sourceOnsetIndex).toBe(-1);
    expect(result.targetOnsetIndex).toBe(-1);
  });

  it('should produce valid fields with BOCPD mode', () => {
    const source = new Float64Array(50);
    for (let i = 0; i < 20; i++) source[i] = 10 + Math.random() * 2;
    for (let i = 20; i < 50; i++) source[i] = 100 + Math.random() * 5;

    const target = new Float64Array(50);
    for (let i = 0; i < 30; i++) target[i] = 10 + Math.random() * 2;
    for (let i = 30; i < 50; i++) target[i] = 100 + Math.random() * 5;

    const result = computePropagationVelocity(source, target, {
      useBOCPD: true,
      expectedDirectLatency: 10,
    });

    expect(result.usedBOCPD).toBe(true);
    expect(result.propagationProbability).toBeGreaterThanOrEqual(0);
    expect(result.propagationProbability).toBeLessThanOrEqual(1);
  });
});

describe('computePropagationVelocity — latency matching', () => {
  it('should match expected latency when gap is consistent', () => {
    // Source onset ~10, target onset ~20
    const source = new Float64Array(30);
    for (let i = 0; i < 10; i++) source[i] = 5 + (Math.random() - 0.5) * 1;
    for (let i = 10; i < 30; i++) source[i] = 50 + Math.random() * 3;

    const target = new Float64Array(30);
    for (let i = 0; i < 20; i++) target[i] = 5 + (Math.random() - 0.5) * 1;
    for (let i = 20; i < 30; i++) target[i] = 50 + Math.random() * 3;

    const result = computePropagationVelocity(source, target, {
      expectedDirectLatency: 10,
      latencyStddevMultiplier: 0.5,
      useBOCPD: false,
    });

    expect(result.propagationDelay).toBeGreaterThanOrEqual(0);
    // Both onsets detected
    expect(result.sourceOnsetIndex).toBeGreaterThan(-1);
    expect(result.targetOnsetIndex).toBeGreaterThan(-1);
  });

  it('should classify implausible latency gap as indirect', () => {
    // Source onset early, target onset much later
    const source = new Float64Array(50);
    for (let i = 0; i < 5; i++) source[i] = 5 + (Math.random() - 0.5) * 1;
    for (let i = 5; i < 50; i++) source[i] = 50 + Math.random() * 3;

    const target = new Float64Array(50);
    for (let i = 0; i < 45; i++) target[i] = 5 + (Math.random() - 0.5) * 1;
    for (let i = 45; i < 50; i++) target[i] = 50 + Math.random() * 3;

    const result = computePropagationVelocity(source, target, {
      expectedDirectLatency: 5,
      latencyStddevMultiplier: 0.5,
      useBOCPD: false,
    });

    expect(result.isDirectPropagation).toBe(false);
  });
});
