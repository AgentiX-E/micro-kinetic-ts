# The deduction's gate — the arm §6 named, made reachable

**Status:** the operator is built, fenced, dispatchable **and measured on the nine cells.** At `rho = 1` the
gate reads **637 / 639 / 639** of 735 at `gate = 0.25 / 0.5 / 0.75` against a 635 control and a 631 published
run — eight cells at or above the published value and **one below** (RE2:TrainTicket, by one case), so the arm
is refused by the same "no cell down" bar that refused its ungated parent, and the shipped default stays 0.
§6 is the reading, its three predictions scored, what it bought by fault type, and the two things it provably
cannot see.

**Owner of:** `TreePrunerOptions.topoDiscountGate`, `DEFAULT_TOPO_DISCOUNT_GATE`, the `topodiscountgate` /
`topo_discount_gate` dispatch names, and the config-line field `topoDiscountGate`.

---

## 1. Why there is anything left to do

Iteration 158 moved the topological deduction into deviation space and iterated 190 restricted it to response
channels. Both were corrections of the operator, and both are measured (`docs/anomaly-space.md`,
`docs/topo-discount-scope.md`). What survived them is one number and one shape:

| arm                     |     RE1 |     RE2 |    RE3 |     735 |
| ----------------------- | ------: | ------: | -----: | ------: |
| `rho = 0` (shipped)     |     327 |     240 |     64 | **631** |
| `rho = 0.5`, `external` |     327 |     239 |     65 |     631 |
| `rho = 1`, `external`   | **329** | **241** | **65** | **635** |
| `rho = 0.5`, `all`      |     326 |     239 |     62 |     627 |

At `rho = 1` five cells gain eight cases — RE1:OnlineBoutique +3, RE1:SockShop +1, RE2:OnlineBoutique +2,
RE3:TrainTicket +2 — and three give up four: RE1:TrainTicket −2, RE2:TrainTicket −1, RE3:SockShop −1. The
total is the highest this project has recorded and the axis is still refused, because **"no cell down" is the
bar and `+4` does not meet it.** That refusal is correct and it is also unhelpful: it says the operator helps
somewhere and hurts somewhere, and it does not say which property separates the two.

**The weight cannot separate them, and that is arithmetic rather than opinion.** The charge is
`rho × min(a, e)`: raising `rho` scales every caller whose callee moved at all. A cell that wants more
deduction and a cell that wants less receive the same push, in the same direction, from the same knob. What is
missing is not a number — it is a **support condition**, and one quantity in this operator has been carried
since iteration 157 without ever being read as one: the SHARE `min(a, e) / a`.

## 2. The physical claim

Containment cuts two ways, and the operator only ever used one of them.

- A **symptom**'s anomaly is _mostly_ its callees'. That is what "the caller's response time contains its
  callees' response time" means quantitatively: on a node that is merely waiting, `e` approaches `a`, and the
  share approaches 1.
- A **source**'s anomaly is its own. Its callee may well be moving — a fault propagates outward, and the
  callee is downstream of it — but the callee accounts for a _fraction_ of the source's reading, because the
  source's reading is the fault.

So the share is a classifier, and it is the classifier the nine cells were asking for. `rho` asks "how much
of an explanation do I remove"; the gate asks "was this an explanation at all". The refused nine-cell column
is consistent with the reading: the cells that gain are the ones where a caller is dominated by what it calls,
and the cells that lose are the ones where the deduction reached a node that was only partly explained.

**The claim is now measured, and it is right about two of the three losses and silent about the third** — see
§6.2 and §6.4. What survives §6 is a narrower statement than the one above: the share classifies the `loss`
cases, which is where the whole net gain comes from, and it says nothing about a `delay` on the path or a
`cpu` at the source. Neither of those is a partly-explained node, and neither is a symptom by any reading of
containment. The paragraph above is the hypothesis; §6 is what it is worth.

## 3. The form

```
explained(v) = max over callees c with weight(v→c) > 0 of weight(v→c) × anomaly(c)
capped(v)    = min(anomaly(v), explained(v))
charged(v)   = capped(v) >= gate × anomaly(v) ? rho × capped(v) : 0
anomaly′(v)  = anomaly(v) − charged(v)
```

Three decisions in four lines, and each was taken against a specific alternative.

1. **The gate reads the SAME capped quantity the charge does.** `e` may exceed `a` — the linearisation
   permits it and "a part cannot exceed the whole" is what the cap says — so the raw share can be 5 while the
   capped share is 1. A gate expressed on the raw ratio would be a second, disagreeing statement about how
   much was explained; a gate on the capped one is the same statement the charge makes, read as a condition.
2. **The comparison is `capped >= gate × anomaly`, not `capped / anomaly >= gate`.** `anomaly` is not
   guaranteed positive — a node with no telemetry reads `0` — and a division answers `NaN` there, which
   compares false, which switches the deduction off for that node silently. The product form is defined
   everywhere, and a non-positive anomaly is admitted unconditionally because a share of a non-positive whole
   is not a quantity.
3. **The threshold is inclusive.** `>=` rather than `>`: `explained` is a product of a propagation weight and
   a callee's anomaly, so exact halves are what a weight grid produces, and the boundary is not a
   measure-zero accident here.

## 4. `gate = 0` is not a small default — it is the operator without the gate

`min(a, e) >= 0 × a` is `min(a, e) >= 0`, which holds for every node: the condition is vacuous, the branch is
unreachable, and no float rounds. That is the same standard `topoDiscount = 0` is held to, and it is why this
knob could be added without a control dispatch: **the shipped configuration is bit-identical by construction
rather than by agreement**, so the nine published cells cannot move.

It is asserted three ways rather than asserted once:

| the fence                                                  | the failure it names                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `DEFAULT_TOPO_DISCOUNT_GATE === 0`                         | a shipped number with no owner, which no census can require a claimant for                                 |
| five fixture families × `toBe` on every node at `gate = 0` | a gate that perturbed the result in the last bit, which would be a different published number              |
| the monotonicity sweep, 11 nodes × 6 gates                 | a gate that could ADD a charge as it rose, i.e. one whose cells could move for a reason nobody could state |

## 5. The instrument

A knob earns nothing by existing; it has to be reachable from a dispatch, visible on the artifact, and
refused where it is malformed. Each of those is a test rather than a habit.

- **Reachable.** `--topo-discount-gate` on both CLIs; `topodiscountgate=` in the golden half's packed
  `anomaly_knobs`; `topo_discount_gate=` in FSE'26's `ranking_knobs`; registered in
  `dispatch-surface-census.test.ts` with an owner document and both input names, and checked flag by flag by
  `reaches()` against the workflows' own `case` blocks. Its value set is `{0, 0.25, 0.5, 0.75, 1}` and a value
  outside it **fails the step** rather than falling back — a gate is a share, and a share outside `[0, 1]` is
  not a configuration this operator has.
- **Visible.** Appended to the golden half's `signals:` line at the tail, because every byte before it is
  what the published artifacts carry and the golden string is an extension of the shipped line rather than a
  replacement for it. On the FSE'26 half it is nested under `topoDiscount` on that line's own rule (a gate
  combined with a zero weight is not a configuration the engine can distinguish — the map is never built), and
  printed **including at its shipped 0** whenever the weight is non-zero, because a gated arm and an ungated
  one differ in this field alone.
- **Attributable.** `topoDiscountGate` joins `REPORTED_CONFIG_FIELDS`, together with `topoDiscount` and
  `topoDiscountScope`, which had been on the LINE since iteration 190 and in no record an artifact is read back
  into. The ablation battery cannot print any of the three — no row of it sets the weight — so
  `UNREPORTED_BY_ABLATION_BATTERY` records that as a fact about the study, separate from
  `UNREPORTED_BY_ENGINE_RUNNERS`, whose shared-record argument stopped being sufficient the moment the two
  halves' lines diverged.
- **Backward-readable.** `topoDiscountGate` is optional on the report record and renders as `0` when absent,
  so an artifact published before the field existed still renders a line a reader can attribute. That is a
  test, not an intention: the fixture deletes the field and asserts `topoDiscountGate=0`.
- **Not searched.** `HELD_AT_ENGINE_DEFAULT` in the optimizer carries it with a reason — a support condition
  is a dispatch axis, and at weight 0 the search would be tuning a field the run cannot consult.

## 6. What is measured, and what is not

Measured: the operator, its inertness at 0, its monotonicity in the gate, its reach on both halves, its
refusal of malformed values, its attribution, its backward compatibility. Coverage on both touched engine
files is **100 / 100 / 100 / 100** (`causal/topo-deduction.ts`, `pruning/pruner.ts`), and the suite is
205 files / 5,168 tests green. **And, since iteration 195, the nine cells.**

### 6.1 The arm

Four runs, all on `68eca88`'s master, one input each. The column headed `rho = 0` is the push-triggered
golden run `41007505748`; the column headed `rho = 1, gate = 0` is `41007628910` and is **the control the
gate is measured against** — the question this axis asks is what the gate buys _over the ungated deduction_,
not what it buys over nothing.

| cell               | `rho=0` (published) | `rho=1`, `gate=0` | `gate=0.25` | `gate=0.5` | `gate=0.75` |
| ------------------ | ------------------: | ----------------: | ----------: | ---------: | ----------: |
| RE1 OnlineBoutique |                 107 |               110 |         110 |    **110** |         109 |
| RE1 SockShop       |                 116 |               117 |         117 |    **117** |         117 |
| RE1 TrainTicket    |                 104 |               102 |         104 |    **104** |         105 |
| RE2 OnlineBoutique |                  80 |                82 |          82 |     **82** |          82 |
| RE2 SockShop       |                  85 |                85 |          85 |     **86** |          86 |
| RE2 TrainTicket    |                  75 |                74 |          74 |       74 † |          74 |
| RE3 OnlineBoutique |                  25 |                25 |          25 |     **25** |          25 |
| RE3 SockShop       |                  18 |                17 |          17 |     **18** |          18 |
| RE3 TrainTicket    |                  21 |                23 |          23 |     **23** |          23 |
| **total**          |             **631** |           **635** |     **637** |    **639** |     **639** |
| **case-level**     |             85.85 % |           86.39 % |     86.67 % |    86.94 % |     86.94 % |
| Δ vs published     |                   — |                +4 |          +6 |         +8 |          +8 |
| **cells below it** |                   — |                 3 |           2 |      **1** |           1 |

† the one cell the arm cannot adopt on, and §6.4 is about it.

The control discipline is this repository's: the `rho = 0` column reproduces the published census
`40868666421` **case for case on all nine cells**, so the numbers being differenced come from one run rather
than from two runs assumed to agree. Each arm's own `signals:` line carries the value it ran with —
`topoDiscount=1 topoDiscountScope=external`, `selfAnomalyWeight=1`, `rankNormalization=true`,
`anomalyNormalizeNodeThreshold=20`, and `topoDiscountGate=0` / `=0.25` / `=0.5` / `=0.75` — read back from the
job logs. **`topoDiscountGate=0` printing at all is §5's "visible" claim measured**: the field is nested under
`topoDiscount` on the line's own rule and rendered including its shipped value, so the arm and its control are
separable by reading them rather than by remembering them.

**`gate = 0.5` and `gate = 0.75` tie at 639 and are not equivalent.** At 0.75 one case in RE1:OnlineBoutique
is given back (`currencyservice_loss_1`, truth rank 1 → 2, now predicted `checkoutservice`) and one is won in
RE1:TrainTicket (`ts-travel-service_delay_3`, rank 4 → 1), which is why the totals tie; 0.5 reaches the same
total with **no break at all** against its own control. Between two arms that tie on the metric, the one that
ties by doing less is the one that is not eating the deduction's benefit to pay for its own.

### 6.2 The three predictions, scored

They were written down in the previous revision of this section, before the runs, so this is a verdict rather
than a story.

1. _"If the share is the missing classifier, the three cells that lose at `rho = 1` are the ones whose losses
   are partly-explained nodes, and they recover **without** the five gaining cells losing — total above 635."_
   **Confirmed in the aggregate, two-thirds confirmed in the mechanism.** The total is 639, above 635; and
   against its own control the arm is `+4 / −0` — it never breaks a case the ungated deduction had right. But
   only **two of the three** losing cells recover: RE1:TrainTicket 102 → 104 at `gate ≥ 0.25` and RE3:SockShop
   17 → 18 at `gate ≥ 0.5`, both **exactly** back to the published value and no further. RE2:TrainTicket does
   not move at any gate — 74 at all four — so its lost case is not a partly-explained node and the share is
   not the quantity that classifies it (§6.4). All four gaining cells keep their gains, and one cell gains a
   case it did not have at `gate = 0` (RE2:SockShop 85 → 86).
2. _"If the gate is merely a weaker deduction, every cell moves toward the `rho = 0` column and the total lands
   between 631 and 635."_ **Refuted.** 639 is above both endpoints, and RE2:SockShop moves **away** from the
   `rho = 0` column — 85 at zero weight, 85 ungated, **86** gated — which is a case neither of the deduction
   nor of no deduction, i.e. the gate is doing something neither arm could.
3. _"If the gate is inert — every cell identical at every value — then `e/a` has no variance on this corpus at
   `rho = 1`."_ **Refuted.** The gate changes the truth's own charge on **70 of 723** analysable cases at
   `gate = 0.5` (45 at 0.25, 84 at 0.75), and the per-case flip sets are disjoint across gates rather than
   nested.

A fourth prediction was derived while the runs were in flight, from the operator's structure rather than from
the corpus, and is recorded because it held: **the six cases whose truth is never scored (§7 of
`re3-quiet-truth.md`) cannot be reached by a gate on an anomaly that does not exist, and must be wrong on all
five arms.** They are: `adservice_loss_4`, `currencyservice_loss_3`, `payment_loss_1`, `cartservice_f1_3`,
`currencyservice_f1_1`, `currencyservice_f1_2` — **0 of 6 correct on the published run and on all four arms.**

### 6.3 What the gate bought, by fault type

Case sets against the published run at `gate = 0.5`: **+17 fixed / −9 broken**, net +8.

| fault type | corpus | fixed | broken | net | reading                                            |
| ---------- | -----: | ----: | -----: | --: | -------------------------------------------------- |
| `delay`    |    120 |     7 |      7 |   0 | the gate neither wins nor loses this class         |
| `loss`     |    120 |     6 |      1 |  +5 | **the arm's entire net is this class**             |
| `cpu`      |    120 |     0 |      1 |  −1 | the one cell-level loss (§6.4)                     |
| `disk`     |    120 |     1 |      0 |  +1 |                                                    |
| `socket`   |     45 |     1 |      0 |  +1 |                                                    |
| `f1`       |     26 |     1 |      0 |  +1 |                                                    |
| `f2`       |     13 |     1 |      0 |  +1 |                                                    |
| `mem`      |    120 |     0 |      0 |   0 |                                                    |
| `f3`       |     26 |     0 |      0 |   0 | recovered inside a cell, not against the published |
| `f4`/`f5`  |     25 |     0 |      0 |   0 |                                                    |

This is the most useful table the axis has produced, because it says the gate is not a general improvement:
**`delay` is exactly a wash at seven for seven.** The gate is a classifier for one failure mode — a `loss`
at a source whose callee also moved — and it pays for its eight cases by re-ranking delay faults as often as
it repairs them. Two of the four cell-level losses that remain are inside cells that net positive.

### 6.4 What the gate cannot see, and why that is the next instrument

**The `rho = 1` deduction deletes ground truths from the ranking, and the gate does not stop it.** Measured:
cases carrying no truth evidence at all, i.e. cases where the engine produced no score for the answer,
are **6 published → 12 at `rho = 1`, at every gate value.** The gate is blind to that entire tail by
construction: a deleted truth is a node whose capped explanation equalled its whole anomaly, i.e. a share of
1, which is above every gate on the grid. Three of them are visible as breaks — `checkoutservice_delay_1`,
`_2`, `_3` in RE2:OnlineBoutique, truth rank 1 → **absent**, and a `delay` at a caller is precisely the case
where containment cannot tell "I am waiting on my callee" from "my callee looks slow because the delay is on
the path to it". That distinction is not in the containment share and no value of this knob will find it.

**The last cell stands on a case this axis cannot reach.** RE2:TrainTicket is −1 at every gate, and the case
is `ts-travel-service_cpu_1`: truth rank 1 → 3 at `rho = 1`, and its recovered post-deduction anomaly is
**`0.6470588235294118` at `gate = 0`, `0.25`, `0.5` and `0.75` — bit-identical.** The gate never touches it,
so its share is at or above the highest value on the grid and no further dispatch of this knob can move it.

**And the artifact cannot say what that share is, which is the gap this iteration names.** The recovered
quantity above is not the gate's input. On a graph the engine normalises — `rankNormalization=true` above 20
nodes, so all of TrainTicket — `applyAnomalyNormalization` re-enters the map before the ranking reads it, so
`selfAnomalyLog1p` inverts to a **rank share**, not a deviation. What the reading can therefore report is
displacement: 0.985 → 0.647 is one rank step of 68 (1 → 2 in the published run's anomaly map) and
`0.647` is 44 of 68. On the small systems, where no normalisation runs, the same inversion **is** the literal
share — RE3:SockShop's `front-end_f3_3` reads `0.9225 → 1.5848`, i.e. `min(a, e)/a = 0.418`, a `f3` at
`front-end` whose callees explained 41.8 % of it, charged whole by the ungated deduction (rank 1 → 3) and left
alone at `gate = 0.5` (rank 3 → 1). **The instrument owed is one field: the share, in deviation space, on the
truth's own evidence.** With it this census could bin cases by share directly instead of bracketing them with
a four-point grid, and the prediction in §2 would become a distribution rather than a set of flips.

### 6.5 The arm is not adopted

639 of 735 with eight cells at or above the published value and one below is the closest any arm in this
campaign has come, and it is refused for the reason the 635 arm was refused: **"no cell down" is the bar, and
RE2:TrainTicket is one case down.**

**Superseded 2026-10-30 (it.162).** The boundary value of the same operator — `gate = 1`, charge only a node
its callees account for in full — reads **641 of 735 with no cell below the published value and no fault type
down** (`docs/topo-share.md` §8). It was not found by a finer grid; it was found by publishing the share and
reading which candidates were fully explained. The `gate = 0` default still ships, because enrolling
`rho = 1` is a change to every user's ranking and the FSE'26 half has not been read yet. The shipped default therefore stays `gate = 0`, which is vacuous and
leaves the nine published cells bit-identical by construction — so nothing in this section changes what the
engine does; it changes what the project knows about what it does.

The next arm is not a fourth gate value. §6.3 says the gate's net is one fault type; §6.4 says its two
residual failures are a direction problem (a `delay` on the path, a `cpu` at the source) that containment
cannot express.

**Correction to this section as it was first written (2026-10-30).** It named the SELF channel — `victimWeight`,
PRISM's axiom as a mask, shipped at 0 with `channelSymmetry` already computed — as the arm to run next. That
arm was already measured and refused in iteration 140: `docs/prism-symmetry-mask.md` §4 records `victim = 0.05`
taking RE1-TT from 101 to **68** and FSE'26 Top@1 from 56.4 % to 55.0 %, and §5 closes the PRISM family in
three forms. Re-running a closed axis would have been a grid, not a mechanism.

What §6.4 actually owes is the instrument it names at the end of the paragraph above, and it is built:
`docs/topo-share.md` publishes the operator's own `min(a, e)/a` on the truth's evidence row, in deviation
space, with the gate that judged it. The next gate is chosen from that distribution rather than from a
four-point grid — and the tail this knob cannot reach is stated there as arithmetic: a share of 1 is zeroed at
`rho = 1` under every `gate ≤ 1`, which is why the no-evidence count is 12 at every gate against 6 shipped.

### 6.6 The fourth arm is still not run, and it is still named

FSE'26. The operator is inert there at every weight (`rho = 0.5` reads 60.5 / 79.0 / 82.2 against a control
that reads the same to the tenth), because its fleets are 3–13 services and the deduction's map is dominated
by three-node topologies. A gate on a term that never fires cannot be measured on that half, and dispatching
one would produce a column of zeros that looks like evidence.

## 7. How to re-measure

```bash
# golden half, nine cells, one input each — the control first
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1,topodiscountgate=0.25
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1,topodiscountgate=0.5
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1,topodiscountgate=0.75

# the §6 reading was produced by exactly these four dispatches, on 68eca88:
#   41007628910  topodiscount=1                    (control, 635)
#   41007632786  topodiscount=1,topodiscountgate=0.25
#   41007636232  topodiscount=1,topodiscountgate=0.5
#   41007639929  topodiscount=1,topodiscountgate=0.75
# plus the push-triggered golden run 41007505748, which is the published 631 column.

# local, on the two cells that can be assembled in a workspace
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite re1 --system ob \
  --topo-discount 1 --topo-discount-gate 0.5
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite re3 --system tt \
  --topo-discount 1 --topo-discount-gate 0.5
```

Read each arm's `signals:` line from its own job log before reading its cells. The field is on the line
precisely so that the configuration a number was produced under is a fact about the run rather than an
assumption about the dispatch.
