# The ablation artifact, and the configuration it could not state

**Twelve booleans, no weights.** `ablation-re1-results` — the register's ablation reference — opened with
`Data`, `Filter`, `Configs` and `Repetitions`, then printed, for each of its 22 configurations:

```
Running: BASELINE (all OFF)
Flags: {"collisionAggregation":false,"extraTraceValidation":false,"selfLearning":false,"logSignal":false,…}
  (the key was `traceAugmentation` when this line was captured; it was renamed in iteration 72 — see below)
```

Measured over the whole 681-line artifact: **133 lines identify a configuration, and ZERO lines name a
weight.** Not one of the fifteen fields `REPORTED_CONFIG_FIELDS` declares necessary for attributability
appears anywhere in it.

That list states the consequence in its own words: *"an artifact that omits one cannot be compared with
another artifact — the difference is unexplained."* And this artifact is read exactly that way: the register
cites its rows as the measurement of what each feature is worth.

---

## 1. What a reader could not reconstruct

Three separate things were missing, and they compound:

1. **The flags are the study's INPUTS; the run is decided by the numbers they map to.** The mapping —
   `flags.logSignal ? 1.0 : 0.0` — lived only in `run-ablation.ts`. An artifact naming booleans tells a reader
   what was asked for, not what was run, and the two differ by every weight in the engine.
2. **Six weights were named by neither the flags nor the artifact.** `latWeight`, `latMinRise`,
   `poolMetricPenaltyWeight`, `stabilityWeight`, `temporalWeight` and `onsetShape` were not passed by the
   construction site at all, so they fell through to `DEFAULT_TREE_PRUNER_OPTIONS`. An option that is not
   passed is not absent from the run — it is INHERITED — and the artifact had no way to say either.
3. **The label asserted a configuration the run does not have.** The first row was called
   `BASELINE (all OFF)`, and the four terms that dominate the shipped ranking are **ON** in it. A reader
   comparing that row against a golden cell would be comparing two different configurations while believing
   they were the same one.

**One of those inherited terms was the single remaining unnamed literal in the whole engine.**
`DEFAULT_TREE_PRUNER_OPTIONS.logSignalMode` read the bare `'count'`, and the golden half's parser held its
own `'count'` beside it (`DEFAULT_RCAEVAL_LOG_SIGNAL_MODE`) with nothing comparing the two — the same second
owner `DEFAULT_LOG_WEIGHT` had been extracted for, one option over. Naming it in the engine is a
prerequisite for either artifact stating the mode, and it removes the last value in `pruner.ts` that a caller
could restate and drift from.

## 2. Why it survived: the third construction site, and the same reason

`run-ablation.ts` calls `main().catch(...)` at import. Nothing can import it, so nothing could call its
option assembly or its line — the defect `fse26-engine-options.ts` and `rcaeval-engine-options.ts` each
record having fixed on their own runner, found a third time on the one whose artifact is read as the
measurement of every feature.

**The extract-per-runner repair has now been applied three times, and that sentence used to continue "and
there are three construction sites". That was wrong** — it was the count of one CLASS, and the iteration that
went looking for the number found EIGHT (`docs/construction-site-census.md`, whose census derives them and
asserts each kind by path). Three are the artifact-producing runners and are now derived; three build the
engine with no arguments at all, which needs no line; one is the tree package's own factory; and one is the
weight search's mapping, whose artifact reported seven of the twenty-seven options its engine ran with.

The generalisable statement is therefore narrower and checkable: **a runner that runs itself on import has an
untestable option assembly**, and the census names every place one is built rather than a remembered count.

## 3. The repair, and what it must not move

- `benchmarks/src/ablation-engine-options.ts` — **new**: owns the flags→options mapping, builds BOTH of the
  engine's constructor arguments, and renders the configuration line.
- The six inherited terms are now passed EXPLICITLY from their owner constants. Their values are
  byte-identical to the defaults they were already receiving, so **no measurement may move** — this is the
  one claim in the iteration that must be checked rather than believed, and §6 says how.
- `run-ablation.ts` consumes the module, prints the line beside `Flags:`, and the base row's label becomes
  `BASELINE (flags OFF)`: it now claims what it can support, and the line states the rest.
- The PRISM sweep section gets the same treatment: its banner keeps `Weights:` (the values it sweeps) and
  gains the base configuration with `prismWeight` named as the swept field.
- `benchmarks/src/reported-config.ts` — **new**: the fields both engine artifacts may omit. `run-rcaeval.ts`
  and `run-ablation.ts` reach the engine through the same two constructor arguments, so both are
  inapplicable to the same six fields for the same reasons, and a record per artifact would be two answers
  to one question.

## 4. The fence, and the naming defect it caught before it shipped

`benchmarks/__tests__/ablation-engine-options.test.ts`, seven assertions over derived sets:

| assertion | what it rejects |
| --- | --- |
| every `signals` key is a `TreePrunerOptions` member | a field that is inert in the first argument |
| every `topology` key is a `TopologyFaultGraphConfig` member | a second argument used as a dumping ground |
| disjoint, both populated | a field whose OWNER is ambiguous |
| `named === signals ⊎ topology` | a line that omits a forwarded option, or invents one |
| `named ∪ exemptions === REPORTED_CONFIG_FIELDS` | a required field neither printed nor exempted |
| the six held terms are named, from their constants | a value restated instead of named |
| the base row's line shows the shipped terms ON | the `all OFF` claim, and a line that cannot distinguish flags from configuration |

The interface membership is read by a SHARED helper (`__tests__/helpers/engine-interfaces.ts`) that both
guards import, following `TreePrunerOptions extends RCAEngineOptions` into the core package — one reader,
because two readers of one interface are two answers to the same question.

**The fence paid for itself on its first run.** It failed with

```
- "enableCollisionAggregation"
+ "collisionAggregation"
```

— the line was printing the FLAG's name where the engine's option name belongs, which would have made the
artifact unjoinable against the source it describes. The line was fixed; the assertion was not weakened.

## 5. Reach, and what it does not cover

- The fence compares NAMES and values against the constants; it does not re-run an ablation. The claim that
  no measurement moved is checked against the published artifacts, not here.
- `enableCollisionAggregation` ships `true` in `DEFAULT_TREE_PRUNER_OPTIONS` and is **not** one of the
  fifteen reported fields, so the golden half's line still does not name it. That is the declared standard's
  boundary rather than an oversight — extending the line to every non-neutral engine default is a larger
  change with its own decisions about what belongs on an artifact, and it is recorded here as the residue
  rather than done quietly.
- The three pipeline flags (`extraTraceValidation`, `selfLearning`, `collisionAggregation`) were verified to
  be READ by the runner — measured, because an ablation flag that nothing reads is a row that measures
  nothing: `extraTraceValidation` at two sites, `selfLearning` at one, `collisionAggregation` reaching
  `enableCollisionAggregation`.
- **AND BEING READ IS NOT THE SAME AS REACHING THE RANKING — the criterion's own boundary, found by measuring
  it.** `extraTraceValidation` (named `traceAugmentation` until iteration 72) is read at two sites and its rows
  measure **`+0.0` on RE2 and RE3 — the only two suites that have traces at all**, while the shipped corpus
  prunes 55–82% of every trace-bearing case's edges. The flag was named for the SHIPPED step and its arm was a
  DIFFERENT option set, so a run with it ON and a run with it OFF could both be missing the shipped step. A
  read-site count is therefore necessary and not sufficient: the site must also be on the path the ranking
  takes, and the shipped corpus is now owned by `benchmarks/src/rcaeval-corpus.ts`, where no feature flag
  reaches it.

## 4. The row that was mistaken for the shipped engine

**Found by reading the artifact against the dispatch, iteration 226.** `ablation-re1-results` and
`ablation-re3-results` each carry a row labelled **`FULL STACK (all ON)`**. It turns on **three of the
twelve flags** — `collisionAggregation`, `extraTraceValidation`, `selfLearning` — and leaves all six
ranking signals at weight 0. Its measured consequence is not a small delta:

| artifact | systems | rows value-identical to `BASELINE (flags OFF)` |
| --- | --- | --- |
| `ablation-re1-results` | OnlineBoutique / SockShop / TrainTicket | 21 / 22 / 21 of 34 |
| `ablation-re3-results` | OnlineBoutique / SockShop / TrainTicket | 18 / 20 / 15 of 34 |

The eight-row legacy cluster — `BASELINE`, `+Collision Q(f,f)`, `+Trace Topo`, `+SelfLearn`, the three
pairwise combinations, and `FULL STACK (all ON)` — collapses to **one distinct value-string across all
six system blocks**, i.e. 224 printed cells carrying one configuration under two names. The row a reader
would take for the stack is the control.

### 4.1 What this corrupted

Every `Δ` in the artifact was computed against `allRuns[0]` — the stripped control — so a contribution
table read off it answered "what does this term buy over an engine nobody publishes?" rather than "what
does it buy over the engine we ship?". The two are not close: the control is 20.0% `AC@1` on
`RE3:TrainTicket` where the published configuration is 73.3%.

### 4.2 The configuration the published cells are actually taken with

It is **not a point in the battery's cube**. `logWeight` is 1 and `rankNormalization` is ON everywhere,
`prismWeight` / `collisionWeight` / `topoWeight` are the shipped 0 — but `traceWeight` is a **per-suite
pin**: `benchmark-rcaeval.yml` states `RANKING_ARG+=(--trace-weight 1)` inside the `re3` step, and the
`re1` / `re2` steps inherit the runner default `0`. `productionFlags(suite)` states both vectors, and a
fence proves the pin from the workflow rather than from a second copy of the claim: exactly one literal
`--trace-weight 1` exists, and the next `run-rcaeval.ts --suite` after it is `re3`.

Two rows now carry those vectors — `PRODUCTION (RE1+RE2: log + rank)` and
`PRODUCTION (RE3: log + trace + rank)` — and the artifact **marks** the one that is production for the
suite being measured. `isProductionFlags` compares all thirteen members, so a row that differs in the one
switch nobody watches is not production.

### 4.3 The grid is a valid counterfactual, and this is the first evidence for it

Two independent readings say the battery reproduces the published numbers where it should:

| suite | published cell | battery row | battery | published |
| --- | --- | ---: | ---: | ---: |
| `RE1:OnlineBoutique` | 112/125 | `BASELINE` (≡ production: no logs, no traces) | 89.6% | 89.6% |
| `RE1:SockShop` | 119/125 | same | 95.2% | 95.2% |
| `RE1:TrainTicket` | 112/125 | same | 89.6% | 89.6% |
| `RE3:OnlineBoutique` | 25/30 | `PRODUCTION (RE3)` | 83.3% | 83.3% |
| `RE3:SockShop` | 19/30 | same | 63.3% | 63.3% |
| `RE3:TrainTicket` | 22/30 | same | 73.3% | 73.3% |

Six of nine cells match to the printed digit, on **both** anchors — which is what licenses reading the
remaining rows as counterfactuals over the engine rather than as an experiment on a stripped toy.

### 4.4 The first reading taken against production

`+Log +Trace +Rank +PRISM (conj)` against `PRODUCTION (RE3)`, same run, same corpus:

| system | production | +PRISM conj | Δ |
| --- | ---: | ---: | ---: |
| OnlineBoutique | 83.3% | 86.7% | **+3.3** |
| SockShop | 63.3% | 43.3% | **−20.0** |
| TrainTicket | 73.3% | 93.3% | **+20.0** |
| RE3 pooled | 73.3% | 74.4% | +1.1 |

**Not adopted.** It buys 6 cases on the cell this project most needs (`RE3:TrainTicket`, the wrong-value
class) and loses 6 on the cell it can least afford (`RE3:SockShop`), and the only rule that would separate
them is the suite label — which does not exist at inference time. The row is kept as the measurement it
is, and the gate it needs is a property of the CASE (evidence sufficiency), not of the suite.

### 4.5 Residue

- `run-ablation.ts` still calls `main()` at import time, so the row table is fenced by reading its source;
  a test that asserted on `CONFIGS` directly would be a stronger fence and needs the runner split.
- The four anomaly-shape weights the published run passes (`anomalyTrendWeight` 0.15, `anomalyCvWeight`
  0.05, `anomalyBreadthWeight` 0.05, `anomalyBurstWeight` 0) are still **not fields of this record**, so
  the battery can neither state nor vary them. They are the last configuration the artifact cannot name.

### 4.6 Read back on all three suites, in both conventions, and the ladder it yields

The rows §4 added were verified on run `41964724908` (`fccc87fd`, 13/13 jobs green, 10:57 → 06:25 next day).
The anchor line is now printed by the battery itself, and it names the configuration rather than a label:

```
Δ anchor: PRODUCTION (RE3: log + trace + rank) — the published configuration for re3
```

**Convention first.** The battery's `AVG` column is the published convention (mean over fault types), its `CW`
column is the case-weighted one. §4.3's table is the case-level reading of the same cells — `25/30` and
`19/30` are counts of cases — so on RE3 the two columns of this section differ by up to 5.6 pp on the same row
(`docs/accuracy-aggregation.md` §8). Both are printed; neither is a correction of the other.

| suite | baseline (flags off) | +log | +trace | +trace +rank | **production** | Δ over baseline |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RE1 `AVG` | 91.5 | 91.5 | 91.5 | 91.5 | **91.5** | **0.0** |
| RE2 `AVG` | 90.0 | 90.0 | 90.0 | 91.5 | **91.5** | +1.5 |
| RE3 `AVG` | 52.9 | 54.0 | 67.6 | 75.4 | **76.5** | **+23.6** |
| RE3 `CW` | 50.0 | 51.1 | 64.4 | 72.2 | **73.3** | +23.3 |

Read across a row, that ladder is this project's entire measured advantage, and it says something the earlier
tables could not:

| term | RE1 | RE2 | RE3 | estimate |
| --- | ---: | ---: | ---: | --- |
| `logSignal` | 0.0 | 0.0 | +1.1 | two independent readings on RE3: alone (52.9→54.0) and on top of trace+rank (75.4→76.5) — **they agree** |
| `rankNormalization` | 0.0 | +1.5 | +7.8 | alone on RE3 (52.9→60.7) and on top of trace (67.6→75.4) — **+7.8 both times** |
| trace activity | 0.0 | 0.0 | +14.7 | 52.9→67.6; the only term whose effect is larger than everything else combined |
| `enableCollisionAggregation`, `extraTraceValidation`, `selfLearning` | 0.0 | 0.0 | 0.0 | **inert, not starved**: these three gate weights that the shipped configuration sets to zero |

Three findings, and the third is the one that costs:

1. **No shipped term moves RE1.** Its baseline IS production to the printed digit. The three terms the shipped
   configuration pays for contribute exactly zero on the suite where 51% of the corpus lives — whatever wins
   there wins in the unmodified term set. (Rows that *add* a weight the shipped configuration does not use do
   move RE1 — `+Topo Signal` reads 90.1, `+Collision Signal` 89.9 — which is the sharper statement: the
   engine's advantage on RE1 is the term set it ships WITHOUT, and adding any of them costs it.)
2. **RE3 is the whole of the margin**, and the trace activity signal is 62% of it.
3. **Half the cube is inert on this corpus.** `+Collision Q(f,f)`, `+Trace Topo`, `+SelfLearn` and their seven
   combinations all read the baseline exactly, because each gates a weight the shipped configuration holds at
   `0`. An ablation of a flag whose weight is zero measures the flag's *plumbing*, not its *idea*, and this
   battery can be read as confirming only the former. That is why the three quantified terms in the table above
   are the three whose weights are non-zero, and why no other row in the six-hundred-line artifact may be
   quoted as a contribution.

Finally, the per-suite pin this section exists for is now measured rather than argued: on RE3,
`PRODUCTION (RE1+RE2)` — i.e. the same engine **without** `--trace-weight 1` — reads **61.9 `AVG` / 58.9 `CW`
against production's 76.5 / 73.3**, a **−14.6 pp** swing from one dispatch argument in the workflow file.

### 4.7 An arm measured on the target cell and refused, and what its refusal re-diagnosed

> **Read §4.8 before acting on this section.** Its observation is sound and its conclusion is not: the field it
> names as the separator, `topoSource`, is multiplied by `topoWeight = 0` in the configuration that produced the
> table, so it enters no score. The section is left as written because the misreading is the finding — the
> artifact printed a signal without the weight that reads it — and §4.8 measures both halves of the correction.

`RE3:SockShop` is the weakest of the nine cells (66.1% published, lift 38.9% over the frequency prior) and its
`f4` type is the weakest block inside it: **1 of 7**, with five misses classified *outweighed* and one *outvoted*.
The displayed evidence of those five has a common shape — the winner's `base` is near zero and its `rise` is
large (`base=0.000 rise=32.0`, `base=0.000 rise=21.9`), which is the pathology
`suppressNearZeroBaselineRise` exists to remove: `deviation = log₁₀(1 + |max − base| / base)` is unbounded as
`base → 0`, so a series idling at 1e-4 that ticks to 3e-3 outranks a series at 30 that moves 30%.

So the lever was cheap and pre-registered: one flag, no code, measured on the cell it targets.

| arm | OB | SS | TT | corpus (88 cases) |
| --- | ---: | ---: | ---: | ---: |
| `--trace-weight 1` (shipped for re3) | 82.1 | 63.3 | 73.3 | 72.7 |
| `+ --suppress-near-zero-baseline-rise` | 82.1 | 63.3 | 73.3 | 72.7 |

**Bit-identical on all 88 cases**, including the seven `RE3:SockShop` `f4` cases it was aimed at — the second
independent measurement of this flag as a no-op, the first having been taken on a different corpus state
(`docs/re3-fault-ceiling.md`). Rejected, and recorded rather than dropped, for the reason every refused arm here
is recorded: a flag that *sounds* like the mechanism you diagnosed and changes nothing is evidence that the
diagnosis was read off the wrong field.

**What the refusal re-diagnosed.** The breakdown prints the *largest* contributing metric, not the one that decides
the ranking: dropping a label leaves the service's other metrics in place, and these winners carry a second one.
The field that actually separates them is `topoSource`:

| case | winner | `topoSource` winner | truth | `topoSource` truth | `dev` winner | `dev` truth |
| --- | --- | ---: | --- | ---: | ---: | ---: |
| `re3ss_carts_f4_1` | `rabbitmq-exporter` | 1.000 | `carts` | 0.437 | 1.519 | 0.290 |
| `re3ss_carts_f4_2` | `orders-db` | 1.000 | `carts` | 0.671 | 0.466 | 0.301 |
| `re3ss_carts_f4_3` | `rabbitmq-exporter` | 1.000 | `carts` | 0.682 | 1.360 | 0.301 |
| `re3ss_orders_f4_1` | `front-end` | 0.262 | `orders` | 0.474 | 0.615 | 0.505 |
| `re3ss_orders_f4_2` | `orders-db` | 1.000 | `orders` | 0.446 | 0.740 | 0.300 |

Four of five winners sit at `topoSource = 1.000` while the truth sits at 0.44–0.68, and the gap is larger than
the `dev` gap in every one of them. `topoSource = 1.000` means *nothing upstream of me deviates* — which a
**leaf** satisfies trivially, because it has nothing downstream in the call graph to be the source of, and its
metric families (`diskio` on a DB, exporter counters) are exactly the ones whose idle level is noise. The
`orders_f4_1` row is the counter-example that makes this a mechanism rather than a story: its winner is
`front-end`, the only winner here that is **not** a leaf, and it is the one row where `topoSource` favours the
truth.

So the next lever is not a baseline guard. It is the source credit: `topoSource` must not be obtainable by being
a sink, and the term that says "nothing upstream moved" has to be read against a parent set that can move. That
is a statement about the operator's domain, and it is falsifiable by the same table: an arm that gates the credit
on `≥ 1 anomalous parent exists` should move `RE3:SockShop` and leave `RE1` alone, and if it does not, the
mechanism is wrong and the row above will say so.

### 4.8 The lever §4.7 named could not have worked, and the artifact said so on its second line

§4.7 is **wrong in its conclusion and right in its observation**, and the error is worth more than the finding.

The observation stands: on the five `RE3:SockShop` `f4` cases the winner's decisive metric is a near-zero-baseline
channel, and the truth's is a genuine rise. The conclusion — "the field that separates them is `topoSource`" —
cannot be true, because **`topoSource` has weight zero in the configuration that produced the table**. Line 6 of
the same artifact reads:

```
signals: stabilityWeight=0.007352 collisionWeight=0 topoWeight=0 topoDiscount=1 ... temporalWeight=0 ...
```

`finalScore(v) += topoWeight × topoSource(v)`, so at `topoWeight = 0` the term is not small, it is **absent**. A
quantity that enters no score cannot separate two candidates, and a table of its values is a table of a mechanism
this run did not use. The observation was read off a printed field; the field was never connected to the order
above it.

**Both halves were then measured.** If the mechanism were the missing discriminator and merely "starved" at zero,
turning it on should help the cell it explains. It does the opposite, and the dose makes it monotone:

| arm (`RE3`, `--trace-weight 1` held) | OB | SS | TT | 88 cases |
| --- | ---: | ---: | ---: | ---: |
| `topoWeight = 0` (shipped) | 82.1 | **63.3** | 73.3 | 64 = 72.7 % |
| `topoWeight = 0.1` | 82.1 | 60.0 | 73.3 | 63 = 71.6 % |
| `topoWeight = 0.3` | 82.1 | 46.7 | 73.3 | 59 = 67.0 % |

Two facts, and the second is the one to keep:

1. **The additive source credit is refused at both weights**, with a monotone loss on exactly the cell it was
   proposed to fix — 63.3 → 60.0 → 46.7 — and no movement on the other two. Whatever decides `RE3:SockShop`, it is
   not that this term is switched off.
2. **The loss lands only where the trace signal is absent.** OB and TT are byte-identical at all three weights
   while SS falls by 16.6 pp. SockShop carries no `traces.csv` (`docs/ablation-input-census.md` §9.1), so its
   ranking is the metric-and-log score alone — which is where an additive bonus of `[0, 1] × weight` on a scale
   the other cells do not share reorders a leader it was never calibrated against. The term is not "inert and
   then starved"; it is **uncalibrated on the one cell that has nothing else**, which is the additive form's
   documented defect (`pruner.ts`, `topoWeight`: "at `topoWeight = 0.1` its term is 3 % of one cell's score scale
   and six rank steps of another's") measured a second time from the other direction.

So §4.7's proposed arm — parent-gating the credit — is **withdrawn before it was run**. Gating a term that is
multiplied by zero changes zero. What the two arms above establish is narrower and harder: on a cell with no
transport channel, the ordering has no source/symptom term it can use, and the first attempt to give it one made
things worse by an amount proportional to the weight.

**The instrument defect this exposed is fixed in the same commit.** The failure block now prints, once per cell,
which of its six per-case comparisons cannot move the ranking, and marks each such line `[INERT: weight 0]`
(`benchmarks/src/signal-evidence.ts`). On the published configuration that is **four of the six** — `onset`,
`injectDelay`, `ratioContrib`, `topoSource` — and on a dispatch without the RE3 trace pin it is five, because
`traceWeight` also ships at zero. Half of what a reader has been reading as causal evidence in these artifacts
describes mechanisms the run did not use, and until this commit nothing on the line said so. A number printed
without the weight that reads it is not evidence, which is `docs/accuracy-aggregation.md` §8's rule one surface
over: **a quantity cannot assert its own unit, and a signal cannot assert its own weight.**
