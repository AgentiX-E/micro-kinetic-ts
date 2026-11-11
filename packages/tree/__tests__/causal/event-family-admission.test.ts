/**
 * The event family has more than one consumer, and one of them kept its own copy of the list.
 *
 * `EVENT_METRIC_LABELS` decides which channels the idle guard measures over the post-injection window. It is
 * read through {@link isEventMetric}, and until this file existed there were TWO answers to "is this label a
 * response channel" — `isEventMetric` for the guard, and a literal `lower === 'error'` inside
 * {@link isResponseChannel} for the topological discount.
 *
 * The two spellings of one quantity are what makes the duplication load-bearing. The RCAEval converter calls
 * the rate `error`; the FSE'26 converter derives it from the same spans and calls it
 * `http.response.error_rate`. A node whose DOMINANT channel is the second spelling is not recognised by the
 * literal, so `topoDiscount` at scope `external` skips the caller-side predicate entirely — the caller becomes
 * unexplainable and keeps an anomaly its callee caused. That is a term failing OPEN, and the eight
 * `mysql`-truth cases of iteration 259 are what it costs.
 *
 * These tests state the relation rather than the literal: every member of the family is a response channel,
 * whatever the family happens to contain. A third spelling then cannot reintroduce the defect.
 *
 * @module __tests__/causal/event-family-admission
 */

import type { CallEdge } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';

import { deductExplainedAnomalies } from '../../src/causal/topo-deduction.js';
import {
  EVENT_METRIC_LABELS,
  isEventMetric,
  isResponseChannel,
} from '../../src/causal/topology-fault-graph.js';

/** The FSE'26 spelling of the same quantity the RCAEval converter calls `error`. */
const FSE26_ERROR = 'http.response.error_rate';

describe('isResponseChannel agrees with the event family', () => {
  it('admits every label the family admits, by relation and not by literal', () => {
    // The assertion is over the FAMILY, so admitting a third spelling to `EVENT_METRIC_LABELS` cannot leave a
    // consumer behind. This is the test the defect would have failed.
    for (const label of EVENT_METRIC_LABELS) {
      expect(isEventMetric(label)).toBe(true);
      expect(isResponseChannel(label)).toBe(true);
    }
  });

  it('keeps the shipped literal set intact for the labels the discount was written against', () => {
    // The relation must not become a widening: `delay`, `loss`, `socket` and the latency percentiles were
    // response channels before this change and stay response channels after it.
    for (const label of ['delay', 'loss', 'socket', 'latency-90']) {
      expect(isResponseChannel(label)).toBe(true);
    }
    // And a channel no call boundary transmits is still refused, on both sides of the predicate.
    for (const label of ['container.cpu.usage', 'k8s.pod.memory.usage', 'jvm.gc.duration.max']) {
      expect(isResponseChannel(label)).toBe(false);
    }
  });

  it('refuses the FSE26 duration spelling, and that refusal is MEASURED rather than inherited', () => {
    // The other half of the same defect, and the arm that would fix it loses: `http.server.request.duration.max`
    // and `hubble_http_request_duration_p50_seconds` are the FSE'26 names for the quantity RCAEval calls
    // `latency-90`, so `isLatencyMetric`'s prefix test recognises neither and `topoDiscount` cannot charge a
    // caller on this corpus. Widening the predicate to them was built and measured on the eight datapacks of
    // `docs/topo-discount-scope.md` §8: Top@1 falls 8/8 -> 6/8, with NetworkPartition and NetworkBandwidth both
    // losing a case. Activating the term on this corpus costs more than it gains, so the name stays outside the
    // family and this test is the record of the arm rather than of a preference.
    expect(isResponseChannel('http.server.request.duration.max')).toBe(false);
    expect(isResponseChannel('hubble_http_request_duration_p50_seconds')).toBe(false);
  });

  it('admits a second spelling when the FAMILY it is given contains one', () => {
    // The shipped family does not contain it, and at the shipped configuration the label is not an event
    // channel at all — the defect, stated as the starting condition rather than hidden.
    expect(isEventMetric(FSE26_ERROR)).toBe(false);
    expect(isResponseChannel(FSE26_ERROR)).toBe(false);
    // An admitted family makes both predicates agree, because there is now one rule and two callers.
    const admitted = new Set([...EVENT_METRIC_LABELS, FSE26_ERROR]);
    expect(isResponseChannel(FSE26_ERROR, admitted)).toBe(true);
    expect(isResponseChannel('container.cpu.usage', admitted)).toBe(false);
  });
});

describe('the topological discount can see the spelling it is given', () => {
  /** A caller on the FSE'26 error spelling, calling a callee that is slow. */
  const scenario = (labels: ReadonlySet<string>) => {
    const edges: CallEdge[] = [
      {
        from: 'ts-seat-service',
        to: 'ts-config-service',
        type: 'REST',
        callRate: 60,
        p99Latency: 40,
        errorRate: 0,
      },
    ];
    return deductExplainedAnomalies(
      {
        anomalies: new Map([
          ['ts-seat-service', 1],
          ['ts-config-service', 1],
        ]),
        edges,
        propagationWeights: Float64Array.from([1]),
        dominantMetrics: new Map([
          ['ts-seat-service', { label: FSE26_ERROR }],
          ['ts-config-service', { label: 'latency-99' }],
        ]),
        eventLabels: labels,
      },
      1, // rho
      'external',
      1, // gate: charge only when the callee explains it in full
      'max',
      'off',
    );
  };

  it('leaves the caller unexplained when its dominant label is outside the family it was given', () => {
    // The shipped state, and the defect: `error` is a response channel but its FSE'26 spelling is not, so the
    // caller-side predicate refuses and a caller whose entire rise its callee caused keeps all of it.
    const result = scenario(new Set(EVENT_METRIC_LABELS));
    expect(result.discounted.get('ts-seat-service')).toBe(1);
    expect(result.share.get('ts-seat-service')).toBeUndefined();
  });

  it('deducts the same caller once the family admits its spelling', () => {
    // Same graph, same anomalies, same weights — one channel of difference. `min(a, e) = 1` clears the gate of
    // 1, so the caller falls to zero and its callee keeps everything: the source survives, the victim does not.
    const result = scenario(new Set([...EVENT_METRIC_LABELS, FSE26_ERROR]));
    expect(result.discounted.get('ts-seat-service')).toBe(0);
    expect(result.discounted.get('ts-config-service')).toBe(1);
    expect(result.share.get('ts-seat-service')).toBe(1);
  });
});
