# The certificate a selection can carry

A screen prints every row and a reader ships one. This document is about the only question left at that point: **what
may be claimed about the row the table told you to ship**, once the table itself is what named it.

`docs/risk-control.md` answers the same question for a hypothesis formulated in advance. That is not what a ranking
table does. The row at the top got there because it was the best of `M` rows **on this corpus**, and a certificate that
ignores the `M` looks is a certificate about a hypothesis nobody stated.

## 1 The defect, measured

The 1 422-case dump (`it275`), 25 families, the default 28-point weight grid, the shipped weights as the reference.
The point-estimate best is `stability 0.3 + log 1.2`, +13 cases. What its claim costs depends on what it is allowed to
claim:

| reading                      |                                                    what it assumes | corpus | budget | rate      |
| ---------------------------- | -----------------------------------------------------------------: | -----: | -----: | --------- |
| **single**                   |                             the row was named before the data arrived |  1 422 |  **8** | **0.56 %** |
| **joint**                    |                            the row was the best of 28 rows on it |  1 422 | **13** | **0.91 %** |
| split, 2 folds               |                 it was named on half the corpus, priced on the other |    711 |    7.5 | 1.05 %    |
| split, 5 folds               |                                 named on four fifths, priced on one |    284 |    7.0 | 2.46 %    |
| split, 10 folds              |                                 named on nine tenths, priced on one |    142 |    7.0 | 4.92 %    |

Two facts sit in that table.

**The naive reading is the most favourable and the least true.** 0.56 % is what a certificate costs when it is computed
for a row that was named in advance, and no row in a 28-row screen was. The gap to 0.91 % is 1.6×, and it is the
winner's curse stated in this repository's own currency rather than in prose.

**Giving up half the corpus costs nearly the same as paying for 28 looks.** A 2-fold split prices the same row at
1.05 % against the joint 0.91 %: the multiplicity of 28 candidates is worth about the same as the data a split holds
back. The deeper folds show why the split cannot be pushed further — the budget stays at 7 whatever the fold size,
because **the count floor does not fall with `n`** (`floorOf`), so the rate can only fall by giving the claim more
corpus. A 10-fold split certifies the same seven cases against a tenth of the data, which is 4.92 %.

The joint reading is therefore the default: it uses the whole corpus and pays for the looks in the level. The split is
the alternative for a caller who wants an out-of-sample claim and has corpus to spare.

## 2 The arithmetic

Two multiplicities, and they compose.

- **Families.** A claim covers every family in the corpus, so it pays `δ/F` each under a union bound, or `δ/(F−i+1)` at
  the `i`-th step under Holm. This is `risk-control.md` §2 and is unchanged.
- **Candidates.** A claim about the best of `M` rows pays `δ/M` before the families are split — Bonferroni's adjustment,
  exact rather than asymptotic, and the same correction Benjamini & Yekutieli apply to intervals around selected
  parameters (JRSS-B 67, 2005).

A malformed `M` is read as **one look**, not zero: zero looks is a selection nobody made, and dividing by it would
certify every claim the module can express — the defect class the empty-family guard already refuses one level up.

`certifyLosses` is the primitive both instruments now call. It takes a **ledger** (how many cases each family loses) and
returns the smallest budget whose claim holds, the priced families, and the binding one. A family named in the ledger
but missing from the population is **added to the claim** rather than dropped: a certificate that ignores a loss it was
handed is a certificate about a different corpus. An empty population is not a corpus, and it states no claim at all —
otherwise a caller could buy a narrower claim by describing less.

## 3 The table on the real corpus

`tsx benchmarks/src/run-term-weight-screen.ts --terms <dump>` prints the landscape and then this, at `δ = 0.05`,
Holm, 28 looks. Excerpt (29 readings: the shipped row plus 28 rows):

| candidate                 | cases | delta | budget | worst family        | lost | price     | verdict         |
| ------------------------- | ----: | ----: | -----: | ------------------- | ---: | --------: | --------------- |
| shipped                   | 1 073 |     0 | **10** | `ContainerKill`     |    0 |         — | unchanged       |
| stability 0.05            | 1 074 |    +1 | **10** | `HTTPRequestDelay`  |    1 |         — | **improvement** |
| stability 0.1             | 1 075 |    +2 |     11 | `HTTPRequestDelay`  |    2 |     2.000 | concession      |
| stability 0.3             | 1 079 |    +6 |     14 | `…ReplacePath`      |    3 |     1.500 | concession      |
| stability 0.4             | 1 074 |    +1 |     16 | `…ReplaceCode`      |    5 |     0.167 | concession      |
| log 1.2                   | 1 073 |     0 |     14 | `HTTPRequestDelay`  |    4 |         — | **flat**        |
| stability 0.3 + log 1.2   | 1 086 |   +13 |     13 | `HTTPResponseDelay` |    3 | **4.333** | concession      |
| stability 0.3 + lat 0.4 + log 1.2 | 1 078 | +5 | 16 | `HTTPRequestDelay`  |    5 |     0.833 | concession      |

Three readings that the landscape alone cannot give:

- **Exactly one row buys a case without weakening the claim**: `stability 0.05`, +1 at the same budget of 10. Under the
  standing acceptance condition — no family may regress — the screen reports "the admissible set is empty"; under the
  certified condition there is exactly one row that costs nothing, and it is worth **one case**.
- **The point-estimate best is not the best buy.** `stability 0.3 + log 1.2` answers 13 more cases for three budget
  units (4.333 each), while `stability 0.1` answers 2 more for one (2.000 each) — a tuner that maximizes cases and a
  tuner that maximizes cases per unit of claim take different rows, and only the second can say what it bought.
- **The flat row exists and is easy to miss.** `log 1.2` answers the same 1 073 cases as the shipped run at a budget of
  14 instead of 10: it gives up four budget units for nothing. A table sorted by cases shows it as a tie.

## 4 The two rules, side by side

Same corpus, same 28 looks, `--correction` switched:

|                     | shipped | `stability 0.05`      | `stability 0.3 + log 1.2` | best price | certified improvements |
| ------------------- | ------: | --------------------- | ------------------------- | ---------: | ---------------------- |
| **union**           |      10 | 13 — concession, 0.333 | 20                        |  **1.857** | none                   |
| **holm**            |      10 | **10 — improvement**   | **13**                    |  **4.333** | `stability 0.05`       |

Holm's step-down is worth more here than it was in the ladder: under the union bound no row can be certified to improve
on what ships, and the best price is less than half the Holm price for the same row. The difference is not a rounding —
it is the difference between "the admissible set is empty" and "one move is free".

**The price is invariant to the level, the budgets are not.** At `δ = 0.01` the shipped budget moves 10 → 12 and the +13
row 13 → 15, so both ends rise by two and the price stays 4.333 — `stability 0.05` is still certified at the shipped
budget (12) and still buys its case for nothing. A claim's *cost in cases per unit conceded* is a property of the corpus;
its *level* is a property of the reader's appetite for being wrong. That is the same shape as the count floor: the
statistic's quantity is stable and the corpus's scale is what moves.

## 5 A defect the refactor found

`thresholdOf` used to return the corpus's own size when no budget certified anything: the bisection's upper end is a
number whatever the claim at that end says. On a one-case corpus that reported "cheapest certifiable: 1" for a corpus
where nothing was certifiable, and a test had been written to call that ceiling honest.

It is not a claim; it is the vacuity the empty-family guard already refuses one level up. At a rate of one, every
observation is certain, so a budget equal to `n` cannot be contradicted by any data. The function now checks the
ceiling and returns `null`, and the test asserts the refusal together with the count that explains it
(`floorOf(1, 0.05) = 5 > n = 1`) and the same count certifying on a corpus large enough to price it.

## 6 A defect the certificate found in the screen

The screen's `losses` field lists only families above `MIN_FAMILY_CASES = 20`, because a family of four cannot sentence
a weight move. A certificate read off that field would have been **narrower than the corpus it is about**: a family of
three losing three cases would vanish from the claim.

The measurement was already there — the map the filter reads — so the row now carries both views of it: `losses`
(filtered, for the verdict) and `ledger` (whole, for the certificate), and the report carries the corpus's `families`
so the claim's width is a property of the corpus rather than of whatever a move happened to break. One measurement, two
views, no second pass that could disagree with the first.

## 7 What this does not do

It does not select. Every row is priced, the three winners are named — most cases, tightest claim, best price — and
which to ship stays a decision whose cost its owner pays. That is the division `gate-rejector.md` keeps between the
frontier and the gate, and it is why the engine's defaults are untouched: `absolute` is still the shipped mode, and
every number in this document is a reading rather than a choice.

## 8 References

- Benjamini, Y. & Yekutieli, D. *False discovery rate-adjusted multiple confidence intervals for selected parameters.*
  JRSS-B 67(1), 71–81, 2005. — the interval form of the level split used here.
- Holm, S. *A simple sequentially rejective multiple test procedure.* Scandinavian Journal of Statistics 6(2), 65–70,
  1979. — the step-down rule, implemented as `Correction = 'holm'`.
- Clopper, C. J. & Pearson, E. S. *The use of confidence or fiducial limits illustrated in the case of the binomial.*
  Biometrika 26(4), 404–413, 1934. — the exact upper end, `exactUpperOf`.
- Bao, Y., Huo, Y., Ren, H. & Zou, C. *Selective conformal inference with false coverage-statement rate control.*
  Biometrika 111(4), 2024 (arXiv:2301.00584). — selection performed on the calibration set instead of paid for in the
  level: the tighter member of this family, and the one that needs a split.
- Angelopoulos, A. N., Bates, S., Fisch, A., Lei, L. & Schuster, T. *Conformal risk control.* 2022. — the monotone-loss
  formulation the ladder's prefix rule is an instance of.
