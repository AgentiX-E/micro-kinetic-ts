/**
 * Assemble the engine's case-level inputs from a benchmark case.
 *
 * This exists because there were TWO call sites and they drifted. Every suite
 * except FSE'26 goes through `BenchmarkRunner.buildFaultGraph`, while
 * `run-fse26.ts` builds its fault graph inline — and the inline one had been
 * passing only `injectTimeMs` and `logs`. So `traceActivity` (the silent-source
 * signal) and then `failedTraceEdges` (the failed-edge-direction signal) were
 * each silently dead on the benchmark with the largest case count.
 *
 * That failure mode is the reason this is a function rather than two object
 * literals: an input reaching one call site and not the other does NOT throw and
 * does NOT lower coverage. It reports "no change", which a reader takes as a
 * measured result — the same shape as the workflow input that the runner
 * dropped, and the same shape as the hardcoded log mode that published a number
 * 24.2pp below the best-measured one.
 *
 * `injectTimeMs` stays a parameter because the CALLER owns that policy: the
 * runner disables the injection anchor for ablations (`useInjectTime`).
 *
 * @module benchmarks/runners/fault-graph-options
 */

import type { BuildFaultGraphOptions } from '@agentix-e/micro-kinetic-core';

import type { BenchmarkCase } from '../loaders/types.js';

/**
 * Map a benchmark case's optional case-level evidence onto the engine's option
 * object.
 *
 * Pure and total: every field is forwarded or deliberately absent, so a new
 * field on {@link BenchmarkCase} is added here once and reaches every caller.
 *
 * @param benchCase - The loaded case.
 * @param injectTimeMs - The injection anchor to use (`0` disables the anchor).
 * @returns The options object to pass to `buildFaultGraph`.
 */
export function toFaultGraphOptions(
  benchCase: BenchmarkCase,
  injectTimeMs: number,
): BuildFaultGraphOptions {
  return {
    injectTimeMs,
    logs: benchCase.logs,
    traceActivity: benchCase.traceActivity,
    failedTraceEdges: benchCase.failedTraceEdges,
  };
}
