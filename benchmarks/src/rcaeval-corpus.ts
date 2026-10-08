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
 * ## The composition this module fixes, exactly
 *
 * The two direction-carrying fields are derived **differently from each other**, and that is deliberate rather
 * than an oversight to be tidied: `edgeLatency` comes from the case's own loaded span list, which is capped
 * (`loadTraces`'s 10 000 spans), while `failedTraceEdges` comes from a separate streaming pass over
 * `traces.csv` that reads the whole file. `run-rcaeval.ts` composes them that way, the shipped `latWeight`
 * multiplies the capped one, and **a repair that unified them would move a published number**. So the owner
 * reproduces the composition rather than improving it, and this paragraph is the record of that choice.
 *
 * @module benchmarks/rcaeval-corpus
 */

import { join } from 'node:path';

import type { ServiceCallGraph, TraceSpan } from '@agentix-e/micro-kinetic-core';
import {
  countDirectionalInputs,
  countTraceActivityByService,
  type RCAEvalLoader,
} from '../../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import type {
  BenchmarkCase,
  RCAEvalCase,
} from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { augmentTopologyWithTraces } from '../../packages/kinetic/src/signals/trace-topology.js';

import { toEngineDirectionalInputs } from './directional-evidence.js';

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
}

/** A case's assembled inputs, plus what the assembly did to the graph. */
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
 * @param options - Whether to augment, and whether to attach span activity.
 * @returns The assembled case and the size of the augmentation.
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

  // The direction the RCAEval side never supplied, at millisecond resolution. Defaulted to empty so a case
  // without traces carries the arrays rather than `undefined` — "no failures observed" and "no traces to
  // observe" are different statements and only the second one is this.
  let directional: ReturnType<typeof toEngineDirectionalInputs> = {
    failedTraceEdges: [],
    edgeLatency: [],
  };

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

    // The seconds-to-milliseconds conversion is done HERE, because the span mapping above passes
    // `t.startTime` through unconverted while `rawCase.injectTime` is seconds — comparing the two directly
    // would put every span before the injection and report no failures at all. That discrepancy in the
    // mapping above is recorded separately as its own finding.
    directional = toEngineDirectionalInputs(
      rawCase.traces.map((t) => ({
        spanId: t.spanId,
        parentSpanId: t.parentSpanId,
        service: t.service,
        startTime: t.startTime * 1000,
        duration: t.duration,
        status: t.status,
      })),
      rawCase.injectTime * 1000,
    );
  }
  const edgesAfter = graph.edges.length;

  let benchCase: BenchmarkCase = {
    ...loader.toBenchmarkCase(rawCase, graph, suiteName),
    failedTraceEdges: directional.failedTraceEdges,
    edgeLatency: directional.edgeLatency,
  };

  if (options.traceActivity && meta.suite === 'RE3') {
    benchCase = {
      ...benchCase,
      traceActivity: await countTraceActivityByService(
        join(meta.dirPath, 'traces.csv'),
        benchCase.injectTime,
      ),
    };
  }

  // `failedTraceEdges` is RE-DERIVED from the raw file, overwriting the array `toEngineDirectionalInputs`
  // produced above. That is the shipped composition, and it is not a no-op: the two derive the same QUANTITY
  // from different inputs (`directional` sees the capped span list, this sees every row). `edgeLatency` is
  // deliberately NOT re-derived, so the caps stay where the published `latWeight` expects them.
  //
  // Unconditional, and deliberately so: gating it on a weight would re-create the defect it repairs, because
  // the shipped failed-edge weight is 0 and the artifact would go on reporting a starved channel as a
  // measured zero. It costs one streaming pass over a file the case already owns.
  const streaming = await countDirectionalInputs(
    join(meta.dirPath, 'traces.csv'),
    benchCase.injectTime,
  );
  benchCase = { ...benchCase, failedTraceEdges: streaming.failedTraceEdges };

  return { benchCase, callGraph: graph, traceUsed, pruned, edgesBefore, edgesAfter };
}
