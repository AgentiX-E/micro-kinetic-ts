# What each shipped term is worth — leave-one-out on the engine that ships

**Iteration 255.** Until this iteration the ablation battery could price exactly **one** member of the
production vector. `PRODUCTION_ROWS` owned `PRODUCTION` and `PRODUCTION LESS TRACE`, and nothing else, so a
report could answer "what does `traceWeight` buy" and had to describe the rest in prose. This document is the
result of closing that gap: two more single-flag counterfactuals (`LESS LOG`, `LESS RANK`), and the table the
three of them make possible.

The rows are **counterfactuals on the shipped engine**, not a grid search: each removes exactly one member of
the configuration that produced `666/735`, and nothing else. That is a different measurement from the flag cube
the battery also runs — the cube moves twelve booleans and, as `docs/ablation-reference.md` records, most of its
corners are value-identical to the stripped baseline because the weights they switch are `0` by construction.

## The RE3 read — the suite where the terms are observable

`RE3` is where all three members bind: it carries spans (so `traceWeight` has a channel), it carries
`RE3:TrainTicket`'s row-ordering sensitivity (so `rankNormalization` changes the answer), and it carries metric
anomaly (so `logWeight` does). Measured on battery `42636825031` at `1f1b9d14`, `aTop1` per system:

| arm | OnlineBoutique | SockShop | TrainTicket | avg | Δ vs production |
| --- | --: | --: | --: | --: | --: |
| `BASELINE (flags OFF)` | 76.7 | 80.0 | 6.7 | 54.4 | −25.6 |
| **`PRODUCTION (log + trace + rank)`** | **86.7** | **80.0** | **73.3** | **80.0** | — |
| `PRODUCTION LESS TRACE (log + rank)` | 86.7 | 80.0 | 30.0 | 65.6 | **−14.4** |
| `PRODUCTION LESS RANK (log + trace)` | 86.7 | 80.0 | 50.0 | 72.2 | **−7.8** |
| `PRODUCTION LESS LOG (trace + rank)` | 76.7 | 80.0 | 73.3 | 76.7 | **−3.3** |

Three things follow, and only the first was assumed before it was measured.

1. **The three terms are additive on this suite.** `14.4 + 7.8 + 3.3 = 25.5`, against the
   `BASELINE → PRODUCTION` gap of `25.6`. There is no interaction term worth naming, which is why a
   leave-one-out is the right instrument here and a cube is not.
2. **The trace term is worth more than the other two combined**, and it is worth it in ONE cell: `RE3:TrainTicket`
   moves `30.0 → 73.3` (`+43.3` points) while `RE3:OnlineBoutique` and `RE3:SockShop` do not move at all. A
   `+14.4` average that is a `+43.3` in one place is not a broad improvement, and reporting only the average
   would hide that.
3. **`rankNormalization` is not cosmetic.** It is worth `+7.8` on average and `+23.3` on `RE3:TrainTicket`
   (`50.0 → 73.3`) — the largest effect of any binary switch in the shipped vector that is not a signal weight.

## The RE1 read, and the thing it exposes

`RE1` is the opposite case and it is the more important one:

| arm | OnlineBoutique | SockShop | TrainTicket | avg |
| --- | --: | --: | --: | --: |
| `BASELINE (flags OFF)` | 90.4 | 95.2 | 90.4 | 92.0 |
| `PRODUCTION (log + trace + rank)` | 90.4 | 95.2 | 90.4 | 92.0 |
| `PRODUCTION LESS TRACE` | 90.4 | 95.2 | 90.4 | 92.0 |
| `PRODUCTION LESS LOG` | 90.4 | 95.2 | 90.4 | 92.0 |
| `PRODUCTION LESS RANK` | 90.4 | 95.2 | 90.4 | 92.0 |

`LESS TRACE` reading `92.0` on `RE1` was expected and is a null: `RE1` (and both SockShop packs) carry no
`traces.csv`, so the term has no channel and its removal cannot move anything. **`LESS LOG` and `LESS RANK`
reading `92.0` was not expected**, and it says something about this battery that the previous four iterations
did not:

> `PRODUCTION` is a four-flag configuration — `logSignal`, `traceSignal`, `rankNormalization`, `prismSignal`.
> The weights that decide `RE1`'s `92.0` are **none of those four**. They are the eight defaults the ablation
> passes through explicitly and never varies: `selfAnomalyWeight`, `dualFamilyWeight` (+ gate and mode),
> `latWeight` + `latMinRise`, `emissionWeight`, `poolMetricPenaltyWeight`, `stabilityWeight`,
> `anomalyTrendWeight` / `anomalyCvWeight` / `anomalyBreadthWeight`, and `temporalWeight`.

So the honest accounting of `666` is:

| suite | from the eight default weights | from the four flags |
| --- | --: | --: |
| `RE1` | **all of `92.0`** | `+0.0` |
| `RE3` | `54.4` | `+25.6` |

and the battery, as it stands, can price the right-hand column and **cannot price the left-hand one**. That is
this iteration's most useful negative result: the terms the project actually depends on are the ones with no
counterfactual arm, and a table of flag ablations was never going to say so on its own.

The next arms to add are therefore **not** more flags. They are `SELF-ANOMALY OFF`, `DUAL-FAMILY OFF`,
`LAT OFF`, `EMISSION OFF`, `POOL PENALTY OFF`, `STABILITY OFF` and the trend/CV/breadth triple — one weight
each, the same single-removal discipline, so the two columns above become one table.

## The instruments that measure nothing, stated as such

The same battery prices the collision-theory instruments, and they are all `0.0`:

| arm | RE3 avg | Δ |
| --- | --: | --: |
| `+Collision Q(f,f)` (aggregator ON, `collisionWeight = 0`) | 54.4 | 0.0 |
| `+Trace Topo` (extra validation, `traceWeight = 0`) | 54.4 | 0.0 |
| `+SelfLearn` (no weight knob) | 54.4 | 0.0 |
| `+Collision Signal` (`collisionWeight = 1`) | 52.2 | **−2.2** |
| `+Topo Signal` (`topoWeight = 1`) | 37.8 | −16.6 |
| `+Rise Signal` (`riseWeight = 1`) | 30.0 | −24.4 |

The first three are **not measurements of those instruments**: the aggregator is switched on while its weight
stays `0`, so by construction it cannot move a score, and `SelfLearn` has no weight to switch. The rows that do
measure something are the last three, and they are all negative.

**This agrees with an independent audit.** `arXiv:2609.27069` finds no reliable graph-specific effect on RCAEval
(`+0.003` `Avg@5`, `p = 0.844`, six disjoint folds) and locates most of its own model's gain in a *system prior*
rather than a graph residual. Our own counterfactuals say the same thing from the other direction: the
collision/topology weights ship at `0`, and every arm that turns one on loses cases. The repository's claim is
therefore **not** "the graph carries the answer" — it is "a deterministic per-node telemetry score, ordered by a
jurisdiction rule, carries it", with the kinematic layer providing the theory that says which orderings are
admissible rather than the score itself.

## One lead, recorded before it is chased

`+Log +Trace +Rank +PRISM (conjunctive)` reads `86.7 / 53.3 / 93.3` — it takes `RE3:TrainTicket` to **`93.3`**
(`+20.0` over production) and costs `RE3:SockShop` **`26.7`** points in the same move, netting `−2.2`. Its
non-conjunctive twin reads `86.7 / 63.3 / 66.7`.

A `+20 / −27` split is not a knob to turn; it is a **signature**, and it points at the dimension the 254th
iteration found when it closed the emission axis: **how many metric families a service reports**. A conjunctive
pool is a strict AND over a service's metrics — it credits a service only when every family agrees — which is
near-vacuous for a single-family leaf datastore and highly selective for a multi-family service. So the
candidate is "make the pooling condition depend on the observed family count, not on the system name", which is
falsifiable and pre-registrable.

It is **not** actioned in this iteration, and the reason is discipline rather than doubt: a rule chosen after
seeing which system it helps is a rule fitted to two cases, and this repository has already paid for that
(`docs/closed-axes-register.md`, iterations 252–254). It is written down here so the next iteration starts from a
stated hypothesis instead of re-discovering the `93.3`.

## What is missing, and what would falsify this table

- `RE1` and `RE2` leave-one-out rows are produced by the same battery and are read on the next dispatch; this
  document states `RE3` because that is where all three members bind. `RE1` carries no spans, so `LESS TRACE`
  there is a **null by construction** — a cell that cannot move is not evidence of no effect.
- The table prices members of the vector, **not** the vector itself: "production beats baseline by `25.6`" is
  true of `RE3` and not a claim about the other six cells.
- `suppressIdleTransients` and `suppressDemandMetrics` are deliberately **not** arms. They change which cases
  enter the corpus rather than how a case is scored, so a row built on one of them would move two things and
  isolate neither.
