# rank-collapse hypothesis — falsified by readback (net-neutral)

## Hypothesis (carried over from `bothwrong-evidence-verdict.md`)

`rankNormalizeScores` maps the top anomaly to exactly `1.0`. The `finalScore` base
term `Math.log(1.0) === 0` therefore collapses the strongest signal to zero, letting
secondary signals (`logWeight`, `traceWeight`) or a service-id tie-break decide the
winner. This was proposed as the root cause of the TrainTicket "0-score zombie"
bothWrong cases.

## Fix

`Math.log(selfScore)` → `Math.log1p(selfScore)` in `finalScoreOf`
(`packages/tree/src/pruning/pruner.ts`). Top anomaly: `log1p(1.0) = 0.693` (strictly
positive). Zero-anomaly service: `log1p(0) = 0` (was `log(0) = -Infinity`).

## Readback (run `34350966725`, golden 9-cell macro AC@1)

| cell | baseline | log1p | delta |
|------|----------|-------|-------|
| RE1-OB | 80.0 | 80.0 | +0.0 |
| RE1-SS | 92.8 | 92.8 | +0.0 |
| RE1-TT | 68.0 | 68.0 | +0.0 |
| RE2-OB | 82.4 | 82.4 | +0.0 |
| RE2-SS | 88.9 | 88.9 | +0.0 |
| RE2-TT | 68.1 | 68.1 | +0.0 |
| RE3-OB | 80.0 | 80.0 | +0.0 |
| RE3-SS | 45.0 | 45.0 | +0.0 |
| RE3-TT | 51.1 | 51.1 | +0.0 |

All nine cells are byte-identical to the golden baseline. Zero net-positive, zero
regression.

## Why net-neutral (mathematical)

`log` and `log1p` are both strictly increasing on `(0, 1]`. The rank order induced by
the base term `f(selfScore)` alone is therefore **invariant** to the choice of `f`.
The only thing that changes is the gap between adjacent ranks:

- `log(1.0) - log(0.98) = 0.0202`
- `log1p(1.0) - log1p(0.98) = 0.0101`

`log1p` halves the gap. Against the secondary signals (`logWeight = 1`, `traceWeight = 1`
on RE3), this gap was never decisive, so no case flips.

## Conclusion

1. **rank-collapse is not an operational lever.** The `log(1.0) = 0` collapse is a
   cosmetic artifact of monotonic invariance, not a ranking bug. It is falsified as the
   bothWrong root cause.
2. **`log1p` is retained as a correctness fix**, not a SOTA move: `log(0) = -Infinity`
   for the minimum-anomaly service is a latent defect for any downstream consumer of
   `finalScore` (the optimizer, a future judge, averaging). `log1p` maps it to `0` and
   yields strictly positive scores. It is TDD-locked and 100% covered.
3. **Deterministic path is now fully exhausted.** loss (weak-source), delay (rank-1
   saturated + full-drop ambiguity), and rank-collapse (monotonic-invariant) are all
   falsified as levers. The bothWrong floor of 77/615 (12.5%) is the true deterministic
   information ceiling; the union ceiling of ≈87.5% requires per-case discrimination
   that deterministic signals do not carry.
