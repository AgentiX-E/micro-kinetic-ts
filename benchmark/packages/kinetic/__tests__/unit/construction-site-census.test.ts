/**
 * How many places build the engine, and what kind of place each one is.
 *
 * ## Why this exists
 *
 * Three consecutive iterations each found the same defect in a different engine construction site — the
 * FSE'26 runner's line, the golden runner's joined two arguments, the ablation runner's flags-to-weights
 * mapping — and each was fixed by extracting the site's option assembly into a module, for the reason all
 * three share: a runner that calls `main()` at import time cannot be imported, so neither its option
 * assembly nor the line recording it can be called by a test.
 *
 * The record then said there were **three** such sites. That was a number nobody had counted: it meant "the
 * three benchmark RUNNERS that produce the register's artifacts", and it was written as if it were about
 * construction in general. `new TreePruner` appears in eight places across the package sources and the
 * benchmark runners. A number a document remembers is exactly the kind of statement this repository has
 * learned to replace with a measurement, so this census replaces it: the population is derived, each site is
 * CLASSIFIED, and the classification is asserted as an exact set — so a ninth site, or a site that changes
 * kind, fails here rather than aging in prose.
 *
 * ## The four kinds, and why each is legitimate or not
 *
 * - **derived** — the two arguments come from a module that also renders the configuration line. This is the
 *   shape the three artifact-producing runners were moved to, and it is the only shape that can be held to
 *   "the artifact states what the run used".
 * - **shipped-defaults** — `new TreePruner()` with no arguments. Legitimate, and it is the strongest form of
 *   it: the shipped configuration IS the engine's defaults, so there is nothing to state that the engine's
 *   own declaration does not already say.
 * - **authored-literal** — a hand-written object at the call site. Legitimate for the TREE package's own
 *   factory, which is a documented starting point rather than a measured artifact — but it is the shape that
 *   produced every defect of the last three iterations, so each instance has to be named here.
 * - **mapped-config** — the arguments are produced by a function that maps a configuration object. This is
 *   the optimizer's path, and it is where the residue lives: a mapping that does not set a field does not
 *   leave it out of the run, it INHERITS it, and the search artifact that reads the mapping's result named
 *   seven of the seventeen options its engine uses.
 *
 * @module packages/kinetic/__tests__/unit/construction-site-census
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
// Four levels up from `packages/<pkg>/__tests__/unit`, which is the depth the neighbouring census
// (`shipped-declaration-census.test.ts`) resolves to as well — one repository root, one spelling.
const REPO_ROOT = resolve(HERE, '../../../..');

/**
 * Where a construction site can live: every package's sources and the benchmark runners.
 *
 * A package is a directory that HAS a `src`, rather than every directory under `packages` — the
 * workspace's own `node_modules` sits there and is not a package, and a walk that assumed it was fails
 * with ENOENT rather than reporting a false site, which is at least the safe direction.
 */
const ROOTS = [
  ...readdirSync(resolve(REPO_ROOT, 'packages'), { withFileTypes: true })
    // Resolved against the repo root, not the process cwd: vitest runs with cwd at the PACKAGE, so a
    // cwd-relative existence check rejects every package and the census silently reports the benchmark
    // runners alone. That is what the first version of this file did.
    .filter((e) => e.isDirectory() && existsSync(resolve(REPO_ROOT, 'packages', e.name, 'src')))
    .map((e) => join('packages', e.name, 'src')),
  join('benchmarks', 'src'),
];

/** Every `.ts` under a root, relative to the repository. */
function sources(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
  };
  walk(resolve(REPO_ROOT, root));
  return found;
}

/**
 * Drop comments before matching.
 *
 * Load-bearing here rather than defensive: this file's own subject is a source SHAPE, and three of the
 * matches a raw read finds are `new TreePruner(` inside doc comments — including one in
 * `optimize/integration.ts` describing the equivalence `new TreePruner()` that its own code does not use.
 * A census of syntax that counts prose is a census of prose.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** What kind of place builds the engine. */
type SiteKind = 'derived' | 'shipped-defaults' | 'authored-literal' | 'mapped-config';

interface Site {
  readonly where: string;
  readonly kind: SiteKind;
}

/**
 * Every construction site, classified by the shape of its arguments.
 *
 * @returns The sites, sorted by location.
 */
function constructionSites(): Site[] {
  const sites: Site[] = [];
  for (const root of ROOTS) {
    for (const path of sources(root)) {
      const text = code(readFileSync(path, 'utf8'));
      // The argument list cannot contain `)` before the call closes, which holds for every shape here:
      // no call site nests another call except the mappers, which are single identifiers.
      for (const m of text.matchAll(/new TreePruner\(([^)]*)\)/g)) {
        const args = m[1]!.trim();
        const kind: SiteKind =
          args === ''
            ? 'shipped-defaults'
            : /^[A-Za-z_$][\w$]*\.signals\s*,\s*[A-Za-z_$][\w$]*\.topology$/.test(args)
              ? 'derived'
              : /^[A-Za-z_$][\w$]*$/.test(args)
                ? 'mapped-config'
                : 'authored-literal';
        sites.push({ where: relative(REPO_ROOT, path), kind });
      }
    }
  }
  return sites.sort((a, b) => a.where.localeCompare(b.where) || a.kind.localeCompare(b.kind));
}

const SITES = constructionSites();

/** The kinds, by name, for the assertions below. */
function sitesOfKind(kind: SiteKind): string[] {
  return SITES.filter((s) => s.kind === kind).map((s) => s.where);
}

describe('every place that builds the engine, classified', () => {
  it('finds the population, so the census is not vacuous', () => {
    // Non-vacuity both ways: a walk that broke would report nothing, and a classifier that collapsed every
    // argument shape into one bucket would report a population with one kind in it.
    expect(SITES.length).toBeGreaterThan(6);
    expect(new Set(SITES.map((s) => s.kind)).size).toBeGreaterThan(2);
  });

  it('records each kind as an exact set, so a ninth site cannot arrive unnoticed', () => {
    // THE CLAIM THIS FILE EXISTS FOR. The record said "three engine construction sites"; three is the
    // number of DERIVED sites — the benchmark runners that produce the register's artifacts — and the
    // other five are needed to say what the engine is built from anywhere. Asserted by name rather than
    // by count, so a site that MOVES between kinds is as visible as one that appears.
    expect(sitesOfKind('derived')).toEqual([
      'benchmarks/src/run-ablation.ts',
      'benchmarks/src/run-fse26.ts',
      'benchmarks/src/run-rcaeval.ts',
    ]);
    expect(sitesOfKind('shipped-defaults')).toEqual([
      'benchmarks/src/run-all.ts',
      'benchmarks/src/run-local-bench.ts',
      'packages/kinetic/src/di/container.ts',
    ]);
    expect(sitesOfKind('authored-literal')).toEqual(['packages/tree/src/di/factories.ts']);
    expect(sitesOfKind('mapped-config')).toEqual(['packages/optimize/src/integration.ts']);
  });

  it('keeps the artifact-producing runners on the shape that can be attributed', () => {
    // The three that produce a register artifact must be DERIVED — their two arguments built by a module
    // that also renders the line the artifact carries. This is what the three extractions bought, stated as
    // the property rather than as the diff: a runner that goes back to a literal fails here by name.
    for (const path of sitesOfKind('derived')) {
      const text = code(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
      expect(text, `${path} builds both arguments from one call`).toMatch(
        /new TreePruner\(\s*\w+\.signals\s*,\s*\w+\.topology\s*\)/,
      );
      expect(text, `${path} has no hand-written literal at the call site`).not.toMatch(
        /new TreePruner\(\s*\{/,
      );
    }
  });

  it('holds the shipped-defaults sites to having NO arguments at all', () => {
    // The strongest form of a configured engine is one that configures nothing: the shipped configuration is
    // the engine's defaults, so the engine's own declaration is the only owner of it. A site in this class
    // that started passing a partial would be a configuration whose author is no longer the engine.
    for (const path of sitesOfKind('shipped-defaults')) {
      const text = code(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
      expect(text, `${path} passes nothing`).toMatch(/new TreePruner\(\s*\)/);
    }
  });
});
