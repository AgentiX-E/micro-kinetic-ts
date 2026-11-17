/**
 * The gate: cross-fitted priors, the reconstruction check, and the pre-registered verdict.
 *
 * The corpora here are generated rather than written out, because the numbers under test are POPULATION
 * properties — an edge needs ten observations before it has a residual, so a fixture that argued about the gate
 * with two cases would be arguing about a population that cannot support one. Each fold is therefore built from
 * a small pattern list repeated to the size the floor requires, and the fold assignment is read from `foldOf`
 * rather than assumed, so a change to the hash breaks the fixture loudly instead of silently re-cutting it.
 *
 * @module benchmarks/__tests__/containment-gate
 */

import { describe, expect, it } from 'vitest';

import { failureEdgeKey } from '../../packages/tree/src/index.js';
import {
  GATE_THRESHOLD,
  STANDING_CRITERION,
  compareEdgeKeys,
  fitPrior,
  foldOf,
  gateReadingToJson,
  gateVerdict,
  otherFold,
  priorsFor,
  readGate,
  type CorpusFold,
  type GateReading,
} from '../src/containment-gate.js';
import { headOf, replayCase } from '../src/containment-replay.js';
import {
  buildContainmentRow,
  type BuildContainmentRowInput,
} from '../src/containment-row-build.js';
import type { ContainmentCaseRow } from '../src/containment-rows.js';

// ── Fixtures ──────────────────────────────────────────────

/** `count` case names per fold, taken from one scan so the fixture names are reproducible. */
function namesByFold(count: number): Record<CorpusFold, string[]> {
  const out: Record<CorpusFold, string[]> = { a: [], b: [] };
  for (let i = 0; out.a.length < count || out.b.length < count; i++) {
    const name = `case-${i}`;
    const fold = foldOf(name);
    if (out[fold].length < count) out[fold].push(name);
  }
  return out;
}

/** One case: the caller's excursion, the callee's, and what the corpus accepts as the answer. */
interface CaseSpec {
  readonly a: number;
  readonly b: number;
  readonly accepted: readonly string[];
}

/**
 * One case's dump row, with the top-1 its own chain produces.
 *
 * The recorded top-1 is computed rather than passed so that every generated row is a HEALTHY artifact: the
 * disagreement counter is meant to fire on a broken dump, and a fixture that tripped it by accident would make
 * the reading refuse itself.
 */
function rowFor(name: string, spec: CaseSpec): ContainmentCaseRow {
  const input: BuildContainmentRowInput = {
    datapack: name,
    faultType: 'NetworkDelay',
    sigma: 3,
    margin: 0,
    edges: [{ from: 'a', to: 'b' }],
    excursions: new Map([
      ['a', spec.a],
      ['b', spec.b],
    ]),
    failedInterfaces: new Map([[failureEdgeKey('a', 'b'), 4]]),
    failureFlows: undefined,
    failingEdges: undefined,
    attribution: 'shape',
    fusionOrder: ['a', 'b'],
    publishedOrder: [],
  };
  const built = buildContainmentRow(input);
  const replayed = replayCase(built, { kind: 'shipped' });
  return replayed === null ? built : { ...built, shippedTop1: headOf(replayed.published) };
}

/** A corpus of `count` cases per fold, each fold running the same pattern list cyclically. */
function corpusOf(
  count: number,
  pattern: (fold: CorpusFold) => readonly CaseSpec[],
): { rows: ContainmentCaseRow[]; accepted: Map<string, readonly string[]> } {
  const names = namesByFold(count);
  const rows: ContainmentCaseRow[] = [];
  const accepted = new Map<string, readonly string[]>();
  for (const fold of ['a', 'b'] as const) {
    const specs = pattern(fold);
    names[fold].forEach((name, index) => {
      const spec = specs[index % specs.length]!;
      rows.push(rowFor(name, spec));
      accepted.set(name, spec.accepted);
    });
  }
  return { rows, accepted };
}

/**
 * A fold whose two ends move together: 6 of 12 cases have both out, 1 has only the callee out, 2 only the
 * caller, 3 neither. `p_caller = 2/3`, `p_callee = 7/12`, both `= 1/2`, so `ρ = 1/2 − 7/18 > 0`.
 */
const CO_MOVING: readonly CaseSpec[] = [
  ...Array.from({ length: 6 }, () => ({ a: 2, b: 3, accepted: ['b'] })),
  { a: 0, b: 1, accepted: ['b'] },
  ...Array.from({ length: 2 }, () => ({ a: 2, b: 1, accepted: ['a'] })),
  ...Array.from({ length: 3 }, () => ({ a: 0, b: 0, accepted: ['a'] })),
];

/**
 * The same caller marginals with the joint collapsed to nothing: 8 cases have only the caller out, 4 only the
 * callee, none both. `p_caller = 2/3`, `p_callee = 1/3`, joint `= 0`, so `ρ = −2/9` — and only FOUR cases invert,
 * which is what lets a test tell which half was gated by which prior.
 */
const ANTI_MOVING: readonly CaseSpec[] = [
  ...Array.from({ length: 4 }, () => ({ a: 0, b: 1, accepted: ['b'] })),
  ...Array.from({ length: 8 }, () => ({ a: 2, b: 1, accepted: ['a'] })),
];

/** A minimal reading for the verdict's arithmetic. */
function readingOf(overrides: Partial<GateReading['arms']['prior']> = {}): GateReading {
  return {
    cases: 100,
    replayable: 100,
    scored: 100,
    disagreements: 0,
    priors: [],
    arms: {
      fusion: { top1: 90, gains: 0, losses: 0 },
      shipped: { top1: 95, gains: 5, losses: 0 },
      prior: { top1: 1_160, gains: 15, losses: 0, ...overrides },
    },
    decisions: {
      inverted: 0,
      'no-failed-interface': 0,
      unmeasured: 0,
      'not-larger': 0,
      'prior-absent': 0,
      'prior-below': 0,
    },
    blocked: { absent: 0, below: 0 },
  };
}

// ── foldOf ────────────────────────────────────────────────

describe('foldOf', () => {
  it('is a function of the name alone, so a reader holding one row can place it', () => {
    expect(foldOf('train-ticket_cpu_0001')).toBe(foldOf('train-ticket_cpu_0001'));
  });

  it('places consecutive names on both sides', () => {
    // The property the split needs: a dump sorted by directory must not put a contiguous run of cases on one
    // side, because on this corpus the directory order groups by fault family.
    expect(new Set(Array.from({ length: 32 }, (_, i) => foldOf(`case-${i}`)))).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('splits a realistic name set within a few cases of even', () => {
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 400; i++) counts[foldOf(`train-ticket_pod-failure_${i}`)] += 1;
    expect(Math.abs(counts.a - counts.b)).toBeLessThan(40);
  });

  it('does not let the fold be a function of the name s length', () => {
    // A hash that degenerated to a length check would still split a directory listing and would be wrong. Same
    // length, different names, both sides.
    const sameLength = Array.from({ length: 12 }, (_, i) => String.fromCharCode(97 + i).repeat(3));
    expect(new Set(sameLength.map(foldOf))).toEqual(new Set(['a', 'b']));
  });
});

describe('otherFold', () => {
  it('is an involution', () => {
    expect(otherFold('a')).toBe('b');
    expect(otherFold(otherFold('a'))).toBe('a');
  });
});

// ── fitPrior ──────────────────────────────────────────────

describe('fitPrior', () => {
  it('fits from one half and applies to the other', () => {
    const { rows } = corpusOf(12, () => CO_MOVING);
    const prior = fitPrior(rows, 'a');
    expect(prior.fittedOn).toBe('a');
    expect(prior.appliesTo).toBe('b');
  });

  it('admits an edge that co-moves and refuses one that does not', () => {
    const coMoving = fitPrior(corpusOf(12, () => CO_MOVING).rows, 'a');
    const antiMoving = fitPrior(corpusOf(12, () => ANTI_MOVING).rows, 'a');
    expect(coMoving.admitted).toBe(1);
    expect(coMoving.fitted).toBe(1);
    expect(coMoving.unfitted).toBe(0);
    expect(antiMoving.fitted).toBe(1);
    expect(antiMoving.admitted).toBe(0);
  });

  it('keys the admitted edge in BOTH directions, because the residual is symmetric', () => {
    const prior = fitPrior(corpusOf(12, () => CO_MOVING).rows, 'a');
    expect(prior.prior.residuals.get(failureEdgeKey('a', 'b'))).toBeGreaterThan(GATE_THRESHOLD);
    expect(prior.prior.residuals.get(failureEdgeKey('b', 'a'))).toBe(
      prior.prior.residuals.get(failureEdgeKey('a', 'b')),
    );
  });

  it('reports an edge the half could not fit instead of admitting it', () => {
    // Three cases per fold: below the floor, so there is no residual — and no residual is not a zero residual.
    // A gate that admitted it would be admitting every thin edge in the corpus.
    const prior = fitPrior(corpusOf(3, () => CO_MOVING).rows, 'a');
    expect(prior.edges).toBe(1);
    expect(prior.fitted).toBe(0);
    expect(prior.unfitted).toBe(1);
    expect(prior.admitted).toBe(0);
    expect(prior.prior.residuals.size).toBe(0);
    expect(prior.observations).toBe(3);
  });

  it('fits the same edges whichever half it reads', () => {
    const rows = corpusOf(12, () => CO_MOVING).rows;
    expect(fitPrior(rows, 'a').admitted).toBe(fitPrior(rows, 'b').admitted);
  });

  it('does not read the labels, because a prior fitted to them would be the answer', () => {
    // Every accepted set flipped: the fit must be byte-identical, since ρ counts excursions and knows nothing
    // about whether the case was answered correctly.
    const straight = corpusOf(12, () => CO_MOVING).rows;
    const flipped = corpusOf(12, () =>
      CO_MOVING.map((spec) => ({ ...spec, accepted: spec.accepted[0] === 'b' ? ['a'] : ['b'] })),
    ).rows;
    expect(fitPrior(flipped, foldOf(straight[0]!.datapack))).toEqual(
      fitPrior(straight, foldOf(straight[0]!.datapack)),
    );
  });

  it('fits from phi when asked, and refuses an edge whose marginal is degenerate', () => {
    // Every case has both ends out of band, so ρ reads 0 and φ is undefined: the two statistics disagree about
    // whether this edge may be admitted, and that disagreement is the ceiling in one line.
    const degenerate: readonly CaseSpec[] = Array.from({ length: 12 }, () => ({
      a: 2,
      b: 3,
      accepted: ['b'],
    }));
    const rows = corpusOf(12, () => degenerate).rows;
    const rho = fitPrior(rows, 'a', 'rho');
    const phi = fitPrior(rows, 'a', 'phi');
    expect(rho.fitted).toBe(1);
    expect(rho.admitted).toBe(0);
    expect(phi.fitted).toBe(0);
    expect(phi.unfitted).toBe(1);
    expect(phi.score).toBe('phi');
  });
});

describe('priorsFor', () => {
  it('keys each prior by the half it may be APPLIED to, so it cannot be applied to its own', () => {
    const priors = priorsFor(corpusOf(12, () => CO_MOVING).rows);
    expect(priors.get('a')!.fittedOn).toBe('b');
    expect(priors.get('b')!.fittedOn).toBe('a');
  });
});

// ── readGate ──────────────────────────────────────────────

describe('readGate', () => {
  it('reconstructs the shipped arm from the chain, which is what makes the artifact usable', () => {
    const { rows, accepted } = corpusOf(12, () => CO_MOVING);
    const reading = readGate(rows, accepted);
    expect(reading.cases).toBe(24);
    expect(reading.replayable).toBe(24);
    expect(reading.disagreements).toBe(0);
    // Seven of twelve cases per fold invert (`b` is further out), and every one of them is accepted as `b`.
    expect(reading.arms.fusion.top1).toBe(24 - 14);
    expect(reading.arms.shipped.top1).toBe(24);
    expect(reading.arms.shipped.gains).toBe(14);
    expect(reading.arms.shipped.losses).toBe(0);
  });

  it('gates each half with the prior fitted on the OTHER half', () => {
    // Fold `a` co-moves (7 would-be inversions) and fold `b` does not (4). The prior applied to `a` therefore
    // comes from `b` and refuses, while the prior applied to `b` comes from `a` and admits. A gate fitted on its
    // own half reads the mirror image — 4 refused and 7 admitted — which is what makes the two COUNTS, and not
    // only the totals, the assertion.
    const { rows, accepted } = corpusOf(12, (fold) => (fold === 'a' ? CO_MOVING : ANTI_MOVING));
    const reading = readGate(rows, accepted);
    expect(reading.decisions['prior-below']).toBe(7);
    expect(reading.decisions['prior-absent']).toBe(0);
    expect(reading.decisions.inverted).toBe(4);
    // Fold `a` keeps the fusion answer, which is wrong on its seven would-be inversions; fold `b` moves and is
    // right on all twelve.
    expect(reading.arms.prior.top1).toBe(fusionCorrect(CO_MOVING) + 12);
    expect(reading.arms.prior.gains).toBe(4);
    expect(reading.arms.prior.losses).toBe(0);
  });

  it('counts a refused inversion as blocked, not as an arm that lost the case', () => {
    const { rows, accepted } = corpusOf(12, (fold) => (fold === 'a' ? CO_MOVING : ANTI_MOVING));
    const reading = readGate(rows, accepted);
    expect(reading.blocked.below).toBe(7);
    expect(reading.blocked.absent).toBe(0);
    // The blocked cases are the fusion's answers, so the arm loses nothing: a refusal is not a movement.
    expect(reading.arms.prior.top1 + 7).toBe(reading.arms.shipped.top1);
  });

  it('separates a fitted refusal from an unfitted one', () => {
    // Both halves anti-move, so the prior applied to either is FITTED and negative. The two reasons must appear
    // in different counters: one is the corpus disagreeing, the other is the corpus not knowing, and a gate that
    // merged them would report unmeasured edges as edges that moved against it.
    const { rows, accepted } = corpusOf(12, () => ANTI_MOVING);
    const reading = readGate(rows, accepted);
    expect(reading.blocked.absent).toBe(0);
    expect(reading.blocked.below).toBe(8);
  });

  it('refuses every inversion when no half can fit the edge', () => {
    const { rows, accepted } = corpusOf(3, () => CO_MOVING);
    const reading = readGate(rows, accepted);
    // Three cases per fold is below the population floor, so there is no residual at all — and the three cases
    // sampled are the pattern's first three, all of which invert.
    expect(reading.decisions['prior-absent']).toBe(6);
    expect(reading.arms.prior.top1).toBe(reading.arms.fusion.top1);
  });

  it('reports no prior at all when the dump carries no chain', () => {
    const { rows, accepted } = corpusOf(12, () => CO_MOVING);
    const stripped = rows.map(({ chain: _dropped, ...rest }) => rest);
    const reading = readGate(stripped, accepted);
    expect(reading.cases).toBe(24);
    expect(reading.replayable).toBe(0);
    expect(reading.scored).toBe(0);
    expect(reading.disagreements).toBe(0);
  });

  it('counts a disagreement rather than averaging over it', () => {
    const { rows, accepted } = corpusOf(12, () => CO_MOVING);
    const tampered = rows.map((row) => ({ ...row, shippedTop1: 'nobody' }));
    expect(readGate(tampered, accepted).disagreements).toBe(24);
  });

  it('leaves a case with no accepted answer out of every arm', () => {
    const { rows } = corpusOf(12, () => CO_MOVING);
    const reading = readGate(rows, new Map());
    expect(reading.replayable).toBe(24);
    expect(reading.scored).toBe(0);
    expect(reading.arms.prior.top1).toBe(0);
    // The census still describes the walks: behaviour is a property of the sweep, not of the labels.
    expect(reading.decisions.inverted).toBe(14);
  });

  it('leaves a case whose arms produced no answer out of the denominator', () => {
    // A case with no candidate has no first candidate, and "no answer" is neither right nor wrong: counting it
    // as wrong would make a dump's coverage look like a capability, and counting it as right would make an empty
    // order look like a hit.
    const { rows, accepted } = corpusOf(12, () => CO_MOVING);
    const truncated = rows.map((row, index) =>
      index < 2
        ? {
            ...row,
            shippedTop1: null,
            chain: { ...row.chain!, order: [], edges: [], excursions: {} },
          }
        : row,
    );
    const reading = readGate(truncated, accepted);
    expect(reading.cases).toBe(24);
    expect(reading.replayable).toBe(24);
    expect(reading.disagreements).toBe(0);
    expect(reading.scored).toBe(22);
    expect(reading.arms.fusion.top1 + reading.arms.shipped.top1).toBe(10 + 22);
  });

  it('counts a loss when the pass moves a case off the answer it had right', () => {
    // The `−0` in the criterion is a real quantity, not a formality: with every case accepting the caller, the
    // seven inverting ones are moved OFF the right answer. Both arms that invert must show it — the shipped one,
    // and the prior one, because this corpus co-moves and the gate therefore admits the same seven.
    const wrongToMove: readonly CaseSpec[] = CO_MOVING.map((spec) => ({
      ...spec,
      accepted: ['a'],
    }));
    const { rows, accepted } = corpusOf(12, () => wrongToMove);
    const reading = readGate(rows, accepted);
    expect(reading.arms.fusion.top1).toBe(24);
    expect(reading.arms.shipped.top1).toBe(10);
    expect(reading.arms.shipped.losses).toBe(14);
    expect(reading.arms.shipped.gains).toBe(0);
    expect(reading.arms.prior.top1).toBe(10);
    expect(reading.arms.prior.losses).toBe(14);
  });

  it('fits phi when asked and reads the same structure through it', () => {
    const { rows, accepted } = corpusOf(12, () => CO_MOVING);
    const reading = readGate(rows, accepted, 'phi');
    expect(reading.priors.map((prior) => prior.score)).toEqual(['phi', 'phi']);
    expect(reading.arms.prior.top1).toBe(reading.arms.shipped.top1);
  });
});

/** How many cases of a pattern the FUSION already answers correctly: its answer is always `a`. */
function fusionCorrect(pattern: readonly CaseSpec[]): number {
  return pattern.filter((spec) => spec.accepted.includes('a')).length;
}

// ── gateVerdict ───────────────────────────────────────────

describe('gateVerdict', () => {
  it('passes an arm that clears both numbers', () => {
    expect(gateVerdict(readingOf()).verdict).toBe('pass');
  });

  it('fails an arm one gain short', () => {
    const verdict = gateVerdict(readingOf({ gains: 14 }));
    expect(verdict.verdict).toBe('fail');
    expect(verdict.reason).toMatch(/14 .* below the 15/);
  });

  it('fails an arm that takes a single loss, however many gains it adds', () => {
    // The pre-registration's `−0` is not a tie-breaker: a pass that trades a wrong answer for a right one is a
    // different mechanism than one that moves cases, and the register has refused two arms on this clause.
    const verdict = gateVerdict(readingOf({ gains: 40, losses: 1, top1: 1_200 }));
    expect(verdict.verdict).toBe('fail');
    expect(verdict.reason).toMatch(/1 loss/);
  });

  it('fails an arm that clears the ± but does not exceed the shipped top-1', () => {
    expect(gateVerdict(readingOf({ gains: 20, top1: 1_156 })).verdict).toBe('fail');
    expect(gateVerdict(readingOf({ gains: 20, top1: 1_157 })).verdict).toBe('pass');
  });

  it('is unmeasured when no row carries the sweep input', () => {
    const verdict = gateVerdict({ ...readingOf(), replayable: 0 });
    expect(verdict.verdict).toBe('unmeasured');
    expect(verdict.reason).toMatch(/no row carries/);
  });

  it('is unmeasured when only part of the dump carries it', () => {
    // A reading over the rows that happened to be walkable would be a population the run never declared, and it
    // would be compared against a whole-corpus number — which is worse than no reading.
    const verdict = gateVerdict({ ...readingOf(), replayable: 99 });
    expect(verdict.verdict).toBe('unmeasured');
    expect(verdict.reason).toMatch(/1 of 100 rows/);
  });

  it('is unmeasured when the chain does not reproduce the run', () => {
    const verdict = gateVerdict({ ...readingOf(), disagreements: 2 });
    expect(verdict.verdict).toBe('unmeasured');
    expect(verdict.reason).toMatch(/2 case/);
  });

  it('reads the criterion it is given rather than the one it ships with', () => {
    const lenient = gateVerdict(readingOf({ gains: 3, top1: 1_000 }), {
      gains: 3,
      losses: 0,
      shippedTop1: 999,
    });
    expect(lenient.verdict).toBe('pass');
    expect(STANDING_CRITERION).toEqual({ gains: 15, losses: 0, shippedTop1: 1_156 });
  });
});

// ── gateReadingToJson ─────────────────────────────────────

describe('gateReadingToJson', () => {
  it('writes the prior’s residual map as sorted entries instead of an empty object', () => {
    // `JSON.stringify(new Map())` is `{}`. The artifact this was found on recorded `"residuals": {}` and kept
    // `fitted`/`admitted` while losing which edges they were, so a reader holding the JSON could not reproduce an
    // admission — the property the chain was added to guarantee. This is the fix, asserted through the same
    // `JSON.stringify` a reader would use rather than against the object's shape.
    const { rows, accepted } = corpusOf(12, () => CO_MOVING);
    const reading = readGate(rows, accepted, 'rho');
    const json = JSON.parse(JSON.stringify(gateReadingToJson(reading))) as {
      priors: { prior: { threshold: number; residuals: [string, number][] } }[];
    };
    expect(json.priors).toHaveLength(2);
    for (const prior of json.priors) {
      expect(prior.prior.threshold).toBe(0);
      expect(Array.isArray(prior.prior.residuals)).toBe(true);
      // Sorted, so two runs of one corpus diff cleanly instead of reordering themselves.
      const keys = prior.prior.residuals.map(([key]) => key);
      expect(keys).toEqual([...keys].sort());
    }
    // And the counts survive beside them, so the artifact is readable both ways.
    expect(json.priors[0]).toHaveProperty('fitted');
  });

  it('keeps the residuals that the threshold refused, because a refusal is a measurement', () => {
    const { rows, accepted } = corpusOf(12, () => CO_MOVING);
    const reading = readGate(rows, accepted, 'rho');
    const json = JSON.parse(JSON.stringify(gateReadingToJson(reading))) as {
      priors: { prior: { residuals: [string, number][] }; fitted: number; admitted: number }[];
    };
    for (const prior of json.priors) {
      // Two entries per fitted edge: the map is keyed by the direction of the call edge, because that is the only
      // key the sweep asks about, and ρ itself is symmetric. The count is therefore 2× the edges, which is what
      // makes `fitted` and the map's length reconcilable rather than two numbers about the same thing.
      expect(prior.prior.residuals).toHaveLength(2 * prior.fitted);
    }
  });
});

// ── compareEdgeKeys ───────────────────────────────────────

describe('compareEdgeKeys', () => {
  it('orders by code unit and answers zero for equal keys', () => {
    // The equality arm is unreachable inside a `Map`, which is why the comparator is a named function: the arm
    // that cannot be reached through the caller is the arm that has to be tested directly.
    expect(compareEdgeKeys('a\u0000b', 'a\u0000b')).toBe(0);
    expect(compareEdgeKeys('a\u0000b', 'a\u0000c')).toBe(-1);
    expect(compareEdgeKeys('a\u0000c', 'a\u0000b')).toBe(1);
    // And it must not answer from ICU: `localeCompare` would put these in a locale's order, not a code unit's.
    expect(compareEdgeKeys('Z', 'a')).toBe(-1);
  });
});
