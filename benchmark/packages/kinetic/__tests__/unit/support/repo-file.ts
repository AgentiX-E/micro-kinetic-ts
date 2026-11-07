import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read a repository file a suite treats as a PREREQUISITE, and say so when it is missing.
 *
 * ## The defect this exists for
 *
 * Iteration 99's fence read `docs/competitor-artefact-availability.md` at module scope, and the document
 * landed in a LATER commit than the test — so commit `1fe6290` could not pass its own suite, and it took a
 * `Release` run to find it:
 *
 *     Error: ENOENT: no such file or directory, open '.../docs/competitor-artefact-availability.md'
 *
 * Three things were wrong, and only the first is about that commit.
 *
 * 1. **A commit that is not self-consistent.** The test and its subject were split across two commits, so
 *    `git bisect` over that range lands on a revision whose suite fails for a reason unrelated to its code.
 *    A suite is part of what a commit MEANS, so a document it reads is part of the commit too.
 * 2. **The dependency was implicit.** Nothing declared that this test needs that document; the only place the
 *    requirement existed was the `readFileSync` call. `test-prerequisite-census.test.ts` now derives every
 *    repository path the suites resolve and asserts each exists, so a deleted document fails the gate that
 *    owns it rather than the suite that happened to read it.
 * 3. **The failure was unnamed.** A bare `ENOENT` reads as a broken environment rather than as a missing
 *    prerequisite, which is why it took a log fetch to diagnose rather than a line of output.
 *
 * @param repoRoot - The repository root, as each suite computes it.
 * @param relativePath - The path, relative to the root, as the suite would write it.
 * @returns The file's contents.
 * @throws When the file is absent, naming it as a prerequisite and the rule it breaks.
 */
export function readRepoFile(repoRoot: string, relativePath: string): string {
  const absolute = resolve(repoRoot, relativePath);
  try {
    return readFileSync(absolute, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `\`${relativePath}\` is a PREREQUISITE of this suite and is not in this working tree.\n` +
          `A document a suite reads is part of what the commit MEANS: land it in the SAME commit as the ` +
          `suite that reads it, or the revision in between fails for a reason its own diff cannot explain.`,
      );
    }
    throw error;
  }
}
