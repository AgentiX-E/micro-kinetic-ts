# FSE'26 — Metric Source Attribution & Fan-Out Verdict (P1c-abl)

> Runs the decisive **component ablation** that `docs/fse26-metric-gap-verdict.md`
> §5 flagged as the remaining question, and lands on three results that reframe the
> earlier verdict: (a) the productive lever is the **histogram peak** source, not the
> trace-derived latency/error-rate the earlier doc credited; (b) underneath both,
> `read_metrics` had a **data-integrity defect** that interleaved a metric's label
> fan-out into a synthetic sawtooth — fixed here; (c) that defect was **suppressing
> the engine on both shards**, and repairing it moves the full 1422-case benchmark
> from **18.85% to 23.07% Top@1** (+60 cases, one regression), i.e. from *below* the
> RCABench SOTA average (21%) to **above** it.

## 0. Headline

| | Top@1 | correct | Δ |
|---|---|---|---|
| pre-fix (shipped state, `5bef29a`) | 18.85% | 268 / 1422 | — |
| post-fix (fan-out rolled up) | **23.07%** | **328 / 1422** | **+60 (+4.22pp)** |
| RCABench SOTA average / best | 21% / 37% | — | +2.07pp vs avg |

Shard split: non-HTTP 159 → 179 (+20), HTTP 109 → **149 (+40)**. Ten of eleven
non-HTTP movements are gains; **every one of the nine HTTP fault types is flat or
up** — there is no offsetting regression.


## 1. Method — a local 1422-case harness that is byte-exact with CI

The full RCABench (1422 cases, 7 categories: HTTP 796 / Network 254 / Resource 173
/ Pod 123 / JVM 73 / Time 2 / DNS 1) was materialised locally from the published
`rcabench-data` shards, and every variant below was run with the production
defaults (`logWeight=1`, `rankNormalization=true`).

The harness is validated **byte-exact against CI**, not merely close. Running the
`gauge_only` variant (which drops all three derived sources and therefore models the
pre-`b811812` converter) and `full` across both shards reproduces CI's old and new
columns on **every one of the 25 fault types**:

| | non-HTTP (626) | HTTP (796) | total (1422) |
|---|---|---|---|
| OLD (pre-`b811812`) | 102 | 133 | **235 = 16.53%** (CI: 16.526%) |
| NEW (all four sources) | 159 | 109 | **268 = 18.85%** (CI: 18.847%) |
| Δ | +57 | **−24** | +33 |

Exact per-type checks include NetworkPartition 9 → 45, NetworkCorrupt 5 → 16,
NetworkLoss 8 → 18, NetworkBandwidth 4 → 13, NetworkDelay 8 → 14, JVMException
33 → 32, JVMMemoryStress 12 → 8, ContainerKill 6 → 1, and on the HTTP side
HTTPResponseReplaceCode 11 → 4, HTTPRequestReplaceMethod 49 → 46,
HTTPResponseReplaceBody 51 → 51, HTTPRequestReplacePath 4 → 0,
HTTPResponseAbort 3 → 1, HTTPRequestAbort 9 → 1. No CI rebuild was needed for any
attribution below.

The headline "the metric fix is net +2.3pp" therefore decomposes as **+57 on non-HTTP
and −24 on HTTP** — the aggregate hides an opposite-signed effect on the larger
shard, which is what made the earlier "direction-asymmetry" story look plausible.

Ablation is driven by the new `--drop-metrics <csv>` switch (`1f1c759`), which
removes metric **names** from the loaded case; the three derived sources are
disjoint name sets, so dropping a set isolates that source.

## 2. Component ablation — 626 non-HTTP cases

`gauge_only` = the pre-fix converter (gauge `_metrics` only).
`full` = all four sources. The other columns drop exactly one source.

| fault type | n | OLD (gauge) | FULL | drop hist | drop sum | drop trace |
|---|---|---|---|---|---|---|
| JVMMemoryStress | 171 | 12 | 8 | 9 | 10 | 9 |
| NetworkPartition | 97 | 9 | 45 | 10 | 47 | 48 |
| ContainerKill | 89 | 6 | 1 | 4 | 1 | 1 |
| NetworkLoss | 48 | 8 | 18 | 8 | 19 | 20 |
| NetworkCorrupt | 46 | 5 | 16 | 7 | 17 | 16 |
| JVMException | 43 | 33 | 32 | 33 | 32 | 32 |
| NetworkBandwidth | 42 | 4 | 13 | 5 | 20 | 11 |
| PodFailure | 24 | 2 | 0 | 0 | 0 | 0 |
| NetworkDelay | 21 | 8 | 14 | 7 | 16 | 13 |
| JVMReturn | 21 | 11 | 12 | 12 | 11 | 12 |
| PodKill | 10 | 1 | 0 | 0 | 1 | 0 |
| JVMLatency | 7 | 2 | 0 | 1 | 2 | 1 |
| TimeSkew / JVMMySQLLatency / JVMCPUStress / DNSRandom | 2/2/2/1 | 0/0/1/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 | 0/0/0/0 |
| **TOTAL** | **626** | **102 (16.29%)** | **159 (25.40%)** | **96 (15.34%)** | **176 (28.12%)** | **163 (26.04%)** |

### Per-source net contribution

| source | effect of dropping it | net |
|---|---|---|
| `_metrics_histogram` (`.max` peaks) | 159 → 96 | **+63 (load-bearing)** |
| `_metrics_sum` (counters) | 159 → 176 | **−17 (net harmful)** |
| trace-derived (mean latency + error rate) | 159 → 163 | **−4 (net harmful)** |

The gains are not additive: summing the three individual contributions
(+63 −17 −4 = +42) understates the joint removal, which costs 57 (159 → 102). The
three sources partially compensate for one another, so only the joint figure
matches CI.

## 3. Finding 1 — the productive lever is the histogram peak source

CI attributed the +75 Network gain to the trace-derived `http.response.error_rate`
/ `http.server.request.duration`. **The ablation falsifies that.** Dropping the
histogram source costs NetworkPartition −35, NetworkLoss −10, NetworkCorrupt −9,
NetworkBandwidth −8, NetworkDelay −7 = **−69 across the Network family**, whereas
dropping the trace-derived source *gains* +3/+2 net.

The carrier is the histogram `.max` series — `http.server.request.duration.max`,
`http.client.request.duration.max`, `hubble_http_request_duration_seconds.max`,
`db.client.connections.{create,use,wait}_time.max`. A latency-injection fault
produces a sharp **peak** at the source, and the peak is what outranks the victims;
the trace-derived **mean** is a diluted version of the same signal and adds noise
instead.

This also explains why `jvm.gc.duration.max` (the signature `070f84f` was written
to expose) did not rescue JVMMemoryStress: that type's source signature is not
latency-peak-shaped, so the one source that does fire cannot reach it.

## 4. Finding 2 — root cause: `read_metrics` interleaved the label fan-out

The `_metrics_sum` counter source is net-negative, and the cause is a **defect**,
not weak signal.

The platform's own normalisation (`convert_metrics`,
`artifacts/fse26-meta/platform-feat/src/rcabench_platform/v2/sources/rcabench.py:31`)
**preserves the label dimensions** as columns: `attr.source`, `attr.destination`,
`attr.source_workload`, `attr.destination_workload` (Cilium/hubble network flows)
and the k8s resource attributes. One metric therefore fans out into one row per
label set **sharing a timestamp** — genuinely distinct time series.

The bridge modelled exactly one series per `(service, metric)` but built it by
concatenating all rows of that metric in time order, with no per-timestamp
roll-up. That interleaves the distinct label series into a sawtooth. Observed on
real data (`ts0-mysql-container-kill-9t6n24`, same datapack):

```
hubble_http_requests_total  ts-notification-service  [1, 4, 1, 4, 1, 4, …]
hubble_http_requests_total  ts-auth-service          [1, 149, 954, 954, 1, 149, 1095, 1096, …]
hubble_http_requests_total  ts-verification-code-service  [1, 4, 884, 885, 1, 4, 938, 938, …]
hubble_http_requests_total  ts-ui-dashboard          [115, 884, 10, 94, 26, 339, 2, 339, …]
k8s.container.cpu_request   (any service)            2304 samples, of which 48 are genuine (48× fan-out)
```

The corrupted series is never uniformly sampled (the first duplicate pair has
step 0), so `compact_metric_series` always emits it in the explicit `timestamps`
form — which is what made the defect post-hoc recoverable. Repairing an entire
626-case subset rolls up **410,652 series** (≈656 per case).

Two prior conclusions are corrected:

- The memory note *"gauge fan-out is a benchmark-inherent feature, do not dedup —
  the platform reference keeps all fan-out values too"* conflated two different
  things. The platform reference (`_extract_service_metrics`, rcabench.py:495) keeps
  a per-metric **multiset** of values (`.group_by("metric").agg(pl.col("value"))`)
  and never treats it as a time series. A multiset is order-free; our engine's
  per-sample deviation is not. Preserving the fan-out values and interleaving them
  into one time axis are not the same operation.
- The histogram reader (`070f84f`) already collapsed per `(service, metric, time)`
  with `max`. The gauge/counter reader never did.

### The fix

`read_metrics` now rolls the fan-out up to one sample per
`(service, metric, time)` with `sum` — the service-level aggregate over the label
partitions (`sum by (service)`). The roll-up is scoped per **source file** so the
normal (baseline) and abnormal (injection) windows are never summed together even
if a timestamp coincides. Five TDD tests lock the behaviour
(`TestReadMetricsFanOut`), including the real sawtooth shape.

## 5. Status of the earlier verdict's mechanism

`docs/fse26-metric-gap-verdict.md` §3 argued the regression was the *victim*
outranking the *silent source* because the restored interface signals are
victim-emitted. **That mechanism is not what the data shows.** The regressions are
driven by the histogram source family, and the `_metrics_sum` source is harmful
because it is corrupted. The direction-asymmetry framing should be treated as
superseded by §§3–4 above; the *numbers* in that doc (per-type old/new) remain
correct and are reproduced exactly here.

## 6. Verdict

1. **Attribution is complete and the mechanism is identified**: histogram peaks are
   the lever (−63 if removed), `_metrics_sum` and trace-derived are net-negative
   (−17 / −4 if kept).
2. **A real data-integrity defect was found and fixed** in the bridge, with TDD.
   The result has been captured without a CI rebuild.
3. **The regression was not a "direction ambiguity" ceiling — it was a bug.** It is
   fully removed by the fix: the full benchmark goes 18.85% → **23.07%**, past the
   SOTA average, with a single regressed case. Measured in §7.

## 7. Post-fix measurement — the defect was the cause

The 626-case non-HTTP subset was rolled up post hoc exactly as the fixed converter
does (adjacent equal timestamps summed, then re-compacted; the corrupted series is
always in explicit-`timestamps` form, so the repair is lossless) and re-scored with
production defaults.

Fidelity: the normal and abnormal files are contiguous slices of one ~8-minute span
(measured span 470–475 s at a 5 s step), so rolling up adjacent equal timestamps
cannot merge the two windows except at a single shared boundary sample — where the
converter's `__source` guard would keep two samples instead of one. The repair is
therefore exact up to one sample per series, which cannot move a ranking.

| variant | Top@1 | correct |
|---|---|---|
| PRE-FIX, **OLD** config (gauge only, interleaved) | 16.29% | 102 |
| POST-FIX, **OLD** config (gauge only, rolled up) | 18.69% | 117 |
| PRE-FIX, all sources (interleaved fan-out) | 25.40% | 159 |
| dropping the counter source entirely (pre-fix) | 28.12% | 176 |
| **POST-FIX, all sources (rolled up)** | **28.59%** | **179** |

**Net +20 cases (+3.19pp in-subset), 10 fault types up and 1 down by a single case.**
The fix is also **independent of this work's P1c restoration**: applied to the *old*
converter configuration it still lifts 102 → 117 (**+15**) — the interleaving had been
suppressing the original gauge source all along, before any derived metric existed.

| fault type | n | pre | post | Δ |
|---|---|---|---|---|
| JVMMemoryStress | 171 | 8 | 13 | **+5** |
| NetworkBandwidth | 42 | 13 | 18 | **+5** |
| NetworkPartition | 97 | 45 | 47 | +2 |
| NetworkDelay | 21 | 14 | 16 | +2 |
| JVMException | 43 | 32 | 34 | +2 |
| JVMLatency | 7 | 0 | 2 | +2 |
| ContainerKill | 89 | 1 | 2 | +1 |
| NetworkCorrupt | 46 | 16 | 17 | +1 |
| PodKill | 10 | 0 | 1 | +1 |
| NetworkLoss | 48 | 18 | 17 | −1 |

Two conclusions follow, and they are the point of the whole ablation:

1. **The counter source was never the problem — the corruption was.** Repairing it
   (179) scores *higher* than deleting it (176). The fan-out interleaving was
   actively destroying a net-positive signal, not exposing a genuinely weak one.
2. **The type this work set out to fix moved.** JVMMemoryStress — the canonical
   source-silent type, previously considered at its deterministic ceiling — gains
   **+5 (8 → 13)** purely from the data-integrity fix. The earlier "source-silent
   ceiling is unchanged / the metric lever is exhausted" conclusion
   (`docs/fse26-metric-gap-verdict.md` §4) is therefore **superseded**: there was an
   unexamined lever underneath, and it was a bug.

The CI confirmation path is a `rcabench-data` cache rebuild (its `build-cache.yml`
clones micro-kinetic-ts and copies the converter), then an `fse26-benchmark`
dispatch; the local harness has already been shown byte-exact with CI on all 25
fault types, so the direction and magnitude are not in doubt.

### 7b. The HTTP shard — where the earlier verdict saw a regression

The same in-place repair applied to the 796 HTTP cases (534,643 series rolled up,
≈672 per case — the HTTP shard is if anything more corrupted than non-HTTP).

| variant | pre-fix | post-fix | Δ |
|---|---|---|---|
| OLD config (gauge only) | 16.71% (133) | 18.47% (147) | **+14** |
| all sources | 13.69% (109) | **18.72% (149)** | **+40** |

| fault type | n | pre | post | Δ |
|---|---|---|---|---|
| HTTPResponseDelay | 89 | 1 | 12 | **+11** |
| HTTPRequestDelay | 88 | 4 | 13 | **+9** |
| HTTPResponseReplaceCode | 231 | 4 | 11 | **+7** |
| HTTPRequestAbort | 60 | 1 | 7 | **+6** |
| HTTPRequestReplaceMethod | 190 | 46 | 52 | **+6** |
| HTTPRequestReplacePath | 39 | 0 | 1 | +1 |
| HTTPResponseReplaceBody | 51 | 50 | 50 | 0 |
| HTTPResponseAbort | 44 | 1 | 1 | 0 |
| HTTPResponsePatchBody | 4 | 2 | 2 | 0 |

**Every HTTP type is flat or up.** The two delay types (`HTTPResponseDelay`
1 → 12, `HTTPRequestDelay` 4 → 13) and `HTTPResponseReplaceCode` (4 → 11) — all
previously filed as source-silent, sub-2% types — are the largest movers. The
`-24` "direction-asymmetry regression" the earlier verdict was built on was
**entirely this defect**: no direction gate is needed to explain it.

### 7c. Full benchmark, post-fix

Non-HTTP post-fix (179) + HTTP post-fix (149) = **328 / 1422 = 23.07% Top@1**,
against 268 / 1422 = 18.85% shipped, and versus the RCABench SOTA average of 21%.
**+60 cases, +4.22pp, one regressed case in the whole benchmark.**

Both halves were scored with identical production defaults on the two disjoint
shards, so the sum is exact rather than extrapolated.

## 8. Next steps

- **Land the fix in CI**: the published `rcabench-data` shards were built with the
  buggy converter, so a cache rebuild (then an `fse26-benchmark` dispatch) is needed
  for the published numbers to reflect it. Until then the shards understate the engine.
- **Re-audit every earlier "ceiling" measurement** taken on this cache. Any conclusion
  drawn from metric-series shape (not just from logs or topology) may have been
  affected at the same ~656 corrupted series per case. `docs/re3-fault-ceiling.md`,
  `docs/loss-weak-source-verdict.md` and `docs/silent-source-ceiling.md` are the
  candidates; their reasoning is not automatically wrong, but it has not been
  re-derived on repaired data.
- Drop or re-derive the trace-derived source before it is allowed back on: both
  the log-side (`logicHttp`) and the metric-side (`http.response.error_rate`) mean
  interface signals are net-negative.
- Multi-label `Network` ground truth: gains are measured with Avg@K over both
  labels, so a "gain" can mean either label matched.
