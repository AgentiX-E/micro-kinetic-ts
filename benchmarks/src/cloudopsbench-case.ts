/**
 * One Cloud-OpsBench case, read off the published tree — and the two fields a comparison turns on.
 *
 * `docs/cloud-opsbench-connection.md` established WHAT the artefact is and left two numbers open: how many cases
 * carry `raw_data/metrics.csv` (the only input this engine reads) and what a case yields once parsed. Iteration
 * 310 answered the first from the paper's prose — "performance only, 76 cases" — and iteration 361 answered it by
 * listing every case directory: **170**, because `boutique/codedefect` carries time series too (98 cases), beside
 * `boutique/performance` (25 of 29) and `trainticket/performance` (47 of 47). One number in that document was
 * therefore wrong by a factor of 2.2, and it was wrong in the direction that understates what is comparable.
 *
 * ## The CSV is not RCAEval's parquet, and the difference is one column header
 *
 * ```
 * time,frontend-cpu,frontend-mem,frontend-cpu_cfs,frontend-rps,frontend-success_rate,frontend-p50latency,…
 * 2026-05-18 21:55:47,0.001,11702272.0,0.0,0.254,1.0,30.656,…
 * ```
 *
 * `<service>-<metric>` with a 5-second cadence, 46–53 rows a case, 112–436 columns. Service names carry hyphens
 * (`redis-cart`, `ts-basic-service`), so the split is at the LAST hyphen: splitting on the first would produce a
 * service called `redis` and a metric called `cart-cpu`, and every downstream reading would be about a service
 * the case does not carry.
 *
 * Refusal rather than coercion, for the reason this repository refuses everywhere: a CSV whose `time` column is
 * missing would otherwise parse into series with `NaN` timestamps, and `summariseSeries` would happily compute a
 * baseline over them — a wrong number attributed to the engine.
 *
 * @module benchmarks/src/cloudopsbench-case
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';

import { parseClosureLabel, type ClosureParse } from './closure-labels.js';

/** One series, as the CSV states it: a service, one metric of that service, and its samples. */
export interface CaseSeries {
  readonly service: string;
  readonly metric: string;
  /** Sample times, Unix milliseconds. */
  readonly timestamps: readonly number[];
  readonly values: readonly number[];
}

/** What one `metrics.csv` yielded. */
export interface MetricsTable {
  /** Every series the file carries, ordered by service then metric. */
  readonly series: readonly CaseSeries[];
  /** Data rows read. */
  readonly rows: number;
  /** Rows whose arity or timestamp refused them. Counted, never silently dropped. */
  readonly malformedRows: number;
}

/** A parse outcome: the table, or the field that refused it. */
export type MetricsParse =
  | { readonly ok: true; readonly table: MetricsTable }
  | { readonly ok: false; readonly reason: string };

/** The `time` cell's shape, matched strictly so a locale format cannot slip through as `Date.parse` would let it. */
const TIME_CELL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * Read one timestamp cell as UTC milliseconds.
 *
 * UTC and not local, because the file states no zone: a comparison that read the same file on two machines in two
 * zones would produce two different `injectTime`s, and the engine's windows are absolute differences from it. The
 * corpus was collected by one harness in one zone, so UTC is a convention that is at least stable.
 *
 * @param cell - The row's first cell.
 * @returns Milliseconds, or `null` when the cell is not the stated shape.
 */
export function readTimeCell(cell: string): number | null {
  const match = TIME_CELL.exec(cell.trim());
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

/**
 * Parse one `raw_data/metrics.csv`.
 *
 * @param text - The file's contents, BOM included (the corpus writes one).
 * @returns The table, or the reason it was refused.
 */
export function parseMetricsCsv(text: string): MetricsParse {
  const lines = text.replace(/^\ufeff/, '').split(/\r?\n/);
  const header = lines.find((line) => line.trim() !== '');
  if (header === undefined) return { ok: false, reason: 'metrics.csv is empty' };
  const columns = header.split(',').map((cell) => cell.trim());
  if (columns[0]!.toLowerCase() !== 'time') {
    return { ok: false, reason: `metrics.csv: first column is "${columns[0]!}" and not "time"` };
  }
  // A trailing comma would otherwise become a series with an empty service AND an empty metric, and every row
  // would carry one more cell than the header names.
  const named = columns.filter((cell, index) => index > 0 && cell !== '');
  if (named.length === 0) return { ok: false, reason: 'metrics.csv: no metric columns' };

  const indexes: { service: string; metric: string; index: number }[] = [];
  for (const [index, column] of columns.entries()) {
    if (index === 0 || column === '') continue;
    // The LAST hyphen: service names carry hyphens and metric names do not, so this is the only split that
    // cannot invent a service (`redis` + `cart-cpu`) the case does not carry.
    const cut = column.lastIndexOf('-');
    if (cut <= 0 || cut === column.length - 1) {
      return { ok: false, reason: `metrics.csv: column "${column}" is not <service>-<metric>` };
    }
    indexes.push({ service: column.slice(0, cut), metric: column.slice(cut + 1), index });
  }

  const samples = new Map<
    string,
    { service: string; metric: string; timestamps: number[]; values: number[] }
  >();
  for (const one of indexes) {
    const key = `${one.service}\u0000${one.metric}`;
    samples.set(key, { service: one.service, metric: one.metric, timestamps: [], values: [] });
  }

  let rows = 0;
  let malformedRows = 0;
  for (const line of lines) {
    if (line.trim() === '' || line === header) continue;
    const cells = line.split(',');
    const at = readTimeCell(cells[0]!);
    if (at === null || cells.length !== columns.length) {
      malformedRows += 1;
      continue;
    }
    rows += 1;
    for (const one of indexes) {
      const cell = cells[one.index]!.trim();
      // An EMPTY cell is a gap and `Number('')` is 0, which is the trap this line exists to avoid: a missing
      // latency would otherwise be recorded as a perfectly healthy zero and every baseline would be dragged down
      // by the samples the collector failed to write.
      if (cell === '') continue;
      const value = Number(cell);
      // A non-numeric cell drops the SAMPLE and not the series: one gap is a gap, and a series whose length no
      // longer matches its timestamps is a different bug than the one being reported.
      if (!Number.isFinite(value)) continue;
      const series = samples.get(`${one.service}\u0000${one.metric}`);
      series?.timestamps.push(at);
      series?.values.push(value);
    }
  }
  if (rows === 0) return { ok: false, reason: 'metrics.csv: no readable data rows' };

  const series = [...samples.values()]
    .filter((one) => one.timestamps.length > 0)
    .sort((a, b) => compareCasePaths(a.service, b.service) || compareCasePaths(a.metric, b.metric));
  return { ok: true, table: { series, rows, malformedRows } };
}

/** One entity an alert names. */
export interface AlertEntity {
  readonly type: string;
  readonly name: string;
}

/** The anomaly window `raw_data/alert.json` states, when it states one. */
export interface AlertWindow {
  /** Start of the earliest alert's window, Unix milliseconds. */
  readonly startMs: number;
  readonly endMs: number;
  /** Every entity the alerts name, in file order — a node alert and a service alert are different claims. */
  readonly entities: readonly AlertEntity[];
}

/** One alert's `time_range`, which the corpus writes as `<start> ~ <end>`. */
const ALERT_RANGE = /^\s*(.+?)\s*~\s*(.+?)\s*$/;

/**
 * Read the anomaly window out of one `raw_data/alert.json`.
 *
 * `null` rather than a zero window when the file states none: `alert.json` is `{}` on every admission and
 * scheduling case (the fault precedes the metrics), and a window invented at epoch zero would put every sample
 * after the injection and turn a case with no runtime signal into one the engine thinks it can see.
 *
 * @param text - The file's contents.
 * @returns The window, or `null` when the file states none.
 */
export function parseAlertWindow(text: string): AlertWindow | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const alerts = (raw as Record<string, unknown>).alerts;
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  const entities: AlertEntity[] = [];
  let startMs = Number.POSITIVE_INFINITY;
  let endMs = Number.NEGATIVE_INFINITY;
  for (const entry of alerts) {
    const one = entry as Record<string, unknown>;
    if (typeof one.type === 'string' && typeof one.name === 'string') {
      entities.push({ type: one.type, name: one.name });
    }
    const range = typeof one.time_range === 'string' ? ALERT_RANGE.exec(one.time_range) : null;
    if (range === null) continue;
    const start = readTimeCell(range[1]!);
    const end = readTimeCell(range[2]!);
    if (start === null || end === null) continue;
    startMs = Math.min(startMs, start);
    endMs = Math.max(endMs, end);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return { startMs, endMs, entities };
}

/** One case, as the published tree states it. */
export interface CloudOpsCase {
  /** `<system>/<category>/<case>`, which is also the path from the two roots. */
  readonly id: string;
  readonly system: string;
  readonly category: string;
  readonly namespace: string;
  readonly query: string;
  readonly difficulty: string;
  readonly faultObject: string;
  readonly faultTaxonomy: string;
  readonly rootCause: string;
  /** Every service the case's own metrics name, ordered. Empty when the case carries no `metrics.csv`. */
  readonly services: readonly string[];
  readonly series: readonly CaseSeries[];
  readonly alert: AlertWindow | null;
  /** Whether `tool_cache.json` exists — the competitor's replay surface, which doubles as a closure oracle. */
  readonly hasToolCache: boolean;
  readonly metricsRows: number;
}

/** A read outcome: the case, or the field that refused it. */
export type CaseRead =
  | { readonly ok: true; readonly value: CloudOpsCase }
  | { readonly ok: false; readonly reason: string };

/**
 * List every case directory under a checkout.
 *
 * The enumeration is three levels of `<system>/<category>/<case>` and it skips non-directories, because the
 * published tree carries a `.DS_Store` file beside the case directories and a census that counted it would
 * report 755 cases where the paper reports 754.
 *
 * @param root - The checkout's root, which holds `benchmark/`.
 * @returns Case ids, ordered so two runs print the same table.
 */
export function listCaseIds(root: string): string[] {
  const ids: string[] = [];
  const base = join(root, 'benchmark');
  for (const system of readdirSync(base).sort()) {
    if (!statSync(join(base, system)).isDirectory()) continue;
    for (const category of readdirSync(join(base, system)).sort()) {
      const categoryDir = join(base, system, category);
      if (!statSync(categoryDir).isDirectory()) continue;
      for (const id of readdirSync(categoryDir).sort()) {
        if (!statSync(join(categoryDir, id)).isDirectory()) continue;
        ids.push(`${system}/${category}/${id}`);
      }
    }
  }
  return ids.sort(compareCasePaths);
}

/**
 * Read one case off the published tree.
 *
 * `metrics.csv` is OPTIONAL and its absence is not a refusal: 584 of the 754 cases carry no time series, and a
 * loader that treated that as an error would report the corpus as 584 errors rather than as 170 comparable cases.
 * What is refused is a case whose `metadata.json` names no root cause, because that case cannot be scored by
 * anyone.
 *
 * @param root - The checkout's root.
 * @param id - The case id, `<system>/<category>/<case>`.
 * @returns The case, or the field that refused it.
 */
export function readCloudOpsCase(root: string, id: string): CaseRead {
  const dir = join(root, 'benchmark', id);
  const metadataPath = join(dir, 'metadata.json');
  if (!existsSync(metadataPath)) return { ok: false, reason: `${id}: no metadata.json` };
  let meta: Record<string, unknown>;
  try {
    const raw = JSON.parse(readFileSync(metadataPath, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null)
      return { ok: false, reason: `${id}: metadata is not an object` };
    meta = raw as Record<string, unknown>;
  } catch (error) {
    return { ok: false, reason: `${id}: metadata is not JSON (${(error as Error).message})` };
  }
  const result = meta.result as Record<string, unknown> | undefined;
  if (typeof result !== 'object' || result === null)
    return { ok: false, reason: `${id}: no metadata.result` };
  const faultObject = result.fault_object;
  if (typeof faultObject !== 'string' || faultObject === '') {
    return { ok: false, reason: `${id}: no metadata.result.fault_object` };
  }
  const [system = '', category = ''] = id.split('/');

  let series: readonly CaseSeries[] = [];
  let alert: AlertWindow | null = null;
  let metricsRows = 0;
  const metricsPath = join(dir, 'raw_data', 'metrics.csv');
  if (existsSync(metricsPath)) {
    const parsed = parseMetricsCsv(readFileSync(metricsPath, 'utf8'));
    if (!parsed.ok) return { ok: false, reason: `${id}: ${parsed.reason}` };
    series = parsed.table.series;
    metricsRows = parsed.table.rows;
  }
  const alertPath = join(dir, 'raw_data', 'alert.json');
  if (existsSync(alertPath)) alert = parseAlertWindow(readFileSync(alertPath, 'utf8'));

  const services = [...new Set(series.map((one) => one.service))].sort(compareCasePaths);
  return {
    ok: true,
    value: {
      id,
      system,
      category,
      namespace: typeof meta.namespace === 'string' ? meta.namespace : '',
      query: typeof meta.query === 'string' ? meta.query : '',
      difficulty: typeof meta.difficulty === 'string' ? meta.difficulty : '',
      faultObject,
      faultTaxonomy: typeof result.fault_taxonomy === 'string' ? result.fault_taxonomy : '',
      rootCause: typeof result.root_cause === 'string' ? result.root_cause : '',
      services,
      series,
      alert,
      hasToolCache: existsSync(join(dir, 'tool_cache.json')),
      metricsRows,
    },
  };
}

/**
 * Read one case's closure label off the published tree.
 *
 * Separate from {@link readCloudOpsCase} because the two live in different roots (`process-label/` beside
 * `benchmark/`) and because a case can legitimately exist with no label: the labels are what a scorer needs, not
 * what a loader needs, and a single reader that refused a case for a missing label would make the corpus
 * census impossible.
 *
 * @param root - The checkout's root, which holds `process-label/`.
 * @param id - The case id.
 * @returns The label, or the reason it was refused.
 */
export function readCaseLabel(root: string, id: string): ClosureParse {
  const path = join(root, 'process-label', id, 'milestone.json');
  if (!existsSync(path)) return { ok: false, reason: `${id}: no milestone.json` };
  return parseClosureLabel(readFileSync(path, 'utf8'), id);
}
