/**
 * The census that prices the interface rule without a model call.
 *
 * What is asserted here is the bookkeeping, because the rule itself is asserted in `query-agent.test.ts`: a
 * reading that counted a rename as a repair without checking whether the renamed answer is CORRECT would report
 * every firing as a win, and a reading that counted a break only when the answer changed would miss the case the
 * rule exists to prevent. Both are one-line mistakes with the same symptom — a table that looks better than the
 * run — so both are pinned.
 */

import { describe, expect, it } from 'vitest';

import { priceModes, type PriceableRow, type Witness } from '../src/edge-novel-census.js';

const row = (over: Partial<PriceableRow> = {}): PriceableRow => ({
  datapack: 'case-1',
  truth: ['front'],
  answer: 'leaf',
  entry: 'front',
  entryChildErrors: 0,
  belowFails: false,
  answerSurprise: 0,
  ...over,
});

const witness = (over: Partial<Witness> = {}): Witness => ({
  datapack: 'case-1',
  novelCaller: 'front',
  novelRise: 4_002,
  ...over,
});

describe('pricing the three modes on one artifact', () => {
  it('reads one row per mode, in the order asked for', () => {
    const readings = priceModes([row()], new Map([['case-1', witness()]]));
    expect(readings.map((one) => one.mode)).toEqual(['none', 'entry-prior', 'edge-novel']);
  });

  it('counts a rename to the correct service as a repair', () => {
    const readings = priceModes([row()], new Map([['case-1', witness()]]));
    const edged = readings.find((one) => one.mode === 'edge-novel')!;
    expect(edged).toEqual({
      mode: 'edge-novel',
      fires: 1,
      repairs: 1,
      breaks: 0,
      net: 1,
      correct: 1,
    });
  });

  it('counts a rename AWAY from a correct answer as a break, which is the case the rule must not have', () => {
    // The arm is already right; the witness names another service. A census that only counted net answers would
    // report this row as a wash.
    const readings = priceModes(
      [row({ truth: ['front'], answer: 'front' })],
      new Map([['case-1', witness({ novelCaller: 'db' })]]),
    );
    const edged = readings.find((one) => one.mode === 'edge-novel')!;
    expect(edged.breaks).toBe(1);
    expect(edged.repairs).toBe(0);
    expect(edged.net).toBe(-1);
    expect(edged.correct).toBe(0);
  });

  it('does not fire on a case that carries no witness, and leaves its answer exactly as it was', () => {
    // The front door is refused here as well (`entryChildErrors` above zero), so a firing could only have come
    // from the witness — which is exactly the claim under test.
    const readings = priceModes(
      [row({ answer: 'leaf', truth: ['leaf'], entryChildErrors: 40 })],
      new Map([['case-1', witness({ novelCaller: null, novelRise: null })]]),
    );
    const edged = readings.find((one) => one.mode === 'edge-novel')!;
    expect(edged.fires).toBe(0);
    expect(edged.correct).toBe(1);
  });

  it('reads a case the artifact does not carry as a refusal rather than as a witness', () => {
    // A witness file from another corpus, or a truncated one: the row still has to be priced.
    const readings = priceModes([row({ entryChildErrors: 40 })], new Map());
    expect(readings.every((one) => one.fires === 0)).toBe(true);
  });

  it('leaves `entry-prior` idempotent, so a run that already shipped it is not counted twice', () => {
    // The artifact's answer is the entry BECAUSE the dispatched resolver put it there. Re-applying it must be a
    // no-op, or the comparison between modes would credit the same repair to two of them.
    const readings = priceModes(
      [row({ answer: 'front', truth: ['front'] })],
      new Map([['case-1', witness({ novelCaller: null, novelRise: null })]]),
    );
    const prior = readings.find((one) => one.mode === 'entry-prior')!;
    expect(prior.fires).toBe(0);
    expect(prior.correct).toBe(1);
  });
});
