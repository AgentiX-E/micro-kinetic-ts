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

import { readFileSync } from 'node:fs';
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
