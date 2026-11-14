# The zero-baseline transport guard — it fires, and it uncovers a second artifact

**Status:** IMPLEMENTED, tested, measured on all nine cells, **and kept OFF**. The measurement is not a
no-op in the way a dead branch is: the guard changes the per-case decisions (8 of 100 diagnostic blocks
differ) and the aggregate is **bit-identical**, because removing one artifact promotes the next one. That
is the finding, and it names the next lever precisely.

| what | where |
| --- | --- |
| the guard | `suppressZeroBaselineLatency` (`packages/tree/src/causal/topology-fault-graph.ts`) |
| the weight | `DEFAULT_SUPPRESS_ZERO_BASELINE_LATENCY = false` |
| the dispatch | RCAEval `anomaly_knobs=zerolat=1\|0`, FSE'26 `ranking_knobs=zero_baseline_latency=1\|0` |
| the outcome | a new `MetricDiagnosticOutcome` member, `zero-baseline-transport` |
| the runs | control `40285763547` (push, default path), candidate `40285881991` |

## 1. The defect, read off the acceptance artifact

Every RE3-TrainTicket miss in run `40255890256` has the same shape. From
`re3tt_ts-route-service_f1_2`:

```
top1 metric=latency-90 head=[0,0,0,0,0,0] tail=[0.0235,0.0235,0.0235,0.0235]
top1 breakdown=dev=2.884 trend=0.166 cv=0.075 burst=0.000 rise=764.147 drop=1.000 base=0.002
GT   breakdown=dev=0.341 …  (the truth's own evidence is a `socket` DROP, 17 -> 9)
```

A 90th-percentile response time that reads **exactly 0** means the service answered nothing in that
window. The engine divides by a baseline of `0.002` and reports a **764× rise**, which is the arrival of
traffic rather than slowness.

## 2. Why the two existing guards do not own it

| guard | its population | why it misses this channel |
| --- | --- | --- |
| `duty-cycled-idle` | a metric at ~0 for **more than 40%** of its history | the corpus channel is ~30% zero. The first fixture written for this test was 50% zero and was taken by THAT guard — which is why the fixture now mirrors the corpus, and why the test asserts *which* guard decided |
| `suppressNearZeroBaselineRise` | every family, baseline MEAN ≤ `0.001` | the failing winners sit at `base = 0.002` — just above the epsilon. It was also measured a no-op for this reason |

The new question is neither "is the baseline small" nor "is most of the series idle": it is **"did the
transport channel have a LEVEL at the start"**. It is asked of the transport family only, because a
resource channel at zero is the idle/crash question the existing guards own — and it is the signature of
genuine TrainTicket faults (`socket` 17 → 9 **is** the truth there).

The head is a **median of a tenth of the series** (floor three samples), never one sample — the lesson
`docs/transient-guard-window.md` records, and the reason a channel that opens on a single zero keeps its
level.

## 3. The measurement

| population | control | `zerolat=1` | Δ |
| --- | ---: | ---: | ---: |
| RE1 (375) | 323 (105/117/101) | 323 (105/117/101) | 0 |
| RE2 (270) | 231 (77/85/69) | 231 (77/85/69) | 0 |
| RE3 (90) | 52 (22/15/15) | 52 (22/15/15) | 0 |
| **735** | **606** | **606** | **0** |

The candidate's own `signals:` line reads `suppressZeroBaselineLatency=true`, so the field reached the
engine — this is not the `topo_discount` defect of a knob that never arrives.

**The other half, and why it is a structural zero rather than an unmeasured one**: run `40285886030`
carries `zero_baseline_latency=1` and reads **Top@1 56.4% / Top@3 69.7% / Top@5 72.1%** — identical to the
shipped default. FSE'26's corpus is `Resource,Pod,JVM`: it carries **no transport family at all**, so the
guard's population does not exist there. That is the kill criterion's second half answered as
"inapplicable, with the reason", not left as "unmeasured".

## 4. What the per-case diff says, and it is the reason this document exists

Eight of the 100 rendered diagnostic blocks differ. In `re3tt_ts-route-service_f1_3`:

| | control | `zerolat=1` |
| --- | --- | --- |
| winner | `ts-user-service` | `ts-contacts-service` |
| its decisive channel | `latency-90` **0 → 0.023** (`dev=2.670`, `rise=466`) | `latency-90` **2.35 → 0.021** (`dev=0.301`, `drop=1.000`) |
| its `trend` bonus | 0.239 | **0.661** |

**The guard did exactly what it was built to do** — a channel with no level stopped being evidence — and
the ranking did not improve, because the artifact it removed was not the only one. What it uncovered is a
*second, independent* defect:

```
trendBonus = trendStrength × 0.15          on ANY monotone move, rise OR collapse
```

A victim whose latency **collapses** from 2.35 s to 0.021 s — because it stopped serving — has an enormous
relative drift, and the trend bonus pays it **0.661 against a deviation of 0.301**. The bonus is more than
twice the evidence it is supposed to augment, and it is direction-agnostic *by design*: the docblock says a
monotone drop earns the same bonus as a rise.

That is the same drop/rise asymmetry `docs/re3-fault-ceiling.md` records for `deviation` — a drop is
bounded at `log10(2)`, a rise is unbounded — met again one term over, in the term that multiplies the
drift by a coefficient instead of compressing it.

## 5. Disposition

| item | state |
| --- | --- |
| the guard, its four tests, its outcome member, its two dispatch keys | **SHIPPED OFF** — the nine cells are bit-identical, on the DEFAULT path and on the flag path |
| the enrolment | **PENDING** — it cannot be enrolled on a zero, and the reason is now a measurement rather than an opinion |
| the next lever | **the direction gate on `trendBonus`**, which the codebase has a precedent for: the `rise` term already pays a collapse only when the service emitted no logic exception (`gatedRiseContribution`). The prediction the diff licenses: `f1_3`-shaped cases — a victim collapsing to near-zero — lose their trend bonus and hand the cell to whoever holds the real evidence |

**A guard that fires and moves nothing is worth more than one that fires and moves everything**: the
second is indistinguishable from a lucky reweighting, while the first localised the next defect to one term
with a per-case table behind it.
