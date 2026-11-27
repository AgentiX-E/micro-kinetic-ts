/**
 * The H8 report: what a reader sees, and the two lines that make the census readable.
 *
 * The format is a contract with the workflow's `grep`, so it is pinned here rather than described: the step's
 * summary line extracts `rows=`, `arm=`, `decisions`, `ceiling` and the verdict, and a rename would silently empty
 * the job summary instead of failing it.
 *
 * @module benchmarks/__tests__/containment-veto-report
 */

import { describe, expect, it } from 'vitest';

import {
  formatVetoReading,
  formatVetoVerdict,
  parseVetoArgs,
} from '../src/containment-veto-report.js';
import type { VetoReading } from '../src/containment-veto-study.js';

/** A reading with every column populated, so a formatter that drops one is visible. */
function reading(overrides: Partial<VetoReading> = {}): VetoReading {
  return {
    cases: 1_422,
    replayable: 1_422,
    scored: 1_422,
    disagreements: 0,
    recordFree: 318,
    priors: [
      {
        fittedOn: 'a',
        appliesTo: 'b',
        prior: { residuals: new Map(), threshold: 0 },
        score: 'rho',
        edges: 56,
        fitted: 8,
        admitted: 8,
        observations: 406,
        unfitted: 48,
      },
      {
        fittedOn: 'b',
        appliesTo: 'a',
        prior: { residuals: new Map(), threshold: 0 },
        score: 'rho',
        edges: 61,
        fitted: 9,
        admitted: 9,
        observations: 375,
        unfitted: 52,
      },
    ],
    arms: {
      fusion: { top1: 1_141, gains: 0, losses: 0 },
      shipped: { top1: 1_156, gains: 15, losses: 0 },
      veto: { top1: 1_170, gains: 29, losses: 0 },
    },
    decisions: {
      inverted: 242,
      'record-silent': 37,
      'no-failed-interface': 515,
      unmeasured: 52,
      'callee-in-band': 0,
      'not-larger': 561,
      'prior-absent': 0,
      'prior-below': 0,
    },
    control: {
      inverted: 117,
      'record-silent': 0,
      'no-failed-interface': 458,
      unmeasured: 12,
      'callee-in-band': 0,
      'not-larger': 238,
      'prior-absent': 0,
      'prior-below': 0,
    },
    ceiling: { atSecond: 36, reachable: 31, unreachable: 5, shipped: 15, veto: 29 },
    ...overrides,
  };
}

describe('parseVetoArgs', () => {
  it('requires both inputs and refuses a token it does not know', () => {
    expect(() => parseVetoArgs([])).toThrow(/--rows is required/);
    expect(() => parseVetoArgs(['--rows', 'r'])).toThrow(/--per-case is required/);
    expect(() => parseVetoArgs(['--row', 'r', '--per-case', 'p'])).toThrow(/unknown argument/);
    // A flag with no value reads as the empty string and is then refused by the required-input check, rather than
    // silently taking the next flag as a path.
    expect(() => parseVetoArgs(['--rows'])).toThrow(/--rows is required/);
    // The same for the other required input: a trailing flag takes the empty string and is refused by the check
    // rather than by the loop, which is the branch that makes `?? ''` load-bearing instead of decorative.
    expect(() => parseVetoArgs(['--rows', 'r', '--per-case'])).toThrow(/--per-case is required/);
    // A flag whose value is missing reads as the empty string rather than swallowing a neighbour, and the output
    // path is the one that may legitimately be absent, so the fallback is exercised on it rather than on an input.
    expect(parseVetoArgs(['--rows', 'r', '--per-case', 'p', '--output'])).toEqual({
      rows: 'r',
      perCase: 'p',
      output: '',
    });
  });

  it('carries the output path only when one was given', () => {
    expect(parseVetoArgs(['--rows', 'r', '--per-case', 'p'])).toEqual({ rows: 'r', perCase: 'p' });
    expect(parseVetoArgs(['--rows', 'r', '--per-case', 'p', '--output', 'o'])).toEqual({
      rows: 'r',
      perCase: 'p',
      output: 'o',
    });
  });
});

describe('formatVetoReading', () => {
  it('prints the instrument, both priors, the three arms, the census and the bound', () => {
    const lines = formatVetoReading(reading());
    expect(lines[0]).toBe(
      '  rows=1422 replayable=1422 scored=1422 disagreements=0 record-free=318',
    );
    expect(lines[1]).toBe(
      '  prior fitted-on=a applies-to=b edges=56 fitted=8 admitted=8 observations=406',
    );
    expect(lines[2]).toBe(
      '  prior fitted-on=b applies-to=a edges=61 fitted=9 admitted=9 observations=375',
    );
    expect(lines[3]).toBe('  arm=fusion    top1=1141');
    expect(lines[4]).toBe('  arm=shipped   top1=1156 +15/-0');
    expect(lines[5]).toBe('  arm=veto      top1=1170 +29/-0');
    expect(lines[6]).toBe(
      '  decisions inverted=242 record-silent=37 no-failed-interface=515 unmeasured=52 callee-in-band=0 not-larger=561 prior-absent=0 prior-below=0',
    );
    expect(lines[7]).toBe(
      '  control   inverted=117 record-silent=0 no-failed-interface=458 unmeasured=12 callee-in-band=0 not-larger=238 prior-absent=0 prior-below=0',
    );
    expect(lines[8]).toBe('  ceiling at-second=36 reachable=31 unreachable=5 shipped=15 veto=29');
    expect(lines[9]).toBe('  criterion: gains>=15 losses<=0 top1>1156');
  });

  it('carries the criterion it was given rather than the standing one', () => {
    const lines = formatVetoReading(reading(), { gains: 2, losses: 4, shippedTop1: 9 });
    expect(lines.at(-1)).toBe('  criterion: gains>=2 losses<=4 top1>9');
  });

  it('omits the delta on an arm that has none, so a baseline does not read as a measurement', () => {
    const lines = formatVetoReading(reading());
    expect(lines[3]).not.toMatch(/\+/);
  });
});

describe('formatVetoVerdict', () => {
  it('prints the verdict in the layout the other three arms use', () => {
    expect(formatVetoVerdict('pass', 'nothing to report')).toBe(
      '  H8-veto: PASS — nothing to report',
    );
    expect(formatVetoVerdict('unmeasured', 'no chain')).toBe('  H8-veto: UNMEASURED — no chain');
  });
});
