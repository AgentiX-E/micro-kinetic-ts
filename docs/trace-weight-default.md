# The trace weight: a pin that was doing 44 points of work

**Status:** the value moved from the dispatch into the engine. `DEFAULT_TRACE_WEIGHT` is `1`, the golden RE3
step no longer states `--trace-weight 1`, and `PRODUCTION_ROWS` is one row plus the single-flag counterfactual
that prices the term. This document is the measurement that moved it, and the two things it does NOT show.

| what         | where                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| the constant | `DEFAULT_TRACE_WEIGHT` (`packages/tree/src/pruning/pruner.ts`)                 |
| the dispatch | `.github/workflows/benchmark-rcaeval.yml`, `trace_weight` input, no `else` pin |
| the battery  | `PRODUCTION_ROWS` (`benchmarks/src/ablation-engine-options.ts`)                |
| the corpus   | `/root/RCAEval-all`, 723 cases, nine cells                                     |

## 1. The state that made this measurable

The runner shipped `traceWeight = 0` and the golden `RE3` job added `--trace-weight 1` inside the guard that
forwards a dispatch input. Two consequences, both of them defects rather than style:

1. **The same source produced two answers.** A local run of the cell that CI calls `74.5%` printed `30.6%`,
   because the difference was a line of YAML. Nothing in the artifact said which of the two it was — the
   `signals:` banner prints the value a run RESOLVED to, not the value it should have had.
2. **The published configuration was not a point in the battery's cube.** `productionFlags(suite)` had to
   return a different vector per suite, which is why the ablation row that reproduced the published `RE3`
   numbers was labelled after its three flags instead of being called production.

## 2. The A/B, unconfounded for the first time

The pin's original evidence was taken against a control that also had `noInjectTime` on, so the two arms
differed in two things. This table differs in one: both arms run the RCAEval baseline protocol (injection time
known), the shipped defaults, and only the weight changes. Cell rates are the published type-mean; `flips`
counts CASES whose top-1 answer changed, which a cell rate can hide in a two-way swap.

| cell               | cases | `traceWeight = 0` | `traceWeight = 1` |                                                                               flips |
| ------------------ | ----: | ----------------: | ----------------: | ----------------------------------------------------------------------------------: |
| RE1 OnlineBoutique |   125 |              89.6 |              89.6 |                                                                 0 (no `traces.csv`) |
| RE1 SockShop       |   120 |              95.0 |              95.0 |                                                                 0 (no `traces.csv`) |
| RE1 TrainTicket    |   123 |              89.2 |              89.2 |                                                                 0 (no `traces.csv`) |
| RE2 OnlineBoutique |    87 |              93.1 |              93.1 |                                                                             0 of 87 |
| RE2 SockShop       |    90 |              97.8 |              97.8 |                                                                 0 (no `traces.csv`) |
| RE2 TrainTicket    |    90 |              83.3 |              83.3 | 0 of 90 — the first 30 locally, all 90 in CI at the new default (run `42039524547`) |
| RE3 OnlineBoutique |    28 |              87.5 |              87.5 |                                                                             0 of 28 |
| RE3 SockShop       |    30 |              66.1 |              66.1 |                                                                 0 (no `traces.csv`) |
| RE3 TrainTicket    |    30 |          **30.6** |          **74.5** |                                                  **13 of 30, all gains, none lost** |

Every flip is listed by the case-level diff, not summarised: thirteen cases, all `ts-auth-service`, all
`MISS -> hit`. Not one case moved the other way on any cell.

## 3. Why the term is worth 44 points on one cell and nothing on eight

The term is BINARY (`0` or `1`, no magnitude) and the adjacent-rank gap of the base term on rank-normalised
TrainTicket is `0.0083` at 68 nodes, so at weight `1` it can override ~100 rank positions. It is therefore not a
refinement of the metric ranking; it is a **volume prior** that replaces the top of it: the service whose spans
move most is taken to be the source.

That is worth 44 points exactly where the metric-only ranking is worst — `RE3:TrainTicket` is the cell with 69
services and one-step misses — and it is worth nothing where either the corpus has no spans (`RE1`, both
SockShop packs) or the prior agrees with the ranking already (`RE2:OnlineBoutique`, `RE3:OnlineBoutique`: zero
case flips on 115 cases between them).

The prior's cost is visible in the same cell: after the move, **eight of the nine remaining misses are one
service** (`ts-route-service`) losing to a trace hub the prior ranks at the maximum, with the truth carrying 27
post-injection ERROR lines and the winner carrying none. That is the next problem, and it is not a weight.

## 4. What this measurement does NOT show

- **`RE2:TrainTicket` is measured in CI, not here.** The 90-case cell exhausts a 6 GB heap on BOTH arms in this
  container (`FATAL ERROR: Reached heap limit`), which is a resource fact about the runner and not about the arm;
  locally only the first 30 cases ran, and the two arms flipped nothing there. The full cell was read at the new
  default in CI (run `42039524547`): OnlineBoutique 93.3, SockShop 97.8, TrainTicket 83.3 — the published table,
  cell for cell.
- **It does not show the term is a good signal.** It shows the term is a _strong_ one, and that the ranking it
  overrides was worse on the one cell that has spans. A future direction signal (failed spans, per-edge status)
  would have to beat this prior, not merely complement it.

## 5. The corpus fact this turned up

`RE3:TrainTicket`'s `traces.csv` has a `statusCode` column and **no value in it**: 189,488 spans in
`re3tt_ts-route-service_f3_1`, every one empty. The `failedEdge` channel — the only term in the ranking that
carries a DIRECTION — is therefore data-inert on the cell that needs direction most, at weight `3`. That is a
corpus limitation, not an implementation defect, and it is the argument for the next corpus: a benchmark whose
traces record which calls failed, rather than only how many spans each service emitted.

## 6. The obvious repair, pre-screened and CLOSED

The failure left by the prior is uniform: the leader carries no post-injection ERROR line and a
dependency-connected candidate does. That suggests a discrete rule — promote the emitter over the silent
leader — and a discrete rule is not a weight, so it does not need the register's closure on weights.

It was screened over all 728 case dumps before any code was written, in three variants of "best-evidenced"
(largest anomaly, most lines, exception-class weighted):

| variant                                        | fires | gains | losses |
| ---------------------------------------------- | ----: | ----: | -----: |
| promote the connected emitter, best by anomaly |   103 |     9 | **68** |
| …best by volume                                |   109 |     2 | **68** |
| …best by exception class                       |   103 |     9 | **68** |

The losses are not noise and they are not spread: **61 of the 68 are `RE2:SockShop`**, where the leader is the
correct answer and a victim floods 15–1,143 error lines beside it, and 6 more are `RE3:OnlineBoutique`, where
`checkoutservice` floods 127–146 lines against a silent `emailservice` truth. The gains are `RE3:SockShop` (7)
and `RE3:TrainTicket` (2). A rule that must separate source from victim on this evidence has the same conflict
the register already records twice, and it loses on the population where the victim's flood is _dense_ — which
is also why the "sparse error channel" refinement (promote only when the candidate's error channel was dropped
as `duty-cycled-idle`) still loses: 4 gains against 9 losses.

**Recorded so it is not proposed a third time.** The population that a per-case discriminator needs is not
missing from the ranking; it is missing from the corpus, and §5 is what that looks like.

## 7. Read back in CI, on the commit that removed the pin

Run `42036486315` on `69df626b`, the commit that deletes the `else` pin:

| cell                    | CI reading at the new default |          published | verdict                                                                                                                                                                                             |
| ----------------------- | ----------------------------: | -----------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RE1 OnlineBoutique      |                         89.6% |              89.6% | unmoved                                                                                                                                                                                             |
| RE3 OnlineBoutique      |                         88.9% |              88.9% | unmoved                                                                                                                                                                                             |
| RE3 SockShop            |                         66.1% |              66.1% | unmoved                                                                                                                                                                                             |
| RE3 TrainTicket         |                     **74.5%** |              74.5% | **reproduced without the pin**                                                                                                                                                                      |
| RE2 (all three systems) |                      not read | 93.3 / 97.8 / 83.3 | the job died at step 6, `Restore cached RCAEval JSON`, before any case was evaluated — a runner failure rather than a gate, and the cell this document flags as unmeasured (§4) is still unmeasured |

That is the whole of the claim: the four cells that could be read are identical to the published table, and the
one that moved locally is the one the pin used to move. A number that changes when you remove the mechanism you
believe was producing it is a number you did not understand; these four do not change.
