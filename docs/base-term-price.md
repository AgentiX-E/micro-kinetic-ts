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

Arms are dispatched on one commit, one flag apart, read from the `Loss census` block rather than from the
report's fault-type mean (`docs/accuracy-aggregation.md`).

| arm                                        | RCAEval (735) | RE1 | RE2 | RE3 | FSE'26 (1422) Top@1 |
| ------------------------------------------ | ------------: | --: | --: | --: | ------------------: |
| `selfAnomalyWeight = 0` (ablation)         |             — |   — |   — |   — |                   — |
| `selfAnomalyWeight = 0.5`                  |             — |   — |   — |   — |                   — |
| `selfAnomalyWeight = 1` (shipped, control) |             — |   — |   — |   — |                   — |
| `selfAnomalyWeight = 1.5`                  |             — |   — |   — |   — |                   — |
| `selfAnomalyWeight = 2`                    |             — |   — |   — |   — |                   — |

The table is filled by §5 once the dispatches land; an empty cell is a run that has not happened, which is
the only honest rendering of a number nobody measured.

## 5. The reading

_(to be recorded)_

## 6. What this cannot answer

- The oracle's bias, above: the gain side of every arm is a strict upper bound and the loss side is
  invisible until the arm runs.
- The fleet-size asymmetry is a property of `ANOMALY_NORMALIZE_NODE_THRESHOLD`'s `rank` transform, not of
  this coefficient. If the sweep's optimum differs between TrainTicket and the other two systems, the
  finding is that the _space_ is the defect and the coefficient is only where it becomes visible — which
  is the axis `docs/anomaly-space.md` opened and did not finish.
- A weight sweep cannot say what the base term would be worth in a _different_ function (identity, root,
  or a rank-share without `log1p`). Those are shapes, and a shape is a separate arm.
