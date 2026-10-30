# The topological deduction, and the channel it is allowed to act on

_Iteration 190. The third form of a term that has been refused twice, and the reason the third one is
admissible where the first two were not._

## 1. What the term is for

A caller's response time CONTAINS its callees' response time, and a caller's error rate contains the
errors its failed calls produced. On a benchmark that asks "which service is the origin", that containment
is a systematic bias toward the caller: a single faulty leaf lifts every service on the path to it, so the
magnitudes that decide the ranking favour the symptom.

The engine already carries three attempts at this. Two of them are off at the shipped weights, and both
were turned off by measurement rather than by taste:

| term                        | form                                                   | why it is off                                                                                                                                         |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topoWeight`                | `+ w · (1 − max over callees of propWeight × anomaly)` | additive on a score that is raw on OnlineBoutique (1–3) and rank-normalised on TrainTicket (steps of 1/63); at `w = 0.1` RE1-TrainTicket lost 46.4 pp |
| `topoDiscount` (ratio form) | `anomaly × (1 − ρ·(1 − topoSource))`                   | deducts the node's WHOLE anomaly, so a callee-origin's own `cpu` reading is deducted by its caller's response; RE1 83.47 → 68.53 at ρ = 0.25          |
| `victimWeight`              | `− w · (1 − symmetry) · log1p(anomaly)`                | PRISM's internal/external axiom as a multiplier; −33 cases at its first weight                                                                        |

All three describe the same correction and all three were refused by the same population. The reason is
not that the correction is wrong; it is that each of them applies it to the wrong QUANTITY.

## 2. The physical claim

Only a response crosses a call boundary.

- A **response** channel — `latency*`, `delay`, `error`, `loss`, `socket` — is observable at the boundary.
  A caller's value contains its callee's, so a callee's rise is a sufficient explanation of the caller's
  rise, and the caller's own rise is therefore ambiguous.
- An **internal** channel — `cpu`, `mem`, `disk` — is a property of the component's own machine. Nothing
  transmits it outward. A busy callee does not make its caller's CPU reading rise, so no callee can
  explain it away, and deducting it is an error of category.
- A **demand** channel — `workload`, `load` — is what was HANDED to the component: the opposite direction.
  It is the family the decisive-evidence guard already excludes.

The ratio form and the symmetry mask both act on a node's single per-node anomaly, which is the MAXIMUM
over all its channels. On RE3/SockShop the origin of `carts_f1_*` reports its fault in `cpu`, and the
victim `front-end` reports it in `error`; a per-node discount cannot separate them, so it deducts the
origin and leaves the victim — the exact inversion that made the term look like a population trade.

## 3. The form

```
explained(v) = max over callees c with propWeight(v→c) > 0 of propWeight(v→c) × anomaly(c)
anomaly'(v)  = max(0, anomaly(v) − ρ · explained(v))
```

applied only where the scope allows it (`external` = both sides must carry a response-channel dominant
metric; `all` = the ablation arm).

**It is a deduction rather than a ratio, and that is what makes it scale-free.** Its relative effect is
`ρ · explained(v) / anomaly(v)` — a ratio of two quantities on the same scale — so the same weight means
the same thing on OnlineBoutique's raw deviation (order 1–3) and on TrainTicket's rank-normalised one
(steps of 1/63), which is the property the additive term never had and the one the ratio form had at the
cost of deducting the wrong channel.

The clamp is written as a branch rather than `Math.max(0, …)` so a fully explained node reads exactly `0`
instead of `-0`, which the ranking's id tie-break would see as a different value.

## 4. The measurement, locally

RE1:OnlineBoutique is 125 cases, RE3:SockShop is 30; both are the assembled local corpus. One variable per
row. `AC@1` per fault type in the golden column order (cpu, delay, disk, loss, mem).

|               ρ | scope    |   OB AC@1 | OB cells                     |   SS AC@1 |
| --------------: | -------- | --------: | ---------------------------- | --------: |
| **0 (shipped)** | external | **85.6%** | 92 / 88 / 96 / 52 / 100      | **63.6%** |
|            0.25 | external | **86.4%** | 92 / 88 / 100 / 52 / 100     | **63.6%** |
|             0.5 | external | **87.2%** | 92 / **92** / 100 / 52 / 100 | **63.6%** |
|            0.75 | external | **88.0%** | 92 / 92 / 100 / **56** / 100 |     61.1% |
|             1.0 | external |     88.0% | 92 / 92 / 100 / 56 / 100     |     61.1% |
|             0.5 | **all**  |     87.2% | 92 / 92 / 100 / 52 / 100     | **53.6%** |

Two things are being read here.

**The scope is the whole of the difference on SockShop.** At ρ = 0.5 the two scopes score the same on
OnlineBoutique (87.2%) and differ by **10 pp** on SockShop — `all` costs six cases, `external` costs none.
That is the inversion of §2 reproduced by an ablation of one field, on one corpus, at one weight.

**The weight has an interior optimum that is not a plateau artefact.** On OnlineBoutique the curve is
85.6 → 86.4 → 87.2 → 88.0 → 88.0, and the cell that moves at each step is a different one (disk at 0.25,
delay at 0.5, loss at 0.75). Nothing moves down at 0.25 or 0.5, which is the pair the shipped default may
be chosen from; 0.75 is where SockShop starts paying.

## 5. The nine cells and FSE'26: measured, and REFUSED

Two arms and one control, all on `90b9860`: control `40896401151` (shipped), `40896889186`
(`topodiscount=0.5`, scope `external`), `40896903790` (`topodiscount=0.5,toposcope=all`). FSE'26 arm
`40896934000` and its control `40901367746` on `69d6587`, which differs from `90b9860` only in `nx.json`
and one test file.

`AC@1`, per suite and per system:

| suite | system         |    ρ = 0 (shipped) | ρ = 0.5 `external` |                 Δ |      ρ = 0.5 `all` |                  Δ |
| ----- | -------------- | -----------------: | -----------------: | ----------------: | -----------------: | -----------------: |
| RE1   | OnlineBoutique |          **85.6%** |          **87.2%** |          **+1.6** |              87.2% |               +1.6 |
| RE1   | SockShop       |              92.8% |              93.6% |              +0.8 |              92.8% |                0.0 |
| RE1   | TrainTicket    |              83.2% |              77.6% |              −5.6 |              69.6% |              −13.6 |
| RE2   | OnlineBoutique |              93.3% |              90.0% |              −3.3 |              90.0% |               −3.3 |
| RE2   | SockShop       |              94.4% |              94.4% |               0.0 |              94.4% |                0.0 |
| RE2   | TrainTicket    |              83.3% |              81.1% |              −2.2 |              78.9% |               −4.4 |
| RE3   | OnlineBoutique |              88.9% |              88.9% |               0.0 |              88.9% |                0.0 |
| RE3   | SockShop       |          **63.6%** |          **63.6%** |               0.0 |          **53.6%** |              −10.0 |
| RE3   | TrainTicket    |              71.0% |              71.0% |               0.0 |              71.0% |                0.0 |
| —     | suite mean     | 87.2 / 88.9 / 71.1 | 86.1 / 88.5 / 71.1 | −1.1 / −0.4 / 0.0 | 83.2 / 87.8 / 66.7 | −4.0 / −1.1 / −4.4 |

FSE'26, 1422 cases: **60.5% → 60.5%** Top@1 (Top@3 79.0 → 79.0, Top@5 82.2 → 82.2). The arm is **exactly
inert** there — not "within noise", the same three numbers to the tenth.

**The scope's claim is confirmed to the tenth.** RE3:SockShop reads 63.6 against 53.6 — the −10.0 pp that
the LOCAL 30-case slice predicted before the dispatch (§4, last row). One field, one corpus, two arms, and
the sign and size transfer from 30 cases to the full cell.

**The axis is refused anyway, on TrainTicket.** RE1:TrainTicket −5.6 and RE2:TrainTicket −2.2 outweigh
RE1:OnlineBoutique +1.6, and the two suite means that could have carried it (RE1 −1.1, RE2 −0.4) do not.
The loss is concentrated in exactly the channels the scope admits, which is the part that had to be read
rather than argued: on RE1:TrainTicket the DELAY cell falls 64.0 → 56.0 and the LOSS cell 52.0 → 32.0.

The mechanism is the scale, and it is the same one `topoWeight` has. TrainTicket is rank-normalised (63–69
nodes, steps of 1/63 = 0.0159), so `explained` is a product of a propagation weight and a RANK, and
subtracting it from a rank moves a node by many positions at once — while the same subtraction on
OnlineBoutique's raw deviation (order 1–3) is a small relative nudge. A `all`-scope arm on the no-inject-time
variant of RE1:TrainTicket reads **80.8 → 32.8**, i.e. the rank surface is where this term is most
destructive.

Consequence: **the default stays ρ = 0**, the axis stays opt-in, and it is registered as measured-and-refused
rather than left open. What a next arm would have to change is stated in §6.

> **Superseded on the mechanism, and re-measured on the same cells — iteration 158, `docs/anomaly-space.md`.**
> The paragraph above names the scale correctly and draws the wrong conclusion from it. TrainTicket's rank
> surface is not a property of the CELL, it is a property of the GRAPH BUILDER (`anomalyNormalizeNodeThreshold`),
> and the operator is extensive: `explained(v)` adds a callee's anomaly into a caller's, so the subtraction that
> inverts it is only defined on a deviation. The deduction now reads `rawAnomalyScores` and returns through the
> graph's own `anomalyNormalization`, and the cell that refused the axis reads **RE3:TrainTicket 71.0 → 78.1
> (+7.1 pp)** at ρ = 1 with **RE1:TrainTicket −5.6 → −1.6** and **RE2:TrainTicket −2.2 → −1.1**. All three suite
> means are up at that weight (87.7 / 89.3 / 72.2 against 87.2 / 88.9 / 71.1). The `all`-scope reading above
> replicates exactly (RE3:SockShop 63.6 → 53.6), so the two questions — which channels, and which space — are
> independent, and this document's scope conclusion stands.

## 6. What a next arm would have to change, and what is still unmeasured

- **The scale.** The deduction is applied in ANOMALY space and then scored on the population's own scale.
  On a rank-normalised suite that is a unit mismatch. The candidate fix is to deduct in rank space — or to
  gate the deduction on `explained / anomaly ≥ θ`, so a node that a callee explains only slightly is not
  moved at all. Neither is measured; both are one condition in `discountedAnomalies`.
- **RE1:SockShop locally** is six cases, so the local instrument cannot see it; TrainTicket cannot be
  assembled in a workspace at all. The nine cells are reachable through the dispatches in §7 only.
- The FSE'26 read above is the shipped-default control against one weight; the axis is inert there, so no
  further weight is worth dispatching until the scale question is settled.

## 7. The middle arm: the predicate was a conjunction, and only one conjunct is physical

§2 states the physical claim correctly and §5 measures the consequence of getting it wrong in one direction.
Both arms it compares, however, are built on a decision that was never measured: **one predicate decides both
sides of the deduction.**

```ts
// until iteration 166
const explicable = (nodeId) => {
  if (scope === 'all') return true;
  return isResponse(dominant(nodeId));
};
// callee side:  if (!explicable(edge.to)) continue;
// caller  side: if (!explicable(nodeId)) { keep entire; continue; }
```

The argument for one predicate was that "does this channel cross a call boundary" is one question, and two
predicates would be free to disagree about it. The argument is sound and its premise is false: the two sides
answer different questions, and §2 only licenses the second one.

- The **callee** side asks whether a callee's deviation can be an explanation its callers inherit. The answer
  cannot depend on the callee's channel. A callee saturated on `cpu` injects **delay** into its caller — that is
  queueing, not a modelling choice — so requiring the callee to be response-dominant makes the operator blind to
  every internal fault at an origin, which is the majority of the corpus.
- The **caller** side asks whether a caller's deviation may be explained away. Here the channel matters exactly
  as §2 says: an internal reading at the caller is the component's own work, and no callee produces its CPU.

So the conjunct belongs on the caller side only. `external` keeps both, `all` drops both, and the arm this
section measures keeps the one that is physical:

| scope      | `explainsThrough` (callee) | `deductibleOn` (caller) |
| ---------- | -------------------------- | ----------------------- |
| `all`      | always                     | always                  |
| `external` | response only              | response only           |
| `caller`   | **always**                 | response only           |

The instance that motivated it: `re3ss_carts_f1_1`, where `carts` reports the injected fault in `cpu` and
`front-end` reports it in `error`. `external` refuses to charge `front-end` — its callee is not response-dominant
— so the victim keeps an anomaly of 2.026 and outranks the origin's 1.157. Under `caller`, `front-end` is charged
its callee's 1.157 and falls to rank 3.

### 7.1 The local readback, before the dispatch

Two assembled cells, 155 cases (RE1:OnlineBoutique 125, RE3:SockShop 30), one variable per row, `ρ = 1`
throughout — the weight §5's superseded note settled. The shipped default is the first row.

| gate | scope    | OB AC@1 | SS AC@1 |       total |
| ---: | -------- | ------: | ------: | ----------: |
|    1 | external | 107/125 |   18/30 | **125/155** |
|    1 | caller   | 107/125 |   18/30 |     125/155 |
|  0.9 | caller   | 109/125 |   18/30 |     127/155 |
|  0.8 | caller   | 109/125 |   18/30 |     127/155 |
| 0.65 | caller   | 109/125 |   17/30 |     126/155 |
|  0.5 | caller   | 110/125 |   19/30 | **129/155** |
| 0.35 | caller   | 110/125 |   18/30 |     128/155 |
|  0.2 | caller   | 110/125 |   18/30 |     128/155 |
|    0 | caller   | 110/125 |   18/30 |     128/155 |
|    0 | external | 110/125 |   17/30 |     127/155 |
|    0 | all      | 108/125 |   13/30 |     121/155 |

Three things are visible, and the third is the one that matters.

1. **The scope alone is worth nothing at the shipped gate.** `gate = 1` requires a callee to explain the caller's
   _entire_ anomaly, which almost never holds, so the deduction is inert on these cells at that threshold — the
   `ρ = 0` control reads the same 125/155. The two knobs are **coupled**, and every prior sweep varied one at a
   time: §5's gate sweep held the scope at `external`, and this section's scope arm had no gate to be measured
   against.
2. **The middle arm dominates both extremes at every gate.** Against `external` at the same gate it gains the
   cases the callee-side conjunct refused (OB +3, SS +2 at 0.5); against `all` it avoids the four cases SS loses
   when an internal caller is charged.
3. **The five fixes are the predicted class and the one break is the predicted failure.** At `gate = 0.5`:
   `re3ss_carts_f1_1` and `re3ss_carts_f3_2` (origin reports `cpu`, victim reports `error`), plus
   `re1ob_currencyservice_loss_1`, `re1ob_productcatalogservice_delay_1`, `re1ob_productcatalogservice_disk_5`.
   The break is `re3ss_front-end_f3_1`, where the _origin_ is `front-end` and its own `error` rise is charged
   against a deviating callee — the operator's standing failure mode, unchanged by the scope.

### 7.2 Predictions, recorded before the dispatch

The 155-case readback is two cells of nine, and +4 cases on 155 is inside one standard error. The dispatch is
therefore the measurement, and these four claims are what it is read against. `external`/`gate = 1` is the
control (641/735, re-taken bare on the same commit).

- **P1 — the mechanism, not the total.** At least **two of the six** RE3:SockShop misses whose winner is
  `front-end` (`carts_f1_1`, `carts_f1_4`, `carts_f3_1`, `carts_f3_2`, `carts_f3_4`, `orders_f4_1`) flip to the
  truth. If fewer than two flip, the `cpu → error` attribution above is wrong and the arm's gains, whatever
  their total, are not this mechanism. **Amended from "three" before the readback, on the instrument's own
  evidence**: §7.1 already shows exactly two of the six flipping locally (`carts_f1_1`, `carts_f3_2`), and the
  other four are cases where the truth's own anomaly is not the largest in its fan-in — a magnitude problem the
  scope cannot reach. Predicting three while the instrument said two would have made P1 a coin toss rather than
  a test of transfer, and the number was written from the class SIZE rather than from the measurement.
- **P2 — the total.** ≥ **650 of 735** at `gate = 0.5`. Proportional transfer of the local +4/155 predicts
  ~+12; the cell mixture predicts less; a total below 650 is a refusal.
- **P3 — no cell down.** No cell below its published value by **≥ 3 cases**. `all`'s damage on RE3:SockShop
  (−4 locally, −10 pp at `ρ = 0.5` in §5) is the harm this arm exists to avoid; if it reappears, the middle arm
  is not middle.
- **P4 — the threshold is not the knob.** `gate = 0` and `gate = 0.5` land within **3 cases** of each other. A
  larger gap means the threshold, not the scope, is doing the work — which would make the plateau at 0.2–0.5 a
  threshold effect and the scope claim unsupported even if P2 holds.

**Refusal rule, written in advance:** refuse the arm if P2 or P3 fails, whatever the total.

## 8. How to re-measure

```bash
# local, both assembled cells
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite re1 --system ob \
  --topo-discount 0.5
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite re3 --system ss \
  --topo-discount 0.5 --topo-discount-scope all

# the middle arm, both gates (§7.2)
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite all \
  --topo-discount-gate 0.5 --topo-discount-scope caller

# golden half, nine cells, one input
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1,toposcope=caller,topodiscountgate=0.5
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1,toposcope=caller,topodiscountgate=0
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=0.5,toposcope=all
# FSE'26 half
gh workflow run fse26-benchmark.yml -f ranking_knobs=topo_discount=0.5
```

The `signals:` line names `topoDiscount` and `topoDiscountScope` unconditionally on the golden artifacts,
because a scope combined with a zero weight is not a configuration the engine can distinguish — the map is
never built — and an omitted-when-default scope would render the two arms byte-identically.

### 7.3 The readback: the mechanism is confirmed, the arm is refused, and the operator's only profitable action is deletion

Four arms on `8d7f2a58`, all `AC@1` from the per-case census rather than from the suite line. Two of them are
the same control: `41096214413` (the push-triggered bare run) and `41096379522` (a bare dispatch) both read
**641/735 with zero per-case flips**, so the control is certified twice. The arms are `41096390539`
(`toposcope=caller,topodiscountgate=0.5`, the local optimum) and `41096401593` (the same scope at gate 0, the
maximal-charging arm).

| cell               | control `external` g1 | `caller` g0.5 |      Δ | `caller` g0 |      Δ |
| ------------------ | --------------------: | ------------: | -----: | ----------: | -----: |
| RE1:OnlineBoutique |               107/125 |       107/125 |      0 |     110/125 |     +3 |
| RE1:SockShop       |               117/125 |       117/125 |      0 |     117/125 |      0 |
| RE1:TrainTicket    |               106/125 |       104/125 |     −2 |     100/125 |     −6 |
| RE2:OnlineBoutique |                 83/90 |         82/90 |     −1 |       82/90 |     −1 |
| RE2:SockShop       |                 88/90 |         85/90 | **−3** |       84/90 |     −4 |
| RE2:TrainTicket    |                 75/90 |         74/90 |     −1 |       74/90 |     −1 |
| RE3:OnlineBoutique |                 25/30 |         25/30 |      0 |       25/30 |      0 |
| RE3:SockShop       |                 18/30 |         19/30 |     +1 |       18/30 |      0 |
| RE3:TrainTicket    |                 22/30 |         23/30 |     +1 |       23/30 |     +1 |
| **total**          |           **641/735** |   **639/735** | **−2** | **632/735** | **−9** |

Against the four predictions of §7.2:

- **P1 — TRUE.** Exactly the predicted pair flipped: `re3ss_carts_f1_1` and `re3ss_carts_f3_2`, both `rank
2 → 1`, both instances of a `cpu` origin whose `error` rise at `front-end` the callee-side conjunct had
  refused. The mechanism is not in doubt: this is the arm doing exactly what it was built to do.
- **P2 — FALSE.** 639, not ≥ 650.
- **P3 — FALSE.** RE2:SockShop falls 88 → 85.
- **P4 — FALSE.** The two gates are 7 cases apart, not ≤ 3, so the threshold is doing work the scope claim
  attributed to the channel.

By the rule written before the dispatch — refuse if P2 or P3 fails, whatever the total — **the arm is refused**,
and `DEFAULT_TOPO_DISCOUNT_SCOPE` stays `external` at `DEFAULT_TOPO_DISCOUNT_GATE = 1`. The scope value stays in
the code and on both dispatch surfaces as the measured answer, the way the `sum` closure stayed after §8 of
`docs/topo-closure.md`.

**What the nine cells now say about the operator itself, in arithmetic rather than in cells.** The charge is
`ρ · min(a_v, e_v)`, so a caller whose explaining callee is at least as large as itself is charged **its entire
anomaly** and reads 0. Three of arm A's nine breaks are exactly that, and they are the largest single-case
movements in the table: `checkoutservice_loss_3` 1.976 → 0.099, `orders_delay_2` 2.260 → 0.041,
`orders_delay_3` 2.237 → 0.004. A node reading 0 then leaves the candidate pool entirely — `performTreeRCA`
admits only `selfScore > 0` — so the truth is not demoted, it is **absent**, and `truthRank` is `undefined`
rather than a number. Two consequences follow, and they are the reason this axis is now closed rather than
merely refused:

1. **Every gate below 1 adds partial charges, and partial charges are uniformly unprofitable.** RE1:TrainTicket
   is the cleanest reading: `ts-travel-service_delay_1` reads `a' = 1.000 → 0.889` and falls from rank 1 to 8,
   because that cell is rank-normalised over 63 nodes and a 11% charge is several positions. The four fixes on
   RE1:OnlineBoutique are real, and they are smaller than the seven losses in cells whose scale is not theirs.
2. **The only profitable action is full deletion, and that is what `gate = 1` already is.** With `e ≥ a_v` the
   charge is the whole anomaly; the gate at 1 admits exactly that set, and the published 641 is what it earns
   (+10 over the ungated operator, §5 of `docs/topo-discount-scope.md` and `docs/anomaly-space.md` §6). So the
   four knobs — weight, gate, scope, closure — are not four independent axes. The weight and the gate are two
   descriptions of one quantity, the scope decides which channels it applies to, and the closure decides how a
   fan-out aggregates; **none of them can change the FORM `min(a_v, e_v)`, and the form is what the loss is
   in.** A fifth value of any of them is a fifth point on the same curve.

The form's defect is now expressible in one sentence: **it deletes a node it has explained, and deletion is not
a rank.** The next arm on this topic is therefore not another value — it is the pool question, which is where
§7.4 points.

### 7.4 What §7.3 leaves: the pool is not the graph, and twelve misses say so

The sentence above — "deletion is not a rank" — is not rhetorical. `performTreeRCA` admits a node to
`scoredNodes` only when `selfScore > 0`, so a node the deduction has fully explained is not ranked last, it is
**absent**: `truthRank` comes back `undefined` and `pool` counts one fewer node. Twelve of the 94 misses in the
published arm are exactly that shape — `truthInGraph: true`, `truthRank: null` — and the census cannot tell
"the truth had no telemetry" from "the truth was explained away", because both read as an absent rank.

The cause is a one-line filter and a comment that describes a different set:

```ts
// benchmarks/src/run-rcaeval.ts, in the record constructor — as it read until iteration 166
// The candidate pool is the graph's node set, and the runner records its size on the case's own
// prediction record so the two cannot disagree about which set the ranking covered.
pool: ep?.pool ?? 0,
```

`ep.pool` is `results.length`, and `results` is the top of `scoredNodes`, which is `{v : selfScore(v) > 0}`.
On a 14-node OnlineBoutique graph it reads 8 or 9, and the five or six nodes it omits are the silent ones. So
the pool is **the set of nodes with a positive post-deduction anomaly**, which is a materially different object
from the graph — and the difference is load-bearing in both directions: a node that is silent can still carry
the strongest `failedEdge` evidence in the case (`failedEdgeWeight` ships at **3**, the largest weight in the
ranking), and a node the deduction deleted can still carry everything else.

The local instrument already reads this, in the smallest possible way: on RE1:OnlineBoutique, admitting the
zero-anomaly nodes instead of filtering them moves **107 → 108**, and the single case it recovers is
`re1ob_adservice_loss_4` — the one case in that cell whose truth was absent from its pool. The other eleven are
in cells without a local corpus, which is why this is a dispatch and not a reading.

That is the next arm, and it is deliberately not a fifth value of the four knobs: it changes the SET the ranking
covers, so every term in `finalScore` becomes able to speak for a node that was previously invisible.
