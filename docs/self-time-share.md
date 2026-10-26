# The self-time share — transport is created where it is not inherited

**Status:** the mechanism is IMPLEMENTED, tested, and shipped at weight **0**. This document is its
design record; the measurement that enrols or refuses it is appended below as §5 and §6, and until one
of them exists the term is OFF and the published numbers are unaffected by construction.

| what | where |
| --- | --- |
| the signal | `computeSelfTimeScores` (`packages/tree/src/pruning/ranking-signals.ts`) |
| the term | `finalScore(v) += selfTimeWeight × selfTimeShare(v)` (`pruner.ts`) |
| the weight | `DEFAULT_SELF_TIME_WEIGHT = 0` (OFF), reachable as `--self-time-weight` |
| the dispatch | RCAEval `anomaly_knobs=selftime=…`, FSE'26 `ranking_knobs=self_time_weight=…` |
| the contract | `FaultPropagationGraph.selfTimeScores` (SPARSE; absent means unknown) |

## 1. The defect it addresses, and the run that named it

`docs/transient-guard-window.md` §4 is the measurement. On `adservice_disk_1` the engine's winner,
`cartservice`, is a **CALLER** of the truth:

| | decisive metric | value |
| --- | --- | ---: |
| winner `cartservice` | `latency-90` | **2.096** (`dev=1.430 rise=25.89×`) |
| truth `adservice` | `cpu` | 1.648 (`rise=14.35×`) |

A caller's response time **contains** its callees'. When a callee becomes slow, the caller's own latency
metric rises with it — and on a rank-normalised graph it can rise *further*, because a caller queues
behind the slow callee. The anomaly score is a maximum over metrics, so it cannot express the difference
between *this service created 26× of delay* and *this service waited 26× as long for someone else*.

The window-estimator dispatch is what proved the effect is load-bearing rather than theoretical: restoring
the guard's discarded latency channels gained 15 cases and lost 17, and **eleven of the seventeen lost by
exactly one rank step** because the restored channel belonged to the caller. The guard had been suppressing
propagated symptoms as a side effect; the doc's own conclusion is that the fix is *a suppression mechanism,
not a better estimator*, worth up to **+8 cases on RE1 (83.5 → 85.6)**.

## 2. The statistic

```
L(v)       = log₁₀(1 + (post(v) − pre(v)) / pre(v))      over v's latency channels, max
inherited  = max over callees c of L(c)
share(v)   = max(0, L(v) − inherited) / L(v)             ∈ [0, 1]
```

Four properties are the design, and each one is pinned by a test rather than argued:

1. **It is a SHARE, not a difference.** A leaf scores `1` whenever it moved — and that is the definition,
   not the degree artefact `computeTopoSourceScores`' leaf carries ("nothing downstream exists that could
   have created it"). A caller keeps only the part of its rise its slowest callee cannot account for.
2. **It inherits from the LARGEST callee, not the sum.** A caller's response time contains the callee it
   waited on longest. A sum would let a caller with many quiet callees inherit more time than it spent,
   and the share would go negative on cases that are plainly inherited.
3. **A fall creates nothing.** The statistic measures disturbance a node *created*; a service that got
   faster while its peers broke did not create any, and inheriting from a faller is a measured zero.
4. **It is scale-invariant.** Multiplying every latency channel by ten leaves the map bit-identical,
   because a deviation is a ratio and the share is a ratio of deviations. That is the first property any
   new term in this repository is asked for, after four scale defects.

## 3. Why this is not a closed row

`docs/reverse-propagation-falsified.md` closes "a source is a node its neighbours do not explain"
(Direction 2, the mirror `1 − maxChildExplanation`) with an argument that survives: **a source's
neighbours are always anomalous**, so any explained-by-a-neighbour test discounts the source in both
directions. `topoWeight` shares that fate at −42.4 / −37.8 / −3.1 cases.

This statistic is a different question, and the difference is checkable rather than rhetorical:

| | `topoSource` / its mirror | self-time share |
| --- | --- | --- |
| reads | TOTAL anomaly (every metric family) | the TRANSPORT channel only |
| asks | is this node explained by a neighbour | how much of this node's delay nothing downstream can account for |
| shape | signed bonus, magnitude = a neighbour's score | ratio in `[0, 1]`, magnitude = a share |
| at a source | discounted, because its callees are anomalous too | **1.0** whenever it has no callee, and ≥ the inherited share otherwise |

The falsification argument for the mirror does not apply because the source's callees need not have high
**latency**: a disk fault at a leaf has no callee at all, and a slow callee that is *itself* waiting on
its own child contributes a smaller own-latency than its caller's total.

## 4. The estimator, and why it is deliberately not the engine's deviation

`deviation` exists only for metrics the guards **kept**. The guard deletes the propagation-symptom latency
channels — including, on fourteen RE1 failure blocks, the *faulted service's own*. A relational measure
that reads an absent level as `0` would report the caller's entire rise as self-created on exactly the
cases the term exists for. Hence:

- the level is estimated from the **raw series**, by a median of the first and last **thirds**;
- a service with no usable latency channel is **ABSENT**, not zero;
- a caller **any** of whose callees lacks a level is **ABSENT** as well — that callee may be the one it
  inherited from, so the comparison is undecidable rather than zero. This is what keeps the term silent
  (and harmless) on the cases where the guard removed the source's channel.

The median-of-thirds estimator was **refused as a guard trigger** in the same document that motivates this
term, and using it here is not a contradiction: a guard needs an **absolute** judgement on one series
("is this transient?"), where two samples in 721 are indefensible; a share compares two services measured
by the *same* estimator, so the common-mode error cancels in the ratio. The failed arm is the control that
makes this statement measurable rather than optimistic.

`pre <= 0` carries no level rather than a large one (the idle-percentile artifact of
`near-zero-rise-suppression-falsified.md`), written as `!(pre > 0)` so the `NaN` arm is the same arm. A
positive-but-denormal baseline makes the ratio overflow, and the finiteness guard on the ratio is
load-bearing: `Infinity` in a share poisons every candidate in the case rather than scoring one.

## 5. What ships, and what is measured

| change | state |
| --- | --- |
| `computeSelfTimeScores`, `isLatencyMetric`, `medianOfRange` exported | **SHIPPED** (the last two as the single owners of the transport-family question and the window median) |
| the term, its sparse contract, `DEFAULT_SELF_TIME_WEIGHT = 0` | **SHIPPED OFF** — at 0 the map is not even built, so the shipped ranking is bit-identical by construction |
| `--self-time-weight` on both runners, `selftime=`/`self_time_weight=` in the packed dispatch blocks | **SHIPPED** — a term measurable on one half only has an undecidable other half |
| the enrolment decision | **PENDING** the runs in §6 |

Two defects were found while wiring it, and both are the same class this repository has paid for before:

1. `DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG` carried the comments `channels-moved term (OFF)` and `no
   contender gate (shipped)` for one iteration after the breadth enrolment. A reader of the DEFAULT object
   learned the opposite of what it ran. Corrected, with the reason stated at the site.
2. The test file's `DEFAULT_BREADTH_PAIR` was declared and never read — a lint finding, and the sign that
   the default path's own value had no fence. It now reads the pair **back off the default object**, which
   is the assertion the 24.2pp `config`-block drift says is worth having.

## 6. The measurement plan

The term's own arms are dispatchable now, and the kill criterion is unchanged: a gain must not be bought
with a regression on the cell that blocks the goal.

| arm | dispatch | what it decides |
| --- | --- | --- |
| control | shipped configuration | the baseline the other arms are read against |
| term alone | `anomaly_knobs=selftime=0.3` | whether inherited transport is worth demoting at all |
| term, small | `anomaly_knobs=selftime=0.1` | the shape of the response, at a weight that cannot dominate the base term |
| composition control | the window estimator's arm | the term's own *enabling* measurement: with the source's latency channel restored, the share has two numbers to compare |

`docs/transient-guard-window.md` §4 predicted the size of the prize: **+8 cases on RE1**, which is past the
one published arm this engine does not lead. That prediction is the thing the runs test, and it is stated
here as a number so a null result is as informative as a positive one.
