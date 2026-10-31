/**
 * Unit tests for the fault census: which fault type the misses belong to, and which of the two failures each one is.
 *
 * The nine-cell accuracy the campaign has been steered by is one number over five fault types, and the five are not
 * comparable: a fault whose signature is a permanent resource shift and a fault whose signature is a lost packet
 * present the ranking with different evidence. The census splits the misses on the axis that names an owner — a miss
 * whose truth deviated LESS than the candidate that beat it cannot be won by re-ordering the signals the engine
 * already has, while a miss whose truth deviated at least as much was decided by a trade between them.
 *
 * The claims pinned here are the ones a plausible implementation gets wrong:
 *
 * 1. `outweighed` is a comparison of the base term and NOT of the total: the total includes the priors, which is the
 *    quantity under suspicion, so a comparison of totals would file every miss under "decided by a trade" and the
 *    split would be constant by construction.
 * 2. A truth with no evidence is `blank` and not `outweighed`: no terms is an absent measurement, and calling it a
 *    zero would file "the ranking did not run" under "the truth was quieter".
 * 3. `blame` names a term only when it FAVOURED the winner: a term the truth also paid, or paid more, is not what
 *    decided the case, and crediting it would make every miss blame a random member of the formula.
 * 4. Equality is `outvoted` and not `outweighed`: the truth deviated at least as much, so the base term was not what
 *    lost the case even though it did not win it.
 *
 * @module benchmarks/__tests__/fault-census
 */

import { describe, expect, it } from 'vitest';

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  accumulateFaultCensus,
  BASE_TERM_NAME,
  createFaultCensus,
  FAULT_BLAME_TOP,
  formatFaultLine,
  type FaultCensus,
} from '../src/fault-census.js';

/** One entry of a breakdown, as the ranking emits it. */
function term(name: string, contribution: number): ScoreTerm {
  return { name, contribution, weight: 1, slope: contribution };
}

/** A miss, or a hit, of one fault type, carrying whatever breakdown the claim needs. */
function prediction(spec: {
  correct: boolean;
  faultType?: string | undefined;
  truthTerms?: readonly ScoreTerm[] | undefined;
  top1Terms?: readonly ScoreTerm[] | undefined;
}): CasePrediction {
  return {
    caseId: 'case',
    truth: 'svc-truth',
    top1: spec.correct ? 'svc-truth' : 'svc-winner',
    correct: spec.correct,
    ...(spec.faultType === undefined ? {} : { faultType: spec.faultType }),
    ...(spec.truthTerms === undefined ? {} : { truthEvidence: { terms: spec.truthTerms } }),
    ...(spec.top1Terms === undefined ? {} : { top1Terms: spec.top1Terms }),
  } as unknown as CasePrediction;
}

/** Fold a list of cases. */
function censusOf(predictions: readonly CasePrediction[]): FaultCensus {
  const census = createFaultCensus();
  for (const p of predictions) accumulateFaultCensus(census, p);
  return census;
}

describe('the fault census — the axis that names an owner', () => {
  it('counts hits and misses per fault type, and never classifies a hit', () => {
    const census = censusOf([
      prediction({ correct: true, faultType: 'cpu' }),
      prediction({
        correct: false,
        faultType: 'cpu',
        truthTerms: [term(BASE_TERM_NAME, 0.2)],
        top1Terms: [term(BASE_TERM_NAME, 0.9)],
      }),
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [term(BASE_TERM_NAME, 1.4)],
        top1Terms: [term(BASE_TERM_NAME, 0.3)],
      }),
    ]);

    expect(census.byFault.get('cpu')).toMatchObject({
      n: 2,
      correct: 1,
      blank: 0,
      outweighed: 1,
      outvoted: 0,
    });
    expect(census.byFault.get('loss')).toMatchObject({
      n: 1,
      correct: 0,
      blank: 0,
      outweighed: 0,
      outvoted: 1,
    });
  });

  it('files a truth with no evidence as blank rather than as a quiet truth', () => {
    // The ranking never surfaced this candidate, so there is no measurement to compare. A zero here would be a
    // claim about the corpus; the absence is a claim about the run.
    const census = censusOf([
      prediction({ correct: false, faultType: 'loss', top1Terms: [term(BASE_TERM_NAME, 0.9)] }),
    ]);

    expect(census.byFault.get('loss')).toMatchObject({ blank: 1, outweighed: 0, outvoted: 0 });
    expect(census.byFault.get('loss')?.blame.size).toBe(0);
  });

  it('files an equally loud truth that carried an empty breakdown as blank', () => {
    const census = censusOf([
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [],
        top1Terms: [term(BASE_TERM_NAME, 0.9)],
      }),
    ]);

    expect(census.byFault.get('loss')?.blank).toBe(1);
  });

  it('reads outweighed off the BASE term even when the truth total is higher', () => {
    // The truth's total is 1.4 against the winner's 0.9 — it was louder overall — and it lost because its own
    // evidence read 0.2 against 0.9. A comparison of totals would file this as a trade, which is exactly the
    // quantity under suspicion; the base term is the one contribution that is not a prior.
    const census = censusOf([
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [term(BASE_TERM_NAME, 0.2), term('dualFamily', 1.2)],
        top1Terms: [term(BASE_TERM_NAME, 0.9)],
      }),
    ]);

    expect(census.byFault.get('loss')).toMatchObject({ outweighed: 1, outvoted: 0 });
    expect(census.byFault.get('loss')?.blame.size).toBe(0);
  });

  it('files a louder truth that lost to a prior as outvoted, and blames that prior', () => {
    const census = censusOf([
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [term(BASE_TERM_NAME, 0.9), term('dualFamily', 0.0)],
        top1Terms: [term(BASE_TERM_NAME, 0.2), term('dualFamily', 1.0)],
      }),
    ]);

    const tally = census.byFault.get('loss')!;
    expect(tally).toMatchObject({ outweighed: 0, outvoted: 1 });
    expect(tally.blame.get('dualFamily')).toBe(1);
    expect(tally.blame.has(BASE_TERM_NAME)).toBe(false);
  });

  it('blames every term that favoured the winner and no term the truth paid more for', () => {
    const census = censusOf([
      prediction({
        correct: false,
        faultType: 'delay',
        truthTerms: [
          term(BASE_TERM_NAME, 1.0),
          term('lat', 0.4),
          term('topo', 0.9),
          term('stability', 1.0),
        ],
        // `topo` favours the winner by 0.9, `lat` by 0.1, the base term is level, and `stability` favours the truth.
        top1Terms: [
          term(BASE_TERM_NAME, 1.0),
          term('lat', 0.5),
          term('topo', 1.8),
          term('stability', 0.1),
        ],
      }),
    ]);

    const tally = census.byFault.get('delay')!;
    expect(tally.outvoted).toBe(1);
    expect(tally.blame.get('topo')).toBe(1);
    expect(tally.blame.get('lat')).toBe(1);
    expect(tally.blame.has('stability')).toBe(false);
    expect(tally.blame.has(BASE_TERM_NAME)).toBe(false);
  });

  it('records no blame when every non-base difference is zero or favours the truth', () => {
    // A case lost on a score tie is broken by service id. That is the ranking's answer and not a term's, so the
    // census reports the split without naming an owner.
    const census = censusOf([
      prediction({
        correct: false,
        faultType: 'f4',
        truthTerms: [term(BASE_TERM_NAME, 0.5), term('prism', 1.0)],
        top1Terms: [term(BASE_TERM_NAME, 0.5), term('prism', 1.0)],
      }),
    ]);

    const tally = census.byFault.get('f4')!;
    expect(tally.outvoted).toBe(1);
    expect(tally.blame.size).toBe(0);
  });

  it('treats an equal base term as outvoted rather than outweighed', () => {
    const census = censusOf([
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [term(BASE_TERM_NAME, 0.7)],
        top1Terms: [term(BASE_TERM_NAME, 0.7), term('stability', 0.01)],
      }),
    ]);

    expect(census.byFault.get('loss')).toMatchObject({ outweighed: 0, outvoted: 1 });
  });

  it('reports a case with no fault label under its own name rather than dropping it', () => {
    const census = censusOf([
      prediction({
        correct: false,
        truthTerms: [term(BASE_TERM_NAME, 0.1)],
        top1Terms: [term(BASE_TERM_NAME, 0.9)],
      }),
    ]);

    expect(census.byFault.get('unknown')).toMatchObject({ n: 1, outweighed: 1 });
  });
});

describe('the fault line — one entry per type, the misses first', () => {
  const build = (): FaultCensus =>
    censusOf([
      prediction({ correct: true, faultType: 'cpu' }),
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [term(BASE_TERM_NAME, 0.2)],
        top1Terms: [term(BASE_TERM_NAME, 0.9)],
      }),
      prediction({ correct: false, faultType: 'loss', top1Terms: [term(BASE_TERM_NAME, 0.5)] }),
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [term(BASE_TERM_NAME, 1.0), term('dualFamily', 0.0)],
        top1Terms: [term(BASE_TERM_NAME, 1.0), term('dualFamily', 0.25)],
      }),
    ]);

  it('prints hits over cases, the miss count and the three-way split', () => {
    const line = formatFaultLine(build())!;

    expect(line.startsWith('[faults] ')).toBe(true);
    expect(line).toContain('loss 0/3: miss 3 = blank 1 + outweighed 1 + outvoted 1 [dualFamily 1]');
    expect(line).toContain('cpu 1/1: miss 0');
  });

  it('orders the types by misses, so the head is the pocket', () => {
    const line = formatFaultLine(build())!;

    expect(line.indexOf('loss ')).toBeLessThan(line.indexOf('cpu '));
  });

  it('bounds the blamed terms and counts what it cut', () => {
    const many = censusOf(
      Array.from({ length: FAULT_BLAME_TOP + 2 }, (_, i) =>
        prediction({
          correct: false,
          faultType: 'loss',
          truthTerms: [term(BASE_TERM_NAME, 1.0), term(`t${i}`, 0.0)],
          top1Terms: [term(BASE_TERM_NAME, 1.0), term(`t${i}`, 1.0)],
        }),
      ),
    );
    const line = formatFaultLine(many)!;

    // Every blamed term was named once, and the two past the bound are counted rather than dropped.
    expect(line).toContain('[t0 1 t1 1 t2 1 +2]');
  });

  it('returns nothing for a census with no case in it', () => {
    expect(formatFaultLine(createFaultCensus())).toBeUndefined();
  });

  it('prints a type whose every case passed with no split at all', () => {
    const line = formatFaultLine(censusOf([prediction({ correct: true, faultType: 'mem' })]))!;

    expect(line).toContain('mem 1/1: miss 0');
    expect(line).not.toContain('blank');
  });
});

describe('the census on cases the formula left half-filled', () => {
  it('reads a winner with no breakdown as paying nothing, and fabricates no owner for the loss', () => {
    // A record written before the winner's breakdown existed carries the truth's evidence and nothing beside it.
    // The base comparison is still defined — the absent side reads as zero — but no term can be said to have
    // favoured a side whose contributions were never recorded, so the split names the miss and not a culprit.
    const census = censusOf([
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [term(BASE_TERM_NAME, 0.4), term('prism', 0.2)],
      }),
    ]);

    const tally = census.byFault.get('loss')!;
    expect(tally).toMatchObject({ blank: 0, outweighed: 0, outvoted: 1 });
    expect(tally.blame.size).toBe(0);
  });

  it('counts a term the winner does not carry at all as paid in full by the winner', () => {
    const census = censusOf([
      prediction({
        correct: false,
        faultType: 'delay',
        truthTerms: [term(BASE_TERM_NAME, 1.0), term('prism', 0.0)],
        top1Terms: [term(BASE_TERM_NAME, 1.0), term('stability', 0.3)],
      }),
    ]);

    const tally = census.byFault.get('delay')!;
    // `stability` exists only on the winner's side; `prism` only on the truth's, where it paid nothing.
    expect(tally.blame.get('stability')).toBe(1);
    expect(tally.blame.has('prism')).toBe(false);
  });
});

describe('the fault line on ties and on a split with no owner', () => {
  it('orders two types with the same shape by label, in both directions', () => {
    const tied = (label: string): CasePrediction =>
      prediction({
        correct: false,
        faultType: label,
        truthTerms: [term(BASE_TERM_NAME, 0.1)],
        top1Terms: [term(BASE_TERM_NAME, 0.9)],
      });
    const line = formatFaultLine(censusOf([tied('zeta'), tied('alpha'), tied('mike')]))!;

    // Equal on misses and on cases, so the label decides — and a two-element comparison reaches only one arm of
    // that comparison, which is why three labels are needed to pin an order rather than a coincidence.
    expect(line.indexOf('alpha ')).toBeLessThan(line.indexOf('mike '));
    expect(line.indexOf('mike ')).toBeLessThan(line.indexOf('zeta '));
  });

  it('prints a split with no blamed term as a split, without inventing an owner', () => {
    const line = formatFaultLine(
      censusOf([
        prediction({
          correct: false,
          faultType: 'f4',
          truthTerms: [term(BASE_TERM_NAME, 0.5), term('prism', 1.0)],
          top1Terms: [term(BASE_TERM_NAME, 0.5), term('prism', 1.0)],
        }),
      ]),
    )!;

    expect(line).toContain('f4 0/1: miss 1 = blank 0 + outweighed 0 + outvoted 1');
    expect(line.endsWith('outvoted 1')).toBe(true);
  });

  it('orders equally blamed terms by name, so the entry does not depend on insertion', () => {
    const blamed = (name: string): CasePrediction =>
      prediction({
        correct: false,
        faultType: 'loss',
        truthTerms: [term(BASE_TERM_NAME, 1.0), term(name, 0.0)],
        top1Terms: [term(BASE_TERM_NAME, 1.0), term(name, 1.0)],
      });
    const line = formatFaultLine(censusOf([blamed('zeta'), blamed('mike'), blamed('alpha')]))!;

    expect(line).toContain('[alpha 1 mike 1 zeta 1]');
  });
});
