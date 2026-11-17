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


### 4.2 A second measurement, on a fixed engine and a differently-built profile

The table above was read from the agentic workflow, which builds its own profile from the full corpus. After the
phase-coupling fix in §288b — the excursion map is a measurement of the case and is built whenever a profile is
supplied, while the switch is read in `analyze` — the pass was measured again on the `waveB2` half (711 cases)
with a profile fitted on that same half, under the shipped signal vector, one graph per case:

| arm | Top@1 | % | gains | losses |
| --- | ---: | ---: | ---: | ---: |
| shipped | 484 | 68.073 | — | — |
| **+ containment** | **518** | **72.855** | **34** | **0** |

**Zero losses again, on a different corpus, a different profile and a fixed engine.** The families it repairs are
the same ones: `HTTPResponseDelay` 11, `HTTPRequestDelay` 10, `NetworkPartition` 7, `NetworkBandwidth` 2,
`NetworkLoss` 2. The 47/5 of §4 splits as 34/0 here and 13/5 in the other half, so **every loss the pass has on
this corpus lives outside this half** — a distribution fact that a single-corpus claim would have hidden.

The same run measured the pass beside the margin bar (§288c): the two are nearly additive on gains (36 + 34 = 70
against a measured 66) and not at all additive on losses (containment repairs one of the margin bar's 25). They
answer different halves of the same question and are not substitutes.

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

The pass needs `containmentExcursions`, which needs `faultFreeProfile`. The engine builds the map in
`buildFaultGraph` whenever a profile was supplied, and reads it in `analyze` only when the switch is on.

**Those two conditions are deliberately in two places, and getting that wrong cost a measurement.** The map used to
be built only when the switch was on, which made "the graph carries excursions" and "this run applies the pass" the
same fact. `analyze` is public and takes the graph as an argument, so a graph built by a pass-off pruner carried no
map and every pruner reading that graph ran without the pass, whatever its own option said. The seven-arm factorial
in iteration 288 hit exactly this: it reported a corpus with **13 violating adjacent pairs** at the shipped count of
484, because its first arm built the graph and the first arm was the pass-off control. A measurement belongs to the
case; whether it acts belongs to the run, and the run is `analyze` — the phase `failedEdgeGateMode` already lives
in. The map is still conditional on the profile, so the shipped configuration allocates nothing.

No benchmark dispatch can supply a profile: `--fault-free-profile` is on the dispatch-surface census'
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

**DynaCausal** — from the RCABench authors themselves (`arXiv:2510.04711`'s own citation trail) — states the
problem in the same words: standard anomaly detection "lacks causality-awareness", so it proposes a ranking
objective that "explicitly penalizes downstream services" and prefers "upstream causal ancestors" over "downstream
victims". That is the same claim as §10's flow rule, arrived at independently and learned rather than derived.
**LagRCA** (ACM, `10.1145/3803437.3805219`) subtracts the anomaly a node's upstream explains before ranking, which
is again the same idea in anomaly units rather than failure counts.

What this register claims is narrower and checkable:

- the decomposition is **deterministic and needs no training**: a band from the corpus and one comparison;
- it is applied as an **order constraint**, not as a learned score, so its effect is one number per corpus;
- its measured cost on this corpus is **five losses in 1 422**, all of them one mechanism (the response-code
  family), against a learned module whose failure set cannot be enumerated at all — which is the property that
  makes the five addressable rather than merely expensive;
- the dual-perspective form (incoming vs outgoing) was measured here too. On the screening quantity, as transport
  ratios, `tOut(callee) > tOut(caller)` fixed 61 and broke 5 while the band test fixed 41 and broke 0; §10 now
  carries the MODULE-level readback of that form — the failure-flow pass, +54/−0 on this half and +76/−0 in union
  with the band test — which is the number the prior-art comparison should be made against.

## 9. Reproduction

```
pnpm exec tsx benchmarks/src/build-fault-free-profile.ts --data-dir <corpus> --out profile.json
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> --fault-free-profile profile.json \
  --containment-order --output results.json
```

The offline measurement in §3–§5 is reproducible from one shipped run's dumps
(`--fingerprint-out` for the bands, `--depth-out` for the full order) plus the corpus topology.

## 10. The second instrument: the failure-flow order (iteration 289)

Section 1 derived the delay instrument from one mechanism — a caller's response time contains its callee's. This
section asks a narrower question about that instrument's ceiling, and answers it with a second instrument of the
same shape.

### 10.1 The ceiling, measured

On the 711-case half, 82 cases publish the truth SECOND behind its own caller. Opening every one of those pairs:

| why the pair is not repaired | cases |
| --- | ---: |
| the containment signature fires (callee outside its band, caller at or below it) | **34** |
| BOTH candidates are inside their bands — nothing was delayed | **41** |
| the two candidates have no direct edge | 5 |
| the callee is not further outside its band than the caller | 2 |

The 34 are the pass's own gains, exactly. The 41 are the reason a delay instrument cannot go further: the
classic error-shaped fault — a replaced status code, an aborted request, a rewritten path — moves no latency
percentile at all, so the excursion is `0` at both ends, and `0` is a measurement of no excursion rather than an
absence of one. A rule that read those zeros as evidence would be inverting pairs on the strength of a channel
that never spoke.

### 10.2 The rule

The failed-call channel was already in the engine as a TERM, charging each failing edge to its CALLEE. A term
scores one candidate at a time; the question here is relational, and the channel's relational form is a flow:

```
incoming(v)    = Σ max(0, failed − baseline) over edges  c → v    (v's interface failing)
outgoing(v)    = Σ max(0, failed − baseline) over edges  v → d    (v's own calls failing)
unexplained(v) = max(0, incoming(v) − outgoing(v))
```

A source's incoming rise is produced by nothing it calls. A victim's is produced by the very calls it makes —
that is what propagation is — so its outgoing rise cancels it. On `c → a → b` with the fault at `b`, `a` reports
failures in and out in the same counts and nets zero while `b` nets its whole rise.

The pass inverts an adjacent pair when all three hold: the pair is a direct call edge, that edge carried a net
rise, and `unexplained(lower) > unexplained(upper)` — the SAME quantity read on both candidates, in the same
unit, strictly. No margin exists to tune and none is offered.

### 10.3 The measurement, through the engine

One graph per case, the shipped signal vector, the pass as an engine option rather than as a replay of the dump:

| arm | Top@1 | % | gains | losses |
| --- | ---: | ---: | ---: | ---: |
| shipped | 484 | 68.07 | — | — |
| `containmentOrder` (§4) | 518 | 72.86 | 34 | 0 |
| **`failureContainment`** | **538** | **75.67** | **54** | **0** |
| both | **560** | **78.76** | **76** | **0** |

Split into halves by case index, which is the only hold-out this corpus allows: `failureContainment` gains
**31/0** on one and **23/0** on the other, the union **41/0** and **35/0**. The two instruments overlap on 12
cases (34 + 54 − 76), which is what the 34-case census predicts: the delay pass fires where the flow is silent and
vice versa far more often than either fires twice.

**The full corpus, read back from the runner on the same commit** (`765b399c`, two dispatched runs, 1 422 cases
each): control `75.457 %`, `failure_containment=1` **`80.028 %`** — **+4.57 pp**, with **67 gains and 2 losses**
per case. So the guarded arm is zero-loss on the half it was designed on and not zero-loss on the corpus: the two
losses the other half contributes are both `HTTPRequestReplaceMethod`, the request-corruption family whose failing
edge is caused by the CALLER's malformed request. That is the same mechanism the degeneracy test refuses in
§10.4, in a form the counts cannot see, and §10.6's promotion path now begins with it.

### 10.4 The one regression, and the refusal that removes it

Without the refusal below, the same arm reads **555 (72 gains, 1 loss)**. The loss is one case:

```
ts5-ts-food-service-request-replace-path-xcddv5
  failures: loadgenerator → ui-dashboard 203,  ui-dashboard → food-service 203,  food-service → travel-service 203
  truth:    ts-food-service
```

Every hop carries the same 203. `travel-service` reports 203 inbound and none outbound, so its residual is 203
while `food-service`'s is `203 − 203 = 0`, and the rule promoted the leaf. But the three accounts are ONE account:
a single count travelling down a chain, whose residual asymmetry is an artefact of where the chain stops. The
refusal is therefore an equality at three sites — the callee saw that count on this one edge, the caller reported
it on this one edge, and the caller's own inbound count is the same number — and it costs **eighteen of the
seventy-two gains** to remove that case. It is a degeneracy test, not a threshold: nothing is compared against a
number somebody picked.

Two other guards were measured and refused for cost, both recorded here rather than dropped:

| guard | gains | losses |
| --- | ---: | ---: |
| none | 72 | 1 |
| self-anomaly corroboration (`selfAnomaly(v) ≥ selfAnomaly(u)`) | 22 | 0 |
| callee has ≥ 2 failing callers | 12 | 0 |
| **the three-site degeneracy test** | **54** | **0** |

### 10.5 The third instrument, measured and refused

A temporal instrument is the obvious next candidate: `postInjectOnsetDelays` says when each service's dominant
metric first moved, which is the collision-source-at-`t₀` + propagation-`τ` model in its plainest form. It reads
the loss case correctly — `food-service` moves 2 338 ms after injection, `travel-service` 25 768 ms — and it
still fails as a rule:

| arbiter | gains | losses |
| --- | ---: | ---: |
| onset only | 45 | **18** |
| delay only | 34 | 0 |
| flow only (unguarded) | 72 | 1 |
| onset, then delay, then flow | 53 | **18** |
| flow, then onset, then delay | 75 | **19** |

The dominant metric an onset is measured on is often not the metric the fault drives, so the ordering is noisy in
both directions. It is refused: an instrument that costs eighteen cases to fix one is not an instrument, and the
fact that it is right about the one case it was consulted for is not evidence.

### 10.6 Wiring

`failureContainment` ships **`true`** since iteration 291. Until then it shipped `false` for the reason
`containmentOrder` does — the full-corpus readback is the condition for a default — and that condition is met:
the shard cache was rebuilt from the converter at `d4c3843f` (`rcabench-data` run `43806078620`, release
`rcabench-shape-v1`) and dispatch `43818561923` reproduced **1 141 of 1 422 (80.2 %)**, with `noSplit=0` on the
guard row, i.e. the shape column present on every case. Unlike the containment order it needs **no profile**, so
it is the one of the two a dispatch can state: it travels in the FSE'26 workflow's packed
`ranking_knobs` block as `failure_containment=0|1`, and `0` is now the ABLATION rather than the default. The golden
half cannot name it — GitHub's 25-input ceiling leaves no input to spend, the reason every late knob is packed
rather than given one — so the axis is FSE'26-only until that surface changes.

Promotion to `true` requires the same four steps §7 lists for the delay pass, and one more that the full-corpus
readback named: **the two `HTTPRequestReplaceMethod` losses**. A request-corruption fault makes the caller send a
request the callee rejects, so the failing edge is the caller's fault while every count says the callee's interface
failed — the degenerate relay of §10.4 generalised to a family. The observable that separates them is the status
the callee returned: a rejected request is a client error, a failing callee is a server error. The FSE'26 bridge
aggregates both into "failed", so the split has to be introduced in the converter and the cache re-cut before the
rule can read it; that is a data-pipeline change, not a threshold, and it is the first task on the path. **§11 is
that task**: the status split was refuted on the datapack, the shape split was measured in its place, and the arm
now reads +68/−0 on the same full corpus.

## 11. The second instrument's missing premise: what KIND of evidence (iteration 290)

Section 10 closed on the two losses the full-corpus readback found and named the observable it expected to separate
them: the HTTP status class, 4xx for a rejected request and 5xx for a failing callee. This section opens the raw
datapacks, shows why that split cannot work, and measures the premise that does.

### 11.1 The mechanism, read off the datapack

`ts0-ts-basic-service-request-replace-method-88h72r`, edge `ts-basic-service → ts-price-service`:

| window | method | calls | status |
| --- | --- | ---: | ---: |
| pre-injection | GET | 304 | 200 |
| pre-injection | POST | 248 | 200 |
| post-injection | POST | **2 963** | **405** |

The datapack's own `display_config` states the injection: `{"injection_point":{"app_name":"ts-basic-service",
"method":"GET","route":"/api/v1/priceservice/prices/*/DongCheOne"},"replace_method":"POST"}`. The CALLER rewrote
the method; the callee answered a method it does not serve that route with.

**4xx does not identify the caller.** `HTTPResponseReplaceCode` injects client-error codes at the callee, and the
same 405 then means "the callee returned the wrong code" — the opposite attribution. The status class is a fact
about the RESPONSE; this case needs a fact about the REQUEST.

That fact is in the span the callee recorded. `span_name` is
`POST /api/v1/priceservice/prices/{routeId}/{trainType}` for all 2 963 rejected calls, and that `(route, method)`
pair **never occurs on that edge in the pre-injection window**. So the premise is: *a failed call whose request
shape the edge has never carried is a request the caller corrupted, and is therefore evidence about the caller.*

### 11.2 The flow becomes a 2×2

|  | shape the edge had carried | shape it had never carried |
| --- | --- | --- |
| edge `c → v` | `knownIn(v)` — v's interface failing | `novelIn(v)` — c sent a corrupted request |
| edge `v → d` | `knownOut(v)` — v's own calls failing | `novelOut(v)` — v sent a corrupted request |

```
unexplained(v) = max(0, knownIn(v) + novelOut(v) − knownOut(v))                 ('shape', the shipped reading)
unexplained(v) = max(0, knownIn(v) + novelIn(v) − knownOut(v) − novelOut(v))   ('counts', the §10 rule)
```

`novelIn` is measured and carried but never credited: a request a callee rejected for its shape says nothing
about the callee. It is kept because the `'counts'` reading needs it to reconstruct the pre-290 quantity exactly —
which is what lets the axis be ablated on ONE cache instead of requiring a second corpus.

Novelty is a **set-membership test**, not a threshold: the pair is absent from the shapes the same edge carried
before the injection. It is also scoped: an edge that appears only after the injection has an ABSENT baseline, not
an empty one, and none of its shapes may be called novel.

### 11.3 What the premise separates, on purpose and by accident

Five datapacks per family, read raw with the bridge's own shape expression:

| family | novel-shape failures | known-shape failures |
| --- | ---: | ---: |
| `request-replace-method` | 431 – 7 099 | 583 – 7 527 |
| `request-replace-path` | 106 – 2 009 | 521 – 2 150 |
| `response-replace-code` | **0** in 6 of 6 | 250 – 1 484 |
| `response-replace-body` | **0** in 6 of 6 | 308 – 1 921 |
| `response-abort` | **0** in 6 of 6 | 251 – 1 427 |
| `exception` | 0 in 5 of 5 | 812 – 5 289 |
| `container-kill`, `corrupt`, `partition`, `pod-failure`, `loss`, `delay`, `stress` | 0 in 30 of 30 | 1 – 316 |

On the corpus itself, through the re-cut cache (1 422 cases):

| | cases | novel mass | rise mass | share |
| --- | ---: | ---: | ---: | ---: |
| all cases | 203 of 1 422 | 210 681 | 1 013 406 | 20.8 % |
| `HTTPRequestReplaceMethod` | 127 | 171 321 | 382 009 | 44.8 % |
| `HTTPRequestReplacePath` | 39 | 34 895 | 76 394 | 45.7 % |
| `HTTPResponseReplaceCode` | 10 | 758 | 56 434 | 1.3 % |
| `JVMReturn` | 3 | 3 359 | 25 069 | 13.4 % |
| every other family | 24 | 348 | — | — |

The instrument speaks on 14.3 % of the corpus, and 98 % of what it says is about the two families whose fault IS a
rewritten request. It is not perfectly silent outside them: `JVMReturn` shows 3 359 novel counts in three cases,
which is the honest cost of the premise — a corrupted RETURN VALUE can reach a URL path and mint a route the edge
never carried, and the instrument cannot tell that from a corrupted request. That is 1.6 % of the corpus's novel
mass, and it is the reason §11.5 will not promote on this measurement alone.

### 11.4 The measurement

Three arms, one cache, one graph per case, the shipped signal vector. Halves are by case index — the only hold-out
this corpus allows.

| arm | Top@1 (full) | % | gains | losses | half A | half B |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| shipped | 1 073 | 75.457 | — | — | — | — |
| `failureContainment` + `attribution=counts` (§10) | 1 138 | 80.028 | 67 | **2** | 54/0 | 13/**2** |
| `failureContainment` + `attribution=shape` | **1 141** | **80.239** | **68** | **0** | 55/0 | 13/0 |

Two checks come before the delta:

1. The `counts` arm reproduces §10.3's runner readback **exactly** — 1 073 control, 1 138, 67 gains, the same two
   losses — through a locally re-cut cache. That is the check that this cache is the corpus §10 was measured on.
2. Top@5 is `1 249` in all three arms: the pass moves cases INTO the top slot and never out of the top five, which
   is what a pass that only reorders adjacent pairs can do.

The shape reading then repairs both losses and adds one more case:

- `ts1-ts-food-service-request-replace-method-rq29d8` — the counts arm promoted `ts-station-food-service` over the
  truth `ts-food-service`;
- `ts1-ts-route-plan-service-request-replace-method-d7vdmg` — likewise `ts-travel-service` over
  `ts-route-plan-service`;
- `ts9-ts-route-plan-service-request-replace-path-9dg8qf` (half A) — the third, a path-replacement case the
  counts arm never repaired.

The gains the counts arm already had on this family survive: 12 of the 68 are `HTTPRequestReplaceMethod`, and the
shape reading keeps every one of them, so this is not a trade between families.

The same statement, per family, on the re-cut cache — the acceptance condition is that no family may regress, so it is
checked at the family grain rather than at the total:

| family | n | shipped | `shape` | Δ |
| --- | ---: | ---: | ---: | ---: |
| `HTTPRequestReplaceMethod` | 190 | 125 | 137 | **+12** |
| `HTTPRequestDelay` | 88 | 57 | 68 | **+11** |
| `HTTPResponseDelay` | 89 | 56 | 67 | **+11** |
| `HTTPResponseReplaceCode` | 231 | 162 | 171 | **+9** |
| `HTTPResponseAbort` | 44 | 34 | 40 | **+6** |
| `NetworkCorrupt` | 46 | 31 | 35 | **+4** |
| `HTTPResponseReplaceBody` | 51 | 45 | 49 | **+4** |
| `HTTPRequestAbort` | 60 | 46 | 49 | **+3** |
| `JVMException` | 43 | 30 | 32 | **+2** |
| `NetworkLoss` | 48 | 29 | 31 | **+2** |
| `NetworkPartition` | 97 | 64 | 66 | **+2** |
| `HTTPRequestReplacePath` | 39 | 38 | 39 | **+1** |
| `NetworkBandwidth` | 42 | 20 | 21 | **+1** |

Thirteen families gain and **none loses** — the two `HTTPRequestReplaceMethod` losses §10.3 recorded are inside the
+12. The families that do not appear are unchanged to the case.

The shape reading's own increment over the counts arm is exactly three cases, and it is checked at the same grain
because a total of +3 can hide a swap:

| family | counts | `shape` | Δ |
| --- | ---: | ---: | ---: |
| `HTTPRequestReplaceMethod` | 135 | 137 | **+2** |
| `HTTPRequestReplacePath` | 38 | 39 | **+1** |

Every other family is identical between the two readings: the KIND of evidence changes the answer only where a novel
shape exists, which is what the census in §11.3 said it would do.

### 11.5 What promotion needed, and what it got

The register's rule is that a default flip is a DISPATCH question, not an arithmetic one, and the three steps it
imposed are all closed:

1. ~~a new cache must be cut~~ — `rcabench-data`'s `build-cache.yml` (run `43806078620`) rebuilt the shard cache
   from this checkout at converter `d4c3843f` and released it as `rcabench-shape-v1`, so the workflow's provenance
   gate resolves a dispatch against it. (This section named `cache-datasets.yml`; that workflow owns the RCAEval
   JSON cache. The correction is recorded rather than quietly rewritten — the same misattribution §290e of the
   register carries.)
2. ~~one dispatched readback on that cache has to reproduce 1 141 with `failure_containment=1`~~ — run
   `43818561923`: **Top@1 = 80.2 %**, `Cases = 1422`, `Top@3 = 86.4`, `Top@5 = 87.8`, `loadErrors=0
   engineErrors=0 emptyGraphs=0`, and the guard row `placeable=1422/1422 injectTime=1422 **noSplit=0**`. The last
   token is the one that matters: the shape column was present on every case, so the arm was not silently measured
   as the counts reading.
3. ~~only then does `DEFAULT_FAILURE_CONTAINMENT` move~~ — it is `true`, and `failureContainment: false` is the
   ablation a dispatch names with `failure_containment=0`.

The statement of this arm is therefore no longer conditional: **+68 top-1 gains against zero losses on 1 422 cases,
1 073 → 1 141 (75.457 % → 80.239 %), shipped and reproduced on a runner.** `failureAttribution` ships `'shape'`
beside it, and the reading still costs nothing where there is no evidence — on every case whose failures all arrive
on shapes the baseline carried, the two readings are identical.

### 11.6 Wiring

`failureAttribution` reaches a dispatch through the packed `ranking_knobs` block as
`failure_attribution=shape|counts`, beside `failure_containment=0|1`; the second is a closed vocabulary that fails
the step on any other word, because the two readings disagree on purpose and a typo must not silently pick one.
Since the flip, `failure_containment=0` is the ABLATION — it is the number the +68 is measured against, so a bare
dispatch and an explicit `=1` are now the same run, and the registry entry that says otherwise has been corrected.
The golden half cannot name either — GitHub's 25-input ceiling — so both axes stay FSE'26-only until that surface
changes.

### 11.7 What is not established

- The `JVMReturn` leakage in §11.3 is measured, not explained. Three cases carry 3 359 novel counts, and no test
  here distinguishes "a returned value reached a route" from "the caller corrupted the request".
- The premise needs the platform to template `span_name` and record `attr.http.request.method`. A corpus without
  either reports zero novelty, and the reading then IS the counts reading — a refusal, not a measurement.

---

## 12. The second reading at the shipped default: +38/−5, and the interface requirement (iteration 293)

§4 measured this pass against the 1 073 control, i.e. **before** iteration 291 promoted the failure flow. Two
things were therefore unmeasured at the point the pass is actually offered: what it does on top of the promoted
default, and whether the five losses that kept it switched off are still the same five.

Both arms were re-read locally on the released corpus (`rcabench-shape-v1`, converter digest `b7fca80e…`, all
seven shards verified against the manifest), one case per line, from each run's own `--per-case-out`:

| arm | `containmentOrder` | interface evidence | Top@1 | Δ vs shipped | gains | losses |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| shipped | off | — | **1 141** (80.239 %) | — | — | — |
| A: excursion alone (§4's rule) | on | not read | 1 174 (82.560 %) | **+33** | 38 | **5** |
| B: §12.1's rule | on | ledger rows | 1 156 (81.294 %) | +15 | 15 | **0** |
| C: §12.1's rule, raw rows | on | raw rows | **1 156** (81.294 %) | **+15** | 15 | **0** |

Arm A reproduces §4's mechanism exactly where it matters: the gains are the families that **propagate**
(`NetworkPartition` +11, `NetworkBandwidth` +9, `NetworkLoss` +7, `HTTPResponseDelay` +3, `NetworkLoss`/`Corrupt`
+2/+2, `HTTPRequestDelay` +2, `HTTPRequestReplaceMethod` +4) and the five losses are `HTTPResponseDelay`,
`HTTPResponseAbort`, `HTTPResponseReplaceCode` ×2 and `HTTPRequestReplaceMethod` — the same shape §4 recorded,
one fault family at a time.

### 12.1 Why the pass needs an interface record, and which one

An excursion is measured per **service**. Two candidates that both moved are therefore two independent
measurements until the case says something passed *between* them. The five losses are exactly the pairs where
nothing did: reading the raw `failedTraceEdges` of those five cases gives **0 failing records in all five**, while
**32 of the 38 gains** sit on a pair whose interface did carry failed calls (1–27 each).

That reading priced two candidate rules, and they are not the same rule:

- **the ledger's rows** — the edges the direction term decided to pay after its mutual rule, its override rule and
  its minimum-records floor. Arm B: the requirement is real and it costs 23 of the 38 gains, because a row the
  term declined to credit is still a row that failed.
- **the raw rows** (`failedInterfaces`, new field) — every edge that reported more failures after the injection
  than before it, before any credit rule. Arm C: the requirement as the case states it.

The distinction is the same one §3.1 draws between two instruments: the ledger is a **decision** about payment,
the raw record is a **measurement** of the case, and a pass that needs evidence needs the measurement.

**On this corpus the two readings are indistinguishable — arm B and arm C are the same 1 156, case for case — and
that is a result rather than a disappointment.** The reason is the pass's own shape: it is a single adjacent sweep,
so refusing ONE pair changes what the next comparison sees. An inversion that needed a blocked pair as its first
step never happens, whatever evidence the pair three positions down carries; and that is why the requirement costs
23 of the 38 gains even though a raw-record screen says 32 of them sit on a pair that did fail. The screen is a
quantity over a FINISHED ranking; the pass is a sequence. §3 records the same lesson for the excursion itself, and
this is its second instance in one document.

### 12.3 What ships, and what is refused

`DEFAULT_CONTAINMENT_ORDER` is `true` from iteration 293 with the requirement in place. The arm that was refused is
the one with the larger number: **+33 with five losses** is not shippable under this register's standing gate — no
fault family with n ≥ 20 may lose a case the shipped run answered — while **+15 against zero** clears it, gains in
seven families and loses in none:

| family | n | shipped | with the pass | Δ |
| --- | ---: | ---: | ---: | ---: |
| NetworkPartition | 97 | 66 | 72 | **+6** |
| NetworkLoss | 48 | 31 | 33 | **+2** |
| NetworkBandwidth | 42 | 21 | 23 | **+2** |
| HTTPRequestReplaceMethod | 190 | 137 | 139 | **+2** |
| HTTPRequestDelay | 88 | 68 | 69 | +1 |
| HTTPResponseDelay | 89 | 67 | 68 | +1 |
| NetworkCorrupt | 46 | 35 | 36 | +1 |
| every other family (18) | — | — | — | 0 |

The pass is inert without a profile, so it changes nothing on the golden half, and it is inert on a case with no
failed-call channel at all. Both are properties of the same rule and neither is a special case in the code.

### 12.2 Wiring

`applyContainmentOrder` takes an optional `failingEdges` record; when present, a pair is inverted only if its own
interface (in the edge's direction) is in it. `TreePruner.containmentOrdered` passes `graph.failedInterfaces`,
and a case with no failed-call channel at all supplies an **empty** record rather than `undefined` — the absent
map would have been read as "no requirement", which is the arm §12.1 refuses.

## 13. The sweep's reasons, and the population ρ needs (iteration 294)

H2 in the iteration-294 pre-registration (internal docs repository) is the factorisation residual

    ρ(a,b) = P(δa out of band ∧ δb out of band) − P(δa out of band) · P(δb out of band)

evaluated over the corpus on a call edge, and asked to do what the interface requirement does only crudely:
separate a propagating pair from a coincidental one. The interface record answers "did anything pass between
these two"; ρ asks "did their movements co-move more than independence allows".

It could not be computed from any artifact this repository writes. ρ is a property of an **edge**, and its
population is the set of adjacent pairs the sweep examined with a call edge between them. The ranking ndjson
cannot reconstruct that set: a pair that was never inverted leaves no trace in the order, and a pair whose
inversion cancelled a later one leaves a trace of the cancellation rather than of the examination.

### 13.1 `inspectContainmentOrder`

The same single sweep, with its reasons kept. `applyContainmentOrder` is now literally
`inspectContainmentOrder(input).order`, so the observation cannot drift from the decision it observes.

| decision | meaning | the pair's excursions |
| --- | --- | --- |
| `inverted` | the callee was further outside its band and every gate passed | both, measured |
| `no-failed-interface` | the pair's own interface carried no failed call | both, measured |
| `unmeasured` | the profile could not speak about one or both sides | only the ones measured |
| `not-larger` | both measured, callee not further out by more than the margin | both, measured |

Four refusals rather than one, because they are four different statements and only the last two are about the
pair's own measurements. A single `refused` would make a corpus with no evidence indistinguishable from one
whose evidence pointed the other way — the same conflation the metric rows were repaired for in the same
iteration.

Two properties are asserted rather than assumed:

- **A side the profile could not measure is ABSENT, never zero.** Zeroing it is the exact substitution
  `latencyExcursions` refuses to make; a consumer that made it would be inverting pairs on missing data. Both
  directions of the absence are tested, because an implementation that carried the lower side unconditionally
  would pass every other fixture.
- **A pair with no call edge produces no row.** A residual is a statistic about an edge, and a pair the topology
  does not join has no edge to be a property of. Recording it as a decision would put a population in the
  denominator that no reader of ρ asked about.

Observations are kept on refusals as well as on inversions, because a refusal is a negative example: every one
of the five losses the interface requirement removed was a refusal whose excursions were the reason the older
arm inverted it. An instrument that recorded only the gains could measure the residual's discrimination on the
gains and nothing else.

### 13.2 What it does not do

It does not compute ρ. It produces the rows ρ is computed from — the per-case, per-edge out-of-band indicators —
and the aggregation is a separate, corpus-level step. Keeping them apart matters because the two have different
populations: the row is a fact about one case, and ρ is a statistic about an edge over many.

It also does not change any default. No weight, no margin, no gate moved; `containment-order.ts` is at
100 % statements, branches, functions and lines with the 45 pre-existing tests untouched.

## 14. The observation H2 needs, and the ceiling ρ carries (iteration 295)

H2 asks whether the factorisation residual of a pair's out-of-band indicators separates a propagating pair from a
coincidental one. `inspectContainmentOrder` (iteration 294, §13) produces the rows; this section records the
artifact that carries them across the process boundary, the two defects the implementation had to design around,
and — before any corpus is read — the **ceiling the statistic itself imposes**, because that ceiling decides how a
failed gate has to be interpreted.

### 14.1 The sweep’s input is not the run’s output

The sweep's population is the adjacent pairs of the order the **fusion** published. The ranking a run reports is
not that order: `contained` runs the containment pass and then the failure-flow pass over the fusion's result, so
by the time a case is scored the fusion order is two transformations behind it. A dump derived from the published
ranking would therefore describe a population with the wrong adjacencies — and on a case the flow pass reordered,
a different set of pairs altogether.

`TreePruner` is constructed a second time in the runner with both passes off (`containmentOrder: false`,
`failureContainment: false`). That pruner publishes the fusion order, and the runner sweeps it with the same
`inspectContainmentOrder` the engine calls. Costs one ranking pass per case and no graph build; the depth is
`--containment-depth`, defaulting to **5** because that is the depth every number in §4 and §12 was measured at.

### 14.2 Two arms are two walks, not two columns

The shipped arm requires the pair's own interface to have carried a failed call; the refused arm (§12) reads the
excursions alone. Both are swept from the same fusion order and their rows are stored **separately**, because the
moment one arm inverts a pair the other refused, the two scans are looking at different adjacencies: row `i` of
one trace and row `i` of the other describe different pairs. Zipping them by index would attach a decision to a
pair it was never taken about, and nothing in the file would show it.

### 14.3 The replay, recorded rather than asserted

The builder reapplies the same two passes, in the same order, to the same input, and compares the result against
the ranking the engine published. The verdict is written to the row (`identical` / `differs` / `unavailable`)
rather than thrown on. A non-zero `differs` count is a statement about the **instrument** — the rows are
describing something other than the decision — and a run that refused to write would leave that fact invisible.
`unavailable` is the honest third state: the case carried no profile or no call edge, so the pass could speak
about nothing and there is no claim to check.

### 14.4 The estimator has a ceiling, and it is not small

ρ is a covariance of two Bernoulli indicators, so it is bounded by the **marginals** rather than by the coupling:

    ρ = P(δa ∧ δb) − p·q, and P(δa ∧ δb) ≤ min(p, q)
    ⇒ ρ ≤ min(p, q) − p·q = min(p(1−q), q(1−p))

Two consequences, both of which have to be in the record before the gate is read:

| marginals | perfect co-movement (both = min(p,q)) | ρ |
| --- | --- | ---: |
| p = q = 0.5 | joint = 0.5 | **0.25** |
| p = q = 0.9 | joint = 0.9 | **0.09** |
| p = q = 1 | joint = 1 | **0** |

So an edge whose two ends are out of band in **every** observation — the most propagation-like measurement the
corpus can produce — scores **zero** on the pre-registered statistic, while an edge whose ends moved together half
the time scores the maximum. This is a property of the estimator, not of the corpus, and it is why the report
prints a second column:

    φ = ρ / √(p(1−p)·q(1−q))

φ is the Pearson correlation of the two indicators, its ceiling is 1 at every marginal configuration, and it is
`null` when either marginal is degenerate (`p ∈ {0, 1}`) — a correlation with no denominator, which is not the
same statement as "no correlation". **H2 is decided on ρ**, because a hypothesis is judged by the number it fixed;
φ is read beside it so that a separation ρ loses to its own scale is visible in the same artifact instead of
costing a second corpus walk. Neither statistic is a gate until the pre-registration's in-engine arm clears
+15 / −0, which §12 still owns.

The two do not dominate each other, and the smoke fixture shows it: on an edge where both sides are inside their
band in every observation ρ reads 0 and φ is undefined, so φ's population is the SMALLER of the two on exactly
the edges that carry no signal. A report that printed only φ would silently drop those labels instead of scoring
them as failures to discriminate.

### 14.5 What is counted, and what is refused

- **Population floor.** An edge with fewer than 10 observations yields no residual at all — at `n` observations
  the sampling error of ρ is about `1/√n`, so a residual over six cases cannot be distinguished from zero.
- **Unmeasured sides.** A pair whose either side the profile could not speak about contributes **nothing**. The
  excursion is `0` when the service stayed inside its band — a measurement — and absent when it could not be
  measured; only the first is counted.
- **Attribution.** A case's move is attributed to the one pair that caused it, and only when the arm inverted
  **exactly one** pair and the answer moved. An arm that inverted three pairs and moved the answer could have been
  helped by any of them, and a residual fitted to a guess about which one would be fitted to the guess. Such a
  case is counted as `ambiguous`, separately from a case whose edge was too thin (`scored` below `gains + losses`),
  because one is a rule problem and the other a corpus problem.
- **No label in the artifact.** The rows carry no accepted answers, for the reason
  `agentic-fingerprint-file.ts` records; they join to the run's per-case verdict file on `datapack`.

### 14.6 The three verdicts

`pass` and `fail` are **findings** and leave the job green: a red build says the code is broken, and a refused
hypothesis is not broken code. Exit **3** is reserved for a row file with no case in it — an instrument failure,
where nothing was measured and a printed zero would be read as a null result.

### 14.7 Instrument coverage

`containment-rows.ts`, `containment-row-build.ts`, `containment-residual.ts` and
`containment-residual-report.ts` measure at 100 % statements, functions and lines, and at ≥ 98 % branches, with
the two refusals asserted in both directions: an unmeasured **upper** side and an unmeasured **lower** side are
separate branches, and a row with no call edge produces no verdict rather than a refusal verdict.
