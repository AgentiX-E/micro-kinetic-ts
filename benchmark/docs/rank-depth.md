# The depth ladder, completed — what the whole order holds, and what five of it was worth

**Status:** measured on all 1 422 RCABench cases from one `--depth-out` run at this commit, plus one full-width
`--terms-dump` and one A/B on `failureAttribution`. Every number here is a re-reading of artifacts the engine
produced; **no model was called for this iteration** (`$0.00`).

## 1. What was already here, and what was not

The instrument is not new, and this document does not replace it. `benchmarks/src/ranking-depth.ts` has owned the
per-case depth since iteration 262: it splits a miss into **deep** (the graph carries the service and the score put
it below others) and **absent** (no accepted service anywhere in the order), writes one `--depth-out` row per case,
and prints a cumulative ladder. `docs/agentic-headroom.md` §10 used it to report the reachable ceiling as
`92.12 %` at `@20` against `87.83 %` at `@5`, `+16.66 pp`, and `docs/agentic-layer-plan.md`'s ceiling table quotes
that figure.

What the ladder could not do is close. `DEPTH_LADDER` ran to `20` and `DEPTH_TOP_LIMIT` was `20`, so on a corpus
whose orders carry **up to 50** candidates the top rung was not the top: `absent` meant "not in the first twenty", and
the `7.9 %` left over at `@20` could not be attributed to "ranked too low" or to "not ranked". This iteration
raises the limit to `50` — one constant, `DEPTH_TOP_LIMIT` — and adds `25`, `30`, `40`, `50` to the ladder. The
cost is a wider row, paid once per `--depth-out` run.

## 2. The ladder, closed

| K | 1 | 2 | 3 | 4 | 5 | 8 | 10 | 12 | 15 | 20 | 25 | 30 | 40 | 45 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cases | 1 141 | 1 190 | 1 228 | 1 238 | 1 249 | 1 263 | 1 278 | 1 287 | 1 294 | 1 310 | 1 327 | 1 345 | 1 400 | **1 422** |
| share | 80.24 % | 83.68 % | 86.36 % | 87.06 % | 87.83 % | 88.82 % | 89.87 % | **90.51 %** | 91.00 % | **92.12 %** | 93.32 % | **94.59 %** | 98.45 % | **100.00 %** |

**`absent = 0`.** Every one of the 1 422 truths is inside the total order the engine already builds, at rank `45` at the worst, in orders of up to `50` candidates. That is the reading the ladder existed to make and could not, and it settles an argument that had
been running on an assumption: **there is no case where a re-ranking, at any width, is blocked by a missing
candidate.** Whatever the 281 misses are, they are orderings.

Three consequences, each of which changes a sentence elsewhere in this repository:

- The `87.83 %` in `docs/agentic-layer-plan.md` §6 is an **elimination** ceiling and is correct as one — a
  protocol that may only remove cannot promote what the window never showed. The clause that followed it
  (*"no layer can beat 87.8 % without the ranking improving first"*) omitted its own width, and the width is
  `maxCandidates`, which is a flag already accepting `[1, 50]`.
- `docs/agentic-headroom.md` §10's `92.12 %` at `@20` now has a companion at `@30` (`94.59 %`) and a terminator
  at `@45` (`100 %`), so "the ceiling" is visibly a curve rather than a number.
- `docs/depth-reranking-preregistration.md`'s admission rule (`depth ≤ 20`) was set against a ladder whose top rung
  was `20`; the population it admits is unchanged, but the share it leaves out is now known to be re-rankable.

## 3. Where the misses sit

The ladder's increments are a histogram of the truth's rank:

| truth at rank | 1 | 2 | 3 | 4 | 5 | 6–10 | 11–20 | 21–30 | 31–45 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cases | 1 141 | 49 | 38 | 10 | 11 | 29 | 32 | 35 | 77 |
| share of the 281 misses | — | 17.4 % | 13.5 % | 3.6 % | 3.9 % | 10.3 % | 11.4 % | 12.5 % | 27.4 % |

**97 of the 281 misses (34.5 %) are one to three places away.** That is the population a re-ranking layer is for,
and it is entirely inside a five-wide window: a layer that could only decide `rank1 ↔ rank2 ↔ rank3` on 1 422
cases would be worth up to `+97`, `86.36 %`, with no new evidence at all. The far tail is a different problem — 112
cases past rank 20, 77 of them past rank 30 and none past rank 45 — and no ordering of the candidates the engine scored can be blamed for
a truth it placed 31st.

## 4. The two relational passes are worth +68, and only at rank 1

`benchmarks/src/terms-dump.ts` records that the array order is not a function of the scores, because two relational
passes permute a finished list, and that "the flow alone moves 68 of 1 422 cases". Re-sorting the same dump by
`finalScore` alone separates them:

| K | engine order | score order | Δ |
| --- | --- | --- | --- |
| 1 | 1 141 | 1 073 | **+68** |
| 2 | 1 190 | 1 184 | +6 |
| 3 | 1 228 | 1 227 | +1 |
| 5 | 1 249 | 1 249 | **0** |
| 10 | 1 278 | 1 278 | 0 |
| 20 | 1 310 | 1 310 | 0 |
| 30 | 1 345 | 1 344 | +1 |

The `+68` was already on record. What is new is that it is **confined to the first position**: the passes do not
widen the candidate set and do not move any `At-5`, `At-10` or `At-20`. A contribution that lives entirely in the
ordering of the first two plots is a **direction** statement — which endpoint of an edge is the source and which is
the victim — and not a **magnitude** statement. That is the correct shape for the collision/propagation apparatus,
and it is the opposite of what a term can do: a term is affine in its weight, and the weight axis is a measured
plateau (`docs/stability-dispersion.md` §6, `+8/1 422` at the best of eight knobs). The tool's measured
contribution and its shipped form agree.

## 5. The score gap is a calibration curve, and it is not monotone

Every consumer so far has read only the order. The relative gap between the first and second score carries
information about whether the first is right:

| relative gap `(s₁ − s₂)/|s₁|` | cases | Top@1 | accuracy |
| --- | --- | --- | --- |
| `[0.000, 0.005)` | 9 | 4 | 44.4 % |
| `[0.005, 0.010)` | 18 | 5 | 27.8 % |
| `[0.010, 0.020)` | 76 | 11 | **14.5 %** |
| `[0.020, 0.050)` | 93 | 49 | 52.7 % |
| `[0.050, 0.100)` | 95 | 71 | 74.7 % |
| `[0.100, 0.300)` | 372 | 273 | 73.4 % |
| `[0.300, ∞)` | 759 | 728 | **95.9 %** |

Above `0.3` the engine is essentially certain: 759 cases, 53.4 % of the corpus, 95.9 %. Below `0.02` it is
essentially wrong: 103 cases — **7.2 % of the corpus holding 83 of the 281 misses, 29.5 % of them** — at 19.4 %.
The band at `[0.010, 0.020)` scores **14.5 %**, six points below a coin flip over the top two and thirty-eight
below the prior.

### 5.1 The band has a mechanism, and it is a twin

Restricting the 103 smallest-gap cases and asking where the truth is:

| truth at rank | 1 | 2 | 3 | 4 | 5 | >5 |
| --- | --- | --- | --- | --- | --- | --- |
| cases | 20 | **9** | **18** | 2 | 4 | 50 |

**Twice as many of these truths sit at rank 3 as at rank 2.** A small gap is therefore not the engine hesitating
between a cause and a near-cause; it is the engine scoring **two nodes of one shape** alike while the answer lies
behind both. Swapping the top two there scores `8.7 %` against the `19.4 %` the engine already achieves — the
cheapest refutation available of the most obvious repair — and it says what the repair must be: **add evidence, do
not reshape the tie.** A pair of twins is a two-sided relation, and the answer is upstream of both.

## 6. Three candidates, refused

**The failure-flow channel as a ranker.** On the 173 cases whose truth is outside the top five, ordering by
`failedEdge` alone puts the truth first in **78 (45 %)**, against the composite's 0 by construction. As a complete
order it scores **676/1 422 (47.54 %)**, `−465`; the jurisdiction form that re-orders only the stratum the term
measured (the pattern `emission` ships with) scores `−186`. A channel can be decisive on the cases it decides and
useless as an order.

**A gated switch to that channel.** A gate on two observables — the composite gap and the concentration
`s₁/(s₁+s₂)` of the flow values — is net positive tuned on all 1 422 (`gap < 0.2, concentration ≥ 0.7`: 113
admitted, **+54**, `84.04 %`) and survives nowhere else: tuned on one half, read on the other, **+4**
(`78.62 → 79.18 %` on 711) and **+5** (`81.86 → 82.56 %`), against a bootstrap 95 % interval of `[+6, +21]` on the
full-corpus optimum. Two thresholds searched on 1 422 cases buy about fifty cases of fit and four of signal.

**Single-channel recall as a proxy for ranking power.** Ranking the 173 misses by `temporal` alone holds 148 of
them in its top 20 (86 %) and scores **44/1 422** as an order; `failedEdge` holds 103 and scores 676. The
information to separate these cases exists in several channels and **no single channel orders it** — a fusion
problem, and this repository's fusion is a plateau.

## 7. The corpus against its own paper

RCABench's abstract states **1 430** validated failure cases; this corpus holds **1 422** across seven category
shards (HTTP 796, Network 254, Resource 173, Pod 123, JVM 73, Time 2, DNS 1). The difference is **8 cases
(0.56 %)**, is not explained by the Zenodo record (two archives, no case count), and does not move any conclusion
here. It does mean a comparison against a paper that says `1 430` has to name its population, and comparisons in
this repository now do.

The category sizes are the more useful reading: `Time` holds 2 cases and `DNS` holds 1. A per-family claim about
either is a claim about two cases and one case, and the per-family tables elsewhere in this repository inherit
that.
