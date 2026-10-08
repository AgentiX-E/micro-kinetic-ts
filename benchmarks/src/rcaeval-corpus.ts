/**
 * The ONE assembly point of an RCAEval case's benchmark inputs.
 *
 * ## Why this module exists
 *
 * The corpus an RCAEval case presents to the engine is not just its metrics: it is the metrics, a call graph
 * — **augmented from the case's own observed spans** — plus the two direction-carrying inputs and, on RE3, the
 * per-service span-activity counts. Three files assembled that corpus, and **the shipped path and the study's
 * path did not assemble it the same way**:
 *
 * - `run-rcaeval.ts` (the golden) calls `augmentTopologyWithTraces(callGraph, spans, { minCallFrequency: 1 })`
 *   for **every case that has traces**. Its own artifact records the size of that step: `50/50 cases with
 *   traces, 50 pruned, avg edges: 20 → 9` (RE2 OB), `218 → 39` (RE2 TT), `23 → 9` (RE3 OB), `218 → 41`
 *   (RE3 TT). RE1 carries no traces and records none.
 * - `run-ablation.ts` **never called it**. Its only route to an augmentation was the runner's
 *   `TraceValidationOptions`, gated on the `traceAugmentation` feature flag — and that arm passed
 *   `{ minCallFrequency: 0, discoverNewEdges: false, pruneUnobserved: true }`, which is **not the shipped
 *   augmentation** but a third, different one.
 * - `run-fse26.ts` **never called it either**, and reads no spans at all.
 *
 * So the study ranked on the **unpruned** graph, the FSE'26 half ranked on the unpruned graph, and the
 * published RCAEval cells ranked on the pruned one. The measured cost of that difference, taken from the two
 * artifacts rather than argued: **one cell of fourteen** — RE2 TrainTicket, +1.8pp in the unpruned direction —
 * with the other thirteen identical per fault type. It is small, and it is not the point. The point is that
 * *which graph a run ranks on was a property of which runner you invoked*, which is the same failure this
 * repository has now repaired twice for other quantities: **a property with no owner drifts.**
 *
 * ## The direction-carrying fields, and the cap
 *
 * `edgeLatency` comes from the case's own loaded span list, which is capped (`loadTraces`'s 10 000 spans and a
 * byte PREFIX), while `failedTraceEdges` comes from a separate streaming pass over `traces.csv` that reads the
 * whole file. `run-rcaeval.ts` composes them that way, the shipped `latWeight` multiplies the capped one, and
 * **a repair that unified them would move a published number**. So the owner reproduces the composition rather
 * than improving it, and this paragraph is the record of that choice.
 *
 * ## The latency channel: three views of one quantity, and two suppressors (iteration 74)
 *
 * `edgeLatency` is the input the shipped **`latWeight = 0.561495`** multiplies — one of the three terms that
 * dominate the ranking — and on **every** RCAEval cell it has been an **empty array**. Two independent
 * mechanisms can produce that, and until this iteration the artifact could not tell them apart:
 *
 * 1. **A unit defect.** `BenchmarkTraceSpan.startTime` is declared `// Unix milliseconds`;
 *    `normalizeTraceStartTime` divides microseconds by 1000 precisely so the value is comparable with
 *    `injectTimeMs`, and the loader's own duration docblock states that contract in as many words. The
 *    expression this repository shipped scaled it by 1000 a **second** time, so `after` is true for EVERY
 *    span, no edge can have a pre-injection mean, and `toEngineDirectionalInputs` returns `[]` — on **every**
 *    corpus, not on this one.
 * 2. **A truncating cap.** `tryLoadTraces` reads a byte PREFIX (`(10_000 + 1) * 256` bytes ≈ 2.6 MB), and
 *    `countTraceActivityByService`'s own docblock records that this "truncates before the post-injection
 *    window". With the unit repaired, the capped route may therefore STILL see no post-injection span.
 *
 * The third route is the one nobody takes: `countDirectionalInputs` derives `edgeLatency` over the WHOLE file
 * in the very streaming pass whose `failedTraceEdges` this owner keeps — and it was dropped one line later, at
 * zero saving. So the owner now derives all three views in one assembly and keeps them:
 *
 * | view | input | start-time unit | what it is |
 * | --- | --- | --- | --- |
 * | `shipped` | the capped span list | scaled twice | the composition that published the nine cells |
 * | `capped` | the capped span list | as the loader normalises it | the same cap, unit repaired |
 * | `whole-file` | the streaming pass | as the loader normalises it | the only view that can hold both sides |
 *
 * Which view a run ranks on is a **corpus** property, stated at every call site rather than defaulted — the
 * reason `prismPooling` exists: *an option a caller can name and a call site omits is an open axis.* The
 * published cells' view is `shipped`, because a repair that silently changed the input would move a published
 * number, and the honest order is to MEASURE the move before taking it.
 *
 * @module benchmarks/rcaeval-corpus
 */

import { join } from 'node:path';

import type { ServiceCallGraph, TraceSpan } from '@agentix-e/micro-kinetic-core';
import type { FaultEdgeLatency } from '../../packages/core/src/interfaces/rca-engine.js';
import {
  countDirectionalInputs,
  countTraceActivityByService,
  type RCAEvalLoader,
} from '../../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import type {
  BenchmarkCase,
  BenchmarkTraceSpan,
  RCAEvalCase,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { augmentTopologyWithTraces } from '../../packages/kinetic/src/signals/trace-topology.js';

import { toEngineDirectionalInputs, type LatencyRouteEntry } from './directional-evidence.js';

/** Which suite a case belongs to, as the engine's case type names it. */
export type RCAEvalSuiteName = 'rcaeval-re1' | 'rcaeval-re2' | 'rcaeval-re3';

/**
 * The shipped augmentation's options, in the one place they are stated.
 *
 * `{ minCallFrequency: 1 }` is what `run-rcaeval.ts` passes and what `TraceTopologyConfig`'s own defaults
 * are, so naming the constant makes the shipped corpus a value rather than an accident of two omitted
 * arguments. A different threshold is a different corpus, not a tunable.
 */
export const SHIPPED_TRACE_AUGMENTATION = { minCallFrequency: 1 } as const;

/**
 * Which input `edgeLatency` was derived from, and how its start times were handled.
 *
 * A closed union rather than a runtime table: `views[source]` is total over it, so a member added here and not
 * derived is a compile error at the one place the views are built — the same guarantee a `Record` would give,
 * without a table whose only reader would be a test.
 */
export type LatencySource = 'shipped' | 'capped' | 'whole-file';

/**
 * The view the PUBLISHED cells ranked on.
 *
 * Named rather than inlined because it is the default a reader has to be able to find: it is the composition
 * whose `edgeLatency` is empty by the unit defect above, which is why `latWeight` is a no-op in every
 * published cell.
 */
export const DEFAULT_LATENCY_SOURCE: LatencySource = 'shipped';

/** The three views, as arrays, for one case. Every view is `[]` when the case carried no spans. */
export interface LatencyViews {
  readonly shipped: readonly FaultEdgeLatency[];
  readonly capped: readonly FaultEdgeLatency[];
  readonly 'whole-file': readonly FaultEdgeLatency[];
}

/** How a case's capped span list is distributed across the injection boundary. */
export interface CapSides {
  /** Spans in the capped list, on both sides. */
  readonly spans: number;
  readonly pre: number;
  readonly post: number;
}

/**
 * Count a capped span list's spans on each side of the injection.
 *
 * The counts are what turns "the channel is empty" into a statement about a MECHANISM: a list with
 * `pre === 0` cannot yield a pre-injection mean however correct the rest of the derivation is, and a list with
 * `post === 0` says the cap landed before the window. Without them the two are one number.
 *
 * @param spans - The case's capped span list, with `startTime` in the unit the loader normalises it to.
 * @param injectTimeMs - The fault injection time in Unix milliseconds, the same anchor the engine receives.
 * @returns The three counts. An empty list is `{spans: 0, pre: 0, post: 0}`.
 */
export function countCapSides(
  spans: ReadonlyArray<{ readonly startTime: number }>,
  injectTimeMs: number,
): CapSides {
  let pre = 0;
  for (const span of spans) if (span.startTime < injectTimeMs) pre += 1;
  return { spans: spans.length, pre, post: spans.length - pre };
}

/** What the caller wants the corpus to contain. */
export interface CorpusAssemblyOptions {
  /**
   * Whether to augment the call graph from the case's own observed spans.
   *
   * A CORPUS property, not a ranking feature: the shipped RCAEval path passes `true` for every case, and a
   * run that passes `false` ranks on a graph the published cells do not. Its only honest use is a study that
   * measures the corpus itself.
   */
  readonly augmentFromTraces: boolean;
  /**
   * Whether to attach the per-service span-activity counts.
   *
   * Gated by the caller rather than decided here, because it is expensive (a streaming pass over a file that
   * reaches ~27 MB) and it is only meaningful on RE3: the "more spans ⇒ source" mechanism holds for RE3's
   * code-level faults and not for RE1/RE2's resource and route faults, where a span rise is not a source
   * signature.
   */
  readonly traceActivity: boolean;
  /**
   * Which view of `edgeLatency` the assembled case carries — i.e. which corpus the engine ranks on.
   *
   * REQUIRED, unlike the two above, because this one has a non-trivial default with a consequence: the
   * published cells are the `shipped` view, whose array is empty by the unit defect, so a caller that omitted
   * the field would rank on a corpus no artifact names. See `LatencySource`.
   */
  readonly latencyFrom: LatencySource;
}

/** A case's assembled inputs, plus what the assembly did to the graph and to the latency channel. */
export interface AssembledRCAEvalCase {
  /** The case the engine will rank on: metrics, the (possibly augmented) graph, and every derived input. */
  readonly benchCase: BenchmarkCase;
  /** The graph after augmentation — what the engine actually receives. */
  readonly callGraph: ServiceCallGraph;
  /** Whether the case carried traces at all. */
  readonly traceUsed: boolean;
  /** Whether augmentation removed at least one edge from the caller's graph. */
  readonly pruned: boolean;
  /** Edge count before / after augmentation, so a run can report the size of the step it took. */
  readonly edgesBefore: number;
  readonly edgesAfter: number;
  /**
   * All three views, kept so a study can measure the channel under each WITHOUT paying for a second
   * assembly: the whole-file view comes out of the streaming pass this function already runs, and the capped
   * views out of a pure in-memory reduction of a list it already holds.
   */
  readonly latencyViews: LatencyViews;
  /** This case's contribution to the latency-route census: one row-count per view, plus the cap's sides. */
  readonly latencyRoute: LatencyRouteEntry;
}

/**
 * The case the engine sees when its latency input comes from `source`.
 *
 * The selection lives here rather than in a runner because the views are this module's and a runner that
 * indexed them itself would be the second implementation of "which corpus is this" — the defect this module
 * exists to have repaired.
 *
 * @param benchCase - The assembled case, in any view.
 * @param views - The case's three views.
 * @param source - Which one to install.
 * @returns A case whose `edgeLatency` is that view. Nothing else differs.
 */
export function selectLatencyView(
  benchCase: BenchmarkCase,
  views: LatencyViews,
  source: LatencySource,
): BenchmarkCase {
  return { ...benchCase, edgeLatency: views[source] };
}

/**
 * Re-state a whole population under one latency view.
 *
 * @param cases - The assembled cases.
 * @param views - Case id → its three views, as `assembleRCAEvalCase` returned them.
 * @param source - Which view every case should carry.
 * @returns New case objects; the originals are untouched, so one assembly serves every row.
 */
export function applyLatencyView(
  cases: readonly BenchmarkCase[],
  views: ReadonlyMap<string, LatencyViews>,
  source: LatencySource,
): BenchmarkCase[] {
  return cases.map((c) => {
    const v = views.get(c.id);
    return v === undefined ? c : selectLatencyView(c, v, source);
  });
}

/**
 * Derive every latency view, and the cap's sides, from one case's spans.
 *
 * @param traces - The case's capped span list, `startTime` in the unit the loader normalises it to.
 * @param injectTimeMs - The injection anchor, in milliseconds.
 * @param wholeFile - The streaming pass's `edgeLatency`, which reads the whole file.
 * @returns The three views and the cap counts. All empty for an empty list.
 */
export function deriveLatencyViews(
  traces: readonly BenchmarkTraceSpan[],
  injectTimeMs: number,
  wholeFile: readonly FaultEdgeLatency[],
): { views: LatencyViews; capSides: CapSides } {
  const spans = traces.map((t) => ({
    spanId: t.spanId,
    parentSpanId: t.parentSpanId,
    service: t.service,
    startTime: t.startTime,
    duration: t.duration,
    status: t.status,
  }));
  return {
    views: {
      // The PUBLISHED composition, reproduced exactly — over-scale included — because the nine cells were
      // measured with it and a number that moves has to move on purpose.
      shipped: toEngineDirectionalInputs(
        spans.map((s) => ({ ...s, startTime: s.startTime * 1000 })),
        injectTimeMs,
      ).edgeLatency,
      capped: toEngineDirectionalInputs(spans, injectTimeMs).edgeLatency,
      'whole-file': wholeFile,
    },
    capSides: countCapSides(spans, injectTimeMs),
  };
}

/**
 * Assemble one case's benchmark inputs, the way the published RCAEval cells are assembled.
 *
 * @param loader - The loader, for the traces file and the span-cap rule.
 * @param rawCase - The case as `loader.loadCase` returned it. Its `traces` are read, not consumed: the caller
 *   owns them and releases them after this returns.
 * @param meta - The suite and the case directory (the directory, not the loaded case, is what the streaming
 *   passes read).
 * @param callGraph - The caller's graph. Graph CONSTRUCTION (exact / embedding / semantic) is the caller's,
 *   because the two runners configure it differently; what is owned here is everything applied *to* it.
 * @param suiteName - The engine's name for this case's suite.
 * @param options - Whether to augment, whether to attach span activity, and which latency view to install.
 * @returns The assembled case, the size of the augmentation, and the latency channel's own census row.
 */
export async function assembleRCAEvalCase(
  loader: RCAEvalLoader,
  rawCase: RCAEvalCase,
  meta: { readonly suite: string; readonly dirPath: string },
  callGraph: ServiceCallGraph,
  suiteName: RCAEvalSuiteName,
  options: CorpusAssemblyOptions,
): Promise<AssembledRCAEvalCase> {
  const edgesBefore = callGraph.edges.length;
  let graph = callGraph;
  let traceUsed = false;
  let pruned = false;

  if (rawCase.traces && rawCase.traces.length > 0) {
    traceUsed = true;

    if (options.augmentFromTraces) {
      const spans: TraceSpan[] = rawCase.traces.map((t) => ({
        traceId: t.traceId,
        spanId: t.spanId,
        parentSpanId: t.parentSpanId ?? '',
        service: t.service,
        operation: t.operationName,
        duration: t.duration,
        statusCode: t.status === 'ERROR' ? 500 : 200,
        isError: t.status === 'ERROR',
        startTime: t.startTime,
      }));
      graph = augmentTopologyWithTraces(graph, spans, SHIPPED_TRACE_AUGMENTATION);
      pruned = graph.edges.length < edgesBefore;
    }
  }
  const edgesAfter = graph.edges.length;

  // The case the engine will rank on, built ONCE — `toBenchmarkCase` reduces every metric series of the case,
  // so calling it a second time to read its anchor would double the cost of the commonest step in the run for
  // no statement the first call does not already make.
  let benchCase: BenchmarkCase = {
    ...loader.toBenchmarkCase(rawCase, graph, suiteName),
    failedTraceEdges: [],
    edgeLatency: [],
  };

  // The anchor every derivation below is split on, read from the case the ENGINE receives rather than
  // recomputed from `rawCase.injectTime` — one conversion, in the one owner of it, so the boundary the ranking
  // filters on and the boundary the channels split on cannot drift apart.
  const injectTimeMs = benchCase.injectTime;

  // Unconditional, and deliberately so: gating the streaming pass on a weight would re-create the defect it
  // repairs, because the shipped failed-edge weight is 0 and the artifact would go on reporting a starved
  // channel as a measured zero. It costs one streaming pass over a file the case already owns — and it is the
  // ONLY route that sees the post-injection window, so its two outputs are the ones the census reads.
  const streaming = await countDirectionalInputs(join(meta.dirPath, 'traces.csv'), injectTimeMs);

  const { views, capSides } = deriveLatencyViews(
    rawCase.traces ?? [],
    injectTimeMs,
    streaming.edgeLatency,
  );

  benchCase = {
    ...benchCase,
    failedTraceEdges: streaming.failedTraceEdges,
    edgeLatency: views[options.latencyFrom],
  };

  if (options.traceActivity && meta.suite === 'RE3') {
    benchCase = {
      ...benchCase,
      traceActivity: await countTraceActivityByService(
        join(meta.dirPath, 'traces.csv'),
        injectTimeMs,
      ),
    };
  }

  return {
    benchCase,
    callGraph: graph,
    traceUsed,
    pruned,
    edgesBefore,
    edgesAfter,
    latencyViews: views,
    latencyRoute: {
      anchorPresent: injectTimeMs > 0,
      capSpans: capSides.spans,
      capPre: capSides.pre,
      capPost: capSides.post,
      shippedRows: views.shipped.length,
      cappedRows: views.capped.length,
      wholeFileRows: views['whole-file'].length,
    },
  };
}
