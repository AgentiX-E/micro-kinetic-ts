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
