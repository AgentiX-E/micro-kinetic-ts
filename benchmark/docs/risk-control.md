# The certified budget

The loss ladder of [`gate-rejector.md`](./gate-rejector.md) prices the acceptance condition on the corpus in front of
it: 1 123 cases for two lost in one family, 1 131 for four, 1 145 for seven. Every one of those numbers is an
**estimate**. This document is the instrument that turns them into claims, and what it says about their price.

## 1. What is estimated, and what is claimed

A family that loses two cases of 1 422 has been observed to lose 0.00141 of them. That is a point estimate. The
question a reader of a benchmark table actually has is different: _if this gate shipped and the next 1 422 cases
arrived, how many would the family lose?_ The honest answer is an interval, and at 95 % the answer for two losses of
1 422 is **0.004421** — four cases per thousand, not two.

The statistic is the exact Clopper–Pearson upper end: the smallest rate `p` for which the binomial tail
`P(X ≤ lost; n, p)` has fallen to the level. It is exact rather than normal-approximate, which matters because the
counts here are 2, 4 and 7 — precisely where a normal approximation is worst. `exactUpperOf` solves it by bisection on
the tail and is verified by plugging its answer back in: `binomCdfUpTo(lost, n, exactUpperOf(lost, n, δ)) = δ`.

## 2. Two exact rules, and what the level costs

Losses do not decrease as the bound widens, so the points a budget allows form a **prefix** of the ordered grid. The
selection rule is therefore: the widest bound whose worst family still clears the budget. That is conformal risk
control over an ordered grid (Angelopoulos, Bates, Fisch, Lei and Schuster, ICLR 2024, and its multi-parameter
extension for per-coordinate losses), and with a monotone loss it needs no correction across the grid.

It does need one across **families**, because the claim "no family loses more than `k` cases" is a statement about 25
families at once. Two rules are implemented, both exact at finite `n`:

| rule                  | level each family is held to                 | why                                                                                                                        |
| --------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **union** (`'union'`) | `δ/F`                                        | the union bound: `P(∩ A_f) ≥ 1 − Σ P(A_fᶜ)`, valid under any dependence, loose by construction                             |
| **Holm** (`'holm'`)   | `δ/(F − i + 1)` for the `i`-th smallest tail | step-down: reaching the least extreme hypothesis required rejecting every other one first, so it may be read at `δ` itself |

Holm's guarantee is family-wise error rate control, which is exactly this module's claim: if all `F` families are
rejected at their own step, then with probability at least `1 − δ` every family's rate is inside the budget. It
dominates the union bound and is never more expensive, so `'holm'` is what the command prints as the reading and
`'union'` is printed beside it as the price of the cruder bound.

## 3. The certified ladder

`tsx benchmarks/src/run-gate-rejector.ts --terms <dump>` prints the point-estimate ladder, then the certified ladder
under each rule. With the level at 0.05 over 1 422 cases and 25 families:

| budget | rule  | bound |     cases |   delta | worst family       | lost |   upper |
| -----: | ----- | ----: | --------: | ------: | ------------------ | ---: | ------: |
|  **7** | Holm  |  0.02 | **1 123** | **+50** | `HTTPRequestDelay` |    2 | 0.00442 |
|     10 | Holm  |  0.05 |     1 131 |     +58 | `HTTPRequestDelay` |    4 | 0.00643 |
|     14 | Holm  |  0.10 | **1 145** | **+72** | `HTTPRequestDelay` |    7 | 0.00919 |
|     11 | union |  0.02 |     1 123 |     +50 | `HTTPRequestDelay` |    2 | 0.00729 |
|     14 | union |  0.05 |     1 131 |     +58 | `HTTPRequestDelay` |    4 | 0.00971 |
|     22 | union |  0.10 |     1 145 |     +72 | `HTTPRequestDelay` |    7 | 0.01301 |

Four readings:

- **The cheapest certified budget is 7, not 2.** The ladder's cheapest point loses two cases and its estimate says
  "two"; the interval says 0.00442 and 7/1 422 = 0.00492 is the first rung above it. Nothing below 7 certifies
  anything, under either rule.
- **The peak survives.** +72 was the number most at risk of being a small-corpus artefact, and it certifies at 14
  (Holm) or 22 (union). The finding stands; only its price was understated.
- **Every rung loses in the same family.** `HTTPRequestDelay` binds at all three bounds, so the budget is spent on one
  family's variance. A rung that bought cases without deepening that family would be cheaper than any rung here, and
  that is the most concrete target the ladder has.
- **The two rules differ by 4, 4 and 8 cases of budget, and the difference is pure slack.** Holm's numbers are the
  floors of §4 exactly, which is the proof that the multiplicity cost of the union bound was an artefact of the bound
  rather than a property of the claim.

The level itself is a cheap knob next to those: at 0.01 the cheapest point moves from 7 to 9, while the count's own
floor for two losses stays at 7 whatever the corpus size.

## 4. Floors: more data does not buy a smaller count

`floorOf(lost, δ)` is the smallest budget **any** corpus size can certify a family that lost `lost` cases. It exists
because `n · upper(lost, n)` converges: 6.24 at 245 cases, 6.29 at 1 422, 6.296 at a million. So:

| losses observed | floor at 95 % | floor at 99 % |
| --------------: | ------------: | ------------: |
|               0 |         **3** |             6 |
|               2 |             7 |             9 |
|               4 |            10 |            12 |
|               7 |            14 |            16 |

The zero row is the rule of three and it settles an argument this register has been having since 278: **the standing
acceptance condition cannot be certified at budget zero, at any corpus size.** Zero failures rule out rates above
`−ln δ / n`, never the rate zero itself. "No regressed fault type" is therefore a description of a corpus, not a
guarantee about one, and it should be read as such wherever it appears.

The other rows say the second unwelcome thing: a family losing two cases is certifiable at seven whatever `n` is. A
larger corpus buys a smaller _share_ of itself given away, not a smaller number of cases. Collecting more cases does
not make the +50 cheaper; it makes the certificate less embarrassing to print.

## 5. What the correction costs, measured twice

The same six numbers appear twice in §3 with two different budgets, and the gap is not a rounding difference: 7
against 11, 10 against 14, 14 against 22. A reader who had only the union bound would conclude that the width of the
claim over 25 families costs 4, 4 and 8 cases of budget — and would be wrong, because that is what a _loose_ bound
costs.

The measurement that decides it is §4: Holm's rungs coincide with the floors exactly. A per-family claim with no
simultaneity would need 7, 10 and 14; Holm needs 7, 10 and 14; the union bound needs 11, 14 and 22. So multiplicity
costs nothing here, and the union bound's excess was slack — the clean families supply evidence so overwhelming (a
tail of about 1e-3 against a threshold of 0.002) that spreading the level evenly across all of them was paying
twenty-four times for something already paid for.

That is worth stating precisely, because the loose rule is the one a careful implementer reaches for first: it is
valid, it is simple, and it is wrong by a factor of nearly two in the only currency this module has. A max-statistic
bootstrap would tighten further; it is not implemented, because it buys tightness with an asymptotic argument where
both rules here buy exactness with none.

## 6. What ships

`benchmarks/src/risk-control.ts`: `exactUpperOf`, `binomCdfUpTo`, `populationOf`, `risksAt`, `certifyOf`,
`thresholdOf`, `floorOf`, `formatCertified` and the `Correction` rule, at 100 % on all four dimensions over 58 tests
whose reference values come from `scipy.stats.beta.ppf` rather than from this implementation. The command prints both
rules, and `--delta` selects the level.

No engine default moves: the module reads a dump and prints a table. What changes is what a table is allowed to say.
A number in `gate-rejector.md` is an observation about a corpus; a number in this document is a claim about the next
one, and the distance between 2 and 7 is what the word "claim" costs.
