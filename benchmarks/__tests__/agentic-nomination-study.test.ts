import { describe, expect, it, vi } from 'vitest';

import type { CandidateFingerprint } from '../../packages/ai/src/agent/index.js';
import type { HeadroomCase } from '../src/agentic-headroom.js';
import {
  DEFAULT_SWEEP,
  formatNominationStudy,
  nominateCases,
  parseNominationArgs,
  sweepNomination,
  sweepPromotion,
  type ProposeNominationOptions,
} from '../src/agentic-nomination-study.js';
import type { NominationRecord } from '../src/agentic-nomination.js';
import { ChatCompletionError, type ChatClient } from '../src/chat-completions.js';

function candidate(service: string, rank: number, score: number): CandidateFingerprint {
  return {
    service,
    rank,
    score,
    channels: [{ label: 'latency_p99', pre: 1, post: 9, band: [1, 2], rate: 0.01, onset: 100 }],
  };
}

function oneCase(datapack: string, accepted: readonly string[]): HeadroomCase {
  return {
    datapack,
    faultType: 'PodKill',
    accepted,
    candidates: ['a', 'b', 'c'].map((service, index) => candidate(service, index, 1 - index * 0.1)),
  };
}

function fakeClient(reply: (user: string) => string): ChatClient {
  return {
    model: 'fake-model',
    endpoint: 'http://localhost',
    complete: async (turn) => ({
      text: reply(turn.user),
      model: 'fake-model',
      promptTokens: 10,
      completionTokens: 2,
      attempts: 1,
    }),
  };
}

describe('parseNominationArgs', () => {
  it('requires both artifacts', () => {
    expect(() => parseNominationArgs([])).toThrow(/--fingerprints and --verdicts/);
    expect(() => parseNominationArgs(['--fingerprints', 'a'])).toThrow(/required/);
  });

  it('reads the paths, the model and the flags', () => {
    const args = parseNominationArgs([
      '--fingerprints',
      'f.ndjson',
      '--verdicts',
      'v.ndjson',
      '--nominations',
      'n.ndjson',
      '--model',
      'deepseek-reasoner',
      '--propose',
    ]);
    expect(args.fingerprints).toBe('f.ndjson');
    expect(args.verdicts).toBe('v.ndjson');
    expect(args.nominations).toBe('n.ndjson');
    expect(args.model).toBe('deepseek-reasoner');
    expect(args.propose).toBe(true);
  });

  it('defaults to the published presentation', () => {
    const args = parseNominationArgs(['--fingerprints', 'f', '--verdicts', 'v']);
    expect(args.maxCandidates).toBe(5);
    expect(args.maxChannels).toBe(8);
    expect(args.maxRanked).toBe(5);
    expect(args.concurrency).toBe(4);
    expect(args.limit).toBe(0);
    expect(args.delta).toBeCloseTo(0.05, 10);
  });

  it('refuses --propose without a destination, because a proposal that is not written is money spent twice', () => {
    expect(() =>
      parseNominationArgs(['--fingerprints', 'f', '--verdicts', 'v', '--propose']),
    ).toThrow(/--nominations is required/);
  });

  it('accepts a value inside range for every numeric flag, and assigns it', () => {
    // The refusal on each flag was tested and the assignment was not, which left every bound checked on one side
    // only. A flag that parses and then never reaches the study is a flag that silently does nothing.
    const args = parseNominationArgs([
      '--fingerprints',
      'f',
      '--verdicts',
      'v',
      '--concurrency',
      '2',
      '--limit',
      '10',
      '--max-candidates',
      '20',
      '--max-channels',
      '4',
      '--max-ranked',
      '6',
      '--delta',
      '0.2',
    ]);
    expect(args.concurrency).toBe(2);
    expect(args.limit).toBe(10);
    expect(args.maxCandidates).toBe(20);
    expect(args.maxChannels).toBe(4);
    expect(args.maxRanked).toBe(6);
    expect(args.delta).toBeCloseTo(0.2, 12);
  });

  it('refuses a value outside its range', () => {
    const base = ['--fingerprints', 'f', '--verdicts', 'v'];
    expect(() => parseNominationArgs([...base, '--concurrency', '0'])).toThrow(/concurrency/);
    expect(() => parseNominationArgs([...base, '--concurrency', '33'])).toThrow(/concurrency/);
    expect(() => parseNominationArgs([...base, '--limit', '-1'])).toThrow(/limit/);
    expect(() => parseNominationArgs([...base, '--max-candidates', '0'])).toThrow(/max-candidates/);
    expect(() => parseNominationArgs([...base, '--max-channels', '65'])).toThrow(/max-channels/);
    expect(() => parseNominationArgs([...base, '--max-ranked', '0'])).toThrow(/max-ranked/);
    expect(() => parseNominationArgs([...base, '--delta', '0'])).toThrow(/delta/);
    expect(() => parseNominationArgs([...base, '--delta', '1'])).toThrow(/delta/);
  });

  it('refuses a missing value, a non-numeric value and an unknown flag', () => {
    const base = ['--fingerprints', 'f', '--verdicts', 'v'];
    expect(() => parseNominationArgs([...base, '--limit'])).toThrow(/needs a value/);
    expect(() => parseNominationArgs(['--fingerprints', '--verdicts', 'v'])).toThrow(
      /needs a value/,
    );
    expect(() => parseNominationArgs([...base, '--limit', 'many'])).toThrow(/needs a number/);
    expect(() => parseNominationArgs([...base, '--nope', 'x'])).toThrow(/unknown flag/);
    expect(() => parseNominationArgs(['--help'])).toThrow('--help');
  });
});

describe('nominateCases', () => {
  const cases = [oneCase('c1', ['a']), oneCase('c2', ['b']), oneCase('c3', ['c'])];

  function collect(): { records: NominationRecord[]; options: ProposeNominationOptions } {
    const records: NominationRecord[] = [];
    return {
      records,
      options: {
        client: fakeClient((user) => (user.includes('c3') ? '{}' : '{"ranking":["b"]}')),
        onRecord: (record) => records.push(record),
        now: () => 0,
      },
    };
  }

  it('asks every case once and records one line each, in the order they finish', async () => {
    const { records, options } = collect();
    const summary = await nominateCases(cases, { ...options, concurrency: 1 });
    expect(summary.asked).toBe(3);
    expect(summary.cases).toBe(3);
    expect(records).toHaveLength(3);
    expect(summary.ranked).toBe(3);
    expect(summary.declined).toBe(0);
  });

  it('records an unreadable reply as unreadable rather than as a silent abstention', async () => {
    const records: NominationRecord[] = [];
    const summary = await nominateCases(cases, {
      client: fakeClient(() => 'I cannot help with that'),
      onRecord: (record) => records.push(record),
      concurrency: 1,
    });
    expect(summary.unreadable).toBe(3);
    expect(summary.unreadableCases).toHaveLength(3);
    expect(records.every((record) => record.malformed !== undefined)).toBe(true);
  });

  it('records a failed call as unreadable with the reason, and does not throw', async () => {
    const records: NominationRecord[] = [];
    const summary = await nominateCases(cases, {
      client: {
        model: 'fake-model',
        endpoint: 'http://localhost',
        complete: async () => {
          throw new ChatCompletionError('endpoint is down', 500, 'server error', 4);
        },
      },
      onRecord: (record) => records.push(record),
      concurrency: 1,
    });
    expect(summary.unreadable).toBe(3);
    expect(summary.unreadableCases[0]).toContain('call failed');
    expect(records[0]!.malformed).toContain('endpoint is down');
  });

  it('records a non-ChatCompletionError with its own message, so a wiring fault is not hidden as an outage', async () => {
    const records: NominationRecord[] = [];
    await nominateCases(cases.slice(0, 1), {
      client: {
        model: 'fake-model',
        endpoint: 'http://localhost',
        complete: async () => {
          throw new TypeError('bad argument');
        },
      },
      onRecord: (record) => records.push(record),
      concurrency: 1,
    });
    expect(records[0]!.malformed).toContain('bad argument');
  });

  it('counts an empty ranking as a decline and still records it', async () => {
    const records: NominationRecord[] = [];
    const summary = await nominateCases(cases, {
      client: fakeClient(() => '{"ranking":[]}'),
      onRecord: (record) => records.push(record),
      concurrency: 2,
    });
    expect(summary.declined).toBe(3);
    expect(summary.ranked).toBe(0);
    expect(records).toHaveLength(3);
  });

  it('reuses a recorded answer under the same prompt and asks nothing', async () => {
    const { records, options } = collect();
    const first = await nominateCases(cases.slice(0, 1), { ...options, concurrency: 1 });
    expect(first.asked).toBe(1);

    const existing = new Map(records.map((record) => [record.datapack, record]));
    const complete = vi.fn();
    const summary = await nominateCases(cases.slice(0, 1), {
      client: { model: 'fake-model', endpoint: 'http://localhost', complete },
      existing,
      onRecord: () => {
        throw new Error('a reused case must not be re-emitted');
      },
      concurrency: 1,
    });
    expect(summary.reused).toBe(1);
    expect(summary.asked).toBe(0);
    expect(complete).not.toHaveBeenCalled();
  });

  it('reports progress once per completed case', async () => {
    const seen: number[] = [];
    await nominateCases(cases, {
      client: fakeClient(() => '{"ranking":["a"]}'),
      onRecord: () => undefined,
      onProgress: (done) => seen.push(done),
      concurrency: 1,
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it('is well defined on an empty population', async () => {
    const summary = await nominateCases([], {
      client: fakeClient(() => '{}'),
      onRecord: () => undefined,
    });
    expect(summary.asked).toBe(0);
    expect(summary.cases).toBe(0);
  });

  it('accumulates the token counts the endpoint reported', async () => {
    const summary = await nominateCases(cases, {
      client: fakeClient(() => '{"ranking":["a"]}'),
      onRecord: () => undefined,
      concurrency: 3,
    });
    expect(summary.promptTokens).toBe(30);
    expect(summary.completionTokens).toBe(6);
  });
});

describe('sweepNomination', () => {
  const cases = [oneCase('c1', ['a']), oneCase('c2', ['b']), oneCase('c3', ['c'])];
  const records = new Map<string, NominationRecord>([
    [
      'c1',
      {
        datapack: 'c1',
        model: 'm',
        protocol: 1,
        digest: 'd',
        ranking: ['a'],
        ms: 1,
        promptTokens: 1,
        completionTokens: 1,
      },
    ],
  ]);

  it('scores every point on the default grid, in order, with the control first', () => {
    const outcomes = sweepNomination(cases, records);
    expect(outcomes).toHaveLength(DEFAULT_SWEEP.length);
    expect(outcomes[0]!.weight).toBe(0);
    expect(outcomes[0]!.strategy).toBe('rrf');
    expect(DEFAULT_SWEEP[0]).toEqual({ strategy: 'rrf', weight: 0 });
  });

  it('honours a caller-supplied grid', () => {
    const outcomes = sweepNomination(cases, records, [{ strategy: 'borda', weight: 0.4 }]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.strategy).toBe('borda');
    expect(outcomes[0]!.weight).toBeCloseTo(0.4, 10);
  });
});

describe('formatNominationStudy', () => {
  const cases = [oneCase('c1', ['a']), oneCase('c2', ['b'])];
  const records = new Map<string, NominationRecord>();

  it('prints the arm table, the oracle row and the refusal census', () => {
    const outcomes = sweepNomination(cases, records, [{ strategy: 'rrf', weight: 0 }]);
    const text = formatNominationStudy(cases, outcomes);
    expect(text).toContain('oracle');
    expect(text).toContain('nominate');
    expect(text).toContain('refusals:');
  });
});

describe('parseNominationArgs — the gate flags', () => {
  const base = ['--fingerprints', 'f', '--verdicts', 'v'];

  it('defaults to a fusion, with no depth and no threshold', () => {
    const args = parseNominationArgs(base);
    expect(args.depth).toBe('');
    expect(args.promotion).toBeNull();
  });

  it("reads 'off' as the control rather than as a number", () => {
    // `Number('off')` is NaN, so the two spellings have to be told apart explicitly or a control would be rejected
    // as a malformed threshold.
    expect(
      parseNominationArgs([...base, '--depth', 'd', '--promotion', 'off']).promotion,
    ).toBeNull();
  });

  it('reads a threshold in (0, 1)', () => {
    expect(parseNominationArgs([...base, '--depth', 'd', '--promotion', '0.03']).promotion).toBe(
      0.03,
    );
  });

  it('refuses a threshold outside (0, 1) and a word that is not off', () => {
    for (const bad of ['0', '1', '-0.1', '2', 'yes', '']) {
      expect(() => parseNominationArgs([...base, '--depth', 'd', '--promotion', bad])).toThrow(
        /--promotion/,
      );
    }
  });

  it('refuses a threshold without the artifact its spread comes from', () => {
    // The gate's denominator is a property of the order it is read from. Without `--depth` the only order in hand
    // is the population's, whose width is whatever the dump was asked for.
    expect(() => parseNominationArgs([...base, '--promotion', '0.03'])).toThrow(/needs --depth/);
    // `--depth` on its own is fine: it is also useful to a caller that only wants the population written out.
    expect(parseNominationArgs([...base, '--depth', 'd']).promotion).toBeNull();
  });
});

describe('sweepPromotion', () => {
  const cases = [oneCase('c1', ['a']), oneCase('c2', ['b'])];
  const records = new Map<string, NominationRecord>([
    [
      'c1',
      {
        datapack: 'c1',
        model: 'm',
        protocol: 1,
        digest: 'd',
        ranking: ['b'],
        ms: 1,
        promptTokens: 1,
        completionTokens: 1,
      },
    ],
    [
      'c2',
      {
        datapack: 'c2',
        model: 'm',
        protocol: 1,
        digest: 'd',
        ranking: ['b'],
        ms: 1,
        promptTokens: 1,
        completionTokens: 1,
      },
    ],
  ]);
  const spread = new Map([
    [
      'c1',
      [
        { service: 'a', score: 1.0 },
        { service: 'b', score: 0.99 },
        { service: 'c', score: 0.0 },
      ],
    ],
    [
      'c2',
      [
        { service: 'a', score: 1.0 },
        { service: 'b', score: 0.99 },
        { service: 'c', score: 0.0 },
      ],
    ],
  ]);

  it('puts the control on the grid, so the table states its own baseline', () => {
    const outcomes = sweepPromotion(cases, records, spread);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.promotion?.threshold).toBeNull();
    expect(outcomes[1]!.promotion?.threshold).toBeCloseTo(0.03, 12);
  });

  it('differences the two arms over one denominator', () => {
    const outcomes = sweepPromotion(cases, records, spread);
    // Both cases have a ratio of 0.01, so the gate fires on both; c1 is repaired and c2 was already right, which
    // the override then breaks.
    expect(outcomes[0]!.correct).toBe(1);
    expect(outcomes[1]!.promotion?.overrides).toBe(2);
    expect(outcomes[1]!.promotion?.fix).toBe(1);
    expect(outcomes[1]!.promotion?.breaks).toBe(1);
    expect(outcomes[1]!.correct).toBe(1);
    expect(outcomes[0]!.cases).toBe(outcomes[1]!.cases);
  });

  it('honours a caller-supplied grid', () => {
    const outcomes = sweepPromotion(cases, records, spread, [{ threshold: 0 }]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.promotion?.threshold).toBe(0);
  });
});
