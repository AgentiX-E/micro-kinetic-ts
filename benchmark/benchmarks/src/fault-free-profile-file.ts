/**
 * Read and write the fault-free frequency profile as one JSON artifact.
 *
 * ## Why the profile is a FILE rather than something a run computes
 *
 * The profile is a statement about the CORPUS, and a run is a statement about one configuration over
 * it. Two arms of one experiment — the control at `faultFreeWeight=0` and the arm at some positive
 * weight — must be scored against the SAME band, or the difference between them is also the difference
 * between two estimates. Computing the profile inside the run would make the artifact's provenance
 * depend on which arm happened to be dispatched first.
 *
 * It is also the only way the cost is paid once. Building it means reading every case's metrics, which
 * is the expensive half of a benchmark dispatch; a file lets the second arm, and every later re-reading
 * of the same corpus, start from the same numbers.
 *
 * ## Why the on-disk shape is a list of channels rather than a nested object
 *
 * The in-memory profile is `Map<service, Map<label, FaultFreeChannel>`. Rendered as nested objects a
 * label containing a dot or a bracket would need quoting rules that neither a hand-edit nor a `jq` query
 * would survive, and NCBench's labels are dotted OTel names (`http.server.request.duration.max`). A flat
 * list of records round-trips any label, and the reader is the only thing that has to know the shape.
 *
 * @module benchmarks/fault-free-profile-file
 */

import { readFileSync, writeFileSync } from 'node:fs';

import type { ServiceId } from '../../packages/core/src/index.js';
import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import {
  DEFAULT_FAULT_FREE_MIN_SAMPLES,
  DEFAULT_FAULT_FREE_MIN_WINDOWS,
  DEFAULT_FAULT_FREE_SIGMA,
  type FaultFreeChannel,
  type FaultFreeProfile,
} from '../../packages/tree/src/index.js';

/** One channel as the file stores it: the service and the label are fields rather than keys. */
interface StoredChannel {
  readonly service: string;
  readonly label: string;
  readonly centre: number;
  readonly scale: number;
  readonly rate: number;
  readonly windows: number;
}

/** The whole artifact. The three thresholds travel with the readings they produced. */
export interface StoredProfile {
  readonly sigma: number;
  readonly minSamples: number;
  readonly minWindows: number;
  readonly channels: readonly StoredChannel[];
}

/**
 * Serialise a profile, flattened.
 *
 * The thresholds are written even though this writer did not choose them: a reader that had to assume
 * them could not tell a profile built at `sigma = 3` from one built at `sigma = 2`, and the rates are
 * not comparable across the two.
 *
 * @param profile - The profile to write.
 * @param options - The thresholds that produced it.
 * @returns The artifact.
 */
export function serialiseFaultFreeProfile(
  profile: FaultFreeProfile,
  options: { sigma?: number; minSamples?: number; minWindows?: number } = {},
): StoredProfile {
  const channels: StoredChannel[] = [];
  for (const [service, byLabel] of profile) {
    for (const channel of byLabel.values()) {
      channels.push({
        service,
        label: channel.label,
        centre: channel.centre,
        scale: channel.scale,
        rate: channel.rate,
        windows: channel.windows,
      });
    }
  }
  // Sorted, so two builds of the same corpus produce byte-identical artifacts: a profile that reordered
  // itself between runs would make every diff of every downstream number look like a change.
  channels.sort((a, b) =>
    a.service === b.service
      ? compareCasePaths(a.label, b.label)
      : compareCasePaths(a.service, b.service),
  );
  return {
    sigma: options.sigma ?? DEFAULT_FAULT_FREE_SIGMA,
    minSamples: options.minSamples ?? DEFAULT_FAULT_FREE_MIN_SAMPLES,
    minWindows: options.minWindows ?? DEFAULT_FAULT_FREE_MIN_WINDOWS,
    channels,
  };
}

/**
 * Rebuild a profile from the artifact.
 *
 * @param stored - The parsed artifact.
 * @returns The profile.
 */
export function deserialiseFaultFreeProfile(stored: StoredProfile): FaultFreeProfile {
  const profile = new Map<ServiceId, Map<string, FaultFreeChannel>>();
  for (const record of stored.channels) {
    let byLabel = profile.get(record.service as ServiceId);
    if (byLabel === undefined) {
      byLabel = new Map();
      profile.set(record.service as ServiceId, byLabel);
    }
    byLabel.set(record.label, {
      label: record.label,
      centre: record.centre,
      scale: record.scale,
      rate: record.rate,
      windows: record.windows,
    });
  }
  return profile;
}

/**
 * Write a profile to disk.
 *
 * @param path - Destination.
 * @param profile - The profile.
 * @param options - The thresholds that produced it.
 */
export function writeFaultFreeProfileFile(
  path: string,
  profile: FaultFreeProfile,
  options: { sigma?: number; minSamples?: number; minWindows?: number } = {},
): void {
  writeFileSync(path, `${JSON.stringify(serialiseFaultFreeProfile(profile, options), null, 2)}\n`);
}

/**
 * Read a profile from disk.
 *
 * A malformed file FAILS rather than yielding an empty profile: an empty profile scores the term at
 * nothing for every candidate, which is indistinguishable from a corpus whose channels all fell below
 * the floor — and the second reading would be published as a measurement of the first.
 *
 * @param path - Source.
 * @returns The profile, and the thresholds it was built with.
 */
export function readFaultFreeProfileFile(path: string): {
  profile: FaultFreeProfile;
  stored: StoredProfile;
} {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredProfile;
  if (!Array.isArray(parsed.channels)) {
    throw new Error(`${path}: a fault-free profile must carry a \`channels\` array`);
  }
  for (const record of parsed.channels) {
    if (
      typeof record.service !== 'string' ||
      typeof record.label !== 'string' ||
      !Number.isFinite(record.centre) ||
      !Number.isFinite(record.scale) ||
      !Number.isFinite(record.rate) ||
      !Number.isFinite(record.windows)
    ) {
      throw new Error(`${path}: malformed channel record ${JSON.stringify(record)}`);
    }
  }
  return { profile: deserialiseFaultFreeProfile(parsed), stored: parsed };
}
