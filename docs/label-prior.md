# The label prior — the one term that is true before the case is read

Iteration 367 enrolled a twentieth term in `finalScore`, and it is unlike the other nineteen in three ways that each
cost something to establish. This document is the owner of its two dispatch fields (`--label-prior-weight`,
`--label-prior-gate`) and of the numbers below.

```
finalScore(v) += w · log p(v),      p(v) = (count(v) + 1/V) / (labelled + 1)
```

## 1. The term, and why the floor is `1/V`

`count(v)` is how often `v` was the **labelled** root cause of the deployment's past incidents, `labelled` is how many
those incidents are, and `V` is the number of candidates **this** case carries. Its input is therefore not the case's
telemetry at all: it is a statement about the deployment applied to the case, and it is available before the first
metric is read.

The pseudo-count is `1/V` rather than a constant because `p` is a distribution over the case's own candidates. A
service that has never been the answer must cost the same whether the case has fifteen candidates or fifty; a constant
floor would make the term's strength a function of the system's size, which is a property of the deployment and not of
the evidence.

**Leave-one-out, not hindsight.** `count(v)` excludes the case being scored. The construction lives in
`benchmarks/src/label-prior-profiles.ts` (corpus side) and reads a profile attached to each case; the engine never sees
the corpus. A prior that included its own case would be the answer dressed as history, and the arm would score well
while being undeployable — the one failure mode this whole document exists to make impossible.

## 2. The term was refused twice, and both refusals had the same shape

Ungated (`--label-prior-gate 0`), on the 156-case Hard bucket of Cloud-OpsBench:

| cell                          |   cases | shipped (w = 0) | ungated (w = 0.1, τ = 0) | gated (w = 0.1, τ = 0.02) | gated (w = 0.05, τ = 0.02) |
| ----------------------------- | ------: | --------------: | -----------------------: | ------------------------: | -------------------------: |
| `boutique` / `codedefect`     |      88 |          0.3636 |               **0.5682** |                    0.4886 |                     0.4432 |
| `boutique` / `performance`    |      21 |          0.8095 |                   0.7143 |                    0.7619 |                 **0.8095** |
| `trainticket` / `performance` |      47 |          0.6596 |               **0.2340** |                **0.6596** |                 **0.6596** |
| **all**                       | **156** |      **0.5128** |                   0.4872 |                **0.5769** |                     0.5577 |

| arm                               |     `CA@1` |    `Top@3` |    `Top@5` | gained / lost |    exact p | half A / half B |
| --------------------------------- | ---------: | ---------: | ---------: | ------------: | ---------: | --------------- |
| shipped (w = 0)                   |     0.5128 |     0.7051 |     0.8269 |             — |          — | 0.4872 / 0.5385 |
| ungated (0.1, 0)                  |     0.4872 |     0.7500 | **0.8910** |       18 / 22 |     0.6358 | 0.4487 / 0.5256 |
| **gated, zero-loss (0.05, 0.02)** |     0.5577 |     0.7628 |     0.8462 |     **7 / 0** | **0.0156** | 0.5128 / 0.6026 |
| **gated, max `CA@1` (0.1, 0.02)** | **0.5769** | **0.7949** |     0.8846 |    **11 / 1** | **0.0063** | 0.5256 / 0.6282 |

The ungated arm gains 18 cases and loses 22, and the losses are not spread: they are almost all `trainticket`, which
falls 42.6 pp. So the price axis has its own zero-loss point, exactly as the gate axis did in the iteration before
this one: **`β = 0.05` never loses a case and never lowers a cell** (0.4432 / 0.8095 / 0.6596 against 0.3636 / 0.8095 /
0.6596 — one cell up 7.96 pp, two bit-identical), while `β = 0.1` buys another 1.92 pp of `CA@1` and pays one case for
it. Both are recorded; neither ships.

**Two honest costs, and what removes them.** At `β = 0.1` the gate still charges `boutique/performance` 4.76 pp
(0.8095 → 0.7619), and `Top@5` there is _lower_ than the ungated arm (0.8846 vs 0.8910). Neither is explained away, and
neither is a property of the gate: both disappear at `β = 0.05`, where the same cell holds its shipped 0.8095 exactly.
So what a reader should take from the two rows is that the prior's price and the prior's gate are separate quantities
with separate optima — τ decides _whether_ the term speaks, β decides _how loudly_, and the cell that a louder term
damages is repaired by turning the term down rather than by raising its bar.

## 3. The gate reads the engine's own margin, and that is the whole finding

The two cells that moved in opposite directions differ in nothing a deployment can observe **except one number**: how
far apart the engine's own first and second candidates are. Measured over the 156 cases (`top1 − top2`, before the
prior is added):

| cell                          | median margin | share below 0.05 |
| ----------------------------- | ------------: | ---------------: |
| `boutique` / `performance`    |        0.5294 |            4.8 % |
| `boutique` / `codedefect`     |        0.1376 |           29.5 % |
| `trainticket` / `performance` |    **0.0102** |       **74.5 %** |

A ranking whose head is separated by a hundredth has no room for an external term; one separated by half a unit has
plenty. So τ = 0.02 does exactly one thing on `trainticket`: **it says nothing — zero of its 47 cases move, and the cell
reads 0.6596, bit-identical to the shipped run.** That is why the traversal is not a hyperparameter search: 0.02 is not
the middle of a plateau, it is above a margin distribution that sits almost entirely below it.

The gate is read from the **base** totals (every term except this one), because a gate computed from the gated score
would be the term's own output deciding whether the term runs. It is also the reason the deployment can use it: a cell
label is a thing the deployment does not know, and `top1 − top2` is a thing it always knows.

## 4. What is deliberately NOT the gate

`β = 0.1, τ = 0.02` scoped per **cell** reads **0.5833** with zero losses (p = 0.0010) — the ceiling, and undeployable:
the category IS the label being predicted, so a per-cell prior is a per-answer prior. Registered as the ceiling the
deployable arm is measured against, never as an arm.

A per-**system** scope is deployable (a deployment knows which fleet it is) and reads 0.5769, which is the shipped
reading.

## 5. Why the weight ships at 0 and the gate at 0.02

`DEFAULT_LABEL_PRIOR_WEIGHT = 0` is the ablation. The term is in the formula and spends nothing, so the shipped ranking
is bit-identical to an engine that had no such term — verified on the 156 cases: 0.5128 with every cell reproduced to
four decimals.

`DEFAULT_LABEL_PRIOR_MARGIN_GATE = 0.02` ships at a **non-zero** value while its weight is zero, and that asymmetry is
deliberate. Weight and gate are one configuration; a default of 0 for the gate would make the obvious arm
(`--label-prior-weight 0.1`, gate omitted) the **ungated** reading that was refused above. A pair whose default gate is
"speak everywhere" is a trap, not a default.

## 6. Acceptance, and what is still open

Cleared: the Cloud-OpsBench Hard bucket — `β = 0.05, τ = 0.02` at **0.5577 with zero cases lost** (one cell up
7.96 pp, two bit-identical), `β = 0.1, τ = 0.02` at **0.5769 with 11 gained and 1 lost** (p = 0.0063, two disjoint
halves both up).

**The τ sweep, read honestly.** Only four points were measured, at `β = 0.1`: τ = 0 → 0.4872, τ = 0.02 → **0.5769**,
τ = 0.05 → 0.5641, τ = 0.1 → 0.5449. So the curve rises from the refused reading to 0.02 and falls monotonically
after it, and **the interval between 0 and 0.02 was not swept** — 0.02 is the best of the points taken, not a located
optimum. The open work is therefore _below_ the shipped threshold, not above it.

**Not yet cleared.** The term ships at weight 0, so no default moved and no ranking changed. Enrolling it at 0.1 needs
both halves of the kill criterion this project applies to every term:

1. **the nine RCAEval cells** — a dispatch with `labelprior=0.1 labelpriorgate=0.02` must hold every cell;
2. **the FSE'26 panel** — and this runner does not yet build a profile at all, which is why the census records
   `fse26: null` for both fields. That is the gap to close before the weight can move.

Open work, in the order the register records it: (a) sweep τ between 0 and 0.02 to locate the optimum the four points
only bracket; (b) `codedefect`'s tail — the term REPAIRS it rather than thinning it (`Top@5` 0.8068 shipped, 0.8523 at
`β = 0.05`, **0.9205** at `β = 0.1`), so the remaining gap to the prior-alone reading of 1.0000 is 7.95 pp of cases
where the history knows the answer and the engine's other nineteen terms outvote it — a head-versus-tail diagnostic,
not a price question; (c) build the profile on the FSE'26 path so half 2 of the criterion is measurable at all.
