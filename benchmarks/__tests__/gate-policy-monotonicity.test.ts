/**
 * Tests for the gate-policy monotonicity invariant.
 *
 * The shipped arm's five gate policies are ordered by strictness (`none` < `cited` < `cone` < `contrast` < `lag`).
 * Each stricter policy refuses a superset of the overrides the looser one refuses, and a refused override falls back
 * to the engine's prior. On a SEEDED arm — where the prior is both the shown order and the fallback name — that makes
 * three quantities monotone: admitted overrides never increase, refusals never decrease, and resolved Top@1 never
 * decreases. The 2026 paper "Free to Look, Free to Reason" (arXiv:2610.35767) reports the opposite shape for a
 * freely calling agent (more prescribed calls correlate with lower accuracy); this module states the exact invariant
 * our architecture claims, so the two positions can be compared rather than conflated.
 */
import { describe, expect, it } from 'vitest';
import {
  FIRST_POLICY,
  LAST_POLICY,
  POLICY_ORDER,
  adjacentMonotonicity,
  checkMonotonicity,
  formatMonotonicity,
  isMonotone,
} from '../src/gate-policy-monotonicity.js';
import type { GatePolicy, GateReading } from '../src/query-agent.js';

/** Build a GateReading with only the fields the invariant reads; the rest are filled with inert values. */
function reading(
  policy: GatePolicy,
  admitted: number,
  refused: number,
  correctResolved: number,
): GateReading {
  return {
    policy,
    admitted,
    refused,
    repairs: 0,
    breaks: 0,
    precision: null,
    correct: correctResolved,
    retention: null,
    correctResolved,
    resolved: 0,
  };
}

/** The five-policy ladder from the real artifact (gate-replay.md §3), ascending strictness. */
const LADDER: readonly GateReading[] = [
  reading('none', 709, 0, 732),
  reading('cited', 668, 41, 756),
  reading('cone', 326, 383, 951),
  reading('contrast', 70, 639, 1153),
  reading('lag', 36, 673, 1181),
];

describe('POLICY_ORDER', () => {
  it('is the strictness ladder the loop defines', () => {
    expect(POLICY_ORDER).toEqual(['none', 'cited', 'cone', 'contrast', 'lag']);
  });

  it('exposes its endpoints', () => {
    expect(FIRST_POLICY).toBe('none');
    expect(LAST_POLICY).toBe('lag');
  });
});

describe('adjacentMonotonicity', () => {
  it('reports per-step deltas that classify admitted/refused/resolved', () => {
    const steps = adjacentMonotonicity(LADDER);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toEqual({
      from: 'none',
      to: 'cited',
      admittedDelta: -41,
      refusedDelta: 41,
      resolvedDelta: 24,
      admittedOk: true,
      refusedOk: true,
      resolvedOk: true,
    });
  });

  it('uses a conservation identity: admitted decrease equals refused increase', () => {
    for (const step of adjacentMonotonicity(LADDER)) {
      expect(step.admittedDelta + step.refusedDelta).toBe(0);
    }
  });

  it('refuses a ladder with duplicate policies', () => {
    expect(() =>
      adjacentMonotonicity([reading('none', 1, 0, 1), reading('none', 0, 1, 2)]),
    ).toThrow(/duplicate/i);
  });

  it('refuses a ladder in the wrong order (lag before none)', () => {
    expect(() => adjacentMonotonicity([reading('lag', 0, 1, 2), reading('none', 1, 0, 1)])).toThrow(
      /order/i,
    );
  });

  it('refuses an unknown policy name', () => {
    const bogus = { ...reading('none', 1, 0, 1), policy: 'bogus' as GatePolicy };
    expect(() => adjacentMonotonicity([bogus, reading('cited', 0, 1, 2)])).toThrow(/unknown/i);
  });

  it('refuses an empty or single-element ladder', () => {
    expect(() => adjacentMonotonicity([])).toThrow(/at least two/i);
    expect(() => adjacentMonotonicity([reading('none', 1, 0, 1)])).toThrow(/at least two/i);
  });
});

describe('checkMonotonicity', () => {
  it('accepts the real five-policy ladder', () => {
    const result = checkMonotonicity(LADDER);
    expect(result.monotone).toBe(true);
    expect(result.firstViolation).toBeNull();
    expect(result.steps).toHaveLength(4);
  });

  it('accepts a flat ladder (a gate that refuses nothing extra)', () => {
    const flat = [
      reading('none', 10, 0, 100),
      reading('cited', 10, 0, 100),
      reading('cone', 10, 0, 100),
      reading('contrast', 10, 0, 100),
      reading('lag', 10, 0, 100),
    ];
    expect(checkMonotonicity(flat).monotone).toBe(true);
  });

  it('flags the first violated step and stops at it', () => {
    const broken = [
      reading('none', 10, 0, 100),
      reading('cited', 12, 0, 100), // admitted increased -> violation
      reading('cone', 5, 7, 90),
    ];
    const result = checkMonotonicity(broken);
    expect(result.monotone).toBe(false);
    expect(result.firstViolation?.from).toBe('none');
    expect(result.firstViolation?.to).toBe('cited');
  });

  it('flags a resolved-Top@1 decrease (the paper-shaped counter-example)', () => {
    const paperShaped = [
      reading('none', 10, 0, 100),
      reading('cited', 9, 1, 90), // stricter but resolved accuracy DROPS
    ];
    const result = checkMonotonicity(paperShaped);
    expect(result.monotone).toBe(false);
    expect(result.firstViolation?.resolvedOk).toBe(false);
  });

  it('checks a free arm too, carrying the seeded flag for interpretation', () => {
    // The invariant is structural (strictness nesting + fallback), so it holds on a free arm as well. The flag is
    // recorded in the result so the "no incumbent to fall back to" caveat is not lost.
    const free = checkMonotonicity(LADDER, { seeded: false });
    expect(free.monotone).toBe(true);
    expect(free.seeded).toBe(false);
    expect(checkMonotonicity(LADDER).seeded).toBe(true);
  });
});

describe('isMonotone', () => {
  it('is the predicate form of checkMonotonicity', () => {
    expect(isMonotone(LADDER)).toBe(true);
    expect(isMonotone([reading('none', 10, 0, 100), reading('cited', 12, 0, 100)])).toBe(false);
  });
});

describe('formatMonotonicity', () => {
  it('renders a stable, human-readable ledger', () => {
    const text = formatMonotonicity(checkMonotonicity(LADDER));
    expect(text).toContain('none -> cited');
    expect(text).toContain('lag');
    expect(text).toMatch(/MONOTONE/);
  });

  it('renders the violating step when non-monotone', () => {
    const text = formatMonotonicity(
      checkMonotonicity([reading('none', 10, 0, 100), reading('cited', 12, 0, 100)]),
    );
    expect(text).toMatch(/VIOLATION/);
  });

  it('renders negative deltas without a plus sign', () => {
    // A malformed ladder (refusals DECREASE) is still formatable so the violation can be read.
    const text = formatMonotonicity(
      checkMonotonicity([reading('none', 10, 5, 100), reading('cited', 6, 2, 99)]),
    );
    expect(text).toContain('admitted -4');
    expect(text).toContain('refused -3');
    expect(text).toContain('resolved -1');
  });
});
