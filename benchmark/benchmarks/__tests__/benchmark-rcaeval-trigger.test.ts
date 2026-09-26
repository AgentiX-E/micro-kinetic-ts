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
 * The two PARSERS, read as text: what a workflow may dispatch is bounded by what its runner
 * ACCEPTS, and the accepted set is the argument chain inside each of these.
 */
const FSE26_CLI = readFileSync(resolve(repoRoot, 'benchmarks/src/fse26-cli.ts'), 'utf8');
const RCAEVAL_CLI = readFileSync(resolve(repoRoot, 'benchmarks/src/rcaeval-cli.ts'), 'utf8');

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

/**
 * The dump switch, guarded where it can silently do nothing.
 *
 * `diagnose_dump` exists so the golden benchmark produces the SAME artifact the FSE'26 runner emits,
 * which is what lets a weight's second half be solved offline instead of costing a dispatch each
 * time. Three things can go wrong without a single test failing: the input can be declared and read
 * nowhere, an invocation can be missed (there are seven), and two invocations can write the same
 * file — the last one silently overwriting the others, leaving a dump of one configuration that
 * still parses.
 */
/**
 * The four knobs BOTH runners accept, guarded where a declared input can do nothing.
 *
 * The kill criterion is an AND over FSE'26 and this benchmark, so a knob only one workflow can pass
 * has an UNDECIDABLE other half — which is why the REJECTED temporal candidate is recorded with
 * `golden: 'unmeasured'`. Adding the input is the fix; the failure mode is the same three this file
 * already guards for `diagnose_dump`: an input declared and read nowhere, an invocation missed (there
 * are seven), and a value that never reaches the runner while the dispatch reports success.
 */
describe('the golden benchmark can dispatch every knob both runners accept', () => {
  const invocations = [
    ...WORKFLOW.matchAll(/pnpm exec tsx benchmarks\/src\/run-rcaeval\.ts ([^\n]*)/g),
  ];
  /** flag -> the shell line that appends it, per the inputs this suite is about. */
  const ARGS: readonly (readonly [string, string, string])[] = [
    ['log_weight', '--log-weight', 'RANKING_ARG+=(--log-weight "${{ inputs.log_weight }}")'],
    [
      'temporal_weight',
      '--temporal-weight',
      'RANKING_ARG+=(--temporal-weight "${{ inputs.temporal_weight }}")',
    ],
    ['onset_shape', '--onset-shape', 'RANKING_ARG+=(--onset-shape "${{ inputs.onset_shape }}")'],
    ['no_rank_normalization', '--no-rank-normalization', 'RANKING_ARG+=(--no-rank-normalization)'],
  ];

  it('declares each input with an EMPTY default, so a push-triggered run is unchanged', () => {
    // The nine cells are the gate, and they were measured at the shipped configuration. A default
    // that is not empty would move the gate's own measurement in the commit that added the surface.
    for (const [input] of ARGS) {
      expect(WORKFLOW, input).toMatch(new RegExp(`^\\s{6}${input}:`, 'm'));
      const block =
        new RegExp(`^\\s{6}${input}:\\n((?:\\s{8}[^\\n]*\\n)+)`, 'm').exec(WORKFLOW)?.[1] ?? '';
      expect(block, input).toContain("default: ''");
    }
    expect(ARGS.length).toBe(4);
  });

  it('threads the array into EVERY invocation, so no suite is left at the default', () => {
    expect(invocations.length).toBeGreaterThan(5);
    for (const one of invocations) {
      expect(one[1]).toContain('"${RANKING_ARG[@]}"');
    }
  });

  it('appends each flag in EVERY invocation, counted rather than sampled', () => {
    // The count is the assertion: one missed invocation is one suite measured at the default while
    // the run reports success, and the other six suites still show the requested configuration.
    for (const [input, flag, line] of ARGS) {
      const built = WORKFLOW.split(line).length - 1;
      expect(built, `${flag} appended ${built} time(s)`).toBe(invocations.length);
      expect(WORKFLOW, `${input} -> ${flag}`).toContain(flag);
    }
  });

  it('is the set BOTH runners accept, which is what makes the criterion decidable on them', () => {
    // The boundary is principled rather than convenient: a knob the FSE'26 runner does not accept
    // cannot make the criterion decidable on the OTHER half either, so adding it here would grow the
    // surface without growing the set of answerable questions.
    for (const [, flag] of ARGS) {
      expect(FSE26_CLI, flag).toContain(`'${flag}'`);
      expect(RCAEVAL_CLI, flag).toContain(`'${flag}'`);
    }
  });
});

describe('the golden benchmark can emit the diagnostic dump', () => {
  const invocations = [
    ...WORKFLOW.matchAll(/pnpm exec tsx benchmarks\/src\/run-rcaeval\.ts ([^\n]*)/g),
  ];

  it('declares the input with an EMPTY default, so a push-triggered run is unchanged', () => {
    expect(WORKFLOW).toMatch(/^\s{6}diagnose_dump:/m);
    const block = /^\s{6}diagnose_dump:\n((?:\s{8}[^\n]*\n)+)/m.exec(WORKFLOW)?.[1] ?? '';
    expect(block).toContain("default: ''");
  });

  it('passes the flag on EVERY invocation, and there is more than one', () => {
    // One missed invocation is one suite whose cells cannot be diagnosed — and the miss is invisible,
    // because the other suites still produce a dump.
    expect(invocations.length).toBeGreaterThan(5);
    for (const one of invocations) {
      expect(one[1]).toContain('"${DIAGNOSE_ARG[@]}"');
    }
    expect(WORKFLOW.match(/DIAGNOSE_ARG=\(--diagnose-dump [^)]+\)/g)?.length).toBe(
      invocations.length,
    );
  });

  it('gives every invocation its own file and ships it', () => {
    // The three RE3 invocations share a job, so a shared path would leave only the last
    // configuration on disk — a dump that is one configuration while looking like all of them.
    const dumps = [...WORKFLOW.matchAll(/DIAGNOSE_ARG=\(--diagnose-dump ([^)]+)\)/g)].map(
      (m) => m[1]!,
    );
    expect(new Set(dumps).size).toBe(dumps.length);
    for (const dump of dumps) {
      expect(WORKFLOW).toContain(`            ${dump}`);
    }
  });

  it('is off unless the dispatch asks for it', () => {
    // Every block is gated on the input being non-empty, so a push or a scheduled run pays nothing.
    const gated = WORKFLOW.match(/if \[ -n "\$\{\{ inputs\.diagnose_dump \}\}" \]; then/g);
    expect(gated?.length).toBe(invocations.length);
  });
});

/** The precision the dump is rendered at, which a dispatch has to be able to ASK for. */
const DUMP_ARG = /DIAGNOSE_ARG=\(--diagnose-dump [^)]+\)/g;
const DECIMALS_FORWARD = '--diagnose-decimals "${{ inputs.diagnose_decimals }}"';

describe('the dump’s render precision is a dispatch input', () => {
  it('declares the input with an EMPTY default, so a push-triggered run is unchanged', () => {
    expect(WORKFLOW).toMatch(/^\s{6}diagnose_decimals:/m);
    const block = /^\s{6}diagnose_decimals:\n((?:\s{8,}[^\n]*\n)+)/m.exec(WORKFLOW)?.[1] ?? '';
    expect(block).toContain("default: ''");
    // `''` is a VALUE here rather than an absence, so the description has to say what it selects —
    // and it has to say that the precision is the ARTIFACT's, because that is what a reader's box
    // comes from and the whole reason the value is stated in the dump at all.
    expect(block).toContain('empty');
    expect(block).toContain('precision');
  });

  it('forwards it on EVERY dump invocation, exactly one per dump', () => {
    // One missed suite is one artifact written at the default precision while the others are finer —
    // and nothing downstream can see it, because every file still parses and still declares a
    // precision. It would just declare the wrong one. Counted on the ARGUMENT rather than on the flag
    // name, so a future description mentioning the flag does not make this pass or fail by accident.
    const dumps = WORKFLOW.match(DUMP_ARG) ?? [];
    expect(dumps.length).toBeGreaterThan(5);
    expect(WORKFLOW.match(/DIAGNOSE_ARG\+=\(--diagnose-decimals /g)?.length).toBe(dumps.length);
  });

  it('ties the flag to the dump’s OWN block, so it can never be passed without one', () => {
    // Asserted positionally rather than by counting: the precision is an argument OF the dump, and a
    // forward that drifted into another step's block would still satisfy a total count while handing
    // two suites the same precision from one input — or handing a suite a flag with no dump to
    // render. Each block is the text from its `--diagnose-dump` up to the next invocation.
    const chunks = WORKFLOW.split(/DIAGNOSE_ARG=\(--diagnose-dump /).slice(1);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      const own = chunk.split('DIAGNOSE_ARG=(')[0]!;
      expect(own).toContain(DECIMALS_FORWARD);
      // And inside the gate, so a dispatch that sets only the precision adds no flag: an ungated
      // forward would be a second way to state the default, on every push and every schedule.
      expect(own).toContain('if [ -n "${{ inputs.diagnose_decimals }}" ]; then');
    }
  });

  it('is a flag the runner actually ACCEPTS, defaulting to the producer’s constant', () => {
    // A declared input forwarded to a runner that ignores the flag produces a successful dispatch,
    // an artifact at the default precision, and no failure anywhere. Read as text for the default,
    // because a hardcoded `3` here would be a second copy of a value the producer owns and would
    // keep rendering three decimals the day the producer starts rendering four.
    // The PARSER's file, which is where the flag is accepted and the default is read: the chain moved
    // out of the runner so that a test could drive it, and a guard left pointing at the runner would
    // have gone on passing while checking nothing.
    const runner = readFileSync(resolve(repoRoot, 'benchmarks/src/rcaeval-cli.ts'), 'utf8');
    expect(runner).toContain("'--diagnose-decimals'");
    expect(runner).toMatch(/diagnoseDecimals: SERVICE_FIELD_DECIMALS/);
    expect(runner).not.toMatch(/diagnoseDecimals: 3\b/);
    expect(runner).toMatch(/parseFieldDecimals\(args\[\+\+i\]!, SERVICE_FIELD_DECIMALS\)/);
  });
});
