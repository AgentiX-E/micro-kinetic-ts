/**
 * A garbage collector the runner can call.
 *
 * The RCAEval path releases a cell's cases at each memory-slice boundary and its last per-case records at each cell
 * boundary, and both releases remove REFERENCES. Removing a reference is not reclaiming memory: V8 collects when it
 * decides to, and its own schedule is driven by heap pressure rather than by a caller who knows it has just dropped
 * three gigabytes. Measured on this corpus, that difference is the whole defect — with the releases in place the
 * runner still climbed from 73 MB at the end of the first cell to 2.3 GB at the end of the fifth, and died in the
 * sixth, because nothing ever asked for a collection.
 *
 * `globalThis.gc` is only defined when the process is started with `--expose-gc`, which a dispatch does not do and a
 * caller cannot arrange from inside the process. The flag can, however, be set at runtime, and the collector it
 * exposes is reachable through a fresh context — this is the documented way to obtain it, and it is the only one
 * that works for a runner that is started without cooperating flags.
 *
 * When even that fails (an engine that has moved on, a locked-down embedder), the result is a no-op. That is a real
 * degradation and not a silent one: the caller's releases still bound what is REACHABLE, and the slicing still bounds
 * the resident set — a collection lets the two bounds become the same number instead of drifting apart.
 *
 * @module benchmarks/collect-garbage
 */

import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

/**
 * A function that asks the engine to collect, or a no-op when the engine will not give one up.
 *
 * The no-op is a value rather than an absence so that every call site can call it unconditionally: a runner that had
 * to test for the collector's existence would spread that test across every boundary it collects at.
 */
export type GarbageCollector = () => void;

/**
 * How a collector is looked for. Returns the candidate, which may be anything — the type check is
 * {@link resolveCollector}'s, so a lookup cannot smuggle a non-function past it.
 */
export type CollectorLookup = () => unknown;

/**
 * The lookup the runner uses: `globalThis.gc` when the process was started with `--expose-gc`, otherwise the
 * collector the runtime flag exposes through a fresh context.
 *
 * Both steps are here rather than in {@link resolveCollector} because they are the two things a test cannot arrange
 * from inside a process — the flag is process-wide and the context construction is the whole point — while the
 * decision they feed is a pure one.
 *
 * @returns Whatever the engine offered: a function, `undefined`, or a value of another type after an engine change.
 */
function nativeCollector(): unknown {
  const fromGlobal = (globalThis as { gc?: unknown }).gc;
  if (fromGlobal !== undefined) return fromGlobal;
  setFlagsFromString('--expose_gc');
  // The expression is a CONSTANT, and it is the only way to reach the collector the flag just exposed: Node does not
  // attach it to `globalThis` retroactively. There is no input here and therefore no injection surface.
  return runInNewContext('gc');
}

/**
 * Turn a lookup into a collector, falling back to a no-op.
 *
 * Two failure modes are folded into the same answer on purpose, because a caller cannot act on the difference: the
 * engine may offer something that is not a function (an engine change), or the lookup may throw (an embedder that
 * forbids the flag). Either way the runner keeps running and the resident set is bounded by the slicing instead.
 *
 * @param lookup - How to look for a collector. Defaults to {@link nativeCollector}.
 * @returns The collector the lookup produced, or a no-op when it produced none.
 */
export function resolveCollector(lookup: CollectorLookup = nativeCollector): GarbageCollector {
  try {
    const found = lookup();
    if (typeof found === 'function') return found as GarbageCollector;
  } catch {
    // Fall through: a runner without a collector still runs, it just leaves the reclamation to the engine.
  }
  return () => {};
}

/**
 * Obtain the collector, once, at module load.
 *
 * Resolved at load rather than per call because the flag is a process-wide setting and the lookup is not free: a
 * runner that calls this once per slice would be paying for a context construction per slice to get the same
 * function back.
 */
export const collectGarbage: GarbageCollector = resolveCollector();
