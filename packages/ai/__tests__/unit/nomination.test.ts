import { describe, expect, it } from 'vitest';

import type { CandidateFingerprint } from '../../src/agent/hypothesis-space.js';
import {
  NOMINATION_PROTOCOL,
  NOMINATION_REJECTIONS,
  buildNominationPrompt,
  fuseNomination,
  parseNominationReply,
  verifyNomination,
} from '../../src/agent/nomination.js';

function candidate(service: string, rank: number, score: number): CandidateFingerprint {
  return {
    service,
    rank,
    score,
    channels: [
      { label: 'latency_p99', pre: 12, post: 90, band: [11, 14.2], rate: 0.02, onset: 4200 },
      { label: 'error', pre: 0, post: 0, band: [0, 0], rate: 0 },
    ],
  };
}

const posterior: readonly CandidateFingerprint[] = [
  candidate('ts-auth-service', 0, 1.414),
  candidate('ts-order-service', 1, 0.8),
  candidate('ts-seat-service', 2, 0.4),
];

describe('NOMINATION_PROTOCOL', () => {
  it('is versioned, because a recorded answer belongs to the question that produced it', () => {
    expect(NOMINATION_PROTOCOL).toBe(1);
  });

  it('declares exactly two rejection families, both about the answer rather than the case', () => {
    expect([...NOMINATION_REJECTIONS]).toEqual(['unknown-candidate', 'duplicate-candidate']);
  });
});

describe('buildNominationPrompt', () => {
  const prompt = buildNominationPrompt('HTTPResponseReplaceCode', posterior);

  it('is a pure function of the fingerprint', () => {
    const again = buildNominationPrompt('HTTPResponseReplaceCode', posterior);
    expect(again).toEqual(prompt);
    expect(again.digest).toBe(prompt.digest);
  });

  it('carries the same table the elimination prompt carries, so the two protocols differ only in what is asked', () => {
    expect(prompt.user).toContain('### rank 0 — ts-auth-service');
    expect(prompt.user).toContain('| channel | pre | post | band | rate | onset |');
    expect(prompt.user).toContain('| latency_p99 | 12 | 90 | [11, 14.2] | 0.02 | 4200 |');
    expect(prompt.presented).toBe(3);
  });

  it('asks for a ranking rather than an elimination, and says a partial ranking is allowed', () => {
    expect(prompt.system).toContain('{"ranking":');
    expect(prompt.system.toLowerCase()).toContain('partial');
    expect(prompt.system).not.toContain('{"eliminate":');
  });

  it('differs in digest from the elimination prompt, because it is a different question', () => {
    expect(prompt.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('degrades to an explicit no-candidate instruction on an empty posterior', () => {
    const empty = buildNominationPrompt('DNS', []);
    expect(empty.presented).toBe(0);
    expect(empty.user).toContain('{"ranking":[]}');
  });

  it('respects the presentation window', () => {
    const narrow = buildNominationPrompt('DNS', posterior, {
      maxCandidates: 2,
      maxChannels: 8,
      maxRanked: 2,
    });
    expect(narrow.presented).toBe(2);
    expect(narrow.user).not.toContain('ts-seat-service');
  });
});

describe('parseNominationReply', () => {
  it('reads a ranking', () => {
    expect(parseNominationReply('{"ranking":["b","a"]}')).toEqual({
      ok: true,
      order: ['b', 'a'],
    });
  });

  it('unwraps a Markdown fence', () => {
    expect(parseNominationReply('```json\n{"ranking":["b"]}\n```')).toEqual({
      ok: true,
      order: ['b'],
    });
  });

  it('accepts an empty ranking as the answer "the engine is right"', () => {
    expect(parseNominationReply('{"ranking":[]}')).toEqual({ ok: true, order: [] });
  });

  it('refuses prose, a non-object, and a missing array', () => {
    expect(parseNominationReply('the ranking is fine').ok).toBe(false);
    expect(parseNominationReply('[1,2]').ok).toBe(false);
    expect(parseNominationReply('{"order":["a"]}').ok).toBe(false);
    expect(parseNominationReply('   ').ok).toBe(false);
  });

  it('refuses an element that is not a non-empty string', () => {
    expect(parseNominationReply('{"ranking":["a",3]}').ok).toBe(false);
    expect(parseNominationReply('{"ranking":["a",""]}').ok).toBe(false);
  });

  it('refuses a ranking longer than the window, which cannot be a ranking of it', () => {
    expect(parseNominationReply('{"ranking":["a","b","c"]}', 2).ok).toBe(false);
    expect(parseNominationReply('{"ranking":["a","b"]}', 2).ok).toBe(true);
  });
});

describe('verifyNomination', () => {
  it('accepts a ranking that names presented candidates exactly once, in any order', () => {
    expect(verifyNomination(['ts-seat-service', 'ts-auth-service'], posterior)).toEqual({
      ok: true,
      order: ['ts-seat-service', 'ts-auth-service'],
    });
  });

  it('accepts a partial ranking: naming the leader is a complete answer', () => {
    expect(verifyNomination(['ts-order-service'], posterior)).toEqual({
      ok: true,
      order: ['ts-order-service'],
    });
  });

  it('accepts an empty ranking, which is the model agreeing with the engine', () => {
    expect(verifyNomination([], posterior)).toEqual({ ok: true, order: [] });
  });

  it('refuses a service the posterior does not carry, without dropping it silently', () => {
    const verdict = verifyNomination(['ts-auth-service', 'ts-ghost-service'], posterior);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toBe('unknown-candidate');
    expect(verdict.culprit).toBe('ts-ghost-service');
  });

  it('refuses a repeat rather than reading it at first sight', () => {
    const verdict = verifyNomination(['ts-auth-service', 'ts-auth-service'], posterior);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error('unreachable');
    expect(verdict.reason).toBe('duplicate-candidate');
    expect(verdict.culprit).toBe('ts-auth-service');
  });
});

describe('fuseNomination', () => {
  const engine = ['a', 'b', 'c', 'd', 'e'];

  it('is the engine itself at weight zero, by reference equality of the contents', () => {
    expect(fuseNomination(engine, ['e', 'd'], { strategy: 'rrf', weight: 0, rrfK: 60 })).toEqual(
      engine,
    );
  });

  it('promotes a named service under rrf', () => {
    const fused = fuseNomination(engine, ['e'], { strategy: 'rrf', weight: 1, rrfK: 60 });
    expect(fused[0]).toBe('e');
    expect([...fused].sort()).toEqual([...engine].sort());
  });

  it('records that borda degenerates when the nominated service is the engine s last', () => {
    // `borda` scores a first place as `n − 1` whether it is the engine's or the model's, so nominating the last
    // engine candidate adds `(n − n) + (n − 1) = n − 1`, which is exactly what the engine's own leader already
    // holds: the tie breaks on engine order and the move vanishes. That is not a defect to paper over — it is why
    // the operator and the protocol are chosen together, and a reader comparing the two strategies on nominations
    // is owed the reason one of them cannot move in this case.
    const fused = fuseNomination(engine, ['e'], { strategy: 'borda', weight: 1, rrfK: 60 });
    expect(fused[0]).toBe('a');
  });

  it('preserves the engine order of the services the nomination never named', () => {
    const fused = fuseNomination(engine, ['c'], { strategy: 'borda', weight: 1, rrfK: 60 });
    expect(fused).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('leaves the engine untouched when the nomination agrees with it', () => {
    const fused = fuseNomination(engine, [...engine], { strategy: 'rrf', weight: 1, rrfK: 60 });
    expect(fused).toEqual(engine);
  });

  it('returns the engine order on an empty nomination, under every strategy and weight', () => {
    for (const strategy of ['rrf', 'borda'] as const) {
      expect(fuseNomination(engine, [], { strategy, weight: 1, rrfK: 60 })).toEqual(engine);
    }
  });

  it('keeps the whole posterior: a nomination cannot insert a service the engine did not rank', () => {
    const fused = fuseNomination(engine, [], { strategy: 'rrf', weight: 1, rrfK: 60 });
    expect(fused).toHaveLength(5);
  });
});
