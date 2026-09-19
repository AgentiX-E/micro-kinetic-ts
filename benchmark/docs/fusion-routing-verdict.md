# Fusion verdict: deterministic routing cannot reach the union ceiling

**Status: CONCLUDED.** This document closes the P1 per-context routing
investigation. It records the full fusion evidence chain — head-to-head →
fixed weight → weight sweep → routing probe — and the definitive conclusion.

## 1. The evidence chain

| Stage | Result | Regression |
|-------|--------|------------|
| Engine alone (production) | 76.1% | — (baseline) |
| PRISM alone (additive) | 76.7% | 15 cells vs engine |
| Fixed `prismWeight=1` | 81.3% (+5.18pp) | **5 cells** (delay/socket + already-100%) |
| Weight sweep (`[0, 0.1, …, 1.0]`) | best non-zero 81.3% | zero-regression frontier = **{0} only** |
| Routing probe (this iteration) | best zero-regression 77.07% (+0.98pp) | 0 cells |

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

## 3. Conclusion

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
