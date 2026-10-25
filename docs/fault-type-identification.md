# Type accuracy was zero, and the table had been hiding it with the AC@1 column

RCAEval's Table 6 has four rows: `AC@1`, `Avg@5`, `LA`, `TA`. This repository printed all four from
one field for its entire history (see `docs/rcaeval-metric-rows.md`), so `TA` read 82.4% on
OnlineBoutique — a number that was never a type accuracy. Once the row stopped being a copy, it read
**0.0% on all fifteen cells**. Two defects stacked, and the second is the interesting one.

## 1. The engine was not answering the question

`RootCauseResult.faultType` came from `classifyFaultType(score, depth, childContribution)`:

```
score ≥ 0.8 → category CPU    if local, MEMORY if cascaded
score ≥ 0.6 → MEMORY / CONNECTION_POOL
score ≥ 0.4 → CODE_ERROR
otherwise   → UNKNOWN
```

That reads the *score*, the *depth* and the *child contribution*. It answers "how bad, and is this node
the origin or a waypoint" — it never looks at which metric moved or how it moved. Its vocabulary
(`CPU`, `MEMORY`, `CONNECTION_POOL`, `CODE_ERROR`, `UNKNOWN`) is a severity taxonomy, and RCAEval's
ground truth is `cpu`/`mem`/`disk`/`delay`/`loss`/`socket`. Two vocabularies with one member in common,
compared by string equality.

So `TA` was not low. It was **zero by construction**, for every case, on every cell, and no
configuration could have moved it.

## 2. The classifier that was written for this question had never been called

`StatisticalAnalyzer` — Layer 2 of the classifier pyramid in `@agentix-e/micro-kinetic-core` — emits
exactly `MEM`/`DISK`/`CPU`/`DELAY`/`LOSS`/`SOCKET`, from series shapes: monotonic rise, burst with high
CV, periodicity, sustained drift. Nothing in the RCA path had ever instantiated it. Wiring it up took
two lines and exposed three defects inside it, each of which is why it would not have worked if it had
been called:

| defect | what it did |
| --- | --- |
| `minDataPoints` was compared with **`metricSeries.length`** — the number of SERIES — while its own docblock says "minimum data points" | a service carrying one or two series was refused a classification and returned `UNKNOWN`; on a five-metric corpus that is not rare, and the refusal is indistinguishable from "no pattern found" |
| `trendSlope` was a **per-sample absolute slope**, in the metric's own units | the rule that reads it (`trendStrength > 0.3`, the DELAY pattern) was a statement about units: a latency series on a 721-sample window produced **383**, a cpu series produced 0.004. `DELAY` was the only category it could ever emit — measured: every service of every case came back `DELAY@0.75` |
| two rules can fire on one series and the **larger confidence formula wins**, regardless of which pattern the series is | a monotone ramp is both "monotonic increase" (MEM, 0.60) and "high autocorrelation" (CPU, 0.79), and CPU wins — the memory-leak signature is reported as a CPU fault |

The first two are fixed here: `minDataPoints` now tests the series' length (per series, as its name
says), and `trendSlope` is the **relative** drift of the fitted last half against the window mean — the
quantity the field's own docblock described ("ratio … drift detection") and the only form in which one
threshold means one thing for every metric. The third is recorded as the next question rather than
guessed at.

## 3. What the hypothesis is built from

Two sources, in order, and the order is the design:

1. **The dominant metric's family.** A series named `latency-90` measures response time; a node whose
   largest deviation is in it was delayed. `mem` measures memory; `cpu` measures processor time. These
   are *definitional* links — the corpus's own names — not fitted ones, and they are the reason the
   classifier can answer at all on a corpus whose shape rules were never calibrated.
2. **The shape rules**, for a dominant label that names no family (`workload`, `error`, `load`). The
   evidence string says which of the two answered, so a reader can tell a definitional link from a
   statistical one.

The reported object keeps both answers: `category` becomes the hypothesis (that is what `TA` scores)
and `subType`/`severity` stay the descriptor's (that is what says how bad and whether it is local).

## 4. The measurement

RE1-OnlineBoutique, 125 cases, one variable — the same local harness used for every screen in this
record:

| RE1-OnlineBoutique | before | after |
| --- | ---: | ---: |
| CPU | 0.0 | **92.0** |
| DELAY | 0.0 | **100.0** |
| DISK | 0.0 | 0.0 |
| LOSS | 0.0 | 0.0 |
| MEM | 0.0 | **24.0** |
| **TA** | **0.0** | **43.2** |
| AC@1 (control) | 82.4 | **82.4** |

`AC@1` is byte-identical, which is the acceptance criterion for a change that must be type-only: the
ranking is untouched and only the reported category moves.

## 5. The two zeros that remain, and why they are not a defect

`disk` and `loss` stay at 0.0 on RE1, and the reason is a property of the *corpus*, measured two
iterations ago and again here:

- RE1 carries five metric families — `cpu`, `mem`, `latency-50`, `latency-90`, `workload` — plus
  `error` and `load`. **Nothing measures disk I/O and nothing measures packet loss.** A disk fault
  surfaces as a secondary effect (cpu or latency), and a loss fault as a workload drop or an error
  burst.
- The channels that would name them are the log and trace channels, and RE1 carries neither: the loss
  census of run `40133362501` records `log` and `lat` as `INPUT_MAP_EMPTY` on **all 374** cases.

So on this suite the two labels are **unidentifiable from the data that suite ships**, and a classifier
that named them would be guessing. That is also the shape of RE1's weak *localization* columns (`disk`
64.0%, `loss` 48–52%): the same missing channel costs both rows.

RE2 and RE3 carry logs and traces, so the same classifier should do better there — and that is the
dispatch's question, not this document's claim.

## 6. What ships

| the change | where |
| --- | --- |
| `faultHypotheses` per service: dominant-family first, shape rules second, absent for a service with no series | `packages/tree/src/causal/topology-fault-graph.ts` |
| the field on the graph, with the absence of an entry meaning "no series" rather than "low confidence" | `packages/core/src/types/graph.ts` |
| `withFaultHypotheses`: category from the hypothesis, severity and subType from the descriptor, floor 0.35 | `packages/tree/src/pruning/pruner.ts` |
| `computeTA` accepts the full `category+subType` form **or** the bare category — the stricter first | `packages/kinetic/src/benchmarks/runners/metrics.ts` |
| `minDataPoints` tests points, and `trendSlope` is relative | `packages/core/src/utils/classifiers/statistical-analyzer.ts` |

## Gates

`packages/tree` **131 + 3** tests; `packages/kinetic` **1082**; repository green; `zsh .git/check_fences.sh`
→ FENCES CLEAR. Coverage per package in the iteration's record.
