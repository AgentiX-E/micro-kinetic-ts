# The routing frontier, held out under the criterion the decision was taken on

**Status: measured.** Three questions answered from artifacts already on disk, at zero run cost: whether the
routing lead is real, what a ranker that reads *no telemetry* scores on our metric, and — the one the first
version of this document left open — **whether the lead survives the rule the probe had already applied when it
admitted the router.** One lead survives intact, one shrinks to a third, one is **retracted**.

**Owner of:** the held-out estimate for a threshold router under each of the two criteria, and the telemetry-free
prior floor per suite. Instrument: `benchmarks/src/router-validation.ts`, readback
`benchmarks/src/validate-routing-frontier.ts`, tests `benchmarks/__tests__/router-validation.test.ts` (32) and
`packages/kinetic/__tests__/unit/leaderboard/routing-probe.test.ts`.

## 1. Why this exists

Iteration 77 re-took the routing probe on the full corpus and reported, per suite, a *deployable* zero-regression
router on RE3 — `engine-margin < 0.5671 -> prism`, **+13.33 pp** with zero regressing cells — where RE1 and RE2
reached their frontiers only through a `per-cell-oracle` that reads the truth. It also recorded the caution its own
verdict document had applied two iterations earlier: **that threshold was chosen to maximise the gain on all 90
cases at once**, so the number is an in-sample optimum. An in-sample optimum is not evidence, and the only way to
find out whether it is evidence is to fit on one set and score on a disjoint one.

The second question arrived from outside. **arXiv:2609.27069**, a controlled audit of this benchmark, records that
RCAEval *"injects faults into only five services per system while exposing 12 to 70 in telemetry"*, so a ranker
reading no telemetry is not a coin flip: on the benchmark's `Avg@5` it scores **0.488** against 0.137 for
uniform-random, and *"collapses to 0.192 across systems"*. That is a claim about the benchmark our headline lives
on, and it must be checked against **our** metric rather than assumed to transfer to it.

**The third question is the one this revision exists for.** The first version of this document answered the first
two under *accuracy*, and recorded the omission as a caveat: *"zero-regression is not checked here."* A caveat is
a measurement that has not been taken, and the probe had not been sloppy — `analyzeRoutingProbe` admits a
candidate only if it regresses no cell, so the router this document was validating had **already been selected
under a stricter rule than the one it was being scored under**. Scoring a candidate under a weaker criterion than
the one that admitted it does not overstate a number by a rounding error; it reports a gain the decision was never
allowed to take. So the criterion is now an explicit argument of every fit and every cross-validation, and both are
printed.

## 2. Method

- **Held out, 5-fold, deterministic.** Folds are assigned by position (`i % k`), because a fold assignment that
  varies between runs would make a held-out claim irreproducible — and this repository has already paid once for a
  case *set* that depended on the filesystem.
- **The exact optimum, not a grid.** The candidate thresholds are the observed signal values themselves plus the
  always-engine arm, because a step function's optimum always sits at a breakpoint. Ties resolve to the smaller
  threshold, so two fits on one fold agree.
- **Two criteria, both printed, and neither is a default.** `FitConstraint` is `'max-accuracy' | 'zero-regression'`
  and it is a **required** argument: an option the caller may omit is an open axis, and this repository has already
  paid for one of those. Under `'zero-regression'` a candidate is skipped unless it regresses no unit on the set it
  was fitted on — the same admissibility rule, evaluated in one place, that `analyzeRoutingProbe` applies.
- **The regression unit is the (system × fault-type) pair**, and the baseline it is compared against is the
  always-engine router **on the fold's own cases**, because that is the population the decision is made on. The
  convention is shared with the probe by name and by value: `benchmarks` does **not** depend on
  `@agentix-e/micro-kinetic` and its `tsconfig.json` carries no path for it, so the two implementations cannot be
  imported into one test — the string is pinned by **literal on each side**, and re-keying either alone fails that
  side's own test. On RE3's records the constrained scan reproduces the probe's `bestZeroRegression` **exactly**
  (`engine-margin < 0.5671 -> prism`, 66.67%, zero regressing cells), which is the cross-check that the two
  implementations of the criterion agree.
- **The oracle is not a router.** `ROUTER_SIGNALS` carries `engine-margin`, `prism-margin` and `prism-score` —
  three quantities available at inference time. The probe's `per-cell-oracle` is a (system × fault-type) lookup,
  and a cell is not known before the incident either; keeping it out is the difference between a router and a
  lookup table.
- **Both ARMS are reported, always.** `inSample` is what a frontier table prints; `heldOut` is the estimate; their
  difference is the amount of fitting. **Their difference is not assumed to be positive** — see §5.

## 3. The results (routing-probe artifacts `rp77`, uncapped, 735 cases)

`regr` is the number of **(fold, unit) pairs** the held-out routers scored below the baseline, summed over the five
folds: a count and not a rate, because a percentage of units would read as an accuracy. `held gain` is
`heldOut − baseline`; `fitting` is `inSample − heldOut`. The denominator a `regr` is read against is not
`5 × units` either: a unit whose cases all fall in the same fold is absent from the other four, so the pairs that
**exist** are **75** on RE1, **90** on RE2 and **55** on RE3 (against 15/18/13 distinct units).

| suite | engine alone | signal | criterion | in-sample | held out | held gain | fitting | regr |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| RE1 (375) | 80.27% | `prism-margin` | max-accuracy | 82.40% | 82.13% | +1.87 pp | +0.27 pp | 7 |
| RE1 | | `prism-margin` | **zero-regression** | 80.80% | 80.00% | **−0.27 pp** | +0.80 pp | 1 |
| RE1 | | `prism-score` | max-accuracy | 83.20% | 81.60% | +1.33 pp | +1.60 pp | 8 |
| RE1 | | **`prism-score`** | **zero-regression** | 81.33% | 81.33% | **+1.07 pp** | **+0.00 pp** | **0** |
| RE1 | | `engine-margin` | max-accuracy | 82.13% | 80.80% | +0.53 pp | +1.33 pp | 5 |
| RE1 | | `engine-margin` | zero-regression | 80.27% | 80.27% | +0.00 pp | −0.00 pp | 2 |
| RE2 (270) | 83.33% | `engine-margin` | max-accuracy | 89.63% | 89.63% | +6.30 pp | +0.00 pp | 3 |
| RE2 | | **`engine-margin`** | **zero-regression** | 84.81% | 85.19% | **+1.85 pp** | −0.37 pp | 1 |
| RE2 | | `prism-score` | max-accuracy | 87.04% | 85.93% | +2.59 pp | +1.11 pp | 10 |
| RE2 | | `prism-score` | zero-regression | 84.81% | 83.70% | +0.37 pp | +1.11 pp | 2 |
| RE2 | | `prism-margin` | max-accuracy | 87.04% | 85.93% | +2.59 pp | +1.11 pp | 9 |
| RE2 | | `prism-margin` | zero-regression | 83.70% | 82.96% | −0.37 pp | +0.74 pp | 1 |
| RE3 (90) | 53.33% | `engine-margin` | max-accuracy | 66.67% | 64.44% | +11.11 pp | +2.22 pp | 3 |
| RE3 | | **`engine-margin`** | **zero-regression** | 66.67% | 64.44% | **+11.11 pp** | +2.22 pp | 2 |
| RE3 | | `prism-margin` | max-accuracy | 56.67% | 55.56% | +2.22 pp | +1.11 pp | 1 |
| RE3 | | `prism-margin` | zero-regression | 55.56% | 54.44% | +1.11 pp | +1.11 pp | 1 |
| RE3 | | `prism-score` | max-accuracy | 57.78% | 56.67% | +3.33 pp | +1.11 pp | 2 |
| RE3 | | `prism-score` | zero-regression | 54.44% | 53.33% | +0.00 pp | +1.11 pp | 0 |

**RE3's lead survives the criterion intact.** The constrained and unconstrained held-out figures are *identical*
to the printed precision — **+11.11 pp** either way — because the threshold each fold's train set preferred was
already admissible, and only **2 of the 55** (fold, unit) pairs RE3's folds actually contain regress. Of the
**+13.33 pp** the probe reported in sample, **+11.11 pp is held out under the rule that admitted it.** This is the
first positively-signed, deployable, out-of-sample improvement in the entire ledger, and it is the only one that was
never a product of the weaker measurement.

**RE2's +6.30 pp was two thirds fitting.** Under the criterion the probe uses it is **+1.85 pp**: the unconstrained
arm's advantage came from thresholds that sink a cell, and three of them do. The difference between the two columns
— **4.45 pp** — is the size of the error the missing criterion was hiding; it is the figure the register row now
carries, and it changes no published headline, because the shipped configuration does not route at all (§5.6).

**RE1's +1.87 pp is retracted.** Under the rule, `prism-margin` scores **−0.27 pp**, i.e. a router that is worse
than doing nothing; the deployable arm on RE1 is `prism-score` at **+1.07 pp** with **0** regressed pairs. That is
consistent with the frontier sweep's earlier finding that RE1 admits no positive global PRISM weight: routing does
not rescue it, and at the strength the rule demands it barely helps it either.

## 4. The floor, and why the published critique does not transfer to our metric

| suite | distinct culprits | modal culprit, in sample | **modal culprit, held out** | uniform over them |
| --- | ---: | ---: | ---: | ---: |
| RE1 | 15 | 6.67% | **6.67%** | 6.67% |
| RE2 | 15 | 6.67% | **5.56%** | 6.67% |
| RE3 | 9 | 16.67% | **16.67%** | 11.11% |

**The `Avg@5` floor of 0.488 does not transfer to service Top-1, and the reason is arithmetic rather than
reassurance.** `Avg@5` scores whether the culprit is anywhere in the top five, so a ranker that always emits the
same five services scores 0.488 on this benchmark — which is what that audit measured, and it is a real property of
the benchmark. Our metric asks for the **single** service, and a ranker that always names the most frequent culprit
— fitted on a train fold and scored on a disjoint one — reaches **5.56% to 16.67%**. Against that floor our
headline **78.75%** is a margin of **+62 to +73 pp**, so it is not an artifact of the candidate set.

The uniform column is reported beside it on purpose, and it is the *weaker* of the two floors: it is what a report
would quote if it assumed a uniform ranker over the culprit set, and on RE3 the modal culprit is materially better
than uniform (16.67% vs 11.11%). **A floor stated as `1/|candidates|` understates a telemetry-free ranker**, which
is the direction that makes results look better than they are — so the stronger floor is the one that belongs in a
claim.

## 5. What this does NOT license

1. **Zero regression is guaranteed on the TRAIN folds, not on the fold the router is then scored on.** Each fold
   fits a threshold admissible on its own train set and is scored on cases it never saw; the promise does not
   travel with it. That is why the count is printed, and the constrained rows above read **0, 1 and 2** depending
   on the signal and the suite: **RE3's `engine-margin` 2, RE1's deployable `prism-score` 0, RE2's deployable
   `engine-margin` 1.** RE3's *deployable* arm being the 2 is the honest pair of numbers to hold together — the
   gain is real and two units of it are paid for out of sample. A deployed router needs this count on the
   population it will serve, which no artifact in this repository can supply.
2. **The count is (fold, unit) pairs, not distinct cells.** Five folds over 13–18 units means a unit can be
   counted more than once, and a reader who takes the number for "cells broken" will overstate it; the register
   and this document both say *pairs* for that reason.
3. **`heldOut − baseline` on a suite is not a deployment decision.** RE1 and RE2 are scored by a router chosen for
   *one* signal per row; nothing here selects between them, and a per-suite choice is a third degree of freedom
   that would itself need holding out.
4. **90 cases is 90 cases.** RE3's held-out estimate rests on 18-case test folds; the spread across folds is
   therefore part of the result rather than a footnote, and the instrument prints per-fold values so it can be read.
5. **`fittingAllowance`'s sign is not a law.** The mean of `k` accuracies, each from a router fitted on a different
   train set, is not bounded above by the whole-set optimum — a fold whose cases are easy can score above it, and
   RE2's `−0.37 pp` is that arm. The module documented the opposite as an invariant in its first draft, the test
   that asserted it failed, and the failure is what corrected it.
6. **A router is not a ranking.** Nothing here changes the nine cells: the shipped configuration does not route, so
   the published numbers stand and this is a **candidate**, measured held out, for the next change to be evaluated
   against them.

## 6. The gate this instrument was itself outside of

Iteration 78 added the two modules in §1 and reported their coverage as **99.03 / 96.7 / 100 / 99.03**. Those
numbers were measured over a denominator that **excluded both modules**. `benchmarks/vitest.config.ts` declares an
*allow-list* of measured files rather than an `exclude` pattern, and its own comment records that the list had
**four holes** before it was first checked; the two new modules were a **fifth**, and nothing caught it because the
check that catches it — `benchmarks/__tests__/coverage-scope.test.ts`, which diffs the allow-list against the
modules the tests import — **was failing on `master`**. Both the CI and Release workflows were red at `aa4153c`
for that one reason, so "all workflows green" was also not true of the revision that reported the module as
covered.

The repair is the boring one the list already prescribes: name both modules in the allow-list, then **measure them
in the denominator** and drive every dimension to the repository's bar. They read **100 / 100 / 100 / 100** and
**98.13 / 97.14 / 100 / 98.13**. The residue is two lines — `process.exit(main(...))`, the launcher that by
definition cannot be reached by an import, which is the very reason the module is importable. Its decision is the
part that could be wrong, so the predicate is extracted as `isEntryPoint(argv1, moduleUrl)` and tested in all three
of its outcomes rather than left inside a top-level `if`.

## 7. Verification

`benchmarks/__tests__/router-validation.test.ts` asserts values rather than shapes, on fixtures whose answers are
exact rationals:

- **`bitesFixture`** (4 units, 12 cases) is built so that **the highest-accuracy router sinks a unit**: every
  threshold reaching the two winning units also reaches the one sandwiched between them. The unconstrained optimum
  is hand-computed at **10/12 at threshold 0.7** and the constrained one at **8/12 at threshold 0.3** — so the test
  fails if the rule is not applied, and fails differently if it is applied too broadly. It is also the fixture the
  cross-validation is hand-computed on, fold by fold: per-fold accuracies `[2/3, 2/3, 1, 1]`, thresholds
  `[0.7 × 4]`, and `regressedUnitsHeldOut` **2** unconstrained against **0** constrained.
- **`cleanFixture`** is the same shape with the losing unit moved above every winning margin, and asserts that both
  criteria return the *same* threshold: the rule costs nothing when the gain is clean.
- **The unit** is pinned by literal, and the fixture uses two systems × two fault types so a key that used only the
  system, or only the fault type, cannot pass.
- **Regression accounting** is asserted to be per-unit and impossible to offset: two units improve and one is
  untouched, and the count is still one.
- **The report** is asserted to print both criteria for every signal, to ship the *unit* of the regression count
  with the number, to name the best deployable arm, and to say so when no arm clears the baseline. A fixture where
  every fold's fit is wrong on the fold it is scored on asserts that a **loss** prints as `-25.00pp` rather than as
  an unsigned magnitude.
- **The entry-point guard** is asserted in all three outcomes without spawning a process.

All of it is pure functions: no clock, no filesystem beyond the readback fixture, no network.
