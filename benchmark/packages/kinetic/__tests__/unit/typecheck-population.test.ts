/**
 * The two `pnpm typecheck` legs cover DIFFERENT file trees, and a claim about which one sees what is a
 * claim about what two configs RESOLVE TO.
 *
 * **Why this file exists.** The record carried a statement about these two populations for two iterations —
 * that the PROJECT leg misses `benchmarks/__tests__` and the WORKSPACE leg covers it — and it was the wrong
 * way round. Nothing connected the statement to the configs that decide it, so nothing could contradict it,
 * and it survived a rewrite that repeated it. Measured 2026-09-26 the other way: adding a field to
 * `AnalyzeDumpOptions` produced three errors **inside `benchmarks/__tests__` that the project leg reported and
 * the workspace leg was clean on**.
 *
 * **The populations are read by the compiler, not by this file.** Two earlier versions of this fence got the
 * answer wrong in two different ways, and both are worth keeping in mind:
 *
 * 1. a hand-rolled JSONC comment stripper (`/\/\*[\s\S]*?\*\//`) **destroys the glob strings themselves** —
 *    `src/**\/*.ts` contains a star-slash sequence — and read `packages/core`'s include as `'src*.ts'`. The
 *    workspace config's own header warns about the same sequence from the other side.
 * 2. a hand-rolled glob matcher then disagreed with four configs, because `include` patterns are relative to
 *    the config's own directory while the trees being named are relative to the repository root.
 *
 * So neither the parsing nor the matching is written here: `ts.parseJsonConfigFileContent` is the function
 * `tsc` itself uses to turn a config into the list of files it compiles, and every assertion below is about
 * **that list**. A config change moves the list, and this fails until the claim is re-derived.
 *
 * @module packages/kinetic/__tests__/unit/typecheck-population
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The files a config compiles, as the COMPILER resolves them — `extends`, globs and excludes included. */
function compiledFiles(configRelative: string): readonly string[] {
  const absolute = path.join(REPO, configRelative);
  const read = ts.readConfigFile(absolute, (file) => readFileSync(file, 'utf-8'));
  if (read.error !== undefined) {
    throw new Error(
      `${configRelative}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(absolute));
  if (parsed.errors.length > 0) {
    throw new Error(
      `${configRelative}: ${ts.flattenDiagnosticMessageText(parsed.errors[0]!.messageText, ' ')}`,
    );
  }
  return parsed.fileNames.map((file) => path.relative(REPO, file).split(path.sep).join('/'));
}

/** The `typecheck` script of one project, which is what decides the config that leg compiles. */
function typecheckScript(project: string): string {
  const pkg = JSON.parse(readFileSync(path.join(REPO, project, 'package.json'), 'utf-8')) as {
    scripts?: Record<string, string>;
  };
  const script = pkg.scripts?.['typecheck'];
  if (script === undefined) throw new Error(`${project} declares no typecheck script`);
  return script;
}

/**
 * The config a project leg compiles.
 *
 * `tsc` with no `-p` compiles `tsconfig.json` in the working directory, so the config IS the project's own —
 * and that is asserted rather than assumed: {@link typecheckScript} is checked against `tsc --noEmit` for
 * every project below, so a leg repointed at `tsconfig.build.json` fails this file loudly instead of silently
 * changing the population. A defensive `-p` branch was written here first and removed: no project uses one,
 * so it was unreachable code pretending to be a derivation.
 *
 * @param project - The project directory, repository-relative.
 * @returns Its config, repository-relative.
 */
function cliConfig(project: string): string {
  return `${project}/tsconfig.json`;
}

const WORKSPACE_CONFIG = 'tsconfig.workspace.json';
const PROJECT = 'benchmarks';
/** One file from each of the trees in dispute, so every assertion below has a named subject. */
const BENCHMARK_TEST = `${PROJECT}/__tests__/fse26-diagnose-analyze.test.ts`;
const BENCHMARK_SOURCE = `${PROJECT}/src/fse26-diagnose-analyze.ts`;
const PACKAGE_TEST = 'packages/kinetic/__tests__/unit/coverage-population.test.ts';

describe('the two typecheck legs cover different trees, and neither covers both', () => {
  it('derives which config each leg uses, from the scripts, rather than assuming a filename', () => {
    const root = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf-8')) as {
      scripts: Record<string, string>;
    };
    expect(root.scripts['typecheck']).toContain(`tsc -p ${WORKSPACE_CONFIG}`);
    expect(root.scripts['typecheck']).toContain('nx run-many --target=typecheck --all');
    expect(cliConfig(PROJECT)).toBe(`${PROJECT}/tsconfig.json`);
    expect(typecheckScript(PROJECT)).toBe('tsc --noEmit');
  });

  it('the WORKSPACE leg does NOT compile the benchmark tests or sources', () => {
    const files = compiledFiles(WORKSPACE_CONFIG);
    // Non-vacuity first: an empty list satisfies every "does not contain" below.
    expect(files.length).toBeGreaterThan(0);
    // The wrong-way-round statement was exactly this fact inverted, so it is asserted by name.
    expect(files).not.toContain(BENCHMARK_TEST);
    expect(files).not.toContain(BENCHMARK_SOURCE);
    expect(files.some((file) => file.startsWith(`${PROJECT}/`))).toBe(false);
    // …and it does compile the trees it exists for, or the absences above would prove nothing.
    expect(files).toContain(PACKAGE_TEST);
  });

  it('the PROJECT leg DOES compile the benchmark tests and sources', () => {
    const files = compiledFiles(cliConfig(PROJECT));
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain(BENCHMARK_TEST);
    expect(files).toContain(BENCHMARK_SOURCE);
    // Its own root-level tool config, which is the difference from a package's BUILD config.
    expect(files.some((file) => file === `${PROJECT}/vitest.config.ts`)).toBe(true);
  });

  it('the two lists are neither equal nor one inside the other, which is why BOTH legs are run', () => {
    const workspace = compiledFiles(WORKSPACE_CONFIG);
    const project = compiledFiles(cliConfig(PROJECT));
    const workspaceOnly = workspace.filter((file) => !project.includes(file));
    const projectOnly = project.filter((file) => !workspace.includes(file));
    // Both directions, because a one-sided inclusion would make "run both" unnecessary rather than right.
    expect(workspaceOnly.length).toBeGreaterThan(0);
    expect(projectOnly.length).toBeGreaterThan(0);
    expect(workspaceOnly).toContain(PACKAGE_TEST);
    expect(projectOnly).toContain(BENCHMARK_TEST);
  });

  it('every project leg resolves its own config, so the project legs are a SET of legs', () => {
    // If a package's `typecheck` compiled the workspace config, the claim "the project legs cover
    // `packages/*/__tests__`" would really be a claim about the workspace leg — which does not.
    const projects = [
      'benchmarks',
      'packages/core',
      'packages/kinetic',
      'packages/tree',
      'packages/causal',
      'packages/wave',
    ];
    for (const project of projects) {
      const resolved = cliConfig(project);
      expect(typecheckScript(project), project).toBe('tsc --noEmit');
      expect(resolved, project).toBe(`${project}/tsconfig.json`);
      const files = compiledFiles(resolved);
      expect(files.length, `${resolved} compiles nothing`).toBeGreaterThan(0);
      // A package's build config compiles `src` only — the tests are the workspace leg's job, and the
      // benchmark project is the exception that carries its own.
      expect(
        files.some((file) => file.startsWith(`${project}/src/`)),
        project,
      ).toBe(true);
    }
    // The exception, stated rather than implied: only `benchmarks` carries its own `__tests__`.
    expect(compiledFiles(cliConfig('benchmarks'))).toContain(BENCHMARK_TEST);
    expect(compiledFiles(cliConfig('packages/core'))).not.toContain(PACKAGE_TEST);
    expect(compiledFiles(WORKSPACE_CONFIG)).toContain(PACKAGE_TEST);
  });
});

/**
 * `pnpm typecheck` is two legs over configs the tree decides, and the union of their file lists is the only
 * thing that stands between a new file and being read by no compiler at all.
 *
 * **Why this fence exists.** Measured 2026-09-27: **six** `.ts` files were read by no config — five under
 * `scripts/` that **five workflows run** (`dump-bothwrong-evidence`, `dump-loss-metrics`, `dump-re3-exceptions`,
 * `dump-re3-metrics`, `run-prism`) and the root `vitest.workspace.ts`. Nothing could report it, because a file
 * no config reaches is a file no compiler mentions: the absence of an error IS the defect. And the fifth of
 * those scripts decides the PRISM numbers the register cites.
 *
 * The rule is therefore not a list of files but the property itself: **every `.ts` file in the tree is in the
 * file list of at least one config `pnpm typecheck` runs.** A new file that no config reaches fails here,
 * which is the only form of this that survives the next file.
 *
 * Enrolling the five found **0 errors**, so this is a pure widening of the population rather than a fix with
 * work in it — which is its own reason to assert the property: the cost of the gap was never the errors it
 * hid, it was that nobody could see how much was unhidden.
 */
describe('no TypeScript file in this repository is read by no compiler', () => {
  /** Directories the walk must not descend into: build output, caches, corpora. */
  const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage', '.nx', 'artifacts']);

  /** Every `.ts`/`.tsx` file in the tree, repository-relative with forward slashes. */
  function everyTypeScriptFile(dir = REPO, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) everyTypeScriptFile(full, found);
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        found.push(path.relative(REPO, full).split(path.sep).join('/'));
      }
    }
    return found;
  }

  /** The directories nx gives a `typecheck` target to, read from the tree's manifests. */
  function legDirectories(): string[] {
    const packages = readdirSync(path.join(REPO, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}`);
    return [...packages, 'benchmarks', 'integration-tests'].sort();
  }

  /**
   * Every config `pnpm typecheck` compiles.
   *
   * Derived from the manifests rather than written out: a project enters this fence by declaring a
   * `typecheck` script, and the existing assertions above hold that script to `tsc --noEmit`, so
   * `<dir>/tsconfig.json` is what it compiles.
   *
   * @returns Repository-relative config paths.
   */
  function everyConfig(): string[] {
    const configs = [WORKSPACE_CONFIG];
    for (const dir of legDirectories()) {
      const manifest = path.join(REPO, dir, 'package.json');
      if (!existsSync(manifest)) continue;
      const parsed = JSON.parse(readFileSync(manifest, 'utf-8')) as {
        scripts?: Record<string, string>;
      };
      if (parsed.scripts?.['typecheck'] !== undefined) configs.push(`${dir}/tsconfig.json`);
    }
    return configs;
  }

  it('reads a config for every project leg plus the workspace leg', () => {
    const configs = everyConfig();
    // Non-vacuity: an empty config list would make the union below zero files and this file pass by silence.
    expect(configs.length).toBeGreaterThanOrEqual(15);
    expect(configs).toContain(WORKSPACE_CONFIG);
    expect(configs).toContain(`${PROJECT}/tsconfig.json`);
    expect(configs).toContain('packages/kinetic/tsconfig.json');
    for (const config of configs) expect(existsSync(path.join(REPO, config)), config).toBe(true);
  });

  it('unions their file lists and finds every file in the tree inside it', () => {
    const covered = new Set<string>();
    for (const config of everyConfig()) for (const file of compiledFiles(config)) covered.add(file);
    const all = everyTypeScriptFile();
    const uncovered = all.filter((file) => !covered.has(file));
    // The message is the deliverable: a bare `toEqual([])` on a 380-file population says nothing about which
    // file appeared, and the whole point is that the offender is silent everywhere else.
    expect(uncovered, `no compiler reads: ${uncovered.join(', ')}`).toEqual([]);
    // …and the walk is not measuring a handful of files. The floor is a reading of the tree, not a bar.
    expect(all.length).toBeGreaterThanOrEqual(370);
    expect(covered.size).toBeGreaterThanOrEqual(370);
  });

  it('names the trees the walk reaches, so its population is not a claim about one directory', () => {
    const all = everyTypeScriptFile();
    // One file from each tree this repository's TypeScript lives in, by name — a walk that quietly skipped a
    // directory would find fewer files and still satisfy the union assertion above.
    for (const file of [
      'vitest.config.ts',
      'scripts/run-prism.ts',
      'packages/kinetic/src/index.ts',
      'packages/kinetic/__tests__/unit/typecheck-population.test.ts',
      'benchmarks/src/run-fse26.ts',
      'benchmarks/__tests__/fse26-capability-census.test.ts',
      'integration-tests/src/pipeline.spec.ts',
    ]) {
      expect(all, file).toContain(file);
    }
  });

  it('reads every workflow-run script, which is the gap this fence was written for', () => {
    // Derived: every `.ts` under `scripts/`, held to the compilers rather than listed. Each of these is run by
    // a workflow and by nothing else, so a type error in one surfaces as a failed job that has already
    // downloaded a corpus — which is exactly why the workspace leg gained the globs rather than a new leg.
    const scripts = everyTypeScriptFile().filter((file) => file.startsWith('scripts/'));
    expect(scripts.length).toBeGreaterThanOrEqual(5);
    const workspace = compiledFiles(WORKSPACE_CONFIG);
    for (const script of scripts) expect(workspace, script).toContain(script);
    // And the root config, which is what replaced the deprecated workspace file this fence found.
    expect(workspace).toContain('vitest.config.ts');
  });
});
