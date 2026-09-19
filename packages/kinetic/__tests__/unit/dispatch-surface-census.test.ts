/**
 * Census of the DISPATCH SURFACE: every ranking knob, its three names, and its owner.
 *
 * ## Why this exists
 *
 * A knob has **three names** and nothing owned the mapping between them:
 *
 *   workflow input      `fleet_baseline`
 *   CLI flag            `--fleet-baseline`
 *   engine option       `metricFleetBaseline`      <- NOT derivable from the other two
 *
 * The first two differ by a mechanical transform, so they can be checked against each
 * other. The third cannot, and the documents quote the THIRD: `fse26-metric-competition-verdict.md`
 * measures `metricFleetBaseline=true` at +0.49pp with six regressed fault types and
 * rejects it, while a search for the input name `fleet_baseline` finds **zero** mentions
 * anywhere in `docs/`. The same holds for `rise_ceiling` / `metricRiseCeiling`.
 *
 * That is not hypothetical: while writing this file, a careful hand search of the register
 * and every document concluded both knobs were **unmeasured**, and a candidate was drafted
 * around one of them. They had both been measured and rejected. The error was in the join,
 * not in the data — and the join had no owner.
 *
 * ## What the census asserts
 *
 * 1. The accepted flag set of each runner is read from its parser CHAIN, and every accepted
 *    flag must be bound to an engine option name (`opts.<name>`), so a flag that reaches no
 *    option cannot hide in the population by being silently dropped.
 * 2. Every workflow input maps to `--<input with underscores as hyphens>` in the runner it
 *    feeds, unless it is explicitly operational (it feeds a script, not the runner). This is
 *    the check that would have caught the historical `--log-mode count` defect, where a
 *    dispatch asked for one mode and silently ran another.
 * 3. Every ranking KNOB (by engine option name, the name the documents use) has an owner:
 *    a document that exists on disk, or one of three sentinels that are themselves asserted
 *    to be exact sets — so a knob cannot become ownerless by omission.
 * 4. The two structural facts the census found are recorded as exact sets rather than
 *    prose: the knobs whose option name is NOT derivable from their flag (which is what
 *    makes a document search miss them), and the knobs whose golden half is dispatchable.
 *
 * @module __tests__/unit/dispatch-surface-census
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const DOCS = resolve(repoRoot, 'docs');
const FSE26_CLI = resolve(repoRoot, 'benchmarks/src/fse26-cli.ts');
/**
 * The RCAEval parser, which moved out of `run-rcaeval.ts` for the reason the FSE'26 one already
 * records about itself: a module that calls `main()` at import time cannot be imported by a test,
 * so its parser was unreachable to every guard and its chain could not be driven directly. This
 * guard noticed the move by finding **zero** accepted flags, which is the vacuity floor below
 * doing its job rather than a coincidence.
 */
const RCAEVAL_CLI = resolve(repoRoot, 'benchmarks/src/rcaeval-cli.ts');
const FSE26_WORKFLOW = resolve(repoRoot, '.github/workflows/fse26-benchmark.yml');
const RCAEVAL_WORKFLOW = resolve(repoRoot, '.github/workflows/benchmark-rcaeval.yml');

/** The sentinel owners, each asserted to be an exact set below rather than a habit. */
const COMMENT_ONLY = 'comment-only';
const NOT_A_RANKING_KNOB = 'not-a-ranking-knob';

/**
 * `flag -> option`, read out of a runner's argument chain.
 *
 * The chain is the accepted set: a flag the parser does not test is a flag the runner
 * rejects, so reading it from the chain means the population cannot come from a usage
 * string or a comment (a usage string lists flags that may not be handled, and a comment
 * lists flags that may not exist).
 *
 * @param source - The runner's text.
 * @returns One entry per accepted flag, with the `opts.<name>` its branch assigns.
 */
function flagToOption(source: string): Map<string, string> {
  const branch = /(?:arg|args\[i\])\s*===\s*'(--[a-z-]+)'/g;
  const starts: { flag: string; at: number }[] = [];
  for (const m of source.matchAll(branch)) starts.push({ flag: m[1]!, at: m.index });
  const bound = new Map<string, string>();
  for (let i = 0; i < starts.length; i++) {
    const span = source.slice(starts[i]!.at, starts[i + 1]?.at ?? source.length);
    const option = /opts\.([A-Za-z][A-Za-z0-9]*)/.exec(span);
    if (option !== null) bound.set(starts[i]!.flag, option[1]!);
  }
  return bound;
}

/** The `workflow_dispatch` input names, in declaration order. */
function inputNames(yml: string): string[] {
  const start = yml.indexOf('workflow_dispatch');
  const end = yml.indexOf('\njobs:');
  expect(start, 'the workflow has no workflow_dispatch block').toBeGreaterThanOrEqual(0);
  expect(end, 'the workflow has no jobs block').toBeGreaterThan(start);
  return [...yml.slice(start, end).matchAll(/^ {6}([a-z_][a-z0-9_]*):\s*$/gm)].map((m) => m[1]!);
}

/** The flag an input is wired to, by the transform every workflow here uses. */
function flagOfInput(name: string): string {
  return '--' + name.replace(/_/g, '-');
}

/**
 * Inputs that bind something other than a runner flag.
 *
 * `shard_tag` selects the dataset release and `categories` filters the converter's output,
 * so neither reaches the engine — and the guard needs them named rather than exempted by a
 * pattern, because "not a runner flag" and "a runner flag that was typoed" look identical
 * to a matcher.
 */
const OPERATIONAL_INPUTS: Readonly<Record<string, string>> = {
  shard_tag: 'selects the rcabench-data release; consumed by the download step',
  categories: 'filters the converter output; consumed by the shard step',
};

/**
 * Options that are not ranking knobs at all.
 *
 * `fusionCeiling` sounds like one — it is named after a ceiling — but its argument is an
 * OUTPUT PATH: the runner joins the engine's top-1 with PRISM's and writes a JSON report
 * there. Classified rather than exempted, because the expensive misreading is the other
 * direction: treating a report path as an unmeasured opportunity.
 */
const NOT_KNOBS: readonly string[] = ['fusionCeiling'];

/**
 * Knobs whose only record is a code comment.
 *
 * `collapseDiscount` is a real ranking knob — it discounts the DROP half of a metric's
 * direction-aware deviation — and its measurement lives in the doc comment on
 * `computeMetricDirection` in `packages/tree/src/pruning/ranking-signals.ts`, citing
 * "benchmark #226/227". No document states it, so the register's fence (which reads
 * `docs/*.md`) cannot see it and a proposer cannot find it. Recorded here as the finding it
 * is; promoting it needs the measurement re-stated in a document, which is a different
 * iteration from a census.
 */
const COMMENT_ONLY_KNOBS: readonly string[] = ['collapseDiscount'];

/**
 * Every operational (non-ranking) option, with the reason it is not a knob.
 *
 * A `Record` rather than a list so that each exemption carries its reason: "not a ranking
 * knob" and "a ranking knob nobody has measured" are the same shape in a set, and the whole
 * point of this census is that those two must never be confused.
 */
const OPERATIONAL_OPTIONS: Readonly<Record<string, string>> = {
  dataDir: 'the case corpus root',
  maxCases: 'caps the population; a scope, not a term',
  output: 'the report path',
  system: 'selects one microservice system',
  suite: 'selects the RCAEval suite',
  noInjectTime: 'disables the injection anchor, which is an ablation of the SETUP',
  routingProbe: 'writes a routing-feasibility probe; an output path',
  diagnose: 'selects which cases render a diagnostic block',
  diagnoseLimit: 'caps how many blocks are rendered',
  diagnoseDump: 'writes the diagnostic dump; an output path',
  diagnoseDecimals: 'sets the dump render precision; a property of the ARTIFACT',
  dropMetrics: 'load-time ablation of the INPUT, applied before the engine runs',
};

/**
 * Every ranking knob: its flag, its owner, and which workflow can dispatch it.
 *
 * Keyed by ENGINE OPTION, because that is the name the documents and the run's own config
 * line use. `fse26`/`rcaeval` hold the workflow input that exposes the knob, or `null` when
 * that benchmark cannot dispatch it at all — which is a fact about the criterion, not
 * bookkeeping: the kill criterion is an AND over the two benchmarks, so a knob that only
 * one side can dispatch has an undecidable other half.
 */
const KNOBS: Readonly<
  Record<string, { flag: string; owner: string; fse26: string | null; rcaeval: string | null }>
> = {
  logWeight: {
    flag: '--log-weight',
    owner: 'fse26-shipped-config-verdict.md',
    fse26: 'log_weight',
    rcaeval: 'log_weight',
  },
  logMode: {
    flag: '--log-mode',
    owner: 'fse26-metric-gap-verdict.md',
    fse26: 'log_mode',
    rcaeval: null,
  },
  logSignalMode: {
    flag: '--log-signal-mode',
    owner: 'fse26-result-attribution.md',
    fse26: null,
    rcaeval: null,
  },
  rankNormalization: {
    flag: '--no-rank-normalization',
    owner: 'fse26-shipped-config-verdict.md',
    fse26: 'no_rank_normalization',
    rcaeval: 'no_rank_normalization',
  },
  metricRiseCeiling: {
    flag: '--rise-ceiling',
    owner: 'fse26-metric-competition-verdict.md',
    fse26: 'rise_ceiling',
    rcaeval: null,
  },
  metricFleetBaseline: {
    flag: '--fleet-baseline',
    owner: 'fse26-metric-competition-verdict.md',
    fse26: 'fleet_baseline',
    rcaeval: null,
  },
  failedEdgeWeight: {
    flag: '--failed-edge-weight',
    owner: 'fse26-failed-edge-verdict.md',
    fse26: 'failed_edge_weight',
    rcaeval: null,
  },
  failedEdgeMode: {
    flag: '--failed-edge-mode',
    owner: 'fse26-failed-edge-verdict.md',
    fse26: 'failed_edge_mode',
    rcaeval: null,
  },
  failedEdgeMinRecords: {
    flag: '--failed-edge-min-records',
    owner: 'fse26-failed-edge-verdict.md',
    fse26: 'failed_edge_min_records',
    rcaeval: null,
  },
  latWeight: {
    flag: '--lat-weight',
    owner: 'fse26-latency-term-verdict.md',
    fse26: 'lat_weight',
    rcaeval: null,
  },
  latMinRise: {
    flag: '--lat-min-rise',
    owner: 'fse26-latency-term-verdict.md',
    fse26: 'lat_min_rise',
    rcaeval: null,
  },
  poolMetricPenaltyWeight: {
    flag: '--pool-penalty',
    owner: 'fse26-pool-penalty-verdict.md',
    fse26: 'pool_penalty',
    rcaeval: null,
  },
  stabilityWeight: {
    flag: '--stability-weight',
    owner: 'fse26-cv-screen.md',
    fse26: 'stability_weight',
    rcaeval: 'stability_weight',
  },
  temporalWeight: {
    flag: '--temporal-weight',
    owner: 'fse26-onset-verdict.md',
    fse26: 'temporal_weight',
    rcaeval: 'temporal_weight',
  },
  onsetShape: {
    flag: '--onset-shape',
    owner: 'fse26-onset-verdict.md',
    fse26: 'onset_shape',
    rcaeval: 'onset_shape',
  },
  collisionWeight: {
    flag: '--collision-weight',
    owner: 're3-fault-ceiling.md',
    fse26: null,
    rcaeval: null,
  },
  topoWeight: {
    flag: '--topo-weight',
    owner: 'fse26-metric-competition-verdict.md',
    fse26: null,
    rcaeval: null,
  },
  traceWeight: {
    flag: '--trace-weight',
    owner: 'rank-collapse-falsified.md',
    fse26: null,
    rcaeval: null,
  },
  prismWeight: {
    flag: '--prism-weight',
    owner: 'fusion-routing-verdict.md',
    fse26: null,
    rcaeval: null,
  },
  collapseDiscount: {
    flag: '--collapse-discount',
    owner: COMMENT_ONLY,
    fse26: null,
    rcaeval: null,
  },
  suppressIdleTransients: {
    flag: '--suppress-idle-transients',
    owner: 'near-zero-rise-suppression-falsified.md',
    fse26: null,
    rcaeval: null,
  },
  suppressNearZeroBaselineRise: {
    flag: '--suppress-near-zero-baseline-rise',
    owner: 'near-zero-rise-suppression-falsified.md',
    fse26: null,
    rcaeval: null,
  },
  fusionCeiling: {
    flag: '--fusion-ceiling',
    owner: NOT_A_RANKING_KNOB,
    fse26: null,
    rcaeval: null,
  },
};

/**
 * The knobs whose option name is NOT derivable from their flag.
 *
 * Four, by three different mechanisms, and only the first two were found by hand — the
 * guard found the rest:
 *
 * 1. a `metric` prefix: `--rise-ceiling` -> `metricRiseCeiling`,
 *    `--fleet-baseline` -> `metricFleetBaseline`;
 * 2. an abbreviation: `--pool-penalty` -> `poolMetricPenaltyWeight`;
 * 3. a NEGATED pole: `rankNormalization` is reached by `--no-rank-normalization`, because
 *    the FSE'26 parser exposes only the negated switch (the RCAEval runner has both poles).
 *
 * Both of the first two are measured and rejected, and both are invisible to a search for
 * their input name — the trap this census exists to close. Recorded as an exact set, so a
 * NEW non-derivable name fails here and has to be added deliberately.
 */
const NON_DERIVABLE_OPTIONS: readonly string[] = [
  'metricFleetBaseline',
  'metricRiseCeiling',
  'poolMetricPenaltyWeight',
  'rankNormalization',
];

/**
 * The ranking knobs BOTH benchmarks can dispatch.
 *
 * The kill criterion's two halves live on two benchmarks, so this set is the set of axes
 * whose criterion is decidable by dispatch at all. It is one element long, and that one is
 * the knob added for the stability candidate: everything measured before it was pre-screened
 * through FSE'26 alone or solved offline on dumps.
 */
const DISPATCHABLE_ON_BOTH: readonly string[] = [
  'logWeight',
  'onsetShape',
  'rankNormalization',
  'stabilityWeight',
  'temporalWeight',
];

/**
 * The accepted ranking flags RCAEval cannot dispatch, as an exact set.
 *
 * 16 of the runner's 17 ranking flags are unreachable through the workflow, so a candidate
 * on any of them has an undecidable golden half unless an input is added first. That is not
 * a hypothetical consequence either: the temporal rejection carries `golden: 'unmeasured'`
 * for exactly this reason.
 */
const UNDISPATCHABLE_ON_RCAEVAL: readonly string[] = [
  '--collapse-discount',
  '--collision-weight',
  '--fusion-ceiling',
  '--log-signal-mode',
  '--no-suppress-idle-transients',
  '--no-suppress-near-zero-baseline-rise',
  '--prism-weight',
  '--rank-normalization',
  '--suppress-idle-transients',
  '--suppress-near-zero-baseline-rise',
  '--topo-weight',
  '--trace-weight',
];

const fse26Flags = flagToOption(readFileSync(FSE26_CLI, 'utf8'));
const rcaevalFlags = flagToOption(readFileSync(RCAEVAL_CLI, 'utf8'));
const fse26Inputs = inputNames(readFileSync(FSE26_WORKFLOW, 'utf8'));
const rcaevalInputs = inputNames(readFileSync(RCAEVAL_WORKFLOW, 'utf8'));

describe('the dispatch surface has one owner per knob', () => {
  it('reads a non-empty accepted set out of each runner, with every flag bound to an option', () => {
    // A floor rather than an equality, so adding a flag is allowed; but a flag that reaches
    // no `opts.` assignment would be silently DROPPED from the population, and a population
    // that shrinks to fit the table is the failure this whole family of guards keeps finding.
    expect(fse26Flags.size).toBeGreaterThanOrEqual(20);
    expect(rcaevalFlags.size).toBeGreaterThanOrEqual(25);
    for (const [flag, option] of fse26Flags) expect(option, flag).not.toBe('');
    for (const [flag, option] of rcaevalFlags) expect(option, flag).not.toBe('');
  });

  it('binds every workflow input to a flag its runner ACCEPTS', () => {
    // The `--log-mode count` defect in miniature: an input wired to a name the runner does
    // not test is a dispatch that runs something else and prints a confident number. It is
    // checked here rather than at dispatch time because a wrong configuration is only
    // visible in the artifact afterwards.
    const check = (inputs: readonly string[], accepted: Map<string, string>, which: string) => {
      for (const name of inputs) {
        if (name in OPERATIONAL_INPUTS) continue;
        expect(accepted.has(flagOfInput(name)), `${which} input ${name}`).toBe(true);
      }
    };
    check(fse26Inputs, fse26Flags, 'fse26');
    check(rcaevalInputs, rcaevalFlags, 'rcaeval');
  });

  it('classifies every input, so a NEW knob cannot arrive unowned', () => {
    // "Classified" is DERIVED rather than hand-listed: an input is accounted for when it is
    // a knob's input, when its flag binds an option recorded as operational (the reason
    // table above), or when it is one of the two that never reach the runner. A hand list
    // would be a fourth place to forget something.
    const knobInputs = new Set<string>();
    for (const knob of Object.values(KNOBS)) {
      if (knob.fse26 !== null) knobInputs.add(knob.fse26);
      if (knob.rcaeval !== null) knobInputs.add(knob.rcaeval);
    }
    const bindsOperational = (name: string, accepted: Map<string, string>): boolean => {
      const option = accepted.get(flagOfInput(name));
      return option !== undefined && option in OPERATIONAL_OPTIONS;
    };
    const unclassified = [
      ...fse26Inputs.filter((n) => !bindsOperational(n, fse26Flags)),
      ...rcaevalInputs.filter((n) => !bindsOperational(n, rcaevalFlags)),
    ].filter((name) => !knobInputs.has(name) && !(name in OPERATIONAL_INPUTS));
    expect(unclassified).toEqual([]);
    // And the exemptions for the two non-runner inputs are named, not pattern-matched.
    for (const name of Object.keys(OPERATIONAL_INPUTS)) {
      expect(fse26Inputs.includes(name) || rcaevalInputs.includes(name), name).toBe(true);
    }
    // Non-vacuity: the derived classification must be doing work, i.e. some inputs ARE
    // operational options rather than knobs.
    const operationalInputs = fse26Inputs.filter((n) => bindsOperational(n, fse26Flags));
    expect(operationalInputs.length).toBeGreaterThan(3);
  });

  it('covers every accepted ranking flag, keyed by the option name the documents use', () => {
    const acceptedOptions = new Set<string>();
    for (const option of [...fse26Flags.values(), ...rcaevalFlags.values()]) {
      if (!(option in OPERATIONAL_OPTIONS)) acceptedOptions.add(option);
    }
    // The table is keyed by option, so a knob added to a runner with no row here fails --
    // which is the only way an unmeasured knob can be caught before someone dispatches it.
    expect(new Set(Object.keys(KNOBS))).toEqual(acceptedOptions);
    // And each row's flag is the one the runner actually binds to that option.
    for (const [option, knob] of Object.entries(KNOBS)) {
      const bound = fse26Flags.get(knob.flag) ?? rcaevalFlags.get(knob.flag);
      expect(bound, `${knob.flag} must be accepted by a runner`).toBeDefined();
      expect(bound, `${knob.flag} -> ${option}`).toBe(option);
    }
  });

  it('names an owner for every knob, and the owner is a document that EXISTS', () => {
    const present = new Set(readdirSync(DOCS));
    for (const [option, knob] of Object.entries(KNOBS)) {
      if (knob.owner === COMMENT_ONLY || knob.owner === NOT_A_RANKING_KNOB) continue;
      expect(present.has(knob.owner), `${option} names ${knob.owner}`).toBe(true);
    }
  });

  it('records the TWO sentinel classifications as exact sets, and the unmeasured set as EMPTY', () => {
    // No ranking knob is merely unmeasured: every one has a document, except the single knob
    // whose only record is a comment. That is a strong claim, and it is only true once the
    // owner lookup is keyed by the OPTION name -- the search that keyed on the input name
    // reported two measured knobs as unmeasured.
    const comment = Object.entries(KNOBS)
      .filter(([, knob]) => knob.owner === COMMENT_ONLY)
      .map(([option]) => option);
    const notKnobs = Object.entries(KNOBS)
      .filter(([, knob]) => knob.owner === NOT_A_RANKING_KNOB)
      .map(([option]) => option);
    expect(comment).toEqual([...COMMENT_ONLY_KNOBS]);
    expect(notKnobs).toEqual([...NOT_KNOBS]);
    // Non-vacuity: the tables that would be satisfied by an empty population.
    expect(Object.keys(KNOBS).length).toBeGreaterThan(20);
    expect(comment.length + notKnobs.length).toBeLessThan(5);
  });

  it('records which option names are NOT derivable from their flag', () => {
    // The trap, as data: these two are measured and rejected, and a search for their INPUT
    // name finds nothing anywhere. Adding a third has to be deliberate.
    const nonDerivable = Object.entries(KNOBS)
      .filter(([option, knob]) => {
        const camel = knob.flag.slice(2).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        return camel !== option;
      })
      .map(([option]) => option)
      .sort();
    expect(nonDerivable).toEqual([...NON_DERIVABLE_OPTIONS].sort());
  });

  it('records exactly which knobs BOTH benchmarks can dispatch', () => {
    const both = Object.entries(KNOBS)
      .filter(([, knob]) => knob.fse26 !== null && knob.rcaeval !== null)
      .map(([option]) => option)
      .sort();
    expect(both).toEqual([...DISPATCHABLE_ON_BOTH].sort());
    // The criterion is an AND over two benchmarks, so a single-knob intersection is the
    // statement that its two halves have been decidable together for one axis only.
    const fse26Only = Object.values(KNOBS).filter((k) => k.fse26 !== null).length;
    const rcaevalOnly = Object.values(KNOBS).filter((k) => k.rcaeval !== null).length;
    expect(fse26Only).toBeGreaterThan(both.length);
    expect(rcaevalOnly).toBe(both.length);
  });

  it('reads the shipped weight from its OWNER, so a moved constant cannot leave a copy behind', () => {
    // A parser that falls back to a literal agrees with the engine today and diverges the moment the
    // constant moves — the failure mode that once published a headline 24.2pp below the best-measured
    // one. It cannot be caught behaviourally, because the two agree NOW, so it is caught in the
    // SOURCE: a term with an exported default must name it, and only `0` — the unambiguous "off"
    // value of an opt-in term that has no constant of its own — may be a literal fallback.
    const owned = [
      'logWeight',
      'latWeight',
      'poolMetricPenaltyWeight',
      'stabilityWeight',
      'temporalWeight',
    ];
    const sources = [
      { name: 'fse26-cli', text: readFileSync(FSE26_CLI, 'utf8'), accepted: fse26Flags },
      { name: 'rcaeval-cli', text: readFileSync(RCAEVAL_CLI, 'utf8'), accepted: rcaevalFlags },
    ];
    for (const { name, text, accepted } of sources) {
      // Non-vacuity DERIVED rather than listed: the owned knobs a parser must name are the owned
      // knobs whose flag that parser accepts, which the extraction above already knows.
      const expected = Object.entries(KNOBS)
        .filter(([, knob]) => accepted.has(knob.flag))
        .map(([option]) => option)
        .filter((option) => owned.includes(option));
      expect(expected.length, `${name} must own at least one of them`).toBeGreaterThan(0);
      for (const knob of expected) {
        expect(text, `${name}: ${knob} must read its constant`).not.toMatch(
          new RegExp(`${knob}: (?!DEFAULT_)\\d`),
        );
        expect(text, `${name} names ${knob}`).toContain(knob);
      }
      expect(text, `${name}: no non-zero literal fallback`).not.toMatch(
        /parseWeight\([^)]*!, (?!0\b)(?!DEFAULT_)\d/,
      );
    }
    // And the extraction really does cover both parsers, so the loop is not asserting over one.
    expect(sources.map((s) => s.accepted.size).every((n) => n > 10)).toBe(true);
  });

  it('records every dispatch a workflow actually has, not merely the ones it claims', () => {
    // The direction that was missing, and it was missing in the expensive way: every other assertion
    // reads the table and asks whether the workflow agrees, so a table that UNDER-REPORTS a dispatch
    // passes all of them. Measured, not hypothesised: four inputs were added to the RCAEval workflow
    // and the guard stayed green, because the intersection it checks is computed from this table
    // rather than from the workflows.
    const declared = (inputs: readonly string[], accepted: Map<string, string>): string[] =>
      inputs
        .filter((name) => !(name in OPERATIONAL_INPUTS))
        .map((name) => accepted.get(flagOfInput(name)))
        .filter(
          (option): option is string => option !== undefined && !(option in OPERATIONAL_OPTIONS),
        );
    const recorded = (side: 'fse26' | 'rcaeval'): string[] =>
      Object.entries(KNOBS)
        .filter(([, knob]) => knob[side] !== null)
        .map(([option]) => option);
    expect(new Set(declared(rcaevalInputs, rcaevalFlags))).toEqual(new Set(recorded('rcaeval')));
    expect(new Set(declared(fse26Inputs, fse26Flags))).toEqual(new Set(recorded('fse26')));
    // Non-vacuity both ways: each workflow must declare something, and the sets must be unequal
    // because RCAEval still exposes fewer knobs than FSE'26 does.
    expect(declared(rcaevalInputs, rcaevalFlags).length).toBeGreaterThan(1);
    expect(declared(fse26Inputs, fse26Flags).length).toBeGreaterThan(
      declared(rcaevalInputs, rcaevalFlags).length,
    );
  });

  it('records the flags RCAEval accepts but cannot dispatch, as an exact set', () => {
    const unreachable = [...rcaevalFlags.keys()]
      .filter((flag) => {
        const option = rcaevalFlags.get(flag)!;
        if (option in OPERATIONAL_OPTIONS) return false;
        return !Object.values(KNOBS).some((k) => k.rcaeval !== null && k.flag === flag);
      })
      .sort();
    expect(unreachable).toEqual([...UNDISPATCHABLE_ON_RCAEVAL].sort());
    expect(unreachable.length).toBeGreaterThan(10);
  });
});
