/**
 * Guards on the coverage POPULATIONS, and on the command that runs them.
 *
 * A coverage percentage is meaningless without the population it was computed over, and this
 * repository had two places where the population was not stated:
 *
 * 1. `pnpm coverage` was `vitest run --coverage` — ONE workspace run. In workspace mode vitest takes
 *    the whole repository as the coverage population and does NOT carry each project's
 *    `coverage.include`/`exclude` into the merged report, so a file a package explicitly EXCLUDES
 *    (`packages/core/src/types/graph.ts`) appears in it, alongside each package's built `dist`
 *    bundle, `packages/kinetic/bin/cli.js`, `scripts/**` and the whole of `benchmarks/src/**`.
 *    Measured on 2026-09-20: the merged report held **191 files and read `All files 58.08%`** while
 *    exiting 0, and the SAME `ai` project reported **6 files at `100 / 100 / 100 / 100`** when run
 *    in its own directory — which is how CI runs it (`pnpm nx test @agentix-e/micro-kinetic-ai
 *    -- --coverage`). Worse than the headline: the configured `thresholds` are dropped in that mode
 *    too, so the command that the project's own notes called "the root coverage gate" enforced
 *    NOTHING.
 * 2. `integration-tests/vitest.config.ts` carried a `coverage` block with neither an `include` nor a
 *    `thresholds`, which resolved to an EMPTY population: `All files | 0 | 0 | 0 | 0` over zero
 *    files, exit 0. A table that reads as a measurement over nothing.
 * 3. The command that replaced it asked for coverage by APPENDING the flag — `nx run-many
 *    --target=test --all … -- --coverage` — and an appended argument travels nx → package manager →
 *    script. Whether it arrives is a property of the PACKAGE MANAGER, not of this repository.
 *    Measured 2026-09-25 in the development environment: `pnpm coverage` ran all 14 projects, ran
 *    3,164 tests, exited 0, printed no coverage table and rewrote no report file — because the
 *    package manager's last line is `exec sh -c "$cmd"`, which drops everything after the script
 *    name. The same form DOES forward on CI (the job log shows `> vitest run "--coverage"` and
 *    `Coverage enabled with v8`, and a 100 kB artifact), so the gate itself was real and the local
 *    command was a silent no-op that reported success. **A percentage nobody can reproduce is not a
 *    measurement**, and a fence that reads a command's SPELLING cannot see a flag that was dropped.
 *
 * So the rules here are structural, and their population is DERIVED rather than listed — a hand
 * maintained list of configs would rot the same way the population did:
 *
 * - a config that declares coverage MUST state its population (`include`) and its bar (`thresholds`,
 *   all four dimensions at the repository's 95%);
 * - the root `coverage` script MUST run the per-project target rather than one merged run, so the
 *   numbers it prints are the numbers that gate;
 * - the coverage request MUST be a TARGET whose script body holds the flag — every project with a
 *   bar declares `test:coverage`, and no workflow appends `--coverage` after `--`;
 * - the projects that script EXCLUDES must be exactly the projects that carry no bar, checked in
 *   BOTH directions so neither side can drift alone.
 *
 * @module __tests__/unit/coverage-population
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/** The repository's own bar, stated once so the fence and the configs cannot disagree silently. */
const BAR = 95;

/** One project, as this file sees it: its directory, its nx name and its coverage config. */
interface Project {
  readonly dir: string;
  readonly name: string;
  readonly configPath: string;
  readonly coverage: {
    readonly include?: readonly string[];
    readonly thresholds?: Readonly<Record<string, number>>;
  };
}

/** The `name` field of a package manifest, which is what nx and `--exclude` address. */
function packageName(dir: string): string {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, dir, 'package.json'), 'utf8')) as {
    name?: string;
  };
  if (manifest.name === undefined) throw new Error(`${dir}/package.json states no name`);
  return manifest.name;
}

/**
 * Every project that could carry a coverage config.
 *
 * The `packages` tree is read from the filesystem rather than listed, so a new package enters this
 * fence by existing; the two directories outside it are named because nx addresses them by path and
 * there are exactly two (`ci.yml` says the same thing where it explains why `benchmarks` is its own
 * job).
 */
function projectDirs(): string[] {
  const packages = readdirSync(resolve(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .sort();
  return [...packages, 'benchmarks', 'integration-tests'];
}

/** The projects that have a vitest config, with its default export's `test.coverage` block. */
async function projects(): Promise<Project[]> {
  const found: Project[] = [];
  for (const dir of projectDirs()) {
    const configPath = resolve(repoRoot, dir, 'vitest.config.ts');
    let module: { default?: { test?: { coverage?: Project['coverage'] } } };
    try {
      module = (await import(pathToFileURL(configPath).href)) as typeof module;
    } catch {
      continue; // A project without a vitest config carries no coverage question at all.
    }
    found.push({
      dir,
      name: packageName(dir),
      configPath,
      coverage: module.default?.test?.coverage ?? {},
    });
  }
  return found;
}

/** A project manifest's `scripts`, as data. */
function manifestScripts(dir: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, dir, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

/** The root `package.json`'s scripts, as text and as data. */
const rootScripts = (): { text: string; scripts: Record<string, string> } => {
  const text = readFileSync(resolve(repoRoot, 'package.json'), 'utf8');
  return { text, scripts: (JSON.parse(text) as { scripts: Record<string, string> }).scripts };
};

describe('a coverage config states its population and its bar', () => {
  it('has every coverage block declare an include and four thresholds at the repository’s bar', async () => {
    const found = await projects();
    const carriers = found.filter((one) => Object.keys(one.coverage).length > 0);
    // The population of THIS assertion is derived, so it cannot pass over an empty set: three
    // projects carry a coverage block today and the number is asserted to be non-trivial rather
    // than assumed.
    expect(carriers.length).toBeGreaterThanOrEqual(2);

    for (const one of carriers) {
      const where = one.dir;
      expect(one.coverage.include, `${where} declares no coverage population`).toBeDefined();
      expect((one.coverage.include ?? []).length, `${where} names no files`).toBeGreaterThan(0);
      const thresholds = one.coverage.thresholds;
      expect(thresholds, `${where} declares no coverage bar`).toBeDefined();
      for (const dimension of ['statements', 'branches', 'functions', 'lines'] as const) {
        const value = thresholds?.[dimension];
        expect(value, `${where} states no ${dimension} threshold`).toBeDefined();
        expect(
          value ?? 0,
          `${where} asks ${String(value)}% of ${dimension}`,
        ).toBeGreaterThanOrEqual(BAR);
      }
    }
  });

  it('leaves a project with no bar OUT of the coverage command, and a project with one IN it', async () => {
    const { scripts } = rootScripts();
    const script = scripts['coverage'] ?? '';
    const excluded = (/-{1,2}exclude=([^ ]+)/.exec(script)?.[1] ?? '')
      .split(',')
      .filter((one) => one !== '')
      .sort();

    const found = await projects();
    const withBar = found
      .filter((one) => one.coverage.thresholds !== undefined)
      .map((one) => one.name)
      .sort();
    const withoutBar = found
      .filter((one) => one.coverage.thresholds === undefined)
      .map((one) => one.name)
      .sort();

    // BOTH directions: a project that gained a bar must stop being excluded, and one that lost it
    // must start being excluded — a one-sided check would let either half drift.
    expect(excluded).toEqual(withoutBar);
    expect(withoutBar.length).toBeGreaterThan(0);
    // And the carriers are what the command actually runs, which is the point of the exclusion list.
    expect(withBar.length).toBeGreaterThan(excluded.length);
  });
});

describe('the coverage command runs the gates, not one merged report', () => {
  it('delegates to the per-project coverage target', () => {
    const { scripts } = rootScripts();
    const script = scripts['coverage'] ?? '';
    // The property that matters: the numbers come from a command CI runs too, so a local run and
    // the gate cannot disagree. `--target=test` would match a prefix of `--target=test:coverage`, so
    // the assertion is anchored on the whole target name followed by whitespace.
    expect(script).toMatch(/nx\s+run-many\s+--target=test:coverage\s+--all/);
    expect(script).not.toMatch(/^\s*vitest\b/);
  });

  it('does not append the flag after `--`, where the package manager can drop it', () => {
    const { scripts } = rootScripts();
    // The regression this rule exists for: the appended form ran every suite, exited 0 and measured
    // nothing under a package manager that does not forward arguments. `-- --coverage` is exactly
    // the shape that cannot be checked from inside the repository, so it may not come back.
    expect(scripts['coverage'] ?? '').not.toMatch(/--\s+--coverage/);
  });

  it('has every project with a bar declare a coverage target that HOLDS the flag', async () => {
    const found = await projects();
    const withBar = found.filter((one) => one.coverage.thresholds !== undefined);
    const withoutBar = found.filter((one) => one.coverage.thresholds === undefined);
    expect(withBar.length).toBeGreaterThanOrEqual(2);

    for (const one of withBar) {
      const command = manifestScripts(one.dir)['test:coverage'] ?? '';
      expect(command, `${one.dir} carries a bar but declares no test:coverage script`).not.toBe('');
      expect(command, `${one.dir}'s test:coverage does not ask for coverage: ${command}`).toContain(
        '--coverage',
      );
    }
    // BOTH directions, so the pair cannot drift: a project with no bar may not carry a coverage
    // target (it would be excluded from the root command and still claim to be the gate), and the
    // one project that deliberately has no bar is `integration-tests`.
    for (const one of withoutBar) {
      expect(
        manifestScripts(one.dir)['test:coverage'] ?? '',
        `${one.dir} has no bar, so it may not declare a coverage target`,
      ).toBe('');
    }
    expect(withoutBar.length).toBeGreaterThan(0);
  });

  it('has NO workflow append the flag either', () => {
    // The same rule as the root script's, over the workflows — because CI is where a dropped flag is
    // least visible: the job still runs the suites, still uploads whatever `coverage/` holds, and
    // still concludes `success`.
    const dir = resolve(repoRoot, '.github/workflows');
    const files = readdirSync(dir).filter((file) => file.endsWith('.yml'));
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const file of files) {
      const text = readFileSync(resolve(dir, file), 'utf8');
      expect(text, `${file} appends --coverage after --`).not.toMatch(/--\s+--coverage/);
    }
    // The positive half: CI must actually ask for coverage, through the target.
    const ci = readFileSync(resolve(dir, 'ci.yml'), 'utf8');
    const calls = ci.match(/:test:coverage/g) ?? [];
    expect(calls.length, 'CI no longer runs the coverage target anywhere').toBeGreaterThanOrEqual(
      2,
    );
  });

  it('skips the cache, because a cached verdict belongs to another tree', () => {
    const { scripts } = rootScripts();
    // `nx.json`'s `test` target is cacheable and its `inputs` are `{projectRoot}/src/**` and
    // `{projectRoot}/__tests__/**` — which do NOT include a `vitest.config.ts`. A threshold raised
    // from 95 to 100 in a config would therefore leave the hash unchanged, and a cached run would
    // replay the old numbers as if they were measured on this tree.
    expect(scripts['coverage'] ?? '').toContain('--skip-nx-cache');
  });

  it('has ONE owner for the coverage gate, so no second command can claim it', () => {
    // The command is text, so a second command that also claims to be the gate is the thing to
    // fence: `test` runs the suites (no coverage) and `test:integration` runs the suite the coverage
    // command excludes. Neither may grow a `--coverage` of its own.
    const { scripts } = rootScripts();
    for (const name of ['test', 'test:integration', 'test:all']) {
      expect(scripts[name] ?? '', `${name} must not become a second coverage gate`).not.toContain(
        '--coverage',
      );
    }
  });
});
