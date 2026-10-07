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

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { BenchmarkTraceSpan } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import {
  formatDirectionalEvidence,
  formatEvidenceSeparation,
  readDirectionalEvidence,
  readEvidenceSeparation,
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
