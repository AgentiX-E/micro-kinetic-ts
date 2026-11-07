/**
 * `--system` was accepted, printed, and ignored.
 *
 * The flag is documented as `'ob' | 'ss' | 'tt' | 'all'` and two manual dump workflows dispatch it, so a
 * reader has three reasons to believe it filters. It did not: the only place the value was read compared
 * `c.system` against the three CANONICAL names instead of against the filter —
 *
 *     if (opts.system !== 'all' && c.system !== 'OnlineBoutique' && c.system !== 'SockShop' &&
 *         c.system !== 'TrainTicket') continue;
 *
 * — a condition that is false for every case a corpus contains, since every case's system IS one of those
 * three. So the population was always all nine cells, `--system xyz` included, and the banner printed the
 * filter it was asked for rather than the one it applied. `docs/dispatch-forwarding.md` and
 * `docs/duplicate-flag-audit.md` both name this shape: a knob that reaches nothing reports "no change",
 * which a reader takes as a measurement.
 *
 * The repair is not a corrected comparison in place, because a comparison in place is what rotted: the
 * vocabulary moves to a parsed value the CLI rejects, and the predicate moves to a function this file can
 * call directly. What could not be tested before was the FILTER, not the flag.
 *
 * @module benchmarks/__tests__/system-filter
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  RCAEVAL_SYSTEM_CODES,
  isSystemFilter,
  parseRCAEvalArgs,
  parseSystemFilter,
  systemMatches,
} from '../src/rcaeval-cli.js';

/** The canonical names a loaded case can carry, plus the loader's own fallback. */
const EVERY_CASE_SYSTEM = ['OnlineBoutique', 'SockShop', 'TrainTicket', 'Unknown'] as const;

describe('--system — the vocabulary, parsed once and rejected loudly', () => {
  it('names every code the CLI and the dump workflows document', () => {
    expect(Object.keys(RCAEVAL_SYSTEM_CODES).sort()).toEqual(['ob', 'ss', 'tt']);
    expect(RCAEVAL_SYSTEM_CODES).toEqual({
      ob: 'OnlineBoutique',
      ss: 'SockShop',
      tt: 'TrainTicket',
    });
  });

  it('folds the code to the canonical name the loader stamps on a case', () => {
    for (const [code, name] of Object.entries(RCAEVAL_SYSTEM_CODES)) {
      expect(parseSystemFilter(code)).toBe(name);
      // A dispatch's spelling is not a ranking input: both spellings name the same cell, and a run that
      // refused `--system TT` would refuse a filter it could honour.
      expect(parseSystemFilter(code.toUpperCase())).toBe(name);
      expect(parseSystemFilter(name)).toBe(name);
      expect(parseSystemFilter(name.toLowerCase())).toBe(name);
    }
  });

  it('keeps `all` as its own value rather than as a system name', () => {
    expect(parseSystemFilter('all')).toBe('all');
    expect(parseSystemFilter('ALL')).toBe('all');
    expect(isSystemFilter('all')).toBe(true);
    expect(isSystemFilter('tt')).toBe(true);
    expect(isSystemFilter('onlineboutique')).toBe(true);
    expect(isSystemFilter('xyz')).toBe(false);
    expect(isSystemFilter('')).toBe(false);
  });

  it('throws on a value it cannot honour, naming the value and the codes', () => {
    // The failure the old parser could not produce: the token reaches the run, so an artifact cannot claim
    // a filter the runner never applied.
    expect(() => parseSystemFilter('xyz')).toThrow(/xyz/);
    expect(() => parseSystemFilter('xyz')).toThrow(/ob, ss, tt/);
    expect(() => parseRCAEvalArgs(['--system', 'xyz'])).toThrow(/xyz/);
  });

  it('parses a dispatched flag into the canonical value, not the raw token', () => {
    expect(parseRCAEvalArgs(['--system', 'tt']).system).toBe('TrainTicket');
    expect(parseRCAEvalArgs(['--system', 'ss']).system).toBe('SockShop');
    expect(parseRCAEvalArgs(['--system', 'ob']).system).toBe('OnlineBoutique');
    expect(parseRCAEvalArgs([]).system).toBe('all');
  });
});

describe('systemMatches — the filter, exercised as a predicate', () => {
  it('keeps every system under `all`, including the loader’s Unknown', () => {
    for (const system of EVERY_CASE_SYSTEM) expect(systemMatches('all', system)).toBe(true);
  });

  it('keeps exactly one canonical system under each code, and never Unknown', () => {
    for (const [code, name] of Object.entries(RCAEVAL_SYSTEM_CODES)) {
      const filter = parseSystemFilter(code);
      for (const system of EVERY_CASE_SYSTEM) {
        // The defect this replaces: the old condition was TRUE for every row of this table that named one
        // of the three systems, i.e. for the whole corpus, so the population was never filtered.
        expect(systemMatches(filter, system)).toBe(system === name);
      }
    }
  });

  it('is a partition: each canonical case belongs to exactly one code filter', () => {
    for (const system of ['OnlineBoutique', 'SockShop', 'TrainTicket'] as const) {
      const kept = Object.keys(RCAEVAL_SYSTEM_CODES).filter((code) =>
        systemMatches(parseSystemFilter(code), system),
      );
      expect(kept).toHaveLength(1);
    }
  });
});

describe('the runner reads the predicate, so the flag cannot fall away again', () => {
  const source = readFileSync(new URL('../src/run-rcaeval.ts', import.meta.url), 'utf-8');

  it('filters through `systemMatches` rather than an inline comparison', () => {
    expect(source).toContain('systemMatches(opts.system, c.system)');
  });

  it('does not carry the dead triple comparison that made the flag a no-op', () => {
    // Checked as TEXT because the wrong version is valid TypeScript that type-checks, runs, and prints the
    // requested filter — the only way to see it is to run nine cells and notice the population never moved.
    expect(source).not.toMatch(/c\.system !== 'OnlineBoutique'/);
    expect(source).not.toMatch(/c\.system !== 'SockShop'/);
    expect(source).not.toMatch(/c\.system !== 'TrainTicket'/);
  });
});
