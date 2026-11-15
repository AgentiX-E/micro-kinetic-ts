# The containment order — a caller may not outrank a callee that moved more

**Status:** implemented, measured on the full corpus by two dispatches, shipped OFF. The pass is **+47 gains /
−5 losses** (75.457 → 78.411 % Top@1); the switch ships off because this register refuses a change with
regressions, and the five are a mechanism rather than noise (§4, §7).

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
**precise** rather than merely comparative, and the difference was measured by a screening formula over the
presented five:

| rule | swaps | gains | losses | net |
| --- | ---: | ---: | ---: | ---: |
| `ratio(callee) > ratio(caller)` (no band) | 24 | 24 | 0 | +24 |
| `excursion(callee) > excursion(caller)` (σ = 3 band) | 41 | 41 | 0 | **+41** |

> **Those two rows are a screening quantity, not this module's.** The screen computed `maxdep` as the largest
> normalised departure over **every** channel a candidate carries. The shipped module restricts the excursion to
> the *latency* channels (§3.1), because a claim about inherited response time should be made on the channel that
> carries response time. The two quantities agree often and not always, and the difference is exactly what §4's
> in-engine readback records: the module measures **+47 / −5**, not 41 / 0. The screen's rows are kept because
> they are what selected the band over the ratio, and they are labelled because they are not the shipment's number.

### 3.1 Why the excursion is restricted to latency channels

Latency labels are the two instruments the corpus carries: `http.server.request.duration` (present on **21 %** of
candidates) and the Hubble family `hubble_http_request_duration_{p50,p90,p95,p99,max}`. The excursion reads the
**maximum** over the family, which is why the rule is not silent on four cases in five.

The restriction is not cosmetic. A counter channel (page faults, restarts, socket allocations) departs its band
under a *source* fault far more sharply than any latency channel does, so an all-channel excursion inverts a
source/callee pair on the wrong instrument — and the caller is often the source. Restricting the quantity to
durations is what keeps the rule about inheritance.

## 4. The measurement, on the shipped corpus

Two dispatches of `.github/workflows/benchmark-agentic.yml` over all 1 422 cases, differing only in
`containment_order`, read back per case from each run's own `per-case.ndjson`:

| | cases | Top@1 |
| --- | ---: | ---: |
| shipped | 1 073 | **75.457 %** |
| shipped + containment | **1 115** | **78.411 %** |
| Δ | **+42** | **+2.95 pp** |

**47 gains, 5 losses.** The five are the reason the pass ships off (§7), and they are *not* what the screening
formula predicted — a zero-loss screen is a property of the all-channel quantity, not of this one.

Split by the fixed hash of the case name (odd/even of the byte sum), so a gain that exists only in one sample
shows up as a gap between halves:

| half | cases | shipped | with the pass | Δ |
| --- | ---: | ---: | ---: | ---: |
| even | 709 | 532 | 557 | **+25** |
| odd | 713 | 541 | 558 | **+17** |

By fault family (the families §286 identified as the headroom):

| family | n in population | before | after | Δ |
| --- | ---: | ---: | ---: | ---: |
| HTTPRequestDelay | 88 | 57 | 67 | **+10** |
| HTTPResponseDelay | 89 | 56 | 66 | **+10** |
| NetworkPartition | 97 | 64 | 71 | **+7** |
| NetworkCorrupt | 46 | 31 | 37 | +6 |
| NetworkLoss | 48 | 29 | 34 | +5 |
| HTTPRequestReplaceMethod | 190 | 125 | 130 | +5 |
| NetworkBandwidth | 42 | 20 | 22 | +2 |
| **HTTPResponseReplaceCode** | 231 | 162 | 160 | **−2** |
| **HTTPResponseAbort** | 44 | 34 | 33 | **−1** |
| resource faults (ContainerKill, JVMMemoryStress, PodFailure, PodKill) | 294 | 294 | 294 | 0 |
| every other family (12 of them, incl. both body rewrites and `HTTPRequestAbort`) | 253 | 201 | 201 | 0 |

The families that gain are the ones that **propagate**: delays, link faults, corruptions. The resource families are
untouched at 100 % — they do not need the rule. The two that fall are the ones where the *victim* is a closer
neighbour than the source: a response-code rewrite makes every downstream callee of the injected service look
worse on duration, and the pass then promotes one of them past it.

### 4.1 What one pass does to a position

The rule only ever promotes a callee, and only past the single position above it. The CALLER is re-tested at the
next index, so it can fall more than one place: with `T → A → B → C` where each of `A`, `B`, `C` has a larger
excursion than `T`, one scan takes `[T, A, B, C]` to `[A, B, C, T]`. In the 1 422 cases, all 47 gains are a
rank-2 truth reaching rank 1, and 4 of the 5 losses are a rank-1 truth falling to rank 2 — but one falls to rank
3, which is that cascade and not a re-sort.


## 5. The margin, and why zero is not a tuning choice

The margin is the only knob that can refuse a pair without changing what the rule is: a larger margin demands a
larger excursion difference before a callee is promoted. Measured on the 711-case half whose 1 422-case results
this document quotes (`waveB2`, with a profile built from that half), against the pass off:

| margin (band widths) | Top@1 | gains | losses |
| --- | ---: | ---: | ---: |
| off | 484 (68.07 %) | — | — |
| **0** | **518 (72.86 %)** | **34** | **0** |
| 0.1 | 517 (72.71 %) | 33 | 0 |
| 0.25 | 509 (71.59 %) | 25 | 0 |
| 0.5 | 504 (70.89 %) | 20 | 0 |

`0` is the maximum of a monotone family, and it is a real equality rather than a threshold somebody picked: both
numbers are the same case in the same unit against the same band. Everything above it buys nothing and costs gains.

**The sweep also settles a question it was not run to answer.** This half contains none of the five losses the
full-corpus run records (§4), so no margin on this axis can be the discriminator for them — and the local harness
reproduces the two CI arms **per case, 711 of 711, with zero disagreements on either the control or the treatment
verdict**. That is what licenses reading the four-arm and sweep tables above as measurements of the shipped path
rather than of a re-implementation.

## 6. What the pass refuses to do

- **No profile → no pass.** The excursion map is not built; `analyze` returns the fusion's own array by identity.
- **One side unmeasured → pair untouched.** An unmeasured candidate read as a measured zero would invert on
  evidence nobody collected.
- **Non-adjacent pairs are not compared.** The claim is about the order the fusion published; a promotion across an
  intervening candidate would be a re-sort, and a re-sort on excursions alone was measured at **45.9 %** Top@1
  against the engine's 85.9 % (§286 §2).
- **One sweep, no backtracking.** A candidate that moves up is not re-tested against the position above it, so one
  measurement cannot compound into an arbitrary climb. The caller is a different matter and §4.1 records it: it is
  compared against its own callee at each successive index and can therefore fall several places in one scan.
- **The direction is fixed.** Only a callee moves up. A rule that could move a caller down for being a caller would
  be a different claim, and the wrong one: the caller is often the answer.

## 7. Wiring, and why the switch ships off

The pass needs `containmentExcursions`, which needs `faultFreeProfile`. The engine builds it in
`buildFaultGraph` only when the switch is on **and** a profile was supplied.

No benchmark dispatch can supply one: `--fault-free-profile` is on the dispatch-surface census'
`OPERATIONAL_FLAGS_UNREACHABLE`, with the reason "a dispatch that could name a path could name one fitted on
another corpus". That rule is right, and it is why the arm is measured on the one workflow that **builds** the
profile itself (`.github/workflows/benchmark-agentic.yml`, input `containment_order`).

**The switch ships `false`, and the reason is the measurement rather than the wiring.** At +47/−5 the pass takes
this corpus from 75.457 % to 78.411 %, a gain-to-loss ratio of 9.4 to 1 — and this register's rule is that a change
with regressions is refused even when the net is large: the ungated failed-edge term at **+105 with two
regressions** was gated rather than shipped (`docs/failed-edge-evidence-gate.md`). The same standard applies here,
and applies twice over because the five are not noise: they are a mechanism (§4, the response-code family), so a
future iteration can write the discriminator that refuses them without guessing.

The promotion path is therefore:

1. build the profile in the benchmark workflow from the corpus it is about to rank (a derived path, never a
   dispatch input — the census rule is about *naming* a path, not about *deriving* one);
2. revise that census entry so the check matches its own rationale;
3. find the discriminator for the five (a property of the case, not a margin — §5 rules the margin out);
4. flip `DEFAULT_CONTAINMENT_ORDER` to `true` and re-read all four cells.


## 8. Prior art, and what is and is not claimed

The mechanism is **not novel** and this document does not claim it is. **TD-RCA** (IWQoS 2026,
`10.1109/IWQoS70441.2026.11661074`) names it *Cascade Confusion* — "synchronous blocking RPC can amplify upstream
anomaly signals and cause victim services to exhibit stronger symptoms than the true root cause" — and solves it
with a Dual-Perspective Decoupling module that models incoming pressure and outgoing propagation, reporting
HR@1 93.9 % on TrainTicket and 94.3 % on SocialNetwork under a VAE-GNN.

What this register claims is narrower and checkable:

- the decomposition is **deterministic and needs no training**: a band from the corpus and one comparison;
- it is applied as an **order constraint**, not as a learned score, so its effect is one number per corpus;
- its measured cost on this corpus is **five losses in 1 422**, all of them one mechanism (the response-code
  family), against a learned module whose failure set cannot be enumerated at all — which is the property that
  makes the five addressable rather than merely expensive;
- the dual-perspective form (incoming vs outgoing) was measured here too, as transport ratios: `tOut(callee) >
  tOut(caller)` fixes 61 and breaks 5 on the screening quantity, while the band test fixes 41 and breaks 0 **on
  that same quantity**. Both rows are the screen, not the module (§3); the module's own readback is §4's
  +47 / −5.

## 9. Reproduction

```
pnpm exec tsx benchmarks/src/build-fault-free-profile.ts --data-dir <corpus> --out profile.json
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> --fault-free-profile profile.json \
  --containment-order --output results.json
```

The offline measurement in §3–§5 is reproducible from one shipped run's dumps
(`--fingerprint-out` for the bands, `--depth-out` for the full order) plus the corpus topology.
