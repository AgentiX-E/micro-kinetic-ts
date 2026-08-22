/**
 * Table output formatter for CLI results.
 *
 * Provides human-readable tabular output for RCA results,
 * benchmark scores, and denoising summaries.
 *
 * @module cli/formatters/table
 */

import type {
  BenchmarkResult,
  DenoiseResult,
  RootCauseResult,
} from '@agentix-e/micro-kinetic-core';

/** Column definition for table formatting. */
interface ColumnDef {
  key: string;
  header: string;
  width: number;
  align: 'left' | 'right';
}

/** Pad a string to the given width with the specified alignment. */
function pad(value: string, width: number, align: 'left' | 'right'): string {
  if (align === 'right') {
    return value.padStart(width);
  }
  return value.padEnd(width);
}

/** Draw a horizontal separator line. */
function separator(widths: number[]): string {
  return '+-' + widths.map((w) => '-'.repeat(w)).join('-+-') + '-+';
}

/** Render a header row. */
function headerRow(cols: ColumnDef[]): string {
  const cells = cols.map((c) => pad(c.header, c.width, c.align));
  return '| ' + cells.join(' | ') + ' |';
}

/** Render a data row. */
function dataRow(cols: ColumnDef[], row: Record<string, string>): string {
  const cells = cols.map((c) => pad(row[c.key] ?? '', c.width, c.align));
  return '| ' + cells.join(' | ') + ' |';
}

/**
 * Format RCA results as a table.
 */
export function formatRCATable(results: readonly RootCauseResult[]): string {
  const cols: ColumnDef[] = [
    { key: 'rank', header: 'Rank', width: 5, align: 'right' },
    { key: 'serviceId', header: 'Service', width: 28, align: 'left' },
    { key: 'faultType', header: 'Fault Type', width: 18, align: 'left' },
    { key: 'confidence', header: 'Confidence', width: 12, align: 'right' },
    { key: 'depth', header: 'Depth', width: 6, align: 'right' },
  ];

  const widths = cols.map((c) => c.width);
  const rows: Record<string, string>[] = results.map((r) => ({
    rank: String(r.rank),
    serviceId: r.serviceId,
    faultType: `${r.faultType.category}/${r.faultType.subType}`,
    confidence: (r.confidence * 100).toFixed(1) + '%',
    depth: String(r.propagationDepth),
  }));

  const lines: string[] = [];
  lines.push(separator(widths));
  lines.push(headerRow(cols));
  lines.push(separator(widths));
  for (const row of rows) {
    lines.push(dataRow(cols, row));
  }
  lines.push(separator(widths));

  return lines.join('\n');
}

/**
 * Format denoise results as a table.
 */
export function formatDenoiseTable(result: DenoiseResult): string {
  const cols: ColumnDef[] = [
    { key: 'category', header: 'Category', width: 20, align: 'left' },
    { key: 'count', header: 'Count', width: 8, align: 'right' },
    { key: 'pct', header: 'Percent', width: 10, align: 'right' },
  ];

  const total =
    result.trueAlarms.length + result.coincidentalAlarms.length + result.groupedAlarms.length;

  const rows: Record<string, string>[] = [
    {
      category: 'True Alarms',
      count: String(result.trueAlarms.length),
      pct: total > 0 ? ((result.trueAlarms.length / total) * 100).toFixed(1) + '%' : '0%',
    },
    {
      category: 'Coincidental',
      count: String(result.coincidentalAlarms.length),
      pct: total > 0 ? ((result.coincidentalAlarms.length / total) * 100).toFixed(1) + '%' : '0%',
    },
    {
      category: 'Grouped',
      count: String(result.groupedAlarms.length),
      pct: total > 0 ? ((result.groupedAlarms.length / total) * 100).toFixed(1) + '%' : '0%',
    },
  ];

  const widths = cols.map((c) => c.width);
  const lines: string[] = [];
  lines.push(separator(widths));
  lines.push(headerRow(cols));
  lines.push(separator(widths));
  for (const row of rows) {
    lines.push(dataRow(cols, row));
  }
  lines.push(separator(widths));

  lines.push('');
  lines.push(`Sparsity Score: ${(result.sparsityScore * 100).toFixed(1)}%`);
  lines.push(`False Positive Reduction: ${(result.falsePositiveReduction * 100).toFixed(1)}%`);

  return lines.join('\n');
}

/**
 * Format benchmark results as a table.
 */
export function formatBenchmarkTable(result: BenchmarkResult): string {
  const cols: ColumnDef[] = [
    { key: 'metric', header: 'Metric', width: 24, align: 'left' },
    { key: 'value', header: 'Value', width: 12, align: 'right' },
  ];

  const rows: Record<string, string>[] = [
    { metric: 'Dataset', value: result.datasetId },
    { metric: 'Total Cases', value: String(result.totalCases) },
    { metric: 'Passed Cases', value: String(result.passedCases) },
    { metric: 'Avg@1', value: (result.avgAtK.avgAt1 * 100).toFixed(1) + '%' },
    { metric: 'Avg@3', value: (result.avgAtK.avgAt3 * 100).toFixed(1) + '%' },
    { metric: 'Avg@5', value: (result.avgAtK.avgAt5 * 100).toFixed(1) + '%' },
    { metric: 'Execution Time', value: (result.executionTimeMs / 1000).toFixed(2) + 's' },
    { metric: 'Memory Peak', value: (result.memoryPeakBytes / (1024 * 1024)).toFixed(1) + ' MB' },
  ];

  const widths = cols.map((c) => c.width);
  const lines: string[] = [];
  lines.push(separator(widths));
  lines.push(headerRow(cols));
  lines.push(separator(widths));
  for (const row of rows) {
    lines.push(dataRow(cols, row));
  }
  lines.push(separator(widths));

  return lines.join('\n');
}
