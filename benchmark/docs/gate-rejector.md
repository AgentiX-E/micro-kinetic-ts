# The gate as a calibrated rejector — the lead, and the price of the standing condition

Iteration 277 left one question: *the shipped gate admits 108 cases, fixes 44 and breaks 2, refuses 1 114 of which
111 were fixable and 88 would have broken — which observable separates the 111 from the 88?*

This document answers it, prices the answer, and states why the answer is not shipped by default.

---

## 1. The answer, first

**The observable is the baseline ranking's own lead** — how far its first candidate is ahead of its second, in units
of the distance the term could ever move. It is computable before the gate decides (the engine already ranks with the
term weighted out), it reads no fault type, no metric name and no latency, and its posterior is monotone in the way a
reject rule needs:

| lead bracket | cases | fixed | broken | `p(fixed)` |
|---|---:|---:|---:|---:|
| `[0.00, 0.05)` | 68 | 61 | 7 | **0.897** |
| `[0.05, 0.10)` | 17 | 13 | 4 | 0.765 |
| `[0.10, 0.20)` | 40 | 30 | 10 | 0.750 |
| `[0.20, 0.30)` | 22 | 18 | 4 | 0.818 |
| `[0.30, 0.50)` | 25 | 16 | 9 | 0.640 |
| `[0.50, 0.75)` | 18 | 12 | 6 | 0.667 |
| `[0.75, 1.00)` | 4 | 4 | 0 | 1.000 |
| `[1.00, 1.50)` | 11 | 1 | 10 | **0.091** |
| `[1.50, 2.00)` | 1 | 0 | 1 | 0.000 |
| `[2.00, ∞)` | 39 | 0 | 39 | **0.000** |

245 cases are decision-relevant (the two arms disagree). Below one unit of lead the term is right three times in
four whatever the bracket; above it the term is right once in eleven and then never. Nine of the ten brackets do not
violate monotonicity, and the isotonic fit pools the one that does.

## 2. Why the lead, stated as arithmetic

A candidate's contribution from the term is `weight × slope`, and every slope in the dump is max-normalised, so the
largest move the term can make on one candidate is `weight`. The **span** of the term on a case is that number times
the largest slope any candidate measured; the **reach** of the baseline is its lead divided by the span.

A lead above one span is beyond what the term can close *on the runner-up*. That is not a proof of impossibility —
the candidate the term promotes need not be the runner-up — and the corpus says so: above one span the term still
flips **11** cases, and it is right once. The reach is therefore a calibrated statistic, not a hard precondition, and
the one claim made about it is the measured table above.

The statistic has no fitted constant in it. `weight` is the configuration, the slope is the dump's, and the reach is
their ratio. What a run chooses is the *bound*, and the bound is chosen by Chow's rule rather than by a scan.

## 3. Chow's rule

A reject option is a decision with a cost. Acting is optimal when `p · benefit > (1 − p) · cost`, i.e. when
`p > cost / (1 + cost)` (Chow 1970). At a rate of 1 — one broken case worth one fixed one — the bar is `p > 1/2`, and
the calibrated curve crosses it between the seventh and eighth brackets: **at a lead of about one unit**, which is a
third of the span.

The bound is then read off the calibration, not chosen: `boundOf(calibrationOf(training), rate)` is the largest reach
whose pooled posterior still clears the bar. On the whole archive that is `0.30`, and it answers **1 145 of 1 422**.

## 4. The frontier, measured

`npx tsx benchmarks/src/run-gate-rejector.ts --terms <dump>` prints this. The run is 1 073; each row is a bound on
the reach, with the run's own admissions kept as a floor.

| reach | cases | delta | admitted | helps | hurts | loss | families that lose a case |
|---:|---:|---:|---:|---:|---:|---:|---|
| 0.02 | 1 123 | +50 | 241 | 58 | 8 | 4 | `HTTPRequestDelay` −2, `HTTPRequestReplacePath` −1, `PodKill` −1 |
| 0.05 | 1 131 | +58 | 333 | 72 | 14 | 8 | five families, worst −4 |
| **0.10** | **1 145** | **+72** | 438 | 95 | 23 | 15 | `HTTPRequestDelay` −7, `HTTPResponseDelay` −4, four more |
| 0.15 | 1 141 | +68 | 578 | 98 | 30 | 18 | seven families, worst −7 |
| **0.20** | **1 145** | **+72** | 639 | 104 | 32 | 19 | seven families, worst −8 |
| 0.25 | 1 142 | +69 | 739 | 107 | 38 | 23 | eight families, worst −8 |
| **0.30** | **1 145** | **+72** | 793 | 110 | 38 | 23 | eight families, worst −8 |
| **0.35** | **1 145** | **+72** | 862 | 111 | 39 | 24 | eight families, worst −9 |
| 0.50 | 1 136 | +63 | 974 | 111 | 48 | 30 | nine families, worst −9 |
| 1.00 | 1 096 | +23 | 1 038 | 111 | 88 | 70 | eleven families, worst −18 |

Two things this table says that the previous iterations could not:

1. **The total is flat over a factor of three in the bound** — 1 145 at 0.10, 0.20, 0.30 and 0.35. The corpus offers
   an interval, not a point, which is what makes the choice of 0.30 unfalsifiable-by-fold rather than lucky.
2. **The condition is not satisfiable by this statistic at any bound.** The cheapest violation is 4 loss units at
   0.02 (three families, −1 and −2), and it buys +50. There is no row with `loss = 0`.

`reach 1.00` is the "always on" arm of iteration 277 (1 096, +23), which is the second check on the reading: the
frontier degenerates to the constant arm exactly when the bound stops excluding anything, because the 180 cases with a
reach between 1 and 2 are all neutral.

## 5. Out of fold

The fold assignment is `foldOf(datapack, 5)`, the discriminator's — not a second split of one corpus.

| rate | folds | held out | run | delta | loss | bounds chosen |
|---:|---|---:|---:|---:|---:|---|
| 1 (a break costs a fix) | 5 | **1 142** | 1 073 | **+69** | 26 | 0.310, 0.310, 0.222, 0.292, 0.310 |
| 3 (a break costs three) | 5 | 1 131 | 1 073 | +58 | 17 | 0.025, 0.101, 0.190, 0.079, 0.086 |

The bound reproduces itself across folds at rate 1 — every fold lands in `[0.22, 0.31]` — and the out-of-fold total is
**within three cases of the in-sample one**. That is the signature of a statistic rather than of a fit: the number the
folds were not allowed to see costs 3 of the 72.

Per fold at rate 1: `+22`, `+8`, `+17`, `+9`, `+13`, with losses of `2`, `6`, `2`, `9`, `7` units spread over one to
six families each, the largest single family loss −4.

At a rate of 3 the rejector gives up 11 cases and 9 loss units: the two numbers move together, which is what a
decision-theoretic knob is supposed to do.

## 6. Why it is not the default

The engine's standing acceptance condition is **no regressed fault type**, and no bound of this statistic satisfies
it. The condition's price has been measured before — iteration 276 read it as **−137 cases, −9.61 pp** on a weight
vector — and this iteration reads it as **−15 to −70 loss units** on a gate bound, depending on where the bound sits.

So the mode ships **opt-in**, and the default stays `absolute`:

```
TreePruner({ failedEdgeWeight: 3, failedEdgeGateMode: 'margin', failedEdgeGateShare: 0.3 })
```

`share` at `margin` is a fraction of the term's own span (at `fleet` it is a fraction of the case's champion rise);
`DEFAULT_FAILED_EDGE_MARGIN_SHARE` is **0.3**, the measured plateau's own point. A run that selects the mode and names
no share gets that number; the shipped path reads none of it, which is asserted on the ranking rather than argued
from the source.

What the mode gives up by not being the default is 72 cases (**75.46 % → 80.52 %** on RCABench). What it would cost
is nine families losing between 1 and 9 cases each. That trade is a decision about the condition, not about the
statistic, and it is the register's to make rather than this module's.

## 7. The condition as a budget, measured

"No regressed fault type" is a budget of zero. `budgetScanOf` reads the same frontier at every budget, so the
condition stops being a veto and becomes a price list: what each rung buys, and which families pay for it. The same
command prints it after the frontier, and `--budget 0 --budget 4 …` replaces the ladder.

| budget | reach | cases | delta | helps | hurts | loss | cases bought per case lost | families that pay |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 0 | — | — | — | — | — | — | — | nothing is that cheap |
| 1 | — | — | — | — | — | — | — | nothing is that cheap |
| 2 | 0.02 | 1 123 | +50 | 58 | 8 | 4 | **12.5** | `HTTPRequestDelay` −2, `HTTPRequestReplacePath` −1, `PodKill` −1 |
| 3 | 0.02 | 1 123 | +50 | 58 | 8 | 4 | 12.5 | same |
| 4–6 | 0.05 | 1 131 | +58 | 72 | 14 | 8 | 7.3 | five families, worst −4 |
| 7–10 | 0.10 | **1 145** | **+72** | 95 | 23 | 15 | 4.8 | six families, worst −7 |

Three readings, and the first two correct guesses made before the scan ran:

1. **The cheapest rung is 2, not 1.** Every point of the frontier loses at least two cases in one family — the bound
   whose worst family is smallest is 0.02, and there `HTTPRequestDelay` loses 2. So the condition cannot be bought
   for one case anywhere on this grid, and a ladder printed only at 0 and 1 would have read as "no trade exists".
2. **The peak costs 7, not 9.** The best total sits at 0.10, where the deepest family loses 7; the earlier guess of 9
   was read off the *summed* loss at 0.35 (24) rather than the deepest family, and the sum cannot answer a per-family
   question. The rung that reaches 1 145 is therefore 7, and a reader who priced the sum would have overpaid.
3. **The trade diminishes steeply.** 12.5 cases bought per case sacrificed at the cheapest rung, 4.8 at the peak. The
   cheapest compliant number is also the most efficient one, and the peak costs 2.6× as much per case: the frontier
   is not a straight line, so "buy as many cases as possible" and "buy cases efficiently" are different rungs.

The ladder's own weakness, stated rather than hidden: every rung above 7 answers 0.10, because the bound that reaches
1 145 earliest is also the one that stays inside every budget from 7 up. A ladder that reported a *different* bound
per rung would be reporting noise: the frontier is flat between 0.10 and 0.35, so the tie-break on cases resolves to
the earliest bound at every rung that reaches the peak.

## 8. What is next

1. **Measure the mode on the golden cells.** The margin bar reads no latency and no metric name, so unlike the
   shipped bar it is expressible on the five RCAEval cells whose `edgeLatency` is empty. That is a dispatch, not an
   argument.
2. **The out-of-fold ladder.** The per-fold losses at rate 1 are `2, 6, 2, 9, 7`, so the cheapest *generalising* rung
   is not the in-sample 2. The scan exists; spending it per fold is the next reading, and it is the one that decides
   whether the budget is a property of the corpus or of a fold.
3. **The same statistic on the other conditional names.** `collision` records a zero on all 1 422 cases and `lat` is
   absent on 662; both are decisions the dump already carries, and the reach is a property of the ranking rather than
   of the term.
