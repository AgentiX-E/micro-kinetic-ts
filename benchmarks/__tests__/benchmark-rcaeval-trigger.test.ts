/**
 * Guards on WHICH CHANGES run the golden benchmark.
 *
 * The kill criterion has two halves, and the second one — "RCAEval golden 9-cell byte-identical" — is
 * a claim about a run. `.github/workflows/benchmark-rcaeval.yml` is the only workflow that produces
 * those nine cells, and its `push` filter listed `benchmarks/src/**` plus two python/shell paths but
 * NOT the engine: a change to `packages/<name>/src/**`, which is where the ranking lives, landed
 * with no golden verification at all. A criterion nothing runs is not a criterion — the same shape as
 * the coverage matrix, where six packages carried a threshold nobody executed.
 *
 * Read as TEXT rather than parsed, because the failure mode is a MISSING ENTRY IN A LIST and nothing
 * but the list itself can see that.
 *
 * @module __tests__/benchmark-rcaeval-trigger
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const WORKFLOW = readFileSync(resolve(repoRoot, '.github/workflows/benchmark-rcaeval.yml'), 'utf8');

/**
 * The `push.paths` entries, exactly as written.
 *
 * Scoped to the `push:` block, so an entry under `workflow_run:` or inside a job's `paths` can never
 * satisfy a check that is about the TRIGGER.
 */
function pushPaths(): string[] {
  const start = WORKFLOW.indexOf('push:');
  expect(start).toBeGreaterThan(-1);
  const rest = WORKFLOW.slice(start);
  const end = rest.indexOf('workflow_run:');
  const block = end === -1 ? rest : rest.slice(0, end);
  return [...block.matchAll(/^\s+- '([^']+)'/gm)].map((m) => m[1]!);
}

describe('the golden benchmark is triggered by the engine it measures', () => {
  it('runs when any package’s sources change', () => {
    // `packages/tree` holds the shipped score, the weights and the pruner. Without this entry an
    // engine change — the only kind that can move the 9-cell — triggers nothing.
    expect(pushPaths()).toContain('packages/*/src/**');
  });

  it('still runs on the benchmark sources it already covered', () => {
    expect(pushPaths()).toContain('benchmarks/src/**');
  });

  it('does not run for tests or docs, which move no number', () => {
    // The filter is also a claim about cost: a 20-minute run must not be spent on a path that cannot
    // change a ranking, and a filter broadened to `packages/**` would fire on every test edit.
    const wouldFire = pushPaths().filter(
      (entry) => entry.includes('__tests__') || entry.startsWith('docs/'),
    );
    expect(wouldFire).toEqual([]);
  });
});
