/**
 * Unit tests for the dual-family census: the instrument that reads the term's POPULATION off the ranking.
 *
 * The term's enrolment (iteration 144) moved one cell and left two alone, and the reason could not be read
 * from any artifact: a constant membership cannot re-order a cell whose family covers most of the fleet, and
 * no printed number said how much of a fleet the family covered. This module is that number, computed from
 * the ranking the correctness checks already count from — one array, two readings, the rule the `GT rank=`
 * instrument set one field over.
 *
 * @module benchmarks/__tests__/dual-family-census
 */

import type { RootCauseResult } from '../../packages/core/src/types/faults.js';
import { SyntheticBenchmarkGenerator } from '../../packages/kinetic/src/benchmarks/index.js';
import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  accumulateDualFamilyCensus,
  createDualFamilyCensus,
  formatDualFamilyCensusLine,
} from '../src/dual-family-census.js';

const generator = new SyntheticBenchmarkGenerator(11);

/**
 * A record whose ranking carries the `dualFamily` term exactly as the pruner builds it.
 *
 * Members are named by their INDEX in this record's own ranking rather than by service id, so a test states
 * "the first two candidates" without depending on the generator's naming.
 *
 * @param memberIndexes - Positions in the ranking that carry a PAID term.
 * @param weight - The term's weight; 0 makes every term a `WEIGHT_ZERO`, which is the ablation's shape.
 */
function recordOf(memberIndexes: readonly number[], weight = 0.25): DiagnosedCaseRecord {
  const benchCase = generator.generateRCAEvalCase('cpu', 5);
  const ids = [...benchCase.callGraph.nodes.keys()];
  const ranking: RootCauseResult[] = ids.map((serviceId, index) => ({
    serviceId,
    faultType: 'cpu' as never,
    confidence: 1,
    rank: index + 1,
    evidenceMetrics: [],
    propagationDepth: 0,
    propagationErrorBound: 0,
    viaTreeSearch: false,
    // The causes are the pruner's own: a zero at weight 0 is `WEIGHT_ZERO` (the term never ran), and a zero
    // at a non-zero weight is `VALUE_ZERO` (the component is not a member). Collapsing the two would make the
    // census call a measured fleet "unmeasured" the moment no candidate passed the shape test.
    terms:
      weight !== 0 && memberIndexes.includes(index)
        ? [{ name: 'dualFamily', contribution: weight }]
        : [
            {
              name: 'dualFamily',
              contribution: 0,
              cause: weight === 0 ? 'WEIGHT_ZERO' : 'VALUE_ZERO',
              source: 'dualFamilyServices',
            },
          ],
  }));
  return {
    case: benchCase,
    graph: {
      callGraph: benchCase.callGraph,
      propagationWeights: new Float64Array(benchCase.callGraph.edges.length),
      anomalyScores: new Map(ids.map((id) => [id, 1])),
      anomalyOnsetTimes: new Map(ids.map((id) => [id, 0])),
      detectedCycles: [],
      totalCycleContribution: 0,
      pruneThreshold: 0.001,
    },
    ranking,
    callGraph: benchCase.callGraph,
  } as DiagnosedCaseRecord;
}

/** The index of the truth in a record's own ranking. */
function truthIndex(record: DiagnosedCaseRecord): number {
  return record.ranking.findIndex((r) => r.serviceId === record.case.groundTruth.serviceId);
}

/** The same record with the truth removed from the ranking — a retrieval failure. */
function withoutTruth(record: DiagnosedCaseRecord): DiagnosedCaseRecord {
  return {
    ...record,
    ranking: record.ranking.filter((r) => r.serviceId !== record.case.groundTruth.serviceId),
  };
}

describe('dual-family census', () => {
  it('counts the family and the fleet from the ranking it is handed', () => {
    const census = createDualFamilyCensus();
    const record = recordOf([0, 1]);

    accumulateDualFamilyCensus(census, record);

    expect(census.cases).toBe(1);
    expect(census.members).toBe(2);
    expect(census.candidates).toBe(record.ranking.length);
    expect(census.unmeasured).toBe(0);
  });

  it('counts the truth as inside the family only when ITS OWN term was paid', () => {
    const inside = recordOf([0]);
    const truthAt = truthIndex(inside);
    const census = createDualFamilyCensus();

    accumulateDualFamilyCensus(census, recordOf([truthAt]));
    accumulateDualFamilyCensus(census, recordOf([truthAt === 0 ? 1 : 0]));

    expect(census.scored).toBe(2);
    expect(census.truthInFamily).toBe(1);
  });

  it('does not count a truth that is not a candidate as a miss, and does not count it as a hit either', () => {
    // `ABSENT` is a RETRIEVAL failure, not a ranking failure — the distinction the `GT rank=` instrument
    // introduced, and averaging the two is how six of a hundred misses came to be misread as ranking losses.
    const census = createDualFamilyCensus();

    accumulateDualFamilyCensus(census, withoutTruth(recordOf([0])));

    expect(census.scored).toBe(0);
    expect(census.absent).toBe(1);
    expect(census.truthInFamily).toBe(0);
  });

  it('reports the ablation as UNMEASURED rather than as an empty family', () => {
    const census = createDualFamilyCensus();
    accumulateDualFamilyCensus(census, recordOf([], 0));

    // The distinction is the whole reason the census reads the TERM: at weight 0 the family is not built, so
    // a census that reported "members 0 of 5" would describe a fleet where nothing passed the shape test.
    expect(census.unmeasured).toBe(1);
    expect(formatDualFamilyCensusLine(census)).toContain('unmeasured');
  });

  it('prints the density and the truth share at one decimal, with ABSENT separated', () => {
    const census = createDualFamilyCensus();
    const measured = recordOf([truthIndex(recordOf([0]))]);
    accumulateDualFamilyCensus(census, measured);
    accumulateDualFamilyCensus(census, measured);
    accumulateDualFamilyCensus(census, withoutTruth(measured));

    const line = formatDualFamilyCensusLine(census);

    // Two of three cases carry one member each; the third (the retrieval failure) carries none and its own
    // ranking, so the means are taken over all three MEASURED cases: 2 members over 14 candidates.
    expect(line).toContain('(14.3%)');
    expect(line).toContain('truth=2/2 (100.0%)');
    expect(line).toContain('absent=1');
  });

  it('counts a case with SOME terms still, and a mixed census reports both its measured and its unmeasured cases', () => {
    // Two shapes the runner can hand over in one cell: a case whose ranking carries no breakdown at all (a
    // producer that does not compute this sum — the term is then absent, not zero), and a cell that mixes a
    // measured case with a `WEIGHT_ZERO` one. Both have to reach the line rather than being folded into the
    // measured total or dropped from it.
    const record = recordOf([0]);
    const partial: DiagnosedCaseRecord = {
      ...record,
      // The member (index 0) keeps its term; a NON-member loses its breakdown, which is the case a producer
      // that does not compute this sum hands over.
      ranking: [
        ...record.ranking.filter((_, index) => index !== 1),
        { ...record.ranking[1]!, terms: undefined },
      ],
    };
    const census = createDualFamilyCensus();
    accumulateDualFamilyCensus(census, partial);
    accumulateDualFamilyCensus(census, recordOf([], 0));

    const line = formatDualFamilyCensusLine(census);

    // The unmeasured case contributes NOTHING to the family means, and the line says how many it left out.
    expect(census.members).toBe(1);
    expect(line).toContain('family=1.0/');
    expect(line).toContain('unmeasured=1');
  });

  it('prints "none scored" when every case was a retrieval failure, instead of a share of zero', () => {
    // A cell whose truth never appears in its own ranking has no denominator to take a truth share over, and
    // printing `0/0` would put a division by zero — or worse, a 0.0% — where the honest answer is that no case
    // could be scored at all.
    const census = createDualFamilyCensus();
    accumulateDualFamilyCensus(census, withoutTruth(recordOf([0])));

    expect(formatDualFamilyCensusLine(census)).toContain('truth=none scored');
  });

  it('is silent when it was handed nothing, rather than printing a zero it did not measure', () => {
    expect(formatDualFamilyCensusLine(createDualFamilyCensus())).toBeUndefined();
  });
});
