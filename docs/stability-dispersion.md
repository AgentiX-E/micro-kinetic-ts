# The decisive-stability statistic — a residual against the metric family, not a rank in the case

**Status:** IMPLEMENTED, tested, shipped at `stabilityScope = 'rank'` (the statistic every published number was
taken with). The fleet arms are read in §6: **the axis is REFUSED** — every fleet point loses, and the reason is a
unit error in the standardisation rather than an absence of information in `cv`.

| what | where |
| --- | --- |
| the shipped statistic | `computeStabilityScores` → `(n − 1 − rank)/(n − 1)` over ascending `breakdown.cv` |
| the repair | `computeDispersionResiduals` → `(median_peers(cv) − cv(v)) / MAD_peers(cv)` |
| the raw input | `AnomalyFeatures.dominantMetric.dispersionCv` — `σ/μ`, untransformed |
| the knob | `stabilityScope: 'rank' \| 'fleet' \| 'fleet_unbinned'`, `--stability-scope` |
| the dispatch | FSE'26 `ranking_knobs=stability_scope=…`, RCAEval `anomaly_knobs=stabilityscope=…` |

## 1. The defect the rank has

`computeStabilityScores` is a rank mapped into `[0, 1]`. On a 49-candidate case one rank step is `1/48 = 0.0208`,
so two nodes whose `cv` differ by a thousandth and two whose `cv` differ tenfold both move the score by the same
amount. `PROGRESS_2026-11-17g.md` §4.4 measured what that costs: of the 249 misses whose truth already outscores
the winner on a term that is switched ON, **163 have `stability` as their only advantage**, and closing their
median 0.53 score gap on the rank scale needs a multiplier near **×350** — at which point the rank's own
quantisation dominates and `×160` already loses 65 cases.

That sweep is also the reason a weight change is not the repair: it is the demonstration that there is nothing
left to raise.

## 2. The defect ABOVE the rank, which this document found second

A rank cannot lose spacing. But `breakdown.cv` — the quantity `computeStabilityScores` ranks — is not a
dispersion at all:

```
cvBonus = cv > 0.5 ? min(cv, 1.5) × anomalyCvWeight : 0        anomalyCvWeight ships at 0.05
```

Three transformations before the rank ever sees it: **hard-zeroed** below `cv = 0.5`, **saturated** above
`cv = 1.5`, and **scaled into a band 0.05 wide** in between. So the rank is ordering a quantity whose resolution
was destroyed one stage upstream, and a residual standardised inside that band would standardise the three
transformations rather than the node.

`AnomalyFeatures.dominantMetric.dispersionCv` therefore carries the **raw `σ/μ`** beside the bonus. It is a new
OPTIONAL field: absent means the case did not decompose the metric, which is an absence rather than a measured
zero, and `computeDispersionResiduals` reads it and nothing else — no fallback to the bonus, because a statistic
that silently mixed a compressed value with an uncompressed one would be two statistics under one name.

## 3. The statistic

```
peers(v)    = { u measured, u ≠ v, family(u) = family(v) }
centre(v)   = median{ cv(u) : u ∈ peers(v) }
spread(v)   = median{ |cv(u) − centre(v)| : u ∈ peers(v) }        (MAD)
residual(v) = (centre(v) − cv(v)) / spread(v)
```

**Signed**: positive is steadier than its family, negative is more dispersed, `0` is typical. Three design
properties, each pinned by a test:

1. **Leave-one-out.** A node is not in its own reference. Including it shrinks the residual by `1/n` in the
   even-peer case and re-introduces the self-flattery the repair exists to remove — the same rule
   `computeFleetSelfTimeResiduals` follows, for the same reason.
2. **Peers share a metric FAMILY.** `cv` is dimensionless but its distribution is not. The key is the label's
   first two dot-separated segments (`k8s.pod`, `jvm.memory`, `container.cpu`, `db.client`, `http.server`), or the
   whole name below that.
   **The first draft of the pre-registration used the exact label, and the corpus refutes it in one line:** a case
   carries **50 services against 85–87 distinct labels**, so an exact-label bin averages 0.59 members and the term
   would be ABSENT by construction — the failure mode `self-time-share.md` §6 names. The correction is recorded in
   the pre-registration rather than in a commit message, because a key chosen after the fact is a key chosen after
   the reading.
3. **ABSENT, not zero, when the reference is unmeasurable** — a node alone in its family, fewer than two peers (one
   peer is a point, and a point has no spread), or a peer group whose MAD is exactly 0 (the divisor does not
   exist; a residual there would be an infinity dressed as a number, and a `0` would claim typicality in a group
   whose typicality is undefined).

`DispersionCensus` counts all of it from the same loop that writes the scores — `services`, `measured`,
`families`, `singletonFamilies`, `scored`, and `absent` decomposed into `peerShort` and `zeroMad`. A counter
advanced anywhere else is a claim about a population the statistic does not describe.

## 4. Why `fleet_unbinned` is a member rather than a boolean

The mechanism control has to be dispatchable or it is not a control. `fleet_unbinned` is the same residual with
`peers =` every measured candidate, so the arm distinguishes "the residual helps" from "the family key helps" —
the latter being the part of the design that costs something, since binning makes the term ABSENT far more often.
If the unbinned arm matches the binned one, the binning is refuted while the statistic stands, and the next arm
drops the key rather than the residual.

## 5. What does not change

The shipped default is `'rank'`, so at `stabilityWeight = 0` every scope is bit-identical by construction, and at
the shipped weight every published number is untouched. The fleet arms carry their own weight ladder because a new
statistic **invalidates** `DEFAULT_STABILITY_WEIGHT`'s criterion intersection rather than inheriting it: that
weight was the midpoint of a region solved on the rank scale, whose permission ends at `0.008032`, and a
MAD-standardised quantity has `O(1)` magnitude.

## 6. The reading

Four arms on one commit (`1c11c41`), FSE'26 RCABench, all 1 422 cases, no load/engine errors and no empty graphs
on any of them.

| arm | dispatch | Top@1 | Top@3 | Top@5 | saved | broke | **net** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| control | `stability_weight=0` | 1 141 **80.24%** | 1 228 | 1 249 | — | — | — |
| A1 | `scope=fleet, weight=0.1` | 730 **51.34%** | 1 045 | 1 123 | 19 | 430 | **−411** |
| A2 | `scope=fleet, weight=0.4` | 270 **18.99%** | 603 | 782 | 12 | 883 | **−871** |
| A3 | `scope=fleet_unbinned, weight=0.1` | 1 112 **78.20%** | 1 230 | 1 256 | 21 | 50 | **−29** |

Runs `44210815387` (control), `44210819354` (A1), `44210824103` (A2), `44210828265` (A3). The control reproduces the
published bare-dispatch reading exactly — `1 141 / 1 422` — so every delta below is against the same-commit number
and not against a remembered one.

`Top@3` and `Top@5` are printed because A3 moves them **up** while losing the head: `+2` and `+7` over the control.
It is the only arm of the four to raise a depth statistic, and that asymmetry is part of the reading rather than a
consolation.

### 6.1 The displacement, which is the measurement that explains the three columns

A weight is not a lever. What a term buys is the number of decisions it changes, and what it costs is how far it
moves them. Both are in the artifacts, because the per-case verdicts carry each arm's top-5:

| arm | lever (top-1 changed) | breakages that installed a candidate the control ranked **outside its top-5** | saves from control-rank 2 |
| --- | --- | --- | --- |
| A1 `fleet 0.1` | **449** | 340 / 430 = **79.1%** | 9 / 19 |
| A2 `fleet 0.4` | **895** | 790 / 883 = **89.5%** | 5 / 12 |
| A3 `unbinned 0.1` | **71** | 11 / 50 = **22.0%** | 15 / 21 |

At the **same weight**, the family-binned residual changes **6.3×** as many top-1s as the unbinned one (449 against
71), and 79% of what it installs is a candidate the rest of the engine had ranked sixth or worse. That is not a
perturbation on a ranking; it **is** the ranking. The unbinned residual, at the same weight, is a perturbation: 78%
of its breakages are adjacent swaps (`rank1 ↔ rank2`) and only 11 cases come from outside the control's top-5.

### 6.2 The unit error

The two poles fail in **opposite** directions, and both failures are the same arithmetic:

```
score(v) += weight × residual(v)          residual is in MADs of the peer group
```

`fleet` bins peers by metric family **because** family members share units and their `cv` values are therefore
comparable — and that is the same fact as "their `cv` values cluster", i.e. `MAD_peers → 0`, i.e.
`residual → ±10²`. Validity and scale are two properties of one choice, and the pre-registration argued only the
first: it adopted the family key for comparability and then anchored the weight by comparing it to the base term's
`1`, which is an anchor on the **weight axis** and never on the **product** axis. A MAD-standardised residual is a
*significance* quantity — a `t`-like number with no ceiling — and multiplying it by a weight calibrated for bounded
shares is a unit error. `fleet_unbinned` is the mirror image: peers mix families, `MAD` is dominated by cross-family
spread, the residual is small, and the term is harmless **because it is nearly inert**.

So the axis has two poles and neither is usable — *valid but unbounded* and *bounded but invalid* — and the weight
ladder was placed inside the first one's unbounded range. `A2`'s `18.99%` is the closest reading this artifact gives
to the statistic's own standalone accuracy: at `0.4` the term dominates 89.5% of the decisions it touches, so its
top-1 rate is approximately the residual's. Well above the `~5%` a random order over 20–50 candidates would score,
and 61 points below the composite. **`cv` carries order information; the standardisation has no portable scale.**

### 6.3 The verdict the pre-registration gives

> _"If both fleet points are at or below the control, the axis closes **as a class**."_

Both are: `51.34%` and `18.99%` against `80.24%`. **The axis closes as a class**, and no third transform of `cv` is
dispatched under this pre-registration.

The falsifier's second sentence — _"not 'this residual is wrong' but 'the dispersion statistic, in either reading, is
not what decides these rankings'"_ — is **falsified by the same artifact**. At `0.1` the term decided 449 of 1 422
rankings and at `0.4` it decided 895. It decided; it decided badly, for a reason the closure does not state. This is
§303's lesson a second time: a compound falsifier yields **one measured verdict and one unmeasured sentence**, and
the sentence is the one a later reader will quote.

What the closure does NOT license: the claim that the family key was refuted. A3's `−29` with `+7` at `Top@5` and
78% adjacent-swap breakages is the reading of a statistic that is **nearly inert at this weight**, not of a
statistic whose reference is wrong. Prediction 4 asserted the reverse ordering (see §6.4) on distributional
grounds; the artifacts order it by magnitude. Comparability and scale cannot be priced by one arm.

### 6.4 The five predictions, audited

| # | predicted | artifact | verdict |
| --- | --- | --- | --- |
| 1 | A1 gains more than 5 cases | A1 net **−411** (19 saved, 430 broken) | **REFUTED**, in sign |
| 2 | A2's gain exceeds A1's, "in both directions, since a MAD score has no ceiling" | 12 saved vs 19, 883 broken vs 430, net **−871** vs −411 | **CONFIRMED as movement, refuted as gain** — the "no ceiling" clause was the hazard, and it was written as a promise |
| 3 | losses, if any, sit on cases whose node is alone in its family, "ABSENT and therefore inert rather than wrong" | losses concentrate in `ReplaceCode` (80) + `ReplaceMethod` (71) = 151 of 430 | **REFUTED, and it was impossible by construction** — a node alone in its family has no residual, so that bucket cannot produce a loss |
| 4 | A3's regressed-family count is strictly worse than A1's, "because unbinned peers mix families" | A3 broke 50, A1 broke 430 | **REFUTED, reversed** — the mixing that costs validity buys scale |
| 5 | the golden nine cells move at `0.1`, so the golden half is expected to refuse | not read: the criterion is an AND and the FSE'26 half failed first | **UNMEASURED**, not falsified |

Prediction 3 is the one worth keeping. It named a bucket that **cannot be populated**: the guard that makes the
term ABSENT is the same guard that removes it from the sum, so "the losses are where the term is absent" is not a
prediction but a contradiction. A1's saves also carry the §8 tell — 9 of 19 come from control-rank 2, and A3's 15
of 21 — so the part of this statistic that is information is **one-rank-step tie-breaking**, which is exactly what
§8 said would make the honest conclusion "the statistic is at its resolution floor".

### 6.5 What this leaves untested

One repair is *specified* by §6.2 and deliberately **not dispatched**: a bounded squash (`tanh`, or a clip at three
MADs) that makes `weight` mean "the largest contribution this term can add", which restores a portable scale under
either binning. It is a third transform of `cv`, so this pre-registration forbids it, and dispatching it now would
be the weight-fishing the falsifier exists to prevent. It also is not the question the falsifier prescribes next:
that is the 11 bucket-C cases, whose truth leads on **nothing** and which no re-weighting of an existing term can
reach. Order of work is therefore bucket-C first, and a fresh pre-registration — stating the weight in
*contribution* units, measured before the arm — if bucket-C leaves headroom.

One instrument defect is recorded rather than repaired: the pre-registration promised the count of the 163
stability-singleton cases that flip, and that count is **not** in this section, because the bucket-A labels lived
in iteration 301's term dump and the dump was not retained. The nearest reading is A3's 21 saves spread over 12
fault families with no concentration (`ReplaceMethod` 3, `JVMException` 3, then eight families at 1–2). An
instrument whose output is thrown away cannot be re-read, and this is the second time in three iterations that a
census had to be rebuilt because its artifact was gone.
