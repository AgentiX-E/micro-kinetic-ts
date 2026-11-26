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
 * @module benchmarks/run-cloudopsbench
 */

import { writeFileSync } from 'node:fs';
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
import { listCaseIds, readCloudOpsCase, type CloudOpsCase } from './cloudopsbench-case.js';
import { parseCloudOpsArgs } from './cloudopsbench-cli.js';
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
import { parseRCAEvalArgs, type CliOptions } from './rcaeval-cli.js';
import { buildRCAEvalEngineOptions } from './rcaeval-engine-options.js';
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
 * @returns The selection, how many directories were entered, and every directory a reader refused.
 */
export function loadSelection(
  dataDir: string,
  maxCases: number | undefined,
  topology: CaseTopology = 'registry',
): {
  readonly selection: ScorableSelection;
  readonly directories: number;
  readonly refusedReads: readonly string[];
} {
  const ids = listCaseIds(dataDir);
  const considered = maxCases === undefined ? ids : ids.slice(0, maxCases);
  const cases: CloudOpsCase[] = [];
  const refusedReads: string[] = [];
  for (const id of considered) {
    const read = readCloudOpsCase(dataDir, id);
    if (read.ok) cases.push(read.value);
    else refusedReads.push(read.reason);
  }
  return {
    selection: selectScorable(cases, topology),
    directories: considered.length,
    refusedReads,
  };
}

/**
 * The engine options an ablation arm may move, as a subset of the RCAEval parser's own object.
 *
 * A named object rather than positional parameters: three arms arrived in three iterations (`--topology`,
 * `--dual-family-weight`, `--dual-family-gate`), and a fourth positional argument is the shape where a caller passes
 * `undefined` in the wrong slot and gets the shipped engine while believing it moved something. Every field is
 * optional and an absent field leaves the parser's value untouched, so the shipped arm stays byte-identical to the
 * anchor fingerprint's by construction.
 */
export type EngineOverrides = Partial<
  Pick<
    CliOptions,
    | 'dualFamilyWeight'
    | 'dualFamilyGate'
    | 'dualFamilyGateMode'
    | 'labelPriorWeight'
    | 'labelPriorMarginGate'
  >
>;

/** DI assembly, sharing every option with the RCAEval cells. */
export function createContainer(
  useInjectTime: boolean,
  overrides: EngineOverrides = {},
): BenchmarkRunner {
  const parsed = parseRCAEvalArgs([]);
  // Drop the absent keys rather than spreading an object whose fields may be `undefined`: `{...parsed, x: undefined}`
  // would overwrite a shipped value with `undefined`, which the engine reads as an invalid number and defaults — a
  // different object from the one the anchor fingerprint hashes.
  const named = Object.entries(overrides).filter(([, value]) => value !== undefined);
  const engine = buildRCAEvalEngineOptions(
    named.length === 0 ? parsed : { ...parsed, ...Object.fromEntries(named) },
  );
  const container = new Container();
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
  container.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner(engine.signals, engine.topology));
  container.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());
  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  return new BenchmarkRunner(container, classifier, undefined, undefined, useInjectTime);
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
  const { selection, directories, refusedReads } = loadSelection(
    dataDir,
    args.maxCases,
    args.topology,
  );

  if (refusedReads.length > 0) {
    throw new Error(
      `${refusedReads.length} case directories could not be read; first: ${refusedReads[0]!}`,
    );
  }
  if (selection.suite.totalCases === 0) {
    throw new Error(`${dataDir}: no scorable case, so there is nothing to score`);
  }

  const runner = createContainer(args.useInjectTime, {
    dualFamilyWeight: args.dualFamilyWeight,
    dualFamilyGate: args.dualFamilyGate,
    dualFamilyGateMode: args.dualFamilyGateMode,
    labelPriorWeight: args.labelPriorWeight,
    labelPriorMarginGate: args.labelPriorMarginGate,
  });
  // ── The label prior, attached to the cases it is estimated FROM ────────────────────────────────────
  //
  // Built here rather than in the engine because it reads the corpus's LABELS: the engine may not see the answer to
  // the case it is scoring, and this construction removes that case from its own history before anything is scored
  // (see `label-prior-profiles.ts`). Attached only when the arm is armed, so a run at the shipped weight scores the
  // exact objects the loader built and the anchor stays byte-identical.
  const priorArmed = (args.labelPriorWeight ?? 0) !== 0;
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
  process.stdout.write(
    `dual-family weight          ${args.dualFamilyWeight === undefined ? 'shipped default (0.25)' : `${args.dualFamilyWeight} (ablation)`}\n`,
  );
  process.stdout.write(
    `dual-family gate            ${args.dualFamilyGate === undefined ? 'shipped default (0.25)' : `${args.dualFamilyGate} (ablation)`} / ${args.dualFamilyGateMode ?? 'channel'}\n`,
  );
  process.stdout.write(
    `label prior                 ${args.labelPriorWeight === undefined ? 'shipped default (0, the ablation)' : `${args.labelPriorWeight} (arm)`} / gate ${args.labelPriorMarginGate ?? 0.02}\n`,
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

  if (args.output !== undefined) {
    writeFileSync(
      args.output,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dataDir,
          useInjectTime: args.useInjectTime,
          topology: args.topology,
          dualFamilyWeight: args.dualFamilyWeight ?? null,
          dualFamilyGate: args.dualFamilyGate ?? null,
          dualFamilyGateMode: args.dualFamilyGateMode ?? null,
          labelPriorWeight: args.labelPriorWeight ?? null,
          labelPriorMarginGate: args.labelPriorMarginGate ?? null,
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
