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

**The order comes from the engine's own call.** `TreePruner.analyzeWithFusion` returns the answer it publishes and
the list its two relational passes were given, so the runner sweeps exactly the order the engine's containment stage
ran over — at the width it ran over it, i.e. `max(PUBLISHED_TOP_K, nodes)`. This replaced a second pruner with both
passes off, which recomputed the list and disagreed with the first call on the cases where the disagreement reached
the head: at `global-measured` the flow pass lifts a callee to just above its caller **to a fixed point**, so the
published head can come from any depth and a five-wide reconstruction cannot contain it (`docs/gate-replay.md` §10,
`micro-kinetic-ts-docs`). One call, one order, no second ranking pass per case.

`--containment-depth`, defaulting to **5**, is now the **recording** width and not the sweep's: the pass decides over
the whole order either way (a decision that depended on how much of itself was written down would let the artifact
decide the answer it reports), and the row states the width rather than leaving its reader to infer it from a
length. 5 remains the default because that is the population every number in §4 and §12 was measured at.

`--containment-depth 0` — "every candidate", the setting a reader reaches for when ρ's per-edge population is too thin
— is written as the word **`pool`** and not as the number it resolves to. The number follows the graph (50 on a
TrainTicket case, 12 on an OnlineBoutique one), so a dump written that way states as many populations as it has graph
shapes and the gate's census refuses it as a mixed file (`docs/gate-replay.md` §11, `micro-kinetic-ts-docs`). The
number is not lost: the window is `min(depth, order.length)`, so a pool-wide row's width **is** the length of the
`chain.order` the same row carries. A file that names `5` beside `pool` is still two populations and is still refused
— what changed is that one rule is now one census entry.

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

### 14.7 The first readback, and the population error it exposed

Run `43993982158` (1 422 cases, `containment_order: 1`) produced the first numbers: **244 observations over 30
edges**, of which 7 reached the population floor, and every residual exactly `0.0000` with an AUC of exactly
`0.5`. φ was undefined on all seven for the same reason.

That is not a weak estimator. It is a CONSTANT one on that population, and the argument is two lines:

    an inversion requires  excursion(lower) > excursion(upper) + margin,  margin = 0
    ⇒ excursion(lower) > 0 in EVERY observation   ⇒  p_lower = 1
    ⇒ δupper ⇒ δlower, so P(both) = p_upper
    ⇒ ρ = p_upper − p_upper · 1 = 0.

The population used was "the pairs the arm inverted", and the pre-registration says "every adjacent pair the
containment sweep considers". Restricting it to the acted-on pairs makes the statistic identically zero **by
construction** — the sweep only acts when the callee is further out, which forces that side's indicator to 1.

Re-read over the EXAMINED pairs, on the same artifact and with no new corpus walk:

| arm | edges | observations | edges at n ≥ 10 | gains | losses | scored | AUC(ρ) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ungated | 64 | 809 | 16 | 45 | 3 | 36 / 2 | **0.8611** |
| gated | 64 | 786 | 16 | 41 | 0 | 33 / 0 | N/A (one class empty) |

The top edges are the ones the mechanism predicts — `ts-route-plan-service ↔ ts-travel-plan-service`
(ρ = 0.1995, n = 191), `ts-preserve-service ↔ ts-travel-service` (ρ = 0.1629, n = 37), `ts-travel-plan-service ↔
ts-travel-service` (ρ = 0.1592, n = 64) — and the one negative edge is
`ts-contacts-service ↔ ts-preserve-service` (ρ = −0.1200, n = 10).

**Two qualifications, and neither is cosmetic.**

1. **`AUC = 0.8611` rests on two negative cases.** With `n₋ = 2` the statistic can only take values in steps of
   `1/72`, and moving either loss one position earlier drops it to `0.75` — below the bar. The gate's first
   criterion is therefore **met and not established**; it is a reading that must be repeated on a population with
   more losses before anything is built on it.
2. **The re-read is post-hoc in the arithmetic though not in the criterion.** The population was changed after
   seeing a null, and the justification is that the pre-registration's own words already fixed the examined pairs.
   That justification is checkable — the sentence is quoted above — but it is a justification, and a reader who
   counts it as one tuning step is not being unreasonable. The record keeps both numbers.

The second pre-registered criterion — replanting `ρ > 0` as the gate in `applyContainmentOrder` and re-reading the
corpus at +15 / −0 and Top@1 > 1 156 — has **not** been measured. It needs the residual computed on one half of
the corpus and applied to the other, because a case that contributes to the edge's own residual and is then judged
by it is a leak rather than a prior.

### 14.8 Instrument coverage

`containment-rows.ts`, `containment-row-build.ts`, `containment-residual.ts` and
`containment-residual-report.ts` measure at 100 % statements, functions and lines, and at ≥ 98 % branches, with
the two refusals asserted in both directions: an unmeasured **upper** side and an unmeasured **lower** side are
separate branches, and a row with no call edge produces no verdict rather than a refusal verdict.

## 15. H2's second criterion: the residual AS the requirement (iteration 296)

§14 answered H2's first question — does ρ separate a gain from a loss — and left the second one open: would
REQUIRING ρ > 0, in place of the failed-interface record, make the containment pass better? This section builds
that arm. It writes no reading: the number is the next dispatch's output, and the design decisions below are the
part that has to be right before the number means anything.

### 15.1 The pre-registration's own falsifier fired, and it named this arm

The docs repository’s pre-registration for 296 fixed H2b (the within-case residual over time slices) before any
data, and wrote its own
falsifier:

> If the readback of iteration 295 shows that the cross-case population is **not** thin — i.e. the labelled
> inversions mostly sit on edges with n ≥ 10 — then H2b's motivating sentence is false, and the honest move is to
> run H2's gate first and to hold this arm until a population actually fails.

The readback (§14.7) scored **36 of 38** labelled inversions on edges at n ≥ 10. The falsifier fired. H2b is held,
and this section is the arm that sentence asks for — which is the point of writing a falsifier down: it was
available to be ignored, and it was written in a place where ignoring it would be visible.

### 15.2 A gate changes the walk, so the row has to carry its own input

The cheap way to price a requirement is to re-read the decisions already recorded and drop the inversions it would
have refused. That is wrong in the direction that flatters the requirement: a sweep inverts as it goes, so
refusing one inversion changes the adjacency the NEXT row describes. The gated walk examines a different set of
pairs — sometimes a superset in one place and a subset in another — and a re-decision would report a corpus the
gate never saw.

So the dump's row now carries `chain`: the fusion order the sweep was given, the directed call edges, the
per-service excursions, the failed interfaces, the flow pass's inputs, and which reading of the flow decides a
pair. With those the whole chain replays from the file, because `applyContainmentOrder` and
`applyFailureContainment` are pure functions and the artifact now carries their arguments. Two consequences, both
worth the bytes:

- an arm nobody has run yet is a **local computation** over one artifact rather than another corpus walk;
- the run's own `replay` verdict becomes checkable by a reader who never ran the corpus.

The field is omitted rather than nulled on a dump written before it existed, so "this artifact predates the chain"
and "this case had an empty one" stay distinguishable — the same rule the excursions already follow.

### 15.3 Four arms, because "no requirement" and "no pass" are different arms

| arm | what it is | why it exists |
| --- | --- | --- |
| `off` | no sweep at all; the fusion order goes straight to the flow pass | the **baseline** every ± in §4 and §12 is read against — 1 141 before the pass |
| `ungated` | the excursion rule and nothing else | the arm §12 refused (`+33 / −5`), kept as the control the interface record is priced against |
| `shipped` | the excursion rule AND the failed-interface record | the 1 156 the criterion must be exceeded |
| `prior` | the excursion rule AND a residual fitted outside this case | H2's proposal |

The first two are one line apart in the code and a whole mechanism apart in meaning, and conflating them would
credit the gate with decisions the fusion had already made. `off` therefore records **no verdicts at all**: a
baseline that examined nothing has nothing to say about what it examined.

### 15.4 The prior is consulted LAST, so the label names what decided the pair

`inspectContainmentOrder` grew two decisions — `prior-absent` and `prior-below` — and the new check sits after the
interface record, after both measurements, and after the inequality:

    no call edge → not recorded
    interface did not fail → `no-failed-interface`
    either side unmeasured → `unmeasured`
    callee not further out → `not-larger`
    edge not fitted → `prior-absent`
    fitted and not above the threshold → `prior-below`
    otherwise → `inverted`

The order is the measurement. Asked first, the prior would label pairs the measurements had already refused, and
the count of "blocked inversions" — the quantity the gate's price is read from — would include pairs it never
reached. Placed last, `prior-absent` and `prior-below` mean exactly **this pair would have been inverted and the
prior stopped it**, which is the population whose size decides whether the gate is a filter or a formality.

### 15.5 Two refusal reasons, because an unfitted edge is not an independent one

`ContainmentPrior` is a map of fitted residuals and a threshold, and **the map keeps every fitted residual,
including the negative ones**: the threshold does the refusing. That is not a detail. Filtering at fit time made a
measured `ρ = −0.14` indistinguishable from a measurement that never happened, and the first version of this gate
reported 14 refusals, all of them `prior-absent`, on a corpus where every one of them was a fitted negative. The
sweep's two decisions exist to keep those apart, and the fit has to preserve the difference for them to be able to.

The threshold is `0` and the comparison is **strict**, for the reason the margin is zero: `ρ = 0` is precisely the
independence the mechanism claims a propagating pair departs from, so admitting it would admit the population the
hypothesis is trying to separate itself from.

### 15.6 The shipped row is an instrument check, not a result

The report prints three arms in a fixed order, and the second one is a check: the shipped arm is walked from the
same chain and must reproduce the corpus's published number. If it does not, the dump is missing an input, and the
residual row beneath it describes a walk the run never took. That case is `unmeasured` and exits **3**.

Three refusals, each with its own sentence, and none of them a red build for a scientific reason:

| state | when | exit |
| --- | --- | --- |
| `unmeasured` | no row carries a chain, or only some do, or the replay disagrees with the record | 3 |
| `fail` | measured, and the arm misses the ± or the Top@1 | 0 |
| `pass` | measured, and it clears both | 0 |

A reading over the rows that happened to be walkable would be a population the run never declared, compared
against a whole-corpus number — worse than no reading, so a partial chain refuses.

### 15.7 The fold is a hash, and that is not cosmetic

Each half's residual is fitted from the OTHER half, so every case is gated exactly once by a prior it did not
contribute to, and both halves are then read together — which is what keeps the result comparable to the
whole-corpus 1 156 instead of to a half-sized number.

The fold is FNV-1a over the case NAME, low bit, rather than an index into the file. The dump is in the loader's
directory order, which on this corpus groups cases by fault family; a hash is independent of that order by
construction, and a reader holding one row can place it. The cost is that the halves are not exactly equal, which
no reading here depends on.

`priorsFor` keys each prior by the half it may be **applied to**, so there is no entry under the half it came
from: the cross-fitting is enforced by the data structure rather than by a comment.

### 15.8 What this does not claim

- **No number.** The arm is built and wired; the reading is the next dispatch's.
- **Not a replacement for H2's first criterion.** The AUC was read on the whole corpus and is met-not-established
  (§14.7); this arm asks a different question of the same statistic, and a pass here does not repair a thin
  negative class there.
- **Not H2b.** The within-case residual stays pre-registered and unbuilt. §15.1 says why it is held and what would
  have to be true for it to be the next arm.

### 15.9 The reading: +27 / −3, and the three cases that refuse the requirement

Run `44013268053` (`cfecf4d`, 1 422 cases, `containment_order: 1`) is the first dump that carries the chain, and
its gate step printed:

```
  rows=1422 replayable=1422 scored=1422 disagreements=0
  prior fitted-on=b applies-to=a score=rho edges=61 fitted=8 admitted=8 unfitted=53 observations=391 (floor n>=10)
  prior fitted-on=a applies-to=b score=rho edges=56 fitted=9 admitted=8 unfitted=47 observations=418 (floor n>=10)
  arm=fusion top1=1141/1422
  arm=shipped top1=1156/1422 +15/-0
  arm=prior top1=1165/1422 +27/-3
  gate decisions: inverted=198 prior-absent=43 prior-below=1 not-larger=561 unmeasured=52
  criterion: gains>=15 losses<=0 top1>1156
  H2-gate: FAIL — 3 loss(es) against a requirement of 0
```

**The reconstruction came back exact**, which is the condition for the two rows under it to describe a walk the run
took: `disagreements=0` over 1 422 replayable cases, and the shipped arm's replay reproduces the corpus's
published 1 156 to the case.

**The requirement is better than the interface record at everything except the one thing that was asked of it.**
It gains 27 where the interface record gains 15, loses 3 where the interface record loses none, and ends 9 cases
higher (1 165 against 1 156). Nine of its 27 gains are cases the interface record also fixes; **eighteen are cases
the interface record does not reach**. The net is the best of the three arms and the criterion refuses it anyway,
because the criterion was `losses ≤ 0` before the number existed and this entry does not renegotiate a bar after
reading the tally.

**All three losses are one edge, and in all three the correct answer was already first.**

| case                                                   | fold | fused head            | shipped head          | prior head            | inversion                   |
| ------------------------------------------------------ | ---- | --------------------- | --------------------- | --------------------- | --------------------------- |
| `ts1-ts-preserve-service-response-abort-fxjfws`        | a    | `ts-preserve-service` | `ts-preserve-service` | `ts-security-service` | `ts-preserve → ts-security` |
| `ts1-ts-preserve-service-response-replace-code-qnm2bw` | b    | `ts-preserve-service` | `ts-preserve-service` | `ts-security-service` | `ts-preserve → ts-security` |
| `ts2-ts-preserve-service-response-replace-code-glvrkq` | a    | `ts-preserve-service` | `ts-preserve-service` | `ts-security-service` | `ts-preserve → ts-security` |

The injected fault is at `ts-preserve-service` in every one (`response-abort`, `response-replace-code`), so the
accepted answer is the service whose response was corrupted. Its callee, `ts-security-service`, is downstream and
moved further out of band, so the containment order promoted the callee over the root — a promotion the interface
record refused, correctly, because no call failed on that edge.

This is the residual's blind spot stated in one case: **ρ measures co-movement, and a caller and its victim
co-move.** The interface record does not measure co-movement at all; it records that a call was made and failed,
which is evidence that a propagation _occurred_ rather than that two series rose together. Its zero losses are
therefore its purpose and not its luck, which is why the three losses are not a small number to be traded against
eighteen gains — they are the mechanism's own failure mode, and the criterion's `losses ≤ 0` is the sentence that
names it.

**What refused the other 44 inversions is population, not disagreement.** Of 198 inversions the arm performed,
`prior-absent` refused 43 and `prior-below` refused exactly **one**. A gate fitted on half a corpus leaves 53 and
47 edges unfitted per half, and an unfitted edge blocks every inversion on it — so the requirement's real cost is
that most edges are unmeasurable on one half, while its real price is paid entirely on the edges it _admitted_.

**The residual is stable across the split, so the losses are not an artifact of it.** Of the 64 edges carrying an
inversion, 8 are measurable in both halves. Every one is positive in both, there are **no sign flips**, and the
mean absolute difference is **0.0421**:

| edge                             | n (a) |  ρ (a) | n (b) |  ρ (b) |           Δ |
| -------------------------------- | ----: | -----: | ----: | -----: | ----------: |
| `ts-preserve ↔ ts-security`      |    20 | 0.0800 |    15 | 0.2178 | **+0.1378** |
| `ts-travel-plan ↔ ts-travel2`    |    34 | 0.0900 |    40 | 0.1781 |     +0.0882 |
| `ts-route-plan ↔ ts-travel`      |    20 | 0.1425 |    17 | 0.0969 |     −0.0456 |
| `ts-route-plan ↔ ts-travel-plan` |   104 | 0.2102 |    87 | 0.1872 |     −0.0229 |
| `ts-preserve ↔ ts-travel`        |    20 | 0.1750 |    17 | 0.1522 |     −0.0228 |
| `ts-route-plan ↔ ts-travel2`     |    22 | 0.1612 |    14 | 0.1735 |     +0.0123 |
| `ts-travel-plan ↔ ts-travel`     |    33 | 0.1570 |    31 | 0.1644 |     +0.0074 |
| `ts-basic ↔ ts-travel`           |    11 | 0.1983 |    11 | 0.1983 |      0.0000 |

Two things follow, and the second is the important one. First, an edge-level constant is a defensible assumption on
this corpus: eight of eight reproduce their sign, and the mean disagreement is 0.042. Second, **the one edge that
produced the three losses is the least stable edge in the corpus** (0.0800 against 0.2178, the largest Δ) and it is
still positive on both halves — so no requirement of the form "the sign must reproduce" or "the smaller half's
estimate must be positive" would have blocked it. The instability is a _warning_ about that edge, not a test that
separates it.

**One artifact defect, found by reading its own JSON.** `containment-gate.json` serialises the prior as
`"residuals": {}` — a `Map` stringifies to nothing — so the machine-readable record keeps `fitted`/`admitted` but
loses which edges they were. The reading above is unaffected (the counts are printed, and the walks are in the
dump), but a reader with the JSON alone cannot reconstruct an admission, which is the one thing §15.2 exists to
guarantee. The fix is to serialise the map's entries; it is recorded here rather than patched silently, because the
artifact this iteration was read from is the one those numbers came from.

## 16. The exact test for an edge's independence (iteration 297, statistic only)

§15.9 refuses the requirement on three cases and says the blind spot is causal rather than statistical. The
obvious objection is that the requirement was never _tested_: `ρ > 0` is a threshold on a point estimate, and a
point estimate over ten observations is not evidence. This section answers the objection with the test the floor
was standing in for, and it is written before the arm that uses it exists, because the criterion had to be fixed
before the number that judges it.

### 16.1 The floor was a p-value with the marginals collapsed

`MIN_POPULATION = 10` is derived in §14.4 from "the sampling error of ρ is about `1/√n`". The scaling is right and
the constant is not, because the evidence an edge carries depends on its **margins** as much as on its count:

| edge                        |   n | margins       | smallest attainable one-sided p | passes 0.05? |
| --------------------------- | --: | ------------- | ------------------------------: | ------------ |
| balanced, perfectly coupled |  10 | `p = q = 0.5` |           `1/C(10,5) = 0.00397` | yes          |
| skewed, perfectly coupled   |  10 | `p = q = 0.9` |                       `0.10000` | **no**       |
| balanced, perfectly coupled |  20 | `p = q = 0.5` |                   `5.41 × 10⁻⁶` | yes          |
| balanced, eight of ten      |  20 | `p = q = 0.5` |                       `0.01151` | yes          |

The floor admits both `n = 10` rows and refuses neither; the second one cannot reach significance at **any**
coupling. A flat count of observations is simultaneously too lax where the margins are skewed and too strict where
they are not.

### 16.2 The test is the permutation test, in closed form

Fix an edge's `n` observations, `a` with side a out of band and `b` with side b out of band. Under independence the
joint count is what a permutation of the b-indicators produces with both margins held fixed, and that permutation
law is exactly hypergeometric:

```
X = bothOut ~ Hypergeometric(n, a, b),   P(X = k) = C(a,k)·C(n−a, b−k) / C(n,b)
p = P(X ≥ bothOut)
```

So `benchmarks/src/containment-significance.ts` enumerates the sum instead of shuffling. That is not a shortcut
around the permutation test; it **is** the permutation test, at the resolution of the exact distribution rather than
of a seed. The sum is taken in log space through a `log(n!)` table, because `C(191,50)` is about 10⁴⁹ and the direct
ratio is `NaN` at the populations this corpus reaches.

### 16.3 The multiplicity the floor could not have

A floor never had to count itself. Testing `m` edges at 0.05 admits about `0.05·m` of them under a global null, so
the criterion is not a p-value but a family-wise procedure, fixed at **Benjamini–Hochberg, `q = 0.05`**, over the
edges a half could fit. An admission is a licence to invert one adjacent pair and a false admission costs one
blocked pair, which is counted; that is the level FDR controls, and it is why this is not Bonferroni — at `m = 64`
Bonferroni demands `p ≤ 7.8 × 10⁻⁴` of the smallest p and would make the gate a test of corpus size.

### 16.4 Three independent checks, because a p-value cannot be spot-checked

| check                                                                                                                                         | what it establishes                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the tea-tasting table `n = 8, a = b = x = 4` → `1/70`, plus five hand-computed fractions (`1/252`, `17/70`, `1063/92378`, `0.8`, `0.1`)       | the enumeration is the right enumeration, including a tail that is a sum rather than one term                                                                            |
| 200 000 actual permutations against the closed form at four tables                                                                            | exact `1.428571e-2` / `3.968254e-3` / `1.150707e-2` / `2.693889e-3` against permuted `1.421e-2` / `3.945e-3` / `1.1135e-2` / `2.62e-3`, `z = −0.29, −0.17, −1.59, −0.65` |
| `scipy.stats.hypergeom.sf` over 120 random tables, and `scipy.stats.false_discovery_control` over 60 random p-vectors of up to 200 hypotheses | max absolute difference `4.7 × 10⁻¹³` on the tails; **exactly 0.0** on every adjusted value                                                                              |

Coverage is 100 % statements, branches, functions and lines over 31 tests, with both structural refusals asserted
as errors rather than `null`s: a table with `bothOut > min(a,b)` or `a + b − bothOut > n` is not a weak table, it is
an impossible one, and the counts that produced it came from an accumulator that lost an observation.

### 16.5 What the test does to §15.9's three losses — computed, not promised

The counts are already in the artifact, so the arm can be priced before it is built. Per half, over that half's
examined pairs, with BH at `q = 0.05` and **no floor** (the test replaces it, since it is valid at `n = 1`):

| half          | edges | testable | admitted at `q = 0.05` |
| ------------- | ----: | -------: | ---------------------: |
| a (713 cases) |    56 |       56 |                      4 |
| b (709 cases) |    61 |       61 |                      4 |

And the edge that caused all three losses splits across the split:

| prior fitted on           |   n | both |   a |   b |      ρ |              p |     q | admitted |
| ------------------------- | --: | ---: | --: | --: | -----: | -------------: | ----: | -------- |
| **a** (applies to fold b) |  20 |    4 |   8 |   6 | 0.0800 | `1.373 × 10⁻¹` | 0.854 | **no**   |
| **b** (applies to fold a) |  15 |    7 |   7 |   8 | 0.2178 | `1.243 × 10⁻³` | 0.019 | **yes**  |

So the test blocks **one** of the three losses — the fold-b case, whose granting prior has p = 0.137 — and leaves
the two fold-a cases, whose granting prior reads p = 0.0012. It also cuts the admitted population from 17 edges
(8 + 9) to 8 (4 + 4), which is where the eighteen gains the interface record does not reach mostly live.

That is the answer to the objection, and it is not the answer that would have rescued the requirement: **a stricter
test does not repair a causal blind spot, it only shrinks the population that pays for it.** The arm stays
pre-registered as `docs-repository:preregistration-297.md` records it — including its predicted failure, and its falsifier, which
says an empty admitted set is `UNMEASURED` rather than `fail` — and it is not built as a candidate requirement,
because §15.9 has already measured the thing it would be asked to fix.

### 16.6 Where the residual axis goes instead

The 18 cases the interface record cannot reach are real headroom, and the 3 it wrongly promoted are the price of
asking a co-movement statistic to decide a direction. Both are answered by the shape **H6** names: make the
residual a **graded term** in the score — prior, evidence, centred residual, as arXiv:2609.27069 independently
implements it — rather than a binary licence on the edge. A term cannot promote a victim over its root by 0.08, and
it cannot block the eighteen cases either; it moves them by an amount proportional to the evidence. That is the
next arm on this axis, and the statistic it needs is the one this section built.

## 17. The residual as a TERM (iteration 298) — refused, and the reason is locality

§16 closed the objection that the gate's threshold was never *tested*, and answered it in the way that did not
rescue the gate: a stricter test does not repair a causal blind spot, it shrinks the population that pays for it.
What §16 could not answer is the other objection — that a binary licence on an edge is the wrong **shape**. A step
spends the same amount whether the fusion led by 0.01 or by 4, so the three losses it took were not a problem of
evidence but of spend.

This section builds the shape that spends proportionally, measures it on the same artifact, and refuses it too.
The refusal is worth more than either pass would have been, because it names what was actually carrying the gate.

### 17.1 What was built

| module | what it holds |
| --- | --- |
| `benchmarks/src/containment-term.ts` | `asymmetryOf`, `termTransfers`, `phiByEdge`, `fusionPairs`, `gradeByTerm` — the arithmetic of one pair and of one order |
| `benchmarks/src/containment-term-study.ts` | `readTerm`, `sweepTerm`, `termVerdict` — the cross-fitted reading, four arms, the reach census |
| `benchmarks/src/containment-term-report.ts` | the argument parser and the report, on the gate's layout so the two read as one column set |
| `benchmarks/src/run-containment-term.ts` | the CLI, exit 3 on an artifact it cannot walk |
| `benchmarks/src/containment-replay.ts` | a FIFTH arm, `graded`, so every arm is walked by one implementation |

`containment-residual.ts` gained `countObservations`: the term fits on the fusion order's own adjacencies and the
gate fits on a sweep's, and a second corpus walk with its own counting loop would have been free to disagree with
the first about what an observation is. `containment-gate.ts` gained `compareEdgeKeys` (the comparator the
residual JSON needs, named so its equality arm is testable at all) and `gateReadingToJson` — the fix for the
artifact defect §15.9 recorded: `JSON.stringify` writes a `Map` as `{}`, so the first gate artifact kept
`fitted`/`admitted` and lost **which edges** they were.

### 17.2 The statistic is φ, not ρ, and the term is single-sided

ρ's ceiling was recorded in the residual module before any gate existed: with `p = q = 1` the joint is forced and
**ρ = 0 however perfectly the two services move together**, while `p = q = 0.5` reads 0.25 for the same coupling.
As a threshold that costs one refusal. As a **weight** it zeroes the most propagation-like edge in the corpus and
pays the most to an edge that co-moved half the time. So the term is weighted by φ — the same covariance over
`√(p(1−p)·q(1−q))`, already computed and serialised beside ρ — and one λ means one thing on every edge:

```
pair (u above, v below), both measured, x_v > x_u + margin
a       = (x_v − x_u) / (x_v + x_u)        ∈ (0, 1]
term(v) += λ · φ(edge) · a                  ≤ λ
```

Nothing is subtracted from `u`. The mechanism's claim is one-directional — the callee's movement is the source —
and punishes-the-caller is a second claim whose counter-example is exactly the three losses. Single-sided is also
what makes `≤ λ` true, which is the bound §17.3 rests on.

### 17.3 λ = 1, derived rather than tuned

The three losses the gate took have fused gaps of **1.226766**, **1.008035** and **1.007362** score points. Since
`|φ| ≤ 1` and `a ≤ 1` and the term is single-sided, a pair moves by at most λ — so for `λ < 1.007362` this arm
**cannot** reproduce any of the three. That is arithmetic, not hope, and it is why λ = 1: the largest round unit
strictly below the smallest of the three gaps. Its cost is stated with it — a term that cannot pay more than one
point can only move pairs the fusion was unsure about — and the whole sweep from 0.25 to 4 is reported so the
bound can be seen to bind.

### 17.4 The prediction, and what happened to it

`preregistration-298.md` (docs repository) fixed the numbers before the corpus was read: **losses 0, "and not by
luck"**, 8–14 gains, Top@1 between 1 149 and 1 165. Run `44013268053`'s artifact reads:

```
  rows=1422 replayable=1422 disagreements=0 unordered=0
  population fusion=833 ungated=861 same-length-cases=1385
  phi fitted-on=a applies-to=b edges=56 fitted=8 positive=8 observations=406
  phi fitted-on=b applies-to=a edges=61 fitted=9 positive=9 observations=375
  transfers qualified=228 unfitted=45 paid=183 silent=0 refused=605
  moved=55 (graded head differs from the fusion head)
  arm=fusion  top1=1141
  arm=shipped top1=1156 +15/-0
  arm=prior   top1=1165 +27/-3
  arm=graded  top1=1137 +6/-10 lambda=1
  reach rank=2 +4/-0 rank=3 +2/-5 rank=4 +0/-2 rank=5 +0/-3
```

**Every one of the three predictions is wrong, and the first is wrong by construction rather than by luck.** The
`prior` row reproduces §15.9's 1 165 / `+27 / −3` exactly, which is what licenses reading the row beneath it.

### 17.5 Why the algebra failed: the bound is on the pair, not on the tournament

The derivation in §17.3 bounds how much a callee can gain **over the caller it was compared with**. It does not
bound how many candidates that gain lets it pass. A candidate at rank 3 that is paid λ can overtake a rank-1
candidate it never shared an edge with, and the three losses §17.3 was reasoning about are not the only way to
lose a case.

That is a category error in the pre-registration, and the pre-registration is not amended: `λ = 1` stays, the
criterion stays, and the falsifier "any loss at λ = 1 falsifies the derivation" is what fired. The correct
statement of the bound is the one this section can now make honestly: **a term bounds what one pair is worth, and
a step bounds which pairs can move at all.**

### 17.6 The mechanism, counted: precision is a function of how far the promotion reaches

Every case whose published head changed is bucketed by the rank the promoted candidate held in the fusion order:

| λ | rank 2 | rank 3 | rank 4 | rank 5 |
| --- | --- | --- | --- | --- |
| 0.25 | **+2 / −0** (100 %) | +0 / −1 (0 %) | — | — |
| 1 | **+4 / −0** (100 %) | +2 / −5 (29 %) | +0 / −2 (0 %) | +0 / −3 (0 %) |
| 4 | +11 / −3 (79 %) | +17 / −7 (71 %) | +0 / −11 (0 %) | +0 / −9 (0 %) |

**Ranks 4 and 5 are 0 for 20 at every λ.** Rank 2 is perfect at λ = 1 and still 79 % at four times it. The term's
precision is not a property of the residual; it is a property of the distance.

And the losers are not a scatter — they are one class of node. At λ = 1 all ten are the same mechanism, and the
edges that paid them are the corpus's most coupled:

| case | truth | promoted | edge that paid it | φ |
| --- | --- | --- | --- | --- |
| `ts1-ts-basic-service-request-replace-method-hz96t6` | `ts-basic-service` | `ts-route-plan-service` | `ts-travel-plan → ts-route-plan` | 0.839 |
| `ts1-ts-basic-service-response-replace-code-5pdcrx` | `ts-basic-service` | `ts-travel2-service` | `ts-travel-plan → ts-travel2` | 0.753 |
| `ts1-ts-route-service-latency-vhk7dz` | `ts-route-service` | `ts-basic-service` | `ts-travel → ts-basic` | **1.000** |
| `ts2-mysql-delay-d427wn` | `ts-route-service` | `ts-basic-service` | `ts-travel → ts-basic` | **1.000** |
| `ts3-ts-seat-service-request-delay-79xhc2` | `ts-seat-service` | `ts-travel-service` | `ts-travel-plan → ts-travel` | 0.749 |

`ts-basic-service` and `ts-travel-service` are the corpus's downstream hubs, and they carry **φ = 1.000**: they
co-move with their callers in every observation. That is not an accident of the statistic — it is what containment
*is*. A caller's latency contains its callee's, so a callee moves whenever its caller does, and the node with the
most callers has the most reasons to move. **The term pays most to the node that co-moves most, and the node that
co-moves most is the furthest downstream.** §15.9 measured this once, as three cases on one edge; a global spend
makes it the dominant failure mode.

### 17.7 Therefore the gate was carried by its step, not by its residual

An adjacent swap can promote exactly one candidate — the one at rank 2 — and that is the distance at which this
statistic reads 100 %. §15.9's `+27 / −3` was therefore not a measurement of the residual's strength. It was a
measurement of a **constrained move whose constraint happened to match the statistic's only reliable range**.

Two consequences, and the second is the uncomfortable one:

- **The AUC of 0.8611 (§14.7) measures a discrimination that no global spend can convert.** Ranking gains against
  losses by ρ says the statistic knows which pairs are real; it says nothing about which *candidates* those pairs
  are about, and a term is asked the second question.
- **The `+27 / −3` is not evidence that a better statistic would do better.** It is evidence that the step's
  structure — a licence on one edge, spent on that edge's own adjacency — is doing most of the work. Anything
  proposed to replace the step has to be measured against *that*, and this arm is the first measurement that says
  so out loud.

### 17.8 The sweep, whole, and its ratio

| λ | Top@1 | ± vs fusion | moved |
| --- | ---: | --- | ---: |
| 0.25 | 1 142 | +2 / −1 | 13 |
| 0.5 | 1 139 | +4 / −6 | 32 |
| 1 | 1 137 | +6 / −10 | 55 |
| 2 | 1 141 | +18 / −18 | 98 |
| 4 | 1 139 | +28 / −30 | 139 |

The curve is not flat, which rules out the "inert" falsifier, and it is not non-monotone in sign, which rules out
the "noise" one. It is **one-to-one**. Gains and losses grow together over a 16-fold range: at λ = 4 the arm buys
28 cases and sells 30. The marginal precision of a further unit of spend is ~50 % at every scale, which is the
precise sense in which the residual's *marginal* value in this shape is zero — and why the arm is refused not for
being below a bar but for having no slope.

### 17.9 The price is starvation, again

`qualified=228`, `unfitted=45`, `paid=183`, `silent=0`, `refused=605`. Of the 228 pairs that qualified on their
excursions, **45 sit on an edge the paying half could not fit** — the same starvation §15.9 recorded as
`prior-absent=43`, for the same reason: a φ fitted on half a corpus cannot fit the edges only the other half
measured. `silent` is zero everywhere, which is its own small finding: no fitted edge in this corpus has φ ≤ 0 once
it is coupled enough to qualify, so the "the corpus measured independence" branch never fired.

### 17.10 What was probed afterwards, and why it closes the axis rather than opening a new arm

The reach table suggests one more shape: **the residual as an addition to the interface record, restricted to the
distance where it is precise.** That is a union — invert when the interface failed, OR when the term's payment
clears the gap at rank 2 — and it can be priced on the same artifact before it is built. It was, as an exploratory
probe and labelled as one (no pre-registration, so it is a bound and not a reading):

| λ | both fix it | shipped only | term-at-rank-2 only | union Top@1 |
| --- | ---: | ---: | ---: | ---: |
| 1 | 3 | 12 | 1 | 1 157 |
| 2 | 4 | 11 | 1 | 1 157 |
| 4 | 9 | 6 | 2 | 1 158 |

Over the 279 cases the fusion misses, the residual restricted to its only reliable distance adds **one** case at
λ = 1 and two at λ = 4, against the shipped arm's fifteen. The union clears 1 156 by one case, and the cost of
building it is a pass that becomes score-aware — which is a documented property of `applyContainmentOrder`
("its result is deterministic and independent of the candidates' scores") and would have to be given up for a
one-case return.

So the honest reading is not "build the union". It is: **the residual axis is exhausted.** As a gate it loses the
argument (§15.9); as a term it has no slope (§17.8); restricted to where it is precise it adds one case (§17.10).
The 18 cases §15.9 called headroom are real and are not reachable from this axis: they need a term that is
*evidence about the candidate*, not a weight on the edge, which is what H6 was hoped to be and is not.

### 17.11 The debts this does not pay

- **φ still has no interval.** A term is a weight, and a weight with no error bar is exactly what a term was
  supposed to be better than a threshold at. The debt §16.4 named twice is now sharper, not smaller.
- **No claim about a candidate below the fifth position.** The term only qualifies pairs the sweep examined, so a
  candidate outside the chain never receives one; the reach census's ranks are the fusion's first five, and
  nothing here says what a lift from rank 9 would be worth.
- **The three losses' "cannot happen" argument was about the pair's gap,** and §17.5 records why it did not
  extend. A reader who wants the bound to hold should read the reach table as the bound's replacement: it is
  empirical, it is per distance, and it is the reason the next arm on this axis is not a spend.

## 18. The pass reading every channel (iteration 299) — the rule held fixed, the measurement swapped

§17 closed the residual axis and named what the next arm had to be: a quantity that is *evidence about the
candidate*. Every containment arm before this one priced the **rule** — the interface record (§12), the residual as
a requirement (§15.9), the residual as a term (§17) — while §289 named the other ceiling in one sentence: the pass
reads `latencyExcursions`, one channel family. Nothing had swapped the measurement while the rule stood still,
because the pass takes a plain `ReadonlyMap<ServiceId, number>` and the swap needed a second map *in the artifact*
before the arm could be walked at all.

### 18.1 The quantity

`channelSurprise` (`packages/tree/src/pruning/fault-free-surprise.ts`) prices each candidate's own post-injection
window against the rate at which its channels fire while nothing is wrong:

```
fired(v, c) = [ max over the post window of |x − centre_c| > σ · scale_c ]     ← the profile's own fire rule
q_c         = (fires_c + 1) / (windows_c + 2)                                 ← Laplace, one pseudo-count each way
surprise(v) = max over c of  fired(v, c) ? log(1 / q_c) : 0
```

Three properties, and each is a decision rather than a detail:

- **Per candidate.** The pass compares two numbers; this is one of them. No relation is invented that the case
  does not carry, which is exactly what §17.8 said the residual could not manage.
- **Dimensionless.** Nats, so one channel's milliseconds and another's byte counts share an axis — the reason the
  profile adopted a *counting* estimator in the first place (`pruning/fault-free-profile.ts`).
- **Zero, not absent, for a measured-clean window.** The pass requires both sides to be measured; a candidate whose
  channel set was read and stayed inside its bands is a measurement of *no* excursion, while a candidate the
  profile cannot speak about is an absence. Substituting one for the other is the move `latencyExcursions` refuses
  and this module refuses identically.

The `max` rather than a sum is the fourth decision: a sum would make the number of published channels a term, and
a candidate with forty channels would out-score one with six for having been observed more.

### 18.2 What the arm changes, and what it does not

The arm is one walk of one chain with one map swapped (`containment-replay.ts`, `kind: 'surprise'`). The rule that
made the shipped pass earn `+15 / −0` is untouched: the pair must share a call edge, the interface must have
carried more failed calls after the injection, and the callee's number must exceed the caller's by the shipped
margin of `0`. So a difference between the two arms is attributable to the measurement and to nothing else.

The map reaches the artifact through the row builder and the chain, and it is written **only when the run measured
one**. An absent map REFUSES the arm rather than walking it empty: an empty map makes the pass a no-op, so a dump
from before the field would report the arm as identical to `off` and the difference would look like a finding.

### 18.3 What a replacement can and cannot say

The arm replaces latency, so its Top@1 is expected to sell the cases the shipped pass fixed — a number that would
say "worse" and stop. The census is what makes the reading useful: `opened` tallies the pairs the surprise walk
inverted and the shipped walk did not, keyed by **the reason the shipped walk refused them**. The two headings that
matter are `unmeasured` (the profile could not measure the candidate's latency at all) and `not-larger` (it
measured, and the callee was not further out on that channel). §289's claim is that those two are a channel
artefact; this census is the first test of it.

A union of the two measurements is deliberately **not** built, whatever the census shows. A union is a new rule,
and the arm exists to price the second measurement. If `opened` is large and the cases behind it improve, the union
becomes the next pre-registration with its own numbers.

### 18.4 The bar, and the instrument check

Unchanged: **gains ≥ 15, losses ≤ 0, Top@1 > 1 156**, applied by `judgeArm` — the same implementation that judges
the gate and the term, so the bar cannot drift between arms. The `shipped` row is a check rather than a result: a
replay that does not reproduce the published number makes the reading `unmeasured`, and the CLI exits 3. So does a
row whose chain carries no surprise map.

### 18.5 The debts this does not pay

- **One channel set, one null.** The price of a fire is the corpus's rate for that channel; nothing here says the
  rate is stable across the corpus's fault types, and a channel that fires rarely *because* its service is rarely
  the source is a confound this arm cannot separate from evidence.
- **The margin is still zero and still underived.** The two numbers are on the same axis now, which is what makes a
  strict comparison exact, but the pass still has no error bar on either side.
- **`σ` is the profile's 3 and was not swept.** A wider band shrinks both the fires and the rates that price them,
  and the arm's optimum could sit at a band the profile builder never considered.

### 18.6 The reading (run `44045839933`)

```
  rows=1422 replayable=1422 unmeasurable=0 disagreements=0 scored=1422
  moved=15 (the surprise map changes the published head)  sigma=3
  arm=fusion    top1=1141
  arm=shipped   top1=1156 +15/-0
  arm=surprise  top1=1155 +16/-2
  decisions inverted=226 no-failed-interface=552 unmeasured=0 not-larger=59
  opened    inverted=1 no-failed-interface=0 unmeasured=2 not-larger=130
  H7-surprise: FAIL — 2 loss(es) against a requirement of 0
```

The replacement did **not** sell the shipped arm's cases, which is what §18.3 expected it to do: it lands one case
below at `1 155`, with `+16 / −2`. The two measurements disagree about 282 pairs — 149 that latency inverts and the
all-channel map does not, 133 the other way — and agree about 1 407 of 1 422 heads. Reading every channel turns
**561 `not-larger` refusals into 59** and 130 of those become inversions, and fifteen heads move for it.

So the ceiling §289 named is real and it is not where the ranking is decided: a pair inversion changes the head
only at the top of the order, and at the top of the order the channel that speaks is the caller's own response
time. The 130 opened pairs are further down, where an inversion is a rearrangement the answer never sees. That is
§17.6's distance lesson arriving from the measurement's side instead of the spend's.

The arm is refused as a replacement, which is what it was pre-registered as. The union now has a measured
population to be priced against rather than a hope, and §301.4 of the register records why it is the next
pre-registration and not this one.

## 19. The record read at case scope (iteration 300) — one absence, two statements

Five arms have now priced this pass: the interface record (§12), the residual as a requirement (§15.9), the residual
as a term (§17), a different channel set (§18), and now the **scope of the record**. The first four moved a
statistic. This one moves a word, and it is the only arm of the five for which nothing had to be fitted.

### 19.1 The sentence §299 left behind

`§299` read a residual requirement that REPLACES the record:

```
arm=shipped top1=1156 +15/-0
arm=prior   top1=1165 +27/-3      ← refused
```

Nine of the 27 gains are cases the record also fixes. **Eighteen it does not reach at all.** And all three losses
are one edge — `ts-preserve → ts-security`, in three cases — where the fault is at the **caller**, the callee moved
further out, and the record's refusal was **correct**, because no call on that edge failed.

Those two halves are the same absence read two ways:

- the case recorded failed calls *somewhere*, and this edge is not among them. A call passed between these two and
  completed. That is evidence the failure did not travel over it. It is a **veto**.
- the case recorded no failed call *at all*. The record is silent about the case, which is a fact about the
  recording and says nothing about this pair. Treating it as a veto is what discards the eighteen.

The shipped rule cannot tell them apart, at no cost, because it never needs to: under a rule that requires the
record, both absences lead to the same refusal. `ContainmentOrderInput.recordScope` is the difference, and it is a
scope rather than a threshold — no number is being tuned, one word is being disambiguated.

### 19.2 What the arm is, and what it is not

```
scope 'edge'  (default, every published number)   absent → refuse, whatever the case recorded
scope 'case'                                      absent → refuse when the case recorded failed calls anywhere,
                                                          fall through to the measurement and the residual
                                                          when it recorded none
```

The measurement, the inequality, the margin of `0`, the sweep and its adjacency are untouched. The residual is the
same cross-fitted prior the `prior` arm carries, and its threshold is the shipped `0`. **Nothing is fitted**, which
is the reason this arm is worth a dispatch: an improvement here cannot be a coefficient that happened to fit the
corpus, and it cannot be re-tuned into a better one.

The two requirements are never consulted for the same pair. The record decides where it **speaks**; the residual
decides where it is **silent**. That is the opposite shape from the `prior` arm, which replaces the record and
therefore prices the residual on the pairs the record had already refused.

### 19.3 `record-silent` is a decision, not a note

`ContainmentDecision` gained one member and it is the only one that is an **inversion** rather than a refusal. Its
existence is the point: `no-failed-interface` used to mean both "the record says a call completed here" and "the
record says nothing here", and the two only became distinguishable when a walk was allowed to act on the
difference. A census that kept them merged would report the arm's whole population inside a counter that reads as
a refusal.

`decisions` also gained the column on the two walks that cannot reach it — the gate's and the surprise's. Their
counters are a `Record` over the union, and a missing key would make the census silently partial the day a scoped
arm is recorded through it.

### 19.4 The family's ceiling, which is a proof and not an estimate

The sweep visits adjacent positions from the top and never revisits one. A candidate therefore ascends **exactly
one place**, and only the pair at positions 0 and 1 can change the published head. Three consequences, and the
third is the one that reframes the whole axis:

1. Any containment arm's published head is either the fusion's first candidate or the fusion's second.
2. The set of cases any arm on this axis can convert is **countable off the artifact**: fusion misses whose
   accepted answer sits at position 1, whose pair carries a call edge, whose two sides are both measured, and whose
   lower side is further out by more than the margin.
3. §17's long-range promotions could only ever lose — `rank=3 +2/−5`, `rank=4 +0/−2`, `rank=5 +0/−3` — and §17.6
   explained it as a distance effect. The distance effect is real and it is a corollary: a sweep cannot promote
   past one place, so an arm that re-sorts by a score is pricing a different mechanism, and the mechanism it left
   could not have carried the cases it wanted.

The study prints this bound as `ceiling at-second=… reachable=… unreachable=… shipped=… veto=…`, so every `top1`
on this axis is read against the number of cases it is spending rather than against 1 422.

### 19.5 The debts this does not pay

- **The silence is one bit.** A case with no record anywhere is treated as uniformly informative about nothing.
  There is no reading of *why* it is silent — a fault that corrupts a response code generates errors its callers
  log, and a fault that corrupts a method may generate none — and that difference is exactly the `ReplaceCode` /
  `ReplaceMethod` mass §301 identified.
- **One prior, one threshold, still underived.** The residual's threshold is `0`, which is a statement that any
  positive coupling is enough. §297 showed the statistic is bounded by its marginals; nothing here addresses that.
- **The margin is still `0`.** The two excursions are on one axis and the comparison is exact at zero, but neither
  side carries an error bar.

### 19.6 The first reading measured a conjunction, and the census said so before any diagnosis did

Run `44101598335` returned:

```
  arm=shipped   top1=1156 +15/-0
  arm=veto      top1=1150 +9/-0
  decisions inverted=99 record-silent=11 no-failed-interface=458 unmeasured=12 not-larger=238 prior-absent=20
```

The arm came out **below the arm it was built to improve**, which is a result and not a bug in itself. The census
is what made it diagnosable in one line: a case-scoped walk is a **relaxation** of the edge-scoped one — it can
invert every pair the shipped walk inverts and some besides — and it inverted **99** where the shipped walk
inverts **242**. A relaxation cannot be stricter, so the walk was not the walk.

It was not. `inspectContainmentOrder` consulted `prior` after the record check, so a pair the record **licensed**
was then asked whether its two ends co-move. That is the correlation statistic sitting on top of the causal one —
precisely the conjunction §299 refused when it priced the residual as a *replacement*, reintroduced in a narrower
scope where it looked like diligence. The condition is now `prior !== undefined && !licensed`.

Two failures of the test suite let it through, and both are worth recording because they are the same failure:

- `containment-order.test.ts` asserted the conjunction **as an invariant** — "a requirement beside the interface
  record, not an alternative to it" — for a configuration no arm had ever run. A test can be green and be a
  specification of the defect.
- `containment-replay.test.ts` compared the veto arm with the shipped one under a prior that **admitted** the
  edge. An admitting prior cannot expose a conjunction: both branches agree. An empty one can, and that is what it
  now uses.

The corrected reading is §302 of the register. What the same artifact established independently of the defect is
§19.4's bound, and it is the more important half: `at-second=43 reachable=21 unreachable=22 shipped=15`.

### 19.7 The corrected reading (run `44113097089`), and the axis closing at 15 of 21

```
  rows=1422 replayable=1422 scored=1422 disagreements=0 record-free=200
  arm=fusion    top1=1141
  arm=shipped   top1=1156 +15/-0
  arm=veto      top1=1156 +15/-0
  decisions inverted=117 record-silent=11 no-failed-interface=458 unmeasured=12 not-larger=238 prior-absent=2
  ceiling at-second=43 reachable=21 unreachable=22 shipped=15 veto=15
  H8-veto: FAIL — Top@1 1156 does not exceed the shipped 1156
```

With the conjunction removed the arm is a relaxation again, and it behaves like one: **it never loses a case the
shipped walk gets right**, and it ends at exactly the shipped number. Eleven pairs were inverted on silence, and
**not one of them changed a published head.**

The census says why, and the answer is not about the record at all. Of the pairs inside the 200 record-free cases,
**238 of 263 were already refused by the measurement** (`not-larger`), 12 by `unmeasured`, 2 by an unfitted prior,
and 11 qualified. Where the record is silent, the excursion rule has usually already spoken: in a case with no
failed call anywhere, the candidate at the top of the order is normally further outside its own band than the
callee below it. The silence was never the constraint. **The measurement was.**

So the axis closes on a number rather than a verdict:

| population | cases |
| --- | ---: |
| fusion misses (1 422 − 1 141) | 281 |
| … with the accepted answer at position 1 of the recorded order | 43 |
| … whose pair the rule can physically qualify | **21** |
| … the shipped pass converts | **15** |
| … any other arm on this axis converts | **0** (the veto's 6 candidates are refused because the case's record exists and does not include the edge) |

Twenty-one is the ceiling of every arm on this axis, shipped or not, and it is a property of the sweep's geometry
rather than of any statistic. The shipped pass already converts **71 %** of it. The remaining six are exactly the
territory §299 priced: cases whose record exists, does not include the edge, and whose residual would admit a
promotion — the population that produced three losses for eighteen gains and was refused. There is nothing left
here that a rule can reach.

### 19.8 The instrument defect this exposed

`inverted=117` is the veto walk's own census. **The shipped walk's census was never printed** — the H2 arm printed
the gate's, H7 the surprise's, H8 the veto's, and the control every one of them is read against had no line. §301
quoted `242` for it, and that number was a *derivation* (the gate's 198 plus the 44 pairs the residual stopped)
rather than a reading, valid only if the two walks shared a cascade — which they do not, because inverting one pair
changes every adjacency below it. A control with no census of its own is the reason a claim about it could not be
checked.

That line exists now: the reading above is from the window before it, and the report prints a `control` row beside
`decisions` from the next dispatch onward. Every transcript in this document before §19.7 is missing it, and that
is a statement about when the instrument was built rather than about the walks.

## 20. The pass that was on and inert (iteration 304)

Every number in this document was taken on a run that supplied `--fault-free-profile`. The pass **requires**
it: `latencyExcursions` returns an empty map when the profile is `undefined` or empty, and
`inspectContainmentOrder` opens with

```ts
if (order.length < 2 || input.excursions.size === 0 || input.edges.length === 0)
  return { order, verdicts };
```

so with no profile the pass returns the ranking **unchanged**, silently. That is correct as a refusal — a pair
whose excursions are unmeasured must not be inverted, and §6 is the argument — but it made the pass's
requirement invisible in the artifact.

### 20.1 What that cost

The 1 422-case corpus was run twice from the same commit (`73dc662`), the same corpus (all seven shard
`sha256` digests match `manifest.json`), the same Node build and the same command line, differing in one
thing: one run passed `--fault-free-profile`, the other did not.

|       |    with the profile |      without it |
| ----- | ------------------: | --------------: |
| Top@1 | **1 156 (81.29 %)** | 1 141 (80.24 %) |
| Top@3 |     1 228 (86.36 %) | 1 228 (86.36 %) |
| Top@5 |     1 249 (87.83 %) | 1 249 (87.83 %) |

Fifteen cases, 1.06 pp, and **Top@3 and Top@5 are identical to the digit** — every one of the fifteen is a
`rank 1 → rank 2` swap, so the truth never leaves the third position. The per-channel scores are
_bit-identical_ on both runs: the difference is not scoring, it is the permutation the pass applies after it.

### 20.2 Why the artifact could not say so

`fse26-run-config.ts` excluded the profile from the recorded configuration on this reasoning:

> the artifact's whole content is determined by the profile FILE and by the two fields that ARE reported
> (`faultFreeWeight`, `faultFreeSelection`), so a record carrying the data would be a multi-megabyte copy of a
> file the run never quotes.

That is true of **one** consumer and false of the other. The fault-free _term_ reads the profile and is
described by `faultFreeWeight`; the containment _order_ reads the same profile for its excursions and is
described by nothing. With the shipped weight of `0` the first consumer is silent, so the two runs above were
byte-identical under every reported field — the same `config` block, the same `Config:` line — and read 15
cases apart. The record was complete by its own test and incomplete in fact.

The exclusion also had the right instinct pointing the wrong way: a **path** is a location, which is why
`dataDir` is not reported, but a **digest** is a content identity, and the whole failure was that two runs
which scored against different bands (or against none) looked like one configuration.

### 20.3 The two fields, and what they change

| field                    | values                  | what it settles                                                                            |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------ |
| `faultFreeProfileDigest` | 16 hex chars, or `null` | which band the run was scored against; `null` is a state, not a missing value              |
| `containmentExcursions`  | `measured` \| `absent`  | whether the pass could speak — `containmentOrder=true` says only that it was **asked for** |

Both are on the `Config:` line and in the artifact's `config` block, both are on `REPORTED_CONFIG_FIELDS`, and a
run in the silent state now also prints a one-line warning naming the measured cost. The pair is deliberately
not folded into one field: `containmentOrder` and `containmentExcursions` answer different questions, and the
whole defect was a run where the first was `true` and the answer to the second was `absent`.

`absent` is derived, not observed: it is `!(containmentOrder ?? DEFAULT_CONTAINMENT_ORDER) || digest === null`,
and reading `undefined` as "off" would have reported `absent` for a run that asked for nothing and got the
shipped behaviour — a second instance of the same class of mistake, inverted.

### 20.4 The general rule this earns

**A recorded configuration must name every input whose absence changes the ranking, not only every input the
command line carries.** The fault-free profile is the first input of this project that arrives as a file
rather than as a flag, and the artifact had a rule for flags that did not extend to it. The rule is now stated
where the exclusion is made (`fse26-run-config.ts`), and the digest is the mechanism: an input you cannot
serialise into the record, you still identify in it.
