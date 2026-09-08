# Direction 2 (callee→caller reverse propagation) — falsified before code

**Status:** empirical conclusion. The last untested architecture lever — a
topology-direction-aware "fault propagates callee → caller" source signal — is
falsified by the SockShop RE3 metric dump (`artifacts/dump-ss`), read offline
against the golden baseline (`3044b29`, bit-identical). No code was written; the
55-minute benchmark cycle was not spent, because the dump already answers the
"chicken-and-egg" question the PoC was designed to resolve.

## The question the PoC had to answer

`topoSource(v) = 1 − maxParentExplanation(v)` and `ratioContrib(v)` are both
directional: they assume fault energy flows caller → callee, so a source is a
node whose anomaly is NOT explained by an upstream parent. Both are documented
to reverse on fan-in callee sources (`docs/re3-fault-ceiling.md`). Direction 2
was the mirror hypothesis: **the fault actually flows callee → caller, so a
source is a node whose anomaly is NOT explained by a downstream callee.**

If that single direction held, a "reverse topoSource" (`1 − maxChildExplanation`)
would be the missing correct signal. The dump was read to test exactly this.

## The data: victims are omnidirectional

For every failing SS RE3 case (`gt=carts` / `gt=orders`), the metrics that rank
ABOVE the ground-truth source fall into three topological positions — none of
which is a single consistent direction:

| victim metric | dev | head→tail | topology relation to `carts`/`orders` |
|---|---|---|---|
| `front-end::error` | 1.47–1.76 | 5.8–9.8 → 0.13–2.5 (drop) | **upstream caller** (front-end calls carts/orders) |
| `rabbitmq-exporter::cpu` | 0.55–1.52 | 0.0001 → 0.0005 | **sibling / sidecar** (orders→rabbitmq, not carts→rabbitmq) |
| `orders-db::diskio` | 0.30–0.74 | 0 → 4.9M | **downstream of a sibling** (orders-db, not carts-db) |
| `carts-db::diskio` | 0.30–0.35 | 0 → 6.2M | **downstream callee** (carts-db is carts's datastore) |
| `payment::workload` | 0.29–0.80 | 0.067 → 2.33 | **sibling** (front-end calls payment, not carts) |
| `shipping::workload` | 0.29–0.48 | 0.067 → 1.87 | **sibling** |
| `queue-master::latency-50` | 0.64 | 0.015 → 0.003 | **sibling / MQ** |

Three facts kill the single-direction hypothesis:

1. **Upstream, downstream, and sibling victims all appear in the SAME case.**
   `carts_f1_1` is outranked by `front-end::error` (upstream) *and*
   `rabbitmq-exporter::cpu` (not on carts's path at all). There is no
   direction `d` such that "source = node unexplained from direction `d`" is
   simultaneously correct for `front-end`, `rabbitmq-exporter`, and `carts`.

2. **Most victims are NOT on the source's propagation path.** `rabbitmq-exporter`,
   `orders-db`, `payment`, `shipping`, and `queue-master` are siblings or
   sidecars — their anomalies are NOT caused by `carts`'s fault. They are
   near-zero-baseline metric spikes that happen to outrank the source. A
   propagation signal (forward OR reverse) can only ever reason about the
   source's neighbours; it is blind to off-path noise, which is exactly what
   wins the deviation race here.

3. **The one genuine propagation victim (`front-end::error`) is upstream**,
   consistent with callee→caller flow — but it is the ONLY such case. The
   downstream `carts-db`/`orders-db`/`queue-master` victims point the other way.
   The direction is not callee→caller; it is "everywhere".

## Why this is the final word (not a missing implementation detail)

A reverse-topoSource signal `1 − maxChildExplanation(v)` would reward a node
whose CALLEES are not anomalous and penalise one whose callees are. On `carts`
the callee `carts-db` IS anomalous (diskio 0→6.2M), so the mirror signal
discounts `carts` exactly as `topoSource` discounts it via `front-end` — the
bidirectional source is "explained" by neighbours in BOTH directions. The
chicken-and-egg problem has no static-graph resolution because **a source's
neighbours are always anomalous** (they are the propagation symptoms), so any
"explained by a neighbour" test discounts the source regardless of direction.

The only remaining discrimination is the METRIC SHAPE of the winner, not the
topology:

- The GT source (`carts::cpu`/`orders::cpu` f4) is `isCrash=true` — a genuine
  drop-to-near-zero, `dev` hard-capped at `log10(2) ≈ 0.301`.
- The ranking winner (production readback `34227145755`) is
  `front-end::error` (`base ≈ 0.17`, `dev ≈ 1.6–1.76`, an upstream-caller
  error DROP) plus `*-db::diskio` (million-scale baseline RISE). The
  near-zero-baseline rise (`rabbitmq-exporter::cpu`, `head ≈ 0.0001`) wins the
  RAW deviation race but is demoted below top-1 by rank normalization +
  trace/topo fusion — it never appears first (see
  `docs/near-zero-rise-suppression-falsified.md`).

The raw-deviation vs. ranking distinction matters: the drop/rise asymmetry of
`docs/re3-fault-ceiling.md` leaks in the RAW view (near-zero rise `dev ≈ 1.5`
vs. capped crash drop `0.301`), but the PRODUCTION top1 that actually outranks
GT is `front-end::error` at `base ≈ 0.17` — not a near-zero baseline.

## Conclusion

Direction 2 is falsified **before any code**: the fault does not propagate in a
single topology direction, so no directional source signal can be correct. The
`docs/re3-fault-ceiling.md` lever (b) "topology-direction-aware propagation" is
now closed with evidence, alongside (a) domain knowledge and the multi-modal
LLM levers. The metric-agnostic deterministic ceiling stands at **~77.4%
Top-1**; the remaining ~11 points are off-path near-zero-baseline metric noise
that only baseline/label-aware (domain) reasoning — or a multi-modal model —
can separate from a genuine crash drop.
