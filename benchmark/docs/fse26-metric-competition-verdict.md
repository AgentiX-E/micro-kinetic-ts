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

| population              | median winning score | implied rise |
| ----------------------- | -------------------- | ------------ |
| wrong top-1 winner      | 2.044                | ~110×        |
| wrong top-1 winner, p90 | 3.121                | ~1320×       |
| wrong top-1 winner, max | 3.874                | ~7480×       |
| ground-truth source     | 1.307                | ~19×         |

Only 9 of 319 wrong winners score below 0.6, so **97% are rise-driven**. The
recurring winners are latency series, ranked by how extreme their rise is:

| median implied rise | metric |
| ------------------- | ------ |
| 2338× | `hubble_http_request_duration_p95_seconds` |
| 797×  | `hubble_http_request_duration_p50_seconds` |
| 322×  | `db.client.connections.use_time.max` |
| 265×  | `http.client.request.duration.max` |
| 127×  | `http.server.request.duration` |

A rise of 2338× on a p95 is not a load level moving; it is a percentile that was
essentially zero for most of its history. The guard that exists for exactly that
class tests `baselineMean <= 0.001` — an **absolute** floor — and the prior
falsification of it (`docs/near-zero-rise-suppression-falsified.md`) was measured
on RCAEval, where the production top-1's baselines ran `0.008 … 8.3e7` and the
guard therefore never fired. Whether the same floor is miscalibrated for a
latency series **in seconds** — legitimately living at `0.05` with peaks at `100`
— is a different question, and it is the one the `rise` and `base` columns of
`metricTop` answer. The ablation of the metric families above is not the next
step; reading the baselines is.

## What this rules out

- **A guard fix for the memory family.** 2/369.
- **A new log-signal mode.** The block's `selfAnomaly`-only ranking is nearly the
  final ranking (26%→23%, 24%→18% top-5).
- **Data acquisition.** 369/369 sources carry all eleven memory series.
- **A `max`-over-metrics tie-break.** The median miss is 0.59 of the winner's
  score; only 23/147 misses are within 20%.
- **Dropping collector internals, pod filesystem, or the node-level series.**
  Net-negative or near-neutral on the necessary-condition test above.
- **A `--drop-metrics` ablation as the next move.** It was the plan before the
  direction of the winners was computed; the rise table makes it a way to tune a
  number that the reading will supply directly.

## Next step

Re-run the same 369 cases with `metricTop` enabled and read the `rise`/`base`
columns for the wrong winner's decisive metric. Two outcomes, two different
fixes, and the run distinguishes them:

- **Baselines at or below the `0.001` floor.** The near-zero guard's floor is
  absolute and simply wrong for a series measured in seconds; the fix is to make
  the floor relative to the series' own peak (the same idea the idle guard
  already uses, since it compares against `max * 0.001`). This is a guard
  recalibration, not a new signal.
- **Baselines at a real operating level (`0.05`, `0.5`, `1e8`).** Then a 100–3000×
  rise is genuine and the defect is structural: a `max` over relative deviations
  across heterogeneous metrics lets the *symptom* with the largest dynamic range
  decide a service's own score. The fix is to rank each metric across services
  before the maximum, so the source's moderate rise on its own signature
  saturates instead of losing to the victim's extreme rise on a latency. That
  keeps the source's information and hands the decision to the causal signals —
  which is the only place it can be made, since the source of this block is
  log-silent.

Either way the change needs the FSE'26 full-set ablation **and** the RCAEval
golden 9-cell guard, because the anomaly score is shared by both.
