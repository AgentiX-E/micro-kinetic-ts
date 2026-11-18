# Pre-registration 308 — the edge that carries the explanation

**Written before any arm is dispatched.** The census that motivates it is `docs/near-miss-census.md`,
committed in the same iteration and measured on the shipped depth artifact. The threshold arithmetic below
is derived from that artifact, not from the arm.

## 1. The defect this arm is against

`docs/near-miss-census.md` §3 establishes, by measurement rather than by argument, that the topological
deduction is **undefined** on RCABench: `explainsThrough` admits a callee only when its dominant metric
label is a response channel, and RCABench's 87 metric names are all `container.*` or `k8s.*`. The scope
predicate is therefore false for every node of every case, the operator returns its input unchanged, and
four knobs (weight, gate, scope, closure) have now been refused on two corpora without any of them being
able to move a single byte.

The class the operator was built for is nevertheless the largest one in the census: **41 of 93 near
misses (44.1 %) are won by `ts-route-plan-service` (23) or `ts-travel-plan-service` (15)**, both
fan-out orchestrators, and 51 of 93 sit at a margin of ≥ 20 %.

## 2. The observable this corpus does carry — in the direction that is not being used

The root cause is a missing ADMISSION channel, not a missing signal. RCABench ships a per-edge response
reading, and the engine already reads it:

```
"traceEdgeLatency": [["ts-route-plan-service", "ts-travel-service", 2.6, 1291.9], …]
                      from                    to                 baseline  post
```

**In the direction it is used**, the engine scores a node by what its callers waited: `formatEdgeLatency`'s
`edgeLatencyScores` is the largest `post/base` over the edges `caller → v`, feeding `latWeight = 0.561495`
and `latMinRise = 10.3`. That answers "is this node's inbound path slow", which is evidence FOR the node.

**In the direction this arm needs**, the same array answers the opposite question: `v → callee` rising means
`v` was waiting on `callee`, which is evidence AGAINST `v`. The graph does not carry it — `edgeLatencyByCallee`
is inbound by construction (`inbound` is in its name, and its docblock says so) — so the arm's first half is
one new field, `edgeLatencyByCaller: Map<ServiceId, {rise, count}>`, built by the same walk that builds its
inbound twin.

**On the ten `ts-route-plan-service` near misses, nine carry at least one out-edge whose latency rose by
185× to 1 065×, and in every one of them the risen edge points at the truth** (a hand reading of the ten
cases is in the census document's probe; it is not a random sample and is not used as a rate).

That is the physical fact the deduction encodes, measured directly: the caller's response contains the
callee's, so an edge whose latency multiplies is a callee explaining its caller. The metric channel cannot
express it here; the trace channel can.

## 3. The arm — one field and one predicate, nothing else

```
edgeRise(v→c)  = post / baseline  from the case's own traceEdgeLatency, aggregated per CALLER
explainsThrough(c) ⇐ isResponseChannel(dominantLabel(c))  OR  edgeRise(v → c) ≥ θ
```

The field is `edgeLatencyByCaller` — the outbound twin of the existing `edgeLatencyByCallee`, built by the
same walk and carrying the same `{ rise, count }` shape, because a predicate that had to re-read the raw
array would be a second owner of "which rise counts".

**Everything else is held at the shipped value**: `rho = 1`, `gate = 1`, `closure = max`,
`scope = external`, `precedence = off`, `latWeight = 0.561495`, and the aggregation, weight and cap are the
ones every published number was measured under.

The knob is `--edge-explained <θ>` (default absent = the operator exactly as it ships, bit-identical by
construction — the same standard `topoDiscountGate = 0` is held to). The arm is `θ = 2` (an edge must at
least double) and `θ = 10`; both are dispatched, in one battery, against a bare control of the same commit.

**Why a predicate and not a new operator.** A new aggregation would have to be mapped into the anomaly's
own units, and `topo-deduction.ts`'s population law says exactly what that costs: a ratio applied to a
rank surface reads `rho·w·(n−1)/k` and is linear in the fleet's size. A predicate reads no units — it
decides WHETHER an existing charge may be applied, which is the one thing `gate` already shows can be
changed without changing the space.

**Why not simply raise `latWeight`.** It is already 0.561495 and it already points the other way: raising it
would make every node with slow inbound edges MORE suspicious, which is the opposite of what the census's 41
cases need. The two readings are both per-edge latency and they are not interchangeable, and that is the
distinction this arm exists to test.

## 4. Predictions, each falsifiable and each wrong in a direction that matters

**P1 — the observer class moves.** Of the 41 observer-class near misses, **at least 12 become correct**.
The mechanism is the one the probe read: nine of ten sampled cases have a risen out-edge pointing at the
truth, and a rise of 185× clears any θ in the grid.

**P2 — the total is bounded by the class.** FSE'26 Top@1 reads **between 1 180 and 1 240** (`+24` to
`+84` over 1 156). Above 1 240 would mean the arm is repairing cases the census says have no observer
winner, which no predicate on the winner can do; below 1 180 would mean it repairs fewer than half the
class it was aimed at.

**P3 — the golden population does not move.** RCAEval's loader carries no per-edge latency, so
`edgeRise` is undefined on every one of its 735 cases and the predicate is never reached: the nine cells
must be **641/735, case for case identical**. This is a construction, and the arm's own `signals:` line
must print the θ it ran with, so a battery that silently applied the predicate to the golden half is
visible in the artifact rather than inferred from a number.

**P4 — no fault type falls by more than one case.** A predicate that admits a callee can only charge a
caller; the classes at risk are the ones whose truth is itself an orchestrator (`JVMException`,
`HTTPResponseDelay` at `ts-travel-plan-service`). If any family loses two or more, the arm is REFUSED
regardless of the total — a filter that breaks as often as it repairs is not a filter, the bar
`docs/topo-closure.md` §6 already set.

**P5 — the `θ` curve is not monotone in the direction the theory predicts, and that is the recorded
expectation.** A larger θ admits fewer callees, so the aggressive arm should move fewer cases. If
`θ = 10` moves MORE than `θ = 2`, the "rise" is not the deciding quantity and the next instrument is the
edge's own baseline, not its ratio.

## 5. The rule, stated before the numbers exist

- **Accepted** if `Top@1 ≥ 1200` on all 1 422 AND the golden nine cells are byte-identical AND no family
  loses ≥ 2.
- **Refused** if any of the three fails, with no appeal to a compensating gain: the repository's standing
  rule is that no cell may go down, and a class that is repaired by a mechanism which breaks another class
  is a trade, not a fix.
- **Recorded as marginal** if `1160 < Top@1 < 1200`: the axis stays open and the census decides the next
  step, exactly as §313 handled arm T's nine-case miss.

## 6. Cost

`$0`. The arm reads an artifact field the converter already writes, calls no model, and both `θ` values
ride one battery. If the arm is accepted, the enclosure costs one more dispatch; if refused, nothing is
enrolled and the operator keeps its shipped form.

## 7. What would make this arm unnecessary

If a later reading shows that the 41 observer-class wins are not separated by any per-case observable —
that their winners' edges rise no more than the truth's own winners do — then the class is not a
topological class and the direction observable is the wrong instrument. The probe's ten cases say
otherwise, and ten is the entire evidence this pre-registration rests on.
