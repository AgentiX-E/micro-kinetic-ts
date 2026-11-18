# The promotion gate — where the model's ranking is worth reading, and where it destroys 28 cases

Every model arm in this project so far has been a **fusion**: hand the model's ranking to an operator, sweep the
weight, read the delta. All of them are negative, and `agentic-fusion.md` §3-4 concludes that "the operator was
never the problem" — the proposal set carries information significantly below chance and no pairwise rule rescues
it.

That conclusion is true of the proposal set **as a whole** and false of a small, nameable part of it. This
document measures where, and states the rule that separates the two.

## 1. The population

| quantity                                                       |             reading |
| -------------------------------------------------------------- | ------------------: |
| cases                                                          |               1 422 |
| engine Top@1, scored against the fault-free profile            | **1 156 (81.29 %)** |
| the model's own first choice, if it were taken verbatim        |     1 103 (77.55 %) |
| cases where the model's first choice differs from the engine's |             **191** |
| … of those, the promotion FIXES a wrong engine answer          |              **43** |
| … of those, the promotion BREAKS a right engine answer         |              **81** |
| net                                                            |             **−53** |

Nineteen per cent of cases get an override, and the overrides destroy twice as much as they repair. That is the
reading the fusion sweeps were built on.

## 2. The first defect: a "relative gap" divided by a score that can be negative

The obvious refinement is to condition the override on the engine's own uncertainty — promote only when the top
two are close. The obvious spelling is

```
relGap = (s₁ − s₂) / s₁
```

and it is **wrong on this corpus**, for two reasons that the first version of this measurement walked into.

1. **The published order is not score-sorted.** The containment pass reorders adjacent caller/callee pairs after
   scoring, so on **83 of 1 422 cases** the published first candidate scores _below_ the second. `relGap` is
   negative on those and a band like `relGap < 0.05` silently absorbs them into "the engine is unsure", when what
   they actually say is "a rule already acted here".
2. **A candidate's score can be at or below zero** — the pool penalty is subtracted — so dividing by `s₁` is not a
   normalisation at all; on those cases the ratio is unbounded or uninterpretable.

The corrected statistic divides by the case's **own spread**, which is always positive and is a property of the
case rather than of the leader:

```
spread = s₁ − s_min            (s_min = the last scored candidate)
relGap = (s₁ − s₂) / spread
```

With that fix the 83 reversed pairs are separable, and they are worth separating: **the model's overrides on them
net −26**, a quarter of the total damage concentrated in 5.8 % of the corpus. A promotion that argues with a
rule which has already moved the pair is worse than useless.

## 3. The second defect: the spread must be taken over the whole order

The same rule, applied to two artifacts of the same run at different widths, selects **29 cases** from the
five-wide fingerprint dump and **122** from the fifty-wide depth dump. The threshold is one number; the
denominator was the artifact.

This is the third appearance of one error in this line of work — iteration 303 found a "method ceiling" that was
the reporting width of an artifact, and the correction here is the same in spirit: **a statistic normalised by a
candidate list inherits that list's width.** `s_min` must be read from the full scored order, which is what the
depth ladder reports, and never from the five candidates a presentation layer happened to carry.

## 4. The gate

```
promote the model's first choice over the engine's only when
    (a) the published pair is score-sorted            s₁ ≥ s₂
    (b) the top two are within 3 % of the case's spread   (s₁ − s₂) / (s₁ − s_min) < 0.03
```

On the 1 422 cases:

|                                                          |                     reading |
| -------------------------------------------------------- | --------------------------: |
| cases in the band                                        |                         122 |
| engine wrong inside the band                             |                 98 (80.3 %) |
| model overrides inside the band                          |                          56 |
| … fix                                                    |                          15 |
| … break                                                  |                           6 |
| … leave the case wrong either way                        |                          35 |
| **net**                                                  |                      **+9** |
| conditional precision (fix / outcome-changing overrides) |        15 / 21 = **71.4 %** |
| end to end                                               | 1 156 → **1 165 (81.92 %)** |

**+9 is small — 0.63 pp — and it is the first positive reading any model arm in this project has produced.**

### 4.1 The threshold curve, and why 0.03

| threshold |   cases | overrides |    fix | break |    net | half A | half B |
| --------: | ------: | --------: | -----: | ----: | -----: | -----: | -----: |
|     0.005 |       6 |         2 |      1 |     0 |     +1 |     +1 |     +0 |
|     0.010 |      17 |         6 |      3 |     0 |     +3 |     +2 |     +1 |
|     0.020 |      92 |        42 |     10 |     4 |     +6 |     +2 |     +4 |
| **0.030** | **122** |    **56** | **15** | **6** | **+9** | **+5** | **+4** |
|     0.050 |     164 |        70 |     17 |    10 |     +7 |     +6 |     +1 |
|     0.080 |     205 |        79 |     18 |    16 |     +2 |     +4 |     −2 |
|     0.120 |     271 |        90 |     23 |    19 |     +4 |     +6 |     −2 |
|     0.200 |     370 |       103 |     23 |    26 |     −3 |     +3 |     −6 |

Two properties matter and one does not.

- **The curve is a hump, not a spike.** It rises from +1 to +9 and falls back to −3, which is the shape a real
  effect makes when the band widens past its signal. A single favourable threshold would be a coincidence.
- **Both halves are positive across 0.01-0.05.** The halves are SHA-256 of the case id, so the split is stable and
  independent of every quantity in the table.
- **The maximum does not transfer.** Tuning on half A picks 0.12 (`+7`) and reads **−1** on half B; tuning on half
  B picks 0.02 (`+5`) and reads +2 on half A. So the _existence_ of a positive band replicates and the _location of
  its optimum_ does not. That is why the rule is stated as a plateau — "any threshold in 0.02-0.05" — rather than
  as "0.03", and why the confirmatory arm below is a pre-registered threshold and not a sweep.

Bootstrap over the 122 cases, 3 000 resamples: **95 % CI [+1, +18]**, `P(net > 0) = 0.975`.

### 4.2 The nulls

The band is where the engine is wrong 80 % of the time, so _any_ override that names a plausible service gains
something. The gate has to beat content-free overrides, and does:

| override rule                                                         |                    net |
| --------------------------------------------------------------------- | ---------------------: |
| **the model's first choice**                                          |                 **+9** |
| the engine's second candidate, always                                 |                    −17 |
| the engine's third candidate, always                                  |                     −3 |
| a uniformly random candidate among the five shown (mean of 500 draws) | −14.1 (range −21 … −8) |

The best of 500 random draws is −8. The gate is +9. The information is the model's, not the band's.

## 5. What this changes about the earlier conclusion

`agentic-fusion.md` §4 says the model "cannot choose between services at better than chance" and reads that as a
task mismatch. Half of that holds. The model is at chance **globally** — verbatim it scores 1 103 against the
engine's 1 156 over the whole corpus — and it is well above chance **where the engine's own top two are within a
few per cent of each other**: 71 % of its outcome-changing overrides are right, against a base rate of 19.7 %
(24/122) for the engine being right in that band.

So the mismatch is not "the model cannot rank". It is "the model's ranking is worth reading only where the engine
has already said it is nearly undecided, and only where no structural rule has intervened". Both conditions are
measurable from the artifact, and neither is a property of the model.

## 5.1 The prescription axis, and a corpus that measured the same thing from the other side

`arXiv:2610.35767` (Peking University and BUPT, 2026-10-26) builds **RCAtlas**, 90 curated cases over eight public
sources, and reports its arms as a function of what it calls the **prescribed-call ratio** — the fraction of a
system's model calls fixed in code, `0.10` to `1.00` across the published agents it re-runs. Its ordering is
monotone in that ratio: simple harnesses (ratio `0`) 65-77 % `PR@1`, published agents (ratio `0.10`-`1.00`)
16-53 %, non-LLM statistical methods 6-39 % with the best (**NSigma**) at **38.9 %**.

This project has three points on the same axis, measured on a different corpus:

| arm | prescription | net |
| --- | ---: | ---: |
| the elimination protocol (`agentic-fusion.md`) | every call fixed; the model may only remove | **−602** |
| the nomination arm, ungated | the model ranks freely; every override applied | **−53** |
| **the nomination arm, gated (§4)** | the model ranks freely; overrides admitted only where the engine is undecided | **+9** |

The ordering is monotone in prescription, which is the same conclusion RCAtlas reaches from a cross-section of
other people's systems — and it is reached here from three arms of **one** system on **one** corpus, which is a
dose-response rather than a comparison between designs.

**What this is not.** A controlled curve. The −602 was measured against an older engine (`1 073` control, not
`1 156`) and on the claim-set artifact rather than the nomination artifact, and "prescription" is not one scalar
across the three arms: the elimination protocol prescribes the *form* of an answer, not only the number of fixed
calls. So the three points are indicative and the direction is the reading; the magnitudes are not comparable to
each other and none of them is comparable to RCAtlas's `PR@1`, whose population shares no case with RCABench's
1 422 (`docs/sota-populations.md` files it as `OTHER`).

**What it does change.** It makes the gate's +9 the *end* of a trend rather than an isolated reading, which is the
strongest available answer to "is +9 a threshold artefact". A threshold artefact would not sit at the minimum
prescription end of a curve whose other two points were measured for other reasons.

## 6. What is NOT claimed

- **Not a SOTA move.** +9 cases is 0.63 pp and takes 81.29 % to 81.92 %, still 8.1 pp below the published
  RCABench best of 90.0 % (arXiv:2608.21310, Sonnet + ThinkDepth.ai on a 500-case sample).
- **Not held out.** The threshold was chosen on this corpus. The cross-half table is the strongest available
  internal check, and §4.1 states exactly how far it goes: the sign replicates, the location does not.
- **Not a substitute for the width axis.** The band is defined on the engine's order, so widening the presented
  candidate list does not enlarge it.

## 7. The width axis, priced before it is dispatched

The pre-registration `docs-repository:preregistration-303.md` authorised a width arm from the depth ladder. The same artifacts
price it more sharply than that projection did.

|                                                                         |                 reading |
| ----------------------------------------------------------------------- | ----------------------: |
| width-5 ceiling (`Top@5`)                                               |         1 249 (87.83 %) |
| width-20 ceiling (`Top@20`)                                             |         1 310 (92.12 %) |
| cases a width-20 arm newly exposes (ranks 6-20)                         |                  **61** |
| … of those, the answer scores ≥ 50 % of the leader                      | 22 of 32 in ranks 11-20 |
| the model's conversion rate on answers it ALREADY sees at positions 2-5 |   **34 of 93 = 36.6 %** |

The last line is the decisive one. Under width 5 the model is shown 93 cases whose answer is at position 2-5, and
it promotes the right one 36.6 % of the time — so the information a wider list would expose is of a kind the model
already converts when it can see it. Width is therefore **not** the binding constraint; the fusion is, which is
what §4 addresses.

That does not retire the width arm. It changes what it is for: a width arm tests whether 61 more opportunities at
a ~36 % conversion rate beat the engine's own ordering there, and the gate in §4 is the mechanism that makes the
conversion survive. Dispatching both together is the next experiment, and it is pre-registered.

## 8. Reproduction

```bash
# No model and no network: replays the recorded nominations against the engine's order.
pnpm exec tsx benchmarks/src/run-agentic-nomination.ts \
  --fingerprints  <fse26 --fingerprint-out>  \
  --verdicts      <fse26 --per-case-out>     \
  --nominations   <recorded nominations.ndjson> \
  --max-candidates 5 --max-rank 5
```

The gate is a pure function of `(published order with scores, model ranking)` and is applied offline, so every
number above is replayable from artifacts already in the repository's `artifacts/agentic/`.

## 9. The confirmatory replay — arm G, on production code

`docs-repository:preregistration-304.md` fixed the threshold at `0.03` and named four predictions before this run. What follows is
the run, and it differs from §4 in one respect that matters: **it is not the analysis script that produced §4.** The
gate is now `packages/ai/src/agent/promotion.ts` with a `gatePromotion` entry point, a `--promotion` flag on the
nomination runner, and the arm pathway wired into `scoreNomination` so the control and the treatment are one loop.
Re-deriving the number through a different implementation is what separates a reading from a transcription.

### 9.1 The artifacts, and why a new run was spent on them

The gate needs three things from one run: the population, the recorded nominations, and the **full scored order**
the spread is taken over. `artifacts/agentic/` does not carry the last one; the terms dump does.

| artifact | supplies | cases |
| --- | --- | --- |
| `fingerprints.ndjson` (`--fingerprint-out`) | the population: posterior, channels, prompt digest | 1 422 |
| `per-case.ndjson` (`--per-case-out`) | the accepted set the run scored against | 1 422 |
| `terms.ndjson` (`--terms-dump`) | the whole scored order — 49 or 50 candidates per case | 1 422 |
| `nominations.ndjson` (recorded 2026-11-17) | the model's ranking per case | 1 422 |

The run cost 15 m 52 s and **$0.00** in model calls, because it asks the engine and nothing else. Its control is
`1 156 / 1 422 = 81.29 %`, and its terms dump is **byte-identical** to the one §4 was computed from
(`md5 4b1dadd057f4b52e1b242c40c39aba19`). That is the check worth stating: a confirmatory run whose artifact is not
the same artifact is not a confirmation of anything.

### 9.2 The four predictions

| # | as registered | reading | |
| --- | --- | --- | --- |
| **G1** | net ≥ **+5** | **+9** | holds |
| **G2** | both id-hash halves positive, `\|A − B\| ≤ 6` | **+5 / +4**, difference 1 | holds |
| **G3** | every override inside the band, so overrides ≤ band | **56 ≤ 122** | holds |
| **G4** | end to end printed as `1 156 + net` with the fraction | **1 156 → 1 165** | holds |

The falsifier — *"if arm G's net on all 1 422 cases is ≤ 0, the promotion axis closes as a class"* — **does not
fire**. Arm W is therefore authorised, and it is registered in `docs-repository:preregistration-305.md`.

G3 is worth one sentence, because it is a structural guarantee rather than a measurement: a promotion is counted in
the band before it is counted as an override, so `overrides ≤ band` holds by construction. The runner prints
`IMPOSSIBLE` if it ever stops holding, and that line exists so that the guarantee has a witness.

### 9.3 The defect this replay found — in the checker, not in the gate

The first run of the confirmatory code read **band 121, engine wrong 98 → 97, `orderDisagreement` 17**. The
disagreement count was a guard added in §9.4: it refuses to gate a case whose full order disagrees with the
population's. Seventeen cases tripped it, so seventeen cases were scored on the engine's answer instead, and one of
them was inside the band.

The guard was **too strict**. It compared the whole five-candidate prefix, and the two artifacts differ:

| first differing position | cases |
| ---: | ---: |
| 1 | 0 |
| 2 | 0 |
| 4 | 2 |
| 5 | 15 |

The gate reads exactly two things from the order: `order[0]`, which is the answer, and the pair `(full[0], full[1])`
plus `min(score)`, which is the margin and its denominator. **Position 1 never differs and position 2 never
differs.** So the correct condition is `full[0].service === engine[0]`, and with it the readings return to
`122 / 98 / 56 / 15 / 6 / 35 / +9` — bit for bit what §4 reported from the analysis script.

### 9.4 Why the tails differ, and why that is a property of this artifact family

The difference is not noise and not a bug in either writer. A structural pass — `containmentOrder` and the failure
flow — permutes **adjacent pairs of the list it is handed**. The fingerprint dump is written from the run's
top-5 answer; the terms dump is written from a separate `analyze` over the whole node set, at `topK = nodes.size`.
Those are two different lists, so the two passes are two different permutations of two different lengths, and they
diverge where a candidate exists in one and not the other: a 50-wide order has a sixth candidate that a five-wide
one cannot promote past its fifth.

`terms-dump.ts` already says the array order *is* the engine's answer and that the scores do not determine it. What
this run adds is the boundary condition: **the array order is the engine's answer at that width.** A consumer that
reads the terms dump as "the published order, longer" gets the first two positions right — which is all a margin
rule needs — and can get positions 4 and 5 wrong, which no margin rule reads.

The guard that came out of this is stated in §9.3 and is deliberately minimal: it does not claim the two artifacts
agree, only that they agree about the one candidate a promotion would move.

### 9.5 What the replay does not add

- **No new accuracy.** `1 156 → 1 165` is the same `+9` §4 reported, `81.29 % → 81.92 %`. A confirmation that
  changed the number would have been a refutation of the earlier one.
- **Still not held out.** The threshold is the one `docs-repository:preregistration-304.md` fixed, but it was chosen by looking at
  this corpus. The halves are the only internal replication and §4.1 states its limit.
- **The prompt is unchanged, which is checked rather than assumed.** The runner rebuilds each case's prompt and
  compares its digest against the one in the nominations artifact; **0 of 1 422** recorded answers belong to a
  different prompt. So the replay is a replay of the question that was asked, not an answer lent to a new one. The
  reason it holds is worth recording, because the opposite was expected: the fingerprint dump records the
  **published** order (its top-1 is `1 156`, not the `1 141` of a run whose containment pass had nothing to read),
  and both runs' dumps agree — so the table the model was shown in November and the table it would be shown now are
  the same table.

## 10. Where the gate sits in the failure decomposition, and what that makes reachable

`arXiv:2609.36686` (NeurIPS 2026, Evaluations & Datasets Track) separates a root-cause ranking's accuracy into
whether the cause entered the candidate set and whether it ranked highly once retrieved:

```
Top@k = Retrieval@K × Rerank@k
```

It also insists that the two failure masses be reported over the **whole population** rather than conditionally, so
that they sum to the total error. That decomposition is already an instrument in this repository
(`benchmarks/src/ranking-depth.ts` prints `Retrieval@K`), and the gate has never been placed in it. Doing so costs
one computation over the artifact arm G already replays.

| quantity | reading |
| --- | ---: |
| `Retrieval@5` — the answer is inside the presented five | `1 249 / 1 422 = 87.83 %` |
| `Rerank@1 ∣ Retrieval@5` — the engine's first choice, given that | `1 156 / 1 249 = 92.55 %` |
| identity check | `0.878340 × 0.925540 = 0.812940` = `Top@1` to six places |
| `Rerank@1` with the gate | `1 165 / 1 249 = 93.27 %` |
| **reranking headroom at width 5** | **+93 cases, +6.54 pp** → ceiling `87.83 %` |
| the gate took | **9 of 93 = 9.7 %** of it |

The identity holds exactly, which is what makes the rest of this section arithmetic rather than analogy.

### 10.1 Three consequences, in increasing order of how much they change the roadmap

**1. A perfect reranker at width 5 does not reach the published best.** `87.83 %` is the ceiling of this axis, and
`arXiv:2608.21310`'s `90.0 %` is 2.17 pp above it. So the 8.1 pp gap §6 names is **not one gap**: 6.54 pp of it is
reranking and 2.17 pp cannot be bought by reranking at any threshold, at any model quality, on a five-wide list.

**2. The gate is 9.7 % of the way through its own axis, and the axis is nearly closed.** Nine cases out of a
reachable ninety-three. That is a sharper statement than "+9 is small": the remaining 84 cases are cases where the
model's first choice is wrong while the answer is visible at positions 2-5, and §7's conversion rate says the model
already promotes the right one 36.6 % of the time when it can see it — so a better *admission rule* has room, but a
better **threshold** has none. Every threshold in the plateau moves single digits (§4.1). This is direct evidence
that the next lever on this axis is a **verifier**, not a wider band.

**3. Width crosses the published best, and the projection is now derived rather than borrowed.** At width 20,
`Retrieval@20 = 1 310 / 1 422 = 92.12 %`. Holding `Rerank@1` at the measured `92.55 %`:

```
0.921238 × 0.925540 = 85.26 %  =  1 212 cases
```

That is the same `85.3 %` that `docs-repository:preregistration-303.md` projected from a width-5 efficiency of `0.926`, arrived at
here by a different route — which is the first time that projection has been **independently confirmed**. And it
says something the earlier route did not: a **perfect** reranker at width 20 reaches `92.12 %`, which is **above**
the published `90.0 %`. The road to the published best is therefore width plus reranking, not a larger backbone —
and `Rerank@1` only has to reach `90.0 / 92.12 = 97.7 %` of retrieved cases for the combination to match it.

### 10.2 What this section is careful about

- **`Rerank@1` is not assumed constant across widths.** The `85.26 %` above holds it at the value measured at width
  5, and a wider list may change it in either direction: more candidates to confuse the model, or more of the
  answers it demonstrably converts. Arm W measures exactly this, which is why its prediction W3 insists the
  **denominator** stay fixed while the numerator moves.
- **`Retrieval@50 = 100 %`** on this corpus — every case's accepted answer is somewhere in the 49- or 50-wide
  order — so the decomposition's `absent` term is zero and the whole error is reranking error **at width 50**.
  Reporting `92.55 %` without that sentence would repeat the mistake the cited paper's own §"retrieval has no hits"
  passage warns about: a conditional rate quoted as if it were an unconditional one.
- **No gap is read against `arXiv:2609.36686`.** Its population is RCAEval plus three CPS datasets, it is registered
  `OTHER` in `docs/sota-populations.md`, and its artefact URL 404s
  (`docs/competitor-artefact-availability.md`). What is taken from it is the **decomposition**, which is why the
  numbers above are this project's own.

### 10.3 Arm W measured the width term, and it is net-neutral

§10.1's third consequence said a perfect reranker at width 20 reaches 92.12 %, above the published 90.0 %, and that
the road is therefore "width plus reranking". Arm W took the width half of that road and read **1 165 — the same
number arm G reached at width 5** (`docs/agentic-presentation-width.md` §10, run `44299700032`).

Two things must be said together, because either one alone is false:

- **The ceiling moved and the answer did not.** `Retrieval@20` is 1 310, so the axis opened 61 new cases and the
  arm converted **5** of them — cases whose truth sat at presented ranks 6, 9, 9, 14 and 17, which a five-wide
  table cannot produce at all.
- **The cases the width gained were paid for by cases it lost.** Arm G fixed 15 and broke 6; arm W fixed 11 and
  broke 2. Fewer overrides (56 → 32), higher precision when it did override (71.4 % → 84.6 %), the same net.

So `Rerank@1` is **not** constant across widths, and §10.2 was right to refuse to assume it: it reads
`1 165 / 1 310 = 88.93 %` at width 20 against `93.27 %` at width 5. That fall is arithmetic rather than behavioural
— the numerator is identical and the denominator grew by 61 — so the decomposition cannot, on its own, say whether
the model reranks worse. What can say it is the gate's own census: overrides `56 → 32` and conditional precision
`71.4 % → 84.6 %`. The model reranked **better** per decision and made fewer decisions, and the projection `1 212`
failed because it assumed an unchanged *count* of overrides rather than an unchanged *rate*.

The consequence for the road is stated in `agentic-presentation-width.md` §10.2: the width class closes at ≤ 20 on
this protocol, and the next lever on `Rerank@1` is an **admission rule or a better-posed question**, not a wider
list. That is the same conclusion §10.1's second consequence reached from the other side, now with a run behind it.
