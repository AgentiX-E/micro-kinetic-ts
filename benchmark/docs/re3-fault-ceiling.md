# RE3 "error-value" Fault Ceiling — Drop/Rise Asymmetry & Collision Direction

**Status:** empirical conclusion. The remaining RE3 error-value failures (SS F4 0%,
SS F1 60%, OB F1 33%, TT F3 40%) share ONE structural cause that pure data-driven
ranking cannot cross. This document records *why*, so no future iteration re-treads
the falsified levers.

## The one structural cause

Every remaining RE3 error-value failure is a **drop-shaped source** (cpu/error/socket
collapse, e.g. carts cpu 29.9 → 2.5, orders error 2.3 → 0) out-ranked by a
**rise-shaped symptom** (near-zero-baseline cpu/latency spike, e.g. rabbitmq cpu
0.0001 → 0.001 = 32×). This is a *mathematical* asymmetry, not a bug:

- A relative **drop** is bounded: a metric can at most fall to zero, so
  `dropRatio ≤ 1.0` and `deviation = log10(1 + dropRatio) ≤ log10(2) ≈ 0.301`.
- A relative **rise** over a near-zero baseline is **unbounded**: `riseRatio → 32×`,
  `deviation = log10(1 + 32) ≈ 1.52`.

So a crash source's deviation is *hard-capped at ~0.30*, while a symptom's
near-zero spike reaches ~1.5. A 5× gap no monotonic transform of the self-anomaly
score can bridge. Symmetrising the drop (measuring it against the post-drop minimum,
so a "28× drop" matches a "28× rise") was tried and re-exploded drop-noise
(`#193` OB RE3: paymentservice 2.19 > adservice 1.84). The log10 compression is
therefore deliberate and correct.

## Collision / ratioContrib is directionally WRONG on fan-in sources

`ratioContrib(v) = collisionGain / (local + collisionGain)` assumes "energy
inherited from upstream = symptom". This holds only when the source is a **root**
(no incoming edges → `ratioContrib = 0`). When the source is a **fan-in callee**
(carts, orders — many callers), the crash source inherits energy from its callers
and gets a HIGH `ratioContrib`, while the true symptom gets a LOW one.

SS RE3 readback (run `34133061247`) — `GT` vs `top1` ratioContrib, all failures:

| case | GT ratioContrib | top1 ratioContrib | direction |
|------|-----------------|-------------------|-----------|
| carts_f1_1 | 0.559 | 0.228 | **reversed** |
| carts_f1_2 | 0.546 | 0.304 | **reversed** |
| carts_f1_3 | 0.592 | 0.190 | **reversed** |
| carts_f1_4 | 0.457 | 0.274 | **reversed** |
| front-end_f1_1 | 0.000 | 0.380 | correct |
| carts_f4_1 | 0.514 | 0.057 | **reversed** |
| carts_f4_2 | 0.498 | 0.232 | **reversed** |
| carts_f4_3 | 0.581 | 0.059 | **reversed** |
| carts_f4_4 | 0.357 | 0.142 | **reversed** |
| orders_f4_1 | 0.267 | 0.000 | **reversed** |

9 of 10 failures are reversed. `collisionWeight > 0` would penalise the crash
source (high ratioContrib) and reward the symptom — a guaranteed net regression
on SS RE3. The same signal also needs an inordinate `collisionWeight ≥ 2.6` to
flip the tt-route-service cases (`silent-source-ceiling.md`), which regresses the
other suites.

**Conclusion:** `collisionWeight` / `ratioContrib` is falsified. It is NOT the
"one remaining correct signal" — its direction is topology-dependent and inverted
for fan-in sources, which is exactly the source shape of the failing cells.
Do not enable it by default; do not re-run its ablation.

## Why rank-normalization does not help SS

`rankNormalizeScores` is monotonic and only rescales the anomaly vector; it helps
only when a downstream causal signal (trace) can exploit the compressed gap. It is
also gated to `≥ 20`-node graphs (`topology-fault-graph.ts`), so SockShop (12–14
nodes) never gets it. But even if extended, the SS sources have NO causal signal to
exploit: `topoSource` is reversed (fan-in source "explained" by its callers),
`traceActivity` ratio < 1, `log` silent. Rank is a no-op without a signal to flip.

## Root cause summary (all five signals)

| signal | SS RE3 F4/F1 source | verdict |
|--------|---------------------|---------|
| self-anomaly | drop dev ≤ 0.30 | symptom spike dev ~1.5 wins ❌ |
| log | silent (no exception) | silent |
| trace | ratio < 1 (span drops) | silent |
| topo | fan-in source "explained" by callers | reversed ❌ |
| collision/ratioContrib | fan-in source inherits energy | reversed ❌ |

## Conclusion

SS RE3 F4/F1 (and TT RE3 F3) are the **structural ceiling of pure data-driven,
metric-agnostic ranking**. The only levers left are (a) domain knowledge
("cpu/error drop-to-low = crash source"), which carries the same risk as the
label-semantics falsification (`isEventMetricLabel`, `9ea8166` → `2b34c8b`), or
(b) topology-direction-aware propagation (fault can flow callee → caller), a large
refactor. Both are outside the current framework and require a deliberate
architecture decision, not a signal tweak.
