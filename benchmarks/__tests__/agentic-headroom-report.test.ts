import { describe, expect, it } from 'vitest';

import {
  CLAIM_REJECTIONS,
  GATE_TRIPS,
  SKIP_REASONS,
  type ClaimRejection,
  type SkipReason,
} from '../../packages/ai/src/agent/index.js';

import {
  formatArmTable,
  formatRefusals,
  formatSkipCensus,
  formatSweep,
} from '../src/agentic-headroom-report.js';
import type { ArmOutcome, SweepPoint } from '../src/agentic-headroom.js';

/** An outcome with every tally at zero, so each test states only the field it is about. */
function outcome(overrides: Partial<ArmOutcome> = {}): ArmOutcome {
  const refused = Object.fromEntries(CLAIM_REJECTIONS.map((reason) => [reason, 0])) as Record<
    ClaimRejection,
    number
  >;
  const skipped = Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<
    SkipReason,
    number
  >;
  const gateTrips = Object.fromEntries(GATE_TRIPS.map((gate) => [gate, 0])) as Record<
    string,
    number
  >;
  return {
    arm: 'engine',
    weight: 0,
    cases: 4,
    correct: 1,
    top1: 0.25,
    moved: 0,
    claims: 0,
    refused,
    abstained: 0,
    skipped,
    truthAbsent: 0,
    reachable: 0,
    gateTrips,
    ...overrides,
  };
}

describe('formatArmTable', () => {
  it('prints a header and one row per arm, with the rate at one decimal', () => {
    const table = formatArmTable([
      outcome(),
      outcome({ arm: 'oracle', weight: 1, correct: 3, top1: 0.75 }),
    ]);
    const lines = table.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('arm');
    expect(lines[0]).toContain('top1');
    expect(lines[1]).toContain('engine');
    expect(lines[1]).toContain('25.0%');
    expect(lines[2]).toContain('oracle');
    expect(lines[2]).toContain('75.0%');
  });

  it('prints the ceiling columns, so a rate cannot be read without the population that bounded it', () => {
    const table = formatArmTable([
      outcome({ cases: 10, correct: 2, truthAbsent: 3, reachable: 5 }),
    ]);
    const row = table.split('\n')[1]!;
    // `absent` is 3 and `reach` is 5: the arm cannot exceed 70 % however good it is, and 70 % is what the two
    // numbers say without a second table.
    expect(row).toContain('10');
    expect(row.trimEnd().endsWith('5')).toBe(true);
  });
});

describe('formatRefusals', () => {
  it('says so when the verifier accepted every claim', () => {
    expect(formatRefusals(outcome())).toBe('no refusals');
  });

  it('names only the reasons that fired, because nine zeroes would bury the two that matter', () => {
    const refused = outcome().refused as Record<ClaimRejection, number>;
    refused['unsupported-statistic'] = 2;
    refused['band-disagrees-with-fingerprint'] = 1;
    expect(formatRefusals(outcome({ refused }))).toBe(
      'unsupported-statistic=2, band-disagrees-with-fingerprint=1',
    );
  });
});

describe('formatSkipCensus', () => {
  it('prints the three buckets the rule partitions the corpus into', () => {
    const skipped = outcome().skipped as Record<SkipReason, number>;
    skipped.margin = 7;
    skipped.evidence = 2;
    skipped.none = 11;
    expect(formatSkipCensus(outcome({ skipped }))).toBe('skip: margin=7 evidence=2 consulted=11');
  });
});

describe('formatSweep', () => {
  it('marks the point the caller carries forward and leaves the others unmarked', () => {
    const points: SweepPoint[] = [
      { rateFloor: 0, margin: 0, outcome: outcome({ top1: 0.5 }) },
      { rateFloor: 0.5, margin: 0, outcome: outcome({ top1: 0.25 }) },
    ];
    const lines = formatSweep(points, points[0]).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('floor');
    expect(lines[1]).toContain('0.00');
    expect(lines[1]).toContain('<-');
    expect(lines[2]).not.toContain('<-');
  });

  it('marks nothing when no point is carried forward', () => {
    const lines = formatSweep([{ rateFloor: 0, margin: 0, outcome: outcome() }]).split('\n');
    expect(lines[1]).not.toContain('<-');
  });
});
