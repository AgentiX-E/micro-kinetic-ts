/**
 * Which measurands a corpus publishes, counted once over a walk.
 *
 * ## Why this is a module and not three lines in a runner
 *
 * Iteration 328 closed the channel split on non-identifiability and named one candidate as untested: *the answer's
 * departure split by what the traffic says, duration against status*. A split needs two columns, and whether a status
 * column EXISTS is a property of the benchmark rather than of any run — so it is settled once, by counting the
 * families the corpus writes, and the count is a fact a later iteration can quote instead of re-deriving.
 *
 * ## What a zero means, and why it has to be said out loud
 *
 * `statusLikeFamilies` returning `[]` is not "no status signal". It is "no status COLUMN", which is a different
 * finding: the signal is measurable on this corpus, but only through `http.response.error_rate`, which
 * {@link channelKindOf} classifies as a symptom. A report that printed only `0` would leave a reader unable to tell
 * a missing column from a missing signal, and those two lead to opposite next steps — price the axis, or close it.
 *
 * @module benchmarks/channel-label-census
 */

import type { ChannelKind } from './channel-kind.js';
import { channelKindOf } from './channel-kind.js';

/** One family's line in the census. */
export interface CensusRow {
  /** The metric family as the producer wrote it. */
  readonly label: string;
  /** The channel {@link channelKindOf} assigns it. */
  readonly kind: ChannelKind;
  /** How many SERIES carried this family across the walk. */
  readonly count: number;
  /** Whether the family measures an HTTP status code. */
  readonly statusLike: boolean;
}

/**
 * Whether a family measures a status code.
 *
 * Two spellings are claimed — `status` anywhere, and a `response`/`code` pair — because the producers in this corpus
 * spell one quantity several ways, and a rule that claimed one of them would report a zero it had not looked for.
 * `error_rate` is deliberately NOT claimed: it is status-DERIVED, it exists here, and counting it would answer the
 * census's own question with the column whose sufficiency the census exists to test.
 *
 * @param label - The metric family.
 * @returns True when the family measures an HTTP status code.
 */
export function statusLikeLabel(label: string): boolean {
  return /status|response[._-]?code/i.test(label);
}

/**
 * Add one case's families to the running count.
 *
 * Mutating a caller-owned map rather than returning a new one because the walk counts one case at a time: 1 422
 * cases do not fit in the default heap, which is why every walk in this repository is incremental.
 *
 * The parameter is a bare `label` rather than a `TelemetryMetric` on purpose: the census counts the families the
 * corpus WRITES, and a walk has the raw series in hand before any window is summarised. Reading the summary instead
 * would count only the series a case could standardise, which is a different population from the one the census asks
 * about.
 *
 * @param counts - The running total, keyed by family.
 * @param metrics - The series one service carried, of which only the label is read.
 */
export function countLabels(
  counts: Map<string, number>,
  metrics: readonly { readonly label: string }[],
): void {
  for (const one of metrics) counts.set(one.label, (counts.get(one.label) ?? 0) + 1);
}

/**
 * Turn the counts into report rows.
 *
 * Count descending and then label ascending, so the order is a function of the data rather than of the walk's
 * iteration order: two walks of the same corpus must produce the same file, byte for byte.
 *
 * @param counts - The running total, keyed by family.
 * @returns One row per family, ordered.
 */
export function censusRows(counts: ReadonlyMap<string, number>): CensusRow[] {
  return (
    [...counts]
      .map(([label, count]) => ({
        label,
        kind: channelKindOf(label),
        count,
        statusLike: statusLikeLabel(label),
      }))
      // `a`/`b` rather than `left`/`right` because the comparator census reads its signature off these two names, and a
      // comparator it cannot name is a comparator outside the population whose safety the audit argues for.
      .sort((a, b) => (b.count === a.count ? (a.label < b.label ? -1 : 1) : b.count - a.count))
  );
}

/**
 * The families a status code would be measured in.
 *
 * @param rows - The census.
 * @returns The status-shaped rows, in census order. Empty is a finding (see the module's header).
 */
export function statusLikeFamilies(rows: readonly CensusRow[]): CensusRow[] {
  return rows.filter((one) => one.statusLike);
}

/** A count with a space every three digits, the way every report in this repository prints one. */
function grouped(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Render the census as the text a dispatch uploads.
 *
 * @param rows - The census.
 * @returns The report: a header with both totals, one line per family, and the verdict a zero deserves.
 */
export function renderCensus(rows: readonly CensusRow[]): string {
  const records = rows.reduce((total, one) => total + one.count, 0);
  const width = Math.max(5, ...rows.map((one) => grouped(one.count).length));
  const kindWidth = Math.max(4, ...rows.map((one) => one.kind.length));
  const lines = [
    `label census: ${grouped(rows.length)} families, ${grouped(records)} series records`,
    '',
    `${'count'.padStart(width)}  ${'kind'.padEnd(kindWidth)}  label`,
    `${'-'.repeat(width)}  ${'-'.repeat(kindWidth)}  -----`,
    ...rows.map(
      (one) => `${grouped(one.count).padStart(width)}  ${one.kind.padEnd(kindWidth)}  ${one.label}`,
    ),
    '',
  ];
  const status = statusLikeFamilies(rows);
  lines.push(`status-like families: ${status.length}`);
  if (status.length === 0) {
    lines.push(
      '  none: the duration/status split is unavailable as a new column on this corpus. A status code is measured',
      '  only through http.response.error_rate, which is classified as the SYMPTOM channel — so the split 328 named',
      '  as untested is a question about that channel, not a column this census failed to find.',
    );
  } else {
    lines.push(...status.map((one) => `  ${one.label} (${grouped(one.count)} series)`));
  }
  return `${lines.join('\n')}\n`;
}
