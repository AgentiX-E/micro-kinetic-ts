# The table has four metric rows and printed one number

Every RCAEval cell in this repository is published from one table:

```
║ Method        | Metric | CPU    | DELAY  | DISK   | LOSS   | MEM    | AVERAGE ║
║ Micro-Kinetic | AC@1   |  92.0% |  88.0% |  84.0% |  44.0% |  92.0% |  80.0%  ║
║ Micro-Kinetic | Avg@5  |  92.0% |  88.0% |  84.0% |  44.0% |  92.0% |  80.0%  ║
║ Micro-Kinetic | LA     |  92.0% |  88.0% |  84.0% |  44.0% |  92.0% |  80.0%  ║
║ Micro-Kinetic | TA     |  92.0% |  88.0% |  84.0% |  44.0% |  92.0% |  80.0%  ║
```

Four rows, four identical columns. The row loop declared `{ key, label }` pairs — `avgTop1`/`AC@1  `,
`avgTop5`/`Avg@5 `, `locationAccuracy`/`LA    `, `typeAccuracy`/`TA    ` — and then read the value from

```
const val = perFault ? perFault.accuracy : 0;      // for every row, whatever its key
```

so `key` reached the label and never reached the value. `perFault.accuracy` is Top-1 by construction
(its own comment in `benchmark-runner.ts` says so: *"which is reported as AC@1 and must therefore be
Top-1, NOT Top-K"*). **`Avg@5`, `LA` and `TA` were the `AC@1` column reprinted**, on every cell this
project has ever published.

Nothing failed, for the reason this defect family is dangerous: the four numbers are equal exactly when
every correct case is correct at rank one, which is what a reader hopes to see. It took a paper's
protocol to notice — RCAEval's own convention defines `Avg@5` as `(1/5)·Σ_{k=1..5} Acc@k`, so a case
placed at rank 3 contributes `0.6` and a case at rank 1 contributes `1`.

## What the real numbers are

Reconstructed from the loss censuses of run `40133362501` (RE1, RE2) and `40153872789` (RE3), each of
which records `truthRank` per case — the rank of the ground truth in the **full** ranking, not a
truncated top-5 list:

| cell | n | AC@1 | **Avg@5** |
| --- | ---: | ---: | ---: |
| RE1-OnlineBoutique | 125 | 82.4 | **89.3** |
| RE1-SockShop | 125 | 92.8 | **95.7** |
| RE1-TrainTicket | 125 | 75.2 | **89.3** |
| RE2-OnlineBoutique | 90 | 84.4 | **95.6** |
| RE2-SockShop | 90 | 92.2 | **96.7** |
| RE2-TrainTicket | 90 | 74.4 | **80.4** |
| RE3-OnlineBoutique | 30 | 73.3 | **80.7** |
| RE3-SockShop | 30 | 50.0 | **79.3** |
| RE3-TrainTicket | 30 | 50.0 | **50.0** |
| **735** | 735 | **80.4** | **88.6** |

**The engine's `Avg@5` on the full 735-case population is 88.6%, and its artifact has been calling
80.4% `Avg@5`.** The gap is largest exactly where the ranking is deepest rather than wrong: RE1-TT
`75.2 → 89.3` (+14.1), RE3-SS `50.0 → 79.3` (+29.3), RE3-OB `73.3 → 80.7`. RE3-TrainTicket's
`50.0 = 50.0` is the honest case: its misses are *deep* (rank > 5), so a top-5 average cannot recover
them, and the census says so (`deep 47.4%`).

This is also what makes the published comparison legible. RCAEval's own reference implementations and
the literature around them report `Avg@5`: TraceRCA `0.77` on RE2-TrainTicket, DeCoR `0.600 / 0.704 /
0.486` on SS1/SS2/OB, and arXiv:2609.27069's no-telemetry **floor of `0.488`** — the score a ranker
reaches by placing the true culprit in the top five on 99.7% of incidents, because RCAEval injects
faults into only five services per system. Against that floor this engine's `88.6` is 39.8 pp, and
against RE2-TrainTicket's `0.77` it is `80.4`.

## What ships

| the change | where |
| --- | --- |
| `FaultTypeMetric` gains `top5Correct`, `acc5`, `avg5`, `typeCorrect`, `typeAccuracy`; the per-case loop counts all three beside the Top-1 count, from the same ranking | `packages/kinetic/src/benchmarks/runners/benchmark-runner.ts` |
| `buildMetricRows` / `metricValue` — the one place a row's key becomes a field; the fold moves here with the row it belongs to | `benchmarks/src/rcaeval-metric-rows.ts` |
| the table renders what that module returns and folds nothing of its own | `benchmarks/src/run-rcaeval.ts` |
| a VALUE fence replacing a TEXT one: `accuracy-aggregation.test.ts` demanded the *name* `meanOverFaultTypes` in `run-rcaeval.ts` and was satisfied by a block that printed one number four times | `benchmarks/__tests__/accuracy-aggregation.test.ts` |

`Acc@5` and `Avg@5` are separate fields on purpose. A hit-at-5 count is `Σ_k Acc@k`'s last term alone;
implementing the row from it would print `0.75` where the published metric is `0.65` on the fixture the
test uses, and the difference is invisible on any cell whose misses are all deeper than five. The
fixture is built to separate all three candidate readings (0.5 / 0.75 / 0.65).

`LA` reads Top-1 **by definition** — RCAEval's Location Accuracy asks whether the top-1 prediction named
the right service — so `LA` and `AC@1` are equal in every cell. That equality is a property of the
metric, asserted in the test so a future divergence has to argue with it, rather than a second copy of
the defect.

## Gates

`benchmarks` **1414/1414**; new module at 100% statements/branches/functions/lines; repository
**4837/4837**; `zsh .git/check_fences.sh` → FENCES CLEAR.
