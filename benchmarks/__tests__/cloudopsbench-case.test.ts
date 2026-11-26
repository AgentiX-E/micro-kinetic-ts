/**
 * The Cloud-OpsBench loader, held to the file shapes the corpus actually publishes.
 *
 * The fixture under `fixtures/cloudopsbench/` is SHAPED like a checkout rather than copied from one: two cases,
 * one with time series and one without, a `.DS_Store` beside the case directories, a BOM on the CSV, a metric gap,
 * a service name with a hyphen, and a `tool_cache.json` carrying all three key conventions. Every one of those is a
 * property observed in the real 3.7 GB tree on 2026-11-26 — the aggregate counts are in
 * `docs/cloud-opsbench-connection.md` — so a format change upstream fails here instead of quietly mis-loading a
 * corpus.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  listCaseIds,
  parseAlertWindow,
  parseMetricsCsv,
  readCaseLabel,
  readCloudOpsCase,
  readTimeCell,
} from '../src/cloudopsbench-case.js';

const fixture = join(import.meta.dirname, 'fixtures', 'cloudopsbench');

describe('one timestamp cell', () => {
  it('reads the stated shape as UTC milliseconds', () => {
    expect(readTimeCell('2026-05-18 21:55:47')).toBe(Date.UTC(2026, 4, 18, 21, 55, 47));
    expect(readTimeCell('2026-05-18T21:55:47')).toBe(Date.UTC(2026, 4, 18, 21, 55, 47));
    expect(readTimeCell(' 2026-05-18 21:55:47 ')).toBe(Date.UTC(2026, 4, 18, 21, 55, 47));
  });

  it('refuses anything else, including the forms Date.parse would guess at', () => {
    // A loose parse would read `05/18/2026` on one machine and `18/05/2026` on another, and the only consumer of
    // this value is a window difference against samples from the same file.
    expect(readTimeCell('')).toBeNull();
    expect(readTimeCell('05/18/2026 21:55:47')).toBeNull();
    expect(readTimeCell('2026-05-18')).toBeNull();
    expect(readTimeCell('2026-05-18 21:55')).toBeNull();
    // A non-numeric cell in a row whose TIME is good: the sample is dropped and the series survives.
    const gap = parseMetricsCsv('time,a-cpu\n2026-05-18 21:55:47,0.5\n2026-05-18 21:55:52,abc\n');
    if (!gap.ok) throw new Error(gap.reason);
    expect(gap.table.series[0]?.values).toEqual([0.5]);
    expect(gap.table.rows).toBe(2);
  });
});

describe('one metrics.csv', () => {
  const text =
    '\ufefftime,adservice-cpu,adservice-p90latency,redis-cart-cpu\n' +
    '2026-05-18 21:55:47,0.03,4.8,0.01\n' +
    '2026-05-18 21:55:52,0.16,70.0,0.01\n' +
    '2026-05-18 21:55:57,0.17,,0.01\n' +
    'not-a-time,0.18,71.0,0.01\n' +
    '2026-05-18 21:56:07,0.19\n';

  it('splits a column at the LAST hyphen, so a hyphenated service survives', () => {
    const parsed = parseMetricsCsv(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.table.series.map((one) => `${one.service}/${one.metric}`)).toEqual([
      'adservice/cpu',
      'adservice/p90latency',
      'redis-cart/cpu',
    ]);
  });

  it('drops a GAP and keeps the series, so times and values stay aligned', () => {
    const parsed = parseMetricsCsv(text);
    if (!parsed.ok) throw new Error(parsed.reason);
    const latency = parsed.table.series.find((one) => one.metric === 'p90latency');
    // Two readable samples of five rows: the empty cell and the two refused rows remove SAMPLES, and a series
    // whose two arrays disagreed would make every window statistic a comparison between different instants.
    expect(latency?.values).toEqual([4.8, 70]);
    expect(latency?.timestamps).toHaveLength(2);
  });

  it('counts the rows it refused instead of hiding them', () => {
    const parsed = parseMetricsCsv(text);
    if (!parsed.ok) throw new Error(parsed.reason);
    // `not-a-time` and the short row: two rows that are not data, counted where a reader can see them.
    expect(parsed.table.malformedRows).toBe(2);
    expect(parsed.table.rows).toBe(3);
  });

  it('orders series by service then metric, so two runs print the same table', () => {
    const parsed = parseMetricsCsv('time,z-cpu,a-cpu,z-a\n2026-05-18 21:55:47,1,2,3\n');
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.table.series.map((one) => `${one.service}/${one.metric}`)).toEqual([
      'a/cpu',
      'z/a',
      'z/cpu',
    ]);
  });

  it('refuses a file it cannot read rather than coercing it', () => {
    expect(parseMetricsCsv('')).toEqual({ ok: false, reason: 'metrics.csv is empty' });
    expect(parseMetricsCsv('\n \n')).toEqual({ ok: false, reason: 'metrics.csv is empty' });
    expect(parseMetricsCsv('stamp,a-cpu\n2026-05-18 21:55:47,1\n')).toEqual({
      ok: false,
      reason: 'metrics.csv: first column is "stamp" and not "time"',
    });
    expect(parseMetricsCsv('time,,\n2026-05-18 21:55:47,,\n')).toEqual({
      ok: false,
      reason: 'metrics.csv: no metric columns',
    });
    expect(parseMetricsCsv('time,cpu\n2026-05-18 21:55:47,1\n')).toEqual({
      ok: false,
      reason: 'metrics.csv: column "cpu" is not <service>-<metric>',
    });
    expect(parseMetricsCsv('time,a-cpu\nbad,1\n')).toEqual({
      ok: false,
      reason: 'metrics.csv: no readable data rows',
    });
  });

  it('keeps a metric whose name itself needs the last hyphen (`cpu_cfs`)', () => {
    const parsed = parseMetricsCsv('time,ts-basic-service-cpu_cfs\n2026-05-18 21:55:47,0.5\n');
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.table.series[0]).toMatchObject({
      service: 'ts-basic-service',
      metric: 'cpu_cfs',
      values: [0.5],
    });
  });
});

describe('one alert.json', () => {
  it('reads the window the alerts state, and every entity they name', () => {
    const window = parseAlertWindow(
      JSON.stringify({
        status: 'has_anomalies',
        alerts: [
          {
            type: 'Service',
            name: 'adservice',
            time_range: '2026-05-18 21:55:52 ~ 2026-05-18 21:56:02',
          },
          {
            type: 'Node',
            name: 'worker-02',
            time_range: '2026-05-18 21:55:57 ~ 2026-05-18 21:56:07',
          },
        ],
      }),
    );
    expect(window?.startMs).toBe(Date.UTC(2026, 4, 18, 21, 55, 52));
    expect(window?.endMs).toBe(Date.UTC(2026, 4, 18, 21, 56, 7));
    expect(window?.entities).toEqual([
      { type: 'Service', name: 'adservice' },
      { type: 'Node', name: 'worker-02' },
    ]);
  });

  it('is null when the file states no window, because a window at epoch zero is worse than none', () => {
    // `alert.json` is `{}` on every admission and scheduling case: the fault precedes the metrics, so a window
    // invented here would put every sample after the injection and hand the engine a case with no signal.
    expect(parseAlertWindow('{}')).toBeNull();
    expect(parseAlertWindow('not json')).toBeNull();
    expect(parseAlertWindow('[]')).toBeNull();
    // A scalar or a `null` root is not this format either: `JSON.parse` succeeds and yields something no alert
    // list can be read off, so the refusal is the object test and not the parser.
    expect(parseAlertWindow('5')).toBeNull();
    expect(parseAlertWindow('null')).toBeNull();
    expect(parseAlertWindow(JSON.stringify({ alerts: 'none' }))).toBeNull();
    expect(parseAlertWindow(JSON.stringify({ alerts: [] }))).toBeNull();
    expect(
      parseAlertWindow(JSON.stringify({ alerts: [{ type: 'Service', name: 'a' }] })),
    ).toBeNull();
    expect(
      parseAlertWindow(
        JSON.stringify({ alerts: [{ time_range: 'yesterday ~ today', status: 'ABNORMAL' }] }),
      ),
    ).toBeNull();
  });
});

describe('the case tree', () => {
  it('lists three-level case directories and skips a file beside them', () => {
    // The real tree carries `.DS_Store` under `benchmark/boutique/`, and a census that counted it would report 755
    // cases where the paper reports 754.
    expect(listCaseIds(fixture)).toEqual(['boutique/performance/1', 'boutique/scheduling/1']);
  });

  it('reads a case that carries time series', () => {
    const read = readCloudOpsCase(fixture, 'boutique/performance/1');
    if (!read.ok) throw new Error(read.reason);
    expect(read.value).toMatchObject({
      id: 'boutique/performance/1',
      system: 'boutique',
      category: 'performance',
      namespace: 'boutique',
      difficulty: 'hard',
      faultObject: 'app/adservice',
      faultTaxonomy: 'Performance_Fault',
      rootCause: 'pod_cpu_overload',
      hasToolCache: true,
      metricsRows: 4,
    });
    // Both services come from the CSV's own columns, hyphenated one included.
    expect(read.value.services).toEqual(['adservice', 'redis-cart', 'ts-basic-service']);
    expect(read.value.alert?.entities).toHaveLength(2);
  });

  it('reads a case that carries none, and reports it as a case rather than an error', () => {
    const read = readCloudOpsCase(fixture, 'boutique/scheduling/1');
    if (!read.ok) throw new Error(read.reason);
    expect(read.value.series).toEqual([]);
    expect(read.value.services).toEqual([]);
    expect(read.value.alert).toBeNull();
    expect(read.value.hasToolCache).toBe(false);
    expect(read.value.metricsRows).toBe(0);
    expect(read.value.faultObject).toBe('node/worker-02');
  });

  it('refuses a case whose metadata cannot be scored by anyone', () => {
    expect(readCloudOpsCase(fixture, 'boutique/absent/1')).toEqual({
      ok: false,
      reason: 'boutique/absent/1: no metadata.json',
    });
  });

  it('reads the label from its own root', () => {
    const label = readCaseLabel(fixture, 'boutique/performance/1');
    if (!label.ok) throw new Error(label.reason);
    expect(label.label.milestones).toHaveLength(2);
    expect(label.label.milestones[0]?.uses[1]?.arguments).toEqual({
      namespace: ['boutique'],
      resource_type: ['pods', 'pod'],
    });
    expect(readCaseLabel(fixture, 'boutique/absent/1')).toEqual({
      ok: false,
      reason: 'boutique/absent/1: no milestone.json',
    });
  });
});

describe('a case whose own files refuse it', () => {
  /** Build a throwaway checkout: `{ relativePath: contents }` under one temporary root. */
  function checkout(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'cloudopsbench-'));
    for (const [path, contents] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    return root;
  }

  const meta = (body: string): Record<string, string> => ({
    'benchmark/boutique/performance/1/metadata.json': body,
  });

  it('names the metadata field that makes a case unscorable', () => {
    const notObject = checkout(meta('5'));
    expect(readCloudOpsCase(notObject, 'boutique/performance/1')).toEqual({
      ok: false,
      reason: 'boutique/performance/1: metadata is not an object',
    });
    const notJson = checkout(meta('{'));
    const read = readCloudOpsCase(notJson, 'boutique/performance/1');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain('boutique/performance/1: metadata is not JSON');

    const noResult = checkout(meta('{}'));
    expect(readCloudOpsCase(noResult, 'boutique/performance/1')).toEqual({
      ok: false,
      reason: 'boutique/performance/1: no metadata.result',
    });
    const noObject = checkout(meta('{"result":{}}'));
    expect(readCloudOpsCase(noObject, 'boutique/performance/1')).toEqual({
      ok: false,
      reason: 'boutique/performance/1: no metadata.result.fault_object',
    });
  });

  it('carries a metrics refusal up with the case id in front of it', () => {
    const broken = checkout({
      ...meta('{"result":{"fault_object":"app/adservice"}}'),
      'benchmark/boutique/performance/1/raw_data/metrics.csv':
        'stamp,a-cpu\n2026-05-18 21:55:47,1\n',
    });
    expect(readCloudOpsCase(broken, 'boutique/performance/1')).toEqual({
      ok: false,
      reason: 'boutique/performance/1: metrics.csv: first column is "stamp" and not "time"',
    });
  });

  it('leaves every optional field empty rather than inventing one', () => {
    // No `raw_data/` at all: the case exists, states its truth, and simply carries no observation. A loader that
    // refused it would report 584 errors instead of 584 cases outside the comparable population.
    const bare = checkout({
      'benchmark/boutique/performance/1/metadata.json': JSON.stringify({
        result: {
          fault_object: 'app/adservice',
          fault_taxonomy: 7,
          root_cause: null,
        },
        namespace: 1,
        query: null,
        difficulty: [],
      }),
    });
    const read = readCloudOpsCase(bare, 'boutique/performance/1');
    if (!read.ok) throw new Error(read.reason);
    expect(read.value).toMatchObject({
      namespace: '',
      query: '',
      difficulty: '',
      faultTaxonomy: '',
      rootCause: '',
      series: [],
      alert: null,
      hasToolCache: false,
      metricsRows: 0,
    });
  });

  it('reads an alert file only where there is one', () => {
    const withAlert = checkout({
      ...meta('{"result":{"fault_object":"app/adservice"}}'),
      'benchmark/boutique/performance/1/raw_data/alert.json': '{"alerts":[]}',
    });
    const read = readCloudOpsCase(withAlert, 'boutique/performance/1');
    if (!read.ok) throw new Error(read.reason);
    // The file exists and states no window: still `null`, because an empty alert list is not an injection time.
    expect(read.value.alert).toBeNull();
  });
});
