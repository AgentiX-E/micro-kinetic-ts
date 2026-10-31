/**
 * Unit tests for the failed-edge gate census: the instrument that reads the gate's DECISIONS.
 *
 * The `direction-gate[...]` line reports that the gate CAN fire on four cells because the corpus view supplies
 * latency rows. It never reported that the gate fired ONCE in 735 cases. The difference between those two
 * statements is a count, and this file pins the count: each column is a predicate evaluated once, and the
 * columns are asserted as numbers rather than through the rendered text wherever the number is the claim.
 *
 * @module benchmarks/__tests__/failed-edge-gate-census
 */

import { SyntheticBenchmarkGenerator } from '../../packages/kinetic/src/benchmarks/index.js';
import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import { FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR } from '../../packages/tree/src/index.js';
import {
  accumulateFailedEdgeGateCensus,
  createFailedEdgeGateCensus,
  formatFailedEdgeGateCensusLine,
} from '../src/failed-edge-gate-census.js';

const generator = new SyntheticBenchmarkGenerator(11);

/** A label inside the duration family — the gate's FIRST half passes on it. */
const DURATION = 'http.client.request.duration.max';
/** A label outside it — a resource metric is not the channel a failed call would show in. */
const RESOURCE = 'container_cpu_usage_seconds_total';

/** What a case looks like from the gate's side. */
interface CaseSpec {
  /** Per-service inbound rise. A service absent from the map was never measured. */
  readonly rises: ReadonlyMap<string, number>;
  /** Per-service dominant metric label. Absent means the producer measured none. */
  readonly labels: ReadonlyMap<string, string | undefined>;
  /** Positions in the ranking whose `failedEdge` term carries a non-zero contribution. */
  readonly paid?: readonly number[];
}

/**
 * A record carrying exactly the two graph fields the census reads, plus a ranking whose terms are the pruner's.
 *
 * The rising map is keyed by service id and the ranking is the graph's own node order, so a test states "the
 * rank-1" as index 0 without depending on the generator's naming.
 *
 * @param spec - The rises, the labels, and which candidates were paid.
 * @returns A record the gate census can read.
 */
function recordOf(spec: CaseSpec): DiagnosedCaseRecord {
  const benchCase = generator.generateRCAEvalCase('cpu', 5);
  const ids = [...benchCase.callGraph.nodes.keys()];
  const paid = spec.paid ?? [];
  const ranking = ids.map((serviceId, index) => ({
    serviceId,
    faultType: 'cpu' as never,
    confidence: 1,
    rank: index + 1,
    evidenceMetrics: [],
    propagationDepth: 0,
    propagationErrorBound: 0,
    viaTreeSearch: true,
    // A paid term carries no cause; an unpaid one carries `VALUE_ZERO`, because the zero here is a measured
    // zero on a term that ran — not a `WEIGHT_ZERO`, which is the label a REFUSED case wears.
    terms: paid.includes(index)
      ? [{ name: 'failedEdge', contribution: 3 }]
      : [
          {
            name: 'failedEdge',
            contribution: 0,
            cause: 'VALUE_ZERO' as const,
            source: 'failedEdgeScores',
          },
        ],
  }));
  return {
    case: benchCase,
    graph: {
      callGraph: benchCase.callGraph,
      propagationWeights: new Float64Array(benchCase.callGraph.edges.length),
      anomalyScores: new Map(ids.map((id) => [id, 1])),
      rawAnomalyScores: new Map(ids.map((id) => [id, 1])),
      anomalyNormalization: 'none',
      anomalyOnsetTimes: new Map(ids.map((id) => [id, 0])),
      detectedCycles: [],
      totalCycleContribution: 0,
      pruneThreshold: 0.001,
      edgeLatencyByCallee: new Map([...spec.rises].map(([id, rise]) => [id, { rise, count: 2 }])),
      dominantMetrics: new Map(
        [...spec.labels].map(([id, label]) => [
          id,
          { label: label ?? '', head: [], tail: [], transientSkipped: [] },
        ]),
      ),
    },
    ranking,
    callGraph: benchCase.callGraph,
  } as DiagnosedCaseRecord;
}

/** The services of a fresh record, so a spec can name the rank-1 without hard-coding the generator's ids. */
function services(): readonly string[] {
  return [...generator.generateRCAEvalCase('cpu', 5).callGraph.nodes.keys()];
}

/** A spec whose rank-1 (index 0) carries `rise` and `label`, and whose champion is `champion`. */
function specOf(
  rise: number,
  label: string | undefined,
  champion = rise,
  paid?: readonly number[],
): CaseSpec {
  const ids = services();
  const rises = new Map<string, number>([[ids[0]!, rise]]);
  if (champion !== rise) rises.set(ids[1]!, champion);
  const labels = new Map<string, string | undefined>([[ids[0]!, label]]);
  return { rises, labels, paid };
}

describe('failed-edge gate census — the populations', () => {
  it('counts a case with no per-edge measurement as no champion, and does not count it as a refusal', () => {
    const census = createFailedEdgeGateCensus('absolute', 0.5);

    accumulateFailedEdgeGateCensus(census, recordOf({ rises: new Map(), labels: new Map() }));

    expect(census.cases).toBe(1);
    expect(census.noChampion).toBe(1);
    expect(census.rankOneMeasured).toBe(0);
    expect(census.barRefused).toBe(0);
    expect(census.nameRefused).toBe(0);
  });

  it('does not count a case whose rank-1 is unmeasured, even when another service was', () => {
    // The distinction the census exists for: "the case carried no measurement" and "the rank-1 was not among
    // the measured services" are one number apart in a naive count and different findings.
    const ids = services();
    const census = createFailedEdgeGateCensus('absolute', 0.5);

    accumulateFailedEdgeGateCensus(
      census,
      recordOf({
        rises: new Map([[ids[1]!, 4]]),
        labels: new Map([[ids[0]!, DURATION]]),
      }),
    );

    expect(census.noChampion).toBe(0);
    expect(census.rankOneMeasured).toBe(0);
  });

  it('counts the two halves of the predicate apart — a resource metric is a name refusal, not a bar refusal', () => {
    // A rise of 400 would clear any bar this corpus can produce, so the only thing that can refuse this case is
    // the FIRST half. Folding the two would report the name as the magnitude and make a unit defect look like a
    // threshold that is merely too strict.
    const census = createFailedEdgeGateCensus('absolute', 0.5);

    accumulateFailedEdgeGateCensus(census, recordOf(specOf(400, RESOURCE)));

    expect(census.rankOneMeasured).toBe(1);
    expect(census.nameRefused).toBe(1);
    expect(census.barRefused).toBe(0);
  });

  it('refuses a golden-scale rise at the absolute bar — the unit defect, as a count', () => {
    // 7.99 is the golden half's median case maximum over the metric series (measured: min 1.01, p50 7.68, p90
    // 121.01, max 482.5 over RE1-OnlineBoutique's 125 cases), and the bar is 300 because FSE'26 injects hundreds
    // of milliseconds onto a sub-millisecond baseline. The body of that distribution cannot reach the bar; its
    // tail can, which is exactly why the residue on the two span-bearing cells is UNMEASURED rather than argued.
    const census = createFailedEdgeGateCensus('absolute', 0.5);

    accumulateFailedEdgeGateCensus(census, recordOf(specOf(7.99, DURATION)));

    expect(FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR).toBeGreaterThan(7.99);
    expect(census.nameRefused).toBe(0);
    expect(census.barRefused).toBe(1);
  });

  it('admits every measured rise at share 0 and only a champion rank-1 at share 1', () => {
    // The two ends of the share's semantics, on a case whose rank-1 (2) is NOT its champion (8): at 0 the bar is
    // zero and any measurement clears it; at 1 the bar is the champion itself, so a non-champion rank-1 is
    // refused. A gate that failed at either end would be reading the champion where it should read the rise.
    const atZero = createFailedEdgeGateCensus('fleet', 0);
    const atOne = createFailedEdgeGateCensus('fleet', 1);
    const record = recordOf(specOf(2, DURATION, 8));

    accumulateFailedEdgeGateCensus(atZero, record);
    accumulateFailedEdgeGateCensus(atOne, record);

    expect(atZero.barRefused).toBe(0);
    expect(atOne.barRefused).toBe(1);
  });

  it('narrows monotonically as the share rises, on a rank-1 that is not the champion', () => {
    const record = recordOf(specOf(2, DURATION, 8));
    const refusals = [0, 0.25, 0.5, 1].map((share) => {
      const census = createFailedEdgeGateCensus('fleet', share);
      accumulateFailedEdgeGateCensus(census, record);
      return census.barRefused;
    });

    // 2 against a champion of 8: admitted at 0 and at 0.25 (bar 2), refused above it.
    expect(refusals).toStrictEqual([0, 0, 1, 1]);
  });
});

describe('failed-edge gate census — what the engine did', () => {
  it('counts `acted` off the breakdown, including a payment to a candidate that is not the rank-1', () => {
    // The column answers "did the term move the score", which is a fact about the RUN. Reading only the rank-1
    // would under-count every case the term paid but did not promote.
    const census = createFailedEdgeGateCensus('absolute', 0.5);

    accumulateFailedEdgeGateCensus(census, recordOf({ ...specOf(2, DURATION), paid: [2] }));

    expect(census.acted).toBe(1);
  });

  it('does not count a zero contribution as acting, at either sign of zero', () => {
    const census = createFailedEdgeGateCensus('absolute', 0.5);
    const record = recordOf(specOf(2, DURATION));
    const zeroed = {
      ...record,
      ranking: record.ranking.map((r) => ({
        ...r,
        terms: [{ name: 'failedEdge', contribution: -0, cause: 'VALUE_ZERO' as const }],
      })),
    } as DiagnosedCaseRecord;

    accumulateFailedEdgeGateCensus(census, zeroed);

    expect(census.acted).toBe(0);
  });

  it('reports the disagreement between the predicate and the engine as a mismatch, not as an admission', () => {
    // The one `INPUT_MAP_EMPTY` case is this shape: the gate let the case through and the term still paid
    // nothing, because the map it reads was empty. A census that reported "acted 0" alone would read as a
    // refusal.
    const census = createFailedEdgeGateCensus('fleet', 0);

    accumulateFailedEdgeGateCensus(census, recordOf(specOf(2, DURATION, 2)));

    const line = formatFailedEdgeGateCensusLine(census)!;
    expect(line).toContain('admissible 1');
    expect(line).toContain('acted 0 (mismatch 1)');
  });

  it('prints no mismatch when the predicate and the engine agree', () => {
    const census = createFailedEdgeGateCensus('fleet', 0);

    accumulateFailedEdgeGateCensus(census, recordOf({ ...specOf(2, DURATION, 2), paid: [0] }));

    const line = formatFailedEdgeGateCensusLine(census)!;
    expect(line).toContain('acted 1');
    expect(line).not.toContain('mismatch');
  });
});

describe('failed-edge gate census — the line', () => {
  it('names the bar it used, with the constant at `absolute` and the share at `fleet`', () => {
    const absolute = createFailedEdgeGateCensus('absolute', 0.5);
    const fleet = createFailedEdgeGateCensus('fleet', 0.5);
    for (const census of [absolute, fleet]) {
      accumulateFailedEdgeGateCensus(census, recordOf(specOf(2, DURATION)));
    }

    expect(formatFailedEdgeGateCensusLine(absolute)).toContain(
      `bar(absolute@${FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR})`,
    );
    expect(formatFailedEdgeGateCensusLine(fleet)).toContain('bar(fleet@0.50)');
  });

  it('says `none measured` when no rank-1 rise was measured, rather than a quantile of an empty sample', () => {
    // A cell with cases and a champion but no MEASURED rank-1: the rank-1 was not among the measured services. The
    // line must still print — the cell was analysed — and the distribution column must not invent a number.
    const ids = services();
    const census = createFailedEdgeGateCensus('absolute', 0.5);
    accumulateFailedEdgeGateCensus(
      census,
      recordOf({ rises: new Map([[ids[1]!, 4]]), labels: new Map([[ids[0]!, DURATION]]) }),
    );

    expect(census.rankOneMeasured).toBe(0);
    const line = formatFailedEdgeGateCensusLine(census)!;
    expect(line).toContain('rise none measured');
    expect(line).toContain('rank-1 measured 0');
  });

  it('counts a record with no candidates at all, without inventing a rank-1 to judge', () => {
    // The engine always returns at least one candidate, so this is a guard rather than a measured state — and it
    // is asserted rather than left to the type, because a census that threw on it would take the whole cell's
    // report down with it.
    const census = createFailedEdgeGateCensus('absolute', 0.5);
    const record = { ...recordOf(specOf(2, DURATION)), ranking: [] } as DiagnosedCaseRecord;

    accumulateFailedEdgeGateCensus(census, record);

    expect(census.cases).toBe(1);
    expect(census.noChampion).toBe(0);
    expect(census.rankOneMeasured).toBe(0);
    expect(census.acted).toBe(0);
  });

  it('reports the rises at nearest rank, so no printed quantile is a rise no case produced', () => {
    const ids = services();
    const census = createFailedEdgeGateCensus('absolute', 0.5);
    // Ten observations, one per case, so each nearest-rank index is a real observation: p10 is the first, p50
    // the fifth, p90 the ninth and max the tenth.
    for (const rise of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      accumulateFailedEdgeGateCensus(
        census,
        recordOf({
          rises: new Map([[ids[0]!, rise]]),
          labels: new Map([[ids[0]!, DURATION]]),
        }),
      );
    }

    expect(formatFailedEdgeGateCensusLine(census)).toContain(
      'rise p10/p50/p90/max 1.00/5.00/9.00/10.00',
    );
  });

  it('omits the what-if column unless a share is asked for, and prints it when one is', () => {
    const silent = createFailedEdgeGateCensus('absolute', 0.5);
    const asked = createFailedEdgeGateCensus('absolute', 0.5, 0.5);
    // Rank-1 rise 4 against a champion of 8: the fleet bar at 0.5 IS 4, so this pins the comparison as `>=`
    // (an exclusive one would refuse the case that sits exactly on its own champion's half).
    for (const census of [silent, asked]) {
      accumulateFailedEdgeGateCensus(census, recordOf(specOf(4, DURATION, 8)));
    }

    expect(formatFailedEdgeGateCensusLine(silent)).not.toContain('fleet@0.50 admissible');
    expect(asked.whatIfAdmit).toBe(1);
    expect(formatFailedEdgeGateCensusLine(asked)).toContain('fleet@0.50 admissible 1');
  });

  it('says nothing for a cell with no cases, and names the ABSENCE for a cell with no measurement', () => {
    // Two thirds of the grid is the second case: `edgeLatencyByCallee` is empty on every RE1 and RE3 case, so the
    // finding there is the absence and not a refusal. A row of zeros would read as "the gate refused every case",
    // and a missing line is indistinguishable from a census that never ran — which is why the sentence carries
    // the count.
    const empty = createFailedEdgeGateCensus('absolute', 0.5);
    const unmeasured = createFailedEdgeGateCensus('absolute', 0.5);
    accumulateFailedEdgeGateCensus(unmeasured, recordOf({ rises: new Map(), labels: new Map() }));

    expect(formatFailedEdgeGateCensusLine(empty)).toBeUndefined();
    const line = formatFailedEdgeGateCensusLine(unmeasured)!;
    expect(line).toContain('no measurement: 1 of 1 cases');
    expect(line).not.toContain('bar refused');
  });
});
