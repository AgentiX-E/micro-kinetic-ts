# FSE'26 log signal — `logicHttp` mode ablation verdict

> Status: **decisive, net-positive with residual regression** (run 34468582559,
> full 1422 cases, `log_mode=logicHttp`, head `a3cb249`, clean:
> loadErrors=0 engineErrors=0 emptyGraphs=0).

## Conclusion (TL;DR)

Counting **logic exceptions PLUS framework HTTP exceptions** (`logicHttp` mode)
lifts the engine **+30.0 pp Top@1** (16.5% → 46.5%), from −4.5 pp below the SOTA
average to **+25.5 pp above it** and **+9.5 pp above the best published model**
(37%). It fixes the `all`-mode regression (35 → 15 cases) by excluding the
business/AMQP text victims flood, but it is still **not zero-regression**: 5
fault types / 15 cases regress.

The residual regression has a precise, information-theoretic cause: the
framework HTTP exceptions `HttpServerErrorException` (caller received a 5xx)
and `ResourceAccessException` (caller's connection failed/timed out) are
**direction-symmetric** — a service floods them whether it is the SOURCE (its
own downstream call failed, as in the HTTP fault types) or a VICTIM (its
upstream source failed, as in the memory/container/bandwidth fault types).
Pure log text cannot tell the two apart; disambiguating them needs the call
graph + metric direction, i.e. a joint signal, not a log-only gate.

## Result

| mode | Top@1 | Top@3 | Top@5 | Δ vs SOTA avg | Δ vs SOTA best |
|---|---|---|---|---|---|
| `count` (baseline) | 16.5% | 26.3% | 34.7% | −4.5 pp | −20.5 pp |
| `all` (ablated) | 34.8% | 45.4% | 53.8% | +13.8 pp | −2.2 pp |
| **`logicHttp`** | **46.5%** | **56.9%** | **61.2%** | **+25.5 pp** | **+9.5 pp** |

Correct cases: 235 (`count`) → 495 (`all`) → **661** (`logicHttp`).
SOTA anchor: avg 21% / best 37%. Net case delta vs `count`: **+441 gain /
−15 regress = +426**.

## Per-fault-type side-by-side (count → logicHttp)

| Fault type | N | `count` | `logicHttp` | Δ (cases) |
|---|---|---|---|---|
| HTTPResponseReplaceCode | 231 | 4.8% (11) | **69.7% (161)** | **+64.9** (+150) |
| HTTPRequestReplaceMethod | 190 | 25.8% (49) | **65.3% (124)** | +39.5 (+75) |
| HTTPRequestReplacePath | 39 | 10.3% (4) | **94.9% (37)** | +84.6 (+33) |
| HTTPResponseAbort | 44 | 6.8% (3) | **81.8% (36)** | +75.0 (+33) |
| HTTPRequestAbort | 60 | 15.0% (9) | **78.3% (47)** | +63.3 (+38) |
| HTTPResponseDelay | 89 | 3.4% (3) | **51.7% (46)** | +48.3 (+43) |
| HTTPRequestDelay | 88 | 3.4% (3) | **48.9% (43)** | +45.5 (+40) |
| NetworkPartition | 97 | 9.3% (9) | 30.9% (30) | +21.6 (+21) |
| NetworkCorrupt | 46 | 10.9% (5) | 23.9% (11) | +13.0 (+6) |
| NetworkLoss | 48 | 16.7% (8) | 18.8% (9) | +2.1 (+1) |
| HTTPResponsePatchBody | 4 | 25.0% (1) | 50.0% (2) | +25.0 (+1) |
| JVMReturn | 21 | 52.4% (11) | 52.4% (11) | 0 |
| JVMLatency | 7 | 28.6% (2) | 28.6% (2) | 0 |
| JVMCPUStress | 2 | 50.0% (1) | 50.0% (1) | 0 |
| PodFailure | 24 | 8.3% (2) | 8.3% (2) | 0 |
| PodKill | 10 | 10.0% (1) | 10.0% (1) | 0 |
| NetworkDelay | 21 | 38.1% (8) | 38.1% (8) | 0 |
| TimeSkew | 2 | 0% (0) | 0% (0) | 0 |
| JVMMySQLLatency | 2 | 0% (0) | 0% (0) | 0 |
| DNSRandom | 1 | 0% (0) | 0% (0) | 0 |
| **HTTPResponseReplaceBody** | 51 | 98.0% (50) | 94.1% (48) | **−3.9** (−2) |
| **JVMException** | 43 | 76.7% (33) | 74.4% (32) | **−2.3** (−1) |
| **ContainerKill** | 89 | 6.7% (6) | 3.4% (3) | **−3.4** (−3) |
| **JVMMemoryStress** | 171 | 7.0% (12) | 3.5% (6) | **−3.5** (−6) |
| **NetworkBandwidth** | 42 | 9.5% (4) | 2.4% (1) | **−7.1** (−3) |

## Regression mechanism (5 types / 15 cases)

The regressed types share one property: **the source is log-silent (or
metric-observable only) and the VICTIM floods framework HTTP exceptions** when
it calls the failed source.

1. **JVMMemoryStress (−6)** — source (`ts-auth-service` etc.) is the
   max-anomaly service (`selfAnomaly≈0.98`, memory gauges rise) but emits
   **0 error lines**; victims (`ts-food-service` err=126, `ts-delivery-service`
   err=48, `ts-notification-service` err=47) flood errors when the OOM'd/GC-stalled
   source times out their calls → `ResourceAccessException`/`HttpServerErrorException`.
2. **ContainerKill (−3)** — source's container dies; victims flood
   `ResourceAccessException` (`Connection refused`).
3. **NetworkBandwidth (−3)** — source's link is throttled; victims flood
   `ResourceAccessException` (read timeout).
4. **HTTPResponseReplaceBody (−2)** — source rewrites response bodies; a
   downstream victim emits an HTTP exception on the malformed body.
5. **JVMException (−1)** — boundary case (32/33 already recovered by `count`).

## Why `logicHttp` is still the right lever (direction of the signal)

The `all`-mode regression was dominated by victims flooding **business/AMQP
text** (`Order Create Fail`, `auto-delete queue`) with no exception class —
`logicHttp` correctly excludes those, cutting the regression 35 → 15 while
raising the gain +18.3 → +30.0 pp. The remaining 15 cases are the irreducible
residue of the **direction-symmetric** HTTP exceptions above, which no log-only
gate can resolve.

## Discriminator evidence (diagnostic run 34471223487)

The targeted diagnostic of the 5 regressed types surfaced the exact
`{logic, exceptionClass}` signature split between source and victim:

| Emitter | `logic` | exception classes | Fault type |
|---|---|---|---|
| **source** | `≈ err` (hundreds) | `RestClientException`, `ResourceAccessException` | HTTPResponseReplaceBody |
| **source** | `= 0` | `HttpServerErrorException` (flooded 1560–3564) | HTTPResponseReplaceCode |
| **victim** | `= 0` | `HttpServerErrorException` only | JVMMemoryStress / NetworkBandwidth / JVMException |

The decisive observation: a **victim** always carries `logic = 0` and floods
**only** `HttpServerErrorException` (it received a 5xx from the failed source),
whereas a replace-body **source** carries `logic ≈ err` (it throws its own
logic exceptions on the malformed body) plus `RestClientException`. The
hard, symmetric case is `HTTPResponseReplaceCode` — its source floods
`HttpServerErrorException` with `logic = 0`, *identically* to a memory/bandwidth
victim. No log-only gate can separate those two; they differ only in call-graph
direction (whose callee is anomalous), which is exactly lever #2.

## Next steps

1. **(P1c lever #2) joint log × topology signal** — reward a framework HTTP
   exception only when the emitter is an edge SOURCE in the call graph (its
   callee is also anomalous) or when the emitter's own metric also rises; this
   is the signal that separates "source's downstream call failed" from
   "victim's upstream source failed". TDD + per-signal ablation, zero-regression
   before default.
2. **(P1c lever #3) latency/saturation series re-convert** — consume the dropped
   trace `duration` + `_metrics_histogram` (GC/saturation) so the silent source
   of JVMMemoryStress/ContainerKill/NetworkBandwidth becomes observable instead
   of relying on victim logs.
3. Decision on `logicHttp` as default: the +30.0 pp gain is overwhelming
   (+426 net cases) but the 15-case regression violates the zero-regression bar;
   keep `count` as default until lever #2/#3 recover those 15 cases, OR flip
   `logicHttp` default with the regression explicitly documented.
