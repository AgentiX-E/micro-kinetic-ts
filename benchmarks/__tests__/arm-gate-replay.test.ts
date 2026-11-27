import { describe, expect, it } from 'vitest';

import type { GateReplayRow } from '../src/arm-gate-replay.js';
import {
  parseGateReplayRows,
  replayDisagreements,
  replayGateAnswer,
  replayGateAnswers,
} from '../src/arm-gate-replay.js';
import type { GatePolicy } from '../src/query-agent.js';

/**
 * One artifact row, with every column this module reads at its "nothing recorded" value.
 *
 * @param over - The columns this test cares about.
 * @returns The row.
 */
const row = (over: Partial<GateReplayRow> = {}): GateReplayRow => ({
  datapack: 'pack',
  stop: 'answered',
  answer: null,
  rawAnswer: null,
  engineWinner: null,
  calls: [],
  inCone: false,
  answerOnset: null,
  priorOnset: null,
  intoAnswer: null,
  intoPrior: null,
  ...over,
});

/**
 * A case where the model named `answer` over the prior `prior`, with the evidence the two gated policies read.
 *
 * @param answer - The model's name.
 * @param prior - The prior's first name.
 * @param over - Columns this test overrides.
 * @returns The row.
 */
const override = (
  answer: string,
  prior: string,
  over: Partial<GateReplayRow> = {},
): GateReplayRow =>
  row({
    rawAnswer: answer,
    engineWinner: prior,
    calls: [answer],
    inCone: true,
    answerOnset: { firstError: 10, fall: -1 },
    priorOnset: { firstError: 20, fall: -1 },
    intoAnswer: 1,
    intoPrior: -1,
    ...over,
  });

describe('reading an arm artifact', () => {
  it('reads the columns the gate needs and ignores the rest', () => {
    const line = JSON.stringify({
      datapack: 'ts0-mysql-loss-67k278',
      stop: 'answered',
      truth: ['mysql', 'ts-train-service'],
      answer: 'ts-train-service',
      rawAnswer: 'ts-train-service',
      engineWinner: 'ts-travel-plan-service',
      calls: ['ts-travel-plan-service', 'ts-train-service'],
      inCone: true,
      answerOnset: { firstError: 78_496, fall: -10_864_640 },
      priorOnset: { firstError: 173_832, fall: -5_822_464 },
      intoAnswer: null,
      intoPrior: null,
      trace: ['TOOL failed', '=> ts-travel-plan-service <- ts-ui-dashboard net'],
      servedModel: 'deepseek-flash',
      cacheHitTokens: 3_328,
    });
    const [parsed] = parseGateReplayRows(line);
    expect(parsed).toEqual({
      datapack: 'ts0-mysql-loss-67k278',
      stop: 'answered',
      answer: 'ts-train-service',
      rawAnswer: 'ts-train-service',
      engineWinner: 'ts-travel-plan-service',
      calls: ['ts-travel-plan-service', 'ts-train-service'],
      inCone: true,
      answerOnset: { firstError: 78_496, fall: -10_864_640 },
      priorOnset: { firstError: 173_832, fall: -5_822_464 },
      intoAnswer: null,
      intoPrior: null,
    });
  });

  it('keeps file order and skips blank lines', () => {
    const text = [
      JSON.stringify(row({ datapack: 'a' })),
      '',
      JSON.stringify(row({ datapack: 'b' })),
    ].join('\n');
    expect(parseGateReplayRows(text).map((parsed) => parsed.datapack)).toEqual(['a', 'b']);
  });

  it('reads an absent onset block as null, and a block without `fall` as a block', () => {
    const text = JSON.stringify({
      datapack: 'a',
      stop: 'answered',
      inCone: false,
      calls: [],
      answerOnset: { firstError: 5 },
    });
    const [parsed] = parseGateReplayRows(text);
    expect(parsed!.answerOnset).toEqual({ firstError: 5, fall: null });
    expect(parsed!.priorOnset).toBeNull();
  });

  it('reads an onset block whose two columns are explicitly null', () => {
    const [parsed] = parseGateReplayRows(
      '{"datapack":"a","stop":"answered","inCone":false,"calls":[],"answerOnset":{"firstError":null,"fall":5}}',
    );
    expect(parsed!.answerOnset).toEqual({ firstError: null, fall: 5 });
  });

  it('refuses a line that is not JSON', () => {
    expect(() => parseGateReplayRows('{not json')).toThrow(/line 1 is not JSON/);
  });

  it('refuses a line that is JSON but not an object', () => {
    expect(() => parseGateReplayRows('[1,2]')).toThrow(/line 1 is not a JSON object/);
  });

  it('refuses a row with no datapack', () => {
    expect(() => parseGateReplayRows('{"stop":"answered","inCone":false,"calls":[]}')).toThrow(
      /carries no datapack/,
    );
    expect(() => parseGateReplayRows('{"datapack":"","stop":"answered","inCone":false}')).toThrow(
      /carries no datapack/,
    );
  });

  it('refuses a row with no stop', () => {
    expect(() => parseGateReplayRows('{"datapack":"a","inCone":false}')).toThrow(/carries no stop/);
  });

  it('refuses an `inCone` that is not a boolean', () => {
    expect(() => parseGateReplayRows('{"datapack":"a","stop":"answered","inCone":"yes"}')).toThrow(
      /`inCone` is not a boolean/,
    );
  });

  it('refuses a name column that is neither null nor a string', () => {
    for (const field of ['answer', 'rawAnswer', 'engineWinner']) {
      const record = { datapack: 'a', stop: 'answered', inCone: false, [field]: 7 };
      expect(() => parseGateReplayRows(JSON.stringify(record))).toThrow(
        new RegExp(`\`${field}\` is neither null nor a name`),
      );
    }
  });

  it('refuses a `calls` column that is not a list of names', () => {
    expect(() =>
      parseGateReplayRows('{"datapack":"a","stop":"answered","inCone":false,"calls":"mysql"}'),
    ).toThrow(/`calls` is not a list/);
    expect(() =>
      parseGateReplayRows('{"datapack":"a","stop":"answered","inCone":false,"calls":[""]}'),
    ).toThrow(/`calls` carries an entry that is not a name/);
  });

  it('refuses an onset column that is neither null nor a block', () => {
    expect(() =>
      parseGateReplayRows(
        '{"datapack":"a","stop":"answered","inCone":false,"calls":[],"answerOnset":5,"priorOnset":5}',
      ),
    ).toThrow(/`answerOnset` is neither null nor an onset block/);
    expect(() =>
      parseGateReplayRows(
        '{"datapack":"a","stop":"answered","inCone":false,"calls":[],"priorOnset":[]}',
      ),
    ).toThrow(/`priorOnset` is neither null nor an onset block/);
  });

  it('refuses an onset whose own columns are not numbers', () => {
    expect(() =>
      parseGateReplayRows(
        '{"datapack":"a","stop":"answered","inCone":false,"calls":[],"answerOnset":{"firstError":"early"}}',
      ),
    ).toThrow(/`answerOnset.firstError` is neither null nor a number/);
    expect(() =>
      parseGateReplayRows(
        '{"datapack":"a","stop":"answered","inCone":false,"calls":[],"priorOnset":{"fall":"later"}}',
      ),
    ).toThrow(/`priorOnset.fall` is neither null nor a number/);
  });

  it('refuses an interface column that is neither null nor a number', () => {
    for (const field of ['intoAnswer', 'intoPrior']) {
      const record = { datapack: 'a', stop: 'answered', inCone: false, calls: [], [field]: 'net' };
      expect(() => parseGateReplayRows(JSON.stringify(record))).toThrow(
        new RegExp(`\`${field}\` is neither null nor a finite number`),
      );
    }
    expect(() =>
      parseGateReplayRows(
        '{"datapack":"a","stop":"answered","inCone":false,"calls":[],"intoAnswer":null}',
      ),
    ).not.toThrow();
    // A finite number is the column's normal value, and an infinity is not a number the artifact can carry: `1e999`
    // is JSON that parses, so the check is on the parsed value rather than on the text.
    expect(
      parseGateReplayRows(
        '{"datapack":"a","stop":"answered","inCone":false,"calls":[],"intoAnswer":3,"intoPrior":-2}',
      )[0],
    ).toMatchObject({ intoAnswer: 3, intoPrior: -2 });
    expect(() =>
      parseGateReplayRows(
        '{"datapack":"a","stop":"answered","inCone":false,"calls":[],"intoPrior":1e999}',
      ),
    ).toThrow(/`intoPrior` is neither null nor a finite number/);
  });
});

describe('the name a policy settles a case on', () => {
  it('leaves a case the certainty floor settled on the prior, under every policy', () => {
    const settled = row({ rawAnswer: null, engineWinner: 'mysql', answer: 'mysql' });
    for (const policy of ['none', 'cited', 'cone', 'contrast', 'lag'] as const) {
      expect(replayGateAnswer(settled, policy)).toBe('mysql');
    }
  });

  it('leaves a model answer that IS the prior alone, under every policy', () => {
    const agreed = row({ rawAnswer: 'mysql', engineWinner: 'mysql', answer: 'mysql' });
    for (const policy of ['none', 'cited', 'cone', 'contrast', 'lag'] as const) {
      expect(replayGateAnswer(agreed, policy)).toBe('mysql');
    }
  });

  it('admits an override under `none` even when the investigation never queried it', () => {
    expect(replayGateAnswer(override('ts-a', 'ts-b', { calls: [] }), 'none')).toBe('ts-a');
  });

  it('refuses an override the investigation never queried, from `cited` upwards', () => {
    const uncited = override('ts-a', 'ts-b', { calls: ['ts-c'] });
    for (const policy of ['cited', 'cone', 'contrast', 'lag'] as const) {
      expect(replayGateAnswer(uncited, policy)).toBe('ts-b');
    }
  });

  it('admits a cited override under `cited` and refuses it off the prior cone above that', () => {
    expect(replayGateAnswer(override('ts-a', 'ts-b'), 'cited')).toBe('ts-a');
    const offCone = override('ts-a', 'ts-b', { inCone: false });
    expect(replayGateAnswer(offCone, 'cone')).toBe('ts-b');
    expect(replayGateAnswer(offCone, 'contrast')).toBe('ts-b');
    expect(replayGateAnswer(offCone, 'lag')).toBe('ts-b');
  });

  it('admits a cited override ON the cone under `cone`', () => {
    expect(replayGateAnswer(override('ts-a', 'ts-b'), 'cone')).toBe('ts-a');
  });

  it('reads onset only: an earlier first error is what `lag` admits', () => {
    const answerLeads = override('ts-a', 'ts-b');
    expect(replayGateAnswer(answerLeads, 'lag')).toBe('ts-a');
    const priorLeads = override('ts-a', 'ts-b', {
      answerOnset: { firstError: 30, fall: -1 },
      priorOnset: { firstError: 20, fall: -1 },
    });
    expect(replayGateAnswer(priorLeads, 'lag')).toBe('ts-b');
  });

  it('lets `lag` admit when the answer errored and the prior never did', () => {
    const priorSilent = override('ts-a', 'ts-b', {
      answerOnset: { firstError: 10, fall: -1 },
      priorOnset: { firstError: null, fall: null },
    });
    expect(replayGateAnswer(priorSilent, 'lag')).toBe('ts-a');
  });

  it('refuses `lag` when the answer never errored', () => {
    const answerSilent = override('ts-a', 'ts-b', {
      answerOnset: { firstError: null, fall: null },
    });
    expect(replayGateAnswer(answerSilent, 'lag')).toBe('ts-b');
  });

  it('admits `contrast` on the interface term alone, which is the disjunction it is', () => {
    // The documented cost of the disjunction: an interface failing from the prior into the answer is exactly what a
    // failing CALLER produces on every callee it has left, so this term admits the prior's own victims. No onset is
    // read at all here — `intoAnswer > 0 > intoPrior` is the whole of the decision.
    expect(replayGateAnswer(override('ts-a', 'ts-b', { answerOnset: null }), 'contrast')).toBe(
      'ts-a',
    );
  });

  it('refuses both evidence policies when neither the onset nor the interface was recorded', () => {
    const bare = override('ts-a', 'ts-b', {
      answerOnset: null,
      priorOnset: null,
      intoAnswer: null,
      intoPrior: null,
    });
    for (const policy of ['contrast', 'lag'] as const) {
      expect(replayGateAnswer(bare, policy)).toBe('ts-b');
    }
  });

  it('reads the interface both ways for `contrast`, which is a disjunction and not a conjunction', () => {
    expect(replayGateAnswer(override('ts-a', 'ts-b'), 'contrast')).toBe('ts-a');
    // The interface failed the OTHER way — a caller reporting errors on its callee's interface is a victim, and the
    // interface term refuses. `contrast` is still a disjunction, so the order term admits: the veto this policy does
    // not have is why §320 priced it as the one that admits breaks.
    expect(
      replayGateAnswer(
        override('ts-a', 'ts-b', {
          answerOnset: { firstError: 30, fall: -1 },
          priorOnset: { firstError: 20, fall: -1 },
          intoAnswer: -1,
          intoPrior: 1,
        }),
        'contrast',
      ),
    ).toBe('ts-b');
    expect(
      replayGateAnswer(
        override('ts-a', 'ts-b', { intoAnswer: null, answerOnset: null }),
        'contrast',
      ),
    ).toBe('ts-b');
  });

  it('lets `lag` admit against a prior that never errored, because absence is not counter-evidence', () => {
    const priorSilent = override('ts-a', 'ts-b', {
      priorOnset: { firstError: null, fall: null },
    });
    expect(replayGateAnswer(priorSilent, 'lag')).toBe('ts-a');
  });

  it('has no name for a case with neither a model answer nor a prior', () => {
    expect(replayGateAnswer(row(), 'lag')).toBeNull();
  });

  it('refuses a policy the loop does not know', () => {
    expect(() => replayGateAnswer(row(), 'strictest' as GatePolicy)).toThrow(
      /`strictest` is not a gate policy/,
    );
  });
});

describe('replaying a whole artifact', () => {
  /**
   * A six-case artifact that takes every path once: a certainty settlement, an agreement, a cited and admitted
   * override, an uncited refusal, an off-cone refusal, and a case with no names at all.
   */
  const artifact: readonly GateReplayRow[] = [
    row({ datapack: 'certainty', rawAnswer: null, engineWinner: 'mysql', answer: 'mysql' }),
    row({ datapack: 'agreed', rawAnswer: 'mysql', engineWinner: 'mysql', answer: 'mysql' }),
    override('ts-a', 'ts-b', { datapack: 'cited' }),
    override('ts-a', 'ts-b', { datapack: 'uncited', calls: ['ts-z'] }),
    override('ts-a', 'ts-b', { datapack: 'offcone', inCone: false }),
    row({ datapack: 'empty' }),
  ];

  it('writes the settled names in the artifact order under `none`', () => {
    const { answers, census } = replayGateAnswers(artifact, 'none');
    expect(answers).toEqual([
      { datapack: 'certainty', answer: 'mysql' },
      { datapack: 'agreed', answer: 'mysql' },
      { datapack: 'cited', answer: 'ts-a' },
      { datapack: 'uncited', answer: 'ts-a' },
      { datapack: 'offcone', answer: 'ts-a' },
    ]);
    expect(census).toEqual({
      cases: 6,
      errored: 0,
      settledBeforeModel: 1,
      agreedWithPrior: 1,
      admitted: 3,
      refused: 0,
      unanswered: 1,
    });
  });

  it('prices the same artifact under `lag` without a second purchase', () => {
    const { answers, census } = replayGateAnswers(artifact, 'lag');
    expect(answers).toEqual([
      { datapack: 'certainty', answer: 'mysql' },
      { datapack: 'agreed', answer: 'mysql' },
      { datapack: 'cited', answer: 'ts-a' },
      { datapack: 'uncited', answer: 'ts-b' },
      { datapack: 'offcone', answer: 'ts-b' },
    ]);
    expect(census.admitted).toBe(1);
    expect(census.refused).toBe(2);
  });

  it('drops an errored row from the names and counts it instead of losing it', () => {
    const withError = [...artifact, row({ datapack: 'crashed', stop: 'error' })];
    const { answers, census } = replayGateAnswers(withError, 'none');
    expect(answers.map((entry) => entry.datapack)).not.toContain('crashed');
    expect(census.errored).toBe(1);
    expect(census.cases).toBe(7);
  });

  it('replays an empty artifact to an empty file rather than dividing by nothing', () => {
    const { answers, census } = replayGateAnswers([], 'lag');
    expect(answers).toEqual([]);
    expect(census.cases).toBe(0);
  });

  it('refuses an unknown policy before it writes anything', () => {
    expect(() => replayGateAnswers(artifact, 'narrow' as GatePolicy)).toThrow(
      /is not a gate policy/,
    );
  });
});

describe('the check that the replay is the loop', () => {
  it('reproduces the artifact column a run dispatched under `none` wrote', () => {
    const recorded: readonly GateReplayRow[] = [
      row({ datapack: 'certainty', rawAnswer: null, engineWinner: 'mysql', answer: 'mysql' }),
      override('ts-a', 'ts-b', { datapack: 'admitted', answer: 'ts-a' }),
      override('ts-a', 'ts-b', { datapack: 'uncited', calls: ['ts-z'], answer: 'ts-a' }),
    ];
    const { answers } = replayGateAnswers(recorded, 'none');
    expect(replayDisagreements(recorded, answers)).toEqual([]);
  });

  it('names both sides of a disagreement', () => {
    const recorded: readonly GateReplayRow[] = [
      override('ts-a', 'ts-b', { datapack: 'flipped', calls: ['ts-z'], answer: 'ts-a' }),
    ];
    const { answers } = replayGateAnswers(recorded, 'lag');
    expect(replayDisagreements(recorded, answers)).toEqual([
      { datapack: 'flipped', recorded: 'ts-a', replayed: 'ts-b' },
    ]);
  });

  it('reports a case the replay settled on nothing as a disagreement with the recorded name', () => {
    const recorded: readonly GateReplayRow[] = [row({ datapack: 'ghost', answer: 'mysql' })];
    const { answers } = replayGateAnswers(recorded, 'lag');
    expect(answers).toEqual([]);
    expect(replayDisagreements(recorded, answers)).toEqual([
      { datapack: 'ghost', recorded: 'mysql', replayed: null },
    ]);
  });

  it('says nothing about an errored row, which has no settlement to check', () => {
    const recorded: readonly GateReplayRow[] = [
      row({ datapack: 'crashed', stop: 'error', answer: 'mysql' }),
    ];
    expect(replayDisagreements(recorded, [])).toEqual([]);
  });
});
