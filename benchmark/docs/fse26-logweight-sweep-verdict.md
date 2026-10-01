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

## 6. The two probes, measured — the metric term's SPACING is not the lever either

Three runs on `2ad5450` (34741483868 / 34741486275 / 34741488203), all 1422
cases, read with `scripts/compare_fse26_runs.py`.

**The control reproduces 47.33% bit-for-bit**, which is the point of running it:
the config-ownership change (every override now passed only when non-empty, and
every runner-owned input default emptied) did not move the shipped default.

| run | configuration | Top@1 | Top@3 | Top@5 | regressed types |
| --- | ------------- | ----- | ----- | ----- | --------------- |
| control | shipped | 47.33% | 60.69% | 65.75% | — |
| `no_rank_normalization=1` | metric term min-max instead of rank | **47.33% (+0.00pp)** | 60.69% | 65.75% | — |
| `drop_metrics=db.client.connections.*` | 7 labels | 47.47% (+0.14pp) | 61.11% | 65.89% | **5** |

### The spacing hypothesis is falsified

`no_rank_normalization` moves the aggregate by **exactly zero** — and six fault
types move in opposite directions, cancelling:

| fault type | control | min-max |
| ---------- | ------- | ------- |
| HTTPResponseReplaceCode | 159 | **160** |
| HTTPRequestReplaceMethod | 123 | **124** |
| HTTPResponseAbort | 34 | **35** |
| NetworkPartition | 39 | **38** |
| HTTPResponseDelay | 42 | **41** |
| HTTPRequestReplacePath | 38 | **37** |

And the silent block does not move **at all**: JVMMemoryStress 4/171 in both,
ContainerKill 1/89 in both, PodFailure 0/24 in both. So §5's question is
answered, negatively: a spacing proportional to the score distribution gives the
block nothing. The reason is §4 — both branches bound the metric term to
`[0, 1]`, so neither can exceed a full log term, and the two services at the top
are close in raw score as well as in rank, so the spacing does not widen the
decisive gap.

This is the case the comparison script was built for: a per-type table reports
opposite-signed movement that an aggregate cannot show, and here the aggregate
would have read as "the switch does nothing".

### The last input ablation is rejected

Dropping the connection-pool family is net-positive and fails the kill criterion:

| fault type | control | dropped |
| ---------- | ------- | ------- |
| ContainerKill | 1 | **4** |
| NetworkLoss | 12 | **14** |
| NetworkCorrupt | 14 | **15** |
| JVMException | 30 | **31** |
| JVMLatency | 2 | **3** |
| NetworkPartition | 39 | **40** |
| **NetworkDelay** | 16 | **10** |
| HTTPResponseReplaceCode | 159 | 158 |

`NetworkDelay` falls from 16/21 to 10/21, and the target block barely moves
(ContainerKill +3, JVMMemoryStress +0). So the family that carried the largest
positive necessary-condition bound (68 flippable against 25 hurt) behaves like
`metricFleetBaseline` before it: a small net gain paid for with type regressions.
It stays as an off-by-default probe.

### What is now closed, and what that leaves

With the metric term bounded to `[0, 1]` in **both** normalisation branches and
the log term reaching 1.0 in one step, §4's condition is a bound on the whole
shipped functional form: a log-silent source loses to the case's top log emitter.
Every lever inside that form has now been measured and rejected —

| lever | result |
| ----- | ------ |
| every `logWeight` (oracle, label given) | +2.67pp ceiling |
| both metric-normalisation branches | 0.00pp, block unmoved |
| every metric input ablation | connection pool +0.14pp / 5 regressions; the other four by necessary-condition bound |
| any monotone compression of the metric term | provably cannot reorder; measured −2.67pp |
| fleet-relative baseline | +0.49pp / 6 regressions |
| anomaly breadth | coin flip |

The silent block's 288 misses are therefore **unreachable within the shipped
score**, and the gap is not a tuning deficit: it is that the victim's interface
evidence is worth a full `±1.0` while the source's resource evidence is confined
to `[0, 1]` and the source has no log term at all by construction.

The reachable headroom is elsewhere, and the `logWeight = 0` run says where. The
network and resource classes are the ones the metric term wins and the log term
loses (NetworkPartition 39 → 47, NetworkBandwidth 12 → 18, NetworkLoss 12 → 17,
NetworkCorrupt 14 → 17), and they sit at 29–41% — the largest low-scoring family
outside the structural block (233 cases, 152 misses). The next measurement is a
per-service diagnostic on the HTTP and Network categories, using the tooling that
resolved the block, to determine whether those misses are the same
direction-ambiguity class or a different and addressable mechanism.
