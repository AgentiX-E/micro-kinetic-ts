# The emission term: an absolute per-request rate, measured on all nine cells, and refused

**The finding, in one sentence.** Ranking candidates by the ABSOLUTE change in their own per-request error rate —
Deng Yu's collision source stated as a number rather than as a ratio — takes `RE3:SockShop` from **19/30 to 28/30**,
past the 26/30 the free reading said was the ceiling, and it is still **refused**, because on the same weight it
costs `RE3:TrainTicket` three cases, `RE3:OnlineBoutique` two, and one each in two RE2 cells.

The term ships **OFF** (`emissionWeight = 0`), with the sweep, the mechanism and the refutation recorded here, so
that the next attempt starts from a measurement instead of from the argument.

## 1. What the term is

```
λ(v)   = mean(error | window) / mean(workload | window)        errors per REQUEST at v
Δλ(v)  = λ(v)|post − λ(v)|pre                                    the same unit, across the boundary
share  = max(0, Δλ(v)) / max over the case of max(0, Δλ)
```

`finalScore(v) += emissionWeight × share(v)`, with the case admitted only when its best `Δλ` clears
`EMISSION_MIN_RISE = 0.1` errors per request.

Every other term in the fusion is a RATIO: how far a node moved against its own baseline, how much of a rise a
neighbour explains, whether a shape returns. A ratio cannot say that one node's emission changed ten times as much
as another's while both moved by the same multiple — and that is the reading `docs/rcaeval-error-scale.md` §1 shows
the `RE3:SockShop` misses need: on `re3ss_orders_f1_1` the truth's per-request rate rises `0.84` against a victim's
`0.07`, while the victim's RELATIVE rise is the larger of the two.

In the collision framing the source is the node whose own emission changed at `t₀`; the propagation `τ` is what
raises everyone else's *level* afterwards without their emission having changed. `Δλ` is that sentence as a number,
and it is the only quantity in the sum whose unit is a rate.

The windows are `pre = [first sample, inject)` and `post = [inject, inject + span)` with `span` the recording's own
pre-injection length: equal amounts of time on each side, so a fault that decays is not averaged against a longer
tail. The refusal list is the strict one — an unknown boundary, unaligned channels, a zero-traffic window, a node
whose emission FELL, and a case whose best change is below the floor all produce an ABSENT entry rather than a zero.

## 2. Where the quantity lives, cell by cell

Measured over all 735 cases (`/root/work/emission-scale.py`), the largest `Δλ` per case and the truth's own `Δλ`:

| cell | n | max Δλ p50 | p90 | p99 | truth Δλ p10 | p50 | p90 |
| ---- | -: | --------: | --: | --: | -----------: | --: | --: |
| RE1:OnlineBoutique | 74 | 0.0000 | 0.0001 | 0.0003 | 0.0000 | 0.0000 | 0.0000 |
| RE1:SockShop | 122 | 0.0000 | 0.0458 | 0.2076 | 0.0000 | 0.0000 | 0.0347 |
| RE1:TrainTicket | 123 | 0.0000 | 0.0030 | 0.2250 | 0.0000 | 0.0000 | 0.0000 |
| RE2:OnlineBoutique | 84 | 0.0000 | 0.0029 | 0.1444 | 0.0000 | 0.0000 | 0.0000 |
| RE2:SockShop | 67 | 0.0000 | 0.0514 | 0.4546 | 0.0000 | 0.0000 | 0.0056 |
| RE2:TrainTicket | 89 | 0.0000 | 0.0015 | 0.0279 | 0.0000 | 0.0000 | 0.0000 |
| RE3:OnlineBoutique | 24 | 0.0013 | 0.5865 | 0.7878 | 0.0000 | 0.0000 | 0.0034 |
| **RE3:SockShop** | 30 | **0.2806** | **0.7954** | 0.8348 | 0.0423 | **0.2806** | **0.7954** |
| RE3:TrainTicket | 30 | 0.1003 | 0.9621 | 0.9931 | 0.0000 | **0.0000** | **0.0000** |

Two facts decide this document. First, the floor has a place to stand: `RE1:OnlineBoutique`'s largest change in any
case is `0.0003` errors per request, so a floor of `0.1` cannot make that cell noisy. Second — and this is the
refutation, visible before any engine ran — **on `RE3:TrainTicket` the truth's own emission does not change at all**
(`p90 = 0`), while the case's largest change is `0.96`. The term's premise is false on that cell: there, the node
emitting more per request is not the fault's source but the service that returns the bad value to its callers.

## 3. The free reading, and the cap it set

Ranking by `Δλ` alone, with no engine, no logs and no traces (`/root/work/probe-lambda0.py`):

| cell | count ranking | **`Δλ` ranking** | engine (shipped) |
| ---- | ------------: | ---------------: | ---------------: |
| RE1:OnlineBoutique | 6/74 | 6/74 | 113/125 |
| RE1:SockShop | 44/122 | 44/122 | 119/125 |
| RE1:TrainTicket | 5/123 | 6/123 | 112/125 |
| RE2:OnlineBoutique | 5/84 | 4/84 | 84/90 |
| RE2:SockShop | 7/67 | 11/67 | 89/90 |
| RE2:TrainTicket | 4/89 | 3/89 | 76/90 |
| RE3:OnlineBoutique | 6/24 | 6/24 | 26/30 |
| **RE3:SockShop** | 18/30 | **26/30** | **19/30** |
| RE3:TrainTicket | 0/30 | 0/30 | 22/30 |

The free reading separates the cell the engine loses (19 → 26) and is catastrophic exactly where the engine is
strong, which is why this was never a candidate as a ranking on its own, and why `docs/rcaeval-error-scale.md` §6
pre-registered it as a TERM with a cap of **26/30 measured before the code existed**.

## 4. The sweep, on the complete corpus

`--emission-weight`, everything else shipped, cells that moved (the five not listed were unchanged in every arm):

| arm | RE3:SockShop | RE3:TrainTicket | RE3:OnlineBoutique | RE2:SockShop | RE1:SockShop | total |
| --: | -----------: | --------------: | -----------------: | -----------: | -----------: | ----: |
| 0 (shipped) | 19 | 22 | 26 | 89 | 119 | **660** |
| 0.1 | 21 | — | — | — | — | — |
| 0.3 | 23 | — | — | — | — | — |
| 0.4 | 26 | 20 | — | — | — | — |
| 0.5 | 27 | 19 | — | 88 | 119 | — |
| 0.65 | 28 | 19 | — | 88 | 119 | — |
| 0.7 | 28 | 19 | — | 88 | 119 | — |
| 0.8 | 28 | 17 | — | 88 | 118 | — |
| 1.0 | 28 | 13 | 26 | 88 | 117 | — |

Two readings, both of which matter:

1. **The cap is beaten.** The engine reaches `28/30` where the free reading said `26/30`, and the reason is
   measurable rather than mysterious: `Δλ` alone gets four cases wrong that the engine's own terms get right, so
   the fusion exceeds either instrument.
2. **The cost is real and it is where §2 predicted.** `RE3:TrainTicket` falls 22 → 19 the moment the term is live
   (and to 13 at weight 1.0), on the very cell whose truth emits nothing: the term credits the service that returns
   the fault's errors, which is the failure mode the relative statistic does not have.

The full nine cells at `w = 0.5`, re-measured **after** the duty-cycle window repair of
`docs/duty-cycle-window.md` so the two changes are not confounded:

| cell | shipped | `emission = 0.5` | Δ |
| ---- | ------: | ---------------: | -: |
| RE1:OnlineBoutique | 113 | 113 | 0 |
| RE1:SockShop | 119 | 119 | 0 |
| RE1:TrainTicket | 112 | **113** | **+1** |
| RE2:OnlineBoutique | 84 | **83** | **−1** |
| RE2:SockShop | 89 | **88** | **−1** |
| RE2:TrainTicket | 76 | 76 | 0 |
| RE3:OnlineBoutique | 26 | **24** | **−2** |
| RE3:SockShop | 19 | **28** | **+9** |
| RE3:TrainTicket | 22 | **19** | **−3** |
| **total** | **660** | **663** | **+3** |

## 5. Why it is refused

The net is `+3` and the criterion this record has used for every magnitude lever since iteration 137 is that **no
cell moves down**: a term that buys one cell by selling four is not a better ranker, it is a different trade, and
the trade was already available and already refused (`metricFleetBaseline`, `+0.49pp with 6 regressed fault types`).

The pre-registration was explicit and it failed on both sides of its own axis: `RE3:SockShop` UP ✓ (past the cap),
`RE2:SockShop` flat ✗ (−1), all three RE1 cells flat ✗ (`RE1:TrainTicket` +1, which is the wrong direction for a
claim of flatness even though it is a gain). A guard that is only checked when it passes is not a guard.

So the term ships at **0**, which is inert by construction (the map is not even built), and what it contributes to
this project is the three things a refusal can contribute:

1. **A priced ceiling.** `26/30` from metrics alone, `28/30` from metrics plus the engine's other evidence — the
   remaining misses are not an information problem, and any future change to `RE3:SockShop` can be scored against
   that pair without running the engine.
2. **A measured boundary between the two cells.** The absolute instrument is right where the truth's own emission
   moved (`RE3:SockShop`, truth `p50 = 0.28`) and wrong where it did not (`RE3:TrainTicket`, truth `p90 = 0`), which
   is a property of the CORPUS and is now in the record as a number rather than as a suspicion.
3. **A named next step.** A term that helps one cell and hurts another by the same mechanism needs a
   *case-level admission*, not a weight: what distinguishes the two is whether the node the emission points at is
   also the node the DIRECTION evidence points at (`failedEdge`, `lat`). That conjunction is a separate axis, and it
   is not measured yet.
