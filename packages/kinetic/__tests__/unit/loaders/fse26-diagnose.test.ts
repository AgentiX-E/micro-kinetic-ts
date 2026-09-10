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
