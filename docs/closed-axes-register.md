### 341 The arm's own reach: 74 of 94 published misses never queried the causal service

The queue 340 re-priced still described its misses by where the truth sits in the **engine's** ranking, which assumes a
seeded arm. The shipped arm is not seeded — its artifact says `seeded: false` on all 1 422 rows — so `SEED_WIDTH` is a
width an experiment would set and the class names describe the **pipeline's** reach. Read against the arm's own `calls`
column instead: **of the 94 published misses, 74 (78.72 %) never queried the causal service at all**, and 20 queried it
and still missed (102 / 135 on the arm's own answers). Against the corpus that is **5.20 pp reachable** against
**1.41 pp of reasoning residue**.

Four facts make those 74 a reach population rather than a hard one: the culprit is a key of the case's own `metrics`
map **and** an endpoint of its own `traceEdges` in **all 74** (51 of 74 also carry log lines for it); the arm stops with
**4.99** of the **five** tool calls the loop can execute spent over **1.888** distinct services, in a corpus carrying ~50 services a
case; in **40 of the 74** the culprit's id is already somewhere in the recorded transcript (a lower bound — a row
keeps its last 2 000 characters); and the 74 span six fault families, so this is a policy failure rather than one
injector's blind spot.

**What a stated schedule already reaches.** "74 reachable" is not a plan: the budget is five executable calls (see
342, which corrects the "ten" this paragraph first carried), so the question is how many of the 74 have the culprit
inside the first five a stated ordering would put first. Against the ordering the pipeline already computes, **29 of the
74 (39.2 %) sit within the engine's top five** and 40 (54.1 %) within the top ten (16 at 11–20, 18 beyond 20); over all
94 misses, 46 and 58. A schedule that spends five calls on the engine's first five candidates would therefore have
queried the culprit in 29 cases — **2.04 pp** — for no extra token and no widening; ten calls reach 40 (2.81 pp) at a
second model call per case.
The two forties are not the same forty: the transcript-named 40 and the top-ten 40 overlap in only 19, so their union is
**61 of 74 (82.4 %)** and the two routes are complementary. This also explains a result carried here as a mystery —
§318 measured a seeded **prompt** as worse than the free arm, and showing a model an order is not the same as ordering
its **calls**.

**Instruments.** `reachCensusOf` / `formatReachCensus` (34 tests, `100/100/100/100`) count three disjoint buckets —
queried, unqueried, **unrecorded** — so an absent `calls` column never reads as a measured absence, and the row states
the configuration it was read on. `Chance@k` / `Lift@k` (56 tests, `100/100/100/100`) print the evaluator's own two
columns, taken from its code: `Chance@5` is the mean of `min(k, n)/n` over the cuts (so `0.70` on a four-service cell,
not `1.00`) and **equals our `floor`**, now an asserted identity per cutoff; and **`Lift@5` is
`average − chance_average`, an excess and not a multiple**, which is why `lift` is a field and a test asserts the ratio
is not it. Reconciling the two exposed a floor defect: `absent` was documented "unreachable at every cutoff" and
charged `uniformFloor(k, pool)` anyway — an answer outside the pool cannot be found by any order over it, so
`chanceAt(k, pool, inPool)` now returns `0` there and the three row states (in-pool, absent, unmeasured) are three
different readings.

**The law, beside 340's aperture.** An engine-side change converts only on cases the arm gets wrong and no rule settles
(135, **9.5 %**); an arm-side change converts on cases the arm never investigated (74, **5.2 %**, evidence already in
the case file). The levers are disjoint, and the second is the larger one.

**Field check.** RCAtlas (late Oct 2026, 90 incidents over eight datasets) publishes the ordering this register argued
from the inside — plain harnesses 65–77 % PR@1 against 16–53 % for five published SOP agents and 6–39 % for
statistical/causal methods, every Pareto-optimal cost/time point a simple harness — and names the mechanism ("hard-coded
investigation paths skip the decisive evidence"), which is our 74 seen from the other side. CARE-PO finds 82.8 % of
agent trajectories carrying a removable call (68.0 % of calls removable), which — since the arm has no unspent half
(see 342) — prices *choice* rather than slack: which five calls are spent is the policy, rather
than defective. SRE-1 puts a process-scored competitor in production (38.8 % single / 71 % ensemble pass, −37 % cost).
DecompRCA v2's "retrieval nearly solved (98–100 %)" is our `abs 0` measured independently, and the 74 says the
bottleneck is *selection*, which its decomposition does not separate.

Full record: `arm-reach-341.md` in this repository and `docs/arm-reach-341.md` in the code repository; the iteration
report is `PROGRESS_2026-11-24m.md`.

### 340 The queue's ¥21 was never a measurement, and the weight it guarded is refused

Two queued arms — `--self-anomaly-weight 0.5` and `fingerprint_top_k = 22` — carried **≈ ¥21 each**. Both figures are
`¥0.0147 × 1 422`, the price of ONE full-cloud arm dispatch, applied to changes that never reach a cloud call. The
engine is **¥0.00** per case, and `fingerprintTopK` is not even engine-side: `fse26-run-config.ts` states that it "sets
the width of the PRESENTATION dump and leaves the published ranking at `analyze(graph, 5)` … the ranking is computed
before the field is read". A field read after the ranking exists has a price of zero by construction.

The number came from one sentence in `term-marginal-338.md` §6.2 — *"the arm's answers were produced from the shipped
engine, so the published 1 328 cannot be verified without a dispatch"* — and that sentence contradicts the arm's own
protocol, stated in three places: **"Seeding is a SEPARATE arm and is off here, so the free arm means free."** The
artifact agrees: five retrieval tools over the case's own telemetry, with `engineRank` written *beside* the answer as a
comparison rather than read by the loop. A weight cannot move an answer the weight never entered, so the published
surface is a **join** of two artifacts that change with it (`per-case`, `terms`) onto two that do not (`answers`,
corpus walk).

**The instruments.** `benchmarks/src/surface-diff.ts` (27 tests, 100/100/100/100): a repair and a break are two
populations, two files with different case sets are refused rather than scored on their intersection, a duplicated id
is refused, and the held-out folds are assigned by the module. `run-miss-ledger.ts` gained `--surface-out`.

**The defect building it found.** The certainty guard reads `top1Score − top2Score`, and the stored artifact every
earlier surface reading was taken on carries **neither column** — so the guard printed `1 308` not because it was idle
but because it was never evaluated. `guardCensusOf` / `formatGuardCensus` (`engine-certainty.ts`, 33 tests,
100/100/100/100) make those two states different lines, and the census now reads `evaluated on 1422 / 1422 cases,
margin measured on every one` for both arms of this iteration.

**The reading, at ¥0.** Engine `1 156 → 1 159` (81.3 % → 81.5 %), which is §338's row to the case. Published surface:

| surface | shipped | 0.5 | delta | repairs / breaks | folds |
| ------- | ------: | --: | ----: | ---------------: | ----: |
| arm answers | 1 287 | 1 287 | +0 | 0 / 0 | +0 / +0 |
| + first hop | 1 308 | 1 308 | +0 | 0 / 0 | +0 / +0 |
| **shipped** | **1 328 (93.39 %)** | **1 328 (93.39 %)** | **+0** | **0 / 0** | **+0 / +0** |

Four of the five engine repairs and both breaks are **masked**: a case the arm already answers correctly cannot be
repaired again, because the surface does not consult the engine on it. The one unmasked repair is the case a promotion
rule exists for, and that family is priced at `−52 / −44 / −152 / −70`. The weight is therefore **refused** on the
reading the ¥21 was meant to buy.

**The law that re-prices the queue.** An engine delta converts to a product delta only on cases the arm gets wrong and
no rule already settles: **135 of 1 422 = 9.5 %**. A weight worth `+3` on the engine is worth `0…3` on the product,
expected conversion under a third. Engine Top@1 is not a proxy for the shipped number. Breadth's 28 addressable cases
are 21 % of that aperture and the reasoning residue's 37 are 27 %; a twentieth weight is worth a fraction of either.

Full record: `cost-audit-340.md` in this repository, and `docs/cost-audit-340.md` in the code repository.

**The field check, and the column it forced.** Four movements this week, in full in `field-survey-340.md`:
DecompRCA reached **v2 as an accepted NeurIPS'26 paper** (`arXiv:2609.36686v2`) whose microservice half reports
retrieval "nearly solved (98–100 %)" and whose graph result is that no learned causal graph "clearly beat[s] the best
statistical baseline" — both of which this register reached first, from a different instrument, which is the strongest
corroboration it has recorded; **RCAEval shipped the decomposition as an official flag** (`--report-decomposition K`,
printing `Retrieval@K` and `Rerank@1`) together with an opt-in chance floor (`--report-chance`), so a reading taken
only on `Avg@5` is no longer comparable with the field's own table and our `abs 0` must be printed in their two
numbers; **Alibaba's BRiSE family** (RCA-100: 103 cases, six modalities, a 3–4-step causal chain with **661 numeric
checkpoints**; AIOps2025: 400 cases) opened a **process-scored** front whose `Reason` pillar grades the transcript —
a thing this corpus cannot score, and whose two published findings ("fault injections ≠ fault cases", and 62.5 % of
cases needing two or more modalities) are this register's `unwidenable 20` and its single-channel refusal under other
names; and **Greptime's Agent RCA Bench** measured the query interface as a variable (105/168 correct against 130/168,
$1.09 against $0.59 per investigation), which is external evidence for the single-surface design `buildTelemetry`
already uses. The first of the four was actionable inside this iteration and is done: `decompositionAt` and
`formatDecomposition` in `benchmarks/src/cutoff-accuracy.ts` print the split under every cutoff table, and the split is
an **identity** — `AC@1 = retrieval × rerank` at every `k`, asserted per cutoff — rather than a second measurement.

### 325.15 The interface witness charges the CALLER, and that is 42 cases

`325.14k` closed the service-granularity route to the 41 child-refused entry cases and named the next unit: the fault
is applied to an **edge**, so the distinguishing fact is *which interface* changed shape. The corpus has carried the
instrument for that reading since iteration 290 and the arm has **never been shown it**: `buildTelemetry` copied
`caller/callee/failed/baseline` off `FaultFailedEdge` and dropped `novel`.

`novel` is the part of an edge's failures whose request **shape** — `(route, method)` as the callee recorded it — the
edge had never carried before the injection. The channel's own docstring is the whole argument: *a callee that broke
rejects nothing, it fails the requests it has always served, while a CALLER that corrupted its request sends a shape
the callee has never been asked for.* `failed − baseline` is identical in the two situations, which is why every
earlier reading of this channel — all of them counts — could not charge either end, and why it read `325.14k`'s 602
triggers at 0.068 precision.

**The rule.** Answer with the caller of the strongest novel interface, skipping a caller that is a **root** of the
call graph: a root is the traffic generator, its request shape is a workload rather than a service's interface, and
the corpus never labels it — it is the strongest witness in **74 of the 203** cases that carry the channel. Nothing
else is read: not the size of the failing edge, not either end's error rate, not the latency.

| reading (¥0, through `applyResolver`) | none | entry-prior | **edge-novel** |
| --- | ---: | ---: | ---: |
| fires | 0 | 0 | **42** |
| repairs | 0 | 0 | **42** |
| breaks | 0 | 0 | **0** |
| Top@1, replay | 1 222 | 1 222 | **1 264 (88.89 %)** |
| Top@1, dispatch `44915289950` | 1 222 | 1 222 | **1 263 (88.82 %)** |

The dispatch settles it: `answeredBy=interface` is **42** rows, every one correct, on a run whose own drift against the
324 answers is −1 case (`repairs 140 · breaks 33 · precision 0.809 · retention 0.971`, 11 410 480 + 52 193 tokens,
**+0.04 %** the token cost for +41 net cases).

`entry-prior` reads 0 fires here because the 324 dispatch already shipped it: a replay that fired again would have
counted the same repair twice, and that idempotence is the check that the two columns are one population.

**The ceiling it was built for.** Of the 41 cases whose truth is the entry and whose children rose anyway, **39** are
repaired — exactly the `HTTPRequestReplaceMethod` block. The two left are `NetworkPartition` and `NetworkBandwidth`,
families on which the channel does not speak. The rule is invariant to all three tie-breaks tried, and **no case in
the corpus carries two distinct novel callers**, so "the caller" is not a second decision wearing the instrument's
name: it is the instrument.

**And the inverse rule is refused.** The 37 remaining witnessed cases carry novelty **arriving at** the entry with none
leaving it. "A shape the entry has never seen means the entry" fires 37 times and is right **15** times — **0.405**
against the 0.813 a rule needs to beat on this residue. Recorded rather than dropped, because it is the natural next
sentence after the one that worked and the corpus says the two directions are not symmetric.

**What it changes about the next axis.** Three of the four instruments that have ever moved this arm (`lag`, the entry
prior, now the witness) are **forced relations enforced inside the resolver**; the one that was merely displayed moved
nothing (`325.14l`). The remaining 158 misses are dominated by `HTTPResponseReplaceCode` (39) — the response-side twin
of this iteration's instrument, where the request shape is unchanged by construction and the same "who corrupted it"
question needs an **absence** reading: a failed edge whose callee shows no error of its own.

### 325.14i The fall is real, universal, and therefore not a localiser

Iteration 323 pre-registered one rule on one new field: a settled answer whose own non-symptom channels **fell** lost
the work it was being sent, so it is a victim and the front door is the source. Priced at ¥0 over the third full
dispatch (`44874383089`, 1 422 cases, telemetry rebuilt per case from the corpus, the rule
applied through `applyResolver`, the same function the loop calls), the rule **loses at every threshold**, and the
best available setting is the one at which it never fires.

| κ (trough standardised) | moves | Top@1 | net against the shipped arm |
| ---: | ---: | ---: | ---: |
| 0 | 1 052 | 311 | −912 |
| 300 | 416 | 837 | −386 |
| 1 000 | 221 | 1 010 | −213 |
| 1 500 | 0 | 1 223 | 0 |

| κ (pre-median vs post-median) | moves | fixed | broken | net |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 1 052 | 41 | 953 | −912 |
| 200 | 255 | 8 | 237 | −229 |

**Two estimators, one verdict.** The trough is the minimum of the post-window and is therefore noise-sensitive in a
way the peak is not — with n samples the expected minimum sits below the median even when nothing moved — so the same
sweep was run on the level shift, which is robust to a single noisy sample. It fails in the same direction and by a
similar amount, which rules out the estimator as the cause.

**The cause is one number.** Every one of the 1 422 effective answers carries at least one non-symptom channel whose
post-window median is at or below its pre-window median: **throughput fell for every service in every case.** An
incident costs the whole system work, so "lost traffic" is a property of the INCIDENT and not of the culprit, and a
quantity that is present at every service cannot choose between services. This is 322's base-rate law in a new place —
the rule admitted **74 %** of the corpus to answer a question about **13 %** of it, and no threshold repairs an
admission rate 54 points too high.

**What survives is the target's measured ceiling.** Of the 41 entry-truth cases the entry prior refuses because a
callee rose, the arm answers **0** and the engine answers **0**, so a working rule is worth **+41 → 1 264 (88.9 %)**.
39 of them are `HTTPRequestReplaceMethod`. The per-case probe also found why nothing at the entry can reach them:
**the entry has no `/error/i` channel in 1 053 of the 1 054 cases that have a rising callee.** *Corrected below: the
channel exists and the reading does not.*

**Correction, same iteration.** The sentence above was the first probe's reading and it was wrong. The entry
**carries** an error-rate channel in **1 418 of 1 422** cases; what is absent is a *standardisable* reading of it,
because that channel's pre-window median is zero in 1 053 of the 1 054 cases with a rising callee and `surpriseOf`
refuses a zero level by design. What the entry genuinely never does is **log**: **0 of 1 422** cases carry an
`ERROR`/`FATAL` line at the front door, so `TOOL logs <entry>` always answers that there is none. The front door is
therefore visible only as an **unstandardised rise** (0 → X) and as a **failed-interface record** — the two
instruments `325.14g` and `325.14h` refuted in their respective forms — and that is why an arm which reasons from
logs systematically under-attributes to the entry. The corrected fact is the stronger one: it is not that the front
door has nothing to say, it is that the tools can only hear it in the two registers this programme has already
refuted.

### 325.14j The collapse axis was selecting on the peak and calling it a fall

The one defect the new field exposed, and it was in the tools rather than in the model. Both `metric` and `fleet` carry
a "falling" section, added when the prompt first asked the arm to take a collapsed service seriously. Both selected it
with `delta < 0`, and `delta = peak − baseline`, so the test was **`peak < baseline`**: the section listed the series
that **never rose**, and could not list the shape a victim actually has — a service whose arrivals spike on retries and
then collapse, which has `peak > baseline` and a trough through the floor.

The repair is `fall > 0` for selection and `byFall` for ordering, written the way `bySurprise` is (standardised fall
first, absolute fall second, label last). The falling lines now print `low=<trough>`; the rise lines are byte-identical
to iteration 322's, so the dispatch that follows can attribute any difference in the arm's answers to this axis alone.

Three tests pin it and all three fail against the previous selection: a rise-then-collapse series is listed, it leads a
shallower fall that merely never rose, and the trough appears on the falling lines and not on the rising ones.

### 325.14k The entry boundary is uninformative at service granularity, and that is a granularity answer

Three candidates were priced at ¥0 over the same artifact to reach the 41 child-refused entry-truth cases (the arm
answers 0 of them, the engine answers 0, so a working rule is worth +41 → 1 264, 88.9 %). All three read the boundary
the fault was applied to, and all three fail on precision:

| rule | fires | on entry-truth | fixed | broken | precision | net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| the entry's own error rate rose | 596 | 41 | 41 | 518 | 0.069 | **−477** |
| the entry's rise ≥ its callees' rise (HTTP family only) | 174 | 7 | 7 | 160 | 0.040 | **−153** |
| a failed interface lands on the entry | 602 | 41 | 41 | 522 | 0.068 | **−481** |
| the entry rose **and** an interface into it failed | 596 | 41 | 41 | 518 | 0.069 | **−477** |

**The signs are right and the precision is twelve times short.** The 41 do carry a signature — the entry's own HTTP
error rate rises in **41 of 41** of them at a median of **8.75 points**, against **555 of 1 011** at a median of
**1.77** for the rest — but every rule that keys on *any* rise admits 55 % of the innocents, and the base-rate law
needs a precision of **0.813** on the admitted set to break even. Precision 0.069 does not fail because a threshold is
mis-set; it fails because the evidence is a **level**, and a level is present on both sides.

**This closes the service-granularity route to the 41 and names the next unit.** The 39 `HTTPRequestReplaceMethod`
cases are a fault applied to an **edge**: the method on a specific interface was replaced, the callee then rejects the
call, and the callee's error rate goes to **100 points** (its median across the whole candidate set is 100, which is
why `entryChildErrors > 0` is true there). At service granularity the entry and its callee look alike — one rose 8.75
points, the other 100 — and the distinguishing fact is *which interface* changed shape, not *which service* moved.
That is the unit `InterfaceRCA` (HR@1 92.57 %) builds on, and it is the only route this programme has left to these 39
cases.

**Every surviving rule in this register is relational and every refuted one is marginal.** `lag` reads an order, the
cone reads a containment, the entry prior reads a non-existence ("nothing below it rose"). The fall, the magnitude
comparison, the failure topology and the entry's own rise all read a level, and all four lose. That is now strong
enough to be a screen rather than an observation: a candidate should be classified before it is priced, and a
level-reading candidate should be expected to fail.

### 325.14l Showing the model a fall changes nothing, which says where the next instrument has to act

Iteration 324 made the collapse axis correct — selection by `fall`, ordering by `byFall`, the trough printed on the
falling lines — and pre-registered the hypothesis that an investigator who can see a service lose its traffic will stop
answering that service's caller. One dispatch (`44890115507`, ¥23.23) and one ¥0 replay that reproduces it to the case
(1 222, 90 renames) say it does not:

| reading | 44874383089 (before) | 44890115507 (after) |
| --- | ---: | ---: |
| Top@1 | 1 223 (86.01 %) | 1 222 (85.94 %) |
| `lag`, re-scored | 1 173 | 1 171 |
| misses naming a **direct callee of the truth** | **72 / 199 = 36.18 %** | **73 / 200 = 36.50 %** |
| tokens | 11 343 352 + 52 238 | 11 406 428 + 52 111 |
| rounds per case | 6.00 | 6.00 |

**The comparison is not exact and the file had claimed it would be.** The tools are deterministic; the **endpoint is
not**. The ungated arm reads **1 067** here against **1 050** before, and the stop distribution moves from
`{answered 1 256, rounds 166}` to `{answered 1 273, rounds 149}`, so ±10 cases is the run-to-run band and the −1 is
inside it. What is *outside* any band is the overshoot rate: 36.18 % and 36.50 % are the same number measured twice.

**The consequence is a design rule.** The two instruments that worked in this programme **enforce** a relation — `lag`
refuses an answer unless the candidate logged first, the entry prior refuses unless nothing below the entry rose.
This iteration **displayed** a relation instead, and display did nothing. Evidence the tools carry is not the same
thing as evidence the loop acts on, and the next instrument has to act: the interface record for the 39
`HTTPRequestReplaceMethod` cases, applied as a check inside the gate rather than as a line in a prompt.

### 333 The confirmation costs nothing: 37 rows are answered by the door and 1 385 are already paid for

The plan's first item was a full-corpus dispatch (**≈ ¥21**) to turn **91.98 %** into a measurement, with **≈ ¥100**
behind it. Both were read again at **¥0**, and the answer is structural rather than a discount. The full reading is
`cost-audit-333.md`.

| bucket | R1 | B | does producing this answer read a model? |
| --- | ---: | ---: | --- |
| repaired — moved to the door, wrong before | 28 | 29 | no |
| broken — moved to the door, right before | 7 | 9 | no |
| moved to a door that is not the truth | 2 | 0 | no |
| moved inside a multi-service truth set | 0 | 0 | no |
| untouched — the paid answer stands | **1 385** | **1 384** | already paid for |

`doorAttribution` names the case's **entry service** from three of the case's own columns and is applied **last** in
`applyResolver`, so the 37 changed rows cost no completion — a dispatch over them would pay for an answer that is then
discarded. When the rule is silent it returns `null` and `applyResolver` falls through to the branch it always took, so
the 1 385 untouched rows are the same program on the same input as the run that produced the paid answers; the `null`
reproduces-324–331 test is that check, and it passes.

**The only residual is model drift**, which belongs to the endpoint: a 50-case stratified re-dispatch bounds it at
`50 × ¥0.0147 ≈ ¥0.74` and reports a reproduction rate. Optional. The rest of the queue — retrieval (74 misses, truth
at engine rank 6–44), resolver scope (10 cases), RCAEval nine cells — is ¥0, because the engine is deterministic and
calls no endpoint, so widening a seed cannot trip the Zhipu 429 that paused the embedding benchmark. Process-level
evidence is ¥2.94 and is publication-only.

**A counting correction, found while building the replay.** The runner's per-bar table counted *"the paid answer was
wrong"* as a repair — 30/7 at bar 50 where the instrument reads 28/7, the two extra rows being the "moved to a door
that is not the truth" bucket. The table now reads `replaySurface`, so the table and the surface line cannot disagree.
The register's +21 came from the instrument and was always right.

### 335 The 135 misses are four failures, and only one of them is a budget

Iteration 334 split the misses at **¥0**: **20** lost at the rank one (precedence), **41** seen but lost (reasoning),
**74** retrieval block (breadth), **0** absent (pool). The pool direction is closed outright — the engine's candidate
set is complete — and breadth buys only visibility: widths 5 / 10 / 22 / 44 make 61 / 75 / 99 / 135 misses visible. The
full reading is `retrieval-block-334.md`.

Two bars a deployed pipeline could read are both **refuted**: the gap between the engine's first two candidates reaches
the block at precision 0.115–0.170, and no single term orders it (`stability` 5.4 %, `temporal` 6.8 %) even though the
truth is stronger on both — a difference of means is not a decision rule.

The candidate that survives is a guard on the ENGINE rather than on the answer: *a resolver may not rename a case whose
engine leads its second candidate by more than 1.5*. The front door's harm concentrates exactly there — 12 of 81
overrides wrong, median margin 3.34 against 0.03 on the 69 it got right — and held out it reads **+10 / +10**, precision
**1.000 / 1.000**, a whole-corpus counterfactual of **1 328 / 1 422 = 93.39 %**.

**It is measured and not shipped.** The margin lives in `terms.ndjson`, whose ordering differs from the shipped
ordering on 83 of 1 422 cases; the guard touches 13, of which 12 agree on both candidates. A bar computed on a possibly
different second candidate is not yet the product's bar. The engine already computes the gated scores, and one local
re-run that writes them costs **¥0** and calls no endpoint — on that column the reading either reproduces (ship, +20
cases) or does not (refuse).

### 336 The engine-certainty guard SHIPS: 1 328 / 1 422 = 93.39 %

Iteration 334 withheld a **+20** because its margin came from a score-sorted dump while the product publishes an order
that is not a function of the scores. Iteration 336 closed that at **¥0** in two halves — the pair (`score(published[0])
− score(published[1])`, negative margins legal) and the column (`per-case.ndjson` gains `top1Score`/`top2Score`, and a
local engine re-run reproduces the published order on **1 422 of 1 422** cases, no endpoint, 15 m 56 s) — and shipped the
rule inside `applyResolver`, applied last, behind `ENGINE_CERTAINTY_MARGIN = 1.5`.

Held out: **+10 / +10** (R1) and **+11 / +11** (B), precision **1.000 / 1.000**, flat from bar 1.0 to 2.0 on both folds
of both artifacts. The dump is a second source of the same number, not an approximation: `worst |score − Σ w·slope| =
0.000e+0` over **69 688** candidates. The full reading is `engine-certainty-336.md`.

A grid test requiring the instrument and the product to settle on the same name failed on its first run — `NaN <= 1.5`
is false, so the instrument read a failed measurement as a decided engine — and the instrument was fixed rather than the
product. Still open: the 74 retrieval misses (truth at engine rank 6–44) and model drift (`≈ ¥0.74`, publication-only).

### 337 The 94 misses have names, and no promotion rule buys them

Iteration 337 classified the shipped surface's 94 misses from four pinned artifacts (**¥0**) and priced every rule that
could have bought them. The classes are read from the engine's own `truthRank` — rank among **all** candidates — so the
boundaries are facts about the artifact: **9** precedence residues (the engine led with the truth and a channel moved
it), **37** seen-not-taken, **48** breadth, **0 absent**. Absent is zero for the second time and on a better surface than
334's, so the pool direction stays closed.

Two readings are new. **`unwidenable 20`**: twenty breadth misses were settled by a channel that never reads the seed, so
breadth's addressable ceiling is **28**, not 48 — a widening arm pays tokens on all 1 422 and cannot touch those twenty at
any width. And the channels rank: interface **149 / 149**, prior 474 / 524, model 595 / 668, entry 69 / 81.

**Four promotion scopings, four refusals**, all on the shipped surface: model-agrees-with-engine **1 / 59** (−58),
engine-over-model **6 / 60** (−54), engine-over-any **9 / 181** (−172), engine-over-quiet-answer **1 / 77** (−76). The
engine alone is right on 1 156 and the pipeline on 1 328: the channels earn **+172** by moving away from the engine, and
the nine residues are that trade's price. This is the fourth precedence family refused (331 loudness, 332 head, 336
margin, 337 promotion) and the first with the price printed beside the prize.

**The stability axis of §336 is closed.** The share of the margin carried by its largest single term reads, at bar 0.5,
repairs **0.867 / 1.011 / 1.377** against breaks **0.404 / 1.114 / 1.570** — the breaks' interval contains the repairs',
`separates false`. The reason is structural: every shipped repair carries ≥ **86.7 %** of its margin on `selfAnomaly`, so
a statistic dominated by the theory's own quantity cannot separate good decisions from bad ones. The full reading is
`miss-ledger-337.md`.

Open externally: **CIE**'s conjunctive internal × external score (arXiv:2601.21359v2, 68 % Top-1 over 735 failures, a
proof under arbitrary amplification — ours is additive and only bounded), DecompRCA's system-description prompt
(**+7..+18**), and Cloud-OpsBench's evidence-closure metric (754 cases, 29–33 % of correct answers fail closure).

### 338 What each implementation contributes, and the first competitor with a theorem

Iteration 338 is **¥0**; the surface is unchanged at **1 328 / 1 422 = 93.39 %** (engine alone 1 156, the written sum's
own order 1 073). It adds the contribution table the register has never had and settles CIE's theorem on our pool. The
full reading is `term-marginal-338.md`.

**The ledger** (`benchmarks/src/term-marginal.ts`, 33 tests, 100 / 100 / 100 / 100): five of nineteen terms decide
anything. `log` −341, `podState` −200 (294 cases at **100 %** precision), `lat` −58, `failedEdge` −42, and the kinetic
onset term **+5 with 60 ties** — a *tie-maker*, whose apparent gain is the engine's published order re-entering the
score. Eleven terms are inert (six at weight 0, five never measured).

**The partition a marginal hides**: where any candidate carries a non-zero evidence term, the sum is right on
**1 072 / 1 368 (78.36 %)**; where only the deviation is available, **1 / 54 (1.85 %)**. Drawn on the pool, not the
winner, so it is not circular. On this label space the theory's quantity orders candidates evidence has already
selected; it does not select.

**The classifier was refuted by the data and fixed**: a `decorative` bound read off the corpus-wide median gap called
`lat` decorative, and removing `lat` costs 70 cases on the published surface. Roles are now entirely measured
(`inert`, `load-bearing`, `decorative`, `tie-maker`, `harmful`) and the gap is context.

**The published-surface ladder** (nine local runs, ¥0, baseline byte-identical): `--self-anomaly-weight 0.5` **+3**
(5/2, positive in both folds), `0` +2, `2` **−37** (0/37), `--lat-weight 0` **−70** (3/73), `--failed-edge-weight 0`
**−46** (0/46), `--log-weight 2` −8, `--pod-state-weight 4` −1, the decorative pair **0** (6/6). The kinetic weight
sits just inside a cliff; the two decorative terms are exactly neutral, confirming the ledger's roles independently.

**CIE refused**: three conjunction modes under **four specifications of the external axis** — shipped weights
800 / 800 / 800, the same eight channels at their measured values 492 / 499 / 499, propagated failure only
193 / 199 / 199, downstream `rise` only 190 / 201 / 201 — against the sum's 1 073, on both folds, all four printed by
`run-conjunctive.ts`. The reason is structural — the external axis carries weight `0` in the shipped vector, so the
conjunction ranks the 15 % of candidates that carry it and discards the rest, and handing it a dense axis does not help
(53 893 of 69 688 candidates carry a positive external deviation at row 2 and it still loses 574); adding `rise`,
`temporal` or `collision` at any non-zero weight gives 209 / 60 / 80 cases, flat across 0.02–0.4. An earlier draft's
"faithful mapping" **745 / 748 / 748** is withdrawn: non-reproducible, see the correction below. **Axes opened**: none
from CIE — the axis this register had named as the way back was tested in the same iteration and is the worst of the
four (below).

**Field.** CIE confirmed (735 failures, nine datasets, 68 % Top-1, 8 ms). **DeCoR / RICE-CM** is new to the register
(*J. Cloud Computing*, DOI 10.1186/s13677-026-01009-x): known onset timing assumed, contemporaneous + lagged relational
evidence, reverse PageRank; Avg@5 0.6000 / 0.7040 / 0.4864 on SS1 / SS2 / OB — the first competitor whose protocol we
can reproduce on our own datasets. **RCAtlas**: a simple harness beats five published agent scaffolds on every model
(65–77 % vs 16–53 % PR@1) and reasoning effort buys a few points for up to 7× runtime.

**Correction to §338 (the same iteration), twice.**

*First.* The register closed CIE with three readings and named a fourth as the way back: a **pool-relative** external
axis. That specification was tested in the same iteration, from the dump's unweighted values, without touching the
engine — and it is the worst of the four: **190 / 201** (share of `rise`) and **193 / 199** (share of
`rise + temporal + collision`) against 1 073. The direction is therefore closed by the framework's **premise** rather
than by our coverage: CIE scores deviation magnitude and nothing else, while 541 of our cases are carried by `log` and
`podState`, which a conjunction over two deviation axes cannot see. No engine work is planned for the axis.

*Second, and it is a correction to this register's own arithmetic.* The **745 / 748 / 748** quoted above for a
"faithful mapping", together with its companion claim that only 2 400 of 69 688 candidates carried an external
deviation, **is withdrawn**. That specification was a hand script whose external set is not in the repository, and no
specification the repository can express reproduces it: all **2 048** subsets of the eleven non-internal channels the
dump carries were measured, under two internal definitions, and none yields a `normMin` of 745. Its companion claim is
contradicted outright — the narrowest printed specification still has **38 417** candidates with a positive external
deviation, and the widest **53 893**. The four printed rows replace both numbers, and the reading they support is
unchanged: the conjunction is refused under every specification of the axis, and the trend across them
(800 → 492 → 193 → 190) runs opposite to what a theorem about the external axis predicts. The module now takes the
specification as a parameter (`AxisSpec`) and every reading carries its own specification line, so this class of error
— a number whose axis is remembered rather than printed — cannot recur silently.

### 339 The competitor's metric is our metric (iteration 339, ¥0)

Full reading: `cutoff-accuracy-339.md` and `PROGRESS_2026-11-24k.md`; figure: `assets/accuracy-cost-339.png`.

The register's standing sentence about DeCoR / RICE-CM was *"its metric is Avg@5, ours is Acc@1, so the numbers are
not comparable directly"*. **Closed**: `Avg@k = (1/k) Σ_{j=1..k} AC@j` is a function of the single integer the census
already writes (`truthRank`), so `benchmarks/src/cutoff-accuracy.ts` computes it exactly, prints the uniform-order floor
beside it, and refuses a row whose `truthRank` column is absent rather than scoring it as a miss (nine such rows of 735,
worth `0.9 pp` of denominator).

Read on the census of run `45314745837` at `9588dda4`: pooled `AC@1 91.7 %`, `Avg@5 95.4 %`, floor `26.5 %`. The three
fleets DeCoR publishes on read `Avg@5 ≥ 0.893` (Sock Shop) and `≥ 0.962` (Online Boutique) — above its
`0.6000 / 0.7040 / 0.4864` under **every** assignment of its unpublished SS1/SS2 labels. And `Avg@k ≥ AC@1` by
definition, so a method publishing only a cutoff average publishes an upper bound on its own `AC@1`: theirs on OB is
`≤ 0.4864`, ours is `0.904`.

`arXiv:2609.27069` measures a telemetry-free ranker at `Avg@5 0.488` on the same benchmark; DeCoR's OB row sits `0.0016`
below it, which is why the floor now travels with every row. **Axes opened**: RICE-CM as a *method* (protocol comparable,
four components unreproduced), and the `AC@3` gap (`4.2 pp` pooled, `10 pp` on `RE3:TrainTicket`).

**Found while verifying the field, same iteration.** `DecompRCA` (`arXiv:2609.36686`, code released) measures the
retrieval/reranking split and reports retrieval "nearly solved (98–100 %)" on microservice benchmarks — our `abs 0` on
all nine cells from the other side. Its `+7 … +18` comes from a **hand-written** system description, not the derived
brief arm T already priced at `+1` (`1 166` vs `1 165`), so the remaining item is a provenance question at ¥0 rather
than an arm.

### 342 The schedule is not the seed, and the budget the arm spends is five

**Correction, and it moves a published number.** `DEFAULT_QUERY_BUDGET` states `maxRounds: 6, maxToolCalls: 10`, and the
second never binds: the loop's last turn is answer-only, so **five** calls execute and the shipped artifact carries 4.99
of them (`1 416 × 5, 6 × 4`). 341's "4.99 of ten, half unspent" is withdrawn. `usableCallsOf(budget) = min(maxToolCalls,
maxRounds − 1)` is the one place that arithmetic lives, so the zero-cost width of a schedule is **five** and 341's
2.81 pp was the double-budget reading quoted as if it were free.

**The mechanism, measured.** The 20 misses that queried the culprit had it at engine **median position 2**; the 74 that
did not, at **9**; five calls spend on **1.888** distinct services. The arm looks where the engine points and stops after
fewer than two services, so the misses it never investigated are the ones the engine ranked third to fifth — the slots a
five-slot schedule adds. §318's "seeded prompt is worse" is therefore not a refutation of scheduling: a **seed** prints
the order (inviting a re-rank, priced at chance, `z = −9.26` over 5 335 claims), a **schedule** keeps it in the harness
and serves one name per call. `TOOL next` ships it, records the served service as investigated, and leaves the free
arm's prompt byte-identical (asserted); `--schedule none|engine` is the switch and `scheduled: <width> | null` is the
column.

**Two prices, never one.** At five calls the ceiling is **29 of the 74 (2.04 pp)** and the point estimate at the measured
**98.33 %** conversion (1 178 of 1 198 investigations that queried the culprit answered correctly) is **2.01 pp**; at ten
calls (`--max-rounds 11`, 2× model calls, ≈ ¥0.029/case) it is **40 (2.81 pp)** and **2.77 pp**.

**The second axis.** `Retrieval@k` split by the arm's record reads **99.25 %** on the population it investigated against
**26.79 %** on the population it did not (`@1`: 88.23 % against 7.14 %), so DecompRCA v2's "retrieval nearly solved
(98–100 %)" is one split of two and the pooled 87.83 % averages a solved problem with an unsolved one.

**Instruments.** `investigation-schedule.ts` (36 tests, 100/100/100/100), `reach-decomposition.ts` (18 tests,
100/100/100/100), `query-agent-schedule.test.ts` (17). Three miss populations stay disjoint, `null` is a pool failure
rather than a distance, and a test fails if the ceiling is ever printed as the estimate; `formatConversion`'s
`cases === 0` guard was removed as unreachable with the reason written where it stood.

### 342b The dispatch refused the schedule arm: −43 pp, and the mechanism is the instruction

532 cases (all 266 engine misses + 266 engine hits), `--schedule engine`, ¥7.36: **agent Top@1 184 against the engine's
266**, 45 repairs against 127 breaks, **139 of 266** engine-correct cases retained against the free arm's 1 134 of
1 156. Projected onto the sample: free **77.8 %**, schedule **34.6 %** — a sign error against §14's +2.01 pp ceiling.
Root cause is the v1 instruction, three ways: it sold the schedule as a replacement for `TOOL fleet` (eight services
per call), it stated ten calls where the loop executes five, and a served slot carried `TOOL metric` verbatim — no
`ERROR` lines, no failed-interface counts. **Closed:** a schedule that competes with the fleet read. **Open:** the same
premise as a `fleet` engine-order section (zero extra calls). Full record: `schedule-dispatch-342.md`.

### 343 The per-tool table was a tail, and the shortlist is the text-free arm

The 342b artifact was re-read on its own 532 ids together with the free arm's, and `TRACE_CHARS = 2 000` decided the
question the entry could not: **532 of 532** rows in **both** arms begin `[earlier results elided]` and keep **4.11**
of five executed directives (free arm **4.05**). A per-tool count from a `trace` is a count of the tail. Withdrawn on
that measurement: *"the fleet read was never common (0.5 %)"* (`TOOL fleet` and `TOOL services` are **0.000 in both
arms** — they are the first calls, and the first block is the one elision removes) and *"the route was never walked"*
(`0 of 532` traces naming `next` describes the last four calls; a `next` issued first is invisible by construction).
What survives: the tail's composition (`TOOL logs` **73.7 % → 25.2 %**, `TOOL edges` **60.5 % → 97.4 %**, both arms
eliding the same number of blocks) and every outcome column (184 vs 266, retention **52.26 %**).

**What ships.** A census counted as the directives run — `QueryOutcome.tools`, `QueryOutcome.nextServed`, per-row
columns, a `census:` line in the job log — so no future arm has to be inferred from a truncated field; and
`--fleet-order none|engine`, which prints the pipeline's own first **five** candidates inside `TOOL fleet`, names only,
after the two surprise sections. The instruction stays byte-identical to the published one (asserted in a test), no
call and no round is spent, so a difference between this arm and the free one can only come from what the model was
**shown**. **The reading refused it** (run **45437298998**, the same 532 ids, ¥7.17): **H1 passes** — `TOOL fleet` is called in
**532 / 532** cases, so 342b's 0.5 % fleet figure was elision and nothing else; **H2 fails** — agent Top@1 **209**
against the free arm's **414** (−205 cases, **−38.53 pp**); **H3 fails as the veto** — **160 / 266 = 60.15 %** of the
engine's correct answers retained, with the prompt byte-identical to the free arm's; **H4 passes and sizes the 342b
defect** — the tail agrees with the census exactly for the tools called last (`logs` 44.2 % both, `services` 0 % both)
and understates the ones called first (`fleet` 0.0 % → **100 %**, `failed` 69.9 % → 95.1 %, `metric` 79.3 % → 100 %).

**The mechanism is substitution.** On the 266 cases the engine has right the arm repeats the engine's rank 1 in **158**
(the free arm: **261**) and answers a **sibling of the printed five** in **44** instead of 1 (140 siblings over the
whole sample against 64). A presented ranking is read as a candidate SET; the model's reconciliation of two rankings is
worse than either ranker — fewer distinct services (1.615 against 1.895), less agreement (37.2 % of answers are the
engine's rank 1, against 67.5 %), and 39.29 % against 77.82 %.

**Three presentations, three losses:** seed (§318, printed) **81.08 %** against the free arm's 93.39 %; schedule
(342b, served) retention **52.26 %**; shortlist (this, shown) **60.15 %**. Full record: `fleet-shortlist-343.md`.
**Closed:** "show the arm the engine's order" in all three known forms — the text-free form, which should have been the
strongest, is refused hardest on retention. Reading a per-tool claim from a `trace` in this repository is closed with
it. **Open:** a wider investigation with **no** order shown (341 prices it at 40 of 74 for 2× the model calls), which no
iteration since 318 has run because every dispatch went to a presentation.

### 344 Convergence priced, and the conversion rate was read on the wrong stratum

343 named substitution and did not price it. On the same 532 paired ids, at ¥0, **414 − 209 = 205** decomposes by
(engine right?) × (queried the culprit?) × (correct?): **−107** (hits, queried — the free arm queries the culprit in
246 of 266, the shortlist arm in 161, so **85 fewer per-service queries**, which is the whole of `distinct` 1.895 →
1.615), **+6** (hits, not queried), **−3** (misses, queried), **−101** (misses, not queried).

**Convergence is the smaller half.** The `−107` block is worth at most **83 cases (40 %)** at the free arm's 98.0 %
conversion, 74 (36 %) under an independent reweighting. The `−101` block is not convergence: on the engine's **misses**
both arms behave the same (48 vs 43 of 266 queried the culprit) and the free arm still answers **115 / 218 = 52.8 %**
against the shortlist arm's **14 / 223 = 6.3 %** — a 46.5-point collapse where the arm did **not** act. The residual
**24 cases (12 %)** are the same queries converting at 83.2 % instead of 98.0 %.

**341's ceiling was overstated by a fifth.** The published 98.33 % conversion is the **hits** stratum's rate — on a hit
the culprit *is* the engine's rank 1, so "queried the culprit" and "agreed with the engine" are one event, and those
cases supply 246 of the 294 queries behind it. Reach cases are misses by definition and convert at **79.2 %**, so the
ceilings are **1.61 pp** at width 5 and **2.23 pp** at width 10, not 2.01 and 2.77.

**Shipped.** Two guards written before the code they fence: `ENGINE_ORDER_SURFACES` names the only **two** surfaces
through which the engine's order may enter a model's context (each call site carries an `ENGINE-ORDER SURFACE` fence,
the count of `scheduleNames(` uses must equal the list's length), and `budget-surface.test.ts` pins the round ceiling as
a measurement knob — 6 / 10, 5 executable, `--max-rounds` parsed in one file, the dispatch input defaulting to empty, no
`packages/*/src` file knowing the vocabulary. Full record: `early-convergence-344.md`.

### 345 The onset channel — evidence inside a read, and no ranking anywhere

The `−101` block is where the arm did nothing, so no tool weight can reach it. What might is **evidence the block could
be short of**: `TOOL logs`, the only tool carrying the first `ERROR`/`FATAL` timestamp, is opened in **0.44** of five
calls per case while `TOOL metric` is opened **1.33** times. `--evidence-order onset` appends `err=+2s/7` (or `err=-`
when the service logged nothing) to each `TOOL metric` line: no call, no round, no instruction change, and **no
ranking** — the one property that separates it from the three refused presentations, because a timestamp can be weighed
against the model's own order while a list of names replaces it. Pre-registered before the artifact in
`onset-channel-345.md`: H1 the misses/not-queried block 52.8 % → ≥ 60 %, H2 Top@1 ≥ 425, H3 hits ≥ 97 %, H4 `TOOL logs`
presence ≥ 70 %, with **+3 cases** as the floor below which "more evidence inside an existing read" closes as an axis.

### 346 A 236-case drift, and three signs that flip

345's flag never reached the loop, so its run was a plain **free arm** (`err=` in **0 of 532** transcripts). What that
control measured is the finding: on the same 532 ids, free **414** (11-23 09:21), schedule **184**, shortlist **209**,
free **178** (11-24 23:36) — same prompt (fenced), same corpus (`converterDigest b7fca80e…`), same ids. McNemar on the
paired cases: **245 discordant one way, 9 the other, Δ −236, p < 0.001**.

Against the **same day's** control: shortlist **+31 (+5.8 pp, 16 vs 47, p < 0.001)**, schedule **+6 (15 vs 21,
p = 0.405)**, shortlist vs schedule **+25**. So **"three presentations, three losses" is withdrawn** — the section inside
`TOOL fleet` is the only arm in this line with a measured **positive** effect, and the axis is **open again** with its
strongest form being the one 343 published as its worst.

**The standing is not comparable.** 1 328 / 1 422 = **93.39 %** is an 11-23 measurement by the arm that scores
**33.46 %** on this sample today. Cause **unverified**: the supplier's model behind the name, supplier-side routing, or
an unfenced change here — the first is the only one invisible to every run in this repository.

**Shipped:** `<artifact>.meta.json` (clock, model, budget, arms as one string); `agent-runner-wiring.test.ts` (call site
and signature must agree on the argument **count**, and the message names what is missing); the rule that **an arm's
control is the free arm dispatched in the same batch**. Full record: `model-drift-346.md`.

**The reading, and the level it establishes.** A free repeat on 11-25 returned **170 / 532** against 178 the night
before: **Δ −8, McNemar 22 vs 14, p = 0.243** — no difference. Against 11-23's **414** the same arm is **Δ −244,
252 vs 8, p < 0.001**. The free arm's accuracy today is a **level around 174 ± 6**, and 414 is a historical record.

Against that level: shortlist **+39 (+7.33 pp, p < 0.001)** on the 11-25 control and **+31 (+5.83 pp, p < 0.001)** on the
11-24 one; schedule **+14 (p = 0.054)** and **+6 (p = 0.405)**. **The section inside `TOOL fleet` is the only intervention
in this programme with a measured gain, under both controls** — and it is the arm 343 published as its worst.
**Withdrawn with it:** 344's 205-case decomposition, whose gap is a day boundary rather than two arms.

### 347 The two files were never the same arm — a 244-case gap that is 186 configurations and 58 instructions

**The reading that ends the drift.** 346 compared two artifacts it called *the free arm*. They ran different harnesses.
The 2026-11-22 artifact (run `45085062340`) ran `gate contrast, fallback engine, resolve edge-novel` and its own rows
say **287 of its 532 sampled cases were answered by something other than the model** — 155 by the prior, 71 by the
entry-prior rule, 61 by the interface witness. The 2026-11-25 artifact (run `45519251447`) ran all three at `none` and
answered **532 of 532** from the model. Neither record named `fallback` or `resolve`: both read `free`, and the two
fields that decide the comparison were absent from the file written to make comparisons safe.

**The decomposition, on the same 532 ids.** `model` 245: 180 → 122. `prior` 155: 105 → 40. `entry` 71: 68 → 2.
`interface` 61: 61 → 6. So **186 of the 244 cases were never a model answer in either run**, and the model's own 245
lose 58. Among those 245, the 139 whose answer string is identical are **correct in 139 of 139** in both runs, and the
106 that changed are the cases where the final turn differs (589 of 1 422 old investigations ended on the round cap;
today's loop forces an answer).

**Reversed.** The drift, its "level 174 ± 6", the claim that 414 may not be compared with anything current, and the
retraction of the standing — `1 328 / 1 422 = 93.39 %` is a **pipeline** reading. **Still invalid:** 342b's −43 pp and
343's −38.53 pp, which compared a bare arm to a pipeline control. **Still standing:** 346's same-day **+31 shortlist**
(bare against bare), 344's within-run findings, 341's ceiling correction. **Restated standing:** **1 287 / 1 422 =
90.51 %** on the 11-22 pipeline artifact; the published 93.39 % adds two deterministic guards (+50 first hop, +20
engine certainty); the model's marginal contribution is **+131 cases over the engine alone**. **Re-measured the same day**
(run `45531140696`, ¥20.81): **1 328 / 1 422 = 93.39 %**, 180 repairs and 8 breaks (precision 0.957, retention 0.993),
guards inside the artifact — **42 gained against 1 lost, Δ +41, p < 0.001** versus 11-22. The field's best (Sonnet +
ThinkDepth.ai, 90.0) is **3.39 points behind at 5.1 SE**, at ¥0.0147 a case. **Left: 94 cases** — 8 breaks (5 model, 3
`entry-prior`), 49 un-repaired misses inside the engine's top ten, 20 at rank 21+.

**Shipped.** `run-metadata.ts` requires `fallback` and `resolve` and records `revision`; `arm-comparison.ts` refuses a
pairing whose records differ outside the declared axis and prints both McNemar forms; `run-arm-comparison.ts` exits 1
rather than printing a table beside a warning; `benchmark-agentic.yml` gains `query_control=free` (same job, harness
flags forwarded, presentation flags omitted, axis derived from the dispatch); the `.meta.json` files are uploaded.
Full record: `arm-configuration-347.md`.

### 348 The bill was never a rate: 98 % of it is the question, and 55 % of it bought discarded answers

**The decomposition, from the artifact's own columns.** Run `45531140696` cost **20.81 CNY** for 1 422 cases:
**10 221 261 prompt tokens against 46 085 completion — 222 to 1**, which at the endpoint's two prices is 20.44 of
input and 0.37 of output. **98.23 % of the money is the question.** Every arm of the previous six iterations was
discussed as though the two columns were interchangeable, and none of them moved the one that carries the bill.

**Where it went.** Grouped by the resolver that settled the case: `model` 636 cases ¥9.40, `prior` 516 ¥7.51,
`interface` 148 ¥2.15, `entry` 74 ¥1.07, `door` 28 ¥0.40, `certainty` 20 ¥0.29. **786 of the 1 422 cases were settled
by something other than the model, after each had paid for six turns: 11.41 CNY, 54.82 % of the run, spent on answers
then discarded.** The `interface` row is the sharpest — 148 cases, **148 correct**, not one of which needed a call. The
per-case cost is 0.0143–0.0148 across all six strata, which is the tell: the loop spends its budget whether or not the
result is used.

**The one signal available at the door.** The engine's margin separates the populations almost perfectly (hits at a
median 0.872, misses at 0.081). Simulated on the artifact, skipped cases answering with the engine's winner:
floor 0.30 → 964 skipped, ¥14.18, **−23 cases**; 0.50 → 771, ¥11.32, −12; 0.80 → 603, ¥8.85, −2;
**0.87 → 582 skipped, ¥8.55, ±0 cases, accuracy unchanged at 93.39 %**; 1.00 → 520, ¥7.64, +0. The loss-free region
is bounded on both sides, which is what makes the figure a measurement rather than a knob.

**Not a bug in the resolver.** Discarding those answers is correct — the interface witness is 148/148 because it reads
the failing interface and the model does not. The defect is **placement**: whether a model will fail is not knowable
before it fails, so the decision that could have been taken at the door is taken at the exit.

**Shipped.** `cost-model.ts` (`costOf`, `auditCost`, `skipAt`, `lossFreeFloor`) at 100 % statements / branches /
functions / lines over 26 cases, refusing an artifact with no `engineMargin` column and treating a `null` margin as
unknown rather than high; `token-rates.ts`, the two prices behind an interface, **the input rate being the cache-MISS
rate because the invoice is the miss arithmetic**; `run-cost-audit.ts`, which prices any artifact offline so the
question is a command rather than a paragraph; and `--certainty-floor`, wired through **both** hops and pinned by two
assertions in `agent-runner-wiring.test.ts`, because iteration 345's `onset` is what a price knob dropped at a hop
looks like — parsed, logged, present in 0 of 532 transcripts. A skipped case is the same arm at a lower price: the
fallback's name, `rounds: 0`, zero tokens, empty transcript, attributed to `prior`, no new vocabulary in the artifact.

**Open, with a measurement attached.** 10.2 M prompt tokens were charged at the miss rate across 8 530 calls to one
endpoint with a byte-identical 750-character system prompt, so **no prefix was reused**. Recovering the cache would cut
the input price by up to 75 % — more than every other row above combined — but it is an endpoint-side property this
repository cannot assert by reading its own code. Stated as an open question rather than a saving.

**Also dropped, with no dispatch:** the acceptance rule. Every arm of the last six iterations was accepted or rejected
on a full-corpus run at ¥20.81 when the question each asked was a paired delta on the engine's 266 misses. A 466-case
stratified sample (`--sample-misses` / `--sample-correct`, both already shipped) costs ¥6.8 and resolves 5 points at
p < 0.01; the full corpus added resolution below 1.5 points, which no decision here has ever turned on.

**Every CNY figure above is an upper bound by 1.87×**, and the cache saving is withdrawn: a four-request probe of the
endpoint (349) found that the served model's published rate is $0.15 / $0.60 per million — 1.07 / 4.28 — rather than
the 2 / 8 these numbers are priced at, and that two byte-identical calls read `prompt_cache_hit_tokens: 0`. The
structure is a token ratio and survives the correction; the money column does not. Full record:
`cost-structure-348.md`.

> **Superseded by §352 and §353.** The CNY card is **1 / 4 off-peak** and **2 / 8 peak** per million — the 2 / 8 these
> numbers are priced at is the *peak* column, not an estimate, and the 1.07 / 4.28 above came from converting the USD
> card at 7.13. So 348's 20.81 is the peak bill, **10.41** the off-peak one, and **0.0078 → 0.0073** a case.

### 349 The model in every artifact is retired, the cache serves nothing, and the price was an estimate

**Four requests of eight tokens, ¥0.001, and three answers.** `GET /v1/models` returns **two** models — `deepseek-flash`
and `deepseek-v4-pro`. `deepseek-chat` is **not among them**: the alias was retired, and a request for it is *served
anyway*, by `deepseek-flash`, which the response's own `model` field reports. Every artifact this programme wrote
carries the name that was ASKED FOR, so **every one of them names a model that no longer exists**, including the
93.39 % standing. What that changes is comparability across the retirement date and not the readings: the arm that ran
ran, and the response named it.

**The cache, closed with a no.** The same body, twice, on both models:

```
deepseek-chat  #1 {"prompt_tokens":191,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":191}
deepseek-chat  #2 {"prompt_tokens":191,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":191}
deepseek-flash #1 {"prompt_tokens":216,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":216}
deepseek-flash #2 {"prompt_tokens":216,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":216}
```

**Zero on the second identical call.** 348 listed "recovering the cache would cut the input price by up to 75 % — more
than every other row combined" as the largest open item; it is closed, and the 75 % was never available. What replaces
the inference is the endpoint's own field, recorded per call from now on: a run that claims a cache saving has to
**show** one.

**The price was an estimate, by 1.87×.** This repository prices a run at 2 CNY per million in and 8 out; every "CNY"
figure it has published is that arithmetic, applied to the endpoint's own token counts. The served model's published
off-peak rate is **$0.15 / $0.60 per million** — **1.07 / 4.28** at 7.13. So **run `45531140696` cost 11.13 CNY and not
20.81**, which is **0.0078 per case** and **1/820th** of the only competitor that publishes a per-case price. The
structure is untouched: 98.23 % input, 222 tokens of question per token of answer, 786 cases settled without the model
at 54.82 % of the bill, and the 0.87 floor's 41.1 % — every one of those is a token ratio, and a price table cancels
out of it. The ratio stays bounded on both sides, which is why the floor is still the one saving on the table.

> **Superseded by §352 and §353.** "By 1.87×" is withdrawn: the card has two columns and 2 / 8 is the peak one, so the
> 11.13 below is 10.41 on the off-peak column and 0.0078 is 0.0073. The cache sentence in the same entry is also
> withdrawn — a workload hits at 81 %, a 191-token probe cannot.

**A risk the probe found on the way past, and did not walk into.** The `deepseek-flash` responses carry
`completion_tokens_details.reasoning_tokens: 8` — the model spent its whole eight-token budget thinking, because
**thinking is on by default on that name**. The shipped arms spend 5.4 completion tokens per call, which is impossible
with thinking on, so the retired alias was serving it with thinking **off**. Migrating the requested name without also
disabling thinking would multiply the output bill tenfold and look like a price change rather than a configuration one;
the migration is therefore one change — `deepseek-flash` with thinking disabled, served name and reasoning tokens both
recorded — and it is not made here.

**Shipped.** `ChatCompletion` carries `cacheHitTokens` / `cacheMissTokens` parsed from the endpoint's own `usage`, with
absence reading as zero (an endpoint that reports no cache served nothing from one); `QueryOutcome.servedModel` and
`QueryArmRow.servedModel` record what the endpoint SAID it served, empty when it says nothing and **never the requested
name**; `QueryArmRow.cacheHitTokens` sums the split across turns; `DEEPSEEK_FLASH_RATES` sits beside
`DEEPSEEK_CHAT_RATES` with the 1.87 asserted by a test; the banner reads `asked for deepseek-chat`; and
`probe-endpoint.yml` is dispatch-only, four requests, no artifact — the next time a supplier moves, the answer costs a
hundredth of a corpus case instead of a day spent reading two files that disagree. Full record:
`endpoint-probe-349.md`.

### 349b The cost column, corrected

Every "CNY" figure this programme has published is priced at **2 CNY per million in, 8 out**, applied to the
endpoint's own token counts. The served model's published off-peak rate is **$0.15 / $0.60 per million** — **1.07 /
4.28** at 7.13, which is **1.87× less**. Run `45531140696` therefore cost **11.13 CNY and not 20.81**, which is
**0.0078 per case**: against the only competitor that publishes a per-case price (RCLAgent V2 at ≈ 6.39 CNY) that is
**820×**, and against the field's best accuracy (Sonnet + ThinkDepth.ai at 90.0) it is +3.39 points at 5.1 standard
errors. **Nothing structural moves**, because the structure is a token ratio and a price table cancels out of it:
98.23 % input, 222 to 1, 786 cases settled without the model at 54.82 %, the 0.87 floor at 41.1 % with two bounded
edges. The cache's 75 % is **withdrawn**, not deferred — two byte-identical calls read `prompt_cache_hit_tokens: 0`.
The migration to `deepseek-flash` is **not made**, because thinking is on by default on that name and the shipped arms
ran with it off; renaming alone would multiply the output bill tenfold and look like a price change.

> **Superseded by §352 and §353.** 1.07 / 4.28 was the USD card at 7.13; the CNY card is **1 / 4**. Run
> `45531140696` cost **10.41**, not 11.13, and **0.0073** a case, not 0.0078 — and the cache's 75 % is not withdrawn
> after all: run `45595943761` recorded **81.25 %** of its prompt tokens as hits.

### 351 The floor priced one rule and shipped another

**Iteration 348's saving was real and its rule was not.** The certainty floor answered `priorTop ?? engine.top1`; the
certainty guard it is a pre-call form of answers `engine.top1`; and `cost-model.skipAt`, which decided whether the
floor was worth buying, credited a skipped case with `engineRight` — the guard's answer. One iteration priced one rule
and ran another, which is the defect `applyResolver`'s own comment records from iteration 322. Two further
disagreements fell out of the same reading: the floor fired on `>=` where `engineCertainty` fires on `>`, and it
reported `answeredBy: 'prior'`, merging every floored case into the refusals' row so the bill could not separate "the
engine was sure" from "the gate fell back".

**Fixed to `engine.top1`, strictly above the bar, attributed `certainty`.** The correction is not cosmetic: it makes
the artifact readable exactly, and the exact reading is stronger than "the accuracy did not move". Above margin
**0.8630** the engine's answer and the shipped answer agree on **every one of the 1 422 cases** — 0 repaired against 0
broken, not a compensating pair. `ruleEdges` names why in two numbers: the highest margin at which the engine would
have **destroyed** a correct case is **0.8630**, the highest at which it would have **repaired** one is **0.5707**;
between them the rule is a straight loss, above both it is inert. At the guard's own bar the floor silences **360
cases (25.3 %) for 2.65 CNY (25.4 %)**; at the corpus's fitted frontier of 0.8630, **582 (40.9 %) for 4.27 CNY
(41.1 %)**, both at 93.39 %.

**The default is 1.5 because it is inherited, not fitted.** For any case above the guard's bar the shipped pipeline
already discards the model's answer and ships `engine.top1` — `applyResolver` applies the guard last — so a floor at
that bar cannot change an answer; it can only stop paying for a turn that was going to be overwritten. Two
preconditions, both checkable in the artifact: the resolver is armed, and the model answered at all (the anchor
reports `unanswered 0`, so the prediction is exact here and probabilistic elsewhere). The 0.8630 tier is worth 15.7
more points of saving and is a fit to one corpus of 1 422 cases; it stays available as an ablation and is not the
default. `query_certainty_floor` therefore ships as `1.5`. Full record: `certainty-floor-351.md`.

**The acceptance run, before it was read:** 360 cases at `rounds: 0` and zero tokens, all answering `engineWinner`
under `certainty`, 0 gained against 0 broken, corpus 93.39 % ± sampling, bill ≤ 8.5 CNY. **Measured on run
`45595943761`: six of six.** 360/360 silent, 360/360 `certainty`, 0/0, corpus 93.32 % (the 1-case gap sits inside the
1 062 that still call the model), and 360 empty `servedModel` against 1 062 reporting `deepseek-flash`.

**And the bill was a fifth of the prediction, for a reason nobody had priced.** The run is the first artifact to carry
`cacheHitTokens`: **6 204 649 of 7 636 769 prompt tokens were cache hits, 81.25 %**, at 1/50th of the miss price. The
run cost **1.69 CNY, 0.00119 a case** — not the 7.77 the no-cache bound gives. That withdraws 349's "the cache serves nothing", which was a fact
about a 191-token probe and not about a workload, and it re-reads the 2 / 8 table as the PEAK tariff rather than an
estimate. It also moves the first lever: cache-miss input is now 84.6 % of the bill and the cached system prompt 7.3 %,
so `--transcript-chars` outranks every prompt-length recommendation this register has made. Full record:
`cache-hit-352.md`.

### 351b The two-signal floor is not a second signal

`priorTop` is recorded per row from 351 on, so the next floor rule — silence the model when the prior and the engine
name the same service — was expected to cost zero to price. It cost zero and it is worth nothing: **`priorTop` equals
`engineWinner` on 1 422 of 1 422 cases**, because the fallback order *is* the engine's ranking. The rule collapses to
the engine arm at 81.29 %.

That identity also says how far 348's rule mismatch was from being live: on an arm with `--fallback engine` the prior
and the engine are the same name, so both rules shipped the same answer and only the stratum and the boundary were
observable. A `--fallback seed` arm would have shipped a different answer, and no artifact in this programme was taken
on one — the fix was required by the rules, not by the readings. The next rule has to read something the engine does
not already know: the entry the graph names, or the interface witness.

### 352 The cache serves 81 % of the tokens at 1/50 the price, and the probe could not see it

**A probe cannot price a workload.** 349 sent the same 191-token body twice and read `prompt_cache_hit_tokens: 0` on
both models, and on that evidence this register withdrew 348's 75 % saving as never available at any price. The
workload says otherwise: run `45595943761` recorded **6 204 649 of 7 636 769 prompt tokens as cache hits, 81.25 %** —
**5 842 hit against 1 349 miss a call**, because an agent repeats a ~5 800-token system prompt and not a ~1 350-token
telemetry block. What 349 established is narrower than it was published as: **a short prompt does not cache.** A
191-token probe has no stable prefix to hit. Full record: `cache-hit-352.md`.

> **Superseded by §354.** The decomposition is not right: the repeated text is a **543.8-token opening**, not a
> 5 800-token system prompt, and the uncached 1 349 a call is the **one block that is new on that call**, not the
> transcript at large. The per-token argument survives — a miss token costs 50 times a hit token — and the lever it
> points at is the block, not the history.

**The card has two columns and the old table was the dearer one.** Off-peak **1 / 4 / 0.02**, peak **2 / 8 / 0.04**,
peak exactly double, weekdays 01:00–04:00 and 06:00–10:00 UTC. So the 2 / 8 every artifact was priced with is a real
tariff — the peak one — and 349's "1.87× over-statement" was the USD card converted at 7.13 rather than the CNY card
read. The acceptance run cost **1.69 CNY, 0.00119 a case**, against 7.77 with no cache and 15.55 at peak.

**The lever flips.** Cache-miss input is now **84.6 %** of the bill, output 8.1 %, the cached system prompt 7.3 % — so
shortening the **transcript** (1 349 uncached tokens a call) is worth fifty times per token what shortening the system
prompt is, which reverses every prompt-length recommendation in this register.

### 353 The bill the runner printed was not the bill

**One sentence, two arithmetics.** Every run ends with `tokens P+C · est. ¥X at the declared prices`, and `X` was
`P × 2 + C × 8` — the peak column, with every prompt token billed as a cache miss. Run `45595943761` cost **1.69** and
its own last line said **15.55**: a **9.2×** overstatement, in the line most readers see before any table. The audit
priced the same artifact correctly the whole time; the constant and the function never met.

**Fixed by deleting the constant.** `billLine` builds the sentence from `costOf`, the function the audit's strata and
total are built with, so the line and the table can only disagree if the line stops being called. `billNote` prints the
counterfactual — "with every prompt at the miss price the same run would read ¥7.77" — because that is the figure every
report before this one carried, and a reader comparing two reports has to be able to see where the 9.2× went.
`QueryArmSummary.cacheHitTokens` carries the column (clamped per row, `null` when no row declared it) because the
runner could not price a cache it never saw.

**The tier is a clock, not a default.** `tariffAt` / `servedRatesAt` read the two windows off the card — `[01:00,
04:00)` and `[06:00, 10:00)` UTC, weekdays, half-open so no instant is billed at both tariffs — and apply them to the
artifact's own `startedAt`. A repricing months later lands on the column the run was billed under rather than on the
clock of whoever reads it. The alternative, a constant, is what produced 15.55 for a 1.69 run.

**And the floor column stops printing one floor twice.** `distinctFloors` dedupes at the printed resolution, so the
cliff `0.8629602…` and a requested `0.863` are one row: `ruleEdges` answers with the corpus's own margin, and a table
that lists it twice as two spellings invites the reading that the curve steps there.

**What this does not fix.** The window boundaries are transcribed from the card, not queried from an endpoint — a
supplier that moves them would move the price silently, and `probe-endpoint.yml` does not read them. The line prices the
artifact, not a case, so it cannot say which stratum is expensive; that reading is the audit's. And the transcript
lever is still unpriced: 84.6 % of the bill sits in tokens nobody has yet tried to shorten.

### 354 The knob that priced the transcript reached nothing, and the tokens it removed were the cheap ones

**The flag was inert on every run this programme ever dispatched.** `--transcript-chars` travelled from the workflow
through the runner into `trace`, and two lines later `TRACE_CHARS = 2 000` overwrote it; `buildUserPrompt` called
`renderTranscript(exchanges)` with **no budget at all**, so every prompt was rendered at the default 9 000 characters.
The wall was never reached — the corpus's own final trace is ~1 700 characters — so no reading could have caught it,
and the same defect class has now been paid for three iterations running: 351 priced one rule and executed another, 353
printed one arithmetic and computed another, 354 moved a lever that was not connected. Fixed by passing the budget
through, and by a red test that asks a 120-character cap to say `elided` **inside the prompt**.

**Three arms on the full corpus, differing only in the cap.** At 1 200 and 600 characters, against the anchor
`45595943761`: accuracy **−9**, **−19** and (alone, on `b9ba1df`) **−13** cases (−0.63 / −1.34 / −0.91 pp), paired
discordants +6/−15, +5/−24 and +6/−19, so the loss scales with what was removed rather than scattering like noise and
the 6-case spread between two identical arms is the run-to-run noise at temperature 0. The acceptance test is the
trajectory, not the accuracy (`CoACT`, `arXiv:2607.02911`): **54.50 %, 46.13 % and 46.34 %** of cases made the same
directives in the same order, and the tool census says what changed — `TOOL logs` **794 → 40 → 34 (−95 / −96 %)**,
`TOOL failed` 1 078 → 1 653 → 1 651, `TOOL edges` 1 160 → 1 569 → 1 509. An arm that cannot re-read what it found stops
asking for long lists and starts asking for verdicts.

**The cap removed 38.3 % of the tokens and 11.8 % of the money — and two thirds of the money came from somewhere it did
not act.** Run alone, the 600-character arm costs **1.493 against 1.693**: the bill fell because the arm **changed
tools** — `TOOL logs` 794 calls → 34, `TOOL failed` and `TOOL edges` taking its place — and a list of verdicts is a
shorter observation than a dump of log lines, so the full-price column fell 9.4 % (225.0 → 203.5 tokens a call) and
that term is 67 % of the saving. The cache is 28 %: **hits per call halve, 974.7 → 535.8**, and the two caps land on
the same figure although they differ by 44 tokens a call, so elision removes one stable block rather than a slope. What
it deletes is the region the endpoint had been serving at 1/50th the miss price, which is why destroying 45 % of the
cache-served tokens bought 0.056 CNY.

**The first reading of that money was wrong, and the third dispatch is why.** The two capped arms ran concurrently on
one key while the anchor ran alone, and the concurrent 600 arm read **1.70** — "none of the money". Run alone it reads
1.49. The decomposition is exact: the **window** removes 438.9 cache-served tokens a call that vanish (2.79 M, costing
nothing to lose), the **contention** moves 34.8 a call from the hit column to the miss column (0.22 M, **+0.22 CNY**),
and the two nearly cancelled in the concurrent artifact. The dichotomy §8 originally offered — "contention, or the
window" — was false, because it assumed the bill follows the cache.

**The bill, to the token.** The capped artifact's per-call curve puts the opening at **543.8 tokens** — the first call
carries no transcript, so that point is the standing instruction plus the head and nothing a cap can reach — and
543.8 × 6 372 calls is **3.47 M** of the 4.70 M the arm spent. The rest of the bill is the **newest observation on each
call**: 225 tokens at full price × 6 366 calls = **¥1.432, 84.6 %** of the anchor's bill, against ¥0.124 for the 6.2 M
tokens of accumulated history (7.3 %) and ¥0.137 of output (8.1 %). The history is not what the run pays for.

**What this closes and what it opens.** The front-eliding family is closed as a lever over the HISTORY — 45 % of the
cache-served tokens destroyed for 0.056 CNY is a bad trade, and the reason a competitor's paper does not state is that
the invoice proves it. It is not closed as evidence about cost, because the saving it did produce came from the one
channel it did not intend: the size of the observation. That channel now has an instrument — `--result-chars`, which
truncates a result as it **enters** the transcript, keeps every byte the model has already read, and so attacks the
full-price term without touching the prefix: at 100 tokens a block instead of ~200 the bill reads **¥1.06, −37 %**
against the anchor's other two columns. The reading that will judge it is free — trajectories preserved per case — and
the columns this iteration added are what make it readable: `turnTokens` (one prompt count per call, which located the
543.8-token opening) and `turnHitTokens` (the cached share of each call, so the next arm states which call lost its
cache instead of deriving it from a case total).

**What this does not establish.** Contention is measured (0.22 M tokens, **¥0.22**) but not paired: the alone arm ran
23 minutes after the others and on a different revision (`b9ba1df`, which fixed the bill line rather than the arm), so a
reader who wants a controlled test of contention would have to re-dispatch two identical arms at once — the sign of the
exact decomposition above is not in doubt, its standard error is. And **501–536 cache-served tokens a call is 92–99 % of
the 543.8-token opening**, which a strict byte-prefix cache could not serve, because the budget line changes every turn
and sits in the third line of the head: the endpoint caches more generously than its documentation implies, or it counts
hits differently than its documentation implies. Every figure above prices the reported counts — what an invoice would
charge — and none of them assumes the mechanism. Full record: `transcript-lever-354.md`.

### 355 The entry gate is refused, and the refusal is what the iteration found

The `entry-prior` rule renames 75 answers and is **70 right and 5 wrong**. This iteration tried to gate the five out,
on one artifact, at zero cost, and every gate failed for a different and instructive reason.

**The margin gate cannot work, and the reason is two thousandths.** The highest-margin REPAIR sits at **0.569** and the
highest-margin BREAK at **0.571** — two cases on opposite sides of the outcome, separated by a quantity smaller than
any rounding of the corpus. A `<= 0.5` bar keeps 66 repairs and 4 breaks, a net **+62** against the ungated **+65**;
`priorSurprise <= 100` reads **+35**. No threshold separates a population from itself, and the phrase "the
distributions overlap" now has its witness: the overlap is two cases deep at the very top of the range.

**The `engineRank` gate works and is ILLEGAL.** `engineRank != 1` keeps 69 repairs and 2 breaks, a net **+67**, and it
is a rule about the LABEL: `engineRank` is `truthRank`, the truth's own position in the engine's order. A resolver
reading it scores itself with the answer key. Recorded because it is the most tempting gate in the artifact — it is a
single comparison, it reads like "respect the engine's confidence", and it is worth +2.

**The `faultType` gate works, reproduces on four arms, survives cross-validation, and is still refused.** A bandwidth or
delay fault raises no error, so the entry rule's premise ("no failure crossed the door", read from the error channel)
is vacuously true exactly where the rule is wrong. Excluding `NetworkBandwidth` and `NetworkDelay` is worth **+3 cases
on all four artifacts** (1 327 → 1 330, 1 318 → 1 321, 1 308 → 1 311, 1 314 → 1 317), and 5-fold cross-validation by
`(hash(family) + index-in-family) mod 2` returns **+3 on held-out folds** — identical to in-sample, which is the
signature of a real constraint rather than a fitted one. **It is refused anyway, on protocol grounds:** `faultType`
lives in `case.json` beside `groundTruthServices`, the harness gives the arm telemetry and nothing else, no prompt
carries it, and `buildTelemetry` never reads it. The +3 would be bought with a field the benchmark reserves, and the
comparison would not survive review. **This is the first measured positive in this programme rejected for a reason
that is not about the measurement**, and it is written here so the next iteration does not rediscover it and ship it.

**The legal version already exists and already ships disabled.** A departure-channel gate (`conduitUnder`,
`ENTRY_PRIOR_TRAFFIC_KAPPA = null`) asks the observable form of the same question, and its pricing read a peak at one
grid point on one corpus — the shape this programme has refused twice. The axis stays closed on its own record, not on
this one.

**What is left of the five breaks: nothing reachable.** They are one `HTTPRequestDelay` at margin 0.355 and four
network faults, their common signature is an error channel that stayed flat, and the only legal way to read that
signature is the channel gate that is already refused. **The rule ships as it is, at 93.3 % precision on the population
it addresses, and the 5 breaks are its price.**
