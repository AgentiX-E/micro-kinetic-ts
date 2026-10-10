/**
 * Guards on the directional evidence the RCAEval loader never built.
 *
 * ## What is being guarded
 *
 * Two observables derived from a case's own traces — inbound failed mass and inbound latency rise — and the
 * direction they carry (the CALLEE is the service the calls were made about). The FSE'26 side has had both for
 * a while (`FaultFailedEdge`, `FaultEdgeLatency`); the RCAEval side has neither, so the network-class misses
 * that iteration 59 attributed to `loss` could not be measured there at all.
 *
 * The fences below are about the DERIVATION, because a derivation that credits the wrong side would make the
 * whole reading backwards while looking plausible — which is the failure mode a census of misses cannot show.
 *
 * @module benchmarks/__tests__/directional-evidence
 */

import * as fs from 'node:fs';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { FaultFailedEdge } from '../../packages/core/src/interfaces/rca-engine.js';
import { countDirectionalInputs } from '../../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import type { BenchmarkTraceSpan } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { computeFailedEdgeScores } from '../../packages/tree/src/pruning/ranking-signals.js';
import {
  formatDirectionalCoverage,
  formatDirectionalEvidence,
  formatEvidenceSeparation,
  readDirectionalEvidence,
  readEvidenceSeparation,
  summarizeDirectionalCoverage,
  toEngineDirectionalInputs,
  type DirectionalReading,
} from '../src/directional-evidence.js';

const AT = 1_000_000;

interface SpanSpec {
  readonly id: string;
  readonly service: string;
  readonly parent?: string;
  readonly before?: boolean;
  readonly ms?: number;
  readonly status?: 'OK' | 'ERROR';
}

/** Build spans around the injection at {@link AT}; `before` places them 1000 ms earlier. */
function spans(specs: readonly SpanSpec[]): BenchmarkTraceSpan[] {
  return specs.map((s) => ({
    traceId: 't',
    spanId: s.id,
    ...(s.parent === undefined ? {} : { parentSpanId: s.parent }),
    service: s.service,
    operationName: 'op',
    startTime: s.before === true ? AT - 1000 : AT + 1000,
    duration: s.ms ?? 10,
    status: s.status ?? 'OK',
  }));
}

/** A case whose `api` service is called by `front`, with `api`'s inbound edge misbehaving. */
const caseWith = (specs: readonly SpanSpec[]) => ({
  caseId: 're2ob_orders_loss_1',
  stratum: 're2ob:RE2:loss',
  injectTimeMs: AT,
  traces: spans(specs),
});

describe('the directional evidence, derived from traces', () => {
  it('credits the CALLEE, which is the direction the other signals lack', () => {
    // `front` calls `api`, and it is `api` that starts failing. A signal that credited the caller would name
    // `front` — the victim that emitted the errors — and be exactly backwards.
    const r = readDirectionalEvidence(
      caseWith([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'api', parent: 'a', status: 'ERROR' },
        { id: 'c', service: 'api', parent: 'a', status: 'ERROR' },
      ]),
    );
    expect(r.edges).toBe(1);
    expect(r.failedTop1).toBe('api');
    expect(r.services.find((s) => s.service === 'api')?.failedMass).toBe(2);
  });

  it('subtracts the pre-injection baseline, so a merely noisy edge is not credited', () => {
    // The baseline is what distinguishes a fault from background noise: an edge that failed twice before and
    // twice after has RISEN by nothing, and counting it would credit a service the injection did not touch.
    const noisy = readDirectionalEvidence(
      caseWith([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'api', parent: 'a', status: 'ERROR', before: true },
        { id: 'c', service: 'api', parent: 'a', status: 'ERROR', before: true },
        { id: 'd', service: 'api', parent: 'a', status: 'ERROR' },
        { id: 'e', service: 'api', parent: 'a', status: 'ERROR' },
      ]),
    );
    expect(
      noisy.services.find((s) => s.service === 'api')?.failedMass,
      'no rise over baseline',
    ).toBe(0);
    // With no rise the channel has no top-1 at all, which is reported as unmeasured rather than as a miss.
    expect(noisy.failedTop1).toBeUndefined();
  });

  it('reads the latency rise from the SAME direction, and skips an edge with no baseline', () => {
    // A call that became slow but still succeeded is invisible to the failure channel — which is why the
    // duration channel exists. But a rise needs both sides: an edge that only exists after the injection has no
    // baseline, and treating one as 1.0 would invent a rise for it.
    const r = readDirectionalEvidence(
      caseWith([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'api', parent: 'a', before: true, ms: 10 },
        { id: 'c', service: 'api', parent: 'a', ms: 50 },
        { id: 'd', service: 'api2', parent: 'a', ms: 999 },
      ]),
    );
    expect(r.latencyTop1).toBe('api');
    expect(r.services.find((s) => s.service === 'api')?.latencyRise).toBeCloseTo(5, 6);
    expect(r.services.find((s) => s.service === 'api2')?.latencyRise, 'no baseline').toBe(0);
  });

  it('treats a root span as establishing no edge, and keeps a self-edge', () => {
    // A span with no parent in the same traces has no caller, so nothing can be said about its direction; a
    // service calling itself is a real call with an unambiguous direction and must not be dropped.
    const r = readDirectionalEvidence(
      caseWith([
        { id: 'root', service: 'gateway' },
        { id: 'self', service: 'api', parent: 'self', status: 'ERROR' },
      ]),
    );
    expect(r.edges).toBe(1);
    expect(r.failedTop1).toBe('api');
    // `gateway` owns only a ROOT span, so no edge points AT it and it has no directional evidence at all. It is
    // therefore ABSENT rather than present-with-zero: a zero would read as "measured, and clean", which is a
    // stronger claim than "nothing was measured about it".
    expect(r.services.find((s) => s.service === 'gateway')).toBeUndefined();
    expect(r.services.map((s) => s.service)).toEqual(['api']);
  });

  it('is deterministic, and says so when there are no traces instead of guessing', () => {
    const withTraces = [
      { id: 'a', service: 'f1' },
      { id: 'b', service: 'z1', parent: 'a', status: 'ERROR' as const },
      { id: 'c', service: 'a1', parent: 'a', status: 'ERROR' as const },
    ];
    const one = readDirectionalEvidence(caseWith(withTraces));
    const two = readDirectionalEvidence(caseWith([...withTraces].reverse()));
    // Equal `failedMass` is broken by name, so a diff between two runs is about a change rather than about the
    // order the spans arrived in.
    expect(one.failedTop1).toBe('a1');
    expect(two.failedTop1).toBe('a1');
    expect(one.services).toEqual(two.services);

    const empty = readDirectionalEvidence({ ...caseWith([]), traces: undefined });
    expect(empty.spans).toBe(0);
    expect(empty.failedTop1).toBeUndefined();
    expect(empty.latencyTop1).toBeUndefined();
    expect(empty.services).toEqual([]);
  });
});

describe('the separation reading, on the cases the engine gets wrong', () => {
  const readings: DirectionalReading[] = [
    // Three `loss` misses: the channel names the true source in two of them.
    readDirectionalEvidence({
      caseId: 'l1',
      stratum: 're2ob:RE2:loss',
      injectTimeMs: AT,
      traces: spans([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'orders', parent: 'a', status: 'ERROR' },
      ]),
    }),
    readDirectionalEvidence({
      caseId: 'l2',
      stratum: 're2tt:RE2:loss',
      injectTimeMs: AT,
      traces: spans([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'orders', parent: 'a', status: 'ERROR' },
      ]),
    }),
    readDirectionalEvidence({
      caseId: 'l3',
      stratum: 're2ss:RE2:loss',
      injectTimeMs: AT,
      traces: spans([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'orders', parent: 'a', status: 'ERROR' },
      ]),
    }),
    // A `disk` case, so the population filter has something to exclude.
    readDirectionalEvidence({
      caseId: 'd1',
      stratum: 're1ob:RE1:disk',
      injectTimeMs: AT,
      traces: spans([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'orders', parent: 'a', status: 'ERROR' },
      ]),
    }),
  ];
  const truth: Record<string, string> = { l1: 'orders', l2: 'orders', l3: 'cart', d1: 'orders' };
  const engine: Record<string, string> = { l1: 'front', l2: 'front', l3: 'front', d1: 'front' };

  it('counts only the cases inside the population AND measurable, and rates over the misses', () => {
    // `all` sees four cases, all measurable, all missed by the engine, and the channel names the truth in
    // three. `loss` sees three, of which two are fixed — so the two populations are NOT the same reading and
    // the line has to say which one it is.
    const all = readEvidenceSeparation(
      readings,
      (id) => truth[id],
      (id) => engine[id],
      (id) => readings.find((r) => r.caseId === id)!.stratum,
      '',
      'failedMass',
    );
    expect(all.population).toBe('all');
    expect(all.measurable).toBe(4);
    expect(all.engineMisses).toBe(4);
    expect(all.channelFixable).toBe(3);
    expect(all.auc).toBeCloseTo(0.75, 6);

    const loss = readEvidenceSeparation(
      readings,
      (id) => truth[id],
      (id) => engine[id],
      (id) => readings.find((r) => r.caseId === id)!.stratum,
      'loss',
      'failedMass',
    );
    expect(loss.measurable).toBe(3);
    expect(loss.engineMisses).toBe(3);
    expect(loss.channelFixable).toBe(2);
  });

  it('keeps an unmeasured case out of the rate rather than counting it as a loss', () => {
    // A case whose traces carry no failing edge is not evidence against the channel; it is unmeasured, and
    // counting it as a miss would let a data-availability problem read as a wrong hypothesis.
    const withUnmeasured = [
      ...readings,
      readDirectionalEvidence({
        caseId: 'l4',
        stratum: 're2ob:RE2:loss',
        injectTimeMs: AT,
        traces: undefined,
      }),
    ];
    const s = readEvidenceSeparation(
      withUnmeasured,
      (id) => truth[id] ?? 'orders',
      (id) => engine[id] ?? 'front',
      (id) => withUnmeasured.find((r) => r.caseId === id)!.stratum,
      'loss',
      'failedMass',
    );
    expect(s.measurable, 'the untraced case is not measurable').toBe(3);
    expect(s.engineMisses).toBe(3);
  });

  it('applies the pre-registered bar rather than a bar chosen after the reading', () => {
    // `minCases: 10` is the FSE'26 bar and three pairs cannot clear it, so this must NOT report a pass — the
    // repository's standard for a separation claim is a pre-registered bar, not a high ratio on a small n.
    const loss = readEvidenceSeparation(
      readings,
      (id) => truth[id],
      (id) => engine[id],
      (id) => readings.find((r) => r.caseId === id)!.stratum,
      'loss',
      'failedMass',
    );
    expect(loss.meetsBar, '0.667 on 3 pairs is not a separation claim').toBe(false);
    expect(loss.p).toBeDefined();
    // And the bar itself is the repository's, not a second one declared here.
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/directional-evidence.ts'),
      'utf8',
    );
    expect(source).toContain('DEFAULT_SEPARATOR_CRITERION');
    expect(source).toContain('separationPValue');
  });
});

describe('the evidence report states its availability before its rate', () => {
  const traced = readDirectionalEvidence({
    caseId: 'c1',
    stratum: 're2ob:RE2:loss',
    injectTimeMs: AT,
    traces: spans([
      { id: 'a', service: 'front' },
      { id: 'b', service: 'orders', parent: 'a', status: 'ERROR' },
    ]),
  });
  const untraced = readDirectionalEvidence({
    caseId: 'c2',
    stratum: 're1ob:RE1:cpu',
    injectTimeMs: AT,
    traces: undefined,
  });

  it("counts traces, edges and each channel's rankability", () => {
    // The FSE'26 side has `failedTraceEdges`; the RCAEval side has traces. So the first question about any rate
    // here is how much of the corpus the derivation could speak about at all, and it is stated first.
    const lines = formatDirectionalEvidence([traced, untraced]);
    expect(lines[0]).toContain('2 cases | with traces=1 | implying an edge=1');
    expect(lines[0]).toContain('failedMass rankable=1');
    // The latency channel is NOT rankable on this corpus: there is no pre-injection span to compare against.
    expect(lines[0]).toContain('latencyRise rankable=0');
  });

  it('names the strata no channel can speak about, instead of quietly rating over the rest', () => {
    const lines = formatDirectionalEvidence([traced, untraced]);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('1 of 2 strata have NO traces at all');
    expect(lines[1]).toContain('re1ob:RE1:cpu(1)');
    // And when every stratum is traced, that line is absent rather than empty.
    const allTraced = formatDirectionalEvidence([traced]);
    expect(allTraced).toHaveLength(1);
  });

  it('prints the pre-registered bar and its requirement on the separation line', () => {
    // `meetsBar` false on a high ratio is the correct outcome, and a line showing only the ratio would invite
    // the opposite reading — so the bar and the pair count it needs are on the line.
    const met = formatEvidenceSeparation({
      channel: 'failedMass',
      population: 'all',
      measurable: 40,
      engineMisses: 30,
      channelFixable: 21,
      auc: 0.7,
      p: 0.02,
      meetsBar: true,
    });
    expect(met).toContain('separation[failedMass|all]');
    expect(met).toContain('channel names the truth=21 (70.0%)');
    expect(met).toContain('p=0.020');
    expect(met).toContain('bar MET');
    expect(met).toContain('needs 0.60 on >=10 pairs');

    const bare = formatEvidenceSeparation({
      channel: 'latencyRise',
      population: 'loss',
      measurable: 3,
      engineMisses: 0,
      channelFixable: 0,
      auc: undefined,
      p: undefined,
      meetsBar: false,
    });
    expect(bare).toContain('(n/a)');
    expect(bare).toContain('p=n/a');
    expect(bare).toContain('bar NOT met');
  });
});

describe('the arms where a reading is NOT counted', () => {
  const one = readDirectionalEvidence({
    caseId: 'c1',
    stratum: 're2ob:RE2:loss',
    injectTimeMs: AT,
    traces: spans([
      { id: 'a', service: 'front' },
      { id: 'b', service: 'orders', parent: 'a', status: 'ERROR' },
    ]),
  });
  const other = readDirectionalEvidence({
    caseId: 'c2',
    stratum: 're1ob:RE1:cpu',
    injectTimeMs: AT,
    traces: spans([
      { id: 'a', service: 'front' },
      { id: 'b', service: 'api', parent: 'a', status: 'ERROR' },
    ]),
  });
  const stratumOf = (id: string): string => (id === 'c1' ? one.stratum : other.stratum);

  it('excludes a case the population filter rejects, rather than rating it inside', () => {
    // The `loss` reading must not contain the `cpu` case: a filter that silently included it would make the
    // two populations the same number wearing different names.
    const loss = readEvidenceSeparation(
      [one, other],
      () => 'orders',
      () => 'front',
      stratumOf,
      'loss',
      'failedMass',
    );
    expect(loss.measurable).toBe(1);
    const cpu = readEvidenceSeparation(
      [one, other],
      () => 'orders',
      () => 'front',
      stratumOf,
      'cpu',
      'failedMass',
    );
    expect(cpu.measurable).toBe(1);
  });

  it('excludes a case the engine got RIGHT, and one whose top-1 the runner could not supply', () => {
    // Both are `continue`s on the same line and both matter: counting the first would make the channel look
    // worse than it is (there was nothing to fix), and counting the second would let a missing reading from
    // the ENGINE read as a miss the channel failed to fix.
    const correct = readEvidenceSeparation(
      [one],
      () => 'orders',
      () => 'orders',
      stratumOf,
      '',
      'failedMass',
    );
    expect(correct.measurable).toBe(1);
    expect(correct.engineMisses, 'the engine was right, so there is no miss to count').toBe(0);
    expect(correct.auc, 'no misses gives no rate rather than a perfect one').toBeUndefined();
    expect(correct.p).toBeUndefined();

    const noTop1 = readEvidenceSeparation(
      [one],
      () => 'orders',
      () => undefined,
      stratumOf,
      '',
      'failedMass',
    );
    expect(noTop1.engineMisses).toBe(0);
  });

  it('reads an edge that exists only BEFORE the injection without inventing an after side', () => {
    // The mirror of the no-baseline case: an edge whose failures and durations are all pre-injection has no
    // AFTER entry at all. Both lookups must fall back to nothing rather than to zero-everything, because a
    // fabricated after-side would read as a rise that never happened.
    const beforeOnly = readDirectionalEvidence(
      caseWith([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'api', parent: 'a', before: true, ms: 10, status: 'ERROR' },
      ]),
    );
    expect(beforeOnly.services.map((s) => s.service)).toEqual(['api']);
    expect(beforeOnly.services[0]!.failedMass).toBe(0);
    expect(beforeOnly.services[0]!.latencyRise).toBe(0);
    expect(beforeOnly.failedTop1).toBeUndefined();
    expect(beforeOnly.latencyTop1).toBeUndefined();
  });

  it('truncates a long list of untraced strata instead of printing 46 of them', () => {
    // The availability line names what no channel can speak about; with 46 untraced strata it must truncate,
    // and the ellipsis is the signal that the list is partial rather than complete.
    const many = Array.from({ length: 10 }, (_, i) =>
      readDirectionalEvidence({
        caseId: `c${i}`,
        stratum: `s${String(i).padStart(2, '0')}:RE1:cpu`,
        injectTimeMs: AT,
        traces: undefined,
      }),
    );
    const lines = formatDirectionalEvidence(many);
    expect(lines[1]).toContain('10 of 10 strata have NO traces at all');
    expect(lines[1]).toContain('…');
    expect(lines[1]!.split(' ').filter((w) => w.includes('(1)')).length).toBe(8);
  });
});

describe('the bridge to the shapes the engine already accepts', () => {
  it("reports the same quantities per EDGE, in the engine's own field names", () => {
    // `FaultFailedEdge` is `{caller, callee, failed, baseline}` and `FaultEdgeLatency` is
    // `{caller, callee, preMeanMs, postMeanMs}` — the shapes the FSE'26 loader produces and the engine reads.
    // Supplying them for RCAEval is the point of the bridge, so the names are asserted rather than assumed.
    const { failedTraceEdges, edgeLatency } = toEngineDirectionalInputs(
      spans([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'orders', parent: 'a', before: true, ms: 10 },
        { id: 'c', service: 'orders', parent: 'a', before: true, status: 'ERROR' },
        { id: 'd', service: 'orders', parent: 'a', ms: 50, status: 'ERROR' },
      ]),
      AT,
    );
    expect(failedTraceEdges).toEqual([
      { caller: 'front', callee: 'orders', failed: 1, baseline: 1 },
    ]);
    expect(edgeLatency).toEqual([
      { caller: 'front', callee: 'orders', preMeanMs: 10, postMeanMs: 50 },
    ]);
  });

  it('omits an edge with no failures and one with no baseline, rather than reporting zeros', () => {
    // An edge whose only spans succeeded has nothing to say about failed calls; an edge that exists only after
    // the injection has no duration baseline. Reporting `failed: 0` or `preMeanMs: 0` would invite the engine to
    // read "measured, and clean" where the truth is "not measured".
    const { failedTraceEdges, edgeLatency } = toEngineDirectionalInputs(
      spans([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'quiet', parent: 'a', ms: 100 },
        { id: 'c', service: 'fresh', parent: 'a', ms: 100 },
      ]),
      AT,
    );
    expect(failedTraceEdges).toEqual([]);
    expect(edgeLatency).toEqual([]);
  });

  it('reports NOTHING when there is no injection anchor, because direction needs one', () => {
    // With `injectTimeMs <= 0` every span would count as "after": the failures would all be post-injection and
    // the baseline would be empty, which reads as a large rise rather than as an absent anchor.
    const noAnchor = toEngineDirectionalInputs(
      spans([
        { id: 'a', service: 'front' },
        { id: 'b', service: 'orders', parent: 'a', status: 'ERROR' },
      ]),
      0,
    );
    expect(noAnchor).toEqual({ failedTraceEdges: [], edgeLatency: [] });
    // And no traces is the same answer as no anchor: nothing to say.
    expect(toEngineDirectionalInputs(undefined, AT)).toEqual({
      failedTraceEdges: [],
      edgeLatency: [],
    });
  });
});

describe('the coverage of the direction channels, which is what makes a zero interpretable', () => {
  // A weighted term whose input is ABSENT contributes exactly zero, and so does one whose input is present
  // but uninformative. Every artifact here reports only the score, so the two are indistinguishable in the
  // output — and `latWeight = 0.561495` multiplied an empty map on every RCAEval run for six iterations
  // while the battery read its zero as a finding about the term.

  const one = (
    failed: number,
    latency: number,
  ): {
    failedTraceEdges?: { caller: string; callee: string; failed: number; baseline: number }[];
    edgeLatency?: { caller: string; callee: string; preMeanMs: number; postMeanMs: number }[];
  } => ({
    failedTraceEdges: Array.from({ length: failed }, (_, i) => ({
      caller: 'a',
      callee: `c${i}`,
      failed: 1,
      baseline: 0,
    })),
    edgeLatency: Array.from({ length: latency }, (_, i) => ({
      caller: 'a',
      callee: `c${i}`,
      preMeanMs: 1,
      postMeanMs: 2,
    })),
  });

  it('counts cases and edges separately, because the two answer different questions', () => {
    // "How many cases have anything to rank with" is a coverage question; "how many edges is that" is a
    // density question. A corpus where one case carries 40 edges and 40 cases carry one each are very
    // different inputs to a max-normalised score.
    const c = summarizeDirectionalCoverage([one(2, 3), one(1, 0), {}]);
    expect(c.cases).toBe(3);
    expect(c.casesWithFailedEdges).toBe(2);
    expect(c.failedEdges).toBe(3);
    expect(c.casesWithLatency).toBe(1);
    expect(c.latencyEdges).toBe(3);
  });

  it('treats an ABSENT field and an EMPTY array the same, since neither is measurable', () => {
    // The loader attaches `[]` on a file with no such column and omits the field on a case it never reached.
    // A count that separated them would report a difference in the data that is only a difference in wiring.
    expect(summarizeDirectionalCoverage([{}])).toEqual(
      summarizeDirectionalCoverage([{ failedTraceEdges: [], edgeLatency: [] }]),
    );
  });

  it('names a STARVED channel instead of printing a zero the reader must interpret', () => {
    // This is the whole point of the line. `edgeLatency 0/204` and `edgeLatency 204/204` with a flat score
    // are opposite findings, and the bare count does not say which; the warning does.
    const starved = formatDirectionalCoverage(
      summarizeDirectionalCoverage([{ failedTraceEdges: one(1, 0).failedTraceEdges }]),
      'rcaeval-re1',
    );
    expect(starved).toContain('direction-coverage[rcaeval-re1]');
    expect(starved).toContain('failedTraceEdges 1/1 cases, 1 edges');
    expect(starved).toContain('edgeLatency 0/1 cases, 0 edges');
    expect(starved).toContain('STARVED: edgeLatency');
    expect(starved, 'singular, not a list').not.toContain('these');
  });

  it('says nothing about starvation when both channels carry rows', () => {
    const line = formatDirectionalCoverage(summarizeDirectionalCoverage([one(1, 1)]), 're3');
    expect(line).not.toContain('STARVED');
  });

  it('names both channels when both are starved, which is the reading the golden half produced', () => {
    // Until this iteration the optimizer artifact reported `with traces=0` for all 204 cases, which is this
    // shape. The line has to be unmistakable rather than a pair of zeros in a longer sentence.
    const line = formatDirectionalCoverage(summarizeDirectionalCoverage([{}, {}]), 're2');
    expect(line).toContain('STARVED: failedTraceEdges, edgeLatency');
    expect(line).toContain('these');
  });
});

describe('the two derivations of the direction inputs agree, because they describe ONE relation', () => {
  // There are two of them for a plumbing reason — one reads a file in a single streaming pass for the runners
  // that drop their spans, the other reads spans a runner still holds — and they must not disagree about what
  // an edge is, because their output is the same case INPUT. The fixtures below are one description rendered
  // two ways, which is the only way to check that.

  interface Planned {
    readonly caller: string;
    readonly callee: string;
    readonly spanId: string;
    readonly at: number;
    readonly ms: number;
    readonly status: 'OK' | 'ERROR';
  }

  /** Jaeger's columns plus `duration`, which is what the streaming half reads. */
  const asCsv = (planned: readonly Planned[]): string[] => {
    const rows = ['traceId,spanId,parentSpanId,serviceName,startTimeMillis,status,duration'];
    for (const p of planned) {
      rows.push(`t1,${p.spanId}c,,${p.caller},${p.at},OK,${p.ms * 100}`);
      rows.push(`t1,${p.spanId}s,${p.spanId}c,${p.callee},${p.at},${p.status},${p.ms}`);
    }
    return rows;
  };

  /** The same calls as spans, the shape the in-memory half reads. */
  const asSpans = (planned: readonly Planned[]): BenchmarkTraceSpan[] =>
    planned.flatMap((p) => [
      {
        traceId: 't1',
        spanId: `${p.spanId}c`,
        parentSpanId: undefined,
        service: p.caller,
        operationName: 'call',
        startTime: p.at,
        duration: p.ms * 100,
        status: 'OK' as const,
      },
      {
        traceId: 't1',
        spanId: `${p.spanId}s`,
        parentSpanId: `${p.spanId}c`,
        service: p.callee,
        operationName: 'handle',
        startTime: p.at,
        duration: p.ms,
        status: p.status,
      },
    ]);

  const CASES: ReadonlyArray<{ readonly name: string; readonly planned: readonly Planned[] }> = [
    {
      name: 'a clean rise on one edge and a fall on another',
      planned: [
        { caller: 'a', callee: 'b', spanId: 's1', at: 100, ms: 10, status: 'OK' },
        { caller: 'a', callee: 'b', spanId: 's2', at: 200, ms: 20, status: 'OK' },
        { caller: 'a', callee: 'b', spanId: 's3', at: 1100, ms: 100, status: 'OK' },
        { caller: 'a', callee: 'c', spanId: 's4', at: 300, ms: 90, status: 'OK' },
        { caller: 'a', callee: 'c', spanId: 's5', at: 1200, ms: 30, status: 'OK' },
      ],
    },
    {
      name: 'a baseline-only edge beside a newly failing one',
      planned: [
        { caller: 'a', callee: 'b', spanId: 's1', at: 200, ms: 10, status: 'ERROR' },
        { caller: 'a', callee: 'b', spanId: 's2', at: 1100, ms: 10, status: 'ERROR' },
        { caller: 'a', callee: 'c', spanId: 's3', at: 150, ms: 10, status: 'ERROR' },
        { caller: 'a', callee: 'c', spanId: 's4', at: 250, ms: 10, status: 'ERROR' },
      ],
    },
    {
      name: 'an edge that appears only after the injection',
      planned: [
        { caller: 'front', callee: 'orders', spanId: 's1', at: 2000, ms: 50, status: 'OK' },
        { caller: 'front', callee: 'orders', spanId: 's2', at: 100, ms: 10, status: 'ERROR' },
      ],
    },
  ];

  for (const { name, planned } of CASES) {
    it(`agrees with the streaming pass on: ${name}`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'directional-'));
      const tracesPath = path.join(dir, 'traces.csv');
      fs.writeFileSync(tracesPath, asCsv(planned).join('\n'));
      const inMemory = toEngineDirectionalInputs(asSpans(planned), 1000);
      return countDirectionalInputs(tracesPath, 1000)
        .then((streamed) => {
          // Field for field and in the same ORDER — both sort by `(caller, callee)` — so a reader diffing
          // the two artifacts of the same corpus is comparing the same sequence.
          expect(streamed.failedTraceEdges).toEqual(inMemory.failedTraceEdges);
          expect(streamed.edgeLatency).toEqual(inMemory.edgeLatency);
        })
        .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
    });
  }

  it('omits a row whose only content is a PRE-EXISTING baseline, in both derivations', () => {
    // This is the rule the in-memory half used to spell as `failed > 0 || baseline > 0`, and the divergence
    // that would have made the two derivations disagree about a case INPUT.
    const planned: readonly Planned[] = [
      { caller: 'a', callee: 'b', spanId: 's1', at: 200, ms: 10, status: 'ERROR' },
      { caller: 'a', callee: 'b', spanId: 's2', at: 250, ms: 10, status: 'ERROR' },
    ];
    expect(toEngineDirectionalInputs(asSpans(planned), 1000).failedTraceEdges).toEqual([]);
  });

  it('and the ENGINE would have discarded such a row anyway, which is why unifying is safe', () => {
    // The safety argument, made executable rather than argued: the one consumer of these rows reads
    // `max(0, failed - baseline)` and skips anything `<= 0`, so a baseline-only row can only ever score zero.
    // Both derivations now omit it, so the arrays agree AND the scores are what they always were.
    const nodes = new Set(['a', 'b']);
    const baselineOnly: FaultFailedEdge[] = [{ caller: 'a', callee: 'b', failed: 0, baseline: 2 }];
    const withBaseline: FaultFailedEdge[] = [{ caller: 'a', callee: 'b', failed: 3, baseline: 2 }];
    expect(computeFailedEdgeScores(baselineOnly, nodes).size).toBe(0);
    expect(computeFailedEdgeScores(withBaseline, nodes).get('b')).toBe(1);
    // And a row where the failures do not exceed the baseline is dropped for the same reason.
    const swamped: FaultFailedEdge[] = [{ caller: 'a', callee: 'b', failed: 2, baseline: 2 }];
    expect(computeFailedEdgeScores(swamped, nodes).size).toBe(0);
  });
});

describe('the separation reading covers both channels', () => {
  // The `latencyRise` arm of the channel ternary: the two channels are selected from the SAME reading, and a
  // guard that exercised only one would leave the other unread — which is how a channel stops being measured.
  const readings: DirectionalReading[] = [
    {
      caseId: 'c1',
      stratum: 're2ob:RE2:loss',
      spans: 4,
      edges: 2,
      services: [],
      failedTop1: 'orders',
      latencyTop1: 'payments',
    },
  ];

  it('reads the channel it was asked for, from one reading', () => {
    const failed = readEvidenceSeparation(
      readings,
      () => 'orders',
      () => 'front',
      () => 'x',
      '',
      'failedMass',
    );
    expect(failed.channelFixable, 'the failed-mass channel names `orders`').toBe(1);
    const latency = readEvidenceSeparation(
      readings,
      () => 'orders',
      () => 'front',
      () => 'x',
      '',
      'latencyRise',
    );
    expect(
      latency.channelFixable,
      'the latency channel names `payments`, which is not the truth',
    ).toBe(0);
    expect(latency.channel).toBe('latencyRise');
    expect(latency.measurable).toBe(1);
  });
});
