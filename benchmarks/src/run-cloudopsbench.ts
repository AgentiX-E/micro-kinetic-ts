/**
 * Cloud-OpsBench runner — the first score this engine has ever taken on that corpus.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-cloudopsbench.ts --data-dir <checkout> [--output <path>]
 *     [--max-cases N] [--no-inject-time]
 *
 * ## What this prints, and the one comparison it licenses
 *
 * A table of cells: `system × category`, each with `CA@1` (the fraction whose first-ranked entity is the labelled
 * one), `Top@3`, `Top@5`, and `ranked` (the fraction whose labelled entity appears anywhere in the ranking). The
 * corpus publishes `CA` — 0.88 on Online Boutique and 0.70 on Train Ticket, by its own paper — so `CA@1` is the
 * column that may be compared with it, and `ranked` is the column that says whether a gap is a retrieval or a
 * reranking problem.
 *
 * The corpus's headline score is `JRA`, which multiplies correctness by evidence closure. This engine is not
 * scored on it and this runner does not print it: the corpus's twelve tools read Kubernetes objects, so 0 of 754
 * cases have every milestone inside this engine's metric/log/edge surface
 * (`docs/closed-axes-register.md` §361). A `JRA` here would be a zero this programme wrote into its own
 * numerator, not a property of the engine.
 *
 * ## The configuration is the shipped default, by construction
 *
 * The engine is assembled from `buildRCAEvalEngineOptions(parseRCAEvalArgs([]))` — the same call the anchor
 * fingerprint test hashes and the RCAEval cells are produced with — so a difference between a cell here and a
 * cell there is telemetry and not options. `--no-inject-time` forwards no injection time, which is the ablation
 * that separates "the alert window told it where to look" from "the metric table did".
 *
 * The label prior is the one option whose VALUE also decides what this runner has to prepare: at a non-zero weight
 * the term reads a per-case history that has to be attached to the cases before they are scored, and at `0` it reads
 * nothing. Both decisions are therefore taken from one resolved option object (`resolveEngineOptions`) rather than
 * from the command line — the previous version asked the RAW flag, which agreed with the engine only while the
 * shipped weight was `0`.
 *
 * @module benchmarks/run-cloudopsbench
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Container,
  DEFAULT_CLASSIFICATION_RULES,
  DI_TOKENS,
  RegexFaultClassifier,
} from '../../packages/core/src/index.js';
import { BenchmarkRunner } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';

// Imported from the module that DEFINES it rather than from the benchmarks index: `benchmarks/index.ts` re-exports
// this function inside an `export type { … }` block, where a value is erased — so the name is unusable there and a
// reader who took the index's word for it would import `undefined` in a JavaScript build.
import { acceptedTruthServiceIds } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import {
  compareArms,
  parseArmBaseline,
  ranksToReading,
  renderArmComparison,
} from './cloudopsbench-arm-baseline.js';
import { listCaseIds, readCloudOpsCase, type CloudOpsCase } from './cloudopsbench-case.js';
import { parseCloudOpsArgs } from './cloudopsbench-cli.js';
import {
  pricesLabelPrior,
  resolveEngineOptions,
  type EngineOverrides,
} from './cloudopsbench-engine-options.js';
import { censusCaseLogs, renderLogCensus, type LogCensus } from './cloudopsbench-logs.js';
import { formatCellTable, formatRate, scoreByCell, type CellScore } from './cloudopsbench-score.js';
import {
  REFUSAL_ORDER,
  selectScorable,
  type CaseTopology,
  type ScorableSelection,
} from './cloudopsbench-suite.js';
import {
  buildSystemLabelPrior,
  withLabelPrior,
  type LabelledCase,
} from './label-prior-profiles.js';
import type { RCAEvalEngineOptions } from './rcaeval-engine-options.js';
import { initRCAEvalTopology } from './rcaeval-topology.js';

/**
 * Read a checkout and keep only the cases this engine can be scored on.
 *
 * `maxCases` caps the NUMBER OF DIRECTORIES READ, not the number of scorable cases: a cap applied after selection
 * would change what the denominator means while leaving the printed rate looking ordinary, and a cap applied before
 * it can only shrink the corpus a smoke run sees.
 *
 * @param dataDir - The checkout root.
 * @param maxCases - Optional cap, for a smoke run.
 * @param topology - The graph arm; `registry` for every published number.
 * @param withLogs - Whether each case's `raw_data/logs.json` is read and attached to the engine's log channel.
 * @returns The selection, how many directories were entered, every directory a reader refused, and the log census.
 */
export function loadSelection(
  dataDir: string,
  maxCases: number | undefined,
  topology: CaseTopology = 'registry',
  withLogs = false,
): {
  readonly selection: ScorableSelection;
  readonly directories: number;
  readonly refusedReads: readonly string[];
  readonly logCensus: LogCensus;
} {
  const ids = listCaseIds(dataDir);
  const considered = maxCases === undefined ? ids : ids.slice(0, maxCases);
  const cases: CloudOpsCase[] = [];
  const refusedReads: string[] = [];
  for (const id of considered) {
    const read = readCloudOpsCase(dataDir, id, { withLogs });
    if (read.ok) cases.push(read.value);
    else refusedReads.push(read.reason);
  }
  const selection = selectScorable(cases, topology);
  // Read off the cases the reader actually returned, in the same order, so the census and the selection cannot
  // disagree about which directories were entered.
  const logCensus = censusCaseLogs(cases.map((one) => one.logs));
  return { selection, directories: considered.length, refusedReads, logCensus };
}

/**
 * The engine options an ablation arm may move, and the two questions asked of the resolved object.
 *
 * Re-exported from `cloudopsbench-engine-options.ts` rather than declared here, so the four sibling scripts that
 * assemble their container from this module keep one import path — and so the projection itself is measured by a
 * test, which a `run-*.ts` entry point cannot be.
 */
export {
  pricesLabelPrior,
  resolveEngineOptions,
  type EngineOverrides,
} from './cloudopsbench-engine-options.js';

/** DI assembly over RESOLVED engine options, sharing every one of them with the RCAEval cells. */
export function createContainerFrom(
  engine: RCAEvalEngineOptions,
  useInjectTime: boolean,
): BenchmarkRunner {
  const container = new Container();
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
  container.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner(engine.signals, engine.topology));
  container.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());
  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  return new BenchmarkRunner(container, classifier, undefined, undefined, useInjectTime);
}

/** DI assembly, sharing every option with the RCAEval cells: the overrides laid over the shipped ones. */
export function createContainer(
  useInjectTime: boolean,
  overrides: EngineOverrides = {},
): BenchmarkRunner {
  return createContainerFrom(resolveEngineOptions(overrides), useInjectTime);
}

/** Render the refusal counts, one line each, in the order a case is charged. */
function formatRefusals(selection: ScorableSelection, directories: number): string {
  const lines = [`case directories            ${directories}`];
  lines.push(`scorable                    ${selection.kept.length}`);
  for (const reason of REFUSAL_ORDER) {
    const ids = selection.refused.get(reason) ?? [];
    lines.push(`refused ${reason.padEnd(32)} ${ids.length}`);
  }
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = parseCloudOpsArgs(process.argv.slice(2));
  const dataDir = resolve(args.dataDir);
  // BEFORE the selection, and this line's position is a defect that was measured rather than tidied: `loadSelection`
  // builds every case's call graph, `buildSystemCallGraph` falls back to a RING when the registry is not yet
  // initialised, and an earlier version of this runner initialised it afterwards — so a whole corpus was scored on a
  // ring graph. `callGraphOf` now throws on that mismatch, and this ordering is what satisfies it.
  await initRCAEvalTopology();
  const { selection, directories, refusedReads, logCensus } = loadSelection(
    dataDir,
    args.maxCases,
    args.topology,
    args.withLogs,
  );

  if (refusedReads.length > 0) {
    throw new Error(
      `${refusedReads.length} case directories could not be read; first: ${refusedReads[0]!}`,
    );
  }
  if (selection.suite.totalCases === 0) {
    throw new Error(`${dataDir}: no scorable case, so there is nothing to score`);
  }

  const overrides: EngineOverrides = {
    dualFamilyWeight: args.dualFamilyWeight,
    dualFamilyGate: args.dualFamilyGate,
    dualFamilyGateMode: args.dualFamilyGateMode,
    labelPriorWeight: args.labelPriorWeight,
    labelPriorMarginGate: args.labelPriorMarginGate,
    labelPriorJurisdiction: args.labelPriorJurisdiction,
    // The log channel's mode and price. The runner forwards both and does not act on them: the artefacts are
    // attached by `loadSelection` (which read `--logs`), and the engine reads the rest off its own options.
    logSignalMode: args.logSignalMode,
    logWeight: args.logWeight,
  };
  // Resolved ONCE: the same object configures the engine and answers whether a history has to be built for it.
  const engineOptions = resolveEngineOptions(overrides);
  const runner = createContainerFrom(engineOptions, args.useInjectTime);
  // ── The label prior, attached to the cases it is estimated FROM ────────────────────────────────────
  //
  // Built here rather than in the engine because it reads the corpus's LABELS: the engine may not see the answer to
  // the case it is scoring, and this construction removes that case from its own history before anything is scored
  // (see `label-prior-profiles.ts`). Attached only when the arm is priced, so a run at weight 0 scores the exact
  // objects the loader built and the anchor stays byte-identical.
  //
  // The predicate reads `engineOptions` and not `args`, which is the whole correction: `(args.labelPriorWeight ?? 0)`
  // stood here until iteration 370 and agreed with the engine only while the shipped weight was 0. At the enrolled
  // 0.1 a bare run reached the engine with weight 0.1 and attached NO history, so every `p(v)` was absent, the term
  // was skipped, and the report called the result "shipped default (0, the ablation)". A configuration claim has to
  // be derived from the configuration, not restated beside it.
  const priorArmed = pricesLabelPrior(engineOptions);
  const labelled: readonly LabelledCase[] = selection.suite.cases.map((one) => ({
    caseId: one.id,
    // The corpus cell's system, not the case's own `datasetName`: the pool a deployment's history covers is the
    // DEPLOYMENT, and a prior pooled per cell would make its denominator a function of the label it predicts.
    system: selection.cells.get(one.id)?.system ?? 'corpus',
    accepted: acceptedTruthServiceIds(one.groundTruth),
  }));
  const priors = priorArmed ? buildSystemLabelPrior(labelled) : undefined;
  const suite =
    priors === undefined
      ? selection.suite
      : { ...selection.suite, cases: withLabelPrior(selection.suite.cases, priors) };
  const result = await runner.runSuite(suite);

  const scores: readonly CellScore[] = scoreByCell(result.casePredictions, selection.cells);
  const overall = scores[scores.length - 1]!;

  process.stdout.write(`${formatRefusals(selection, directories)}\n`);
  process.stdout.write(
    `inject time                 ${args.useInjectTime ? 'forwarded (corpus alert window)' : 'NOT forwarded (ablation)'}\n`,
  );
  process.stdout.write(
    `call graph                  ${args.topology === 'registry' ? 'registry (the deployment)' : 'RING (ablation: not the deployment)'}\n`,
  );
  // The log bridge's own coverage, printed BEFORE the table: an arm whose entries all predate its injection window
  // produces the same score as an arm whose bridge read nothing, and only this line separates them.
  process.stdout.write(renderLogCensus(logCensus));
  if (args.withLogs) {
    // Printed from the RESOLVED options, for the reason the label prior's line is: a mode restated from the flag
    // would name `count` on a run whose engine received `logicHttp` the moment a default moved.
    process.stdout.write(
      `log signal                  weight ${engineOptions.signals.logWeight} / ${engineOptions.signals.logSignalMode}\n`,
    );
  }
  // Every number below is READ OFF the options the engine got, and the flag only chooses which of the two labels to
  // print. The previous version restated the literal too (`shipped default (0, the ablation)`, `shipped default
  // (0.25)`), which is a claim about the configuration that no longer consults it — it is how a report of the
  // ablation came to carry the enrolled configuration's name one line after the enrolment.
  const shown = (passed: boolean, value: number | string): string =>
    passed ? `${value} (arm)` : `shipped default (${value})`;
  process.stdout.write(
    `dual-family weight          ${shown(args.dualFamilyWeight !== undefined, engineOptions.signals.dualFamilyWeight)}\n`,
  );
  process.stdout.write(
    `dual-family gate            ${shown(args.dualFamilyGate !== undefined, engineOptions.signals.dualFamilyGate)} / ${engineOptions.signals.dualFamilyGateMode}\n`,
  );
  process.stdout.write(
    `label prior                 ${shown(args.labelPriorWeight !== undefined, engineOptions.signals.labelPriorWeight)} / gate ${engineOptions.signals.labelPriorMarginGate} / ${engineOptions.signals.labelPriorJurisdiction}${priorArmed ? '' : ' — no history built (the ablation)'}\n`,
  );
  // The prior's own census, printed beside its price: a term whose input is a history has to say how big that
  // history was and how many candidates it could speak about, or a reader cannot tell "the arm did nothing" from
  // "the arm had no history to read".
  if (priors !== undefined) {
    const sizes = [...priors.values()].map((one) => one.labelled);
    const covered = [...priors.values()].filter((one) => one.counts.size > 0).length;
    process.stdout.write(
      `label prior history         ${covered}/${sizes.length} cases carry a non-empty history, median ${sizes.slice().sort((a, b) => a - b)[Math.floor((sizes.length - 1) / 2)] ?? 0} labelled incidents\n`,
    );
  }
  process.stdout.write(`cases scored                ${result.totalCases}\n\n`);
  process.stdout.write(formatCellTable(scores));
  process.stdout.write(
    `\nCA@1 over all ${overall.cases} cases: ${formatRate(overall.top1, overall.cases)}\n`,
  );

  // ── The recorded reading, when this run is one of the arms it names ────────────────────────────────
  //
  // The three counts come from the same `casePredictions` the table above was rendered from, so the gate and the
  // number a reader sees cannot disagree. A movement leaves `process.exitCode = 1` rather than throwing: the run
  // finished and its numbers are worth reading, and a job that dies before writing its artifact is a job that hides
  // the very movement it was meant to report.
  if (args.armBaseline !== undefined && args.armName !== undefined) {
    const baseline = parseArmBaseline(readFileSync(resolve(args.armBaseline), 'utf8'));
    const measured = ranksToReading(
      args.armName,
      {
        weight: engineOptions.signals.labelPriorWeight,
        gate: engineOptions.signals.labelPriorMarginGate,
        jurisdiction: engineOptions.signals.labelPriorJurisdiction,
        // The log channel travels with the reading, because an arm is a configuration: `weight: 0` means the artefact
        // was read and the term priced at nothing, which the engine does NOT treat as "no log" — the presence of the
        // entries flips `sideChannelObserved` in `buildFaultGraph`. Naming one of those runs after the other would be
        // the same defect as the shipped-weight restatement, one field over.
        ...(args.withLogs
          ? {
              logs: {
                weight: engineOptions.signals.logWeight,
                mode: engineOptions.signals.logSignalMode,
              },
            }
          : {}),
      },
      result.casePredictions.map((one) => one.truthRank ?? null),
    );
    const comparison = compareArms(baseline, [measured]);
    process.stdout.write(
      `\narm                         ${measured.arm} against ${baseline.corpus}@${baseline.revision}\n`,
    );
    process.stdout.write(
      `arm reading                 CA@1 ${String(measured.at1)} / Top@3 ${String(measured.at3)} / Top@5 ${String(measured.at5)} of ${String(measured.cases)}\n`,
    );
    process.stdout.write(renderArmComparison(comparison));
    if (comparison.movements.length > 0) process.exitCode = 1;
  }

  if (args.output !== undefined) {
    writeFileSync(
      args.output,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dataDir,
          useInjectTime: args.useInjectTime,
          topology: args.topology,
          // The RESOLVED values, not the flags: `null` used to mean "shipped", and after iteration 369 a reader
          // cannot recover which configuration produced these numbers from a `null` — the shipped weight moved and
          // the shipped jurisdiction moved with it. A dump states what ran.
          dualFamilyWeight: engineOptions.signals.dualFamilyWeight,
          dualFamilyGate: engineOptions.signals.dualFamilyGate,
          dualFamilyGateMode: engineOptions.signals.dualFamilyGateMode,
          labelPriorWeight: engineOptions.signals.labelPriorWeight,
          labelPriorMarginGate: engineOptions.signals.labelPriorMarginGate,
          labelPriorJurisdiction: engineOptions.signals.labelPriorJurisdiction,
          labelPriorHistoryBuilt: priorArmed,
          withLogs: args.withLogs,
          logSignalMode: engineOptions.signals.logSignalMode,
          logWeight: engineOptions.signals.logWeight,
          logCensus,
          directories,
          scorable: selection.kept.length,
          refused: Object.fromEntries(
            REFUSAL_ORDER.map((reason) => [reason, (selection.refused.get(reason) ?? []).length]),
          ),
          cases: result.casePredictions.map((one) => ({
            caseId: one.caseId,
            truth: one.truth,
            top1: one.top1 ?? null,
            correct: one.correct,
            truthRank: one.truthRank ?? null,
          })),
          cells: Object.fromEntries(selection.cells),
          avgTop1: result.avgTop1,
          avgTop3: result.avgTop3,
          avgTop5: result.avgTop5,
        },
        null,
        2,
      )}\n`,
    );
    process.stdout.write(`wrote ${args.output}\n`);
  }
}

// Only when run as a script: the module's parser and loader are imported by the tests, and a top-level `main()`
// would make `import` an execution.
if (process.argv[1] !== undefined && process.argv[1].endsWith('run-cloudopsbench.ts')) {
  await main();
}
