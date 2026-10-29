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
import {
  DEFAULT_DUAL_FAMILY_GATE_MODE,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  DEFAULT_TOPO_DISCOUNT_SCOPE,
  ONSET_SHAPES,
} from '../../packages/tree/src/index.js';

import { DEFAULT_FSE26_LOG_MODE, isLogSignalMode, parseFSE26Args } from '../src/fse26-cli.js';
import { buildFse26EngineOptions } from '../src/fse26-engine-options.js';
import { parseRCAEvalArgs } from '../src/rcaeval-cli.js';
import { buildRCAEvalEngineOptions } from '../src/rcaeval-engine-options.js';

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

  it('refuses a trailing --log-mode with no value', () => {
    // A missing value is not the same decision as an unusable one, and the two used to be conflated.
    // An unusable VALUE falls back to the shipped configuration, deliberately: a typo must reproduce
    // a published configuration rather than invent one. A missing value has nothing to fall back
    // FROM — the flag was asked for — so the run would report the shipped configuration as if it
    // were the answer to a question nobody can read out of the artifact.
    expect(() => parseFSE26Args(['--log-mode'])).toThrow(/--log-mode/);
    expect(parseFSE26Args(['--log-mode', 'LOGICHTTP']).logMode).toBe(DEFAULT_FSE26_LOG_MODE);
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
    // `--log-weight` is parsed STRICTLY and falls back to the SHIPPED weight,
    // not to 0: 0 is itself a measured configuration (14.98% Top@1), so falling
    // back to it would run a different ablation than the one asked for while the
    // `Config:` line reported a weight the operator typed.
    expect(parseFSE26Args(['--log-weight', 'x']).logWeight).toBe(1.0);
    expect(parseFSE26Args(['--log-weight', '1O']).logWeight).toBe(1.0);
    // An EMPTY value is unusable too, and it is the case that hides best:
    // `Number('')` is 0, which is finite and non-negative, so a naive check accepts
    // it and silently runs the 14.98% ablation. The workflow passes this flag only
    // when the dispatch input is non-empty, for the same reason.
    expect(parseFSE26Args(['--log-weight', '']).logWeight).toBe(1.0);
    expect(parseFSE26Args(['--log-weight', '   ']).logWeight).toBe(1.0);
  });

  it('keeps every valid log weight, including the measured 0', () => {
    expect(parseFSE26Args(['--log-weight', '0']).logWeight).toBe(0);
    expect(parseFSE26Args(['--log-weight', '0.25']).logWeight).toBe(0.25);
    expect(parseFSE26Args(['--log-weight', '1']).logWeight).toBe(1);
    expect(parseFSE26Args(['--log-weight', '-1']).logWeight).toBe(1.0);
  });

  it('parses the failed-edge weight, at the ENROLLED default of 3', () => {
    // 3 since iteration 125: a controlled pair on FSE'26 took Top@1 53.2% -> 56.1% (+41 cases) with zero
    // regressed fault types. `0` is still a configuration — every published cell before that ran it.
    expect(parseFSE26Args([]).failedEdgeWeight).toBe(3);
    expect(parseFSE26Args(['--failed-edge-weight', '0']).failedEdgeWeight).toBe(0);
    expect(parseFSE26Args(['--failed-edge-weight', '1']).failedEdgeWeight).toBe(1);
    expect(parseFSE26Args(['--failed-edge-weight', '2.5']).failedEdgeWeight).toBe(2.5);
  });

  it('parses the failed-edge aggregation, defaulting to sum', () => {
    expect(parseFSE26Args([]).failedEdgeMode).toBe('sum');
    expect(parseFSE26Args(['--failed-edge-mode', 'sum']).failedEdgeMode).toBe('sum');
    expect(parseFSE26Args(['--failed-edge-mode', 'mean']).failedEdgeMode).toBe('mean');
  });

  it('parses the latency weight, defaulting to the SHIPPED measured weight', () => {
    // Not zero. `parseFSE26Args([])` is what CI runs when no input is overridden,
    // so this IS the published configuration, and the shipped value is the
    // criterion-passing point inside the zero-regression window rather than the
    // ablation. Asserted against the engine's own constant, so the number has one
    // owner and a change to it cannot pass by editing a literal here.
    expect(parseFSE26Args([]).latWeight).toBe(DEFAULT_LAT_WEIGHT);
    expect(DEFAULT_LAT_WEIGHT).toBeGreaterThan(0);
    // Zero is still reachable explicitly — it is a different MEASURED
    // configuration (the pre-flip control), not an invalid one.
    expect(parseFSE26Args(['--lat-weight', '0']).latWeight).toBe(0);
    expect(parseFSE26Args(['--lat-weight', '0.75']).latWeight).toBe(0.75);
    expect(parseFSE26Args(['--lat-weight', '2']).latWeight).toBe(2);
  });

  it('falls back to the SHIPPED latency weight on anything unusable', () => {
    // The fallback has to be the SHIPPED value, exactly as `--log-weight`'s is.
    // It used to be a hardcoded 0, which was the shipped value only while the
    // default WAS 0: after the flip it would have run the ablation on a typo and
    // reported it under the shipped configuration's name in the `Config:` line.
    // A negative weight would flip the term into a PENALTY on the very services it
    // is meant to credit.
    expect(parseFSE26Args(['--lat-weight', '0.5x']).latWeight).toBe(DEFAULT_LAT_WEIGHT);
    expect(parseFSE26Args(['--lat-weight', '-1']).latWeight).toBe(DEFAULT_LAT_WEIGHT);
    expect(parseFSE26Args(['--lat-weight', '']).latWeight).toBe(DEFAULT_LAT_WEIGHT);
  });

  it('parses the latency rise floor, defaulting to the SHIPPED measured value', () => {
    // The shipped floor is half of a measured PAIR with the weight: at the shipped
    // weight a floor of 1 scores 673 against 750, and a floor of 10.3 at the OLD weight
    // is a 6-case regression. So the default is the engine's constant, and `1` — the
    // credited-everything shape — is still reachable as an explicit ablation.
    expect(parseFSE26Args([]).latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    expect(parseFSE26Args([]).latMinRise).toBeGreaterThan(1);
    expect(parseFSE26Args(['--lat-min-rise', '1']).latMinRise).toBe(1);
    expect(parseFSE26Args(['--lat-min-rise', '10.3']).latMinRise).toBe(10.3);
  });

  it('parses the pool penalty, defaulting to the SHIPPED (inert) constant', () => {
    // The shipped value is 0 while the +6-case window is still a prediction: the
    // default has to be the engine's own constant, so a dispatched run without the
    // flag reproduces exactly what the last measured run used. Asserted against the
    // export so the number has one owner.
    expect(parseFSE26Args([]).poolMetricPenaltyWeight).toBe(DEFAULT_POOL_METRIC_PENALTY_WEIGHT);
    expect(parseFSE26Args(['--pool-penalty', '0.0679']).poolMetricPenaltyWeight).toBe(0.0679);
    // An explicit 0 is the ablation, and it is distinguishable from the default only
    // while the default is non-zero — which is why the config line prints the field
    // unconditionally rather than omitting it at the default.
    expect(parseFSE26Args(['--pool-penalty', '0']).poolMetricPenaltyWeight).toBe(0);
  });

  it('parses the temporal PAIR: the shipped weight and the shipped shape', () => {
    // Both halves are read from the engine's constants rather than asserted as literals:
    // what this test is for is that the CLI and the pruner cannot disagree about a
    // configuration, and pinning the numbers here would be a second owner of them —
    // the recorded-runs guard is where a VALUE is asserted, once.
    expect(parseFSE26Args([]).temporalWeight).toBe(DEFAULT_TEMPORAL_WEIGHT);
    expect(parseFSE26Args([]).onsetShape).toBe(DEFAULT_ONSET_SHAPE);
    expect(parseFSE26Args(['--temporal-weight', '0.036552']).temporalWeight).toBe(0.036552);
    // The SHAPE is a different kind of field: it has no default-0 to be omitted against,
    // and it is inert while the weight is 0, which is why it can be set on its own.
    for (const shape of ONSET_SHAPES) {
      expect(parseFSE26Args(['--onset-shape', shape]).onsetShape).toBe(shape);
    }
  });

  it('falls back to the SHIPPED shape on an unknown one, like every other mode flag', () => {
    // A typo must reproduce a published configuration rather than invent one — the same
    // rule `--log-mode` and `--failed-edge-mode` follow. A shape is not a weight, so
    // there is no "ablation" a malformed value could accidentally select.
    expect(parseFSE26Args(['--onset-shape', 'earliest']).onsetShape).toBe(DEFAULT_ONSET_SHAPE);
    expect(parseFSE26Args(['--onset-shape', '']).onsetShape).toBe(DEFAULT_ONSET_SHAPE);
  });

  it('falls back to the SHIPPED temporal weight on an empty or unusable value', () => {
    // The shipped value is 0 again — the pair was reverted after the golden rejected it —
    // so this assertion is WEAKER than it was, and saying so is the point: with the shipped
    // value equal to the ablation, a fallback to either is indistinguishable here. What is
    // still tested is the class, at a value that can tell them apart: garbage returns the
    // shipped value, a real number returns itself, and nothing else is ever returned.
    expect(parseFSE26Args(['--temporal-weight', '']).temporalWeight).toBe(DEFAULT_TEMPORAL_WEIGHT);
    expect(parseFSE26Args(['--temporal-weight', '1x']).temporalWeight).toBe(
      DEFAULT_TEMPORAL_WEIGHT,
    );
    expect(parseFSE26Args(['--temporal-weight', '-1']).temporalWeight).toBe(
      DEFAULT_TEMPORAL_WEIGHT,
    );
    // The REJECTED candidate stays reachable by name, which is how its rejection is
    // re-measured rather than argued, and the ablation is selectable explicitly.
    expect(parseFSE26Args(['--temporal-weight', '0.036552']).temporalWeight).toBe(0.036552);
    expect(parseFSE26Args(['--temporal-weight', '0']).temporalWeight).toBe(0);
  });

  it('falls back to the SHIPPED pool penalty on an empty or unusable value', () => {
    // `Number('')` is 0 — finite and non-negative — so an inline parse would read a
    // blank value as the ABLATION, which is a different measured configuration.
    expect(parseFSE26Args(['--pool-penalty', '']).poolMetricPenaltyWeight).toBe(
      DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    );
    expect(parseFSE26Args(['--pool-penalty', 'abc']).poolMetricPenaltyWeight).toBe(
      DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    );
    expect(parseFSE26Args(['--pool-penalty', '-1']).poolMetricPenaltyWeight).toBe(
      DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    );
  });

  it('refuses a rise floor below 1 rather than accepting a no-op', () => {
    // A floor below 1 cannot mask anything the shipped shape does not already mask
    // (magnitudes are `log1p(max(0, rise - 1))`), so accepting it would render a
    // configuration the operator believes changed something when nothing changed.
    // The fallback is the SHIPPED floor, like every other weight fallback.
    for (const bad of ['0.5', '0', '-3', 'x', '']) {
      expect(parseFSE26Args(['--lat-min-rise', bad]).latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    }
  });

  it('parses the failed-edge evidence floor, defaulting to the shipped 1', () => {
    expect(parseFSE26Args([]).failedEdgeMinRecords).toBe(1);
    expect(parseFSE26Args(['--failed-edge-min-records', '2']).failedEdgeMinRecords).toBe(2);
    expect(parseFSE26Args(['--failed-edge-min-records', '5']).failedEdgeMinRecords).toBe(5);
  });

  it('rejects a floor that would credit a callee on no evidence', () => {
    // A floor of 0 or a non-integer falls back to the SHIPPED floor rather than
    // inventing a configuration. `Number('2O')` is NaN, so a typo reproduces the
    // published behaviour instead of a plausible different one.
    expect(parseFSE26Args(['--failed-edge-min-records', '0']).failedEdgeMinRecords).toBe(1);
    expect(parseFSE26Args(['--failed-edge-min-records', '-3']).failedEdgeMinRecords).toBe(1);
    expect(parseFSE26Args(['--failed-edge-min-records', '2.5']).failedEdgeMinRecords).toBe(1);
    expect(parseFSE26Args(['--failed-edge-min-records', '2O']).failedEdgeMinRecords).toBe(1);
    expect(parseFSE26Args(['--failed-edge-min-records', '']).failedEdgeMinRecords).toBe(1);
  });

  it('falls back to the SHIPPED mode on an unrecognised value', () => {
    // An unknown aggregation must reproduce a published configuration, never
    // invent one — the same reasoning as the log-signal mode.
    expect(parseFSE26Args(['--failed-edge-mode', 'median']).failedEdgeMode).toBe('sum');
    expect(parseFSE26Args(['--failed-edge-mode', '']).failedEdgeMode).toBe('sum');
  });

  it('rejects a failed-edge weight with trailing garbage instead of running a different one', () => {
    // Same trap as `--rise-ceiling`: `parseFloat('1O')` is 1, so a typo would
    // silently measure a weight of 1. The fallback is the SHIPPED weight (3).
    expect(parseFSE26Args(['--failed-edge-weight', '1O']).failedEdgeWeight).toBe(3);
    expect(parseFSE26Args(['--failed-edge-weight', 'x']).failedEdgeWeight).toBe(3);
    expect(parseFSE26Args(['--failed-edge-weight', '']).failedEdgeWeight).toBe(3);
    // A negative weight would make the signal a penalty, which is a different
    // mechanism than the one the option documents.
    expect(parseFSE26Args(['--failed-edge-weight', '-1']).failedEdgeWeight).toBe(3);
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
    // The VALUE fallback above is unchanged. The flag with NO value is refused instead: there is
    // nothing to fall back from, and 0 is also the "off" value, so a silent default would make an
    // unhonoured request indistinguishable from a deliberate ablation.
    expect(() => parseFSE26Args(['--rise-ceiling'])).toThrow(/--rise-ceiling/);
  });

  it('turns on the fleet-relative metric baseline only when asked', () => {
    expect(parseFSE26Args([]).metricFleetBaseline).toBe(false);
    expect(parseFSE26Args(['--fleet-baseline']).metricFleetBaseline).toBe(true);
    // A flag with no value must not consume the next flag.
    expect(parseFSE26Args(['--fleet-baseline', '--rise-ceiling', '10']).metricRiseCeiling).toBe(10);
  });

  it('refuses a flag it does not test instead of discarding it', () => {
    // This asserted the opposite until now, and a discarded flag is invisible in exactly the way
    // that costs a run: the parser proceeds at the shipped configuration and the artifact says
    // confidently what that configuration scored. The intent the old assertion was reaching for —
    // a stray token must not corrupt the ACCEPTED flags around it — is asserted directly below it.
    expect(() => parseFSE26Args(['--verbose', '--log-mode', 'count'])).toThrow(/--verbose/);
    expect(parseFSE26Args(['--log-mode', 'count']).logMode).toBe('count');
  });

  it('does not consume the next flag when the value is missing', () => {
    // The name and the comment above were right; the assertion could not tell the two readings
    // apart. `--log-weight --log-mode` DID swallow `--log-mode` as the weight, `parseWeight` fell
    // back to `1.0`, and the following `count` was discarded as a stray token — so the assertion
    // passed only because the swallowed flag's own default equals the value it checked for. The
    // property is now true and checkable, at the flag whose value is missing.
    expect(() => parseFSE26Args(['--failed-edge-weight'])).toThrow(/--failed-edge-weight/);
    expect(() => parseFSE26Args(['--log-weight', '--log-mode'])).toThrow(/--log-weight/);
    expect(() => parseFSE26Args(['--log-weight', '--log-mode', 'count'])).toThrow(/--log-weight/);
    // The intent, in the form that honours it.
    expect(parseFSE26Args(['--log-weight', '0.5', '--log-mode', 'count']).logMode).toBe('count');
  });
});

/**
 * The eight ranking knobs only the GOLDEN half could state, and what this fence is.
 *
 * `docs/dispatch-surface-audit.md`'s Finding 6 found them by the third seam: options the engine carried,
 * the artifact NAMED, and no dispatch could state. Its own boundary argument then said the consequence out
 * loud — *adding an RCAEval-only knob grows the surface without growing the set of answerable questions,
 * because the FSE'26 half would still be unreachable* — and registered the mirror as a task. This is the
 * fence for it.
 *
 * The assertions are deliberately a CROSS-RUNNER EQUIVALENCE rather than eight shapes and eight defaults.
 * A per-flag assertion would pass while the two runners disagreed, and disagreement is the defect the
 * audit document's boundary argument is about: the kill criterion is an AND over the two benchmarks, so a
 * value that means one thing on one half and another on the other makes the intersection meaningless even
 * when both halves are individually reachable. So each row is fed to BOTH parsers and the ENGINE-level
 * values are compared, and the malformed rows are compared too — a fallback that differs is the same
 * defect wearing a valid value's clothes.
 */

/**
 * One knob, its flag, and where the value lands on the ENGINE.
 *
 * `bucket` rather than a single path because the two engine arguments are separate objects and the split is
 * load-bearing: `collapseDiscount` and the two suppression switches are arguments to the fault-graph
 * builder, not to the ranking fusion, and a value placed in the wrong object is exactly the silent no-op
 * `rcaeval-engine-options.ts` records having been built to prevent.
 */
const MIRRORED_KNOBS: readonly {
  option: string;
  flag: string;
  value: string;
  bucket: 'signals' | 'topology';
  expected: string | number | boolean;
}[] = [
  { option: 'traceWeight', flag: '--trace-weight', value: '1', bucket: 'signals', expected: 1 },
  { option: 'topoWeight', flag: '--topo-weight', value: '0.25', bucket: 'signals', expected: 0.25 },
  // Iteration 190's weight. It joins this table because it is a weight the pruner reads from `signals`, which
  // is the one thing this table exists to prove about a mirrored knob.
  {
    option: 'topoDiscount',
    flag: '--topo-discount',
    value: '0.5',
    bucket: 'signals',
    expected: 0.5,
  },
  {
    option: 'collisionWeight',
    flag: '--collision-weight',
    value: '0.5',
    bucket: 'signals',
    expected: 0.5,
  },
  {
    option: 'prismWeight',
    flag: '--prism-weight',
    value: '0.125',
    bucket: 'signals',
    expected: 0.125,
  },
  {
    option: 'prismPooling',
    flag: '--prism-pooling',
    value: 'conjunctive',
    bucket: 'signals',
    expected: 'conjunctive',
  },
  {
    option: 'collapseDiscount',
    flag: '--collapse-discount',
    value: '0.4',
    bucket: 'topology',
    expected: 0.4,
  },
  {
    option: 'suppressIdleTransients',
    flag: '--suppress-idle-transients',
    value: '',
    bucket: 'topology',
    expected: true,
  },
  {
    option: 'suppressNearZeroBaselineRise',
    flag: '--suppress-near-zero-baseline-rise',
    value: '',
    bucket: 'topology',
    expected: true,
  },
];

/** The engine-level value of one knob, read from whichever argument owns it. */
function engineValue(
  engine: { signals: object; topology: object },
  row: (typeof MIRRORED_KNOBS)[number],
) {
  const bucket = row.bucket === 'signals' ? engine.signals : engine.topology;
  return (bucket as Record<string, unknown>)[row.option];
}

/** The argv a row dispatches, with the value appended only when the flag takes one. */
function argvOf(row: (typeof MIRRORED_KNOBS)[number], value = row.value): string[] {
  return value === '' ? [row.flag] : [row.flag, value];
}

describe('the topological deduction pair', () => {
  it('parses the scope, refusing any value that is not one of the two', () => {
    // The scope is a MODE, not a number, so it is parsed by its union's own guard on the rule every mode flag
    // on this surface follows: a typo reproduces the shipped configuration rather than inventing one.
    expect(parseFSE26Args(['--topo-discount-scope', 'all']).topoDiscountScope).toBe('all');
    expect(parseFSE26Args(['--topo-discount-scope', 'external']).topoDiscountScope).toBe(
      'external',
    );
    expect(parseFSE26Args(['--topo-discount-scope', 'none']).topoDiscountScope).toBe(
      DEFAULT_TOPO_DISCOUNT_SCOPE,
    );
  });

  it('ships both at the values a bare dispatch resolves to', () => {
    // Bit-identity on the shipped configuration is the promise the whole axis rests on: the deduction is 0, so
    // no published number moved by adding it.
    const opts = parseFSE26Args([]);
    expect(opts.topoDiscount).toBe(0);
    expect(opts.topoDiscountScope).toBe(DEFAULT_TOPO_DISCOUNT_SCOPE);
  });
});

describe("the FSE'26 half reaches the eight knobs the golden half could state alone", () => {
  it('accepts each one, and lands it on the engine in the argument that owns it', () => {
    // The failure this replaces is loud rather than quiet on this runner — an unrecognised flag is a
    // THROWN stray token, not a silent default — so the red state is an exception rather than a wrong
    // number. Both are asserted, because "it parsed" and "it reached the engine" are different claims and
    // the second is the one the audit document's Finding 6 is about.
    for (const row of MIRRORED_KNOBS) {
      const parsed = parseFSE26Args(argvOf(row));
      expect(
        (parsed as unknown as Record<string, unknown>)[row.option],
        `${row.option} not parsed`,
      ).toEqual(row.expected);
      const engine = buildFse26EngineOptions(parsed);
      expect(engineValue(engine, row), `${row.option} did not reach the engine`).toEqual(
        row.expected,
      );
    }
  });

  it('agrees with the golden runner on EVERY row, at the engine', () => {
    // The equivalence the boundary argument needs. Comparing the two ENGINE objects rather than the two
    // parse results is deliberate: the option names are not all the same on the two surfaces, so two
    // parsers can agree field-by-field and still disagree about what the engine receives.
    for (const row of MIRRORED_KNOBS) {
      const mine = engineValue(buildFse26EngineOptions(parseFSE26Args(argvOf(row))), row);
      const golden = engineValue(buildRCAEvalEngineOptions(parseRCAEvalArgs(argvOf(row))), row);
      expect(mine, `${row.option}: the two runners disagree`).toEqual(golden);
      expect(golden, `${row.option}: the golden runner does not land it either`).toEqual(
        row.expected,
      );
    }
  });

  it('falls back the SAME way as the golden runner on a malformed value', () => {
    // A fallback is a second statement of the default, so it is a place the two halves can silently part.
    // The value-taking rows get a value neither parser can read; the two switches take none, so their
    // only malformed form is the NEGATED pole, which every runner here spells as its own flag.
    // Rows are looked up BY NAME rather than by position. The table grows every time an axis is reopened —
    // `topoDiscount` is the most recent — and a positional lookup turns each addition into a silent re-read
    // of a different knob, which is a test that keeps passing while measuring nothing.
    const rowOf = (option: string): (typeof MIRRORED_KNOBS)[number] => {
      const found = MIRRORED_KNOBS.find((candidate) => candidate.option === option);
      if (found === undefined) throw new Error(`no mirrored row named ${option}`);
      return found;
    };
    const negatives: readonly {
      row: (typeof MIRRORED_KNOBS)[number];
      bad: string;
      negated: string;
    }[] = [
      { row: rowOf('traceWeight'), bad: '1O', negated: '--no-trace-weight' },
      { row: rowOf('topoWeight'), bad: '-1', negated: '--no-topo-weight' },
      { row: rowOf('topoDiscount'), bad: '-0.5', negated: '--no-topo-discount' },
      { row: rowOf('collisionWeight'), bad: 'abc', negated: '--no-collision-weight' },
      { row: rowOf('prismWeight'), bad: '', negated: '--no-prism-weight' },
      { row: rowOf('prismPooling'), bad: 'not-a-pooling', negated: '--no-prism-pooling' },
      { row: rowOf('collapseDiscount'), bad: 'Infinity', negated: '--no-collapse-discount' },
    ];
    for (const { row, bad, negated } of negatives) {
      const mine = engineValue(buildFse26EngineOptions(parseFSE26Args([row.flag, bad])), row);
      const golden = engineValue(buildRCAEvalEngineOptions(parseRCAEvalArgs([row.flag, bad])), row);
      expect(mine, `${row.option}: the runners disagree about a malformed '${bad}'`).toEqual(
        golden,
      );
      // A value-taking knob has no negated pole: `--no-x` means "off" only for the switches, and reading it
      // as a zero weight here would turn a typo into a different experiment that still runs. Both halves
      // must refuse the spelling rather than resolve it.
      expect(() => parseFSE26Args([negated]), `${negated} was read as a value`).toThrow();
      expect(() => parseRCAEvalArgs([negated]), `${negated} was read as a value`).toThrow();
    }
    // And the switches' shipped pole, which is the value a run that says nothing is measured at. Selected
    // by TYPE, because "the switch rows" is a claim about what they hold, not about where they sit.
    for (const row of MIRRORED_KNOBS.filter(
      (candidate) => typeof candidate.expected === 'boolean',
    )) {
      const mine = engineValue(buildFse26EngineOptions(parseFSE26Args([])), row);
      const golden = engineValue(buildRCAEvalEngineOptions(parseRCAEvalArgs([])), row);
      expect(mine, `${row.option}: shipped default`).toEqual(false);
      expect(golden, `${row.option}: the golden half's shipped default`).toEqual(false);
    }
  });

  it('still REFUSES a flag it does not handle, so the reach above is not a loosened parser', () => {
    // The mirror adds eight branches to a chain whose default arm throws. A fence that only counted
    // accepted flags would be satisfied by a parser that accepted everything, so the refusal is asserted
    // in the same block as the acceptance.
    for (const row of MIRRORED_KNOBS) {
      expect(() => parseFSE26Args([`--not${row.flag}`]), `--not${row.flag} was accepted`).toThrow();
    }
  });
});

describe("the FSE'26 half's two mode flags", () => {
  it('accepts the closed set, forwards it to the fault graph, and REFUSES anything else', () => {
    // These two sit on the topology object rather than in `signals`, and they are MODES with a closed set
    // rather than weights with a fallback — so the wrong spelling has to be an error, not the default. The
    // distinction is the whole reason this block exists: an unrecognised mode that silently reproduced the
    // shipped configuration would turn a typo into an experiment that runs and reports a number.
    const modes: readonly { flag: string; values: readonly string[] }[] = [
      { flag: '--drop-deviation-mode', values: ['bounded', 'log'] },
      { flag: '--baseline-anchor', values: ['whole-file', 'pre-injection'] },
    ];
    for (const { flag, values } of modes) {
      const field = flag.slice(2).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
      for (const value of values) {
        const parsed = parseFSE26Args([flag, value]);
        expect(
          (parsed as unknown as Record<string, unknown>)[field],
          `${flag} ${value} did not parse`,
        ).toBe(value);
        const topology = buildFse26EngineOptions(parsed).topology as Record<string, unknown>;
        expect(topology[field], `${flag} ${value} did not reach the fault graph`).toBe(value);
      }
      expect(() => parseFSE26Args([flag, 'neither']), `${flag} accepted 'neither'`).toThrow(
        /expects/,
      );
      // A mode flag with no value at all is a stray token, not a value: the branch above is guarded on
      // `hasValue`, so the flag alone falls through to the same refusal every unknown argument gets.
      expect(() => parseFSE26Args([flag]), `${flag} with no value was accepted`).toThrow();
    }
  });

  it('lets the OTHER modes fall back instead — the two rules are not interchangeable', () => {
    // The two above throw on an unknown value; the gate mode does not, and it must not start. The
    // difference is measured-versus-published: `bounded|log` and `whole-file|pre-injection` are both
    // published configurations, so a typo between them is a silent re-pairing of the experiment, while an
    // unknown gate mode has no published arm to be confused with and reading it as the shipped one is the
    // only outcome that cannot invent a configuration nobody ran.
    expect(parseFSE26Args(['--dual-family-gate-mode', 'neither']).dualFamilyGateMode).toBe(
      DEFAULT_DUAL_FAMILY_GATE_MODE,
    );
    // …and the same malformed value reaches the ENGINE as the shipped mode, not as the typo. Read from
    // `signals`, which is the object the pruner's first constructor argument owns — the gate mode is a
    // ranking signal, not a fault-graph setting, and placing it in `topology` would be the silent no-op the
    // two-object split exists to make visible.
    const signals = buildFse26EngineOptions(parseFSE26Args(['--dual-family-gate-mode', 'neither']))
      .signals as unknown as Record<string, unknown>;
    expect(signals.dualFamilyGateMode).toBe(DEFAULT_DUAL_FAMILY_GATE_MODE);
  });
});
