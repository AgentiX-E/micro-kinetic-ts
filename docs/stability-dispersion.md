# The decisive-stability statistic — a residual against the metric family, not a rank in the case

**Status:** IMPLEMENTED, tested, shipped at `stabilityScope = 'rank'` (the statistic every published number was
taken with). The two fleet arms are pre-registered in `micro-kinetic-ts-docs/preregistration-302.md` and their
reading is appended here as §6 once it exists.

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

Not yet taken. The arms — `stability_weight=0` (control), `stability_scope=fleet,stability_weight=0.1`,
`stability_scope=fleet,stability_weight=0.4`, and `stability_scope=fleet_unbinned,stability_weight=0.1` — are
pre-registered with their falsifier in `preregistration-302.md`, and this section is where their readings and the
per-family regressions will be recorded, refusals included.
