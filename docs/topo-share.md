# The share — the quantity the gate reads, and the only reading a candidate the deduction deletes can have

## 1. The debt this pays

`docs/topo-discount-gate.md` §6 closes with a sentence that names an instrument rather than a result:

> **The instrument owed is the share itself**, on the truth's own evidence in deviation space: the artifacts
> can only bracket it, because `applyAnomalyNormalization` re-enters the map before the ranking reads it …

That sentence was written by iteration 195 after it had measured the gate on the nine cells and found that it
could not choose the next arm from its own artifacts. The gate ran at four values — 0, 0.25, 0.5, 0.75 —
reading 635 / 637 / **639** / 639 of 735 against 631 published, and one cell (RE2:TrainTicket) sat one case
below the published value at **every** gate, including the one that reads `74 → 74`. Every artifact said the
same thing about the blocking case: its post-deduction anomaly is bit-identical at all four gates. That is a
reading of the deduction's _output_, and the deduction's _decision_ is a ratio it never published.

So the next arm could only have been chosen by running a finer grid and watching a cell move — which is
tuning a number, and which cannot distinguish "no threshold in the interval reaches this case" from "the
threshold is above the grid's top". This document is the instrument, and §5 is what it makes decidable.

## 2. What the share is

For every node the operator is allowed to act on, and whose own anomaly is positive:

```
explained(v) = max over callees c of w(v→c) × anomaly(c)      // the linearisation
share(v)     = min(anomaly(v), explained(v)) / anomaly(v)      // in [0, 1], capped
```

Three properties are the definition, not decoration:

1. **Capped at 1.** When the linearisation says a callee accounts for six times its caller's anomaly, the
   share is 1 and not 6. A part cannot exceed the whole; the reading of a broken linearisation is "entirely
   explained", and a value outside `[0, 1]` could not be compared with a threshold anyway.
2. **Computed in deviation space, and reported there.** The operator adds a callee's anomaly into a caller's,
   which is defined on quantities that ADD. §3 is the arithmetic of why this cannot be recovered afterwards.
3. **It does not depend on the gate.** The gate decides _whether_ to charge; the share says _how much_ was
   explained. A share that moved with the gate would be a second answer to the gate's own question, and the
   artifact would then have to name the configuration before the number meant anything. The test file asserts
   invariance across `gate ∈ {0, 0.25, 0.5, 0.75, 1}` rather than trusting it.

### 2.1 The two absences, which are not a zero

| state                            | the map    | what it means                                                      | what a zero would have said                                      |
| -------------------------------- | ---------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| considered, nothing explained it | **`0`**    | a measurement of this corpus                                       | —                                                                |
| the scope never looked           | **absent** | a `cpu`-dominant node under `external` scope: a CONFIGURATION fact | "its callees explained nothing" — a corpus fact, and a false one |
| no anomaly to explain            | **absent** | there is no whole for a fraction to be a fraction of               | "0 % of its anomaly was explained" — true and unreadable         |

The distinction is the one `TermZeroCause` draws one level up for optional sources: a missing measurement and
a measured zero are the same number and different problems, and a record that files them together sends a
reader to the wrong object. `packages/tree/__tests__/causal/topo-deduction-share.test.ts` asserts both
absences by name, including the arm where `all` scope admits the node and the absence turns into a value — the
assertion that keeps the absence the scope's rather than the corpus's.

## 3. Why it must be computed inside the operator

The same topology, the same relative ordering, two spaces:

| input                                          |  `a` |  `b` | `w(a→b)` | `explained(a)` |    share |
| ---------------------------------------------- | ---: | ---: | -------: | -------------: | -------: |
| deviations                                     |  4.0 |  2.0 |      0.5 |            1.0 | **0.25** |
| ranks in a fleet that puts them one step apart | 0.50 | 0.49 |      0.5 |          0.245 | **0.49** |

The second row is not a different corpus; it is the same two nodes as the graph builder reports them above
`anomalyNormalizeNodeThreshold`, where a score is `k/(n−1)` and the population law of
`packages/tree/src/causal/topo-deduction.ts` applies. A ratio recovered from the reported scores is therefore
a ratio of ranks, and on TrainTicket (63–69 nodes) that is a different number from the one the gate compared.
The instrument has to come from the operator or it is measuring something else.

## 4. Where it travels

| site                                    | field                                        | when                                                                               |
| --------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `deductExplainedAnomalies`              | `TopoDeductionResult.share`                  | always — it is the operator's own decision                                         |
| `RootCauseResult.evidenceMetrics`       | `{ metric: 'topo_share', value, threshold }` | when `topoDiscount ≠ 0` and the node was considered; `threshold` is the run's gate |
| `TruthEvidence` (and its census mirror) | `topoShare`, `topoGate`                      | read from the row above, so the value and its cut come from ONE record             |

An evidence row rather than a score term, because the share is not part of `finalScore` — it is the reading
that explains why the anomaly inside `finalScore` moved. A term would have to add to the sum, and
`sumScoreTerms(terms) === finalScore` is an invariant the producer's own fence asserts.

Both `truthEvidence` fields are optional and stay ABSENT when the engine wrote no row, which is what makes the
shipped configuration (`topoDiscount = 0`) byte-identical in its artifacts: the evidence array is simply not
extended, so `metricCount` and every published byte are unchanged.

## 5. What it makes decidable

**5.1 Choosing the next gate from a measurement.** With the share published per case, the question "is there a
threshold that keeps the seventeen cases `gate = 0.5` repairs and spares the nine it breaks" becomes a lookup
over the artifact's own rows instead of a grid of 30-minute runs. If the repaired cases' shares and the broken
cases' shares interleave, no threshold exists and the axis is closed honestly — with a distribution rather
than with a cell that would not move.

**5.2 The tail no gate can reach.** A truth whose share is 1 is zeroed at `rho = 1` for every `gate ≤ 1`,
because `min(a, e) = a` passes any threshold in the interval. That is why iteration 195 measured the count of
cases carrying no truth evidence at **12 at every gate** and **6 shipped**, and why the six the deduction adds
(`checkoutservice_delay_1/2/3`, `orders_delay_1`, `orders_loss_4/5`) cannot be repaired by this knob at all.
The fix for that tail is a BOUNDED charge — `rho < 1`, or a cap on the fraction removed — not a threshold, and
this document is the reason that distinction is now a statement rather than a guess.

**5.3 A refusal is reported, not silent.** A node the gate refuses keeps its score and still carries its
share, so an artifact can say "the threshold is what spared this case" rather than only "the score did not
move". `packages/tree/__tests__/unit/pruner.test.ts` asserts the pair: unchanged score at `gate = 1`, share
still on the row.

## 6. What is measured, and what is not yet

Measured in this build:

- the operator's share, arithmetically — nine cases in `topo-deduction-share.test.ts`, including the cap, the
  two absences, gate-invariance, and the identity `discounted = a − rho·share·a` over a `rho × gate` grid;
- the evidence row's presence, value and threshold at the pruner, and its absence when the deduction is off;
- the `TruthEvidence` pair, and its absence on a result the engine did not write a row for;
- the equality of the two mirrored declarations, by the existing census fence.

**Measured: the 735-case share distribution, and the arm it chose.** §7 records the reading; the short form is
that the boundary gate this document predicted would _not_ beat 639 reads **641 of 735 with every one of the
nine cells at or above the published value**, and the share distribution is why the two arms differ.

### 6.1 Three predictions, recorded before the readback

Written when the two arms were dispatched (`41019996998` at gate 0, `41020001659` at gate 1) and before any
artifact was opened, so that the reading cannot be a story told afterwards:

1. **The instrumented arm reproduces 635 case for case.** The instrument changes no score, and the control it
   is read against is the same configuration on the previous commit.
2. **A share is published on every truth the arm ranks, and on none of the six it deletes.** The deleted ones
   have no post-deduction score, hence no evidence row at all — which is the gap §5.2 states as arithmetic
   rather than as a limitation of the instrument.
3. **At `gate = 1` the count of cases carrying no truth evidence stays 12, and RE2:TrainTicket returns to 75.** Deletion requires `share = 1`, which every gate in `[0, 1]` passes, so the boundary arm cannot add
   or remove a deletion; and the blocking case's post-deduction anomaly is non-zero (`0.647`), which means its
   share is below 1, so the boundary gate must refuse to charge it. What that costs is the seventeen cases
   `gate = 0.5` repairs, which sit at shares in `[0.5, 1)`: the boundary arm charges only `share = 1`, so it
   keeps whatever a fully-explained node's charge buys and nothing else. It is therefore **not predicted to
   beat 639** — it is the arm that says whether the tail of the repairs lives at `share = 1` or below it, and
   the number it prints is the denominator of the next decision rather than a candidate to enrol.

## 7. How to re-measure

```bash
# The control: the ungated arm, which must reproduce 635/735 and now also publishes every share.
gh workflow run benchmark-rcaeval.yml -f scopes=golden -f anomaly_knobs=topodiscount=1

# The boundary: charge only a node its callees wholly explain (share = 1).
gh workflow run benchmark-rcaeval.yml -f scopes=golden -f anomaly_knobs=topodiscount=1,topodiscountgate=1

# Local, on the fixture the operator's own tests use:
pnpm vitest run packages/tree/__tests__/causal/topo-deduction-share.test.ts
```

## 8. The reading — three arms, and the prediction that was wrong in the useful direction

Runs on `e4eaea36`'s parent tree (`7aea6e32`): `41019971423` (push-triggered golden control, shipped
configuration), `41019996998` (`topodiscount=1`, gate 0), `41020001659` (`topodiscount=1,topodiscountgate=1`).
Every `signals:` line was read before any cell was: the three differ in exactly `topoDiscount` and
`topoDiscountGate`.

| cell                | shipped | `rho = 1`, gate 0 | **`rho = 1`, gate 1** |
| ------------------- | ------: | ----------------: | --------------------: |
| RE1 OnlineBoutique  |     107 |               110 |                   107 |
| RE1 SockShop        |     116 |               117 |               **117** |
| RE1 TrainTicket     |     104 |               102 |               **106** |
| RE2 OnlineBoutique  |      80 |                82 |                **83** |
| RE2 SockShop        |      85 |                85 |                **88** |
| RE2 TrainTicket     |      75 |                74 |                    75 |
| RE3 OnlineBoutique  |      25 |                25 |                    25 |
| RE3 SockShop        |      18 |                17 |                    18 |
| RE3 TrainTicket     |      21 |                23 |                **22** |
| **total**           | **631** |           **635** |     **641 = 87.21 %** |
| cells below shipped |       — |                 3 |                 **0** |

**641 is the first arm in this campaign with no cell below the published value**, and the first whose fault-type
table has no negative entry: `delay` 99 → **103**, `loss` 70 → **74**, `socket` 43 → 44, `f1` 18 → 19, and the
other seven types identical.

### 8.1 The three predictions

| #   | prediction                                                                                                           | outcome                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | the instrumented arm reproduces 635 case for case                                                                    | **held** — 631 / 635 / 641, and gate 0 is the same 635 the previous commit read                                                                                                                                                                                                                                                |
| 2   | a share on every truth the arm ranks, none on the six it deletes                                                     | **half** — 12 without evidence, as predicted; but only **406 of the 723** ranked truths carry a share, because `external` scope never considers the **317** whose dominant channel is internal. That absence is the configuration's, and the instrument reports it as an absence rather than as a zero — which is §2.1 working |
| 3   | at gate 1 the no-evidence count stays 12 and RE2:TrainTicket returns to 75; the arm is **not** predicted to beat 639 | **half, and the half that failed is the useful one** — the count is 12 and the cell is 75, both as stated; the total is **641**, two above the arm this document expected to remain the best                                                                                                                                   |

### 8.2 Why the boundary gate wins, and why it is the same mechanism as its cost

`gate = 1` charges only a node whose callees account for **all** of it, so the operator becomes a filter: a
node that is fully contained in its callees is removed from the candidate pool. Both sides of the ledger are
that one action:

- **13 fixes, every one a rank 2 → 1.** The false winner was a CALLER — `recommendationservice` over
  `productcatalogservice` (four cases), `front-end` over `carts` / `user` (three), `orders` over `carts`,
  `checkoutservice` over `currencyservice`, `ts-travel-service` over `ts-train-service` — and deleting it
  promotes the truth. This is the containment reading of a symptom doing exactly what it says.
- **3 breaks, and they are the same action on the other side.** `checkoutservice_delay_1/2/3` are truths whose
  OWN anomaly a callee accounted for in full, so the truth itself left the pool (rank 1 → absent). Containment
  cannot tell a source that a big callee overshadows from a symptom that a callee explains, and that is the
  `delay`-on-the-path problem §195 named.

Six cases acquire a deletion they did not have (the three above plus `orders_delay_1`, `orders_loss_4`,
`orders_loss_5`); the last three were already misses, so the net cost of the filter is **3 cases against 13**.

### 8.3 What is still owed before this is enrolled

The golden half's bar is now met: no cell down, no fault type down, +10 cases. What is not yet measured is the
other half — `FSE'26` at `topo_discount=1,topo_discount_gate=1` (arm `41024050841`), and the two bounded-charge
probes (`rho = 0.5 / 0.75` at gate 1, arms `41024054670` / `41024058625`) that ask whether a partial charge
keeps the thirteen fixes while returning the three deleted truths to the pool. Enrolling the deduction at
`rho = 1` changes the shipped default for every user of this engine, so it is a decision for a measurement on
both populations rather than for one.
