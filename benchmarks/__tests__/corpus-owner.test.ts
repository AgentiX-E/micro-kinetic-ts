/**
 * The corpus owner, on a real case directory.
 *
 * ## Why this is not a unit test of a helper
 *
 * Every pure function of the owner has a test beside it, and none of those tests can say what the owner
 * actually ASSEMBLES — because the defect iteration 74 is about lives in the lines that DERIVE the view, not in
 * the reduction that consumes it. So this file writes a real RCAEval case directory (`metrics.json`,
 * `inject_time.txt`, `traces.csv`), hands it to the real loader, calls the real owner, and reads the three views
 * back. Nothing is stubbed: the fixture is a corpus, and the assertions are about what one corpus produces.
 *
 * **What it pins.** `BenchmarkTraceSpan.startTime` is milliseconds — `normalizeTraceStartTime` divides
 * microseconds by 1000 so the value is comparable with `injectTimeMs`, and the loader's own duration docblock
 * states that contract. An owner that scales it again puts every span after the anchor, so the `shipped` view is
 * empty on a corpus that carries a perfectly good pre/post pair — which is what the nine published cells read,
 * and which no artifact could distinguish from a corpus with nothing to measure.
 *
 * @module benchmarks/__tests__/corpus-owner
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RCAEvalLoader } from '../../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import type { LatencySource } from '../src/rcaeval-corpus.js';
import { assembleRCAEvalCase } from '../src/rcaeval-corpus.js';
import { buildRCAEvalCallGraph } from '../src/rcaeval-topology.js';

/** The anchor, in SECONDS — the unit `inject_time.txt` carries and `toBenchmarkCase` converts. */
const ANCHOR_S = 1_700_000_000;

/** Unix MICROSECONDS, the unit a Jaeger `startTime` column carries. */
const us = (secondsFromAnchor: number): string => `${(ANCHOR_S + secondsFromAnchor) * 1_000_000}`;

const METRICS = {
  a: [{ timestamp: ANCHOR_S - 60, value: 1, metric_name: 'cpu_usage' }],
  b: [
    { timestamp: ANCHOR_S - 60, value: 2, metric_name: 'cpu_usage' },
    { timestamp: ANCHOR_S + 60, value: 90, metric_name: 'cpu_usage' },
  ],
};

/**
 * One edge with a pair on each side of the anchor, and a failing call after it.
 *
 * `a` is the caller — the parent span's service — and `b` the callee, so the edge `a>b` holds a
 * `preMeanMs = 10` against a `postMeanMs = 500`. The `response_code` column is what makes the second call a
 * failure: RCAEval stores the error indicator as an HTTP status rather than as a flag.
 */
const TRACES = [
  'traceId,spanId,parentSpanId,serviceName,operationName,startTime,duration,response_code',
  `t1,p1,,a,root,${us(-3)},1,200`,
  `t1,c1,p1,b,work,${us(-1)},10,200`,
  `t1,c2,p1,b,work,${us(1)},500,500`,
  '',
].join('\n');

function createCaseDir(
  baseDir: string,
  dirName: string,
  files: { metrics?: unknown; injectTime?: number; traces?: string },
): string {
  const casePath = path.join(baseDir, dirName);
  fs.mkdirSync(casePath, { recursive: true });
  if (files.metrics !== undefined) {
    fs.writeFileSync(path.join(casePath, 'metrics.json'), JSON.stringify(files.metrics));
  }
  if (files.injectTime !== undefined) {
    fs.writeFileSync(path.join(casePath, 'inject_time.txt'), String(files.injectTime));
  }
  if (files.traces !== undefined) {
    fs.writeFileSync(path.join(casePath, 'traces.csv'), files.traces);
  }
  return casePath;
}

/** Assemble one fixture and hand back everything the owner returned. */
function assemble(
  dir: string,
  options: {
    suite: string;
    suiteName: 'rcaeval-re1' | 'rcaeval-re2' | 'rcaeval-re3';
    augmentFromTraces: boolean;
    traceActivity: boolean;
    latencyFrom: LatencySource;
  },
) {
  const loader = new RCAEvalLoader();
  const rawCase = loader.loadCase(dir);
  const graph = buildRCAEvalCallGraph(rawCase.benchmark, Object.keys(rawCase.metrics));
  return assembleRCAEvalCase(
    loader,
    rawCase,
    { suite: options.suite, dirPath: dir },
    graph,
    options.suiteName,
    {
      augmentFromTraces: options.augmentFromTraces,
      traceActivity: options.traceActivity,
      latencyFrom: options.latencyFrom,
    },
  );
}

describe('the corpus owner, on a real case directory', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcaeval-corpus-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  it('scales a start time ONCE, so the published view is empty and the repaired one is not', async () => {
    const dir = createCaseDir(tempDir, 'rcaeval-re3_b_CPU_1', {
      metrics: METRICS,
      injectTime: ANCHOR_S,
      traces: TRACES,
    });
    const assembled = await assemble(dir, {
      suite: 'RE3',
      suiteName: 'rcaeval-re3',
      augmentFromTraces: true,
      traceActivity: true,
      latencyFrom: 'capped',
    });

    // THE assertion: one corpus, three views, and the published one cannot hold the pair it is looking at.
    expect(
      assembled.latencyViews.shipped,
      'the published view is empty by the double scale',
    ).toEqual([]);
    expect(assembled.latencyViews.capped).toEqual([
      { caller: 'a', callee: 'b', preMeanMs: 10, postMeanMs: 500 },
    ]);
    expect(assembled.latencyViews['whole-file']).toEqual([
      { caller: 'a', callee: 'b', preMeanMs: 10, postMeanMs: 500 },
    ]);

    // The cap's sides, from the same list: two spans before the anchor and one after it — so neither of the
    // other two mechanisms (a prefix that truncates early, an anchor that is absent) emptied the view above.
    expect(assembled.latencyRoute).toEqual({
      anchorPresent: true,
      capSpans: 3,
      capPre: 2,
      capPost: 1,
      shippedRows: 0,
      cappedRows: 1,
      wholeFileRows: 1,
    });

    // The view the caller named is the one the engine receives, and the other input comes from the streaming
    // pass — which is the only route that sees the post-injection window.
    expect(assembled.benchCase.edgeLatency).toEqual(assembled.latencyViews.capped);
    expect(assembled.benchCase.failedTraceEdges).toEqual([
      { caller: 'a', callee: 'b', failed: 1, baseline: 0 },
    ]);
    expect(assembled.benchCase.injectTime).toBe(ANCHOR_S * 1000);
    expect(assembled.traceUsed).toBe(true);
    expect(assembled.edgesBefore).toBeGreaterThan(0);
    expect(assembled.edgesAfter).toBeLessThanOrEqual(assembled.edgesBefore);
    // RE3, and asked for: per-service span activity, from a pass that reads the WHOLE file — the parent at −3s
    // is service `a`'s only span, and the two children are service `b`'s, one on each side.
    expect(assembled.benchCase.traceActivity?.get('a')).toEqual({ pre: 1, post: 0 });
    expect(assembled.benchCase.traceActivity?.get('b')).toEqual({ pre: 1, post: 1 });
  });

  it('installs the published view when that is what the caller asked for', async () => {
    // The golden's own choice, one call apart from the case above — and the two differ by the presence of an
    // input the term multiplies. That is what makes `latWeight`'s zero across the nine cells a corpus fact
    // rather than a property of the weight.
    const dir = createCaseDir(tempDir, 'rcaeval-re3_b_CPU_1', {
      metrics: METRICS,
      injectTime: ANCHOR_S,
      traces: TRACES,
    });
    const assembled = await assemble(dir, {
      suite: 'RE3',
      suiteName: 'rcaeval-re3',
      augmentFromTraces: true,
      traceActivity: false,
      latencyFrom: 'shipped',
    });
    expect(assembled.benchCase.edgeLatency).toEqual([]);
    // …while everything ELSE about the case is the same, which is what makes the difference attributable.
    expect(assembled.benchCase.failedTraceEdges).toHaveLength(1);
    expect(assembled.latencyViews.capped).toHaveLength(1);
    expect(assembled.benchCase.traceActivity).toBeUndefined();
  });

  it('is total over a trace file with no parent column, where no edge can be expressed', async () => {
    // A dump without the parent relation: every span is its own root, so no caller is known and NO view can hold
    // a row — the honest answer, and the one an API that omitted the column would otherwise report as a starved
    // corpus. It is also the only shape in which `parentSpanId` is `undefined` rather than an empty cell, which
    // is the arm the assembly's `?? ''` mapping needs.
    const header = 'traceId,spanId,serviceName,operationName,startTime,duration,response_code';
    const dir = createCaseDir(tempDir, 'rcaeval-re3_b_CPU_1', {
      metrics: METRICS,
      injectTime: ANCHOR_S,
      traces: [
        header,
        `t1,orphan,b,work,${us(-1)},10,200`,
        `t1,orphan2,b,work,${us(1)},500,500`,
        '',
      ].join('\n'),
    });
    const assembled = await assemble(dir, {
      suite: 'RE3',
      suiteName: 'rcaeval-re3',
      augmentFromTraces: true,
      traceActivity: false,
      latencyFrom: 'whole-file',
    });
    expect(assembled.traceUsed).toBe(true);
    expect(assembled.pruned).toBe(false);
    // The spans are there and the anchor splits them — so this is not a starvation of the corpus, it is the
    // absence of a RELATION, and the two must not read the same in the census.
    expect(assembled.latencyRoute).toMatchObject({
      anchorPresent: true,
      capSpans: 2,
      capPre: 1,
      capPost: 1,
      shippedRows: 0,
      cappedRows: 0,
      wholeFileRows: 0,
    });
  });

  it('is total over a case with no traces, no anchor and no augmentation', async () => {
    // The bare fixture: metrics only. Every branch the rich fixture takes the other way — no traces, no anchor,
    // no augmentation, no span activity, and a suite that is not RE3 — so the owner has no arm that only a
    // complete corpus can reach.
    const dir = createCaseDir(tempDir, 'rcaeval-re2_b_CPU_1', { metrics: METRICS });
    const assembled = await assemble(dir, {
      suite: 'RE2',
      suiteName: 'rcaeval-re2',
      augmentFromTraces: false,
      traceActivity: false,
      latencyFrom: 'shipped',
    });
    expect(assembled.traceUsed).toBe(false);
    expect(assembled.pruned).toBe(false);
    expect(assembled.latencyRoute).toEqual({
      anchorPresent: false,
      capSpans: 0,
      capPre: 0,
      capPost: 0,
      shippedRows: 0,
      cappedRows: 0,
      wholeFileRows: 0,
    });
    expect(assembled.benchCase.edgeLatency).toEqual([]);
    expect(assembled.benchCase.failedTraceEdges).toEqual([]);
    // A missing `inject_time.txt` degrades to 0 rather than throwing, and the case keeps its metrics.
    expect(assembled.benchCase.injectTime).toBe(0);
    expect(assembled.benchCase.traceActivity).toBeUndefined();
    expect(assembled.benchCase.metrics.size).toBeGreaterThan(0);
  });
});
