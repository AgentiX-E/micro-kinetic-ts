/**
 * Every single-quoted YAML scalar in `.github/workflows` must escape its own apostrophes.
 *
 * This file exists because one did not. Iteration 166 added the phrase `` `caller` restricts only the
 * caller's channel`` to the `ranking_knobs` description of `fse26-benchmark.yml`, inside a scalar that opens
 * and closes with `'`. The apostrophe in `caller's` closed the scalar 1 274 characters early, the rest of the
 * line became a bare YAML scalar, and GitHub rejected the whole file: the push-triggered validation run
 * (`41096212325`) failed with **no jobs and no logs**, which is what a workflow looks like when it never
 * parsed. `pnpm verify` was green throughout — nothing in the repository reads these files as YAML.
 *
 * The rule is decidable without a parser, which is why it is enforced without adding a dependency: inside a
 * single-quoted scalar, `''` is an escaped apostrophe and a lone `'` is the terminator. So after stripping the
 * opening and closing quote of a `description:` line, every remaining `'` must be followed by another one.
 *
 * The scope is deliberately narrow — lines that OPEN with `description: '` and CLOSE with `'` — because that
 * is the shape these workflows use for their long inputs, and a general YAML validator written here would be a
 * second parser to be wrong in its own way. A workflow that switched to a folded block (`>`) would leave this
 * guard silently unexercised, so the last test asserts the population is non-empty and names the files it saw.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_DIR = resolve(HERE, '../../../../.github/workflows');

/** A `description: '…'` line, in the single-line form every workflow here uses. */
const QUOTED_DESCRIPTION = /^\s*description: '(.*)'\s*$/;

/**
 * The first unescaped apostrophe in a single-quoted scalar's body, or `null` when every one is doubled.
 *
 * @param body - The scalar's text with its opening and closing quote removed.
 * @returns The index of the offending character, relative to `body`, or `null`.
 */
function firstUnescapedQuote(body: string): number | null {
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "'") continue;
    if (body[i + 1] === "'") {
      i++;
      continue;
    }
    return i;
  }
  return null;
}

/** Every workflow file, as `[name, text]` pairs. */
function workflows(): Array<readonly [string, string]> {
  return readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => [name, readFileSync(resolve(WORKFLOW_DIR, name), 'utf8')] as const);
}

describe('the platform’s own parser is the acceptance test, so the syntax it would reject is checked here', () => {
  it('reports the apostrophe that closed a scalar early, and not a doubled one', () => {
    // The historical string, verbatim: this is the input that produced a workflow with no jobs.
    // Assembled rather than written literally: a literal would have to escape the very character under test,
    // and a test that escapes it is a test of the escape. Double quotes for the fragments, by the same rule.
    const apostrophe = "'";
    const broken =
      '(`all` is the ablation arm of the shipped `external`, `caller' + apostrophe + 's channel)';
    expect(firstUnescapedQuote(broken)).toBe(broken.indexOf(apostrophe));
    // The repaired form, and a doubled apostrophe that is a legal escape rather than a terminator.
    expect(firstUnescapedQuote('(`caller` restricts only the caller-side channel)')).toBeNull();
    expect(firstUnescapedQuote("the caller''s channel")).toBeNull();
  });

  it('has no unescaped apostrophe in any workflow description', () => {
    const offenders: string[] = [];
    for (const [name, text] of workflows()) {
      text.split('\n').forEach((line, index) => {
        const match = QUOTED_DESCRIPTION.exec(line);
        if (match === null) return;
        const at = firstUnescapedQuote(match[1]!);
        if (at !== null) offenders.push(`${name}:${index + 1} column ${at + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('reads a non-empty population, so the guard cannot pass by finding nothing', () => {
    // Without this the first test could keep passing while every workflow moved to folded blocks that this
    // file does not model — a guard whose subject left is indistinguishable from a guard that holds.
    const counted = workflows().map(([name, text]) => [
      name,
      text.split('\n').filter((line) => QUOTED_DESCRIPTION.test(line)).length,
    ]) as Array<[string, number]>;
    const total = counted.reduce((sum, [, n]) => sum + n, 0);
    expect(total).toBeGreaterThanOrEqual(10);
    // Named rather than only counted: which file carries them is the fact a reader needs when the guard fires.
    // `fse26-benchmark.yml` is the file whose scalar broke; `benchmark-rcaeval.yml` writes its descriptions with
    // DOUBLE quotes, which is a different hazard (an unescaped `"` or `\`) and therefore outside this rule.
    expect(counted.filter(([, n]) => n > 0).map(([name]) => name)).toContain('fse26-benchmark.yml');
  });
});
