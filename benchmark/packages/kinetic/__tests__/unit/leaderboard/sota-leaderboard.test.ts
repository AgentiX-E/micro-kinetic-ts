/**
 * Unit tests for the SOTA leaderboard module.
 *
 * These tests pin the module's two responsibilities:
 *   1. Data integrity — the canonical table is valid, frozen, and uniquely keyed.
 *   2. Guard enforcement — validation flags range/provenance/duplicate problems,
 *      and the comparison guards make cross-cohort (strawman) comparison throw.
 *
 * @module benchmarks/leaderboard/sota-leaderboard.test
 */

import { describe, expect, it } from 'vitest';

import {
  SOTA_LEADERBOARD_VERSION,
  VALIDATION_CODES,
  createSotaLeaderboard,
  entriesByCohort,
  isOursMeasured,
  isPublished,
  marginTo,
  requireComparable,
  validateLeaderboard,
} from '../../../src/benchmarks/leaderboard/sota-leaderboard.js';

import type {
  LeaderboardEntry,
  LeaderboardTable,
  OursMeasuredProvenance,
  Provenance,
} from '../../../src/benchmarks/leaderboard/sota-leaderboard.js';

// ── Helpers ───────────────────────────────────────────────

const OURS_PROV: Provenance = {
  kind: 'ours-measured',
  commit: '80709c2',
  harness: 'rcaeval-loader',
};
const PUB_PROV: Provenance = { kind: 'published', source: 'Test Source', arxivId: '9999.00000' };

/** Build a minimal valid entry, overriding any field. */
function makeEntry(overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    method: 'TestMethod',
    paradigm: 'deterministic-causal',
    result: 0.5,
    cohort: 'rcaeval-full',
    metric: 'Top-1',
    provenance: OURS_PROV,
    ...overrides,
  };
}

/** Build a single-entry table for focused validation tests. */
function makeTable(entry: LeaderboardEntry): LeaderboardTable {
  return {
    version: SOTA_LEADERBOARD_VERSION,
    generatedAt: '2026-09-08T00:00:00.000Z',
    entries: [entry],
  };
}

// ── Type guards ───────────────────────────────────────────

describe('type guards', () => {
  it('narrows ours-measured provenance', () => {
    expect(isOursMeasured(OURS_PROV)).toBe(true);
    expect(isPublished(OURS_PROV)).toBe(false);
  });

  it('narrows published provenance', () => {
    expect(isPublished(PUB_PROV)).toBe(true);
    expect(isOursMeasured(PUB_PROV)).toBe(false);
  });
});

// ── createSotaLeaderboard ─────────────────────────────────

describe('createSotaLeaderboard', () => {
  const table = createSotaLeaderboard('2026-09-08T00:00:00.000Z');

  it('sets version and generation timestamp', () => {
    expect(table.version).toBe(SOTA_LEADERBOARD_VERSION);
    expect(table.generatedAt).toBe('2026-09-08T00:00:00.000Z');
  });

  it('produces a frozen table and frozen entries array', () => {
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.entries)).toBe(true);
  });

  it('contains the canonical 18 cells', () => {
    expect(table.entries).toHaveLength(18);
  });

  it('is valid: no errors, only the two venue-only warnings', () => {
    const report = validateLeaderboard(table);
    expect(report.valid).toBe(true);
    expect(report.issues).toHaveLength(2);
    for (const issue of report.issues) {
      expect(issue.code).toBe(VALIDATION_CODES.missingCitationId);
      expect(issue.severity).toBe('warning');
    }
  });

  it('records our two measured cells with the reproducing commit', () => {
    const ours = table.entries.filter(
      (e): e is LeaderboardEntry & { readonly provenance: OursMeasuredProvenance } =>
        isOursMeasured(e.provenance),
    );
    expect(ours).toHaveLength(2);
    for (const entry of ours) {
      expect(entry.provenance.commit).toBe('80709c2');
    }
  });
});

// ── validateLeaderboard — integrity rules ─────────────────

describe('validateLeaderboard', () => {
  it('accepts an empty table as valid', () => {
    const report = validateLeaderboard({
      version: SOTA_LEADERBOARD_VERSION,
      generatedAt: '2026-09-08T00:00:00.000Z',
      entries: [],
    });
    expect(report.valid).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('flags a result below zero', () => {
    const report = validateLeaderboard(makeTable(makeEntry({ result: -0.1 })));
    expect(report.valid).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]!.code).toBe(VALIDATION_CODES.resultOutOfRange);
    expect(report.issues[0]!.severity).toBe('error');
  });

  it('flags a result above one', () => {
    const report = validateLeaderboard(makeTable(makeEntry({ result: 1.1 })));
    expect(report.valid).toBe(false);
    expect(report.issues[0]!.code).toBe(VALIDATION_CODES.resultOutOfRange);
  });

  it('warns (not errors) on a zero result', () => {
    const report = validateLeaderboard(makeTable(makeEntry({ result: 0 })));
    expect(report.valid).toBe(true);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]!.code).toBe(VALIDATION_CODES.zeroResult);
    expect(report.issues[0]!.severity).toBe('warning');
  });

  it('flags an empty method name', () => {
    const report = validateLeaderboard(makeTable(makeEntry({ method: '   ' })));
    expect(report.valid).toBe(false);
    expect(report.issues[0]!.code).toBe(VALIDATION_CODES.emptyMethod);
  });

  it('flags an ours-measured entry with a blank commit', () => {
    const badProv: Provenance = { kind: 'ours-measured', commit: '', harness: 'rcaeval-loader' };
    const report = validateLeaderboard(makeTable(makeEntry({ provenance: badProv })));
    expect(report.valid).toBe(false);
    expect(report.issues[0]!.code).toBe(VALIDATION_CODES.missingCommit);
  });

  it('flags a published entry with a blank source', () => {
    const badProv: Provenance = { kind: 'published', source: '  ', arxivId: '9999.00000' };
    const report = validateLeaderboard(makeTable(makeEntry({ provenance: badProv })));
    expect(report.valid).toBe(false);
    expect(report.issues[0]!.code).toBe(VALIDATION_CODES.missingSource);
  });

  it('warns on a published entry with no arXiv id and no DOI', () => {
    const badProv: Provenance = { kind: 'published', source: 'Venue Only' };
    const report = validateLeaderboard(makeTable(makeEntry({ provenance: badProv })));
    expect(report.valid).toBe(true);
    expect(report.issues[0]!.code).toBe(VALIDATION_CODES.missingCitationId);
    expect(report.issues[0]!.severity).toBe('warning');
  });

  it('flags a duplicate cell (same key)', () => {
    const table: LeaderboardTable = {
      version: SOTA_LEADERBOARD_VERSION,
      generatedAt: '2026-09-08T00:00:00.000Z',
      entries: [makeEntry(), makeEntry()],
    };
    const report = validateLeaderboard(table);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === VALIDATION_CODES.duplicateEntry)).toBe(true);
  });

  it('does not treat same method in different cohorts as duplicate', () => {
    const table: LeaderboardTable = {
      version: SOTA_LEADERBOARD_VERSION,
      generatedAt: '2026-09-08T00:00:00.000Z',
      entries: [makeEntry({ cohort: 'rcaeval-full' }), makeEntry({ cohort: 'rcaeval-re2-ob' })],
    };
    const report = validateLeaderboard(table);
    expect(report.valid).toBe(true);
  });

  it('orders errors before warnings', () => {
    const table: LeaderboardTable = {
      version: SOTA_LEADERBOARD_VERSION,
      generatedAt: '2026-09-08T00:00:00.000Z',
      entries: [
        makeEntry({ method: 'ZeroMethod', result: 0 }),
        makeEntry({ method: 'HugeMethod', result: 2 }),
      ],
    };
    const report = validateLeaderboard(table);
    expect(report.issues[0]!.severity).toBe('error');
    expect(report.issues[1]!.severity).toBe('warning');
  });
});

// ── entriesByCohort ───────────────────────────────────────

describe('entriesByCohort', () => {
  const table = createSotaLeaderboard('2026-09-08T00:00:00.000Z');

  it('filters to a single cohort', () => {
    const full = entriesByCohort(table, 'rcaeval-full');
    expect(full.length).toBeGreaterThan(0);
    for (const entry of full) expect(entry.cohort).toBe('rcaeval-full');
  });

  it('narrows by cohort and metric', () => {
    const result = entriesByCohort(table, 'rcaeval-full', 'Top-1');
    for (const entry of result) {
      expect(entry.cohort).toBe('rcaeval-full');
      expect(entry.metric).toBe('Top-1');
    }
  });

  it('returns an empty array for an unmatched cohort', () => {
    expect(entriesByCohort(table, 'rcaeval-single-system', 'MRR@1')).toHaveLength(0);
  });
});

// ── requireComparable ─────────────────────────────────────

describe('requireComparable', () => {
  const a = makeEntry({ method: 'A', cohort: 'rcaeval-full', metric: 'Top-1' });
  const b = makeEntry({ method: 'B', cohort: 'rcaeval-full', metric: 'Top-1' });

  it('does not throw for same cohort, metric, and system', () => {
    expect(() => requireComparable(a, b)).not.toThrow();
  });

  it('throws for a cohort mismatch', () => {
    const other = makeEntry({ cohort: 'rcaeval-re2-ob' });
    expect(() => requireComparable(a, other)).toThrow(/different cohorts/);
  });

  it('throws for a metric mismatch', () => {
    const other = makeEntry({ metric: 'AC@1' });
    expect(() => requireComparable(a, other)).toThrow(/different metrics/);
  });

  it('throws for a system mismatch', () => {
    const withSystem = makeEntry({ system: 'SockShop' });
    const otherSystem = makeEntry({ system: 'TrainTicket' });
    expect(() => requireComparable(withSystem, otherSystem)).toThrow(/different systems/);
  });

  it('throws when one entry has no system and the other does', () => {
    const noSystem = makeEntry();
    const withSystem = makeEntry({ system: 'SockShop' });
    expect(() => requireComparable(noSystem, withSystem)).toThrow(/different systems/);
    expect(() => requireComparable(withSystem, noSystem)).toThrow(/different systems/);
  });
});

// ── marginTo ──────────────────────────────────────────────

describe('marginTo', () => {
  it('computes the corrected ~1.14x margin over PRISM', () => {
    const table = createSotaLeaderboard('2026-09-08T00:00:00.000Z');
    const ours = table.entries.find(
      (e) => e.method === 'Micro-Kinetic' && e.cohort === 'rcaeval-full',
    )!;
    const prism = table.entries.find((e) => e.method === 'PRISM')!;
    const margin = marginTo(ours, prism);
    expect(margin.ratio).toBeCloseTo(0.774 / 0.68, 5);
    expect(margin.ppGap).toBeCloseTo(9.4, 5);
  });

  it('throws on a cross-cohort comparison (the strawman)', () => {
    const table = createSotaLeaderboard('2026-09-08T00:00:00.000Z');
    const ours = table.entries.find(
      (e) => e.method === 'Micro-Kinetic' && e.cohort === 'rcaeval-full',
    )!;
    const gala = table.entries.find((e) => e.method === 'GALA')!;
    expect(() => marginTo(ours, gala)).toThrow(/different cohorts/);
  });

  it('throws when the denominator is zero', () => {
    const a = makeEntry({ method: 'A', result: 0.5 });
    const zero = makeEntry({ method: 'Zero', result: 0 });
    expect(() => marginTo(a, zero)).toThrow(/zero result/);
  });
});
