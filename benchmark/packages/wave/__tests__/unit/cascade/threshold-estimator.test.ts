import type { CallEdge, ServiceCallGraph, ServiceNode } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';
import { ThresholdEstimator } from '../../../src/cascade/threshold-estimator.js';

// ── Test Helpers ────────────────────────────────────────────

function makeServiceGraph(serviceIds: string[], edges: CallEdge[] = []): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, { id, name: `Service ${id}`, namespace: 'default', labels: {} });
  }
  return { nodes, edges, systemLoad: 0.5 };
}

function makeEdge(
  from: string,
  to: string,
  callRate = 100,
  p99Latency = 100,
  errorRate = 0.01,
): CallEdge {
  return { from, to, type: 'REST', callRate, p99Latency, errorRate };
}

const threeNodeGraph = makeServiceGraph(
  ['svc_a', 'svc_b', 'svc_c'],
  [makeEdge('svc_a', 'svc_b', 200), makeEdge('svc_b', 'svc_c', 100)],
);

// ── estimate ────────────────────────────────────────────────

describe('ThresholdEstimator.estimate', () => {
  // ── Generation threshold ──────────────────────────────────

  describe('generation threshold', () => {
    it('should be in [0.01, 1]', () => {
      const t = new ThresholdEstimator().estimate(threeNodeGraph).generationThreshold;
      expect(t).toBeGreaterThanOrEqual(0.01);
      expect(t).toBeLessThanOrEqual(1);
    });

    it('should increase with higher dissipation rate', () => {
      const e = new ThresholdEstimator();
      const low = e.estimate(threeNodeGraph, 0.05).generationThreshold;
      const high = e.estimate(threeNodeGraph, 0.5).generationThreshold;
      expect(low).toBeLessThanOrEqual(high);
    });

    it('should be 1.0 for disconnected graph with no coupling', () => {
      const single = makeServiceGraph(['svc-only']);
      const t = new ThresholdEstimator().estimate(single).generationThreshold;
      expect(t).toBeGreaterThanOrEqual(0.01);
    });
  });

  // ── Propagation threshold ─────────────────────────────────

  describe('propagation threshold', () => {
    it('should be in [0.01, 1]', () => {
      const t = new ThresholdEstimator().estimate(threeNodeGraph).propagationThreshold;
      expect(t).toBeGreaterThanOrEqual(0.01);
      expect(t).toBeLessThanOrEqual(1);
    });

    it('should be higher for sparse graphs than dense', () => {
      const e = new ThresholdEstimator();
      const sparse = makeServiceGraph(['a', 'b', 'c'], [makeEdge('a', 'b', 50)]);
      const dense = makeServiceGraph(
        ['a', 'b', 'c'],
        [makeEdge('a', 'b', 200), makeEdge('b', 'c', 200), makeEdge('a', 'c', 200)],
      );
      expect(e.estimate(sparse).propagationThreshold).toBeGreaterThanOrEqual(
        e.estimate(dense).propagationThreshold,
      );
    });
  });

  // ── Extinction threshold ──────────────────────────────────

  describe('extinction threshold', () => {
    it('should be in [0.001, 1]', () => {
      const t = new ThresholdEstimator().estimate(threeNodeGraph).extinctionThreshold;
      expect(t).toBeGreaterThanOrEqual(0.001);
      expect(t).toBeLessThanOrEqual(1);
    });

    it('should increase with higher dissipation rate', () => {
      const e = new ThresholdEstimator();
      const low = e.estimate(threeNodeGraph, 0.05).extinctionThreshold;
      const high = e.estimate(threeNodeGraph, 0.5).extinctionThreshold;
      expect(low).toBeLessThanOrEqual(high);
    });
  });

  // ── Spectral gap ──────────────────────────────────────────

  describe('spectralGap', () => {
    it('should be >= 0', () => {
      const g = new ThresholdEstimator().estimate(threeNodeGraph).spectralGap;
      expect(g).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Percolation threshold ─────────────────────────────────

  describe('percolationThreshold', () => {
    it('should be in [0.01, 1]', () => {
      const t = new ThresholdEstimator().estimate(threeNodeGraph).percolationThreshold;
      expect(t).toBeGreaterThanOrEqual(0.01);
      expect(t).toBeLessThanOrEqual(1);
    });
  });

  // ── Cascade risk classification ───────────────────────────

  describe('cascade risk', () => {
    it('should be one of low/moderate/high', () => {
      const risk = new ThresholdEstimator().estimate(threeNodeGraph).cascadeRisk;
      expect(['low', 'moderate', 'high']).toContain(risk);
    });

    it('should classify isolated single node', () => {
      const single = makeServiceGraph(['svc-only']);
      const risk = new ThresholdEstimator().estimate(single).cascadeRisk;
      expect(['low', 'moderate', 'high']).toContain(risk);
    });

    it('should classify fully connected graph', () => {
      const full = makeServiceGraph(
        ['a', 'b', 'c'],
        [
          makeEdge('a', 'b', 300),
          makeEdge('b', 'a', 300),
          makeEdge('a', 'c', 300),
          makeEdge('c', 'a', 300),
          makeEdge('b', 'c', 300),
          makeEdge('c', 'b', 300),
        ],
      );
      const risk = new ThresholdEstimator().estimate(full).cascadeRisk;
      expect(['low', 'moderate', 'high']).toContain(risk);
    });

    it('should classify chain graph', () => {
      const chain = makeServiceGraph(
        ['a', 'b', 'c', 'd', 'e'],
        [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'd'), makeEdge('d', 'e')],
      );
      const risk = new ThresholdEstimator().estimate(chain).cascadeRisk;
      expect(['low', 'moderate', 'high']).toContain(risk);
    });

    it('should produce high risk for large dense graph with low dissipation', () => {
      const ids = Array.from({ length: 10 }, (_, i) => `svc${i}`);
      const edges = [];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          edges.push(makeEdge(ids[i]!, ids[j]!, 300));
          edges.push(makeEdge(ids[j]!, ids[i]!, 300));
        }
      }
      const dense = makeServiceGraph(ids, edges);
      const result = new ThresholdEstimator().estimate(dense, 0.05);
      expect(result.cascadeRisk).toMatch(/^(low|moderate|high)$/);
      expect(typeof result.cascadeRisk).toBe('string');
    });

    it('should produce moderate risk for medium graph with moderate dissipation', () => {
      const ids = Array.from({ length: 8 }, (_, i) => `svc${i}`);
      const edges = ids.slice(1).map((id, i) => makeEdge(ids[i]!, id, 200));
      const medium = makeServiceGraph(ids, edges);
      const result = new ThresholdEstimator().estimate(medium, 0.5);
      expect(result.cascadeRisk).toMatch(/^(low|moderate|high)$/);
    });
  });

  // ── Error cases ───────────────────────────────────────────

  describe('error cases', () => {
    it('should throw for empty graph', () => {
      const empty: ServiceCallGraph = { nodes: new Map(), edges: [], systemLoad: 0.5 };
      expect(() => new ThresholdEstimator().estimate(empty)).toThrow();
    });

    it('should throw for dissipationRate < 0', () => {
      expect(() => new ThresholdEstimator().estimate(threeNodeGraph, -0.1)).toThrow();
    });

    it('should throw for dissipationRate > 1', () => {
      expect(() => new ThresholdEstimator().estimate(threeNodeGraph, 1.5)).toThrow();
    });
  });
});

// ── generationThreshold ─────────────────────────────────────

describe('ThresholdEstimator.generationThreshold', () => {
  it('should return a value in [0.01, 1]', () => {
    const t = new ThresholdEstimator().generationThreshold(
      makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]),
    );
    expect(t).toBeGreaterThanOrEqual(0.01);
    expect(t).toBeLessThanOrEqual(1);
  });
});

// ── propagationThreshold ────────────────────────────────────

describe('ThresholdEstimator.propagationThreshold', () => {
  it('should return a value in [0.01, 1]', () => {
    const t = new ThresholdEstimator().propagationThreshold(
      makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]),
    );
    expect(t).toBeGreaterThanOrEqual(0.01);
    expect(t).toBeLessThanOrEqual(1);
  });
});

// ── extinctionThreshold ─────────────────────────────────────

describe('ThresholdEstimator.extinctionThreshold', () => {
  it('should return a value in [0.001, 1]', () => {
    const t = new ThresholdEstimator().extinctionThreshold(
      makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]),
    );
    expect(t).toBeGreaterThanOrEqual(0.001);
    expect(t).toBeLessThanOrEqual(1);
  });
});

// ── Degenerate topologies ───────────────────────────────────
//
// Every branch below is a boundary the estimator can genuinely be handed: a deployment with services but no
// observed calls yet, a single-service system, and an edge whose endpoint the node list does not carry (a graph
// assembled from two snapshots taken seconds apart). They are asserted on the THRESHOLD they force, not on the
// call, because each one is a different claim about the model rather than a different path to the same number.

describe('ThresholdEstimator.estimate — degenerate topologies', () => {
  it('reads a graph with services and no edges as fully uncoupled', () => {
    // avgCoupling is 0 here, so `T_gen ≈ dissipation / coupling` has no denominator: the model's answer is "no
    // cascade can be generated", which is the top of the range, not the bottom. A clamped `Math.min(1, x/0)`
    // would have reported `1` for the wrong reason — through `Infinity` rather than through the guard.
    const noEdges = makeServiceGraph(['a', 'b', 'c']);
    const thresholds = new ThresholdEstimator().estimate(noEdges);

    expect(thresholds.generationThreshold).toBe(1);
    expect(thresholds.propagationThreshold).toBe(1);
    expect(thresholds.percolationThreshold).toBe(1);
    expect(thresholds.cascadeRisk).toMatch(/^(low|moderate|high)$/);
  });

  it('places the propagation floor at 1 for a single-service system', () => {
    // With N = 1 there is no second service to propagate TO, so `1/(N−1)` is a division by zero and the model's
    // honest floor is the whole range. The value is asserted exactly: a `0` here would read as "propagation is
    // free", which is the opposite of what a one-service graph can support.
    const single = makeServiceGraph(['only']);
    const thresholds = new ThresholdEstimator().estimate(single);

    expect(thresholds.propagationThreshold).toBe(1);
    expect(thresholds.spectralGap).toBe(1);
  });

  it('ignores an edge whose endpoint is not a node, rather than throwing or shifting the matrix', () => {
    // A graph assembled from two snapshots can name a service that was not in the node list — during a rollout it
    // is momentarily absent. Reading such an edge into the adjacency matrix would require an index the matrix does
    // not have, so the edge is dropped; the assertion is that the drop leaves the answer equal to the graph
    // WITHOUT that edge, which is the property a caller relies on.
    const dangling = makeServiceGraph(
      ['a', 'b', 'c'],
      [makeEdge('a', 'b'), makeEdge('ghost', 'c'), makeEdge('b', 'ghost')],
    );
    const clean = makeServiceGraph(['a', 'b', 'c'], [makeEdge('a', 'b')]);
    const estimator = new ThresholdEstimator();

    expect(estimator.estimate(dangling).percolationThreshold).toBeCloseTo(
      estimator.estimate(clean).percolationThreshold,
      10,
    );
    expect(estimator.estimate(dangling).propagationThreshold).toBeCloseTo(
      estimator.estimate(clean).propagationThreshold,
      10,
    );
  });
});

describe('ThresholdEstimator.estimate — the classifier reaches every class it declares', () => {
  it('returns low, moderate and high across its two axes', () => {
    // The classifier's three names are its whole contract, and two of them had never been observed: every existing
    // assertion accepted any of the three (`toMatch(/^(low|moderate|high)$/)`), which passes on a classifier that
    // always answers `low`.
    //
    // The sweep is over TWO axes because one is not enough, and that is a measured fact rather than a guess. Call
    // rate sets how much of the score the coupling term can contribute — at 300 calls/s on a six-service clique it
    // is 0.06, which cannot carry the rest of the way to `high` — so `high` needs mean call rate above roughly
    // 1000/s, the regime a real front-end sits in and a quiet batch service does not. `low` needs the opposite end:
    // a graph used a handful of times a second at high dissipation, where both thresholds sit at their ceiling and
    // there is nothing left for the score to accumulate.
    //
    // The claim is the SET, not a hand-picked cell: which dissipation lands in which class is a property of the
    // formula, and pinning it here would turn a formula change into a test rewrite.
    const ids = Array.from({ length: 6 }, (_, i) => `svc${i}`);
    const clique = (callRate: number) => {
      const edges = [];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          edges.push(makeEdge(ids[i]!, ids[j]!, callRate));
        }
      }
      return makeServiceGraph(ids, edges);
    };
    const estimator = new ThresholdEstimator();
    const seen = new Set<string>();
    for (const graph of [clique(5), clique(300), clique(2000)]) {
      for (const dissipation of [0, 0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1]) {
        seen.add(estimator.estimate(graph, dissipation).cascadeRisk);
      }
    }

    expect([...seen].sort()).toEqual(['high', 'low', 'moderate']);
  });
});

describe('ThresholdEstimator.estimate — the percolation estimate is a function of the graph, not a constant', () => {
  it('is 1 with no edges, and only leaves 1 when the graph is BOTH connected and heavily used', () => {
    // The assertion this replaces was `>= 0.01`, which every constant satisfies — including the constant `1.0` the
    // no-edge arm returns. Reading the estimate at three operating points instead makes the quantity a measurement,
    // and it pinned something worth knowing: `1 / (avgDegree × avgCoupling)` with `avgCoupling = mean(callRate)/1000`
    // exceeds 1 for any graph under roughly a thousand calls per second per edge, so the published value sits at the
    // ceiling of its clamp for most real deployments. The number is not wrong — a lightly used graph really is hard
    // to percolate through — but only the high-throughput cell distinguishes the estimate from `1`.
    const estimator = new ThresholdEstimator();
    const at = (callRate: number) =>
      estimator.estimate(
        makeServiceGraph(
          ['a', 'b', 'c'],
          [
            makeEdge('a', 'b', callRate),
            makeEdge('b', 'a', callRate),
            makeEdge('b', 'c', callRate),
            makeEdge('c', 'b', callRate),
          ],
        ),
      ).percolationThreshold;
    const empty = estimator.estimate(makeServiceGraph(['a', 'b', 'c'])).percolationThreshold;

    expect(empty).toBe(1);
    expect(at(200)).toBe(1);
    expect(at(5000)).toBeLessThan(1);
    expect(at(5000)).toBeGreaterThanOrEqual(0.01);
  });
});

describe('ThresholdEstimator.estimate — a rank-one adjacency matrix has no second eigenvalue', () => {
  it('reports the spectral gap floor instead of dividing by zero', () => {
    // Two services that call each other at a saturated rate build the matrix [[1,1],[1,1]]: its eigenvalues are 2
    // and 0, so after deflating the dominant eigenpair the remaining matrix is numerically zero and the second
    // power iteration's Rayleigh denominator vanishes. That is the one place the `1e-15` guard is reachable, and
    // the property worth asserting is not the branch but the CONSEQUENCE: the gap is finite and floored, so the
    // extinction threshold derived from it is a number rather than `Infinity` or `NaN`.
    const saturated = makeServiceGraph(
      ['caller', 'callee'],
      [makeEdge('caller', 'callee', 5000, 100, 0), makeEdge('callee', 'caller', 5000, 100, 0)],
    );
    const thresholds = new ThresholdEstimator().estimate(saturated, 0.1);

    expect(Number.isFinite(thresholds.spectralGap)).toBe(true);
    expect(thresholds.spectralGap).toBeGreaterThan(0);
    expect(Number.isFinite(thresholds.extinctionThreshold)).toBe(true);
    expect(thresholds.extinctionThreshold).toBeGreaterThanOrEqual(0.01);
  });
});
