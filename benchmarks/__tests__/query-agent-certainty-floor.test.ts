/**
 * The certainty floor: the first saving taken BEFORE the call rather than after the run.
 *
 * Run `45531140696` cost 20.81 CNY. Its own columns say 10 221 261 prompt tokens against 46 085 completion — **98.2 %
 * of the bill is the question** — and 786 of the 1 422 cases were settled by something other than the model after
 * paying for six turns each: **11.42 CNY, 55 % of the run, for answers that were then discarded**.
 *
 * Whether a model will fail cannot be known in advance. Whether the ENGINE was already sure can, and it is the only
 * signal available at the door. Measured on that artifact, a floor of 0.90 skips 566 cases, saves 8.32 CNY (40 %) and
 * changes the corpus accuracy by zero.
 *
 * What these cases pin is the contract at the port:
 *
 *   * a skipped case spends **nothing** — no call, no round, no token;
 *   * it answers with the name a refusal would have shipped, so it is the same arm at a lower price;
 *   * an unusable margin is not a high margin, and a case with no engine opinion is never skipped;
 *   * and a floor that would answer `null` is not applied, because a silent no-answer scores zero and would make the
 *     floor look cheap in tokens and expensive in accuracy.
 */

import { describe, expect, it } from 'vitest';

import {
  buildTelemetry,
  runQueryAgent,
  type EngineOpinion,
  type QuerySeed,
} from '../src/query-agent.js';

import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';

const INJECT = 1_700_000_000_000;

/** Two services. The engine's order is passed in; the case itself carries no ranking, which is the point. */
function telemetry() {
  const series = {
    label: 'cpu',
    unit: 'percent',
    timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
    values: Float64Array.from([10, 10, 90, 90]),
  };
  const bench = {
    id: 'case-floor',
    datasetName: 'fse26',
    injectTime: INJECT,
    metrics: new Map([
      ['checkout', [series]],
      ['db', [series]],
    ]),
    callGraph: {
      systemLoad: 0,
      nodes: new Map([
        ['checkout', { id: 'checkout', name: 'checkout', namespace: 'shop', labels: {} }],
        ['db', { id: 'db', name: 'db', namespace: 'shop', labels: {} }],
      ]),
      edges: [],
    },
    logs: [],
    traces: [],
    truth: ['checkout'],
  } as unknown as BenchmarkCase;
  return buildTelemetry(bench);
}

/** A client that records every turn and answers immediately, so a skipped case costs exactly zero calls. */
function client() {
  const turns: { system: string; user: string }[] = [];
  return {
    turns,
    model: 'fake',
    complete: async (turn: { system: string; user: string }) => {
      turns.push(turn);
      return { text: 'ANSWER db', promptTokens: 100, completionTokens: 5 };
    },
  };
}

const order: QuerySeed = { source: 'engine', candidates: ['checkout', 'db'] };

function opinion(margin: number | null, top1: string | null = 'checkout'): EngineOpinion {
  return { top1, margin };
}

describe('the certainty floor', () => {
  it('does not exist when it is zero: the arm spends what every arm before it spent', async () => {
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      order,
      opinion(9),
      null,
      null,
      false,
      0,
    );
    expect(fake.turns.length).toBeGreaterThan(0);
    expect(outcome.rounds).toBeGreaterThan(0);
    expect(outcome.promptTokens).toBeGreaterThan(0);
  });

  it('spends nothing at all on a case the engine already decided, and answers the fallback name', async () => {
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      order,
      opinion(2),
      null,
      null,
      false,
      0.9,
    );
    // The three zeros: no call, no round, no token. Anything else would be a saving that is not a saving.
    expect(fake.turns).toHaveLength(0);
    expect(outcome.rounds).toBe(0);
    expect(outcome.promptTokens).toBe(0);
    expect(outcome.completionTokens).toBe(0);
    // And it answers the same name a refusal would have shipped, attributed to the prior because that is what it is.
    expect(outcome.answer).toBe('checkout');
    expect(outcome.answeredBy).toBe('prior');
    expect(outcome.stop).toBe('answered');
  });

  it('leaves a case at the floor itself to the engine, because the boundary is inclusive', async () => {
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      order,
      opinion(0.9),
      null,
      null,
      false,
      0.9,
    );
    expect(outcome.rounds).toBe(0);
  });

  it('investigates a case whose margin is below the floor', async () => {
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      order,
      opinion(0.1),
      null,
      null,
      false,
      0.9,
    );
    expect(fake.turns.length).toBeGreaterThan(0);
    expect(outcome.rounds).toBeGreaterThan(0);
  });

  it('investigates when the margin was never measured, because null is not a wide margin', async () => {
    // An artifact written before the column existed must leave the pipeline alone: skipping on an absent number is
    // a decision nobody can re-read.
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      order,
      opinion(null),
      null,
      null,
      false,
      0.9,
    );
    expect(fake.turns.length).toBeGreaterThan(0);
    // And it spent on it: an unmeasured margin buys an investigation, not a skip with a saved invoice.
    expect(outcome.rounds).toBeGreaterThan(0);
  });

  it('investigates when there is no engine opinion at all, rather than assuming one', async () => {
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      order,
      null,
      null,
      null,
      false,
      0.9,
    );
    expect(fake.turns.length).toBeGreaterThan(0);
    expect(outcome.rounds).toBeGreaterThan(0);
  });

  it('answers the engine winner when the arm has no fallback, which is the free arm at a floor', async () => {
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      null,
      opinion(3, 'db'),
      null,
      null,
      false,
      0.9,
    );
    expect(fake.turns).toHaveLength(0);
    expect(outcome.answer).toBe('db');
  });

  it('investigates rather than settling on null when neither a fallback nor an engine name exists', async () => {
    // A floor that answers nothing scores zero on every case it touches. That is cheap in tokens and expensive in
    // accuracy, and the artifact would not be able to say which had happened.
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      null,
      opinion(3, null),
      null,
      null,
      false,
      0.9,
    );
    expect(fake.turns.length).toBeGreaterThan(0);
    expect(outcome.answer).not.toBeNull();
  });

  it('keeps the transcript empty, so the artifact cannot claim an investigation it did not run', async () => {
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      null,
      'none',
      'none',
      order,
      opinion(2),
      null,
      null,
      false,
      0.9,
    );
    expect(outcome.trace).toBe('');
    expect(outcome.investigated).toEqual([]);
    expect(outcome.toolCalls).toBe(0);
  });
});
