# The PRISM pooling axis: the second combination function, and the engine that could not name it

**Status:** axis enrolled and dispatchable. `TreePrunerOptions.prismPooling` (`--prism-pooling`) selects which
of PRISM's two combination functions the fused `prismScore` is built with, the value is stated on the reported
configuration line, and the ablation battery carries the two rows that measure it. It is **open** rather than
closed: the pooling has never been measured inside the engine, only by the standalone evaluator, and the global
flip is not a gain.

## 1. The axis

PRISM's one signal is the internal-vs-external attribute asymmetry: a root cause is anomalous in its *internal*
attributes (cpu / mem / disk / socket) **and** its *external* ones (latency / error / throughput), while a victim
component shows external anomalies only. The asymmetry is realised by two different combination functions:

```
additive      M = S^I + S^E − log1p(S^I + S^E)     sub-linear dampener; a single huge score is softened,
                                                  an external-only symptom is still a candidate
conjunctive   M = min(S^I, S^E)                    the score is GATED by the weaker channel; an
                                                  external-only symptom scores 0
```

`packages/core/src/anomaly/prism.ts` implements both, `PRISM_POOLINGS` is the census over the union,
`DEFAULT_PRISM_POOLING` is the paper's own default (`additive`) and `isPrismPooling` is the guard the runners
parse with. The pooling is the axis; the union, its census and its guard live beside `combinePrismScore` because
that function is shared by the standalone evaluator and by the engine's fused signal.

## 2. What the axis measures, on the identical 735 cases

`docs/prism-head-to-head.md` §2 records the controlled head-to-head (run `34246577708`, the same 735 cases our
nine cells are measured on, same service-level AC@1 protocol, same tie-break). Both poolings, per cell, against
the engine:

| cell | additive | conjunctive | engine (golden) | conj − add |
| --- | ---: | ---: | ---: | ---: |
| RE1 OnlineBoutique | **84.0%** | 51.2% | 80.0% | −32.8 |
| RE1 SockShop | **88.0%** | 80.8% | 92.8% | −7.2 |
| RE1 TrainTicket | **64.8%** | 64.0% | 68.0% | −0.8 |
| RE2 OnlineBoutique | **92.2%** | 82.2% | **86.7%** | −10.0 |
| RE2 SockShop | **87.8%** | 78.9% | **92.2%** | −8.9 |
| RE2 TrainTicket | **81.1%** | 74.4% | **71.1%** | −6.7 |
| RE3 OnlineBoutique | 80.0% | **83.3%** | 80.0% | +3.3 |
| RE3 SockShop | **50.0%** | 26.7% | 45.0% | −23.3 |
| RE3 TrainTicket | 33.3% | **76.7%** | 51.1% | **+43.4** |
| **Overall** | **78.9%** | 69.8% | **78.75%** | −9.1 |

> **Correction (it. 75).** The `ours` column was measured on **615** of the 735 cases — RE2’s
> invocation was capped at 50 of its 90 per system — and is now the full-corpus measurement
> (`86.7 / 92.2 / 71.1` on RE2, overall **78.75%**; run `37872246084`). PRISM’s columns are unaffected,
> because its runner never capped, so this table is now **735 against 735**. The last column is
> `conjunctive − additive` and does not involve our column at all.

Read as a population rather than as an average: **`additive` wins 7 of the 9 cells — every resource-fault cell
of RE1 and RE2 — and `conjunctive` wins exactly 2, both of them RE3.** Its largest single-cell margin anywhere in
this repository's record is **RE3 TrainTicket 76.7% against `additive`'s 33.3%** (+43.4pp), on the weakest cell
of the published nine (51.1%); its worst is RE1 OnlineBoutique, where it collapses to 51.2% against 84.0%.

**A global choice is therefore unsupportable in either direction**, and that is the finding rather than a
preference. The nine-cell average (−9.1pp) is not a statement about the cells; the cells are two disjoint
populations that want opposite answers. Anything that reads the axis correctly must be **per-context** — which
is also the shape `docs/closed-axes-register.md` §"What is left" independently arrives at for the FSE'26
misses (89% of them reachable by reweighting but 89% and 11% wanting opposite weightings, i.e. conflict
between cases rather than absent evidence). The correct object is a discriminator that decides *which term to
trust*, and the pooling is a term whose answer flips by cell.

## 3. The defect this enrolment repairs: an unreachable knob

`conjunctive` was implemented, and it was measured — but only by the standalone evaluator
(`scripts/run-prism.ts --pooling conjunctive`). The engine's single call site read

```ts
computePrismScore(metrics, new Set(callGraph.nodes.keys()), injectTimeMs)   // pooling omitted
```

`computePrismScores` already took the pooling as its fourth parameter; the call site simply did not pass it. So
**every engine run, every ablation row and every workflow dispatch combined additively whatever it was
configured with**, and the second column of the table in §2 was reproducible from no engine configuration at
all. The table could be published while being unreproducible from the engine.

This is the failure the repository already names: **a repaired pin whose replacement is unreachable is still a
pin** (`docs/dispatch-surface-audit.md`, Finding 2). An option that exists in a primitive and is reachable only
from a script beside the engine is an **open axis**, not a closed one — no measurement of the engine had ever
been taken with it.

## 4. What is enrolled

| layer | what changed |
| --- | --- |
| core | `PRISM_POOLINGS` (a `Record` over the union, so a new member is a compile error), `DEFAULT_PRISM_POOLING`, `isPrismPooling` (via `hasOwnProperty.call`, so the prototype chain cannot be a member) |
| engine | `TreePrunerOptions.prismPooling`, defaulted to `DEFAULT_PRISM_POOLING` — the value the call site already passed **by omission**; the pooling is now forwarded to the primitive at the single call site |
| runner | `--prism-pooling`, parsed against `isPrismPooling` rather than a hand-written pair, falling back to the shipped pooling on an unusable value like every other mode flag |
| artifact | `prismPooling=<value>` on the reported configuration line and on the ablation artifact's line |
| study | `AblationWeightOverrides` became `AblationEngineOverrides` (the first member that is not a number), and the battery carries the two pooling rows as the **additive rows' siblings** — the flags spread from the named `PRISM_ONLY_FLAGS` / `PRODUCTION_PRISM_FLAGS` constants, one override apart |
| register | a `dispatch-surface-census` KNOBS row, owner this document; `--prism-pooling` recorded in `UNDISPATCHABLE_ON_RCAEVAL` |

The sibling construction is what makes the delta attributable: a row that retyped twelve booleans would
attribute a flag's effect to the pooling, which is the one thing a single-knob ablation must not do.

## 5. Acceptance, and what it does NOT claim

**The accepted configuration is unchanged by construction.** The shipped pooling is the value the call site
already passed by omission, so the golden 9-cell must be **byte-identical** and FSE'26 must show **zero
regressed fault types** — the shared kill criterion, both halves. That is an AND, and it is the criterion for
exactly one claim: the pooling is inert while `prismWeight` is 0, which is the shipped value, so moving this
axis may not move a published number.

It does **not** claim a gain. The direction §2 points at is a per-context choice, and two of nine cells is not a
global gain. What the enrolment buys is the ability to ask the question on the register's own ablation
reference for the first time.

**And it is not yet decidable on both halves of the criterion.** `--prism-pooling` is accepted by the RCAEval
runner and reachable from no workflow, which is why it is recorded in `UNDISPATCHABLE_ON_RCAEVAL`: a candidate
that ships a per-context pooling rule would need a `prism_pooling` dispatch input before its golden half could
be measured.

**The frontier it belongs to has now been re-taken.** The weight sweep that closed the fusion direction
(`docs/fusion-routing-verdict.md`) swept `prismWeight` alone, which was the only dimension it could sweep —
the pooling was unreachable — so its `zero-regression frontier = {0}` describes the additive slice.
`packages/kinetic/src/benchmarks/leaderboard/prism-sweep.ts` now takes the axis as a list of POINTS, each
naming its own weight and pooling, and refuses an axis that does not start at the shipped configuration, a
duplicated point, or a label that disagrees with the point it labels. The readback is
`docs/prism-pooling-frontier.md`; the swept columns are
`w ∈ {0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0} × {additive, conjunctive}`, with the other pooling's weight-0
column serving as an inert control the runner asserts against the baseline **from the data**, and the best
point required to name its pooling because the weight alone is now ambiguous.

## 6. Files

- `packages/core/src/anomaly/prism.ts` — the union, `PRISM_POOLINGS`, `DEFAULT_PRISM_POOLING`,
  `isPrismPooling`; `combinePrismScore` defaults to the constant.
- `packages/tree/src/pruning/prism-signal.ts` — re-exports the vocabulary beside `computePrismScores`.
- `packages/tree/src/pruning/pruner.ts` — `TreePrunerOptions.prismPooling`, forwarded at the one call site.
- `benchmarks/src/rcaeval-cli.ts` — `--prism-pooling`, by the union's own guard.
- `benchmarks/src/rcaeval-engine-options.ts` — the option object and the reported line.
- `benchmarks/src/ablation-engine-options.ts`, `benchmarks/src/run-ablation.ts` — `AblationEngineOverrides`
  and the two sibling rows.
- `docs/dispatch-surface-audit.md` — the knob's three names and its owner.
- `docs/prism-head-to-head.md` — the measurement in §2.
