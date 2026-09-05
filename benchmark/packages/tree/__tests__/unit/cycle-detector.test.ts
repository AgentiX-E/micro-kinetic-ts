import { describe, it, expect } from 'vitest';
import {
  JohnsonCycleDetector,
  buildAdjacencyList,
  tarjanSCC,
  cycleKey,
} from '@agentix-e/micro-kinetic-tree';
import type { JohnsonCycleOptions } from '@agentix-e/micro-kinetic-tree';

describe('JohnsonCycleDetector', () => {
  const detector = new JohnsonCycleDetector();

  it('returns empty array for DAG (no cycles)', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
      ['A', 'C'],
    ];
    const cycles = detector.detect(edges);
    expect(cycles).toEqual([]);
  });

  it('detects a single 2-node cycle (A→B→A)', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'A'],
    ];
    const cycles = detector.detect(edges);
    expect(cycles).toHaveLength(1);
    const path = cycles[0]!.nodePath;
    expect(path.length).toBe(2);
    expect(path).toContain('A');
    expect(path).toContain('B');
  });

  it('detects a 3-node cycle (A→B→C→A)', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ];
    const cycles = detector.detect(edges);
    expect(cycles).toHaveLength(1);
    const path = cycles[0]!.nodePath;
    expect(path.length).toBe(3);
    expect(new Set(path)).toEqual(new Set(['A', 'B', 'C']));
  });

  it('detects multiple cycles', () => {
    // Graph: A→B, B→C, C→A, B→A
    // Cycles: A-B-C-A and A-B-A
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
      ['B', 'A'],
    ];
    const cycles = detector.detect(edges);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
  });

  it('handles disconnected graph', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
      ['X', 'Y'],
      ['Y', 'Z'],
    ];
    const cycles = detector.detect(edges);
    expect(cycles).toEqual([]);
  });

  it('respects maxCycles option', () => {
    // Create graph with many cycles
    const edges: Array<readonly [string, string]> = [];
    // Complete graph K4 has many cycles: A-B-A, A-B-C-A, etc.
    for (const from of ['A', 'B', 'C', 'D']) {
      for (const to of ['A', 'B', 'C', 'D']) {
        if (from !== to) {
          edges.push([from, to] as const);
        }
      }
    }
    const limited = new JohnsonCycleDetector({ maxCycles: 3 });
    const cycles = limited.detect(edges);
    expect(cycles.length).toBeLessThanOrEqual(3);
  });

  it('respects maxCycleLength option', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'A'],
    ];
    const limited = new JohnsonCycleDetector({ maxCycleLength: 2 });
    const cycles = limited.detect(edges);
    // The 3-cycle should be filtered out but the 2-cycles might remain
    for (const c of cycles) {
      expect(c.nodePath.length).toBeLessThanOrEqual(2);
    }
  });

  it('throws on empty edges array', () => {
    expect(() => detector.detect([])).toThrow();
  });

  it('uses custom options in constructor', () => {
    const custom = new JohnsonCycleDetector({ maxCycles: 50, maxCycleLength: 10 });
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'], ['B', 'A'],
    ];
    const cycles = custom.detect(edges);
    expect(cycles).toHaveLength(1);
  });

  it('detectWithContributions classifies by threshold', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'], ['B', 'A'],
    ];
    const contributions = new Map<string, number>();
    contributions.set('A→B', 0.5);
    const result = detector.detectWithContributions(edges, contributions, 0.3);
    expect(result).toHaveLength(1);
    expect(result[0]!.significant).toBe(true);
    expect(result[0]!.contribution).toBeCloseTo(0.5);
  });

  it('detectWithContributions handles contribution below threshold', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'], ['B', 'A'],
    ];
    const contributions = new Map<string, number>();
    contributions.set('A→B', 0.1);
    const result = detector.detectWithContributions(edges, contributions, 0.3);
    expect(result[0]!.significant).toBe(false);
  });

  it('handles SCC with back-edges to earlier-indexed nodes', () => {
    // 4-node cycle creates an SCC where later iterations
    // have edges pointing to nodes already removed from consideration
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'A'],
    ];
    const detector = new JohnsonCycleDetector();
    const cycles = detector.detect(edges);
    expect(cycles.length).toBeGreaterThanOrEqual(1);
    // All cycles should contain valid service IDs
    for (const c of cycles) {
      expect(c.nodePath.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('detectWithContributions returns 0 when cycle key not in contributions map', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'], ['B', 'A'],
    ];
    const contributions = new Map<string, number>();
    // Empty contributions map → all cycles get contribution 0 via ?? 0
    const result = detector.detectWithContributions(edges, contributions, 0.3);
    expect(result).toHaveLength(1);
    expect(result[0]!.contribution).toBe(0);
    expect(result[0]!.significant).toBe(false);
  });
});

describe('buildAdjacencyList', () => {
  it('builds adjacency from edge list', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'C'],
    ];
    const adj = buildAdjacencyList(edges);
    expect(adj.get('A')).toEqual(['B', 'C']);
    expect(adj.get('B')).toEqual(['C']);
    expect(adj.get('C')).toEqual([]);
  });

  it('handles empty edge list', () => {
    const adj = buildAdjacencyList([]);
    expect(adj.size).toBe(0);
  });

  it('ensures target nodes exist even if only as target', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
    ];
    const adj = buildAdjacencyList(edges);
    expect(adj.has('A')).toBe(true);
    expect(adj.has('B')).toBe(true);
    expect(adj.get('B')).toEqual([]);
  });
});

describe('tarjanSCC', () => {
  it('finds SCC in a graph with mutual reachability', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'A'],
      ['C', 'D'],
    ];
    const adj = buildAdjacencyList(edges);
    const sccs = tarjanSCC(adj);
    // Should find SCCs
    expect(sccs.length).toBeGreaterThan(0);
  });

  it('finds single-node SCCs in DAG', () => {
    const edges: Array<readonly [string, string]> = [
      ['A', 'B'],
      ['B', 'C'],
    ];
    const adj = buildAdjacencyList(edges);
    const sccs = tarjanSCC(adj);
    // Each node is its own SCC in a DAG
    expect(sccs.length).toBe(3);
  });

  it('handles empty graph', () => {
    const adj = buildAdjacencyList([]);
    const sccs = tarjanSCC(adj);
    expect(sccs).toEqual([]);
  });
});

describe('cycleKey', () => {
  it('returns empty string for empty path', () => {
    expect(cycleKey([])).toBe('');
  });

  it('rotates to lexicographically smallest representation', () => {
    // 'A→B→C' rotated: ABC, BCA, CAB → 'A→B→C' is smallest
    const key1 = cycleKey(['A', 'B', 'C']);
    const key2 = cycleKey(['B', 'C', 'A']);
    expect(key1).toBe(key2);
  });

  it('produces arrow-joined string', () => {
    const key = cycleKey(['S1', 'S2', 'S3']);
    expect(key).toContain('→');
    expect(key.split('→')).toHaveLength(3);
  });
});
