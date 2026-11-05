# The prior floor, as a STANDING instrument — every artifact now prints what its own pool gave away

_Iteration 225. The floor was measured in iteration 153 and has been a section of two documents ever since. This
iteration makes it a reading: every RCAEval artifact prints the prior beside its own rate, so a number cannot be
published without the baseline it is above._

## 1. What iteration 153 established, and what was still missing

`docs/benchmark-corpus-completeness.md` §9 read the label space off the 735 loss-census rows of one run and
found that **`RE3` is prior-heavy in a way `RE1`/`RE2` are not**: the six `RE1`/`RE2` cells are five-way and
perfectly balanced (25 or 18 cases per truth), while `RE3` exposes 2, 3 and 4 truths with imbalanced
distributions, so a constant answer scores **50.0 / 40.0 / 50.0 %** on the three cells that carry this project's
weakest numbers. `docs/sota-comparison.md` §0g then carried that table into the standings, and the citation is
the published audit that made the question unavoidable:

> a ranker reading no telemetry at all places the true culprit in the top five on 99.7 percent of held-out
> incidents, scoring `Avg@5` 0.488. That prior, not the uniform-random 0.137, is the honest in-distribution
> floor. — [`arXiv:2609.27069`](https://arxiv.org/abs/2609.27069)

Three things were still missing, and each is a defect of the same kind — a measurement that exists as prose
rather than as an instrument:

1. **The floor was not printed by any run.** It was computed once, by hand, from one artifact, and then quoted.
   A later run could print an accuracy on a different configuration, or on a re-measured cell, without the
   baseline that made it readable — and the §9 column went stale the moment the engine moved from `641` to
   `656` (its `RE1:OnlineBoutique 85.6 %` is now `89.6 %`).
2. **The floor was reported as one number per cell**, the majority class. On a balanced cell that is identical
   to the uniform baseline and on an imbalanced one it is not, and no artifact separated "the pool is small"
   from "the pool is skewed" — two different statements that licence two different readings.
3. **`Avg@5` was described as degenerate but never priced.** It is the headline metric of the paper being
   answered, and its floor on this corpus is not 0.488 but `3/S` (0.60) — or `0.82` on an imbalanced three-way
   cell, where the ordered rule beats it — which the section did not state.

## 2. The closed forms

The floor needs no run, because it is a property of the corpus. The distinct truth services of a cell **are** the
services the benchmark injected into, so a ranker that reads no telemetry has two exact baselines:

```
uniform(S):  AC@k = min(k, S) / S        Avg@5 = (1/5)·Σ_{k=1..5} min(k, S)/S        Top@5 = min(5, S)/S
ordered:     AC@k = #{cases whose truth is support-ranked at most k} / n
```

The second is the majority-class rule from §9. The two agree on a balanced cell — a test asserts they agree to
twelve digits — and their difference on `RE3` is exactly the part of the floor that came from the labels rather
than from the pool size. `Avg@5` has two regimes whose boundary is `S = 5`:

| `S` | `Avg@5` at the floor | `Top@5` at the floor |
| --: | -------------------: | -------------------: |
|   2 |                 0.70 |                 1.00 |
|   3 |                 0.80 |                 1.00 |
|   5 |                 0.60 |                 1.00 |
|   6 |                 0.50 |                 0.83 |

Every cell of this corpus has `S ≤ 5`. **`Top@5` is therefore `1.00` at the floor on all nine cells**, and the
instrument says so in words on the line rather than leaving the number to be quoted.

### 2.1 Which baseline the margin is taken against — and why it is the frequency one

The ordered rule **dominates** the uniform one at every cutoff: `AC@k` under uniform is `k/S`, and the top `k`
services of a support distribution hold at least `k/S` of its cases (`k` of `S` shares of a mean of `1/S`), so
the frequency rule is the uniform rule at its weakest. A majority-class answer needs nothing but the corpus's
label counts, which every competitor in this space has, so on an imbalanced cell it is the stronger of the two
telemetry-free rankers **and the one a claim has to beat**.

The first version of this instrument printed both floors and then divided by the *weaker* one. That is a defect
of exactly the kind the instrument exists to prevent, and it is recorded in §3.2 rather than quietly fixed: on
`RE3:SockShop` it reported `45.0 %` of the margin where the true share above the majority-class rule is
`38.9 %`. `lift` is now computed against `PriorFloor.baseline`, which **is** the ordered object rather than a
second computation of it (a test asserts identity, so the two cannot drift), and the clause names the
denominator in words so no reader has to infer which of the two printed percentages was used.

The domination is a measured law, not a definition: a property test over 240 generated label spaces asserts
`baseline.ac1`, `baseline.avg5` and `baseline.top5` are each `≥` their uniform counterparts.

## 3. The instrument

`benchmarks/src/prior-floor.ts`, wired into `run-rcaeval.ts` beside the five censuses that already read the same
predictions, printed unconditionally per cell and once for the run:

```
[prior-floor] OnlineBoutique/RE1: | S=5 | telemetry-free AC@1 20.0% (uniform) 20.0% (frequency)
              | Avg@5 60.0% (uniform) 60.0% (frequency) | Top@5 100.0% | engine AC@1 89.6%
              | lift 87.0% of the reachable margin above the 20.0% frequency prior
              | — Top@5 is SATURATED by the prior here, so it is not evidence for this cell
[prior-floor] SockShop/RE3:       | S=3 | telemetry-free AC@1 33.3% (uniform) 40.0% (frequency)
              | Avg@5 80.0% (uniform) 82.0% (frequency) | Top@5 100.0% | engine AC@1 63.3%
              | lift 38.9% of the reachable margin above the 40.0% frequency prior
              | — Top@5 is SATURATED by the prior here, so it is not evidence for this cell
```

**Every number here is a closed form over the cell's case counts, so it is reproducible by hand** — which is what
makes the line an instrument rather than a claim. `lift` is `(engine − baseline) / (1 − baseline)`: the share of
the margin the prior left that the engine actually takes. It is the only one of these numbers comparable between
cells, and on a single-candidate cell — where the prior takes the whole interval and `0/0` would print as
`0.0 %`, reading as a failure — the line says `n/a` and why.

### 3.1 All nine cells, read from the artifacts

Engine rates are `656/735` (`8f0f2abf66`, battery `41943711643`); the floors are functions of the label support
alone.

| cell | n | `S` | prior `AC@1` uniform | prior `AC@1` frequency | prior `Avg@5` u / f | engine `AC@1` | lift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `RE1:OnlineBoutique` | 125 | 5 | 20.0 % | 20.0 % | 60.0 / 60.0 | **89.6 %** | **87.0 %** |
| `RE1:SockShop` | 125 | 5 | 20.0 % | 20.0 % | 60.0 / 60.0 | **95.2 %** | **94.0 %** |
| `RE1:TrainTicket` | 125 | 5 | 20.0 % | 20.0 % | 60.0 / 60.0 | **89.6 %** | **87.0 %** |
| `RE2:OnlineBoutique` | 90 | 5 | 20.0 % | 20.0 % | 60.0 / 60.0 | **93.3 %** | **91.7 %** |
| `RE2:SockShop` | 90 | 5 | 20.0 % | 20.0 % | 60.0 / 60.0 | **97.8 %** | **97.2 %** |
| `RE2:TrainTicket` | 90 | 5 | 20.0 % | 20.0 % | 60.0 / 60.0 | **83.3 %** | **79.2 %** |
| `RE3:OnlineBoutique` | 30 | 4 | 25.0 % | **50.0 %** | 70.0 / 84.0 | **83.3 %** | **66.7 %** |
| `RE3:SockShop` | 30 | 3 | 33.3 % | **40.0 %** | 80.0 / 82.0 | **63.3 %** | **38.9 %** |
| `RE3:TrainTicket` | 30 | 2 | 50.0 % | 50.0 % | 90.0 / 90.0 | **73.3 %** | **46.7 %** |
| pooled `RE1` (375) | 375 | — | — | 20.0 % | — | 91.5 % | 89.3 % |
| pooled `RE2` (270) | 270 | — | — | 20.0 % | — | 91.5 % | 89.4 % |
| pooled `RE3` (90) | 90 | — | — | **46.7 %** | — | 73.3 % | **50.0 %** |
| **whole corpus** | **735** | — | — | **23.3 %** | — | **89.3 %** | **86.0 %** |

Three readings follow, and none of them is available from the rates alone:

1. **The six `RE1`/`RE2` cells are the same task at two difficulties, and both are close to solved.** Their
   floors are identical (`20.0 %`, `Avg@5` `60.0 %`), so `79.2 – 97.2 %` of the reachable margin is the honest
   description of them; the spread between `97.2 %` (`RE2:SockShop`) and `79.2 %` (`RE2:TrainTicket`) is the
   difficulty, and it is a ranking problem rather than a pool problem.
2. **`RE3:SockShop` is the worst cell by a factor of two in the comparable unit** — `38.9 %` against `66.7 %`
   and `46.7 %` on its own suite and `79 – 97 %` on the other two — and it is *also* the cell whose floor eats
   the most: `40.0 %` of it is available to a constant answer.
3. **`RE3:OnlineBoutique` is the cell whose RANK moves most.** By rate it is joint sixth of nine (`83.3 %`,
   tied with `RE2:TrainTicket`); by margin it is **third worst** (`66.7 %`), because half of it is one class
   (`15/30`), so the floor takes `50.0 %` before the engine reads anything. It stays the best of the three `RE3`
   cells on both readings — the correction here is that "best of a weak suite" is `12.5 pp` below the *worst*
   `RE1`/`RE2` cell, which is the fact a rate ranking hides and a single-suite reading cannot see.

`RE1:OnlineBoutique` is the case §9 makes in the engine's favour: a perfectly balanced five-way cell, so the
frequency baseline collapses onto the uniform one and the whole `69.6 pp` above it was bought by reading
telemetry.

`RE3:SockShop` is the case §9 makes against it, and the per-class split is the part the aggregate hides:

| truth class | cases | engine correct | majority-class prior correct |
| --- | ---: | ---: | ---: |
| `front-end` | 9 | **9** (100 %) | 0 |
| `carts` | 12 | **5** (41.7 %) | 12 (100 %) |
| `orders` | 9 | **5** (55.6 %) | 0 |
| **cell** | 30 | **19** (63.3 %) | **12** (40.0 %) |

**On the majority class the engine is seven cases behind a blind guess, and its entire lead on the cell comes
from the one class the prior cannot name.** A cell reported as "63.3 %, above the 33.3 % chance rate" hides that;
a cell reported as "38.9 % of the margin above the majority-class rule, seven cases behind it on its own largest
class" does not.

### 3.2 The defect the instrument found in itself

The first version computed `lift` against `floor.uniform.ac1` while printing both baselines on the same line.
On the six balanced cells that is invisible — the two numbers are identical to twelve digits — and on the three
cells where it matters it flattered every one of them:

| cell | floor printed | old `lift` (÷ uniform) | corrected `lift` (÷ frequency) | delta |
| --- | ---: | ---: | ---: | ---: |
| `RE3:OnlineBoutique` | 25.0 % u / **50.0 % f** | 77.8 % | **66.7 %** | −11.1 pp |
| `RE3:SockShop` | 33.3 % u / **40.0 % f** | 45.0 % | **38.9 %** | −6.1 pp |
| `RE3:TrainTicket` | 50.0 % / 50.0 % | 46.7 % | 46.7 % | 0 (balanced) |

The direction of the error is the one to note: it was largest exactly where the corpus gives the most away, so
it made the three weakest cells look strongest relative to their own floor. The fix is three lines and a
property test; the reason it is written down is that the same shape — two baselines on one line, a division by
one of them — will be re-proposed by whoever adds a third baseline.

## 4. What this changes

1. **A rate is no longer printable without its floor.** The five censuses beside this one answer "which term
   lost the case"; this one answers "what was the case worth", and a campaign that ranks its own cells needs the
   second to choose between them.
2. **`Top@5` is retired as a headline, in the artifact rather than in prose.** It is `1.00` at the floor on every
   cell, so an engine cannot be said to beat a prior on it. `Top@3` survives only where `S > 3`.
3. **A competitor's `89 % / 96 % / 99 %` is now readable.** On the same 735 cases those three numbers sit above
   floors of roughly `0.20 / 0.60 / 1.00`; the first is a result and the third is arithmetic. And the prior
   floor of the corpus as a whole is `23.3 %`, not the `13.7 %` a uniform-random reading would give.
4. **The next cell is chosen by lift, not by rate, and the bottom of the queue is where the two disagree.**
   Worst first by margin: `RE3:SockShop` `38.9`, `RE3:TrainTicket` `46.7`, `RE3:OnlineBoutique` `66.7`,
   `RE2:TrainTicket` `79.2`, then `RE1:OnlineBoutique` and `RE1:TrainTicket` at `87.0`, `RE2:OnlineBoutique`
   `91.7`, `RE1:SockShop` `94.0`, `RE2:SockShop` `97.2`. Worst first by rate the bottom **three are the same three
   cells in the same order** (`63.3`, `73.3`, `83.3`), so the suite to work on is `RE3` under either reading —
   what the margin changes is the next two places: `RE3:OnlineBoutique` and `RE2:TrainTicket` are **equal at
   `83.3 %` on the rate and `12.5 pp` apart on the margin**, so the tie a rate ranking reports is not a tie, and
   `RE2:TrainTicket` moves from joint sixth to fourth worst.

## 5. What it does not license

**The prior is not a feature.** Restricting the candidate pool to the injected-service set would raise `AC@1` to
at least `33 %` and `Top@5` to `100 %` on every cell, and it is exactly the shortcut `2609.27069` identifies. The
census is a function of the `(truth, correct)` pairs the correctness count already carries, it is printed *beside*
the run rather than fed into it, and the module has no parameter through which a pool could be narrowed.

Nor does the corrected `lift` change the ranking of the cells against each other: it lowers three numbers and
leaves the order it produces, which is the test a correction has to pass before it is allowed to be called one.

## 6. Limits

- **`S` is read as "distinct truths in the cell"**, which is the injected set exactly when every injected service
  appears at least once — true of all nine cells, stated rather than assumed.
- **It is not a floor for FSE'26.** That corpus injects on edges with two accepted labels per case, so its
  candidate pool is a different object; the census is wired into the RCAEval runner only.
- **The frequency baseline is a label statistic**, so it is only meaningful where the label distribution is a
  property of the corpus rather than of a sample. `RE3:SockShop`'s `12 / 9 / 9` is such a distribution on 30
  cases; on a smaller cell it would be a coin toss between the two baselines.
- **A lift is a ratio of two rates over one denominator**, so it inherits the cell's sampling error: on 30 cases
  one case is 3.3 pp of rate and about 1.7 pp of lift at the `RE3:SockShop` floor.
- **The dominance proof is about expectations, not about sampling.** It says the frequency rule is never worse
  on a cell's *labels*; it says nothing about whether a competitor's model could beat both.

## 7. How to reproduce

```bash
# all nine cells; the line prints beside every other census of the run
pnpm exec tsx benchmarks/src/run-rcaeval.ts --suite re1
pnpm exec tsx benchmarks/src/run-rcaeval.ts --suite re3

# the closed forms, the dominance law and the corrected denominator, without a corpus
pnpm exec vitest run benchmarks/__tests__/prior-floor.test.ts
```
