# The gate, and the vector that clears it

Iteration 275 ended with a number and a refusal: one weight vector, fitted on half the corpus and read on the other,
gained **+47.3 cases (6.7 pp)** in six fits out of six — and the pre-registered gate refused it, because three fault
families above the twenty-case floor lost cases (HTTPRequestAbort −3, HTTPRequestReplacePath −4, NetworkDelay −6).
The question this iteration had to answer was therefore not "is there a better vector" but **"is there a better vector
that costs no family a case"**, and the recommendation was to answer it as a linear program rather than as another
perceptron.

Doing that required two repairs to the instrument first, and both of them were bugs that had been reporting numbers.

| Reading | Denominator | Number | Share |
|---|---|---|---|
| `Top@1` as published | 1 422 | 1 073 | 75.46 % |
| `Top@1` under the shipped weights, strictly | 1 422 | 1 031 | 72.50 % |
| `Top@1` under the ZERO vector, strictly | 1 422 | 0 | 0.00 % |
| `Top@1` under the ZERO vector, optimistically | 1 422 | **1 073** | **75.46 %** |
| The gate: cases a family above the floor may not lose | 1 031 | 1 011 | — |
| Best gate-clean vector, in sample (3 seeds) | 1 422 | +17.3 mean | +1.22 pp |
| The same vector's held half | 711 | +14.75 mean | +2.07 pp |
| The unconstrained fit it refuses (275) | 1 422 | +154 | +10.83 pp |

---

## 1. The zero vector scores the published run

A case is answered when the engine's first candidate is an accepted one. The engine sorts by score, stably, so a
candidate **level** with the answer keeps its earlier position — and on the artifact, position is the recorded order.
Two readings follow, and they are not the same reading:

- **strict**: the best accepted candidate outscored the best rejected one;
- **optimistic**: the first candidate of the ranking is accepted, ties resolved by position.

Measured on the 1 422-case dump:

| Vector | strict | optimistic |
|---|---:|---:|
| the shipped weights | **1 031** | 1 031 |
| the zero vector | **0** | **1 073** |

The zero vector answers **the published run, all of it, by tie**. Every candidate scores zero, so the artifact's order
decides every case, and the artifact's order *is* the recorded order. This is not a curiosity about an empty vector:
it is a **spurious global optimum of the count function**, and every ascent or linear program written over this
artifact is drawn to it. Iteration 275's own constrained probe returned `w = 0` with "count 1 073" and read it as an
improvement over the 1 031 baseline. It was reading the tie-break.

Ties are otherwise absent from this corpus: under the shipped weights **one** case in 1 422 carries a tie anywhere in
its ranking, and the fitted vectors carry none. So the two readings agree everywhere the weights are real, and the
module reports both rather than choosing: `readUnder` returns `answers` (strict) and `optimistic` (positional) from one
pass over the scores, and the count a change is credited with is the strict one.

## 2. The solver that returned an unfinished tableau as an optimum

The linear program in `weight-reachability.ts` carries a pivot budget, because Bland's rule removes one negative
reduced cost per pivot and a program whose right-hand sides are all zero crawls through degenerate vertices. The budget
was silent: when it ran out, `maximise` returned the tableau it had, and the caller read the value as an optimum and
the duals as a certificate.

It ran out. A 592-row program — the first attempt at a gate-constrained fit — came back with a point whose `‖w‖₁` was
**10.9 against a box constraint that said 1**, and an objective of 0. Both numbers were read as "the gate cannot be
cleared". A solver cannot distinguish "finished" from "ran out" for its caller, so it must not pretend to:
`maximise` now **throws** `the pivot budget was exhausted`, the budget is an explicit parameter so a test can pin the
path, and the contract is asserted in `weight-reachability.test.ts`. The reachability verdicts of iteration 275 are
unaffected — every one of those programs is small enough to converge, and every verdict is still re-ranked or rebuilt
before it is counted.

## 3. The gate as an invariant, not as a penalty

The pre-registered gate is *`Top@1` must not fall, and no family with `n ≥ 20` may lose a case it answered*. A penalty
weighted into one objective trades the two against each other, and the exchange rate it picks is whatever the weight
happened to be. Measured on this corpus (gate weight × cases gained × gate cases lost):

| gate weight | gained | gate cases lost |
|---:|---:|---:|
| 1 | +92 to +136 | 70 to 112 |
| 4 | +82 to +114 | 111 to 116 |
| 16 | +139 to +145 | 67 to 73 |
| 64 | +115 | 27 to 54 |
| 256 | +52 to +58 | 21 to 37 |

Every weight loses the gate, and the trade is the weight's, not the corpus's. `fitUnderGate` therefore refuses the trade
outright: a promotion is **applied only if the gate still holds afterwards**, and a move that would open it is rolled
back.

That check has to be cheap, and it is, by a bound rather than by a shortcut. A step is normalised to Euclidean norm
`rate`, so it moves any candidate's score by at most `rate · max‖v‖`, and a gap can therefore close by at most twice
that. `fragileMask` admits exactly the protected cases whose gap is inside that bound, and `gateViolations` re-reads
them after the step. A protected case the guard skips by more than the bound **provably** kept its answer. The gate is
preserved by induction over the moves, which is why the repair pass the obvious design would need does not exist: a
pass that only fires when the guard failed is a pass no test can reach.

## 4. What it measures

The fitted vector, read on the corpus and family by family against the shipped weights' own reading. Numbers are
recomputed by `run-gate-fit.ts` from the dump; the table below is its output, not a transcription.

```bash
npx tsx benchmarks/src/run-gate-fit.ts --terms <dump>.ndjson --fit --epochs 60 --seed 20261113
```

```
cases 1422   answers 1050   optimistic 1050
gate: 0 case(s) lost, 0 famil(ies) above the floor affected
faultType                            n  before  after  lost
HTTPResponseReplaceCode            231     162    168     0
HTTPRequestReplaceMethod           190     123    124     0
JVMMemoryStress                    171     171    171     0
NetworkPartition                    97      48     48     0
ContainerKill                       89      89     89     0
HTTPResponseDelay                   89      56     58     0
HTTPRequestDelay                    88      57     58     0
HTTPRequestAbort                    60      46     46     0
HTTPResponseReplaceBody             51      45     46     0
NetworkLoss                         48      21     21     0
NetworkCorrupt                      46      23     24     0
HTTPResponseAbort                   44      34     34     0
JVMException                        43      30     35     0
NetworkBandwidth                    42      12     12     0
HTTPRequestReplacePath              39      38     38     0
PodFailure                          24      24     24     0
JVMReturn                           21      12     13     0
NetworkDelay                        21      20     21     0
PodKill                             10      10     10     0  (below floor)
JVMLatency                           7       6      6     0  (below floor)
HTTPResponsePatchBody                4       3      3     0  (below floor)
JVMCPUStress                         2       1      1     0  (below floor)
JVMMySQLLatency                      2       0      0     0  (below floor)
TimeSkew                             2       0      0     0  (below floor)
DNSRandom                            1       0      0     0  (below floor)
```

Nine families gain (HTTPResponseReplaceCode +6, JVMException +5, HTTPResponseDelay +2, and six by +1), nine are
unchanged, **none loses**, and the moves behind it are 186 applied against 22 620 refused. Three seeds reach
**1 047, 1 048 and 1 050** — a spread of three cases on a fit whose move set is one gate refusal away from frozen.

The held-out fits are the ones worth reading carefully, because the gate is a statement about *this* corpus and the
split moves it:

| orientation | seed | train | held | held, vs baseline | held gate lost |
|---:|---:|---|---|---:|---:|
| 0 | 1 | 518 → 524 | 513 → 521 | **+8** | 3 |
| 0 | 20261113 | 518 → 523 | 513 → 520 | **+7** | 4 |
| 1 | 1 | 513 → 547 | 518 → 540 | **+22** | 6 |
| 1 | 20261113 | 513 → 545 | 518 → 540 | **+22** | 9 |

The gain transfers — **+7 to +22 on a half the fit never saw** — and the GATE does not: 3 to 9 protected cases are
lost on the held half in every one of the four fits, because only the training half's families were held to the
floor. That is the honest limit of the claim: *the gate is cleared on the corpus that states it*, which is what a
published weight change means, and there is no evidence here that a vector clears it on unseen cases. A criterion
that is a property of a fixed corpus cannot be transferred by a parameter fit, and pretending otherwise would be the
same error in the other direction.

## 5. The gate's price

| Reading | Cases | Share | Note |
|---|---:|---:|---|
| The unconstrained fit (275) | +154 | +10.83 pp | refused: 13 cases in 3 families |
| The gate-clean fit (this iteration) | +17.3 | +1.22 pp | 0 cases lost, 18 families above the floor |
| **The gate's price** | **−137** | **−9.61 pp** | what "no family may lose a case" costs |

That is the number the register has been missing since iteration 272. The gate is not a formality that the next fit
will satisfy; it removes **89 %** of the reachable gain (137 of 154), and it does so by pinning the vector close to
the published one. A weight change that keeps every family is available — this iteration ships one — but it is worth
1.2 pp, not 10.8.

The honest reading of that trade is not "the gate is wrong". It is that **a single weight vector cannot be both
strictly better everywhere and different**, and the remaining headroom is a per-case decision rather than a parameter
one. Iteration 275's own ceiling says the same thing from the other side: selecting a vector per case reaches 100 % of
the corpus, a single vector 81.6 %.

## 6. Reproducing this

```bash
# the population, the shipped weights' reading and the zero vector's two readings
npx tsx benchmarks/src/run-gate-fit.ts --terms <dump>.ndjson

# the fit, in sample and on either alternating half
npx tsx benchmarks/src/run-gate-fit.ts --terms <dump>.ndjson --fit --epochs 60 --seed 7 --orientation 0

# the module's own tests, and their coverage
cd benchmarks && npx vitest run __tests__/gate-fit.test.ts
```

## 7. What this does not claim

- **Not a maximum, and not approximable to one.** The count is a sum of indicators over a union of cones, and
  maximising it subject to a mandatory subsystem of homogeneous inequalities is **Max FLS**, which is NP-hard even
  when every coefficient is `0` or `1` (Amaldi & Kann, *The complexity and approximability of finding maximum
  feasible subsystems of linear relations*, TCS 147, 1995). The unconstrained version admits a 2-approximation; the
  mandatory subsystem here destroys that guarantee, because it is the subsystem that decides which cones are
  reachable at all. So the fit is a greedy ascent under a hard constraint, its answer is a point the corpus was read
  at, and **no exact ceiling for the gate-constrained count is claimed** — the 100 % per-case ceiling of iteration
  275 is a ceiling on selection, not on a single vector inside the gate.
- **Not an engine measurement.** Every number here is arithmetic over a dump. The shipped 75.46 % is an engine
  reading, and the artifact's own reading of the same weights is 72.50 % — the 42-case gap is the `failedEdge`
  mixture iteration 275 found, and it is why the fitted vector is compared against 1 031 and not against 1 073. The
  confirmation is one dispatch, which needs the corpus and does not run here.
- **Not a term change.** Nothing in the formula moved. Fourteen weights moved, `podState` not among them.
