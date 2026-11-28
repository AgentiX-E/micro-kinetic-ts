/**
 * The jurisdiction of the two decay parameters — and the fact that neither of them can move a ranking.
 *
 * `TreePrunerOptions.decayAlpha` is documented as "1-hop decay factor α ∈ (0, 1]". `analyze` reads it at exactly two
 * places: `childContrib += childScore × weight × α¹` inside the tree pass, and `estimatePropagationError(depth, α)`.
 * The **cycle** contribution carries a parameter of the same name and a different value — `analyze` hands
 * `CollisionContributionAnalyzer` the graph's `computedDecayAlpha`, a tier constant chosen from the node count, and
 * never the option — and it is applied with the exponent the theory is about (`αⁿ`, n = cycle length).
 *
 * Measured, in this file: **neither parameter reaches `finalScore`.**
 *
 * - the tree pass stores `totalScore = mixedSelf + childContrib × fanOutDilution` in `scores`, and then ranks by
 *   `selfScores = nodeAnomaly` on purpose ("the collision energy … would let a healthy convergence node outrank the
 *   true source, so it is deliberately excluded from the primary ranking signal"). `childContrib` is therefore a
 *   channel nothing downstream of the ranking reads, and α enters only it;
 * - the cycle contribution is reported on the graph and on each pruned-edge record, and no term carries it.
 *
 * Which falsifies the pre-registration `docs/loop-decay-falsified.md` records: replacing `α` with the theorem's
 * `ε^k` cannot change a number, because the numbers a ranking is made of never see either α. These tests exist so
 * that the day someone wires the child-propagation channel or the cycle contribution INTO the score, the change is
 * announced by a red test and the axis reopens deliberately rather than by accident.
 *
 * @module __tests__/unit/decay-parameter-jurisdiction
 */

import type { CallEdge, MetricMap, ServiceNode, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { sumScoreTerms, TreePruner } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

const INJECT = 300_000;

function node(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 };
}

/** A cpu series that steps at the injection: five samples before, three after. */
function step(before: number, after: number): TimeSeries {
  const values = [before, before, before, before, before, after, after, after];
  return {
    label: 'cpu',
    timestamps: values.map((_, index) => index * 60_000),
    values: new Float64Array(values),
    unit: 'ratio',
  };
}

/** `charlie` rises hardest, so there is an anomaly order for the ranking to be wrong about. */
function metrics(): MetricMap {
  return new Map<string, readonly TimeSeries[]>([
    ['alpha', [step(0.2, 0.9)]],
    ['bravo', [step(0.3, 0.6)]],
    ['charlie', [step(0.1, 4)]],
    ['leaf', [step(0.4, 0.5)]],
  ]);
}

/**
 * `alpha → bravo → charlie → alpha`, plus a leaf off `alpha`: exactly one cycle, of length three.
 *
 * Three is the shortest length a cycle can have, and the length is the exponent in the law under test — so a
 * fixture that got it wrong by one would be visibly wrong rather than plausibly wrong.
 */
const callGraph = {
  nodes: new Map<string, ServiceNode>(
    ['alpha', 'bravo', 'charlie', 'leaf'].map((id) => [id, node(id)]),
  ),
  edges: [
    edge('alpha', 'bravo'),
    edge('bravo', 'charlie'),
    edge('charlie', 'alpha'),
    edge('alpha', 'leaf'),
  ],
  systemLoad: 0.3,
};

/** The graph for one `decayAlpha`, from the same topology and the same metrics. */
function graphFor(decayAlpha: number) {
  const pruner = new TreePruner({ decayAlpha });
  return {
    pruner,
    graph: pruner.buildFaultGraph(callGraph, metrics(), { injectTimeMs: INJECT }),
  };
}

describe('the tree’s decay parameter cannot move the answer', () => {
  it('leaves the ranking, the scores and the breakdown bit-identical at α = 0.2 and α = 0.95', () => {
    // The finding. `childContrib` is a channel the ranking does not read — the tree pass ranks by the node's OWN
    // anomaly — so the option's two extremes produce the same answer, term for term, to the last bit.
    const low = graphFor(0.2);
    const high = graphFor(0.95);
    const strip = (rows: ReturnType<typeof low.pruner.analyze>): unknown =>
      rows.map((row) => [row.serviceId, row.rank, row.finalScore, row.terms]);
    expect(strip(low.pruner.analyze(low.graph, 4))).toEqual(
      strip(high.pruner.analyze(high.graph, 4)),
    );
  });

  it('but it IS read: it moves the uncertainty the engine states about each rank', () => {
    // A fence that only asserted "nothing changes" would pass on a parameter that had been deleted. It is read
    // once — `estimatePropagationError(depth, α)` — and its reach is the reported error bound and the confidence
    // derived from it, so the two extremes must differ there and nowhere else.
    const low = graphFor(0.2).pruner.analyze(graphFor(0.2).graph, 4);
    const high = graphFor(0.95).pruner.analyze(graphFor(0.95).graph, 4);
    expect(low.map((row) => row.propagationErrorBound)).not.toEqual(
      high.map((row) => row.propagationErrorBound),
    );
    expect(low.map((row) => row.confidence)).not.toEqual(high.map((row) => row.confidence));
  });

  it('and the error bound is 1 − α^depth, which is a stated uncertainty and not a propagated one', () => {
    // The exact law, so the pre-registration's replacement is a replacement of THIS expression: the theorem's
    // per-loop factor would make it `1 − ε^k`, and k is a property of the graph's loops rather than of a node's
    // depth. It changes how wrong the engine says it might be; it does not change what it says.
    const alpha = 0.8;
    for (const row of graphFor(alpha).pruner.analyze(graphFor(alpha).graph, 4)) {
      expect(row.propagationErrorBound).toBeCloseTo(1 - Math.pow(alpha, row.propagationDepth), 12);
    }
  });

  it('ranks by the node’s own anomaly, which is the channel the option does not enter', () => {
    // Every weight but the base term is 0 in a default pruner, so the ranking IS `log1p(anomaly)` order. This
    // assertion is what would fail if the ranking were ever switched to the `totalScore` channel that α does enter.
    const { pruner, graph } = graphFor(0.8);
    const results = pruner.analyze(graph, 4);
    const byBase = [...results].sort((left, right) => {
      const slopeOf = (terms: typeof left.terms): number =>
        terms?.find((term) => term.name === 'selfAnomalyLog1p')?.slope ?? 0;
      return slopeOf(right.terms) - slopeOf(left.terms);
    });
    expect(results.map((r) => r.serviceId)).toEqual(byBase.map((r) => r.serviceId));
  });

  it('keeps the score equal to the sum of its own terms, so no term is hiding outside the breakdown', () => {
    const { pruner, graph } = graphFor(0.8);
    for (const result of pruner.analyze(graph, 4)) {
      expect(result.terms).toBeDefined();
      expect(sumScoreTerms(result.terms!)).toBeCloseTo(result.finalScore!, 9);
    }
  });
});

describe('the cycle’s decay parameter is a different number, a different reader, and also out of the score', () => {
  it('ignores the option: the contribution is identical at α = 0.2 and α = 0.95', () => {
    // `analyze` passes `computedDecayAlpha` and never `this.options.decayAlpha`, so a reader who sets the option
    // expecting to change the cycle decay is setting a number nothing on that path reads.
    const low = graphFor(0.2);
    const high = graphFor(0.95);
    expect(low.graph.totalCycleContribution).toBeGreaterThan(0);
    expect(low.graph.totalCycleContribution).toBeCloseTo(high.graph.totalCycleContribution, 12);
    expect(low.graph.detectedCycles.map((c) => c.contribution)).toEqual(
      high.graph.detectedCycles.map((c) => c.contribution),
    );
  });

  it('decays by αⁿ with α the node-count tier and n the cycle length', () => {
    // Four nodes is the `< 20` tier, so α = 0.9, and the cycle is `alpha → bravo → charlie → alpha`, so n = 3.
    // Asserting the LAW rather than the value keeps the test honest about what it pins: the exponent is the LENGTH,
    // which is the quantity a loop-suppression law says should instead carry a LOOP count (always 1 for a simple
    // cycle, whatever its length).
    const { graph } = graphFor(0.8);
    const weights = new Map<string, number>();
    for (let index = 0; index < graph.callGraph.edges.length; index += 1) {
      const e = graph.callGraph.edges[index]!;
      weights.set(`${e.from}→${e.to}`, graph.propagationWeights[index]!);
    }
    const cycle = graph.detectedCycles[0]!;
    const path = cycle.nodePath;
    let raw = 1;
    for (let index = 0; index < path.length; index += 1) {
      raw *= weights.get(`${path[index]}→${path[(index + 1) % path.length]}`)!;
    }
    expect(path.length).toBe(3);
    expect(cycle.contribution).toBeCloseTo(raw * Math.pow(0.9, 3), 12);
  });

  it('puts the contribution in no term of the result, so it cannot be in the sum', () => {
    // The contribution is reported on the graph and on each pruned-edge record. If a future change makes it a term,
    // the term has to carry a name, and this assertion is where that change announces itself.
    const { pruner, graph } = graphFor(0.8);
    const names = pruner
      .analyze(graph, 4)
      .flatMap((result) => (result.terms ?? []).map((term) => term.name));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => /cycle|loop/i.test(name))).toEqual([]);
  });
});
