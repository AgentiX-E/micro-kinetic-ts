/**
 * The gate report's pure half: the flags a dispatch may pass and the lines it reads back.
 *
 * @module benchmarks/__tests__/containment-gate-report
 */

import { describe, expect, it } from 'vitest';

import { formatGateReading, parseGateArgs } from '../src/containment-gate-report.js';
import type { GateReading } from '../src/containment-gate.js';

const READING: GateReading = {
  cases: 1_422,
  replayable: 1_422,
  scored: 1_400,
  disagreements: 0,
  priors: [
    {
      fittedOn: 'b',
      appliesTo: 'a',
      prior: { residuals: new Map(), threshold: 0 },
      score: 'rho',
      edges: 32,
      fitted: 9,
      admitted: 8,
      observations: 404,
      unfitted: 23,
    },
    {
      fittedOn: 'a',
      appliesTo: 'b',
      prior: { residuals: new Map(), threshold: 0 },
      score: 'rho',
      edges: 31,
      fitted: 8,
      admitted: 7,
      observations: 405,
      unfitted: 23,
    },
  ],
  arms: {
    fusion: { top1: 1_100, gains: 0, losses: 0 },
    shipped: { top1: 1_140, gains: 40, losses: 0 },
    prior: { top1: 1_112, gains: 14, losses: 2 },
  },
  decisions: {
    inverted: 20,
    'record-silent': 0,
    'no-failed-interface': 0,
    unmeasured: 100,
    'not-larger': 300,
    'prior-absent': 5,
    'prior-below': 7,
  },
  blocked: { absent: 5, below: 7 },
};

describe('parseGateArgs', () => {
  it('reads the two required paths and defaults the rest', () => {
    const opts = parseGateArgs(['--rows', 'r.ndjson', '--per-case', 'p.ndjson']);
    expect(opts).toEqual({ rows: 'r.ndjson', perCase: 'p.ndjson', score: 'rho', output: '' });
  });

  it('reads the statistic it is asked for', () => {
    expect(
      parseGateArgs(['--rows', 'r', '--per-case', 'p', '--score', 'phi', '--output', 'o.json']),
    ).toEqual({ rows: 'r', perCase: 'p', score: 'phi', output: 'o.json' });
  });

  it('refuses a statistic it does not have, rather than defaulting to the pre-registered one', () => {
    // A dispatch that misspelled `phi` would otherwise read ρ twice and report the second reading as agreement
    // between two statistics.
    expect(() => parseGateArgs(['--rows', 'r', '--per-case', 'p', '--score', 'phii'])).toThrow(
      /--score must be rho or phi/,
    );
  });

  it('refuses an unknown flag rather than running with a default', () => {
    expect(() => parseGateArgs(['--rows', 'r', '--percase', 'p'])).toThrow(/unknown argument/);
  });

  it('requires both paths', () => {
    expect(() => parseGateArgs(['--per-case', 'p'])).toThrow(/--rows is required/);
    expect(() => parseGateArgs(['--rows', 'r'])).toThrow(/--per-case is required/);
  });
});

describe('formatGateReading', () => {
  const lines = formatGateReading(READING);

  it('starts with the instrument s own census, before any arm', () => {
    expect(lines[0]).toBe('  rows=1422 replayable=1422 scored=1400 disagreements=0');
  });

  it('prints one line per prior, with the half it came from and the half it may speak about', () => {
    expect(lines[1]).toMatch(/prior fitted-on=b applies-to=a score=rho/);
    expect(lines[2]).toMatch(/prior fitted-on=a applies-to=b score=rho/);
    expect(lines[1]).toMatch(/edges=32 fitted=9 admitted=8 unfitted=23 observations=404/);
  });

  it('prints the reconstruction before the arms it licenses', () => {
    // The shipped row is the instrument check: if the replay does not reproduce the corpus's published number,
    // the row under it describes a walk the run never took.
    expect(lines[3]).toBe('  arm=fusion top1=1100/1400');
    expect(lines[4]).toBe('  arm=shipped top1=1140/1400 +40/-0');
    expect(lines[5]).toBe('  arm=prior top1=1112/1400 +14/-2');
  });

  it('gives the baseline no movement of its own', () => {
    // It IS the origin: a `+0/-0` beside the other two rows would read as a third arm that achieved nothing.
    expect(lines[3]).not.toMatch(/\+0\/-0/);
  });

  it('carries the denominator on every arm, so a share can never be read as a count', () => {
    for (const line of lines.slice(3, 6)) expect(line).toMatch(/top1=\d+\/1400/);
  });

  it('prints the gated walks own census, including both refusal reasons', () => {
    expect(lines[6]).toBe(
      '  gate decisions: inverted=20 prior-absent=5 prior-below=7 not-larger=300 unmeasured=100',
    );
  });

  it('prints the criterion beside the numbers it judges', () => {
    expect(lines[7]).toBe('  criterion: gains>=15 losses<=0 top1>1156');
  });

  it('prints a different criterion when one is supplied', () => {
    const other = formatGateReading(READING, { gains: 3, losses: 1, shippedTop1: 900 });
    expect(other.at(-1)).toBe('  criterion: gains>=3 losses<=1 top1>900');
  });
});
