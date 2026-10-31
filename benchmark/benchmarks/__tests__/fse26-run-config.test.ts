/**
 * The reported configuration may not disagree with the configuration that was RUN.
 *
 * ## The defect
 *
 * Run `41053711414` was dispatched as `ranking_knobs=topo_closure=sum`. The workflow translated it to
 * `--topo-closure sum`, the parser accepted it, `buildFse26EngineOptions` forwarded it, the engine aggregated
 * the deduction by `sum` — and the run's own header printed
 *
 *     … topoDiscountGate=1 topoClosure=max
 *
 * because the record the line is rendered from is built inline in `run-fse26.ts`'s `main()` and never copied
 * the field, and `formatFSE26ConfigLine` renders an absent `topoClosure` as the shipped default. Nine
 * characters of label, and every number in that artifact belongs to the wrong configuration. This is the
 * failure `ablation-engine-options.test.ts` calls "a label asserting a configuration the run did not have",
 * arriving from the opposite direction: there a weight never reached the engine, here an option never
 * reached the label.
 *
 * ## Why the existing guards did not cover it
 *
 * `fse26-engine-options.test.ts` asks whether every parsed option reaches the ENGINE, and names
 * `NON_ENGINE_OPTION_KEYS` for the ones that deliberately do not. Nothing asked the same question about the
 * RECORD, and the record was not callable from a test, so the question could not be put. The golden half was
 * immune by construction: `rcaeval-engine-options.ts` renders its line straight from the parsed options, so
 * there is no second object for it to fall out of step with.
 *
 * ## What is asserted
 *
 * The two projections of one input must agree: **every option the engine receives is an option the artifact
 * states, at the same value**, and every option the runner accepts is either stated or named as a harness
 * switch. Both are key-set sweeps rather than hand-written lists, so a knob added tomorrow fails these tests
 * before it can be dispatched — which is the only moment anyone is thinking about it.
 *
 * @module benchmarks/__tests__/fse26-run-config
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TOPO_CLOSURE } from '../../packages/tree/src/index.js';
import type { Fse26CliOptions } from '../src/fse26-cli.js';
import { parseFSE26Args } from '../src/fse26-cli.js';
import { buildFse26EngineOptions } from '../src/fse26-engine-options.js';
import { formatFSE26ConfigLine } from '../src/fse26-report.js';
import { buildFse26RunConfig, NOT_REPORTED_FSE26_OPTION_KEYS } from '../src/fse26-run-config.js';

const BASE = parseFSE26Args([]);

/**
 * Every dispatchable knob at a value that is NOT its default, spelled as the workflow spells it.
 *
 * The point of the non-default values is that a field copied from the wrong source would read the default:
 * `--topo-closure sum` against a shipped `max` is the case that found this defect, and the same shape is
 * available for each of the others.
 */
const KNOBBED = parseFSE26Args([
  '--log-weight',
  '0.5',
  '--log-mode',
  'all',
  '--no-rank-normalization',
  '--anomaly-normalize-threshold',
  '7',
  '--rise-ceiling',
  '0',
  '--fleet-baseline',
  '--failed-edge-min-records',
  '4',
  '--failed-edge-mode',
  'mean',
  '--failed-edge-weight',
  '1',
  '--lat-weight',
  '0',
  '--lat-min-rise',
  '20.5',
  '--pool-penalty',
  '0.5',
  '--stability-weight',
  '0.5',
  '--self-time-weight',
  '0.25',
  '--self-anomaly-weight',
  '0',
  '--victim-weight',
  '0.5',
  '--dual-family-weight',
  '0',
  '--dual-family-gate',
  '0',
  '--dual-family-gate-mode',
  'min',
  '--temporal-weight',
  '0.5',
  '--onset-shape',
  'order',
  '--trace-weight',
  '2',
  '--trace-skips-leader',
  '--topo-weight',
  '0.5',
  '--topo-discount',
  '0.5',
  '--topo-discount-scope',
  'all',
  '--topo-discount-gate',
  '0',
  '--topo-closure',
  'sum',
  '--collision-weight',
  '0.5',
  '--prism-weight',
  '0.5',
  '--prism-pooling',
  'conjunctive',
  '--anomaly-trend-weight',
  '0',
  '--anomaly-burst-weight',
  '0.5',
  '--anomaly-cv-weight',
  '0',
  '--anomaly-breadth-weight',
  '0',
  '--anomaly-breadth-gate',
  '0.5',
  '--collapse-discount',
  '0.5',
  '--drop-deviation-mode',
  'log',
  '--baseline-anchor',
  'pre-injection',
  '--suppress-demand-metrics',
  '--suppress-idle-transients',
  '--suppress-near-zero-baseline-rise',
  '--suppress-zero-baseline-latency',
  '--cap-trend-bonus-at-deviation',
]);

/** The options that describe the INVOCATION; each must still be named, not merely dropped. */
const HARNESS = {
  dataDir: '/tmp/corpus',
  maxCases: 5,
  output: 'out.json',
  diagnose: ['JVMMemoryStress'],
  diagnoseLimit: 2,
  diagnoseDecimals: 3,
} as const;

const ARMS: ReadonlyArray<readonly [string, Fse26CliOptions]> = [
  ['shipped defaults', BASE],
  ['every knob off its default', KNOBBED],
  ['the harness switches as well', { ...KNOBBED, ...HARNESS }],
];

describe('buildFse26RunConfig', () => {
  describe('the engine and the record are two projections of one input', () => {
    for (const [arm, opts] of ARMS) {
      it(`states every option the engine receives, at the same value — ${arm}`, () => {
        const engine = buildFse26EngineOptions(opts);
        const config: Record<string, unknown> = { ...buildFse26RunConfig(opts) };

        // Key-set sweep, not a hand-written list: `topoClosure` failed exactly here before the fix, with the
        // engine holding `sum` and the record holding nothing.
        const forwarded = { ...engine.signals, ...engine.topology } as Record<string, unknown>;
        for (const [key, value] of Object.entries(forwarded)) {
          expect({ key, stated: key in config, value: config[key] }).toEqual({
            key,
            stated: true,
            value,
          });
        }
      });
    }

    it('names `topoClosure` on the record even when it holds the shipped default', () => {
      // The field is optional on the READ-BACK type so that an artifact written before it existed still
      // parses; a producer that relies on that leniency publishes a `sum` run labelled `max`.
      const config = buildFse26RunConfig(BASE);
      expect('topoClosure' in config).toBe(true);
      expect(config.topoClosure).toBe(DEFAULT_TOPO_CLOSURE);
    });

    it('renders the closure it was GIVEN, from argv to the header line', () => {
      // End to end, in the shape the dispatch takes: this is the assertion run `41053711414` would have
      // failed.
      const line = formatFSE26ConfigLine(buildFse26RunConfig(KNOBBED));
      expect(line).toContain('topoClosure=sum');
      expect(formatFSE26ConfigLine(buildFse26RunConfig(BASE))).toContain(
        `topoClosure=${DEFAULT_TOPO_CLOSURE}`,
      );
    });
  });

  describe('every accepted option is accounted for', () => {
    it('is either stated on the record or named as a harness switch', () => {
      const stated = new Set(Object.keys(buildFse26RunConfig(BASE)));
      // The one alias: the option is called `logMode` on the command line and `logSignalMode` everywhere the
      // engine and the artifact name it.
      const aliases: Readonly<Record<string, string>> = { logMode: 'logSignalMode' };
      const excluded = new Set<string>([
        ...NOT_REPORTED_FSE26_OPTION_KEYS,
        ...Object.values(aliases),
      ]);

      const unaccounted = Object.keys(BASE).filter(
        (key) => !stated.has(key) && !excluded.has(key) && !excluded.has(aliases[key] ?? ''),
      );
      expect(unaccounted).toEqual([]);
    });

    it('names only real options as not-reported, so the list cannot rot', () => {
      const keys = new Set(Object.keys(BASE));
      for (const key of NOT_REPORTED_FSE26_OPTION_KEYS) expect(keys.has(key)).toBe(true);
    });

    it('does not leak a harness switch onto the record', () => {
      const config: Record<string, unknown> = { ...buildFse26RunConfig({ ...BASE, ...HARNESS }) };
      for (const key of Object.keys(HARNESS)) expect(key in config).toBe(false);
      // …while the one switch that changes the RANKING is stated, because two runs that drop different
      // metrics are not the same configuration.
      expect(config['dropMetrics']).toEqual([...BASE.dropMetrics]);
    });

    it('reports each knob at its parsed value rather than at the shipped one', () => {
      // `Object.entries` rather than an index-signature cast: the record is a typed interface, and the
      // question here is genuinely "which fields differ", so reading it as a map is the honest view.
      const config = new Map(Object.entries(buildFse26RunConfig(KNOBBED)));
      const shipped = new Map(Object.entries(buildFse26RunConfig(BASE)));
      const moved = [...config.keys()].filter(
        (key) => JSON.stringify(config.get(key)) !== JSON.stringify(shipped.get(key)),
      );
      // Every option the knobbed argv names must move. A count rather than a list keeps this from
      // duplicating the argv above, while still failing if a copy silently reads the default.
      expect(moved.length).toBeGreaterThanOrEqual(30);
      expect(moved).toContain('topoClosure');
      expect(moved).toContain('logSignalMode');
      expect(moved).toContain('onsetShape');
    });
  });

  it('is a pure function of its input, so two renderings cannot straddle a mutation', () => {
    const opts: Fse26CliOptions = { ...KNOBBED };
    expect(buildFse26RunConfig(opts)).toEqual(buildFse26RunConfig(opts));
    expect(buildFse26RunConfig(opts)).not.toBe(buildFse26RunConfig(opts));
  });
});
