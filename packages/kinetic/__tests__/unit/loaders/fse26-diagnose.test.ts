/**
 * Unit tests for the FSE'26 diagnostic formatter.
 *
 * Covers deterministic service ordering, ground-truth and prediction markers,
 * metric-name listing, non-finite guard, message truncation, and the empty
 * case. The formatter is pure, so the tests assert exact output lines.
 *
 * @module __tests__/unit/loaders/fse26-diagnose.test
 */

import { describe, expect, it } from 'vitest';

import type {
  FSE26DiagnosticInput,
  FSE26DiagnosticService,
} from '../../../src/benchmarks/fse26-diagnose.js';
import { formatFSE26Diagnostic } from '../../../src/benchmarks/fse26-diagnose.js';

function service(overrides: Partial<FSE26DiagnosticService>): FSE26DiagnosticService {
  return {
    serviceId: 'ts-order-service',
    metricNames: ['container.cpu.usage', 'container.memory.usage'],
    dominantMetric: 'container.cpu.usage',
    selfAnomaly: 0.5,
    logScore: 0,
    errorCount: 0,
    fatalCount: 0,
    logicExceptionCount: 0,
    httpExceptionCount: 0,
    sampleErrorMessages: [],
    exceptionClasses: [],
    ...overrides,
  };
}

function input(overrides: Partial<FSE26DiagnosticInput>): FSE26DiagnosticInput {
  return {
    datapack: 'ts5-ts-order-service-stress-svfvxk',
    faultType: 'JVMMemoryStress',
    groundTruthServices: ['ts-order-service'],
    services: [],
    topPredictions: [],
    logSignalMode: 'logicHttp',
    ...overrides,
  };
}

describe('formatFSE26Diagnostic', () => {
  it('renders the header with ground truth and service count', () => {
    const out = formatFSE26Diagnostic(input({}));
    expect(out).toContain(
      'DIAG datapack=ts5-ts-order-service-stress-svfvxk faultType=JVMMemoryStress ' +
        'GT=[ts-order-service] services=0',
    );
    expect(out).toContain('prediction=[]');
  });

  it('names the log-signal mode the counts were gated by', () => {
    // The `logic` and `http` counts are mode-dependent, so the block has to say
    // which mode produced it or it cannot be read after being lifted out of a log.
    expect(formatFSE26Diagnostic(input({}))).toContain('logMode=logicHttp');
    expect(formatFSE26Diagnostic(input({ logSignalMode: 'count' }))).toContain('logMode=count');
  });

  it('sorts services by self-anomaly descending, then service id ascending', () => {
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({ serviceId: 'ts-basic-service', selfAnomaly: 0.2 }),
          service({ serviceId: 'ts-order-service', selfAnomaly: 0.9 }),
          service({ serviceId: 'ts-auth-service', selfAnomaly: 0.9 }),
        ],
      }),
    );
    // Service lines start with two spaces; the header/GT lines are excluded so
    // `indexOf` cannot collide with the ground-truth list in the header.
    const serviceLines = out
      .split('\n')
      .filter((line) => line.startsWith('  ts-'))
      .map((line) => line.slice(2).split(' ')[0]!);
    // ts-order-service and ts-auth-service tie at 0.9 → service id ascending
    // (auth before order); ts-basic-service (0.2) sorts last.
    expect(serviceLines).toEqual(['ts-auth-service', 'ts-order-service', 'ts-basic-service']);
  });

  it('tags ground-truth services and top predictions with markers', () => {
    const out = formatFSE26Diagnostic(
      input({
        groundTruthServices: ['ts-order-service'],
        services: [service({ serviceId: 'ts-order-service', selfAnomaly: 0.7 })],
        topPredictions: ['ts-basic-service', 'ts-order-service'],
      }),
    );
    // The ground-truth service is the #2 prediction, so it carries both markers.
    expect(out).toContain('ts-order-service [GT,#2]');
  });

  it('lists metric names and the dominant metric on the service line', () => {
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({
            serviceId: 'ts-order-service',
            metricNames: ['container.cpu.usage', 'container.memory.usage'],
            dominantMetric: 'container.memory.usage',
            selfAnomaly: 0.42,
            logScore: 0.5,
          }),
        ],
      }),
    );
    expect(out).toContain('selfAnomaly=0.420 logScore=0.500 dominant=container.memory.usage');
    expect(out).toContain('metrics(2): container.cpu.usage,container.memory.usage');
  });

  it('renders a dash for an absent dominant metric', () => {
    const out = formatFSE26Diagnostic(
      input({ services: [service({ dominantMetric: undefined, selfAnomaly: 0 })] }),
    );
    expect(out).toContain('dominant=-');
  });

  it('renders error counts and truncated sample messages', () => {
    const longMessage = 'x'.repeat(200);
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({
            serviceId: 'ts-order-service',
            selfAnomaly: 0.1,
            errorCount: 3,
            fatalCount: 1,
            logicExceptionCount: 2,
            sampleErrorMessages: [longMessage],
          }),
        ],
      }),
    );
    expect(out).toContain('err=3 fatal=1 logic=2');
    // Truncated to 160 chars + ellipsis.
    expect(out).toContain(`ERR: ${'x'.repeat(160)}…`);
  });

  it('renders the framework-HTTP exception count on the service line', () => {
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({
            serviceId: 'ts-basic-service',
            selfAnomaly: 0.1,
            errorCount: 1560,
            logicExceptionCount: 0,
            httpExceptionCount: 1560,
          }),
        ],
      }),
    );
    // err/logic/http are all rendered on the single service line, so the count
    // is directly observable (distinct from `err` and `logic`).
    expect(out).toContain('err=1560 fatal=0 logic=0 http=1560');
  });

  it('leaves a short sample message untruncated', () => {
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({
            serviceId: 'ts-order-service',
            selfAnomaly: 0.1,
            sampleErrorMessages: ['Connection refused'],
          }),
        ],
      }),
    );
    expect(out).toContain('ERR: Connection refused');
  });

  it('renders the distinct exception classes and omits the line when empty', () => {
    const withClasses = formatFSE26Diagnostic(
      input({
        services: [
          service({
            serviceId: 'ts-basic-service',
            selfAnomaly: 0.1,
            exceptionClasses: ['HttpClientErrorException', 'HttpServerErrorException'],
          }),
          service({ serviceId: 'ts-order-service', selfAnomaly: 0.05, exceptionClasses: [] }),
        ],
      }),
    );
    expect(withClasses).toContain('exc(2): HttpClientErrorException,HttpServerErrorException');
    // Only the service WITH exception classes emits an exc line — the empty one
    // contributes nothing, so exactly one exc line exists in the whole output.
    expect(withClasses.split('exc(').length - 1).toBe(1);
  });

  it('guards against non-finite self-anomaly values', () => {
    const out = formatFSE26Diagnostic(input({ services: [service({ selfAnomaly: Number.NaN })] }));
    expect(out).toContain('selfAnomaly=nonfinite');
  });

  it('renders the full prediction list in rank order', () => {
    const out = formatFSE26Diagnostic(
      input({ topPredictions: ['ts-basic-service', 'ts-order-service', 'ts-auth-service'] }),
    );
    expect(out).toContain('prediction=[ts-basic-service, ts-order-service, ts-auth-service]');
  });

  it('keeps the first rank for a duplicate prediction', () => {
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({ serviceId: 'ts-order-service', selfAnomaly: 0.9 }),
          service({ serviceId: 'ts-basic-service', selfAnomaly: 0.2 }),
        ],
        topPredictions: ['ts-basic-service', 'ts-basic-service', 'ts-order-service'],
      }),
    );
    // The duplicate second occurrence is ignored; ts-basic-service stays #1.
    expect(out).toContain('ts-basic-service [#1]');
  });

  it('tie-breaks a reversed two-service tie by service id ascending', () => {
    const out = formatFSE26Diagnostic(
      input({
        groundTruthServices: [],
        services: [
          service({ serviceId: 'ts-order-service', selfAnomaly: 0.5 }),
          service({ serviceId: 'ts-auth-service', selfAnomaly: 0.5 }),
        ],
      }),
    );
    const serviceLines = out
      .split('\n')
      .filter((line) => line.startsWith('  ts-'))
      .map((line) => line.slice(2).split(' ')[0]!);
    expect(serviceLines).toEqual(['ts-auth-service', 'ts-order-service']);
  });

  it('tie-breaks an already-sorted two-service tie without swapping', () => {
    const out = formatFSE26Diagnostic(
      input({
        groundTruthServices: [],
        services: [
          service({ serviceId: 'ts-auth-service', selfAnomaly: 0.5 }),
          service({ serviceId: 'ts-order-service', selfAnomaly: 0.5 }),
        ],
      }),
    );
    const serviceLines = out
      .split('\n')
      .filter((line) => line.startsWith('  ts-'))
      .map((line) => line.slice(2).split(' ')[0]!);
    expect(serviceLines).toEqual(['ts-auth-service', 'ts-order-service']);
  });
});

describe('formatFSE26Diagnostic — metric competition', () => {
  it('renders the metric competition for a ground-truth service', () => {
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({
            metricOutcomes: [
              { label: 'container.memory.rss', outcome: 'kept', score: 0.412 },
              { label: 'jvm.memory.used', outcome: 'transient-return', score: 0 },
            ],
          }),
        ],
      }),
    );

    expect(out).toContain('metricKept(1): container.memory.rss=0.412');
    expect(out).toContain('metricDrop(1): jvm.memory.used:transient-return');
  });

  it('renders the metric competition for a predicted service', () => {
    const out = formatFSE26Diagnostic(
      input({
        groundTruthServices: ['ts-some-other-service'],
        topPredictions: ['ts-order-service'],
        services: [service({ metricOutcomes: [{ label: 'http', outcome: 'kept', score: 1 }] })],
      }),
    );

    expect(out).toContain('metricKept(1): http=1.000');
  });

  it('omits the metric competition for a service that is neither ground truth nor predicted', () => {
    // 51 services carry ~70 metrics each; rendering the competition for all of
    // them would multiply the dump by an order of magnitude for rows nothing
    // reads. The bound is part of the contract, so it is pinned here.
    const out = formatFSE26Diagnostic(
      input({
        groundTruthServices: ['ts-elsewhere'],
        topPredictions: ['ts-also-elsewhere'],
        services: [
          service({
            serviceId: 'ts-bystander',
            metricOutcomes: [{ label: 'http', outcome: 'kept', score: 1 }],
          }),
        ],
      }),
    );

    expect(out).not.toContain('metricKept');
    expect(out).not.toContain('metricDrop');
  });

  it('omits the metric competition when the caller supplied no outcomes', () => {
    // An engine that does not report metric diagnostics must produce exactly the
    // block it produced before, so the addition stays purely additive.
    const out = formatFSE26Diagnostic(input({ services: [service({})] }));

    expect(out).not.toContain('metricKept');
    expect(out).not.toContain('metricDrop');
  });

  it('states zero counts rather than omitting the lines for an empty inventory', () => {
    // "the dataset carries no metrics for this service" and "this service was
    // never examined" are different findings; only the lines' presence separates
    // them, so an empty inventory still renders.
    const out = formatFSE26Diagnostic(input({ services: [service({ metricOutcomes: [] })] }));

    expect(out).toContain('metricKept(0):');
    expect(out).toContain('metricDrop(0):');
  });

  it('orders kept metrics by score descending then label ascending', () => {
    // Both input orders, because a small-array sort is free to call the
    // comparator in either direction and only one order exercises both arms of
    // the score-then-label chain.
    const outcomes = [
      { label: 'z-low', outcome: 'kept' as const, score: 0.1 },
      { label: 'a-high', outcome: 'kept' as const, score: 0.9 },
      { label: 'b-high', outcome: 'kept' as const, score: 0.9 },
    ];

    for (const order of [outcomes, [...outcomes].reverse()]) {
      const out = formatFSE26Diagnostic(input({ services: [service({ metricOutcomes: order })] }));
      expect(out).toContain('metricKept(3): a-high=0.900 b-high=0.900 z-low=0.100');
    }
  });

  it('orders dropped metrics by label ascending with their reason', () => {
    const outcomes = [
      { label: 'zeta', outcome: 'too-few-samples' as const, score: 0 },
      { label: 'alpha', outcome: 'duty-cycled-idle' as const, score: 0 },
    ];

    for (const order of [outcomes, [...outcomes].reverse()]) {
      const out = formatFSE26Diagnostic(input({ services: [service({ metricOutcomes: order })] }));
      expect(out).toContain('metricDrop(2): alpha:duty-cycled-idle zeta:too-few-samples');
    }
  });
});

describe('formatFSE26Diagnostic — anomaly shape', () => {
  const breakdown = {
    deviation: 3.203,
    trend: 0.04,
    cv: 0.048,
    burst: 0,
    riseRatio: 1954.3,
    dropRatio: 0.02,
    baselineMean: 0.0017,
  };

  it('renders the decomposition of the metrics that decided the service score', () => {
    // The score alone cannot say whether a metric won on a genuine deviation or
    // on a bonus, nor how large its rise was. Anomaly scores are unbounded in
    // the RISE direction only, so the rise is what has to be visible.
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({
            metricOutcomes: [
              {
                label: 'hubble_http_request_duration_p99_seconds',
                outcome: 'kept',
                score: 3.291,
                breakdown,
              },
              {
                label: 'container.cpu.usage',
                outcome: 'kept',
                score: 0.358,
                breakdown: { ...breakdown, deviation: 0.35, riseRatio: 1.24, baselineMean: 0.42 },
              },
            ],
          }),
        ],
      }),
    );

    expect(out).toContain(
      'metricTop(2): hubble_http_request_duration_p99_seconds=3.291' +
        '{dev=3.203,trend=0.040,cv=0.048,burst=0.000,rise=1.954e+3,drop=0.02,base=1.700e-3} ' +
        'container.cpu.usage=0.358' +
        '{dev=0.350,trend=0.040,cv=0.048,burst=0.000,rise=1.24,drop=0.02,base=4.200e-1}',
    );
  });

  it('renders only the breakdowns it has, and states the count it rendered', () => {
    // A kept outcome the caller reported without a decomposition must not be
    // printed as if it had one, and the count has to say how many of the kept
    // metrics carry a decomposition so a partial render is detectable.
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({
            metricOutcomes: [
              { label: 'a', outcome: 'kept', score: 0.9, breakdown },
              { label: 'b', outcome: 'kept', score: 0.5 },
            ],
          }),
        ],
      }),
    );

    expect(out).toContain('metricTop(1/2): a=0.900{');
    expect(out).not.toContain(' b=0.500{');
  });

  it('omits the shape line when no kept metric carries a decomposition', () => {
    const out = formatFSE26Diagnostic(
      input({
        services: [service({ metricOutcomes: [{ label: 'a', outcome: 'kept', score: 1 }] })],
      }),
    );

    expect(out).not.toContain('metricTop');
  });

  it('does not render the shape line for a service that is neither ground truth nor predicted', () => {
    const out = formatFSE26Diagnostic(
      input({
        groundTruthServices: ['ts-elsewhere'],
        topPredictions: ['ts-also-elsewhere'],
        services: [
          service({
            serviceId: 'ts-bystander',
            metricOutcomes: [{ label: 'a', outcome: 'kept', score: 1, breakdown }],
          }),
        ],
      }),
    );

    expect(out).not.toContain('metricTop');
  });

  it('survives a non-finite decomposition value rather than printing NaN', () => {
    const render = (patch: Partial<typeof breakdown>): string =>
      formatFSE26Diagnostic(
        input({
          services: [
            service({
              metricOutcomes: [
                { label: 'a', outcome: 'kept', score: 1, breakdown: { ...breakdown, ...patch } },
              ],
            }),
          ],
        }),
      );

    const infinite = render({ riseRatio: Number.POSITIVE_INFINITY });
    expect(infinite).not.toContain('Infinity');
    expect(infinite).toContain('rise=nonfinite');

    // A baseline is the one value whose exact zero and whose non-finite cases
    // are both reachable: an exact-zero row (the metric never moved off zero)
    // and a NaN from a degenerate series.
    expect(render({ baselineMean: 0 })).toContain('base=0');
    expect(render({ baselineMean: Number.NaN })).not.toContain('NaN');
    expect(render({ baselineMean: Number.NaN })).toContain('base=nonfinite');
  });

  it('declares the entries it printed when the kept list is longer than the render', () => {
    // The declaration is a count of what FOLLOWS on the line. Declaring the kept
    // count instead asserts entries that were never printed, which is exactly
    // what a truncated line looks like — and the reader rejects those, so the
    // whole line became unreadable whenever a service carried more kept metrics
    // than the render shows. Every fixture in this suite had at most three, so
    // 100% line and branch coverage did not see it.
    const entry = (label: string, score: number) => ({
      label,
      outcome: 'kept' as const,
      score,
      breakdown,
    });
    const out = formatFSE26Diagnostic(
      input({
        services: [
          service({
            metricOutcomes: [entry('a', 0.9), entry('b', 0.8), entry('c', 0.7), entry('d', 0.6)],
          }),
        ],
      }),
    );

    expect(out).toContain('metricTop(3/4): a=0.900{');
    expect(out).not.toContain('d=0.600{');
  });

  it('orders the shape line by score then label, in either comparator order', () => {
    const entry = (label: string, score: number) => ({
      label,
      outcome: 'kept' as const,
      score,
      breakdown,
    });
    const outcomes = [entry('z-flat', 0.9), entry('a-flat', 0.9), entry('m-low', 0.1)];

    for (const order of [outcomes, [...outcomes].reverse()]) {
      const out = formatFSE26Diagnostic(input({ services: [service({ metricOutcomes: order })] }));
      expect(out).toContain(
        'metricTop(3): a-flat=0.900{dev=3.203,trend=0.040,cv=0.048,burst=0.000,' +
          'rise=1.954e+3,drop=0.02,base=1.700e-3} ' +
          'z-flat=0.900{dev=3.203,trend=0.040,cv=0.048,burst=0.000,rise=1.954e+3,drop=0.02,base=1.700e-3} ' +
          'm-low=0.100{dev=3.203,trend=0.040,cv=0.048,burst=0.000,rise=1.954e+3,drop=0.02,base=1.700e-3}',
      );
    }
  });
});
