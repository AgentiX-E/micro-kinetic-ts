# FSE'26 framework-HTTP direction — corrected verdict (supersedes emitter-dominance falsification)

## Correction notice

The prior turn's readback of the source-silent diagnostic concluded "the GT
source is 100% log-silent" and cross-checked it against a claim that the
replace-code source is _also_ silent. That cross-check was **wrong**: the
diagnostic parser matched service lines with the regex `\[#N\]` and silently
DROPPED every ground-truth service, which is rendered `[GT,#N]`. This fabricated
`gt_http = 0` for the replace-code side and produced an over-broad "both
directions are identical" story. This doc is the clean re-parse.

## Corrected evidence (710 cases, two diagnostic runs)

| fault type                    | GT floods framework-HTTP | GT is top emitter | GT metric-rank #1 |
| ----------------------------- | ------------------------ | ----------------- | ----------------- |
| HTTPResponseReplaceCode (231) | 173 (75%)                | **162/173 (94%)** | 160/173 (92%)     |
| HTTPResponseDelay (89)        | 70 (79%)                 | 41/70 (59%)       | 45/70 (64%)       |
| HTTPRequestDelay (88)         | 69 (78%)                 | 37/69 (54%)       | 43/69 (62%)       |
| JVMMemoryStress (171)         | 0 (0%)                   | 0/105 (0%)        | 0/105 (0%)        |
| ContainerKill (89)            | 0 (0%)                   | 0/43 (0%)         | 0/43 (0%)         |
| NetworkBandwidth (42)         | 1 (2%)                   | 1/22 (5%)         | 1/22 (5%)         |

### Fact 1 — the two directions ARE separable in kind

- **Source-active (replace-code)**: the source is the concentrated framework-HTTP
  emitter (94% top-emitter) AND metric-rank #1 (92%). Its flood is huge —
  `gt_http` median 537, p90 3,162, max 10,981.
- **Source-silent (kill/memory/bandwidth)**: the source NEVER floods (0-2%);
  a **victim** is the top emitter AND metric-rank #1. The victim flood is small —
  median 35, p90 110, max 336.

### Fact 2 — the metric ranking itself inverts in source-silent types

In every source-silent case the top-http-emitter is metric-rank **#1**, while the
GT source sits at rank #2-#5 with `selfAnomaly` 0.94-1.00 (close but never #1):

```
JVMMemoryStress  GT=[ts-order-service]
  ts-seat-service  [#1] anom=1.00 http=336   ← victim (latency from receiving errors)
  ts-order-service [#2] anom=0.98 http=0     ← the silent source (memory fault)
```

The scalar `selfAnomaly` (max over all metrics) cannot separate "the source's
resource fault" from "the victim's latency fault": the victim's error-reception
latency spike slightly exceeds the source's memory/cpu spike.

### Fact 3 — the magnitude gap is real but overlapping

`gt_http` (source-active) vs top-emitter `http` (source-silent):

| band    | replace-code source | source-silent victim |
| ------- | ------------------- | -------------------- |
| >= 1000 | 89 / 231 (39%)      | 0 / 170 (0%)         |
| >= 500  | 116 / 231 (50%)     | 0 / 170 (0%)         |
| >= 100  | 150 / 231 (65%)     | 20 / 170 (12%)       |
| < 100   | 81 / 231 (35%)      | 150 / 170 (88%)      |
| == 0    | 58 / 231 (25%)      | 0 / 170 (0%)         |

A threshold near 500 separates cleanly but only captures half the replace-code
cases (and the absolute count is confounded by traffic volume + injection
duration), so it is not a robust shipped lever.

## Conclusion — the log signal is exhausted, for the RIGHT reason

`logicHttpDominant` (emitter-concentration) is still dead, but the correct
reason is: **both directions are concentrated** (replace-code source floods
concentrated 94% AND source-silent victim floods concentrated ~70%), so
concentration carries no directional information. The earlier falsification doc
reached the right conclusion from the right source-silent evidence; only its
replace-code cross-check was corrupted by the parser bug.

The real bottleneck is **metric**: the scalar `selfAnomaly` lets the victim's
latency spike out-rank the source's resource fault in source-silent types. The
only lever is the documented data gap — consume `_metrics_sum`/`_metrics_histogram`
(`jvm.gc.*`, duration quantiles) and trace `duration`/`attr.http.response.status_code`,
derive `http.response.error_rate` / `http.server.request.duration` / GC-saturation
series, and TDD a multi-dimensional source signature.

## Next step — P1c metric re-convert (unchanged, now better justified)

Re-download 13.4GB, re-convert (aggregate, not raw span), TDD a latency/GC
metric signal, ablate against `count` (16.5%) and `logicHttp` (46.5%). The
derived `http.server.request.duration` (response latency) is the candidate
source signature for the memory-stress/kill/bandwidth types that the log signal
cannot reach.
