# What each shipped coefficient is worth — the left column, priced

**Iteration 256.** `docs/production-leave-one-out.md` ended with an accounting that had two columns and only
one of them measured:

| suite | from the shipped weights | from the four flags |
| --- | --: | --: |
| `RE1` | all of `92.0` | `+0.0` |
| `RE3` | `54.4` | `+25.6` |

The right column came from four single-flag arms. The left column was prose, because those weights are
**numbers** — `selfAnomalyWeight = 1`, `dualFamilyWeight = 0.25`, `latWeight = 0.561495` — and the battery's
production rows were four booleans. This document is the left column, measured.

## The instrument

Ten arms. Each takes the configuration that produced `666/735` and sets exactly **one** coefficient to `0`; the
arm is exact where the engine treats `0` as absence (`emissionWeight` is not even computed at `0`), and near-exact
elsewhere. The rows are built from a table keyed by the engine's own constant, not written out, because eight
literals are eight chances for a label to name a number the row does not carry.

The selection carries the shipped configuration as its **first row**, and that is load-bearing rather than tidy:
`run-ablation.ts` measures every Δ from `allRuns[0]`, so a selection that began at an arm would have reported ten
numbers against an arm. That defect was observed before it shipped — the verdict block printed
`varies=selfAnomalyWeight,<own field>` for every row, which is the arithmetic of a diff against the first row —
and `PRODUCTION_WEIGHT_CONFIGS` exists to prevent it. The control also buys the check this kind of table needs:
production is re-measured in the same job, on the same cases, beside the arms.

**The control reproduces the published cells on all three suites**, which is what makes the rest of the table
readable rather than merely neighbouring:

| suite | control arm | published cell | match |
| --- | --- | --- | --- |
| `RE1` | `90.4 / 95.2 / 90.4` → `345/375` | `90.4 / 95.2 / 90.4` | exact |
| `RE2` | `93.3 / 98.9 / 84.4` → `249/270` | `93.3 / 98.9 / 84.4` | exact |
| `RE3` | `86.7 / 80.0 / 73.3` → `72/90` | `86.7 / 80.0 / 73.3` | exact |

Battery `42660148243` at `653d916d`, three jobs, one suite each, eleven rows each. Cases, not percentages, are
the unit below: a percentage of a 30-case cell moves in thirds, and a reader cannot add thirds.

## The table

Cases correct out of each cell's population; `Δ` is against the control in the same column.

| arm | `RE1` | `RE2` | `RE3` | cases | Δ | reading |
| --- | --: | --: | --: | --: | --: | --- |
| **`PRODUCTION (log + trace + rank)`** | **345**/375 | **249**/270 | **72**/90 | **666** | — | the published nine cells |
| `LESS SELF-ANOMALY (selfAnomalyWeight=0)` | 251 | 218 | 64 | 533 | **−133** | the base term is the ranking |
| `LESS DUAL-FAMILY (dualFamilyWeight=0)` | 342 | 239 | 61 | 642 | **−24** | the second-largest earner |
| `LESS EMISSION (emissionWeight=0)` | 344 | 249 | 67 | 660 | **−6** | one `RE3` cell, one `RE1` case |
| `LESS BREADTH (anomalyBreadthWeight=0)` | 345 | 247 | 72 | 664 | **−2** | `RE2:SockShop` only |
| `LESS TREND (anomalyTrendWeight=0)` | 344 | 248 | 73 | 665 | **−1** | pays on one cell, costs on two |
| `LESS CV (anomalyCvWeight=0)` | 345 | 250 | 73 | **668** | **+2** | the only arm that GAINS |
| `LESS LAT (latWeight=0)` | 345 | 249 | 72 | 666 | `0` | starved and inert, see below |
| `LESS POOL PENALTY (poolMetricPenaltyWeight=0)` | 345 | 249 | 72 | 666 | `0` | inert on every case |
| `LESS STABILITY (stabilityWeight=0)` | 345 | 249 | 72 | 666 | `0` | inert on every case |
| `LESS FAILED EDGE (failedEdgeWeight=0)` | 345 | 249 | 72 | 666 | `0` | gate refuses, see below |

Five of the ten coefficients move nothing at all, and the table would be misread if that were reported as "five
terms are worthless". The battery's own verdict block separates the two reasons, and the separation is the
finding:

| arm | `RE1` | `RE2` | `RE3` |
| --- | --- | --- | --- |
| `LESS LAT` | `STARVED` ×3 | OB/TT moved, SS `STARVED` | OB/TT `INERT`, SS `STARVED` |
| `LESS EMISSION` | `INERT` ×2, TT moved | `INERT` ×3 | SS moved, OB/TT `INERT` |
| `LESS POOL PENALTY` | `INERT` ×3 | `INERT` ×3 | `INERT` ×3 |
| `LESS STABILITY` | `INERT` ×3 | `INERT` ×3 | `INERT` ×3 |
| `LESS FAILED EDGE` | `INERT` ×3 | `INERT` ×3 | `INERT` ×3 |
| `LESS BREADTH` | `INERT` ×3 | SS moved | `INERT` ×3 |

**`STARVED` means the input was absent, so the zero is a statement about the corpus. `INERT` means the input was
present and the ranking did not move, which is a statement about the term.** `latWeight` is the largest weight in
the vector (`0.561495`) and it is `STARVED` on `RE1` and on both SockShop packs — those corpora carry no
`traces.csv`, so the propagation channel has nothing to read — while on `RE2` and `RE3` it has an input and
**reorders candidates without flipping a case**. The pool penalty, the stability prior and the failed-edge term
are `INERT` everywhere: each was measured at full shipped strength on all 735 cases and the ordering they produced
was the same ordering.

The failed-edge zero has a second cause and it is the gate, not the term: `admitsFailedEdgeTerm` refuses the
cases on this half for the reason `docs/failed-edge-gate.md` records, so the arm is a measurement of the gate.
That is why the row is kept rather than dropped — a reader comparing this table with the FSE'26 half, where the
same weight is worth `+41` cases, needs the refusal stated where the zero is.

## The one arm that gains: `anomalyCvWeight = 0.05` costs two cases

`LESS CV` reads `668/735` — one case on `RE2:TrainTicket` and one on `RE3:TrainTicket`, and nothing anywhere
else:

| cell | production | `LESS CV` | Δ |
| --- | --: | --: | --: |
| `RE2:TrainTicket` | 76/90 | 77/90 | **+1** |
| `RE3:TrainTicket` | 22/30 | 23/30 | **+1** |
| the other seven cells | — | — | `0` |

The mechanism is checkable and it is the one the term was built for: `cv` is the **dispersion** share of a
channel's anomaly — a channel whose series is noisy throughout earns `min(cv, 1.5) × 0.05` on top of its
deviation — and on TrainTicket, the only cell with 63–69 services and near-zero baselines, a noisy but healthy
channel receives that bonus and outranks the truth. Removing the share does not make the ranking worse anywhere
else, which is what a tie-break score of `0.05` against a base term of `1.0` predicts.

`LESS TREND` reads the same `RE3` case (`+1`) and nets `−1`, and the cell-level rows say it is **three losses
against two gains** rather than the two losses this paragraph claimed before the fault-type rows were read:
`RE1` OnlineBoutique `delay` `24 → 23`, `RE2` OnlineBoutique `loss` `12 → 11`, `RE2` SockShop `delay`
`14 → 13`, against gains on `RE2` TrainTicket `mem` `14 → 15` and `RE3` TrainTicket `f2` `5 → 6`. It is
therefore **not** a candidate, and it is worth naming why the two arms are not symmetric: the trend share
(`0.15`) is three times the dispersion share and measures monotone drift, which is real evidence for a
ramp-shaped fault; dispersion is not evidence of anything — **but that reading is itself qualified below**, where
the pre-registered pair shows the two shares do not compose additively.

## The confirmation, on the instrument that publishes

> **Superseded in part** by *The joint arm* below: the `+2` is reproduced here as a configuration reading, and the
> pre-registered pair shows the composition's response to its own coefficients is larger than the margin. The
> default is consequently unchanged.

The two cases the arm found were re-measured on the **golden** runner — `run-rcaeval.ts`, the code path the nine
published cells come from — with the knob passed as a dispatch input rather than by editing a default
(`anomaly_knobs=cv=0`, battery `42666007350` at the same commit `653d916d`):

| cell | published | `cv=0` | Δ |
| --- | --: | --: | --: |
| `RE1:OnlineBoutique` | 113/125 | 113/125 | `0` |
| `RE1:SockShop` | 119/125 | 119/125 | `0` |
| `RE1:TrainTicket` | 113/125 | 113/125 | `0` |
| `RE2:OnlineBoutique` | 84/90 | 84/90 | `0` |
| `RE2:SockShop` | 89/90 | 89/90 | `0` |
| `RE2:TrainTicket` | 76/90 | 77/90 | **+1** |
| `RE3:OnlineBoutique` | 26/30 | 26/30 | `0` |
| `RE3:SockShop` | 24/30 | 24/30 | `0` |
| `RE3:TrainTicket` | 22/30 | 23/30 | **+1** |

`668/735` against `666/735`, cell for cell as the ablation predicted it — which is the property that matters:
the two instruments agree on the control (nine cells, above) and on the arm (two cells, here), so neither reading
is an artefact of its own corpus assembly.

**And it is not shipped by this iteration.** The repository's kill criterion is an AND over two benchmarks, and
the same coefficient is live on the FSE'26 half's 1422 datapacks. A default changed on the strength of one half
would be the mistake iterations 129 and 249 each paid for. The change is pre-registered for the next iteration
with the FSE'26 dispatch as its first step; the arm, its confirmation and the exact command are recorded here so
that the next session starts from a measurement instead of an intuition.

## The joint arm: the two shares are not separable, and the pair refutes the sum

`TREND` and `CV` were the only pair whose single arms landed on the same case with opposite signs, and the
question was pre-registered above: `667` if the `RE2` gain and the `RE2` loss are one case, `668` if they are not.
The pair was run (`42722364076`, twelve rows, one job per suite) and **neither number is what it reads**:

| arm | `RE1` (375) | `RE2` (270) | `RE3` (90) | total (735) |
| --- | --: | --: | --: | --: |
| **production** (control) | 345 | 249 | 72 | **666** |
| `LESS TREND` | 344 | 248 | 73 | 665 |
| `LESS CV` | 345 | **250** | 73 | **668** |
| **`LESS TREND + CV`** | 345 | **247** | 73 | **665** |
| sum of the two singles' deltas | `−1` | `0` | `+2` | `+1` |
| measured joint delta | `0` | `−2` | `+1` | **`−1`** |

**The interaction is the same size as the effects it was supposed to compose, and it changes sign with the
suite.** Three witnesses, each a fault-type cell whose case count is `caseReps / 3`:

| cell | cases | production | `−TREND` | `−CV` | `−TREND + CV` | what it is |
| --- | --: | --: | --: | --: | --: | --- |
| `RE1` SockShop `loss` | 25 | 19 | 19 | 19 | **20** | a case **neither removal fixes alone** |
| `RE2` OnlineBoutique `loss` | 15 | 12 | 11 | 12 | **10** | the pair costs **two** where the singles cost one and none |
| `RE3` TrainTicket `f2` | 7 | 5 | 6 | 6 | **6** | both removals recover **the same** case |

### The mechanism, read off the code rather than inferred from the table

The shares are additive in `featureScore` (`deviation + trendBonus + burstBonus + cvBonus`), so the interaction
cannot come from the sum. It comes from what happens next: `buildTopologyFaultGraph` **re-scales the field to
`[0,1]` over the fleet**, and the base term is `log1p` of that rescaled value. A share therefore does not add to
the truth's score alone — it moves the fleet's maximum, which re-scales **every** candidate, and only then is the
result compared against the weighted signals. That is why `RE1` SockShop `loss` gains a case only when both
shares are gone (the two competitors that were above the truth each lose their amplifier, and neither removal
alone is enough to reorder them) and why `RE2` OnlineBoutique `loss` loses a second case the singles never
touched.

### What this refutes, and the decision it forces

1. **The vector is not additive under removal, and this document cannot price it as if it were.** The 256th
   iteration warned that leave-one-out is a first-order marginal; this is the measured counterexample, and it is
   larger than three of the nine margins it qualifies.
2. **`anomalyCvWeight = 0` is NOT shipped.** Its `+2` is real as a *configuration* reading — the golden runner
   reproduced it cell for cell — but the neighbourhood probe says a single adjacent edit takes the same corpus to
   `665`. A 0.27 pp difference whose sign is not stable under the next edit is not a default to change; it is a
   knife edge, and shipping it would be fitting noise dressed as a mechanism (`docs/drop-deviation-symmetry.md`
   records the same refusal for the same reason).
3. **The three anomaly shares are read as ONE composite for the rest of the accounting.** Any future arm that
   varies `trend`, `cv` or `breadth` has to be read against `TREND + CV`-style neighbours before its margin is
   quoted anywhere, because their single-arm deltas are not components of it.

## What is not priced, and why the omission is stated

- **`podStateWeight = 8`** — the largest number in the vector after `selfAnomalyWeight` — has **no channel on this
  corpus**. Every metric point in the nine cells belongs to one of ten families (`cpu`, `mem`, `load`, `latency`,
  `latency-50`, `latency-90`, `error`, `workload`, `socket`, `diskio`) and none of them is a pod lifecycle
  reading: no restart counter, no readiness probe, no phase. An arm would measure the corpus. The term
  is priced on the half that has the channel (`docs/pod-state-term.md`: `31.7 / 99.3 / 100.0 / 100.0` at
  `0 / 4 / 8 / 16`), and the omission is a fact about RCAEval rather than about the term.
- **`temporalWeight`, `sourceWeight`, `selfTimeWeight`, `victimWeight`** ship at `0`, so an arm over them would
  remove nothing. `temporalWeight` is now forwardable from the battery (`overrides.temporalWeight`) because the
  golden half has carried the knob all along and the battery could not state it — the seam
  `docs/dispatch-forwarding.md` was written about.
- **The joint arms are not measured.** `LESS TREND` and `LESS CV` both read `23/30` on `RE3:TrainTicket`, which is
  consistent with **one case decided by the shared composition** and with two independent cases that happen to
  land on the same count. The arm that separates those readings is `TREND + CV OFF`, and it is pre-registered
  here rather than run in this iteration: a pair chosen after seeing which single arm gains is a rule fitted to
  one cell, and this repository has paid for that (`docs/closed-axes-register.md`, iterations 252–254).

## What this changes about the claim

The repository's SOTA claim has always been *"a deterministic per-node telemetry score, ordered by a jurisdiction
rule, carries the answer"*, with the kinematic layer providing the theory of admissible orderings rather than the
score. The table prices that sentence for the first time:

- **The base term is worth `133` cases.** Without the coefficient on `log1p(anomaly)` — the one quantity in the sum
  that is a property of the model rather than a prior over it — the ranking scores `533/735`. Nothing else in the
  vector is within an order of magnitude of it.
- **The dual-family shape test is worth `24`** — PRISM's axiom as a bounded indicator, and the largest single
  contribution any *imported* idea makes.
- **The emission term is worth `6`** — the collision source's own `Δλ` in errors per request, the one place Deng
  Yu's picture enters the ranking as a measured quantity rather than as an ordering rule.
- **`0` are the four collision/topology weights** (`collisionWeight`, `topoWeight`, `riseWeight`,
  `failedEdgeWeight`), which is consistent with every arm that turns one of them on losing cases and with
  `arXiv:2609.27069`'s finding that RCAEval carries no reliable graph-specific effect.

A reader who expects the kinematic layer to be where the accuracy comes from will find the opposite here, and the
honest statement is the one the arms support: **the model's contribution is the anomaly it defines and the
orderings it declares admissible, not a weighted sum of its named instruments.**

## Two 2026 references that read the same way

Neither paper is about this repository, and neither is a benchmark we lead on — they are recorded because they
report the same phenomenon from the other side, which is what makes this table more than bookkeeping.

- **`arXiv:2611.02416`** (November 2026, SLM-based diagnosis with historical-frequency profiling) reports that
  *"final decisions often favor large anomaly scores despite the model's own propagation analysis suggesting
  otherwise"*, and builds its remedy around how often a signal is flagged during the fault-free period. That is
  this table's `−133` in another vocabulary: the term that decides a case is the candidate's own anomaly
  magnitude, and every propagation-derived term in the vector is worth `6` cases or fewer.
- **`arXiv:2610.35767`** (RCAtlas) strips the agent scaffolding off and finds that the *simple* harnesses reach
  `PR@1` of 65–77% while published staged agents land at 16–53% and statistical/causal methods at 6–39%. The
  reading is the same shape: the accuracy lives in what is measured per component, not in the choreography
  around it — which is the claim this repository has been making with a different instrument.

Neither comparison may be read as a gap. Different populations, different metrics, different tasks; what
transfers is the direction of the evidence, and it points the same way this iteration's arm table does.

## Reproduction

```
gh workflow run benchmark-production-weights.yml          # twelve rows, one job per suite
pnpm exec tsx benchmarks/src/run-ablation.ts --suite re1 --only production-weights
```

The first command is the artifact this document cites (`42722364076`, and `42660148243` before the joint arm
joined the table); the second is the same selection locally. `--only` selects twelve rows rather than the
battery's fifty, which is why one suite takes ten minutes instead of forty — and its control row is what lets a
local run be compared with a published cell at all.
