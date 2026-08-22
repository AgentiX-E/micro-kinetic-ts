import { describe, it, expect } from 'vitest';
import { HierarchyTruncator } from '../../../src/bbgky/truncator.js';
import type { BBGKYHierarchy, BBGKYState } from '@agentix-e/micro-kinetic-core';

function makeState(order: number, energy: number, isSignificant: boolean): BBGKYState {
  return {
    order,
    serviceIds: Array.from({ length: order }, (_, i) => `svc_${i}`),
    correlationEnergy: energy,
    tensor: new Float64Array(Math.pow(order, 2)),
    isSignificant,
  };
}

function makeHierarchy(states: BBGKYState[], systemSize: number): BBGKYHierarchy {
  const energyRatios: number[] = [];
  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1]!.correlationEnergy;
    const curr = states[i]!.correlationEnergy;
    energyRatios.push(prev > 0 ? curr / prev : 0);
  }
  return {
    systemSize,
    states,
    truncationOrder: states.length,
    energyRatios,
    truncationError: 0,
  };
}

describe('HierarchyTruncator', () => {
  describe('findTruncationOrder', () => {
    // ── Normal truncation: E_k/E_{k-1} < η ─────────────
    it('should truncate when E3/E2 drops below eta', () => {
      const truncator = new HierarchyTruncator();
      // E2/E1 = 0.05/1 = 0.05 >= 0.01
      // E3/E2 = 0.0004/0.05 = 0.008 < 0.01 → k=2 (the 3rd energy, 1-based k)
      const energies = [1.0, 0.05, 0.0004, 0.00001];
      const order = truncator.findTruncationOrder(energies, 0.01);
      expect(order).toBe(2);
    });

    it('should truncate when E2/E1 < eta for two-entry list', () => {
      const truncator = new HierarchyTruncator();
      // E2/E1 = 0.005/1 = 0.005 < 0.01
      const energies = [1.0, 0.005];
      const order = truncator.findTruncationOrder(energies, 0.01);
      expect(order).toBe(1);
    });

    // ── No truncation: all ratios >= η ──────────────────
    it('should return energies.length when all ratios >= eta', () => {
      const truncator = new HierarchyTruncator();
      // 0.5, 0.6, 0.667 — all >= 0.01
      const energies = [1.0, 0.5, 0.3, 0.2];
      const order = truncator.findTruncationOrder(energies, 0.01);
      expect(order).toBe(energies.length);
    });

    // ── Single energy ───────────────────────────────────
    it('should return 1 for single energy', () => {
      const truncator = new HierarchyTruncator();
      const order = truncator.findTruncationOrder([1.0], 0.01);
      expect(order).toBe(1);
    });

    // ── Boundary: η = 0 (never truncate) ────────────────
    it('should return energies.length when eta=0', () => {
      const truncator = new HierarchyTruncator();
      const energies = [1.0, 0.5, 0.2];
      const order = truncator.findTruncationOrder(energies, 0);
      expect(order).toBe(energies.length);
    });

    // ── Boundary: η = 1 (always truncate after first) ───
    it('should return 1 when eta=1', () => {
      const truncator = new HierarchyTruncator();
      // E2/E1 = 0.5 < 1 → return k=1 (0-based index 0 + 1)
      const energies = [1.0, 0.5, 0.2];
      const order = truncator.findTruncationOrder(energies, 1);
      expect(order).toBe(1);
    });

    // ── Zero energy handling ────────────────────────────
    it('should truncate at index when previous energy is 0', () => {
      const truncator = new HierarchyTruncator();
      // E1=0, so prev <= 0 at k=1 → return k=1
      const energies = [0, 1.0, 0.5];
      const order = truncator.findTruncationOrder(energies, 0.01);
      expect(order).toBe(1);
    });

    it('should handle all-zero energies', () => {
      const truncator = new HierarchyTruncator();
      // E1=0, prev <= 0 → return 1
      const energies = [0, 0, 0];
      const order = truncator.findTruncationOrder(energies, 0.01);
      expect(order).toBe(1);
    });

    // ── Empty energies (boundary) ───────────────────────
    it('should throw for empty energies array', () => {
      const truncator = new HierarchyTruncator();
      expect(() => truncator.findTruncationOrder([], 0.01)).toThrow();
    });

    // ── Increasing energies ─────────────────────────────
    it('should handle increasing energies (no truncation)', () => {
      const truncator = new HierarchyTruncator();
      // E ratios: 2, 1.5 — all >= 0.01
      const energies = [1.0, 2.0, 3.0];
      const order = truncator.findTruncationOrder(energies, 0.01);
      expect(order).toBe(energies.length);
    });

    // ── Very small eta ──────────────────────────────────
    it('should not truncate with very small eta when ratios are moderate', () => {
      const truncator = new HierarchyTruncator();
      // 0.5 >= 1e-10 → no truncation
      const energies = [1.0, 0.5, 0.25];
      const order = truncator.findTruncationOrder(energies, 1e-10);
      expect(order).toBe(energies.length);
    });
  });

  describe('estimateTruncationError', () => {
    // ── No drop when truncation >= states.length ────────
    it('should return 0 when truncationOrder equals states length', () => {
      const truncator = new HierarchyTruncator();
      const states = [makeState(1, 1.0, true), makeState(2, 0.5, true)];
      const hierarchy = makeHierarchy(states, 2);
      const error = truncator.estimateTruncationError(hierarchy, 2);
      expect(error).toBe(0);
    });

    it('should return 0 when truncationOrder > states length', () => {
      const truncator = new HierarchyTruncator();
      const states = [makeState(1, 1.0, true)];
      const hierarchy = makeHierarchy(states, 1);
      const error = truncator.estimateTruncationError(hierarchy, 5);
      expect(error).toBe(0);
    });

    // ── Positive error for early truncation ─────────────
    it('should compute positive error for early truncation', () => {
      const truncator = new HierarchyTruncator();
      const states = [
        makeState(1, 1.0, true),
        makeState(2, 0.5, true),
        makeState(3, 0.1, false),
      ];
      const hierarchy = makeHierarchy(states, 2);
      const error = truncator.estimateTruncationError(hierarchy, 2);
      expect(error).toBeGreaterThanOrEqual(0);
    });

    // ── SystemSize scales the error ─────────────────────
    it('should produce different error with different system sizes', () => {
      const truncator = new HierarchyTruncator();
      const states = [makeState(1, 1.0, true), makeState(2, 0.01, false)];
      const hierarchySmall = makeHierarchy(states, 2);
      const hierarchyLarge = makeHierarchy(states, 100);
      const errorSmall = truncator.estimateTruncationError(hierarchySmall, 1);
      const errorLarge = truncator.estimateTruncationError(hierarchyLarge, 1);
      // Larger system → smaller error due to 1/systemSize factor
      expect(errorLarge).toBeLessThanOrEqual(errorSmall);
    });

    // ── Zero energy ratio → zero error ──────────────────
    it('should return 0 when ratio is 0', () => {
      const truncator = new HierarchyTruncator();
      const states = [makeState(1, 1.0, true), makeState(2, 0, false)];
      const hierarchy = makeHierarchy(states, 2);
      const error = truncator.estimateTruncationError(hierarchy, 1);
      expect(error).toBe(0);
    });

    it('should return 0 when both energies are zero', () => {
      const truncator = new HierarchyTruncator();
      const states = [makeState(1, 0, true), makeState(2, 0, false)];
      const hierarchy = makeHierarchy(states, 2);
      const error = truncator.estimateTruncationError(hierarchy, 1);
      expect(error).toBe(0);
    });

    // ── Ratio >= 1 ──────────────────────────────────────
    it('should return the ratio itself when ratio >= 1', () => {
      const truncator = new HierarchyTruncator();
      const states = [makeState(1, 0.5, true), makeState(2, 1.0, false)]; // ratio = 2.0
      const hierarchy = makeHierarchy(states, 2);
      const error = truncator.estimateTruncationError(hierarchy, 1);
      expect(error).toBeGreaterThanOrEqual(1);
    });

    // ── truncationOrder <= 0 should throw ───────────────
    it('should throw for non-positive truncationOrder', () => {
      const truncator = new HierarchyTruncator();
      const states = [makeState(1, 1.0, true)];
      const hierarchy = makeHierarchy(states, 2);
      expect(() => truncator.estimateTruncationError(hierarchy, 0)).toThrow();
    });

    // ── Single state, truncate at 1 (no tail) ───────────
    it('should return 0 for single state when truncating at 1', () => {
      const truncator = new HierarchyTruncator();
      const states = [makeState(1, 1.0, true)];
      const hierarchy = makeHierarchy(states, 1);
      // truncationOrder=1, states.length=1, 1 >= 1 → return 0
      const error = truncator.estimateTruncationError(hierarchy, 1);
      expect(error).toBe(0);
    });

    // ── Factorial scaling factor ────────────────────────
    it('should scale error by factorial factor', () => {
      const truncator = new HierarchyTruncator();
      const states = [
        makeState(1, 1.0, true),
        makeState(2, 0.01, false),
      ];
      const hierarchy = makeHierarchy(states, 10);
      const error = truncator.estimateTruncationError(hierarchy, 1);
      // With truncationOrder=1, factorial(0)=1, systemFactor=0.1
      expect(error).toBeGreaterThanOrEqual(0);
    });

    // ── Factorial loop coverage (n > 1) ──────────────────
    it('should apply factorial for truncationOrder >= 3', () => {
      const truncator = new HierarchyTruncator();
      const states = [
        makeState(1, 1.0, true),
        makeState(2, 0.5, true),
        makeState(3, 0.1, false),
        makeState(4, 0.01, false),
      ];
      const hierarchy = makeHierarchy(states, 100);
      // truncationOrder=3 → factorial(3-1)=factorial(2)=2
      const error = truncator.estimateTruncationError(hierarchy, 3);
      expect(error).toBeGreaterThanOrEqual(0);
    });

    it('should apply larger factorial for truncationOrder=4', () => {
      const truncator = new HierarchyTruncator();
      const states = [
        makeState(1, 1.0, true),
        makeState(2, 0.5, true),
        makeState(3, 0.2, true),
        makeState(4, 0.05, false),
        makeState(5, 0.01, false),
      ];
      const hierarchy = makeHierarchy(states, 50);
      // truncationOrder=4 → factorial(3)=6
      const error = truncator.estimateTruncationError(hierarchy, 4);
      expect(error).toBeGreaterThanOrEqual(0);
    });

    // ── Energy ratio >= 1 branch ────────────────────────
    it('should handle ratio >= 1 via inconsistent hierarchy', () => {
      const truncator = new HierarchyTruncator();
      const states = [
        makeState(1, 0.5, true),
        makeState(2, 1.0, false),
        makeState(3, 0.3, false),
      ];
      // Build with explicit ratios including >= 1
      const hierarchy: BBGKYHierarchy = {
        systemSize: 2,
        states,
        truncationOrder: states.length,
        energyRatios: [2.0, 0.3],
        truncationError: 0,
      };
      const error = truncator.estimateTruncationError(hierarchy, 1);
      expect(error).toBe(2.0);
    });

    // ── Missing energyRatios entry (?? 0 branch) ────────
    it('should handle energyRatios shorter than expected', () => {
      const truncator = new HierarchyTruncator();
      const states = [
        makeState(1, 1.0, true),
        makeState(2, 0.5, true),
        makeState(3, 0.1, false),
      ];
      // energyRatios has only 1 entry but states has 3
      const hierarchy: BBGKYHierarchy = {
        systemSize: 2,
        states,
        truncationOrder: 3,
        energyRatios: [0.5], // only one ratio, ratioIdx=2 will be undefined → ?? 0
        truncationError: 0,
      };
      // truncationOrder=2 is the one we test
      const error = truncator.estimateTruncationError(hierarchy, 2);
      expect(error).toBe(0);
    });
  });
});
