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
