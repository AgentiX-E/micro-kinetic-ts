# The symmetry mask — PRISM's axiom as a discount, not a score

**Status:** the mechanism is IMPLEMENTED, tested, and shipped at weight **0**. Its measurement is §4, and
its disposition is recorded there and on `DEFAULT_VICTIM_WEIGHT`.

**Owner of:** `--victim-weight` (both runners), `anomaly_knobs=victim=<weight>` on the golden half,
`ranking_knobs=victim_weight=<weight>` on FSE'26.

---

## 1. What the mask is

PRISM (arXiv:2601.21359, Luan Pham — the RCAEval benchmark's own author) localises a root cause from
per-service metrics alone, on one observation:

> Root causes show anomalies in **both** internal properties (cpu, memory, disk, socket) and external
> properties (latency, error, throughput). Affected components show anomalies **only** in external
> properties, because faults propagate through observable interfaces and do not penetrate internal state.

This engine already carries PRISM's score as an additive term (`prismWeight`, shipped 0). The mask is a
different form of the same axiom. For each candidate `v`:

```
Sⁱ(v) = max over INTERNAL channels of deviationZScore      (cpu / mem / disk / socket)
Sᵉ(v) = max over EXTERNAL channels of deviationZScore      (latency / error / throughput / workload)
sym(v) = hasInternal(v) && Sⁱ+Sᵉ > 0 ? 2·min(Sⁱ,Sᵉ)/(Sⁱ+Sᵉ) : 1
```

```
finalScore(v) −= victimWeight × (1 − sym(v)) × log1p(selfAnomaly(v))
```

`sym = 1` means the two channels moved alike, so nothing is discounted; `sym = 0` means only one moved,
which is the victim signature. At weight 1 the term cancels exactly the base term of a candidate that
failed the axiom and exactly half of one that is balanced.

Three decisions are in that definition, and each is a rule this repository has already paid to learn:

1. **No threshold.** The quantity is a ratio, so no constant had to be invented for "how small is small".
   The breadth gate needed a fraction and the trend ceiling needed a cap; both were only defensible as
   values *measured* on a sweep. A ratio needs neither.
2. **Missing internal telemetry is NEUTRAL, not zero.** A component carrying no internal channel is
   `sym = 1`. An axiom about internal properties cannot be applied to a component that has none, and the
   self-time term's failure — a leaf scoring 1.0 by arithmetic because it had no callee — is the same
   mistake one module over.
3. **A mask, not a score.** See §2. This is the whole reason the term exists in this form.

## 2. Why a mask, and the measurement that decided it

Before building anything, PRISM's score was swept as what it already is: an **added** term.
Six arms on the golden nine cells, same commit (`a70a260`), one input each, every other weight shipped.
Control is the push-triggered run at the same commit, re-confirmed by an arm that states `prism_weight` as
absent (`40340844173`), which read the shipped 606/735 to the case.

| arm | run | RE1 (375) | RE2 (270) | RE3 (90) | 735 |
| --- | --- | ---: | ---: | ---: | ---: |
| **shipped** (`prism_weight = 0`) | `40340844173` | **323** | **231** | **52** | **606** |
| `additive 0.25` | `40341373995` | 315 | 242 | 57 | 614 |
| `additive 0.50` | `40341387607` | 313 | **246** | 59 | **618** |
| `additive 0.75` | `40341401043` | 308 | 244 | 61 | 613 |
| `conjunctive 0.25` | `40341334056` | 301 | 239 | 58 | 598 |
| `conjunctive 0.50` | `40341347263` | 290 | 239 | 64 | 593 |
| `conjunctive 0.75` | `40341360380` | 286 | 233 | **64** | 583 |

Three readings, and the third is the interesting one.

**The frontier is still `{w = 0}`** — the register's conclusion survives two enrolments (breadth at
`cba6d5b`, burst removal at `3ab50dc`) with six arms rather than the old grid. Every arm below
`additive 0.50` costs RE1, and RE1 is the cell this engine leads by **0.73 pp**, four cases — a lead the
`additive 0.50` arm would spend entirely (313/375 = 83.47%, below `L0`'s 85.4%).

**`additive 0.50` gains +12 on the 735 fold** (606 → 618) with RE2 231 → 246 and RE3 52 → 59. That is the
largest single-arm gain measured on this population since the breadth enrolment, and it is refused for the
reason above: a fold total is not the goal, every benchmark is.

**`conjunctive 0.75` takes the blocking cell from 15 to 24 of 30** — past PRISM's own conjunctive 23/30
(76.7%) — while costing RE1 **37** cases. That is the trade the axiom does not require. An added score at a
weight that can reorder the whole ranking moves every candidate; the axiom only has something to say about
candidates that fail it. As a bounded multiplier it can move a candidate only relative to the ones that
fail the axiom, and on a case where **every** candidate is external-only — a pure delay fault, which is
what RE1's `delay` and `loss` cells are — it discounts them alike and the order is unchanged by
construction. That is the hypothesis §4's arms test, and it is stated before the measurement rather than
after it.

## 3. The wiring

- `computeChannelExtremes` (`pruning/prism-signal.ts`) is now the ONE place the internal/external split is
  walked; `computePrismScores` consumes it too, so the score and the mask cannot disagree about what `Sⁱ`
  and `Sᵉ` are.
- `computeChannelSymmetry` turns the extremes into `sym`; the map is **absent**, not empty, when the weight
  is 0, so the shipped path does not build it at all.
- The term is `victim`, weight `−victimWeight`, value `(1 − sym) × log1p(selfAnomaly)`, so
  `Σ terms = finalScore` is preserved and the breakdown reports what decided the score. A candidate missing
  from the map reads the neutral symmetry 1: a case the map cannot judge is not a case it can punish.
- `graph.channelSymmetry` carries the map; `RankingWeights.victimWeight` carries the weight, so the
  optimizer sees the field and holds it at the engine's default (registered in `HELD_AT_ENGINE_DEFAULT`).

## 4. The measurement

Four arms on the golden nine cells and one on FSE'26, dispatched at the enrolled default with
`anomaly_knobs=victim=<w>` / `ranking_knobs=victim_weight=<w>`. The prediction, written before the runs:
RE1 is **unchanged** (every candidate is external-only, so the mask is uniform), RE2 and RE3 gain (their
truths carry internal channels), and no cell regresses.

| arm | RE1 | RE2 | RE3 | 735 | verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| shipped | 323 | 231 | 52 | 606 | control |
| `victim=0.05` | | | | | |
| `victim=0.10` | | | | | |
| `victim=0.20` | | | | | |
| `victim=0.50` | | | | | |
| FSE'26 `victim_weight=0.2` | — | — | — | — | |

*(filled in by the acceptance commit; a table of empty cells is the honest state of a build that has not
been measured yet, and this document is shipped with the build rather than after the result.)*
