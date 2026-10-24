/**
 * The RCAEval **nine cells**, fenced at the SHIPPED default.
 *
 * `docs/fse26-discriminator-verdict.md` §22 licences a benchmark arm; it does not licence an engine
 * change, and the sentence it ends on is the reason this file exists: *a benchmark arm is not an
 * engine change*. The engine's second condition is the RCAEval golden nine-cell — the nine published
 * cells of the 735-case benchmark, which are measured by `.github/workflows/benchmark-rcaeval.yml`
 * and by nothing in this repository.
 *
 * So this file does not measure those cells (it cannot: the corpus is 735 cases of parquet). It
 * fences the CONSEQUENCE of the ENGINE's shipped weight on them, on a fixture whose cells are computed
 * by the real engine: at `new TreePruner()` every cell reads as pinned below, and at weight **0** —
 * the configuration every published cell before iteration 125 ran — exactly one cell reads DIFFERENTLY.
 * **That second assertion is what makes the first one evidence**: a nine-cell table that no weight can
 * move would be satisfied by the term doing nothing at all (law 34), which is the failure mode a
 * golden fence is prone to.
 *
 * The direction of the pair inverted in iteration 125, when the weight left 0. It has to: the pin
 * follows whatever ships, and the reachability proof has to move to the OTHER pole. What it still
 * catches is a default that changes without this table being re-read — which is the only thing a
 * fixture can know about a corpus it does not have.
 */

import type {
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import { TreePruner } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

/** One case: who the fault is on, what dominates the rank-1's anomaly, and which edges failed. */
interface CaseSpec {
  /** The ground-truth service set. */
  readonly truth: readonly string[];
  /** The metric label of the service that starts as rank-1 (the fixture's most anomalous). */
  readonly rankOneLabel: string;
  /** Failed calls `caller → callee`, charged to the callee. */
  readonly failures?: readonly { caller: string; callee: string; failed: number }[];
  /** Inbound latency measurements, `caller → callee`, as pre/post mean durations. */
  readonly latency?: readonly { caller: string; callee: string; pre: number; post: number }[];
}

const DURATION = 'http.server.request.duration';
const CPU = 'container_cpu_usage_seconds_total';

/**
 * One case, ranked by the real pruner.
 *
 * The topology is `edge → mid → leaf`, and the case's metric label is applied to `mid`, which is the
 * service the anomaly values make rank-1 unless a case says otherwise. This is a FIXTURE, and its
 * only job is to be a population the engine ranks: the assertion is on the engine's answer, never on
 * the fixture's shape.
 */
function ranksAsTruth(spec: CaseSpec, options: { failedEdgeWeight?: number }): boolean {
  const ids = ['edge', 'mid', 'leaf'] as const;
  const nodes = new Map<string, ServiceNode>(
    ids.map((id) => [id, { id, name: id, namespace: 'default', labels: {} }]),
  );
  const callGraph: ServiceCallGraph = {
    nodes,
    edges: [
      { from: 'edge', to: 'mid', type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 },
      { from: 'mid', to: 'leaf', type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 },
    ],
    systemLoad: 0.3,
  };
  const series = (label: string, values: number[]): TimeSeries => ({
    label,
    timestamps: values.map((_, i) => i * 60_000),
    values: new Float64Array(values),
    unit: 'count',
  });
  // `mid` is rank-1 at every weight this file states: its own anomaly is the case's largest, and
  // the only term that can move above it is the one under test.
  const metrics: MetricMap = new Map<string, readonly TimeSeries[]>([
    ['edge', [series(CPU, [1, 1, 1, 1, 2, 2, 2, 2])]],
    ['mid', [series(spec.rankOneLabel, [1, 1, 1, 1, 5, 5, 5, 5])]],
    ['leaf', [series(CPU, [1, 1, 1, 1, 4, 4, 4, 4])]],
  ]);
  const pruner = new TreePruner(options);
  const graph = pruner.buildFaultGraph(callGraph, metrics, {
    failedTraceEdges: spec.failures?.map((row) => ({ ...row, baseline: 0 })),
    edgeLatency: spec.latency?.map((row) => ({
      caller: row.caller,
      callee: row.callee,
      preMeanMs: row.pre,
      postMeanMs: row.post,
    })),
  });
  const top = pruner.analyze(graph, 3)[0];
  return top !== undefined && spec.truth.includes(top.serviceId);
}

/**
 * The nine cells, as the published table reads them: three suites × three systems.
 *
 * Two cases per cell, and ONE of the eighteen is a case the gate would admit at a non-zero weight —
 * `RE2-TT`'s second case, whose rank-1 carries a duration metric and a 500× inbound rise while the
 * truth is the rank-1 itself. That is the population a flip would touch, and its cell is the one
 * that must move.
 */
const CELLS: Readonly<Record<string, readonly CaseSpec[]>> = {
  'RE1-OB': [
    { truth: ['mid'], rankOneLabel: CPU },
    { truth: ['mid'], rankOneLabel: CPU },
  ],
  'RE1-SS': [
    { truth: ['mid'], rankOneLabel: CPU },
    { truth: ['edge'], rankOneLabel: CPU },
  ],
  'RE1-TT': [
    { truth: ['mid'], rankOneLabel: CPU },
    { truth: ['mid'], rankOneLabel: CPU },
  ],
  'RE2-OB': [
    { truth: ['mid'], rankOneLabel: CPU },
    { truth: ['mid'], rankOneLabel: CPU },
  ],
  'RE2-SS': [
    { truth: ['mid'], rankOneLabel: CPU },
    { truth: ['leaf'], rankOneLabel: CPU },
  ],
  'RE2-TT': [
    { truth: ['mid'], rankOneLabel: CPU },
    {
      truth: ['mid'],
      rankOneLabel: DURATION,
      failures: [{ caller: 'mid', callee: 'leaf', failed: 10 }],
      latency: [{ caller: 'edge', callee: 'mid', pre: 1, post: 500 }],
    },
  ],
  'RE3-OB': [
    { truth: ['mid'], rankOneLabel: CPU },
    { truth: ['mid'], rankOneLabel: CPU },
  ],
  'RE3-SS': [
    { truth: ['mid'], rankOneLabel: CPU },
    { truth: ['edge'], rankOneLabel: CPU },
  ],
  'RE3-TT': [
    { truth: ['mid'], rankOneLabel: CPU },
    { truth: ['mid'], rankOneLabel: CPU },
  ],
};

/** Correct / total per cell, in the published order. */
function nineCells(options: { failedEdgeWeight?: number } = {}): Record<string, string> {
  const table: Record<string, string> = {};
  for (const [cell, cases] of Object.entries(CELLS)) {
    const correct = cases.filter((spec) => ranksAsTruth(spec, options)).length;
    table[cell] = `${correct}/${cases.length}`;
  }
  return table;
}

/**
 * The table at the SHIPPED default, pinned.
 *
 * Pinned as a WHOLE rather than cell by cell, because a partial pin is a pin that outlives its own
 * population: adding a tenth cell would be free, and a reader comparing the two tables by eye would
 * find the new row in neither the record nor the assertion.
 */
const PINNED: Readonly<Record<string, string>> = {
  'RE1-OB': '2/2',
  'RE1-SS': '1/2',
  'RE1-TT': '2/2',
  'RE2-OB': '2/2',
  'RE2-SS': '1/2',
  // The one cell the direction term changes, now that it ships at 3: the fixture's second case there is the
  // one the gate admits, and the term promotes its callee over the truth. On a real corpus this cell is
  // untouchable — `rows: shipped 0` means the gate cannot fire — which is why the number here is a fixture's
  // and not a forecast.
  'RE2-TT': '1/2',
  'RE3-OB': '2/2',
  'RE3-SS': '1/2',
  'RE3-TT': '2/2',
};

describe('RCAEval golden nine cells — fenced at the shipped default', () => {
  it('reads the pinned table at the SHIPPED options, on cells the real engine produced', () => {
    // The subject is `new TreePruner()` — no options — so this asserts what a run with no input
    // passed actually does. That is the same distinction the `defaultPath` sub-record makes for the
    // stability weight: a point measured by passing a flag is a measurement of the flag.
    expect(nineCells()).toEqual(PINNED);
  });

  it('MOVES exactly one cell at weight 0 — the pole the published cells ran', () => {
    // Law 34: a green census is evidence only if a red one is reachable. The shipped weight is 3 since
    // iteration 125, so the DIFFERENT pole is 0 — the configuration every published cell before that ran —
    // and the fixture must move there, in exactly the cell the gate admits a case in. If this ever reports
    // zero moved cells, the pin above has stopped depending on the weight and asserts nothing.
    const off = nineCells({ failedEdgeWeight: 0 });
    const moved = Object.keys(PINNED).filter((cell) => off[cell] !== PINNED[cell]);
    expect(moved).toEqual(['RE2-TT']);
    expect(off['RE2-TT']).toBe('2/2');
  });
});
