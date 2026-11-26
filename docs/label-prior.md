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

## 5. Why the weight ships at 0.1, the gate at 0, and the jurisdiction at `tail`

It shipped at `0` — the ablation — for four iterations, and the reason was never that `0` was good: it was the only
honest value while the arm was unmeasured on the second half of the criterion. Iteration 369 read that half and the
three constants moved together:

| constant | value | why that value |
| --- | ---: | --- |
| `DEFAULT_LABEL_PRIOR_WEIGHT` | **0.1** | the arm both halves were measured at: panel `Top@1` 1 186 (1/1, p = 1.000), `Top@3` +24, `Top@5` +27 (p < 0.001); golden `AC@1` 666 of 666 and nine-cell `Avg@5` 92.47 → **94.48 %** |
| `DEFAULT_LABEL_PRIOR_MARGIN_GATE` | **0** | under the pin the gate protects nothing and costs depth: `τ = 0.02` reads `+16 / +19` instead of `+24 / +27`, withholding 89 cases |
| `DEFAULT_LABEL_PRIOR_JURISDICTION` | **`tail`** | the only arm whose head cost is zero *by construction*; `everywhere` is the arm that moved `Top@1` by −2 and lost more than it gained (20/22, p = 0.878) |

The three are one configuration, and the coupling is the point rather than an implementation detail: **`0` with
`everywhere` is the refused ungated arm, `0.02` with `tail` is the shallower arm, and only `0` with `tail` is the arm
that was read.** A test asserts the triple exactly, so a partial edit cannot ship a configuration nobody measured.

The ablation is still reachable and still the control every dispatch can name: `--label-prior-weight 0` restores the
bit-identical shipped ranking, because at weight 0 the profile is neither read nor logged.

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

**Not yet cleared — and iteration 368 cleared half 2 the hard way: by refusing it.** The term ships at weight 0, so no
default moved and no ranking changed. Enrolling it needs both halves of the kill criterion this project applies to every
term:

1. **the nine RCAEval cells** — a dispatch with `labelprior=0.1 labelpriorgate=0.02` must hold every cell;
2. **the FSE'26 panel** — **now measurable, and measured: refused.** The runner derives the history from the corpus it
   scores (`fse26-label-history.ts`), so both fields are dispatchable on that half and the census rows carry
   `ranking_knobs`. Four arms on the 1,422 cases, one commit, one profile, one flag apart — the head of the ranking is
   separated by a **median 0.6277**, sixty times this document's `trainticket` cell, and the term therefore loses
   `Top@1` at every price while gaining at depth:

| arm | `Top@1` | `Top@3` | `Top@5` | gained / lost | exact p |
| --- | ---: | ---: | ---: | ---: | ---: |
| shipped (β = 0) | **1 186 (83.40 %)** | 1 236 | 1 255 | — | — |
| β = 0.1, τ = 0 | 1 184 (83.26 %) | **1 260** | **1 279** | 20 / 22 | 0.878 |
| β = 0.1, τ = 0.02 | 1 176 (82.70 %) | 1 253 | 1 273 | 8 / 18 | 0.076 |
| β = 0.05, τ = 0.02 | 1 182 (83.12 %) | 1 242 | 1 267 | 3 / 7 | 0.344 |

All four were dispatched on the configuration the FSE'26 workflow dispatches — `--fault-free-profile` plus
`--failure-containment-scope global-measured` — which reads **1 186** where the engine's default scope reads the
standing table's **1 156**, so the deltas below are against the control that shares every flag and differs by exactly
the two numbers under test.

**And the reason is not the gate.** `label-prior-reach.ts` measures the gate's own input off the run's term dump: the
median base `top1 − top2` on this corpus is **0.6277**, so τ = 0.02 admits **93.7 %** of cases (withholds 89 of 1 422).
The threshold that is a gate on Cloud-OpsBench is a no-op here. Worse, it is *not merely inert but uninformative*: the
42 cases the prior flips have base margins with the same distribution on both sides — gained, median **0.0142** (p90
0.0960); lost, median **0.0531** (p90 0.1432) — so no threshold separates the flips it wins from the flips it loses, and
raising τ from 0.02 to 0.2 shrinks the flip set to three cases rather than improving it. **The margin is a measure of how
DECIDED the head is, not of how CORRECT it is**, and this term's errors are about *which* label, not *whether* one is
confident. The full reading is `docs/label-prior-fse26.md`.

Open work, in the order the register records it: (a) **done** — the eight-point sweep below closes the bracket, and it
also retired this note's first guess (the table above: the optimum is a plateau, not a point); (b) `codedefect`'s tail —
the term REPAIRS it rather than thinning it (`Top@5` 0.8068 shipped, 0.8523 at `β = 0.05`, **0.9205** at `β = 0.1 /
τ = 0.02`, **0.9432** at `β = 0.1 / τ = 0.015`), so the remaining gap to the prior-alone reading of 1.0000 is 5.68 pp of
cases where the history knows the answer and the engine's other nineteen terms outvote it — a head-versus-tail
diagnostic, not a price question; (c) **done** — the FSE'26 history is derived on that path, both fields dispatch
through `ranking_knobs`, and half 2 of the criterion is measurable; (d) **done, and it is the arm that survives** — the
HEAD-PINNED order (`labelPriorJurisdiction = 'tail'`: the head of the order the engine would report WITHOUT the prior
is clamped at position 1 and the prior reorders 2..n). Measured on the panel at `β = 0.1 / τ = 0`: `Top@1`
**1 186 (83.40 %) = arm A to the case** — 1 gained, 1 lost, `p = 1.000` — with `Top@3` **+24** (28/4, `p < 0.001`) and
`Top@5` **+27** (30/3, `p < 0.001`), i.e. the whole depth gain the summed arm paid for at the head, and three cases
more at the fifth position. So the prediction written above held, with one qualifier that was not in it: the
containment pass runs AFTER the pin and can still move position 1, which is where the 1/1 residue comes from. The
gate turns out to be a SUBSTITUTE for the pin rather than a complement — at `τ = 0.02` the pinned arm reads `+16 / +19`
instead of `+24 / +27` at the same head — and the restated criterion (four conjuncts, the fourth being the golden
half) is in `docs/label-prior-fse26.md` §4.2. **The golden half has since been read and the default moved**: run
`45859433294` reads `AC@1` 666 of 666 cell for cell and a nine-cell `Avg@5` mean of 92.47 → 94.48 %, so the triple
enrols at `β = 0.1, τ = 0, tail` (§5, and §4.5 of the FSE'26 document for the table).

## 7. Two admission mechanisms, and the condition that chooses between them

The engine now has two ways to restrain a term, and until this section nothing said which applies when. Both are
written here as claims with their falsification conditions, because a mechanism chosen by taste is a mechanism that
cannot be wrong.

**Setting.** A term `t` adds `δ_t(v)` to every candidate `v`'s total. Let `A` be the shipped order and `a₁` its head.
Two mechanisms:

* a **gate** with threshold `τ` on a decision statistic `s(x)` — here the base margin `A₁ − A₂` — which withholds `t`
  when `s(x) < τ`;
* a **jurisdiction** `J ⊆ {1..n}` — here `tail = {2..n}` — which lets `t` reorder only the positions in `J`.

**Claim 1 — a gate is sound only if the term's errors are correlated with `s`.** Write `ε` for "the term's preferred
head is not the truth". Gating helps iff `P(ε | s < τ) > P(ε | s ≥ τ)`; it is worthless iff the two are equal; it is
*negative* if the inequality reverses, because then it withholds the term exactly where the term was right. Nothing
about the value of `τ` can repair an equality — the search over `τ` is a search inside a null.

**Falsified on FSE'26, and this is the measurement that motivates the jurisdiction.** The median base margin there is
**0.6277** against Cloud-OpsBench's **0.0102** — the same statistic, 61× apart — so `τ = 0.02` withholds 89 of 1 422
cases: a no-op. And the flips the term actually makes have the same margin distribution on both sides: gained median
**0.0142** (p90 0.0960), lost median **0.0531** (p90 0.1432). `P(ε | s < τ) = P(ε | s ≥ τ)` up to noise, which is the
middle case of the three. **A margin measures how decided the head is, not how correct it is.**

**Claim 2 — the head-pinned jurisdiction holds by construction, at any weight.** The order is computed from the base
scores, the term reorders the tail, and the head is then pinned to the base order's head. So `ΔTop@1 = 0` identically,
for every `β` and every corpus, and that is a property of the construction rather than a measurement — which is why the
arm was written down before it was run. **Falsifier:** any case where position 1 differs from the base order's head.
There is exactly one, and it is not this term's: the containment pass runs *after* the pin, moves position 1 in 43 of
1 422 cases, and produces the arm's 1/1 residue.

**Claim 3 — a prior over labels cannot be gated at all, only scoped.** A frequency prior's error is **label
substitution**: it prefers whichever label the deployment has seen most, and that preference is independent of how
decided the case is. So no statistic of the *case* separates its successes from its failures — which is Claim 1's
equality, arriving from the structure of the term rather than from the corpus. Its damage is bounded instead by where
it is allowed to act, and the bound is worth having because the metrics are monotone in rank: a substitution at
position 1 costs a `Top@1` case, the same substitution at position 2 costs nothing at `Top@1` and is *earned back* at
`Top@5` when it is right. Measured: `+0` at the head, `+24` / `+27` at depth.

**Claim 4 — the two mechanisms do not compose, and the gate is a substitute.** A gate on the pinned arm can only
withhold the term inside the tail, where its worst outcome is a lost depth case and its best is a gained one. Measured
at `τ = 0.02` under the pin: `+16 / +19` instead of `+24 / +27`, head unchanged — 89 cases withheld, 8–11 cases of
depth paid, nothing bought. **Falsifier:** a cell where the gated-pinned arm beats the ungated-pinned arm at depth.
None in six arms across three depths.

**The rule, and the reason it is a rule rather than a preference.** Ask **what the term's information is about**. If it
is about the *case* — a measurement of this incident — its errors track some decision statistic and a gate is the right
instrument. If it is about the *deployment* — a prior over which labels occur — its errors are substitutions that no
statistic of the case can predict, and only the positions it may touch can bound them. The gate is the older
instrument and stays the default for measurement terms; the jurisdiction is the one this document adds, and it is the
only one of the two whose head cost is **provably** zero.
