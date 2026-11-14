/**
 * Unit tests for the profile's on-disk form.
 *
 * The file is the only place two arms of one experiment can agree about a band, so the properties that
 * matter are the ones that make two reads equivalent: a round trip that loses nothing, a serialisation
 * that does not depend on the insertion order of a `Map`, and a refusal that distinguishes "unreadable"
 * from "empty".
 *
 * @module benchmarks/__tests__/fault-free-profile-file.test
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import type { ServiceId } from '../../packages/core/src/index.js';
import type { FaultFreeChannel, FaultFreeProfile } from '../../packages/tree/src/index.js';

import { parseBuildProfileArgs } from '../src/fault-free-profile-build.js';
import {
  deserialiseFaultFreeProfile,
  readFaultFreeProfileFile,
  serialiseFaultFreeProfile,
  writeFaultFreeProfileFile,
} from '../src/fault-free-profile-file.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ffp-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function channel(label: string, overrides: Partial<FaultFreeChannel> = {}): FaultFreeChannel {
  return { label, centre: 1, scale: 2, rate: 0.25, windows: 4, ...overrides };
}

function profileOf(entries: Record<string, Array<[string, FaultFreeChannel]>>): FaultFreeProfile {
  const profile = new Map<ServiceId, Map<string, FaultFreeChannel>>();
  for (const [service, channels] of Object.entries(entries)) {
    const byLabel = new Map<string, FaultFreeChannel>();
    for (const [label, value] of channels) byLabel.set(label, value);
    profile.set(service as ServiceId, byLabel);
  }
  return profile;
}

describe('the profile artifact', () => {
  it('round-trips every field of every channel', () => {
    const original = profileOf({
      adservice: [['cpu', channel('cpu', { centre: 12.5, scale: 0.75, rate: 0, windows: 9 })]],
      cartservice: [
        ['mem', channel('mem', { centre: 0, scale: 1, rate: 1, windows: 3 })],
        ['latency', channel('latency', { centre: -4, scale: 3, rate: 0.5, windows: 6 })],
      ],
    });
    const restored = deserialiseFaultFreeProfile(serialiseFaultFreeProfile(original));
    expect(restored.get('adservice' as ServiceId)?.get('cpu')).toEqual(
      original.get('adservice' as ServiceId)?.get('cpu'),
    );
    expect(restored.get('cartservice' as ServiceId)?.get('mem')).toEqual(
      original.get('cartservice' as ServiceId)?.get('mem'),
    );
    expect(restored.get('cartservice' as ServiceId)?.get('latency')).toEqual(
      original.get('cartservice' as ServiceId)?.get('latency'),
    );
  });

  it('carries the three thresholds that produced the rates', () => {
    const stored = serialiseFaultFreeProfile(profileOf({ a: [['cpu', channel('cpu')]] }), {
      sigma: 2.5,
      minSamples: 7,
      minWindows: 4,
    });
    expect(stored.sigma).toBe(2.5);
    expect(stored.minSamples).toBe(7);
    expect(stored.minWindows).toBe(4);
  });

  it('defaults the thresholds when none were named, so a reader is never guessing', () => {
    const stored = serialiseFaultFreeProfile(profileOf({ a: [['cpu', channel('cpu')]] }));
    expect(stored.sigma).toBe(3);
    expect(stored.minSamples).toBe(5);
    expect(stored.minWindows).toBe(3);
  });

  it('orders the channels canonically, so two builds of one corpus are byte-identical', () => {
    const forward = serialiseFaultFreeProfile(
      profileOf({
        b: [['z', channel('z')]],
        a: [
          ['y', channel('y')],
          ['x', channel('x')],
        ],
      }),
    );
    const backward = serialiseFaultFreeProfile(
      profileOf({
        a: [
          ['x', channel('x')],
          ['y', channel('y')],
        ],
        b: [['z', channel('z')]],
      }),
    );
    expect(forward).toEqual(backward);
    expect(forward.channels.map((c) => `${c.service}/${c.label}`)).toEqual(['a/x', 'a/y', 'b/z']);
  });

  it('keeps a dotted label intact, which is why the shape is a list rather than nested keys', () => {
    const label = 'http.server.request.duration.max';
    const stored = serialiseFaultFreeProfile(profileOf({ a: [[label, channel(label)]] }));
    expect(stored.channels[0]?.label).toBe(label);
    const restored = deserialiseFaultFreeProfile(stored);
    expect(restored.get('a' as ServiceId)?.get(label)?.label).toBe(label);
  });

  it('writes and reads a file that is byte-stable across two writes', () => {
    const dir = tempDir();
    const a = join(dir, 'a.json');
    const b = join(dir, 'b.json');
    const profile = profileOf({ a: [['cpu', channel('cpu')]] });
    writeFaultFreeProfileFile(a, profile);
    writeFaultFreeProfileFile(b, profile);
    expect(readFileSync(a, 'utf8')).toBe(readFileSync(b, 'utf8'));
    expect(
      readFaultFreeProfileFile(a)
        .profile.get('a' as ServiceId)
        ?.get('cpu'),
    ).toEqual(channel('cpu'));
  });

  it('refuses a file with no channel list rather than reading it as an empty profile', () => {
    // An empty profile scores the term at nothing for every candidate, which is indistinguishable from a
    // corpus whose channels all fell below the floor — so the two may not share a reading.
    const dir = tempDir();
    const path = join(dir, 'bad.json');
    writeFileSync(path, JSON.stringify({ sigma: 3 }));
    expect(() => readFaultFreeProfileFile(path)).toThrow(/channels/);
  });

  it('refuses a channel record whose numbers are not finite', () => {
    const dir = tempDir();
    const path = join(dir, 'bad.json');
    writeFileSync(
      path,
      JSON.stringify({
        sigma: 3,
        minSamples: 5,
        minWindows: 3,
        channels: [{ service: 'a', label: 'cpu', centre: 'x', scale: 1, rate: 0, windows: 3 }],
      }),
    );
    expect(() => readFaultFreeProfileFile(path)).toThrow(/malformed/);
  });

  it('refuses a channel record that is missing its service', () => {
    const dir = tempDir();
    const path = join(dir, 'bad.json');
    writeFileSync(
      path,
      JSON.stringify({
        sigma: 3,
        minSamples: 5,
        minWindows: 3,
        channels: [{ label: 'cpu', centre: 1, scale: 1, rate: 0, windows: 3 }],
      }),
    );
    expect(() => readFaultFreeProfileFile(path)).toThrow(/malformed/);
  });

  it('round-trips an empty profile without inventing a service', () => {
    const stored = serialiseFaultFreeProfile(new Map());
    expect(stored.channels).toEqual([]);
    expect(deserialiseFaultFreeProfile(stored).size).toBe(0);
  });
});

describe('the build command line', () => {
  it('requires a data directory and an output path', () => {
    expect(() => parseBuildProfileArgs(['--out', 'x.json'])).toThrow(/--data-dir/);
    expect(() => parseBuildProfileArgs(['--data-dir', '/tmp/c'])).toThrow(/--out/);
  });

  it('reads the thresholds when they are named, and leaves them absent otherwise', () => {
    const bare = parseBuildProfileArgs(['--data-dir', '/tmp/c', '--out', 'x.json']);
    expect(bare.sigma).toBeUndefined();
    expect(bare.minSamples).toBeUndefined();
    expect(bare.minWindows).toBeUndefined();
    expect(bare.maxCases).toBe(0);

    const named = parseBuildProfileArgs([
      '--data-dir',
      '/tmp/c',
      '--out',
      'x.json',
      '--sigma',
      '2.5',
      '--min-samples',
      '7',
      '--min-windows',
      '4',
      '--max-cases',
      '12',
    ]);
    expect(named.sigma).toBe(2.5);
    expect(named.minSamples).toBe(7);
    expect(named.minWindows).toBe(4);
    expect(named.maxCases).toBe(12);
  });
});
