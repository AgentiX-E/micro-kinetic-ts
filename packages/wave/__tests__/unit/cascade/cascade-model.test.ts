import type { CallEdge, ServiceCallGraph, ServiceNode } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';
import { WaveCascadeModel } from '../../../src/cascade/cascade-model.js';

// ── Test Helpers ────────────────────────────────────────────

function makeNode(id: string): ServiceNode {
  return { id, name: `Service ${id}`, namespace: 'default', labels: {} };
}

function makeServiceGraph(serviceIds: string[], edges: CallEdge[] = []): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, makeNode(id));
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

// ── simulateCascade ─────────────────────────────────────────

describe('WaveCascadeModel.simulateCascade', () => {
  /** 5-node graph with source='svc-a', normal parameters */
  const fiveNodeGraph = makeServiceGraph(
    ['svc-a', 'svc-b', 'svc-c', 'svc-d', 'svc-e'],
    [
      makeEdge('svc-a', 'svc-b', 100),
      makeEdge('svc-b', 'svc-c', 80),
      makeEdge('svc-c', 'svc-d', 60),
      makeEdge('svc-d', 'svc-e', 40),
    ],
  );

  const run = (graph = fiveNodeGraph, src = 'svc-a') =>
    new WaveCascadeModel().simulateCascade(src, graph);

  // ── Normal: 5-node, source='svc-a' ────────────────────────

  describe('five-node graph, source=svc-a, normal params', () => {
    const result = run();

    it('should set sourceServiceId to svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should have propagationDistance >= 0', () => {
      expect(result.propagationDistance).toBeGreaterThanOrEqual(0);
    });

    it('should have peakIntensity in [0, 1]', () => {
      expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.peakIntensity).toBeLessThanOrEqual(1);
    });

    it('should include all five services in intensityTrajectories', () => {
      expect(result.intensityTrajectories.size).toBe(5);
    });

    it('should have svc-a trajectory', () => {
      expect(result.intensityTrajectories.has('svc-a')).toBe(true);
    });

    it('should have svc-b trajectory', () => {
      expect(result.intensityTrajectories.has('svc-b')).toBe(true);
    });

    it('should have svc-c trajectory', () => {
      expect(result.intensityTrajectories.has('svc-c')).toBe(true);
    });

    it('should have svc-d trajectory', () => {
      expect(result.intensityTrajectories.has('svc-d')).toBe(true);
    });

    it('should have svc-e trajectory', () => {
      expect(result.intensityTrajectories.has('svc-e')).toBe(true);
    });

    it('should give each service a time series with at least one point', () => {
      for (const [, traj] of result.intensityTrajectories) {
        expect(traj.length).toBeGreaterThan(0);
      }
    });

    it('should have dissipated property as boolean', () => {
      expect(typeof result.dissipated).toBe('boolean');
    });

    it('should have timeToPeak >= 0', () => {
      expect(result.timeToPeak).toBeGreaterThanOrEqual(0);
    });

    it('should have source initial intensity = 1', () => {
      const traj = result.intensityTrajectories.get('svc-a')!;
      expect(traj[0]!.intensity).toBe(1);
    });

    it('should have non-source initial intensity = 0', () => {
      const traj = result.intensityTrajectories.get('svc-b')!;
      expect(traj[0]!.intensity).toBe(0);
    });
  });

  // ── Edge: Very long decay (may not dissipate) ─────────────

  describe('very long decay time', () => {
    const graph = makeServiceGraph(['svc-a', 'svc-b'], [makeEdge('svc-a', 'svc-b', 100)]);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', graph, {
      couplingStrength: 0.5,
      propagationSpeed: 1.0,
      decayTimeConstant: 600000, // very slow decay
      cascadeThreshold: 0.01,
      timeHorizon: 5000, // short horizon
    });

    it('should have dissipated as boolean', () => {
      expect(typeof result.dissipated).toBe('boolean');
    });

    it('should include both services', () => {
      expect(result.intensityTrajectories.size).toBe(2);
    });
  });

  // ── Edge: Cascade persists to end (not dissipated) ────────

  describe('non-dissipating cascade', () => {
    const isolated = makeServiceGraph(['svc-a']);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', isolated, {
      couplingStrength: 0.5,
      propagationSpeed: 1.0,
      decayTimeConstant: 900000, // very slow decay
      cascadeThreshold: 0.02,
      timeHorizon: 5000, // very short horizon
    });

    it('should have sourceServiceId svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should have dissolved as boolean', () => {
      expect(typeof result.dissipated).toBe('boolean');
    });

    it('should have peakIntensity in [0, 1]', () => {
      expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.peakIntensity).toBeLessThanOrEqual(1);
    });
  });

  // ── Edge: call without params (undefined params) ──────────

  describe('undefined params', () => {
    const graph = makeServiceGraph(['svc-a']);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', graph, undefined);

    it('should have sourceServiceId svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should have intensityTrajectories size 1', () => {
      expect(result.intensityTrajectories.size).toBe(1);
    });

    it('should have peakIntensity in [0, 1]', () => {
      expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.peakIntensity).toBeLessThanOrEqual(1);
    });
  });

  describe('isolated source node', () => {
    const isolated = makeServiceGraph(['svc-only']);
    const result = run(isolated, 'svc-only');

    it('should have sourceServiceId svc-only', () => {
      expect(result.sourceServiceId).toBe('svc-only');
    });

    it('should have intensityTrajectories size 1', () => {
      expect(result.intensityTrajectories.size).toBe(1);
    });

    it('should have propagationDistance 0', () => {
      expect(result.propagationDistance).toBe(0);
    });

    it('should have peakIntensity 1', () => {
      expect(result.peakIntensity).toBe(1);
    });
  });

  // ── Edge: Fully connected graph ───────────────────────────

  describe('fully connected graph', () => {
    const fullyConnected = makeServiceGraph(
      ['a', 'b', 'c'],
      [
        makeEdge('a', 'b', 100),
        makeEdge('b', 'a', 100),
        makeEdge('a', 'c', 100),
        makeEdge('c', 'a', 100),
        makeEdge('b', 'c', 100),
        makeEdge('c', 'b', 100),
      ],
    );
    const result = run(fullyConnected, 'a');

    it('should include all 3 services', () => {
      expect(result.intensityTrajectories.size).toBe(3);
    });

    it('should have sourceServiceId a', () => {
      expect(result.sourceServiceId).toBe('a');
    });

    it('should have propagationDistance as number', () => {
      expect(typeof result.propagationDistance).toBe('number');
    });
  });

  // ── Edge: Max coupling (1.0) ──────────────────────────────

  describe('max coupling 1.0', () => {
    const graph = makeServiceGraph(['svc-a', 'svc-b'], [makeEdge('svc-a', 'svc-b', 1000)]);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', graph, {
      couplingStrength: 1.0,
      propagationSpeed: 1.0,
      decayTimeConstant: 60000,
      cascadeThreshold: 0.1,
      timeHorizon: 60000,
    });

    it('should have sourceServiceId svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should have peakIntensity in [0, 1]', () => {
      expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.peakIntensity).toBeLessThanOrEqual(1);
    });

    it('should include both services', () => {
      expect(result.intensityTrajectories.size).toBe(2);
    });
  });

  // ── Edge: Zero coupling (0.0) ─────────────────────────────

  describe('zero coupling 0.0', () => {
    const graph = makeServiceGraph(['svc-a', 'svc-b'], [makeEdge('svc-a', 'svc-b', 100)]);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', graph, {
      couplingStrength: 0.0,
      propagationSpeed: 1.0,
      decayTimeConstant: 60000,
      cascadeThreshold: 0.1,
      timeHorizon: 60000,
    });

    it('should have sourceServiceId svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should keep svc-b intensity near 0 (no coupling)', () => {
      const traj = result.intensityTrajectories.get('svc-b')!;
      const maxB = Math.max(...traj.map((t) => t.intensity));
      expect(maxB).toBe(0);
    });
  });

  // ── Error: Nonexistent source ─────────────────────────────

  describe('error cases', () => {
    it('should throw for nonexistent source', () => {
      const graph = makeServiceGraph(['svc-a']);
      const model = new WaveCascadeModel();
      expect(() => model.simulateCascade('svc-unknown', graph)).toThrow();
    });

    it('should throw for empty graph', () => {
      const empty: ServiceCallGraph = { nodes: new Map(), edges: [], systemLoad: 0.5 };
      const model = new WaveCascadeModel();
      expect(() => model.simulateCascade('svc-a', empty)).toThrow();
    });
  });
});

// ── computeDecayCurve ────────────────────────────────────────

describe('WaveCascadeModel.computeDecayCurve', () => {
  const graph = makeServiceGraph(
    ['svc-a', 'svc-b', 'svc-c'],
    [makeEdge('svc-a', 'svc-b', 100), makeEdge('svc-b', 'svc-c', 50)],
  );

  it('should have 100 time points', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.timePoints.length).toBe(100);
  });

  it('should have 100 correlation values', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.correlationValues.length).toBe(100);
  });

  it('should have decayConstant > 0', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.decayConstant).toBeGreaterThan(0);
  });

  it('should have fitQuality = 1.0 (theoretical)', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.fitQuality).toBe(1);
  });

  it('should have C(0) ≈ 1.0', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.correlationValues[0]).toBeCloseTo(1, 2);
  });

  it('should handle single-node graph', () => {
    const single = makeServiceGraph(['svc-only']);
    const curve = new WaveCascadeModel().computeDecayCurve(single, 60000);
    expect(curve.decayConstant).toBeGreaterThan(0);
  });

  it('should throw for timeHorizon <= 0', () => {
    const model = new WaveCascadeModel();
    const single = makeServiceGraph(['svc-a']);
    expect(() => model.computeDecayCurve(single, -100)).toThrow();
  });
});

// ── Propagation distance ────────────────────────────────────
//
// `propagationDistance` is the one field of `CascadeResult` that describes the SPREAD of a cascade rather than the
// intensity at a point. Before this block every assertion on it was `>= 0` — which a constant `0` satisfies — and
// the constant was real: the kernel read out-edges, so a downstream node had no triple that could give it energy,
// and the BFS read the LAST step, which is below the threshold for every node once the horizon exceeds a few decay
// constants. The two defects are now fixed and the field is asserted on graphs whose answer is known by hand.

describe('WaveCascadeModel.simulateCascade — propagation distance', () => {
  const params = {
    couplingStrength: 0.9,
    propagationSpeed: 1.0,
    decayTimeConstant: 60000,
    cascadeThreshold: 0.01,
    timeHorizon: 300000,
  } as const;

  const chain = (length: number) =>
    makeServiceGraph(
      Array.from({ length }, (_, i) => `svc-${String.fromCharCode(97 + i)}`),
      Array.from({ length: length - 1 }, (_, i) =>
        makeEdge(`svc-${String.fromCharCode(97 + i)}`, `svc-${String.fromCharCode(98 + i)}`, 1000),
      ),
    );

  const peak = (
    result: { intensityTrajectories: ReadonlyMap<string, readonly { intensity: number }[]> },
    id: string,
  ) => Math.max(...result.intensityTrajectories.get(id)!.map((point) => point.intensity));

  it('carries a one-way call downstream, which is the whole defect this block used to record', () => {
    // `a → b → c` is the shape of every real call graph and the shape on which the previous model reported a
    // one-way call as carrying NOTHING: `T(i,j,k)` was built from the calls `i` makes, so `b`'s interaction sum
    // collapsed to its self term and it could only lose intensity.
    const result = new WaveCascadeModel().simulateCascade('svc-a', chain(3), params);

    expect(peak(result, 'svc-b')).toBeGreaterThan(0.01);
    expect(peak(result, 'svc-c')).toBeGreaterThan(0.01);
    expect(result.propagationDistance).toBe(2);
  });

  it('reports the hop count of the FARTHEST service above the threshold, not the last one standing', () => {
    expect(
      new WaveCascadeModel().simulateCascade('svc-a', chain(5), params).propagationDistance,
    ).toBe(4);
  });

  it('stops at a disconnected service, because hops are counted over the coupling', () => {
    const graph = makeServiceGraph(
      ['svc-a', 'svc-b', 'svc-orphan'],
      [makeEdge('svc-a', 'svc-b', 1000)],
    );
    const result = new WaveCascadeModel().simulateCascade('svc-a', graph, params);
    expect(result.propagationDistance).toBe(1);
    expect(peak(result, 'svc-orphan')).toBe(0);
  });

  it('is monotone in the threshold: a higher bar cannot reach further', () => {
    const graph = chain(5);
    const model = new WaveCascadeModel();
    const low = model.simulateCascade('svc-a', graph, { ...params, cascadeThreshold: 0.01 });
    const mid = model.simulateCascade('svc-a', graph, { ...params, cascadeThreshold: 0.2 });
    const high = model.simulateCascade('svc-a', graph, { ...params, cascadeThreshold: 0.95 });

    expect(mid.propagationDistance).toBeLessThanOrEqual(low.propagationDistance);
    expect(high.propagationDistance).toBeLessThanOrEqual(mid.propagationDistance);
    expect(high.propagationDistance).toBe(0);
  });

  it('is monotone in the coupling: a stronger coupling cannot reach less far', () => {
    const graph = chain(5);
    const model = new WaveCascadeModel();
    const weak = model.simulateCascade('svc-a', graph, { ...params, couplingStrength: 0.02 });
    const strong = model.simulateCascade('svc-a', graph, { ...params, couplingStrength: 1 });

    expect(weak.propagationDistance).toBeLessThanOrEqual(strong.propagationDistance);
    expect(strong.propagationDistance).toBe(4);
  });

  it('reports 0 for an isolated source', () => {
    const isolated = makeServiceGraph(['svc-a'], []);
    expect(new WaveCascadeModel().simulateCascade('svc-a', isolated).propagationDistance).toBe(0);
  });
});

// ── The invariant set is a theorem, not a clamp ──────────────

describe('WaveCascadeModel.simulateCascade — intensity stays in [0, 1]', () => {
  // The previous implementation clamped with `Math.max(0, Math.min(1, …))`, and the clamp was load-bearing: the
  // explicit step overshot and the clamp pinned trajectories at exactly 0 and 1. The scheme in place now makes
  // [0, 1] an invariant set by construction, so this sweep is the assertion that the clamp is gone and not needed:
  // any single value outside the interval on any of these configurations is a scheme that needs one again.
  const graph = makeServiceGraph(
    ['a', 'b', 'c', 'd', 'e'],
    [
      makeEdge('a', 'b', 1000),
      makeEdge('b', 'c', 1000),
      makeEdge('c', 'd', 1000),
      makeEdge('d', 'e', 1000),
      makeEdge('b', 'd', 500),
      makeEdge('a', 'c', 200),
    ],
  );

  it('holds across horizons, couplings and speeds — including steps far beyond the CFL bound', () => {
    // Sixteen combinations, each spanning the two extremes that matter: a 1 s horizon (a step of 2 ms) and a
    // 1 h horizon (a step of 7.2 s, i.e. thousands of times any CFL bound for these rates).
    const model = new WaveCascadeModel();
    for (const timeHorizon of [1000, 3600000]) {
      for (const couplingStrength of [0, 0.25, 0.9, 1]) {
        for (const propagationSpeed of [0.1, 10]) {
          const result = model.simulateCascade('a', graph, {
            couplingStrength,
            propagationSpeed,
            decayTimeConstant: 60000,
            cascadeThreshold: 0.1,
            timeHorizon,
          });
          for (const [, trajectory] of result.intensityTrajectories) {
            for (const point of trajectory) {
              expect(Number.isNaN(point.intensity)).toBe(false);
              expect(point.intensity).toBeGreaterThanOrEqual(0);
              expect(point.intensity).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it('decays an isolated source as exp(-γt), which is what the implicit sink integrates to', () => {
    // The exact solution of `dn/dt = -γ n` at t = 60 s with γ = 1/60 s⁻¹ is e⁻¹. The discrete scheme is
    // `n ← n/(1 + dt·γ)` per step, i.e. `(1 + 0.01)⁻¹⁰⁰ = 0.3697` — within 0.5% of e⁻¹, and the test asserts the
    // gap is that small rather than that it is zero, because the two schemes are different schemes.
    const isolated = makeServiceGraph(['solo'], []);
    const result = new WaveCascadeModel().simulateCascade('solo', isolated, {
      couplingStrength: 0.5,
      propagationSpeed: 1,
      decayTimeConstant: 60000,
      cascadeThreshold: 0.01,
      timeHorizon: 60000,
    });
    const trajectory = result.intensityTrajectories.get('solo')!;
    expect(trajectory.at(-1)!.intensity).toBeCloseTo(Math.exp(-1), 2);
    expect(trajectory.at(-1)!.time).toBeCloseTo(60000, 6);
  });
});

// ── Determinism, and the two fields that were constants ─────

describe('WaveCascadeModel.simulateCascade — determinism and the reported instants', () => {
  const params = {
    couplingStrength: 0.9,
    propagationSpeed: 1,
    decayTimeConstant: 60000,
    cascadeThreshold: 0.05,
    timeHorizon: 300000,
  } as const;

  it('two runs of the same input are bit-for-bit identical', () => {
    // The previous decay computation seeded power iteration with `Math.random()`, so the same graph produced
    // different gaps on two calls. Nothing in this model is allowed to be random: a benchmark input that varies
    // between runs has no error bar.
    const graph = makeServiceGraph(
      ['a', 'b', 'c'],
      [makeEdge('a', 'b', 1000), makeEdge('b', 'c', 1000)],
    );
    const first = new WaveCascadeModel().simulateCascade('a', graph, params);
    const second = new WaveCascadeModel().simulateCascade('a', graph, params);
    for (const [id, trajectory] of first.intensityTrajectories) {
      const twin = second.intensityTrajectories.get(id)!;
      expect(twin.map((point) => point.intensity)).toEqual(
        trajectory.map((point) => point.intensity),
      );
    }
    expect(second.propagationDistance).toBe(first.propagationDistance);
    expect(second.timeToPeak).toBe(first.timeToPeak);
  });

  it('reports timeToPeak 0 for an isolated source and a positive instant once there is a front', () => {
    // The field was 0 for every graph: the peak of a cascade that starts at 1 is at t = 0. Reading the peak of the
    // mass OUTSIDE the source is the instant the front exists, which is what the name claims.
    const isolated = makeServiceGraph(['solo'], []);
    expect(new WaveCascadeModel().simulateCascade('solo', isolated, params).timeToPeak).toBe(0);

    const link = makeServiceGraph(['a', 'b'], [makeEdge('a', 'b', 1000)]);
    expect(new WaveCascadeModel().simulateCascade('a', link, params).timeToPeak).toBeGreaterThan(0);
  });
});

// ── The decay curve is the operator's spectrum ──────────────

describe('WaveCascadeModel.computeDecayCurve — the gap is the operator’s', () => {
  it('inverts the Laplacian gap of the graph it was given, in seconds', () => {
    // A path of two unit-weight edges has gap 1 (its Laplacian is [[1,-1],[-1,1]] scaled by the edge weight), so
    // the decay constant is 1 s = 1000 ms — a number that comes from the topology rather than from a fit.
    const graph = makeServiceGraph(
      ['a', 'b', 'c'],
      [makeEdge('a', 'b', 100000), makeEdge('b', 'c', 100000)],
    );
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    // The edge weight carries the surviving share of the call (1 - errorRate = 0.99), so the gap is 0.99 and the
    // decay constant is 1000/0.99 ms. The number is analytic in the topology AND the edge, which is the point.
    expect(curve.decayConstant).toBeCloseTo(1000 / 0.99, 4);
  });

  it('reports the same gap on two calls', () => {
    const graph = makeServiceGraph(
      ['a', 'b', 'c'],
      [makeEdge('a', 'b', 100), makeEdge('b', 'c', 50)],
    );
    const model = new WaveCascadeModel();
    expect(model.computeDecayCurve(graph, 60000).decayConstant).toBe(
      model.computeDecayCurve(graph, 60000).decayConstant,
    );
  });

  it('falls back to the horizon when the graph carries no transport at all', () => {
    const graph = makeServiceGraph(['a', 'b'], [makeEdge('a', 'b', 1000, 100, 1)]);
    expect(new WaveCascadeModel().computeDecayCurve(graph, 60000).decayConstant).toBeCloseTo(
      60000,
      6,
    );
  });
});
