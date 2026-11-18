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

The pre-registration `preregistration-303.md` authorised a width arm from the depth ladder. The same artifacts
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
