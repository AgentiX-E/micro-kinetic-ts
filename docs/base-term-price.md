# The base term's price — what the anomaly itself is worth in the score

**Status:** the base term's coefficient is a DECLARED value (`DEFAULT_SELF_ANOMALY_WEIGHT = 1`) and the
sweep below is the reading that prices it. Until this document existed, the largest single contribution
to every score was also the one coefficient no arm could state.

**Owner of:** `selfAnomalyWeight`, `--self-anomaly-weight`, `selfanom=` (RCAEval `anomaly_knobs`),
`self_anomaly_weight` (FSE'26 `ranking_knobs`).

---

## 1. What could not be measured before

The ranking is a sum of terms:

```
finalScore(v) = selfAnomalyWeight × log1p(anomaly(v))          ← the model's own quantity
              + sourceWeight  × sourceLikelihood(v)             ← priors over it
              + temporalWeight × onsetEarliness(v)
              − collisionWeight × collisionEnergy(v)
              + topoWeight × topologicalSource(v)
              + logWeight × logScore(v)
              + riseWeight × gatedRise(v)
              + traceWeight × traceActivity(v)
              + prismWeight × prismScore(v)
              + failedEdgeWeight × failedEdgeScore(v)
              + latWeight × edgeLatency(v)
              − poolMetricPenaltyWeight × poolMetricScore(v)
              + stabilityWeight × stabilityScore(v)
              + selfTimeWeight × selfTimeShare(v)
              − victimWeight × (1 − symmetry(v)) × log1p(anomaly(v))
              + dualFamilyWeight × 1[dual family](v)
```

Every coefficient except the first is an exported constant, a `workflow_dispatch` knob and a field on the
artifact's own configuration line. The first was the literal `1` written into the expression, with a
docblock explaining why `log1p` was the right function and stating that "it has no configurable weight".

That sentence was true and it was the defect. A term that cannot be set to 0 cannot be **ablated**, so the
one quantity the kinetic model actually defines — the extensive deviation `anomaly(v)` — was the only part
of the score whose marginal value this campaign had never measured. Every published number is 85.85%
case-level on the nine cells and 60.5% Top@1 on FSE'26 _with_ it, and nothing separated that from the
number the priors alone would produce.

## 2. What the coefficient was hiding

A free read of the shipped configuration's own census (735 cases, `def-re*/rcaeval-loss-census-*.jsonl`)
answers the first part before any dispatch. `log1p` is invertible, so the anomaly behind each printed
contribution can be recovered from the artifact itself.

- **On a small fleet the base term is the ranking.** OnlineBoutique and SockShop are below
  `ANOMALY_NORMALIZE_NODE_THRESHOLD` (20), so their anomaly is a deviation: the gap between the truth and
  the winner is a median **+0.40 / +0.36 / +0.25** in `log1p` units on RE1:OnlineBoutique, RE1:SockShop and
  RE3:SockShop — the same magnitude as `latWeight` (0.561) and larger than every other weight.
- **On a large fleet it is a tie-break.** TrainTicket is 63–69 services, so step 1b replaces the deviation
  with a rank `k/(n−1)` and `log1p` compresses one rank step to **0.008** — 2% of a single prior unit. The
  TrainTicket ranking is therefore decided almost entirely by the priors, and the base term contributes a
  near-constant offset to everyone near the top.
- **A single-term-null oracle over the 98 misses that carry evidence says the base term is the decisive
  term on 50 of them** (51%), against 13 for `dualFamily`, 5 for `lat` and 1 for `log`. 69 of 98 are
  flippable by removing _some_ one term.

The oracle is a biased sample — it counts the flips a removal would produce and cannot count what the
removal would break, because the census records the truth's terms and the winner's and no third
candidate's. That is exactly why the coefficient had to become a knob: the question is not answerable
from an artifact, and the campaign's rule is that a count of cases a change _could_ affect carries no
information about the cases it _does_.

## 3. The instrument

- `DEFAULT_SELF_ANOMALY_WEIGHT = 1` — the literal, named. At 1 the sum is bit-identical to what shipped,
  which the unit suite asserts twice: once as `term === log1p(anomaly)` and once as a score equality
  against an arm that names the constant explicitly.
- Linear response: at weight `w` the contribution is `w·log1p(a)` and the score moves by exactly the term's
  own delta, so a cell that moves between two arms moved because the base term's share changed.
- `WEIGHT_ZERO` at 0 — the one cause the term could not previously produce, and the reason the ablation is
  attributable rather than mysterious.
- The field is on both runners (flag, packed knob, artifact line) and on the L2 search's
  `RankingWeights` projection, so the optimizer can move it and an artifact can be compared with another.

## 4. The sweep

Five arms on one commit (`c515486`), one flag apart, read from the `Loss census` block rather than from the
report's fault-type mean (`docs/accuracy-aggregation.md`). The control is the push-triggered golden run;
each arm's own configuration line carries the value it ran with, read back from the job logs rather than
from the dispatch.

| arm                                        |    RCAEval (735) | RE1 (375) | RE2 (270) |  RE3 (90) |
| ------------------------------------------ | ---------------: | --------: | --------: | --------: |
| `selfAnomalyWeight = 0` (ablation)         | **518 = 70.48%** |     64.3% |     79.6% |     68.9% |
| `selfAnomalyWeight = 0.5`                  |     628 = 85.44% |     86.9% |     87.0% | **74.4%** |
| `selfAnomalyWeight = 1` (shipped, control) | **631 = 85.85%** | **87.2%** |     88.9% |     71.1% |
| `selfAnomalyWeight = 1.5`                  |     628 = 85.44% |     87.5% | **90.0%** |     63.3% |
| `selfAnomalyWeight = 2`                    |     626 = 85.17% |     87.5% |     89.6% |     62.2% |

Per cell, as cases:

| cell               |     w = 0 | w = 0.5 |   **w = 1** | w = 1.5 |   w = 2 |
| ------------------ | --------: | ------: | ----------: | ------: | ------: |
| RE1 OnlineBoutique |    73/125 | 106/125 | **107/125** | 108/125 | 107/125 |
| RE1 SockShop       |    97/125 | 116/125 | **116/125** | 116/125 | 117/125 |
| RE1 TrainTicket    |    71/125 | 104/125 | **104/125** | 104/125 | 104/125 |
| RE2 OnlineBoutique |     77/90 |   79/90 |   **80/90** |   81/90 |   81/90 |
| RE2 SockShop       |     69/90 |   84/90 |   **85/90** |   87/90 |   87/90 |
| RE2 TrainTicket    |     69/90 |   72/90 |   **75/90** |   75/90 |   74/90 |
| RE3 OnlineBoutique |     24/30 |   26/30 |   **25/30** |   24/30 |   24/30 |
| RE3 SockShop       |     11/30 |   16/30 |   **18/30** |   17/30 |   17/30 |
| RE3 TrainTicket    | **27/30** |   25/30 |       21/30 |   16/30 |   15/30 |

## 5. The reading

**The base term is worth +113 cases, +15.4 pp, and the value the formula chose by writing `1` is the optimum
of the five tested.** The top is flat — 0.5, 1.0 and 1.5 are within three cases of each other — and the cliff
is below it. That is the second result this instrument produces and the more useful one: an inherited literal
has become a measured optimum, and the measurement can now be re-run by anyone who doubts it.

Three things the sweep says that the oracle could not.

1. **The oracle was wrong about the direction, and it was wrong by two to one.** Nulling the term flips 50 of
   the 98 misses that carry evidence and loses 163 cases that the census cannot see, because the census
   carries the truth's terms and the winner's and no third candidate's. A count of victories with no count of
   defeats is not a price.
2. **The suites disagree, and the disagreement is systematic.** RE2 is better at 1.5 (88.9 → 90.0: +1
   OnlineBoutique, +2 SockShop, 0 TrainTicket). RE3 is better at 0.5 (71.1 → 74.4: +4 TrainTicket, +1
   OnlineBoutique, −2 SockShop). No weight on the grid regresses no cell except the shipped one, so the
   shipped value stands — but it stands as the compromise the bar selects, not as the best value for either
   suite.
3. **RE3:TrainTicket improves monotonically as the coefficient falls, on every one of its four fault types**
   (f1 6 → 7, f2 5 → 6, f3 6 → 10, f4 4 → 5, at w = 0), while RE1:TrainTicket loses 33 cases over the same
   move, worst on `loss` (13 → 0) and `delay` (16 → 8). The cell is not asking for a smaller unit: it is
   asking for a different ORDER on ties that the rank transform made nearly equal, and `loss` is the class
   where the anomaly is the only evidence there is.

**The coefficient does not move.** `DEFAULT_SELF_ANOMALY_WEIGHT` stays 1: it is the shipped value, it is the
grid's optimum on the total, and it is the only arm that regresses no cell.

## 6. What this cannot answer

- The oracle's bias, above: the gain side of every arm is a strict upper bound and the loss side is
  invisible until the arm runs.
- The fleet-size asymmetry is a property of `ANOMALY_NORMALIZE_NODE_THRESHOLD`'s `rank` transform, not of
  this coefficient. If the sweep's optimum differs between TrainTicket and the other two systems, the
  finding is that the _space_ is the defect and the coefficient is only where it becomes visible — which
  is the axis `docs/anomaly-space.md` opened and did not finish.
- A weight sweep cannot say what the base term would be worth in a _different_ function (identity, root,
  or a rank-share without `log1p`). Those are shapes, and a shape is a separate arm.
