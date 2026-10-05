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
 * Whether a workflow's text can reach a flag — in CODE, not in prose.
 *
 * Two rules, both measured rather than assumed:
 *
 * The flag's own spelling at a TOKEN boundary, not a substring, so `--diagnose` is not "reached" by
 * `--diagnose-decimals` — the prefix trap.
 *
 * And COMMENT text does not count. These workflows document their flags in `#` blocks right above
 * the code that passes them, so a plain text search reports a flag as REACHED when its only mention
 * is the sentence describing it. Measured: with `--diagnose-decimals` renamed at the one place it is
 * passed, this guard still passed — on a comment four lines above. A usage string lists flags that
 * may not be handled; a comment lists flags that may not exist.
 *
 * The stripping is deliberately crude, and the crudeness is ONE-WAY: removing text can only make a
 * flag look UNREACHED, which fails the guard loudly, never silently passes it.
 */
function reaches(flag: string, text: string): boolean {
  const code = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .map((line) => line.replace(/\s#.*$/, ''))
    .join('\n');
  return new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9-])').test(code);
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
    rcaeval: 'log_signal_mode',
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
 * whose criterion is decidable by dispatch at all. It was one element long when it was
 * first written — the knob added for the stability candidate — and grew to five when the
 * four knobs both runners accepted were exposed on the RCAEval side.
 *
 * `logSignalMode` is the sixth, and it arrived by a different route than a workflow input:
 * the RCAEval RUNNER accepted `--log-signal-mode` all along but parsed it against a
 * hand-written two-member list, so four of the six members of `LogSignalMode` — including
 * `all` — were silently replaced by `count`. The input could not be added until the
 * vocabulary was the engine's, which is why the two changes travel together: a dispatch
 * that names a mode the runner would discard is worse than no dispatch at all.
 *
 * It is also the member that exposes a second join this table was missing, which
 * {@link AXIS_OF_OPTION} records: the two runners spell one engine axis twice.
 */
const DISPATCHABLE_ON_BOTH: readonly string[] = [
  'logSignalMode',
  'logWeight',
  'onsetShape',
  'rankNormalization',
  'stabilityWeight',
  'temporalWeight',
];

/**
 * The CLI option names that are two spellings of ONE engine axis.
 *
 * Rows here are keyed by `opts.<name>` — the name a runner ASSIGNS, which is the only name its
 * own parser can be read for. Two runners may therefore spell one axis twice, and nothing joined
 * them: `fse26-cli.ts` assigns `opts.logMode` for its `--log-mode` while `rcaeval-cli.ts` assigns
 * `opts.logSignalMode` for its `--log-signal-mode`, and BOTH become the engine's single
 * `logSignalMode` field (`fse26-engine-options.ts`: `logSignalMode: opts.logMode`).
 *
 * The consequence was structural rather than cosmetic. The intersection "knobs BOTH benchmarks can
 * dispatch" is computed over ROWS, so an axis spelled twice could never appear in it: adding the
 * golden input for the log mode would have left the intersection at five while the axis had in
 * fact become decidable. That is the same defect this whole file exists for — a JOIN with no
 * owner — one level up from the flag↔option join it was written to close.
 *
 * The alias is not invented here: `benchmarks/__tests__/fse26-engine-options.test.ts` records
 * `{ logMode: 'logSignalMode' }` to explain why `opts.logMode` is accounted for, and both places
 * now name the same pair. Recorded as an exact map, so a THIRD spelling has to be deliberate.
 */
const AXIS_OF_OPTION: Readonly<Record<string, string>> = {
  logMode: 'logSignalMode',
};

/** The engine axis an option belongs to — itself, unless it is a second spelling of one. */
function axisOf(option: string): string {
  return AXIS_OF_OPTION[option] ?? option;
}

/**
 * The accepted ranking flags RCAEval cannot dispatch, as an exact set.
 *
 * 11 of the runner's 17 ranking flags are unreachable through the workflow, so a candidate
 * on any of them has an undecidable golden half unless an input is added first. That is not
 * a hypothetical consequence either: the temporal rejection carries `golden: 'unmeasured'`
 * for exactly this reason.
 *
 * `--log-signal-mode` LEFT this set when its workflow input was added. It is recorded rather
 * than silently dropped, because the members of the set are the register's inventory of open
 * axes and a set that shrinks without a note is a set nobody can audit.
 */
const UNDISPATCHABLE_ON_RCAEVAL: readonly string[] = [
  '--collapse-discount',
  '--collision-weight',
  '--fusion-ceiling',
  '--no-suppress-idle-transients',
  '--no-suppress-near-zero-baseline-rise',
  '--prism-weight',
  '--rank-normalization',
  '--suppress-idle-transients',
  '--suppress-near-zero-baseline-rise',
  '--topo-weight',
  '--trace-weight',
];

/**
 * Artifact-shaping flags a runner ACCEPTS and its own workflow cannot reach, as an exact set.
 *
 * The dispatchability assertions above are written for RANKING knobs, and they exempt
 * {@link OPERATIONAL_OPTIONS} by design — which is precisely where a false claim came to live.
 * `fse26-cv-screen.md` states that the dump precision "is now an input to all seven dump steps
 * (`--diagnose-decimals`), so the same dispatch that renders FSE'26 at four decimals also settles
 * whether the window is admitted", and the register records the ONE `needs 1` window — FSE'26's
 * stability `flip` — as a prediction **one dispatch away**. The seven steps are the RCAEval suites.
 * On the FSE'26 side the flag was accepted by no parser, threaded by no runner and declared by no
 * workflow, so the prediction was not one dispatch away; it was unreachable.
 *
 * A ranking knob's absence is caught by the tables above. An OPERATIONAL option's absence was
 * caught by nothing, because "not a ranking knob" and "a knob nobody wired" are the same shape in a
 * set — the same reason {@link OPERATIONAL_OPTIONS} carries its reasons. So this check runs in the
 * direction that finds it: what a runner accepts must be REACHABLE from the workflow that drives
 * it, or be named here WITH its reason.
 *
 * The reachability test is the flag's own spelling at a token boundary, not a substring: a
 * substring search would let `--diagnose` be "reached" by `--diagnose-decimals`, which is the
 * prefix trap, and would make the check pass on a workflow that never passes the flag.
 */
const OPERATIONAL_FLAGS_UNREACHABLE: Readonly<Record<string, string>> = {
  '--routing-probe':
    'writes a routing-feasibility probe; an output path the workflow does not read back',
  '--system':
    'narrows one suite to a single microservice system; the workflow dispatches whole suites',
};

const fse26Flags = flagToOption(readFileSync(FSE26_CLI, 'utf8'));
const rcaevalFlags = flagToOption(readFileSync(RCAEVAL_CLI, 'utf8'));
const fse26Inputs = inputNames(readFileSync(FSE26_WORKFLOW, 'utf8'));
/**
 * Every step of a workflow whose RUN LINE can name a flag, with the flags it can name.
 *
 * A step's command line is not only the literal tokens written on it: it also expands shell arrays,
 * and those arrays are built a few lines above, inside the same `run:` block. So the set of flags a
 * step can name is the literals PLUS whatever the arrays it expands add — and a flag in BOTH is a
 * step that states one knob twice, whose meaning then depends on the parser's tie-break.
 *
 * That is not hypothetical here: `benchmark-rcaeval.yml`'s RE3 job pins its mode with
 * `--log-signal-mode novelty` and then expands `RANKING_ARG`, which carries the same flag from a
 * `workflow_dispatch` input. Measured, the parser honours the LAST occurrence, so a dispatch asking
 * for `all` ran `all` in the step whose entire purpose is the `novelty` reference — and the artifact
 * is still uploaded as `rcaeval-re3-novelty-results.txt`.
 *
 * @param yml - A workflow's text.
 * @returns One entry per step that invokes a runner.
 */
function runBlocks(yml: string): {
  readonly label: string;
  readonly literals: ReadonlySet<string>;
  readonly arrays: ReadonlyMap<string, ReadonlySet<string>>;
  readonly expanded: readonly string[];
}[] {
  const out: ReturnType<typeof runBlocks> = [];
  const starts = [...yml.matchAll(/^ {6}- name: (.+)$/gm)];
  for (let i = 0; i < starts.length; i++) {
    const span = yml.slice(starts[i]!.index, starts[i + 1]?.index ?? yml.length);
    // The body runs to the end of the STEP, which the slice already bounded, and the anchor is a
    // NEWLINE rather than `^` for a reason this took two corrections to find: `^` without `/m`
    // anchors at the start of the whole string, so it matched no step at all — and `$` WITH `/m`
    // matches end-of-LINE, which would have captured a single line. Both failures were silent; the
    // non-vacuity guard below is the only reason either was seen instead of the check passing over
    // an empty population.
    const run = /\n *run: \|\n([\s\S]*)$/.exec(span);
    if (run === null) continue;
    const body = run[1]!;
    const command = body
      .split('\n')
      .filter((line) => /benchmarks\/src\/run-[a-z0-9-]+\.ts/.test(line))
      .join('\n');
    if (command === '') continue;
    const literals = new Set(
      [...command.matchAll(/(?<![A-Za-z0-9_-])(--[a-z][a-z0-9-]*)/g)].map((m) => m[1]!),
    );
    const arrays = new Map<string, Set<string>>();
    for (const m of body.matchAll(/^\s+([A-Z_][A-Z0-9_]*)\+=\s*\((--[a-z][a-z0-9-]*)/gm)) {
      const set = arrays.get(m[1]!) ?? new Set<string>();
      set.add(m[2]!);
      arrays.set(m[1]!, set);
    }
    const expanded = [...command.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\[@\]\}/g)].map((m) => m[1]!);
    out.push({ label: starts[i]![1]!.trim(), literals, arrays, expanded });
  }
  return out;
}

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
    // Asked of AXES, not of rows. A row is a spelling a runner assigns; an axis is the engine
    // option it reaches. The log mode is the case that proves the difference: `logMode` and
    // `logSignalMode` are two rows and one axis, and a row-wise intersection reported the axis as
    // undispatchable on the golden half even once its input existed.
    const rowsOn = (side: 'fse26' | 'rcaeval'): string[] =>
      Object.entries(KNOBS)
        .filter(([, knob]) => knob[side] !== null)
        .map(([option]) => axisOf(option));
    const both = [...new Set(Object.keys(KNOBS).map(axisOf))]
      .filter((axis) => rowsOn('fse26').includes(axis) && rowsOn('rcaeval').includes(axis))
      .sort();
    expect(both).toEqual([...DISPATCHABLE_ON_BOTH].sort());
    // The criterion is an AND over two benchmarks, so this set is the statement of which axes
    // have both halves. FSE'26 still reaches more axes than the golden half does, and the golden
    // half reaches exactly the intersection — a golden side that could dispatch an axis the
    // FSE'26 side could not would be a knob added without an owner.
    const fse26Axes = new Set(rowsOn('fse26'));
    const rcaevalAxes = new Set(rowsOn('rcaeval'));
    expect(fse26Axes.size).toBeGreaterThan(both.length);
    expect([...rcaevalAxes].sort()).toEqual([...both].sort());
    // Non-vacuity for the join itself: the map must name a pair that BOTH tables actually hold,
    // or it would be a comment wearing a data structure's clothes. Without this, an alias that
    // named nothing would leave the intersection computed over rows and still pass.
    expect(Object.keys(AXIS_OF_OPTION).length).toBeGreaterThan(0);
    for (const [option, axis] of Object.entries(AXIS_OF_OPTION)) {
      expect(option in KNOBS, `${option} must be a row`).toBe(true);
      expect(axis in KNOBS, `${axis} must be a row`).toBe(true);
      expect(option).not.toBe(axis);
    }
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

  it('reaches every artifact-shaping flag a runner accepts, or names the exception', () => {
    // The direction the ranking tables cannot cover, and the one that would have caught the FSE'26
    // dump precision: an OPERATIONAL flag a runner accepts and no workflow ever passes. Ranked
    // flags have a table each; operational options had an exemption, and the exemption is where a
    // document could assert a dispatch that did not exist.
    const unreached = (accepted: Map<string, string>, text: string): string[] =>
      [...accepted.keys()]
        .filter((flag) => accepted.get(flag)! in OPERATIONAL_OPTIONS)
        .filter((flag) => !reaches(flag, text))
        .sort();
    const found = [
      ...unreached(fse26Flags, readFileSync(FSE26_WORKFLOW, 'utf8')),
      ...unreached(rcaevalFlags, readFileSync(RCAEVAL_WORKFLOW, 'utf8')),
    ].sort();
    expect(found).toEqual(Object.keys(OPERATIONAL_FLAGS_UNREACHABLE).sort());
    // Non-vacuity: the check must have a population to walk on BOTH sides, or it is asserting over
    // one runner and reporting the other as clean.
    for (const [which, accepted] of [
      ['fse26', fse26Flags],
      ['rcaeval', rcaevalFlags],
    ] as const) {
      const population = [...accepted.keys()].filter(
        (flag) => accepted.get(flag)! in OPERATIONAL_OPTIONS,
      );
      expect(population.length, `${which} operational population`).toBeGreaterThan(3);
    }
    // And the two traps the boundary-and-comment rules exist for, asserted directly rather than
    // trusted: the flags share a prefix, and this workflow names the flag in a comment above the
    // single line that passes it. A text search that ignores either reports a rehearsal as a
    // dispatch.
    expect('${DIAGNOSE_ARG[@]}'.includes('--diagnose')).toBe(false);
    expect(reaches('--diagnose-decimals', '#   `--diagnose-decimals` parses to the default')).toBe(
      false,
    );
    expect(reaches('--diagnose-decimals', '  --diagnose-decimals "${{ inputs.x }}" \\')).toBe(true);
    expect(reaches('--diagnose-decimals', '--diagnose-decimals-typo')).toBe(false);
  });

  it('reaches from BOTH workflows every artifact-shaping option BOTH runners accept', () => {
    // The sharper form of the rule above, and the one the FSE'26 dump precision failed. The kill
    // criterion's two halves live on two benchmarks, and the dump is the artifact BOTH screens read
    // — so an artifact-shaping option both runners accept but only one workflow passes makes the
    // two dumps incomparable in a way no reader can see: each still parses, and each still declares
    // a precision. `diagnoseDecimals` was in exactly that state, and the prediction that depended on
    // it — FSE'26's one `needs 1` window — was recorded as one dispatch away.
    //
    // The population is derived, not listed: an option here is one that BOTH parsers accept AND
    // that the reason table classifies as operational. `output` is absent because only the FSE'26
    // parser has it in this sense; `diagnose` and `diagnoseLimit` because only the FSE'26 one does.
    const both = Object.keys(OPERATIONAL_OPTIONS)
      .filter((option) => {
        const inFse26 = [...fse26Flags.values()].includes(option);
        const inRcaeval = [...rcaevalFlags.values()].includes(option);
        return inFse26 && inRcaeval;
      })
      .sort();
    expect(both).toEqual(['dataDir', 'diagnoseDecimals', 'maxCases']);
    // Non-vacuity: the derived population must not be empty, and it must be a strict subset of
    // what one runner accepts — otherwise "both" would be measuring a single runner twice.
    expect(both.length).toBeGreaterThan(1);
    expect(both.length).toBeLessThan(
      [...fse26Flags.values()].filter((o) => o in OPERATIONAL_OPTIONS).length,
    );
    // Each runner's OWN flag is the one looked for, because the two spellings can differ even for
    // a shared option; and each workflow must reach it.
    const texts = {
      fse26: readFileSync(FSE26_WORKFLOW, 'utf8'),
      rcaeval: readFileSync(RCAEVAL_WORKFLOW, 'utf8'),
    };
    const accepted = { fse26: fse26Flags, rcaeval: rcaevalFlags };
    for (const option of both) {
      for (const which of ['fse26', 'rcaeval'] as const) {
        const flag = [...accepted[which].entries()].find(([, o]) => o === option)?.[0];
        expect(flag, `${which} accepts ${option}`).toBeDefined();
        expect(reaches(flag!, texts[which]), `${which} must reach ${flag}`).toBe(true);
      }
    }
  });

  it('never lets a step PIN a flag that an array it expands also sets', () => {
    // The direction no other assertion here reads. Every check above asks whether a KNOB is
    // reachable; none asked what a single command line means when it names the same knob twice, and
    // the answer is not a property of the knob but of the parser's tie-break — which is exactly why
    // it went unseen through the change that created it. Iteration 42 made the log mode dispatchable
    // on the golden half and passed the new flag at all seven ranking sites, including the RE3 job's
    // novelty reference, whose mode is pinned by hand on the same command line. Measured: the parser
    // honours the LAST occurrence, so the reference silently ran a candidate's mode and filed it
    // under the reference's name.
    //
    // The invariant is stated over POPULATIONS rather than over this one flag, because the flag will
    // change and the shape will not: a step may pin a flag, or it may expand an array that sets one,
    // never both.
    // BOTH workflows, because the shape is not RCAEval-specific: FSE'26 has one runner step and
    // could grow the same defect, and a fence over one workflow is half a fence. The counts below
    // are what makes the difference between "clean" and "unread" visible.
    const counts: Record<string, number> = {};
    for (const [which, path] of [
      ['rcaeval', RCAEVAL_WORKFLOW],
      ['fse26', FSE26_WORKFLOW],
    ] as const) {
      const blocks = runBlocks(readFileSync(path, 'utf8'));
      counts[which] = blocks.length;
      const offenders: string[] = [];
      for (const block of blocks) {
        const viaArray = new Set<string>();
        for (const name of block.expanded) {
          for (const flag of block.arrays.get(name) ?? []) viaArray.add(flag);
        }
        const twice = [...block.literals].filter((flag) => viaArray.has(flag)).sort();
        if (twice.length > 0)
          offenders.push(`${which}: ${block.label} states ${twice.join(', ')} twice`);
      }
      expect(offenders, `${which} must not pin a flag its own arrays set`).toEqual([]);
    }
    // Non-vacuity: the population has to be real. Steps that expand an array which adds at least one
    // flag are the only ones the invariant can be violated by, and there must be several, or the
    // loop above would be asserting over an empty set of interesting shapes. The second count is the
    // one that failed when the helper was broken, so it is kept as the guard on the guard.
    expect(counts.rcaeval).toBeGreaterThan(5);
    expect(counts.fse26).toBeGreaterThan(0);
    const withArrayFlags = [
      ...runBlocks(readFileSync(RCAEVAL_WORKFLOW, 'utf8')),
      ...runBlocks(readFileSync(FSE26_WORKFLOW, 'utf8')),
    ].filter((block) => block.expanded.some((n) => (block.arrays.get(n)?.size ?? 0) > 0));
    expect(withArrayFlags.length).toBeGreaterThan(4);
  });
});
