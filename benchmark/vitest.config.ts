import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Every project under `packages/` that carries a vitest config, DISCOVERED rather than listed.
 *
 * Discovered because the list this file replaces was neither stated nor complete: `vitest.workspace.ts`
 * declared one glob for `packages` and nothing else, which resolved to 13 of the repository's 15 projects — so
 * `pnpm test` ran 3,211 of the 4,042 tests, exited 0, and left the `benchmarks` project's **25 files and 831
 * tests** out of the population with no statement anywhere. `release.yml` runs `pnpm test:all`, so a release
 * gate never ran them either. Reading the directory means a new project is enrolled by existing, which is the
 * only version of this that cannot drift.
 *
 * @returns Repository-relative paths to the package projects' configs, sorted for a stable order.
 */
function packageProjects(): string[] {
  const packages = resolve(here, 'packages');
  return readdirSync(packages, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(resolve(packages, entry.name, 'vitest.config.ts')),
    )
    .map((entry) => `packages/${entry.name}/vitest.config.ts`)
    .sort();
}

/**
 * The projects a root-level `vitest` run executes.
 *
 * **This is the population of `pnpm test`**, and it is a claim in its own right: the root command carries no
 * coverage threshold, so the only thing wrong with a narrow population was that nobody could see it. The two
 * children of this array are therefore each a decision:
 *
 * - the **package projects** plus **`benchmarks/`** — every project whose suite runs without credentials. The
 *   `benchmarks` project pins its own `root` precisely so that a root-level invocation can reach it, and until
 *   this file existed nothing invoked it that way.
 * - **`integration-tests/` is absent, and that is a decision with a name**: `pnpm test:integration` runs it
 *   under its own config and `pnpm test:all` is `test` followed by `test:integration`, so enrolling it here
 *   would run that suite twice and change what `test:all` means. An exclusion nobody decided is not an
 *   exclusion, so `packages/kinetic/__tests__/unit/test-population.test.ts` asserts that the projects this
 *   file leaves out are exactly the ones a NAMED separate command covers — in both directions, against a walk
 *   of the tree rather than against a second copy of this list.
 *
 * `vitest.workspace.ts` is gone rather than amended: vitest 3 reports it as `DEPRECATED` and removes it in the
 * next major, and `test.projects` is what it points at.
 */
export default defineConfig({
  test: {
    projects: [...packageProjects(), 'benchmarks/vitest.config.ts'],
  },
});
