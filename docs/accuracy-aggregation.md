# Accuracy aggregation — one quantity, five owners, two conventions

**Status:** defect found, repaired and fenced. **No published number moves**: the golden half's fold is
reproduced bit-for-bit by the owner's function, and the study half now reports the published convention as
its headline with its own convention printed beside it.

**And §7 closes a residual this repair left in its own scope** — four hand-rolled case-weighted folds still in
`run-ablation.ts`, the runner every ledger number comes from, found by an audit of the `@k` family rather than
by a failing test. Read §7 before trusting §3's *"every site now calls it"*, which was true of the published
fold only.

## 1. The defect

RCAEval's published table reports, per system, an `AVERAGE` column beside one column per fault type. That
column is the **unweighted mean of the fault-type accuracies**, and the nine published cells are its values.
It existed as an inline expression in `benchmarks/src/run-rcaeval.ts`:

```ts
const avg = averages.reduce((s, v) => s + v, 0) / averages.length;   // mean over FAULT TYPES
```

**The same quantity was then implemented fourteen more times across five more sites, and eleven of those in
the other convention** — the mean over CASES:

| site | folded | convention |
| --- | --- | --- |
| `run-rcaeval.ts`, the table's `AVERAGE` | fault-type accuracies → a system's AC@1 | **published** |
| `run-local-bench.ts` | the same | **published, written out a second time** |
| `run-ablation.ts`, per system | the same | case-weighted (`allA1 += avgTop1 × cases`) — **the last site repaired, in §7** |
| `prism-sweep.ts`, `analyzePrismSweep`'s `overall` | the same, over cells | case-weighted |
| `benchmark-runner.ts`, `runAll` | the same, over suites | case-weighted ×4 (**the method has no callers at all**) |
| `benchmark-runner.ts`, the three report formatters | the same, for a summary line | case-weighted ×6 (labelled `weightedAvg`, so honest) |

The two conventions are **not** interchangeable and they are **not** close: they coincide **iff every cell
holds the same number of cases**, which is RE1 (all cells 25 cases) and is not RE2 or RE3. Nothing on any
artifact named which one a number was in.

## 2. The evidence — the frozen artifacts of run `37764638225`

This is not a theoretical concern. The register carried a standing, unexplained disagreement: the study's
instruments read RE3 at **53.33%** where the golden read **58.70%**, and it had been investigated for three
runs as an *input* defect. The golden's own artifact prints the per-fault-type columns, so the two can be
compared cell by cell:

| cell | golden (per fault type) | study (per fault type) | agreement |
| --- | --- | --- | --- |
| RE1 OB | 92.0 / 88.0 / 84.0 / 44.0 / 92.0 | 92 / 88 / 84 / 44 / 92 | **identical** |
| RE1 SS | 100 / 100 / 100 / 68 / 96 | 100 / 100 / 100 / 68 / 96 | **identical** |
| RE1 TT | 80.0 / 72.0 / 48.0 / 48.0 / 92.0 | 80 / 72 / 48 / 48 / 92 | **identical** |
| RE2 OB | 88.9 / 66.7 / 100.0 / 55.6 / 100.0 / 83.3 | 88.9 / 66.7 / 100 / 55.6 / 100 / 83.3 | **identical** |
| RE2 SS | 100.0 / 66.7 / 100.0 / 100.0 / 100.0 / 66.7 | 100 / 66.7 / 100 / 100 / 100 / 66.7 | **identical** |
| RE2 TT | 77.8 / **55.6** / 66.7 / 33.3 / 75.0 / 100.0 | 77.8 / **77.8** / 66.7 / 33.3 / 75.0 / 100 | one cell, 2 cases |
| RE3 OB | 83.3 / 83.3 / 100.0 / 33.3 / 100.0 | {83.3, 83.3, 100, 33.3, 100} | **identical (multiset)** |
| RE3 SS | 60.0 / 20.0 / 0.0 / 100.0 | {60, 20, 0, 100} | **identical (multiset)** |
| RE3 TT | 57.1 / 57.1 / 40.0 / 50.0 | {57.1, 57.1, 40, 50} | **identical (multiset)** |

**Thirteen of the fourteen comparable cells are identical per fault type.** The nine published cells are the
mean over the printed columns; the study's were the mean over the cases:

| system | golden `AVERAGE` (type mean) | study (case mean) |
| --- | ---: | ---: |
| RE3 OB | (83.3+83.3+100+33.3+100)/5 = **80.0** | (9·33.3+3·100+6·83.3+6·83.3+6·100)/30 = **73.3** |
| RE3 SS | (60+20+0+100)/4 = **45.0** | (10·60+3·100+10·20+7·0)/30 = **36.7** |
| RE3 TT | (57.1+57.1+40+50)/4 = **51.1** | (7·57.1+7·57.1+10·40+6·50)/30 = **50.0** |

So the recorded 5.37pp RE3 gap is **entirely a fold**, and RE1 agreed only because 25 = 25 = 25.

## 3. The repair

`packages/kinetic/src/benchmarks/runners/suite-accuracy.ts` owns both conventions:

- `meanOverFaultTypes(values)` — the **published** fold, unit-agnostic and accumulating in input order, so it
  reproduces the golden's inline expression bit-for-bit (the byte-pinned golden fence is the evidence);
- `caseWeightedMean(cells)` — the study's fold, kept because it reports a weight's effect in the unit the
  weight acts on;
- `rollupSuiteAccuracy(cells)` — **both at once**, which is the refusal: a caller cannot obtain the published
  statistic without the case-weighted one appearing in the same object.

Every site now calls it, and each site's **choice** is a call rather than a re-derivation. The study's
instruments report the published convention as the **headline** (`AVG`) and their own as a named second
column (`CW`), and name both on the artifact itself; `analyzePrismSweep` picks its best zero-regression column
in the published convention and ships both curves (`overall`, `caseWeightedOverall`).

## 4. What the record carried, and what the artifacts say

Two things the register stated before this, both now corrected:

1. **§100's hypothesis was wrong, and this is the correction.** It recorded the RE3 gap as probably caused by
   `run-ablation.ts` not attaching per-case trace spans where `run-rcaeval.ts` does, with the "cheap first
   read" being to print whether a case carried spans. The per-fault-type columns above are that read, done
   against frozen artifacts, and they refute the hypothesis: the accuracies are the same numbers. **The
   input was never the problem; the fold was.**
2. **A real, separate asymmetry survives, and it costs exactly one cell.** `run-rcaeval.ts` calls
   `augmentTopologyWithTraces(callGraph, spans, { minCallFrequency: 1 })` for every case that has traces, and
   `run-ablation.ts` never called it — its only route was the runner's `traceOpts`, gated on a feature flag
   that (iteration 72, `corpus-assembly.md`) was named for the shipped step while being a different one. Both
   paths now assemble the corpus through `benchmarks/src/rcaeval-corpus.ts`. The golden's own artifact states the size of
   what the study therefore does without: `[trace] 50/50 cases with traces, 50 pruned, avg edges: 20 → 9
   (55% reduction)` (RE2 OB), `218 → 39` (RE2 TT), `23 → 9` (RE3 OB), `218 → 41` (RE3 TT); RE1 carries no
   traces and records none. **The one cell this shows up in is RE2 TT, one fault type, 2 cases of 9** — every
   other trace-bearing cell agrees per fault type. So it is named and measured as a residual rather than
   claimed as resolved: the two paths do not build one corpus, and the ablation's rows are measured on the
   unpruned graph.

## 5. Acceptance — measured, on run `37785902886`

The nine cells are **byte-identical** (`80.0 / 92.8 / 68.0` · `82.4 / 88.9 / 68.1` · `80.0 / 45.0 / 51.1`), each
per-fault-type column is identical to the frozen reference, and the configuration line matches the pinned
literal including `prismPooling=additive` (and `traceWeight=1` on RE3 alone). CI `37785903455` and Release
`37785902970` are success.

**And the study's production rows now reproduce the published cells.** This is the measurement the repair was
for, and it is a prediction that could have failed:

| suite | study's production row (`+Log +Trace Activity [+Rank]`), published convention | golden cells | difference |
| --- | --- | --- | --- |
| RE1 | 80.0 / 92.8 / 68.0 | 80.0 / 92.8 / 68.0 | **0.0 — exact** |
| RE2 | 82.4 / 88.9 / **69.9** | 82.4 / 88.9 / **68.1** | **+1.8, RE2 TT only** |
| RE3 | 80.0 / 45.0 / 51.1 | 80.0 / 45.0 / 51.1 | **0.0 — exact** |

Two of three suites now agree **exactly**, and the third differs on **exactly the one cell §4 named as the
residual** — RE2 TT, the trace-bearing cell whose corpus the study does not prune. So the residual is no longer
a suspicion: **the study's unpruned corpus is worth +1.8pp on RE2 TT**, in that direction, measured.

The `CW` column is the control that the change is a fold and nothing else. Every v4 row reproduces exactly:
`+PRISM Signal` RE1 82.9 / RE2 88.0 / RE3 54.4; `+Log +Trace Activity +Rank +PRISM` RE1 80.5 / RE2 87.3 /
RE3 65.6; `PRISM Signal (conjunctive)` RE1 76.8 / RE2 84.0 / RE3 66.7; `+Log +Trace +Rank +PRISM (conj)`
RE1 75.5 / RE2 84.0 / RE3 67.8. **No measurement moved; the headline did.**

## 6. Gates

`packages/kinetic` · `benchmarks/__tests__/accuracy-aggregation.test.ts` (the census fence, which found the
runner's nine further copies by asserting their ABSENCE) · `packages/kinetic`'s `prism-sweep.test.ts`, whose one
failing assertion **was** the defect restated as an expectation (`overall[0] === 0.75` for a 75/25 split — the
case mean) and now asserts both conventions · twelve packages plus `benchmarks` swept (a fence in package X
reads package Y's source) · both typechecks · lint · format · **four mutations, four killed**.

## 7. The residual THIS census left, and it was its own

**Status:** defect found by audit, repaired, fenced, **two mutations killed**. **No number moves** — the repair
is a refactor by construction, and §7.4 states how that is checked.

### 7.1 What was left behind

§3 routed the **published** fold to the owner and said *"Every site now calls it, and each site's choice is a
call rather than a re-derivation."* For `run-ablation.ts` that was half true. It called the owner for the
headline and kept **four hand-rolled case-weighted accumulators**:

```ts
allA1 += result.avgTop1 * suite.cases.length;      // ×4, one per metric
…
const avgA1 = totalCases > 0 ? allA1 / totalCases : 0;   // ×4, one per metric
```

**Four sites of the convention this document exists for, in the runner every ledger number comes from.** The
record already said so twice and neither reached the guard: §1's table lists `run-ablation.ts` as a
case-weighted site (`allA1 += avgTop1 × cases` — the expression, verbatim), and the owner module's own docblock
names *"an ablation row"* as the first re-implementation it was written to remove.

### 7.2 How it was found — not by a failing test

By an **audit of the `@k` family** during a verification pass on the benchmark's own metric definitions:
`suite-accuracy.ts`'s consumers were enumerated and the ablation was not among them while `run-rcaeval.ts`,
`run-local-bench.ts`, `benchmark-runner.ts` and `prism-sweep.ts` all were.

The reason no test caught it is the finding: §6's fence covered the runner and the local bench under the title
**"leaves no hand-rolled fold in the two remaining sites"** — a title that *enumerated a population*. The
population §1 names is five sites. **An enumeration standing in for a rule goes stale the moment the population
is larger than the enumeration**, and this one had been stale since it was written.

### 7.3 The repair, and why it is a refactor rather than a re-measurement

Four `AccuracyCell[]` arrays are pushed in the loop in exactly the order the accumulators added them, and folded
once each by `caseWeightedMean`. The owner accumulates `accuracy × cases` and `cases` in cell order and divides
at the end; the inline form accumulated the same two sums in the same order and divided at the end. **Same
cells, same order, same operation** — bit-identical, including the empty-population arm, which returns `0` and
is exactly the `totalCases > 0 ? … : 0` guard removed.

`totalCases` survives as a separate counter, deliberately: the artifact **prints** it (`N case-reps`), which is
a population and not a fold.

### 7.4 The fence, and the two mutations that prove it is real

The new fence is an **ABSENCE over the whole file** rather than a list of known sites — that is the repair for
§7.2's cause, not for its symptom — plus four positive assertions that each fold is a call to the owner:

| mutation | result |
| --- | --- |
| `avgA5` reverted to an inline `reduce((s,c) => s + c.accuracy × c.cases, 0) / totalCases` (a **different name**) | **killed** — the positive assertion `const avgA5 = caseWeightedMean(a5Cells)` fails |
| a hand-rolled accumulator name (`allA1`) reintroduced | **killed** — the absence assertion fails |

Both read **comments-stripped** source, because this repository has paid twice for a text assertion being
defeated by the comment explaining the defect (`benchmark-rcaeval-trigger`'s sampler check; `ablation-engine-
options`'s AVG/CW absence fence). The stripper now lives once in `benchmarks/__tests__/helpers/source-text.ts`:
two fences needing it is two answers to "what does this file say", which is the shape both fences exist to catch.

### 7.5 Measured acceptance — the refactor, verified end to end

**Run `37900344770` on `070e9b4`** (10/10 jobs, 116.5 min). The claim in §7's header is *"no number moves"*, and
§7.3 argues it *by construction*; this is the run that measures it.

| artifact | differing lines vs the previous run (`37886983273`) | of which are a measured value |
| --- | ---: | ---: |
| `rcaeval-re{1,2,3}-results` | 2 each | **0** — one `Total duration: …ms` per file |
| `ablation-re{1,2,3}-results` | 99 each | **0** |

The method matters, because a raw diff of the ablation artifacts reports **297 differing lines** and every one of
them is a wall-clock token (`… 3834ms)` → `… 5743ms)`, `Total duration`). The check therefore **strips timing
tokens and re-diffs**: after normalisation the three golden artifacts and the three ablation artifacts are
**byte-identical**, i.e. all 1 235 lines of each ablation artifact including every `A@1`, every `cw`, every
isolated `Δ`, every per-fault-type cell and every census line.

*An artifact that carries a duration cannot be compared byte-for-byte; it has to be compared on the quantity
anyone reads.* Stating that is the difference between "the run was green" and "the refactor was value-preserving",
and only the second is a claim about the repair.
