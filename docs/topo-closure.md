# The closure — how a caller's explanation is added up

## 1. The question this document owns

`docs/topo-share.md` enrolled the topological deduction at `rho = 1` and the boundary gate, reading 641 of 735 on
the golden nine cells with no cell and no fault type down. §11 then read the 94 remaining misses and found that
the band a ranking change can still reach — 31 cases at rank two — is dominated by ONE shape: a node that calls
everything and is called by nothing. TrainTicket's `ts-admin-travel-service` appears six times as the false
winner, SockShop's `front-end` three times.

That shape is not a threshold question, and it is not a direction question either: the deduction already looks at
exactly this relation, and it already declines to charge these nodes. What it does not do is **count them**. The
operator's `explained(v)` is a maximum over the callees, so a node with ten callees at a tenth of its traffic
each and every one of them anomalous is explained by _one tenth_ of its anomaly, however thoroughly the fan-out
accounts for it.

This document owns the aggregation, and only the aggregation: the weight, the gate and the scope have documents
of their own (`topo-discount-scope.md`, `topo-discount-gate.md`, `topo-share.md`).

## 2. The operator

    explained(v) = ⊕ over callees c with weight(v→c) > 0 of weight(v→c) × anomaly(c)
    charged(v)   = min(anomaly(v), explained(v)) >= gate × anomaly(v) ? rho × min(a, e) : 0
    anomaly′(v)  = anomaly(v) − charged(v)

`⊕` is `TopoClosure`, and it has two reachable values:

| value | reading                                                                                      |
| ----- | -------------------------------------------------------------------------------------------- |
| `max` | the caller's request takes ONE branch of its fan-out, so its worst branch is its explanation |
| `sum` | the caller's request fans OUT and waits for every branch, so its explanation is the total    |

`max` is the shipped value and every published population was measured under it.

## 3. Why both readings are physical

The maximum was written down in iteration 158 with its justification in the module: _"the caller's traffic splits
across its callees, so the fractions do not compose into a total"_. That sentence is true of a route that selects
a branch — a frontend endpoint that calls one of three services depending on the request shape — and the maximum
is exactly the right aggregation there, because only one branch is on any request's path.

It is false of a request that fans out and waits. A checkout that calls inventory, payment and shipping in
parallel does have every one of them on its path, and its own response time is then the slowest branch's — while
its error count is the sum of theirs. **The two readings are not two statistical conventions; they are two
request shapes**, and a fleet contains both. Nothing in the call graph says which shape a node is, which is why
the aggregation is a named choice that a dispatch can state and a measurement can decide, rather than a constant
someone picked.

`sum` is also the reading closest to the influx balance the deduction is a relaxation of: the anomaly arriving at
a caller from below is the _total_ it receives. The maximum is what that balance becomes when the branches are
alternative explanations of the same quantity — which is the branching case, and only that case.

## 4. What the closure does NOT change

Three properties of the operator are untouched, and each is a fence rather than an intention:

1. **The bound.** The cap lives on the EXPLAINED quantity, inside `min(a, e)`, so a sum that exceeds the whole
   reads as "entirely explained" and never as a negative anomaly. `rho` stays bounded by `rho` on every
   population, at either closure.
2. **The gate.** At `gate = 1` a partial sum is refused exactly as a partial maximum was. The closure decides HOW
   MUCH was explained; the gate decides WHETHER that counts. That is what makes the two closures measurable at
   one gate on one population rather than being two different operators.
3. **The scope.** `external` still admits only response channels on both sides. An internal reading (`cpu`) is
   not transmitted across a call boundary, so it is not summed either — a closure that read every channel would
   smuggle a second axis into the first.

The one thing that DOES change is the arithmetic on a tree: a sum over one term is that term, so `max` and `sum`
are the same operator on any node with a single callee, and they can differ only where a fan-out exists. That is
the property the unit tests pin, because it is what makes this an ablation of one decision rather than the
introduction of a second operator.

## 5. What is measured

One arm, on the golden nine cells, against the enrolled configuration:

```
topodiscount=1, topodiscountgate=1, topoclosure=sum
```

against the shipped `topoclosure=max`. Same commit, same corpus, same everything else — the closure is the only
difference, and both arms print their closure on the `signals:` line so an artifact can be attributed after the
fact. The acceptance rule is the one every axis in this record is held to: **more cases correct, no cell below
its published value, no fault type down.**

## 6. The predictions, recorded before the arm is read

Made before dispatch, in the discipline `docs/topo-share.md` §6.1 established, and scored afterwards. Each is
falsifiable and each is wrong in a direction that would matter.

**P1 — the mechanism reaches the observer class.** Of the nine rank-2 cases whose false winner is the node that
calls the truth and is called by everything (`ts-admin-travel-service` ×6, `front-end` ×3), **at least four
become correct**. The claim being tested is that the fan-out aggregate is what keeps them above their own
callees, and a share of 1 at `gate = 1` removes them from the pool.

**P2 — the gain is bounded by the fan-out count.** The total reads **between 642 and 660**. Above 660 would mean
the closure is repairing cases the census says have no fan-out (the thirteen `unrelated` rank-2 cases, which no
topological operator can reach); below 642 would mean it repairs nothing the maximum did not.

**P3 — the cost is real and small.** Between **one and six** cases break, and every break is a case whose truth
is itself a caller that a fan-out of mild callees fully explains — the mirror of the class P1 repairs. If ten or
more break, the closure is REFUSED regardless of the total, because a filter that removes a tenth of the
population it charges is not a filter.

**P4 — no cell falls.** The four cells that carry the observer cases (RE1:TrainTicket, RE2:TrainTicket,
RE1:SockShop, RE3:SockShop) gain; the cells whose graphs are trees at the nodes that matter
(RE3:OnlineBoutique, RE1:OnlineBoutique on most cases) are unchanged or up. **Any cell below its published value
refuses the arm**, on the rule the gate itself was held to.

## 7. How to re-measure

```
workflow_dispatch benchmark-rcaeval.yml
  anomaly_knobs = topodiscount=1,topodiscountgate=1,topoclosure=sum
```

The closure is printed unconditionally on both halves' `signals:` lines, and the census carries the per-case
evidence — `topo_share` beside `topo_gate` — so a case that moved can be read against the share that moved it
rather than inferred from the total.

## 8. The reading — all four predictions refuted, and the closure REFUSED

Arm `41053699258` (`anomaly_knobs=topoclosure=sum`, its own `signals:` line reading `topoDiscount=1
topoDiscountScope=external topoDiscountGate=1 topoClosure=sum`) against `41053553008`, a **bare** dispatch of the
same commit that ran `topoClosure=max` with no knobs at all and reproduced `41031397704` case for case.

| arm              | cases | fixes | breaks |   total |    rate | cells below published |
| ---------------- | ----: | ----: | -----: | ------: | ------: | --------------------: |
| `max` (shipped)  |   735 |     — |      — | 641/735 | 87.21 % |             published |
| `sum` (this arm) |   735 |    +2 |    −11 | 632/735 | 85.99 % |                 **4** |

| cell               |   `max` |   `sum` |      Δ |
| ------------------ | ------: | ------: | -----: |
| RE1:OnlineBoutique | 107/125 | 107/125 |      0 |
| RE1:SockShop       | 117/125 | 117/125 |      0 |
| RE1:TrainTicket    | 106/125 | 103/125 | **−3** |
| RE2:OnlineBoutique |   83/90 |   82/90 | **−1** |
| RE2:SockShop       |   88/90 |   85/90 | **−3** |
| RE2:TrainTicket    |   75/90 |   72/90 | **−3** |
| RE3:OnlineBoutique |   25/30 |   25/30 |      0 |
| RE3:SockShop       |   18/30 |   18/30 |      0 |
| RE3:TrainTicket    |   22/30 |   23/30 |     +1 |

**P1 — refuted, and by the case list rather than by the count.** Nine rank-2 cases have a false winner of the
observer shape; **one of the nine** became correct (`ts-travel-service_loss_5`, rank 2 → 1). The other eight kept
rank 2 exactly. P1 asked for four. The mechanism was not blocked, it was _insufficient_: the gate charges an
observer only when its aggregate explanation reaches its whole anomaly, and summing a fan-out that is mostly idle
still does not reach it — the aggregate crosses the threshold in one case out of thirteen rank-2 caller cases, not
in four of nine.

**P2 — refuted downward.** 632, below both the predicted floor of 642 and the control's 641.

**P3 — refuted upward, past its own refusal threshold.** Eleven broke where one to six were predicted, and the
document had already written the consequence: _if ten or more break, the closure is REFUSED regardless of the
total._ The mechanism it named is right in every case:

| break                                   | truth               | what `sum` did to the truth                             |
| --------------------------------------- | ------------------- | ------------------------------------------------------- |
| `ts-travel-service_delay_1/3/4/5` (RE1) | `ts-travel-service` | rank 1 → 58 / 62 / 62 / 38, anomaly 1.000 → 0.079–0.126 |
| `ts-travel-service_delay_1/2` (RE2)     | `ts-travel-service` | rank 1 → 8 / 3                                          |
| `ts-travel-service_cpu_1` (RE2)         | `ts-travel-service` | rank 1 → 44                                             |
| `orders_delay_2/3`, `orders_socket_1`   | `orders`            | rank 1 → **absent** (no truth evidence at all)          |
| `checkoutservice_loss_3`                | `checkoutservice`   | rank 1 → **absent** (no truth evidence at all)          |

Seven of the eleven are ONE service, `ts-travel-service`, and the reason is structural: it is the corpus's widest
fan-out caller, so it is the node a `sum` overcharges most. Four of the eleven did not fall in rank but vanished
from the pool — the truth's own anomaly fully explained by its callees, which at `rho = 1` deletes it rather than
demoting it. That is the exact mirror of the class P1 was meant to repair, and it arrives at nearly twice the rate
the prediction admitted.

**P4 — refuted.** Four cells below their published value, one above.

### 8.1 The direction mix, which is the instrument's first reading

The same two arms carry `winnerRelation` per case, so the movement can be read as a change of _direction_ rather
than a change of total (see `docs/winner-direction.md`):

| relation of the miss                                             | `max` | `sum` |
| ---------------------------------------------------------------- | ----: | ----: |
| `caller` — the winner is the truth's victim (reversed causality) |    32 |    29 |
| `callee` — the winner is the truth's dependency                  |    14 |    20 |
| `unrelated` — no directed path either way                        |    48 |    54 |
| misses                                                           |    94 |   103 |

The closure converted three reversed-causality misses and _created_ six callee-shaped and six unrelated ones. The
`callee` column rising is the breaks: charging a caller drops it below the callee that explained it. The
`unrelated` column rising is the deletions: a truth with no evidence row leaves a pool in which some disconnected
node is now first.

### 8.2 The verdict, and what the refusal leaves behind

**`DEFAULT_TOPO_CLOSURE` stays `max`.** Three of the four predictions fail in the direction that refuses, and the
fourth fails outright; there is no reading of the arm under which it is an improvement, and the prediction that
would have overridden the total — ten or more breaks — fired.

What the arm nevertheless establishes, and what the next axis inherits:

1. **The observer class is real and is the right diagnosis, and the aggregate is the wrong lever for it.** The nine
   cases are exactly the shape §6 described, the one that moved did so by the predicted mechanism, and the other
   eight stayed put because a fan-out is not a request path — the sum of a mostly-idle fan-out is still smaller
   than the observer's own anomaly. The lever that would move them is a _per-request_ attribution (which branch was
   on the caller's path), not a different aggregation of the same quantities.
2. **The cost is on the same containment relation as the benefit**, which is why no value of `rho` or `gate` can
   separate them (`docs/topo-share.md` §9 found the same thing for the bounded charge, from the other side).
   A knob that multiplies a charge cannot pick out which callers to charge.
3. **Half the misses are not direction errors at all.** 48 of the 94 have a winner with no directed path to the
   truth. Any further work on the deduction — its weight, its gate, its closure — can move at most the other 46.

### 8.3 The other population, on an arm that labels itself

The FSE'26 half was re-taken on the commit that repaired §198.4's label defect — `ranking_knobs=topo_closure=sum`,
run `41063737205`, whose own header reads `topoClosure=sum`:

| population     |   control (`max`) |            arm (`sum`) | verdict                                                                     |
| -------------- | ----------------: | ---------------------: | --------------------------------------------------------------------------- |
| Top@1          | 60.5 % (860/1422) |      60.5 % (860/1422) | identical                                                                   |
| Top@3 / Top@5  |   79.0 % / 82.2 % |        79.0 % / 82.2 % | identical                                                                   |
| 25 fault types |                 — | **25 of 25 identical** | identical, down to `PodFailure 0/24`, `JVMMySQLLatency 0/2`, `TimeSkew 0/2` |

Inert on 1 422 cases, as every other knob of this deduction is on that corpus (§197.3). The commit was also certified on the golden half by a bare dispatch of its own — `41061840781`, line reading `topoClosure=max`, **641 of 735 with zero per-case flips** against `41053553008` — so extracting the record out of `main()` stated a field without reading one. The arm also corroborates
the mislabelled one: `41053711414`, whose header said `max`, reproduces this run's 25 fault-type rows case for case,
so the engine there really did aggregate by `sum` — which is the split the extraction was made to make impossible,
and the reason the earlier artifact was re-taken rather than read.
