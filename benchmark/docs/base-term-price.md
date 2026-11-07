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

And on the other half of the kill criterion — 1,422 cases, three arms, the same commit and the same one flag:

| arm                                        |   FSE'26 Top@1 |     Top@3 |     Top@5 |
| ------------------------------------------ | -------------: | --------: | --------: |
| `selfAnomalyWeight = 0` (ablation)         | **62.24%** 885 | **80.7%** | **83.0%** |
| `selfAnomalyWeight = 1` (shipped, control) |     60.48% 860 |     79.0% |     82.2% |
| `selfAnomalyWeight = 2`                    |     57.10% 812 |     74.5% |     78.3% |

The FSE'26 control is also the second identity proof of the naming: it reproduces the run made **before** the
constant existed (`40964283136`, commit `9075e05`) byte for byte — 860 / 79.0 / 82.2 — which is what "at 1 the
sum is unchanged" has to mean on a corpus nobody re-compiled.

## 5. The reading

**The base term is worth +113 cases, +15.4 pp on RCAEval, and on that corpus the value the formula chose by
writing `1` is the optimum of the five tested.** The top is flat — 0.5, 1.0 and 1.5 are within three cases of
each other — and the cliff is below it. That is the second result this instrument produces and the more
useful one: an inherited literal has become a measured optimum, and the measurement can now be re-run by
anyone who doubts it. The third result is §5b's, and it is the one that keeps the sentence honest.

Four things the sweep says that the oracle could not.

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
4. **The one cell that looks flat is flat by arithmetic, not by robustness.** RE1:TrainTicket reads
   104/125 at 0.5, 1, 1.5 and 2 — a plateau across a 4× range, which reads like a cell that does not care.
   It is a cell that cannot be reached. Its misses were asked one question each: does the truth's own anomaly
   point above the winner's, and if so by how much? Fourteen of its 21 say **no** — the truth is ranked below
   the winner on the anomaly itself, so no coefficient recovers them. Of the seven that say yes, one crosses
   at `w = 1.9`, and the other six need `w ∈ {7.8, 10.3, 15.6, 15.6, 31.4, 31.4}`. Against a `dualFamily`
   flag that pays a flat **0.25** in a space whose smallest step is **0.008**, the modal miss is a one-rank
   disagreement outvoted 31 : 1, and the grid's top of 2 is 0.016 — still 16× short. **The axis was never
   flat; the answer sits 15 grid-widths above the tested top.**

## 5a. The ceiling, per cell

The same question asked of all 98 misses: which way does the truth's own anomaly point, and what weight would
be needed to act on it.

| cell               | misses | base points at the WINNER too | base points at the truth | weight that would flip it                       | ceiling |
| ------------------ | -----: | ----------------------------: | -----------------------: | :---------------------------------------------- | ------: |
| RE1 OnlineBoutique |     17 |                            16 |                        1 | 1.2                                             |     108 |
| RE1 SockShop       |      9 |                             8 |                        1 | 2.0                                             |     117 |
| RE1 TrainTicket    |     21 |                            14 |                        7 | 1.9 · 7.8 · 10.3 · 15.6 · 15.6 · 31.4 · 31.4    |     111 |
| RE2 OnlineBoutique |      9 |                             3 |                        6 | 1.0 · 1.1 · 2.4 · 4.4 · 6.3 · 9.2               |      86 |
| RE2 SockShop       |      4 |                             1 |                        3 | 1.2 · 1.4 · 3.2                                 |      88 |
| RE2 TrainTicket    |     15 |                            14 |                        1 | 5.3                                             |      76 |
| RE3 OnlineBoutique |      2 |                             2 |                        0 | —                                               |      25 |
| RE3 SockShop       |     12 |                            11 |                        1 | 5.6                                             |      19 |
| RE3 TrainTicket    |      9 |                             9 |                        0 | —                                               |      21 |
| **735**            | **98** |                        **78** |                   **20** | **7 inside [0, 2] · 8 in (2, 10] · 5 above 10** | **651** |

**The remaining headroom of this axis is 20 cases of 735 — 2.7 pp — and it is bought entirely with the 78
misses whose anomaly ordering is itself wrong.** Three things follow, and they are the reason the coefficient
string is closed rather than merely unpromising:

- **78 of the 98 misses are not a weighting problem.** The truth's anomaly is below the winner's; a bigger
  coefficient makes those cases worse, not better. Three quarters of the loss is upstream of the ranking, in
  the anomaly score or in retrieval, and this document cannot price that.
- **Thirteen of the 20 recoverable cases need a weight the project has never run**, five of them more than
  10 and two at 31.4. Every such arm is a different model, not a tuning step, and nothing here measures what
  `w = 31` does to the 637 cases that are currently right.
- **The cells that prefer a higher weight prefer it for the same reason.** RE2:OnlineBoutique and RE2:SockShop
  are the only two cells where the base term already points at the truth in most misses (6 of 9, 3 of 4);
  they are also the two that gained at `w = 1.5`. That is one mechanism agreeing with itself, and it is the
  mechanism the next section has to explain before any of this is worth re-tuning.

## 5b. The other corpus says the opposite

On 1,422 FSE'26 cases the same coefficient is **monotone decreasing**: 0 is the best of the three arms and 1 is
1.76 pp below it. Removing the term does not liberate a tie-break there — it recovers 25 cases. The movement
is not uniform, and its shape is the reading:

| fault type               | w = 0 | w = 1 | w = 2 | total | Δ(0 − 1) |
| ------------------------ | ----: | ----: | ----: | ----: | -------: |
| ContainerKill            |    38 |    26 |    18 |    89 |  **+12** |
| HTTPResponseReplaceCode  |   167 |   160 |   151 |   231 |   **+7** |
| JVMMemoryStress          |    60 |    55 |    44 |   171 |   **+5** |
| HTTPRequestReplaceMethod |   126 |   123 |   115 |   190 |       +3 |
| NetworkBandwidth         |    18 |    21 |    21 |    42 |       −3 |
| HTTPRequestDelay         |    54 |    56 |    57 |    88 |       −2 |
| HTTPRequestReplacePath   |    36 |    38 |    38 |    39 |       −2 |

Four fault families pay for the term — a killed container, a memory stress, a replaced response code, a
replaced method — and three are paid by it. The first two are the **resource** regimes, where a deviation
score should be the best evidence available; the other two are **substitution** regimes, where what changes is
a value rather than a level, so a level-based anomaly is close to uninformative there and its ordering is
noise. And `ContainerKill` is the regime in which the fault _destroys the series the term reads_ — a killed
pod stops emitting, so on the truth the anomaly is computed from a truncated or falling series while its
neighbours carry the loud deviation. On the RCAEval half the same asymmetry is measured directly: **78 of the
98 evidence-carrying misses have the truth ranked BELOW the winner on the anomaly itself**, which is the
"quiet truth" inversion `docs/re3-quiet-truth.md` found on RE3 and this census now shows on the whole 735
(11 of 12 on RE3-SockShop, 14 of 21 on RE1-TrainTicket, 14 of 15 on RE2-TrainTicket, 16 of 17 on
RE1-OnlineBoutique). The phenomenon is not a cell's quirk. It is the corpus.

So the price of this term is **+113 cases on RCAEval and −25 on FSE'26**, and the two corpora are not
disagreeing about the coefficient: they are disagreeing about the fault mix. RCAEval's 735 sit mostly in the
classes the term pays for; FSE'26's 1,422 include four large families where it does not. A single global
constant cannot express that, and the honest report is the exchange rate — **moving it to 0 buys 25 FSE'26
cases and costs 113 RCAEval cases, 4.5 to 1 against**, and moving it to 2 costs both.

## 5c. What the coefficient is not allowed to say

The verdict below is therefore not "1 is optimal". It is narrower and it is the only claim the two
instruments jointly support.

**The coefficient does not move.** `DEFAULT_SELF_ANOMALY_WEIGHT` stays 1: it is the shipped value, it is the
grid's optimum on the RCAEval total, it is the only arm that regresses no RCAEval cell, and on the other
corpus it is 1.76 pp off an arm that costs 113 cases on this one. Every value on the grid regresses a
benchmark; 1 regresses the smaller one, by the smaller amount. The register entry records a **trade**, not a
verdict, and the two arms that would test the trade properly are named and unrun: `w = 0.5` on the FSE'26
half, which locates the crossing rather than assuming it is monotone, and any per-case gate on the term's own
input — a rule that reads how far the top two anomalies are apart and pays the term only when they are far
enough apart to mean something (§5a: 12 of RE1-TrainTicket's 21 misses sit within two rank steps) — which is
the only form that could take both sides of the trade at once.

## 5d. The space, measured and refused

The first thing a flat coefficient suggests is that the coefficient is not what is wrong. On TrainTicket the
anomaly is rank-normalised, so its smallest step is 0.008 and every gap in §5a is a multiple of it: if the
large-fleet ranking needs magnitude, the **space** is the lever and not the weight. The engine has carried the
alternative all along — `rankNormalization = false` runs `minmax`, an affine rescale that keeps the deviation,
in units of the fleet's widest one.

That arm is now run. One input (`no_rank_normalization`), one commit, 735 cases, everything else shipped:

| cell               | rank (shipped) | minmax |  Δ |
| ------------------ | -------------: | -----: | -: |
| RE1 OnlineBoutique |            107 |    107 |  0 |
| RE1 SockShop       |            116 |    116 |  0 |
| RE1 TrainTicket    |            104 |    103 | −1 |
| RE2 OnlineBoutique |             80 |     80 |  0 |
| RE2 SockShop       |             85 |     85 |  0 |
| RE2 TrainTicket    |             75 |     71 | −4 |
| RE3 OnlineBoutique |             25 |     25 |  0 |
| RE3 SockShop       |             18 |     18 |  0 |
| RE3 TrainTicket    |             21 |     15 | −6 |
| **735**            |        **631** |**620** | **−11** |

Two things this measures, and the second is the general one.

1. **The flag's population is exactly the population the threshold defines, case for case.** All 490 cases below
   `anomalyNormalizeNodeThreshold` have identical outcomes to the shipped run — 490 of 490, not "the six cells
   did not move" — and all 13 cases that differ are on the three TrainTicket cells. That is the check
   `docs/anomaly-space.md` §9 said was untestable on two thirds of the benchmark, and it now has a number:
   zero cases, in both directions, by construction.
2. **Magnitude does not help, so the flat coefficient was not hiding a scale problem.** All three TrainTicket
   cells get **worse**, RE3:TrainTicket by a quarter of its cases. The flattened rank order is not what the
   large-fleet ranking is suffering from; it is what it is _surviving on_. Restoring the deviation restores the
   loudness of the neighbours — the inversion §5b names — so an order that preserves magnitude preserves the
   wrong ordering: on these cells the truth is the quiet node. **The space axis closes on the same corpus, and
   for the same reason, as the weight axis.**

## 6. What this cannot answer

- The oracle's bias, above: the gain side of every arm is a strict upper bound and the loss side is
  invisible until the arm runs.
- ~~The fleet-size asymmetry is a property of the `rank` transform, not of this coefficient.~~ **Answered by
  §5d and the answer is the opposite of the guess**: the space was the first suspect and it is now a measured
  refusal — −11 cases, all three large-fleet cells down. What remains unexplained is not the space and not the
  coefficient but the ordering the two of them read, which is the quiet-truth inversion and belongs to
  `docs/re3-quiet-truth.md`, not here.
- A weight sweep cannot say what the base term would be worth in a _different_ function (identity, root,
  or a rank-share without `log1p`). Those are shapes, and a shape is a separate arm.
