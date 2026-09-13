# The failed-edge-direction signal: +5.8pp, rejected on two narrow regressions

Measured on a matched pair — same commit (`684ef8a`), same cache
(`rcabench-full-v3`), same config except the switch:

| run | config | Top@1 | Top@3 | Top@5 |
|---|---|---|---|---|
| `34762122434` | control (`failedEdgeWeight=0`) | 47.3% | 60.7% | 65.8% |
| `34762124299` | ablation (`failedEdgeWeight=1`) | **53.1%** | **71.0%** | **75.9%** |

`673 -> 755` correct cases, **+82 (+5.8pp)**, with the top-3 and top-5 metrics
moving by roughly the same amount.

## The evidence class is real, and now counted

The run prints what the ranking actually received, next to the result:

```
Data:   failed edges in 1222/1422 cases (4805 records, 4805 in-graph, net 1013406 failures)
```

An earlier ablation of this same switch had measured **0.00pp with zero movement
across all 25 fault types**, which was not a verdict — the FSE'26 runner builds
its fault graph inline instead of through `BenchmarkRunner`, and that second copy
of the option object was passing only `injectTimeMs` and `logs`. The signal had
received nothing. `traceActivity` was missing from the same call site, so the
silent-source signal had been dead on this benchmark for longer.

That is why the counter ships with the signal rather than after it: a signal with
no input reports the same headline as a signal with no effect, and only an input
count next to the number tells them apart.

## Per-fault-type movement: 11 up, 2 down

| fault type | control | ablation | Δ |
|---|---|---|---|
| HTTPResponseReplaceCode | 159/231 | **220/231** | **+61** |
| HTTPRequestReplaceMethod | 123/190 | 130/190 | +7 |
| JVMMemoryStress | 4/171 | **1/171** | **−3** |
| JVMException | 30/43 | 34/43 | +4 |
| NetworkCorrupt | 14/46 | 18/46 | +4 |
| HTTPRequestDelay | 39/88 | 42/88 | +3 |
| HTTPResponseDelay | 42/89 | 45/89 | +3 |
| HTTPResponsePatchBody | 3/4 | **1/4** | **−2** |
| HTTPResponseReplaceBody | 45/51 | 46/51 | +1 |
| HTTPRequestAbort | 47/60 | 48/60 | +1 |
| NetworkPartition | 39/97 | 40/97 | +1 |
| NetworkBandwidth | 12/42 | 13/42 | +1 |
| JVMLatency | 2/7 | 3/7 | +1 |

The gain is concentrated where the theory predicted: the HTTP families whose
misses were **log-decided** (the winner emits, the source does not) are exactly
where inverting the credit — from the emitter to the callee of the failed calls —
buys the most. `ReplaceCode` alone accounts for 61 of the 82.

## Verdict: rejected as a default flip

The pre-registered kill criterion for any new signal is `RCAEval golden 9-cell
byte-identical` **AND** `FSE'26 zero regressed fault types`. The second half
fails: `HTTPResponsePatchBody` (−2) and `JVMMemoryStress` (−3). So the default
stays **0** and the signal is recorded as an off-by-default probe, the same rule
that rejected `metricFleetBaseline` (+0.49pp / 6 types), the connection-pool
family drop (+0.14pp / 5) and the narrow label drop (+0.28pp / 2).

Applying that rule to a +5.8pp gain is not the same trade as applying it to
+0.28pp, and that difference should be stated rather than smoothed over — but the
rule exists precisely so that a headline cannot buy silence about damage, and
moving it because the number is large is how it stops being a rule. What the
result changes is the PRIORITY of the next question: the two regressions are now
the binding constraint on a large gain, so they are worth diagnosing rather than
the axis being retired.

## The two halves of the criterion are not equally informative

The golden 9-cell is byte-identical in all nine cells:

| | OnlineBoutique | SockShop | TrainTicket |
|---|---|---|---|
| RE1 | 80.0 | 92.8 | 68.0 |
| RE2 | 82.4 | 88.9 | 68.1 |
| RE3 | 80.0 | 45.0 | 51.1 |

That check is satisfied **structurally, not empirically**: only the FSE'26 loader
emits `failedTraceEdges`, so on RCAEval the signal's input is absent and the term
is zero for every service at ANY weight. The blast radius of this switch is
exactly one dataset, which means the RCAEval golden cannot falsify it and the
FSE'26 regression count is the whole criterion.

## Next: where the two regressions come from

The signal's known failure mode is a **victim with many callers**: if a fault
makes several services' calls fail against one *symptom*, that symptom collects
the largest net failure count and takes the vote. `JVMMemoryStress` (a
silent-source fault where the source emits nothing and its callers time out) and
`HTTPResponsePatchBody` (4 cases total) are both shapes where that is plausible.
The discriminator is already in the cache and needs no new field: for the 5 lost
cases, whether the charged callee is the symptom rather than the source, and
whether a gate on the callee's OWN anomaly would exclude it without touching the
61 `ReplaceCode` gains.
