# The corpus order had no owner: two traversals that followed the filesystem, and fourteen orders that answered from the machine

**Status:** both classes closed. `packages/kinetic/src/benchmarks/case-order.ts` is the ONE order convention,
`benchmarks/src/case-corpus-walk.ts` is the ONE corpus traversal, and
`benchmarks/__tests__/case-traversal-census.test.ts` holds every traversal in the repository to the first.

## 1. What was measured, before anything was changed

The repository traverses a case corpus in **fifteen** places and orders sequences in **fourteen** more. A census
over `benchmarks/src`, `scripts` and the three packages' `src` found two things:

| # | finding | population |
| --- | --- | --- |
| 1 | Traversals that returned `readdirSync` order **raw** | **2** — `run-rcaeval.ts`'s and `run-ablation.ts`'s `discoverAllCases` |
| 2 | Traversals that canonicalised | **13** — including `run-fse26.ts`, `run-optimize.ts`, `scripts/run-prism.ts` and all four dump scripts |
| 3 | Orders built with `localeCompare` | **14**, over **6** files |
| 4 | Orders built with a hand-rolled `<` | a growing minority, including `rcaeval-loader.ts`'s edge list |

**The two that did not sort are the two whose `slice(0, maxCases)` decides a published case set.** That is the
defect, and it is worse than an inconsistency because of *which* two:

- `run-rcaeval.ts:541` — `const selected = maxCases > 0 ? metas.slice(0, maxCases) : metas;`. The golden
  workflow passes no `--max-cases`, so the published nine cells are safe; but **two probe workflows run this very
  runner and the ablation runner with `--suite re2 --max-cases 50`**, which is how 1) the sibling suppression
  switch's measurement and 2) the PRISM sweep's RE2 window were taken. `prism-pooling-frontier.md` §5 calls the
  latter — +9.33 pp on RE2 — *"the largest number this instrument has produced"*.

> **Why those two workflows are named by what they DO rather than by their file names.** `benchmarks/__tests__/
> benchmark-rcaeval-trigger.test.ts` holds an unconditional rule: *a workflow may cap only while NO document
> names it*. The rule is right — a conclusion may not rest on a sample, and a named list of permitted samplers is
> maintained by the same person about to cite the number — and it has a **cost that this iteration is the first
> to pay: a defect that lives in a sampler cannot be cited by name, so it cannot be documented where it is
> found.** The names are one `grep` away (`--max-cases` over `.github/workflows/`), the fence's rule is intact,
> and the alternative — an exemption for documents that describe the sampler rather than quote it — is precisely
> the enumeration that rule replaced. Recorded as a limit rather than worked around: **an unconditional rule
> about citations can hide the citation that would expose the thing it governs.**

`readdirSync`'s order is deliberately unspecified. The same command over the same corpus could therefore rank a
**different 50 of RE2's 90 cases on another machine**, and the record had already noticed the symptom without
naming the cause: `ABLATION_FINDINGS.md` v8's standing follow-ups say *"The `discoverAllCases` walk is unsorted,
so a capped run's case SET was filesystem order."*

### 1.1 One file held both conventions, which is how the class survived

`packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts` sorted a **suite's case directories** with
`a.name.localeCompare(b.name)`, and eight hundred lines later hand-rolled a **code-unit** comparator for its edge
list — with the reason written beside it:

> *"One order for both arrays, so a reader diffing them is comparing the same edges in the same sequence. …
> Replacing the comparator with `localeCompare` would silence an unreachable arm and blind that control, so it
> stays."*

**One file, two order conventions, and the machine-dependent one was on the case list.** The hand-rolled one
was on the sequence whose stability the same comment argues for. That is the register's *"a partition with two
owners has no convention"* arriving as an ordering rather than as a value — and it is why the repair is a shared
module rather than a lambda at each site.

Three loaders of **one shape** existed (`rcaeval-loader.ts`, `aiops2025-loader.ts`, `rca100-loader.ts`), all three
sorting a suite's case directories with `localeCompare`; one of the three also sorted a per-service metric-file
listing, where the order becomes a `Map`'s insertion order and a Map's order is observable.

## 2. What `localeCompare` costs, stated as the failure rather than as a preference

`'é'.localeCompare('z')` is negative; `'é' < 'z'` is false. Both are correct answers to different questions. The
first asks *where French collation puts these two strings*; the second asks *where these two byte sequences
sort*. The first is a property of **the machine** — ICU version and `LANG` — and the second is a property of **the
data**. A corpus's order has to be the second, because a changed order changes which cases a `slice(0, n)`
selects, i.e. a published population.

The convention is therefore `compareCasePaths`, in `packages/kinetic/src/benchmarks/case-order.ts`, and its
comparator is three-armed:

```ts
export function compareCasePaths(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
```

The third arm is not decoration. `Array.prototype.sort` asks whether two keys are **equal**, and a two-arm
comparator answers `1` — claiming an order between two entries that have none. The repository's own
`comparator-population.test.ts` exists to price precisely that, and `compareCasePaths` is the one row in its
table whose tie-break is **unreachable** — because its keys *are* its parameters. The census's grammar could not
see that shape, so it was extended to the bare form (`a < b`); the alternative was to write a comparator that
matched a reader rather than a requirement.

## 3. What order can and cannot move — measured, so the fix is bounded

The repair changes the ORDER of every uncapped run, so the honest question is what an order can move. Read from
the code rather than assumed:

1. `BenchmarkRunner.runSuite` computes `avgTop1`/`avgTop3`/`avgTop5` at its **line 909**, and makes its only
   stateful call — `this.calibrator.train(...)` — at its **line 963**, i.e. *after* the metrics exist.
2. The calibrator's weights are **read by nothing**. `getCalibrator()` has zero callers outside its own
   definition, and `WeightCalibrator`'s own deprecation block says so in as many words: *"Its weights are never
   consumed. The `TreePruner` ranking reads only the flat `RankingWeights` fields … Training it therefore has no
   effect on any prediction."*

So **an uncapped run's metric is order-independent**, and the published nine cells may not move. A capped run's
**set** is not, and that is what §1 fixed.

### 3.1 And the registered claim that this refutes

`ABLATION_FINDINGS.md` v8's standing follow-ups add: *"Not folded in: it is **not a no-op** for the `selfLearning`
rows, which share a calibrator across cases."* That clause is false, and the evidence is the same docblock:

- `selfLearning` has exactly **one** effect in the study — `const calibrator = config.flags.selfLearning ? new
  WeightCalibrator() : undefined` — and `BenchmarkRunner`'s constructor is `calibrator ?? new WeightCalibrator()`,
  so the flag selects *which instance* the runner trains and never whether it trains.
- Nothing reads calibrated weights, so the shared calibrator cannot make a row order-dependent.

**Which is why `+SelfLearn` reads 0.0 on all three suites in v8's own ledger.** The zero was a *construction*, not
a measurement — the register's *"a tool wired as a SCORE measures zero"* one step further: a tool wired as
nothing at all measures zero for a reason no ablation row can distinguish from inertness.

## 4. The enrolment

| layer | what changed |
| --- | --- |
| the convention | `packages/kinetic/src/benchmarks/case-order.ts`: `compareCasePaths`, `inCaseOrder` |
| its home | this package, because `rcaeval-loader.ts` sorts a suite's case directories — a comparator in `benchmarks/src` could only be read back from the loader through a **dependency inversion**, the defect `DEFAULT_FAILED_EDGE_MODE` had when it lived in the wrong package carrying four declaring sites |
| the traversal | `benchmarks/src/case-corpus-walk.ts`: `walkCaseDirectories` (BFS, marker-terminal, dot-pruned, canonical) and `discoverCaseMetas` |
| the reader | injectable (`CaseWalkOptions.readdir`), so the property is testable with a **scrambled traversal** rather than assumed from a filesystem |
| the runners | `run-rcaeval.ts` and `run-ablation.ts` both `return discoverCaseMetas({ root: dataDir, marker: 'metrics.json', parse: parseCaseDir })` — no post-processing |
| the loaders | three suite listings and two metric-file listings canonicalised |
| the sequences | all fourteen `localeCompare` sites replaced, including the edge order `directional-evidence.ts` shares with the loader and the diagnostic `discoverAllDirectoriesWithMetrics` renders |
| the census | `benchmarks/__tests__/case-traversal-census.test.ts` |

### 4.1 The injected reader is the whole point

The claim is **not** "the output is sorted on this filesystem" — that would be a fact about APFS. The claim is
**the order is a function of the SET, not of the traversal**, and the only way to assert it is to hand the walk
two different permutations of one directory and require the same answer:

```ts
const forwards  = walkCaseDirectories({ root, marker, readdir: readerOf(tree) });
const backwards = walkCaseDirectories({ root, marker, readdir: readerOf(scrambled(tree)) });
expect(backwards).toEqual(forwards);
```

`readdirSync`'s order is unspecified, so a test that relied on the filesystem to produce a scramble would be
asserting a fact about the machine it ran on.

## 5. The census, and the two defects it had in itself

`benchmarks/__tests__/case-traversal-census.test.ts`, three invariants with **no exception list**:

1. **Every `readdirSync` in the source roots canonicalises what it traversed** — the population is derived, so a
   sixteenth traversal is covered the day it is written rather than the day someone remembers this file.
2. **No call site answers from the machine** — zero `.localeCompare(` calls, comment text blanked so the prose
   that explains the convention is not read as an offence.
3. **Both capping runners RETURN the walk's order** and re-order nothing.

One site is exempt, named by FILE with its reason and asserted as an exact one-element set: the walk's own
`(dir) => readdirSync(dir, { withFileTypes: true })`. It is a **concise arrow**, so it has no block for the rule to
read; the order is imposed one level up, and that is proven behaviourally by the two-scramble test.

### 5.1 Two defects the census committed while being written, both recorded rather than tidied away

- **It chose a `while` loop as "the function that owns the traversal."** Its first version walked backwards for
  any line ending in `{`, and a `readdirSync` inside a `while` is owned by the *function* holding the `while`.
  The rule therefore reported five canonical traversals as uncanonical, because a loop never sorts. The repair
  walks outward through the enclosing braces and stops at the first opener that is not control flow.
- **It counted braces inside string and template literals**, and one of those — a multi-line template — was
  blanked to a single line, which shifted every line number after it. It reported a site at a line holding a
  different statement. Both are fixed: literals are blanked with their NEWLINES PRESERVED, which is the property
  that keeps a census's line numbers its own.

### 5.2 And the first version of the delegation assertion was satisfied by a MUTANT

`expect(source).toContain("discoverCaseMetas({ root: dataDir, … })")` is satisfied by

```ts
const out = discoverCaseMetas({ root: dataDir, marker: 'metrics.json', parse: parseCaseDir });
out.sort((a, b) => a.dirPath.length - b.dirPath.length);   // a drift the sibling runner does not share
return out;
```

— i.e. by **exactly the drift the census exists to prevent.** The assertion now reads the function's own body and
requires `return discoverCaseMetas(` with no `.sort(` and no `readdirSync(` in it. This was found by mutating the
source and watching the census **pass**, which is the only way to find it: a green census is evidence about the
census only if a red one is reachable.

### 5.3 And a site that leaves the population (the register's law 30, one iteration later)

`run-ablation.ts` no longer appears in the traversal population at all, because its traversal now **delegates**
and it holds no `readdirSync` of its own. *"Routing a read through a clearer failure can move it out of its own
census"* — written in iteration 99 and fulfilled by iteration 100's own repair. The census asserts that absence
explicitly (`expect(files.has('benchmarks/src/run-ablation.ts')).toBe(false)`) and asserts the delegation below,
because a site that leaves a population must arrive in another one or the repair is only a disappearance.

## 6. Two more censuses fired on the change, and both were right

- **`benchmarks/__tests__/coverage-scope.test.ts`** — "imported by a test but not in `coverage.include`". Its own
  docblock records this hole five times; this is the sixth. `src/case-corpus-walk.ts` is now listed.
- **`packages/kinetic/__tests__/unit/comparator-population.test.ts`** — the derived comparator population grew by
  `compareCasePaths`, so the record had to state its population field. Its signature also failed
  `/^a[.[]/`, which is exactly the assertion §2's grammar extension made wrong; both were widened together.

## 7. Acceptance

**By construction**: no uncapped run's case SET changes, and §3 measures that order cannot move a metric. The
golden nine cells and the whole `signals:` line must therefore be **byte-identical**, and the run below is a
confirmation rather than a measurement.

| suite | OnlineBoutique | SockShop | TrainTicket |
| --- | ---: | ---: | ---: |
| RE1 | 80.0% | 92.8% | 68.0% |
| RE2 | 86.7% | 92.2% | 71.1% |
| RE3 | 80.0% | 45.0% | 51.1% |

## 8. What this does NOT claim

- **It does not claim the capped probes' numbers were wrong.** It claims their populations were a property of the
  filesystem, which makes them unreproducible rather than incorrect — and `prism-pooling-frontier.md` §5's RE2
  window is the largest number the record has produced from one. That document's own #1 follow-up — *re-take RE2
  without the case cap* — is now the named next step rather than a suggestion, and it also discharges the rule
  quoted in §1: an uncapped invocation is not a sampler, so a document may name it.
- **It does not claim `localeCompare` is wrong in general.** It claims it is wrong for a corpus's order. The
  census found no remaining call site in the source roots, so the distinction is currently unused — which is the
  honest statement: the rule is enforced more strictly than the argument requires, deliberately, because the
  argument is the part that gets re-litigated.
- **It does not claim the runners are testable.** All four call `main()` at import time — a fact the record
  already carries and works around — so the walk is proven in its own module and each runner is tied to it by
  source. Guarding those entry points (`isEntryPoint` exists in this repository) would unlock a real cross-runner
  execution fence, and it is not done here.
- **And it does not claim the `readdirSync` order in the exempt primitive is harmless.** The exemption is that the
  order is imposed above it, and the module is asserted to contain that imposition.

## 9. Files

- `packages/kinetic/src/benchmarks/case-order.ts` — the convention.
- `packages/kinetic/src/benchmarks/index.ts` — its barrel export.
- `benchmarks/src/case-corpus-walk.ts` — the traversal.
- `benchmarks/src/run-rcaeval.ts`, `benchmarks/src/run-ablation.ts` — the two runners delegate.
- `packages/kinetic/src/benchmarks/loaders/{rcaeval,aiops2025,rca100}-loader.ts` — five listings canonicalised.
- `benchmarks/src/{directional-evidence,optimize-population,run-ablation,rcaeval-topology}.ts`,
  `scripts/dump-{bothwrong-evidence,loss-metrics,re3-exceptions,re3-metrics}.ts` — the remaining sequences.
- `benchmarks/__tests__/case-corpus-walk.test.ts`, `benchmarks/__tests__/case-traversal-census.test.ts`,
  `packages/kinetic/__tests__/unit/case-order.test.ts` — 23 new tests.
- `benchmarks/vitest.config.ts`, `packages/kinetic/__tests__/unit/comparator-population.test.ts` — the two
  censuses the change had to satisfy.
