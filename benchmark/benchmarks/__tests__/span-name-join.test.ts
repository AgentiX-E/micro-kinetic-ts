/**
 * The trace file and `metrics.json` are two artefacts of one deployment, and the join between their service
 * names is a MEASURED boundary, not a guess.
 *
 * `RE2:OnlineBoutique` spells the front end `frontendservice` in its spans and `frontend` in its metrics. On
 * all ninety cases of that cell the topology augmenter — which keeps only the edges a span confirms — dropped
 * the seven YAML edges starting at `frontend` and installed four from `frontendservice`, a node with no
 * metrics. Every edge-walking term then reported "no evidence", which is indistinguishable from a quiet
 * corpus. This file pins the repair at the one owner of the join, and pins the pronunciation of its refusals.
 *
 * @module benchmarks/__tests__/span-name-join
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RCAEvalLoader } from '../../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import { assembleRCAEvalCase, traceServiceResolver } from '../src/rcaeval-corpus.js';
import { buildRCAEvalCallGraph } from '../src/rcaeval-topology.js';

const ANCHOR_S = 1_700_000_000;
const us = (secondsFromAnchor: number): string => `${(ANCHOR_S + secondsFromAnchor) * 1_000_000}`;

const METRICS = {
  frontend: [{ timestamp: ANCHOR_S - 60, value: 1, metric_name: 'cpu_usage' }],
  cartservice: [{ timestamp: ANCHOR_S - 60, value: 1, metric_name: 'cpu_usage' }],
};

/** `frontendservice` is the trace spelling of the metric id `frontend`; `cartservice` matches exactly. */
const TRACES = [
  'traceId,spanId,parentSpanId,serviceName,operationName,startTime,duration,response_code',
  `t1,p1,,frontendservice,root,${us(-3)},1,200`,
  `t1,c1,p1,cartservice,work,${us(-1)},10,200`,
  `t1,c2,p1,cartservice,work,${us(1)},500,500`,
  `t1,c3,p1,adservice,serve,${us(1)},5,200`,
  '',
].join('\n');

const dirs: string[] = [];

function writeCase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcaeval-join-'));
  dirs.push(dir);
  const casePath = path.join(dir, 'rcaeval-re2_frontend_cpu_1');
  fs.mkdirSync(casePath);
  fs.writeFileSync(path.join(casePath, 'metrics.json'), JSON.stringify(METRICS));
  fs.writeFileSync(path.join(casePath, 'inject_time.txt'), String(ANCHOR_S));
  fs.writeFileSync(path.join(casePath, 'traces.csv'), TRACES);
  return casePath;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('traceServiceResolver', () => {
  it('resolves an exact id to itself', () => {
    const resolve = traceServiceResolver(['frontend', 'currencyservice']);
    expect(resolve('frontend')).toBe('frontend');
    expect(resolve('currencyservice')).toBe('currencyservice');
  });

  it('resolves a name the metric id only differs from by case and punctuation', () => {
    const resolve = traceServiceResolver(['front-end', 'ts-auth-service']);
    expect(resolve('front_end')).toBe('front-end');
    expect(resolve('FrontEnd')).toBe('front-end');
    expect(resolve('TS.Auth.Service')).toBe('ts-auth-service');
  });

  it('resolves a name that only adds a trailing `service` token', () => {
    const resolve = traceServiceResolver(['frontend', 'checkoutservice', 'ts-order-service']);
    expect(resolve('frontendservice')).toBe('frontend');
    expect(resolve('checkout-service')).toBe('checkoutservice');
    expect(resolve('ts-order-service')).toBe('ts-order-service');
  });

  it('refuses a name that matches nothing', () => {
    const resolve = traceServiceResolver(['frontend', 'cartservice']);
    expect(resolve('adservice')).toBeUndefined();
    expect(resolve('')).toBeUndefined();
  });

  it('refuses a spelling two different ids claim', () => {
    // `front-end` and `front_end` are two distinct measured nodes whose normalised spellings coincide.
    // Picking one would attribute another node's spans to it, which is the failure this join exists to avoid.
    const resolve = traceServiceResolver(['front-end', 'front_end']);
    expect(resolve('frontend')).toBeUndefined();
    // An exact id is still an exact id: ambiguity is a property of the NORMALISED key, not of the input.
    expect(resolve('front-end')).toBe('front-end');
  });

  it('is empty-safe: no ids means nothing resolves', () => {
    expect(traceServiceResolver([])('frontend')).toBeUndefined();
  });

  it('does not reinterpret a name by stripping a token the id itself needs', () => {
    const resolve = traceServiceResolver(['currencyservice']);
    expect(resolve('currency')).toBeUndefined();
    expect(resolve('currencyservice')).toBe('currencyservice');
  });
});

describe('the corpus owner joins the two vocabularies', () => {
  it("keeps the graph in the case's own id space and reports what the join did", async () => {
    const dir = writeCase();
    const loader = new RCAEvalLoader();
    const rawCase = loader.loadCase(dir);
    const graph = buildRCAEvalCallGraph(rawCase.benchmark, Object.keys(rawCase.metrics));
    const assembled = await assembleRCAEvalCase(
      loader,
      rawCase,
      { suite: 'RE2', dirPath: dir },
      graph,
      'rcaeval-re2',
      { augmentFromTraces: true, traceActivity: false, latencyFrom: 'whole-file' },
    );

    // ONE assertion for the phantom: every endpoint of every edge is a service the case measures.
    const metricIds = new Set(Object.keys(METRICS));
    expect(
      assembled.callGraph.edges.filter((e) => !metricIds.has(e.from) || !metricIds.has(e.to)),
    ).toEqual([]);
    // And the observed call survives, which is what the other vocabulary destroyed.
    expect(assembled.callGraph.edges.map((e) => `${e.from}>${e.to}`)).toContain(
      'frontend>cartservice',
    );
    expect(assembled.spanServices).toEqual({ total: 4, renamed: 1, dropped: 1 });
    // The direction channel reads the same reconciled names, so the failing call is on edge `frontend>...`
    // and not on an edge whose caller nothing can rank.
    expect(assembled.benchCase.failedTraceEdges).toEqual([
      { caller: 'frontend', callee: 'cartservice', failed: 1, baseline: 0 },
    ]);
    expect(assembled.latencyViews['whole-file']).toEqual([
      { caller: 'frontend', callee: 'cartservice', preMeanMs: 10, postMeanMs: 500 },
    ]);
  });

  it('reports a case whose spans need no join as unchanged, not as repaired', async () => {
    const dir = writeCase();
    const exact = path.join(path.dirname(dir), 'rcaeval-re2_cartservice_cpu_1');
    fs.mkdirSync(exact);
    fs.copyFileSync(path.join(dir, 'metrics.json'), path.join(exact, 'metrics.json'));
    fs.copyFileSync(path.join(dir, 'inject_time.txt'), path.join(exact, 'inject_time.txt'));
    fs.writeFileSync(
      path.join(exact, 'traces.csv'),
      TRACES.split('\n')
        .map((line) => line.replace('frontendservice', 'frontend'))
        .filter((line) => !line.includes('adservice'))
        .join('\n'),
    );

    const loader = new RCAEvalLoader();
    const rawCase = loader.loadCase(exact);
    const graph = buildRCAEvalCallGraph(rawCase.benchmark, Object.keys(rawCase.metrics));
    const assembled = await assembleRCAEvalCase(
      loader,
      rawCase,
      { suite: 'RE2', dirPath: exact },
      graph,
      'rcaeval-re2',
      { augmentFromTraces: true, traceActivity: false, latencyFrom: 'whole-file' },
    );

    expect(assembled.spanServices).toEqual({ total: 3, renamed: 0, dropped: 0 });
  });

  it('leaves a case with no traces exactly as it found it', async () => {
    const dir = writeCase();
    const bare = path.join(path.dirname(dir), 'rcaeval-re2_cartservice_mem_1');
    fs.mkdirSync(bare);
    fs.copyFileSync(path.join(dir, 'metrics.json'), path.join(bare, 'metrics.json'));
    fs.copyFileSync(path.join(dir, 'inject_time.txt'), path.join(bare, 'inject_time.txt'));

    const loader = new RCAEvalLoader();
    const rawCase = loader.loadCase(bare);
    const graph = buildRCAEvalCallGraph(rawCase.benchmark, Object.keys(rawCase.metrics));
    const assembled = await assembleRCAEvalCase(
      loader,
      rawCase,
      { suite: 'RE2', dirPath: bare },
      graph,
      'rcaeval-re2',
      { augmentFromTraces: true, traceActivity: false, latencyFrom: 'whole-file' },
    );

    expect(assembled.traceUsed).toBe(false);
    expect(assembled.spanServices).toEqual({ total: 0, renamed: 0, dropped: 0 });
    expect(assembled.callGraph.edges).toEqual(graph.edges);
  });
});
