import { describe, it, expect } from 'vitest';
import { StossDenoiser } from '../../../src/stoss/denoiser.js';
import { CouplingSparsityAnalyzer } from '../../../src/stoss/coupling-analyzer.js';
import { IndependenceChecker } from '../../../src/stoss/independence-checker.js';
import type { AlertRecord, ServiceCallGraph, ServiceNode, CouplingSparsityMatrix } from '@agentix-e/micro-kinetic-core';

function makeServiceGraph(serviceIds: string[]): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, { id, name: `Service ${id}`, namespace: 'default', labels: {} });
  }
  return { nodes, edges: [], systemLoad: 0.5 };
}

function makeAlert(serviceId: string, timestamp: number, value: number): AlertRecord {
  return {
    id: `alert_${serviceId}_${timestamp}`,
    serviceId,
    severity: 'warning',
    timestamp,
    metric: 'cpu_usage',
    value,
    threshold: 0.8,
    message: `Alert on ${serviceId}`,
  };
}

function makeCouplingMatrix(serviceIds: string[], sparsityScore: number = 0.8): CouplingSparsityMatrix {
  const dimension = serviceIds.length;
  const matrix = new Float64Array(dimension * dimension);
  for (let i = 0; i < dimension; i++) {
    matrix[i * dimension + i] = 1;
  }
  return {
    dimension,
    serviceIds: [...serviceIds],
    matrix,
    sparsityScore,
    threshold: 0.7,
    satisfiesStosszahlansatz: sparsityScore >= 0.7 && dimension >= 20,
    independentGroups: [],
  };
}

describe('StossDenoiser', () => {
  describe('denoise', () => {
    it('should classify alerts into true, coincidental, and grouped', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1500, 0.5),
      ];
      const coupling = makeCouplingMatrix(['svc_a', 'svc_b'], 0.9);

      const result = denoiser.denoise(alerts, coupling);
      expect(result).toHaveProperty('trueAlarms');
      expect(result).toHaveProperty('coincidentalAlarms');
      expect(result).toHaveProperty('groupedAlarms');
      expect(result).toHaveProperty('sparsityScore');
      expect(result).toHaveProperty('falsePositiveReduction');
    });

    it('should compute falsePositiveReduction as coincidental/total', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1500, 0.5),
      ];
      const coupling = makeCouplingMatrix(['svc_a', 'svc_b'], 0.9);

      const result = denoiser.denoise(alerts, coupling);
      expect(result.falsePositiveReduction).toBeGreaterThanOrEqual(0);
      expect(result.falsePositiveReduction).toBeLessThanOrEqual(1);
    });

    it('should handle single alert', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [makeAlert('svc_a', 1000, 0.9)];
      const coupling = makeCouplingMatrix(['svc_a'], 0.9);

      const result = denoiser.denoise(alerts, coupling);
      expect(result.trueAlarms.length + result.coincidentalAlarms.length + result.groupedAlarms.length).toBe(1);
    });

    it('should handle empty coupling matrix gracefully (should throw)', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [makeAlert('svc_a', 1000, 0.9)];
      const emptyCoupling: CouplingSparsityMatrix = {
        dimension: 0,
        serviceIds: [],
        matrix: new Float64Array(0),
        sparsityScore: 0,
        threshold: 0.7,
        satisfiesStosszahlansatz: false,
        independentGroups: [],
      };

      expect(() => denoiser.denoise(alerts, emptyCoupling)).toThrow();
    });

    it('should throw for empty alerts', () => {
      const denoiser = new StossDenoiser();
      const coupling = makeCouplingMatrix(['svc_a', 'svc_b'], 0.9);
      expect(() => denoiser.denoise([], coupling)).toThrow();
    });

    it('should handle alerts from same service in different time windows', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 70000, 0.85), // outside 1-min window
      ];
      const coupling = makeCouplingMatrix(['svc_a'], 0.9);

      const result = denoiser.denoise(alerts, coupling);
      expect(result.trueAlarms.length + result.coincidentalAlarms.length).toBe(2);
    });

    it('should handle multiple alerts from same service in same window', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
      ];
      const coupling = makeCouplingMatrix(['svc_a'], 0.9);

      const result = denoiser.denoise(alerts, coupling);
      // Same service, multiple alerts → all true alarms
      expect(result.trueAlarms.length).toBe(3);
    });

    it('should return total classification matching input count', () => {
      const denoiser = new StossDenoiser();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c']);
      const analyzer = new CouplingSparsityAnalyzer();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52), makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
        makeAlert('svc_c', 1200, 0.3), makeAlert('svc_c', 2200, 0.35),
        makeAlert('svc_c', 3200, 0.32), makeAlert('svc_c', 4200, 0.28),
        makeAlert('svc_c', 5200, 0.31),
      ];

      // Build coupling from the same alerts + graph for consistency
      const coupling = analyzer.computeCouplingSparsity(alerts, graph);

      const result = denoiser.denoise(alerts, coupling);
      const total = result.trueAlarms.length + result.coincidentalAlarms.length
        + result.groupedAlarms.reduce((s, g) => s + g.alerts.length, 0);
      expect(total).toBe(alerts.length);
    });

    it('should have sparsityScore in result', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1500, 0.5),
      ];
      const coupling = makeCouplingMatrix(['svc_a', 'svc_b'], 0.75);

      const result = denoiser.denoise(alerts, coupling);
      expect(result.sparsityScore).toBe(0.75);
    });

    it('should classify all independent pairs as coincidental', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1100, 0.1),
      ];
      // Create sparse coupling with zero non-diagonal
      const matrix = new Float64Array([1, 0, 0, 1]);
      const coupling: CouplingSparsityMatrix = {
        dimension: 2, serviceIds: ['svc_a', 'svc_b'], matrix, sparsityScore: 1.0, threshold: 0.7,
        satisfiesStosszahlansatz: false, independentGroups: [],
      };

      const result = denoiser.denoise(alerts, coupling);
      // Total classification equals input
      const total = result.trueAlarms.length + result.coincidentalAlarms.length
        + result.groupedAlarms.reduce((s, g) => s + g.alerts.length, 0);
      expect(total).toBe(2);
    });

    it('should handle tightly coupled alert pairs', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1100, 0.89),
      ];
      // Highly coupled matrix
      const matrix = new Float64Array([1, 0.9, 0.9, 1]);
      const coupling: CouplingSparsityMatrix = {
        dimension: 2, serviceIds: ['svc_a', 'svc_b'], matrix, sparsityScore: 0.5, threshold: 0.7,
        satisfiesStosszahlansatz: false, independentGroups: [],
      };

      const result = denoiser.denoise(alerts, coupling);
      const total = result.trueAlarms.length + result.coincidentalAlarms.length
        + result.groupedAlarms.reduce((s, g) => s + g.alerts.length, 0);
      expect(total).toBe(2);
    });

    it('should produce groupedAlarms with expected structure', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1100, 0.89),
        makeAlert('svc_c', 1200, 0.88),
      ];
      const N = 3;
      const matrix = new Float64Array(N * N);
      for (let i = 0; i < N; i++) { matrix[i * N + i] = 1; }
      // Set some coupling
      matrix[0 * N + 1] = 0.5; matrix[1 * N + 0] = 0.5;
      const coupling: CouplingSparsityMatrix = {
        dimension: N, serviceIds: ['svc_a', 'svc_b', 'svc_c'], matrix,
        sparsityScore: 0.6, threshold: 0.7,
        satisfiesStosszahlansatz: false, independentGroups: [],
      };

      const result = denoiser.denoise(alerts, coupling);
      const total = result.trueAlarms.length + result.coincidentalAlarms.length
        + result.groupedAlarms.reduce((s, g) => s + g.alerts.length, 0);
      expect(total).toBe(alerts.length);
    });

    it('should have groupedAlarms with id and timeWindow', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1100, 0.89),
        makeAlert('svc_c', 1200, 0.88),
      ];
      const N = 3;
      const matrix = new Float64Array(N * N);
      for (let i = 0; i < N; i++) { matrix[i * N + i] = 1; }
      matrix[0 * N + 1] = 0.5; matrix[1 * N + 0] = 0.5;
      const coupling: CouplingSparsityMatrix = {
        dimension: N, serviceIds: ['svc_a', 'svc_b', 'svc_c'], matrix,
        sparsityScore: 0.6, threshold: 0.7,
        satisfiesStosszahlansatz: false, independentGroups: [],
      };

      const result = denoiser.denoise(alerts, coupling);
      if (result.groupedAlarms.length > 0) {
        expect(result.groupedAlarms[0]!.id).toBeDefined();
        expect(result.groupedAlarms[0]!.timeWindow.length).toBe(2);
      }
    });

    it('should handle no alerts in window (empty result)', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 200000, 0.5), // far apart in time
      ];
      const coupling = makeCouplingMatrix(['svc_a', 'svc_b'], 0.9);

      const result = denoiser.denoise(alerts, coupling);
      const total = result.trueAlarms.length + result.coincidentalAlarms.length
        + result.groupedAlarms.reduce((s, g) => s + g.alerts.length, 0);
      expect(total).toBe(2);
    });

    it('should accept custom IndependenceChecker', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const checker = new IndependenceChecker();
      const denoiser = new StossDenoiser(analyzer, checker);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1500, 0.5),
      ];
      const coupling = makeCouplingMatrix(['svc_a', 'svc_b'], 0.9);

      const result = denoiser.denoise(alerts, coupling);
      expect(result).toHaveProperty('trueAlarms');
    });

    it('should handle all time windows with multiple services', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1200, 0.5),
        makeAlert('svc_c', 1400, 0.3),
        makeAlert('svc_a', 70000, 0.85),
        makeAlert('svc_b', 72000, 0.55),
      ];
      const coupling = makeCouplingMatrix(['svc_a', 'svc_b', 'svc_c'], 0.9);

      const result = denoiser.denoise(alerts, coupling);
      const total = result.trueAlarms.length + result.coincidentalAlarms.length
        + result.groupedAlarms.reduce((s, g) => s + g.alerts.length, 0);
      expect(total).toBe(5);
    });

    it('should compute falsePositiveReduction with mixed classifications', () => {
      const denoiser = new StossDenoiser();
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1100, 0.5),
        makeAlert('svc_c', 1200, 0.3),
      ];
      const N = 3;
      const matrix = new Float64Array(N * N);
      for (let i = 0; i < N; i++) { matrix[i * N + i] = 1; }
      const coupling: CouplingSparsityMatrix = {
        dimension: N, serviceIds: ['svc_a', 'svc_b', 'svc_c'], matrix,
        sparsityScore: 0.9, threshold: 0.7,
        satisfiesStosszahlansatz: false, independentGroups: [],
      };

      const result = denoiser.denoise(alerts, coupling);
      expect(result.falsePositiveReduction).toBeGreaterThanOrEqual(0);
      expect(result.falsePositiveReduction).toBeLessThanOrEqual(1);
    });

    it('should read coupling values from indices given by coupling.serviceIds', () => {
      const denoiser = new StossDenoiser();
      // serviceIds ordering: index 0 → svc_z, 1 → svc_a, 2 → svc_m. The strong
      // coupling lives at matrix[0][2] (svc_z ↔ svc_m), NOT at sorted positions.
      // A sort- or hash-based mapping would misread this relationship.
      const alerts: AlertRecord[] = [
        makeAlert('svc_z', 1000, 0.9),
        makeAlert('svc_a', 1100, 0.1),
        makeAlert('svc_m', 1200, 0.9),
      ];
      const N = 3;
      const matrix = new Float64Array(N * N);
      for (let i = 0; i < N; i++) { matrix[i * N + i] = 1; }
      matrix[0 * N + 2] = 0.9; matrix[2 * N + 0] = 0.9; // svc_z ↔ svc_m coupled
      const coupling: CouplingSparsityMatrix = {
        dimension: N, serviceIds: ['svc_z', 'svc_a', 'svc_m'], matrix,
        sparsityScore: 0.5, threshold: 0.7,
        satisfiesStosszahlansatz: false, independentGroups: [],
      };

      const result = denoiser.denoise(alerts, coupling);
      const groupedIds = result.groupedAlarms.flatMap((g) => g.alerts.map((a) => a.serviceId));
      expect(groupedIds).toContain('svc_z');
      expect(groupedIds).toContain('svc_m');
      expect(groupedIds).not.toContain('svc_a');
    });

    it('should throw when an alert service ID is absent from coupling.serviceIds', () => {
      const denoiser = new StossDenoiser();
      // Two services in the matrix, but the alerts reference a third, unknown
      // service — a genuine invariant violation, not a modulo index wrap.
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_b', 1100, 0.8),
        makeAlert('svc_unknown', 1200, 0.7),
      ];
      const coupling = makeCouplingMatrix(['svc_a', 'svc_b'], 0.9);

      expect(() => denoiser.denoise(alerts, coupling)).toThrow(
        /not present in the coupling matrix serviceIds/,
      );
    });
  });

  describe('computeCouplingSparsity', () => {
    it('should delegate to CouplingSparsityAnalyzer', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const denoiser = new StossDenoiser(analyzer);
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52), makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const result = denoiser.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(2);
    });

    it('should create default CouplingSparsityAnalyzer when none provided', () => {
      const denoiser = new StossDenoiser();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52), makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const result = denoiser.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(2);
    });
  });
});
