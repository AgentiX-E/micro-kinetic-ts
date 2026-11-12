/**
 * Guards on the agentic measurement line: where it runs, what it forwards, and where the corpus comes from.
 *
 * ## Why this file exists
 *
 * Iteration 268 found the two failures this file is written against, both in the same class: **a guard whose
 * exemption cannot be distinguished from its subject**. `sota-comparison.md` §31.1 printed a cell two enrolments
 * old because the anchor fence scanned five NAMED table regions and everything else was unfenced by default;
 * `cell-baseline.ts` skipped a run whose configuration digest differed from the baseline's, which is what an ARM
 * looks like — and also what a STALE BASELINE looks like, so the gate was green with all nine cells unread.
 *
 * The agentic line had its own version of it, one level up: the dumps the offline study consumes
 * (`--fingerprint-out`, `--per-case-out`) were reachable from a runner's command line but from no dispatch,
 * because `fse26-benchmark.yml` is AT the 25-input `workflow_dispatch` limit and `dispatch-surface-census`
 * pins that count as an exact 25. So the study was reproducible only on a machine that held ~19 GB of
 * converted corpus, which is why its numbers were read over 711 cases instead of 1 422.
 *
 * ## What is asserted, and why each one is not obvious
 *
 * 1. **The flags reach the runner.** A dump flag the workflow never passes is a dump that never exists; the
 *    study then fails on a missing file with no statement about which half was wrong.
 * 2. **`--fault-free-weight` is NOT passed.** `--fault-free-profile` is required by the fingerprint dump and
 *    supplies the BANDS the dump records, at the shipped weight of 0. A workflow that also forwarded a weight
 *    would be measuring a different configuration than the one the standing document quotes, while printing a
 *    number in the same table.
 * 3. **An empty input is never forwarded.** `--max-cases ''` parses to 0. Whether 0 means "all" or "none"
 *    depends on the flag's parser, and the rule the other workflow earned was: pass a flag only when its input
 *    is non-empty, so the runner's own default is the single owner of the configuration.
 * 4. **The corpus comes through ONE owner.** The three steps that fetch and verify it (resolve the tag from
 *    the converter digest, download, provenance gate) live in `.github/actions/rcabench-shards` and nowhere
 *    else. A second copy is how a gate ends up enforced in one workflow and skipped in another.
 * 5. **The study reads the artifact, not the corpus.** Job `study` has no `--data-dir` and no `rcabench` path
 *    in it, so a number it prints cannot be an accident of the data it happened to load.
 * 6. **The profile key is derived, not typed.** `cache-datasets.yml` records the version of this mistake that
 *    shipped: a constant key hit the cache the OLD pipeline had produced and converted nothing.
 * 7. **The prune applies on a schedule and reports on a dispatch.** A reclaim job that only runs when a human
 *    remembers runs after the eviction it was meant to prevent; a manual run that deletes by default is a foot
 *    on a shared budget.
 *
 * Read as TEXT rather than parsed. The repo has no YAML dependency (`workflow-scalars.test.ts` records why),
 * and every failure above is a MISSING OR EXTRA LINE, which is what a text scan sees.
 *
 * @module __tests__/agentic-workflow-wiring
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const WORKFLOW = readFileSync(resolve(repoRoot, '.github/workflows/benchmark-agentic.yml'), 'utf8');
const FSE26 = readFileSync(resolve(repoRoot, '.github/workflows/fse26-benchmark.yml'), 'utf8');
const ACTION = readFileSync(
  resolve(repoRoot, '.github/actions/rcabench-shards/action.yml'),
  'utf8',
);
const PRUNE = readFileSync(resolve(repoRoot, '.github/workflows/cache-prune.yml'), 'utf8');

/** The job blocks of a workflow, keyed by job id. */
function jobs(text: string): Map<string, string> {
  const found = new Map<string, string>();
  const starts = [...text.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index]!;
    const end = starts[index + 1]?.index ?? text.length;
    found.set(start[1]!, text.slice(start.index!, end));
  }
  return found;
}

/** The declared `inputs:` names of a workflow. */
function inputNames(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf('    inputs:');
  if (start < 0) return [];
  const names: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === '') continue;
    // The block ends at the first dedent, which is what makes this a scan of ONE block rather than of
    // every six-space key in the file.
    if (!line.startsWith('      ')) break;
    const match = /^ {6}([a-z][a-z0-9_]*):$/.exec(line);
    if (match !== null) names.push(match[1]!);
  }
  return names;
}

/** The workflow's lines with comments removed, so a claim in prose cannot satisfy a check on code. */
function codeLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

const WORKFLOW_CODE = codeLines(WORKFLOW);

describe('the agentic line runs where the corpus and the keys are', () => {
  it('passes the three dump flags the offline study consumes', () => {
    // Without these the study has no input. Each is a distinct artifact: the fingerprints carry the
    // posterior, the verdict file carries the labels as the corpus states them, and the profile is what
    // makes the band per channel measurable at all.
    expect(WORKFLOW).toContain('--fingerprint-out artifacts/agentic/fingerprints.ndjson');
    expect(WORKFLOW).toContain('--per-case-out artifacts/agentic/per-case.ndjson');
    expect(WORKFLOW).toContain('--fault-free-profile "$HOME/fault-free-profile.json"');
    // Non-vacuity: the flags are on a line that invokes the runner, not in a comment that mentions them.
    const invocations = WORKFLOW_CODE.split('\n').filter((line) =>
      line.includes('tsx benchmarks/src/run-fse26.ts'),
    );
    expect(invocations).toHaveLength(1);
  });

  it('does not forward a fault-free weight, so the published configuration is the one measured', () => {
    // The profile sets the BANDS. Its weight ships at 0 (`DEFAULT_FAULT_FREE_WEIGHT`), so passing the file
    // changes no ranking term; passing a weight as well would change the ranking and still print the same
    // column headings.
    // Checked against the code, not the prose: the block comment above the step NAMES the flag to explain
    // why it is absent, and a text scan over the whole file would call that explanation a violation.
    expect(WORKFLOW_CODE).not.toMatch(/--fault-free-weight/);
  });

  it('forwards an empty input to nothing, so the runner owns its own defaults', () => {
    // `--max-cases ''` parses to 0 and whether that means "all" or "none" is the parser's business. The
    // conditional form is the only shape that cannot silently change a configuration.
    expect(WORKFLOW_CODE).toContain('MAX_CASES_ARG=()');
    expect(WORKFLOW_CODE).toMatch(/if \[ -n "\$\{\{ inputs\.max_cases \}\}" \]; then/);
    expect(WORKFLOW_CODE).toMatch(/WEIGHT_ARG=\(\)/);
    // And it reaches the command line ONLY through that array: a flag written directly on the invocation
    // is an unconditional override wearing the conditional form's clothes.
    const invocation = WORKFLOW_CODE.slice(
      WORKFLOW_CODE.indexOf('tsx benchmarks/src/run-fse26.ts'),
      WORKFLOW_CODE.indexOf('tee artifacts/agentic/results.txt'),
    );
    expect(invocation).not.toBe('');
    expect(invocation).not.toMatch(/--max-cases/);
    expect(invocation).toContain('"${MAX_CASES_ARG[@]}"');
  });

  it('takes the corpus through the one action that owns it, and keeps no second copy', () => {
    // The defect this forbids is the one §0p records one level up: two copies of a gate, one of which goes
    // quiet. The provenance call appears in the action and in no workflow.
    expect(WORKFLOW).toContain('uses: ./.github/actions/rcabench-shards');
    // The workflow may READ the converter digest -- that is what keys the profile cache -- but it must not
    // run the gate: `--manifest` and `--cache-label` are the tell, and they appear in the action alone.
    expect(WORKFLOW).not.toContain('--manifest');
    expect(WORKFLOW).not.toContain('--cache-label');
    expect(ACTION).toContain('--manifest');
    expect(ACTION).toContain('--cache-label');
    expect(ACTION).toContain('fse26_cache_select.py');
  });

  it('reads only the artifacts in the study job, never the corpus', () => {
    // The boundary is what makes the control arm free and the reading checkable: the study cannot see the
    // data, so a number it prints is a property of the artifacts.
    const study = jobs(WORKFLOW).get('study');
    expect(study, 'the study job is missing').toBeDefined();
    expect(study).not.toContain('rcabench');
    expect(study).not.toContain('--data-dir');
    expect(study).toContain('name: agentic-measure');
    expect(study).toContain('run-agentic-headroom.ts');
    const measure = jobs(WORKFLOW).get('measure');
    expect(measure).toContain('name: agentic-measure');
  });

  it('derives the profile cache key instead of typing one', () => {
    // `cache-datasets.yml` records the version of this that shipped: the constant `RCAEvalJSON` hit the
    // cache the OLD bridge had produced, so the fix converted nothing and the step read `skipped`. Here the
    // key is the corpus digest times a digest of every source file the build reads.
    expect(WORKFLOW).toContain('id: key');
    expect(WORKFLOW).toContain('key: ${{ steps.key.outputs.key }}');
    expect(WORKFLOW).toContain('--digest');
    expect(WORKFLOW).toContain("pathlib.Path(root).rglob('*.ts')");
  });

  it('builds the profile over the whole corpus rather than the dispatched scope', () => {
    // The profile is a property of the CORPUS; an arm that rebuilt it per scope could not be compared with
    // an arm that read it, which is the reason `fault-free-profile-build.ts` is a separate step at all.
    const build = WORKFLOW.slice(WORKFLOW.indexOf('name: Build the fault-free profile'));
    const step = build.slice(0, build.indexOf('- name:', 10));
    expect(step).not.toMatch(/--max-cases/);
  });

  it('stays inside the dispatch input limit', () => {
    // The hard `workflow_dispatch` limit is 25. This file is a separate workflow PRECISELY because the
    // other one is at 25; the count is asserted on every workflow elsewhere, and here on this one because
    // the next axis will be tempted to arrive as a new input.
    expect(inputNames(WORKFLOW).length).toBeLessThanOrEqual(25);
    expect(inputNames(WORKFLOW).length).toBeGreaterThan(0);
  });

  it('leaves the other benchmark workflow at the exact 25 inputs the census pins', () => {
    // The reason this is a separate file. If a later iteration frees a slot, this assertion is where that
    // decision gets recorded rather than inferred.
    expect(inputNames(FSE26)).toHaveLength(25);
  });
});

describe('the shard action is one owner for the corpus', () => {
  it('declares the three outputs its callers read, each bound to a step that produces it', () => {
    const block = ACTION.split('\noutputs:\n')[1]!.split('\nruns:\n')[0]!;
    const names = [...block.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((match) => match[1]!);
    const values = [...block.matchAll(/^ {4}value: (.+)$/gm)].map((match) => match[1]!);
    expect(names).toEqual(['tag', 'categories', 'case-count']);
    // Every one names a step output rather than a literal, which is the difference between an output and a
    // second copy of the answer.
    expect(values).toEqual([
      '${{ steps.resolve.outputs.tag }}',
      '${{ steps.download.outputs.categories }}',
      '${{ steps.download.outputs.case-count }}',
    ]);
  });

  it('is used by BOTH consumers, so a gate cannot be re-inlined into one of them', () => {
    // The reason the action exists rather than the three steps being copied. `fse26-benchmark.yml` is the
    // consumer that existed first; if a later edit re-inlines the provenance call there, the two workflows
    // can disagree about which corpus is consumable and only one of them will say so.
    expect(FSE26).toContain('uses: ./.github/actions/rcabench-shards');
    expect(FSE26).not.toContain('fse26_provenance.py');
    expect(FSE26).not.toContain('releases/download');
  });

  it('refuses a cache, because the budget it would spend is already over quota', () => {
    // The measurement, recorded where the decision lives: 10.74 GB of a 10 GB budget, 5.69 GB of it
    // per-SHA CodeQL overlays. A 2.5 GB shard entry would buy a 114 s download and pay with the 3.9 GB
    // artifact that takes ~30 minutes to rebuild.
    expect(ACTION).not.toContain('uses: actions/cache');
    expect(ACTION).toContain('10 743 940 592');
    expect(ACTION).toContain('cache-prune.yml');
  });

  it('verifies provenance for a pinned tag too', () => {
    // The pinned path skips DISCOVERY, never the check: a pinned tag whose manifest came from another
    // converter must still be refused, or the pin becomes an override.
    expect(ACTION).toContain('Cache tag PINNED by the caller');
    // The gate step is UNCONDITIONAL: no `if:` on it means a pinned tag cannot skip it, which is the
    // shape the old inline version had (the pin branch `exit 0`d out of discovery and the check ran anyway
    // -- but nothing in the old file said so, so nothing stopped the next edit from moving it inside the
    // discovery step).
    const gate = ACTION.slice(ACTION.indexOf('- name: Verify cache provenance'));
    expect(gate).not.toMatch(/^\s+if:/m);
    expect(gate).toContain('--cache-label');
  });
});

describe('the cache reclaim is an action on a schedule and a reading on a dispatch', () => {
  it('applies from the schedule and requires an explicit flag from a dispatch', () => {
    // A prune that only runs when a human remembers runs after the eviction it exists to prevent.
    expect(PRUNE).toContain("github.event_name == 'schedule'");
    expect(PRUNE).toMatch(/APPLY: \$\{\{ github\.event_name == 'schedule'/);
    expect(PRUNE).toContain('ARGS+=(--apply)');
  });

  it('holds the permission the deletes need, and nothing more', () => {
    // `actions: write` is what `DELETE /actions/caches/{id}` requires. `contents: read` is what checkout
    // needs to read the script. A broader grant would be a token with a purpose nobody stated.
    expect(PRUNE).toContain('actions: write');
    expect(PRUNE).toContain('contents: read');
    expect(PRUNE).not.toContain('contents: write');
  });

  it('calls the script that the tests and the docs name', () => {
    // Non-vacuity for the whole file: a workflow that describes a prune and runs nothing would pass every
    // assertion above.
    expect(existsSync(resolve(repoRoot, 'scripts/prune_caches.py'))).toBe(true);
    expect(existsSync(resolve(repoRoot, 'scripts/test_prune_caches.py'))).toBe(true);
    expect(PRUNE).toContain('python3 scripts/prune_caches.py');
  });
});
