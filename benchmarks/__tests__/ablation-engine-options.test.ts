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
  DEFAULT_PRISM_POOLING,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  isPrismPooling,
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
  extraTraceValidation: false,
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

describe('the second PRISM knob, which is not a weight', () => {
  // The record was called `AblationWeightOverrides` and every member was a number. The pooling is the
  // member that made the name untrue, and keeping it out is what the engine did: `combinePrismScore`
  // takes both poolings and the standalone evaluator dispatches them (`run-prism.ts --pooling
  // conjunctive`), while no engine run, battery row or dispatch could select the second one — the call
  // site omitted the argument. A record whose name promised numbers would have had to leave the axis
  // outside the study, which is the state being repaired.

  it('takes the overridden pooling, and only when the row names one', () => {
    expect(
      buildAblationEngineOptions(ALL_OFF, { prismPooling: 'conjunctive' }).signals.prismPooling,
    ).toBe('conjunctive');
    // `??` rather than `||`, for the same reason the weights use it: one reading of the record for
    // every field beats two, and a `||` reintroduces a falsy-discards-the-override path the moment a
    // pooling is ever spelled `''`.
    expect(buildAblationEngineOptions(ALL_OFF).signals.prismPooling).toBe(DEFAULT_PRISM_POOLING);
    expect(isPrismPooling(DEFAULT_PRISM_POOLING)).toBe(true);
  });

  it('changes the named field and NOTHING else, so a pooling row moves for one reason', () => {
    // The property that makes the delta attributable to the pooling: the flags are identical and the
    // only differing field is the one the row is about. A row that retyped twelve booleans would
    // attribute a flag's effect to the pooling.
    const base = buildAblationEngineOptions(ALL_OFF);
    const conjunctive = buildAblationEngineOptions(ALL_OFF, { prismPooling: 'conjunctive' });
    const differing = Object.keys(base.signals).filter(
      (k) =>
        base.signals[k as keyof typeof base.signals] !==
        conjunctive.signals[k as keyof typeof conjunctive.signals],
    );
    expect(differing).toEqual(['prismPooling']);
    expect(conjunctive.topology).toEqual(base.topology);
  });

  it('states the overridden pooling on the line, so the artifact cannot describe the wrong run', () => {
    // The configuration line is the only thing a reader has; `REPORTED_CONFIG_FIELDS`' own consequence.
    const line = formatAblationConfigLine(ALL_OFF, { prismPooling: 'conjunctive' });
    expect(line).toContain('prismPooling=conjunctive');
    expect(formatAblationConfigLine(ALL_OFF)).toContain(`prismPooling=${DEFAULT_PRISM_POOLING}`);
    // And the two lines really differ, so the assertion above is not comparing a line to itself.
    expect(formatAblationConfigLine(ALL_OFF, { prismPooling: 'conjunctive' })).not.toBe(
      formatAblationConfigLine(ALL_OFF),
    );
  });

  it('is inert while the signal is off, which is why the rows must also carry the flag', () => {
    // The one override here whose effect the weight gates. A row that varied the pooling with
    // `prismSignal: false` would move nothing and read as a measurement that the pooling does not
    // matter — which is why the two rows in the battery are the ADDITIVE rows' siblings, flags and all.
    expect(
      buildAblationEngineOptions(ALL_OFF, { prismPooling: 'conjunctive' }).signals.prismWeight,
    ).toBe(0);
    expect(
      buildAblationEngineOptions({ ...ALL_OFF, prismSignal: true }, { prismPooling: 'conjunctive' })
        .signals.prismWeight,
    ).toBe(1);
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
    //
    // THIS TEST USED TO COUNT THE SPREAD GLOBALLY and expect three. Iteration 73 added a second numeric group
    // — the two priors the battery had never varied — and made the global count six, which is a correct
    // failure of an assertion whose encoding had stopped describing the group it names. The property is
    // per-group, and the group is identified by its overrides:
    for (const override of [
      'latWeight: 0',
      'latMinRise: 1',
      'latWeight: 0, latMinRise: 1',
      'poolMetricPenaltyWeight: 0',
      'stabilityWeight: 0',
      'poolMetricPenaltyWeight: 0, stabilityWeight: 0',
    ]) {
      // THE PAIR, adjacent and in order, so the assertion is about the row rather than about the file. A
      // plain `toContain(override)` is satisfied by a row whose flags DIFFER — which is the one thing a
      // numeric ablation must not do, because it would attribute that flag's effect to the weight. Two named
      // constants (`PRISM_ONLY_FLAGS`, `PRODUCTION_PRISM_FLAGS`) legitimately spread `ALL_OFF_FLAGS` and set
      // flags, so the assertion cannot be about the spread in general; it has to be about these six rows.
      const escaped = override.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        RUNNER,
        `the row overriding ${override} must spread the all-off flags immediately before it`,
      ).toMatch(
        new RegExp(`flags: \\{ \\.\\.\\.ALL_OFF_FLAGS \\},\\s*overrides: \\{ ${escaped} \\}`),
      );
    }
    // And the population is pinned WITH its composition named, so a seventh row forces a decision instead of
    // silently joining a group whose flags nobody re-checked: three for the propagation channel's 2x2, three
    // for the two priors.
    expect(RUNNER.split('flags: { ...ALL_OFF_FLAGS }').length - 1, '6 numeric rows').toBe(6);
    expect(RUNNER, 'and it is defined once').toContain('const ALL_OFF_FLAGS: FeatureFlags = {');
  });

  it('threads the override through the container factory, not only through the printed line', () => {
    // A line that states an override the engine never received is worse than no line: it is a false record.
    expect(RUNNER).toContain('buildContainer(config.flags, config.overrides)');
    expect(RUNNER).toContain('buildAblationEngineOptions(flags, overrides)');
    // The sweep's own construction site names BOTH dimensions of its axis, so a column cannot be
    // measured at a configuration its label does not describe.
    expect(RUNNER).toContain('prismWeight: point.weight');
    expect(RUNNER).toContain('prismPooling: point.pooling');
  });

  it('attaches BOTH direction inputs, so a weight on either is measurable', () => {
    // The defect this test was written for: the loader attached `failedTraceEdges` and never `edgeLatency`,
    // so the shipped `latWeight` multiplied an empty map in every row — and a weight times an empty map is
    // zero whether the term is useful or not.
    //
    // It used to assert the runner's own INLINE attachment, including that it derived both fields from one
    // streaming pass. That attachment is now in the one corpus owner this runner shares with the golden path,
    // which is a stronger guarantee than the inline one: the two cannot drift, because there is one of them.
    // The owner's composition — in-memory `edgeLatency`, streaming `failedTraceEdges`, deliberately not
    // unified because `latWeight` multiplies the capped one — is pinned in `corpus-assembly.test.ts`.
    expect(RUNNER).toContain('assembleRCAEvalCase(');
    expect(RUNNER).toContain('augmentFromTraces: true');
    expect(RUNNER, 'the runner no longer assembles the corpus itself').not.toContain(
      'countDirectionalInputs(',
    );
    expect(RUNNER).not.toContain('countFailedTraceEdges(');
  });

  it('reports the coverage of those inputs, so a zero can be read as starved or inert', () => {
    expect(RUNNER).toContain('summarizeDirectionalCoverage(bundle.cases)');
    expect(RUNNER).toContain('formatDirectionalCoverage(');
  });

  it('carries the pooling rows as the additive rows’ SIBLINGS, flags and all', () => {
    // Source-shape, because the runner calls `main()` at import time. The rows exist because the
    // pooling axis was unmeasured, and they must differ from their additive siblings in the POOLING
    // and in nothing else: a row that retyped twelve booleans would attribute a flag's effect to the
    // pooling, which is the one thing a single-knob ablation must not do.
    expect(RUNNER).toContain('const PRISM_ONLY_FLAGS: FeatureFlags = {');
    expect(RUNNER).toContain('const PRODUCTION_PRISM_FLAGS: FeatureFlags = {');
    const spills = RUNNER.split('flags: { ...PRISM_ONLY_FLAGS }').length - 1;
    const production = RUNNER.split('flags: { ...PRODUCTION_PRISM_FLAGS }').length - 1;
    expect(spills, 'the isolated-signal row and its pooling sibling').toBe(2);
    expect(production, 'the production-configuration row and its pooling sibling').toBe(2);
    expect(RUNNER.split("overrides: { prismPooling: 'conjunctive' }").length - 1).toBe(2);
    // And the two named constants really are the rows they claim to be — read from the SOURCE rather
    // than transcribed, so the siblings are the runner's own flags and not a second copy of them.
    expect(RUNNER).toMatch(
      /const PRISM_ONLY_FLAGS: FeatureFlags = \{\s*\.\.\.ALL_OFF_FLAGS,\s*prismSignal: true,\s*\}/,
    );
    expect(RUNNER).toMatch(
      /const PRODUCTION_PRISM_FLAGS: FeatureFlags = \{\s*\.\.\.ALL_OFF_FLAGS,\s*logSignal: true,\s*traceSignal: true,\s*rankNormalization: true,\s*prismSignal: true,\s*\}/,
    );
    // The production flags are the shipped configuration's, so the row's label is a claim the source
    // supports: `logWeight = 1`, `traceWeight = 1` and rank normalisation are what the nine cells run.
    expect(
      formatAblationConfigLine({
        ...ALL_OFF,
        logSignal: true,
        traceSignal: true,
        rankNormalization: true,
        prismSignal: true,
      }),
    ).toContain('logWeight=1');
  });
});

describe('the sweep axis is two-dimensional, and its first column is the shipped configuration', () => {
  // Source-shape, because the runner calls `main()` at import time. What these fences hold is the
  // property the frontier depends on: the axis's FIRST column IS the baseline — the shipped weight with
  // the shipped pooling — because the whole output of the sweep is "no cell fell below the baseline",
  // and a frontier measured against any other configuration describes a run nobody ships. The pure
  // analyzer refuses a misordered axis at run time; these make the mistake unreachable at the source.
  //
  // The reader is per-describe rather than shared, matching the sibling block below: a hoisted constant
  // would have to be read at module scope, before the suite's own setup runs.
  const RUNNER = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/run-ablation.ts'),
    'utf8',
  );

  it('leads the pooling list with the SHIPPED pooling, so the first column is the baseline', () => {
    // `PRISM_SWEEP_WEIGHTS` starts at 0 and the weights are mapped in order, so the axis's first point
    // is (0, <first pooling>). The shipped pooling must therefore LEAD this list.
    expect(RUNNER).toMatch(
      /const PRISM_SWEEP_POOLINGS: readonly PrismPooling\[\] = \[DEFAULT_PRISM_POOLING, 'conjunctive'\]/,
    );
    // …and the ladder must still start at zero, which is what makes the shipped column the FIRST one.
    expect(RUNNER).toMatch(/const PRISM_SWEEP_WEIGHTS = \[0,/);
  });

  it('builds the axis as the cross product, so every pooling is measured at every weight', () => {
    // A pooling measured at only some weights would make the frontier's "best point" a comparison
    // between two different ladders rather than between two configurations at one weight.
    expect(RUNNER).toMatch(
      /const PRISM_SWEEP_AXIS: readonly AxisPoint\[\] = PRISM_SWEEP_POOLINGS\.flatMap\(\(pooling\) =>\s*PRISM_SWEEP_WEIGHTS\.map\(\(weight\) => axisPoint\(weight, pooling\)\),\s*\);/,
    );
    // Both dimensions reach the engine at the CONSTRUCTION site, not only the weight.
    expect(RUNNER).toContain('prismWeight: point.weight');
    expect(RUNNER).toContain('prismPooling: point.pooling');
    // The old 1-D construction — a container built from a bare weight — must be gone, or the axis
    // would still be one column per weight with the pooling inherited by omission. That omission is
    // exactly the defect the enrolment repaired, so its return is worth a fence.
    expect(RUNNER).not.toMatch(/buildContainer\(PRISM_SWEEP_FLAGS, \{ prismWeight: weight \}\)/);
    expect(RUNNER).not.toMatch(/analyzePrismSweep\(PRISM_SWEEP_WEIGHTS/);
  });

  it('asserts the no-op control from the DATA, not from the construction', () => {
    // `prismWeight = 0` multiplies the signal away whatever the pooling, so the two weight-0 columns
    // must agree. The sweep prints that comparison rather than trusting it: if the pooling ever
    // reached the ranking at weight zero, a column would be a configuration other than its label.
    expect(RUNNER).toContain('no-op control');
    expect(RUNNER).toMatch(/r\.point\.weight === 0/);
  });

  it('names the pooling in the best-point report, because the weight alone is now ambiguous', () => {
    // Two configurations share every weight on this axis; a report that printed only the weight would
    // be ambiguous between one that can regress and one that does not.
    expect(RUNNER).toContain('prismPooling=${b.point.pooling}');
    expect(RUNNER).toContain('${b.point.label}');
  });
});
