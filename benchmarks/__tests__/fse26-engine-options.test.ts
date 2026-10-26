/**
 * Unit tests for the option-to-engine mapping.
 *
 * The property that matters: an option the runner ACCEPTS must either reach the
 * engine or be named as deliberately not reaching it. A silent drop is the worst
 * outcome available here, because the run still succeeds and the `Config:` line
 * still reports the configuration the operator asked for — so an ablation that
 * was never applied reports "no change" and is read as evidence.
 *
 * @module benchmarks/__tests__/fse26-engine-options
 */

import { describe, expect, it } from 'vitest';

import {
  ANOMALY_NORMALIZE_NODE_THRESHOLD,
  DEFAULT_FAILED_EDGE_WEIGHT,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_PRISM_POOLING,
  DEFAULT_SELF_TIME_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
} from '../../packages/tree/src/index.js';
import type { Fse26CliOptions } from '../src/fse26-cli.js';
import { parseFSE26Args } from '../src/fse26-cli.js';
import { NON_ENGINE_OPTION_KEYS, buildFse26EngineOptions } from '../src/fse26-engine-options.js';

const BASE = parseFSE26Args([]);

describe('buildFse26EngineOptions', () => {
  it('forwards the signal options the pruner is constructed with', () => {
    const engine = buildFse26EngineOptions({ ...BASE, logWeight: 0.5, logMode: 'count' });

    expect(engine.signals).toEqual({
      logWeight: 0.5,
      logSignalMode: 'count',
      // Read from BASE, which is `parseFSE26Args([])` — so this is the SHIPPED default and not a literal a
      // future flip would have to remember to edit twice.
      failedEdgeWeight: DEFAULT_FAILED_EDGE_WEIGHT,
      failedEdgeMode: 'sum',
      failedEdgeMinRecords: 1,
      latWeight: DEFAULT_LAT_WEIGHT,
      latMinRise: DEFAULT_LAT_MIN_RISE,
      poolMetricPenaltyWeight: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
      stabilityWeight: DEFAULT_STABILITY_WEIGHT,
      selfTimeWeight: DEFAULT_SELF_TIME_WEIGHT,
      temporalWeight: DEFAULT_TEMPORAL_WEIGHT,
      onsetShape: DEFAULT_ONSET_SHAPE,
      // The five the mirror of iteration 96 added, each asserted here rather than left to the
      // "accounts for EVERY parsed option" test below: that test proves an option is not SILENTLY dropped,
      // and this one proves it lands in the RIGHT object. A value forwarded into `topology` when the pruner
      // reads it from `signals` is accounted for and still a no-op, which is the defect
      // `rcaeval-engine-options.ts` records having been built to prevent.
      traceWeight: 0,
      topoWeight: 0,
      collisionWeight: 0,
      prismWeight: 0,
      prismPooling: DEFAULT_PRISM_POOLING,
    });
  });

  it('forwards the temporal prior: off by default, and the shape its own owner', () => {
    // Two fields with two different rules, and both rules matter. The WEIGHT is 0
    // today, so a silent drop would be invisible; the SHAPE is inert while the weight
    // is 0, so a silent drop would be invisible TWICE — which is exactly the class of
    // no-op this mapping file exists to make impossible.
    expect(buildFse26EngineOptions(BASE).signals.temporalWeight).toBe(DEFAULT_TEMPORAL_WEIGHT);
    expect(buildFse26EngineOptions(BASE).signals.onsetShape).toBe(DEFAULT_ONSET_SHAPE);
    expect(
      buildFse26EngineOptions({ ...BASE, temporalWeight: 0.036552 }).signals.temporalWeight,
    ).toBe(0.036552);
    expect(
      buildFse26EngineOptions({ ...BASE, onsetShape: 'earliest-only' }).signals.onsetShape,
    ).toBe('earliest-only');
  });

  it('forwards the pool-dominance penalty, inert by default', () => {
    // Inert until the +6-case window is measured rather than predicted: the mapping
    // has to carry the value the CLI parsed, and the default has to be the engine's
    // own constant — a literal here would be a second shipped configuration.
    expect(buildFse26EngineOptions(BASE).signals.poolMetricPenaltyWeight).toBe(
      DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    );
    expect(
      buildFse26EngineOptions({ ...BASE, poolMetricPenaltyWeight: 0.0679 }).signals
        .poolMetricPenaltyWeight,
    ).toBe(0.0679);
  });

  it('forwards the failed-edge-direction weight, ENROLLED at 3 by default', () => {
    // Shipped at 3 since iteration 125, on a controlled pair (Top@1 53.2% -> 56.1%, +41 cases, zero regressed
    // fault types). The forwarding is what this test is for: an option the engine receives and the config line
    // does not state is the defect the whole `signals:` line exists to prevent.
    expect(buildFse26EngineOptions(BASE).signals.failedEdgeWeight).toBe(3);
    expect(buildFse26EngineOptions({ ...BASE, failedEdgeWeight: 1 }).signals.failedEdgeWeight).toBe(
      1,
    );

    // End to end, from argv — the only path a dispatch actually takes.
    const fromArgv = buildFse26EngineOptions(parseFSE26Args(['--failed-edge-weight', '2.5']));
    expect(fromArgv.signals.failedEdgeWeight).toBe(2.5);
  });

  it('forwards the failed-edge AGGREGATION, shipped as sum', () => {
    // The aggregation changes which service the signal votes for, so a dropped
    // value would run the measured `sum` while the `Config:` line reported
    // `mean` — the same silent swap this file exists to prevent.
    expect(buildFse26EngineOptions(BASE).signals.failedEdgeMode).toBe('sum');
    expect(
      buildFse26EngineOptions({ ...BASE, failedEdgeMode: 'mean' }).signals.failedEdgeMode,
    ).toBe('mean');

    const fromArgv = buildFse26EngineOptions(parseFSE26Args(['--failed-edge-mode', 'mean']));
    expect(fromArgv.signals.failedEdgeMode).toBe('mean');
  });

  it('forwards the failed-edge evidence floor, shipped as 1', () => {
    // A dropped floor would run the unguarded signal while the `Config:` line
    // reported the guarded one — the silent swap this file exists to prevent.
    expect(buildFse26EngineOptions(BASE).signals.failedEdgeMinRecords).toBe(1);
    expect(
      buildFse26EngineOptions({ ...BASE, failedEdgeMinRecords: 2 }).signals.failedEdgeMinRecords,
    ).toBe(2);

    const fromArgv = buildFse26EngineOptions(parseFSE26Args(['--failed-edge-min-records', '3']));
    expect(fromArgv.signals.failedEdgeMinRecords).toBe(3);
  });

  it('forwards the latency weight, shipped at the measured zero-regression point', () => {
    // ON by default, unlike the failed-edge signal: this term's weight was solved
    // against the kill criterion's second half and then measured, so the shipped
    // configuration carries it. A dropped weight would run the 673-case ablation
    // while the `Config:` line reported the 694-case default.
    expect(buildFse26EngineOptions(BASE).signals.latWeight).toBe(DEFAULT_LAT_WEIGHT);
    expect(DEFAULT_LAT_WEIGHT).toBeGreaterThan(0);
    // The ablation stays reachable, and it is a DIFFERENT configuration.
    expect(buildFse26EngineOptions({ ...BASE, latWeight: 0 }).signals.latWeight).toBe(0);
    expect(buildFse26EngineOptions({ ...BASE, latWeight: 0.75 }).signals.latWeight).toBe(0.75);

    // End to end, from argv — the only path a dispatch actually takes, for both the
    // shipped default and the ablation.
    expect(buildFse26EngineOptions(parseFSE26Args([])).signals.latWeight).toBe(DEFAULT_LAT_WEIGHT);
    expect(buildFse26EngineOptions(parseFSE26Args(['--lat-weight', '0'])).signals.latWeight).toBe(
      0,
    );
    expect(
      buildFse26EngineOptions(parseFSE26Args(['--lat-weight', '0.75'])).signals.latWeight,
    ).toBe(0.75);
  });

  it('forwards the latency rise floor, shipped at the value the pair was measured with', () => {
    // A dropped floor would run the credited-everything shape while the `Config:` line
    // reported the masked one — the silent swap this file exists to prevent, and here
    // it would be worth 77 cases at the shipped weight.
    expect(buildFse26EngineOptions(BASE).signals.latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    expect(buildFse26EngineOptions({ ...BASE, latMinRise: 1 }).signals.latMinRise).toBe(1);

    const fromArgv = buildFse26EngineOptions(parseFSE26Args(['--lat-min-rise', '12']));
    expect(fromArgv.signals.latMinRise).toBe(12);
  });

  it('forwards rank normalization, which is load-bearing on the large topologies', () => {
    expect(buildFse26EngineOptions(BASE).topology.rankNormalization).toBe(true);
    expect(
      buildFse26EngineOptions({ ...BASE, rankNormalization: false }).topology.rankNormalization,
    ).toBe(false);
  });

  it('forwards each ablation switch, at its parsed value', () => {
    expect(buildFse26EngineOptions(BASE).topology.metricRiseCeiling).toBe(0);
    expect(buildFse26EngineOptions(BASE).topology.metricFleetBaseline).toBe(false);

    expect(
      buildFse26EngineOptions({ ...BASE, metricRiseCeiling: 20 }).topology.metricRiseCeiling,
    ).toBe(20);
    expect(
      buildFse26EngineOptions({ ...BASE, metricFleetBaseline: true }).topology.metricFleetBaseline,
    ).toBe(true);
  });

  it('forwards the switches end to end, from argv to the engine arguments', () => {
    // The whole point: `--rise-ceiling 20` on a real dispatch has to reach the
    // constructor, not merely parse.
    const engine = buildFse26EngineOptions(
      parseFSE26Args(['--rise-ceiling', '20', '--fleet-baseline', '--no-rank-normalization']),
    );

    expect(engine.topology).toEqual({
      rankNormalization: false,
      // The axis's POPULATION, and it travels with the boolean rather than beside it: the two are read as
      // one configuration, because a reader holding only `rankNormalization: false` cannot tell which cases
      // the flag could have acted on.
      anomalyNormalizeNodeThreshold: ANOMALY_NORMALIZE_NODE_THRESHOLD,
      metricRiseCeiling: 20,
      metricFleetBaseline: true,
      // …and the three the mirror added to THIS object, on the split's own rule: these are arguments to the
      // fault-graph builder rather than to the ranking fusion, so `collapseDiscount` and the two suppression
      // switches belong beside `rankNormalization` and not beside the weights.
      collapseDiscount: 0,
      suppressIdleTransients: false,
      suppressNearZeroBaselineRise: false,
      // The zero-baseline transport guard, at its shipped pole — a GUARD rather than a weight, so it states
      // `false` here like its two neighbours.
      suppressZeroBaselineLatency: false,
      capTrendBonusAtDeviation: false,
      // The demand guard, at its shipped pole on a dispatch that says nothing about it — and the assertion is
      // that a value the parser never touched still REACHES the builder, which is what this test is for.
      suppressDemandMetrics: true,
      // The anomaly composition, at its shipped values on a dispatch that says nothing about them. The breadth
      // term is the interesting one: it ships OFF, and this assertion is what makes "OFF" a value that reaches
      // the builder rather than a field the mapping remembered to omit.
      anomalyTrendWeight: 0.15,
      // REMOVED in iteration 137, and it is the field this assertion was built for: the burst coefficient now
      // ships at 0, so "the default reaches the builder" is a claim about ZERO — the value a dropped field
      // would also produce. The sweep that removed it is in the constant's own docblock.
      anomalyBurstWeight: 0,
      anomalyCvWeight: 0.05,
      anomalyBreadthWeight: 0.05,
      anomalyBreadthGate: 0.8,
    });
  });

  it('accounts for EVERY parsed option: forwarded to the engine, or named as not', () => {
    // The guard against a silent drop. A new CLI option fails here until it is
    // wired into `buildFse26EngineOptions` or added to `NON_ENGINE_OPTION_KEYS`
    // with a reason — which is the only moment anyone is thinking about it.
    const engine = buildFse26EngineOptions(BASE);
    const forwarded = new Set([...Object.keys(engine.signals), ...Object.keys(engine.topology)]);
    // The two objects use different names for the same option; map them.
    const aliases: Readonly<Record<string, string>> = { logMode: 'logSignalMode' };
    const accounted = new Set([...forwarded, ...NON_ENGINE_OPTION_KEYS, ...Object.values(aliases)]);

    const unaccounted = Object.keys(BASE).filter(
      (key) => !accounted.has(key) && !accounted.has(aliases[key] ?? ''),
    );
    expect(unaccounted).toEqual([]);
  });

  it('names only real options as not-engine, so the list cannot rot', () => {
    // A stale name in the list would silently widen the exclusion above.
    const keys = new Set(Object.keys(BASE));
    for (const key of NON_ENGINE_OPTION_KEYS) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it('does not leak a run-harness option into the engine arguments', () => {
    const engine = buildFse26EngineOptions({
      ...BASE,
      dataDir: '/tmp/x',
      maxCases: 5,
      output: 'out.json',
      diagnose: ['JVMMemoryStress'],
      diagnoseLimit: 2,
      dropMetrics: ['queueSize'],
    });

    for (const key of NON_ENGINE_OPTION_KEYS) {
      expect(Object.keys(engine.topology)).not.toContain(key);
      expect(Object.keys(engine.signals)).not.toContain(key);
    }
  });

  it('is a pure function of its input', () => {
    const opts: Fse26CliOptions = { ...BASE, metricFleetBaseline: true };
    expect(buildFse26EngineOptions(opts)).toEqual(buildFse26EngineOptions(opts));
  });
});
