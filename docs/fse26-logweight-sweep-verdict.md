# FSE'26 logWeight sweep — verdict: the axis is closed, and the metric term is the weak one

Four full 1422-case runs on one commit and one provenance-verified shard set
(`b27894f`, runs 34733455962 / 34737067821 / 34737069332 / 34737066499), read with
`scripts/compare_fse26_runs.py`, which prints each artifact's configuration
verbatim. The sweep existed to price the exchange rate between the two live
terms of the shipped score:

```
finalScore(v) = log1p(selfAnomaly(v)) + logWeight x logScore(v)
```

`logWeight = 1` and every other weight at its 0 default, so these are the only
two terms. `selfAnomaly` is rank-normalised to `[0, 1]` in steps of `1/(n-1)`
(0.020 on a 51-service case); `logScore` is max-normalised to `[0, 1]` and
reaches 1.0 in a single step, so **one step of the log term is worth fifty rank
positions of the metric term**.

## 1. The sweep

| run | `logWeight` | Top@1 | Top@3 | Top@5 | delta |
| --- | ----------- | ----- | ----- | ----- | ----- |
| control | 1.0 | **47.33%** (673) | 60.69% | 65.75% | — |
| 34737067821 | 0.5 | 46.84% (666) | 60.62% | 65.54% | −0.49pp |
| 34737069332 | 0.25 | 43.81% (623) | 56.54% | 61.53% | −3.52pp |
| 34737066499 | **0** | **14.98% (213)** | 28.41% | 38.96% | −32.35pp |

The control reproduces the published 47.33% exactly, which is what makes the
rest comparable.

## 2. The two families move in OPPOSITE directions

| fault type | n | w=1 | w=0 | |
| ---------- | - | --- | --- | - |
| HTTPResponseReplaceCode | 231 | 159 | **11** | log-driven |
| HTTPRequestReplaceMethod | 190 | 123 | **18** | log-driven |
| HTTPRequestAbort | 60 | 47 | **7** | log-driven |
| HTTPResponseReplaceBody | 51 | 45 | **5** | log-driven |
| HTTPRequestReplacePath | 39 | 38 | **1** | log-driven |
| HTTPResponseAbort | 44 | 34 | **1** | log-driven |
| HTTPResponseDelay | 89 | 42 | **12** | log-driven |
| HTTPRequestDelay | 88 | 39 | **13** | log-driven |
| JVMException | 43 | 30 | **7** | log-driven |
| JVMReturn | 21 | 12 | **4** | log-driven |
| **NetworkPartition** | 97 | 39 | **47** | metric-driven |
| **NetworkBandwidth** | 42 | 12 | **18** | metric-driven |
| **NetworkLoss** | 48 | 12 | **17** | metric-driven |
| **NetworkCorrupt** | 46 | 14 | **17** | metric-driven |
| **JVMMemoryStress** | 171 | 4 | **13** | metric-driven |
| ContainerKill | 89 | 1 | **2** | metric-driven |

The log term and the metric term are **anti-correlated in their strengths**: the
log term wins the HTTP error classes, the metric term wins the network and
resource classes. The silent block's total under the metric term alone is
`13/171 = 7.6%`, up from `2.3%` — which means **the block is not lost on the
metric, it is lost to the log term**, exactly as the score-level decomposition
predicted (source `logScore = 0` in 288/288 misses; the winner's is 1.000 in
166/288).

## 3. The axis is closed — with a ceiling, not an argument

Two measurements bound every possible value of `logWeight`, including a PERFECT
per-case selector among them:

| quantity | value |
| -------- | ----- |
| shipped (w=1) | 673 / 1422 = **47.33%** |
| per-fault-type oracle over {w=1, w=0} | 705 / 1422 = 49.58% (**+2.25pp**) |
| per-fault-type oracle over all four weights | 711 / 1422 = **50.00%** (**+2.67pp**) |

An oracle that picks the best weight **per fault type, with the label given for
free**, gains **+2.67pp**. No weight, and no selector over weights, can do
better. That retires the axis: it cannot pay for the silent block, because

1. the block's recovery is not continuous — it is unchanged at w=0.5 (4/171 →
   4/171) and still 6/171 at w=0.25, so the block only responds below the
   weight where the HTTP classes have already collapsed;
2. its own ceiling on this axis is **13/171**, reached only at w=0, which costs
   **460 cases**.
   A trade of 9 cases for 460 is not a trade.

## 4. Why: the flip condition is a bound on the weight, not on the data

The reason the sweep is monotone for the block is a property of the two terms,
not of the data. Both branches of the score normalisation -- rank normalisation
when it is on, min-max scaling when it is off -- map the metric term into
`[0, 1]`. The log term is max-normalised into `[0, 1]` as well. So for a
log-silent source `s` (`L(s) = 0`) against a competitor `w` that is the case's
top emitter (`L(w) = 1`):

```
score(w) - score(s) = [m(w) - m(s)] + logWeight,      m, L in [0, 1]
```

`m(w) - m(s) >= -1`, so the source can only win when

```
logWeight < m(s) - m(w)        i.e. below its own metric ADVANTAGE
```

and that advantage is bounded by 1, because the metric term is confined to the
unit interval. Two consequences:

- **`logWeight = 1` cannot flip a silent source.** The best it reaches is a tie,
  and only in the degenerate case where the source holds rank 1 and the
  competitor rank 0 -- which the service-id tie-break then resolves against it.
  That is why the sweep is monotone for the block, and why no reweighting of the
  metric component was ever going to work: a reweighting of two terms both
  bounded by 1 is a *scaling*, and a scaling cannot exceed the bound.
- **What matters is the SPACING, not the range.** Rank normalisation spaces the
  metric term uniformly at `1/(n-1)` (0.020 on a 51-service case), so the block's
  measured median advantage is only **0.0619** -- about three rank positions.
  Min-max scaling spaces it in proportion to the score distribution, so a
  genuinely extreme excursion can reach an advantage near 1.0 while the bulk of
  the services sit near 0.

That is the actionable part, and it is a different question from any weight. It
also explains the six earlier rejections in one line: every metric-layer
candidate was adjusting the term whose entire top-5 spread is 0.08, against a
term worth up to 1.0.

## 5. What this makes the next question

The sweep prices the two components: **the metric term alone is 14.98%** and the
log term is worth +32.35pp on top. The metric term is therefore the weak one --
below the SOTA average of 21% on its own -- and §4 says its weakness is the
SPACING, not the weight.

The one untested configuration on that axis is the metric term's scaling rule, and
`no_rank_normalization` is the switch that asks it: whether a spacing proportional
to the score distribution gives a genuinely extreme source a large enough
advantage to outvote a full log term, without touching `logWeight`. It is a real
question with a real risk -- `rankNormalization` is load-bearing on TrainTicket
RE3 (3.6% -> 51.1%), so a global flip is neither the recommendation nor available;
the measurement exists to say whether a *conditional* rule is worth designing.

`drop_metrics` was exposed in the same change for the one input ablation that
still carries a large positive necessary-condition bound: the connection-pool
family, at 68 flippable against 25 hurt, never run.

Both are guarded by the standing kill criterion: RCAEval golden 9-cell
bit-identical, FSE'26 zero regressed fault types.
