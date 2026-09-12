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
  it is a metric of the sidecar, not of the service. They are resolved as
  the service's metric and therefore compete in that service's anomaly maximum
  (33 block sources and 21 wrong winners are decided by them).
- `k8s.pod.cpu.node.utilization` is the **node's** utilization — on a shared
  cluster, other tenants' load.
- `k8s.pod.filesystem.usage` rising is not a memory-fault signature, and for a
  `ContainerKill` a disk gauge moving is noise.

A `max` over a metric inventory that mixes service-local, sidecar, and node-level
series lets the latter two win the service's own score, which is what the numbers
show. `jvm.system.cpu.load_1m` is the largest single beater and is a genuinely
ambiguous case — a memory allocator does burn CPU — so it is listed but not
claimed as a defect.

## What this rules out

- **A guard fix.** 2/369.
- **A new log-signal mode.** The block's `selfAnomaly`-only ranking is nearly
  the final ranking (26%→23%, 24%→18% top-5).
- **Data acquisition.** 369/369 sources carry all eleven memory series.
- **A `max`-over-metrics tie-break.** The median miss is 0.59 of the winner's
  score; only 23/147 misses are within 20%.

## Next step — measure the mixed inventory, with no code change

`--drop-metrics` already exists and is exactly this ablation: it filters the
named series out of every case before scoring, so a ranking change is
attributable to one of the bridge's metric sources without a cache rebuild.
The measurement to run, on the **full 1422 cases** against the 47.3% baseline:

1. drop the collector internals
   (`queueSize,processedLogs,processedSpans,otlp.exporter.exported,otlp.exporter.seen`);
2. drop the node-level series (`k8s.pod.cpu.node.utilization`,
   `k8s.pod.cpu_limit_utilization`, `k8s.pod.memory.node.utilization`);
3. both.

It needs a `drop_metrics` workflow input first (the runner already accepts the
flag; the workflow does not expose it). The families are candidates, not
conclusions: `jvm.system.cpu.load_1m` is deliberately **not** in any of them.

If any family is net-positive with zero regressed types, the fix belongs in the
bridge's metric selection rather than in the scorer, and it is verifiable by the
same run.
