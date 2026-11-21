/**
 * How much a channel's excursion is worth, and the order a table should present it in.
 *
 * Three modules used to answer this question, and they answered it differently. The fingerprint builder ordered a
 * candidate's channels by how far `post` sat outside its band **in the channel's own units**; the elimination
 * prompt ordered them by the same distance **divided by the band's width**; the evidence arm picked the furthest
 * one, again in its own units. Those are three names for one idea, and the difference between them is not
 * cosmetic — it is the difference between a table that shows the fault and a table that shows the largest number.
 *
 * A channel measured in bytes has a band whose width is a hundred million; a channel measured as an error rate has
 * a band whose width is a hundredth. One megabyte of drift on the first is a fraction of its own band, and one
 * percent on the second is a hundred bands. Ranked by absolute distance, the byte channel wins every time, and on
 * the 1 422-case corpus it did: `container.filesystem.available` and `k8s.pod.filesystem.available` were cited by
 * 2 569 of 5 335 model claims — 48 % of the output — while being out of band in 99 % of **fault-free** windows,
 * which is to say while carrying no information at all.
 *
 * So there is one definition here, in band widths:
 *
 * 1. **Out of its band before inside it.** A channel inside its fault-free band cannot be cited as evidence (the
 *    verifier refuses it), so presenting one above an out-of-band channel is offering a row the protocol will
 *    reject.
 * 2. **Rarer excursions first.** `rate` is measured, not assumed: it is the fraction of fault-free windows in which
 *    this channel left this band anyway. It is therefore the correct discount for "this channel moved", and it is
 *    the only quantity here that was calibrated against the case being fault-free. A channel that leaves its band
 *    in 99 % of clean windows has told a reader nothing by leaving it again; a channel that leaves it in 2 % has.
 * 3. **Earlier onset first.** A fault reaches its source before its symptoms, so a channel that moved sooner is
 *    better evidence about where the fault started. Absent onset sorts last: a channel that never left its band has
 *    no time, and a time invented for it would be a claim.
 * 4. **Farther first, in band widths.** Only once two channels are equally rare and equally early does the size of
 *    the excursion decide, and then only in units the band itself defines, so a byte and a ratio are compared on
 *    the same scale.
 * 5. **Label, ascending.** So the order is total and a cap on the number of channels shown is a property of the
 *    case rather than of the array the channels arrived in.
 *
 * @module packages/ai/src/agent/evidence
 */

import type { ChannelFingerprint } from './hypothesis-space.js';

/**
 * How far outside its band a channel sits, in units of the band's own width.
 *
 * Zero means inside. A zero-width band — the shape a channel takes when it is exactly one value in every fault-free
 * window, e.g. `error` at 0 — has no width to measure in, and any move off it is unbounded in those units: the
 * result is a positive infinity rather than a division by a made-up floor, because a finite number there would be
 * a scale nobody chose.
 *
 * @param channel - The channel to measure.
 * @returns Zero inside the band, a positive distance outside it, and infinity when there is no scale to state.
 */
export function departureOf(channel: ChannelFingerprint): number {
  const [low, high] = channel.band;
  const value = channel.post;
  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high)) {
    return Number.POSITIVE_INFINITY;
  }
  if (value >= low && value <= high) return 0;
  const width = high - low;
  if (width <= 0) return Number.POSITIVE_INFINITY;
  const distance = value > high ? value - high : low - value;
  return distance / width;
}

/**
 * One channel with the four numbers the order is computed from.
 *
 * Decorated once rather than recomputed inside the comparator, for two reasons that point the same way: `departureOf`
 * is the expensive arm, and the repository's comparator census derives a site's signature from the comparison the
 * tie-break applies — which it can only read when that comparison is written on the sort's own two arguments.
 */
export interface ChannelEvidence {
  readonly channel: ChannelFingerprint;
  /** Band widths outside the band; zero inside, infinity when the band has no width. */
  readonly departure: number;
  /** `0` outside the band and `1` inside it, so an ascending sort puts the citable rows first. */
  readonly outside: number;
  /** Milliseconds after `t0` at which the channel first left its band; infinity when it never did. */
  readonly onset: number;
  /** The channel's label, carried so the last tie-break reads a field rather than reaching through. */
  readonly label: string;
}

/**
 * Measure one channel.
 *
 * Exported so a caller that needs the numbers (a census, a report) does not recompute them differently from the
 * order — the defect this module exists to remove.
 *
 * @param channel - The channel to measure.
 * @returns The channel and its departure.
 */
export function evidenceOf(channel: ChannelFingerprint): ChannelEvidence {
  const departure = departureOf(channel);
  return {
    channel,
    departure,
    outside: departure > 0 ? 0 : 1,
    onset: channel.onset ?? Number.POSITIVE_INFINITY,
    label: channel.label,
  };
}

/**
 * The order described in the module docblock, as a comparator over two measured channels.
 *
 * Written on the sort's own two arguments, and with the infinities compared rather than subtracted: `∞ − ∞` is
 * `NaN`, and a comparator that returns `NaN` leaves the order to the engine's sort implementation.
 *
 * @param a - One measured channel.
 * @param b - The other.
 * @returns Negative when `a` should stand first.
 */
export function compareChannelEvidence(a: ChannelEvidence, b: ChannelEvidence): number {
  if (a.outside !== b.outside) return a.outside - b.outside;
  if (a.channel.rate !== b.channel.rate) return a.channel.rate < b.channel.rate ? -1 : 1;
  if (a.onset !== b.onset) return a.onset < b.onset ? -1 : 1;
  if (a.departure !== b.departure) return a.departure > b.departure ? -1 : 1;
  // Three arms rather than two: two identical labels are a malformed fingerprint, and zero is the only answer that
  // does not invent a difference the data does not state.
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/**
 * The channels worth showing, most informative first.
 *
 * The single owner of that order: the fingerprint builder reads it to decide which channels its `maxChannels` cap
 * keeps, and the prompt reads it to decide which of those it prints. Two orders would make the second a truncation
 * of something the first never promised, and the model would be shown a row the builder had already ranked below
 * channels it dropped.
 *
 * A duplicate label is carried, not collapsed: the fingerprint refuses duplicates at build time (`shadowed`), so one
 * arriving here is a caller's defect and hiding it would hide the defect.
 *
 * @param channels - A candidate's channels, in any order.
 * @param limit - How many to keep; a non-positive limit yields none.
 * @returns At most `limit` channels, best first.
 */
export function channelsByEvidence(
  channels: readonly ChannelFingerprint[],
  limit: number,
): readonly ChannelFingerprint[] {
  const ranked = channels.map(evidenceOf).sort(compareChannelEvidence);
  return ranked.slice(0, Math.max(0, limit)).map((row) => row.channel);
}
