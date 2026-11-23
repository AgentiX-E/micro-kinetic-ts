/**
 * The label census's own tests.
 *
 * The census answers one question and it answers it about the CORPUS rather than about a run: **which measurands
 * does this benchmark publish at all?** Iteration 328 named the duration/status split as the only untested candidate
 * left for the family the witness cannot see, and a split needs a status column to exist. A census that quietly
 * bucketed an unknown family, or that counted a family once per SERVICE rather than once per series, would answer
 * "yes, there is one" — so the properties asserted here are the ones that make a zero mean zero.
 */

import { describe, expect, it } from 'vitest';

import type { CensusRow } from '../src/channel-label-census.js';
import {
  censusRows,
  countLabels,
  renderCensus,
  statusLikeFamilies,
  statusLikeLabel,
} from '../src/channel-label-census.js';
import type { TelemetryMetric } from '../src/query-agent.js';

/** One metric, with only the label the census reads. */
function metric(label: string): TelemetryMetric {
  return {
    label,
    baseline: 0,
    peak: 1,
    delta: 1,
    ratio: 1,
    surprise: 1,
    trough: 0,
    fall: 0,
    peakOffset: 1_000,
  };
}

describe('which families measure a status code', () => {
  it('recognises the three names a producer gives one', () => {
    expect(statusLikeLabel('http.server.response.status_code')).toBe(true);
    expect(statusLikeLabel('hubble_http_response_status_code')).toBe(true);
    expect(statusLikeLabel('http.response.code')).toBe(true);
  });

  it('does not mistake a duration, a count or an error rate for one', () => {
    // `error_rate` is a STATUS-DERIVED quantity and is deliberately not counted here: it is the symptom channel, it
    // exists on this corpus, and calling it a status column would make the census answer the question it is asking
    // with the column the answer is already known to be in.
    expect(statusLikeLabel('http.server.request.duration')).toBe(false);
    expect(statusLikeLabel('http.response.error_rate')).toBe(false);
    expect(statusLikeLabel('hubble_http_requests_total')).toBe(false);
    expect(statusLikeLabel('')).toBe(false);
  });
});

describe('counting the families a corpus writes', () => {
  it('accumulates across calls, so a walk can count one case at a time', () => {
    const counts = new Map<string, number>();
    countLabels(counts, [metric('container.cpu.usage'), metric('http.response.error_rate')]);
    countLabels(counts, [metric('container.cpu.usage')]);
    expect([...counts]).toEqual([
      ['container.cpu.usage', 2],
      ['http.response.error_rate', 1],
    ]);
  });

  it('counts a family once per SERIES rather than once per case, and never invents one', () => {
    const counts = new Map<string, number>();
    countLabels(counts, []);
    expect(counts.size).toBe(0);
  });

  it('orders the report by count and then by label, so the order is a function of the data', () => {
    const counts = new Map([
      ['b.series', 2],
      ['a.series', 2],
      ['c.series', 9],
    ]);
    expect(censusRows(counts).map((one) => one.label)).toEqual(['c.series', 'a.series', 'b.series']);
  });

  it('breaks a tie by label in BOTH directions, so two walks of one corpus agree byte for byte', () => {
    const counts = new Map([
      ['c.series', 4],
      ['a.series', 4],
      ['b.series', 4],
    ]);
    expect(censusRows(counts).map((one) => one.label)).toEqual(['a.series', 'b.series', 'c.series']);
  });

  it('carries each family’s channel kind and whether it is status-shaped', () => {
    const rows = censusRows(
      new Map([
        ['container.cpu.usage', 3],
        ['http.server.request.duration', 2],
        ['http.response.error_rate', 1],
      ]),
    );
    expect(rows.map((one) => [one.label, one.kind, one.statusLike])).toEqual([
      ['container.cpu.usage', 'resource', false],
      ['http.server.request.duration', 'traffic', false],
      ['http.response.error_rate', 'symptom', false],
    ]);
  });
});

describe('reading the census', () => {
  const trafficOnly: readonly CensusRow[] = censusRows(
    new Map([
      ['http.server.request.duration', 447],
      ['http.response.error_rate', 447],
      ['container.cpu.usage', 735],
    ]),
  );

  it('finds no status family in a corpus that publishes none', () => {
    expect(statusLikeFamilies(trafficOnly)).toEqual([]);
  });

  it('finds the ones it is given, rather than being written to always say zero', () => {
    const withStatus = censusRows(
      new Map([
        ['http.server.request.duration', 447],
        ['http.server.response.status_code', 120],
      ]),
    );
    expect(statusLikeFamilies(withStatus).map((one) => one.label)).toEqual([
      'http.server.response.status_code',
    ]);
  });

  it('prints every family with its count and kind, and the totals it counted', () => {
    const text = renderCensus(trafficOnly);
    expect(text).toContain('3 families');
    expect(text).toContain('1 629 series records');
    expect(text).toMatch(/735\s+resource\s+container\.cpu\.usage/);
    expect(text).toMatch(/447\s+symptom\s+http\.response\.error_rate/);
  });

  it('states the consequence of a zero instead of printing a zero', () => {
    // A zero is a finding and has to be reported as one: the axis 328 named as "untested" is unavailable, and a
    // reader who saw only `status-like families: 0` would not know whether to price it or to close it.
    const text = renderCensus(trafficOnly);
    expect(text).toContain('status-like families: 0');
    expect(text).toContain('unavailable as a new column');
  });

  it('states the other consequence when a status family IS present', () => {
    const withStatus = censusRows(
      new Map([
        ['http.response.error_rate', 9],
        ['http.server.response.status_code', 120],
      ]),
    );
    const text = renderCensus(withStatus);
    expect(text).toContain('status-like families: 1');
    expect(text).toContain('http.server.response.status_code');
    expect(text).not.toContain('unavailable as a new column');
  });
});
