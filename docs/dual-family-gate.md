# The membership's POPULATION — a fleet-relative gate, and the census that measures it

**Status:** a MECHANISM plus the instrument that measures its premise, both landed. The gate ships at **0**,
which is the identity of the membership iteration 144 enrolled: `min(Sⁱ,Sᵉ) > 0` holds exactly when both
channels moved, so a push that passes no flag ranks the nine cells byte-identically. Whether a positive gate is
worth its cost is decided by the golden sweep in §6, not by this document's argument.

**Owner of:** `dualFamilyGate`, and of the `[dual-family]` census line every RCAEval cell now prints.

---

## 1. The premise that was wrong, and the fence that now holds it

`docs/re3-quiet-truth.md` §7 ended with a named next measurement:

> PRISM's `Sⁱ`/`Sᵉ` are z-scores of a mean shift, this engine's are `log₁₀(1 + ratio)` over a max — and the
> difference between those two statistics on the same channels is what separates 18 gains from 0.

**That sentence was false about the code.** `computeChannelExtremes` calls `deviationZScore`, which is PRISM's
own `S(P) = |mean_fault − mean_baseline| / scale` — the paper's statistic, not the anomaly composition's. The
two never differed, so no experiment could have separated "18 gains" from "0" on that axis. The claim was the
five-hundredth-odd instance of this project's oldest defect family: prose asserting a property of code that the
code does not have.

It is now a VALUE fence rather than a correction in prose. `prism-signal.test.ts` asserts that a component whose
baseline is a constant 100 and whose fault window is a constant 200 reads **exactly 1** on both channels —
where `log₁₀(1 + ratio)` would read 0.3010. A future change of statistic fails that test.

## 2. What the difference actually is: density, not statistic

If the statistic is shared, the reason one cell moved (RE3-SockShop 15 → 18) and two did not (RE3-TrainTicket
unchanged on 68 candidates, FSE'26 Top@1 byte-identical at 0.10/0.25/0.50) has to be a property of the
POPULATION. A membership pays a CONSTANT, so it can only re-order a cell in which the family is a strict subset
of the fleet; where nearly every candidate is a member, the bonus is near-uniform and moves nobody.

No artifact printed that density, so the mechanism could be asserted and not measured. It is now printed, once
per cell, from the ranking the correctness checks are already counted from:

```
  [dual-family] family=7.6/9.2 (81.7%) truth=122/124 (98.4%) absent=1
```

That is OnlineBoutique RE1 (125 cases, the one cell this sandbox can run locally). **81.7% of the fleet is in
the family and the truth is in it 98.4% of the time** — the bonus is a near-constant on that cell, which is
exactly why `dualFamilyWeight` left it at 105 of 125 at every weight from 0 to 0.50. The census reads the term
`dualFamily` out of each candidate's breakdown, so it cannot disagree with the score about who was paid; a
second walk over the metrics would be a second implementation of the membership.

The line distinguishes four facts that render as the same absence: a **member** (the term was paid), a
**non-member** (`VALUE_ZERO`), an **unmeasured** case (`WEIGHT_ZERO` — the family was never built, which is the
ablation's shape and must not be read as "nothing passed the test"), and **absent** (the truth is not a
candidate at all — a retrieval failure, counted apart since iteration 143 established that six of a hundred
sampled misses are of that kind and that no reweighting addresses them).

## 3. The gate

```
  m(v)    = hasInternal(v) ? min(Sⁱ(v), Sᵉ(v)) : 0
  m*      = max over the fleet of m(v)
  dual(v) = m(v) > 0 && m(v) ≥ dualFamilyGate · m*
```

Three properties, each of which is a test:

1. **Identity at 0.** `min > 0` holds exactly when both channels moved, so gate 0 is the membership of
   iteration 144 to the case.
2. **It can only narrow, never widen.** A zero can never clear a positive share of a positive maximum, so no
   gate admits an external-only victim: the conjunction is still PRISM's.
3. **It is fleet-relative, not an absolute floor.** The threshold is a share of the fleet's own strongest dual
   signal, the construction `anomalyBreadthGate` already uses — the same statement about a 14-service graph and
   a 69-service one, and no constant invented per corpus.

The form is the mechanism rather than a tuning knob: a constant bonus paid to every member leaves a pair's gap
untouched (both sides move by the same weight), while a gated bonus moves one side only and widens the gap by
exactly the weight. That identity is asserted in `pruner.test.ts`.

## 4. The local pre-screen, and what it says about the price

OnlineBoutique RE1, 125 cases, shipped configuration, one run per arm — the one cell the sandbox has data for:

| gate | family / fleet | truth in family | OB RE1 | Δ |
| ---: | ---: | ---: | ---: | ---: |
| **0** | 7.6 / 9.2 (81.7%) | 122/124 (98.4%) | **105** | — |
| 0.25 | 2.4 / 9.2 (25.9%) | 100/124 (80.6%) | 103 | −2 |
| 0.50 | 1.5 / 9.2 (16.3%) | 83/124 (66.9%) | 98 | −7 |
| 0.75 | 1.1 / 9.2 (12.2%) | 70/124 (56.5%) | 96 | −9 |

The gate does what it was built to do — the family falls from 82% to 26% of the fleet at 0.25 — and on THIS
cell that is a small loss. The reading is not a verdict on the cell the lever is aimed at: OB RE1 is a cell
where the term was already inert, so all it can do there is cost. The decision needs RE3-TrainTicket, where the
term has never moved anything, and that is the sweep in §6.

## 5. Where it plugs in

`dualFamilyGate` travels the same road every other ranking axis does — one constant (`DEFAULT_DUAL_FAMILY_GATE`,
read from the engine by both runners), one pruner option, one flag on each CLI (`--dual-family-gate`, parsed with
the unit-interval parser because a share above 1 is not a gate), one field on each engine-option record, one
field on each artifact's configuration line (printed unconditionally, since the shipped value is 0 and an
omitted-when-default rule would render a gated arm and the shipped run identically), one packed dispatch key on
each half (`dualfamgate=` on the golden side, `dual_family_gate` on the FSE'26 side), one row in the dispatch
census, and one line in the optimizer's inventory of fields it holds at the engine's default.

## 6. The golden sweep

Four arms, one commit (`bca8a37`), one input each, everything else shipped. Case-level counts, from each
run's own loss census (which prints `cases / correct` per system and is the same number the published cells
are built from):

| gate | weight | RE1 OB / SS / TT | **RE1** | RE2 OB / SS / TT | **RE2** | RE3 OB / SS / TT | **RE3** | **735** | run |
| ---: | ---: | --- | ---: | --- | ---: | --- | ---: | ---: | --- |
| **0** (shipped) | 0.25 | 105 / 117 / 101 | **323** | 77 / 85 / 69 | **231** | 22 / 18 / 15 | **55** | **609** | `40520127345` |
| 0.25 | 0.25 | 103 / 117 / 98 | 318 | 80 / 86 / 71 | **237** | 23 / 20 / 15 | **58** | **613** | `40520163213` |
| 0.25 | 0.10 | 103 / 117 / 98 | 318 | 78 / 86 / 70 | 234 | 22 / 18 / 15 | 55 | 607 | `40530891885` |
| 0.50 | 0.25 | 98 / 115 / 92 | 305 | 79 / 85 / 74 | 238 | 24 / 17 / **17** | 58 | 601 | `40520169613` |

**The fourth arm was run to separate the two knobs, and it did**: at the same population (gate 0.25) the RE1 cost
is **−5 at both weights** while RE2 goes +3 (weight 0.10) versus +6 (0.25), RE3 0 versus +3, and FSE'26 Top@1
+1.7 versus **+3.1**. The price is set by the POPULATION and the benefit by the WEIGHT — which is the opposite of
what the weight-only axis of iteration 144 did (it moved RE3 by 3 and RE1 not at all). A lever that improves its
own exchange rate as it gets stronger is the shape worth keeping.**

On the FSE'26 half — 1,422 cases, and the population whose inertness iteration 144 recorded — the same gate reads
**Top@1 59.5% / Top@3 77.7% / Top@5 81.3%** against the shipped **56.4 / 69.7 / 72.1** (run `40527629997`): the
term that was byte-identical at every *weight* moves **+3.1 / +8.0 / +9.2 pp** when its *population* is made
selective. That is the largest single movement this project has recorded on that benchmark since its anchor was
set — and it is the corpus where the membership had nothing to say before.

**The gate works, and it is refused.** Every arm moves a population up — 0.25 takes RE2 **+6** and RE3 **+3**,
0.50 takes RE2 **+7** and **RE3-TrainTicket from 15 to 17 of 30, the first movement that cell has ever shown in
this campaign** — and every arm takes RE1 down (5 and 18). The standing rule is that no cell may move down, and
RE1 is the cell this engine leads by 0.73 pp over the best published number; 318 of 375 is 84.8%, which is below
`L0`'s 85.4%, i.e. the enrolment would trade a first place for a third place. Ships at **0**, which is the
identity, so the nine cells are the ones iteration 144 published.

The sweep is worth more than the enrolment would have been, because it prices the exchange rate that three
refusals this month could only describe. A term that re-orders RE2 and RE3 at 1.7 : 1 against RE1 is not a bug
to fix — it is the same quantity the register's `dropDeviationMode` and `victimWeight` rows measured, now with a
second axis (the population) that moves the ratio in the *favourable* direction: the weight axis of iteration 144
bought +3 RE3 for **0** RE1, and the population axis buys +9 (RE2+RE3) for −5. A lever that keeps the population
axis and shrinks its price is the next question, and the sweep says it must come from the FORM (which members
are paid) rather than from either magnitude.

## 7. What the census measured about the mechanism, at the shipped gate

The census reads the family's density per cell, which is what no artifact could say before:

| cell | gate 0 | gate 0.25 | gate 0.50 | truth in family (gate 0) |
| --- | ---: | ---: | ---: | ---: |
| RE1 OB / SS / TT | 81.7% / 56.8% / 39.3% | 25.9% / 15.1% / 6.1% | 16.3% / 10.1% / 2.8% | 98.4% / 100% / 100% |
| RE2 OB / SS / TT | 95.9% / 51.8% / 39.8% | 20.0% / 15.1% / 7.3% | 13.6% / 11.0% / 3.3% | 100% / 100% / 100% |
| RE3 OB / SS / TT | 81.9% / 56.5% / 38.6% | 28.2% / 30.3% / 19.8% | 18.1% / 19.3% / 7.9% | 100% / 100% / 100% |

**At the shipped gate the truth is in the family in 727 of the 729 cases whose truth is a candidate at all** —
100% on eight of the nine cells and 122 of 124 on OnlineBoutique RE1, with the six `ABSENT` cases counted where
they belong and not here — and the family still covers between 38.6% and 95.9% of the candidates. That is the whole mechanism in one
line: the membership never fails to *include* the answer — it fails to *exclude* anything else, and a constant
bonus paid to four candidates in ten, or nine in ten, cannot re-order a cell. The gate is what converts the
membership from a description of the fleet into a statement about it, and the price table in §6 is what that
conversion costs.

## 8. The denominator: per-family normalisation — ENROLLED, no population down

§6 priced the `min` gate and refused it: it buys RE2 and RE3 by paying RE1. The reason it *had* to pay is
structural, and it is the reason two earlier refusals named a per-family normalisation as the precondition for
trying PRISM's axiom again (`docs/prism-symmetry-mask.md`, `docs/self-time-share.md`):

```
  max min(Sⁱ,Sᵉ)  ≤  min( max Sⁱ , max Sᵉ )
```

with equality only when ONE component is the champion of both families. On a real fleet the extremes live in
different services — one with a huge `cpu` shift, another with a huge `latency` shift — so `max min` collapses
toward the balanced middle and the `min` bar goes LOOSE exactly where the fleet is heterogeneous. `channel` gives
each family its own champion:

```
  dual(v) = hasInternal(v) ∧ Sⁱ(v) ≥ gate · max_w Sⁱ(w) ∧ Sᵉ(v) ≥ gate · max_w Sᵉ(w)
```

Three arms, one commit (`d83fb86`), one input each, everything else shipped. Case-level counts from each run's own
loss census:

| arm | RE1 OB / SS / TT | **RE1** | RE2 OB / SS / TT | **RE2** | RE3 OB / SS / TT | **RE3** | **735** | FSE'26 Top@1 |
| --- | --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| `min`, gate 0 (145's shipped) | 105 / 117 / 101 | 323 | 77 / 85 / 69 | 231 | 22 / 18 / 15 | 55 | 609 | 56.4% |
| `min`, gate 0.25 (`40520163213`) | 103 / 117 / 98 | 318 | 80 / 86 / 71 | 237 | 23 / 20 / 15 | 58 | 613 | 59.5% |
| **`channel`, gate 0.25** (`40605425605`) | **107** / 116 / **104** | **327** | **80 / 85 / 75** | **240** | **24** / 18 / **19** | **61** | **628** | **60.5%** |
| `channel`, gate 0.50 (`40605428520`) | 108 / 115 / 102 | 325 | — | — | 23 / 17 / 17 | 57 | — | — |

**ENROLLED.** `DEFAULT_DUAL_FAMILY_GATE = 0.25`, `DEFAULT_DUAL_FAMILY_GATE_MODE = 'channel'`: RE1 **327**
(+4, 87.2%), RE2 **240** (+9, 88.9%), RE3 **61** (+6, 67.8%), 735 **628** (+19, 85.4%), FSE'26 Top@1 **60.5%**
(+4.1 pp). **No population moves down**, which no other arm this month has managed; inside the populations the
movement is `+2 / −1 / +3` on RE1, `+3 / 0 / +6` on RE2 and `+2 / 0 / +4` on RE3 — one cell loses a single case
(Sock Shop RE1) while eight gain or hold.

**The blocking cell moved by four.** RE3-TrainTicket reads **19 of 30 = 63.3%**, against PRISM's published 76.7%:
the deficit is **13.4 pp** where it was 26.7 pp, and it is the first movement that cell has shown in twelve arms
(`docs/re3-quiet-truth.md` §9).

The censuses are why, and they invert the premise the term was built on:

| cell (gate 0.25, `channel`) | family / fleet | truth in family |
| --- | ---: | ---: |
| RE1 OB / SS / TT | 8.7% / 6.7% / 1.5% | 63.7% / 82.4% / 65.6% |
| RE3 OB / SS / TT | 11.4% / 9.3% / 4.7% | 88.9% / 46.7% / 73.3% |

The membership keeps the truth **less** often than the `min` gate did (63.7% against 80.6% on RE1-OB) and the
cells go **up**. A shape term earns its weight by excluding the competitors it was never about, not by certifying
the answer — the opposite of every "reward evidence" reading this campaign has tried, and only visible because the
census prints both numbers.

**Why 0.25 and not 0.50.** At 0.50 the family covers 5.6% of OnlineBoutique's RE1 fleet and keeps only **49.2%**
of its truths (against 8.7% and 63.7% at 0.25), and the arms agree: RE3 falls 61 → 57 and RE1 327 → 325. The
stronger gate has started to exclude the answer. 0.25 is the smaller of the two values measured on the winning
side, taken on the rule the breadth gate established: the smallest value that reaches the measured value leaves
the most room before the next mechanism starts to matter.
