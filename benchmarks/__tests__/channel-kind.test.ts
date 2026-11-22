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
    expect(departureOf([])).toEqual({ resource: null, traffic: null, other: null });
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
    expect(departure).toEqual({ resource: 120, traffic: 700, other: 9 });
  });

  it('skips a series whose spread cannot be estimated instead of counting it as zero', () => {
    // `undefined` is the producer's refusal, not a measured quiet: a median of zero or a pre-window of two samples
    // has no spread to standardise against, and reading it as 0 would let an unmeasurable channel decide a verdict.
    const departure = departureOf([
      metric('container.cpu.usage', undefined),
      metric('http.server.request.duration', 5),
    ]);
    expect(departure).toEqual({ resource: null, traffic: 5, other: null });
  });

  it('leaves an error series out of every bucket, because a symptom is not a departure of the service', () => {
    const departure = departureOf([
      metric('http.response.error_rate', 900),
      metric('container.cpu.usage', 12),
    ]);
    expect(departure).toEqual({ resource: 12, traffic: null, other: null });
  });
});

describe('whether an answer’s departure lives ONLY in the traffic channel', () => {
  it('refuses a profile it was not given, rather than reading silence as a verdict', () => {
    expect(trafficOnly(null, 200)).toBe(false);
  });

  it('refuses a profile whose traffic never departed', () => {
    expect(trafficOnly({ resource: 10, traffic: null, other: null }, 200)).toBe(false);
    expect(trafficOnly({ resource: 10, traffic: 0, other: null }, 200)).toBe(false);
  });

  it('refuses an answer that did work of its own, however loud its traffic was', () => {
    expect(trafficOnly({ resource: 900, traffic: 1_200, other: null }, 200)).toBe(false);
  });

  it('refuses an answer whose loudest series is in neither the resource nor the traffic family', () => {
    // A JVM heap rise above the traffic rise is the service's own state, and a rule that named the front door over
    // it would be reading the largest number in the profile rather than the channel it came from.
    expect(trafficOnly({ resource: 10, traffic: 400, other: 800 }, 200)).toBe(false);
  });

  it('admits an answer whose traffic is its loudest series and whose resource side stayed under the bar', () => {
    expect(trafficOnly({ resource: 10, traffic: 900, other: 200 }, 200)).toBe(true);
    expect(trafficOnly({ resource: 200, traffic: 900, other: null }, 200)).toBe(true);
    expect(trafficOnly({ resource: null, traffic: 900, other: null }, 200)).toBe(true);
  });

  it('admits a resource side equal to the bar, because the bar is a ceiling rather than a threshold', () => {
    expect(trafficOnly({ resource: 201, traffic: 900, other: null }, 200)).toBe(false);
  });
});

describe('reading every service’s profile out of one case', () => {
  it('keys the profiles by service id and carries the services that have no measurand as all-null', () => {
    const profiles = readChannelProfiles(
      telemetryOf([
        service('front', [metric('http.response.error_rate', 300)]),
        service('leaf', [metric('container.cpu.usage', 45)]),
        service('silent', []),
      ]),
    );
    expect([...profiles.keys()]).toEqual(['front', 'leaf', 'silent']);
    expect(profiles.get('front')).toEqual({ resource: null, traffic: null, other: null });
    expect(profiles.get('leaf')).toEqual({ resource: 45, traffic: null, other: null });
    expect(profiles.get('silent')).toEqual({ resource: null, traffic: null, other: null });
  });

  it('is a plain record that survives JSON, because it is written to an artifact and read back', () => {
    const profiles = readChannelProfiles(
      telemetryOf([service('leaf', [metric('container.cpu.usage', 45)])]),
    );
    const round: ChannelDeparture = JSON.parse(JSON.stringify(profiles.get('leaf')));
    expect(round).toEqual({ resource: 45, traffic: null, other: null });
  });
});
