/**
 * The H7 report: the argument surface and the layout a reader diffs between runs.
 *
 * @module benchmarks/__tests__/containment-surprise-report
 */

import { describe, expect, it } from 'vitest';

import {
  formatSurpriseReading,
  formatSurpriseVerdict,
  parseSurpriseArgs,
} from '../src/containment-surprise-report.js';
import type { SurpriseReading } from '../src/containment-surprise-study.js';

/** A reading with every field populated, so the layout is pinned as a whole. */
function reading(overrides: Partial<SurpriseReading> = {}): SurpriseReading {
  return {
    cases: 10,
    replayable: 10,
    unmeasurable: 0,
    disagreements: 0,
    scored: 9,
    moved: 2,
    arms: {
      fusion: { top1: 7, gains: 0, losses: 0 },
      shipped: { top1: 8, gains: 1, losses: 0 },
      surprise: { top1: 6, gains: 3, losses: 5 },
    },
    decisions: {
      inverted: 12,
      'record-silent': 0,
      'no-failed-interface': 3,
      unmeasured: 4,
      'callee-in-band': 0,
      'not-larger': 5,
      'prior-absent': 0,
      'prior-below': 0,
    },
    opened: {
      inverted: 1,
      'record-silent': 0,
      'no-failed-interface': 0,
      unmeasured: 6,
      'callee-in-band': 0,
      'not-larger': 2,
      'prior-absent': 0,
      'prior-below': 0,
    },
    sigma: 3,
    ...overrides,
  };
}

describe('parseSurpriseArgs', () => {
  it('reads the two required inputs', () => {
    expect(parseSurpriseArgs(['--rows', 'r.ndjson', '--per-case', 'p.ndjson'])).toEqual({
      rows: 'r.ndjson',
      perCase: 'p.ndjson',
    });
  });

  it('reads the optional output', () => {
    expect(parseSurpriseArgs(['--rows', 'r', '--per-case', 'p', '--output', 'o.json']).output).toBe(
      'o.json',
    );
  });

  it('requires a row file', () => {
    expect(() => parseSurpriseArgs(['--per-case', 'p'])).toThrow(/--rows is required/);
  });

  it('requires a verdict file, because a reading without labels is a census and not an arm', () => {
    expect(() => parseSurpriseArgs(['--rows', 'r'])).toThrow(/--per-case is required/);
  });

  it('treats a flag with no value as a missing value rather than as the next flag', () => {
    expect(() => parseSurpriseArgs(['--rows'])).toThrow(/--rows is required/);
    expect(() => parseSurpriseArgs(['--rows', 'r', '--per-case'])).toThrow(
      /--per-case is required/,
    );
    expect(parseSurpriseArgs(['--rows', 'r', '--per-case', 'p', '--output']).output).toBe('');
  });

  it('refuses an unknown token instead of ignoring it', () => {
    // A mistyped `--row` would leave the required input unset and the run would read its default, which is how a
    // report comes to describe an artifact nobody named.
    expect(() => parseSurpriseArgs(['--row', 'r'])).toThrow(/unknown argument: --row/);
  });
});

describe('formatSurpriseReading', () => {
  it('prints the instrument first, then the population, then the three arms', () => {
    const lines = formatSurpriseReading(reading());
    expect(lines[0]).toBe('  rows=10 replayable=10 unmeasurable=0 disagreements=0 scored=9');
    expect(lines[1]).toContain('moved=2');
    expect(lines[1]).toContain('sigma=3');
    expect(lines[2]).toBe('  arm=fusion    top1=7');
    expect(lines[3]).toBe('  arm=shipped   top1=8 +1/-0');
    expect(lines[4]).toBe('  arm=surprise  top1=6 +3/-5');
  });

  it('leaves the baseline without a ± because it is the arm every ± is read against', () => {
    expect(formatSurpriseReading(reading())[2]).not.toContain('+0/-0');
  });

  it('prints both censuses with every reason, including the ones that stayed zero', () => {
    // A reason that vanished from the line would be indistinguishable from a reason nobody looked for.
    const lines = formatSurpriseReading(reading());
    expect(lines[5]).toBe(
      '  decisions inverted=12 no-failed-interface=3 unmeasured=4 callee-in-band=0 not-larger=5 prior-absent=0 prior-below=0',
    );
    expect(lines[6]).toContain('opened    inverted=1');
    expect(lines[6]).toContain('unmeasured=6');
  });

  it('states the criterion it will be judged by, so the verdict line is not the only place it appears', () => {
    expect(formatSurpriseReading(reading())[7]).toBe('  criterion: gains>=15 losses<=0 top1>1156');
  });

  it('prints a criterion it was given rather than the standing one', () => {
    const lines = formatSurpriseReading(reading(), { gains: 1, losses: 2, shippedTop1: 3 });
    expect(lines[7]).toBe('  criterion: gains>=1 losses<=2 top1>3');
  });
});

describe('formatSurpriseVerdict', () => {
  it('uppercases the verdict and keeps the reason beside it', () => {
    expect(formatSurpriseVerdict('fail', '+6 is below the 15 the gate requires')).toBe(
      '  H7-surprise: FAIL — +6 is below the 15 the gate requires',
    );
  });

  it('says unmeasured in the same shape, so a reader and a grep both find it', () => {
    expect(formatSurpriseVerdict('unmeasured', 'no row carries a chain')).toBe(
      '  H7-surprise: UNMEASURED — no row carries a chain',
    );
  });
});
