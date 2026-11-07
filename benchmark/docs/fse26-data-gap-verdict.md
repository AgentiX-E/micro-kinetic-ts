# FSE'26 weak-fault-type gap verdict

> Status: **source-code + diagnostic confirmed** (run 34446843763, 12 case dumps
> across the 4 weak fault types).

## Conclusion (TL;DR)

The four weak fault types (579 cases / 40.7% of the dataset) are weak for
**three distinct reasons**, not one:

1. **HTTPResponseReplaceCode (231 @4.8%) — signal gap, the top lever.** The
   source floods ERROR logs (`HttpClientErrorException` storm; 1560/2860/3564
   lines in the 3 samples, **always the max-error service, 10–16× any victim**),
   but the log signal is gated on `isLogicException` (self-caused programming
   errors), so these propagated HTTP errors score `logScore=0.000`. The signature
   is **present and source-distinctive**, just unrewarded.

2. **HTTPResponseDelay / HTTPRequestDelay (177 @3.4%) — data gap.** The source
   is essentially invisible (selfAnomaly=0.367, rank #32): adding latency
   consumes no CPU/memory, and the latency signature lives in trace `duration`
   (ns) — **dropped** by `read_trace_edges`. The only retained latency is
   `hubble_http_request_duration_*` (network-level), which fires on the
   *victims* (who wait on the delayed source), not the source.

3. **JVMMemoryStress (171 @7.0%) — mixed.** The memory gauges
   (`container.memory.usage`, `k8s.pod.memory.*`) are retained, but the fault's
   sharpest observable is a latency side-effect (GC pressure → slow requests),
   so the engine ranks the broad `hubble_http_request_duration_*` spike over the
   gradual memory rise. The GC metrics (`jvm.gc.duration`, `jvm.gc.*`) live in
   `*_metrics_histogram.parquet` — **dropped**.

## Diagnostic evidence (run 34446843763, per-case signal inventory)

The diagnostic dump prints each service's selfAnomaly, dominant metric, and
post-injection ERROR/FATAL/logic counts. Key rows (`err(gt)` vs `err(max)`):

| Fault type | GT source | err(gt) | err(max) | max=GT? | source rank |
|---|---|---|---|---|---|
| ReplaceCode ×3 | ts-basic-service | 1560 / 2860 / 3564 | same | **always** | #7 / #16 / #14 |
| JVMMemoryStress ×3 | auth / cancel / config | 0 / 0 / 0 | 126 / 251 / 195 | never | #2 / #6 / #17 |
| RequestDelay ×2 | basic / seat | 1 / 3 | 48 | never | #5 / #6 |
| ResponseDelay ×2 | basic / seat | 4 / 1 | 48 | never | #32 / #10 |

The source's dominant metric is almost always `hubble_http_request_duration_pXX`
(a broad network-latency symptom), never its fault-specific signature.

## Bridge data gaps (source-code confirmed)

`fse26_convert.py` reads three inputs and silently discards the rest:

1. **`read_metrics`** reads only `_metrics.parquet` (gauge/counter), dropping
   `_metrics_sum.parquet` (summary) and `_metrics_histogram.parquet`
   (`count`/`sum`/`min`/`max` + `jvm.gc.*` attributes).
2. **`read_trace_edges`** reads only `trace_id`/`span_id`/`parent_span_id`/
   `service_name`, dropping `duration` (ns) and `attr.http.response.status_code`
   (+ `attr.status_code`, `attr.http.request.method`, content lengths).
3. **`read_logs`** keeps `time`/`service_name`/`level`/`message` — the only fully
   retained telemetry.

The platform's reference analyzer derives `http.response.error_rate`
(status_code ≥ 400) and `http.server.request.duration` (span duration) from the
dropped fields. Its golden-signal map also names `jvm.gc.duration` (latency),
`jvm.memory.used` (saturation) — the JVMMemoryStress signature.

## P1c plan (ranked by value ÷ cost)

1. **Error-count log signal (replace-code, 231 cases) — cheapest, biggest.**
   Add an `all` mode to `computeLogScores` (count ALL ERROR/FATAL post-injection,
   not gated on `isLogicException`), wire `--log-mode all` through `run-fse26.ts`,
   TDD the pure function, then ablate `count` vs `all` on the full FSE'26
   benchmark. Risk: `all` misfires on memory/delay (source silent, victim floods),
   so it MUST be ablated — net-positive + zero regression across fault types
   before it becomes the default.

2. **Trace `duration` → latency signal (delay, 177 cases) — data re-convert.**
   Extend the converter to aggregate per-service span `duration` (mean/P90 per
   window, mirroring the platform's `_calculate_duration_metrics`) into `case.json`,
   then reward a source-side latency rise. Cost: re-download 13.4 GB + re-convert
   (~2 h CI); emit aggregated series, not raw spans.

3. **Histogram metrics + saturation prior (JVMMemoryStress, 171 cases).**
   Consume `_metrics_histogram` (`jvm.gc.*`, latency percentiles) and add a
   saturation-metric prior so a gradual memory/GC rise outranks a broad latency
   side-effect. Cost: same re-convert.

Cost of 2 + 3 is shared (one re-convert adds both trace `duration` and histogram
series).

## Control

HTTPResponseReplaceBody (51 @98.0%) is near-perfect because its signature is in
the **logs** (retained): the body replacement makes the source throw, and the
throw is a self-caused logic exception that the existing log signal already
rewards. This confirms the log signal works when the exception is self-caused —
the gap is exactly the propagated HTTP-error case.
