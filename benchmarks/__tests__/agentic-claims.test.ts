import { describe, expect, it } from 'vitest';

import {
  formatClaimRecord,
  parseClaimRecords,
  replayOf,
  type ClaimRecord,
} from '../src/agentic-claims.js';

/** One claim in the shape the protocol produces. */
const CLAIM = {
  remove: 'ts-auth-service',
  keep: 'ts-order-service',
  because: {
    channel: 'latency_p99',
    statistic: 'post' as const,
    observed: 98.25,
    band: [11, 14.2] as const,
    rate: 0,
  },
};

function record(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    datapack: 'ts0-logistics-1',
    model: 'deepseek-chat',
    protocol: 1,
    digest: 'a1b2c3d4e5f60708',
    claims: [CLAIM],
    ms: 812,
    promptTokens: 940,
    completionTokens: 61,
    ...overrides,
  };
}

describe('formatClaimRecord', () => {
  it('writes one line with a fixed field order, so two runs of one answer diff as nothing', () => {
    const line = formatClaimRecord(record());
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      datapack: 'ts0-logistics-1',
      model: 'deepseek-chat',
      protocol: 1,
      digest: 'a1b2c3d4e5f60708',
      claims: [
        {
          remove: 'ts-auth-service',
          keep: 'ts-order-service',
          because: {
            channel: 'latency_p99',
            statistic: 'post',
            observed: 98.25,
            band: [11, 14.2],
            rate: 0,
          },
        },
      ],
      ms: 812,
      promptTokens: 940,
      completionTokens: 61,
    });
    expect(line).toBe(formatClaimRecord(record()));
  });

  it('omits a rate the claim did not assert, rather than writing an absent one as zero', () => {
    const withoutRate = {
      ...CLAIM,
      because: {
        channel: 'latency_p99',
        statistic: 'post' as const,
        observed: 98.25,
        band: [11, 14.2] as const,
      },
    };
    const parsed = JSON.parse(formatClaimRecord(record({ claims: [withoutRate] }))) as {
      claims: { because: Record<string, unknown> }[];
    };
    expect('rate' in parsed.claims[0]!.because).toBe(false);
  });

  it('carries the refusal reason when a reply could not be read', () => {
    const parsed = JSON.parse(
      formatClaimRecord(record({ claims: [], malformed: 'the reply is not JSON' })),
    ) as Record<string, unknown>;
    expect(parsed['malformed']).toBe('the reply is not JSON');
    expect(parsed['claims']).toEqual([]);
  });
});

describe('parseClaimRecords', () => {
  it('round-trips every field', () => {
    const one = record();
    expect(parseClaimRecords(`${formatClaimRecord(one)}\n`)).toEqual([one]);
  });

  it('round-trips a claim that asserted no rate, keeping the absence an absence', () => {
    const withoutRate = {
      ...CLAIM,
      because: {
        channel: 'latency_p99',
        statistic: 'post' as const,
        observed: 98.25,
        band: [11, 14.2] as const,
      },
    };
    const [read] = parseClaimRecords(`${formatClaimRecord(record({ claims: [withoutRate] }))}\n`);
    expect(read!.claims[0]!.because.rate).toBeUndefined();
    expect('rate' in read!.claims[0]!.because).toBe(false);
  });

  it('skips blank lines and reads several records in order', () => {
    const text = [
      formatClaimRecord(record({ datapack: 'b' })),
      '',
      formatClaimRecord(record({ datapack: 'a' })),
      '',
    ].join('\n');
    expect(parseClaimRecords(text).map((entry) => entry.datapack)).toEqual(['b', 'a']);
  });

  it('throws with the line number rather than dropping an unreadable line', () => {
    // A reader that skipped a bad line would report an accuracy over a corpus it did not read.
    const good = formatClaimRecord(record());
    const cases: readonly [string, string][] = [
      [`${good}\nnot json`, 'claims line 2 is not JSON'],
      [`${good}\n[]`, 'claims line 2 is not an object'],
      [`${good}\n{"model":"m"}`, 'claims line 2 names no case'],
      [`${good}\n{"datapack":"x"}`, 'claims line 2 names no model'],
      [`${good}\n{"datapack":"x","model":"m"}`, 'claims line 2 carries no prompt digest'],
      [
        `${good}\n{"datapack":"x","model":"m","digest":"d","protocol":"1"}`,
        'line 2: protocol is not a number',
      ],
      [
        `${good}\n{"datapack":"x","model":"m","digest":"d","protocol":1,"ms":"8"}`,
        'line 2: ms is not a number',
      ],
      [
        `${good}\n{"datapack":"x","model":"m","digest":"d","protocol":1,"ms":8,"promptTokens":"9"}`,
        'line 2: promptTokens is not a number',
      ],
      [
        `${good}\n{"datapack":"x","model":"m","digest":"d","protocol":1,"ms":8,"promptTokens":"9","completionTokens":1}`,
        'line 2: promptTokens is not a number',
      ],
      [
        `${good}\n{"datapack":"x","model":"m","digest":"d","protocol":1,"ms":8,"promptTokens":9,"completionTokens":"1"}`,
        'line 2: completionTokens is not a number',
      ],
      [
        `${good}\n{"datapack":"x","model":"m","digest":"d","protocol":1,"ms":8,"promptTokens":9,"completionTokens":1}`,
        'claims line 2 carries no claims array',
      ],
      [
        `${good}\n{"datapack":"x","model":"m","digest":"d","protocol":1,"ms":8,"promptTokens":9,"completionTokens":1,"claims":[],"malformed":7}`,
        'claims line 2 carries a malformed reason that is not text',
      ],
    ];
    for (const [text, message] of cases) expect(() => parseClaimRecords(text)).toThrow(message);
  });

  it('round-trips a record whose answer could not be read', () => {
    // The `malformed` field is written by the writer only when a reply could not be read, so the reader has to
    // accept both shapes: a record with the field and a record without it.
    const readless = record({ claims: [], malformed: 'the reply is not JSON' });
    expect(parseClaimRecords(`${formatClaimRecord(readless)}\n`)).toEqual([readless]);
  });

  it('refuses a claim it could not have written, by name', () => {
    const base = {
      datapack: 'x',
      model: 'm',
      protocol: 1,
      digest: 'd',
      ms: 8,
      promptTokens: 9,
      completionTokens: 1,
    };
    const cases: readonly [unknown, string][] = [
      ['not an object', 'line 1: a claim is not an object'],
      [{ remove: 'a', keep: 'b' }, 'line 1: a claim carries no basis'],
      [
        {
          remove: 'a',
          keep: 'b',
          because: { channel: 'c', statistic: 'post', observed: 1, band: [1] },
        },
        "line 1: a claim's band is not two numbers",
      ],
      [
        { remove: 'a', keep: 'b', because: { statistic: 'post', observed: 1, band: [0, 1] } },
        'line 1: a claim names no channel',
      ],
      [
        {
          remove: 'a',
          keep: 'b',
          because: { channel: 'c', statistic: 'mean', observed: 1, band: [0, 1] },
        },
        'line 1: a claim cites an unknown statistic',
      ],
      [
        {
          remove: 'a',
          keep: 'b',
          because: { channel: 'c', statistic: 'post', observed: 'x', band: [0, 1] },
        },
        "line 1: a claim's observed value is not a number",
      ],
      [
        {
          remove: 'a',
          keep: 'b',
          because: { channel: 'c', statistic: 'post', observed: 1, band: [0, 1], rate: 'x' },
        },
        "line 1: a claim's rate is not a number",
      ],
      [
        { keep: 'b', because: { channel: 'c', statistic: 'post', observed: 1, band: [0, 1] } },
        'line 1: a claim does not name both a removed and a kept service',
      ],
    ];
    for (const [claim, message] of cases) {
      expect(() => parseClaimRecords(JSON.stringify({ ...base, claims: [claim] }))).toThrow(
        message,
      );
    }
  });
});

describe('replayOf', () => {
  const digests = new Map([
    ['ts0-logistics-1', 'a1b2c3d4e5f60708'],
    ['ts1-logistics-2', 'ffffffffffffffff'],
  ]);

  it('pairs an answer with the question it was asked', () => {
    const replay = replayOf([record()], digests);
    expect(replay.reused).toBe(1);
    expect(replay.byCase.get('ts0-logistics-1')).toEqual([CLAIM]);
    expect(replay.stale).toEqual([]);
    expect(replay.foreignProtocol).toEqual([]);
    expect(replay.unknown).toEqual([]);
    expect(replay.malformed).toBe(0);
  });

  it('refuses an answer whose prompt digest disagrees, instead of scoring a different question', () => {
    const replay = replayOf([record({ digest: '0000000000000000' })], digests);
    expect(replay.reused).toBe(0);
    expect(replay.stale).toEqual(['ts0-logistics-1']);
    expect(replay.byCase.size).toBe(0);
  });

  it('refuses an answer from another protocol version', () => {
    const replay = replayOf([record({ protocol: 0 })], digests);
    expect(replay.reused).toBe(0);
    expect(replay.foreignProtocol).toEqual(['ts0-logistics-1']);
  });

  it('refuses a case the population does not hold', () => {
    const replay = replayOf([record({ datapack: 'somewhere-else' })], digests);
    expect(replay.unknown).toEqual(['somewhere-else']);
    expect(replay.reused).toBe(0);
  });

  it('records an unreadable answer as an abstention rather than as a missing case', () => {
    const replay = replayOf([record({ claims: [], malformed: 'the reply is not JSON' })], digests);
    expect(replay.reused).toBe(1);
    expect(replay.malformed).toBe(1);
    expect(replay.byCase.get('ts0-logistics-1')).toEqual([]);
  });

  it('keeps the three refusals apart, so one number cannot stand for three mistakes', () => {
    const replay = replayOf(
      [
        record(),
        record({ datapack: 'ts1-logistics-2', digest: 'x' }),
        record({ datapack: 'gone' }),
        record({ datapack: 'ts0-logistics-1', protocol: 9 }),
      ],
      digests,
    );
    expect(replay.reused).toBe(1);
    expect(replay.stale).toEqual(['ts1-logistics-2']);
    expect(replay.unknown).toEqual(['gone']);
    expect(replay.foreignProtocol).toEqual(['ts0-logistics-1']);
  });
});
