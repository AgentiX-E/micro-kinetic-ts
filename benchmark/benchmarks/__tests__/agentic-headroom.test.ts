import { describe, expect, it } from 'vitest';

import type {
  CandidateFingerprint,
  ChannelFingerprint,
} from '../../packages/ai/src/agent/index.js';

import type { FingerprintRecord } from '../src/agentic-fingerprint-file.js';
import {
  bestSweepPoint,
  evidenceClaims,
  joinHeadroom,
  oracleClaims,
  scoreArm,
  splitOf,
  sweepEvidence,
  takeSplit,
  type HeadroomCase,
} from '../src/agentic-headroom.js';
import type { PerCaseVerdict } from '../src/fse26-per-case.js';

/** A channel whose post value sits outside its band. */
function fired(
  label: string,
  post: number,
  rate: number,
  band: readonly [number, number] = [0, 1],
): ChannelFingerprint {
  return { label, pre: 0, post, band, rate };
}

/** A channel that never left its band. */
function quiet(label: string): ChannelFingerprint {
  return { label, pre: 0.5, post: 0.5, band: [0, 1], rate: 0 };
}

function candidate(
  service: string,
  rank: number,
  score: number,
  channels: readonly ChannelFingerprint[],
): CandidateFingerprint {
  return { service, rank, score, channels };
}

/** One joined case. */
function headroomCase(
  datapack: string,
  candidates: readonly CandidateFingerprint[],
  accepted: readonly string[] = ['svc-b'],
): HeadroomCase {
  return { datapack, faultType: 'stress', accepted, candidates };
}

/** A record carrying the same ordering as a case, which is what the join requires. */
function recordOf(oneCase: HeadroomCase): FingerprintRecord {
  return {
    datapack: oneCase.datapack,
    faultType: oneCase.faultType,
    injectTimeMs: 1_000_000,
    candidates: oneCase.candidates,
    census: { considered: 0, offered: 0, unmeasurable: 0, unprofiled: 0, shadowed: 0, capped: 0 },
  };
}

/** The verdict line a run would have written for a case. */
function verdictOf(oneCase: HeadroomCase): PerCaseVerdict {
  return {
    datapack: oneCase.datapack,
    faultType: oneCase.faultType,
    accepted: oneCase.accepted,
    ranked: oneCase.candidates.map((entry) => entry.service),
  };
}

/** The canonical posterior: the leader's evidence is ordinary, the truth one rank down is rare. */
const ordinaryLeader = candidate('svc-a', 0, 2, [fired('cpu', 5, 0.67)]);
const rareTruth = candidate('svc-b', 1, 1.5, [fired('cpu', 4, 0)]);
const closeCase = headroomCase('case-1', [ordinaryLeader, rareTruth]);
/** The same two candidates with the truth already leading. */
const rightCase = headroomCase('case-right', [rareTruth, ordinaryLeader]);

describe('joinHeadroom', () => {
  it('pairs records and verdicts on datapack', () => {
    const join = joinHeadroom([recordOf(closeCase)], [verdictOf(closeCase)]);
    expect(join.cases).toEqual([closeCase]);
    expect(join.unpairedFingerprints).toEqual([]);
    expect(join.unpairedVerdicts).toEqual([]);
    expect(join.disagreements).toEqual([]);
  });

  it('reports a fingerprint with no verdict line', () => {
    const join = joinHeadroom([recordOf(closeCase)], []);
    expect(join.cases).toEqual([]);
    expect(join.unpairedFingerprints).toEqual(['case-1']);
  });

  it('reports a verdict line with no fingerprint', () => {
    const join = joinHeadroom([], [verdictOf(closeCase)]);
    expect(join.unpairedVerdicts).toEqual(['case-1']);
  });

  it('refuses a pair whose orders disagree, because the two files are then from different runs', () => {
    const join = joinHeadroom(
      [recordOf(closeCase)],
      [{ ...verdictOf(closeCase), ranked: ['svc-b', 'svc-a'] }],
    );
    expect(join.cases).toEqual([]);
    expect(join.disagreements).toEqual(['case-1']);
  });

  it('compares only the width both sides carry, so a shorter ranking is not a disagreement', () => {
    const join = joinHeadroom(
      [recordOf(closeCase)],
      [{ ...verdictOf(closeCase), ranked: ['svc-a'] }],
    );
    expect(join.cases).toHaveLength(1);
  });
});

describe('oracleClaims', () => {
  it('proposes nothing when the truth already leads', () => {
    expect(oracleClaims([rareTruth, ordinaryLeader], ['svc-b'])).toEqual([]);
  });

  it('proposes nothing when the posterior does not hold the truth at all', () => {
    expect(oracleClaims([ordinaryLeader, rareTruth], ['svc-z'])).toEqual([]);
  });

  it('proposes one claim per candidate above the truth, citing a channel shared with the truth', () => {
    const third = candidate('svc-c', 2, 1, [fired('mem', 9, 0.5)]);
    const claims = oracleClaims(
      [ordinaryLeader, candidate('svc-x', 1, 1.8, [fired('cpu', 7, 0.2)]), rareTruth, third],
      ['svc-b'],
    );
    expect(claims).toHaveLength(2);
    expect(claims.map((claim) => claim.remove)).toEqual(['svc-a', 'svc-x']);
    // The claim's `keep` is the truth, and its citation is on a channel the truth also carries — a channel only
    // the removed candidate has would be refused as `unknown-channel`.
    expect(claims.every((claim) => claim.keep === 'svc-b' && claim.because.channel === 'cpu')).toBe(
      true,
    );
  });

  it('proposes nothing when a candidate above the truth carries no out-of-band channel it shares with it', () => {
    const leader = candidate('svc-a', 0, 2, [fired('mem', 5, 0.5)]);
    expect(oracleClaims([leader, rareTruth], ['svc-b'])).toEqual([]);
  });
});

describe('evidenceClaims', () => {
  it('demotes a leader whose evidence is ordinary in favour of a rival whose evidence is rare', () => {
    const claims = evidenceClaims([ordinaryLeader, rareTruth], { rateFloor: 0.33, margin: 0 });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      remove: 'svc-a',
      keep: 'svc-b',
      because: { channel: 'cpu', observed: 5, rate: 0.67 },
    });
  });

  it('abstains when the leader has no out-of-band channel at all, because there is nothing to cite', () => {
    const quietLeader = candidate('svc-a', 0, 2, [quiet('cpu')]);
    expect(evidenceClaims([quietLeader, rareTruth], { rateFloor: 0, margin: 0 })).toEqual([]);
  });

  it('abstains when the leader is the only candidate carrying the fired channel', () => {
    const loneLeader = candidate('svc-a', 0, 2, [fired('cpu', 5, 0.9)]);
    const rival = candidate('svc-b', 1, 1, [fired('mem', 3, 0)]);
    expect(evidenceClaims([loneLeader, rival], { rateFloor: 0, margin: 0 })).toEqual([]);
  });

  it('abstains when the leader evidence is rarer than the floor', () => {
    expect(evidenceClaims([ordinaryLeader, rareTruth], { rateFloor: 0.8, margin: 0 })).toEqual([]);
  });

  it('abstains when the rival is not rarer by the required margin', () => {
    const nearRival = candidate('svc-b', 1, 1, [fired('cpu', 4, 0.66)]);
    expect(evidenceClaims([ordinaryLeader, nearRival], { rateFloor: 0.33, margin: 0.1 })).toEqual(
      [],
    );
  });

  it('takes the leader least ordinary argument, not the first channel it happens to carry', () => {
    const leader = candidate('svc-a', 0, 2, [fired('cpu', 9, 0.9), fired('mem', 5, 0.4)]);
    const rival = candidate('svc-b', 1, 1, [fired('cpu', 4, 0), fired('mem', 2, 0)]);
    const claims = evidenceClaims([leader, rival], { rateFloor: 0.33, margin: 0 });
    // `mem` at 0.4 is the strongest thing the leader can say for itself; a claim citing `cpu` at 0.9 would
    // overstate its case, and an arm that overstated it would be measuring a different hypothesis.
    expect(claims[0]?.because.channel).toBe('mem');
    expect(claims[0]?.because.rate).toBe(0.4);
  });

  it('abstains on an empty posterior', () => {
    expect(evidenceClaims([], { rateFloor: 0, margin: 0 })).toEqual([]);
  });
});

describe('scoreArm', () => {
  const wrongCase = headroomCase('case-wrong', [ordinaryLeader, rareTruth]);

  it('scores the control from the posterior it was given and moves nothing', () => {
    const outcome = scoreArm([wrongCase, rightCase], {
      arm: 'engine',
      weight: 0,
      useSkipRule: false,
    });
    expect(outcome).toMatchObject({ cases: 2, correct: 1, top1: 0.5, moved: 0, claims: 0 });
  });

  it('reaches the oracle ceiling at weight 1', () => {
    const outcome = scoreArm([wrongCase], { arm: 'oracle', weight: 1, useSkipRule: false });
    expect(outcome).toMatchObject({ correct: 1, moved: 1, reachable: 1, claims: 1 });
  });

  it('is the identity at weight 0, which is the layer switched off', () => {
    const outcome = scoreArm([wrongCase], { arm: 'oracle', weight: 0, useSkipRule: false });
    // The claim is still proposed and still verified — the weight is what decides whether it acts, and zero must
    // be indistinguishable from a layer that does not exist.
    expect(outcome).toMatchObject({ correct: 0, moved: 0, claims: 1, reachable: 1 });
  });

  it('counts a case whose truth is outside the posterior as absent rather than as a failure to move it', () => {
    const noTruth = headroomCase(
      'case-absent',
      [ordinaryLeader, candidate('svc-b', 1, 1, [quiet('cpu')])],
      ['svc-z'],
    );
    const outcome = scoreArm([noTruth], { arm: 'oracle', weight: 1, useSkipRule: false });
    expect(outcome).toMatchObject({ truthAbsent: 1, reachable: 0, abstained: 1, moved: 0 });
  });

  it('scores the evidence arm end to end, and reports the claims it made', () => {
    const outcome = scoreArm([wrongCase, rightCase], {
      arm: 'evidence',
      weight: 1,
      useSkipRule: false,
      thresholds: { rateFloor: 0.33, margin: 0 },
    });
    // The wrong case is corrected; the right case cites nothing because its leader's evidence is already rare.
    expect(outcome).toMatchObject({ correct: 2, moved: 1, claims: 1, abstained: 1 });
    expect(outcome.top1).toBe(1);
  });

  it('does not consult a method arm when the skip rule resolves the case on margin', () => {
    const wide = headroomCase('case-wide', [
      candidate('svc-a', 0, 10, [fired('cpu', 5, 0.9)]),
      candidate('svc-b', 1, 1, [fired('cpu', 4, 0)]),
    ]);
    const outcome = scoreArm([wide], {
      arm: 'evidence',
      weight: 1,
      useSkipRule: true,
      thresholds: { rateFloor: 0, margin: 0 },
    });
    expect(outcome.skipped.margin).toBe(1);
    expect(outcome.abstained).toBe(1);
    expect(outcome.moved).toBe(0);
  });

  it('still measures the ceiling on a case the skip rule would have resolved', () => {
    const wide = headroomCase('case-wide', [
      candidate('svc-a', 0, 10, [fired('cpu', 5, 0.9)]),
      candidate('svc-b', 1, 1, [fired('cpu', 4, 0)]),
    ]);
    const outcome = scoreArm([wide], { arm: 'oracle', weight: 1, useSkipRule: true });
    expect(outcome).toMatchObject({
      skipped: { margin: 1, evidence: 0, none: 0 },
      moved: 1,
      correct: 1,
    });
  });

  it('counts a refused claim and abstains, rather than clamping it', () => {
    const recorded = new Map([
      [
        'case-wrong',
        [
          {
            remove: 'svc-a',
            keep: 'svc-b',
            because: {
              channel: 'cpu',
              statistic: 'post' as const,
              observed: 999,
              band: [0, 1] as const,
            },
          },
        ],
      ],
    ]);
    const outcome = scoreArm([wrongCase], {
      arm: 'recorded',
      weight: 1,
      useSkipRule: false,
      recorded,
    });
    expect(outcome.refused['value-disagrees-with-fingerprint']).toBe(1);
    expect(outcome).toMatchObject({ moved: 0, abstained: 1, claims: 1 });
  });

  it('applies a recorded claim that verifies', () => {
    const recorded = new Map([
      [
        'case-wrong',
        [
          {
            remove: 'svc-a',
            keep: 'svc-b',
            because: {
              channel: 'cpu',
              statistic: 'post' as const,
              observed: 5,
              band: [0, 1] as const,
              rate: 0.67,
            },
          },
        ],
      ],
    ]);
    const outcome = scoreArm([wrongCase], {
      arm: 'recorded',
      weight: 1,
      useSkipRule: false,
      recorded,
    });
    expect(outcome).toMatchObject({ moved: 1, correct: 1 });
  });

  it('reports a rate that disagrees with the fingerprint as its own refusal', () => {
    const recorded = new Map([
      [
        'case-wrong',
        [
          {
            remove: 'svc-a',
            keep: 'svc-b',
            because: {
              channel: 'cpu',
              statistic: 'post' as const,
              observed: 5,
              band: [0, 1] as const,
              rate: 0.1,
            },
          },
        ],
      ],
    ]);
    const outcome = scoreArm([wrongCase], {
      arm: 'recorded',
      weight: 1,
      useSkipRule: false,
      recorded,
    });
    expect(outcome.refused['rate-disagrees-with-fingerprint']).toBe(1);
  });

  it('counts every skip reason, so the cost rule is a measurement rather than a claim', () => {
    const empty = headroomCase('case-empty', [], ['svc-b']);
    const outcome = scoreArm([empty], { arm: 'engine', weight: 0, useSkipRule: false });
    // An empty posterior is `evidence`, not `margin`: an agent has nothing to eliminate from.
    expect(outcome.skipped.evidence).toBe(1);
    expect(outcome.skipped.none).toBe(0);
  });
});

describe('takeSplit', () => {
  it('partitions the corpus into two disjoint halves that together hold every case', () => {
    const cases = Array.from({ length: 40 }, (_, index) =>
      headroomCase(`case-${index}`, [ordinaryLeader]),
    );
    const inside = takeSplit(cases, 'in');
    const outside = takeSplit(cases, 'out');
    expect(inside.length + outside.length).toBe(cases.length);
    const ids = new Set(inside.map((oneCase) => oneCase.datapack));
    expect(outside.every((oneCase) => !ids.has(oneCase.datapack))).toBe(true);
    expect(takeSplit(cases, 'all')).toHaveLength(cases.length);
  });

  it('assigns a case to one half by its id alone', () => {
    expect(splitOf('case-1')).toBe(splitOf('case-1'));
    expect(['in', 'out']).toContain(splitOf('case-1'));
  });
});

describe('sweepEvidence', () => {
  it('reports one point per threshold pair and marks the best in-sample point', () => {
    const points = sweepEvidence([closeCase], {
      floors: [0, 0.5, 0.9],
      margins: [0, 0.2],
      weight: 1,
      useSkipRule: false,
    });
    expect(points).toHaveLength(6);
    const best = bestSweepPoint(points);
    // At floor 0 the leader qualifies and is demoted; above 0.67 it does not, so the sweep must separate.
    expect(best?.outcome.top1).toBe(1);
    expect(best?.rateFloor).toBe(0);
  });

  it('returns nothing for an empty sweep', () => {
    expect(bestSweepPoint([])).toBeUndefined();
  });

  it('keeps the earliest point on a tie, so the choice is not a property of the grid order', () => {
    const points = sweepEvidence([rightCase], {
      floors: [0, 0.5],
      margins: [0],
      weight: 1,
      useSkipRule: false,
    });
    expect(points.map((point) => point.outcome.top1)).toEqual([1, 1]);
    expect(bestSweepPoint(points)?.rateFloor).toBe(0);
  });
});

describe('the arms on the cases the first pass did not reach', () => {
  it('reads a departure BELOW the band as evidence, not only above it', () => {
    // A channel that collapsed is as anomalous as one that spiked, and an arm that only read the upper bound
    // would silently abstain on every case whose fault made a metric fall.
    const collapsed = candidate('svc-a', 0, 2, [
      { label: 'cpu', pre: 1, post: -5, band: [0, 1], rate: 0.6 },
    ]);
    const rival = candidate('svc-b', 1, 1, [fired('cpu', 4, 0)]);
    const claims = evidenceClaims([collapsed, rival], { rateFloor: 0.33, margin: 0 });
    expect(claims[0]).toMatchObject({ remove: 'svc-a', because: { observed: -5, rate: 0.6 } });
    expect(oracleClaims([collapsed, rival], ['svc-b'])).toHaveLength(1);
  });

  it('cites the loudest shared channel, even when a later channel is weaker', () => {
    const leader = candidate('svc-a', 0, 2, [fired('cpu', 9, 0.5), fired('mem', 3, 0.5)]);
    const truth = candidate('svc-b', 1, 1, [fired('cpu', 4, 0), fired('mem', 2, 0)]);
    const claims = oracleClaims([leader, truth], ['svc-b']);
    expect(claims[0]?.because.channel).toBe('cpu');
  });

  it('keeps the rarer of two shared channels when the later one is noisier', () => {
    // `mem` at 0.4 is already the better citation; a `cpu` at 0.9 must not replace it, or the claim would
    // overstate the leader's case and the arm would be measuring a different hypothesis than the one it names.
    const leader = candidate('svc-a', 0, 2, [fired('mem', 5, 0.4), fired('cpu', 9, 0.9)]);
    const rival = candidate('svc-b', 1, 1, [fired('mem', 2, 0), fired('cpu', 4, 0)]);
    const claims = evidenceClaims([leader, rival], { rateFloor: 0.33, margin: 0 });
    expect(claims[0]?.because.channel).toBe('mem');
  });

  it('abstains on a posterior with one candidate, which is nothing to eliminate FROM', () => {
    expect(evidenceClaims([ordinaryLeader], { rateFloor: 0, margin: 0 })).toEqual([]);
  });

  it('skips a leader channel that is shared but inside its band', () => {
    const leader = candidate('svc-a', 0, 2, [quiet('cpu'), fired('mem', 5, 0.9)]);
    const rival = candidate('svc-b', 1, 1, [quiet('cpu'), fired('mem', 4, 0)]);
    expect(
      evidenceClaims([leader, rival], { rateFloor: 0.33, margin: 0 })[0]?.because.channel,
    ).toBe('mem');
  });

  it('skips a rival that does not carry the cited channel, or carries it inside its band', () => {
    const leader = candidate('svc-a', 0, 2, [fired('cpu', 5, 0.9)]);
    const without = candidate('svc-b', 1, 1, [fired('mem', 3, 0)]);
    const inside = candidate('svc-c', 1, 1, [quiet('cpu')]);
    expect(evidenceClaims([leader, without], { rateFloor: 0.33, margin: 0 })).toEqual([]);
    expect(evidenceClaims([leader, inside], { rateFloor: 0.33, margin: 0 })).toEqual([]);
  });

  it('abstains for a recorded arm that was given no claims for the case', () => {
    const outcome = scoreArm([closeCase], { arm: 'recorded', weight: 1, useSkipRule: false });
    expect(outcome).toMatchObject({ abstained: 1, claims: 0, moved: 0 });
  });

  it('falls back to the arm most permissive thresholds when none are given', () => {
    const outcome = scoreArm([closeCase], { arm: 'evidence', weight: 1, useSkipRule: false });
    // floor 0 and margin 0: every leader with a shared out-of-band channel qualifies.
    expect(outcome.moved).toBe(1);
  });

  it('takes a right answer away when a claim removes the candidate that was right', () => {
    const recorded = new Map([
      [
        'case-right',
        [
          {
            remove: 'svc-b',
            keep: 'svc-a',
            because: {
              channel: 'cpu',
              statistic: 'post' as const,
              observed: 4,
              band: [0, 1] as const,
            },
          },
        ],
      ],
    ]);
    const outcome = scoreArm([rightCase], {
      arm: 'recorded',
      weight: 1,
      useSkipRule: false,
      recorded,
    });
    // The engine was right and the claim moved it: the count must FALL rather than stay, or a layer that damages
    // the answer would be reported as free.
    expect(outcome).toMatchObject({ moved: 1, correct: 0 });
  });

  it('does not credit a move that lands on an answer the corpus does not accept', () => {
    const third = candidate('svc-c', 1, 1.5, [fired('cpu', 4, 0.1)]);
    const wrongCase = headroomCase('case-third', [ordinaryLeader, third], ['svc-b']);
    const recorded = new Map([
      [
        'case-third',
        [
          {
            remove: 'svc-a',
            keep: 'svc-c',
            because: {
              channel: 'cpu',
              statistic: 'post' as const,
              observed: 5,
              band: [0, 1] as const,
            },
          },
        ],
      ],
    ]);
    const outcome = scoreArm([wrongCase], {
      arm: 'recorded',
      weight: 1,
      useSkipRule: false,
      recorded,
    });
    expect(outcome).toMatchObject({ moved: 1, correct: 0 });
  });

  it('reports a rate of zero over an empty population rather than dividing by it', () => {
    expect(scoreArm([], { arm: 'engine', weight: 0, useSkipRule: false })).toMatchObject({
      cases: 0,
      correct: 0,
      top1: 0,
    });
  });
});
