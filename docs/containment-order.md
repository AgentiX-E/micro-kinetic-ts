# The containment order — a caller may not outrank a callee that moved more

**Status:** implemented, measured, shipped OFF (ablation-exact). Promotion to ON is gated on one wiring change,
named in §7 and blocked by a deliberate census rule.

**Registration:** `docs/closed-axes-register.md` §287.

## 1. The mechanism

A caller's response time **contains** its callee's. On any fault that propagates along the call graph, the
upstream service's latency deviation is at least as large as the downstream one's — not because it is the source,
but because it is waiting. Iteration 286 measured what that costs on the FSE'26 corpus:

- of 1 422 cases, 176 have their truth inside the presented five but not first (12.4 %);
- **111 of those put the truth at rank 2** — one step, 7.8 points of the corpus;
- **100 of the 111 have the rank-1 candidate as the truth's CALLER**, against **0** callees;
- on those 100 the truth's `http.server.request.duration` departure is 5–20× the winner's, and the winner leads on
  `http.response.error_rate` (31 against 6) — the victim's signature.

The engine already has three levers aimed at this mechanism (`topoDiscount`, `selfTimeWeight`, `victimWeight`).
Iteration 286 measured four self-time weights and seven topological-gate settings: **the ranking was
byte-identical**, because the terms that could speak read an input map that is empty on a 41-service graph.

## 2. Why no weight can express it

Every term in the fusion scores **one candidate at a time**. The statement that has to be made is *relational*:

> this pair is inverted, because the lower one's own latency left the band it occupied when nothing was wrong and
> the upper one's did not.

A relational statement has no additive form. It is not a coefficient, it is a constraint on the order, and that is
what `pruning/containment-order.ts` implements: one pass over adjacent positions, inverting a pair when the higher
candidate calls the lower one and the lower one's excursion is strictly larger.

## 3. The signal: an excursion against a fault-free band

```
band(v, label) = [centre − σ·scale, centre + σ·scale]        (the corpus profile, σ = 3)
excursion(v)   = max over latency labels of (0 if post ∈ band else distance / band width)
```

The band is the corpus artifact the engine already builds (`build-fault-free-profile`). It is what makes the test
**precise** rather than merely comparative, and the difference is measured:

| rule | swaps | gains | losses | net |
| --- | ---: | ---: | ---: | ---: |
| `ratio(callee) > ratio(caller)` (no band) | 24 | 24 | 0 | +24 |
| `excursion(callee) > excursion(caller)` (σ = 3 band) | 41 | 41 | 0 | **+41** |

Latency labels are the two instruments the corpus carries: `http.server.request.duration` (present on **21 %** of
candidates) and the Hubble family `hubble_http_request_duration_{p50,p90,p95,p99,max}`. The excursion reads the
**maximum** over the family, which is why the rule is not silent on four cases in five.

## 4. The measurement, on the shipped corpus

One pass over the top five, on all 1 422 cases:

| | cases | Top@1 |
| --- | ---: | ---: |
| shipped | 1 073 | **75.457 %** |
| shipped + containment | **1 114** | **78.34 %** |
| Δ | **+41** | **+2.88 pp** |

Split by the fixed hash of the case name (odd/even of the byte sum), so a gain that exists only in sample shows up
as a gap between halves:

| half | cases | shipped | with the pass | Δ |
| --- | ---: | ---: | ---: | ---: |
| even | 709 | 532 | 557 | **+25** |
| odd | 713 | 541 | 557 | **+16** |

**Gains 41, losses 0.** The zero is structural rather than lucky: the rule only inverts a pair whose *ordering by
evidence* is already contradicted by the band test, and it never touches a case where either candidate was not
measured.

By fault family (the families §286 identified as the headroom):

| family | n in population | before | after | Δ |
| --- | ---: | ---: | ---: | ---: |
| HTTPRequestDelay | 16 | 2 | 10 | **+8** |
| HTTPResponseDelay | 21 | 3 | 10 | **+7** |
| NetworkPartition | 13 | 4 | 9 | **+5** |
| NetworkCorrupt | 10 | 4 | 8 | +4 |
| NetworkLoss | 10 | 1 | 4 | +3 |
| NetworkBandwidth | 5 | 1 | 4 | +3 |
| HTTPRequestReplaceMethod | 27 | 12 | 14 | +2 |
| resource faults (ContainerKill, JVMMemoryStress) | 12 | 12 | 12 | 0 |

The families that gain are exactly the ones that **propagate**: delays and link faults. The families that gain
nothing are the ones that do not need the rule — resource faults, which the engine already answers at 100 %.

## 5. The margin, and why zero is not a tuning choice

| margin (band widths) | swaps | gains | losses |
| --- | ---: | ---: | ---: |
| 0 | 41 | 41 | 0 |
| 0.2 | 40 | 40 | 0 |
| 0.5 | 32 | 32 | 0 |

Both numbers are measured on the same case in the same unit against the same band, so `0` is a real equality
rather than a threshold somebody picked. The sweep above is a flat plateau in the only direction that matters
(losses stay at zero), which is what a threshold derived from the physics looks like.

## 6. What the pass refuses to do

- **No profile → no pass.** The excursion map is not built; `analyze` returns the fusion's own array by identity.
- **One side unmeasured → pair untouched.** An unmeasured candidate read as a measured zero would invert on
  evidence nobody collected.
- **Non-adjacent pairs are not compared.** The claim is about the order the fusion published; a promotion across an
  intervening candidate would be a re-sort, and a re-sort on excursions alone was measured at **45.9 %** Top@1
  against the engine's 85.9 % (§286 §2).
- **One sweep, no backtracking.** A candidate that moves up is not re-tested against the position above it, so one
  measurement cannot compound into an arbitrary climb.
- **The direction is fixed.** Only a callee moves up. A rule that could move a caller down for being a caller would
  be a different claim, and the wrong one: the caller is often the answer.

## 7. Wiring, and why the switch ships off

The pass needs `containmentExcursions`, which needs `faultFreeProfile`. The engine builds it in
`buildFaultGraph` only when the switch is on **and** a profile was supplied.

No benchmark dispatch can supply one: `--fault-free-profile` is on the dispatch-surface census'
`OPERATIONAL_FLAGS_UNREACHABLE`, with the reason "a dispatch that could name a path could name one fitted on
another corpus". That rule is right, and it is also why `DEFAULT_CONTAINMENT_ORDER` is `false` rather than `true`:
a switch whose input is empty in every production run is indistinguishable from a feature that does not exist —
the lesson §286b recorded for `traceWeight = 1` over zero coverage.

The arm is therefore measured on the one workflow that **builds** the profile itself
(`.github/workflows/benchmark-agentic.yml`, input `containment_order`), and the promotion path is:

1. build the profile in the benchmark workflow from the corpus it is about to rank (a derived path, never a
   dispatch input — the census rule is about *naming* a path, not about *deriving* one);
2. revise that census entry so the check matches its own rationale;
3. flip `DEFAULT_CONTAINMENT_ORDER` to `true` and re-read all four cells.

## 8. Prior art, and what is and is not claimed

The mechanism is **not novel** and this document does not claim it is. **TD-RCA** (IWQoS 2026,
`10.1109/IWQoS70441.2026.11661074`) names it *Cascade Confusion* — "synchronous blocking RPC can amplify upstream
anomaly signals and cause victim services to exhibit stronger symptoms than the true root cause" — and solves it
with a Dual-Perspective Decoupling module that models incoming pressure and outgoing propagation, reporting
HR@1 93.9 % on TrainTicket and 94.3 % on SocialNetwork under a VAE-GNN.

What this register claims is narrower and checkable:

- the decomposition is **deterministic and needs no training**: a band from the corpus and one comparison;
- it is applied as an **order constraint**, not as a learned score, so its effect is one number per corpus;
- its measured cost on this corpus is **zero losses**, which a learned module cannot state about itself;
- the dual-perspective form (incoming vs outgoing) was measured here too, as transport ratios: `tOut(callee) >
  tOut(caller)` fixes 61 and breaks 5, while the band test fixes 41 and breaks 0. The extra 20 wins and 5 losses
  are the price of reading transport instead of self-excursion, and this corpus prefers the precise reading.

## 9. Reproduction

```
pnpm exec tsx benchmarks/src/build-fault-free-profile.ts --data-dir <corpus> --out profile.json
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> --fault-free-profile profile.json \
  --containment-order --output results.json
```

The offline measurement in §3–§5 is reproducible from one shipped run's dumps
(`--fingerprint-out` for the bands, `--depth-out` for the full order) plus the corpus topology.
