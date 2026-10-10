/**
 * Guard on the population of a ROOT-LEVEL `vitest` run — i.e. of `pnpm test`.
 *
 * The coverage gate is per project and its population is fenced (`coverage-population.test.ts`). This file is
 * about the other command, the one that carries **no threshold at all**, which is exactly why its population
 * went unexamined: `pnpm test` is `vitest run` at the repository root, and what that runs is whatever the root
 * config declares.
 *
 * Measured 2026-09-27, before the fix:
 *
 * | | declared | ran | repository |
 * | --- | --- | --- | --- |
 * | projects | **13** | 13 | **15** |
 * | project-file pairs | — | **129** | 152 |
 * | tests | — | **3,211** | **4,042** |
 *
 * `vitest.workspace.ts` held one glob for `packages` and nothing else, so the `benchmarks` project — **25 test
 * files and 831 tests** — was not in the population, and the command **exited 0**. `release.yml` runs
 * `pnpm test:all`, so no release gate ran them either, and the record's own `coverage-gate-audit.md` §7
 * described this run as executing *"the whole suite (127 files, 3198 tests)"*: a claim about a population that
 * nothing connected to the command that decides it. The file was also **deprecated** — vitest 3 prints
 * `DEPRECATED` for it and removes it in the next major — and **no compiler read it**, so nothing could have
 * reported either fact.
 *
 * The rules here are structural, and their population is DERIVED:
 *
 * - every project config on disk is either a project of the ROOT run, or covered by a **named** separate
 *   command — so an exclusion has a name or it does not exist;
 * - the two sets are DISJOINT, so no suite runs twice under `test:all`;
 * - every project is reachable from some `package.json` script, so "not in `test`" cannot mean "unrunnable";
 * - the deprecated workspace file is gone, because the root config is what replaced it.
 *
 * @module __tests__/unit/test-population
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/** Directories the walk must not descend into: build output, caches, corpora. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.nx', 'artifacts']);

/**
 * Every project config in the tree, found by walking it.
 *
 * A walk rather than a glob over the three directories that happen to hold projects today: the root config is
 * excluded by position (it is the root, not a project), and everything else is included by existing. A project
 * added anywhere in the tree is therefore in this population the moment it has a config, which is what makes
 * the equality below a statement about the tree rather than about a second copy of the root config's list.
 *
 * @returns Sorted repository-relative config paths.
 */
function configsOnDisk(dir = repoRoot, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      configsOnDisk(full, found);
      continue;
    }
    if (!/^vitest\.config\.(ts|mts|js|mjs)$/.test(entry)) continue;
    const relative = full.slice(repoRoot.length + 1);
    // The root config IS the run's own declaration; every other one is a project it has to account for.
    if (relative === 'vitest.config.ts') continue;
    found.push(relative);
  }
  return found.sort();
}

/** `package.json`'s scripts, which is where a named command lives. */
function scripts(): Record<string, string> {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

/**
 * The configs a NAMED script runs instead of the root one, and the script that names each.
 *
 * Derived from `package.json`, because the point of the rule is that an exclusion must be addressable: a
 * project kept out of `test` has to be reachable by typing something. `test` itself is the root run and is
 * therefore not a separate command; every other `test:*` script that passes `--config` is one.
 *
 * @returns Repository-relative config path -> the script name that runs it.
 */
function namedSeparately(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [name, body] of Object.entries(scripts())) {
    if (name === 'test' || !name.startsWith('test')) continue;
    const pointed = /--config\s+(\S+)/.exec(body);
    if (pointed === null) continue;
    found.set(pointed[1]!.replace(/^\.\//, ''), name);
  }
  return found;
}

/** The projects the ROOT config declares, by importing it — the same object vitest reads. */
async function declaredByRoot(): Promise<string[]> {
  const module = (await import(pathToFileURL(resolve(repoRoot, 'vitest.config.ts')).href)) as {
    default?: { test?: { projects?: readonly unknown[] } };
  };
  const projects = module.default?.test?.projects;
  if (projects === undefined) throw new Error('vitest.config.ts declares no test.projects');
  return projects.map((one) => String(one).replace(/^\.\//, '')).sort();
}

describe('a root-level `vitest` run states its population, and its exclusions have names', () => {
  it('declares every project config on disk, less the ones a NAMED command covers', async () => {
    const onDisk = configsOnDisk();
    const declared = await declaredByRoot();
    const named = namedSeparately();
    // The union, both directions. A project added to the tree without being enrolled fails here; a declared
    // path that no longer exists fails here too, because `onDisk` is the tree.
    const union = [...declared, ...named.keys()].sort();
    expect(union).toEqual(onDisk);
    // Disjoint, so `test:all` (`test` then the named commands) runs no suite twice.
    for (const one of declared) expect(named.has(one), one).toBe(false);
  });

  it('is not satisfied by an empty or a single project, so the equality above is not vacuous', async () => {
    const declared = await declaredByRoot();
    const named = namedSeparately();
    // Thirteen packages plus `benchmarks`, against one named command. A floor rather than a literal list:
    // the literal list is what rotted, and the equality above is what the floor is protecting.
    expect(declared.length).toBeGreaterThanOrEqual(14);
    expect(named.size).toBeGreaterThanOrEqual(1);
    // The project whose absence this fence exists for, named rather than counted — a fence that could pass
    // with `benchmarks` missing would not have caught the defect it was written for.
    expect(declared).toContain('benchmarks/vitest.config.ts');
  });

  it('keeps every declared project reachable from a `package.json` script', async () => {
    // "Not in `test`" must not be able to mean "unrunnable": the excluded project has a command, and
    // `test:all` is the command that runs everything, so the union of what the scripts cover is the tree.
    const declared = await declaredByRoot();
    const named = namedSeparately();
    const every = scripts();
    expect(every['test']).toContain('vitest');
    // `test:all` composes the root run and the named one, so it covers the union by construction.
    expect(every['test:all']).toContain('pnpm test');
    for (const script of named.values()) expect(every['test:all']).toContain(`pnpm ${script}`);
    // …and nothing is left over: every config on disk is in one of the two sets.
    expect([...declared, ...named.keys()].sort()).toEqual(configsOnDisk());
  });

  it('has removed the DEPRECATED workspace file rather than amending it', () => {
    // vitest 3 prints `DEPRECATED  The workspace file is deprecated and will be removed in the next major`
    // for it, and no compiler read it — so the file could have gone on declaring 13 of 15 projects with
    // nothing able to say so. The assertion is on the absence of the FORM, so re-introducing it fails here.
    for (const deprecated of [
      'vitest.workspace.ts',
      'vitest.workspace.js',
      'vitest.workspace.mts',
    ]) {
      expect(existsSync(resolve(repoRoot, deprecated)), deprecated).toBe(false);
    }
    expect(existsSync(resolve(repoRoot, 'vitest.config.ts'))).toBe(true);
  });

  it('runs a project whose suite the root config names, measured rather than assumed', async () => {
    // The end of the chain: the declared array is not decoration — the config it names EXISTS and its
    // `include` selects files. A declared path that resolves to nothing would satisfy every assertion above.
    for (const one of await declaredByRoot()) {
      const module = (await import(pathToFileURL(resolve(repoRoot, one)).href)) as {
        default?: { test?: { include?: readonly string[] } };
      };
      const include = module.default?.test?.include;
      expect(include, one).toBeDefined();
      expect((include ?? []).length, one).toBeGreaterThan(0);
    }
  });
});
