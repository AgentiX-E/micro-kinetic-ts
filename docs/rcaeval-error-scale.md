# The error channel is a count, the cell is decided by traffic — and the engine already knows

**The finding, in one sentence.** RCAEval reports `error` as an error COUNT per sample and `workload` as that same
sample's request count; on `RE3:SockShop` the truth and a victim differ by **0.6%** in error count while differing by
**11.6×** in traffic, so the count comparison cannot separate them — and normalising the input, which is the obvious
repair, moves **nothing**, because the engine's channel statistic is already scale-invariant. The defect is real, the
repair is in the wrong place, and this document is the measurement that says so.

## 1. The near-tie, in the corpus's own numbers

Nine of `RE3:SockShop`'s eleven misses have truth `orders` and winner `front-end`. Two of the eleven, measured on the
window the engine uses (pre-injection against post-injection):

| case          | service              | `error` count rise | `error / workload` rise | relative count rise | `workload` (req/s) |
| ------------- | -------------------- | -----------------: | ----------------------: | ------------------: | -----------------: |
| `orders_f1_1` | **`orders`** (truth) |              1.775 |              **0.8427** |                9.00 |               2.12 |
| `orders_f1_1` | `front-end` (winner) |          **1.786** |                  0.0722 |                9.06 |              24.55 |
| `orders_f3_1` | **`orders`** (truth) |              1.649 |              **0.7945** |                5.60 |               2.12 |
| `orders_f3_1` | `front-end` (winner) |          **1.683** |                  0.0683 |                5.70 |              24.55 |

Three readings follow from that table, and only the third survives contact with the engine:

1. **The count comparison is a coin-flip decided by traffic.** `1.786` against `1.775` is six parts in a thousand.
2. **The per-request rate separates them by an order of magnitude** (`0.843` against `0.072`), and ranking the 30
   cases by it alone reaches **26/30** against **18/30** for the count. The same substitution is identity on
   `RE1:SockShop` (44/122 either way), `RE3:OnlineBoutique` (6/24) and `RE3:TrainTicket` (0/30), and worth one case on
   `RE1:TrainTicket` (6 against 5). The pick is not degenerate: over the 30 cases it names `carts` 10, `orders` 12,
   `front-end` 7, `shipping` 1 against a truth distribution of 12 / 9 / 9.
3. **The engine does not read that quantity, and this is the measurement that says so.**

## 2. The repair that was built, measured, and refused

`toPerRequestError` divided the `error` channel by the same sample's `workload` at the corpus boundary — only when the
two series carried the **same instants**, because an element-wise division across two series that merely happen to be
the same length would pair an error from one instant with a request count from another, and a misaligned denominator
is not a denominator. An idle sample was treated as one request rather than as an infinite rate. Six unit tests
covered the transform and its three refusals.

The whole grid, on the complete 735-case corpus, before and after:

| cell               |  before |   after |     Δ |
| ------------------ | ------: | ------: | ----: |
| RE1:OnlineBoutique |     113 |     113 |     0 |
| RE1:SockShop       |     119 |     119 |     0 |
| RE1:TrainTicket    |     112 |     112 |     0 |
| RE2:OnlineBoutique |      84 |      84 |     0 |
| RE2:SockShop       |      89 |      89 |     0 |
| RE2:TrainTicket    |      76 |      76 |     0 |
| RE3:OnlineBoutique |      26 |      26 |     0 |
| RE3:SockShop       |      19 |      19 |     0 |
| RE3:TrainTicket    |      22 |      22 |     0 |
| **total**          | **660** | **660** | **0** |

**733 of 735 cases kept the identical top-1**, and the two that moved are a win and a loss:

| case                | truth    | before      | after        |
| ------------------- | -------- | ----------- | ------------ |
| `re3ss_orders_f3_3` | `orders` | `orders-db` | **`orders`** |
| `re3ss_carts_f3_4`  | `carts`  | `carts`     | `front-end`  |

Net zero, one new loss on the cell that was already weakest, and a corpus-wide demonstration that the transform is
invisible to the ranking. **Refused and reverted in the same iteration**, on the rule this project already runs by: a
change that moves a cell down without a measured gain is not shipped because its reasoning is sound.

## 3. What the null result proves, and what it redirects to

A per-service scale factor on a channel that leaves **733 of 735** answers untouched is not a coincidence: the
pipeline's channel statistic is invariant to it. The engine's own arithmetic says the same thing — the anomaly is read
as a **relative** rise (a channel that grows ×9 is anomalous whatever its absolute size), while the discriminator in
§1 is an **absolute** difference in per-request rate (`0.843` against `0.072`). Those are different questions, and the
engine answers the first.

So the traffic defect is not an input-mapping defect. It is a **statistic** defect: what has to change is the quantity
the ranking compares ACROSS services, not the units the corpus supplies. The engine already carries four statistics
for exactly this class of question — `endpoint`, `level-window`, `trimmed-ends` and `hump` — and its shipped policy
(`hump`) resolves per case on whether the case observed a call boundary, which on RE3 it does. §4 is that sweep.

## 4. The statistic sweep, on the same 30 cases

`--transient-guard-test` is the shipped knob that chooses the statistic, and it was swept before anything was written:

| arm              |    RE3:SockShop | Δ against shipped | note                                                                                             |
| ---------------- | --------------: | ----------------: | ------------------------------------------------------------------------------------------------ |
| `hump` (shipped) | **19/30 63.3%** |                 — | the policy in production                                                                         |
| `trimmed-ends`   |     19/30 63.3% |             **0** | identical to the case                                                                            |
| `endpoint`       |     18/30 60.0% |                −1 |                                                                                                  |
| `level-window`   |     10/30 33.3% |            **−9** | the level statistic, which is the one that WOULD read an absolute quantity, is catastrophic here |

So the statistic is not the missing lever either, and the `level-window` arm is the decisive negative: the reading that
carries the §1 signal, applied to the whole channel rather than to the error channel alone, costs nine cases. The
discriminator in §1 is a property of ONE channel's absolute rate; the guard statistic is a property of the node's
whole evidence. Widening the second to capture the first is not available.

## 5. Where this leaves the corpus question

The probe in §1 is a measurement of the corpus, not of the engine, and it is worth keeping for that reason: **a
reading that separates the truth from its victim by 11.7× while the engine's reading separates them by 0.6% is a
statement about what information is available**, and any future statistic can be scored against it without running the
engine at all. It is also the cheapest known upper bound on this cell: `26/30 = 86.7%` is reachable from metrics
alone, with no logs, no traces and no topology — which means the remaining eleven misses are not an information
problem.
