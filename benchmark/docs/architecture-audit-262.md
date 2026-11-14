# Why the last weeks of gains do not transfer — an architecture audit

**Iteration 262.** The engine is 2× the best published number on FSE'26 (`Top@1` 76.09% against the paper's
best 37.0%) and ~11 pp above the benchmark author's own graph-free method on RCAEval (89.8% against PRISM's
78.91%, measured on the same harness). Those are real. What is not real is the assumption underneath the way
they were obtained: that the eighteen coefficients the ranking is a sum of are properties of the CAUSAL
MECHANISM rather than of the corpus they were solved on.

This document prices that assumption, names the three defects it hides, and records the instrument built to
test it (this iteration) rather than another point fix.

---

## 1. The same coefficient is worth +77 cases on one corpus and 0 on the other

Every weight in `packages/tree/src/pruning/pruner.ts` ships with a "zero-regression window" measured on the
FSE'26 archive. The same ten coefficients were priced on the golden 735 by setting each one to zero
(`docs/production-weight-leave-one-out.md`, battery `42660148243`). Put the two columns beside each other:

| coefficient | on FSE'26 (1,422 cases) | on RCAEval (735 cases) | verdict |
| --- | ---: | ---: | --- |
| `selfAnomalyWeight` (base) | the term the ranking IS | **−133** | carries both corpora |
| `logWeight` | **−460** at 0 | −0 measured; the mode is the axis | carries both |
| `dualFamilyWeight` | (FSE'26-only shape) | **−24** | carries both |
| `latWeight` | **+77** at the shipped 0.561495 | **0** | corpus-specific |
| `failedEdgeWeight` | **+80** at 1.0 | **0** | corpus-specific |
| `poolMetricPenaltyWeight` | **+6** | **0** | corpus-specific |
| `stabilityWeight` | **+1** | **0** | corpus-specific |
| `temporalWeight` | **+4** at 0.036552 | **−40.8 pp** `RE1:TT`, **−42.4 pp** `RE2:TT` | **sign flips** |
| `emissionWeight` | (FSE'26-only shape) | −6 | weak |
| `podStateWeight` | **+200** at 8 | not measured on the nine | FSE'26-only, by construction |

Five of the eight measured coefficients are worth **exactly zero** on the other corpus, and one changes sign
by more than forty points. This is not noise: `latWeight` alone is 7.9 pp of the FSE'26 headline, and the
ablation arm that removes it on RCAEval reproduces all nine golden cells **to the case**.

The mechanism is recorded in this repository already, in the docblock that rejected the temporal prior:

> on RCAEval the injection-anchored onset anchors to the SOURCE's slow-responding dominant metric, so
> "whoever moved first" is systematically a symptom

Two corpora, two injection GRAMMARS. A coefficient that reads a shape whose meaning depends on the grammar
cannot be shared across them, and no amount of window bisection changes that — bisection finds a value that
does not hurt on the corpus it was measured on, which is precisely what an in-sample fit is.

**This is what "7 up, 4 down" was.** The `eventExtraLabels` arm moved `Top@1` 1073 → 1082 while four fault
types lost cases; the losses were read as a property of the switch. They are a property of the SUM: promoting
one channel's evidence re-weights every other term's share of the same total, in cases the arm was never
about.

## 2. The weights are not importances — they are unit conversions

The score is `log1p(selfAnomaly) + Σ wᵢ·sᵢ`. The terms are not in the same unit, and the shipped weights
absorb the difference:

| term | range of the value | shipped weight | largest contribution |
| --- | --- | ---: | ---: |
| `selfAnomalyLog1p` | `[0, log 2]` = `[0, 0.693]` | 1 | **0.69** |
| `log` | `[0, 1]` | 1 | 1 |
| `lat` | `[0, 1]` | 0.561495 | 0.56 |
| `failedEdge` | `[0, 1]` | **3** | **3** |
| `podState` | `[0, 1]` | **8** | **8** |

A single pod-lifecycle term can contribute **11.5×** the maximum of the base term. That is not a statement
that pod lifecycle is eleven times as important; it is a statement that `0.5` of a [0,1] corroboration share
had to outweigh a log of an already-normalised deviation. Every time a term is added, the numbers that were
solved before it move — which is why each new term costs a re-solve of the ones around it, and why the
"window" values are six-decimal literals (`0.561495`, `0.0679`, `0.007352`) rather than round numbers: they
are the midpoints of intervals produced by a fit, not physical constants.

## 3. Every decision was made in-sample

There is a 70/15/15 stratified splitter in `packages/optimize/src/split.ts` and a GP/BO/meta-learner
optimiser beside it. Neither is on the default path. The shipped coefficients were solved by scanning the
**whole corpus** and choosing the point that maximised or preserved the headline — then the same corpus
reported it. No published cell in this repository is a held-out number.

An in-sample fit of 18 parameters over 1,422 cases is not automatically wrong, but it makes the reported
number an upper bound on generalisation, and it makes every subsequent gain smaller and more fragile for the
same reason: the remaining headroom is the part of the score that the fit could not reach.

## 4. What this iteration built instead of another fix

The engine already attaches `{weight, slope}` to every `ScoreTerm`, and its own docblock says why: *"a reader
of one dump can then answer 'at what weight would this term have decided the case' arithmetically —
`score' = score + (w' − w) × slope` — instead of dispatching one run per weight."*

That instrument existed and was never connected. This iteration connects it:

- `--terms-dump <path>` on the FSE'26 runner writes one JSON line per case: every candidate, its total, and
  every term as `[name, weight, slope]`. It re-ranks over the **whole** node set rather than the shipped top
  5, because a re-weighting can promote a candidate the shipped order never showed.
- `scripts/terms-oracle.py` re-scores that dump at any weight vector, and can rescale each term within a case
  (`none` / `minmax` / `rank`) before weighting. `none` is a self-check: it must reproduce the run's own
  `Top@1` exactly, or the screen is measuring its own bug.

One dispatch now yields a corpus-wide instrument: a weight vector, a rescaling regime, or a conditional
routing rule can be evaluated locally in seconds instead of one 40-minute dispatch per point. That is the
difference between sampling a surface and sweeping it, and it is the reason the previous month produced
single-variable arms.

## 5. The architecture this makes testable

Three changes, in order of what they can falsify, each expressible as a dump transformation — i.e. free:

| # | change | the claim it tests | falsified by |
| --- | --- | --- | --- |
| **S1** | rescale every term within the case (`rank` / `minmax`) before weighting | the corpus-specific value of `lat`/`failedEdge`/`pool` comes from their UNIT, not their signal | a rescale that loses cases on BOTH corpora at every weight ⇒ drop S1 |
| **S2** | let the AVAILABLE EVIDENCE choose the mixture: a case with no per-edge latency has no `lat` term, renormalise the rest | one coefficient vector cannot serve cases with disjoint channel inventories | a routing rule that is not separable by observable case features |
| **S3** | fit on the train split, report on test (`split.ts`, 70/15/15) | the headline survives being measured on cases no decision saw | any test-split number materially below the in-sample one |

S2 is what "adaptive" has to mean here: not an adaptive DATASET, but a mixture conditioned on what the case
can support. The evidence for it is already in §1 — the two corpora differ in which channels exist at all,
and that is observable per case without labels.

## 6. Priorities

| id | item | why it is first | acceptance |
| --- | --- | --- | --- |
| **P0** | `--terms-dump` on the full archive, self-check reproduces 1082 | without it every experiment is a dispatch | dump exists; `oracle` with no overrides prints `Top@1=1082` |
| **P0** | S1 screen (`rank` / `minmax`) at the shipped weights, both corpora | the cheapest falsification of the unit hypothesis | a regime with no per-fault-type loss on either corpus |
| **P1** | S2 routing by channel inventory | converts §1 from a complaint into a rule | held-out gain with zero per-type regression |
| **P1** | S3 held-out report of the shipped configuration | the number every claim rests on | test-split cell table published beside the in-sample one |
| **P2** | competitor decision structures, not competitor signals | see §7 | one implemented, one measured |
| **P3** | the 173 `absent` cases, re-read under S2 | the class where no mixture can help is the class that needs a new channel | `absent` count falls |

## 7. What "learning from the leaders" has to mean

Reading competitors for SIGNALS is what produced the eighteen terms; reading them for DECISION STRUCTURES is
what has not been done, and it is where each of them actually differs:

| method | its decision structure | ours today | gap |
| --- | --- | --- | --- |
| PRISM (arXiv:2601.21359) | an internal/external **axiom that removes** a candidate's evidence | we imported the axiom as two additive terms (`victim`, `dualFamily`) | we ADD where it SUBTRACTS; the mask is not adjudicated |
| TraceRCA | iterative **pruning** of a candidate set between rounds | one shot over all nodes | no iteration, so no second look |
| BARO | multi-source **fusion with per-source reliability** | fixed weights, no reliability estimate | weights are constants, not estimated |
| RCLAgent / GALA+ | agentic **hypothesis testing** with a stopping rule | none (deliberately: LLM agents measure 25–57%) | not the moat; recorded, not chased |
| RCAtlas / TORAI | evaluation-set construction (diversity axes, exclusion rules) | we consume their sets | no contribution to set construction |

The one-line consequence: the next term should be a **decision**, not another signal. S2 is exactly that.

---

## 8. What this document does NOT claim

It does not retract a published cell. The FSE'26 and RCAEval numbers are what the engine produced on those
corpora; §1 says they are produced by coefficients fitted to those corpora, which is a statement about
portability and not about arithmetic. It also does not propose a new default: nothing here ships until the
oracle screen and one dispatch agree, on both corpora, with zero regressed fault types.

---

## 9. Readback — what the instrument said on the first real dump

Everything below was measured from one dispatch (`43055506630`, 1422 cases, 69 688 candidate rows),
re-scored locally. The control reproduced the run's own `Top@1 / @3 / @5 = 1073 / 1227 / 1249`, so
the arithmetic under every row is the engine's.

### 9.1 S1, the unit hypothesis: REFUTED

| per-case rescaling of each term, weights held fixed | Top@1 | Δ |
| --- | ---: | ---: |
| none (the run) | 1073 | — |
| `minmax` to [0, 1] | 1058 | −15 |
| percentile `rank` | 833 | −240 |

The units are incompatible, and repairing them by rescaling is a loss: `rank` discards the cardinal
gap that decides a case, and `minmax` rescales one term around a vector fitted in the original units.

### 9.2 The weights are worth +114 held-out — and +1 under the rule every acceptance test uses

| reading | Top@1 | Δ vs shipped |
| --- | ---: | ---: |
| shipped | 1073 | — |
| one vector, fitted in-sample, aggregate objective | **1204** | **+131** |
| one vector, 5-fold held-out, stratified, seed 20261112 | **1187** | **+114** |
| one vector, fitted with a per-fault-type non-regression gate (types with n ≥ 20) | **1074** | **+1** |

The fourth row is the verdict. Every accepted change in this repository has had to hold "no fault type
down", and under that rule the best single weight vector in the whole space is worth **one case**. The
+131 is a TRADE: `HTTPResponseReplaceCode +62` and `HTTPRequestReplaceMethod +24` are bought with
`HTTPResponsePatchBody −3`, `HTTPRequestAbort −2` and `HTTPRequestReplacePath −1`. A single vector
cannot buy the big shapes without selling the small ones, which is what "one vector" means.

### 9.3 The ceiling: 99.30 %, and the gap is heterogeneity

| reading | Top@1 | share |
| --- | ---: | ---: |
| shipped | 1073 | 75.46 % |
| best single vector, held-out | 1187 | 83.47 % |
| **any** per-case non-negative weight vector (one LP per case) | **1412** | **99.30 %** |
| …with every weight's sign free | 1422 | 100.00 % |

A per-case LP is not jointly achievable, so 1412 is a strict upper bound on **every** weight vector
this architecture admits — including ones nobody has tried. It sits 15 pp above the best single vector
and 24 pp above the shipped one. **The model class is expressive enough; a constant parameter vector is
not.** Ten of the 1422 cases cannot be separated even with free signs, and those are the `absent`
class of `docs/absent-census.md` — a truth the candidate set never contained, which no weight can
rescue.

### 9.4 The conditioner is a label-free per-case observable, and it predicts accuracy

Which evidence channels a case carries is a property of the case, not of its label. Measured over the
corpus, with the shipped ranking:

| latency channel | failed-edge channel | log channel | cases | shipped Top@1 |
| :---: | :---: | :---: | ---: | ---: |
| ✓ | ✓ | ✓ | 598 | 86.0 % |
| – | ✓ | ✓ | 402 | 83.6 % |
| ✓ | ✓ | – | 63 | 74.6 % |
| ✓ | – | – | 99 | 70.7 % |
| – | – | – | 101 | 50.5 % |
| – | ✓ | – | **159** | **34.6 %** |

The worst bucket is not a fault type and not a system: it is **159 cases that carry a failed-edge
channel, no latency channel and no log channel**, answered at 34.6 %. That is 159 of the corpus's 349
misses in one cell of a 3-bit signature, and the signature is computable before scoring. This is the
rule that "adaptive" should have been from the start: not a different dataset, but a **mixture
conditioned on the channels the case can support**, which is also BARO's decision structure
(per-source reliability) applied where this engine actually has a choice.

### 9.5 Priorities, revised by the readback

| id | item | acceptance |
| --- | --- | --- |
| **P0** | the 159-case `failedEdge`-only bucket: a mixture over the 6 channel signatures, fitted per bucket, held-out | held-out Top@1 above 1187 with no fault type down |
| **P0** | the RCAEval dump (`--terms-dump` is now on that workflow, unconditionally) | the FSE'26-fitted vector applied to 735 cases, Top@1 not below 89.8 % |
| **P1** | re-read the 173 `absent` cases as the LP's 10 inseparable ones plus 163 that a near-miss weight could reach | the count falls, or the residue is named |
| **P2** | PRISM's subtraction as a DECISION (mask adjudication), not a term | one ablation, no fault type down |

Neither of the first two is a knob. Both are the architecture the ceiling points at.

### 9.6 The mixture, measured — and why it is not yet admissible

`--only regimes` fits one weight vector per channel signature, on four folds, and reports the fifth.

| variant | held-out Top@1 | Δ | fault types down |
| --- | ---: | ---: | --- |
| shipped | 1073 | — | — |
| one vector, aggregate objective | 1187 | **+114** | 3 types, 6 cases |
| one vector, per-type gate (n ≥ 20) | 1074 (in-sample) | **+1** | **none** |
| mixture, 6 signatures | 1185 | **+112** | 3 types, 3 cases |
| mixture, gate applied per bucket | 1144 | **+71** | 3 types, 3 cases |

The mixture and the single vector land within two cases of each other, and neither clears the rule.
The reason is structural rather than statistical: the gate is applied to ONE bucket's vector on that
bucket's training cases, while the number that has to clear is the mixture's over the whole corpus.
A per-bucket fit cannot see the interaction, so three types lose one case each and the best
admissible answer stays at +1.

What the mixture does show is where the headroom physically is: `-lat +failedEdge -log` — 159 cases,
11.2 % of the corpus — goes from **55 to 132** held-out (+77), i.e. from 34.6 % to 83.0 %. The
conditioner works; the objective does not yet compose.

**Therefore the next step is a JOINT fit**: one coordinate ascent over all six vectors with the
corpus-level gate as its objective, which is a different optimisation (the buckets share the metric)
and not a harder parameter search. The alternative — a new channel for the 159 cases — is what
`docs/absent-census.md` asked for and is unchanged by this result.

### 9.7 The cross-corpus gate: the fitted vector is HARMFUL on the other corpus

`--terms-dump` is now unconditional on the RCAEval workflow (no second analysis is needed there — the
runner already ranks over the whole node set), and the run `43120401664` produced all **735** cases:
375 RE1 + 270 RE2 + 90 RE3. The control reproduces the run's own cells exactly — RE1 `345/375`
(92.00 %, the artifact's own printed `accuracy 92.0%`), RE2 `248/270` (91.85 %), RE3 `71/90`
(78.89 %), pooled **664/735 = 90.34 %**.

Applying the FSE'26 vector of §9.2 without refitting:

| corpus | shipped | FSE'26 vector applied | Δ |
| --- | ---: | ---: | ---: |
| RE1 (375) | 345 | 302 | **−43** |
| RE2 (270) | 248 | 240 | **−8** |
| RE3 (90) | 71 | 62 | **−9** |
| **pooled (735)** | **664 (90.34 %)** | **604 (82.18 %)** | **−60 = −8.16 pp** |

This is the measurement the audit existed to make, and it settles the direction: the coefficients are
a property of the CORPUS, not of the causal mechanism, and a re-fit that gains 8 pp on one benchmark
loses 8 pp on the other. Restoring one term at a time to the corpus's own recorded weight does not
recover it (`selfAnomalyLog1p` back to 1 recovers +40 of the 60, `temporal` back to 0 another +26,
and the terms are entangled), and one term is the reverse of the expectation: `prism` at 0.5, which
the fit switched ON, is worth **+75** on RCAEval — restoring it to 0 makes the reading 529.

**What this means for the programme.** A single global vector cannot be both corpora's answer, which
is the same conclusion §9.3 reaches from the other side: the parameter vector must be conditioned,
and the conditioner must be something a case reveals about itself. The channel signature of §9.4 is
one such thing; the corpus's own injection grammar is another, and it is the one the `temporal` result
names — RCAEval anchors its onset to the source's slow response indicator, so "the source moved first"
is systematically the wrong inference there.
