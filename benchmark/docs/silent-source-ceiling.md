# Silent-Source Fault Ceiling

## Why `ts-route-service` RE3 "error-value" cases are structurally unreachable by pure data-driven ranking

**Status:** empirical conclusion, do NOT re-attack the falsified directions.

The TrainTicket RE3 "error-value" target has been lifted from an original
baseline of **3.6% → 51.1%** (per-fault F3 **0% → 40%**, F1/F2 57.1%, F4 50%,
via rank-normalization + trace-activity). The remaining 5 failing cases are all
`ts-route-service` f3_1…f3_5. This document records *why* they are the
structural ceiling of the current pure data-driven approach, so future work does
not re-tread ground that has already been empirically falsified.

## The 5 cases at a glance

| case | GT signature | victim (top1) signature |
|------|--------------|-------------------------|
| f3_1…f3_5 | `ts-route-service` socket drop 23→9…19→12 (dev 0.32~0.39) | `ts-food-service`/`ts-order-*` latency/cpu near-zero-baseline spike (dev 1.13~1.63) |

## Seven causal priors, each falsified or insufficient

Every ranking signal is either silent, reversed, or under-powered against the
GT socket-drop source:

| # | signal | GT (socket drop) | victim (latency spike) | verdict |
|---|--------|------------------|------------------------|---------|
| 1 | self-anomaly | dev 0.32~0.39 | dev 1.13~1.63 | victim wins ❌ |
| 2 | log | no logic exception (silent source) → 0 | — | silent |
| 3 | trace | ratio 0.82~0.95 (span **drops**, never rises) | — | silent (gate stays neutral) |
| 4 | topo | 0.21~0.30 (anomalous parent "explains" it) | 0.13~1.0 | reversed ❌ |
| 5 | temporal | injectDelay 83000~91000ms (source **later**) | 0~69000ms (earlier) | reversed ❌ |
| 6 | rise/collapse | socket drop = collapse, punished as silent symptom | — | reversed ❌ |
| 7 | collision/ratioContrib | 0 (source) | 0.11~0.28 (symptom) | **only correct direction** ⚠️ |

The production config enables only **log + trace**. Both are silent on these 5
cases, so the ranking degenerates to pure self-anomaly and the victim's
near-zero-baseline latency spike wins.

## Temporal-priority is already falsified — not an untried path

`temporalWeight` ("earliest onset = source") was benchmarked in #207/#208 at
weight 0.5 and measured a **net regression ≈ −2.5pp** (OnlineBoutique RE1 −12.0,
RE3 −13.3). The injection-anchored onset systematically anchors to the source's
slow-responding dominant metric (latency/socket drop crosses the 30% deviation
threshold LATE), while the symptom's fast metric (cpu/workload spike) crosses
EARLY. On the 5 `ts-route-service` cases the ground-truth onset is *reversed*:
`injectDelay GT = 83000~91000ms`, the top1 victim fires at `0~69000ms`. Do not
retry.

## The only correct signal is under-powered

`ratioContrib(v) = collisionGain / (local + collisionGain)` — source ≈ 0,
symptom → 1 — is the one signal pointing in the right direction
(GT = 0 vs top1 = 0.11~0.28). But flipping each case requires an inordinate
`collisionWeight`, and two cases have no discrimination at all:

| case | top1 lead (log gap) | ratioContrib | weight needed to flip |
|------|---------------------|--------------|----------------------|
| f3_1 | 0.467 | 0.110 | 4.2 |
| f3_2 | 0.771 | 0.211 | 3.7 |
| f3_3 | 0.506 | **0.000** | ∞ (no discrimination) |
| f3_4 | 0.443 | **0.000** | ∞ (no discrimination) |
| f3_5 | 0.739 | 0.284 | 2.6 |

A `collisionWeight ≥ 2.6` would regress the other suites; and f3_3/f3_4 are
unreachable regardless.

## Root cause

The socket drop (23→9) is a **slow, bounded collapse**: its drop deviation is
capped by `log10(1 + dropRatio)` ≈ `log10(1 + 0.61) = 0.207`, while a
near-zero-baseline latency spike inflates to a 19~466× rise that clamps to 1.0.
No monotonic transform of the self-anomaly score can bridge that gap, and no
causal prior points at the source.

## Conclusion

These 5 cases are the **structural ceiling of pure data-driven RCA**. The only
remaining lever is domain knowledge ("socket-connection drop = resource-layer
fault source"), which is a large refactor *outside* the pure data-driven
framework and carries the same risk as the label-semantics falsification
(`isEventMetricLabel`, `9ea8166` → reverted `2b34c8b`), which suppressed the
cpu/disk fault source's own spike (OB RE3 f1 11% → 0%).

**Recommendation:** freeze this target at F3 40%; redirect effort to the next
highest-value cell (SockShop RE3 45.0% — F4 0%, F3 20%).
