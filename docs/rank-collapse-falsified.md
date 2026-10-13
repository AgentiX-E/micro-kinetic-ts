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

---

## 2026-10-13 — the SCALE argument the "gap was never decisive" sentence left open, and the pin's confounded control

The section above computes `log1p(1.0) - log1p(0.98) = 0.0101` and concludes, correctly, that **halving the gap
flips no case**. That statement is about the CHANGE. It has been read for a session as if it also said the base
term's gap is not what decides — and **that reading is wrong, in the direction that matters**. This section is
the measurement of what actually decides, on the same artifacts.

### 1. The base term's deciding magnitude, per cell

`top1Terms` and `truthEvidence.terms` carry the winner's and the truth's decompositions for every case, so
`|Δ selfAnomalyLog1p|` is the base term's own contribution to the gap. Restricted to the **159 misses** that
carry both (the correct cases are excluded: there the winner IS the truth, so every term is identical by
construction and the comparison is vacuous — a trap this read fell into once before it was corrected):

| cell | misses | base median abs-delta | the base term is the largest mover |
| --- | ---: | ---: | ---: |
| RE1-OnlineBoutique | 24 | 0.2269 | 24 / 24 |
| RE1-SockShop | 9 | 0.3621 | 9 / 9 |
| **RE1-TrainTicket** | 40 | **0.0160** | 40 / 40 |
| RE2-OnlineBoutique | 11 | 0.1226 | 11 / 11 |
| RE2-SockShop | 7 | 0.0985 | 6 / 7 |
| **RE2-TrainTicket** | 26 | **0.0494** | 26 / 26 |
| RE3-OnlineBoutique | 8 | 0.2654 | 7 / 8 |
| RE3-SockShop | 19 | 0.1450 | 16 / 19 |
| RE3-TrainTicket | 15 | 0.2213 | 10 / 15 |

**So the base term is the largest single contributor on 149 of 159 misses — and on TrainTicket it is largest by a
margin of `0.016` to `0.049`.** The two facts are not in tension: the term is the biggest mover AND its moves are
an order of magnitude smaller there. **That is what rank normalisation does at 68–69 nodes**: the anomaly it
feeds the base term is a POSITION on a 68-step grid, so adjacent ranks are `1/(n-1)` apart and `log1p` compresses
them further — `log1p(1) - log1p(67/68) = 0.0083`.

### 2. The terms it competes against are BINARY, and worth ~100 of those steps

The same 159 misses, aggregated by the absolute delta each term contributes:

| term | Σ abs-delta | share | what its contribution IS |
| --- | ---: | ---: | --- |
| `selfAnomalyLog1p` | 25.8318 | 71.4% | `log1p` of a rank grid or a raw deviation |
| `trace` | 6.0000 | 16.6% | **exactly `{0, 1}`** — 6 movements at exactly ±1 |
| `log` | 4.0000 | 11.1% | **exactly `{0, 1}`** — 4 movements at exactly ±1 |
| `stability` | 0.3612 | 1.0% | a bounded score at weight `0.007352` |
| the other nine | 0.0000 | 0.0% | zero-weight |

The integer totals are the tell: **`6.0000` and `4.0000` are not sums of magnitudes, they are counts of flips.**
Each binary term contributes `±1` or nothing. Against TrainTicket's `0.0083`–`0.049` base steps, **one flip of
`trace` or `log` is worth 20 to 120 base ranks** — and against the base term's own total swing on a case, more
than it can ever recover.

**And both terms are unanimously wrong.** Solving the two-candidate problem `margin = A + Σ theta_k · B_k = 0`
(the winner is the incumbent top-1, so beating it IS winning the case):

| term | cases it moved | of those, favouring the truth | favouring the winner |
| --- | ---: | ---: | ---: |
| `trace` | 6 | **0** | **6** |
| `log` | 4 | **0** | **4** |

**Ten movements, ten against.** The per-case weight at which each case would be exactly balanced:

- `traceWeight`: `-0.3252, -0.2798, -0.1250, -0.0101, 0.0408, 0.0792` — so **`traceWeight = 0` fixes the two cases
  whose threshold is positive** (`0.0408`, `0.0792`), and the other four need a NEGATIVE weight, i.e. the truth
  also trails on everything else.
- `logWeight`: `-0.0257, 0.0751, 0.0981, 0.3147` — **`logWeight = 0` fixes three.** But it is not admissible:
  `logWeight` is the largest weight in the ranking and the FSE'26 half measures `logWeight = 0` at **14.98%
  Top@1**, so the kill criterion's AND refuses it on the other benchmark whether this one likes it or not.

### 3. What this read does NOT establish, stated because the register's own law requires it

**The 2-candidate view proves REACHABILITY, not SAFETY.** `top1Terms` and `truthEvidence.terms` describe two
candidates; the runner-up is not in the census. So "`traceWeight = 0` fixes 2 cases" is sound — nothing in the
159 misses requires `traceWeight > 0` — and "it breaks nothing" is **not**: turning the term off also shrinks the
margin between a correct top-1 and whoever is second, and this artifact cannot see who that is. **A count of the
cases a change could affect carries no information about the cases it does**, which is the register's own reason
for demanding a run rather than an estimate.

`logWeight = 0` is additionally refuted from outside this corpus, as above. **Only `traceWeight = 0` is a live
candidate, and only a run can decide it.**

### 4. And the RE3 pin's own evidence is CONFOUNDED, which makes that run the first clean test

The pin is `--trace-weight 1` on the RE3 job. Its evidence is `docs/fse26-cv-screen.md`'s fidelity table, where
three RE3 dumps differ in TWO variables at once:

| dump | `traceWeight` | `noInjectTime` | dump `prediction=` |
| --- | ---: | --- | ---: |
| `re3` | **1** | off | **48** |
| `re3-noinject` | **0** | **on** | 37 |
| `re3-novelty` | **0** | **on** | 37 |

**The controls move the trace weight AND the injection anchor together**, so the recorded 48-vs-37 margin
attributes to `traceWeight` a difference that `noInjectTime` may have produced — and `noInjectTime` is separately
classified as *"an ablation of the SETUP"* rather than a ranking knob, i.e. a change to the input the engine
sees. There is no RE3 dump with `traceWeight = 0` and the anchor on.

**So the pin rests on a comparison that varies two things, and this iteration's free read says the term it
credits is worth two cases in the OTHER direction.** The two cannot both be right, and the run that settles it is
now dispatchable for the first time: `trace_weight` became a workflow input in iteration 96 and
`DEFAULT_TRACE_WEIGHT` gave its default a name in this one.

**Prediction, recorded before the run.** Every suite but RE3 already runs `traceWeight = 0`, so a dispatch of
`trace_weight=0` must leave **RE1 and RE2 byte-identical** — nine-cell rows AND the `signals:` prefix — and may
move **only** RE3's three cells. A difference anywhere else is evidence that something other than this input
moved, and that is what makes the dispatch a measurement rather than a hope.

### 5. What changed in the code, and it is the residue `dispatch-surface-audit.md` left

`traceWeight` shipped as a bare literal in **four** places — the engine's own `DEFAULT_TREE_PRUNER_OPTIONS`, and
each parser's field default and `parseWeight` fallback — with the RE3 job pinning a bare `1` beside them. It now
reads **`DEFAULT_TRACE_WEIGHT`**, exported from `packages/tree` beside `DEFAULT_LOG_WEIGHT` and
`DEFAULT_LOG_SIGNAL_MODE`, so the golden workflow's description can state its default as a NUMBER and the
description guard can check it. That closes the last item in the audit document's Finding 6, and it is the third
instance of the class: a value with several owners and no name.
