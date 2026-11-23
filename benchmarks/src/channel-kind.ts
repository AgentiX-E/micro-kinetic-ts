/**
 * Which CHANNEL a metric family measures, and what that decides.
 *
 * ## The distinction this module draws
 *
 * `http.response.error_rate` rising means *calls are failing here*, which is true of every hop on a failure's
 * path. `container.cpu.usage` rising means *this service is working harder*, which is true only of the service
 * doing the work. That split has been the entry prior's premise since iteration 322, but it was drawn as one
 * boolean (symptom or not) and the rest of the non-symptom channels were pooled. They are not the same statement:
 * an HTTP duration rise at a service whose container did nothing is a retry storm PASSING THROUGH it, while a
 * container rise is the same fact read about the service itself. Pooling the two is what makes a conduit look like
 * a source.
 *
 * ## Why a label predicate rather than a list
 *
 * The corpus writes one channel under several names (`http.server.request.duration` and
 * `http.client.request.duration`, `hubble_http_request_duration_p99`), and the families are prefixes of the
 * producer's own metric names rather than a taxonomy anyone published. A list would silently miss the third name;
 * a prefix rule misses only what it does not claim, and what it does not claim lands in `other` — a bucket that is
 * REPORTED rather than folded, so an unclassified series can be noticed instead of deciding a verdict.
 *
 * @module benchmarks/channel-kind
 */

import type { Telemetry, TelemetryMetric } from './query-agent.js';

/**
 * What a series measures about the service that carries it.
 *
 * - `symptom` — a failure record (`error` in the name). True of every hop on a failure's path, so it localises
 *   nothing on its own; it is the channel that is usually ABSENT (1 053 of 1 054 rising-callee cases).
 * - `resource` — work the service did with its own container or pod (`container.*`, `k8s.*`).
 * - `traffic` — calls passing through it (`http.*`, `hubble.*`).
 * - `other` — everything else (a pool, a queue depth, a JVM heap). Neither of the two statements above, and
 *   therefore reported separately rather than pooled with either.
 */
export type ChannelKind = 'symptom' | 'resource' | 'traffic' | 'other';

/**
 * One service's strongest departure in each channel, on the measurand that channel can be read on.
 *
 * The three departure channels are standardised (`surprise`, in units of the series' own pre-window spread) so they
 * can be compared with each other. The symptom channel is not: it is a rate, and the standardisation refuses exactly
 * where the rate becomes interesting (see {@link ChannelDeparture.symptomRise}).
 */
export interface ChannelDeparture {
  /** Largest `surprise` among the resource series, or `null` when none could be standardised. */
  readonly resource: number | null;
  /** Largest `surprise` among the traffic series, or `null` when none could be standardised. */
  readonly traffic: number | null;
  /** Largest `surprise` among the unclaimed series, or `null` when none could be standardised. */
  readonly other: number | null;
  /**
   * Largest `surprise` among the SYMPTOM series, or `null` when none could be standardised.
   *
   * Recorded because it is a measurement, and reported rather than read: on this corpus it is `null` on the cases it
   * would matter for, which is finding 329.2 rather than a defect here.
   */
  readonly symptom: number | null;
  /**
   * Largest ABSOLUTE rise (`peak − baseline`) among the symptom series, or `null` when the case carries none.
   *
   * This is the measurand the symptom channel is actually read on, and the reason is a refusal rather than a taste.
   * `surprise` divides by the pre-window's spread, so a series flat at ZERO before the injection has no standardised
   * rise at all — and an error rate is flat at zero before the injection in every case where it is diagnostic. The
   * refusal therefore lands, exactly and only, on the signal. A rate is already dimensionless (errors per request),
   * so its rise is comparable across services without standardising it, and the floors it is read against are rates.
   */
  readonly symptomRise: number | null;
}

/** The channel kinds a departure is measured over, in the order a report reads them. */
const MEASURED: readonly Exclude<ChannelKind, 'symptom'>[] = ['resource', 'traffic', 'other'];

/**
 * Which channel one metric family measures.
 *
 * The order of the rules is load-bearing. `k8s.pod.network.errors` carries a resource prefix and measures a
 * failure; classifying it by prefix would count it as work the service did, which is the one error a rule about
 * conduits must not make. So the symptom test comes first and is a word test rather than a prefix.
 *
 * @param label - The metric family as the producer wrote it.
 * @returns The channel kind. An unclaimed family is `other` rather than `traffic`.
 */
export function channelKindOf(label: string): ChannelKind {
  if (/error/i.test(label)) return 'symptom';
  if (label.startsWith('container.') || label.startsWith('k8s.')) return 'resource';
  if (label.startsWith('http') || label.startsWith('hubble')) return 'traffic';
  return 'other';
}

/**
 * One service's departure, split by channel.
 *
 * A series whose `surprise` is `undefined` is skipped rather than counted as zero: `undefined` is the producer's
 * refusal (a pre-window too short or too flat to standardise against), and reading a refusal as a measured quiet is
 * how an unmeasurable channel comes to decide a verdict.
 *
 * @param metrics - The service's series.
 * @returns The profile, with `null` in every channel that carried no measurable non-symptom series.
 */
export function departureOf(metrics: readonly TelemetryMetric[]): ChannelDeparture {
  const best: Record<Exclude<ChannelKind, 'symptom'>, number | null> = {
    resource: null,
    traffic: null,
    other: null,
  };
  // The two symptom columns are maxima of their OWN measurand over the same series, taken separately: the loudest
  // standardised rise and the largest absolute one are different questions and need not be the same series.
  let symptom: number | null = null;
  let symptomRise: number | null = null;
  for (const one of metrics) {
    if (channelKindOf(one.label) === 'symptom') {
      if (one.surprise !== undefined && (symptom === null || one.surprise > symptom)) {
        symptom = one.surprise;
      }
      if (Number.isFinite(one.delta) && (symptomRise === null || one.delta > symptomRise)) {
        symptomRise = one.delta;
      }
      continue;
    }
    if (one.surprise === undefined) continue;
    const incumbent = best[channelKindOf(one.label) as Exclude<ChannelKind, 'symptom'>];
    if (incumbent === null || one.surprise > incumbent) {
      best[channelKindOf(one.label) as Exclude<ChannelKind, 'symptom'>] = one.surprise;
    }
  }
  return {
    resource: best.resource,
    traffic: best.traffic,
    other: best.other,
    symptom,
    symptomRise,
  };
}

/**
 * Whether a service's departure lives ONLY in the traffic channel.
 *
 * Three statements, and each is a refusal of a different mistake:
 *
 * 1. **Traffic departed** (`> 0`). A profile whose only measurand is its container is not a conduit, and a rule
 *    that read "no resource rise" alone would name the front door for every case where the answer was silent
 *    everywhere but its resources.
 * 2. **The resource side stayed under `kappa`.** `kappa` is a ceiling rather than a threshold — a container that
 *    moved by the same amount as the bar is admitted — because the quantity being compared is a standardised
 *    surprise and the sweep's granularity is coarser than one unit of it.
 * 3. **Nothing else was louder than the traffic.** A JVM heap or a queue depth above the traffic rise is the
 *    service's own state, and a rule that ignored it would be reading the largest number in the profile rather
 *    than the channel it came from.
 *
 * @param departure - The service's profile, or `null` when the case does not carry that service.
 * @param kappa - The resource ceiling, in units of the pre-window's own spread.
 * @returns True when the departure is traffic-shaped.
 */
export function trafficOnly(departure: ChannelDeparture | null, kappa: number): boolean {
  if (departure === null) return false;
  if (departure.traffic === null || !(departure.traffic > 0)) return false;
  if (departure.resource !== null && departure.resource > kappa) return false;
  if (departure.other !== null && departure.other > departure.traffic) return false;
  return true;
}

/**
 * Whether a service is a CONDUIT: calls failing through it, no work of its own, and latency above its own spread.
 *
 * Three clauses, and the third is the one iteration 329 adds to the two 328 priced.
 *
 * 1. **Traffic only** ({@link trafficOnly}) — the service's own container did nothing and nothing else in its profile
 *    was louder than its traffic. Without this clause the rule names the front door for every service whose calls
 *    are failing, which is every hop on the path.
 * 2. **Its own error rate rose by at least `floor`** — the calls it carries are FAILING, not merely slower. The rise
 *    is the absolute one, for the reason {@link ChannelDeparture.symptomRise} states: a rate flat at zero before the
 *    injection has no standardised rise, and that is the case this clause is for.
 * 3. **`floor === null` reads the POOLED rule** — 328's clause and nothing more. It is the comparison every
 *    conditioned reading is stated against, and it is expressed here rather than in the caller so the two pricings
 *    cannot drift into two implementations of one rule.
 *
 * The channel cannot say WHERE — a symptom rise is true of every hop on a failure's path, which is why 328 refused
 * it as a localiser. It can say WHAT: an error-rate rise marks the family of faults that rewrites a response, and
 * that is a classification rather than a location, which is the question this clause asks.
 *
 * @param departure - The service's profile, or `null` when the case does not carry that service.
 * @param kappa - The resource ceiling, in units of the pre-window's own spread.
 * @param floor - The error-rate rise a conduit must show, in errors per request, or `null` for the pooled rule.
 * @returns True when the departure reads as a conduit carrying a failure.
 */
export function conduitUnder(
  departure: ChannelDeparture | null,
  kappa: number,
  floor: number | null,
): boolean {
  if (!trafficOnly(departure, kappa)) return false;
  if (floor === null) return true;
  const rise = departure!.symptomRise;
  // `null` is the producer's refusal and a `0` is a measured quiet: a rule that read the first as the second would
  // fire on every case whose error-rate family is absent, which on this corpus is most of them.
  return rise !== null && rise >= floor;
}

/**
 * Every service's profile in one case.
 *
 * Recorded for EVERY service rather than for the answer alone, because the answer is a property of a DISPATCH and
 * the profile is a property of the CASE: one artifact prices the rule for every policy, for both sides of every
 * fallback, and for every `kappa` in a sweep without a second corpus walk. That is the whole reason this is a
 * module rather than three lines inside the resolver.
 *
 * @param telemetry - The case's tool view.
 * @returns The profiles keyed by service id, in the case's own iteration order.
 */
export function readChannelProfiles(telemetry: Telemetry): ReadonlyMap<string, ChannelDeparture> {
  const profiles = new Map<string, ChannelDeparture>();
  for (const [id, service] of telemetry.services) profiles.set(id, departureOf(service.metrics));
  return profiles;
}

/** The kinds a profile measures, in report order. Re-exported so a printer cannot invent a fourth. */
export const MEASURED_CHANNELS: readonly Exclude<ChannelKind, 'symptom'>[] = MEASURED;
