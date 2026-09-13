# FSE'26 metric competition — verdict: the fault signature is scored and out-competed

Run `34684319273` on `16ceae9`, categories `Resource,Pod,JVM` (369 cases),
shipped config (`logSignalMode=logicHttp`, `logWeight=1`, `rankNormalization=true`),
`--diagnose` on all nine fault types in those categories.

## Why this block, and not the 41 regressions

The previous turn's P0 was the 41 net cases `logicHttp` loses. Before spending a
run on it, the existing 818-case dump was re-reduced with a question it could
already answer: **where does the ground truth rank on `selfAnomaly` ALONE?**

| fault type      | n   | `selfAnomaly`-only top-5 | final top-5 | Top@1     |
| --------------- | --- | ------------------------ | ----------- | --------- |
| JVMMemoryStress | 171 | 44 (26%)                 | 39 (23%)    | **2.3%**  |
| ContainerKill   | 89  | 21 (24%)                 | 16 (18%)    | **1.1%**  |
| PodFailure      | 24  | —                        | —           | **0.0%**  |
| PodKill         | 10  | —                        | —           | 10.0%     |

Together with four singletons (`JVMCPUStress` 2, `JVMMySQLLatency` 2, `TimeSkew`
2, `DNSRandom` 1) that is **≈301 cases — 21% of the benchmark — at ≈2% Top@1**,
288 misses. Recovering every one of the 41 regressed cases is worth +2.9pp;
reaching 50% on this block is worth +10.1pp. And the log signal is irrelevant
here: `selfAnomaly`-only top-5 is 26%→23% and 24%→18%, so no change to the
log-signal mode can move this block.

So this turn measures the block instead of the regression set.

## The instrument

A service's anomaly score is the **maximum over its metrics**
(`computeAnomalyFeatures`). A scalar maximum cannot distinguish

- the fault signature was scored and lost the competition, from
- the fault signature was discarded before it was ever scored,

and those call for different work. The fault graph now records
`metricDiagnostics`: one entry per metric per service, in input order, carrying
the score for a metric that survived and the **name of the guard** for one that
did not (`too-few-samples`, `non-positive-mean`, `duty-cycled-idle`,
`transient-return`, `near-zero-baseline-rise`, `sub-epsilon-deviation`).
`transientSkipped` is now derived from that same list rather than accumulated
beside it.

The DIAG block renders it as two lines, for the services a reader compares
(ground truth and predictions; a case has ~51 services × ~70 metrics):

```
  ts-order-service [GT,#2] selfAnomaly=0.320 ... dominant=jvm.system.cpu.utilization ...
    metricKept(3): jvm.system.cpu.utilization=0.318 container.memory.rss=0.212 container.memory.usage=0.198
    metricDrop(3): jvm.memory.used:transient-return processedLogs:duty-cycled-idle queueSize:duty-cycled-idle
```

`--family <regex>` reduces a dump to the two verdicts per fault type.

## Harness validation

- Every one of the nine types reproduces the published 1422-case numbers
  exactly (`JVMMemoryStress 4/171`, `ContainerKill 1/89`, `JVMException 30/43`,
  `PodFailure 0/24`, `JVMReturn 12/21`, `PodKill 1/10`, `JVMLatency 2/7`,
  `JVMCPUStress 0/2`, `JVMMySQLLatency 0/2`).
- 2094 services rendered a metric competition; the declared entry count matched
  the entries printed in **every** one.
- The pre-existing `dominant=` field equals the highest-scoring kept metric in
  **2094/2094** services. The score the diagnostic reports is the number the
  ranking consumed, not a re-derivation.
- The shape readback is run `34694846718`, after the declaration defect below was
  fixed: **2094** services carry an attributable decomposition (5 before the
  fix), and the same nine types reproduce again.

## The verdict

```
  fault type        cases  has-fam  kept  dropped  absent  dominant  kept-lost
  JVMMemoryStress     171      171   171        0       0        24        147
  ContainerKill        89       89    89        0       0         3         86
  PodFailure           24       24    24        0       0         4         20
  JVMReturn            21       21    21        0       0         0         21
  JVMException         43       43    43        0       0         0         43
  PodKill              10       10     8        2       0         0          8
  JVMLatency            7        7     7        0       0         0          7
  JVMCPUStress          2        2     2        0       0         0          2
  JVMMySQLLatency       2        2     2        0       0         0          2
```

Family: `^(container|jvm|k8s\.pod)\.memory\.` — the eleven memory series a
memory-stress or container-kill injection is supposed to move.

**A guard discards the memory metric in 2 of 369 cases. The other 367 keep it and
lose with it.** There is no guard bug to fix, and no missing data: 369/369
sources carry the family. The defect is in the competition, not in admission.

## What beats it

For the 294 block cases whose source rendered a competition, the metric that
out-scored the source's best memory metric:

| count | metric                                      |
| ----- | ------------------------------------------- |
| 45    | `jvm.system.cpu.load_1m`                    |
| 31    | **(the memory metric itself wins)**         |
| 28    | `k8s.pod.filesystem.usage`                  |
| 24    | `queueSize`                                 |
| 20    | `db.client.connections.wait_time.max`       |
| 55    | `http.*` latency, six labels combined       |
| 9     | `processedSpans`                            |
| 9     | `jvm.gc.duration.max`                       |

And the metric that decided the *wrong winner's* own competition, over 319 cases:

| count | metric                                |
| ----- | ------------------------------------- |
| 39    | `db.client.connections.use_time.max`  |
| 38    | `jvm.system.cpu.load_1m`              |
| 28    | `jvm.class.loaded`                    |
| 21    | `queueSize`                           |
| 20    | `http.server.request.duration`        |
| 14    | `k8s.pod.cpu.node.utilization`        |

Score ratio (source's best memory metric ÷ the metric that beat it):
median **0.59** for JVMMemoryStress (p10 0.33, p90 0.85; 23/147 are a
within-20% miss) and median **0.34** for ContainerKill.

## The reading

Three of the recurring winners are **not service-local metrics**:

- `queueSize`, `processedLogs`, `processedSpans`, `otlp.exporter.exported`,
  `otlp.exporter.seen` are the **OTel Collector's own** internals. A collector's
  queue growing because log volume exploded is a *consequence* of the fault, and
  it is a metric of the sidecar, not of the service.
- `k8s.pod.cpu.node.utilization` is the **node's** utilization — on a shared
  cluster, other tenants' load.
- `k8s.pod.filesystem.usage` rising is not a memory-fault signature.

That reading suggested the fix was to drop those families. **Measurement
contradicts it**, and the correction is recorded here rather than left in a
readme:

| drop family | winner's decisive metric is in it | source's is not (flippable) | source's is (would hurt) |
| ----------- | --------------------------------- | --------------------------- | ------------------------ |
| collector internals | 25 | 17 | **30** |
| node-level (`*.node.utilization`) | 14 | 14 | 7 |
| limit-relative (`*_limit_utilization`) | 4 | 4 | 2 |
| connection pool (`db.client.connections.*`) | 68 | **62** | 25 |
| pod filesystem | 4 | 3 | **27** |

This is a necessary-condition count, not a prediction: a case can only flip if
dropping the family removes the *wrong winner's* decisive metric and leaves the
*source's* intact. It is enough to kill three of the five:

- **collector internals is net-negative** (25 helped, 30 hurt). The source's
  strongest metric is a collector metric more often than the wrong winner's is,
  so those series are not noise — they carry the source signal in a third of the
  cases. The structural complaint was right about their provenance and wrong
  about their effect.
- **node-level and limit-relative** have small positive bounds (14 and 4) against
  7 and 2 counter-cases.
- **pod filesystem is net-negative** (4 helped, 27 hurt).

Only the connection pool has a large positive bound (62 against 25), and even it
carries 25 counter-cases, so it is a candidate for a measured ablation rather
than a conclusion.

## The mechanism, once the decomposition is visible

`score = deviation + trend + cv + burst` with `deviation = log10(1 + ratio)`, and
the two directions are not symmetric: `dropRatio` is bounded at 1 by
construction, so a **drop-only** score cannot exceed `log10(2) ≈ 0.301` plus the
bounded bonuses — about 0.55. **A score above ~0.55 is therefore a rise**, which
makes the direction of every winner computable without inspecting any series:

| population               | n    | median score | `10^score − 1` | median **riseRatio** | median **baseline** |
| ------------------------ | ---- | ------------ | -------------- | -------------------- | ------------------- |
| wrong top-1 winner       | 319  | 2.044        | 110×           | **29.22×**           | **1.75**            |
| other predicted (rank 2+) | 1406 | —           | —              | 26.76×               | 1.55                |
| ground-truth source      | 369  | 1.307        | 19×            | **8.46×**            | **8.07**            |

The `10^score − 1` column is what the first reading reported, and it is **not the
rise**: the score includes the bonuses, so it overstates the ratio by roughly the
bonus share. The `riseRatio` column is the metric's actual relative rise and is
the one to reason from. Every direction claim below is unaffected — a score above
0.55 still implies a rise — but every magnitude claim must use `riseRatio`.

Only 9 of 319 wrong winners score below 0.6, so **97% are rise-driven**. The
winner's rise is 3.5× the source's (29.22 against 8.46) on a baseline 4.6×
smaller (1.75 against 8.07), which is the entire separation. The predictions that
did NOT take rank 1 have the same profile as those that did (rise 26.76,
baseline 1.55), so this is a property of being victim-like rather than of
winning: the source is out-ranked by essentially any caller, and the ordering
among the callers is what decides.

## Two candidates this measurement eliminated

**The near-zero-baseline guard.** Its floor is an *absolute* `baselineMean ≤
0.001`, and the prior falsification of it was measured on RCAEval where the
production top-1's baselines ran `0.008 … 8.3e7`, so the guard never fired. On
this block the decisive metrics' baselines are:

| baseline band | wrong winners |
| ------------- | ------------- |
| ≤ 1e-6 | 0 |
| 1e-6 … 1e-3 (at or below the floor) | **14** |
| 1e-3 … 1e-2 | 14 |
| 1e-2 … 1 | 109 |
| > 1 | 182 |

Median baseline **1.75**, minimum `4.4e-5`, maximum `7.8e6`. Only **14 of 319**
(4.4%) would be touched by the floor at all, 13 of them inside one family
(`k8s.*`, median baseline `5e-4`); the source population has 9 of 369. And the
prior falsification on RCAEval — where the baselines ran `0.008 … 8.3e7` and the
guard never fired — is *consistent* with this rather than contradicted by it.
Recalibrating the guard reaches 4% of the wrong winners, not a block.
**Eliminated.**

**The trend bonus.** `trendBonus = trendStrength × 0.15` and `trendStrength` is
unbounded, so a metric that drifts monotonically earns an open-ended bonus —
`trend = 0.779` out of a `score = 3.291` in one real case, a quarter of it. But
the composition is the *same in both populations*:

| population | deviation | trend | cv | burst | trend ≥ 25% of score |
| ---------- | --------- | ----- | -- | ----- | -------------------- |
| wrong top-1 winner | 0.730 | 0.223 | 0.034 | 0.000 | 120/319 |
| other predicted (rank 2+) | 0.712 | 0.239 | 0.034 | 0.000 | 606/1406 |
| ground-truth source | 0.709 | **0.244** | 0.033 | 0.000 | 174/369 |

The source leans on the trend bonus slightly **more** than the wrong winner does.
Reweighting it cannot separate the two populations, because the winner does not
have a different composition — it has more of the same one. **Eliminated.**

## What is left

Every population is a deviation-led rise (0.71–0.73 of the score from the
deviation, 0.22–0.24 from the trend) on a real operating baseline. The winner's
metric simply has a larger relative rise — which is precisely what
`max over metrics` is defined to select. Nothing in the metric layer can prefer
the source's 8.5× resource rise to a caller's 29× latency rise, because the
*ratio* is the only quantity the score consults and the *symptom* has the larger
one.

The remaining lever is therefore structural: change what a service's score IS,
rather than reweighting a term of it. The candidate that keeps the source's
information while removing the dynamic-range bias is to rank each metric ACROSS
services before the maximum, so the source saturates on the metric where it is
extreme instead of losing to a victim on a metric with a wider range. The
decision then falls to the causal signals, which is the only place it can be made
for this block — the source is log-silent.

That change touches the anomaly score, which FSE'26 and RCAEval share, so it
needs the full-set FSE'26 ablation **and** the golden 9-cell guard, with the
9-cell required to be bit-identical or the candidate dies.

## An instrument defect found by its own guard

The first `metricTop` render declared the number of kept metrics that carried a
decomposition — 38 on a real case — while printing at most three entries. The
reader validates a declaration against what follows (a truncation that reads as
complete is the defect class the instrument exists for), so it rejected 2089 of
2094 lines and the first shape run was unusable. The producer was wrong and the
guard was right.

The blind spot is worth naming: every fixture in the suite had at most three kept
metrics with a decomposition, so line and branch coverage were both **100%**
while the truncation path was never exercised. Coverage of lines is not coverage
of the cases a line can see.

## What this rules out

- **A guard fix for the memory family.** 2/369.
- **A new log-signal mode.** The block's `selfAnomaly`-only ranking is nearly the
  final ranking (26%→23%, 24%→18% top-5).
- **Data acquisition.** 369/369 sources carry all eleven memory series.
- **A `max`-over-metrics tie-break.** The median miss is 0.59 of the winner's
  score; only 23/147 misses are within 20%.
- **Dropping collector internals, pod filesystem, or the node-level series.**
  Net-negative or near-neutral on the necessary-condition test above.
- **Recalibrating the near-zero-baseline guard.** It would touch 14 of 319 wrong
  winners (4.4%), 13 of them in one family.
- **Reweighting the trend bonus.** The source leans on it more than the winner
  does (0.250 against 0.223).
- **A `--drop-metrics` ablation as the next move.** It was the plan before the
  direction and composition of the winners were computable.

## Next step — the structural candidate, and its kill criterion

Change what a service's anomaly score IS: rank each metric across services
*before* the maximum, so a service that is the extreme deviator on ANY metric
saturates on that metric instead of being out-scaled on it. The source then stops
losing to a symptom whose only advantage is a wider dynamic range, and the
decision moves to the causal signals (onset order, call-graph direction, the log
signal) where a source/symptom asymmetry actually exists.

Its kill criterion is fixed in advance, because the change touches a score that
both benchmarks share:

1. the **RCAEval golden 9-cell must be bit-identical** (RE1 80/92.8/68,
   RE2 82.4/88.9/68.1, RE3 80/45/51.1) — this is shared production scoring, and a
   golden-baseline regression kills the change regardless of the FSE'26 gain;
2. the **FSE'26 full 1422 must not regress a single fault type**, with the
   silent block (JVMMemoryStress 171, ContainerKill 89, PodFailure 24,
   PodKill 10) as the target.

A cheaper intermediate worth measuring in the same run: keep the max but clamp
each metric's *contribution* to a common ceiling (the way the DROP direction is
already clamped at `log10(2)`), so no single metric can be worth more than a
fixed amount. That preserves the ordering among the source's own metrics while
capping the advantage a 100× rise has over a 5× one. It is a smaller change and
the same run tells us whether the ceiling is enough before the ranking change is
attempted.
