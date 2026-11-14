/**
 * Build the fault-free frequency profile from a corpus on disk.
 *
 * A separate step rather than a mode of the benchmark runner, because the thing it produces is a property
 * of the CORPUS and the thing the runner produces is a property of a CONFIGURATION. One build serves every
 * arm, and an arm that rebuilt the profile could not be compared with an arm that read it.
 *
 * The ENTRY POINT is `build-fault-free-profile.ts`, which is four lines: this module carries everything a
 * test can call, on the rule `run-*.ts` states in the other direction — a file that runs on import is a file
 * no test can call.
 *
 * ## The memory shape
 *
 * A case's metrics are released as soon as its window summaries are taken, so the peak footprint is one
 * case rather than a corpus. That is why the cases are presented to `buildFaultFreeProfile` through a
 * GENERATOR: an array of 1 422 cases' series is several gigabytes, and the profile it would produce is a
 * few hundred numbers.
 *
 * @module benchmarks/fault-free-profile-build
 */

import { FSE26Loader } from '../../packages/kinetic/src/benchmarks/index.js';
import { buildFaultFreeProfile, type FaultFreeObservation } from '../../packages/tree/src/index.js';
import { discoverCaseDirs } from './case-discovery.js';
import { writeFaultFreeProfileFile } from './fault-free-profile-file.js';

/** What a build reports about the profile it wrote. */
export interface BuildProfileSummary {
  /** Services the profile carries at least one channel for. */
  readonly services: number;
  /** Channels published, summed over services. */
  readonly channels: number;
  /** Cases whose pre-segment was read, which is the window count for a channel present in all of them. */
  readonly cases: number;
}

/** What the command line accepts. */
export interface BuildProfileArgs {
  readonly dataDir: string;
  readonly out: string;
  /** Cases to take, or 0 for all. */
  readonly maxCases: number;
  readonly sigma?: number;
  readonly minSamples?: number;
  readonly minWindows?: number;
}

/**
 * Parse the command line.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseBuildProfileArgs(argv: readonly string[]): BuildProfileArgs {
  let dataDir = '';
  let out = '';
  let maxCases = 0;
  let sigma: number | undefined;
  let minSamples: number | undefined;
  let minWindows: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data-dir') dataDir = argv[++i] ?? '';
    else if (arg === '--out') out = argv[++i] ?? '';
    else if (arg === '--max-cases') maxCases = Number.parseInt(argv[++i] ?? '0', 10) || 0;
    else if (arg === '--sigma') sigma = Number.parseFloat(argv[++i] ?? '');
    else if (arg === '--min-samples') minSamples = Number.parseInt(argv[++i] ?? '', 10);
    else if (arg === '--min-windows') minWindows = Number.parseInt(argv[++i] ?? '', 10);
    // The chain ends in a REFUSAL rather than in silence, for the reason both other parsers in this repository
    // already record: a token that matches no branch is discarded, the run proceeds at the defaults it could
    // not name, and the artifact reports a profile nobody asked for. Here the cost is specific — a mistyped
    // `--min-sample 8` would leave the floor at its default and publish a band fitted at three samples, which
    // is exactly the file a later arm would read as evidence.
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (dataDir === '') throw new Error('--data-dir is required');
  if (out === '') throw new Error('--out is required');
  return { dataDir, out, maxCases, sigma, minSamples, minWindows };
}

/**
 * Present a corpus as one observation per case, releasing each case's series after its summaries are
 * taken.
 *
 * @param dirs - The case directories.
 * @param loader - The corpus loader.
 * @param maxCases - Cases to take, or 0 for all.
 * @returns A generator of observations.
 */
export function* observationsOf(
  dirs: readonly string[],
  loader: FSE26Loader,
  maxCases: number,
): Generator<FaultFreeObservation> {
  const selected = maxCases > 0 ? dirs.slice(0, maxCases) : dirs;
  for (const dir of selected) {
    const raw = loader.loadCase(dir);
    const benchCase = loader.toBenchmarkCase(raw);
    yield { metrics: benchCase.metrics, injectTimeMs: benchCase.injectTime };
  }
}

/**
 * Build the profile for a corpus directory and write it.
 *
 * @param args - The parsed command line.
 * @returns How many services and channels the profile carries.
 */
export function runBuildProfile(
  args: BuildProfileArgs,
  loader: FSE26Loader = new FSE26Loader(),
): BuildProfileSummary {
  const dirs = discoverCaseDirs(args.dataDir);
  let observations = 0;
  const profile = buildFaultFreeProfile(
    (function* (): Generator<FaultFreeObservation> {
      for (const observation of observationsOf(dirs, loader, args.maxCases)) {
        observations += 1;
        yield observation;
      }
    })(),
    {
      ...(args.sigma === undefined ? {} : { sigma: args.sigma }),
      ...(args.minSamples === undefined ? {} : { minSamples: args.minSamples }),
      ...(args.minWindows === undefined ? {} : { minWindows: args.minWindows }),
    },
  );
  writeFaultFreeProfileFile(args.out, profile, {
    ...(args.sigma === undefined ? {} : { sigma: args.sigma }),
    ...(args.minSamples === undefined ? {} : { minSamples: args.minSamples }),
    ...(args.minWindows === undefined ? {} : { minWindows: args.minWindows }),
  });
  let channels = 0;
  for (const byLabel of profile.values()) channels += byLabel.size;
  return { services: profile.size, channels, cases: observations };
}

/**
 * Build a profile from a command line and report what it wrote.
 *
 * Takes its arguments rather than reading `process.argv`, for the reason the parser does: a function that
 * reads the process is a function no test can call, and this one has an assertion worth making — that the
 * summary it prints counts the same channels the file carries.
 *
 * @param argv - Arguments after the script name.
 * @param loader - The corpus loader, or a stand-in.
 * @returns The summary that was printed.
 */
export function main(argv: readonly string[], loader?: FSE26Loader): BuildProfileSummary {
  const args = parseBuildProfileArgs(argv);
  const summary = runBuildProfile(args, loader);
  console.log(
    `Fault-free profile: ${summary.channels} channels over ${summary.services} services, ` +
      `counted from ${summary.cases} cases → ${args.out}`,
  );
  return summary;
}
