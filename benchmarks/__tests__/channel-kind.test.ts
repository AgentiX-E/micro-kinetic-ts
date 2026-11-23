/**
 * The channel kind's own tests.
 *
 * The split this module draws is the axis a resolver reads, so the properties asserted here are the ones a wrong
 * reading would come from: a label classified by its SUFFIX rather than its family (`k8s.pod.network.errors` is a
 * symptom, not work the service did), a maximum taken across kinds instead of within one, and a "traffic only"
 * verdict granted to a profile whose traffic never departed at all.
 */

import { describe, expect, it } from 'vitest';

import type { ChannelDeparture } from '../src/channel-kind.js';
import {
  channelKindOf,
  conduitUnder,
  departureOf,
  readChannelProfiles,
  trafficOnly,
} from '../src/channel-kind.js';
import type { Telemetry, TelemetryMetric, TelemetryService } from '../src/query-agent.js';

/** One metric, with only the fields the split reads. */
function metric(label: string, surprise: number | undefined): TelemetryMetric {
  const peak = surprise ?? 0;
  return {
    label,
    baseline: 1,
    peak,
    delta: peak - 1,
    ratio: peak,
    surprise,
    trough: 1,
    fall: 0,
    peakOffset: 1_000,
  };
}

/**
 * One metric whose absolute rise is set independently of its standardised one.
 *
 * The two are not the same quantity and a test that derives one from the other cannot see the defect this pair
 * exists to pin: a rate with a zero pre-window has NO standardised rise and a perfectly good absolute one.
 */
function rate(label: string, surprise: number | undefined, delta: number): TelemetryMetric {
  return {
    label,
    baseline: 0,
    peak: delta,
    delta,
    ratio: delta,
    surprise,
    trough: 0,
    fall: 0,
    peakOffset: 1_000,
  };
}

/** One service, with the fields the profile builder walks. */
function service(id: string, metrics: readonly TelemetryMetric[]): TelemetryService {
  return {
    id,
    metrics,
    callers: [],
    callees: [],
    firstErrorOffset: undefined,
    errorCount: 0,
    errorLines: [],
  };
}

/** A telemetry carrying the given services and nothing else. */
function telemetryOf(services: readonly TelemetryService[]): Telemetry {
  return {
    injectTime: 0,
    services: new Map(services.map((one) => [one.id, one])),
    failed: [],
    latency: [],
  };
}

describe('which channel a metric family measures', () => {
  it('classifies the resource families as work the service did', () => {
    expect(channelKindOf('container.cpu.usage')).toBe('resource');
    expect(channelKindOf('k8s.pod.network.io')).toBe('resource');
  });

  it('classifies the HTTP, Hubble and client-duration families as traffic passing through', () => {
    expect(channelKindOf('http.server.request.duration')).toBe('traffic');
    expect(channelKindOf('http.client.request.duration')).toBe('traffic');
    expect(channelKindOf('hubble_http_request_duration_p99')).toBe('traffic');
  });

  it('classifies an ERROR series as a symptom even when its family is a resource one', () => {
    // The order of the rules is the finding: `k8s.pod.network.errors` carries a resource prefix and measures a
    // failure, and a classifier that read the prefix would count it as work the service did.
    expect(channelKindOf('k8s.pod.network.errors')).toBe('symptom');
    expect(channelKindOf('http.response.error_rate')).toBe('symptom');
    expect(channelKindOf('container.error_count')).toBe('symptom');
  });

  it('gives a family it does not claim its own bucket rather than folding it into traffic', () => {
    // A pool, a queue depth and a JVM heap are neither the service's own container nor its traffic. Pooling them
    // would let an unclassified series decide a verdict it was never examined for.
    expect(channelKindOf('jvm.memory.used')).toBe('other');
    expect(channelKindOf('queueSize')).toBe('other');
    expect(channelKindOf('db.client.connections.usage')).toBe('other');
    expect(channelKindOf('')).toBe('other');
  });
});

describe('a service’s departure, split by channel', () => {
  it('reads no departure at all from a service with no series', () => {
    expect(departureOf([])).toEqual({
      resource: null,
      traffic: null,
      other: null,
      symptom: null,
      symptomRise: null,
    });
  });

  it('keeps the maximum WITHIN each kind rather than one maximum across them', () => {
    const departure = departureOf([
      metric('container.cpu.usage', 40),
      metric('container.memory.usage', 120),
      // A second series in a kind that already has a louder one: the maximum is kept, not overwritten.
      metric('container.cpu.throttled', 5),
      metric('http.server.request.duration', 700),
      metric('jvm.memory.used', 9),
    ]);
    expect(departure).toEqual({
      resource: 120,
      traffic: 700,
      other: 9,
      symptom: null,
      symptomRise: null,
    });
  });

  it('skips a series whose spread cannot be estimated instead of counting it as zero', () => {
    // `undefined` is the producer's refusal, not a measured quiet: a median of zero or a pre-window of two samples
    // has no spread to standardise against, and reading it as 0 would let an unmeasurable channel decide a verdict.
    const departure = departureOf([
      metric('container.cpu.usage', undefined),
      metric('http.server.request.duration', 5),
    ]);
    expect(departure).toEqual({
      resource: null,
      traffic: 5,
      other: null,
      symptom: null,
      symptomRise: null,
    });
  });

  it('measures an error series in its OWN channel, never in the three a departure is compared across', () => {
    // A symptom is not work the service did and it is not traffic passing through, so it may not enter `resource`,
    // `traffic` or `other`. It is measured, because a channel that cannot say WHERE can still say WHAT.
    const departure = departureOf([
      rate('http.response.error_rate', 900, 0.5),
      metric('container.cpu.usage', 12),
    ]);
    expect(departure).toEqual({
      resource: 12,
      traffic: null,
      other: null,
      symptom: 900,
      symptomRise: 0.5,
    });
  });

  it('reads a rate’s ABSOLUTE rise where the standardised one refused', () => {
    // The refusal lands exactly on the series that distinguishes the populations: an error rate is flat at zero
    // before the injection, so its pre-window has no spread to divide by. The rise is what remains measurable, and
    // it is a rate, so it is compared against floors that are rates.
    const departure = departureOf([rate('http.response.error_rate', undefined, 0.42)]);
    expect(departure.symptom).toBeNull();
    expect(departure.symptomRise).toBe(0.42);
  });

  it('refuses a rise that is not a number, because a failed measurement is not a large one', () => {
    // `Number.NaN` compares false against everything, so a bare `>` would drop it — and `Infinity` would win every
    // maximum it appeared in. The finite test is what keeps a broken series out of the column rather than at its top.
    const departure = departureOf([
      { ...rate('http.response.error_rate', 900, 0.4), delta: Number.NaN },
      rate('http.response.error_rate.other', 30, 0.2),
    ]);
    expect(departure.symptomRise).toBe(0.2);
    expect(
      departureOf([
        { ...rate('http.response.error_rate', 900, 0.4), delta: Number.POSITIVE_INFINITY },
      ]).symptomRise,
    ).toBeNull();
  });

  it('takes each symptom measurand as its own maximum rather than off one series', () => {
    // Two series can win the two columns: the loudest standardised rise and the largest absolute one are different
    // questions, and reading the top series' delta would answer the second with the first's winner.
    const departure = departureOf([
      rate('http.response.error_rate', 900, 0.05),
      rate('http.response.error_rate.callee', 30, 0.6),
    ]);
    expect(departure.symptom).toBe(900);
    expect(departure.symptomRise).toBe(0.6);
  });
});

/** A departure with the three non-symptom channels given and both symptom columns empty. */
function profile(
  resource: number | null,
  traffic: number | null,
  other: number | null,
  symptomRise: number | null = null,
  symptom: number | null = null,
): ChannelDeparture {
  return { resource, traffic, other, symptom, symptomRise };
}

describe('whether an answer’s departure lives ONLY in the traffic channel', () => {
  it('refuses a profile it was not given, rather than reading silence as a verdict', () => {
    expect(trafficOnly(null, 200)).toBe(false);
  });

  it('refuses a profile whose traffic never departed', () => {
    expect(trafficOnly(profile(10, null, null), 200)).toBe(false);
    expect(trafficOnly(profile(10, 0, null), 200)).toBe(false);
  });

  it('refuses an answer that did work of its own, however loud its traffic was', () => {
    expect(trafficOnly(profile(900, 1_200, null), 200)).toBe(false);
  });

  it('refuses an answer whose loudest series is in neither the resource nor the traffic family', () => {
    // A JVM heap rise above the traffic rise is the service's own state, and a rule that named the front door over
    // it would be reading the largest number in the profile rather than the channel it came from.
    expect(trafficOnly(profile(10, 400, 800), 200)).toBe(false);
  });

  it('admits an answer whose traffic is its loudest series and whose resource side stayed under the bar', () => {
    expect(trafficOnly(profile(10, 900, 200), 200)).toBe(true);
    expect(trafficOnly(profile(200, 900, null), 200)).toBe(true);
    expect(trafficOnly(profile(null, 900, null), 200)).toBe(true);
  });

  it('admits a resource side equal to the bar, because the bar is a ceiling rather than a threshold', () => {
    expect(trafficOnly(profile(201, 900, null), 200)).toBe(false);
  });

  it('does not consult the symptom channel, which is the other axis and is priced separately', () => {
    // 328's rule is the one this clause extends, and an extension that changed the parent's verdict while claiming
    // to refine it would make the two pricings incomparable.
    expect(trafficOnly(profile(10, 900, null, 0.9), 200)).toBe(true);
    expect(trafficOnly(profile(10, 900, null, 0), 200)).toBe(true);
  });
});

describe('whether an answer is a CONDUIT: failing calls, no work of its own, and latency through it', () => {
  it('refuses a profile it was not given', () => {
    expect(conduitUnder(null, 200, 0.01)).toBe(false);
  });

  it('keeps the traffic-only bar it extends rather than replacing it', () => {
    // An answer that did work of its own is a source whatever its error rate says, because the clause under test is
    // a REFINEMENT of 328's and not a second rule wearing its name.
    expect(conduitUnder(profile(900, 1_200, null, 0.9), 200, 0.01)).toBe(false);
    expect(conduitUnder(profile(10, null, null, 0.9), 200, 0.01)).toBe(false);
  });

  it('refuses an answer whose error rate the case does not measure', () => {
    // A `null` rise is the producer's refusal and a zero is a measured quiet, and a rule that read the first as the
    // second would fire on every case whose error-rate family is absent — which is most of them.
    expect(conduitUnder(profile(10, 900, null, null), 200, 0.01)).toBe(false);
  });

  it('refuses a conduit whose calls are not failing, and admits one whose rise reached the floor', () => {
    expect(conduitUnder(profile(10, 900, null, 0.004), 200, 0.01)).toBe(false);
    expect(conduitUnder(profile(10, 900, null, 0.01), 200, 0.01)).toBe(true);
    expect(conduitUnder(profile(10, 900, null, 0.4), 200, 0.01)).toBe(true);
  });

  it('reads the floor as the POOLED rule when no floor is given', () => {
    // `null` is how the caller states "328's rule, no conditioning", and it must reproduce it exactly so the two
    // pricings are one comparison rather than two implementations.
    expect(conduitUnder(profile(10, 900, null, null), 200, null)).toBe(true);
    expect(conduitUnder(profile(10, 900, null, 0), 200, null)).toBe(true);
    expect(conduitUnder(profile(900, 900, null, 0.9), 200, null)).toBe(false);
  });
});

describe('reading every service’s profile out of one case', () => {
  it('keys the profiles by service id and carries the services that have no measurand as all-null', () => {
    const profiles = readChannelProfiles(
      telemetryOf([
        service('front', [rate('http.response.error_rate', 300, 0.3)]),
        service('leaf', [metric('container.cpu.usage', 45)]),
        service('silent', []),
      ]),
    );
    expect([...profiles.keys()]).toEqual(['front', 'leaf', 'silent']);
    expect(profiles.get('front')).toEqual(profile(null, null, null, 0.3, 300));
    expect(profiles.get('leaf')).toEqual(profile(45, null, null));
    expect(profiles.get('silent')).toEqual(profile(null, null, null));
  });

  it('is a plain record that survives JSON, because it is written to an artifact and read back', () => {
    const profiles = readChannelProfiles(
      telemetryOf([service('leaf', [metric('container.cpu.usage', 45)])]),
    );
    const round: ChannelDeparture = JSON.parse(JSON.stringify(profiles.get('leaf')));
    expect(round).toEqual(profile(45, null, null));
  });
});
