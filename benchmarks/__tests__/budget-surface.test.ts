/**
 * The budget is a MEASUREMENT KNOB and it stays on the measurement side.
 *
 * Iteration 344 was authorised to treat the round ceiling as a product switch, on one condition: **evaluation side
 * only**. This file is what "only" means in a form the build can check.
 *
 * The engine — `packages/*` — has no notion of an investigation budget at all. `DEFAULT_QUERY_BUDGET` lives in
 * `benchmarks/src/query-agent.ts` because it describes how many times a *model* may call a *tool*, which is a property
 * of the harness being measured and not of the ranking the product ships. `packages/optimize` does carry a field called
 * `maxRounds`, and it is a different object: an iteration ceiling for coordinate descent. The naming collision is the
 * reason this guard scans for the SPECIFIC vocabulary (`maxToolCalls`, `transcriptChars`, `usableCallsOf`) rather than
 * for the word "budget".
 *
 * The ceiling itself is not free: `usableCallsOf` exists because the last round of the loop is `forcing` — it accepts an
 * ANSWER and nothing else — so a budget that STATES ten calls can execute five. 341 published "4.99 of ten, half
 * unspent" and had to withdraw it for exactly this reason, which is why the derived number is pinned here and not just
 * the declared one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { usableCallsOf } from '../src/investigation-schedule.js';
import { DEFAULT_QUERY_BUDGET } from '../src/query-agent.js';

const benchDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = resolve(benchDir, '../');

/** Every `.ts` file under a directory, recursively. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...sources(full));
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const packages = resolve(repoRoot, 'packages');
const productSources = readdirSync(packages)
  .map((name) => resolve(packages, name, 'src'))
  .filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap((dir) => sources(dir));

const benchSources = sources(resolve(benchDir, 'src'));

describe('the budget surface', () => {
  it('states six rounds and ten calls, and derives five executable calls from them', () => {
    expect(DEFAULT_QUERY_BUDGET.maxRounds).toBe(6);
    expect(DEFAULT_QUERY_BUDGET.maxToolCalls).toBe(10);
    // The derived number is the one every reach estimate depends on. If a future edit changes either field, this line
    // fails before a document can quote a ceiling built on five calls that no longer exist.
    expect(usableCallsOf(DEFAULT_QUERY_BUDGET)).toBe(5);
  });

  it('does not reach the product: no package outside benchmarks knows the vocabulary', () => {
    const vocabulary = ['maxToolCalls', 'transcriptChars', 'usableCallsOf', 'QUERY_BUDGET'];
    const hits: string[] = [];
    for (const file of productSources) {
      const text = readFileSync(file, 'utf8');
      for (const word of vocabulary) {
        if (text.includes(word)) hits.push(`${file.replace(repoRoot, '')}: ${word}`);
      }
    }
    expect(hits).toEqual([]);
    // The scan is only meaningful if it found packages to scan.
    expect(productSources.length).toBeGreaterThan(20);
  });

  it('parses `--max-rounds` in exactly one file, so there is one place a dispatch can widen it', () => {
    const parsers = benchSources.filter((file) =>
      readFileSync(file, 'utf8').includes("'max-rounds'"),
    );
    expect(parsers.map((file) => file.slice(benchDir.length + 1))).toEqual([
      'src/run-query-agent.ts',
    ]);
  });

  it('exposes the ceiling as an optional dispatch input whose empty value means the default', () => {
    const workflow = readFileSync(
      resolve(repoRoot, '.github/workflows/benchmark-agentic.yml'),
      'utf8',
    );
    expect(workflow).toContain('query_max_rounds:');
    // An input that DEFAULTS to a wider budget would widen every dispatch that did not ask, which is the product
    // behaviour this file exists to keep on the measurement side.
    const block = workflow.slice(workflow.indexOf('query_max_rounds:'));
    const declared = block.slice(0, block.indexOf('type:'));
    expect(declared).toContain("default: ''");
  });
});
