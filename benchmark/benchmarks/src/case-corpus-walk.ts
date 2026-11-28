/**
 * The corpus traversal, and the ORDER it returns.
 *
 * ## Why this is a module rather than a line in each runner
 *
 * The repository traverses a case corpus in eleven places. Three of them canonicalised their output, six
 * more did so with `localeCompare`, and **two did not sort at all — and those two are the ones whose
 * `slice(0, maxCases)` decides a published case set** (`run-rcaeval.ts`'s and `run-ablation.ts`'s
 * `discoverAllCases`). A capped run's population was therefore a property of the FILESYSTEM: `readdirSync`'s
 * order is deliberately unspecified, so the same command over the same corpus could rank a different subset on
 * another machine, and two of the record's own instruments (`benchmark-prism-sweep.yml` and
 * `benchmark-near-zero-rise.yml`, both `--max-cases 50` on RE2) were measured that way.
 *
 * ## Two conventions lived in one file, which is how the class survived
 *
 * `rcaeval-loader.ts` sorted a SUITE's case directories with `a.name.localeCompare(b.name)` at one line and
 * hand-rolled a code-unit comparator for its edge list eight hundred lines later — and the later one carries
 * the reason in a comment: *"Replacing the comparator with `localeCompare` would silence an unreachable arm
 * and blind that control, so it stays."* One file, two order conventions, and the machine-dependent one was on
 * the case list. `localeCompare` answers from ICU and the active locale, which are properties of the MACHINE;
 * a corpus's order has to be a property of the CORPUS. {@link compareCasePaths} is the one convention, and it
 * is code-unit order, because that is the only order two machines are guaranteed to agree on.
 *
 * ## What order can and cannot move — measured, so the fix is bounded
 *
 * `BenchmarkRunner.runSuite` computes `avgTop1`/`avgTop3`/`avgTop5` **before** its only stateful call
 * (`this.calibrator.train(...)`, which happens after the metrics exist), and the calibrator's weights are read
 * by nothing: `getCalibrator()` has no callers, and `WeightCalibrator`'s own docblock says *"Its weights are
 * never consumed … Training it therefore has no effect on any prediction."* So an UNCAPPED run's metric is
 * order-independent, which is why the published nine cells may not move — and a capped run's **SET** is not,
 * which is what this module repairs.
 *
 * ## The reader is injectable on purpose
 *
 * The claim is not "the output is sorted on this filesystem". It is **the order is a function of the SET, not
 * of the traversal**, and the only way to assert that is to hand the walk two permutations of one directory.
 * `readdirSync`'s order is unspecified, so a test that relied on the filesystem to produce a scramble would be
 * asserting a fact about APFS. {@link CaseWalkOptions.readdir} exists so the property can be stated.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// The order convention's ONE owner, imported rather than restated: it lives in the kinetic package because the
// RCAEval loader's own suite-case sort has to reach it, and a comparator placed in this package could only be
// read back from there through a dependency inversion.
import { inCaseOrder } from '../../packages/kinetic/src/benchmarks/case-order.js';

/**
 * One directory entry, as much of `Dirent` as the walk reads.
 *
 * Narrowed rather than reusing `Dirent` because the walk never needs the rest, and because a test must be able
 * to supply a traversal — which a full `Dirent` would make awkward without reaching for `Object.create`.
 */
export interface WalkDirent {
  /** The entry's own name, not its path. */
  readonly name: string;
  /** Whether the entry is a directory (and may therefore be descended into). */
  isDirectory(): boolean;
  /** Whether the entry is a file (used only to find the marker). */
  isFile(): boolean;
}

/** A directory reader. Injectable; defaults to `readdirSync` with `withFileTypes`. */
export type DirectoryReader = (dir: string) => readonly WalkDirent[];

/** What a traversal needs to know about the corpus. */
export interface CaseWalkOptions {
  /** The directory the traversal starts from. It may itself be a case directory. */
  readonly root: string;
  /** The file whose presence makes a directory a CASE directory (`metrics.json` / `case.json`). */
  readonly marker: string;
  /** The reader. Defaults to `readdirSync(root, { withFileTypes: true })`. */
  readonly readdir?: DirectoryReader;
}

/** The default reader: `readdirSync`, whose order is unspecified and therefore must not be relied on. */
const READDIR: DirectoryReader = (dir) => readdirSync(dir, { withFileTypes: true });

/**
 * Every case directory under `root`, in canonical order.
 *
 * Breadth-first, so a nested corpus is reached; a directory carrying `marker` is a case and is **terminal**,
 * because descending into it would report one case twice; dot-directories are pruned, because a stray `.git`
 * is not a case. A directory that cannot be read is skipped rather than fatal — a corpus with one unreadable
 * subtree is a corpus, and throwing here would make the caller's own diagnostic unreachable.
 *
 * @param options - The root, the marker and an optional reader.
 * @returns Absolute directory paths, in {@link compareCasePaths} order.
 */
export function walkCaseDirectories(options: CaseWalkOptions): string[] {
  const { root, marker } = options;
  const readdir = options.readdir ?? READDIR;
  const found: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries: readonly WalkDirent[];
    try {
      entries = readdir(current);
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === marker)) {
      found.push(current);
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) queue.push(join(current, entry.name));
    }
  }
  return inCaseOrder(found, (dir) => dir);
}

/** What a discovery needs: a traversal, and the parser that turns a directory into a case or nothing. */
export interface CaseDiscoveryOptions<M> extends CaseWalkOptions {
  /** A case directory's parse, or `null` when the directory is not a case the caller can read. */
  readonly parse: (dir: string) => M | null;
}

/**
 * Parse every case directory under `root`, in the traversal's canonical order.
 *
 * The composition every runner performs, extracted so the ORDER is the walk's rather than each site's — a
 * runner that walked and then sorted its own output could drift from the others, and the two that did neither
 * are why this exists.
 *
 * @param options - The root, marker, parser and optional reader.
 * @returns The parsed cases, canonical, with unparseable directories dropped.
 */
export function discoverCaseMetas<M>(options: CaseDiscoveryOptions<M>): M[] {
  const found: M[] = [];
  for (const dir of walkCaseDirectories(options)) {
    const meta = options.parse(dir);
    if (meta !== null) found.push(meta);
  }
  return found;
}
