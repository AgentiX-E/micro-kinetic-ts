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

## 9. The bounded charge, measured — the axis §8.3 asked for, and the answer is no

§8.3 left one question open, and it was the only one left: *does a partial charge keep the thirteen fixes
while returning the three deleted truths to the pool?* If it did, the filter would become a demotion and the
`share = 1` tail would stop being a structural loss. Four arms answer it, and they answer it on one
configuration line each.

| arm           | `rho` | gate | fixes | breaks | total       | rate        | cells below published |
| ------------- | ----: | ---: | ----: | -----: | ----------: | ----------: | --------------------: |
| `41019971423` |     0 |    0 |     — |      — | **631/735** | 85.85 %     | published (control)   |
| `41019996998` |     1 |    0 |   +17 |    −13 |     635/735 | 86.39 %     | 3                     |
| `41027607492` |  0.25 |    1 |    +6 |  **−0** |     637/735 | 86.67 %     | 0                     |
| `41024054670` |   0.5 |    1 |    +6 |     −2 |     635/735 | 86.39 %     | 0                     |
| `41024058625` |  0.75 |    1 |    +8 |     −3 |     636/735 | 86.53 %     | 0                     |
| `41020001659` |     1 |    1 |   +13 |     −3 | **641/735** | **87.21 %** | **0**                 |

Four things this table decides, and one thing it refuses to.

**0. The plane is NOT monotone, and the arm that proved it is the one I predicted wrong.** The first draft
of this section extrapolated a monotone family — 631 → 635 → 636 → 641 across `rho = 0 / 0.5 / 0.75 / 1` —
and left the `rho = 0.25` cell blank until the arm landed. It landed at **637 with `+6 / −0`**: the same six
fixes the `rho = 0.5` arm keeps, and NONE of its two breaks. So the measured plane reads **631 → 637 → 635 →
636 → 641**, a knee rather than a slope, and `rho = 0.5` is *worse* than an arm with half its charge. The
reason is that the fixes and the breaks have different margins: the six fixes clear at a charge of at most a
quarter, the two `checkoutservice` breaks need a charge strictly between a quarter and a half, and nothing
about either is visible from a grid of halves. That is the same lesson §8.1's prediction 3 taught — the
arm the document expected to lose is the one that moved the answer — arriving from the other side.

**1. The deletion half of the hypothesis HOLDS, exactly.** At `gate = 1, rho = 1` the three truths leave the
pool (`rank 1 → absent`, no evidence row at all). At `rho = 0.5` all three are back in it, and their
post-deduction anomaly is exactly half the undeducted one — `checkoutservice_delay_1` 1.852498304 →
0.926249152, `_2` 1.866397445 → 0.933198723, `_3` 1.842092643 → 0.921046322. The charge is linear in `rho`,
which is what the operator's own arithmetic says it must be, and the pool membership is what it buys.

**2. The correctness half FAILS, and the fix count fails with it.** Coming back to the pool is not coming back
to rank 1: at `rho = 0.5` the truth lands at rank 3, 2 and 1 — the third one is the only case that arm
recovers, and it recovers it by luck of margin rather than by mechanism. Against that, the fixes read six at
`rho ∈ {0.25, 0.5}` and eight at `rho = 0.75`, against thirteen at the boundary. **The corner is still the
maximum** — `rho = 1` buys seven more fixes than the knee for the same three breaks — but it is a maximum
over two DIFFERENT operators rather than the end of one curve: below 1 the operator demotes, at 1 it filters,
and the six fixes the knee keeps are the demotions that happen to need no more than a quarter of the charge. There is no interior
point at which the breaks vanish while the fixes remain, and the reason is arithmetic rather than empirical.

**3. Why no interior point reaches the corner, in one sentence.** A fix demotes a *caller* of the truth; a
break demotes the *truth*. Both charges are `rho × min(a, e)` on the same relation, so the ratio of the two
ledgers is fixed by the MARGINS rather than by `rho`: raising the charge converts each fix and each break at
its own threshold, and the ordering of those thresholds is a property of the corpus. Measured, the six cheap
fixes come before the two `checkoutservice` breaks and the remaining seven fixes come after them — so at the
boundary the ledger is `+13 / −3` and at every interior point it is worse. What separates a symptom from an
overshone source is not HOW MUCH of its anomaly is explained — it is WHETHER it is entirely explained, and
only the gate encodes a "whether".

**What the table refuses to say.** `41019996998` (`gate = 0`, `rho = 1`) and `41024054670` (`gate = 1`,
`rho = 0.5`) both read exactly **635**, and they are different operators with different ledgers: `+17 / −13`
against `+6 / −2`. Worse, **three arms inside one family read 635, 636 and 637 with the same six fixes** —
a total is not a mechanism, and an arm reported as a single number would have made those look like the same
configuration read at increasing strengths. Every row above is read off the census jsonl, per case, which is
what this document was built to make possible in the first place.

## 10. Enrolment — both populations read, and the pair becomes the default

The golden half met its bar in §8 (no cell down, no fault type down, +10 cases). The other half was still
owed and is now measured on the same code (`53993ef` is a docs-only descendant of `7aea6e32`, so the arm and
its control run the same tree):

| population             | control (`41027467282`, bare) | arm (`41024050841`, `rho = 1, gate = 1`) | verdict |
| ---------------------- | ----------------------------: | ---------------------------------------: | ------- |
| FSE'26 Top@1           |                 60.5 % (860/1422) |                            60.5 % (860/1422) | identical |
| FSE'26 Top@3 / Top@5   |                    79.0 % / 82.2 % |                       79.0 % / 82.2 % | identical |
| FSE'26 fault types     |                                 — |                    **25 of 25 identical** | identical |

So the operator is **inert on the FSE'26 population** and worth **+10 cases** on the golden one. The
enrolment is therefore:

```ts
export const DEFAULT_TOPO_DISCOUNT = 1;      // was 0
export const DEFAULT_TOPO_DISCOUNT_GATE = 1; // was 0
```

That the arm is inert on 1 422 large-fleet cases and worth ten on 735 small-fleet ones is not a contradiction:
the deduction acts on callee→caller containment, and the two corpora differ in how much of that relation
survives into a per-node anomaly. **What this pair does NOT establish is WHY it is inert there**: the share is
published in the RCAEval loss census and nowhere else, so on FSE'26 the observable is "no movement" and the
mechanism is unmeasured. That is a named gap, not a conclusion.

### 10.0 The enrolment certified by a run that names no arm

An arm read through a `workflow_dispatch` knob and a default read by a bare run are two different claims, and
only the second one is about what a user gets. Both populations were therefore re-run on the commit that
carries the enrolment (`89900939`) with **no knobs at all**, and both reproduce their arms exactly:

| population | run | the run's own `signals:` line | reads |
| ---------- | --- | ----------------------------- | ----- |
| RCAEval (735) | `41031397704`, push-triggered | `topoDiscount=1 … topoDiscountGate=1` | **641 = 87.21 %**, nine cells identical to `41020001659`, `+13 / −3` |
| FSE'26 (1422) | `41034020065`, bare dispatch | `topoDiscount=1 topoDiscountGate=1` | **60.5 / 79.0 / 82.2**, and **25 of 25 fault types identical** to the pre-enrolment control |

So the default is not "the arm, described": it IS the arm, and a run that asks for nothing reproduces both
figures. The FSE'26 half now has **three** runs agreeing — the control on `53993ef`, the knobbed arm on
`e4eaea36`, and the bare run on `89900939` — which is the strongest statement available about a population the
operator does not move.

### 10.1 The fences the enrolment moved, and why each one had to be named

Fifteen assertions across six files were pinned to the old default. None of them was a nuisance: every one
was a place where a test had been leaning on a default instead of naming the arm it compared against, and the
enrolment turned that leaning into a silent change of subject.

| file                                          | fence                                                     | what it now states                                              |
| --------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| `causal/topo-discount-gate.test.ts`           | the shipped gate is 0                                     | it is **1**, the boundary                                        |
| the same file                                 | "gate 0 changes nothing" compared gate 0 against the default | monotonicity of the charge in the gate, across a five-case grid |
| `unit/pruner.test.ts`                         | `new TreePruner()` was the undeducted arm                 | the undeducted arm is `{ topoDiscount: 0 }`, named                |
| the same file                                 | six deduction tests compared against an ungated arm        | they name `topoDiscountGate: 0` as well as the weight            |
| the same file                                 | the self-time block measured its term on the shipped background | it fixes `topoDiscount: 0` so its background cannot move   |
| `benchmarks/cli-args.test.ts`                 | `--topo-discount 2` fell back to a literal 0              | it falls back to `DEFAULT_TOPO_DISCOUNT`                         |
| `benchmarks/fse26-cli.test.ts`                | "ships both at the values a bare dispatch resolves to"    | a bare dispatch resolves to the engine's own three values         |
| `benchmarks/fse26-report.test.ts`             | a legacy config without the gate rendered `=0`             | it renders the ENGINE's default                                   |
| `benchmarks/rcaeval-reported-config.test.ts`  | the golden `signals:` line                                | the enrolled line, `topoDiscount=1 … topoDiscountGate=1`           |
| `kinetic/shipped-declaration-census.test.ts`  | two docblocks still said `Default: 0`                     | both say what ships and why                                       |

**And one divergence the enrolment FOUND rather than caused.** `rcaeval-cli.ts` parsed `--topo-discount` with
`parseUnitInterval(args[++i]!)`, inheriting that helper's own zero, while `fse26-cli.ts` passed
`DEFAULT_TOPO_DISCOUNT` explicitly. Both were correct while the default was 0, which is exactly why nobody had
noticed that one of them was a literal. A cross-runner parity test caught it on the first run after the flip.

## 11. What the 94 remaining misses say the next axis is

On the enrolled arm the truth's rank among the misses is: **31 at rank 2**, 16 at 3, 8 at 4, 7 at 5, 20 at 6+
and 12 absent. Rank 2 is the band a ranking change can still reach, and its structure is not diffuse:

| false winner                                   | cases | its position relative to the truth            |
| ---------------------------------------------- | ----: | --------------------------------------------- |
| `ts-admin-travel-service` (TrainTicket)        |     6 | the ADMIN caller — observes every other service |
| `front-end` (SockShop)                         |     3 | the ROOT caller — same shape                   |
| `ts-inside-payment-service`, `recommendationservice`, `orders-db`, … | 22 | the CALLEE of the truth — the opposite direction |

Two of those three groups are the same defect: a node whose anomaly is an aggregate of what it calls is
ranked above the thing it is calling. `TopoEvo` (`arXiv:2605.15611`) names it **symptom-amplification bias**
and reports a 3.44 pp absolute gain from adjudicating it with two explicit tests — **temporal precedence**
(cause onsets first) and **path consistency** (the evidence lies on a propagation path). Neither is built
here: the engine has `failedEdge` and `lat`, both of which measure magnitude along an edge and neither of
which measures *direction in time*.

That is the next axis, and it is a mechanism rather than a threshold — which is the only kind this document
has admitted since §2.
