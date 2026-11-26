/**
 * The Cloud-OpsBench runner's own command line.
 *
 * Kept out of `rcaeval-cli.ts` on purpose: every option in that parser is forwarded to the engine, and the anchor
 * fingerprint is computed over the forwarded set. A runner-only flag added there would enter that set, change the
 * fingerprint, and make a difference between two corpora look like a difference between two configurations.
 *
 * @module benchmarks/src/cloudopsbench-cli
 */

/** Parsed command line. */
export interface CloudOpsArgs {
  /** The checkout root — the directory holding `benchmark/` and `process-label/`. */
  readonly dataDir: string;
  /** Where to write the per-case JSON, when asked. */
  readonly output: string | undefined;
  /**
   * Cap on the number of case DIRECTORIES read.
   *
   * Deliberately a read cap and not a kept-case cap: a cap applied after selection would change what the
   * denominator means while leaving the printed rate looking ordinary.
   */
  readonly maxCases: number | undefined;
  /** Whether the corpus's alert window is forwarded to the engine as the injection time. */
  readonly useInjectTime: boolean;
  /**
   * Which call graph every case is built on.
   *
   * `registry` is the deployment and the only arm a published number may come from; `ring` is the ablation that
   * reproduces the graph an earlier version of this runner built by accident, so the topology channel can be priced
   * case by case rather than argued about.
   */
  readonly topology: TopologyArm;
}

/** The two graph arms, as the command line spells them. */
export type TopologyArm = 'registry' | 'ring';

/**
 * Parse this runner's arguments.
 *
 * @param args - The process arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseCloudOpsArgs(args: readonly string[]): CloudOpsArgs {
  let dataDir: string | undefined;
  let output: string | undefined;
  let maxCases: number | undefined;
  let useInjectTime = true;
  let topology: TopologyArm = 'registry';

  const valueOf = (index: number, flag: string): string => {
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    return value;
  };

  for (let index = 0; index < args.length; index += 1) {
    const one = args[index]!;
    if (one === '--data-dir') {
      dataDir = valueOf(index, '--data-dir');
      index += 1;
    } else if (one === '--output') {
      output = valueOf(index, '--output');
      index += 1;
    } else if (one === '--max-cases') {
      const value = valueOf(index, '--max-cases');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--max-cases must be a positive integer, got "${value}"`);
      }
      maxCases = parsed;
      index += 1;
    } else if (one === '--no-inject-time') {
      useInjectTime = false;
    } else if (one === '--topology') {
      const value = valueOf(index, '--topology');
      if (value !== 'registry' && value !== 'ring') {
        throw new Error(`--topology is registry or ring, got "${value}"`);
      }
      topology = value;
      index += 1;
    } else {
      throw new Error(`unknown argument "${one}"`);
    }
  }

  if (dataDir === undefined) {
    throw new Error(
      '--data-dir is required: this runner reads a Cloud-OpsBench checkout and nothing else',
    );
  }
  return { dataDir, output, maxCases, useInjectTime, topology };
}
