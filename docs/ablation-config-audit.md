# The ablation artifact, and the configuration it could not state

**Twelve booleans, no weights.** `ablation-re1-results` — the register's ablation reference — opened with
`Data`, `Filter`, `Configs` and `Repetitions`, then printed, for each of its 22 configurations:

```
Running: BASELINE (all OFF)
Flags: {"collisionAggregation":false,"traceAugmentation":false,"selfLearning":false,"logSignal":false,…}
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
measurement of every feature. The extract-per-runner repair has now been applied three times, which is
itself the finding worth recording: **"a runner that runs itself on import" is a property of every runner in
this repository, and each one needed the same extraction.**

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
- The three pipeline flags (`traceAugmentation`, `selfLearning`, `collisionAggregation`) were verified to be
  READ by the runner — measured, because an ablation flag that nothing reads is a row that measures nothing:
  `traceAugmentation` at two sites, `selfLearning` at one, `collisionAggregation` reaching
  `enableCollisionAggregation`.
