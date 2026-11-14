/**
 * Find every case directory under a data root.
 *
 * One walk, parameterised by the marker file that identifies a case, because the two corpora this
 * repository reads mark their cases differently: the FSE'26 bridge writes a `case.json` per datapack and
 * the RCAEval archive writes a `metrics.json`. The walk itself — breadth-first, skip dot-directories, sort
 * the result — is the same, and it was written twice before this module existed: `run-fse26.ts` and
 * `run-optimize.ts` each carried a copy whose only difference was the marker. Two copies of a traversal is
 * a difference waiting to be discovered by a run that reads one corpus and reports the other.
 *
 * The walk does not match on directory NAMES: a datapack's directory is named after its case, and a reader
 * that keyed on the name would silently skip a corpus whose naming convention differed by one character.
 *
 * @module benchmarks/case-discovery
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';

/**
 * What a case directory is identified by.
 *
 * `case.json` is the FSE'26 bridge's marker; `metrics.json` is the RCAEval archive's.
 */
export type CaseMarker = 'case.json' | 'metrics.json';

/**
 * Discover every case directory under `dataDir`, in sorted order.
 *
 * Sorted rather than in readdir order, because a run that took `--max-cases 5` would otherwise evaluate a
 * different five on two machines, and the two runs would look like a difference in the configuration.
 *
 * @param dataDir - The root to walk.
 * @param marker - The file whose presence makes a directory a case. Default `case.json`.
 * @returns The case directories, sorted.
 */
export function discoverCaseDirs(dataDir: string, marker: CaseMarker = 'case.json'): string[] {
  const dirs: string[] = [];
  const queue: string[] = [dataDir];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    if (entries.some((entry) => entry.isFile() && entry.name === marker)) {
      dirs.push(current);
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) queue.push(join(current, entry.name));
    }
  }
  dirs.sort(compareCasePaths);
  return dirs;
}
