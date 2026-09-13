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

import type { Fse26CliOptions } from '../src/fse26-cli.js';
import { parseFSE26Args } from '../src/fse26-cli.js';
import { NON_ENGINE_OPTION_KEYS, buildFse26EngineOptions } from '../src/fse26-engine-options.js';

const BASE = parseFSE26Args([]);

describe('buildFse26EngineOptions', () => {
  it('forwards the signal options the pruner is constructed with', () => {
    const engine = buildFse26EngineOptions({ ...BASE, logWeight: 0.5, logMode: 'count' });

    expect(engine.signals).toEqual({ logWeight: 0.5, logSignalMode: 'count' });
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
      metricRiseCeiling: 20,
      metricFleetBaseline: true,
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
