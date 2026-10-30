# The deduction's gate — the arm §6 named, made reachable

**Status:** the operator is built, fenced and dispatchable; **the nine-cell arm is not yet read back.** This
document owns the question and states exactly where the reading stands, in the repository's convention: a
measurement that has not run is named, not implied.

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
205 files / 5,168 tests green.

Not measured: **the nine cells.** The arm to run is `rho = 1` at `gate ∈ {0.25, 0.5, 0.75}`, against
`rho = 1, gate = 0` as the control — the control is the 635 configuration rather than the shipped 631 one,
because the question this axis asks is what the gate buys _over the ungated deduction_, not what it buys over
nothing. Three predictions are on record before the runs, so the reading cannot be a story told afterwards:

1. If the share is the missing classifier, the three cells that lose at `rho = 1` are the ones whose losses
   are partly-explained nodes, and they recover **without** the five gaining cells losing — total above 635.
2. If the gate is merely a weaker deduction, every cell moves toward the `rho = 0` column and the total lands
   between 631 and 635. That is not a null result and it is not a win: it would say the operator's coverage is
   the problem and the share is not the classifier.
3. If the gate is inert — every cell identical at every value — then `e/a` has no variance on this corpus at
   `rho = 1`, which would contradict §2 directly and would be the more interesting reading of the three.

**A fourth arm is not run and is named rather than implied:** FSE'26. The operator is inert there at every
weight (`rho = 0.5` reads 60.5 / 79.0 / 82.2 against a control that reads the same to the tenth), because its
fleets are 3–13 services and the deduction's map is dominated by three-node topologies. A gate on a term that
never fires cannot be measured on that half, and dispatching one would produce a column of zeros that looks
like evidence.

## 7. How to re-measure

```bash
# golden half, nine cells, one input each — the control first
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1,topodiscountgate=0.25
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1,topodiscountgate=0.5
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=1,topodiscountgate=0.75

# local, on the two cells that can be assembled in a workspace
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite re1 --system ob \
  --topo-discount 1 --topo-discount-gate 0.5
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite re3 --system tt \
  --topo-discount 1 --topo-discount-gate 0.5
```

Read each arm's `signals:` line from its own job log before reading its cells. The field is on the line
precisely so that the configuration a number was produced under is a fact about the run rather than an
assumption about the dispatch.
