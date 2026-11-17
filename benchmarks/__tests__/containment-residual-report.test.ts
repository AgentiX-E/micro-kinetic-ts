/**
 * The residual report's parsing and rendering: a typo is refused, and an absent measurement never prints a number.
 *
 * @module benchmarks/__tests__/containment-residual-report.test
 */

import { describe, expect, it } from 'vitest';

import { formatDiscrimination, parseResidualArgs } from '../src/containment-residual-report.js';

/** A census with every counter at zero. */
const EMPTY_CENSUS = {
  gains: 0,
  losses: 0,
  unchanged: 0,
  unanswered: 0,
  ambiguous: 0,
  scoredGains: 0,
  scoredLosses: 0,
} as const;

describe('parseResidualArgs', () => {
  it('reads the three flags', () => {
    expect(
      parseResidualArgs(['--rows', 'r.ndjson', '--per-case', 'p.ndjson', '--output', 'o.json']),
    ).toEqual({ rows: 'r.ndjson', perCase: 'p.ndjson', output: 'o.json' });
  });

  it('defaults the output to the log only', () => {
    expect(parseResidualArgs(['--rows', 'r', '--per-case', 'p']).output).toBe('');
  });

  it('refuses an unknown flag rather than running with an empty join', () => {
    expect(() => parseResidualArgs(['--rows', 'r', '--percase', 'p'])).toThrow(
      /unknown argument: --percase/,
    );
  });

  it('refuses a missing required flag by name', () => {
    expect(() => parseResidualArgs(['--per-case', 'p'])).toThrow(/--rows is required/);
    expect(() => parseResidualArgs(['--rows', 'r'])).toThrow(/--per-case is required/);
  });

  it('refuses a flag whose value is missing', () => {
    expect(() => parseResidualArgs(['--rows'])).toThrow(/unknown argument: --rows/);
  });
});

describe('formatDiscrimination', () => {
  it('prints the census beside the number, not instead of it', () => {
    const lines = formatDiscrimination({
      arm: 'ungated',
      score: 'rho',
      census: { ...EMPTY_CENSUS, gains: 38, losses: 5, scoredGains: 30, scoredLosses: 4 },
      auc: 0.83,
    });
    expect(lines[0]).toContain('gains=38');
    expect(lines[0]).toContain('losses=5');
    expect(lines[0]).toContain('score=rho');
    expect(lines[1]).toContain('scored: gains=30 losses=4');
    expect(lines[2]).toContain('AUC=0.8300');
    expect(lines[2]).toContain('PASS');
  });

  it('marks a measured AUC below the bar as FAIL rather than omitting it', () => {
    const lines = formatDiscrimination({
      arm: 'gated',
      score: 'phi',
      census: { ...EMPTY_CENSUS, gains: 1, losses: 1, scoredGains: 1, scoredLosses: 1 },
      auc: 0.5,
    });
    expect(lines[2]).toContain('score=phi');
    expect(lines[2]).toContain('FAIL');
    expect(lines[2]).toContain('bar=0.8');
  });

  it('never prints a numeric AUC where the population supported none', () => {
    const lines = formatDiscrimination({
      arm: 'gated',
      score: 'rho',
      census: EMPTY_CENSUS,
      auc: null,
      unavailable: 'no labelled inversion had a residual',
    });
    expect(lines[2]).toBe('  arm=gated score=rho AUC=N/A (no labelled inversion had a residual)');
    expect(lines.join('\n')).not.toMatch(/AUC=0/);
  });

  it('falls back to a stated reason when the refusal carries none', () => {
    const lines = formatDiscrimination({
      arm: 'gated',
      score: 'rho',
      census: EMPTY_CENSUS,
      auc: null,
    });
    expect(lines[2]).toContain('population unavailable');
  });
});
