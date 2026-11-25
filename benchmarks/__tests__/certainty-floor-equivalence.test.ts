/**
 * The floor must ship what the guard would have shipped, because the two rules read the same number.
 *
 * The certainty floor was added in iteration 348 as the first saving taken BEFORE the call, and it settled a skipped
 * case on `priorTop ?? engine.top1`. The certainty guard — shipped since iteration 336, and the rule the floor is a
 * pre-call form of — settles on `engine.top1`. Two rules that read the same column and answer differently are two
 * rules, and `cost-model.ts` prices a skipped case with `engineRight` (`engineWinner` against `truth`), which is the
 * GUARD's answer. So the artifact would have priced one rule while the arm shipped another — the defect iteration
 * 322 paid a dispatch to learn, stated in `applyResolver`'s own comment.
 *
 * What these cases pin:
 *
 *   * a floor at the guard's bar ships the SAME answer the guard ships, on every case, for any margin above it;
 *   * so a case the floor silences is a case whose model answer the run would have thrown away anyway — a price cut,
 *     not a configuration change;
 *   * the boundary belongs to the guard, not to the floor: `engineCertainty` fires on `margin > bar`, so a case
 *     sitting exactly on the floor is investigated rather than skipped;
 *   * the stratum is `certainty` and not `prior`, because it was the engine's separation that settled it;
 *   * and it fires with the resolver OFF as well, because it is a cost knob rather than a resolver — the runner's
 *     default `--resolve` is `none`, so coupling the two would make the floor inert in the configuration that
 *     dispatches it.
 */

import { describe, expect, it } from 'vitest';

import {
  ENGINE_CERTAINTY_MARGIN,
  buildTelemetry,
  engineCertainty,
  runQueryAgent,
  type EngineOpinion,
  type QuerySeed,
} from '../src/query-agent.js';

import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';

const INJECT = 1_700_000_000_000;

/**
 * The shipped bar, narrowed once.
 *
 * The exported constant is `number | null` because the guard accepts `null` to disable itself. A test that fell back
 * to `0` would compare the floor against a bar nobody ships and pass, so this refuses instead: if the guard is ever
 * disabled, the equivalence below is about nothing and must not report success.
 */
if (ENGINE_CERTAINTY_MARGIN === null)
  throw new Error('the certainty guard is disabled in this build');
const BAR: number = ENGINE_CERTAINTY_MARGIN;

/** Two services, one metric each. The engine's order is passed in; the case itself carries no ranking. */
function telemetry() {
  const series = {
    label: 'cpu',
    unit: 'percent',
    timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
    values: Float64Array.from([10, 10, 90, 90]),
  };
  const bench = {
    id: 'case-equivalence',
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

/** A client that answers on the first turn with a name the engine did not choose, so a rename is observable. */
function client(text = 'ANSWER db') {
  const turns: { system: string; user: string }[] = [];
  return {
    turns,
    model: 'fake',
    complete: async (turn: { system: string; user: string }) => {
      turns.push(turn);
      return { text, promptTokens: 100, completionTokens: 5 };
    },
  };
}

/** The order the arm SHOWS. It is also the order a refusal settles on, so `priorTop` is `checkout`. */
const order: QuerySeed = { source: 'engine', candidates: ['checkout', 'db'] };

function opinion(margin: number | null, top1: string | null = 'checkout'): EngineOpinion {
  return { top1, margin };
}

/** The whole arm at one floor, so the equivalence is read off two runs of the shipped function rather than a copy. */
async function arm(
  margin: number | null,
  floor: number,
  resolution: 'none' | 'edge-novel',
  top1: string | null = 'checkout',
) {
  const fake = client();
  const outcome = await runQueryAgent(
    fake,
    telemetry(),
    undefined,
    order,
    'none',
    resolution,
    order,
    opinion(margin, top1),
    null,
    null,
    false,
    floor,
  );
  return { fake, outcome };
}

describe('the floor and the guard are one rule, read at two moments', () => {
  const margins = [BAR + 0.004, 2, 3.5, 9];

  for (const margin of margins) {
    it(`ships the guard's answer at margin ${margin}: the model's name is discarded either way`, async () => {
      // The arm the floor must be equal to: no floor, resolver on, so the guard re-reads the settled answer.
      const unfloored = await arm(margin, 0, 'edge-novel');
      expect(unfloored.fake.turns.length).toBeGreaterThan(0);
      // The guard's own reading of the same case, taken through the shipped function rather than restated.
      expect(unfloored.outcome.answer).toBe(engineCertainty('db', opinion(margin), BAR));
      // And the floor at the same bar ships it without paying for the turn.
      const floored = await arm(margin, BAR, 'edge-novel');
      expect(floored.fake.turns).toHaveLength(0);
      expect(floored.outcome.answer).toBe(unfloored.outcome.answer);
    });
  }

  it('names the engine and not the prior, because the margin decided it', async () => {
    const floored = await arm(9, BAR, 'edge-novel');
    expect(floored.outcome.answeredBy).toBe('certainty');
  });

  it('ships the engine name when it differs from the prior, which is the branch that was miscoded', async () => {
    // `priorTop` is the fallback's first name (`checkout`); the engine's top-1 here is `db`. A floor settling on the
    // prior answers `checkout`, the guard answers `db` — and only the guard's answer is what `skipAt` prices.
    const floored = await arm(9, BAR, 'edge-novel', 'db');
    expect(floored.outcome.answer).toBe('db');
    expect(floored.outcome.answeredBy).toBe('certainty');
  });

  it('leaves a case sitting exactly on the floor to the model, because the guard fires strictly above its bar', async () => {
    // The boundary is the guard's, not the floor's. An inclusive floor against a strict guard would make the two
    // rules disagree on the single margin where they are easiest to compare.
    const onTheBoundary = await arm(BAR, BAR, 'edge-novel');
    expect(onTheBoundary.fake.turns.length).toBeGreaterThan(0);
    // The guard is inert there too: asserted against the shipped function, not restated.
    expect(engineCertainty('db', opinion(BAR), BAR)).toBe(null);
  });
});

describe('what a floored case costs', () => {
  it('reports zero rounds, zero calls and zero tokens, which is the only form a saving can take', async () => {
    const floored = await arm(9, BAR, 'edge-novel');
    expect(floored.outcome.rounds).toBe(0);
    expect(floored.outcome.toolCalls).toBe(0);
    expect(floored.outcome.promptTokens).toBe(0);
    expect(floored.outcome.completionTokens).toBe(0);
    expect(floored.outcome.trace).toBe('');
    expect(floored.outcome.stop).toBe('answered');
  });

  it('reports no served model, because nothing was served', async () => {
    // A row that carried the requested name would claim a model answered a case that never called one, and the
    // `servedModel` column exists precisely because the requested name is not the served one.
    const floored = await arm(9, BAR, 'edge-novel');
    expect(floored.outcome.servedModel).toBe('');
    expect(floored.outcome.cacheHitTokens).toBe(0);
  });
});

describe('the floor is a price knob, not a resolver', () => {
  it('still fires with the resolver off, because the runner default for `--resolve` is `none`', async () => {
    // Coupling the two would make the floor inert in the configuration that actually dispatches it: `--resolve`
    // defaults to `none`, so a floor that required the resolver would save nothing in every run nobody configured.
    const floored = await arm(9, BAR, 'none');
    expect(floored.fake.turns).toHaveLength(0);
    expect(floored.outcome.rounds).toBe(0);
    expect(floored.outcome.answer).toBe('checkout');
    expect(floored.outcome.answeredBy).toBe('certainty');
  });

  it('does not fire when the arm was handed no engine at all', async () => {
    const fake = client();
    const outcome = await runQueryAgent(
      fake,
      telemetry(),
      undefined,
      order,
      'none',
      'none',
      order,
      null,
      null,
      null,
      false,
      BAR,
    );
    expect(fake.turns.length).toBeGreaterThan(0);
    expect(outcome.rounds).toBeGreaterThan(0);
  });
});
