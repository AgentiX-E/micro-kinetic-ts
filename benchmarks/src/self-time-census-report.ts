/**
 * The self-time term's reach, as one artifact line.
 *
 * A term that contributes nothing has three causes and a ranking cannot tell them apart. This line can:
 *
 * - **no transport channel at all** — the corpus's converter wrote `latency-*` for some services and not others,
 *   and a caller whose CALLEE has none is undecidable rather than zero;
 * - **a channel the window refuses** — too few samples, or a pre-fault level that is not positive (the idle
 *   percentile artifact);
 * - **a measured zero** — a flat or fallen level: a measurement, and the only one of the three that is evidence.
 *
 * It exists because FSE'26 read *nothing*: three arms of the fleet-normalisation study moved not one case, and
 * "the normalisation is silent" and "the map was never built" are the same number in a `Top@1` column.
 *
 * @module benchmarks/self-time-census-report
 */

import type { SelfTimeCensus } from '../../packages/tree/src/index.js';

/**
 * Render the census.
 *
 * @param census - The corpus total.
 * @returns One line, prefixed so a workflow's grep can find it.
 */
export function formatSelfTimeCensus(census: SelfTimeCensus): string {
  const share = (part: number, whole: number): string =>
    whole === 0 ? '  -' : `${((part / whole) * 100).toFixed(1)}%`;
  return (
    `[self-time] services=${census.services} withLatency=${census.withLatency} ` +
    `(${share(census.withLatency, census.services)}) withLevel=${census.withLevel} ` +
    `(${share(census.withLevel, census.services)}) undecided=${census.undecided} ` +
    `scored=${census.scored} (${share(census.scored, census.services)}) ` +
    `measuredZero=${census.measuredZero} channelsRefusedShort=${census.channelsRefusedShort} ` +
    `channelsRefusedIdle=${census.channelsRefusedIdle}`
  );
}
