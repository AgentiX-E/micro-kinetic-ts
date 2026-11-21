# The population of `pnpm test`, and the files no compiler read

`docs/coverage-gate-audit.md` is about the **coverage** population: which files a percentage is computed over.
This document is about the other two populations the same repository decides with a config, and both were
narrow **silently** — the failure mode produces no error at all, because a suite that is not run and a file
that is not compiled are indistinguishable from a suite that passed and a file that is fine.

| population | decided by | stated? | measured before | measured after |
| --- | --- | --- | --- | --- |
| suites a root `vitest` run executes (`pnpm test`) | `vitest.workspace.ts` → `vitest.config.ts` | **no** | **3,211 of 4,042 tests**, exit 0 | **4,051**, exit 0 |
| `.ts` files any typecheck config reads | the `include` lists + `tsconfig.workspace.json` | **no** | **6 files in no config** | **0** |

Both are now derived from the tree and both are fenced, because a hand-stated population is what rotted in the
first place — twice, in the same repository, in the same week.

## 1. `pnpm test` ran 13 of the repository's 15 projects, and said nothing

`package.json` has `"test": "vitest run"`. At the repository root that is a workspace run, and what it runs is
whatever the root workspace declaration lists. The declaration was one line:

```ts
// vitest.workspace.ts
export default defineWorkspace(['packages/*/vitest.config.ts']);
```

**13 of 15.** `benchmarks/vitest.config.ts` and `integration-tests/vitest.config.ts` are not under `packages/`.

| | before | after |
| --- | --- | --- |
| projects in the population | **13** | **14** (15 configs, one named separately) |
| `(project, file)` pairs | 129 | **153** |
| tests | **3,211** | **4,051** |
| `benchmarks` tests run | **0** of 831 | **831** |
| exit code | 0 | 0 |

**The command reported success.** `vitest list benchmarks/__tests__/fse26-capability-census.test.ts` printed
nothing and exited 0 — the same shape as a test filter that matches nothing, which this record already names as
a measurement that is not a measurement. And the omission was not confined to a convenience command:

- `release.yml` runs **`pnpm test:all`**, which is `pnpm test && pnpm test:integration`. So the release gate
  never ran `benchmarks` either. **A release could ship with the benchmark suite failing.**
- `ci.yml` does run it (`benchmark-tests` → `nx run @agentix-e/micro-kinetic-benchmarks:test:coverage`), which
  is why the project's suite was green while the command a developer types was not the command that checked it.

### And the record's own claim about the command was the thing to check

`docs/coverage-gate-audit.md` §7 said, of this very run:

> `pnpm test` — the workspace run that **executes the whole suite (127 files, 3198 tests)** and carries no
> coverage claim. The workspace file also still exists, with vitest's own deprecation notice (`test.projects`
> in a root config is where it is heading); **migrating it is a separate change with its own measurement**, and
> it is not needed to make the coverage numbers honest.

Two things are true of that paragraph and one is not. The **deferral is real and correctly scoped** — the
coverage gate is per project, so the workspace file was indeed not what made those numbers dishonest. But
*"the whole suite"* is a claim about a population with **nothing connecting it to the config that decides it**,
and it is false: the file was written before this iteration and `benchmarks` existed when it was written.
**127 files and 3,198 tests are not the whole suite; they are what one glob resolved to.**

The paragraph is also the reason this iteration is not scope creep: **the migration was named, deferred, and
assigned a measurement** — and this is that change.

### The fix states every child of the array, and names the one it leaves out

`vitest.workspace.ts` is **deleted**, not amended: vitest 3 prints

```
DEPRECATED  The workspace file is deprecated and will be removed in the next major.
            Please, use the `test.projects` field in the root config file instead.
```

for it on every invocation, and — the point — **no compiler read it**, so nothing could have reported either
that it was deprecated or that it declared 13 of 15. The replacement is a root `vitest.config.ts`:

```
projects: [...packageProjects(), 'benchmarks/vitest.config.ts']
```

where `packageProjects()` **reads `packages/`** rather than listing it, so a new package is enrolled by
existing. `integration-tests/` is deliberately absent, and the reason is in the file: `pnpm test:integration`
runs it under its own config and `test:all` composes the two, so enrolling it would run that suite twice and
change what `test:all` means. **That is a decision with a name**, which is what the fence demands.

## 2. Six TypeScript files were read by no compiler, and five of them are run by workflows

`pnpm typecheck` is two legs: `nx run-many --target=typecheck --all` (each project's own `tsconfig.json`) and
`tsc -p tsconfig.workspace.json`. The union of those file lists is the only thing standing between a new file
and being read by nothing, and it had a hole:

| file | what runs it |
| --- | --- |
| `scripts/dump-bothwrong-evidence.ts` | `.github/workflows/dump-bothwrong-evidence.yml` |
| `scripts/dump-loss-metrics.ts` | `.github/workflows/dump-loss-metrics.yml` |
| `scripts/dump-re3-exceptions.ts` | `.github/workflows/dump-re3-exceptions.yml` |
| `scripts/dump-re3-metrics.ts` | `.github/workflows/dump-re3-metrics.yml` |
| `scripts/run-prism.ts` | `.github/workflows/benchmark-prism.yml` — **and it decides the PRISM numbers the register cites** |
| `vitest.workspace.ts` | nothing — which is §1 |

**The absence of an error IS the defect.** A file no config reaches is a file no compiler mentions, so the
failure mode is silence, and its cost is not the errors it hides but the fact that **nobody can see how much is
unhidden**. Enrolling the five found **0 errors** — it was pure widening.

Five workflow-only scripts are the worst place to keep unchecked code: the only way to run one is a job that
has already downloaded a corpus.

### The fence is the property, not the list

`tsconfig.workspace.json` gained `"*.ts"` and `"scripts/*.ts"`, and its four sets are recorded in its own
header with the star-slash warning it already carried (a glob written inside a block comment **closes the
comment** — a trap this iteration hit again in the new `vitest.config.ts`, and the same one the JSONC stripper
hit in iteration 23). But a widened `include` is a fact about today, so the rule is asserted as a property:

> `typecheck-population.test.ts` reads every config `pnpm typecheck` runs — derived from the manifests, each
> project entering by declaring a `typecheck` script — unions their **file lists** with the compiler's own
> `parseJsonConfigFileContent`, and requires the union to cover **every `.ts` file in the tree**.

A new file that no config reaches fails there. The failure message is the deliverable:

```
AssertionError: no compiler reads: scripts/zz-probe.ts
```

`vitest.config.ts` and `test-population.test.ts` were both written this iteration and would have been the
seventh and eighth such files had the fence not existed.

## 3. The two fences

| fence | file | its population, derived from | it fails when |
| --- | --- | --- | --- |
| the TEST population | `packages/kinetic/__tests__/unit/test-population.test.ts` | a walk of the tree for vitest configs, plus `package.json`'s `test:*` scripts | a project config is not a project of the root run **and** not named by a `test:*` command |
| the TYPECHECK population | `packages/kinetic/__tests__/unit/typecheck-population.test.ts` | a walk of the tree for `.ts`, against the union of the configs' file lists | any file is in no config's file list |

The test-population fence states four things, each in both directions:

1. `declared ∪ named === every config on disk` — a config added anywhere in the tree is unaccounted-for until
   it is one or the other; a declared path that does not exist fails too, because the comparison's other side
   is the tree.
2. `declared ∩ named === ∅` — so `test:all` runs no suite twice, which is the reason `integration-tests` is not
   in `test`.
3. every project is reachable from a script — `test:all` composes `test` and every named command, so "not in
   `test`" cannot mean "unrunnable".
4. the deprecated workspace form is **gone** — the assertion is on the absence of `vitest.workspace.ts`,
   `.js` and `.mts`, so re-introducing it fails here.

And the counts are asserted as **floors** rather than as a list, with `benchmarks/vitest.config.ts` named — a
fence that could pass with `benchmarks` missing would not have caught the defect it was written for.

## 4. The harness that measured this had the same defect, and the file fixed here was masking it

Worth recording because it is the same law one layer out, and because it invalidated nothing but exhausted a
repair:

`mutation_pass_21.py` took a guard's project to be **its first path segment**: `<project>/<relative>`. That is
right for `benchmarks/__tests__/…` and wrong for `packages/<pkg>/__tests__/…`, which ran vitest from
`micro-kinetic-ts/packages/` — a directory with no config — where the invocation **fails to start**. Every row
using a `packages/<pkg>/…` guard came back **`NO-TESTS`**: zero tests executed, which the harness's own
`executed == 0` check reports as neither a kill nor a survivor.

**It went unnoticed for two passes because `vitest.workspace.ts` was there.** Vitest, started from
`micro-kinetic-ts/packages`, walked *up* to the repository root, found the deprecated workspace file, and loaded
the 13 package projects — so a `packages/kinetic/…` filter matched and the rows ran. **The rows were therefore
measured, but for a reason the harness never stated.** Deleting that file turned all twelve `ts` rows into
`NO-TESTS` and the mismatch report named the cause.

The repair derives the project root: the deepest ancestor carrying a `vitest.config.ts`, so a deeper project
needs no change. Re-run against it, **`mutation_pass_23.py`'s rows 15–17 reproduce their declared verdicts** —
the earlier measurements stand, and they now stand on a stated derivation rather than on a file this iteration
deleted.

## 5. Defects in this iteration's own work

1. **My first `vitest.config.ts` would not parse**: its doc comment spelled the glob it was replacing, and the
   glob contains a star-slash sequence that **closes the block comment**, leaving the rest as code —
   `Expected ";" but found "pnpm"`. The `tsconfig.workspace.json` header warns about exactly this, from the
   other side, and iteration 23 hit it in a JSONC stripper. Written out in prose now.
2. **My measurement probe was left in the tree** (`packages/kinetic/__tests__/unit/zz_probe25.ts`) and oxlint
   reported its four `console` statements — the fence working on the fence's author.
3. **The first assertion compared an unsorted list to a sorted one** and failed on ordering alone. Two of the
   five tests in the new fence were red for a reason that had nothing to do with the subject.
4. **One invented path**: the "names the trees the walk reaches" test named
   `integration-tests/docker-compose.test.ts`, which does not exist; the real file is
   `integration-tests/src/pipeline.spec.ts`. **A fixture written from imagination rather than captured from the
   subject** — the same defect the mutation-pass skill records.
5. **The probe reported a defect that is not there.** Before choosing this subject I measured a
   partial-population hypothesis — that a screen might solve a window over a fraction of the cases and print it
   like a complete one — and the corpus does not contain that state: every fractional population is either
   ~100% or 0%. **The iteration was not built on it.** This is recorded because a hypothesis that survives
   measurement is worth as much as one that dies, and because the alternative — building the fix anyway — is
   how a record fills with claims its artifacts do not support.

## 6. Gates

| | |
| --- | --- |
| the root run, end to end | **153 files, 4,051 tests, 0 failures, exit 0** in 41.5 s (`--pool=forks`, `maxForks=2`) — the fix's own proof, not a collection |
| `packages/kinetic` | **968 tests / 37 files** (959 / 36 before: the two fences), coverage **100 / 99.44 / 100 / 100** — **unchanged** from CI's reading, because a test file is not in a coverage allow-list |
| both typechecks | 15 projects clean + `tsconfig.workspace.json` clean, and the workspace leg reads **162 files** (156 before: the five scripts and the root config) |
| lint / format | **0 warnings, 0 errors on 341 files**; the touched files formatted |
| mutations | **13 rows, every one as declared**; both controls (`py`, `ts`) SURVIVED with 73 and 9 tests executed; tree hash-verified byte-identical |
| the harness repaired | `mutation_pass_21.py` derives the project root; **`mutation_pass_23.py` rows 15–17 and `mutation_pass_24.py` rows 1–2, 15 re-run and confirmed** |
| golden | **NOT owed** — `benchmark_run_owed` returns `(False, ())` over all six changed paths, while its control fires on `packages/core/src/index.ts`. None of them is a trigger: the root config and `tsconfig.workspace.json` are outside `packages/*/src/**` and `benchmarks/src/**`, and the two fences are under `packages/kinetic/__tests__/**`, which is not one either. **And this change moves no score by construction**: the root config decides which suites a root-level `vitest` RUNS and touches nothing the engine reads |

## 7. The same gates, read from CI — and one number that moved for a reason that is not this change

| | |
| --- | --- |
| CI `0280fd3` | **19 of 19 jobs green** |
| `Release` | **green**, and its own log is the end-to-end proof on CI: `> vitest run` → **`Test Files 153 passed (153)`, `Tests 4051 passed (4051)`**, then `> vitest run --config integration-tests/vitest.config.ts` → `1 file, 9 tests`. **The release gate now runs the benchmarks suite**, which it never did |
| the push | started **only `CI` and `Release`** — no benchmark run, a third independent confirmation of §6's golden answer |
| 56 dimensions | 14 coverage jobs × 4 — **worst `95.00`** (`wave` branches) over **4,051 tests**, `benchmark-tests` unchanged at `99.84 / 97.49 / 100 / 99.84` |
| `test (kinetic)` | `100 / 99.44 / 100 / 100` with **968** tests (959 before: the two fences) — **unmoved** |
| `test (optimize)` | branches **100 → 99.77** — see below. **Not caused by this change** |

### The one movement, and why it is not a consequence of this iteration

`test (optimize)`'s branch dimension fell from `100.00` to `99.77` — one arc, `packages/optimize/src/optimizer.ts:238`:

```ts
const bestConfig = best.idx >= 1 ? experimentHistory[best.idx - 1]!.config : priorConfig;
```

The uncovered arm is the one the comment above it describes — *"when no experiment improves on the prior, the
best observation is the prior itself (idx 0)"*. Nothing this iteration changed is under `packages/optimize`,
and the attribution is measured rather than argued:

- **`200 tests`, unchanged** (the same count CI reports for `test (optimize)`); every other file in the package at `100`; the project's own thresholds
  applied and satisfied (the job succeeded).
- run locally on the committed tree, `packages/optimize` reads **`100 / 100 / 100 / 100`**.
- **run three times in a row on that same tree it reads `100`, `99.77`, `100`.**

**So the gate's reading is not reproducible, and the branch is NOT dead** — some runs take it. The cause is one
line:

```ts
// packages/optimize/src/config-space.ts:221
const defaultRng = () => Math.random();
```

`sampleUniform(rng = defaultRng)` is the default, and the optimizer's tests never inject a seeded generator, so
whether any sampled configuration beats the GP's soft prior (accuracy 0.6) differs run to run. That makes the
`priorConfig` arm sometimes taken and sometimes not — which is why the same commit reads `100.00` and `99.77`,
and why this is **a finding of its own rather than a regression from this one**: the number this record gates on
is produced by a coin flip.

It is left **named and measured rather than patched here**, because it is a different subject with a different
repair (a seeded generator in the tests, or an injected RNG in the optimizer), and §5's discipline applies to
it too: the fix should be the smallest change that makes the reading a measurement.
