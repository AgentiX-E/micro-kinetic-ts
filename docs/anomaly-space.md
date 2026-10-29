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

`AC@1`, per suite and system, one commit (`9075e05`), four arms dispatched together. Runs, in the
table's column order: control `40964201475`; ρ = 0.5 `external` `40964215103`; ρ = 1.0 `external`
`40964228925`; ρ = 0.5 `all` `40964244129`. Every arm differs from the control in the single flag the
column names, and nothing else changed between them.

| suite | system         |              ρ = 0 | ρ = 0.5 `external` |                     Δ |     ρ = 1.0 `external` |                      Δ |      ρ = 0.5 `all` |                  Δ |
| ----- | -------------- | -----------------: | -----------------: | --------------------: | ---------------------: | ---------------------: | -----------------: | -----------------: |
| RE1   | OnlineBoutique |              85.6% |              87.2% |                  +1.6 |              **88.0%** |               **+2.4** |              87.2% |               +1.6 |
| RE1   | SockShop       |              92.8% |              93.6% |                  +0.8 |                  93.6% |                   +0.8 |              92.8% |                0.0 |
| RE1   | TrainTicket    |              83.2% |              80.8% |                  −2.4 |                  81.6% |                   −1.6 |              80.8% |               −2.4 |
| RE2   | OnlineBoutique |              93.3% |              88.9% |                  −4.4 |                  91.1% |                   −2.2 |              88.9% |               −4.4 |
| RE2   | SockShop       |              94.4% |              94.4% |                   0.0 |                  94.4% |                    0.0 |              94.4% |                0.0 |
| RE2   | TrainTicket    |              83.3% |              82.2% |                  −1.1 |                  82.2% |                   −1.1 |              82.2% |               −1.1 |
| RE3   | OnlineBoutique |              88.9% |              88.9% |                   0.0 |                  88.9% |                    0.0 |              88.9% |                0.0 |
| RE3   | SockShop       |              63.6% |              63.6% |                   0.0 |                  61.1% |                   −2.5 |          **53.6%** |          **−10.0** |
| RE3   | TrainTicket    |              71.0% |              74.5% |                  +3.5 |              **78.1%** |               **+7.1** |              78.1% |               +7.1 |
| —     | suite means    | 87.2 / 88.9 / 71.1 | 87.2 / 88.5 / 72.2 | 0.0 / −0.4 / **+1.1** | **87.7 / 89.3 / 72.2** | **+0.5 / +0.4 / +1.1** | 86.9 / 88.5 / 68.9 | −0.3 / −0.4 / −2.2 |

FSE'26, 1422 cases: **60.5% → 60.5%** Top@1, 79.0 → 79.0 Top@3, 82.2 → 82.2 Top@5, inert to the tenth —
its fleets are 3–13 services, so step 1b never runs and there is no space to get wrong.

**What the space was worth, against the same weight in the old space (iteration 157, run `40896889186`):**

| cell               |              ρ = 0 | ρ = 0.5, rank space (157) | ρ = 0.5, deviation space (this) |         recovered |
| ------------------ | -----------------: | ------------------------: | ------------------------------: | ----------------: |
| RE1 TrainTicket    |              83.2% |                     77.6% |                           80.8% |       **+3.2 pp** |
| RE2 TrainTicket    |              83.3% |                     81.1% |                           82.2% |       **+1.1 pp** |
| RE3 TrainTicket    |              71.0% |                     71.0% |                       **74.5%** |       **+3.5 pp** |
| RE1 OnlineBoutique |              85.6% |                     87.2% |                           87.2% |               0.0 |
| RE3 SockShop       |              63.6% |                     63.6% |                           63.6% |               0.0 |
| suite means        | 87.2 / 88.9 / 71.1 |        86.1 / 88.5 / 71.1 |          **87.2 / 88.5 / 72.2** | +1.1 / 0.0 / +1.1 |

Three readings.

1. **The cell the axis was refused on is now the cell it wins on.** RE3:TrainTicket reads **+7.1 pp** at
   ρ = 1, the largest single-cell gain this project has recorded, and it is the same cell that lost
   5.6 pp in the previous iteration with the same operator and a different input space.
2. **At ρ = 1 no suite is down** — 87.7 / 89.3 / 72.2 against 87.2 / 88.9 / 71.1 — which is the first
   configuration in this project's record where all three suite means improve together. Four CELLS are
   still down (RE1:TrainTicket −1.6, RE2:OnlineBoutique −2.2, RE2:TrainTicket −1.1, RE3:SockShop −2.5),
   which is why the default has not moved: the project's bar for adoption has been "no cell down", and
   this arm does not meet it yet.
3. **The scope finding replicates exactly.** `all` still costs RE3:SockShop **10.0 pp** (63.6 → 53.6) and
   buys nothing at this ρ, which is the same 10 pp that a 30-case local slice predicted in the previous
   iteration. The two questions — which channels, and which space — are independent, and both are now
   measured on the same commit.

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
  the threshold), so it can only confirm the cap is inert and no cell moved.
- **`'minmax'` as a space.** The `rankNormalization = false` arm is measured only for reconstruction, not
  against the corpus: every dispatch runs the shipped `rankNormalization = true`.
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
