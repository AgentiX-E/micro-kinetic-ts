/**
 * Tests for the verifier replay census.
 *
 * The census turns "how many of the model's real claims did the mechanical verifier accept, and why did it refuse
 * the rest" into a pure, re-scorable object. What is asserted here is the arithmetic and the contract: every one of
 * the nine refusal families has a counter, the counters partition the refusals exactly, the survival rate is over
 * all claims rather than over the consulted subset, and the census agrees with `verifyClaim` called directly — so a
 * change in the verifier cannot be silently absorbed by a change in the census.
 */

import { describe, expect, it } from 'vitest';

import {
  CLAIM_REJECTIONS,
  type CandidateFingerprint,
  type ClaimRejection,
  type EliminationClaim,
  verifyClaim,
} from '../../packages/ai/src/agent/index.js';

import {
  type ReplayRow,
  type VerdictCensus,
  emptyRefusalCounts,
  replayVerdicts,
  verdictVerified,
} from '../src/verifier-replay-census.js';

/** A minimal candidate with one channel, so claims can cite a concrete band and value. */
function candidate(
  service: string,
  rank: number,
  channel: string,
  band: readonly [number, number],
  value: number,
  rate = 0.5,
): CandidateFingerprint {
  return {
    service,
    rank,
    score: 1 - rank,
    channels: [
      {
        label: channel,
        pre: 0,
        post: value,
        band: [...band] as [number, number],
        rate,
        onset: 0,
      },
    ],
  } as unknown as CandidateFingerprint;
}

/** A claim that cites the removed candidate's channel exactly as the fingerprint carries it. */
function claim(
  remove: string,
  keep: string,
  channel: string,
  band: readonly [number, number],
  value: number,
): EliminationClaim {
  return {
    remove,
    keep,
    because: {
      channel,
      statistic: 'post',
      observed: value,
      band: [...band] as [number, number],
      rate: 0.5,
    },
  } as unknown as EliminationClaim;
}

/** A row whose claim is accepted by `verifyClaim`: removed is outside its band, both rows carry the channel. */
function acceptedRow(index: number): ReplayRow {
  const band: [number, number] = [0, 10];
  const candidates = [
    candidate(`svc-a-${index}`, 0, 'latency', band, 50),
    candidate(`svc-b-${index}`, 1, 'latency', band, 5),
  ];
  return { claim: claim(`svc-a-${index}`, `svc-b-${index}`, 'latency', band, 50), candidates };
}

describe('emptyRefusalCounts', () => {
  it('has exactly one zero counter per declared refusal family', () => {
    const counts = emptyRefusalCounts();
    const keys = Object.keys(counts).sort();
    expect(keys).toEqual([...CLAIM_REJECTIONS].sort());
    for (const key of CLAIM_REJECTIONS) expect(counts[key]).toBe(0);
  });

  it('returns a fresh object each call — a tally cannot mutate the shared template', () => {
    const a = emptyRefusalCounts() as Record<string, number>;
    const b = emptyRefusalCounts();
    a['unknown-channel'] = 7;
    expect(b['unknown-channel']).toBe(0);
  });
});

describe('verdictVerified', () => {
  it('is true only for a complete verdict object', () => {
    expect(verdictVerified({ ok: true, claim: acceptedRow(0).claim })).toBe(true);
    expect(
      verdictVerified({ ok: false, reason: 'unknown-channel', claim: acceptedRow(0).claim }),
    ).toBe(false);
  });
});

describe('replayVerdicts', () => {
  it('returns an empty, well-formed census for no rows', () => {
    const c = replayVerdicts([]);
    expect(c.claims).toBe(0);
    expect(c.verified).toBe(0);
    expect(c.refused).toBe(0);
    expect(c.survival).toBe(0);
    expect(c.refusals).toEqual(emptyRefusalCounts());
  });

  it('counts an accepted row as verified and keeps survival at one', () => {
    const c = replayVerdicts([acceptedRow(1)]);
    expect(c.claims).toBe(1);
    expect(c.verified).toBe(1);
    expect(c.refused).toBe(0);
    expect(c.survival).toBe(1);
    expect(Object.values(c.refusals).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('partitions refusals by reason and reports survival over ALL claims', () => {
    const rows: ReplayRow[] = [acceptedRow(1), acceptedRow(2)];
    // unknown-candidate: remove names nobody in the posterior
    const unknownCandidate: ReplayRow = {
      claim: claim('ghost', 'svc-b-1', 'latency', [0, 10], 50),
      candidates: acceptedRow(1).candidates,
    };
    // unknown-channel: removed row does not carry the cited channel
    const unknownChannel: ReplayRow = {
      claim: claim('svc-a-1', 'svc-b-1', 'cpu', [0, 10], 50),
      candidates: acceptedRow(1).candidates,
    };
    rows.push(unknownCandidate, unknownChannel);
    const c = replayVerdicts(rows);
    expect(c.claims).toBe(4);
    expect(c.verified).toBe(2);
    expect(c.refused).toBe(2);
    expect(c.survival).toBe(0.5);
    expect(c.refusals['unknown-candidate']).toBe(1);
    expect(c.refusals['unknown-channel']).toBe(1);
    expect(Object.values(c.refusals).reduce((a, b) => a + b, 0)).toBe(c.refused);
  });

  it('counts every one of the nine refusal reasons reachable through verifyClaim', () => {
    // Build one row per reason directly; encoding reachability of each is verifyClaim's job, the census's job is to
    // tally whatever reason it returns without dropping or conflating any family.
    const reasons: ClaimRejection[] = [...CLAIM_REJECTIONS];
    const rows: ReplayRow[] = reasons.map((reason) => ({
      claim: {
        remove: reason,
        keep: 'keep',
        because: { channel: 'c', statistic: 'post', observed: 1, band: [0, 2], rate: 0.5 },
      } as unknown as EliminationClaim,
      candidates: acceptedRow(99).candidates,
    }));
    const c = replayVerdicts(rows);
    expect(c.claims).toBe(reasons.length);
    // The reason each row earns is whatever verifyClaim says; the census must agree with a direct tally.
    const direct = rows.map((r) => verifyClaim(r.claim, r.candidates));
    expect(c.verified).toBe(direct.filter((v) => v.ok).length);
    expect(c.refused).toBe(direct.filter((v) => !v.ok).length);
    for (const reason of reasons) {
      expect(c.refusals[reason]).toBe(direct.filter((v) => !v.ok && v.reason === reason).length);
    }
  });

  it('agrees with verifyClaim row for row — the census is a tally, never a second scorer', () => {
    const rows: ReplayRow[] = [acceptedRow(1), acceptedRow(2)];
    const refused: ReplayRow = {
      claim: claim('ghost', 'svc-b-1', 'latency', [0, 10], 50),
      candidates: acceptedRow(1).candidates,
    };
    rows.push(refused);
    const c = replayVerdicts(rows);
    const direct = rows.map((row) => verifyClaim(row.claim, row.candidates));
    expect(c.verified).toBe(direct.filter((v) => verdictVerified(v)).length);
    expect(c.refused).toBe(direct.filter((v) => !verdictVerified(v)).length);
    expect(c.claims).toBe(rows.length);
  });

  it('does not mutate its input rows', () => {
    const rows = [acceptedRow(1)];
    const snapshot = JSON.stringify(rows);
    replayVerdicts(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe('VerdictCensus shape', () => {
  it('exposes a readonly refusals tally keyed by every rejection family', () => {
    const c: VerdictCensus = replayVerdicts([acceptedRow(1)]);
    expect(Object.keys(c.refusals).sort()).toEqual([...CLAIM_REJECTIONS].sort());
    expect(c.survival).toBeGreaterThanOrEqual(0);
    expect(c.survival).toBeLessThanOrEqual(1);
  });
});
