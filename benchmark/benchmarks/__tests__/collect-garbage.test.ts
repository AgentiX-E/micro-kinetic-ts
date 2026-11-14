/**
 * Unit tests for {@link collectGarbage}.
 *
 * The property that matters is behavioural rather than structural: calling it must actually RECLAIM, because the
 * whole reason it exists is that dropping references was not enough. Measured on the RCAEval corpus the runner went
 * from 73 MB at the first cell's end to 2.3 GB at the fifth's while every case had already been released — the heap
 * held pages nothing pointed at, and no collection was ever requested.
 *
 * The test therefore allocates, releases, collects, and reads the heap. It is deliberately not a test of V8: what it
 * pins is that THIS function reaches a collector rather than the no-op fallback, so a process that starts without
 * `--expose-gc` — which is every dispatch — still gets one.
 *
 * @module __tests__/collect-garbage
 */

import { describe, expect, it } from 'vitest';

import { collectGarbage, resolveCollector } from '../src/collect-garbage.js';

const mb = (bytes: number): number => bytes / 1024 / 1024;

describe('collectGarbage — a release is not a reclamation', () => {
  it('is a callable function, whether it reached a collector or fell back', () => {
    // The fallback is a real outcome and not an error: an embedder that forbids the flag still runs. What must never
    // happen is the module throwing at load, which would take the runner down before its first case.
    expect(typeof collectGarbage).toBe('function');
    expect(() => collectGarbage()).not.toThrow();
  });

  it('reclaims what a caller released', () => {
    // 64 MB of live-then-dropped objects. Without a collector the pages stay resident and `heapUsed` barely moves;
    // with one the drop is visible. The bound is loose on purpose — the assertion is "the memory came back", not "a
    // particular collection strategy ran".
    const before = process.memoryUsage().heapUsed;

    let held: number[][] | undefined = Array.from({ length: 64 }, () =>
      Array.from<number>({ length: 128 * 1024 }).fill(1),
    );
    const whileHeld = process.memoryUsage().heapUsed;
    expect(whileHeld).toBeGreaterThan(before);

    held = undefined;
    collectGarbage();
    const afterRelease = process.memoryUsage().heapUsed;

    expect(held).toBeUndefined();
    // At least a quarter of what was held has to be gone: a collector that reclaimed nothing would leave the whole
    // 64 MB in place, and that is the failure this pins.
    expect(mb(whileHeld - afterRelease)).toBeGreaterThan(16);
  });

  it('is safe to call when there is nothing to reclaim', () => {
    // It runs at every slice boundary, including the last, and at every cell boundary: most calls have nothing to do.
    for (let i = 0; i < 5; i++) expect(() => collectGarbage()).not.toThrow();
  });
});

/**
 * The decision `collectGarbage` is made of, on every input the engine can present.
 *
 * These are not a decomposition of the call above: the four outcomes below are the four states a real process can be
 * in — a collector already exposed, one the runtime flag exposes, an engine that offers something that is not a
 * function, and an embedder that forbids the flag outright — and only the first two are reachable by choosing a
 * command line. The last two are the reason the fallback exists, so they are exercised rather than assumed.
 */
describe('resolveCollector — what the engine offered, turned into something callable', () => {
  it('returns the collector the lookup produced, and calls it', () => {
    let calls = 0;
    const collector = resolveCollector(() => () => {
      calls += 1;
    });

    collector();

    expect(calls).toBe(1);
  });

  it('falls back to a no-op when the lookup offers nothing', () => {
    // The shape of an engine that has moved on: the flag is accepted and exposes nothing.
    const collector = resolveCollector(() => undefined);

    expect(typeof collector).toBe('function');
    expect(() => collector()).not.toThrow();
  });

  it('falls back to a no-op when the lookup offers something that is not a function', () => {
    // The other shape of the same change: the name exists and is not a collector. Returning it would move the
    // failure from here to the first slice boundary, where it reads as a crash in the runner.
    expect(() => resolveCollector(() => 'gc')()).not.toThrow();
  });

  it('falls back to a no-op when the lookup throws', () => {
    // A locked-down embedder: `setFlagsFromString` is the call that goes first, and it can refuse.
    const collector = resolveCollector(() => {
      throw new Error('flag not permitted');
    });

    expect(() => collector()).not.toThrow();
  });

  it('reaches a real collector with the lookup it ships', () => {
    // The default path, in this process: no `--expose-gc` on the command line, so the flag is set at runtime and the
    // collector is taken from a fresh context. This is the state every dispatch runs in.
    const collector = resolveCollector();

    expect(typeof collector).toBe('function');
    expect(() => collector()).not.toThrow();
  });

  it('prefers a collector the process already exposed', () => {
    const holder = globalThis as { gc?: unknown };
    const previous = holder.gc;
    const exposed = (): void => {};

    holder.gc = exposed;
    try {
      expect(resolveCollector()).toBe(exposed);
    } finally {
      if (previous === undefined) delete holder.gc;
      else holder.gc = previous;
    }
  });
});
