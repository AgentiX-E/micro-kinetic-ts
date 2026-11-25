import { describe, expect, it } from 'vitest';

import {
  capReadingOf,
  capVerdictOf,
  perCallCurveOf,
  trajectoryOf,
  type CapRow,
} from '../src/transcript-reading.js';

/**
 * A row as an artifact writes it, in the fields this reading touches.
 *
 * The default is one case of an investigation that took six calls over five tool directives and answered the engine's
 * own name — the corpus's dominant shape (1 056 of 1 062 cases in run `45595943761`), so a test that changes one field
 * changes exactly one thing.
 */
function row(over: Partial<CapRow> = {}): CapRow {
  return {
    datapack: 'x',
    answer: 'svc',
    calls: ['fleet', 'metric svc', 'trace svc', 'logs svc', 'logs svc'],
    correct: true,
    rounds: 6,
    promptTokens: 7_200,
    completionTokens: 32,
    cacheHitTokens: 5_850,
    turnTokens: [1_200, 1_200, 1_200, 1_200, 1_200, 1_200],
    turnLatencyMs: [900, 900, 900, 900, 900, 900],
    ...over,
  };
}

describe('the trajectory, which is the thing a cap can break', () => {
  it('is the directives in order plus the answer, and nothing else', () => {
    // `CoACT` (arXiv:2607.02911) replaces "does the compressed text read like the original" with "does the next action
    // stay the same", on the argument that the agent's loop is deterministic given its actions: if the action is
    // preserved, the environment it sees next is preserved, and so is everything after. This harness records exactly
    // that object already, which is why the strongest acceptance test for a transcript cap costs no model call.
    expect(trajectoryOf(row())).toEqual({
      calls: ['fleet', 'metric svc', 'trace svc', 'logs svc', 'logs svc'],
      answer: 'svc',
    });
  });

  it('counts a reordered investigation as changed, because a different order is a different investigation', () => {
    const a = row({ calls: ['fleet', 'logs svc'] });
    const b = row({ calls: ['logs svc', 'fleet'] });
    expect(capReadingOf([a], [b]).trajectoryPreserved).toBe(0);
    expect(capReadingOf([a], [b]).trajectoryChanged).toBe(1);
  });

  it('counts an answer that changed with the calls unchanged as a changed trajectory', () => {
    // The case the harness exists for: an arm that looks at the same evidence and names a different service. A cap
    // that did that would be spending accuracy to buy tokens, and a reading that only compared `calls` would miss it.
    const reading = capReadingOf([row({ answer: 'svc' })], [row({ answer: 'other' })]);
    expect(reading.trajectoryPreserved).toBe(0);
    expect(reading.answerChanged).toBe(1);
    expect(reading.trajectoryChanged).toBe(0);
  });
});

describe('the paired reading', () => {
  it('pairs on the cases both artifacts carry, in the same order-independent way', () => {
    const first = [row({ datapack: 'a' }), row({ datapack: 'b' })];
    const second = [row({ datapack: 'b' }), row({ datapack: 'c' })];
    const reading = capReadingOf(first, second);
    expect(reading.shared).toBe(1);
    expect(reading.onlyAnchor).toBe(1);
    expect(reading.onlyCapped).toBe(1);
  });

  it('counts gains and losses on ACCURACY, so a preserved trajectory that is still wrong is not a repair', () => {
    const reading = capReadingOf(
      [row({ datapack: 'a', correct: false }), row({ datapack: 'b', correct: true })],
      [row({ datapack: 'a', correct: true }), row({ datapack: 'b', correct: false })],
    );
    expect(reading.gains).toBe(1);
    expect(reading.losses).toBe(1);
  });

  it('sums the tokens, the uncached share and the model time, and reports time as null when unrecorded', () => {
    // The wall clock matters because `arXiv:2609.32961` measured compressed policies running 1.2-1.8x LONGER while
    // spending a third of the tokens: a token saving that costs time is not a saving, and an artifact written before
    // the column existed cannot be read as a fast one.
    const anchor = [row({ promptTokens: 7_200, cacheHitTokens: 5_850 })];
    const capped = [row({ promptTokens: 6_000, cacheHitTokens: 5_850 })];
    const reading = capReadingOf(anchor, capped);
    expect(reading.tokens).toEqual({ anchor: 7_200, capped: 6_000 });
    expect(reading.completion).toEqual({ anchor: 32, capped: 32 });
    expect(reading.uncached).toEqual({ anchor: 1_350, capped: 150 });
    expect(reading.latencyMs).toEqual({ anchor: 5_400, capped: 5_400 });

    const noClock = capReadingOf(
      [row({ turnLatencyMs: undefined })],
      [row({ turnLatencyMs: undefined })],
    );
    expect(noClock.latencyMs).toBeNull();
  });
});

describe('the branches a clean pair of artifacts never reaches', () => {
  it('prices a row with no cache column at the miss rate, rather than crediting it with hits nobody recorded', () => {
    // Absence is not zero hits. An artifact written before the column existed cannot say what the cache served, and a
    // reading that treated `undefined` as `0` would be right by accident; a reading that treated it as "all hits" would
    // understate the cap's reach. Both sides therefore count the whole prompt as uncached — the upper bound — and this
    // asserts it on a row that carries no column at all.
    const bare = row({ cacheHitTokens: undefined, promptTokens: 1_000 });
    const reading = capReadingOf([bare], [row({ cacheHitTokens: undefined, promptTokens: 1_000 })]);
    expect(reading.uncached).toEqual({ anchor: 1_000, capped: 1_000 });
  });

  it('counts a case only the capped artifact carries, instead of dropping it silently', () => {
    const reading = capReadingOf(
      [row({ datapack: 'a' })],
      [row({ datapack: 'a' }), row({ datapack: 'b' })],
    );
    expect(reading.shared).toBe(1);
    expect(reading.onlyCapped).toBe(1);
    expect(reading.onlyAnchor).toBe(0);
  });

  it('says the time is unrecorded when only ONE of the two artifacts carries a clock', () => {
    // A latencies comparison with one side missing is not a comparison: printing the side that exists would read as
    // "the cap took 0 ms", which is the failure the cache column already taught this programme twice.
    const reading = capReadingOf(
      [row({ turnLatencyMs: [10, 20] })],
      [row({ turnLatencyMs: undefined })],
    );
    expect(reading.latencyMs).toBeNull();
  });

  it('treats a call sequence of the same length with a different order as changed, and one of another length too', () => {
    const anchor = [row({ calls: ['fleet', 'logs svc'] })];
    expect(capReadingOf(anchor, [row({ calls: ['fleet', 'logs other'] })]).trajectoryChanged).toBe(
      1,
    );
    expect(
      capReadingOf(anchor, [row({ calls: ['fleet', 'logs svc', 'trace svc'] })]).trajectoryChanged,
    ).toBe(1);
    expect(capReadingOf(anchor, [row({ calls: ['fleet', 'logs svc'] })]).trajectoryPreserved).toBe(
      1,
    );
  });
});

describe('the verdict, in the reader own words', () => {
  const line = (reading: ReturnType<typeof capReadingOf>, startsWith: string): string =>
    capVerdictOf(reading).find((one) => one.startsWith(startsWith)) ?? '';

  it('reports the uncached change SIGNED, because a cap can make it rise', () => {
    // The first version of this line clamped the saving at zero and printed "0.00 % removed" for a run whose uncached
    // tokens had gone UP by 5 % — the one reading that cannot be true, on the one measurement the iteration exists to
    // take. The sign is the finding: a cap that removes cached tokens makes the remainder dearer.
    const up = capReadingOf(
      [row({ promptTokens: 1_000, cacheHitTokens: 800 })],
      [row({ promptTokens: 700, cacheHitTokens: 200 })],
    );
    expect(line(up, 'uncached prompt')).toContain('+');
    expect(line(up, 'uncached prompt')).toContain('ADDED');
    const down = capReadingOf(
      [row({ promptTokens: 1_000, cacheHitTokens: 800 })],
      [row({ promptTokens: 1_000, cacheHitTokens: 900 })],
    );
    expect(line(down, 'uncached prompt')).toContain('-');
    expect(line(down, 'uncached prompt')).not.toContain('ADDED');
  });

  it('leads with the trajectory, because that is the acceptance test and not a summary of one', () => {
    expect(capVerdictOf(capReadingOf([row()], [row()]))[1]).toContain(
      'trajectory preserved 1 (100.00 %)',
    );
  });

  it('says the clock is unrecorded rather than reporting zero milliseconds', () => {
    const reading = capReadingOf(
      [row({ turnLatencyMs: undefined })],
      [row({ turnLatencyMs: undefined })],
    );
    expect(line(reading, 'model time')).toContain('not recorded');
  });

  it('names the cases only one artifact carries, instead of printing a paired count that hides them', () => {
    const reading = capReadingOf(
      [row({ datapack: 'a' }), row({ datapack: 'b' })],
      [row({ datapack: 'a' })],
    );
    expect(capVerdictOf(reading)[0]).toContain('only anchor 1');
  });

  it('answers a share of nothing with a dash, not with a NaN or a confident 0 %', () => {
    // Two artifacts that share no case at all: a paired reading of zero is a refusal dressed as a measurement, and a
    // percentage of it has no value. The dash says so in the one place a reader looks.
    const reading = capReadingOf([row({ datapack: 'a' })], [row({ datapack: 'b' })]);
    expect(capVerdictOf(reading)[1]).toContain('trajectory preserved 0 (—)');
  });

  it('prints no parenthetical when the two artifacts carry the same cases', () => {
    expect(capVerdictOf(capReadingOf([row()], [row()]))[0]).toBe(
      'transcript cap — paired on 1 cases',
    );
  });
});

describe('the per-call curve', () => {
  it('averages each call index over the cases that made it, so a growth curve is not a single total', () => {
    const curve = perCallCurveOf([
      row({ turnTokens: [1_000, 1_100] }),
      row({ turnTokens: [3_000, 3_100] }),
      row({ turnTokens: [2_000] }),
    ]);
    expect(curve).toEqual([
      { call: 1, cases: 3, mean: 2_000 },
      { call: 2, cases: 2, mean: 2_100 },
    ]);
  });

  it('answers with nothing when no row carries the column, rather than with a flat zero curve', () => {
    // An artifact written before `turnTokens` existed has a total and no curve. A zero would be a measurement of a run
    // that spent nothing; `[]` says this file cannot answer.
    expect(perCallCurveOf([row({ turnTokens: undefined })])).toEqual([]);
  });

  it('skips the calls a case did not make instead of counting them as zero, which would bend the curve down', () => {
    const curve = perCallCurveOf([
      row({ turnTokens: [1_000, 2_000] }),
      row({ turnTokens: [1_000] }),
    ]);
    expect(curve[1]).toEqual({ call: 2, cases: 1, mean: 2_000 });
  });
});
