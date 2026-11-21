/**
 * The term report's argument parsing and formatting.
 *
 * Both are tested because both are places where a number can be reported without being measured: a λ silently
 * defaulted from a typo turns the pre-committed sweep into a different curve, and a formatter that printed the
 * wrong arm's ± would put the gate's `+15/−0` beside the term's numbers.
 */

import { describe, expect, it } from 'vitest';

import { STANDING_CRITERION } from '../src/containment-gate.js';
import {
  DEFAULT_LAMBDAS,
  formatTermReading,
  formatTermSweep,
  parseTermArgs,
} from '../src/containment-term-report.js';
import type { TermReading } from '../src/containment-term-study.js';

function readingFor(lambda: number, overrides: Partial<TermReading> = {}): TermReading {
  return {
    cases: 10,
    replayable: 10,
    disagreements: 0,
    unordered: 0,
    lambda,
    fits: [
      {
        fittedOn: 'a',
        appliesTo: 'b',
        edges: 56,
        fitted: 8,
        positive: 8,
        observations: 406,
      },
    ],
    population: { fusion: 833, ungated: 861, shared: 1385 },
    census: { qualified: 228, unfitted: 45, paid: 183, silent: 0, refused: 605 },
    moved: 55,
    reach: [
      { rank: 2, gains: 4, losses: 0 },
      { rank: 3, gains: 2, losses: 5 },
      { rank: 4, gains: 0, losses: 2 },
      { rank: 5, gains: 0, losses: 3 },
    ],
    arms: {
      fusion: { top1: 1141, gains: 0, losses: 0 },
      shipped: { top1: 1156, gains: 15, losses: 0 },
      prior: { top1: 1165, gains: 27, losses: 3 },
      graded: { top1: 1137, gains: 6, losses: 10 },
    },
    ...overrides,
  };
}

describe('parseTermArgs', () => {
  const base = ['--rows', 'r.ndjson', '--depth', 'd.ndjson', '--per-case', 'p.ndjson'];

  it('reads the three inputs and defaults the sweep to the pre-registered grid', () => {
    expect(parseTermArgs(base)).toEqual({
      rows: 'r.ndjson',
      depth: 'd.ndjson',
      perCase: 'p.ndjson',
      lambdas: DEFAULT_LAMBDAS,
      output: '',
    });
  });

  it('reads a λ grid in the order it was given', () => {
    expect(parseTermArgs([...base, '--lambdas', '4,1,0.25']).lambdas).toEqual([4, 1, 0.25]);
  });

  it('refuses a λ that is not a positive finite number rather than defaulting it', () => {
    // A defaulted λ would report a curve nobody asked for while looking like the one that was.
    for (const bad of ['0', '-1', 'abc', 'Infinity', '1,,2']) {
      expect(() => parseTermArgs([...base, '--lambdas', bad])).toThrow(/positive finite number/);
    }
  });

  it('refuses a missing input by name', () => {
    expect(() => parseTermArgs(['--depth', 'd', '--per-case', 'p'])).toThrow(/--rows is required/);
    expect(() => parseTermArgs(['--rows', 'r', '--per-case', 'p'])).toThrow(/--depth is required/);
    expect(() => parseTermArgs(['--rows', 'r', '--depth', 'd'])).toThrow(/--per-case is required/);
  });

  it('refuses an argument it does not know', () => {
    expect(() => parseTermArgs([...base, '--score', 'phi'])).toThrow(/unknown argument: --score/);
  });

  it('carries the output path through', () => {
    expect(parseTermArgs([...base, '--output', 'out.json']).output).toBe('out.json');
  });
});

describe('formatTermReading', () => {
  it('prints the instrument, the population, the fits, the census and the four arms', () => {
    const lines = formatTermReading(readingFor(1));
    expect(lines[0]).toBe('  rows=10 replayable=10 disagreements=0 unordered=0');
    expect(lines[1]).toBe('  population fusion=833 ungated=861 same-length-cases=1385');
    expect(lines[2]).toBe(
      '  phi fitted-on=a applies-to=b edges=56 fitted=8 positive=8 observations=406',
    );
    expect(lines[3]).toBe('  transfers qualified=228 unfitted=45 paid=183 silent=0 refused=605');
    expect(lines[4]).toBe('  moved=55 (graded head differs from the fusion head)');
    expect(lines[5]).toBe('  reach rank=2 +4/-0 rank=3 +2/-5 rank=4 +0/-2 rank=5 +0/-3');
    // The gate's two readings are printed beside the new arm so the old number can be seen to reproduce, and the
    // graded row carries its λ because a term's reading is meaningless without the weight it was taken at.
    expect(lines).toContain('  arm=fusion  top1=1141');
    expect(lines).toContain('  arm=shipped top1=1156 +15/-0');
    expect(lines).toContain('  arm=prior   top1=1165 +27/-3');
    expect(lines).toContain('  arm=graded  top1=1137 +6/-10 lambda=1');
  });

  it('prints one fit line per half, in the order the halves were fitted', () => {
    const reading = readingFor(1, {
      fits: [
        { fittedOn: 'a', appliesTo: 'b', edges: 56, fitted: 8, positive: 8, observations: 406 },
        { fittedOn: 'b', appliesTo: 'a', edges: 61, fitted: 9, positive: 9, observations: 375 },
      ],
    });
    expect(formatTermReading(reading).filter((line) => line.startsWith('  phi '))).toHaveLength(2);
  });
});

describe('formatTermSweep', () => {
  it('prints one row per λ with its verdict, then the criterion', () => {
    const lines = formatTermSweep([readingFor(0.25), readingFor(4)]);
    expect(lines[0]).toBe('  lambda sweep:');
    expect(lines[1]).toBe('    lambda=0.25  top1=1137 +6/-10 moved=55 fail');
    expect(lines[2]).toBe('    lambda=4     top1=1137 +6/-10 moved=55 fail');
    expect(lines[3]).toBe('  criterion: gains>=15 losses<=0 top1>1156');
  });

  it('prints the criterion the caller supplied, so a changed bar is visible in the output', () => {
    const clean = readingFor(1, {
      arms: {
        fusion: { top1: 1_141, gains: 0, losses: 0 },
        shipped: { top1: 1_156, gains: 15, losses: 0 },
        prior: { top1: 1_165, gains: 27, losses: 3 },
        graded: { top1: 1_200, gains: 6, losses: 0 },
      },
    });
    const lines = formatTermSweep([clean], { gains: 1, losses: 0, shippedTop1: 1_100 });
    expect(lines.at(-1)).toBe('  criterion: gains>=1 losses<=0 top1>1100');
    // And the verdict follows that bar rather than the standing one.
    expect(lines[1]).toContain('pass');
    expect(STANDING_CRITERION.gains).toBe(15);
  });
});

describe('a flag at the end of the command line', () => {
  it('reads a missing value as empty and refuses it by name, rather than swallowing the next flag', () => {
    // Every `next ?? ''` in the parser. A parser that treated `['--rows']` as "required but absent" only by
    // luck would accept `['--rows','--depth','d']` and read `--depth` as a file name; the refusal names the flag
    // that has no value, which is the sentence an operator can act on.
    expect(() => parseTermArgs(['--rows'])).toThrow(/--rows is required/);
    expect(() => parseTermArgs(['--rows', 'r', '--depth'])).toThrow(/--depth is required/);
    expect(() => parseTermArgs(['--rows', 'r', '--depth', 'd', '--per-case'])).toThrow(
      /--per-case is required/,
    );
    expect(
      parseTermArgs(['--rows', 'r', '--depth', 'd', '--per-case', 'p', '--output']).output,
    ).toBe('');
    // A λ flag with no value is an empty string, which is not a positive finite number.
    expect(() =>
      parseTermArgs(['--rows', 'r', '--depth', 'd', '--per-case', 'p', '--lambdas']),
    ).toThrow(/positive finite number/);
  });
});

describe('the reach line', () => {
  it('says so when no published head moved, instead of printing an empty list', () => {
    const lines = formatTermReading(readingFor(0, { reach: [] }));
    expect(lines).toContain('  reach (no published head moved)');
  });
});
