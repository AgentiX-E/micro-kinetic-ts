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
 * The same file now also guards the corpus the trigger's run is scored on: which is only half a criterion if
 * the nine cells are computed over a SUBSET of the benchmark the claim is about. See the corpus block below.
 *
 * @module __tests__/benchmark-rcaeval-trigger
 */

import { readdirSync, readFileSync } from 'node:fs';
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
/** The runner, read as text for the same reason: the guard that keeps the census opt-in lives here. */
const RCAEVAL_RUNNER = readFileSync(resolve(repoRoot, 'benchmarks/src/run-rcaeval.ts'), 'utf8');

/**
 * The `push.paths` entries, exactly as written.
 *
 * Scoped to the `push:` block, so an entry under `workflow_run:` or inside a job's `paths` can never
 * satisfy a check that is about the TRIGGER.
 */
/** One `upload-artifact` step, reduced to the two things a reader can act on. */
interface UploadStep {
  readonly name: string;
  readonly condition: string;
  readonly paths: readonly string[];
}

/**
 * Every `upload-artifact` step, with the FILES it names and the CONDITION it runs on.
 *
 * Read by INDENTATION rather than parsed, because this file's business is an entry that is absent from a
 * list, and both directions of that defect are invisible to a parser that only asks whether the YAML is
 * valid: a `path:` naming a file no run writes, and a file listed UNCONDITIONALLY beside files that are
 * always written while the file itself is opt-in. The second is what makes an artifact look complete, which
 * is how a reader comes to believe a diagnostic is in it when it is not.
 *
 * @param workflow - The workflow's text.
 * @returns One entry per upload step, in file order.
 */
function uploadSteps(workflow: string): UploadStep[] {
  const lines = workflow.split('\n');
  const steps: UploadStep[] = [];
  for (let i = 0; i < lines.length; i++) {
    const start = /^(\s*)- name: Upload (.*)$/.exec(lines[i]!);
    if (start === null) continue;
    const indent = start[1]!.length;
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() !== '' && /^\s*- /.test(line) && line.search(/\S/) <= indent) break;
      block.push(line);
    }
    const paths: string[] = [];
    for (let k = 0; k < block.length; k++) {
      // The BLOCK form first: `path: |` would otherwise satisfy the inline pattern with `|` as its value,
      // and the file list that follows it would then be read as prose. Which is the same mistake the two
      // defects this helper exists for both make — a form that matches a pattern while meaning something else.
      if (/^\s*path:\s*\|\s*$/.test(block[k]!)) {
        const base = block[k]!.search(/\S/);
        for (let m = k + 1; m < block.length; m++) {
          const inner = block[m]!;
          if (inner.trim() === '') continue;
          if (inner.search(/\S/) <= base) break;
          paths.push(inner.trim());
        }
        continue;
      }
      const inline = /^\s*path:\s*(\S+)\s*$/.exec(block[k]!);
      if (inline !== null) paths.push(inline[1]!);
    }
    steps.push({
      name: start[2]!,
      condition: /^\s*if:\s*(.+)$/m.exec(block.join('\n'))?.[1]?.trim() ?? '',
      paths,
    });
  }
  return steps;
}

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
    // The property is "an upload step names it", NOT "it appears with twelve spaces in front". The
    // assertion used to be the indentation, which is a fact about how the path list is FORMATTED: moving the
    // dump to its own conditional step — which is what makes the artifact honest, see below — ships the same
    // file from the same run and would have failed a check that is about the file being shipped.
    const shipped = uploadSteps(WORKFLOW);
    for (const dump of dumps) {
      const owner = shipped.filter((one) => one.paths.includes(dump));
      expect(owner.length, `${dump} must be named by exactly one upload step`).toBe(1);
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

/**
 * The corpus the nine cells are scored on, guarded where a partial one can be mistaken for the benchmark.
 *
 * ## The defect
 *
 * RE2 ships **90 cases per system** (270 overall: six fault types x five services x three repetitions).
 * Three invocations in this workflow ranked the first **50**, leaving **120 cases — 44% of RE2 — unmeasured**,
 * and the damage was not the missing cases but the claim they fed: `docs/sota-comparison.md` folds the suite
 * means with the PUBLISHED sizes (`(375x0.803 + 270x0.798 + 90x0.587) / 735`), so a **150-case** RE2 mean was
 * weighted as if all 270 had been ranked, and `docs/prism-head-to-head.md` printed that mean in a column beside
 * a competitor evaluated on all **735**. RE1 (125/system) and RE3 (30/system) were never capped.
 *
 * ## What this holds
 *
 * An ABSENCE, because that is the shape of the defect: **no invocation in this workflow may cap the corpus**.
 * And a RULE over the other workflows: **a workflow that caps may not be named by any document.** This replaced
 * an exact set of four filenames, and the replacement is the repair for this defect rather than a tidier spelling
 * of it — the set said two verdict-cited probes may sample, and the verdicts cited their numbers. A rule that
 * reads the repository's own citations cannot be maintained into staleness by the person citing the number.
 */
const WORKFLOWS = resolve(repoRoot, '.github/workflows');
const DOCS = resolve(repoRoot, 'docs');

describe('the golden benchmark ranks the whole corpus it is scored on', () => {
  const invocations = [
    ...WORKFLOW.matchAll(/pnpm exec tsx benchmarks\/src\/run-(?:rcaeval|ablation)\.ts ([^\n]*)/g),
  ].map((m) => m[1]!);

  it('caps NOTHING, on any invocation, in any form', () => {
    // The absence. Three of these lines carried `--max-cases 50` and the other four did not, which is the
    // two-corpora defect one level up: the published cells and the fidelity control that measures against them
    // would have ranked different populations.
    expect(invocations.length).toBeGreaterThan(5);
    const capped = invocations.filter((args) => args.includes('--max-cases'));
    expect(capped, 'a capped corpus cannot be the benchmark the claim is about').toEqual([]);
  });

  it('invokes RE2 three times, and every one of them is the full suite', () => {
    // Counted, so that removing the cap from the published run and leaving it on the control — the exact
    // asymmetry the previous test would still catch but this one names — cannot pass as a fix.
    const re2 = invocations.filter((args) => args.includes('--suite re2'));
    expect(re2).toHaveLength(3);
    for (const args of re2) expect(args).not.toContain('--max-cases');
    // And the flag is still a flag the runner ACCEPTS, so this is a decision rather than a dead option.
    const cli = readFileSync(resolve(repoRoot, 'benchmarks/src/rcaeval-cli.ts'), 'utf8');
    expect(cli).toContain("'--max-cases'");
  });

  it('holds the rule: a workflow a document CITES may not cap its corpus', () => {
    // Read as INVOCATIONS, not as file text. The first version scanned the whole file for the token, and the
    // comment left in `benchmark-rcaeval.yml` — which names the flag to explain why it is gone — made that file
    // a member of its own sampler list. A count of a syntactic form is not a statement about a group; the group
    // here is "an invocation that caps its corpus".
    const sampling = readdirSync(WORKFLOWS)
      .filter((name) => name.endsWith('.yml'))
      .filter((name) =>
        [
          ...readFileSync(resolve(WORKFLOWS, name), 'utf8').matchAll(
            /pnpm exec tsx benchmarks\/src\/run-[\w-]+\.ts ([^\n]*)/g,
          ),
        ].some((m) => m[1]!.includes('--max-cases')),
      )
      .sort();

    // THE RULE, and it replaced an enumeration of four filenames. That enumeration is why this defect survived
    // iteration 75: the list said `benchmark-fusion-ceiling.yml` and `benchmark-routing-probe.yml` MAY sample,
    // and their artifacts are exactly what three verdict documents consume — `fusion-routing-verdict.md` states
    // the union ceiling "87.5% (538/615)" as the reason deterministic routing was closed, and
    // `delay-exhausted-verdict.md` and `rank-collapse-falsified.md` cite the same number as an information
    // ceiling. **A probe may sample; a CONCLUSION may not rest on one.** A named list cannot express that,
    // because the list is maintained by the same person who is about to cite the number.
    //
    // The rule that can: a workflow may cap only while NO document names it. The claim is checkable from the
    // repository's own text, so it cannot go stale silently — the day a document starts citing a sampler, the
    // citation itself fails this assertion.
    const cited = sampling.filter((name) =>
      readdirSync(DOCS)
        .filter((doc) => doc.endsWith('.md'))
        .some((doc) => readFileSync(resolve(DOCS, doc), 'utf8').includes(name)),
    );

    // UNCONDITIONAL, and it needs no exemption list — which is the point of defining the population by
    // INVOCATION. `fse26-benchmark.yml` caps via a DISPATCH INPUT (`MAX_CASES_ARG`) rather than a literal on a
    // command line, so it is not a member of this population at all and cannot appear here; that is the same
    // reason the set it replaced never listed it. A rule whose population is defined by the right predicate
    // needs fewer exceptions than one whose population is a list.
    expect(cited, 'no workflow that caps may be named by a document').toEqual([]);

    // The check is not vacuous: some workflows DO cap, so an empty `cited` is a statement about them rather
    // than about an empty `sampling`.
    expect(sampling.length).toBeGreaterThan(0);

    // And the two workflows whose artifacts the verdicts consume are not samplers any more — asserted as a
    // PRESENCE beside the absence, because "must not cap" alone would also be satisfied by deleting the
    // invocation, which would leave the verdicts with no measurable source at all.
    for (const [file, probe] of [
      ['benchmark-fusion-ceiling.yml', '--fusion-ceiling'],
      ['benchmark-routing-probe.yml', '--routing-probe'],
    ] as const) {
      const text = readFileSync(resolve(WORKFLOWS, file), 'utf8');
      expect(sampling, `${file} must not sample`).not.toContain(file);
      // INVOCATION-scoped, and deliberately not `text.includes(probe)`: the comment above that invocation names
      // the flag in order to explain the absence, so a text check would be satisfied by the explanation of the
      // very change it exists to protect. Third occurrence of that shape in this repository — hence the regex
      // starts at the subcommand and refuses a cap between it and the probe.
      expect(text, `${file}'s RE2 invocation must still run its probe, uncapped`).toMatch(
        new RegExp(`--suite re2 (?!--max-cases)\\S*${probe}`),
      );
    }
  });
});

/**
 * Guards the artifact that makes a MISS readable: the per-case loss census.
 *
 * The accuracy table cannot distinguish a case whose root cause was never a candidate from one whose root
 * cause came second, and neither can the console diagnostics — those print the first few failures per fault
 * type, so a split computed from them is a split of a SAMPLE while reading as one of the population. This
 * suite holds the three things that make the census usable: it is requested by every invocation, every file
 * is shipped, and the file is the one the invocation actually writes.
 */
describe('the golden benchmark ships the per-case loss census', () => {
  const CENSUS_FILES = [...WORKFLOW.matchAll(/CENSUS_ARG=\(--loss-census ([^)]+)\)/g)].map(
    (m) => m[1]!,
  );

  it('passes the flag on EVERY invocation, counted rather than sampled', () => {
    const invocations = [
      ...WORKFLOW.matchAll(/pnpm exec tsx benchmarks\/src\/run-rcaeval\.ts [^\n]*/g),
    ];
    expect(CENSUS_FILES.length).toBe(invocations.length);
    for (const [one] of invocations) {
      expect(one).toContain('"${CENSUS_ARG[@]}"');
    }
  });

  it('gives every invocation its own file, so one suite cannot truncate another', () => {
    expect(new Set(CENSUS_FILES).size).toBe(CENSUS_FILES.length);
    expect(CENSUS_FILES.length).toBeGreaterThan(1);
  });

  it('ships every census file, on an upload step that runs regardless of the job outcome', () => {
    const shipped = uploadSteps(WORKFLOW);
    for (const file of CENSUS_FILES) {
      const owner = shipped.filter((one) => one.paths.includes(file));
      expect(owner.length, `${file} must be named by exactly one upload step`).toBe(1);
      expect(owner[0]!.condition, `${file}'s upload must run even when the run failed`).toBe(
        'always()',
      );
    }
  });

  it('fails the job when a file it names is missing, rather than warning and shipping the rest', () => {
    // `upload-artifact` defaults to `warn`: the step succeeds, the artifact holds whatever WAS written, and
    // the absence is only visible to a reader who tries to fetch the file. That is how an artifact comes to
    // look complete while naming a file no run writes.
    const owned = uploadSteps(WORKFLOW).filter((one) =>
      one.paths.some((p) => CENSUS_FILES.includes(p)),
    );
    expect(owned.length).toBe(CENSUS_FILES.length);
    for (const one of owned) {
      // The census file's OWN step, found in its own path list — `paths[0]` is the results file, and reading
      // the stem off the wrong entry is the sort of off-by-one that makes a fence assert nothing.
      const stem = one.paths
        .filter((p) => CENSUS_FILES.includes(p))
        .map((p) => p.replace('rcaeval-loss-census-', '').replace('.jsonl', ''))[0]!;
      expect(WORKFLOW, `${one.name} must declare if-no-files-found: error`).toContain(
        `name: rcaeval-${stem}-results`,
      );
    }
    // One declaration per artifact that carries a census or a diagnose dump — two per suite — and NO others,
    // so a declaration added to an artifact whose file is genuinely optional fails here rather than shipping
    // a red job for a configuration nobody asked for.
    const mustFail = uploadSteps(WORKFLOW).filter((one) =>
      one.paths.some((p) => CENSUS_FILES.includes(p) || p.includes('rcaeval-diagnose-')),
    );
    expect(mustFail.length).toBe(CENSUS_FILES.length * 2);
    expect((WORKFLOW.match(/if-no-files-found: error/g) ?? []).length).toBe(mustFail.length);
  });

  it('is a flag the runner ACCEPTS, so a dispatch cannot pass a fixture of its own', () => {
    // A workflow may only pass what its runner parses: an argument nothing accepts makes `run-rcaeval.ts`
    // throw at startup, which is a red job rather than an artifact — unless the flag is unknown to the parser
    // AND unread by the runner, in which case the census would silently be the empty string and no file
    // would be written at all.
    expect(RCAEVAL_CLI).toContain("'--loss-census'");
    expect(RCAEVAL_CLI).toMatch(/lossCensus: string;/);
  });

  it('leaves the census OFF unless the dispatch asks for it', () => {
    // The runner's default is the empty string, and the emitter is guarded on it: a `--loss-census` that
    // defaulted to a path would make every existing invocation write one, which is a behaviour change in a
    // benchmark whose whole kill criterion is that its numbers do not move.
    expect(RCAEVAL_CLI).toMatch(/lossCensus: '',/);
    // The emitter is guarded on it, in the two places that could write the file: the per-group join and the
    // single write after the loop. Two guards and not one, because the join allocates the rows and the write
    // is what creates the file — an unguarded write would create an empty census on every existing run.
    expect(RCAEVAL_RUNNER.match(/if \(opts\.lossCensus !== ''\)/g)?.length).toBe(2);
  });
});

describe('the opt-in diagnose dump is listed only where it is produced', () => {
  it('is NOT uploaded beside the unconditional files of the same artifact', () => {
    // The defect this closes: `path:` named `rcaeval-diagnose-re1.txt` on the same step as the results, so
    // every default run shipped an artifact claiming a file the run never writes — the dump is opt-in. The
    // fix is structural: the dump has its own step, gated on the very input that produces it, so the pair
    // "file listed" and "file written" are the same condition.
    const shipped = uploadSteps(WORKFLOW);
    const unconditional = shipped.filter((one) => one.condition === 'always()');
    for (const one of unconditional) {
      for (const p of one.paths) {
        expect(p, `${one.name} must not name an opt-in file unconditionally`).not.toContain(
          'diagnose',
        );
      }
    }
  });

  it('gives every dump an upload step gated on `inputs.diagnose_dump`', () => {
    const dumps = [...WORKFLOW.matchAll(/DIAGNOSE_ARG=\(--diagnose-dump ([^)]+)\)/g)].map(
      (m) => m[1]!,
    );
    const shipped = uploadSteps(WORKFLOW);
    for (const dump of dumps) {
      const owner = shipped.filter((one) => one.paths.includes(dump));
      expect(owner.length, `${dump} must be named by exactly one upload step`).toBe(1);
      expect(owner[0]!.condition, `${dump} must be uploaded only when it exists`).toBe(
        "${{ inputs.diagnose_dump != '' }}",
      );
    }
  });
});
