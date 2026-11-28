/**
 * The fault-free SURPRISE: how improbable a candidate's own post-injection window is, in the units the
 * profile already counts.
 *
 * ## What the shipped fault-free term does not read, and why that is now the question
 *
 * `computeFaultFreeScores` publishes `1 − r_e(v)` — the complement of the rate at which the candidate's rarest
 * channel leaves its band when nothing is wrong. It is a **prior**: it says *this channel behaves like this
 * anyway*, and it never looks at what the window in front of the case did. The containment pass then reads a
 * different quantity entirely, `latencyExcursions`, which looks at the observation but only through one channel
 * FAMILY (`docs/closed-axes-register.md` §289 records that ceiling: the pass reads latency and only latency).
 *
 * This module is the join of the two: the observation, in the units of the rate that says how ordinary the
 * observation is. For a candidate `v` with published channel `c`,
 *
 *     fired(v, c) = [ max over the post-injection window of |x − centre_c|  >  σ · scale_c ]
 *     q_c         = (fires_c + 1) / (windows_c + 2)          ← Laplace, because the count is all there is
 *     surprise(v) = max over c of  fired(v, c) ? log(1 / q_c) : 0
 *
 * ## Why this is an entropy production and not a rescaling of the deviation
 *
 * `log(1/q)` is the surprisal of an event under the measure the corpus counted for that channel — a KL divergence
 * `D(Bern(1) ‖ Bern(q))` of the observation from the channel's own fault-free law. It is therefore
 *   - **per candidate**, so it can enter a score or a comparison without inventing a relation the case lacks;
 *   - **dimensionless** — nats, so one channel's milliseconds and another's byte counts are on one axis, which is
 *     exactly the property the paper's counting estimator was adopted for;
 *   - **non-negative, and zero only for a candidate whose whole channel set stayed inside its bands** — the same
 *     honest zero `latencyExcursions` reports, so a consumer can keep the distinction between "measured clean"
 *     and "not measured at all".
 *
 * The rate is the null and the window is the observation, so the quantity is monotone in departure and
 * ANTI-monotone in how often the channel does this anyway: a dashboard that swings by a third every few minutes
 * carries a large rate and therefore a small surprise however far it swings, which is the failure
 * `docs/absent-census.md` §4 records from the other side.
 *
 * ## The three refusals
 *
 * A channel contributes nothing when the profile cannot speak about it — no published entry, no positive band,
 * a series that does not reach the injection, a non-finite sample — and a candidate with no contributing channel
 * is **absent** from the result rather than present with `0`. That distinction is not pedantry: `0` means the
 * profile measured this candidate and it did not move, and a consumer that substituted `0` for "unmeasured"
 * would invert pairs on the absence of evidence. It is the same rule `latencyExcursions` states for the same
 * reason.
 *
 * @module pruning/fault-free-surprise
 */

import type { MetricMap, ServiceId } from '@agentix-e/micro-kinetic-core';

import { injectionSplitIndex } from '../causal/topology-fault-graph.js';
import { DEFAULT_FAULT_FREE_SIGMA, type FaultFreeProfile } from './fault-free-profile.js';

/** What {@link channelSurprise} needs. */
export interface ChannelSurpriseInput {
  /** The case's channels, exactly as the engine received them. */
  readonly metrics: MetricMap;
  /** The corpus profile, or `undefined` when this run has none — in which case the result is empty. */
  readonly profile: FaultFreeProfile | undefined;
  /** Fault injection time in Unix ms. `<= 0` means unknown, and an unknown boundary yields no surprise. */
  readonly injectTimeMs: number;
  /** Band half-width in robust standard deviations. Defaults to the profile builder's own. */
  readonly sigma?: number | undefined;
}

/**
 * The Laplace-smoothed fault-free firing probability of one channel.
 *
 * `rate` is `fires / windows`, so the count is recovered by rounding rather than stored twice — the profile
 * publishes windows precisely so that a later arm can re-derive the count without a second corpus walk. The
 * smoothing is not decoration: a channel with no fire in `n` windows has `q = 0` as its maximum-likelihood rate,
 * and `log(1/0)` would make the rarest channel in the corpus infinitely surprising. `(fires + 1) / (windows + 2)`
 * is the honest upper bound a count of zero supports, and it is what keeps the quantity finite on exactly the
 * channels that look cleanest.
 *
 * @param rate - The published rate.
 * @param windows - The windows it was counted over.
 * @returns The smoothed firing probability, in `(0, 1)`.
 */
export function smoothedFiringRate(rate: number, windows: number): number {
  const fires = Math.round(rate * windows);
  return (fires + 1) / (windows + 2);
}

/**
 * How surprising each candidate's post-injection window is, given its own fault-free profile.
 *
 * @param input - Channels, profile, anchor and band width.
 * @returns Per-service surprise in nats, for the services the profile could speak about.
 */
export function channelSurprise(input: ChannelSurpriseInput): Map<ServiceId, number> {
  const surprises = new Map<ServiceId, number>();
  const { metrics, profile, injectTimeMs } = input;
  if (profile === undefined || profile.size === 0) return surprises;
  if (!(injectTimeMs > 0)) return surprises;
  const sigma = input.sigma ?? DEFAULT_FAULT_FREE_SIGMA;

  for (const [serviceId, seriesList] of metrics) {
    const published = profile.get(serviceId);
    if (published === undefined || published.size === 0) continue;

    let worst = 0;
    let measured = false;
    for (const series of seriesList) {
      const entry = published.get(series.label);
      if (entry === undefined) continue;
      const halfWidth = sigma * entry.scale;
      if (!(halfWidth > 0)) continue;
      if (!(entry.windows > 0)) continue;
      const sampleCount = Math.min(series.values.length, series.timestamps.length);
      const split = injectionSplitIndex(series.timestamps, sampleCount, injectTimeMs);
      if (split === undefined || split >= sampleCount) continue;
      let finite = true;
      for (let i = split; i < sampleCount; i++) {
        if (!Number.isFinite(series.values[i]!)) {
          finite = false;
          break;
        }
      }
      if (!finite) continue;

      const centre = entry.centre;
      let departure = 0;
      for (let i = split; i < sampleCount; i++) {
        const distance = Math.abs(series.values[i]! - centre);
        if (distance > departure) departure = distance;
      }
      measured = true;
      // The profile's own fire rule, on the case's own window: `departure > σ · scale`, strict, because a window
      // that sits exactly on the band's edge is a window the fault-free count called clean.
      if (departure <= halfWidth) continue;
      const q = smoothedFiringRate(entry.rate, entry.windows);
      const contribution = Math.log(1 / q);
      if (contribution > worst) worst = contribution;
    }
    if (measured) surprises.set(serviceId, worst);
  }
  return surprises;
}
