# The direction of a miss — the instrument §11 owed

## 1. The question this document owns

`docs/topo-share.md` §11 read the 94 remaining misses of the enrolled arm and said this about the band a ranking
change can still reach:

> | false winner                                                         | cases | its position relative to the truth               |
> | -------------------------------------------------------------------- | ----: | ------------------------------------------------ |
> | `ts-admin-travel-service` (TrainTicket)                              |     6 | the ADMIN caller — observes every other service  |
> | `front-end` (SockShop)                                               |     3 | the ROOT caller — same shape                     |
> | `ts-inside-payment-service`, `recommendationservice`, `orders-db`, … |    22 | the CALLEE of the truth — the opposite direction |

That table was read off **service names and a mental model of the deployment**. Nothing in the artifact carried the
call graph, so the direction of a miss was computable at run time and thrown away, and the sentence that decided
the next axis — "both are direction errors" — was an inference rather than a count. This document owns the count.

The distinction is not academic. A topological operator can only ever reach a miss whose winner sits on a directed
path to or from the truth. If 22 of the 31 rank-2 misses are the truth's callee, an aggregation change is a
candidate axis; if most of them are _unrelated_ — no directed path either way — then no topological operator can
touch them at all, and the axis is somewhere else entirely.

## 2. The vocabulary

An edge `caller → callee` means the caller depends on the callee, so a fault at the callee propagates UP to the
caller. The relation is therefore about the truth, not about the winner:

| value       | meaning                                                                                      | reachable by a topological operator?                        |
| ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `caller`    | the winner can reach the truth, so the winner is the truth's **victim** (reversed causality) | yes — a caller must not outrank the callee that explains it |
| `callee`    | the truth can reach the winner, so the winner is the truth's **dependency**                  | yes — the same relation read the other way                  |
| `unrelated` | no directed path either way                                                                  | **no**                                                      |
| `self`      | the winner IS the truth (only possible on a correct case, which carries no loss)             | not applicable                                              |

Counted in the report as `reversed` / `depend` / `neither` / `self`, with `direct` as the one-hop part of
`reversed` — all a one-edge repair can reach.

Two rules keep the classification from inventing a direction:

1. **A cycle has no direction.** When both paths exist the pair is in a strongly connected component; the nearer
   side wins and an exact tie reads `caller`. That default is deliberate: the count exists to measure **reversed
   causality**, so the ambiguity resolves toward the hypothesis being tested rather than away from it — and the
   `direct` column makes the cost of that choice visible, because a tie that reads `caller` also reads `direct`
   when it is one hop.
2. **Absence is not a value.** A case with no prediction has no winner to place, and an artifact written before
   this column existed has no direction to read. Both are reported as `unstated` in a column of their own, on the
   rule `DeepEvidenceClass` states: a record that did not look must not read as a measurement of `unrelated`.

## 3. Where it is computed, and why there

`classifyWinnerRelation` runs in `run-rcaeval.ts` at the moment the loss record is built — the one place the case's
`ServiceCallGraph` and its `top1` are both in hand. The record then carries `winnerRelation` and `winnerHops`, and
`summarizeWinnerDirection` renders them per cell without walking a graph again: a second walk in the summariser
would be a second answer to a question the record has already answered, and the two would eventually disagree.

The distance is a breadth-first shortest path, `winner → truth` for `caller` and `truth → winner` for `callee`. It
is reported because the _reachable_ part of the band splits on it: a one-hop reversed miss is the case a
containment rule can fix directly, a five-hop one is a case about a chain.

## 4. The first reading — the nine cells at 641/735

From `41053553008` (bare dispatch, `topoClosure=max`, 641 of 735 — the enrolled configuration):

| cell               | cases | misses | reversed | direct | depend | neither | unstated |
| ------------------ | ----: | -----: | -------: | -----: | -----: | ------: | -------: |
| RE1:OnlineBoutique |   125 |     18 |        7 |      7 |      2 |       9 |        0 |
| RE1:SockShop       |   125 |      8 |        1 |      1 |      2 |       5 |        0 |
| RE1:TrainTicket    |   125 |     19 |        9 |      3 |      5 |       5 |        0 |
| RE2:OnlineBoutique |    90 |      7 |        3 |      3 |      2 |       2 |        0 |
| RE2:SockShop       |    90 |      2 |        0 |      0 |      1 |       1 |        0 |
| RE2:TrainTicket    |    90 |     15 |        4 |      4 |      0 |      11 |        0 |
| RE3:OnlineBoutique |    30 |      5 |        1 |      1 |      0 |       4 |        0 |
| RE3:SockShop       |    30 |     12 |        6 |      6 |      2 |       4 |        0 |
| RE3:TrainTicket    |    30 |      8 |        1 |      0 |      0 |       7 |        0 |
| **all nine**       |   735 |     94 |   **32** | **25** | **14** |  **48** |    **0** |

**Half the misses are not direction errors at all.** 48 of 94 have a winner with no directed path to the truth, in
either direction, on a graph that contains the truth (`truthInGraph` is true on every one of them). No weighting,
gating or aggregation of the deduction can reach those cases, because the deduction exists to compare a node with
its neighbours and these winners are not neighbours. That single column retires a class of candidate axis.

**The reachable part is one-hop.** 25 of the 32 reversed misses are a direct caller. Whatever repairs them is a rule
about a parent-child pair, not about paths.

## 5. What it corrects in §11

| §11 said                                                   | measured                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 9 observers (`ts-admin-travel-service` ×6, `front-end` ×3) | **9, but 5 + 4**: `ts-admin-travel-service` ×5, `front-end` ×4                                   |
| 22 are "the CALLEE of the truth"                           | **6 are the callee**; **12 are unrelated**; 13 are the caller                                    |
| "Both are direction errors"                                | 19 of the 31 rank-2 misses are direction errors; 12 are not                                      |
| `recommendationservice` is a callee of the truth           | it is a **caller** (2 rank-2 cases, one hop) — `productcatalogservice` → `recommendationservice` |

The rank-2 band, measured: **13 reversed / 6 depend / 12 neither**. §11's total of 31 was right; its composition
was not, and the error moved the weight of the argument from "the callee direction is the big group" (false: 6) to
"the caller direction is" (13), while the largest group — 12 — is the one no topological operator can reach.

That correction is the point of publishing the column: the sentence §11 used to open the next axis was an
inference from service names, and inferences from names are how a document outlives its correction.

## 6. What it changes about the next axis

1. **The `sum` closure cannot repair the band, and the direction mix says why** — `docs/topo-closure.md` §8: it
   converted three reversed misses and created six `depend` and six `unrelated` ones. A `depend` miss is a caller
   pushed below the callee that explained it, which is the break shape; an `unrelated` miss is a deleted truth.
2. **The 48 unrelated misses are the largest single block in the loss, and they are outside topology.** They need a
   signal that does not live on the call graph — a temporal precedence between onsets, a per-instance identity, or
   a channel the graph does not carry. Any axis that stays inside `explained(v)` is capped at 46 misses by
   construction.
3. **A one-hop rule is now expressible.** 25 of the 32 reversed misses are direct callers, so a predicate of the
   form "a node may not outrank its parent unless its own channel is anomalous" is measurable against a stated
   population for the first time — the column names the cases a later arm must move.

## 7. How to read it back

The census prints the distribution per cell at the end of every run:

```
  winner direction — of the misses, was the winner a VICTIM of the truth (reversed causality), a
  DEPENDENCY of it, or neither? `direct` is the one-hop part of `reversed`, which is all a one-edge
  repair can reach.
  cell                    cases  misses  reversed  direct  depend  neither  unstated   reversed
  RE1:TrainTicket           125      19         9       6       5        5         0     47.37 %
  ...
```

The per-case fields (`winnerRelation`, `winnerHops`) are on every loss record, so a case that moved between two
arms can be read against the relation it held rather than inferred from the service that won.

**What the column does not yet carry, and the next artifact owes:** the graph itself. `unrelated` is a fact about
the case's call graph, and a sparse graph makes it the default reading — this corpus's `RE2:TrainTicket` cell has 11
unrelated misses out of 15, which is either a fact about where its faults land or a fact about how few edges its
graph has. Telling those apart needs the edge count and the truth's degree on the record. Until then `unrelated`
is the strongest reading available and it is a reading about the graph, not about the fault.
