# The self-time share — transport is created where it is not inherited

**Status:** the mechanism is IMPLEMENTED, tested, shipped at weight **0**, REFUSED at both measured weights
(§6), and its fleet repair is REFUSED on FSE'26 with a census rather than a deficit (§9) — the corpus carries
no latency channel, so the term is unobservable there and three arms at two scopes are one artifact digest.
This document is its design record; the measurements that enrol or refuse it are appended as §5, §6 and §9,
and the term stays OFF, so the published numbers are unaffected by construction.

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

## 6. The measurement — REFUSED at both weights, and the mechanism is the leaf

Two arms on the golden nine cells, same commit (`0c61004`), one variable each, every other weight at its
shipped value. Control is run `40198340020`'s configuration read at `0c61004`'s ranking, which the
`selfTimeWeight=0` line makes bit-identical by construction.

| arm | RE1 | RE1-OB | RE1-SS | RE1-TT | RE2 | RE3 | 735 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| control | 319 | 105 | 116 | 98 | 230 | 50 | **599** |
| `selftime=0.1` | 271 | 108 | 116 | **47** | 234 | 48 | 553 |
| `selftime=0.3` | 269 | 110 | 117 | **42** | 239 | 43 | 551 |

**RE1 loses 48–50 cases, and TrainTicket accounts for 51–56 of them.** Online Boutique and Sock Shop *gain* — 
+3 and +1 at 0.1, +5 and +1 at 0.3 — and TrainTicket collapses from 98 to 42, which is the signature
`docs/transient-guard-window.md` recorded for the multiplicative topological discount: **a leaf scores 1.0
by arithmetic and a hub cannot.**

That is not a tuning problem, it is the definition meeting the graph. TrainTicket is 64 services over
**79 edges**, so most nodes are leaves; a share that pays every leaf its whole rise is a hub penalty wearing
a transport hat, and the hubs include `ts-order-service`, the truth in a plurality of that cell's cases. On
Online Boutique's 14 services and 13 edges the same term has almost no hub to punish, which is why the two
sparse cells improve: **the term is a graph-density-dependent bias, not a source signal.**

### What this refuses, and what it does not

Refused: the term as written, at both weights, on the cell that blocks the goal. The prediction in
`transient-guard-window.md` §4 (+8 cases on RE1) is **not** supported — the mechanism it named is real
(the caller does own the larger channel) but the statistic built on it moves the answer the wrong way by an
order of magnitude more than the effect it was meant to recover.

Not refused, and now a named target with the measurement to back it: **a degree-normalised share.** The
falsification gives the requirement precisely — the quantity must compare a node's self-created transport
against the FLEET's typical self-created transport on the same graph, not against the absolute `[0, 1]`
scale, because `1.0` means two different things for a leaf and for a hub. That is the same lesson
`docs/topological-source-direction.md` records one term over.

The term stays shipped at weight 0 with its tests, its two dispatch keys and this record. A refused
mechanism that can be re-measured in two dispatches is worth more than a deleted one that has to be
re-derived.

## 7. The repair, built — `computeFleetSelfTimeResiduals` and `selfTimeScope: 'fleet'`

§6 ends with a requirement rather than a term: *the quantity must compare a node's self-created transport against
the FLEET's typical self-created transport on the same graph, not against the absolute `[0, 1]` scale, because
`1.0` means two different things for a leaf and for a hub.* This section is that sentence as arithmetic.

```
peers(v)    = { u measured, u ≠ v, outdegree(u) = outdegree(v) }
residual(v) = share(v) − median{ share(u) : u ∈ peers(v) }          ABSENT when peers(v) is empty
```

Three properties are the design, each pinned by a test rather than argued:

1. **Leave-one-out.** `v` is excluded from its own reference. On a bin of three at `0.4 / 0.7 / 1.0` the 0.4 node
   reads `0.4 − 0.85 = −0.45`; a reference that included the node itself would read `0.4 − 0.7 = −0.30`, and that
   is not a smaller number so much as a different statistic — one shrunk by a factor that varies with how many
   peers the graph happens to have. A degree artefact must not be reintroduced by the term that exists to remove
   one.
2. **Conditioned on OUT-degree, because out-degree is the structural part of the share.** The denominator is the
   node's own level and the subtrahend is a **callee**'s, so fan-out is the graph property that fixes the scale:
   a leaf's share is 1 by construction and a four-callee node's is capped by its loudest callee. In-degree does
   not enter the formula at all. Distinct callees are counted, so two parallel calls to one service are one
   branch, and an unmeasured callee still counts toward the fan-out — the fan-out is a fact about the service,
   not about the instrumentation that deleted a channel.
3. **ABSENT rather than zero when a node has no peer of its own degree.** The term's contract already says
   unknown is not a measured `0` (that is why a caller with an undecidable callee is absent rather than maximally
   self-created); this is the same sentence applied to the REFERENCE. On a graph of fourteen services most nodes
   are alone in their degree class, and the term is then silent **by construction** rather than by a weight that
   happened to be small — which is the property that keeps this from being a hub penalty with a new name.

What it is **not**: a re-tuning of the refused term. The estimator, the raw series, the sparse contract and the
undecidable-callee rule are `computeSelfTimeScores`' own — the residual is a TRANSFORM of the share, computed
from it, so an A/B between the two scopes is a reading of the normalisation rather than of two statistics.
Nothing is fitted: the reference is a median of the case's own nodes, and the residual is **signed**, which the
`[0, 1]` statistic could not be. A node that created less transport than its structural peers is now pushed
DOWN, and the caller in §1 — the service the whole term exists to demote — is exactly such a node.

The weight stays 0. The scope is `'absolute'` unless a dispatch states otherwise, so no published number moves:
at weight 0 the map is not built at all, and the two knobs cannot disagree about an OFF term.

## 8. Pre-registration — H9, the fleet reading against two points of the weight

Written before any run of the arm, and the run ids are appended below once they exist.

**Question.** The absolute share was refused at `0.1` and `0.3` on the golden half. Is the refused statistic the
problem, or the reading? The repair above is the document's own stated answer; this arm is whether it is right.

**Arms**, one variable each against the same-commit control (`selfTimeWeight = 0`, which is bit-identical to
every published number by construction):

| arm | dispatch | what it prices |
| --- | --- | --- |
| control | `ranking_knobs=self_time_weight=0` | the shipped reading, on this commit |
| A1 | `self_time_weight=0.05,self_time_scope=fleet` | the repair, at a weight a rank step can feel |
| A2 | `self_time_weight=0.2,self_time_scope=fleet` | the repair, four times louder |
| A3 | `self_time_weight=0.05,self_time_scope=absolute` | **the mechanism control**: any transport term at all |

A3 is not an afterthought. Without it a gain on A1 or A2 is indistinguishable from "a term that rewards
self-created latency helps", which is a different claim and one §6 already refused on the golden half. The
absolute arm has never been measured on FSE'26 at all, so this is its first reading there.

**Why a ladder rather than one weight.** The residual's scale is new: none of the published runs has ever
carried it, and the register's law is that a weight is enrolled by a run, not chosen. A single point picked blind
would make a null result undecidable — it could be the wrong weight or the wrong statistic. Two points can
distinguish those: a monotone response says the term is live and the sign is the finding, while two flat points
say the term never spoke.

**Population.** FSE'26 RCABench, all 1 422 cases, `Top@1` with `Top@3` / `Top@5` and per-fault-type cells. The
golden nine cells are spent only if a point clears this half — the criterion is an AND, and this is its cheaper
side.

**The criterion, stated before the numbers.** A point enrols iff `Top@1` strictly exceeds the control, the
regressed fault-type count is `0`, and it loses no cell on the nine. Anything else is refused, and a refusal is
recorded here with its reading rather than deleted.

**Falsifier.** If BOTH fleet points are at or below their control, the axis is refused as a statute — not "this
weight is wrong" but "the share, in either reading, is not the statistic that decides this ranking" — and the
next arm on this population must be a different channel rather than a third normalisation of this one.

**Four predictions, auditable against the artifact:**

1. A3 (absolute, 0.05) loses cases on FSE'26 — the mechanism §6 named is direction-blind on any graph with many
   leaves, and TrainTicket-shaped cells exist on both halves.
2. A2 moves strictly more cases than A1, in both directions.
3. The residual is ABSENT for most candidates on the small graphs (OnlineBoutique and SockShop are 14 and ~10
   services), so the term is silent there and the arm's entire effect is on the large ones.
4. If the repair works, its gains are cases whose winner is a CALLER of the truth — the population §1 names —
   and its losses are cases where the truth is a leaf among moved leaves.

## 9. The reading — three arms, one number, and a census that says why

The arms were dispatched against `3fd024f`, and the control was re-read on the same commit rather than
inherited: `selfTimeWeight = 0` is bit-identical to every published number by construction, but "by
construction" is a claim about the engine, not about the corpus, and a corpus whose cache rolled would make
the control describe a different population.

| arm | run | config as printed | `Top@1` | `Top@3` | `Top@5` | per-case digest |
| --- | --- | --- | ---: | ---: | ---: | --- |
| control | `43828014109` (`05236ff`) | `selfTimeWeight=0` | **1 141** (80.24 %) | 86.4 % | 87.8 % | `a201eb81…` |
| A3 mechanism control | `44134531473` | `selfTimeWeight=0.05` (scope omitted = `absolute`) | **1 141** (80.24 %) | 86.4 % | 87.8 % | `a201eb81…` |
| A1 | `44134503641` | `…=0.05 … selfTimeScope=fleet` | **1 141** (80.24 %) | 86.4 % | 87.8 % | `a201eb81…` |
| A2 | `44134518256` | `…=0.2 … selfTimeScope=fleet` | **1 141** (80.24 %) | 86.4 % | 87.8 % | `a201eb81…` |

**The four digests are the same digest.** Not "the same accuracy": the same 1 422 rows, candidate for
candidate, in the same order — `md5` `a201eb8111893c90453b730c6ae965f0` on all four, so the identity holds at
the level of the artifact and not at the level of a rounded percentage. Zero cases moved, in either direction,
on the arm that raises the weight eight-fold over the arm below it.

The control was then re-taken **on `2122359`**, the commit that adds the census, so the comparison does not rest
on two commits agreeing: run `44142865215` (`selfTimeWeight=0`) also reads **1 141** with the same digest, and it
prints **no** `[self-time]` row — which is the other half of the print rule (an OFF term has nothing to report)
arriving as a reading rather than as a code path.

Under §8's falsifier that is a refusal: both fleet points are at the control, so the axis does not enrol. But
the falsifier's wording commits to a second sentence — "the share, in either reading, is not the statistic
that decides this ranking" — and the census says that sentence **cannot be read off this run**. The census was
built for exactly this ambiguity; it was dispatched at both scopes on `2122359` (`44141801070` at `absolute`,
`44141794481` at `fleet`), and both print the line identically, which is the point: the scope decides what the
weight multiplies, and this line is about whether there is anything to multiply:

```
[self-time] services=71105 withLatency=0 (0.0%) withLevel=0 (0.0%) undecided=0 scored=0 (0.0%)
            measuredZero=0 channelsRefusedShort=0 channelsRefusedIdle=0
```

**Zero of 71 105 services carried a latency channel.** Not "the channels were refused" — all three refusal
counters are 0 — and not "the level came out flat": no level was ever attempted, because the loop that builds
them returns on an empty channel set before it looks at a window. `isLatencyMetric` gates on
`label.startsWith('latency')` and this corpus's converter emits no channel with that prefix, so
`levels.size === 0` on every case and the term's map is empty on all 1 422 of them. The weight multiplied
nothing, three times, at two weights and two scopes.

So the two sentences the arms could not separate are now separated, and only one of them is true here:

- **"The normalisation is silent on this corpus"** — NOT ESTABLISHED. Nothing was normalised. The fleet
  residual and the absolute share were equally unobservable, which is why A1, A2 and A3 are one digest: the
  scope decides what the weight multiplies, and the weight multiplied an empty map.
- **"The map was never built"** — ESTABLISHED, by the counts, on 71 105 of 71 105 services.

### The four predictions, against the artifact

| # | pre-registered | outcome |
| --- | --- | --- |
| 1 | A3 loses cases — the §6 mechanism is direction-blind on leaf-heavy graphs | **NOT REALISED**, and its premise is why: a term that never builds a map cannot lose a case. The prediction was about a term that runs. |
| 2 | A2 moves strictly more cases than A1, in both directions | **NOT REALISED** — both move exactly zero. |
| 3 | The residual is ABSENT for most candidates on the 14- and ~10-service graphs | **NOT TESTED.** There is no residual to be absent. |
| 4 | Gains are win-the-CALLER cases, losses are leaf-among-moved-leaves cases | **NOT TESTED**, same reason. |

Two predictions failed and two were never reached; the document records that instead of rewriting the four
into a retrodiction. A pre-registration whose predictions fail because the arm could not run is evidence about
the arm's reach, not about its theory — which is the reason the census had to exist before the next arm, and
the reason §8's ladder was right to be a ladder: one point alone would have produced "0.05 is not enough",
a sentence about a weight measured on nothing.

### What this closes, in the register's vocabulary

The self-time share is now closed **on FSE'26** for a narrower reason than the falsifier anticipated: the
population cannot see the term, so no weight on it can be evaluated there. §6's refusal on the golden nine
cells stands unchanged and remains the only measured judgement of the statistic. The next arm on this
population must be a different channel — the falsifier's own instruction — and the register entry records the
census rather than the tie, because the tie is the weaker fact.
