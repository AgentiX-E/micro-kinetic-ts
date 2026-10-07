/**
 * Guards on the ABLATION artifact's configuration — the register's ablation reference.
 *
 * ## The defect
 *
 * `ablation-re1-results` printed `Running: BASELINE (all OFF)` and a JSON record of twelve BOOLEANS, and
 * **not one weight**. That file is what the register reads a feature's worth from, and a reader could not
 * reconstruct a single run from it:
 *
 * - the flags are the study's INPUTS; the run is decided by the numbers they map to
 *   (`flags.logSignal ? 1.0 : 0.0`), and that mapping lived only in `run-ablation.ts` — a file that calls
 *   `main()` at import time and is therefore importable by nothing;
 * - six weights were named by neither the flags nor the artifact, because the construction site did not
 *   pass them: `latWeight`, `latMinRise`, `poolMetricPenaltyWeight`, `stabilityWeight`, `temporalWeight`
 *   and `onsetShape` fell through to `DEFAULT_TREE_PRUNER_OPTIONS`;
 * - so the row labelled `BASELINE (all OFF)` ran with the four terms that dominate the shipped ranking ON.
 *   The label asserted a configuration the run did not have, which is the same failure as a document that
 *   outlives its correction — in an artifact, where a reader takes it for data.
 *
 * This is `REPORTED_CONFIG_FIELDS`' own stated consequence, on the third artifact to need it: *an artifact
 * that omits one cannot be compared with another artifact; the difference is unexplained.*
 *
 * ## What the repair does not change
 *
 * The six terms are now passed explicitly from their owner constants. Their values are byte-identical to the
 * defaults they already received, so **no measurement may move** — the change is that the artifact can state
 * them. `formatAblationConfigLine` is that statement, rendered in the shape the golden half's artifact uses
 * so one reader covers both.
 *
 * @module benchmarks/__tests__/ablation-engine-options
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_LOG_SIGNAL_MODE,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
} from '../../packages/tree/src/index.js';

import {
  buildAblationEngineOptions,
  formatAblationConfigLine,
  type AblationFeatureFlags,
} from '../src/ablation-engine-options.js';
import { REPORTED_CONFIG_FIELDS } from '../src/fse26-report.js';
import { UNREPORTED_BY_ENGINE_RUNNERS } from '../src/reported-config.js';
import { PRUNER_OPTION_MEMBERS, TOPOLOGY_MEMBERS, namedOn } from './helpers/engine-interfaces.js';

/** Every flag off — the configuration the artifact used to label `BASELINE (all OFF)`. */
const ALL_OFF: AblationFeatureFlags = {
  collisionAggregation: false,
  traceAugmentation: false,
  selfLearning: false,
  logSignal: false,
  topoSignal: false,
  collisionSignal: false,
  collapseDiscount: false,
  riseSignal: false,
  traceSignal: false,
  rankNormalization: false,
  suppressIdleTransients: false,
  prismSignal: false,
};

/** The same flags with every ENGINE-visible one turned on. */
const ALL_ON: AblationFeatureFlags = {
  ...ALL_OFF,
  collisionAggregation: true,
  logSignal: true,
  topoSignal: true,
  collisionSignal: true,
  collapseDiscount: true,
  riseSignal: true,
  traceSignal: true,
  rankNormalization: true,
  suppressIdleTransients: true,
  prismSignal: true,
};

const off = buildAblationEngineOptions(ALL_OFF);
const on = buildAblationEngineOptions(ALL_ON);

describe('the ablation engine arguments are the two objects the constructor takes', () => {
  it('sends only TreePrunerOptions members in the first argument', () => {
    const foreign = Object.keys(off.signals).filter((key) => !PRUNER_OPTION_MEMBERS.includes(key));
    expect(
      foreign,
      'a field the engine option type does not declare is inert in the FIRST argument',
    ).toEqual([]);
    expect(Object.keys(off.signals).length).toBeGreaterThanOrEqual(14);
  });

  it('sends only TopologyFaultGraphConfig members in the second argument', () => {
    const foreign = Object.keys(off.topology).filter((key) => !TOPOLOGY_MEMBERS.includes(key));
    expect(foreign, 'the second argument takes topology fields only').toEqual([]);
    const signals = new Set(Object.keys(off.signals));
    for (const key of Object.keys(off.topology)) {
      expect(signals.has(key), `${key} is in BOTH arguments`).toBe(false);
    }
    expect(Object.keys(off.topology).length).toBeGreaterThanOrEqual(3);
  });
});

describe('the ablation artifact states the configuration it ran', () => {
  it('names exactly the options it forwards, in both directions', () => {
    const named = namedOn(formatAblationConfigLine(ALL_OFF)).sort();
    const forwarded = [...Object.keys(off.signals), ...Object.keys(off.topology)].sort();
    // Both directions in one equality: a forwarded option the line omits is a run nobody can reconstruct,
    // and a name the line invents is a configuration nobody ran.
    expect(named).toEqual(forwarded);
    expect(named.length).toBeGreaterThanOrEqual(17);
  });

  it('names every reported field whose shipped value is non-zero, or exempts it with a reason', () => {
    // The repository's declared standard, applied to the artifact that had none of it. The exemption record
    // is SHARED with the golden half: both runners reach the engine through `TreePruner`, so both are
    // inapplicable to the same six fields for the same reasons, and two copies would be two answers.
    const named = new Set(namedOn(formatAblationConfigLine(ALL_OFF)));
    const exempt = new Set(Object.keys(UNREPORTED_BY_ENGINE_RUNNERS));
    const namedReported = REPORTED_CONFIG_FIELDS.filter((field) => named.has(field));
    expect([...namedReported, ...exempt].sort()).toEqual([...REPORTED_CONFIG_FIELDS].sort());
    for (const field of namedReported) {
      expect(exempt.has(field), `${field} is both printed and exempt`).toBe(false);
    }
    for (const [field, reason] of Object.entries(UNREPORTED_BY_ENGINE_RUNNERS)) {
      expect(reason.length, `${field}'s reason`).toBeGreaterThan(40);
    }
  });

  it('names the six terms the study holds at the shipped value, from their owners', () => {
    // The defect this file exists for: these six were in neither the flags nor the artifact, so the row
    // could not be attributed. Each is now named AND taken from its constant, so a moved default moves the
    // artifact with it instead of leaving it describing a configuration the engine no longer ships.
    const line = formatAblationConfigLine(ALL_OFF);
    for (const [name, value] of [
      ['logSignalMode', DEFAULT_LOG_SIGNAL_MODE],
      ['latWeight', DEFAULT_LAT_WEIGHT],
      ['latMinRise', DEFAULT_LAT_MIN_RISE],
      ['poolMetricPenaltyWeight', DEFAULT_POOL_METRIC_PENALTY_WEIGHT],
      ['stabilityWeight', DEFAULT_STABILITY_WEIGHT],
      ['temporalWeight', DEFAULT_TEMPORAL_WEIGHT],
      ['onsetShape', DEFAULT_ONSET_SHAPE],
    ] as const) {
      expect(line, `${name} is named`).toContain(`${name}=${String(value)}`);
    }
  });

  it('shows that the row it calls BASELINE is not a configuration with everything off', () => {
    // The claim the old label made, measured: with every flag off, the four terms that dominate the shipped
    // ranking are still ON, because they are inherited and the label cannot turn them off.
    const line = formatAblationConfigLine(ALL_OFF);
    for (const name of ['latWeight', 'latMinRise', 'poolMetricPenaltyWeight', 'stabilityWeight']) {
      expect(line, `${name} is ON in the base row`).not.toContain(`${name}=0 `);
    }
    expect(line).toContain(`latWeight=${DEFAULT_LAT_WEIGHT}`);
    // And the flags the study DOES drive are off in that row, so the line distinguishes the two.
    expect(line).toContain('logWeight=0');
    expect(line).toContain('traceWeight=0');
    expect(line).toContain('collisionWeight=0');
  });

  it('renders the line from the flags alone, so the artifact and the run cannot diverge', () => {
    expect(formatAblationConfigLine(ALL_OFF)).toBe(formatAblationConfigLine({ ...ALL_OFF }));
    // A flag that changes a weight changes that field and nothing else's VALUE.
    expect(formatAblationConfigLine(ALL_ON)).toContain('logWeight=1');
    expect(formatAblationConfigLine(ALL_ON)).toContain('traceWeight=1');
    expect(formatAblationConfigLine(ALL_ON)).toContain('rankNormalization=true');
    // The PRISM sweep's override is the one field a sweep point changes.
    expect(
      formatAblationConfigLine({ ...ALL_OFF, prismSignal: true }, { prismWeight: 0.35 }),
    ).toContain('prismWeight=0.35');
    expect(formatAblationConfigLine({ ...ALL_OFF, prismSignal: true })).toContain('prismWeight=1');
    expect(formatAblationConfigLine(ALL_OFF)).toContain('prismWeight=0');
    // And the two configurations really differ, so the join above is not comparing a line to itself.
    expect(formatAblationConfigLine(ALL_ON)).not.toBe(formatAblationConfigLine(ALL_OFF));
    expect(on.signals.logWeight).toBe(1);
    expect(off.signals.logWeight).toBe(0);
  });
});

describe('the weights the study VARIES, as opposed to the flags it switches', () => {
  // Twelve flags each map to `1.0` or `0.0`, so the battery could not express a question about a term whose
  // SHIPPED weight is neither — and the three that dominate the ranking are exactly those. `latWeight`
  // (0.561495) is the one varied here first, because it is the only one of the three whose input did not
  // exist on the RCAEval path at all: it multiplied an empty map in every row of every previous battery.

  it('honours an override of ZERO, which `||` could not', () => {
    // THE ASSERTION THIS WHOLE INTERFACE EXISTS FOR. The value an override most needs to express is zero —
    // "turn this term off" — and a falsy check silently returns the shipped weight instead, so the row
    // labelled `LAT OFF` would measure the term ON. The failure is invisible: the line would print
    // `latWeight=0.561495` and the row would be a duplicate of the baseline wearing a different label.
    expect(buildAblationEngineOptions(ALL_OFF, { latWeight: 0 }).signals.latWeight).toBe(0);
    expect(buildAblationEngineOptions(ALL_OFF, { latMinRise: 0 }).signals.latMinRise).toBe(0);
    expect(formatAblationConfigLine(ALL_OFF, { latWeight: 0 })).toContain('latWeight=0 ');
  });

  it('leaves every field it was not given at its owner constant', () => {
    // An override is a POINT in the space, not a new configuration: the term it does not name must still be
    // the shipped one, or a row would differ from its siblings in more than the knob it is about.
    const overridden = buildAblationEngineOptions(ALL_OFF, { latWeight: 0 }).signals;
    expect(overridden.latMinRise).toBe(DEFAULT_LAT_MIN_RISE);
    expect(overridden.poolMetricPenaltyWeight).toBe(DEFAULT_POOL_METRIC_PENALTY_WEIGHT);
    expect(overridden.stabilityWeight).toBe(DEFAULT_STABILITY_WEIGHT);
    expect(overridden.logSignalMode).toBe(DEFAULT_LOG_SIGNAL_MODE);
    expect(overridden.onsetShape).toBe(DEFAULT_ONSET_SHAPE);
    // And the no-override case is the identical object, so "not overridden" is not a second code path.
    expect(buildAblationEngineOptions(ALL_OFF)).toEqual(buildAblationEngineOptions(ALL_OFF, {}));
  });

  it('changes the named field and NOTHING else, so a row moves for one reason', () => {
    const base = buildAblationEngineOptions(ALL_OFF);
    const floorless = buildAblationEngineOptions(ALL_OFF, { latMinRise: 1 });
    const differing = Object.keys(base.signals).filter(
      (k) =>
        base.signals[k as keyof typeof base.signals] !==
        floorless.signals[k as keyof typeof floorless.signals],
    );
    expect(differing).toEqual(['latMinRise']);
    expect(floorless.topology).toEqual(base.topology);
  });

  it('states the overridden value on the line, so the artifact cannot describe the wrong run', () => {
    // The configuration line is the only thing a reader has; `REPORTED_CONFIG_FIELDS`' own consequence.
    const line = formatAblationConfigLine(ALL_OFF, { latWeight: 0, latMinRise: 1 });
    expect(line).toContain('latWeight=0 ');
    expect(line).toContain('latMinRise=1 ');
    // The floor's removal is spelled `1`, and that is the engine's own reference point rather than a number
    // chosen here: `computeEdgeLatencyScores` documents `1` as identical to the pre-floor term.
    expect(line).not.toContain('latMinRise=10.3');
  });
});

describe('the battery really carries the propagation-channel rows', () => {
  // Source-shape, because `run-ablation.ts` calls `main()` at import time and is importable by nothing. A
  // row that was written and then lost in a refactor is exactly the failure this guards: the term would be
  // unmeasured again, and the artifact would look complete.
  const RUNNER = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/run-ablation.ts'),
    'utf8',
  );

  it('has all four cells of the 2x2 — the shipped one being the baseline row it already had', () => {
    expect(RUNNER, 'the channel OFF').toContain('latWeight: 0');
    expect(RUNNER, 'the floor removed').toContain('latMinRise: 1');
    expect(RUNNER, 'and both, to separate the two knobs from their interaction').toContain(
      'latWeight: 0, latMinRise: 1',
    );
    // The shipped cell is the baseline, so it must still hold the shipped weight.
    expect(formatAblationConfigLine(ALL_OFF)).toContain(`latWeight=${DEFAULT_LAT_WEIGHT}`);
  });

  it('holds the flags IDENTICAL across the three rows, so a difference is the weight', () => {
    // The rows spread the same twelve booleans from one named constant. A row that differed in a flag would
    // attribute that flag's effect to a weight, which is the one thing a numeric ablation must not do.
    const rows = RUNNER.split('flags: { ...ALL_OFF_FLAGS }').length - 1;
    expect(rows, 'three rows spread the shared constant').toBe(3);
    expect(RUNNER, 'and it is defined once').toContain('const ALL_OFF_FLAGS: FeatureFlags = {');
  });

  it('threads the override through the container factory, not only through the printed line', () => {
    // A line that states an override the engine never received is worse than no line: it is a false record.
    expect(RUNNER).toContain('buildContainer(config.flags, config.weights)');
    expect(RUNNER).toContain('buildAblationEngineOptions(flags, overrides)');
    expect(RUNNER).toContain('buildContainer(PRISM_SWEEP_FLAGS, { prismWeight: weight })');
  });

  it('attaches BOTH direction inputs, so a weight on either is measurable', () => {
    // The defect this iteration repaired: the loader attached `failedTraceEdges` and never `edgeLatency`,
    // so the shipped `latWeight` multiplied an empty map in every row — and a weight times an empty map is
    // zero whether the term is useful or not.
    expect(RUNNER).toContain('countDirectionalInputs(');
    expect(RUNNER).toContain('edgeLatency: directional.edgeLatency');
    expect(RUNNER).toContain('failedTraceEdges: directional.failedTraceEdges');
    expect(RUNNER, 'one read, not two').not.toContain('countFailedTraceEdges(');
  });

  it('reports the coverage of those inputs, so a zero can be read as starved or inert', () => {
    expect(RUNNER).toContain('summarizeDirectionalCoverage(bundle.cases)');
    expect(RUNNER).toContain('formatDirectionalCoverage(');
  });
});
