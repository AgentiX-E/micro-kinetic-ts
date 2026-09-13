/**
 * Unit tests for the FSE'26 runner's argument parsing.
 *
 * The case that matters most is `--log-mode count`. The accepted modes used to be
 * a hand-written `||` chain, and when the default was flipped to `logicHttp` the
 * rewrite dropped `count` from it: the value matched nothing and silently fell
 * back to `logicHttp`, so dispatching `count` ran `logicHttp` and reported 47.3%.
 * Two diagnostic runs dispatched to compare the two modes came back
 * byte-identical, which is how it surfaced.
 *
 * @module benchmarks/__tests__/fse26-cli
 */

import { describe, expect, it } from 'vitest';

import type { LogSignalMode } from '../../packages/tree/src/index.js';

import { DEFAULT_FSE26_LOG_MODE, isLogSignalMode, parseFSE26Args } from '../src/fse26-cli.js';

/**
 * Every member of the union, spelled out.
 *
 * A duplicate of the production list is acceptable *here* because these tests
 * assert behaviour — that the value survives parsing — while production guards
 * exhaustiveness against the type. The production guard is what makes the list
 * complete; this one makes it correct.
 */
const ALL_MODES: readonly LogSignalMode[] = [
  'count',
  'novelty',
  'logicHttp',
  'logicHttpJoint',
  'logicHttpDominant',
  'all',
];

describe('parseFSE26Args — log mode', () => {
  it('honours --log-mode count', () => {
    // The regression. `count` is a recognised mode with a recorded full-benchmark
    // measurement, so refusing it makes that configuration undispatchable.
    expect(parseFSE26Args(['--log-mode', 'count']).logMode).toBe('count');
  });

  it('honours every member of the mode union', () => {
    for (const mode of ALL_MODES) {
      expect(parseFSE26Args(['--log-mode', mode]).logMode, mode).toBe(mode);
    }
  });

  it('falls back to the measured default for an unrecognised mode', () => {
    // A typo must not select a *different* configuration silently; it selects the
    // one that is documented as the default.
    expect(parseFSE26Args(['--log-mode', 'logicHtttp']).logMode).toBe(DEFAULT_FSE26_LOG_MODE);
  });

  it('falls back for a mode name that is not a mode at all', () => {
    expect(parseFSE26Args(['--log-mode', 'LOGICHTTP']).logMode).toBe(DEFAULT_FSE26_LOG_MODE);
  });

  it('ignores a trailing --log-mode with no value', () => {
    expect(parseFSE26Args(['--log-mode']).logMode).toBe(DEFAULT_FSE26_LOG_MODE);
  });

  it('defaults to the measured best mode with no arguments', () => {
    expect(DEFAULT_FSE26_LOG_MODE).toBe('logicHttp');
    expect(parseFSE26Args([]).logMode).toBe('logicHttp');
  });

  it('takes the last occurrence when the flag is repeated', () => {
    expect(parseFSE26Args(['--log-mode', 'count', '--log-mode', 'all']).logMode).toBe('all');
  });
});

describe('isLogSignalMode', () => {
  it('accepts every member of the union', () => {
    for (const mode of ALL_MODES) {
      expect(isLogSignalMode(mode), mode).toBe(true);
    }
  });

  it('rejects non-modes, including names of Object.prototype members', () => {
    for (const value of ['', 'count ', 'COUNT', 'toString', 'constructor', '__proto__']) {
      expect(isLogSignalMode(value), value).toBe(false);
    }
  });
});

describe('parseFSE26Args — other flags', () => {
  it('applies the documented defaults', () => {
    const opts = parseFSE26Args([]);
    expect(opts.dataDir).toContain('RCABench-json');
    expect(opts.maxCases).toBe(0);
    expect(opts.logWeight).toBe(1.0);
    expect(opts.rankNormalization).toBe(true);
    expect(opts.output).toBe('');
    expect(opts.diagnose).toEqual([]);
    expect(opts.diagnoseLimit).toBe(3);
    expect(opts.dropMetrics).toEqual([]);
  });

  it('parses the scalar flags', () => {
    const opts = parseFSE26Args([
      '--data-dir',
      '/data',
      '--max-cases',
      '25',
      '--log-weight',
      '0.5',
      '--output',
      'out.json',
    ]);
    expect(opts.dataDir).toBe('/data');
    expect(opts.maxCases).toBe(25);
    expect(opts.logWeight).toBe(0.5);
    expect(opts.output).toBe('out.json');
  });

  it('turns off rank normalization', () => {
    expect(parseFSE26Args(['--no-rank-normalization']).rankNormalization).toBe(false);
  });

  it('splits and trims the comma-separated flags', () => {
    const opts = parseFSE26Args([
      '--diagnose',
      ' JVMMemoryStress , NetworkPartition ,, ',
      '--drop-metrics',
      'a.max,b.max',
    ]);
    expect(opts.diagnose).toEqual(['JVMMemoryStress', 'NetworkPartition']);
    expect(opts.dropMetrics).toEqual(['a.max', 'b.max']);
  });

  it('reads --diagnose-limit 0 as unlimited rather than as a default', () => {
    expect(parseFSE26Args(['--diagnose-limit', '0']).diagnoseLimit).toBe(0);
  });

  it('ignores an unparseable number instead of producing NaN', () => {
    // `parseInt('x')` is NaN and `NaN || 0` is 0, so a bad count means "all
    // cases" rather than an empty run.
    expect(parseFSE26Args(['--max-cases', 'x']).maxCases).toBe(0);
    expect(parseFSE26Args(['--log-weight', 'x']).logWeight).toBe(0);
  });

  it('parses the metric rise ceiling, defaulting to unbounded', () => {
    expect(parseFSE26Args([]).metricRiseCeiling).toBe(0);
    expect(parseFSE26Args(['--rise-ceiling', '10']).metricRiseCeiling).toBe(10);
    expect(parseFSE26Args(['--rise-ceiling', '2.5']).metricRiseCeiling).toBe(2.5);
    expect(parseFSE26Args(['--rise-ceiling', '0']).metricRiseCeiling).toBe(0);
  });

  it('rejects a ceiling with trailing garbage instead of running a different one', () => {
    // THE reason this flag does not use `parseFloat`: `parseFloat('1O')` is 1, so
    // `--rise-ceiling 1O` meaning 10 would have measured a ceiling of 1 — a
    // plausible number from a DIFFERENT configuration, which is worse than a
    // failure because nothing in the artifact looks wrong. Anything that is not
    // a finite positive number falls back to the shipped configuration, which
    // can only reproduce published numbers.
    expect(parseFSE26Args(['--rise-ceiling', '1O']).metricRiseCeiling).toBe(0);
    expect(parseFSE26Args(['--rise-ceiling', '10x']).metricRiseCeiling).toBe(0);
    expect(parseFSE26Args(['--rise-ceiling', '']).metricRiseCeiling).toBe(0);
    expect(parseFSE26Args(['--rise-ceiling', '-4']).metricRiseCeiling).toBe(0);
    expect(parseFSE26Args(['--rise-ceiling', 'Infinity']).metricRiseCeiling).toBe(0);
    expect(parseFSE26Args(['--rise-ceiling']).metricRiseCeiling).toBe(0);
  });

  it('turns on the fleet-relative metric baseline only when asked', () => {
    expect(parseFSE26Args([]).metricFleetBaseline).toBe(false);
    expect(parseFSE26Args(['--fleet-baseline']).metricFleetBaseline).toBe(true);
    // A flag with no value must not consume the next flag.
    expect(parseFSE26Args(['--fleet-baseline', '--rise-ceiling', '10']).metricRiseCeiling).toBe(10);
  });

  it('ignores unknown flags', () => {
    expect(parseFSE26Args(['--verbose', '--log-mode', 'count']).logMode).toBe('count');
  });
});
