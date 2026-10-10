# FSE'26 error-flood log signal — `all` mode ablation verdict

> Status: **decisive** (run 34450240928, full 1422 cases, `log_mode=all`,
> head `ddd8160`, clean: loadErrors=0 engineErrors=0 emptyGraphs=0).

## Conclusion (TL;DR)

Counting every ERROR/FATAL line (`all` mode) instead of only self-caused logic
exceptions (`count` mode) lifts the engine **+18.3 pp Top@1** (16.5% → 34.8%),
from −4.5 pp below the SOTA average to **+13.8 pp above it** and within 2.2 pp
of the best published model (37%). But it is **not zero-regression**: 10 fault
types / 35 cases regress. The mechanism is now understood precisely, and a
narrower signal is the right fix — not the blunt `all` mode.

## Result

| | Top@1 | Top@3 | Top@5 | Δ vs SOTA avg |
|---|---|---|---|---|
| `count` (baseline) | 16.5% | 26.3% | 34.7% | −4.5 pp |
| `all` (ablation) | **34.8%** | **45.4%** | **53.8%** | **+13.8 pp** |

Correct cases: 235 → 495 (**+260**). SOTA anchor: avg 21% / best 37%.

## Per-fault-type side-by-side

| Fault type | N | `count` | `all` | Δ |
|---|---|---|---|---|
| HTTPResponseReplaceCode | 231 | 4.8% (11) | **57.1% (132)** | **+52.3** |
| HTTPRequestReplaceMethod | 190 | 25.8% (49) | **50.5% (96)** | +24.7 |
| JVMMemoryStress | 171 | 7.0% (12) | 5.3% (9) | −1.7 |
| NetworkPartition | 97 | 9.3% (9) | **28.9% (28)** | +19.6 |
| ContainerKill | 89 | 6.7% (6) | 6.7% (6) | 0 |
| HTTPResponseDelay | 89 | 3.4% (3) | 1.1% (1) | −2.3 |
| HTTPRequestDelay | 88 | 3.4% (3) | 0.0% (0) | −3.4 |
| HTTPRequestAbort | 60 | 15.0% (9) | **70.0% (42)** | +55.0 |
| HTTPResponseReplaceBody | 51 | 98.0% (50) | 84.3% (43) | −13.7 |
| NetworkLoss | 48 | 16.7% (8) | 25.0% (12) | +8.3 |
| NetworkCorrupt | 46 | 10.9% (5) | 10.9% (5) | 0 |
| HTTPResponseAbort | 44 | 6.8% (3) | **70.5% (31)** | +63.7 |
| JVMException | 43 | 76.7% (33) | 62.8% (27) | −13.9 |
| NetworkBandwidth | 42 | 9.5% (4) | **40.5% (17)** | +31.0 |
| HTTPRequestReplacePath | 39 | 10.3% (4) | **84.6% (33)** | +74.3 |
| PodFailure | 24 | 8.3% (2) | 0.0% (0) | −8.3 |
| NetworkDelay | 21 | 38.1% (8) | 0.0% (0) | −38.1 |
| JVMReturn | 21 | 52.4% (11) | 52.4% (11) | 0 |
| PodKill | 10 | 10.0% (1) | 0.0% (0) | −10.0 |
| JVMLatency | 7 | 28.6% (2) | 0.0% (0) | −28.6 |
| HTTPResponsePatchBody | 4 | 25.0% (1) | 50.0% (2) | +25.0 |
| TimeSkew | 2 | 0.0% | 0.0% | 0 |
| JVMMySQLLatency | 2 | 0.0% | 0.0% | 0 |
| JVMCPUStress | 2 | 50.0% (1) | 0.0% (0) | −50.0 |
| DNSRandom | 1 | 0.0% | 0.0% | 0 |

Net: **+295 gained** (9 fault types) vs **−35 regressed** (10 fault types) = **+260**.

## Why `all` wins (the gain)

`count` gates on `isLogicException` — the RCAEval-tuned regex of self-caused
programming errors (`NullPointerException`, `IllegalArgumentException`, …).
FSE'26 HTTP fault injection makes the SOURCE flood a **framework HTTP
exception**, not a programming error:

```
Servlet.service() for servlet [dispatcherServlet] in context with path [] threw
exception [Request processing failed; nested exception is org.springframework.web
.client.HttpServerErrorException: 500 …]
```

That exception is NOT in `LOGIC_EXCEPTION_PATTERN`, so `count` scores the source
`logScore = 0.000`. `all` counts it, and the source is the max-error service
(ReplaceCode: 1560 vs 147/97/63/48) → correctly ranked #1.

## Why `all` regresses (the cost)

`all` also counts the **victims'** floods, which are NOT framework exceptions
but business/AMQP errors:

- `[create][Order Create Fail][Order already exists]…` (order/preserve)
- `[getAllFood]… Get the Get Food Request Failed!` (food)
- `Failed to check/redeclare auto-delete queue(s).` (notification/delivery)

In the fault types where the source is silent or low-error, these victim floods
outrank the source: delay (source `err=1–4`, victims `err=44–48`), memory
(source `err=0`, victims `err=42–126`), pod (source has no logs). NetworkDelay
(38.1% → 0%) is the worst: the source is the network itself, victims flood
timeouts.

## The discriminator (the fix)

Across all 12 diagnostic dumps, the source's error signature is **always** the
`Servlet.service() … nested exception is org.springframework.web.client.*`
framework exception, and the victims' signatures are **always** business/AMQP
messages with no exception class:

| Fault type | source err (framework HTTP) | victim err (business/AMQP) |
|---|---|---|
| ReplaceCode ×3 | 1560 / 2860 / 3564 | 147 / 97 / 63 / 48 |
| RequestDelay ×2 | 1 / 3 | 44–48 |
| ResponseDelay ×2 | 4 / 3 | 13–48 |
| JVMMemoryStress ×3 | **0** | 42–126 |

So the correct signal counts **logic exceptions + framework HTTP exceptions**
(`Servlet.service()` / `org.springframework.web.client.*`), NOT business/AMQP
messages and NOT connectivity/timeout. This should:

1. Keep the ReplaceCode/Method/Abort/Path gain (source floods framework HTTP).
2. **Fix** the delay types — the source is the *only* service emitting the
   framework exception (err 1–4), so it is no longer a pure data gap.
3. Stay **neutral** on memory/pod (source `err=0`, victims emit no framework
   exception) — no regression.

## Status

- `all` mode is **not** flipped to default: it violates the zero-regression
  bar (10 fault types / 35 cases).
- Next: verify the exact exception class, implement the framework-HTTP mode,
  ablate for net-positive + zero regression.
