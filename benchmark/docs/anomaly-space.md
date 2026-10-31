# The anomaly's space — why an extensive operator needs the deviation

Iteration 157 shipped the topological deduction as a subtraction on what the graph reported and was
refused on TrainTicket. This document is the diagnosis: the operator was right, the _quantity it read_
was not. It is the first axis in this project closed by a question about **units** rather than about a
weight, a sign or a population, and the answer generalises to every future addition of the same kind.

## 1. The operator is extensive; the input is not

`deductExplainedAnomalies` computes

    explained(v) = max over callees c with w(v→c) > 0 of w(v→c) × anomaly(c)
    anomaly′(v)  = anomaly(v) − rho × min(anomaly(v), explained(v))

The first line **adds** a callee's anomaly into a caller's. That is a statement about a quantity that
accumulates — an influx — and it is exactly the linearisation of the collision balance
`a(v) = s(v) + Σ_c w(v→c)·a(c)` that the deduction inverts. It is only meaningful on the anomaly that
the balance is written in: the **deviation**.

`buildTopologyFaultGraph` step 1b replaces the deviation with a **rank** on every graph with at least
`anomalyNormalizeNodeThreshold` (20) services:

| suite                      | services | `anomalyNormalization` | a score is                   |
| -------------------------- | -------- | ---------------------- | ---------------------------- |
| RE1/RE2/RE3 OnlineBoutique | 12–14    | `none`                 | a deviation, order 1–3       |
| RE1/RE2/RE3 SockShop       | 12–14    | `none`                 | a deviation, order 1–3       |
| RE1/RE2/RE3 TrainTicket    | 63–69    | `rank`                 | `k/(n−1)`, steps of **1/62** |

so on TrainTicket the subtraction ran on a quantity with a granularity of 0.0161 and means, and on
OnlineBoutique on one with none. The same weight therefore did different things — which the nine-cell
dispatch measured as +1.6 pp on RE1:OnlineBoutique against −5.6 pp on RE1:TrainTicket (run
`40896889186`, ρ = 0.5, scope `external`).

## 2. The population law

On a rank surface, a node at rank `k` (0-indexed from the bottom) reads `a = k/(n−1)` while an
anomalous callee reads `a_c ≈ 1`, so

    relative effect   = rho × w × a_c / a  =  rho × w × (n−1)/k
    ranks overtaken   = rho × w × a_c × (n−1)

**Both grow with the population for a reason that has nothing to do with the graph.** Rank
normalisation is an equaliser: it replaces "the healthy floor is far away" with one gap per node, so an
absolute deduction of size δ overtakes `δ·(n−1)` services instead of the handful the data actually puts
in that interval. At ρ = 0.5, w = 0.5, n = 63 that is 15 ranks; at n = 12, 2 ranks. The mechanism is
measured directly in `topo-deduction-space.test.ts` ("makes the deduction cross the fleet on a RANK
surface"), on a fleet whose healthy floor is clustered — the shape a measured fleet has and the shape
whose rank image is uniform.

## 3. What the engine keeps, and the round trip

`FaultPropagationGraph` now carries the space it is in:

- `rawAnomalyScores` — the deviation, kept from before step 1b;
- `anomalyNormalization` — `'none' | 'rank' | 'minmax'`, which transform separates the two maps.

The deduction reads the first and returns through
`applyAnomalyNormalization(result, graph.anomalyNormalization)`, so the ranking keeps reading one space
while the operator works in another. On OnlineBoutique and SockShop `'none'` makes the round trip the
identity, which is why **the published numbers on those cells are unchanged by construction** rather
than by re-measurement agreeing.

`minMaxNormalizeScores` is extracted from the inline block for the same reason: the builder and the
round trip must be one definition of the transform, not two.

## 4. The cap, and why it sits on the subtrahend

The subtraction is now `anomaly − rho·min(anomaly, explained)` rather than `max(0, anomaly − rho·explained)`.
The difference is only in the regime `rho·explained ≥ anomaly`, which is where the linearisation has
broken down (a part cannot exceed the whole) — and it is the regime that zeroed TrainTicket's cells:

| form              | relative effect | at ρ = 1      | behaviour when `e > a`     |
| ----------------- | --------------- | ------------- | -------------------------- |
| `max(0, a − ρ·e)` | unbounded       | `max(0, a−e)` | removes the whole anomaly  |
| `a − ρ·min(a, e)` | `≤ ρ`           | `max(0, a−e)` | removes `ρ` of the anomaly |

The two agree at ρ = 1 and wherever `ρ·e ≤ a`, so the cap costs nothing where it does not bind — which
the local readings confirm: 85.6 / 87.2 / 88.0 on RE1:OnlineBoutique at ρ = 0 / 0.5 / 1 and 63.6 / 63.6 /
61.1 on RE3:SockShop, the **same numbers the uncapped form read** in iteration 157.

## 5. The defect, reproduced on real data at a chosen population

The local corpus has 12–14 services per fleet, so the builder never normalises it and the local cells
**cannot see the space at all**. They can, however, be put in it: `--anomaly-normalize-threshold 0`
forces step 1b to run on every graph, which is the TrainTicket situation at a size that fits on a
workstation. Same 30 SockShop cases and same 125 OnlineBoutique cases, same weight (ρ = 0.5), same
onset path, only the call site's input differs:

| suite              | fleet | ρ = 0 (no deduction) | ρ = 0.5, deviation space | ρ = 0.5, rank space (the defect) |      Δ (fix) |
| ------------------ | ----- | -------------------: | -----------------------: | -------------------------------: | -----------: |
| RE3 SockShop       | 12–14 |                58.8% |                **61.3%** |                        **39.6%** | **+21.7 pp** |
| RE1 OnlineBoutique | 12–14 |                84.0% |                **84.8%** |                        **82.4%** |  **+2.4 pp** |

Two readings matter more than the totals. First, the sign of the term FLIPS with the space: on
SockShop the deduction is **+2.5 pp** in deviation space and **−19.2 pp** in rank space, so the
TrainTicket −5.6 pp was never a statement about the weight — it was this table at a milder dose.
Second, the rank-space run does not merely lose cases, it loses a _fault family_: the fourth column
reads **66.7% → 0.0%**, every case of one family and no other. A deduction worth 15 ranks does not
demote a victim, it erases the ranking.

And the honest counterweight: the operator is now space-invariant, but the RANKING it feeds is not.
SockShop reads 63.6% at the shipped threshold and 58.8% at threshold 0, because rank normalisation
changes every other term too — so a run's number can still depend on the space, just not through this
operator. That is the difference between "the operator no longer reads a quantity its algebra is
invalid on" and "the engine is space-free", and only the first is what this iteration claims.

## 6. The nine cells and FSE'26

Reported in **cases**, not percentages, because a case count is what the artifact carries and it is the
only form in which a one-case difference is not mistaken for a rounding error. One commit (`9075e05`),
four arms dispatched together: control `40964201475`; ρ = 0.5 `external` `40964215103`; ρ = 1.0
`external` `40964228925`; ρ = 0.5 `all` `40964244129`. Every arm differs from the control in the single
flag the column names, and nothing else changed between them.

| suite | system         |       ρ = 0 | ρ = 0.5 `external` |     Δ | ρ = 1.0 `external` |      Δ | ρ = 0.5 `all` |      Δ |
| ----- | -------------- | ----------: | -----------------: | ----: | -----------------: | -----: | ------------: | -----: |
| RE1   | OnlineBoutique |     107/125 |            109/125 |    +2 |        **110/125** |     +3 |       109/125 |     +2 |
| RE1   | SockShop       |     116/125 |            117/125 |    +1 |            117/125 |     +1 |       116/125 |      0 |
| RE1   | TrainTicket    |     104/125 |            101/125 |    −3 |            102/125 |     −2 |       101/125 |     −3 |
| RE2   | OnlineBoutique |       80/90 |              80/90 |     0 |          **82/90** |     +2 |         80/90 |      0 |
| RE2   | SockShop       |       85/90 |              85/90 |     0 |              85/90 |      0 |         85/90 |      0 |
| RE2   | TrainTicket    |       75/90 |              74/90 |    −1 |              74/90 |     −1 |         74/90 |     −1 |
| RE3   | OnlineBoutique |       25/30 |              25/30 |     0 |              25/30 |      0 |         25/30 |      0 |
| RE3   | SockShop       |       18/30 |              18/30 |     0 |              17/30 |     −1 |     **14/30** |     −4 |
| RE3   | TrainTicket    |       21/30 |              22/30 |    +1 |          **23/30** |     +2 |         23/30 |     +2 |
| —     | **total**      | **631/735** |        **631/735** | **0** |        **635/735** | **+4** |   **627/735** | **−4** |

The same numbers as case-level `AC@1`: ρ = 0 reads 85.6 / 92.8 / 83.2, 88.9 / 94.4 / 83.3, 83.3 / 60.0 /
70.0; ρ = 1 reads 88.0 / 93.6 / 81.6, 91.1 / 94.4 / 82.2, 83.3 / 56.7 / 76.7. The harness's published cell
`AVERAGE` is a different quantity **by design** — the unweighted mean over fault types
(`docs/accuracy-aggregation.md`) — and the two agree on RE1 and RE2 (equal counts per type) and do not on
RE3, where the published column reads 88.9 / 63.6 / 71.0 (ρ = 0) and 88.9 / 61.1 / 78.1 (ρ = 1).

**The control is the shipped configuration, cell for cell.** The ρ = 0 arm is not a new baseline: it
reproduces the last shipped run (`40868666421`, `topoDiscount = 0` on `0e2d714`) on all nine cells and
all 735 cases — 107 / 116 / 104 / 80 / 85 / 75 / 25 / 18 / 21, total 631. That identity is the assertion
that the fix is **inert when the flag is off**, and it is what makes the other three columns comparable
to a published number rather than to a fresh control.

FSE'26, 1422 cases: **60.5% → 60.5%** Top@1, 79.0 → 79.0 Top@3, 82.2 → 82.2 Top@5, inert to the tenth —
its fleets are 3–13 services, so step 1b never runs and there is no space to get wrong.

### 6.1 Erratum: what the first revision of this table said, and why it was wrong

The first revision reported ρ = 0 **OnlineBoutique/RE2 as 93.3%** and therefore a **−4.4 pp** cost at
ρ = 0.5 and a **−2.2 pp** cost at ρ = 1, and read that as "the one cell with no counterpart gain". The
arm reads **80/90 = 88.9%**, and the ρ = 1 arm reads **82/90 = 91.1%**: the sign is **+2.2 pp**, not
−2.2, and the cell is one of the five that IMPROVE. Two defects produced one wrong number:

- **93.3 was SockShop's reading, in OnlineBoutique's row.** The ρ = 0 column had been assembled from
  the report text rather than re-read from the arm, and 93.3% is SockShop/RE2 in the ρ = 0.5 arm of the
  iteration before. Nothing about the operator changed — a transcription produced a phantom regression,
  and the phantom then became a reason to hold the default ("the cell with no counterpart gain").
- **A second convention made the error invisible.** The published cell `AVERAGE` is the unweighted mean
  over fault types (`docs/accuracy-aggregation.md`), while the loss census is case-level; the two agree
  on RE1 and RE2 and differ by up to **5.6 pp** on RE3 (88.9% against 83.3% for OnlineBoutique, 63.6%
  against 60.0% for SockShop). Every value in that column was therefore a plausible cell reading, and a
  wrong one could not be spotted by looking at its neighbours — only by re-reading the arm.

Both are now fenced by form rather than by care: the table above is case counts, which cannot be
transcribed from a percentage, and the census that carries them is the artifact `run-rcaeval.ts` uploads
next to the report.

**What the space was worth, at a FIXED weight — the comparison the fix is actually about** (iteration
157, run `40896889186`, same ρ = 0.5 `external`, old rank space):

| cell               | rank space (157) | deviation space (this) | Δ cases |            Δ |
| ------------------ | ---------------: | ---------------------: | ------: | -----------: |
| RE1 TrainTicket    |           97/125 |                101/125 |      +4 |      +3.2 pp |
| RE2 TrainTicket    |            73/90 |                  74/90 |      +1 |      +1.1 pp |
| RE3 TrainTicket    |            21/30 |                  22/30 |      +1 |      +3.3 pp |
| RE1 OnlineBoutique |          109/125 |                109/125 |       0 |            0 |
| RE2 OnlineBoutique |            81/90 |                  80/90 |      −1 |      −1.1 pp |
| all other cells    |                — |                      — |       0 |            0 |
| **total**          |      **626/735** |            **631/735** |  **+5** | **+0.68 pp** |

Three readings.

1. **At the weight that ships, the fix is worth +5 cases and costs one.** The old space at ρ = 0.5 sat
   five cases BELOW the no-deduction configuration (626 against 631): the operator was net destructive,
   on three TrainTicket-family cells. Moving it to its own algebra recovers all five and leaves a single
   −1 (RE2:OnlineBoutique), so the deduction at 0.5 is now exactly neutral against off — the honest
   description of a term whose axis is unadopted rather than of a term that hurts.
2. **Raising the weight still does not meet the bar, and now for a different reason.** ρ = 1 buys **+4
   cases** over shipped (635/735, 86.4% case-level) and is the highest total this project has recorded, but
   three cells give up one or two cases each (RE1:TrainTicket −2, RE2:TrainTicket −1, RE3:SockShop −1),
   so "no cell down" is still unmet and `topoDiscount` stays 0. What changed is the argument: it is no
   longer "the operator is wrong", it is "the operator is right and its weight still costs three cells a
   case apiece" — a statement about the TERM's coverage of response channels, not about its space.
3. **The scope finding replicates in cases as well as in points.** `all` costs RE3:SockShop **4 of 30
   cases** (18 → 14) and buys one on TrainTicket, which is the same ~10 pp a 30-case local slice
   predicted. The two questions — which channels, and which space — are independent, and both are now
   measured on one commit against a control that matches the shipped run exactly.

## 7. Fences

- **Reconstruction** (`causal/anomaly-space.test.ts`): for each of `'none'`, `'rank'` and `'minmax'`,
  applying the named transform to `rawAnomalyScores` reproduces `anomalyScores` exactly. A flag that
  merely named a space would be satisfied by a label; this one is a fact about the run.
- **Call site** (`causal/topo-discount-scope.test.ts`): the pruner must read `graph.rawAnomalyScores`
  and must return through `applyAnomalyNormalization`. A one-word edit puts the defect back and only a
  nine-cell dispatch would notice — so the fence is textual, next to the formula it protects.
- **Population invariance** (`unit/pruner.test.ts`): on the same configuration embedded in a 19-service
  and a 24-service fleet — below and above the threshold — the deduction moves the victim by the same
  number of ranks, and at n ≥ 20 the `selfAnomalyLog1p` term the ranking reads is bit-identical. This
  test fails if the call site reverts (verified by mutation: 1 of 1 attempts caught).

## 8. What this says about the next axis

The general statement is worth writing down because it constrains every future term: **an operator that
treats the anomaly as extensive commutes with a transform only if the transform is affine.** `minmax` is
affine (a scale and a shift), so it is order-safe; `rank` is not, because its slope depends on where a
node sits in the population. Any term added later that sums over neighbours — a pool term, a collision
term, a per-edge transfer — has the same obligation, and the obligation is now expressible in one line:
read `rawAnomalyScores`, return through `applyAnomalyNormalization`.

## 9. What is not measured

- **ρ = 0 is still the shipped default.** The axis is opt-in until the nine cells and FSE'26 say what
  the adopted value is; the local instrument cannot see the space at all (both local suites are below
  the threshold), so it can only confirm the cap is inert and no cell moved. What the fix changes at
  that weight is nothing — asserted, not assumed: the ρ = 0 arm reproduces the shipped run on all 735
  cases (§6).
- **A per-cell uncertainty.** The corpus is deterministic, so a one-case difference is real and not
  noise; but every one of these jobs also runs a second pass (`--no-inject-time`, which sets the
  anchor to `injectTimeMs: 0` = unknown) and that pass is not a repeat of the first. It moves
  RE1:OnlineBoutique by 1.6 pp and RE2:TrainTicket by 6.6 pp, and it **collapses RE3:TrainTicket from
  21/30 to 2/30**, with 27 of the 28 misses classified DEEP and, on all 28, `selfAnomalyLog1p` as the
  winner's largest per-term advantage. So RE3:TrainTicket's published number is a statement about a
  run that HAS an anchor, and the unanchored reading is 6.7%. No document in this project reports an
  interval, and every "±1 case" reading in §6 is a composition claim rather than a significance one.
- **`'minmax'` as a space — measured 2026-10-30, and REFUSED.** The `rankNormalization = false` arm had only
  ever been checked for reconstruction; one dispatch (`no_rank_normalization`, run `40984560183`) now runs it on
  the whole 735 with everything else shipped, and it costs 11 cases: RE1-TrainTicket 104 → 103, RE2-TrainTicket
  75 → 71, RE3-TrainTicket 21 → 15, and the 490 cases below the threshold **outcome-identical, 490 of 490**. So
  the threshold's population is exactly what it says it is, and restoring magnitude on the large-fleet cells
  makes all three of them worse — the flattened order is not the defect, it is what those cells are surviving
  on (`docs/base-term-price.md` §5d).
- **The slope argument, quantified.** "Rank is not affine" is a property of the transform; how much it
  costs a _specific_ fault family is a per-cell measurement, and only the nine-cell table reports it.

## 10. How to re-measure

    # the space itself — the unit tests state the population law arithmetically
    pnpm --filter @agentix-e/micro-kinetic-tree test -- topo-deduction-space anomaly-space

    # the local cells (below the threshold: the cap only)
    pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir <corpus> --suite re1 --system ob \
      --topo-discount 0.5

    # the cells the space can move
    gh workflow run benchmark-rcaeval.yml -f scopes=golden -f anomaly_knobs=topodiscount=0.5
