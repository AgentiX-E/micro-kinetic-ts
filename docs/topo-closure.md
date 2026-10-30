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
