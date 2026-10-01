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

## The fan-in/volume hypothesis is refuted

The two regressions were the obvious place to look for a mechanism, and the
totals suggested one: the cache carries 1,013,406 net failures over 4,805
records, ~211 per edge, so a raw `sum` is largely a measure of how much traffic a
service receives. If that were the failure mode, a high-traffic SYMPTOM whose
callers time out would out-accumulate the source — and dividing by the number of
distinct callers that saw failures (`mean`) would fix it.

It does not. Matched pair on one commit and one cache, weight 1, only the
aggregation changed:

| run | mode | Top@1 | Top@3 | Top@5 | correct |
|---|---|---|---|---|---|
| `34766439438` | `sum` | 53.1% | 71.0% | 75.9% | 755 |
| `34766441691` | `mean` | 51.6% | 69.9% | 75.9% | 734 |

`mean` costs 21 cases, and it does not repair either regressed type:
`JVMMemoryStress` (1/171) and `HTTPResponsePatchBody` (1/4) are byte-identical
under both aggregations. So a raw sum is not being dominated by traffic, and
removing the amplification only loses cases — `ReplaceCode` 220→215,
`ReplaceMethod` 130→125, `ReplacePath` 38→36. `mean` is retained, tested and off
by default, as the recorded answer rather than a live option.

One correction to the previous section, stated plainly: the both-endpoints
invariant fixed in the same commit is right, but it is **empirically inert on this
cache** — the coverage line is identical before and after (4,805 records, 4,805
in-graph), so no edge in the data actually had an out-of-graph endpoint. It is a
latent defect, not one that cost anything here.

## Next: where the two regressions come from

The dumps answer it, and the answer is not the mechanism the criterion assumed.
All five regressions were extracted from a matched pair of diagnostic runs (same
commit, same cache, `diagnose=JVMMemoryStress,HTTPResponsePatchBody`) and every one
has the same shape:

| case | fault | source | winner | winner records | winner failedEdge | source selfAnomaly |
|---|---|---|---|---|---|---|
| `brbql8` | JVMMemoryStress | `ts-inside-payment-service` | `ts-ui-dashboard` | **1** | **1.000** | 1.000 |
| `ds6qwb` | JVMMemoryStress | `ts-assurance-service` | `ts-ui-dashboard` | **1** | **1.000** | 1.000 |
| `pf77h8` | JVMMemoryStress | `ts-cancel-service` | `ts-ui-dashboard` | **1** | **1.000** | 1.000 |
| `qjhx5h` | PatchBody | `ts-food-service` | `ts-consign-service` | **1** | **1.000** | 0.420 |
| `vcqmmx` | PatchBody | `ts-route-plan-service` | `ts-travel-plan-service` | **1** | **1.000** | 1.000 |

The winner in every case has exactly ONE contributing record, and
max-normalisation turns that single record into the FULL weight. So one failed
call — a timeout, a retry — purchases the signal: in the three JVMMemoryStress
cases the source has no failed-edge evidence at all while `ts-ui-dashboard` scores
1.000, and `1.0 + log1p(0.48) = 1.392` beats the source's `log1p(1.0) = 0.693`.

This refutes the remaining part of the fan-in story as well. `mean` was already
measured to be worse, and it could not have helped here anyway: the problem is not
that many callers accumulated, it is that ONE record was enough. The signal's
defect is a missing evidence FLOOR, not a missing normalisation.

`failedEdgeMinRecords` (default 1 = the shipped behaviour, so nothing moves until
it is set) requires a callee to have at least that many contributing edges before
it is credited at all, and drops it from the normalisation denominator too. The
value is stated as a principle rather than tuned: one event is not a pattern — the
same reason `computeTraceActivityScores` guards on span counts — and two is the
smallest value that expresses it. A matched pair at 1 vs 2 on one commit measures
whether it recovers all five without spending the +82.

## The evidence floor recovers the losses AND spends the gain — the axis is retired

Matched pair on one commit and one cache, weight 1, only the floor changed:

| run | floor | Top@1 | Top@3 | Top@5 | correct |
|---|---|---|---|---|---|
| `34811523306` | 1 (shipped) | 53.1% | 71.0% | 75.9% | 755 |
| `34811525788` | 2 | 47.7% | 63.7% | 67.4% | 679 |

The floor does exactly what it was built to do — `HTTPResponsePatchBody` 1→4 and
`JVMMemoryStress` 1→4, both fully recovered — and then takes the gain with it:
`HTTPResponseReplaceCode` **220→158, −62 of the +61 it produced**. Measured against
the shipped baseline (673 cases), floor 2 is 678: **+15 across six fault types and
−10 across six others**, with six types regressed for a net of five cases.

So the gain and the regressions are the same population. The signal's
discriminating power on FSE'26 lives in single-record evidence — the cases it wins
and the cases it loses are drawn from one source, and filtering for "repeated"
evidence filters out both. It is not separable by evidence volume, by aggregation
(`mean` measured worse), or by direction (that is the signal's whole premise).

**Verdict: the axis is retired.** `failedEdgeWeight` stays 0 and the shipped FSE'26
Top@1 stays 47.33%. The switch remains in the code, tested and off by default,
carrying this measurement so the question is not re-run.

What would reopen it: evidence that distinguishes a source from a victim on a
*different* signal, not a threshold on this one. The dump now records the signal's
own per-service score, so a future candidate can be attributed case by case instead
of inferred from totals — which is how this question was settled and the previous
two framings were disproved.

## The earlier framing, corrected

An intermediate reading of these regressions attributed them to a high-fan-in
symptom out-accumulating the source. That was a plausible guess from the totals
(1,013,406 net failures over 4,805 records) and it was wrong: the dumps show a
single record, and `mean` measured worse. The dumps are what settled it, which is
why the diagnostic had to carry the signal's own score before the question could
be answered at all.

## The scale axis, solved rather than swept: no weight exists

The verdict above closed this signal along volume (`minRecords`), aggregation
(`mean`) and direction (its own premise). One axis was left unmeasured — the
WEIGHT — and a sweep looked like the way to test it. It is not necessary: every
candidate's score is affine in the weight, so the dump already contains the answer.

For a case, `score(v) = base(v) + w × slope(v)` where `base` is
`log1p(selfAnomaly) + logWeight × logScore` and `slope` is the failed-edge score.
The target is at rank 1 exactly on an interval, obtained by intersecting one
half-line per competitor, and a single weight exists iff the per-case intervals
intersect. `computeWeightSeparation` does that exactly; `--weight-sweep` (with
`--log-weight <w>`)
runs it over a dump. A **control** dump is sufficient, because the slope does not
depend on the weight being on.

Solved over the 67 cases this signal moves (62 fixed, 5 broken) in the 522-block
stock dump:

| population | its requirement on the weight |
| --- | --- |
| the 62 fixed cases | need `w ≥ 0.010 … 0.580` (**largest 0.580**) |
| the 5 broken cases | tolerate `w ≤ 0.261 … 0.949` (**smallest 0.261**) |

A single weight would need `w ≥ 0.580` and `w ≤ 0.261` at once. **The intervals
overlap; no weight exists.** So the sweep cannot pass the kill criterion, and the
axis is closed on its fourth and last dimension without spending a run.

This is a falsifier, not a solver: it proves a sweep is futile and cannot prove one
is sufficient, because it only reads the cases it is given and says nothing about
cases that are wrong for other reasons. That asymmetry is why it is worth having —
it will answer the next weight question the same way, for free.

### Two defects the solver's own tests found

Both are the absence-versus-zero family, which this codebase keeps producing:

- a case whose target the dump does not describe initially contributed **no
  constraint**, so the aggregate would report "separable" on the strength of a case
  it never read. An unreadable target now yields an EMPTY interval, i.e. an
  unsatisfiable case.
- the report rendered `-Infinity` (an unsatisfiable case) as `unbounded`, i.e. as
  the most permissive possible answer. The three meanings — a finite cap, no cap,
  and no weight at all — are now three distinct strings.
