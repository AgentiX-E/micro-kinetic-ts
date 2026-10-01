/**
 * The benchmark suite's coverage scope, diffed against what its tests actually import.
 *
 * `vitest.config.ts` declares an ALLOW-LIST of measured modules rather than an
 * `exclude` pattern, and its own comment records that the list had two holes before it
 * was first checked — the second of which had put 235 unmeasured lines of flag parsing
 * behind a wrong headline. Writing a third hole by hand is not a reason to stop
 * checking: a list is a CLAIM, and the cheapest way to falsify a claim about "what we
 * measure" is to compare it with "what we import".
 *
 * The comparison is exact and needs no exception list, because a runner entry point
 * cannot be imported by a test at all: `run-*.ts` calls `main()` at import time. A module
 * that a test DOES import is therefore a module with a testable surface, and it belongs
 * in the denominator.
 *
 * @module benchmarks/__tests__/coverage-scope.test
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(HERE, '../vitest.config.ts');
const TESTS_DIR = HERE;

/** Every file under `dir`, recursively. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

/** The `src/*.ts` modules a test imports directly, as bare names. */
function importedModules(): Set<string> {
  const names = new Set<string>();
  for (const file of walk(TESTS_DIR)) {
    if (!file.endsWith('.test.ts')) continue;
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/from '\.\.\/src\/([\w-]+)\.js'/g)) names.add(m[1]!);
  }
  return names;
}

/** The `src/*.ts` modules the coverage allow-list names, in file order. */
function listedModules(): string[] {
  const config = readFileSync(CONFIG_PATH, 'utf8');
  const coverageAt = config.indexOf('coverage:');
  expect(coverageAt, 'vitest.config.ts has no coverage block').toBeGreaterThan(-1);
  return [...config.slice(coverageAt).matchAll(/'src\/([\w-]+)\.ts'/g)].map((m) => m[1]!);
}

describe('benchmark coverage scope', () => {
  const listed = listedModules();
  const imported = importedModules();

  it('measures every module a test imports', () => {
    // The hole itself. A module with tests that is absent from the allow-list is
    // excluded from the denominator, so its own coverage is never measured and never
    // required — the tests pass and the gate does not exist.
    const unmeasured = [...imported].filter((name) => !listed.includes(name)).sort();
    expect(unmeasured, `imported by a test but not in coverage.include`).toEqual([]);
  });

  it('lists no module that nothing imports, and never twice', () => {
    // The other direction: a stale entry is an allow-list entry that measures nothing.
    // Duplicates are the same defect in miniature and were found here once, which is
    // how a hand-maintained list behaves when nothing diffs it.
    const stale = listed.filter((name) => !imported.has(name));
    expect(stale, 'in coverage.include but imported by no test').toEqual([]);
    expect(listed.length).toBe(new Set(listed).size);
  });

  it('finds both sides non-empty, so the comparison is not vacuous', () => {
    // Two empty sets are equal. Without this, a refactor that moved the tests or broke
    // the extraction would leave a green guard that compares nothing.
    expect(imported.size).toBeGreaterThan(5);
    expect(listed.length).toBeGreaterThan(5);
  });
});
