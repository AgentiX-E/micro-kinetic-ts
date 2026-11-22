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

/** One service's strongest departure in each of the three non-symptom channels. */
export interface ChannelDeparture {
  /** Largest `surprise` among the resource series, or `null` when none could be standardised. */
  readonly resource: number | null;
  /** Largest `surprise` among the traffic series, or `null` when none could be standardised. */
  readonly traffic: number | null;
  /** Largest `surprise` among the unclaimed series, or `null` when none could be standardised. */
  readonly other: number | null;
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
  for (const one of metrics) {
    const kind = channelKindOf(one.label);
    if (kind === 'symptom') continue;
    if (one.surprise === undefined) continue;
    const incumbent = best[kind];
    if (incumbent === null || one.surprise > incumbent) best[kind] = one.surprise;
  }
  return { resource: best.resource, traffic: best.traffic, other: best.other };
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
