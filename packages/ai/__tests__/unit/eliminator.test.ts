import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ELIMINATOR_OPTIONS,
  ELIMINATOR_PROTOCOL,
  PROMPTABLE_STATISTICS,
  buildEliminatorPrompt,
  departureOf,
  digestOf,
  parseEliminatorReply,
  shownChannels,
} from '../../src/agent/eliminator.js';
import type { CandidateFingerprint, ChannelFingerprint } from '../../src/agent/hypothesis-space.js';
import { verifyClaim } from '../../src/agent/hypothesis-space.js';

function fired(
  label: string,
  post: number,
  band: readonly [number, number],
  onset?: number,
): ChannelFingerprint {
  return { label, pre: band[0], post, band, rate: 0, ...(onset === undefined ? {} : { onset }) };
}

function quiet(label: string, value: number, band: readonly [number, number]): ChannelFingerprint {
  return { label, pre: value, post: value, band, rate: 0 };
}

const LATENCY: readonly [number, number] = [11, 14.2];

const auth: CandidateFingerprint = {
  service: 'ts-auth-service',
  rank: 0,
  score: 1.4142135623730951,
  channels: [fired('latency_p99', 98.25, LATENCY, 4200), quiet('error', 0, [0, 0])],
};

const order: CandidateFingerprint = {
  service: 'ts-order-service',
  rank: 1,
  score: 0.8,
  channels: [fired('latency_p99', 40, LATENCY, 9000), fired('cpu', 0.9, [0.1, 0.3])],
};

describe('departureOf', () => {
  it('is zero inside the band and measured in band widths outside it', () => {
    expect(departureOf(quiet('cpu', 0.2, [0.1, 0.3]))).toBe(0);
    // 0.3 is the top of the band, width 0.2, and 0.9 is 0.6 above it: three widths.
    expect(departureOf(fired('cpu', 0.9, [0.1, 0.3]))).toBeCloseTo(3, 12);
    expect(departureOf(fired('cpu', -0.1, [0.1, 0.3]))).toBeCloseTo(1, 12);
  });

  it('reads a move off a zero-width band as unbounded, not as a made-up scale', () => {
    // `error` sits at exactly zero in a fault-free window, so its band is the single point [0, 0]. A channel that
    // reports 0.5 there has moved by an unbounded number of widths, and a finite number would be a scale nobody
    // chose — so the departure is infinite, which also makes it sort as the strongest evidence there is.
    expect(departureOf(fired('error', 0.5, [0, 0]))).toBe(Number.POSITIVE_INFINITY);
    expect(departureOf({ label: 'error', pre: 0, post: 0, band: [0, 0], rate: 0 })).toBe(0);
    // An inverted band is a malformed fingerprint rather than a narrow one; it is read the same way.
    expect(departureOf(fired('cpu', 0.9, [0.3, 0.1]))).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads an unmeasurable value as an infinite departure rather than as no evidence', () => {
    expect(departureOf({ label: 'cpu', pre: 0, post: NaN, band: [0, 1], rate: 0 })).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(
      departureOf({ label: 'cpu', pre: 0, post: 2, band: [0, Number.POSITIVE_INFINITY], rate: 0 }),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('shownChannels', () => {
  it('puts out-of-band channels first, then earliest onset, then widest departure', () => {
    const channels = [
      quiet('zeta', 0.2, [0.1, 0.3]),
      fired('late', 0.9, [0.1, 0.3], 9000),
      fired('early', 0.9, [0.1, 0.3], 4200),
      fired('widest', 3.9, [0.1, 0.3], 5000),
      quiet('alpha', 0.2, [0.1, 0.3]),
    ];
    expect(shownChannels(channels, 5).map((channel) => channel.label)).toEqual([
      'early',
      'widest',
      'late',
      'alpha',
      'zeta',
    ]);
  });

  it('orders a pair whose onset ties by departure, in both directions of the comparator', () => {
    // The comparator has to be a total order for the digest to be stable, so every arm of it needs a pair that
    // reaches it: same band, same onset, different departure — handed over twice, in opposite orders.
    const wide = fired('wide', 3.9, [0.1, 0.3], 100);
    const near = fired('near', 0.5, [0.1, 0.3], 100);
    const later = fired('later', 3.9, [0.1, 0.3], 200);
    expect(shownChannels([near, wide, later], 3).map((c) => c.label)).toEqual([
      'wide',
      'near',
      'later',
    ]);
    expect(shownChannels([later, wide, near], 3).map((c) => c.label)).toEqual([
      'wide',
      'near',
      'later',
    ]);
    // The pair as a pair: the widest first when it arrives first, and still first when it arrives second.
    expect(shownChannels([wide, near], 2).map((c) => c.label)).toEqual(['wide', 'near']);
    expect(shownChannels([near, wide], 2).map((c) => c.label)).toEqual(['wide', 'near']);
    // And a pair whose onsets are both absent, which is the arm a corpus of channels that never fired takes.
    const quietLeft = quiet('quiet-left', 0.2, [0.1, 0.3]);
    const quietRight = quiet('quiet-right', 0.2, [0.1, 0.3]);
    expect(shownChannels([quietRight, quietLeft], 2).map((c) => c.label)).toEqual([
      'quiet-left',
      'quiet-right',
    ]);
  });

  it('treats two channels that are identical in every key as equal rather than as ordered', () => {
    // A duplicate label on one candidate is a malformed fingerprint, and the comparator still has to answer: it
    // answers zero, which is the only answer that does not invent a difference the data does not state.
    const twice = [quiet('cpu', 0.2, [0.1, 0.3]), quiet('cpu', 0.2, [0.1, 0.3])];
    expect(shownChannels(twice, 2)).toHaveLength(2);
    expect(shownChannels(twice, 2).map((channel) => channel.label)).toEqual(['cpu', 'cpu']);
  });

  it('prints an unmeasurable value as a name rather than as a broken number', () => {
    // A fingerprint can carry NaN — a channel with no post-injection sample — and `String(NaN)` is `NaN`, which a
    // model reads as a value. The table says `nan` so the row is visibly unquotable.
    const broken: CandidateFingerprint = {
      service: 'ts-x',
      rank: 0,
      score: NaN,
      channels: [{ label: 'cpu', pre: 0, post: NaN, band: [0, 1], rate: NaN }],
    };
    const table = buildEliminatorPrompt('NetworkLoss', [broken]).user;
    expect(table).toContain('score nan');
    expect(table).toContain('| cpu | 0 | nan | [0, 1] | nan | - |');
    expect(table).not.toContain('NaN');
  });

  it('keeps at most the limit, and nothing at all at zero', () => {
    expect(shownChannels(auth.channels, 1).map((channel) => channel.label)).toEqual([
      'latency_p99',
    ]);
    expect(shownChannels(auth.channels, 0)).toEqual([]);
  });

  it('orders two channels that agree on every key by label, so the digest cannot depend on array order', () => {
    const left = quiet('beta', 0.2, [0.1, 0.3]);
    const right = quiet('alpha', 0.2, [0.1, 0.3]);
    expect(shownChannels([left, right], 2).map((c) => c.label)).toEqual(['alpha', 'beta']);
    expect(shownChannels([right, left], 2).map((c) => c.label)).toEqual(['alpha', 'beta']);
  });
});

describe('digestOf', () => {
  it('is 16 hex characters and separates two texts that differ in one character', () => {
    const base = digestOf('the same question');
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(digestOf('the same questions')).not.toBe(base);
    expect(digestOf('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('buildEliminatorPrompt', () => {
  const prompt = buildEliminatorPrompt('HTTPResponseReplaceCode', [auth, order]);

  it('is a pure function of the fingerprint', () => {
    const again = buildEliminatorPrompt('HTTPResponseReplaceCode', [auth, order]);
    expect(again).toEqual(prompt);
    expect(again.digest).toBe(prompt.digest);
  });

  it('states the fault type, the ranks and the presentation width', () => {
    expect(prompt.user).toContain('FAULT TYPE: HTTPResponseReplaceCode');
    expect(prompt.user).toContain('CANDIDATES: 2');
    expect(prompt.user).toContain('### rank 0 — ts-auth-service — score 1.4142135623730951');
    expect(prompt.presented).toBe(2);
    expect(prompt.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('prints every number so that a copy of it round-trips to the same double', () => {
    // The contract the verifier depends on: the value a claim quotes is compared with `===`, so a prompt that
    // rounded would refuse a faithful answer. `String(v)` is the shortest representation that round-trips, and the
    // test reads the table back rather than trusting the formatter.
    const awkward = 0.1 + 0.2;
    const precise: CandidateFingerprint = {
      service: 'ts-pay-service',
      rank: 0,
      score: 1.4142135623730951,
      channels: [
        { label: 'error', pre: 0, post: awkward, band: [0, 0.1], rate: 0.3333333333333333 },
      ],
    };
    const table = buildEliminatorPrompt('NetworkLoss', [precise]).user;
    const row = table.split('\n').find((line) => line.startsWith('| error |'));
    expect(row).toBe(`| error | 0 | ${String(awkward)} | [0, 0.1] | ${String(1 / 3)} | - |`);
    const cells = row!.split('|').map((cell) => cell.trim());
    expect(cells[1]).toBe('error');
    expect(Number(cells[3])).toBe(awkward);
    expect(Number(cells[5])).toBe(1 / 3);
    expect(table).toContain('score 1.4142135623730951');
  });

  it('renders the shape a real row takes, including a channel that never left its band', () => {
    expect(prompt.user).toContain('| latency_p99 | 11 | 98.25 | [11, 14.2] | 0 | 4200 |');
    expect(prompt.user).toContain('| error | 0 | 0 | [0, 0] | 0 | - |');
  });

  it('narrows the window and the channel count without changing the digest contract', () => {
    const narrow = buildEliminatorPrompt('HTTPResponseReplaceCode', [auth, order], {
      maxCandidates: 1,
      maxChannels: 1,
      maxClaims: 0,
    });
    expect(narrow.presented).toBe(1);
    expect(narrow.user).not.toContain('ts-order-service');
    expect(narrow.user).toContain('At most 0 elimination(s).');
    expect(narrow.digest).not.toBe(prompt.digest);
  });

  it('asks for the empty answer when the engine offered no candidate', () => {
    // An empty posterior is a case an agent cannot help with; the protocol says so rather than sending a table with
    // no rows, which a model would answer by inventing one.
    const empty = buildEliminatorPrompt('NetworkLoss', []);
    expect(empty.presented).toBe(0);
    expect(empty.user).toContain('The engine returned no candidate. Reply with {"eliminate":[]}.');
  });

  it('offers post and onset and never the statistic the model would have to compute', () => {
    expect(PROMPTABLE_STATISTICS).toEqual(['post', 'onset']);
    expect(prompt.system).toContain('`statistic` is `post` or `onset`');
    expect(prompt.system).not.toContain('delta');
  });

  it('names the protocol version, which a cached reply is only valid under', () => {
    expect(ELIMINATOR_PROTOCOL).toBe(1);
    expect(DEFAULT_ELIMINATOR_OPTIONS).toEqual({ maxCandidates: 5, maxChannels: 6, maxClaims: 4 });
  });
});

describe('parseEliminatorReply', () => {
  const good = {
    eliminate: [
      {
        remove: 'ts-auth-service',
        keep: 'ts-order-service',
        channel: 'latency_p99',
        statistic: 'post',
        observed: 98.25,
        band: [11, 14.2],
        rate: 0,
      },
    ],
  };

  it('reads a claim and hands it to the verifier unchanged', () => {
    const parsed = parseEliminatorReply(JSON.stringify(good), 4);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.claims).toEqual([
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
    ]);
    expect(verifyClaim(parsed.claims[0]!, [auth, order]).ok).toBe(true);
  });

  it('accepts the empty answer as an answer', () => {
    // "The ranking is right" is a legitimate output, and the arm counts it as one: a refusal to answer and an
    // agreement with the engine are different events, and only one of them is evidence of skill.
    expect(parseEliminatorReply('{"eliminate":[]}', 4)).toEqual({ ok: true, claims: [] });
  });

  it('unwraps a fenced answer but not a fenced essay', () => {
    const fenced = '```json\n' + JSON.stringify(good) + '\n```';
    expect(parseEliminatorReply(fenced, 4).ok).toBe(true);
    expect(parseEliminatorReply('```\n' + JSON.stringify(good), 4).ok).toBe(true);
    expect(parseEliminatorReply('```', 4)).toEqual({ ok: false, why: 'the reply is not JSON' });
  });

  it('refuses anything that is not one JSON object with an eliminate array', () => {
    expect(parseEliminatorReply('   ', 4)).toEqual({ ok: false, why: 'the reply was empty' });
    expect(parseEliminatorReply('The source is ts-auth-service.', 4)).toEqual({
      ok: false,
      why: 'the reply is not JSON',
    });
    expect(parseEliminatorReply('[{"remove":"a"}]', 4)).toEqual({
      ok: false,
      why: 'the reply is not a JSON object',
    });
    expect(parseEliminatorReply('null', 4)).toEqual({
      ok: false,
      why: 'the reply is not a JSON object',
    });
    expect(parseEliminatorReply('{"verdict":"a"}', 4)).toEqual({
      ok: false,
      why: 'the reply has no eliminate array',
    });
  });

  it('refuses a reply that carries more eliminations than the prompt allowed', () => {
    const tooMany = { eliminate: [good.eliminate[0], good.eliminate[0], good.eliminate[0]] };
    expect(parseEliminatorReply(JSON.stringify(tooMany), 2)).toEqual({
      ok: false,
      why: 'the reply carries 3 eliminations against a bound of 2',
    });
  });

  it('refuses a malformed element by name, and refuses the whole reply with it', () => {
    // Applied whole or not at all: a truncated response's surviving claims are the ones the model happened to
    // emit first, and admitting them would make the arm's accuracy a function of `max_tokens`.
    const cases: readonly [unknown, string][] = [
      ['not an object', 'elimination 0 is not an object'],
      [[], 'elimination 0 is not an object'],
      [
        { keep: 'b', channel: 'c', statistic: 'post', observed: 1, band: [0, 1] },
        'elimination 0 does not name both a removed and a kept service',
      ],
      [
        { remove: 'a', channel: 'c', statistic: 'post', observed: 1, band: [0, 1] },
        'elimination 0 does not name both a removed and a kept service',
      ],
      [
        { remove: 'a', keep: 'b', statistic: 'post', observed: 1, band: [0, 1] },
        'elimination 0 does not name a channel',
      ],
      [
        { remove: 'a', keep: 'b', channel: 'c', statistic: 'delta', observed: 1, band: [0, 1] },
        'elimination 0 cites statistic delta, and this prompt offers post or onset',
      ],
      [
        { remove: 'a', keep: 'b', channel: 'c', statistic: 'post', observed: 1, band: [0] },
        'elimination 0 does not carry a two-number band',
      ],
      [
        { remove: 'a', keep: 'b', channel: 'c', statistic: 'post', observed: 1, band: [0, 'x'] },
        'elimination 0 does not carry a two-number band',
      ],
      [
        { remove: 'a', keep: 'b', channel: 'c', statistic: 'post', observed: '1', band: [0, 1] },
        'elimination 0 does not carry a numeric observed value',
      ],
      [
        {
          remove: 'a',
          keep: 'b',
          channel: 'c',
          statistic: 'post',
          observed: 1,
          band: [0, 1],
          rate: 'x',
        },
        'elimination 0 carries a rate that is not a number',
      ],
    ];
    for (const [element, why] of cases) {
      expect(parseEliminatorReply(JSON.stringify({ eliminate: [element] }), 4)).toEqual({
        ok: false,
        why,
      });
    }
  });

  it('counts the position of the element that failed, not the first position', () => {
    const second = { eliminate: [good.eliminate[0], { remove: 'a' }] };
    expect(parseEliminatorReply(JSON.stringify(second), 4)).toEqual({
      ok: false,
      why: 'elimination 1 does not name both a removed and a kept service',
    });
  });

  it('carries no rate when the reply states none, because a claim may assert less', () => {
    const withoutRate = { eliminate: [{ ...good.eliminate[0], rate: undefined }] };
    const parsed = parseEliminatorReply(JSON.stringify(withoutRate), 4);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.claims[0]!.because.rate).toBeUndefined();
    expect('rate' in parsed.claims[0]!.because).toBe(false);
  });
});
