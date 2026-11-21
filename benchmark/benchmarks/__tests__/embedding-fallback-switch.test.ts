/**
 * Guards the switch that decides whether a run measures the PUBLISHED configuration.
 *
 * Run 43901259774 reached the RE3 cells with an exhausted embedding balance and published four
 * `AC@1 0.0 %` rows over an empty denominator. The repair (iteration 294) asks the provider one
 * question before the corpus walk and refuses when it answers no. Refusing is the right DEFAULT: a
 * supplier's billing state is not a measurement, and a workflow that stays green through it is
 * telling a reader something untrue.
 *
 * But a red default with no way out is not a policy either — it is a permanently red workflow, and a
 * permanently red workflow stops being read. This file guards the way out: an explicit, operator-set
 * substitution that declares itself in every artifact it touches.
 *
 * ## Why a repository variable and not a dispatch input
 *
 * `workflow_dispatch` accepts at most 25 inputs and this workflow defines exactly 25. The census in
 * `packages/kinetic/__tests__/unit/dispatch-surface-census.test.ts` pins that count, and the entries
 * inside it are each fenced by their own tests — `diagnose_decimals` alone has five — because every
 * one of them closes the same hole: an option the runner accepts that no dispatch can state is a
 * configuration nobody can name. Freeing a slot would mean re-opening one of those holes to plug
 * this one.
 *
 * A repository variable costs no slot and answers a strictly better question. A dispatch input says
 * "this RUN was degraded"; an environment variable says "this REPOSITORY is currently degraded" —
 * which is what an exhausted balance is. It also reaches the runs a dispatch cannot: every push that
 * touches `packages/*\/src/**` starts this workflow, and those are the runs that produce the nine
 * cells day to day.
 *
 * ## The two arms
 *
 * | `vars.BENCHMARK_EMBEDDING_FALLBACK` | behaviour |
 * | --- | --- |
 * | unset / empty | the shipped strict arm: probe, refuse, exit non-zero, name the recharge |
 * | `local` | substitute the in-process TF-IDF provider, print `DEGRADED`, mark the artifact |
 *
 * The `|| ''` at the end of the expression is load-bearing: an unset variable renders as an empty
 * value and `parseEmbeddingFallback('')` answers `abort`. Without it a `null` would reach the
 * parser as the four-character string `null` and the run would die on the POLICY rather than on the
 * provider — a red that names the wrong cause.
 *
 * Read as TEXT, for the reason the trigger test gives: the failure mode is a MISSING DECLARATION in
 * a list of near-identical `env:` blocks, and only the text can see that one block of nine lacks it.
 *
 * @module __tests__/embedding-fallback-switch
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseEmbeddingFallback } from '../src/semantic-preflight.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const WORKFLOW = readFileSync(resolve(repoRoot, '.github/workflows/benchmark-rcaeval.yml'), 'utf8');

/** The declaration every step that can embed must carry, exactly as written. */
const SWITCH = "BENCHMARK_EMBEDDING_FALLBACK: ${{ vars.BENCHMARK_EMBEDDING_FALLBACK || '' }}";

/** Every step that hands the runner an embedding provider, counted by its own secret. */
const PROVIDER_STEPS = /ZHIPU_API_KEY: \$\{\{ secrets\.ZHIPU_API_KEY \|\| '' \}\}/g;

describe('every step that can embed carries the switch', () => {
  it('declares it once per provider step, so a new job cannot inherit the strict arm by omission', () => {
    // Paired COUNTS rather than a single presence check: the defect this guards is one of nine
    // identical `env:` blocks lacking the line, which a `toContain` on the file cannot see. Adding a
    // job that injects the key and forgets the policy moves the two numbers apart.
    const providerSteps = WORKFLOW.match(PROVIDER_STEPS)?.length ?? 0;
    const switches = WORKFLOW.split(SWITCH).length - 1;
    expect(providerSteps).toBeGreaterThan(0);
    expect(switches).toBe(providerSteps);
  });

  it('takes the value from a repository variable rather than a dispatch input', () => {
    // The input budget is full and each of its 25 entries is fenced. If a later iteration frees a
    // slot and moves this to `inputs.`, that decision has to be recorded here rather than inferred —
    // and the census test that pins the count is where the freed slot lands.
    expect(WORKFLOW).not.toMatch(/BENCHMARK_EMBEDDING_FALLBACK:\s*\$\{\{\s*inputs\./);
    expect(WORKFLOW).toContain('vars.BENCHMARK_EMBEDDING_FALLBACK');
  });

  it('never hard-codes an arm, in either direction', () => {
    // `local` here would make the CI permanently green on a substituted backend — the exact failure
    // the preflight exists to prevent, with the banner moved from the log into a variable nobody
    // reads. `abort` here is harmless but redundant, and it hides which arm the default is.
    expect(WORKFLOW).not.toMatch(/BENCHMARK_EMBEDDING_FALLBACK:\s*['"]?(?:local|abort)['"]?\s*$/m);
    expect(WORKFLOW).not.toMatch(/BENCHMARK_EMBEDDING_FALLBACK=(?:local|abort)/);
  });

  it("keeps the `|| ''` that turns an unset variable into the strict arm", () => {
    // Without the fallback operand GitHub renders an unset variable as an empty value rather than
    // skipping the assignment, and the two are only the same thing because `parseEmbeddingFallback`
    // maps BOTH `undefined` and `''` to `abort`. Asserting the operand keeps that agreement visible
    // from this side; the parser's half is the test below.
    expect(WORKFLOW).toContain("vars.BENCHMARK_EMBEDDING_FALLBACK || ''");
  });
});

describe('the strict arm is the default, end to end', () => {
  it('maps an unset or empty value to abort', () => {
    expect(parseEmbeddingFallback(undefined)).toBe('abort');
    expect(parseEmbeddingFallback('')).toBe('abort');
  });

  it('accepts the one substitution the workflow can set', () => {
    expect(parseEmbeddingFallback('local')).toBe('local');
    expect(parseEmbeddingFallback('abort')).toBe('abort');
  });

  it('refuses a third value rather than defaulting to either arm', () => {
    // A typo must not silently pick the strict arm (a reader believing the repository was degraded
    // when it was not) or the loose one (a substituted run published under the anchor's name).
    expect(() => parseEmbeddingFallback('Local')).toThrow(/takes abort or local/);
    expect(() => parseEmbeddingFallback('tfidf')).toThrow(/takes abort or local/);
  });
});

describe('the switch does not cost a dispatch input', () => {
  it('leaves the workflow at the 25 inputs the census pins', () => {
    const block = WORKFLOW.slice(WORKFLOW.indexOf('  workflow_dispatch:'));
    const inputs = block.slice(0, block.indexOf('\n  push:'));
    const names = [...inputs.matchAll(/^ {6}([a-z][a-z0-9_]*):$/gm)].map((match) => match[1]!);
    expect(names).toHaveLength(25);
    expect(names).not.toContain('embedding_fallback');
  });
});
