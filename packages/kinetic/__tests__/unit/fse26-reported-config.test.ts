/**
 * Report-integrity guard for the published FSE'26 number.
 *
 * The number that gets published is whatever the CI workflow runs when nobody
 * overrides it. That default therefore has exactly one legitimate owner: the
 * runner, whose default is chosen from measurement. Any second copy of it is a
 * drift hazard, and the drift is silent — the run still succeeds, still prints
 * a confident Top@1, and just reports the wrong configuration.
 *
 * It already happened once: `.github/workflows/fse26-benchmark.yml` hardcoded
 * `log_mode: count` while the best measured mode was `logicHttp`. Every
 * scheduled run published `count` (Top@1 23.1% / 328 of 1422) although
 * `logicHttp` measured Top@1 47.3% / 673 of 1422 on the same commit and the
 * same provenance-verified cache (runs 34604119657 and 34604105028).
 *
 * So the invariant enforced here is structural, not cosmetic:
 *
 *   1. the workflow's `log_mode` input defaults to EMPTY — it passes
 *      `--log-mode` only when the dispatch input is non-empty, which makes the
 *      runner's own default the single source of truth;
 *   2. the runner's default is the best-measured mode.
 *
 * The assertions read the two files as text on purpose: the defect lives in
 * configuration, not in a runtime code path, so no amount of execution
 * coverage can see it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The ENGINE's constant, imported rather than restated: this guard exists to catch a
// document disagreeing with the code, so a copy of the value here would be a third
// opinion and could itself drift.
import {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_LOG_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
} from '../../../../packages/tree/src/index.js';

// packages/kinetic/__tests__/unit/ → four levels up is the repository root.
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const WORKFLOW_PATH = resolve(repoRoot, '.github/workflows/fse26-benchmark.yml');
/**
 * The other workflow that can spend a flag on the ENGINE.
 *
 * It had no `workflow_dispatch` inputs at all until the decisive-stability candidate needed one:
 * the golden 9-cell is the criterion's second half, and the term is inert at its default weight,
 * so measuring it THERE means passing a flag rather than moving the default. That makes this file
 * the second place a description can turn into a second owner of a value the runner carries — the
 * same defect class, a different artifact — so the same two checks run on it.
 */
const RCAEVAL_WORKFLOW_PATH = resolve(repoRoot, '.github/workflows/benchmark-rcaeval.yml');
/**
 * Where the runner's configuration defaults live.
 *
 * This was `run-fse26.ts` until the CLI parsing moved to `fse26-cli.ts` so that
 * it could be tested at all (`run-fse26.ts` calls `main()` on import). The
 * extraction broke this guard, which is the correct behaviour for a guard that
 * reads a file by path: it reported `undefined` rather than silently passing.
 */
const RUNNER_PATH = resolve(repoRoot, 'benchmarks/src/fse26-cli.ts');

/**
 * Read the `default:` of one `workflow_dispatch` input out of the raw YAML.
 *
 * Only the input block is parsed (the lines indented deeper than the input
 * name), so a `default:` belonging to a different input cannot be picked up.
 */
function readInputDefault(yml: string, input: string): string | undefined {
  const lines = yml.split('\n');
  const header = new RegExp(`^ {6}${input}:\\s*$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return undefined;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const indent = line.length - line.trimStart().length;
    // A line at or below the input's own indent ends the block.
    if (line.trim().length > 0 && indent <= 6) return undefined;
    const m = /^\s*default:\s*(.*)$/.exec(line);
    if (m) return m[1]!.trim().replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

/** The runner's own default log-signal mode. */
const DEFAULT_RE = /DEFAULT_FSE26_LOG_MODE:\s*LogSignalMode\s*=\s*'([A-Za-z]+)'/;

function readRunnerDefault(source: string): string | undefined {
  return DEFAULT_RE.exec(source)?.[1];
}

/**
 * The modes the CLI accepts, read from its exhaustive `Record<LogSignalMode, true>`.
 *
 * This is the guard for a defect that already fired: the accepted set was a
 * hand-written `||` chain, and when the default was flipped to `logicHttp` the
 * rewrite dropped `count` from it. `--log-mode count` then matched nothing and
 * fell back to `logicHttp`, so the `count` configuration became unreachable
 * through the workflow — and silently, because the fallback produced a valid run
 * with a plausible number. Two diagnostics dispatched to compare the two modes
 * came back byte-identical.
 */
function readAcceptedModes(source: string): string[] {
  // Anchored on the declaration: a bare name match also hits the identifier's
  // mention in the module's doc comment, and `[^{]*` then ran on to the first
  // brace in the file -- an `import { … }` -- capturing the wrong block.
  const body = /const LOG_MODE_ACCEPTED[^{]*\{([^}]*)\}/.exec(source)?.[1];
  if (body === undefined) return [];
  return [...body.matchAll(/(\w+):\s*true/g)].map((m) => m[1]!);
}

/**
 * Modes with a recorded full-benchmark measurement. Keeping the set here means
 * flipping the default to an unmeasured mode fails this test instead of being
 * published as fact.
 */
const MEASURED_MODES: Record<string, { topAt1: number; hits: number; cases: number; run: string }> =
  {
    count: { topAt1: 0.231, hits: 328, cases: 1422, run: '34604119657' },
    logicHttp: { topAt1: 0.473, hits: 673, cases: 1422, run: '34604105028' },
  };

/**
 * Where the engine's shipped latency weight is declared.
 *
 * The same discipline as `MEASURED_MODES`, applied to a NUMBER rather than a mode:
 * a default is a claim, and a claim without a measurement behind it is how this
 * benchmark published 23.1% for months. The value is read as text because the
 * defect being guarded against is a configuration default, which no runtime
 * assertion of the engine's own behaviour can see.
 */
const PRUNER_PATH = resolve(repoRoot, 'packages/tree/src/pruning/pruner.ts');
const DEFAULT_LAT_WEIGHT_RE = /DEFAULT_LAT_WEIGHT\s*=\s*([0-9.]+)/;
const DEFAULT_LAT_MIN_RISE_RE = /DEFAULT_LAT_MIN_RISE\s*=\s*([0-9.]+)/;

/**
 * Weights with a recorded full-benchmark measurement, and what that measurement
 * did to the fault types. `regressedTypes` is the half of the shared kill
 * criterion that decides whether a weight may ship: `0` is required.
 */
const MEASURED_LAT_WEIGHTS: Record<
  string,
  { topAt1: number; hits: number; cases: number; regressedTypes: number; run: string }
> = {
  '0': {
    topAt1: 0.4732770745428973,
    hits: 673,
    cases: 1422,
    regressedTypes: 0,
    run: '34861464922',
  },
  '0.03': {
    topAt1: 0.4880450070323488,
    hits: 694,
    cases: 1422,
    regressedTypes: 0,
    run: '34872477561',
  },
  '0.66': {
    topAt1: 0.5555555555555556,
    hits: 790,
    cases: 1422,
    regressedTypes: 5,
    run: '34872482240',
  },
  '0.75': {
    topAt1: 0.5520393811533052,
    hits: 785,
    cases: 1422,
    regressedTypes: 7,
    run: '34861468557',
  },
  '0.561495': {
    topAt1: 0.5274261603375527,
    hits: 750,
    cases: 1422,
    regressedTypes: 0,
    run: '34921980498',
  },
};

/**
 * Where the engine's shipped pool-penalty weight is declared, and the runs that
 * measured the two points the shipped value is chosen between.
 *
 * The same discipline as the latency weight, and here it guards a PAIR of points for a
 * second reason: `0.0679` is the midpoint of a window whose LOWER boundary is the gain
 * plateau (0.048823) and whose UPPER boundary is the first casualty (0.087011). A
 * constant moved without a run is indistinguishable from a number someone liked, and the
 * control point is what makes "the term was off" a measurement rather than an assumption.
 */
const DEFAULT_POOL_PENALTY_RE = /DEFAULT_POOL_METRIC_PENALTY_WEIGHT\s*=\s*([0-9.]+)/;
const MEASURED_POOL_WEIGHTS: Record<
  string,
  { topAt1: number; hits: number; cases: number; regressedTypes: number; run: string }
> = {
  '0': {
    topAt1: 0.5274261603375527,
    hits: 750,
    cases: 1422,
    regressedTypes: 0,
    run: '34949812666',
  },
  '0.0679': {
    topAt1: 0.5316455696202531,
    hits: 756,
    cases: 1422,
    regressedTypes: 0,
    run: '34949854236',
  },
};

/**
 * Rise floors with a recorded full-benchmark measurement.
 *
 * A floor is not a weight, and it is NOT safe on its own: at the shipped weight a
 * floor of 10.3 costs 6 cases across 6 fault types. The pair is the configuration, so
 * the guard below requires the PAIR to have been measured, not each half separately.
 */
const MEASURED_LAT_FLOORS: Record<
  string,
  { topAt1: number; hits: number; cases: number; regressedTypes: number; run: string }
> = {
  '1': {
    topAt1: 0.4838255977496484,
    hits: 688,
    cases: 1422,
    regressedTypes: 6,
    run: '34921984651',
  },
  '10.3': {
    topAt1: 0.5274261603375527,
    hits: 750,
    cases: 1422,
    regressedTypes: 0,
    run: '34921980498',
  },
};

/** Read a `const NAME = <number>` out of a source file, as text. */
function readConstant(source: string, pattern: RegExp, label: string): number {
  const m = pattern.exec(source);
  if (m === null) throw new Error(`${label}: constant not found in the source`);
  return Number(m[1]);
}

/** Read a `const NAME = '<text>'` out of a source file. A shape is a word, not a number. */
function readStringConstant(source: string, pattern: RegExp, label: string): string {
  const m = pattern.exec(source);
  if (m === null) throw new Error(`${label}: constant not found in the source`);
  return m[1]!;
}

/**
 * Where the engine's shipped SHAPE for the temporal prior is declared, and the runs
 * that measured the pair.
 *
 * The shape is not a weight, so it cannot be omitted-when-default the way a zero can,
 * and it is the half that decides WHAT the term says. It is keyed here by the weight it
 * was measured WITH, because the two are one configuration: a weight quoted without its
 * shape is not a measurement, and this table is what stops the pair from being split by
 * a later edit that only means to touch one of them.
 */
const DEFAULT_ONSET_SHAPE_RE = /DEFAULT_ONSET_SHAPE:\s*OnsetShape\s*=\s*'([a-z-]+)'/;
const MEASURED_TEMPORAL_PAIRS: Record<
  string,
  {
    shape: string;
    topAt1: number;
    hits: number;
    cases: number;
    regressedTypes: number;
    /**
     * The kill criterion's OTHER half, recorded as data.
     *
     * It was missing from the first version of this table, and that is how a candidate
     * shipped with only half of the criterion checked: `regressedTypes` (FSE'26) is a
     * claim about fault TYPES on one benchmark, and nothing here could record that the
     * golden 9-cell had moved. It had — by 40.8pp on one cell — and the table said
     * nothing, so the guard said nothing.
     *
     * `unmeasured` is the honest reading of a candidate the OTHER half already rejected:
     * buying a golden run to confirm a rejection the FSE'26 half has delivered is a run
     * spent to learn nothing, and recording `moved` would be a measurement nobody took.
     * The guard requires `identical` on the shipped point, so an unmeasured row can never
     * be green — which is the only property it needs.
     */
    golden: 'identical' | 'moved' | 'unmeasured';
    run: string;
    goldenRun: string;
    /**
     * The same configuration, reached through the engine's DEFAULT path.
     *
     * `run` above may have been reached with the value PINNED on the command line, and a
     * pin is a second owner of the value: the pins that produced this table's rows were
     * written when the engine's default was something else. A configuration measured only
     * down a pinned path is not a measurement of what SHIPS — the pin and the default can
     * be edited apart, and when they are, the gate keeps passing for a reason that has
     * nothing to do with the signal (see the RCAEval runner's `temporalWeight: 0` pin,
     * `docs/closed-axes-register.md`). So anything that ships must also appear here,
     * measured with no flag at all.
     */
    defaultPath?: { run: string; goldenRun: string; golden: 'identical' | 'moved' };
    /** The companion point, when this one's gain is a gain against it. */
    control?: string;
  }
> = {
  '0': {
    shape: 'earliness',
    topAt1: 0.5316455696202531,
    hits: 756,
    cases: 1422,
    regressedTypes: 0,
    golden: 'identical',
    run: '35021503281',
    goldenRun: '35028063290',
    // The revert (`301c430`) had to PROVE it restored the engine, and this is that proof
    // on both benchmarks: FSE'26 through the default path reproduces the control above
    // fault type for fault type (25/25 identical, 756/1422), and RCAEval reproduces all
    // nine recorded cells. Both halves, no pin.
    defaultPath: { run: '35035314921', goldenRun: '35035309768', golden: 'identical' },
  },
  '0.036552': {
    shape: 'earliest-only',
    topAt1: 0.5344585091420534,
    hits: 760,
    cases: 1422,
    regressedTypes: 0,
    // BOTH halves, and they disagree. Kept as DATA rather than as a sentence in a
    // document: the next session must find the rejection where it finds the values.
    golden: 'moved',
    run: '35021510164',
    goldenRun: '35029285379',
    control: '35021503281',
  },
  // The ONE region the intersection left open on this axis — `earliness`
  // `[0.007722, 0.010108)` — dispatched at its midpoint and REJECTED on the half that can
  // be dispatched. Net ZERO cases (757 → 757) with ONE fault type regressed:
  // `HTTPResponseDelay 52 → 53` and `NetworkBandwidth 13 → 12`. The screen had flagged
  // exactly this as `costsOnGainSide` (the gain is bought at or above FSE'26's own cap of
  // `0.005361`), and this time the run AGREED with the caveat — the stability axis's
  // identical caveat was the one the run rejected, so the two are not the same claim.
  '0.008915': {
    shape: 'earliness',
    topAt1: 757 / 1422,
    hits: 757,
    cases: 1422,
    regressedTypes: 1,
    golden: 'unmeasured',
    run: '35420303504',
    // No golden run, and none bought: the criterion is an AND and this half failed.
    goldenRun: '',
    control: '35420305720',
  },
};

/**
 * Where the engine's shipped temporal weight is declared.
 *
 * A third owner of "what the record is keyed by", so it is read as text exactly like
 * the latency and pool weights above.
 */
const DEFAULT_TEMPORAL_WEIGHT_RE = /DEFAULT_TEMPORAL_WEIGHT\s*=\s*([0-9.]+)/;

/**
 * Where the engine's shipped decisive-stability weight is declared.
 *
 * Read as TEXT, like every other constant in this file: the defect it guards is a disagreement
 * between two files, which a typed import cannot see.
 */
const DEFAULT_STABILITY_WEIGHT_RE = /DEFAULT_STABILITY_WEIGHT\s*=\s*([0-9.]+)/;

/**
 * Every decisive-stability weight that has been measured on a full benchmark, keyed by the weight.
 *
 * Unlike {@link MEASURED_TEMPORAL_PAIRS} there is no shape to pair this with: the engine's
 * `computeStabilityScores` IS the `rank` reading of the statistic, so a weight quoted alone is a
 * complete configuration and the shape half of the key cannot drift.
 *
 * The table exists for one reason — the two halves of the criterion DISAGREE on this axis, and the
 * disagreement is not a rounding matter. `0.030170` is the midpoint of the FSE'26 window and gained
 * five cases with zero regressed fault types; it is recorded here as a REJECTION because it moved
 * four of the nine golden cells. `0.007352` is the midpoint of the INTERSECTION and gained one.
 */
const MEASURED_STABILITY_WEIGHTS: Record<
  string,
  {
    topAt1: number;
    hits: number;
    cases: number;
    /** The FSE'26 half: fault TYPES that regressed. */
    regressedTypes: number;
    /** The golden half, recorded as data. `moved` is a rejection whatever the other half says. */
    golden: 'identical' | 'moved';
    run: string;
    goldenRun: string;
    /** The companion point this one's gain is measured against. */
    control?: string;
    /**
     * The same configuration reached with NO flag, on both benchmarks.
     *
     * `run` is the FSE'26 arm; `control` is the same commit with the term ablated to 0, so the
     * gain is measured against a companion built from the same sources rather than from a commit
     * that has drifted.
     */
    defaultPath?: {
      run: string;
      goldenRun: string;
      golden: 'identical' | 'moved';
      control?: string;
    };
  }
> = {
  '0': {
    topAt1: 0.5316455696202531,
    hits: 756,
    cases: 1422,
    regressedTypes: 0,
    golden: 'identical',
    run: '35021503281',
    goldenRun: '35028063290',
  },
  '0.007352': {
    topAt1: 757 / 1422,
    hits: 757,
    cases: 1422,
    regressedTypes: 0,
    golden: 'identical',
    run: '35411806524',
    goldenRun: '35411810992',
    control: '35125285784',
    // The point that SHIPS, reached with NO flag at all. Every measurement above was taken by
    // passing `stability_weight`, and a flag is a second owner of the value — one that can be
    // edited apart from the engine's default, which is exactly the failure the RCAEval runner's own
    // `temporalWeight: 0` pin produced. Its control is on the SAME commit, so the +1 is one case
    // and not a drift between commits.
    defaultPath: {
      run: '35416576350',
      goldenRun: '35416556932',
      golden: 'identical',
      control: '35416580279',
    },
  },
  '0.030170': {
    topAt1: 761 / 1422,
    hits: 761,
    cases: 1422,
    // BOTH halves, and they disagree. Kept as DATA: the FSE'26 half is genuinely attractive
    // (+5, zero regressed types), so the next session has to find the rejection where it finds the
    // values, not in a paragraph.
    regressedTypes: 0,
    golden: 'moved',
    run: '35125277962',
    goldenRun: '35132525118',
    control: '35125285784',
  },
};

describe('FSE26 reported configuration', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
  const runner = readFileSync(RUNNER_PATH, 'utf8');

  it('keeps the workflow free of a hardcoded log-mode default', () => {
    // An empty default is the whole point: the runner owns the choice, so the
    // published configuration cannot drift away from the measured one.
    expect(readInputDefault(workflow, 'log_mode')).toBe('');
  });

  it('ships a runner default that has a recorded full-benchmark measurement', () => {
    const mode = readRunnerDefault(runner);
    expect(mode).toBeDefined();
    expect(Object.keys(MEASURED_MODES)).toContain(mode);
  });

  it('ships the best-measured mode as the runner default', () => {
    const mode = readRunnerDefault(runner)!;
    const best = Object.entries(MEASURED_MODES).sort((a, b) => b[1].topAt1 - a[1].topAt1)[0]!;
    expect(mode).toBe(best[0]);
  });

  it('accepts every mode that has been measured', () => {
    // A measured mode that the CLI refuses is not merely unused: it is
    // UNDISPATCHABLE, and the fallback hides that by reporting another mode's
    // number. This is the assertion that would have caught `count` disappearing.
    const accepted = readAcceptedModes(runner);
    expect(accepted.length).toBeGreaterThan(0);
    for (const mode of Object.keys(MEASURED_MODES)) {
      expect(accepted, `measured mode ${mode} must be accepted by --log-mode`).toContain(mode);
    }
  });

  it('accepts the mode it ships as the default', () => {
    expect(readAcceptedModes(runner)).toContain(readRunnerDefault(runner));
  });
});

describe('FSE26 latency weight — a shipped default is a measured claim', () => {
  const pruner = readFileSync(PRUNER_PATH, 'utf8');
  const shipped = DEFAULT_LAT_WEIGHT_RE.exec(pruner)?.[1];

  it('declares the shipped latency weight where this guard can read it', () => {
    expect(shipped).toBeDefined();
  });

  it('ships a latency weight that has a recorded full-benchmark measurement', () => {
    expect(Object.keys(MEASURED_LAT_WEIGHTS)).toContain(shipped);
  });

  it('ships a latency weight that regressed ZERO fault types', () => {
    // The second half of the shared kill criterion, and the only reason this term
    // was rejected at 0.75 in the first place (+7.88pp and still refused). A future
    // flip to a weight that gains more while costing a type fails here rather than
    // being discovered in the artifact.
    const measured = MEASURED_LAT_WEIGHTS[shipped!]!;
    expect(measured.regressedTypes).toBe(0);
  });

  it('ships the best-measured zero-regression weight', () => {
    const passing = Object.entries(MEASURED_LAT_WEIGHTS)
      .filter(([, m]) => m.regressedTypes === 0)
      .sort((a, b) => b[1].topAt1 - a[1].topAt1);
    expect(shipped).toBe(passing[0]?.[0]);
  });
});

/**
 * The weight the term shipped at while the floor was still 1 (the no-op). Anything
 * above it is only defensible together with a floor, because the shipped shape's
 * zero-regression window ends at 0.030459.
 */
const DEFAULT_SHIPPED_WEIGHT_WITHOUT_FLOOR = 0.03;

describe('FSE26 latency rise floor — shipped as a PAIR with the weight', () => {
  const pruner = readFileSync(PRUNER_PATH, 'utf8');
  const shippedWeight = DEFAULT_LAT_WEIGHT_RE.exec(pruner)?.[1];
  const shippedFloor = DEFAULT_LAT_MIN_RISE_RE.exec(pruner)?.[1];

  it('declares the shipped floor where this guard can read it', () => {
    expect(shippedFloor).toBeDefined();
  });

  it('ships a floor that has a recorded full-benchmark measurement', () => {
    expect(Object.keys(MEASURED_LAT_FLOORS)).toContain(shippedFloor);
  });

  it('ships a floor the shipped WEIGHT is also measured at', () => {
    // The two values are ONE configuration. A floor measured only against a different
    // weight would say nothing about the pair that actually ships — and this one is
    // not safe on its own: at the shipped weight a floor of 10.3 costs 6 cases across
    // 6 fault types, so its own row is a regression and only the pair is a gain.
    expect(MEASURED_LAT_FLOORS[shippedFloor!]!.run).toBe(MEASURED_LAT_WEIGHTS[shippedWeight!]!.run);
  });

  it('ships a PAIR whose measurement regressed zero fault types', () => {
    expect(MEASURED_LAT_FLOORS[shippedFloor!]!.regressedTypes).toBe(0);
    expect(MEASURED_LAT_WEIGHTS[shippedWeight!]!.regressedTypes).toBe(0);
  });

  it('does not ship the no-op floor with a weight that needs a floor', () => {
    // The shipped weight exists only because the floor removed the competitor that
    // bounded the shipped shape. Shipping them mismatched — a high weight with a floor
    // of 1 — is the failure this file can see no other way.
    if (Number(shippedWeight) > DEFAULT_SHIPPED_WEIGHT_WITHOUT_FLOOR) {
      expect(Number(shippedFloor)).toBeGreaterThan(1);
    }
  });
});

describe('FSE26 decisive-stability weight is a measured claim on BOTH halves', () => {
  const source = readFileSync(PRUNER_PATH, 'utf8');

  it('ships a weight whose recorded run has BOTH halves of the criterion green', () => {
    // The two halves disagree on this axis by more than 4x in the weight, and the difference is a
    // REJECTION, not a preference: 0.030170 gained five cases on FSE'26 and moved four golden
    // cells. So a default here is a claim about two benchmarks and the table is what holds both.
    const shippedWeight = readConstant(
      source,
      DEFAULT_STABILITY_WEIGHT_RE,
      'DEFAULT_STABILITY_WEIGHT',
    );
    const recorded = MEASURED_STABILITY_WEIGHTS[String(shippedWeight)];
    expect(
      recorded,
      `no recorded run for the shipped stability weight ${shippedWeight}`,
    ).toBeDefined();
    expect(recorded!.cases).toBe(1422);
    expect(recorded!.regressedTypes).toBe(0);
    // The half that rejected the window's own midpoint.
    expect(recorded!.golden).toBe('identical');
  });

  it('has walked the DEFAULT path — a flag is a second owner of the value', () => {
    // Every other measurement of this weight was taken by PASSING `stability_weight`, and the
    // register's own rule is that such a point measures the flag and not what ships: the RCAEval
    // runner once pinned `temporalWeight: 0` while the engine's default moved, and the run that
    // followed was a measurement of the pin. So the shipped point must ALSO have been reached with
    // no input at all, and that arm has to be green on both halves too.
    const shippedWeight = readConstant(
      source,
      DEFAULT_STABILITY_WEIGHT_RE,
      'DEFAULT_STABILITY_WEIGHT',
    );
    const recorded = MEASURED_STABILITY_WEIGHTS[String(shippedWeight)]!;
    const walked = recorded.defaultPath;
    expect(
      walked,
      `the shipped stability weight ${shippedWeight} has no default-path run`,
    ).toBeDefined();
    expect(walked!.golden).toBe('identical');
    // It must be a DIFFERENT run from the flag arm's, not a second name for it. Without this the
    // guard is satisfied by the flag measurement it exists to replace — measured: reading
    // `recorded` instead of `recorded.defaultPath` passes every other assertion here, because
    // both arms are green and both have a control.
    expect(walked!.run).not.toBe(recorded.run);
    expect(walked!.goldenRun).not.toBe(recorded.goldenRun);
    // And the default path has its OWN control, on the same commit: a one-case gain measured
    // against a companion from another commit is a gain plus a drift.
    expect(walked!.control).toBeDefined();
    expect(walked!.control).not.toBe(recorded.control);
    // The flag path and the default path reach the same number, which is what makes the flag arm a
    // measurement of the engine rather than of itself.
    expect(recorded.hits).toBe(757);
  });

  it('keeps the REJECTED window midpoint on the record, with both of its numbers', () => {
    // The test that pays for the table. The rejected point is the FSE'26 solver's own
    // recommendation — +5 cases, zero regressed fault types — so a paragraph is not enough to stop
    // it being re-proposed. Its gain AND the half it failed are data here.
    const rejected = MEASURED_STABILITY_WEIGHTS['0.030170']!;
    expect(rejected.golden).toBe('moved');
    expect(rejected.regressedTypes).toBe(0);
    expect(rejected.hits).toBe(761);
    // And the shipped point is the intersection's midpoint, NOT the window's: the two are 4.1x
    // apart, which is the number this table exists to make unmissable.
    const shippedWeight = readConstant(
      source,
      DEFAULT_STABILITY_WEIGHT_RE,
      'DEFAULT_STABILITY_WEIGHT',
    );
    expect(Number(shippedWeight)).toBeLessThan(0.03017);
    expect(MEASURED_STABILITY_WEIGHTS[String(shippedWeight)]!.golden).toBe('identical');
  });
});

/**
 * Enumerate the `workflow_dispatch` input names out of the raw YAML.
 *
 * Inputs live at a fixed indent under `inputs:`; the scan stops at the first
 * shallower line so a key from the enclosing mapping cannot be mistaken for an
 * input.
 */
function readInputNames(yml: string): string[] {
  const lines = yml.split('\n');
  const start = lines.findIndex((line) => /^ {4}inputs:\s*$/.test(line));
  if (start < 0) return [];
  const names: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= 4) break;
    const m = /^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*$/.exec(line);
    if (m) names.push(m[1]!);
  }
  return names;
}

/**
 * Every `workflow_dispatch` input, classified by WHO owns its default.
 *
 * - `runner` — the input overrides a default the runner also carries. It MUST
 *   therefore default to EMPTY, so the runner stays the only owner. A literal
 *   here is a second copy, and a second copy can drift silently: the run still
 *   succeeds, still prints a confident Top@1, and simply reports a
 *   configuration nobody chose. That is not hypothetical — this file's history
 *   contains `log_mode: count` against a measured best of `logicHttp`, worth
 *   24.2pp, and the drift was invisible in the artifact.
 * - `workflow` — the input has no runner counterpart: it selects which
 *   provenance-verified shards to download, which the runner cannot know.
 *
 * Exhaustive by construction: a NEW workflow input fails the suite until it is
 * classified, so the choice cannot be made by accident.
 */
const INPUT_OWNER: Readonly<Record<string, 'runner' | 'workflow'>> = {
  shard_tag: 'workflow',
  categories: 'workflow',
  max_cases: 'runner',
  log_weight: 'runner',
  log_mode: 'runner',
  diagnose: 'runner',
  diagnose_limit: 'runner',
  rise_ceiling: 'runner',
  fleet_baseline: 'runner',
  no_rank_normalization: 'runner',
  drop_metrics: 'runner',
  failed_edge_weight: 'runner',
  failed_edge_mode: 'runner',
  failed_edge_min_records: 'runner',
  lat_weight: 'runner',
  lat_min_rise: 'runner',
  pool_penalty: 'runner',
  stability_weight: 'runner',
  temporal_weight: 'runner',
  onset_shape: 'runner',
};

/**
 * Read one input's `description:` out of the raw YAML.
 *
 * Returns `undefined` when the input has no description, which is a failure the
 * caller has to state rather than an empty string it can quietly accept.
 */
function readInputDescription(yml: string, input: string): string | undefined {
  const lines = yml.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^ {6}${input}:\\s*$`).test(line));
  if (start < 0) return undefined;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= 6) return undefined;
    const m = /^\s+description:\s*(.*)$/.exec(line);
    if (m) return m[1]!;
  }
  return undefined;
}

describe('FSE26 workflow descriptions agree with the code they describe', () => {
  /**
   * Inputs whose description states the RUNNER's shipped value, and the constant it
   * has to match.
   *
   * A description is documentation that a dispatcher reads instead of the code, and it
   * can drift the same way a hardcoded default can — silently, because a run succeeds
   * whoever is right. This one HAD drifted: `pool_penalty` said "empty = … 0 = INERT"
   * for a whole session after 0.0679 shipped, so a reader who wanted the shipped
   * configuration would have believed they had to pass a value, and the value they
   * would have passed was the ablation. The description is read as TEXT on purpose:
   * the defect is a disagreement between two files, which no runtime path can see.
   */
  const DESCRIBES_SHIPPED: Readonly<Record<string, number>> = {
    // The largest term in the ranking, and the last one to get an owner: this entry used to be a
    // bare `1`, because the engine's default was a bare `1.0` in four files. The guard could only
    // be satisfied by a fifth copy until `DEFAULT_LOG_WEIGHT` existed.
    log_weight: DEFAULT_LOG_WEIGHT,
    failed_edge_weight: 0,
    failed_edge_min_records: 1,
    lat_weight: DEFAULT_LAT_WEIGHT,
    lat_min_rise: DEFAULT_LAT_MIN_RISE,
    pool_penalty: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    // The runner default is 0 and the CANDIDATE is 0.030170: a description naming the candidate
    // would satisfy a substring test for a shipped `0`, which is why the guard compares NUMERIC
    // TOKENS and this table records the value the runner actually falls back to.
    stability_weight: DEFAULT_STABILITY_WEIGHT,
    temporal_weight: DEFAULT_TEMPORAL_WEIGHT,
    diagnose_limit: 3,
  };

  it('names the shipped value of every input whose description quotes one', () => {
    const yml = readFileSync(WORKFLOW_PATH, 'utf8');
    for (const [input, shipped] of Object.entries(DESCRIBES_SHIPPED)) {
      const description = readInputDescription(yml, input);
      expect(description, `${input} has no description to check`).toBeDefined();
      // Compared as NUMBERS, not as substrings. `toContain('0')` succeeds against a
      // description that names `0.036552`, so the moment a value reverts to 0 the check
      // stops checking and a description still advertising the rejected candidate passes —
      // which is precisely the state this file was in an hour ago. Every numeric token is
      // read out and compared numerically, which also tolerates `1.0` for a shipped `1`.
      const numbers = [...description!.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      expect(numbers, `${input} must name the shipped ${shipped}: ${description}`).toContain(
        shipped,
      );
    }
  });

  /**
   * Inputs whose description states a STRING-valued runner default, and the constant it must name.
   *
   * The numeric table above cannot see this class at all: its detection regex requires a digit, so a
   * description advertising `earliest-only` — the REJECTED shape — would satisfy every assertion in
   * this file while the constant says `earliness`. The check here is POSITIVE (a registered entry
   * must name its constant), which is the direction the register's own precedent came from: the
   * `pool_penalty` description read "0 = INERT" for a session after 0.0679 shipped, i.e. a KNOWN
   * claim drifting rather than an unknown one arriving. A NEW string claim is still undetected, and
   * that limit is recorded in `docs/dispatch-surface-audit.md` rather than implied by silence.
   */
  const DESCRIBES_SHIPPED_STRING: Readonly<Record<string, string>> = {
    onset_shape: DEFAULT_ONSET_SHAPE,
  };

  it('names the shipped STRING default of every input whose description quotes one', () => {
    const yml = readFileSync(WORKFLOW_PATH, 'utf8');
    for (const [input, shipped] of Object.entries(DESCRIBES_SHIPPED_STRING)) {
      const description = readInputDescription(yml, input) ?? '';
      expect(description, `${input} has no description to check`).not.toBe('');
      expect(description, `${input} must name the shipped '${shipped}'`).toContain(shipped);
    }
  });

  it('covers every runner-owned input whose description quotes a value', () => {
    // The table above is hand-registered, so this keeps it honest: an input claiming
    // "the runner default, which is <something with a digit>" must be in the table or
    // fail the suite. Without it, the next measured constant gets a stale description
    // and nothing notices — which is exactly how `pool_penalty` read "0 = INERT" for a
    // session after 0.0679 shipped.
    const yml = readFileSync(WORKFLOW_PATH, 'utf8');
    const claiming = readInputNames(yml).filter((name) => {
      const description = readInputDescription(yml, name) ?? '';
      return /runner default, which is (?!empty)[^)]*\d/.test(description);
    });
    expect(claiming.sort()).toEqual(Object.keys(DESCRIBES_SHIPPED).sort());
  });
});

describe('RCAEval workflow descriptions agree with the code they describe', () => {
  /**
   * Inputs whose description states the RUNNER's shipped value, and the constant it has to match.
   *
   * `stability_weight` is the first input this workflow has ever had, and it is described the way
   * the FSE'26 workflow's are — "empty = the runner default, which is 0" — because that is what a
   * dispatcher reads. The value is read from the engine's own constant for the reason the whole
   * file exists: a copy here would be a third opinion about what the runner falls back to.
   */
  const DESCRIBES_SHIPPED: Readonly<Record<string, number>> = {
    stability_weight: DEFAULT_STABILITY_WEIGHT,
    log_weight: DEFAULT_LOG_WEIGHT,
    temporal_weight: DEFAULT_TEMPORAL_WEIGHT,
  };

  it('names the shipped value of every input whose description quotes one', () => {
    const yml = readFileSync(RCAEVAL_WORKFLOW_PATH, 'utf8');
    for (const [input, shipped] of Object.entries(DESCRIBES_SHIPPED)) {
      const description = readInputDescription(yml, input);
      expect(description, `${input} has no description to check`).toBeDefined();
      // Numeric TOKENS, not substrings: `toContain('0')` is satisfied by a description naming
      // `0.03017`, which is exactly the drift this guards against.
      const numbers = [...description!.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      expect(numbers, `${input} must name the shipped ${shipped}: ${description}`).toContain(
        shipped,
      );
    }
  });

  /**
   * Inputs whose description states a STRING-valued runner default, and the constant it must name.
   *
   * The numeric table above cannot see this class at all: its detection regex requires a digit, so a
   * description advertising `earliest-only` — the REJECTED shape — would satisfy every assertion in
   * this file while the constant says `earliness`. The check here is POSITIVE (a registered entry
   * must name its constant), which is the direction the register's own precedent came from: the
   * `pool_penalty` description read "0 = INERT" for a session after 0.0679 shipped, i.e. a KNOWN
   * claim drifting rather than an unknown one arriving. A NEW string claim is still undetected, and
   * that limit is recorded in `docs/dispatch-surface-audit.md` rather than implied by silence.
   */
  const DESCRIBES_SHIPPED_STRING: Readonly<Record<string, string>> = {
    onset_shape: DEFAULT_ONSET_SHAPE,
  };

  it('names the shipped STRING default of every input whose description quotes one', () => {
    const yml = readFileSync(WORKFLOW_PATH, 'utf8');
    for (const [input, shipped] of Object.entries(DESCRIBES_SHIPPED_STRING)) {
      const description = readInputDescription(yml, input) ?? '';
      expect(description, `${input} has no description to check`).not.toBe('');
      expect(description, `${input} must name the shipped '${shipped}'`).toContain(shipped);
    }
  });

  it('covers every input whose description claims a runner default', () => {
    const yml = readFileSync(RCAEVAL_WORKFLOW_PATH, 'utf8');
    const claiming = readInputNames(yml).filter((name) => {
      const description = readInputDescription(yml, name) ?? '';
      return /runner default, which is (?!empty)[^)]*\d/.test(description);
    });
    expect(claiming.sort()).toEqual(Object.keys(DESCRIBES_SHIPPED).sort());
  });

  it('leaves the runner-owned default EMPTY, so the runner is the sole owner', () => {
    // The one input here selects a weight the runner also carries, so a non-empty default would
    // make the workflow a second owner of it — and the failure mode is silent: the run succeeds
    // and prints a confident cell, for a configuration nobody chose.
    const yml = readFileSync(RCAEVAL_WORKFLOW_PATH, 'utf8');
    expect(readInputDefault(yml, 'stability_weight')).toBe('');
  });
});

describe('FSE26 workflow-input ownership', () => {
  const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

  it('classifies every workflow input, so a new one cannot slip through', () => {
    const names = readInputNames(workflow);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => INPUT_OWNER[name] === undefined)).toEqual([]);
    // And the table carries no stale entry for an input that no longer exists.
    expect(Object.keys(INPUT_OWNER).filter((name) => !names.includes(name))).toEqual([]);
  });

  it('leaves every runner-owned default empty, so the runner is the sole owner', () => {
    const offenders = Object.entries(INPUT_OWNER)
      .filter(([, owner]) => owner === 'runner')
      .map(([name]) => [name, readInputDefault(workflow, name)] as const)
      .filter(([, value]) => value !== '')
      .map(([name, value]) => `${name}=${String(value)}`);
    expect(offenders).toEqual([]);
  });
});

describe('FSE26 pool-penalty weight is a measured value', () => {
  const source = readFileSync(PRUNER_PATH, 'utf8');

  it('ships a weight that has a recorded run with zero regressed fault types', () => {
    // A default is a claim about a measurement. The number is read as TEXT because the
    // defect being guarded is a configuration default, which no runtime assertion of the
    // engine's own behaviour can see.
    const shipped = readConstant(
      source,
      DEFAULT_POOL_PENALTY_RE,
      'DEFAULT_POOL_METRIC_PENALTY_WEIGHT',
    );
    const recorded = MEASURED_POOL_WEIGHTS[String(shipped)];

    expect(recorded, `no recorded run for the shipped pool penalty ${shipped}`).toBeDefined();
    expect(recorded!.cases).toBe(1422);
    expect(recorded!.regressedTypes).toBe(0);
    expect(recorded!.topAt1).toBeCloseTo(0.5316455696202531, 12);
  });

  it('keeps the OFF point recorded too, so the term was measured against its own ablation', () => {
    // The gain is only a gain against the same commit with the term off: `0` is a key
    // of the table for the same reason the latency weight's `0` is.
    expect(MEASURED_POOL_WEIGHTS['0']).toBeDefined();
    expect(MEASURED_POOL_WEIGHTS['0']!.hits).toBe(750);
    expect(MEASURED_POOL_WEIGHTS['0']!.regressedTypes).toBe(0);
  });
});

describe('FSE26 temporal prior is a measured PAIR', () => {
  const source = readFileSync(PRUNER_PATH, 'utf8');

  it('ships a weight whose recorded run has BOTH halves of the criterion green', () => {
    // A default is a claim about a measurement, and the criterion has TWO halves. A table
    // that can only record one of them lets a candidate ship on a green FSE'26 result
    // while the golden has collapsed — which is not hypothetical: the onset pair did
    // exactly that (FSE'26 +4, RE1 TrainTicket 68.0 → 27.2).
    const shippedWeight = readConstant(
      source,
      DEFAULT_TEMPORAL_WEIGHT_RE,
      'DEFAULT_TEMPORAL_WEIGHT',
    );
    const recorded = MEASURED_TEMPORAL_PAIRS[String(shippedWeight)];
    expect(
      recorded,
      `no recorded run for the shipped temporal weight ${shippedWeight}`,
    ).toBeDefined();
    expect(recorded!.cases).toBe(1422);
    expect(recorded!.regressedTypes).toBe(0);
    // The half that was missing. `moved` is a rejection, whatever the other half says.
    expect(recorded!.golden).toBe('identical');
  });

  it('requires the shape to be the one the recorded run used', () => {
    // A weight is a claim about a shape: carrying one without the other is not a
    // configuration, so a shape flipped on its own is as unmeasured as a weight flipped on
    // its own. Read from source in the same breath as the weight.
    const shippedWeight = readConstant(
      source,
      DEFAULT_TEMPORAL_WEIGHT_RE,
      'DEFAULT_TEMPORAL_WEIGHT',
    );
    const shippedShape = readStringConstant(source, DEFAULT_ONSET_SHAPE_RE, 'DEFAULT_ONSET_SHAPE');
    expect(shippedShape).toBe(MEASURED_TEMPORAL_PAIRS[String(shippedWeight)]!.shape);
  });

  it('requires the shipped point to have been measured through the DEFAULT path', () => {
    // A pinned flag and the engine's default are two owners of one value, and only the
    // second one ships. The rows above were reached with the weight pinned on the command
    // line — legitimate for a candidate, and for a control it is how the ablation is
    // named — but that pin was written when the default was different, and the whole point
    // of the revert is that the pin and the default can disagree. So the shipped weight
    // must ALSO have been measured with no flag at all, on both benchmarks.
    const shippedWeight = readConstant(
      source,
      DEFAULT_TEMPORAL_WEIGHT_RE,
      'DEFAULT_TEMPORAL_WEIGHT',
    );
    const recorded = MEASURED_TEMPORAL_PAIRS[String(shippedWeight)]!;
    expect(
      recorded.defaultPath,
      `the shipped temporal weight ${shippedWeight} has never been run without a pin`,
    ).toBeDefined();
    expect(recorded.defaultPath!.run).not.toBe(recorded.run);
    expect(recorded.defaultPath!.goldenRun).not.toBe(recorded.goldenRun);
    // Same criterion, same verdict: a default-path point that moved is a rejection too.
    expect(recorded.defaultPath!.golden).toBe('identical');
  });

  it('keeps the REJECTED candidate on the record, with both of its numbers', () => {
    // This is the test that pays for the whole table. A rejected candidate whose only
    // trace is a paragraph in a verdict document gets re-proposed as new by the next
    // session — the register exists because of that, and here the FSE'26 gain alone is
    // genuinely attractive (+4 cases, zero regressed types, the named four datapacks
    // flipped). So the rejection is data: its gain AND the cell it destroyed.
    const rejected = MEASURED_TEMPORAL_PAIRS['0.036552']!;
    expect(rejected.shape).toBe('earliest-only');
    expect(rejected.golden).toBe('moved');
    expect(rejected.regressedTypes).toBe(0);
    expect(rejected.hits).toBe(760);
    expect(rejected.control).toBe(MEASURED_TEMPORAL_PAIRS['0']!.run);
    // And a rejected candidate has no default path, because it never was one.
    expect(rejected.defaultPath).toBeUndefined();
  });

  it('keeps the region the intersection left open on the record, rejected by a RUN', () => {
    // The intersection instrument left exactly one temporal region open — `earliness`
    // `[0.007722, 0.010108)` — and named the bar it could not decide (`costsOnGainSide`:
    // the gain is bought at or above FSE'26's own cap of `0.005361`, so whether a case is
    // cost there is a fault-TYPE count no screen can make). This is the run that made the
    // count, at the midpoint the solver's own rule recommends.
    const rejected = MEASURED_TEMPORAL_PAIRS['0.008915']!;
    expect(rejected.shape).toBe('earliness');
    expect(rejected.regressedTypes).toBe(1);
    // Net zero: it gained one type and cost one, so even the type that improved bought
    // nothing — the control on the same commit (`temporalWeight=0`) totals 757 too. A
    // rejection that costs a case is not a rejection that gained a case.
    expect(rejected.hits).toBe(757);
    // And the record does not CLAIM the other half: it was never run, because a criterion
    // that is an AND needs only one failure. `unmeasured` is not `moved`.
    expect(rejected.golden).toBe('unmeasured');
    expect(rejected.defaultPath).toBeUndefined();
    // Its control is the same commit with the term ablated — `temporalWeight=0` — so the
    // trade is measured against a companion built from the same sources.
    expect(rejected.control).toBe('35420305720');
  });

  it('refuses to read an UNMEASURED golden half as anything but a failure', () => {
    // The table now holds a row whose other half was never run, so the guard's own
    // predicate has to be stated: only `identical` is green, and `unmeasured` is a row that
    // must never be shipped. Asserted over the whole table rather than one key, because the
    // next rejected candidate is the one that would otherwise be added quietly.
    const green = Object.entries(MEASURED_TEMPORAL_PAIRS).filter(
      ([, m]) => m.golden === 'identical',
    );
    // A guard that finds no green row is a guard over an empty table, which passes for
    // every candidate — the vacuity this file pays attention to.
    expect(green.length).toBeGreaterThan(0);
    for (const [weight, m] of Object.entries(MEASURED_TEMPORAL_PAIRS)) {
      if (m.golden !== 'identical') continue;
      expect(m.regressedTypes, weight).toBe(0);
      expect(m.defaultPath, weight).toBeDefined();
    }
    // And every row that skipped the other half did so because this half had already
    // failed: `unmeasured` is a row that was REJECTED, never one that was not checked.
    const unmeasured = Object.entries(MEASURED_TEMPORAL_PAIRS).filter(
      ([, m]) => m.golden === 'unmeasured',
    );
    expect(unmeasured.length).toBeGreaterThan(0);
    for (const [weight, m] of unmeasured) {
      expect(m.regressedTypes, weight).toBeGreaterThan(0);
      expect(m.defaultPath, weight).toBeUndefined();
    }
  });

  it('names the shipped shape in the workflow input a dispatcher reads', () => {
    // The same lesson as the latency pair's descriptions: the description is a second
    // owner of the value it quotes, and `onset_shape` is not covered by the numeric table
    // above because a shape is a word.
    const yml = readFileSync(WORKFLOW_PATH, 'utf8');
    const description = readInputDescription(yml, 'onset_shape');
    expect(description, 'onset_shape has no description to check').toBeDefined();
    expect(description).toContain('earliness');
    expect(description).not.toContain('default, which is earliest-only');
  });
});
