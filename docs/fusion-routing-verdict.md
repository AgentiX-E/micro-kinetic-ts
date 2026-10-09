# Fusion verdict: deterministic routing cannot reach the union ceiling

**Status: CORRECTED — the numbers below are the 615-case measurement, and the re-take on 735 changes the
conclusion in §2. Read §2.1 before quoting any of them.** This document closes the P1 per-context routing
investigation. It records the full fusion evidence chain — head-to-head → fixed weight → weight sweep → routing
probe — and the definitive conclusion.

> **PROVENANCE — read this before quoting any number below.** The union ceiling in §1 and the whole of §2 come from
> runs produced by **`.github/workflows/benchmark-fusion-ceiling.yml`** (union) and
> **`.github/workflows/benchmark-routing-probe.yml`** (frontier), and both invocations passed `--max-cases 50` on
> RE2 — so every figure below is measured over **615 of the benchmark's 735 cases**, with RE2 sampled at 150 of
> its 270. **RE2 is the suite where the two engines disagree most**, so that is the suite a union estimate most
> needs. The caps are removed and both workflows are being re-run; §1 and §2 will be restated from the 735-case
> artifacts. See `docs/verdict-provenance.md`, which owns the rule this document is now subject to:
> **a workflow that caps its corpus may not be named by any `docs/*.md`** — so naming them here, as the producers
> of these numbers, is what makes a future re-cap fail the fence rather than pass as an omission.

## 1. The evidence chain

| Stage | Result | Regression |
|-------|--------|------------|
| Engine alone (production) | 76.1% | — (baseline) |
| PRISM alone (additive) | 76.7% | 15 cells vs engine |
| Fixed `prismWeight=1` | 81.3% (+5.18pp) | **5 cells** (delay/socket + already-100%) |
| Weight sweep (`[0, 0.1, …, 1.0]`) | best non-zero 81.3% | zero-regression frontier = **{0} only** |
| Routing probe (this iteration) | best zero-regression 77.07% (+0.98pp) | 0 cells |

**A scope correction, recorded here rather than left to a reader's inference.** The weight sweep above was
run while the engine's single PRISM call site hard-coded the pooling — `conjunctive` was implemented in
`combinePrismScore` and reachable only from the standalone evaluator — so every point of that ladder, and
therefore the `zero-regression frontier = {0}` it reports, is a statement about the **`additive` slice** of a
two-dimensional axis. The pooling is now an engine option (`docs/prism-pooling-axis.md`) and the frontier has
been re-taken over the whole space (`docs/prism-pooling-frontier.md`). The row above is that
measurement's additive slice.

**The conclusion of this document does not rest on that row alone** — the routing probe below is measured
independently of the pooling, and it is what closed the deterministic-routing direction. But the sentence the
row supports ("no single GLOBAL weight can ship") was a claim about a space made from a slice of it, and the
difference is exactly where the candidate would have lived.

The union of the two engines' correct sets — the perfect-case-oracle ceiling —
is **87.5%** (538/615). Neither the weight-sweep nor the routing probe reaches it.

## 2. Routing probe readback (run `34330734670`, 615 cases)

Disagreement structure:

| Category | Cases |
|----------|-------|
| bothCorrect | 402 |
| engineOnly | 66 |
| prismOnly | 70 |
| **bothWrong (hard floor)** | **77 (12.5%)** |

Zero-regression frontier (single-signal deterministic routers, 1664 evaluated):

| Router | Accuracy | Gain | Prism-only recovered |
|--------|----------|------|----------------------|
| always-engine (baseline) | 76.10% | — | — |
| `prism-margin > 138023.5 → prism` | **77.07%** | **+0.98pp** | **6 / 70** |
| `prism-score > 148675.7 → prism` | 77.07% | +0.98pp | 6 / 70 |
| `resource-fault → prism` | 78.0% | +2.0pp | regresses 3 cells |
| per-cell-oracle (uses truth) | 81.46% | +5.37pp | 33 / 70 (oracle, not deployable) |

Signal separation on the 136 routable cases (unconstrained by zero-regression):

| Signal | Prism-only recovered (best threshold) |
|--------|---------------------------------------|
| prism-margin | 15 / 70 |
| prism-score | 8 / 70 |
| engine-margin | 5 / 70 |

## 2.1 The re-take on the full corpus: the conclusion does not hold as written

Both workflows were re-run uncapped (`37918734605`, `37918742831`; 3/3 jobs each) with the corpus at the
benchmark's 735. Two things changed, and the second is the one this document got wrong.

**The numbers moved in the direction that favours fusion.** The union ceiling is **88.44% (650/735)**, not 87.5%
(538/615); the both-wrong floor is **85 cases (11.56%)**, not 77 (12.5%) — and **24 of those 85 are RE3**, which
is 12.2% of the corpus and 28.2% of the floor, with a **26.67%** both-wrong rate of its own.

**And the per-suite frontier is not the corpus-wide one.** §2 evaluated routers across the whole benchmark and
reported one frontier, so its conclusion — *"deterministic per-context routing is not viable"* — is a statement
about the corpus. Read per suite:

| suite | engine alone | best zero-regression | gain | deployable? |
| --- | ---: | ---: | ---: | --- |
| RE1 | 80.27% | 83.20% | +2.93 pp | no — `per-cell-oracle` reads the truth |
| RE2 | 83.33% | 89.26% | +5.93 pp | no — `per-cell-oracle` reads the truth |
| RE3 | **53.33%** | **66.67%** | **+13.33 pp** | **YES — `engine-margin < 0.5671 -> prism`, zero regressing cells** |

**RE3 was never capped.** Its 90 cases are the same quantity in both runs, so this router was measurable in the
615-case run as well — the corpus-wide view is what hid it, not the corpus. **The correction is therefore about
the SCOPE of the frontier, not about the sampling**, and the next iteration's re-take must report per suite.

**What survives.** A single GLOBAL weight is still not shippable (RE1 admits no positive weight), and RE1/RE2's
zero-regression frontier is still only reachable by truth-based oracles — so per-context routing is not reopened
there. And the RE3 router is one fitted threshold on 90 cases with **no held-out validation**, which is the same
caution this document applied to its own +0.98 pp router two iterations ago; it is a lead to test, not a
configuration to ship.

## 3. Conclusion

> **SUPERSEDED IN SCOPE by §2.1.** The statement below is about a CORPUS-WIDE frontier, and a per-suite frontier finds a deployable +13.33 pp router on RE3 with zero regressing cells. It is kept as written because the reasoning about signal separation is still the reason RE1 and RE2 have no deployable router — but it is not the whole answer, and quoting it alone is what this document got wrong.

**Deterministic per-context routing is not viable.** The three available
inference-time signals (engine `finalScore` margin, PRISM M-score/margin,
fault-type) separate engine-only from prism-only cases near-randomly. The best
zero-regression router recovers only 6 of 70 prism-only wins (+0.98pp), and
that gain is a data-fitted threshold with no held-out validation — within
overfitting/noise territory on a single 615-case benchmark.

Three distinct gaps explain the shortfall:

1. **Signal insufficiency** (+0.98pp → +5.37pp): the coarse per-cell oracle
   (system × fault-type, truth-based) reaches 81.46%, but the available signals
   cannot approximate even that static routing, recovering 6 not 33 cases.
2. **Mixed cells** (+5.37pp → +6.04pp): some (system × fault-type) cells hold
   both engine-only and prism-only wins (e.g. RE1:TrainTicket 25/21), so no
   cell-level decision is lossless.
3. **bothWrong floor**: 77 cases (12.5%) fail BOTH engines; no fusion can
   recover them. The union ceiling is capped at 87.5% regardless of router
   quality.

The deterministic frontier is therefore: engine 76.1% / PRISM 76.7% / blended
`prismWeight=1` 81.3% (5-cell regression) / zero-regression routing 77.07%.
The 87.5% union requires per-case discrimination that the deterministic signals
do not carry.

## 4. Implication

The complementary internal/external asymmetry (PRISM) vs graph-based engine
signal is real but **not separable at inference time** by the signals we can
compute deterministically. Reaching the union ceiling would require either

- richer per-case features that actually separate engine-only from prism-only
  cases, or
- a learned router (which the near-random separation of the current 3 signals
  argues against without substantial feature engineering), or
- attacking the 77-case bothWrong floor directly (dominated by RE3, where both
  engines sit near chance).

See `sota-roadmap-2026.md` for the strategic decision this feeds.
