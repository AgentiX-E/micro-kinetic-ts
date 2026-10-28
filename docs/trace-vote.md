# The trace vote — a binary term scored on its decisions, and the mask that withholds it from the leader

**Status:** the term SHIPS ON for RE3 and OFF everywhere else, unchanged; `traceSkipsLeader` ships **`false`**, so
this document's mechanism is opt-in until the nine cells price it. What lands here is the instrument that makes
the pricing decidable, and one arm that already refutes the reading a reader would reach for first.

**Owner of:** `traceSkipsLeader`, the `[trace-vote]` census line, and `CasePrediction.traceVote`.

---

## 1. The term, and why it is the odd one

`finalScore(v) += traceWeight × traceActivity(v)`, where `traceActivity(v)` is `1` for the **unique** service
whose span count rose after injection while its peers held or fell (`minPreCount` 500, `riseThreshold` 1.15,
`minPostCount` 1), and `0` for everyone else. It is the only term in the formula whose value is a **decision**
rather than a magnitude.

It exists because of one case: TrainTicket RE3's `ts-auth-service` wrong-value fault throws no exception — no log
signal — emits no error span, and moves its metrics only mildly, so every prior this engine has ranks it below its
own victims. Its one deterministic signature is that it does **more work per request** and therefore emits more
spans while route/latency symptoms collapse.

That is a good reason for a vote. It is not a reason for the vote to be *always* right, and no artifact in this
repository had ever asked whether it was.

## 2. The two measurements that disagree, and why both are true

Iteration 148's term-gap census (`docs/term-gap.md`) subtracts the winner's ranking terms from the truth's, per
cell, and on the blocking cell it reads:

```
[term-gap] failing=11 compared=11 | costs: trace=+5.000(5) selfAnomalyLog1p=+2.303(11) | helps: dualFamily=-1.750(7)
```

`trace` is the single largest cost: **a full unit on 5 of TrainTicket RE3's 11 misses.** The obvious reading is
that the term should be weakened or removed, and the same commit was dispatched with `trace_weight=0`:

| arm | RE1 (375) | RE3 (90) | RE3-TrainTicket |
| --- | ---: | ---: | ---: |
| `trace_weight = 0` | 327 | **51** | 8 of 30 |
| `trace_weight = 1` (shipped pin) | 327 | **61** | 19 of 30 |
| `trace_weight = 2` | 327 | 61 | 19 of 30 |

**Ten cases on the block is what the pin buys**, and doubling the weight changes nothing — the term is binary and
already dominant at 1. So the term wins more than it loses and is still the term that loses the cases a reader
stares at: **a cost is not a cause.** The weight axis is a plateau on both sides.

## 3. The instrument: the vote, scored

The failure diagnostics print the service with the highest post/pre ratio, which is **not** the service the rule
chose — `pre >= 500` disqualifies the highest-ratio service in most TrainTicket cases. `CasePrediction.traceVote`
records the decision itself, read from the graph's own `traceActivityScores`, and `trace-vote-census.ts` counts it:

| cell | votes | hits | share | abstained | wrong | decisive |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RE3 OnlineBoutique | 1 / 30 | 0 | 0.0% | 29 | 1 | 1 |
| RE3 SockShop | 0 / 30 | — | — | 30 | 0 | 0 |
| **RE3 TrainTicket** | **20 / 30** | **15** | **75.0%** | 10 | **5** | **5** |
| RE1 / RE2, all three systems | 0 | — | — | 375 / 270 | 0 | 0 |

Three findings, and the third is the one that matters:

1. On RE1 and RE2 the term **abstains on every case** — `traceWeight` is 0 there, so the census reports
   `abstained=645` and the pin's asymmetry is a measurement rather than something a reader infers from a
   configuration line.
2. On SockShop the rule never finds a unique riser; on OnlineBoutique it fires once and is wrong.
3. On TrainTicket the rule votes in 20 of 30 cases and is right in 15 — and **all five wrong votes became the
   top-1**. That is exactly the five cases the term-gap census charges `+1.000` for. **Two instruments, built for
   different questions, name the same five cases.** That agreement is the reason to trust either of them.

## 4. The mask: withhold the vote from the anomaly leader

The term's own reason to exist says what the refinement has to be. It was written for a source whose metrics moved
mildly; a candidate that is **already the cell's largest anomaly** needs no corroboration, and a vote landing on
it is more often traffic re-routed toward a loud victim than a silent source. So:

```
trace(v) = weight × 1[v is the unique riser]
masked  when traceSkipsLeader ∧ v is the unique riser ∧ selfAnomaly(v) = max_w selfAnomaly(w)
```

Three properties, each a test in `pruner.test.ts`:

- the mask is a **MASK**, not a weight: the term's value is zeroed and the breakdown reports `MASKED` with
  `mask: 'traceSkipsLeader'`, the shape the `rise` term's logic-exception gate established;
- it **keeps** the vote for a candidate that is not the leader — the silent source is the entire point, and a
  refinement that suppressed it would be the removal arm again;
- it is **inert at `traceWeight = 0`**, which is the shipped weight on six of the nine cells, so the flag cannot
  move a cell that does not vote.

`traceSkipsLeader` ships **`false`**. The prediction worth writing down before the sweep: on the five wrong votes
the voted service is the loud one (its own anomaly is 1.1–2.7), so the mask removes its unit and the truth —
sitting at ranks 2, 4, 7 and 13 — gains the gap it needs; on the fifteen right votes the truth is either silent
(and keeps its vote) or already loud (and loses a unit it did not need). The risk is the second half of that
sentence, and the nine cells are the only way to price it.

## 5. What this does not license

- The mask does not improve the RULE. It is a precondition on **who may be paid**, not a better detector of
  silent sources; if the sweep fails, the next question is the rule's own thresholds (`minPreCount 500` is an
  absolute count, and TrainTicket's fleets differ by an order of magnitude in traffic).
- Nothing here says the term should be swept on weight. 1 and 2 are identical, and 0 costs ten cases; the axis is
  closed in both directions.
- The census reports the rule's **decision**, not whether the term was paid: a masked vote is still a vote, so a
  cell run with the mask on will report the same `votes`/`hits` and a different score. That is deliberate — the
  instrument must not change when the mechanism does.
