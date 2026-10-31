# The symmetry mask — PRISM's axiom as a discount, not a score

**Status:** the mechanism is IMPLEMENTED, tested, shipped at weight **0**, and **REFUSED at the first
weight it was measured at** (§4). The PRISM family is now closed in three forms with one cause (§5).

**Owner of:** `--victim-weight` (both runners), `anomaly_knobs=victim=<weight>` on the golden half,
`ranking_knobs=victim_weight=<weight>` on FSE'26.

---

## 1. What the mask is

PRISM (arXiv:2601.21359, Luan Pham — the RCAEval benchmark's own author) localises a root cause from
per-service metrics alone, on one observation:

> Root causes show anomalies in **both** internal properties (cpu, memory, disk, socket) and external
> properties (latency, error, throughput). Affected components show anomalies **only** in external
> properties, because faults propagate through observable interfaces and do not penetrate internal state.

This engine already carries PRISM's score as an additive term (`prismWeight`, shipped 0). The mask is a
different form of the same axiom. For each candidate `v`:

```
Sⁱ(v) = max over INTERNAL channels of deviationZScore      (cpu / mem / disk / socket)
Sᵉ(v) = max over EXTERNAL channels of deviationZScore      (latency / error / throughput / workload)
sym(v) = hasInternal(v) && Sⁱ+Sᵉ > 0 ? 2·min(Sⁱ,Sᵉ)/(Sⁱ+Sᵉ) : 1
```

```
finalScore(v) −= victimWeight × (1 − sym(v)) × log1p(selfAnomaly(v))
```

`sym = 1` means the two channels moved alike, so nothing is discounted; `sym = 0` means only one moved,
which is the victim signature. At weight 1 the term cancels exactly the base term of a candidate that
failed the axiom and exactly half of one that is balanced.

Three decisions are in that definition, and each is a rule this repository has already paid to learn:

1. **No threshold.** The quantity is a ratio, so no constant had to be invented for "how small is small".
   The breadth gate needed a fraction and the trend ceiling needed a cap; both were only defensible as
   values *measured* on a sweep. A ratio needs neither.
2. **Missing internal telemetry is NEUTRAL, not zero.** A component carrying no internal channel is
   `sym = 1`. An axiom about internal properties cannot be applied to a component that has none, and the
   self-time term's failure — a leaf scoring 1.0 by arithmetic because it had no callee — is the same
   mistake one module over.
3. **A mask, not a score.** See §2. This is the whole reason the term exists in this form.

## 2. Why a mask, and the measurement that decided it

Before building anything, PRISM's score was swept as what it already is: an **added** term.
Six arms on the golden nine cells, same commit (`a70a260`), one input each, every other weight shipped.
Control is the push-triggered run at the same commit, re-confirmed by an arm that states `prism_weight` as
absent (`40340844173`), which read the shipped 606/735 to the case.

| arm | run | RE1 (375) | RE2 (270) | RE3 (90) | 735 |
| --- | --- | ---: | ---: | ---: | ---: |
| **shipped** (`prism_weight = 0`) | `40340844173` | **323** | **231** | **52** | **606** |
| `additive 0.25` | `40341373995` | 315 | 242 | 57 | 614 |
| `additive 0.50` | `40341387607` | 313 | **246** | 59 | **618** |
| `additive 0.75` | `40341401043` | 308 | 244 | 61 | 613 |
| `conjunctive 0.25` | `40341334056` | 301 | 239 | 58 | 598 |
| `conjunctive 0.50` | `40341347263` | 290 | 239 | 64 | 593 |
| `conjunctive 0.75` | `40341360380` | 286 | 233 | **64** | 583 |

Three readings, and the third is the interesting one.

**The frontier is still `{w = 0}`** — the register's conclusion survives two enrolments (breadth at
`cba6d5b`, burst removal at `3ab50dc`) with six arms rather than the old grid. Every arm below
`additive 0.50` costs RE1, and RE1 is the cell this engine leads by **0.73 pp**, four cases — a lead the
`additive 0.50` arm would spend entirely (313/375 = 83.47%, below `L0`'s 85.4%).

**`additive 0.50` gains +12 on the 735 fold** (606 → 618) with RE2 231 → 246 and RE3 52 → 59. That is the
largest single-arm gain measured on this population since the breadth enrolment, and it is refused for the
reason above: a fold total is not the goal, every benchmark is.

**`conjunctive 0.75` takes the blocking cell from 15 to 24 of 30** — past PRISM's own conjunctive 23/30
(76.7%) — while costing RE1 **37** cases. That is the trade the axiom does not require. An added score at a
weight that can reorder the whole ranking moves every candidate; the axiom only has something to say about
candidates that fail it. As a bounded multiplier it can move a candidate only relative to the ones that
fail the axiom, and on a case where **every** candidate is external-only — a pure delay fault, which is
what RE1's `delay` and `loss` cells are — it discounts them alike and the order is unchanged by
construction. That is the hypothesis §4's arms test, and it is stated before the measurement rather than
after it.

## 3. The wiring

- `computeChannelExtremes` (`pruning/prism-signal.ts`) is now the ONE place the internal/external split is
  walked; `computePrismScores` consumes it too, so the score and the mask cannot disagree about what `Sⁱ`
  and `Sᵉ` are.
- `computeChannelSymmetry` turns the extremes into `sym`; the map is **absent**, not empty, when the weight
  is 0, so the shipped path does not build it at all.
- The term is `victim`, weight `−victimWeight`, value `(1 − sym) × log1p(selfAnomaly)`, so
  `Σ terms = finalScore` is preserved and the breakdown reports what decided the score. A candidate missing
  from the map reads the neutral symmetry 1: a case the map cannot judge is not a case it can punish.
- `graph.channelSymmetry` carries the map; `RankingWeights.victimWeight` carries the weight, so the
  optimizer sees the field and holds it at the engine's default (registered in `HELD_AT_ENGINE_DEFAULT`).

## 4. The measurement — REFUSED at the first weight, and the mechanism is DENSITY again

Four arms on the golden nine cells and one on FSE'26, same commit (`6118216`), one input each, every
other weight at its shipped value. The prediction in §2 was: RE1 unchanged, RE2/RE3 up, nothing down.

| arm | run | RE1 (375) | RE2 (270) | RE3 (90) | 735 |
| --- | --- | ---: | ---: | ---: | ---: |
| shipped | `40340844173` | **323** (105/117/101) | **231** (77/85/69) | **52** (22/15/15) | **606** |
| `victim=0.05` | `40378653751` | 290 (105/117/**68**) | 215 (77/85/**53**) | 52 (22/15/15) | 557 |
| `victim=0.10` | `40378666957` | 262 (103/117/**42**) | 212 (77/84/**51**) | 53 (22/16/15) | 527 |
| `victim=0.20` | `40378680309` | 237 (102/117/**18**) | 205 (77/83/**45**) | 53 (22/16/15) | 495 |
| `victim=0.50` | `40378692821` | 217 (91/116/**10**) | 194 (76/81/**37**) | 51 (22/14/15) | 462 |
| FSE'26 `victim_weight=0.2` | `40378704523` | — | — | — | Top@1 **55.0%** (was 56.4%), Top@3 66.7, Top@5 68.6 |

**The prediction was wrong in the most informative way.** Online Boutique and Sock Shop are **untouched**
(RE1 105 and 117 at every weight; RE2 77 and 85 until 0.5), RE3 is untouched entirely, and **everything
happens on TrainTicket**: RE1-TT 101 → 68 → 42 → 18 → 10, RE2-TT 69 → 53 → 51 → 45 → 37.

That is the same density signature `docs/topological-source-direction.md` and
`docs/prism-symmetry-mask.md` §2 record for every topological form this engine has measured: on 14 nodes
and 13 edges a re-weighting has almost nothing to reorder, and on 64 nodes over 79 edges it reorders
everything. The mask is not neutral where every candidate is external-only — because **they are not**:
`sym` is a ratio of two DIFFERENT quantities, a resource channel's relative mean shift (cpu 0.29 → 0.26
is 0.10σ) against a transport channel's (latency 4.75 s → 23.5 s is 3.9σ). Those are not commensurable,
so `sym` is small for almost every component, the discount is near-uniform on a sparse graph (hence
"nothing moved" on Online Boutique) and violently non-uniform on a dense one, where the few components
that keep an internal anomaly are the ones with the LARGEST resource shifts — which on TrainTicket's
fan-in graph are the CALLERS retrying, not the source.

### 4.1 The per-case diff says the same thing

RE1-TT at `victim=0.05`: of the 16 sampled miss blocks, **6 become correct** — every one of them a case
whose previous winner carried the bigger external rise (`ts-order-service_delay_3/4/5`,
`ts-route-service_disk_4/5`, `ts-order-service_loss_4`) — and the cell still loses 33 net, so the mask
broke roughly 39 cases that the block sample does not show. A term that fixes a third of the sampled
misses and costs 33 cases on the same cell is not a discriminator; it is a perturbation.

## 5. Verdict: the PRISM family is CLOSED, in three forms, with one cause

| form | best arm | blocking cell | cost | verdict |
| --- | --- | ---: | ---: | --- |
| additive score (`prismWeight`) | `additive 0.50` | RE3-TT 15 → 18 | RE1 **−10** (fold +12) | refused |
| conjunctive score (`prismPooling`) | `conjunctive 0.75` | RE3-TT **15 → 24** | RE1 **−37** | refused |
| symmetry mask (`victimWeight`) | `victim 0.05` | RE3-TT 15 → 15 | RE1 **−33**, FSE'26 −1.4 pp | refused |

All three read the same quantity — a **z-score mean shift**, whose scale is set by each channel's own
units — and all three therefore re-weight this engine's tuned ranking by an amount no other term controls.
The reimplementation of PRISM reads 78.9% on the 735 fold *as a ranking of its own*, which is the regime
the paper's guarantees are for; fused into a ranking that already carries eleven priors and a mask, its
scale is noise.

**What survives.** The RE3-TT measurement at `conjunctive 0.75` — 24 of 30, past PRISM's own 23 — is a
real fact about that cell, and it says the cell's truth does carry internal evidence the engine's ranking
does not exploit. But every way of exploiting it that has been measured so far costs RE1 more than it
gains, and the reason is now measured rather than suspected: **the two channel families are not
commensurable without a per-family normalisation this engine does not have.** That is the requirement a
successor must meet, and it is the same requirement the self-time term's refusal named — a statistic that
compares a node against the FLEET's distribution of the same statistic, never against another family's.

The term ships at 0 with its map unbuilt, its seven tests, and both dispatch keys, so the mechanism can be
re-measured in one dispatch if a per-family normalisation ever exists.
