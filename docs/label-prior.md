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
reads 0.6596, bit-identical to the shipped run.**

**And the sweep below corrects a sentence that used to stand here.** It said 0.02 was "not the middle of a plateau".
It is: τ = 0.015 and τ = 0.02 produce the same `CA@1` at both prices, so the curve is FLAT across that interval and
falls on either side of it. What makes 0.02 the shipped value is not that it is a maximum but that it is the only
threshold at which **no cell is below its shipped reading** — the same criterion the dual-family gate's 0.08 was chosen
on one iteration earlier. A maximum and a safe boundary are different claims, and only the second one is true.

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

**The τ sweep, read honestly — eight points, not four.** Two prices, four thresholds each, all on the engine:

| β | τ | `CA@1` | `Top@3` | `Top@5` | `codedefect` | `boutique/performance` | `trainticket` |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.05 | 0.005 | 0.4679 | 0.7692 | 0.8590 | — | — | — |
| 0.05 | 0.010 | 0.5192 | 0.7756 | 0.8590 | — | — | — |
| 0.05 | 0.015 | 0.5577 | 0.7756 | 0.8590 | 0.4545 | 0.7619 | 0.6596 |
| **0.05** | **0.020** | **0.5577** | 0.7628 | 0.8462 | 0.4432 | **0.8095** | **0.6596** |
| 0.10 | 0.005 | 0.4744 | 0.7500 | 0.8910 | — | — | — |
| 0.10 | 0.010 | 0.5321 | 0.7885 | 0.9038 | — | — | — |
| 0.10 | 0.015 | **0.5769** | **0.8077** | **0.8974** | **0.5000** | 0.7143 | **0.6596** |
| **0.10** | **0.020** | **0.5769** | 0.7949 | 0.8846 | 0.4886 | 0.7619 | **0.6596** |

**τ ∈ [0.015, 0.02] is a plateau and τ < 0.015 is a cliff.** `CA@1` is identical at the two top thresholds for both
prices (0.5577 and 0.5769) and falls by 4.0 and 4.5 pp at 0.010. `trainticket` reads 0.6596 at every τ ≥ 0.015 — the
term is silent there across the whole plateau, which is the gate working rather than the threshold being lucky.

**And 0.02 is the only point in the plateau where no cell is below its shipped reading.** At β = 0.05, τ = 0.015 lifts
`codedefect` 1.13 pp further but charges `boutique/performance` 4.76 pp; τ = 0.02 lifts `codedefect` 7.96 pp and leaves
the other two cells **bit-identical**. At β = 0.1 neither plateau point is cell-safe (`performance` falls 4.76 pp at
both), which is why the zero-loss arm is a *price* choice rather than a threshold one — the two axes are separate, and
the sweep is what separates them.

**So the reason to keep 0.02 is safety, not maximum.** A reader who wanted the highest `Top@3` on this one slice would
choose (0.1, 0.015); a reader who wanted to be unable to damage a cell would choose (0.05, 0.02). Both are recorded.
The default stays at 0.02 because the second criterion is the one this project applies to every enrolment, and because
`Top@3` is not a board we are measured on.

**Not yet cleared.** The term ships at weight 0, so no default moved and no ranking changed. Enrolling it at 0.1 needs
both halves of the kill criterion this project applies to every term:

1. **the nine RCAEval cells** — a dispatch with `labelprior=0.1 labelpriorgate=0.02` must hold every cell;
2. **the FSE'26 panel** — and this runner does not yet build a profile at all, which is why the census records
   `fse26: null` for both fields. That is the gap to close before the weight can move.

Open work, in the order the register records it: (a) **done in this iteration** — the eight-point sweep below closes
the bracket, and it also retired this note's first guess (the table above: the optimum is a plateau, not a point);
(b) `codedefect`'s tail — the term REPAIRS it rather than thinning it (`Top@5` 0.8068 shipped, 0.8523 at `β = 0.05`,
**0.9205** at `β = 0.1 / τ = 0.02`, **0.9432** at `β = 0.1 / τ = 0.015`), so the remaining gap to the prior-alone
reading of 1.0000 is 5.68 pp of cases where the history knows the answer and the engine's other nineteen terms outvote
it — a head-versus-tail diagnostic, not a price question; (c) build the profile on the FSE'26 path so half 2 of the
criterion is measurable at all.
