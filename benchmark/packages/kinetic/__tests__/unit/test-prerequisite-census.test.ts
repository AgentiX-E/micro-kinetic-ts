/**
 * Every repository file the test suites treat as a prerequisite — a derived census, and the named failure.
 *
 * ## Why
 *
 * In iteration 99 a fence read `docs/competitor-artefact-availability.md` at module scope and the document
 * landed in a **later commit** than the test. `Release` on the revision between them failed with
 *
 *     Error: ENOENT: no such file or directory, open '.../docs/competitor-artefact-availability.md'
 *
 * and it took a log fetch to read, because a bare `ENOENT` looks like a broken environment. The revision is
 * not self-consistent: **a suite is part of what a commit means**, so a document a suite reads is part of the
 * commit too — and nothing had ever declared that relationship, so nothing could see it.
 *
 * ## What it asserts
 *
 * 1. The population is DERIVED from the suites' own sources — every `resolve(repoRoot, '<path>')` literal, so
 *    a new prerequisite cannot arrive without being counted.
 * 2. Every one of them EXISTS. This is the direction that catches a **deleted** document: the register's own
 *    fence guarantees every `docs/*.md` is named by the register, so a deletion has to be a decision — and it
 *    must not silently take a suite with it.
 * 3. The failure for a missing prerequisite is NAMED. Asserted directly on the helper, because the message is
 *    the whole difference between a one-line diagnosis and a log fetch.
 *
 * ## The limit, stated rather than implied
 *
 * No test can see git history, so nothing here can assert that a document and its reader landed in the same
 * commit. What is asserted is that the dependency exists, that it is enumerated, and that breaking it fails
 * LOUDLY. The ordering rule itself is a commit discipline, and it is written where the failure occurs — in
 * `support/repo-file.ts` — instead of being assumed.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readRepoFile } from './support/repo-file.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/**
 * Every `.ts` under any project's `__tests__` tree, plus the integration project's own sources.
 *
 * Discovered rather than listed, for the reason `vitest.config.ts` discovers its projects: a list of suites
 * is a copy that goes stale, and the population here has to include a suite added tomorrow.
 *
 * @returns Repository-relative paths, sorted.
 */
function suiteSources(): string[] {
  const found: string[] = [];
  const packagesDir = resolve(repoRoot, 'packages');
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const tests = resolve(packagesDir, entry.name, '__tests__');
    if (existsSync(tests)) collect(tests, `packages/${entry.name}/__tests__`, found);
  }
  const benchmarks = resolve(repoRoot, 'benchmarks/__tests__');
  if (existsSync(benchmarks)) collect(benchmarks, 'benchmarks/__tests__', found);
  const integration = resolve(repoRoot, 'integration-tests/src');
  if (existsSync(integration)) collect(integration, 'integration-tests/src', found);
  // THIS file is excluded, and the reason is the census's own subject: it TESTS the reader, so the paths it
  // passes are FIXTURES rather than prerequisites — one of them deliberately does not exist, and counting it
  // would report the census as its own missing file. The register's fence excludes itself for the same reason.
  return found.filter((f) => !f.endsWith(SELF)).sort();
}

/** Append every `.ts` under `dir` to `out`, as a repository-relative path. */
function collect(dir: string, prefix: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) collect(resolve(dir, entry.name), child, out);
    else if (entry.name.endsWith('.ts')) out.push(child);
  }
}

/** This census's own file, excluded from its population: see `suiteSources`. */
const SELF = 'test-prerequisite-census.test.ts';

const suites = suiteSources();

/**
 * Every `resolve(repoRoot, '<path>')` or `readRepoFile(repoRoot, '<path>')` literal in a suite source.
 *
 * Textual because that is what the dependency IS: the suites compute their root from their own location and
 * hand it to one of the two readers, and the literal is the whole declaration. **Both call shapes are matched
 * and that is the point**: routing a read through the helper would otherwise MOVE it out of this census's
 * population — a suite that stopped being counted because it started failing more clearly. A suite that
 * builds a path another way is outside the population, which is why the count is asserted rather than assumed.
 *
 * The literal must be PATH-SHAPED, and that is not cosmetic: this file's own docblock writes the pattern out
 * in order to describe it, so a loose `'([^']+)'` reads `<path>` as a prerequisite and reports this census as
 * its own missing file. **A fence that reads source text sees the text that documents it** — the register's
 * fence hit the same thing and had to exclude its own name, and the shape rule is the version that does not
 * need a name list at all.
 *
 * @param source - A suite's TypeScript source.
 * @returns The distinct literals, in source order.
 */
export function repoPathLiterals(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(
    /(?:resolve|readRepoFile)\(\s*repoRoot\s*,\s*'([A-Za-z0-9._/-]+)'/g,
  )) {
    if (!out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

describe('every repository path a suite resolves is a declared, existing prerequisite', () => {
  it('derives the population from the suites, and finds it non-trivial', () => {
    expect(suites.length).toBeGreaterThan(100);
    const paths = suites.flatMap((s) =>
      repoPathLiterals(readFileSync(resolve(repoRoot, s), 'utf8')),
    );
    // A census over an empty population passes for the wrong reason, so the population is asserted — and the
    // documents this iteration added are asserted by NAME, because they are the ones that broke.
    expect(paths.length).toBeGreaterThanOrEqual(3);
    expect(paths).toContain('docs/competitor-artefact-availability.md');
    expect(paths).toContain('docs/sota-comparison.md');
  });

  it('finds every one of them present', () => {
    const missing: string[] = [];
    for (const suite of suites) {
      for (const path of repoPathLiterals(readFileSync(resolve(repoRoot, suite), 'utf8'))) {
        if (!existsSync(resolve(repoRoot, path))) missing.push(`${path}  <-  ${suite}`);
      }
    }
    // A missing one is either a deleted document or a prerequisite that never landed — and both fail here
    // with the path and the suite that needs it, rather than as an `ENOENT` inside whichever suite ran first.
    expect(missing).toEqual([]);
  });

  it('refuses a missing prerequisite with the reason, not a bare ENOENT', () => {
    let message = '';
    try {
      readRepoFile(repoRoot, 'docs/this-document-does-not-exist.md');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('docs/this-document-does-not-exist.md');
    expect(message).toContain('PREREQUISITE');
    expect(message).toContain('SAME commit');
  });

  it('reads a present prerequisite unchanged', () => {
    const text = readRepoFile(repoRoot, 'docs/competitor-artefact-availability.md');
    expect(text).toContain('Competitor artefact availability');
  });

  it('rethrows anything that is not a missing file', () => {
    // The helper must not swallow a real read error — an unreadable file is a different defect and the
    // named message would misattribute it to a missing commit.
    expect(() => readRepoFile(repoRoot, 'docs')).toThrow();
  });
});
