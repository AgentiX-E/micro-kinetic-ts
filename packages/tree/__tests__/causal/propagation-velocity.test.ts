/**
 * Unit tests for propagation velocity model.
 *
 * Tests the MAD-based onset detection (default) and BOCPD mode.
 * Data must have sufficient variance for MAD to produce non-zero thresholds.
 */

import { describe, it, expect } from 'vitest';
import { computePropagationVelocity } from '../../src/causal/propagation-velocity.js';

/**
 * Deterministic step series: a low-variance baseline (ripple around 10) that
 * jumps to a high plateau (ripple around 100) at `onset`. The ripple gives the
 * baseline non-zero MAD so onset detection has a real threshold to exceed,
 * while the plateau stays far above it. Unlike the `Math.random()` noise used
 * in the legacy cases, this is fully reproducible.
 */
function deterministicStep(length: number, onset: number): Float64Array {
  const values = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const ripple = (i % 3) - 1; // -1, 0, 1 → deterministic baseline dispersion
    values[i] = i < onset ? 10 + ripple * 0.5 : 100 + ripple * 0.5;
  }
  return values;
}

/** Aggressive BOCPD tuning that reliably detects a changepoint on short series. */
const SENSITIVE_BOCPD = { hazardRate: 0.3, changepointThreshold: 0.7, minRunLength: 10 };


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

    // No onset in source → neutral propagation probability (changed to 0 to fall back to anomaly similarity)
    expect(result.propagationProbability).toBe(0);
  });

  it('should handle no anomaly in target (returns neutral)', () => {
    const source = new Float64Array(20);
    for (let i = 0; i < 10; i++) source[i] = 10 + (Math.random() - 0.5) * 2;
    for (let i = 10; i < 20; i++) source[i] = 100 + Math.random() * 5;

    const target = new Float64Array(20);
    for (let i = 0; i < 20; i++) target[i] = 10 + Math.random() * 0.1;

    const result = computePropagationVelocity(source, target, { useBOCPD: false });

    expect(result.propagationProbability).toBe(0);
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

  it('computes forward BOCPD propagation probability (deterministic)', () => {
    // Source faults at 15, target at 30 — a positive, direct propagation delay.
    const source = deterministicStep(60, 15);
    const target = deterministicStep(60, 30);
    const result = computePropagationVelocity(source, target, {
      useBOCPD: true,
      expectedDirectLatency: 10,
      bocpd: SENSITIVE_BOCPD,
    });

    expect(result.usedBOCPD).toBe(true);
    expect(result.method).toBe('bocpd');
    expect(result.propagationDelay).toBeGreaterThan(0);
    expect(result.propagationProbability).toBeGreaterThan(0);
  });

  it('returns zero probability for BOCPD-detected reverse propagation', () => {
    // Source faults at 30 but target at 15 — target anomaly precedes source,
    // so propagation is reversed/coincidental and must score zero.
    const source = deterministicStep(60, 30);
    const target = deterministicStep(60, 15);
    const result = computePropagationVelocity(source, target, {
      useBOCPD: true,
      expectedDirectLatency: 10,
      bocpd: SENSITIVE_BOCPD,
    });

    expect(result.usedBOCPD).toBe(true);
    expect(result.method).toBe('bocpd');
    expect(result.propagationDelay).toBeLessThan(0);
    expect(result.propagationProbability).toBe(0);
    expect(result.isDirectPropagation).toBe(false);
  });

  it('returns zero-lag probability for coincident BOCPD onsets', () => {
    // Identical data → identical BOCPD onset → zero propagation delay.
    const values = deterministicStep(60, 30);
    const result = computePropagationVelocity(values, values, {
      useBOCPD: true,
      expectedDirectLatency: 10,
      bocpd: SENSITIVE_BOCPD,
    });

    expect(result.usedBOCPD).toBe(true);
    expect(result.method).toBe('bocpd');
    expect(result.propagationDelay).toBe(0);
    expect(result.propagationProbability).toBe(0.1);
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

  it('returns zero-lag probability for coincident onsets (deterministic)', () => {
    // Identical data → identical detected onset → zero propagation delay.
    const values = deterministicStep(40, 30);
    const result = computePropagationVelocity(values, values, { useBOCPD: false });

    expect(result.sourceOnsetIndex).toBe(30);
    expect(result.targetOnsetIndex).toBe(30);
    expect(result.propagationDelay).toBe(0);
    expect(result.propagationProbability).toBe(0.1);
    expect(result.isDirectPropagation).toBe(false);
  });

  it('rejects any mismatched delay when latencyStddevMultiplier is 0', () => {
    // σ = 0 collapses the Gaussian kernel to a Kronecker delta: only a delay
    // EXACTLY equal to the expected latency is accepted. A 5-step delay against
    // an expected latency of 3 must therefore be rejected.
    const source = deterministicStep(40, 25);
    const target = deterministicStep(40, 30);
    const result = computePropagationVelocity(source, target, {
      useBOCPD: false,
      expectedDirectLatency: 3,
      latencyStddevMultiplier: 0,
    });

    expect(result.propagationDelay).toBeGreaterThan(0);
    expect(result.propagationProbability).toBe(0);
    expect(result.isDirectPropagation).toBe(false);
  });

  it('accepts an exact delay when latencyStddevMultiplier is 0 (delta kernel)', () => {
    // With σ = 0 the kernel is a Kronecker delta: the only accepted delay is the
    // one EXACTLY equal to the expected latency. Here delay = 5 = expected latency.
    const source = deterministicStep(40, 25);
    const target = deterministicStep(40, 30);
    const result = computePropagationVelocity(source, target, {
      useBOCPD: false,
      expectedDirectLatency: 5,
      latencyStddevMultiplier: 0,
    });

    expect(result.propagationDelay).toBe(5);
    expect(result.propagationProbability).toBeGreaterThan(0);
    expect(result.isDirectPropagation).toBe(true);
  });
});
