/**
 * FSE'26 RCABench runner — fault-propagation-aware microservice RCA.
 *
 * RCABench (arXiv:2510.04711) is the hardest public RCA target: 1,430 validated
 * failure cases on Train Ticket (50+ services), 25 fault types across 6
 * categories, with dynamic workloads and hierarchical ground-truth labels. The
 * 11 SOTA models re-evaluated on it average only 0.21 Top@1 (best 0.37).
 *
 * The Parquet bridge (`scripts/fse26_convert.py`) normalises each datapack into
 * a single `case.json`; this runner consumes that JSON via {@link FSE26Loader}
 * and scores the production {@link TreePruner} engine against the benchmark's
 * dual-label ground truth (network faults accept BOTH the injection point's
 * source and target service).
 *
 * Unlike the RCAEval runner, the engine is invoked directly (not through the
 * {@link BenchmarkRunner}) so the dual-label accepted set is scored exactly —
 * the shared runner scores against `groundTruth.serviceId` (the FIRST label),
 * which would under-count a correct target-service prediction on a network
 * fault.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-fse26.ts [--data-dir <json-root>] \
 *     [--max-cases N] [--log-weight <w>] [--no-rank-normalization] [--output <path>] \
 *     [--diagnose <fault-types>] [--diagnose-limit N] [--diagnose-decimals N] \
 *     [--containment-out <path>] [--containment-depth N] [--drop-metrics <names>]
 *
 * `--drop-metrics` is the component-ablation switch: it filters the named
 * metric series out of every case before scoring, so a ranking change can be
 * attributed to one of the bridge's metric sources without a cache rebuild.
 * `--diagnose-decimals` sets the precision the diagnostic dump DECLARES and
 * renders at; it is what a reader's error bar is drawn from.
 * Read-only: never writes to the data directory.
 *
 * @module benchmarks/run-fse26
 */

import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import type {
  FaultPropagationGraph,
  RootCauseResult,
  ServiceId,
} from '../../packages/core/src/index.js';

import { TopologyUnion } from '../../packages/ai/src/agent/index.js';
import type { BenchmarkCase, FSE26RawCase } from '../../packages/kinetic/src/benchmarks/index.js';
import {
  buildFSE26Diagnostic,
  computeAvgAtKMultiLabel,
  dropFSE26MetricNames,
  FSE26Loader,
  toFaultGraphOptions,
} from '../../packages/kinetic/src/benchmarks/index.js';
import {
  computeSelfTimeDetail,
  DEFAULT_FAULT_FREE_SIGMA,
  DEFAULT_MIN_CALLEE_EXCURSION,
  EMPTY_SELF_TIME_CENSUS,
  mergeSelfTimeCensus,
  type SelfTimeCensus,
} from '../../packages/tree/src/index.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';

import { FingerprintDump } from './agentic-fingerprint-file.js';
import { buildCandidateFingerprints } from './agentic-fingerprint.js';
import { discoverCaseDirs } from './case-discovery.js';
import { buildContainmentRow } from './containment-row-build.js';
import { ContainmentRowDump } from './containment-rows.js';
import { readFaultFreeProfileFile } from './fault-free-profile-file.js';
import { fingerprintSourceOrder } from './fingerprint-width.js';
import { buildFse26EngineOptions } from './fse26-engine-options.js';
import { buildCorpusLabelHistory, priorForCase } from './fse26-label-history.js';
import { buildFse26RunConfig } from './fse26-run-config.js';
import { DepthDump, formatDepthLadder, readDepthDump } from './ranking-depth.js';
import { formatSelfTimeCensus } from './self-time-census-report.js';
import { TermDump } from './terms-dump.js';
import { TopologyBriefDump } from './topology-brief-file.js';

import {
  boundaryPlaceable,
  formatBoundaryCensus,
  summariseBoundaryCensus,
  type BoundaryObservation,
} from './fse26-boundary-census.js';
import { parseFSE26Args, PUBLISHED_TOP_K } from './fse26-cli.js';
import {
  marginColumns,
  PER_CASE_RANK_LIMIT,
  poolColumns,
  writePerCaseVerdicts,
  type PerCaseVerdict,
} from './fse26-per-case.js';
import {
  buildFSE26Report,
  formatFailedEdgeCoverageLine,
  formatFSE26ConfigLine,
  summariseFailedEdgeCoverage,
  type FSE26RunConfig,
} from './fse26-report.js';

/** The published FSE'26 anchor: 11 SOTA models average 0.21 Top@1 (best 0.37). */
const ANCHOR_AVG = 0.21;
const ANCHOR_BEST = 0.37;

/** Per-fault-type accuracy accumulator. */
interface FaultCell {
  total: number;
  correct: number;
}

/**
 * Render the `--diagnose` block for one case.
 *
 * A thin adapter over the shared builder, which lives in the engine's own package: the dump's
 * writer is ONE function, and this runner passes what only it knows — the raw datapack's labels and
 * the dual-label accepted set it scored against — while every per-service magnitude comes from the
 * graph the engine built.
 *
 * `fieldDecimals` is threaded rather than defaulted, for the reason the shared input now REQUIRES
 * it: the dump declares its own precision and a reader derives its error bar from that declaration,
 * so an omission here is not a cosmetic default but a different artifact under the same name.
 */
function buildDiagnostic(
  raw: FSE26RawCase,
  benchCase: BenchmarkCase,
  faultGraph: FaultPropagationGraph,
  ranking: RootCauseResult[],
  logSignalMode: string,
  fieldDecimals: number,
): string {
  return buildFSE26Diagnostic({
    case: benchCase,
    graph: faultGraph,
    ranking,
    callGraph: benchCase.callGraph,
    datapack: raw.datapack,
    faultType: raw.faultType,
    groundTruthServices: raw.groundTruthServices,
    logSignalMode,
    injectTimeMs: benchCase.injectTime > 0 ? benchCase.injectTime : 0,
    fieldDecimals,
  });
}

async function main(): Promise<void> {
  const opts = parseFSE26Args(process.argv.slice(2));
  const loader = new FSE26Loader();
  const dropSet = new Set(opts.dropMetrics);

  // The run configuration, built once. Both renderings of it — the header line
  // and the `config` object in the JSON artifact — come from this object, so
  // they cannot disagree about the mode; that is how the JSON lost `logMode`
  // while the line kept it, leaving two artifacts 24.2pp apart with byte-equal
  // `config` blocks. It is built in `fse26-run-config.ts` rather than here so
  // that the test suite can call it: this file calls `main()` on import, which
  // is why the ENGINE mapping was extracted, and the reported record had the
  // same hole — `topoClosure` reached the engine and not the record, so run
  // `41053711414` aggregated by `sum` and printed `topoClosure=max`.

  // Production ranking config: the log signal is shipped enabled (benchmark
  // #220 net-positive, zero regression); every other causal prior is opt-in.
  // Rank normalization is load-bearing on Train Ticket's large topologies.
  // The fault-free profile is READ here rather than derived: it is a corpus artifact, and every arm of one
  // experiment must be scored against the same band or the arms differ by two estimates rather than by one
  // weight. A weight without a profile is refused by name, because a non-zero weight over an absent map
  // scores nothing and would publish the control's numbers under the arm's configuration.
  if (opts.faultFreeWeight !== 0 && opts.faultFreeProfilePath === undefined) {
    throw new Error('--fault-free-weight requires --fault-free-profile');
  }
  // Same rule, one layer over: an elimination fingerprint IS the fault-free band per channel, so a dump asked
  // for without a profile would be a file of empty candidate lists — and an offline arm reading it would report
  // "no verifiable claim" for every case, which is a statement about the run rather than about the corpus.
  if (opts.fingerprintOut !== '' && opts.faultFreeProfilePath === undefined) {
    throw new Error('--fingerprint-out requires --fault-free-profile');
  }
  const profileRead =
    opts.faultFreeProfilePath === undefined
      ? undefined
      : readFaultFreeProfileFile(opts.faultFreeProfilePath);
  const faultFreeProfile = profileRead?.profile;
  // Built AFTER the profile is read, because the record now names which profile it was scored against. The
  // digest is the only part of that input the artifact carries, and it is the only part a reproduction needs:
  // the containment order reads the profile too, so with the shipped weight of 0 a run that omitted it was
  // byte-identical on the config line to the shipped run and read 1 141 against 1 156 Top@1.
  const runConfig: FSE26RunConfig = buildFse26RunConfig(opts, {
    digest: profileRead?.digest ?? null,
  });
  const engineOptions = buildFse26EngineOptions(opts, faultFreeProfile);
  const pruner = new TreePruner(engineOptions.signals, engineOptions.topology);

  console.log("Micro-Kinetic — FSE'26 RCABench");
  console.log('═'.repeat(65));
  console.log(`Data:   ${opts.dataDir}`);
  console.log(formatFSE26ConfigLine(runConfig));
  // The one state that used to be silent: the pass is asked for, has nothing to read, and returns the ranking
  // unchanged. Named on its own line as well as on the config line, because this is a WARNING about the run
  // rather than a field of it — a reader who has not memorised the field list would take the run for shipped.
  if (runConfig.containmentExcursions === 'absent' && runConfig.containmentOrder !== false) {
    console.log(
      'Warning: containmentOrder is on and no --fault-free-profile was supplied, so the pass has no ' +
        'excursions and cannot reorder anything. Measured cost of this state on the FSE 26 corpus: ' +
        '1 141 against 1 156 Top@1 (15 cases, 1.06 pp).',
    );
  }
  if (opts.dropMetrics.length > 0) {
    console.log(`Ablation: dropping metric names [${opts.dropMetrics.join(', ')}]`);
  }
  console.log(`Anchor: SOTA avg=${ANCHOR_AVG} best=${ANCHOR_BEST} Top@1`);
  console.log('═'.repeat(65));

  const dirs = discoverCaseDirs(opts.dataDir);
  const selected = opts.maxCases > 0 ? dirs.slice(0, opts.maxCases) : dirs;
  console.log(`Cases discovered: ${dirs.length}; evaluated: ${selected.length}`);
  // ── The label history, derived ONCE over the WHOLE corpus ────────────────────────────────────────────
  //
  // The population is `dirs` and not `selected`, because `p` is a frequency over the DEPLOYMENT's diagnosed
  // incidents: a case this run does not score is still an incident that deployment diagnosed, so excluding it
  // would make the prior a function of `--max-cases`. The case being scored is removed per case instead
  // (`priorForCase`), which is the leave-one-out rule, and that is a property of one case rather than of the
  // population.
  //
  // Built only when the weight asks for it: at the shipped `0` the term is not priced, so a run that read the
  // corpus twice would pay for a history no ranking could use. The reader is a prefix scan (see
  // `fse26-label-history.ts`), so even an armed run costs seconds rather than a second corpus pass.
  const labelHistory = opts.labelPriorWeight === 0 ? undefined : buildCorpusLabelHistory(dirs);
  if (labelHistory !== undefined) {
    console.log(
      `Label prior: armed at ${opts.labelPriorWeight} / gate ${opts.labelPriorMarginGate}; history ` +
        `${labelHistory.history.labelled} labelled incidents over ` +
        `${labelHistory.history.counts.size} services`,
    );
    if (labelHistory.unreadable > 0) {
      // Named rather than folded into the total: a history fitted on 1 421 of 1 422 cases has a different
      // denominator from one fitted on all of them, and the difference is invisible in every downstream number.
      console.log(
        `Warning: ${labelHistory.unreadable} of ${dirs.length} cases could not be read for the history, so the ` +
          'prior was fitted on the remainder.',
      );
    }
  }
  console.log('═'.repeat(65));

  // ── Per-case accumulation (small; the loaded cases are released per case) ──
  const predictionsPerCase: string[][] = [];
  // The same answers, beside the labels, for a judgement that is chosen AFTER the run: an average over the
  // corpus cannot be re-scored, and RCABench's ground truth is a set (both endpoints of an edge-shaped fault).
  const verdicts: PerCaseVerdict[] = [];
  const acceptedPerCase: string[][] = [];
  const faultTypeOfCase: string[] = [];
  // One compact projection per case for the failed-edge coverage counter: the
  // metric KEYS only, because a case's series are large and are released after
  // scoring. See summariseFailedEdgeCoverage for why the input is counted at all.
  const failedEdgeCases: Array<{
    failedTraceEdges?: BenchmarkCase['failedTraceEdges'];
    metricKeys: ReadonlySet<string>;
  }> = [];
  // …and one projection of the same shape for the level test's PRECONDITION. A `transientGuardTest`
  // arm measures zero on a corpus whose injection boundary cannot be placed, and that zero is
  // indistinguishable from the two statistics agreeing — so the population is counted next to the
  // number, on the rule `summariseFailedEdgeCoverage` records above. See fse26-boundary-census.
  const boundaryObservations: BoundaryObservation[] = [];
  const faultCells = new Map<string, FaultCell>();
  // The self-time term's reach over the corpus, accumulated only on an arm that turns the term on. Read from the
  // parsed weight rather than from the engine options because this is a property of the DISPATCH: an arm whose
  // weight is 0 has no census to report, and one whose weight is non-zero must say whether the term could see.
  const selfTimeWeight = opts.selfTimeWeight;
  let selfTimeCensus: SelfTimeCensus = EMPTY_SELF_TIME_CENSUS;
  let loadErrors = 0;
  let engineErrors = 0;
  let emptyGraphs = 0;
  const diagnosed = new Map<string, number>();

  // The term dump is truncated ONCE, before the first case, so a rerun replaces the
  // previous artifact rather than appending a second population onto it — an artifact
  // that silently concatenates two runs is a population nobody declared.
  // Constructing the dump truncates it, so a second dispatch into the same path cannot read as one
  // run with twice the cases.
  const termDump = opts.termsOut === '' ? undefined : new TermDump(opts.termsOut);
  // The fingerprint dump, on the same truncate-once rule: an arm reads a POPULATION, and a file that appended a
  // second run onto the first would describe a corpus nobody dispatched.
  const fingerprintDump =
    opts.fingerprintOut === '' ? undefined : new FingerprintDump(opts.fingerprintOut);
  // The PRESENTATION dump, on the same truncate-once rule and with a different contract: its width is what the
  // flag asks for, and its array order is the engine's answer AT THAT WIDTH. A consumer that needs the published
  // answer reads `--fingerprint-out`; a consumer that needs a wider window reads this one.
  const presentationDump =
    opts.presentationOut === '' ? undefined : new FingerprintDump(opts.presentationOut);
  // The depth dump, on the same truncate-once rule and for the same reason: it describes a POPULATION.
  // It is also the only artifact that can tell a case ranked too low from a case the order never held, which is
  // the split that decides whether the remaining headroom is a ranking question or a graph question.
  const depthDump = opts.depthOut === '' ? undefined : new DepthDump(opts.depthOut);
  // The topology brief, and it is the only dump here that is not a rendering of THIS run's answer: it is the
  // union of the call graphs every case carried. It is written rather than passed as a string because a corpus
  // pass is the only thing that holds the graphs — a dispatch that could type a topology could attach one nobody
  // measured — and it is written ONCE per run because a brief that differed by case would be a per-case input.
  const topologyUnion = opts.topologyBriefOut === '' ? undefined : new TopologyUnion();
  const topologyDump =
    opts.topologyBriefOut === '' ? undefined : new TopologyBriefDump(opts.topologyBriefOut);
  // The containment rows, on the same truncate-once rule and for the same reason: they describe a POPULATION.
  const containmentDump =
    opts.containmentOut === '' ? undefined : new ContainmentRowDump(opts.containmentOut);
  // There is no second engine here any more. A "quiet" pruner with both relational passes switched off used to
  // recover the sweep's input, and it was a SECOND computation of a list the one `analyze` call already holds: two
  // computations of one thing differ exactly where the difference is hardest to see, and on this corpus the
  // difference reached the published head on five cases (`docs/gate-replay.md` §9.6). `analyzeWithFusion` reports
  // the list its passes were given, so the row is an observation of the call rather than a reconstruction beside
  // it — and one construction site fewer for the census to attribute.

  for (const dir of selected) {
    let raw: FSE26RawCase;
    try {
      raw = loader.loadCase(dir);
    } catch (err) {
      loadErrors++;
      // Surface the first few failures verbatim — a silent count hides the
      // root cause (e.g. non-finite values producing unparseable JSON).
      if (loadErrors <= 3) {
        console.error(`[loadError] ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    if (dropSet.size > 0) raw = dropFSE26MetricNames(raw, dropSet);
    const benchCase = loader.toBenchmarkCase(raw);
    // The union takes the CASE's edges and nothing else, so there is no argument by which a label, a fault type or
    // the engine's answer could reach the brief. An edge observed in ten cases is one edge.
    topologyUnion?.addCase(benchCase.callGraph.edges);
    // Count what the ranking can actually use, from the SAME node set the signal
    // filters on (`callGraph.nodes` is exactly the metric-keyed service set), so
    // the counter cannot disagree with the signal about what was usable.
    failedEdgeCases.push({
      failedTraceEdges: benchCase.failedTraceEdges,
      metricKeys: new Set(benchCase.callGraph.nodes.keys()),
    });
    boundaryObservations.push({
      injectTime: benchCase.injectTime,
      placeable: boundaryPlaceable(benchCase.metrics, benchCase.injectTime),
    });
    // Dual-label accepted set: the raw case's full ground-truth list (two
    // labels for network faults, one otherwise).
    const accepted =
      raw.groundTruthServices.length > 0
        ? [...raw.groundTruthServices]
        : [benchCase.groundTruth.serviceId];
    const faultType = benchCase.groundTruth.faultType ?? 'unknown';
    // The case the engine scores, which carries the prior when the run is armed. It must be attached HERE and
    // not after the ranking: `toFaultGraphOptions` is the one owner of the case -> graph mapping and forwards
    // `labelPrior`, so a prior attached to a copy the graph never saw is a term that is silently absent —
    // `MAP_ABSENT` on every candidate, which reads as "this deployment has no history" rather than as a defect.
    const scoredCase =
      labelHistory === undefined
        ? benchCase
        : { ...benchCase, labelPrior: priorForCase(labelHistory, accepted) };

    let ranking: RootCauseResult[] = [];
    // The list the engine's relational passes were given, at the pool's width. Reports the call's own input, and
    // stays EMPTY when the case produced no graph — a case the engine could not score has no order to describe.
    let fusionOrder: readonly ServiceId[] = [];
    // `PUBLISHED_TOP_K` is a reporting width and the artifacts at the pool's width still need the whole order: the
    // one question a depth row has to answer about the operator is whether the truth was ranked low or was never in
    // the pool at all, and a five-wide order answers `absent` for both. Declared here rather than inside the
    // graph branch because the dump blocks below reuse it to decide whether their narrower order is a second call.
    const orderWidth = Math.max(PUBLISHED_TOP_K, benchCase.callGraph.nodes.size);
    let faultGraph: FaultPropagationGraph | undefined;
    try {
      if (benchCase.callGraph.edges.length === 0) {
        // The engine requires ≥ 1 edge; a single-service case is degenerate.
        emptyGraphs++;
      } else {
        // ONE owner for the case -> options mapping. This call site used to
        // spell the options out inline and had silently dropped `traceActivity`
        // and `failedTraceEdges`, so both signals were dead on the benchmark
        // with the largest case count — reporting "no change", which reads as a
        // result. See packages/kinetic/src/benchmarks/runners/fault-graph-options.ts.
        faultGraph = pruner.buildFaultGraph(
          benchCase.callGraph,
          benchCase.metrics,
          toFaultGraphOptions(scoredCase, scoredCase.injectTime),
        );
        // ── The order at the POOL's width, not the reporting width ────────────────────────────────
        //
        // The cost is one sort of at most a hundred entries: the graph is built once either way and `analyze`
        // reuses it.
        // One call, and it reports the list its two relational passes were given. That list is the containment
        // dump's sweep input; taking it from here rather than recomputing it is what makes the row an observation
        // of this call. The published prefix every other artifact reads is still `ranking.slice(0, 5)` below.
        const analysis = pruner.analyzeWithFusion(faultGraph, orderWidth);
        ranking = analysis.results;
        fusionOrder = analysis.passInput;
        // The term's own census, taken from the SAME inputs the scorer reads and only when the weight asks for it.
        // A term that ships at 0 has never been exercised on this corpus, and "the arm moved nothing" has two
        // very different causes a ranking cannot separate: the normalisation is silent, or the map was never
        // built. This counter is the difference between those two sentences.
        if (selfTimeWeight !== 0) {
          selfTimeCensus = mergeSelfTimeCensus(
            selfTimeCensus,
            computeSelfTimeDetail(benchCase.callGraph.edges, benchCase.metrics).census,
          );
        }
      }
    } catch {
      engineErrors++;
    }

    // The PUBLISHED order: the prefix every artifact that says "what this run answered" must be built from, so the
    // widened order this case now carries cannot leak into a dump whose contract is the five-wide one. One local,
    // because two slices of the same list are two places that can disagree about the width.
    const publishedRanking = ranking.slice(0, PUBLISHED_TOP_K);

    // ── Optional per-case signal diagnostic (--diagnose) ──
    // Dump the source vs symptom signal inventory for a weak fault type so its
    // gap can be traced to a data gap or a signal gap.
    if (opts.diagnose.includes(faultType)) {
      const dumped = diagnosed.get(faultType) ?? 0;
      const unlimited = opts.diagnoseLimit === 0;
      if (unlimited || dumped < opts.diagnoseLimit) {
        diagnosed.set(faultType, dumped + 1);
        if (faultGraph) {
          console.log(
            buildDiagnostic(
              raw,
              benchCase,
              faultGraph,
              ranking,
              opts.logMode,
              opts.diagnoseDecimals,
            ),
          );
        }
      }
    }

    // ── Optional per-candidate TERM dump (--terms-dump) ──
    // The scoring run above asks for the top 5, which is what every published number is read
    // from. A weight screen cannot use that list: re-weighting can promote a candidate that the
    // shipped ranking never showed, and a screen restricted to the shipped top 5 would report a
    // promotion it could not make. So the dump re-ranks the SAME graph over the whole node set —
    // the same engine, the same terms, a different `topK` — and the first five of that order are
    // the five above, because the ranking is a total order sliced at the end.
    // Both writers below read the SAME full order, so it is computed once: two `analyze` calls over the whole
    // node set would be two orderings of one graph, and every argument in this repository about a dump being a
    // property of the run rather than of a second pass would stop being true.
    //
    // The DEPTH row is written even when the case produced no graph. A case the engine could not score has no
    // accepted service in its (empty) order, and dropping it would shrink the ladder's denominator to the cases
    // that happened to work — a table whose rungs are shares of a population the run never declared, and one
    // that reads BETTER the more cases the loader failed on.
    if (termDump !== undefined || depthDump !== undefined) {
      // The order at the POOL's width, which the scoring call above has ALREADY computed whenever the pool is at
      // least as wide as the reporting width — the usual case, and the only one where the two widths coincide.
      // Re-ranking here would be a second computation of one thing (the failure mode `docs/gate-replay.md` §9.6
      // records), and it costs a full pass per case on every corpus. Below five candidates the two widths differ
      // and the narrower order is genuinely a different call.
      const poolWidth = Math.max(1, benchCase.callGraph.nodes.size);
      const full =
        faultGraph === undefined
          ? []
          : orderWidth === poolWidth
            ? ranking
            : pruner.analyze(faultGraph, poolWidth);
      if (faultGraph !== undefined) {
        termDump?.record({ datapack: basename(dir), faultType, accepted, ranking: full });
      }
      depthDump?.record({ datapack: basename(dir), faultType, accepted, ranking: full });
    }

    // ── Optional per-case CONTAINMENT SWEEP rows (--containment-out) ──
    // The observation H2 needs and no other artifact carries: one row per adjacent pair the sweep examined with a
    // call edge between them, from BOTH arms, plus a replay check against the published ranking. The dump exists
    // because ρ is a property of an edge over many cases while the label ("did this inversion help") is a property
    // of a case, and deciding the population at write time would decide the measurement.
    if (containmentDump !== undefined) {
      // `0` is every candidate — the setting a reader reaches for when ρ's per-edge population is too thin. The
      // shipped depth is the default, because every containment number in `docs/containment-order.md` was measured
      // on the five the engine publishes and a dump at another depth would describe a different population.
      //
      // It is a RECORDING width and no longer a sweep width: the sweep decides over the whole order the engine
      // handed its passes and the window limits what the file says about it, so `gatedTop1` and the replay are the
      // engine's own. The width is written to every row, because the population a ρ is fitted over is a
      // configuration and a reader may not have to infer it from a row count.
      //
      // `0` is written as the word `pool`, not as the node count it resolves to. Every candidate is a RULE whose
      // resolved width follows the graph, and a dump that wrote 49 here and 12 there would state as many widths as
      // it has graphs — a census that cannot tell one rule from a corpus of configurations, and refuses both
      // (`docs/gate-replay.md` §11). The number is not lost: it is the length of the order the same row carries.
      const depth = opts.containmentDepth === 0 ? ('pool' as const) : opts.containmentDepth;
      containmentDump.record(
        buildContainmentRow({
          datapack: basename(dir),
          faultType,
          sigma: DEFAULT_FAULT_FREE_SIGMA,
          margin: engineOptions.signals.containmentMargin,
          // The engine's shipped noise floor, recorded so a reader replays the configuration that produced the
          // verdict. It is the fix, not a search axis -- the margin beside it is the ablation dimension.
          minCalleeExcursion: DEFAULT_MIN_CALLEE_EXCURSION,
          // The run's own excursion-licence switch, read from the SAME options the pruner ran under so the dump
          // records what happened rather than today's default. An ablation dispatch that turns it off writes false.
          licenseByExcursion: engineOptions.signals.licenseByExcursion,
          depth,
          edges: faultGraph?.callGraph.edges ?? [],
          excursions: faultGraph?.containmentExcursions,
          surprises: faultGraph?.containmentSurprises,
          failedInterfaces: faultGraph?.failedInterfaces,
          failureFlows: faultGraph?.failureFlows,
          failingEdges: faultGraph?.failingEdges,
          attribution: engineOptions.signals.failureAttribution,
          // The scope the ENGINE applied, taken from the same object the pruner was built from rather than from
          // the CLI options: one option has one owner, and a dump that read the flag twice could state a
          // configuration the engine never ran under (`docs/gate-replay.md` §8).
          scope: engineOptions.signals.failureContainmentScope,
          fusionOrder,
          publishedOrder: ranking.map((result) => result.serviceId),
        }),
      );
    }

    // ── Optional per-case elimination FINGERPRINT (--fingerprint-out) ──
    // Built from the ranking that was just published, not from a re-rank: the layer's claim is about the answer
    // the run reports, and a fingerprint taken from a wider `topK` would let an offline arm claim a movement this
    // run never made.
    if (
      (fingerprintDump !== undefined || presentationDump !== undefined) &&
      faultFreeProfile !== undefined
    ) {
      const injectTimeMs = benchCase.injectTime > 0 ? benchCase.injectTime : 0;
      // TWO dumps, TWO contracts. `fingerprintDump` is the published ranking AS a fingerprint, and every offline
      // arm joins it against the per-case verdict file assuming the orders agree case for case. The presentation
      // dump is the engine at a requested width, and it does not satisfy that assumption -- a structural pass
      // permutes the list it is handed, so a twenty-wide order differs from the published five at positions 4-5
      // on 17 cases. Putting both contracts in one file is what made the study job fail in the one guard that was
      // right to refuse, so the decision of WHICH order a dump carries is made per dump rather than per run.
      if (fingerprintDump !== undefined) {
        const built = buildCandidateFingerprints({
          metrics: benchCase.metrics,
          ranking: publishedRanking,
          injectTimeMs,
          profile: faultFreeProfile,
        });
        fingerprintDump.record({
          datapack: basename(dir),
          faultType,
          injectTimeMs,
          candidates: built.candidates,
          census: built.census,
        });
      }
      // The second pass is spent ONLY when a presentation dump was asked for: a widened order costs one extra
      // `analyze` per case, and a run that writes no presentation artifact must not pay for it.
      if (presentationDump !== undefined) {
        const source = fingerprintSourceOrder({
          published: publishedRanking,
          width: opts.fingerprintTopK,
          nodeCount: benchCase.callGraph.nodes.size,
          widen: (k) => (faultGraph === undefined ? [] : pruner.analyze(faultGraph, k)),
        });
        const presented = buildCandidateFingerprints({
          metrics: benchCase.metrics,
          ranking: source,
          injectTimeMs,
          profile: faultFreeProfile,
        });
        presentationDump.record({
          datapack: basename(dir),
          faultType,
          injectTimeMs,
          candidates: presented.candidates,
          census: presented.census,
          // The order this run published, recorded BESIDE the wider one. It is the only field that lets a reader
          // tell a presentation of this run from a dump left over from another: the candidate array is exactly
          // what the widening changes, so comparing it is comparing the wrong thing, and `joinHeadroom` compares
          // this instead. Written as service ids because that is what the per-case verdict file carries — and
          // sliced at the PUBLISHED width, because `ranking` is now the pool's width and a dump that silently
          // widened would break the join it exists to make.
          published: publishedRanking.map((row) => row.serviceId),
        });
      }
    }

    predictionsPerCase.push(ranking.map((r) => r.serviceId));
    // The three pool columns, derived by the file's own owner so the runner cannot answer them with a second rule.
    // The anomaly lookup is the graph's PRE-deduction map — `anomalyScores` is what the builder wrote, before
    // `analyze` charges anything — and `undefined` for a service the graph does not hold, which the file writes
    // as `null`. That is what makes `truthRank: 0` readable: `truthAnomalyBefore > 0` is a candidate the
    // deduction removed, `0` is one that never moved.
    const columns = poolColumns(ranking, accepted, (serviceId) =>
      faultGraph === undefined || !faultGraph.callGraph.nodes.has(serviceId)
        ? undefined
        : (faultGraph.anomalyScores.get(serviceId) ?? 0),
    );
    verdicts.push({
      datapack: basename(dir),
      faultType,
      accepted,
      ranked: ranking.slice(0, PER_CASE_RANK_LIMIT).map((r) => r.serviceId),
      ...columns,
      // …and the engine's own sort values for the first two candidates this row publishes, because a rule that
      // refuses to rename a case the engine was decided about can only read a margin about THIS pair. Derived by
      // the file's owner (`marginColumns`) so the runner cannot answer it with a second rule.
      ...marginColumns(ranking),
    });
    acceptedPerCase.push(accepted);
    faultTypeOfCase.push(faultType);

    const cell = faultCells.get(faultType) ?? { total: 0, correct: 0 };
    cell.total++;
    if (ranking.length > 0 && accepted.includes(ranking[0]!.serviceId)) cell.correct++;
    faultCells.set(faultType, cell);
  }

  // ── The topology brief, rendered once over the whole population ──
  if (topologyUnion !== undefined && topologyDump !== undefined) {
    const brief = topologyUnion.render(predictionsPerCase.length);
    if (brief.text === '') {
      // Nothing was written, and it is said rather than left to the reader: a file with no record is
      // indistinguishable from a file the run forgot to write, and the arm that reads it would refuse either way.
      console.log(
        `  Topology brief: the corpus carried no call edge, so NO brief was written to ${opts.topologyBriefOut}`,
      );
    } else {
      topologyDump.record({
        // A label for the file's reader. `basename` of a path that ends in a separator is empty, so the fallback is
        // not cosmetic: an empty `system` is refused by the reader.
        system: basename(opts.dataDir) || 'corpus',
        cases: predictionsPerCase.length,
        services: brief.services,
        edges: brief.edges,
        digest: brief.digest,
        brief: brief.text,
      });
      // The size is printed beside the digest because the brief is priced per case: an arm that shows every case
      // the union is a channel whose cost is `chars × cases`, and that product is the number the dispatch is
      // bought with. `estimatedTokens` is `chars / 4` and is named an estimate for the reason the field documents.
      console.log(
        `  Topology brief: ${brief.services} services, ${brief.edges} call edges over ` +
          `${predictionsPerCase.length} cases, ${brief.chars} chars (~${brief.estimatedTokens} tokens estimated), ` +
          `digest ${brief.digest} -> ${opts.topologyBriefOut}`,
      );
    }
  }

  // ── Aggregate ────────────────────────────────────────────
  const top1 = computeAvgAtKMultiLabel(predictionsPerCase, acceptedPerCase, 1);
  const top3 = computeAvgAtKMultiLabel(predictionsPerCase, acceptedPerCase, 3);
  const top5 = computeAvgAtKMultiLabel(predictionsPerCase, acceptedPerCase, 5);

  // Printed with the RESULTS, not only in the header: a signal that received
  // nothing produces "no change", which is indistinguishable from a measured
  // null unless the input is counted next to the number. See
  // summariseFailedEdgeCoverage.
  const failedEdgeCoverage = formatFailedEdgeCoverageLine(
    summariseFailedEdgeCoverage(failedEdgeCases),
  );

  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  console.log('');
  console.log(`${'═'.repeat(65)}`);
  console.log("  FSE'26 RCABench — Micro-Kinetic (production TreePruner)");
  console.log(`${'═'.repeat(65)}`);
  console.log(`  Top@1 = ${pct(top1)}   Top@3 = ${pct(top3)}   Top@5 = ${pct(top5)}`);
  console.log(
    `  Cases = ${predictionsPerCase.length}   loadErrors=${loadErrors} ` +
      `engineErrors=${engineErrors} emptyGraphs=${emptyGraphs}`,
  );
  console.log(`  ${failedEdgeCoverage}`);
  // Printed for the reason above, one axis over: this line is what a zero on a
  // `transientGuardTest` arm has to be read against.
  console.log(`  ${formatBoundaryCensus(summariseBoundaryCensus(boundaryObservations))}`);
  // The self-time term's own census, printed only on an arm that asks for the term — an OFF term has nothing to
  // report, and a line printed at weight 0 would invite a reader to interpret an absence the engine never built.
  if (selfTimeWeight !== 0) {
    console.log(`  ${formatSelfTimeCensus(selfTimeCensus)}`);
  }
  console.log('');
  console.log(`  vs published anchor: SOTA avg ${pct(ANCHOR_AVG)} / best ${pct(ANCHOR_BEST)}`);
  const delta = top1 - ANCHOR_AVG;
  console.log(`  Δ vs SOTA avg: ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`);
  console.log('');
  console.log('  Per-fault-type Top@1:');
  const sortedFaults = [...faultCells.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [ft, cell] of sortedFaults) {
    const acc = cell.total > 0 ? cell.correct / cell.total : 0;
    console.log(
      `    ${ft.padEnd(24)} ${cell.correct.toString().padStart(3)}/${cell.total
        .toString()
        .padEnd(3)} ${pct(acc)}`,
    );
  }
  console.log(`${'═'.repeat(65)}`);

  // ── Structured output (for CI artifact) ──────────────────
  if (opts.output) {
    const report = buildFSE26Report({
      anchor: { sotaAvgTop1: ANCHOR_AVG, sotaBestTop1: ANCHOR_BEST },
      config: runConfig,
      cases: predictionsPerCase.length,
      top1,
      top3,
      top5,
      loadErrors,
      engineErrors,
      emptyGraphs,
      perFaultType: faultCells,
    });
    writeFileSync(opts.output, JSON.stringify(report, null, 2));
    console.log(`\nResults written to ${opts.output}`);
  }
  if (opts.perCaseOut !== '') {
    const written = writePerCaseVerdicts(opts.perCaseOut, verdicts);
    console.log(`  Per-case verdicts: ${written} rows -> ${opts.perCaseOut}`);
  }
  if (opts.depthOut !== '') {
    // The ladder is printed as well as written: the artifact is what an offline analysis joins on, and the table
    // is what a dispatch reads in its own log. Both come from the same rows, so the log cannot state a ladder the
    // file does not support.
    const summary = depthDump!.summary();
    const rows = readDepthDump(opts.depthOut);
    console.log(formatDepthLadder(rows));
    console.log(
      `  Depth rows: ${summary.cases} cases, ${summary.candidates} candidates, ` +
        `${summary.absent} absent, deepest=${summary.deepest ?? 'none'} -> ${summary.path}`,
    );
  }
  if (fingerprintDump !== undefined) {
    // The census is printed rather than only written: a fingerprint that offered nothing is indistinguishable
    // from a model that abstained, and the four counters are what tell the two apart.
    const summary = fingerprintDump.summary;
    // The REQUESTED width is printed beside the realised counts, because those two numbers are not the same
    // sentence: a run that asked for twenty and wrote five because every case was capped is an artifact of a
    // different population than one that asked for five, and only the request distinguishes them.
    console.log(
      `  Fingerprints: ${summary.cases} cases, ${summary.candidates} candidates, ` +
        `${summary.channels} channels, requested width ${opts.fingerprintTopK === 0 ? 'every' : String(opts.fingerprintTopK)} ` +
        `(published ${PUBLISHED_TOP_K}) -> ${summary.path}`,
    );
    console.log(
      `  Fingerprint census: considered=${summary.census.considered} offered=${summary.census.offered} ` +
        `unmeasurable=${summary.census.unmeasurable} unprofiled=${summary.census.unprofiled} ` +
        `shadowed=${summary.census.shadowed} capped=${summary.census.capped}`,
    );
  }
  if (presentationDump !== undefined) {
    // The REQUESTED width is printed beside the realised counts, because those two numbers are not the same
    // sentence: a run that asked for twenty and wrote five because every case was capped is an artifact of a
    // different population than one that asked for five, and only the request distinguishes them.
    const summary = presentationDump.summary;
    console.log(
      `  Presentation:  ${summary.cases} cases, ${summary.candidates} candidates, ` +
        `${summary.channels} channels, requested width ` +
        `${opts.fingerprintTopK === 0 ? 'every' : String(opts.fingerprintTopK)} ` +
        `(published ${PUBLISHED_TOP_K}) -> ${summary.path}`,
    );
  }
  if (containmentDump !== undefined) {
    // Printed rather than only written: a dump whose replay count is not equal to its case count is describing
    // something other than the decision it observes, and that has to be legible in the log of the run that wrote
    // it — the artifact itself is what a reader joins on, but a mismatch is a finding about the instrument.
    const summary = containmentDump.summary;
    console.log(
      `  Containment rows: ${summary.cases} cases, ${summary.pairs} pairs ` +
        `(${summary.measuredPairs} measured both sides), inverted=${summary.inverted} ` +
        `ungated-inverted=${summary.invertedUngated} no-failed-interface=${summary.noFailedInterface} ` +
        `unmeasured=${summary.unmeasured} not-larger=${summary.notLarger} -> ${summary.path}`,
    );
    console.log(
      `  Containment replay: identical=${summary.replayIdentical} differs=${summary.replayDiffers} ` +
        `unavailable=${summary.replayUnavailable}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
