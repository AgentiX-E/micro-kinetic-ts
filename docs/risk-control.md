# The certified budget

The loss ladder of [`gate-rejector.md`](./gate-rejector.md) prices the acceptance condition on the corpus in front of
it: 1 123 cases for two lost in one family, 1 131 for four, 1 145 for seven. Every one of those numbers is an
**estimate**. This document is the instrument that turns them into claims, and the numbers it produces are larger.

## 1. What is estimated, and what is claimed

A family that loses two cases of 1 422 has been observed to lose 0.00141 of them. That is a point estimate. The
question a reader of a benchmark table actually has is different: _if this gate shipped and the next 1 422 cases
arrived, how many would the family lose?_ The honest answer is an interval, and at 95 % the answer for two losses of
1 422 is **0.00729** — not 0.00141. Ten cases per thousand, not two.

The statistic is the exact Clopper–Pearson upper end: the smallest rate `p` for which the binomial tail
`P(X ≤ lost; n, p)` has fallen to the level. It is exact rather than normal-approximate, which matters because the
counts here are 2, 4 and 7 — precisely where a normal approximation is worst. `exactUpperOf` solves it by bisection on
the tail and is verified by plugging its answer back in: `binomCdfUpTo(lost, n, exactUpperOf(lost, n, δ)) = δ`.

## 2. The selection rule, and why the level is split

Losses do not decrease as the bound widens, so the points a budget allows form a **prefix** of the ordered grid. The
selection rule is therefore: the widest bound whose worst family still clears the budget. That is conformal risk
control over an ordered grid (Angelopoulos, Bates, Fisch, Lei and Schuster, ICLR 2024, and the multi-parameter
extension for per-coordinate losses), and with a monotone loss it needs no correction across the grid.

It does need one across **families**. The claim "no family loses more than `k` cases" is a simultaneous claim over
`F` families, so each family is held to `δ/F` — a union bound, and the smallest one available without an assumption
we cannot make. The corpus has 25 fault families, so each is held to 0.002 rather than 0.05. The price is visible and
is the subject of §5.

## 3. The certified ladder

`tsx benchmarks/src/run-gate-rejector.ts --terms <dump>` prints the point-estimate ladder and then the same ladder
certified. With the level at 0.05 over 1 422 cases and 25 families:

| budget | bound |     cases |   delta | worst family       | lost |   upper | certified                   |
| -----: | ----: | --------: | ------: | ------------------ | ---: | ------: | --------------------------- |
|      0 |     — |         — |       — | —                  |    — |       — | no                          |
|      2 |     — |         — |       — | —                  |    — |       — | no (the 279 point estimate) |
|     10 |     — |         — |       — | —                  |    — |       — | no                          |
| **11** |  0.02 | **1 123** | **+50** | `HTTPRequestDelay` |    2 | 0.00729 | **yes**                     |
|     14 |  0.05 |     1 131 |     +58 | `HTTPRequestDelay` |    4 | 0.00971 | yes                         |
|     22 |  0.10 | **1 145** | **+72** | `HTTPRequestDelay` |    7 | 0.01301 | yes                         |

Three readings:

- **The cheapest certified budget is 11, not 2.** The ladder's cheapest point loses two cases and its estimate says
  "two"; the interval says 0.00729 and 11/1 422 = 0.00774 is the first rung above it. Nothing between 2 and 10
  certifies anything.
- **The peak still certifies, at 22.** The +72 is not a fragile artefact of a small corpus — it survives a 95 %
  interval simultaneous over 25 families. What it does not survive is being called cheap.
- **Every certified rung loses in the same family.** `HTTPRequestDelay` binds at all three, so the budget is being
  spent on one family's variance rather than spread over many. That is the most useful thing in the table for the
  next iteration: a rung that bought cases without deepening that family would be cheaper than any rung here.

The certified ladder at 99 % moves the same point from 11 to 13, and the two others by similar amounts — the
sensitivity to the level is small next to the sensitivity to the count.

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

## 5. The price of simultaneity

The same losses read at a per-family level with no simultaneous claim need 7, 10 and 14 (`floorOf` at 0.05). Read
simultaneously over 25 families they need 11, 14 and 22. So multiplicity costs **4, 4 and 8 cases of budget** — more
than the interval costs at the first rung, and the reason the certified ladder looks nothing like the estimated one.

That cost is a property of the claim, not of this implementation: 25 families is a wide claim, and a corpus with
fewer families is cheaper to certify at the same losses. It is also the one place where a tighter correction could
honestly be sought — a max-statistic bootstrap over the corpus would exploit the dependence between families instead
of assuming none — and that is stated as the next mathematical step rather than implemented, because a bootstrap
buys tightness with an asymptotic argument where the union bound buys exactness with none.

## 6. What ships

`benchmarks/src/risk-control.ts`: `exactUpperOf`, `binomCdfUpTo`, `populationOf`, `risksAt`, `certifyOf`,
`thresholdOf`, `floorOf`, `formatCertified`, at 100 % on all four dimensions over 52 tests whose reference values come
from `scipy.stats.beta.ppf` rather than from this implementation. The command prints the certified ladder under the
estimated one, and `--delta` selects the level.

No engine default moves: the module reads a dump and prints a table. What changes is what a table is allowed to say.
A number in `gate-rejector.md` is an observation about a corpus; a number in this document is a claim about the next
one, and the difference between 2 and 11 is the price of the word "claim".
