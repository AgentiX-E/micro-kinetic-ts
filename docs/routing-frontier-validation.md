# The routing frontier, held out — and the floor our headline must clear

**Status: measured.** Two questions answered from artifacts already on disk, at zero run cost: whether the routing
lead is real, and what a ranker that reads *no telemetry* scores on our metric. **The lead survives; the published
critique of this benchmark's floor does not transfer to Top-1.**

**Owner of:** the held-out estimate for a threshold router, and the telemetry-free prior floor per suite.
Instrument: `benchmarks/src/router-validation.ts`, readback `benchmarks/src/validate-routing-frontier.ts`, tests
`benchmarks/__tests__/router-validation.test.ts`.

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

## 2. Method

- **Held out, 5-fold, deterministic.** Folds are assigned by position (`i % k`), because a fold assignment that
  varies between runs would make a held-out claim irreproducible — and this repository has already paid once for a
  case *set* that depended on the filesystem.
- **The exact optimum, not a grid.** The candidate thresholds are the observed signal values themselves plus the
  always-engine arm, because a step function's optimum always sits at a breakpoint. Ties resolve to the smaller
  threshold, so two fits on one fold agree.
- **The oracle is not a router.** `ROUTER_SIGNALS` carries `engine-margin`, `prism-margin` and `prism-score` —
  three quantities available at inference time. The probe's `per-cell-oracle` is a (system × fault-type) lookup,
  and a cell is not known before the incident either; keeping it out is the difference between a router and a
  lookup table.
- **Both arms are reported, always.** `inSample` is what a frontier table prints; `heldOut` is the estimate; their
  difference is the amount of fitting. **Their difference is not assumed to be positive** — see §5.

## 3. The results (routing-probe artifacts `rp77`, uncapped, 735 cases)

| suite | engine alone | signal | in-sample | **held out** | held gain | fitting |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| RE1 (375) | 80.27% | `prism-margin` | 82.40% | **82.13%** | **+1.87 pp** | +0.27 pp |
| RE1 | | `prism-score` | 83.20% | 81.60% | +1.33 pp | +1.60 pp |
| RE1 | | `engine-margin` | 82.13% | 80.80% | +0.53 pp | +1.33 pp |
| RE2 (270) | 83.33% | **`engine-margin`** | 89.63% | **89.63%** | **+6.30 pp** | **+0.00 pp** |
| RE2 | | `prism-margin` | 87.04% | 85.93% | +2.59 pp | +1.11 pp |
| RE3 (90) | 53.33% | **`engine-margin`** | 66.67% | **64.44%** | **+11.11 pp** | +2.22 pp |
| RE3 | | `prism-score` | 57.78% | 56.67% | +3.33 pp | +1.11 pp |
| RE3 | | `prism-margin` | 56.67% | 55.56% | +2.22 pp | +1.11 pp |

**The RE3 lead survives.** Of the **+13.33 pp** the probe reported, **+11.11 pp is held out** — two thirds of the
gap between the engine and PRISM's best on the suite where both are weakest, from a threshold a fold can re-fit
without seeing the cases it is scored on. **This is the first positively-signed, deployable, out-of-sample
improvement in the entire ledger.**

**RE2's arm is the most stable of the three**: its in-sample and held-out figures are *identical* to the printed
precision, i.e. the threshold does not move between folds at all. **RE1 gains little on any signal** (at most
+1.87 pp), which is consistent with the frontier sweep's earlier finding that RE1 admits no positive global PRISM
weight — routing does not rescue it either.

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

1. **Zero-regression is not checked here.** This instrument reports *accuracy*; the probe's frontier reports
   accuracy **subject to zero regressing cells**, and the two are different quantities. RE2's +6.30 pp held-out
   gain is therefore **unconstrained**, and whether an `engine-margin` threshold there also regresses no cell is a
   separate measurement that has not been taken. Stating the gain without that is exactly the error this repository
   keeps finding.
2. **90 cases is 90 cases.** RE3's held-out estimate rests on 18-case test folds; the spread across folds is
   therefore part of the result rather than a footnote, and the instrument prints per-fold values so it can be read.
3. **`fittingAllowance`'s sign is not a law.** The mean of `k` accuracies, each from a router fitted on a different
   train set, is not bounded above by the whole-set optimum — a fold whose cases are easy can score above it. The
   module documented the opposite as an invariant in its first draft, the test that asserted it failed, and the
   failure is what corrected it. *That is the second wrong expectation this iteration's tests caught; the code was
   right both times and the expectation was guessed.*
4. **A router is not a ranking.** Nothing here changes the nine cells: the shipped configuration does not route, so
   the published numbers stand and this is a **candidate**, measured held out, for the next change to be evaluated
   against them.

## 6. Verification

`benchmarks/__tests__/router-validation.test.ts` asserts values rather than shapes: the exact optimum on a fixture
whose breakpoints are checkable by hand; the tie rule; that routing is strictly below the threshold; that a
threshold is always either the always-engine arm or an observed breakpoint; that folds partition every index
exactly once and refuse `k < 2`; that the algebra of `heldOutGain` and `fittingAllowance` holds exactly; that an
unstable prior is visible; and that the modal rule breaks ties by name so the floor is reproducible. 16 tests, all
passing, on a module that is pure functions end to end.
