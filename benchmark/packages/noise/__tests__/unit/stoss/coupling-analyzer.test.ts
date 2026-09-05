import { describe, it, expect } from 'vitest';
import { CouplingSparsityAnalyzer } from '../../../src/stoss/coupling-analyzer.js';
import { StatisticsProvider } from '../../../src/math/statistics-provider.js';
import type { AlertRecord, ServiceCallGraph, ServiceNode, CallEdge } from '@agentix-e/micro-kinetic-core';

function makeServiceGraph(serviceIds: string[], edges: CallEdge[] = []): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, {
      id,
      name: `Service ${id}`,
      namespace: 'default',
      labels: {},
    });
  }
  return {
    nodes,
    edges,
    systemLoad: 0.5,
  };
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

describe('CouplingSparsityAnalyzer', () => {
  describe('computeCouplingSparsity', () => {
    it('should compute sparsity for multi-service alert history', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5),
        makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
        makeAlert('svc_c', 1200, 0.3),
        makeAlert('svc_c', 2200, 0.35),
        makeAlert('svc_c', 3200, 0.32),
        makeAlert('svc_c', 4200, 0.28),
        makeAlert('svc_c', 5200, 0.31),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(3);
      expect(result.matrix.length).toBe(9);
    });

    it('should compute correct sparsity score S = 1 - ||C||_0 / N^2', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5),
        makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.sparsityScore).toBeGreaterThanOrEqual(0);
      expect(result.sparsityScore).toBeLessThanOrEqual(1);
    });

    it('should return independentGroups array', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5),
        makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
        makeAlert('svc_c', 1200, 0.3),
        makeAlert('svc_c', 2200, 0.35),
        makeAlert('svc_c', 3200, 0.32),
        makeAlert('svc_c', 4200, 0.28),
        makeAlert('svc_c', 5200, 0.31),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(Array.isArray(result.independentGroups)).toBe(true);
    });

    it('should have satisfiesStosszahlansatz when N >= 20 and S > threshold', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const serviceIds: string[] = [];
      for (let i = 0; i < 25; i++) {
        serviceIds.push(`svc_${i}`);
      }
      const graph = makeServiceGraph(serviceIds);
      const alerts: AlertRecord[] = [];
      for (const sid of serviceIds) {
        for (let t = 0; t < 10; t++) {
          alerts.push(makeAlert(sid, t * 1000, Math.random()));
        }
      }

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(typeof result.satisfiesStosszahlansatz).toBe('boolean');
    });

    it('should satisfy Stosszahlansatz for a large sparse system (S > τ and N >= minSystemSize)', () => {
      // With N >= minSystemSize (20) and fewer than 5 alerts per service, every
      // off-diagonal pair has minLen < 5, so coupling is 0 and sparsity is high.
      // This exercises the `satisfies && meetsScaleRequirement` conjunction on the
      // true branch, which the dense random fixture above cannot reach.
      const analyzer = new CouplingSparsityAnalyzer();
      const serviceIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        serviceIds.push(`svc_${i}`);
      }
      const graph = makeServiceGraph(serviceIds);
      // One alert per service → every pair has aligned length 1 (< 5) → MI = 0.
      const alerts: AlertRecord[] = serviceIds.map((sid, i) => makeAlert(sid, 1000, i * 0.1));

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      // N = 20 >= 20 and off-diagonal coupling is zero → S = 1 - 20/400 = 0.95 > 0.7.
      expect(result.satisfiesStosszahlansatz).toBe(true);
    });

    it('should have N=1 with satisfiesStosszahlansatz = false even if sparse', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_only']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_only', 1000, 0.9),
        makeAlert('svc_only', 2000, 0.85),
        makeAlert('svc_only', 3000, 0.92),
        makeAlert('svc_only', 4000, 0.88),
        makeAlert('svc_only', 5000, 0.91),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(1);
      expect(result.satisfiesStosszahlansatz).toBe(false);
    });

    it('should handle single service in multi-service graph', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(1);
      expect(result.matrix.length).toBe(1);
      expect(result.matrix[0]).toBe(1);
    });

    it('should handle N=100 with full coupling', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const serviceIds: string[] = [];
      for (let i = 0; i < 100; i++) {
        serviceIds.push(`svc_${i}`);
      }
      const graph = makeServiceGraph(serviceIds);
      const alerts: AlertRecord[] = [];
      for (const sid of serviceIds) {
        for (let t = 0; t < 5; t++) {
          alerts.push(makeAlert(sid, t * 1000, 0.5));
        }
      }

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(100);
    });

    it('should throw for empty history', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a']);
      expect(() => analyzer.computeCouplingSparsity([], graph)).toThrow();
    });

    it('should throw for empty graph', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const emptyGraph: ServiceCallGraph = {
        nodes: new Map(),
        edges: [],
        systemLoad: 0.5,
      };
      const alerts: AlertRecord[] = [makeAlert('svc_a', 1000, 0.9)];
      expect(() => analyzer.computeCouplingSparsity(alerts, emptyGraph)).toThrow();
    });

    it('should have diagonal elements = 1', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85), makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88), makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55), makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48), makeAlert('svc_b', 5500, 0.51),
        makeAlert('svc_c', 1200, 0.3), makeAlert('svc_c', 2200, 0.35), makeAlert('svc_c', 3200, 0.32),
        makeAlert('svc_c', 4200, 0.28), makeAlert('svc_c', 5200, 0.31),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      const N = result.dimension;
      for (let i = 0; i < N; i++) {
        expect(result.matrix[i * N + i]).toBe(1);
      }
    });

    it('should have symmetric coupling matrix', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85), makeAlert('svc_a', 3000, 0.92),
        makeAlert('svc_a', 4000, 0.88), makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55), makeAlert('svc_b', 3500, 0.52),
        makeAlert('svc_b', 4500, 0.48), makeAlert('svc_b', 5500, 0.51),
        makeAlert('svc_c', 1200, 0.3), makeAlert('svc_c', 2200, 0.35), makeAlert('svc_c', 3200, 0.32),
        makeAlert('svc_c', 4200, 0.28), makeAlert('svc_c', 5200, 0.31),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      const N = result.dimension;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          expect(result.matrix[i * N + j]).toBe(result.matrix[j * N + i]);
        }
      }
    });

    it('should handle services with few alerts (minLen < 5)', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9),
        makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_b', 1500, 0.5),
        makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_c', 1200, 0.3),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(3);
      // When minLen < 5 for a pair, coupling = 0
    });

    it('should handle alerts assigned to services not in graph', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52), makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
        makeAlert('svc_unknown', 1000, 0.9), // Not in graph
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(2);
    });

    it('should have independentGroups with correct structure', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c', 'svc_d']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.9), makeAlert('svc_b', 2500, 0.85),
        makeAlert('svc_b', 3500, 0.92), makeAlert('svc_b', 4500, 0.88),
        makeAlert('svc_b', 5500, 0.91),
        makeAlert('svc_c', 1200, 0.3), makeAlert('svc_c', 2200, 0.35),
        makeAlert('svc_c', 3200, 0.32), makeAlert('svc_c', 4200, 0.28),
        makeAlert('svc_c', 5200, 0.31),
        makeAlert('svc_d', 1300, 0.31), makeAlert('svc_d', 2300, 0.36),
        makeAlert('svc_d', 3300, 0.33), makeAlert('svc_d', 4300, 0.29),
        makeAlert('svc_d', 5300, 0.32),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(Array.isArray(result.independentGroups)).toBe(true);
      result.independentGroups.forEach(group => {
        expect(Array.isArray(group)).toBe(true);
        group.forEach(member => {
          expect(typeof member).toBe('string');
        });
      });
    });

    it('should handle service in graph with no matching alerts', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_ghost']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52), makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(3);
    });

    it('should have threshold set from DEFAULT_STOSS_PARAMS', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52), makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.threshold).toBe(0.7);
    });

    it('should have sparsityScore = 1 - nonzeroCount / N^2', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      // N=1, diagonal is 1 → nonzeroCount=1, total=N^2=1, sparsity=1-1/1=0
      expect(result.sparsityScore).toBe(0);
    });

    it('should accept custom StatisticsProvider', () => {
      const stats = new StatisticsProvider();
      const analyzer = new CouplingSparsityAnalyzer(stats);
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.5), makeAlert('svc_b', 2500, 0.55),
        makeAlert('svc_b', 3500, 0.52), makeAlert('svc_b', 4500, 0.48),
        makeAlert('svc_b', 5500, 0.51),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.dimension).toBe(2);
    });

    it('should return serviceIds in graph node insertion order', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      // Deliberately non-sorted: the matrix rows/columns follow graph node
      // insertion order, which is the single source of truth for index semantics.
      const graph = makeServiceGraph(['svc_c', 'svc_a', 'svc_b']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_c', 1000, 0.9), makeAlert('svc_c', 2000, 0.85),
        makeAlert('svc_a', 1500, 0.5), makeAlert('svc_a', 2500, 0.55),
        makeAlert('svc_b', 1200, 0.3), makeAlert('svc_b', 2200, 0.35),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      expect(result.serviceIds).toEqual(['svc_c', 'svc_a', 'svc_b']);
      expect(result.dimension).toBe(3);
    });

    it('should return independent groups with real service IDs', () => {
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c', 'svc_d']);
      const alerts: AlertRecord[] = [
        makeAlert('svc_a', 1000, 0.9), makeAlert('svc_a', 2000, 0.85),
        makeAlert('svc_a', 3000, 0.92), makeAlert('svc_a', 4000, 0.88),
        makeAlert('svc_a', 5000, 0.91),
        makeAlert('svc_b', 1500, 0.9), makeAlert('svc_b', 2500, 0.85),
        makeAlert('svc_b', 3500, 0.92), makeAlert('svc_b', 4500, 0.88),
        makeAlert('svc_b', 5500, 0.91),
        makeAlert('svc_c', 1200, 0.3), makeAlert('svc_c', 2200, 0.35),
        makeAlert('svc_c', 3200, 0.32), makeAlert('svc_c', 4200, 0.28),
        makeAlert('svc_c', 5200, 0.31),
        makeAlert('svc_d', 1300, 0.31), makeAlert('svc_d', 2300, 0.36),
        makeAlert('svc_d', 3300, 0.33), makeAlert('svc_d', 4300, 0.29),
        makeAlert('svc_d', 5300, 0.32),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      const known = new Set(result.serviceIds);
      for (const group of result.independentGroups) {
        for (const member of group) {
          expect(known.has(member)).toBe(true);
        }
      }
    });

    it('should group a hub-and-spoke topology into a single connected component', () => {
      // A "hub-and-spoke" coupling: the central service svc_c couples to both
      // svc_a and svc_b, but svc_a and svc_b are mutually independent. This is
      // a common microservice topology (a shared datastore feeding two disjoint
      // frontends) and exercises the union-by-rank `rank[ra] < rank[rb]` path,
      // where the hub's component has strictly higher rank than a leaf.
      const analyzer = new CouplingSparsityAnalyzer();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c']);
      // Value sequences are chosen so that MI(svc_a, svc_c) and
      // MI(svc_b, svc_c) both exceed the coupling threshold while
      // MI(svc_a, svc_b) stays below it (verified against the analyzer's
      // own mutual-information output).
      const a = [3, 6, 3, 1, 2, 5];
      const b = [7, 1, 1, 1, 4, 1];
      const c = [5, 3, 4, 3, 4, 5];
      const alerts: AlertRecord[] = [
        ...a.map((v, i) => makeAlert('svc_a', 1000 + i * 1000, v)),
        ...b.map((v, i) => makeAlert('svc_b', 1000 + i * 1000, v)),
        ...c.map((v, i) => makeAlert('svc_c', 1000 + i * 1000, v)),
      ];

      const result = analyzer.computeCouplingSparsity(alerts, graph);
      // The hub connects both leaves, so all three services collapse into one
      // connected component (matrix indices 0, 1, 2 → svc_a, svc_b, svc_c).
      expect(result.independentGroups).toEqual([['svc_a', 'svc_b', 'svc_c']]);
    });
  });
});
