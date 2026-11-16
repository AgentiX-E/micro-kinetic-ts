/**
 * The workflow's colour must be a statement about the measurement, not about the size of its transcript.
 *
 * Run `43901259774` failed with
 *
 *     $GITHUB_STEP_SUMMARY upload aborted, supports content up to a size of 1024k, got 1048k
 *
 * in the dashboard's `Post summary` step — that step `cat`-ed three whole console transcripts into a file
 * GitHub caps at 1 MB. Two consequences, and both are the reason this file exists:
 *
 *  - a run whose NINE CELLS ARE PERFECT can go red by printing one more census line, and
 *  - a run whose cells are ABSENT can go red for a reason that has nothing to do with them, so the colour
 *    carries no information about the numbers in either direction.
 *
 * The fix is a budget rather than a smaller transcript: each section is capped and SAYS it is capped, so the
 * total is bounded by construction. What is asserted here is the bound, because "we truncate" is not a bound.
 *
 * @module benchmarks/__tests__/step-summary-budget
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const WORKFLOW = readFileSync(resolve(repoRoot, '.github/workflows/benchmark-rcaeval.yml'), 'utf8');

/** GitHub's documented ceiling for a step summary, in bytes. */
const LIMIT = 1024 * 1024;

/** The `Post summary` step's script, exactly as written. */
function summaryScript(): string {
  const start = WORKFLOW.indexOf('- name: Post summary');
  expect(start).toBeGreaterThan(0);
  const next = WORKFLOW.indexOf('- name:', start + 1);
  return WORKFLOW.slice(start, next === -1 ? undefined : next);
}

describe('the benchmark step summary is budgeted', () => {
  it('caps every section instead of pasting whole transcripts', () => {
    const script = summaryScript();
    // The unbounded form, as text: a transcript pasted straight into the summary. `cat artifacts/… >> …` is what
    // aborted run 43901259774, and it is the shape a future edit would restore because it reads as the obvious
    // implementation. The helper's own `cat "$1"` is the BOUNDED path — it only runs when the file is under the
    // budget — so the fence is on the artifact path, which must never reach `cat` again.
    expect(script).not.toMatch(/cat\s+\S*artifacts\//);
    expect(script).toContain('SECTION_BYTES=');
    expect(script).toContain('head -c "$SECTION_BYTES"');
  });

  it('bounds the WHOLE summary by construction, not by remembering a number', () => {
    // Three sections, each at most `SECTION_BYTES`, plus the headers and the truncation notices. The budget has
    // to leave room for those, so the assertion is a margin rather than an equality: what it forbids is a
    // budget set so close to the limit that the notices push it over — which is how the limit was hit.
    const bytes = Number(/SECTION_BYTES=(\d+)/.exec(summaryScript())?.[1]);
    expect(Number.isFinite(bytes)).toBe(true);
    const sections = (summaryScript().match(/^ *emit /gm) ?? []).length;
    expect(sections).toBe(3);
    expect(sections * bytes).toBeLessThan(LIMIT * 0.95);
  });

  it('says in the summary that a section was truncated, and where the rest is', () => {
    // A silently short transcript is the defect this whole iteration is about, one level up: the artifact is
    // the record, and the summary is a view of it. A view that does not say it is a view is a record that lies
    // by omission.
    const script = summaryScript();
    expect(script).toContain('truncated:');
    expect(script).toContain('in the artifact');
  });

  it('still emits a section when the artifact is missing, rather than dropping it', () => {
    // The 43901259774 run's RCAEval artifact was EMPTY of usable cells; a summary that omitted the section
    // would have read as a workflow that never ran it.
    const script = summaryScript();
    expect(script).toContain("'No RCAEval results'");
    expect(script).toContain("'No ablation results'");
    expect(script).toContain("'No synthetic results available'");
  });
});
