# FSE'26 log signal — `logicHttp` mode ablation verdict

> Status: **decisive, net-positive with residual regression — now the shipped
> default.** Measured on the full 1422-case RCABench, both runs on the same
> commit (`858b6ea`) and the same **provenance-verified** cache
> (`converterDigest sha256:00d9656a…3798`, `schemaVersion 2`):
>
> | run | mode | Top@1 | status |
> |---|---|---|---|
> | 34604105028 | `logicHttp` | **47.3%** (673/1422) | success, clean |
> | 34604119657 | `count` | 23.1% (328/1422) | success, clean |
>
> Both: `loadErrors=0 engineErrors=0 emptyGraphs=0`.
>
> Supersedes the 46.5% headline in the first revision of this document, which
> was measured (run 34468582559, head `a3cb249`) **before** the label fan-out
> fix (`969b19a`) and before the histogram/summary conversion (`b811812`), i.e.
> against a cache that is no longer shipped.

## Conclusion (TL;DR)

Counting **logic exceptions PLUS framework HTTP exceptions** (`logicHttp`)
lifts the engine **+24.2 pp Top@1** over the shipped `count` mode
(23.1% → 47.3%), clearing the published SOTA average (21%) by **+26.3 pp** and
the best published model (37%) by **+10.3 pp**. Top@3 and Top@5 move with it
(35.0% → 60.7% and 44.4% → 65.8%).

It is **not zero-regression**: 8 fault types / 41 cases give back ground. The
gain is +386 cases against the 41 lost, so the net is +345 — the mode is
therefore shipped, with the regression documented rather than hidden.

The regression has one mechanism, not eight. The framework HTTP exception
classes `HttpServerErrorException` (the emitter received a 5xx from its
downstream) and `ResourceAccessException` (its downstream connection failed or
timed out) are **direction-symmetric**: a service floods them whether it is the
SOURCE (its own outbound call failed) or a VICTIM (its upstream source failed).
Log text alone cannot separate those two cases; every regressed type is one
where the true source is log-silent and its victims do the flooding.

## Result

| mode | Top@1 | Top@3 | Top@5 | Δ vs SOTA avg | Δ vs SOTA best |
|---|---|---|---|---|---|
| `count` (previous default) | 23.1% | 35.0% | 44.4% | +2.1 pp | −13.9 pp |
| **`logicHttp`** (shipped default) | **47.3%** | **60.7%** | **65.8%** | **+26.3 pp** | **+10.3 pp** |

Correct cases: 328 (`count`) → **673** (`logicHttp`). SOTA anchor: avg 21% /
best 37%. Net case delta: **+386 gain / −41 regress = +345**.

## Per-fault-type side-by-side (count → logicHttp)

Every number below is from the two provenance-verified runs above. Types are
ordered by absolute case delta.

| Fault type | N | `count` | `logicHttp` | Δ (cases) |
|---|---|---|---|---|
| HTTPResponseReplaceCode | 231 | 4.8% (11) | **68.8% (159)** | **+148** |
| HTTPRequestReplaceMethod | 190 | 27.4% (52) | **64.7% (123)** | +71 |
| HTTPRequestAbort | 60 | 11.7% (7) | **78.3% (47)** | +40 |
| HTTPRequestReplacePath | 39 | 2.6% (1) | **97.4% (38)** | +37 |
| HTTPResponseAbort | 44 | 2.3% (1) | **77.3% (34)** | +33 |
| HTTPResponseDelay | 89 | 13.5% (12) | **47.2% (42)** | +30 |
| HTTPRequestDelay | 88 | 14.8% (13) | **44.3% (39)** | +26 |
| HTTPResponsePatchBody | 4 | 50.0% (2) | **75.0% (3)** | +1 |
| NetworkDelay | 21 | 76.2% (16) | 76.2% (16) | 0 |
| JVMReturn | 21 | 57.1% (12) | 57.1% (12) | 0 |
| JVMLatency | 7 | 28.6% (2) | 28.6% (2) | 0 |
| PodKill | 10 | 10.0% (1) | 10.0% (1) | 0 |
| PodFailure | 24 | 0% (0) | 0% (0) | 0 |
| TimeSkew | 2 | 0% (0) | 0% (0) | 0 |
| JVMMySQLLatency | 2 | 0% (0) | 0% (0) | 0 |
| JVMCPUStress | 2 | 0% (0) | 0% (0) | 0 |
| DNSRandom | 1 | 0% (0) | 0% (0) | 0 |
| **ContainerKill** | 89 | 2.2% (2) | 1.1% (1) | **−1** |
| **NetworkCorrupt** | 46 | 37.0% (17) | 30.4% (14) | **−3** |
| **JVMException** | 43 | 79.1% (34) | 69.8% (30) | **−4** |
| **HTTPResponseReplaceBody** | 51 | 98.0% (50) | 88.2% (45) | **−5** |
| **NetworkLoss** | 48 | 35.4% (17) | 25.0% (12) | **−5** |
| **NetworkBandwidth** | 42 | 42.9% (18) | 28.6% (12) | **−6** |
| **NetworkPartition** | 97 | 48.5% (47) | 40.2% (39) | **−8** |
| **JVMMemoryStress** | 171 | 7.6% (13) | 2.3% (4) | **−9** |

The eight regressed types are exactly the eight whose **source is log-silent**:
`JVMMemoryStress`, `NetworkBandwidth`, `NetworkPartition`, `NetworkLoss`,
`NetworkCorrupt` (metric-observable only — gauges, drops, link errors),
`ContainerKill` (the pod is gone), `HTTPResponseReplaceBody` (the source's own
exception is `RestClientException`, which the gate admits for both roles), and
`JVMException` (a boundary case that `count` already resolves).

Note that the network column is the one that moved most between revisions: on
the pre-fan-out cache `count` scored NetworkPartition 9.3% and `logicHttp`
30.9%; on the shipped cache it is 48.5% vs 40.2%. The fan-out fix alone made
`count` strong on network faults, and `logicHttp`'s victim-flood term now costs
more there than it recovers. Reasoning from the superseded numbers would have
produced the opposite conclusion.

## Regression mechanism

The regressed types share one property: **the source is log-silent (or
metric-observable only) and the VICTIM floods framework HTTP exceptions** when
it calls the failed source.

1. **JVMMemoryStress (−9)** — the source (`ts-auth-service` etc.) is the
   max-anomaly service (`selfAnomaly≈0.98`, memory gauges rise) but emits
   **0 error lines**; victims (`ts-food-service`, `ts-delivery-service`,
   `ts-notification-service`) flood errors when the OOM'd/GC-stalled source
   times out their calls → `ResourceAccessException` /
   `HttpServerErrorException`.
2. **NetworkPartition (−8), NetworkBandwidth (−6), NetworkLoss (−5),
   NetworkCorrupt (−3)** — the link fails or degrades; the source stays silent
   while victims flood `ResourceAccessException` (connection refused / read
   timeout). `count` ignores the flood entirely, so the metric-anomalous source
   wins by default.
3. **HTTPResponseReplaceBody (−5)** — the source rewrites response bodies; its
   own exceptions arrive as `RestClientException`, which the gate admits for
   source and victim alike.
4. **JVMException (−4)** — boundary case (30 of 34 already recovered by
   `count`).
5. **ContainerKill (−1)** — the source's container dies; victims flood
   `ResourceAccessException` (`Connection refused`).

## Why `logicHttp` is still the right default (direction of the signal)

The `all`-mode regression was dominated by victims flooding **business/AMQP
text** (`Order Create Fail`, `auto-delete queue`) with no exception class.
`logicHttp` correctly excludes those, which is why it dominates the
`replace-code` / `replace-method` / `replace-path` / `delay` / `abort` classes:
231 + 190 + 39 + 44 + 60 + 89 + 88 = 741 cases where the faulting service
genuinely floods a framework HTTP error, of which `logicHttp` recovers 482
against `count`'s 97.

The 41 lost cases are the irreducible residue of the direction-symmetric
exception classes, which no log-only gate can resolve. They are a known,
bounded, measured cost — not a hidden one.

## Discriminator evidence (diagnostic run 34471223487, pre-fix cache)

The targeted diagnostic of the regressed types surfaced the exact
`{logic, exceptionClass}` signature split between source and victim:

| Emitter | `logic` | exception classes | Fault type |
|---|---|---|---|
| **source** | `≈ err` (hundreds) | `RestClientException`, `ResourceAccessException` | HTTPResponseReplaceBody |
| **source** | `= 0` | `HttpServerErrorException` (flooded 1560–3564) | HTTPResponseReplaceCode |
| **victim** | `= 0` | `HttpServerErrorException` only | JVMMemoryStress / NetworkBandwidth / JVMException |

The decisive observation: a **victim** always carries `logic = 0` and floods
**only** `HttpServerErrorException`, whereas a replace-body **source** carries
`logic ≈ err` plus `RestClientException`. The hard, symmetric case is
`HTTPResponseReplaceCode` — its source floods `HttpServerErrorException` with
`logic = 0`, *identically* to a memory/bandwidth victim. No log-only gate can
separate those two; they differ only in call-graph direction.

## Next steps

1. **(lever #2, open) joint log × topology signal** — reward a framework HTTP
   exception only when the emitter is an edge SOURCE in the call graph (its
   callee is also anomalous) or when the emitter's own metric also rises. This
   is the signal that separates "source's downstream call failed" from
   "victim's upstream source failed", and it is the only route to recovering
   the 41 cases without giving back the 386. `logicHttpJoint` attempted this and
   was falsified — see `docs/fse26-logicHttpJoint-falsified.md` — but the
   falsified variant gated on *rank-normalised anomaly scores*, which is not a
   monotone-invariant comparison. The call-graph-direction half of the idea is
   still untested.
2. **(lever #3, IMPLEMENTED BUT UNMEASURED)** latency/saturation series. A
   first revision of this document asked for a "re-convert" to consume the
   dropped trace `duration` + histogram series. **That conversion already
   happened** in `b811812` — an ancestor check places it *after* the 46.5%
   measurement head (`a3cb249`), and the shipped shards carry the series:
   `jvm.gc.duration.max` in 81/1422 cases, `http.server.request.duration.max`
   in 83, `http.client.request.duration.max` in 39,
   `hubble_http_request_duration_seconds.max` in 126,
   `jvm.memory.used_after_last_gc` in 123. What is missing is not the data but
   the **measurement**: no run has isolated the contribution of these series,
   because `logicHttp` reaches Top@1 47.3% through a log-only term that
   dominates them. The correct experiment is a component ablation —
   `--drop-metrics` with the duration/histogram names removed — to see whether
   they add anything on top of the log term, not another conversion.
3. **(closed) `logicHttp` as default.** Flipped. The residual regression the
   first revision measured as 15 cases is 41 cases on the shipped cache, and the
   +386 gain still dominates it roughly 9×. `benchmarks/src/run-fse26.ts` and
   `.github/workflows/fse26-benchmark.yml` now take the mode from a single
   source of truth (the runner default), guarded by
   `packages/kinetic/__tests__/unit/fse26-reported-config.test.ts`.
