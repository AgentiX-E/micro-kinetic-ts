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

*Filled by the runs named below; the tables are the measurement, not a claim.*

| gate | RE1 | RE2 | RE3 | 735 | FSE'26 Top@1 | run |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
