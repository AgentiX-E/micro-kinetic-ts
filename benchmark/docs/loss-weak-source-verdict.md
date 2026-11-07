# Network-loss ("loss") weak-source verdict — deterministic crack is not viable

## Motivation

The routing-probe readback (run `34330734670`, 615 cases) showed `loss` is the
single largest bothWrong contributor (34/77) and the worst union rate among the
big fault types (66.7%; engine 55.9% / PRISM 52.0%, both near chance). This
investigation asks whether that 66.7% union ceiling is a *signal-shape* limit or
a *deterministic-algorithm* limit — i.e. whether a new deterministic signal can
break it.

## Method

`scripts/dump-loss-metrics.ts` (commit `ea48149`, run `34334434219`) reproduced
the engine's own guard sequence + baseline breakdown for every `loss` case
across RE1/RE2 (120 cases), then reported the ground-truth (GT) source's
dominant-metric direction, deviation, and global rank among all
`(service × metric)` pairs. Results were joined with the routing-probe per-case
records (engine/prism top-1, top-2, finalScore) for 102 cases.

## Findings

1. **The signature is real, not silent.** GT source is `active=120 (100%)`,
   `silent=0`. The dominant GT metric is a **latency rise** in 92/120 cases
   (`latency-90` 68, `latency-50` 24), plus `workload` drop (18), `diskio`
   (6), `cpu` (2), `socket` (2). This is the physical signature of packet loss:
   TCP retransmission lifts the source's latency, and the loss propagates.

2. **But the source is usually NOT the strongest anomaly.** Only `top1 = 59/120`
   (49%) of GT sources rank #1 by deviation. The other half rank #2–#42 — a
   downstream victim's latency rises *more* than the source's, because the
   victim's inbound requests stall behind the source's dropped/retransmitted
   packets.

3. **Failure is dominated by weak-source cases.** Of the 34 bothWrong cases,
   **31 (91%) have GT rank ≥ 2**; only 3 are rank-1 "strong signal" cases.
   Engine performance splits cleanly on this axis:
   - GT rank 1: engine correct 43/52 (82.7%) — the strong-signal cases mostly work.
   - GT rank > 1: engine correct 14/50 (28%) — the weak-source cases mostly fail.

4. **The weak-source cases are structurally irreducible from the data.** The
   source's own latency rises only slightly (e.g. `checkoutservice` latency-90
   dev 0.349, ~1.2×) while a victim's rises ~27× (`emailservice` dev 1.430).
   RCAEval metrics are service-granular: a `latency-90` series does not
   decompose inbound vs outbound, so "the service that is dropping packets" and
   "the service waiting behind those packets" are observationally identical —
   both look like a latency rise, and the victim's is always larger.

## Why this is a deterministic dead end

- The engine and PRISM both assume "strongest anomaly = source". Loss violates
  that assumption by construction.
- The propagation-direction escape hatches are already falsified in this repo:
  `temporalWeight` ("earliest = source", bench #207/#208) and reverse
  propagation (callee→caller, `docs/reverse-propagation-falsified.md`) both fail
  because the victim's onset can precede the source's observable onset.
- The fan-in/out topology prior is direction-ambiguous
  (`docs/re3-fault-ceiling.md`).

## Verdict

The loss union ceiling of **66.7%** (34 bothWrong) is a *deterministic-algorithm
limit*, not a signal-shape limit: the information needed to separate a
packet-loss source from its latency-amplified victims (inbound/outbound
decomposition, or per-connection retransmit counters) is not present in the
RCAEval metric schema. Combined with the RE3 silent-source ceiling
(`docs/silent-source-ceiling.md`), the deterministic frontier is ≈82% overall
(the blended `prismWeight=1` fusion already reaches 81.3% with 5-cell
regression). Further gains require per-case discrimination that deterministic
signals do not carry — i.e. a gated LLM judge, or cross-benchmark validation to
confirm the frontier is not single-annotator overfit.
