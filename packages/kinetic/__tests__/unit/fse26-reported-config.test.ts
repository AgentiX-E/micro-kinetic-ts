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
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
} from '../../../../packages/tree/src/index.js';

// packages/kinetic/__tests__/unit/ → four levels up is the repository root.
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const WORKFLOW_PATH = resolve(repoRoot, '.github/workflows/fse26-benchmark.yml');
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
    run: string;
    control: string;
  }
> = {
  '0.036552': {
    shape: 'earliest-only',
    topAt1: 0.5344585091420534,
    hits: 760,
    cases: 1422,
    regressedTypes: 0,
    run: '35021510164',
    control: '35021503281',
  },
};

/** The same commit with the term off — the arm a gain is a gain AGAINST. */
const MEASURED_TEMPORAL_OFF = {
  topAt1: 0.5316455696202531,
  hits: 756,
  cases: 1422,
  regressedTypes: 0,
  run: '35021503281',
};

/**
 * Where the engine's shipped temporal weight is declared.
 *
 * A third owner of "what the record is keyed by", so it is read as text exactly like
 * the latency and pool weights above.
 */
const DEFAULT_TEMPORAL_WEIGHT_RE = /DEFAULT_TEMPORAL_WEIGHT\s*=\s*([0-9.]+)/;

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
    log_weight: 1,
    failed_edge_weight: 0,
    failed_edge_min_records: 1,
    lat_weight: DEFAULT_LAT_WEIGHT,
    lat_min_rise: DEFAULT_LAT_MIN_RISE,
    pool_penalty: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
    temporal_weight: DEFAULT_TEMPORAL_WEIGHT,
    diagnose_limit: 3,
  };

  it('names the shipped value of every input whose description quotes one', () => {
    const yml = readFileSync(WORKFLOW_PATH, 'utf8');
    for (const [input, shipped] of Object.entries(DESCRIBES_SHIPPED)) {
      const description = readInputDescription(yml, input);
      expect(description, `${input} has no description to check`).toBeDefined();
      expect(description, `${input} must name the shipped ${shipped}`).toContain(String(shipped));
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

  it('ships a weight AND a shape that were measured together', () => {
    // A weight is a claim about a shape. The engine's only non-zero measurement of this
    // signal before the pair used the min-max `earliness` shape and was a net REGRESSION
    // on RCAEval, so a shipped weight quoted alone would not identify a configuration
    // that anyone has run.
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
    expect(recorded!.topAt1).toBeCloseTo(0.5344585091420534, 12);

    // The other half of the pair, read from source in the same breath: a shape flipped
    // without a run is exactly as unmeasured as a weight flipped without one, and the
    // guard's whole job is to make that impossible to do silently.
    const shippedShape = readStringConstant(source, DEFAULT_ONSET_SHAPE_RE, 'DEFAULT_ONSET_SHAPE');
    expect(shippedShape).toBe(recorded!.shape);
  });

  it('keeps the OFF point recorded, on one commit, so the gain has an arm', () => {
    // `+4` is a difference, and a difference needs both sides measured at the same
    // commit and the same dataset — otherwise it is a comparison of two runs.
    const recorded = MEASURED_TEMPORAL_PAIRS['0.036552']!;
    expect(recorded.control).toBe(String(MEASURED_TEMPORAL_OFF.run));
    expect(MEASURED_TEMPORAL_OFF.hits).toBe(756);
    expect(MEASURED_TEMPORAL_OFF.regressedTypes).toBe(0);
    expect(recorded.hits - MEASURED_TEMPORAL_OFF.hits).toBe(4);
  });

  it('names the shipped shape in the workflow input a dispatcher reads', () => {
    // The same lesson as the latency pair's descriptions: the description is a second
    // owner of the value it quotes, and `onset_shape` is not covered by the numeric
    // table above because a shape is a word.
    const yml = readFileSync(WORKFLOW_PATH, 'utf8');
    const description = readInputDescription(yml, 'onset_shape');
    expect(description, 'onset_shape has no description to check').toBeDefined();
    expect(description).toContain('earliest-only');
    expect(description).not.toContain('default, which is earliness');
  });
});
