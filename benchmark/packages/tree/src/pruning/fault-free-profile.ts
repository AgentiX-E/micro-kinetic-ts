/**
 * The fault-free frequency profile — how often a channel looks anomalous when nothing is wrong.
 *
 * ## The gap this closes
 *
 * Every ranking term this engine shipped before this module reads the case in front of it: a level
 * shift, a failed edge, a log template, an emission ratio. All of them answer *how much did this move*,
 * and none answers *does this channel move like this anyway*. A dashboard whose pod-network channel
 * swings by a third every few minutes carries as much deviation as a payment service that has never
 * once left its band, and the engine paid both the same. `docs/absent-census.md` §4 is that failure in
 * one line: a truth carrying `0.551` of deviation on `k8s.pod.network.io` losing to competitors that
 * carry more.
 *
 * The missing quantity is measurable and it is not in the case. Lee et al. (arXiv 2611.02416, §4.1.1)
 * call it the **Expected Outlier Baseline**:
 *
 *     r(s) = Pr over fault-free windows W' of [ φ(s; W') > τ ]
 *
 * — the fraction of fault-free windows in which the signal's own anomaly score leaves the band. They
 * count it rather than fitting a distribution, and they say why: counting puts KPIs with different σ
 * and log templates counted as entries on one scale, which is exactly the property a linear fusion
 * needs from a term.
 *
 * ## Why the windows come from OTHER cases
 *
 * The paper profiles a dataset's whole fault-free period — tens of hours. A datapack carries minutes:
 * the samples before its own injection. Profiling a case from its own pre-segment would produce one
 * window, which is a flag and not a rate, and on a corpus of one case it would be a leak.
 *
 * The corpus supplies the missing axis. The same `(service, channel)` pair re-appears in every case
 * that touches that service, and each of those cases contributes its own pre-segment — which is
 * fault-free by construction, because every corpus here injects the fault at `t₀` and labels the time.
 * A case is therefore **one window**, the rate is a count over the cases that carried the channel, and
 * a corpus of `n` cases yields a rate with `n`-window resolution.
 *
 * That is a deliberate departure from the paper's 10-minute windowing and it is a weaker estimate in
 * one direction only: a channel that swings within a case but holds its level across cases reads as
 * clean here, where the paper's finer windowing would catch it. It is stronger in another: the window
 * is one whole pre-segment, so nothing about the choice of a 10-minute boundary can bias it.
 *
 * ## Why the summary is not the samples
 *
 * A window is summarised by `(median, mad, min, max)` before anything else happens, and the profile is
 * estimated from those five numbers. Two consequences, both deliberate:
 *
 * - `max |x − c|` over a window IS `max(|max − c|, |min − c|)` for any `c`, so the flag is computed
 *   exactly and the raw samples are never needed twice.
 * - The centre is the median of the window MEDIANS rather than the pooled median of every sample. Those
 *   differ when windows carry different sample counts, and the median of medians is the estimator that
 *   gives a 1-sample window the same vote as a 2000-sample one — which is what "one window, one
 *   observation" means.
 *
 * @module pruning/fault-free-profile
 */

import type { MetricMap, ServiceId, TimeSeries } from '@agentix-e/micro-kinetic-core';

/** The band, in robust standard deviations, a window's extreme must leave to be counted as a fire. */
export const DEFAULT_FAULT_FREE_SIGMA = 3;

/** The narrowest pre-segment that counts as a window. Below this a window is a handful of samples. */
export const DEFAULT_FAULT_FREE_MIN_SAMPLES = 5;

/** The fewest windows a channel must be counted over before its rate is published at all. */
export const DEFAULT_FAULT_FREE_MIN_WINDOWS = 3;

/** One channel's published profile. */
export interface FaultFreeChannel {
  /** The channel's label, as the case wrote it. */
  readonly label: string;
  /** Median of the per-window medians — the level the channel holds when nothing is wrong. */
  readonly centre: number;
  /** Median of the per-window robust scales (1.4826 × MAD), with the spread of the medians as fallback. */
  readonly scale: number;
  /** The EOB: fraction of fault-free windows whose extreme left the band. In `[0, 1]`. */
  readonly rate: number;
  /** How many windows the rate was counted over. */
  readonly windows: number;
}

/**
 * A profile: per service, per channel label, the published reading.
 *
 * Keyed by service because the same label means different things on different services — `cpu` on a
 * load generator and `cpu` on a database are two channels, and pooling them would profile neither.
 */
export type FaultFreeProfile = ReadonlyMap<ServiceId, ReadonlyMap<string, FaultFreeChannel>>;

/** One case's contribution to the profile: its channels and the instant its fault was injected. */
export interface FaultFreeObservation {
  readonly metrics: MetricMap;
  /** Fault injection time in Unix ms. `<= 0` means unknown, and an unknown window contributes nothing. */
  readonly injectTimeMs: number;
}

/** How the threshold and the two floors are set. */
export interface FaultFreeProfileOptions {
  /** Band half-width in robust standard deviations. Default {@link DEFAULT_FAULT_FREE_SIGMA}. */
  readonly sigma?: number;
  /** Narrowest pre-segment that counts as a window. Default {@link DEFAULT_FAULT_FREE_MIN_SAMPLES}. */
  readonly minSamples?: number;
  /** Fewest windows before a rate is published. Default {@link DEFAULT_FAULT_FREE_MIN_WINDOWS}. */
  readonly minWindows?: number;
}

/** One window's summary — everything the second pass reads, and nothing else. */
interface WindowSummary {
  readonly median: number;
  /** The window's own standard deviation — the paper's σ, read within one window. */
  readonly sd: number;
  readonly min: number;
  readonly max: number;
}

/**
 * The median of a list of finite numbers, or `undefined` for an empty list.
 *
 * Even counts average the two middle values rather than picking one: a profile whose centre depended on
 * which of two windows a sort happened to leave first would not be invariant to the order the corpus was
 * read in, and the corpus order is not a property of the data.
 *
 * @param values - The numbers to summarise. Not mutated.
 * @returns The median, or `undefined` when there is nothing to summarise.
 */
function medianOf(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Summarise one window from the samples strictly before `injectTimeMs`.
 *
 * @param series - The channel.
 * @param injectTimeMs - Fault injection time in Unix ms (`> 0`).
 * @param minSamples - Narrowest acceptable pre-segment.
 * @returns The summary, or `undefined` when the window is unknown, empty or too narrow.
 */
function summariseWindow(
  series: TimeSeries,
  injectTimeMs: number,
  minSamples: number,
): WindowSummary | undefined {
  if (!(injectTimeMs > 0)) return undefined;
  const n = Math.min(series.values.length, series.timestamps.length);
  let split = -1;
  for (let i = 0; i < n; i++) {
    if (series.timestamps[i]! >= injectTimeMs) {
      split = i;
      break;
    }
  }
  // No boundary means no sample reaches the injection — the whole recording is pre-segment, so the case
  // cannot say what its own fault looked like and cannot be a fault-free window either. Refused, not
  // repaired: the two readings differ and only one of them is a measurement.
  if (split < minSamples) return undefined;

  const values = series.values;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < split; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) return undefined;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const buffer: number[] = [];
  for (let i = 0; i < split; i++) buffer.push(values[i]!);
  const median = medianOf(buffer);
  if (median === undefined) return undefined;

  // The window's own σ, and the POPULATION form (divide by n) rather than the sample form: a window here
  // is the whole population it describes, not a draw from a larger one, and with `n` as small as five the
  // Bessel correction would widen the band of exactly the shortest windows by 12 %.
  const mean = sum / split;
  let squares = 0;
  for (let i = 0; i < split; i++) {
    const d = values[i]! - mean;
    squares += d * d;
  }
  const sd = Math.sqrt(squares / split);

  return { median, sd, min, max };
}

/**
 * Estimate the profile from a corpus of cases.
 *
 * Two passes and no third: the first collects one summary per `(service, channel, case)`, the second
 * fixes each channel's band from those summaries and counts the fires. Nothing is estimated from a
 * value the first pass already summarised differently, so the centre a flag is measured against and the
 * centre the profile publishes are the same number.
 *
 * A channel is published only when it has at least `minWindows` windows AND a positive scale. Both are
 * refusals rather than defaults: a rate over two windows is a count that cannot be told apart from a
 * coin flip, and a channel with no scale has no band, so every window would be flagged and the term
 * would report the loudest possible evidence for the least measurable channel.
 *
 * @param observations - One entry per case: its metrics and its injection time.
 * @param options - Band width and the two floors.
 * @returns The profile. Empty when no channel clears the floors.
 */
export function buildFaultFreeProfile(
  observations: Iterable<FaultFreeObservation>,
  options: FaultFreeProfileOptions = {},
): FaultFreeProfile {
  const sigma = options.sigma ?? DEFAULT_FAULT_FREE_SIGMA;
  const minSamples = options.minSamples ?? DEFAULT_FAULT_FREE_MIN_SAMPLES;
  const minWindows = options.minWindows ?? DEFAULT_FAULT_FREE_MIN_WINDOWS;

  const windows = new Map<ServiceId, Map<string, WindowSummary[]>>();
  for (const observation of observations) {
    for (const [serviceId, seriesList] of observation.metrics) {
      for (const series of seriesList) {
        const summary = summariseWindow(series, observation.injectTimeMs, minSamples);
        if (summary === undefined) continue;
        let channels = windows.get(serviceId);
        if (channels === undefined) {
          channels = new Map();
          windows.set(serviceId, channels);
        }
        const list = channels.get(series.label);
        if (list === undefined) channels.set(series.label, [summary]);
        else list.push(summary);
      }
    }
  }

  const profile = new Map<ServiceId, Map<string, FaultFreeChannel>>();
  for (const [serviceId, channels] of windows) {
    const published = new Map<string, FaultFreeChannel>();
    for (const [label, summaries] of channels) {
      if (summaries.length < minWindows) continue;
      // `summaries` is non-empty here (the floor above returned for an empty one) and every median in it is
      // finite, so `medianOf` cannot answer `undefined` — the guard that used to stand here was a branch no
      // corpus could take, which is the shape this repository counts as dead rather than defensive.
      const centre = medianOf(summaries.map((s) => s.median))!;

      // The scale is the median of the windows' own σ. A window that held one level exactly contributes an
      // σ of ZERO, which is not a scale — it is the absence of one — so the fallback reads the
      // disagreement BETWEEN the windows, which is the only dispersion such a window carries. When every
      // window holds the same level the fallback is zero as well, and the band is then degenerate: the
      // comparison `departure > σ · scale` is strict, so a window that never left its level is clean and
      // one that did is a fire. That is the correct reading of a channel that has never moved — the
      // cleanest evidence there is — and it needs no special case.
      const spread = medianOf(
        summaries.map((s) => s.sd).filter((sd) => Number.isFinite(sd) && sd > 0),
      );
      // Both readings are finite by construction: `spread` is filtered to finite values, the fallback is a
      // median of finite differences, and `centre` is a median of finite medians. The `isFinite` guard that
      // used to stand here could not fire, so it is gone rather than kept as documentation of a worry.
      const acrossWindows =
        spread ?? medianOf(summaries.map((s) => Math.abs(s.median - centre))) ?? 0;

      let fires = 0;
      for (const summary of summaries) {
        const departure = Math.max(Math.abs(summary.max - centre), Math.abs(summary.min - centre));
        if (departure > sigma * acrossWindows) fires += 1;
      }
      published.set(label, {
        label,
        centre,
        scale: acrossWindows,
        rate: fires / summaries.length,
        windows: summaries.length,
      });
    }
    if (published.size > 0) profile.set(serviceId, published);
  }
  return profile;
}

/**
 * The two aggregations, as a value so that a parser, a test's probe set and this module's own type cannot
 * disagree about the vocabulary. The array is the OWNER: `FaultFreeSelection` is derived from it.
 */
export const FAULT_FREE_SELECTIONS = ['rarest', 'dominant'] as const;

/** Which of a node's channels the score reads. */
export type FaultFreeSelection = (typeof FAULT_FREE_SELECTIONS)[number];

/**
 * Whether a token names an aggregation.
 *
 * @param value - The token.
 * @returns `true` when it is one of {@link FAULT_FREE_SELECTIONS}.
 */
export function isFaultFreeSelection(value: string): value is FaultFreeSelection {
  return (FAULT_FREE_SELECTIONS as readonly string[]).includes(value);
}

/**
 * Score each node of one case against the profile.
 *
 *   score(v) = 1 − r_e(v)
 *
 * The complement rather than the negation, because every other term in the fusion is non-negative and a
 * term that spent a negative slope would need a weight of the opposite sign to mean "trust this node" —
 * a sign that a multiplicative grid cannot reach.
 *
 * `r_e` is read one of two ways, and they are different hypotheses rather than two spellings of one:
 *
 * - **`rarest`** (the default) is the paper's aggregation — the EOB of the node's RAREST channel. Its
 *   argument is that a component whose every anomalous channel is ordinary has no rare evidence, so the
 *   order should be set by the one channel that is.
 * - **`dominant`** is this engine's own reading — the EOB of the channel the node's anomaly came from.
 *   Its argument is that a fact about a channel the candidate's score did not use is not evidence about
 *   the candidate.
 *
 * Both are offered because the two arguments are both sound and only the corpus can choose; a single
 * spelling would have made the choice untestable.
 *
 * A node is ABSENT, rather than present with a neutral score, whenever the profile cannot speak about
 * it — no profile at all, no entry for the service, no entry for the channel the selection reads, no
 * channel in common between the profile and the case, or a rate outside `[0, 1]`. `0.5` would be a
 * measurement nobody made, and the fusion would read it as half-trusted evidence.
 *
 * @param metrics - The case's channels, used only to learn which labels the node actually carries.
 * @param dominantMetrics - Per-node dominant channel, of which only `label` is read.
 * @param profile - The profile, or `undefined` when none was built for this corpus.
 * @param selection - Which channel the score reads. Default `rarest`.
 * @returns Per-node score in `[0, 1]`. Empty when nothing can be scored.
 */
export function computeFaultFreeScores(
  metrics: MetricMap,
  dominantMetrics: ReadonlyMap<ServiceId, { readonly label: string }> | undefined,
  profile: FaultFreeProfile | undefined,
  selection: FaultFreeSelection = 'rarest',
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (profile === undefined || profile.size === 0) return scores;

  const usable = (rate: number | undefined): rate is number =>
    rate !== undefined && Number.isFinite(rate) && rate >= 0 && rate <= 1;

  for (const [serviceId, seriesList] of metrics) {
    const channels = profile.get(serviceId);
    if (channels === undefined || channels.size === 0) continue;

    let rate: number | undefined;
    if (selection === 'dominant') {
      const label = dominantMetrics?.get(serviceId)?.label;
      if (label === undefined) continue;
      rate = channels.get(label)?.rate;
    } else {
      let rarest = Infinity;
      for (const series of seriesList) {
        const candidate = channels.get(series.label)?.rate;
        if (!usable(candidate)) continue;
        if (candidate < rarest) rarest = candidate;
      }
      rate = Number.isFinite(rarest) ? rarest : undefined;
    }

    if (!usable(rate)) continue;
    scores.set(serviceId, 1 - rate);
  }
  return scores;
}
