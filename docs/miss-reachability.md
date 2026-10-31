# The nine windows, joined — why a weight that pays in one cell is vetoed by another

Iteration 172 closed with the fault census: 75 of the 94 misses were lost on the base term, and the reweighting
question was therefore narrowed rather than answered. This document is the join the per-cell artifacts cannot make,
done by hand on the enrolled arm's own output, and its conclusion is arithmetic: **seven of the eight switched-off
terms have no global weight at all**, because the cap is a minimum over cells and one cell with a fragile correct
case vetoes a weight another cell needs.

The reading is a join of nine `[latent]` lines — one per cell — from battery **`41188083576`** on `25b4279b`. No
dispatch produced this document and no arm is inferred from a single cell.

## 1. What the line already says, and what it cannot

`formatLatentTermLine` prints, per cell, each term's **cap** (the weight at which a correct case in that cell loses
its place) and its **need** (the smallest weight that wins a miss back), and counts the misses whose need sits
strictly below the cap. That count is the term's window **in that cell**, and it is the right instrument for the
question "is this term pointing the right way here".

It cannot answer the question a weight decision actually asks, because a weight is one number and the cells are
nine. The decision is a conjunction:

    win the cases in every cell you want to win
    AND stay below the cap in EVERY cell, including the eight where you want nothing

The second clause is the one that binds, and it is invisible in a per-cell reading by construction.
`latent-term-census.md` §6 names exactly this as the shippable quantity — "a weight is global, so the shippable window
is the **intersection** over the nine cells, and this sandbox can see two of them" — and it is the reason the line
prints per cell rather than being folded. Nine cells are in hand from one battery, so the intersection can now be
taken.

## 2. The nine cells

| cell | misses | guarded | terms with a window, `flips(cap, need)` |
|---|---|---|---|
| RE1:OnlineBoutique | 17 | 107 | `temporal` 1 (0.123, 0.016) · `topo` 1 (0.215, 0.028) · `collision` 1 (0.086, 0.070) |
| RE1:SockShop | 6 | 117 | `dualFamily` 2 (1.059, 0.335) · `prism` 1 (0.129, 0.103) · `rise` 1 (0.343, 0.156) · `collision` 1 (0.843, 0.298) |
| RE1:TrainTicket | 19 | 106 | `rise` 5 (0.550, 0.011) · `temporal` 3 (0.069, 0.017) · `prism` 2 (0.013, 0.008) · `collision` 2 (0.026, 0.013) |
| RE2:OnlineBoutique | 3 | 83 | `prism` 1 (5.717, 1.319) |
| RE2:SockShop | 0 | 88 | — (the cell loses nothing, so every term is closed there and its caps are the whole budget) |
| RE2:TrainTicket | 15 | 75 | `prism` 7 (0.749, 0.012) |
| RE3:OnlineBoutique | 2 | 25 | `prism` 1 (1.381, 0.083) · `rise` 1 (0.284, 0.142) · `dualFamily` 1 (0.946, 0.330) |
| RE3:SockShop | 12 | 18 | — |
| RE3:TrainTicket | 8 | 22 | `dualFamily` 3 (0.781, 0.258) · `prism` 1 (0.097, 0.008) · `stability` 1 (0.082, 0.017) · `source` 1 (0.076, 0.023) |

The eight non-base terms between them hold **37 case-wins** across the nine cells — the base term itself, which
`latent` also prices, holds one more. Read cell by cell, that is a list of eight arms. Read as a conjunction, it is
one.

## 3. The join: a cap is a MINIMUM, and the minimum comes from a cell with nothing to win

For each term, the global window is `(min need over the cells that pay, min cap over ALL cells)`. It is non-empty
only when the second number is larger than the first.

| term | min cap | which cell sets it | smallest need | cells that pay | window |
|---|---|---|---|---|---|
| `collision` | **0.005** | RE3:TrainTicket | 0.013 | 3 | **none** |
| `rise` | **0.001** | RE3:TrainTicket | 0.011 | 3 | **none** |
| `source` | **0.005** | RE1:OnlineBoutique | 0.022 | 2 | **none** |
| `topo` | **0.008** | RE1:TrainTicket | 0.009 | 2 | **none** (0.001 short) |
| `temporal` | **0.010** | RE3:TrainTicket | 0.016 | 2 | **none** |
| `stability` | **0.012** | RE2:TrainTicket | 0.017 | 2 | **none** |
| `prism` | **0.013** | RE1:TrainTicket | 0.008 | 6 | (0.008, 0.013) — width 0.005 |
| `dualFamily` | **0.781** | RE3:TrainTicket | 0.258 | 3 | (0.258, 0.781) — width 0.52 |

Seven of the eight switched-off terms have no window at all. Not a narrow one: **none**. And in five of the seven
the cell that sets the cap is a cell the term cannot pay in either — `collision` and `temporal` are vetoed by
RE3:TrainTicket, where their own entries read `need=none` (no miss in that cell is reachable at any weight), while
`rise` is vetoed by the same cell at `cap=0.001` against its own `need=0.352` there. The terms that would pay in
RE1:TrainTicket are priced out by a cell that would gain nothing from them at any price.

This is the arithmetic behind the shape the register keeps recording — "five cells gain eight cases, three give up
four", "it re-ranks delay faults as often as it repairs them". A weight grid cannot separate two cells whose caps
differ by a factor of 550 within one term, and no value of the weight is missing: the SET of cases the weight acts
on is the same set in every cell.

## 4. The two windows that exist, and what is different about them

Both survivors are terms whose reading is a **decision rather than a magnitude**.

`prism` holds the widest benefit in the corpus — 13 of the 38 case-wins — and its global window is
`(0.008, 0.013)`, five thousandths wide, bounded above by RE1:TrainTicket where two cases need 0.008. Inside that
window the corpus pays at most 13 cases and the artifact does not say how many: the line records the number of misses
whose need is below the CELL's cap, not below a given weight, so the count inside a global window needs the
histogram this artifact does not carry (§6).

`dualFamily` ships at **0.25** and its cheapest win needs **0.258** — eight thousandths above the value in
production. At 0.34 it reaches all three paying cells: 3 + 1 + 2 = **6 cases**, against a cap of 0.781, i.e. with
2.3× headroom rather than a knife edge. It is the only term in the formula whose slope is binary (`0/1` membership
of the dual family) and that is why: a difference of one membership unit is a fixed number, so the demand is a
number on the same scale as the membership bonus, whatever the cell's anomaly surface is doing.

## 5. What this authorises, and what it does not

One arm is supported by arithmetic that a reader can check on the printed lines: **`dualFamilyWeight` 0.25 → 0.34**,
predicted +6 cases with no cell's cap crossed. One is *not*: `prism` inside `(0.008, 0.013)` is a knife edge whose
upper bound is one correct case in a 64-node rank surface, and the register's own rule is that an arm is refused
when a cell goes down — a window of width 0.005 is not a setting, it is a coincidence of this corpus.

**Caveat that must be checked before the arm is read.** `dualFamily` also carries `dualFamilyGate = 0.25` and
`dualFamilyGateMode = channel`, and a term whose weight decides WHICH candidates are admitted is affine only
conditional on the population it admits — `latent-term-census.ts` says so in its own docblock. If the gate reads the
weight, the prediction above does not hold and the arm is a measurement rather than a confirmation.

## 6. Limits, stated rather than implied

- **The caps are exact minima; the needs are minima.** `[latent]` sorts the closed terms by cap ASCENDING and
  truncates with `+N`, so the omitted terms have LARGER caps and the printed minimum is the true minimum. The needs
  are not sorted, so `need` is the smallest demand in the cell and the number of cases below any particular weight
  is unreadable here.
- **Benefit and cost are both measured, counts inside a window are not.** The cap is a real cost (a guarded correct
  case) and the flips are real benefits (a miss with a window). What is missing is the joint count, and it is
  missing from the artifact rather than from the arithmetic.
- **Both bounds are taken over the WHOLE ranking, not over the recorded winner and runner-up.** That is the fix
  `latent-term-census.md` §3 records after two arms refuted the narrow form (`prism=0.30` cost a cell a case broken
  by a candidate two places down), so a cap read here is not the optimistic one that failed in RE3-SockShop.
- **A cell that loses nothing still sets caps.** `RE2:SockShop` reads `misses=0` and still records
  `topo cap=0.013`, `prism cap=0.015`, `collision cap=0.047` from its 88 guarded cases — a perfect cell is the most
  informative cell about cost, which is what `formatLatentTermLine` says in its own comment. It sets no term's
  minimum here by 0.002 in one case (`prism`), so it is one unlucky correct case away from being the binding cell of
  the corpus.
- **One suite at a time.** A job runs the three systems of one suite, so the join above spans nine cells only
  because three jobs were read together. Nothing in the artifact enforces that the three were the same revision,
  and this document's claim is that they were: one battery, one revision, `25b4279b`.

## 7. The instrument this owes

A per-cell **histogram of required weights** per term, in a machine-readable artifact, so that "how many cases does
this term win inside `(0.008, 0.013)`" is a lookup rather than an estimate. The line prints `min` and a count
against the cell's own cap; the missing population is the distribution between them. Until it exists, a window's
WIDTH is readable and its YIELD is not, and the difference between those two is the difference between an arm and a
guess.
