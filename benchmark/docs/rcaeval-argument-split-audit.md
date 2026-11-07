# The RCAEval runner's engine arguments, and the four fields the first one never read

**One object doing two jobs.** `TreePruner` takes TWO arguments:

```ts
constructor(
  options?: Partial<TreePrunerOptions>,
  topologyConfig?: Partial<TopologyFaultGraphConfig>,
)
```

The RCAEval runner handed the first argument a **sixteen**-field object, of which **four are not
`TreePrunerOptions` members at all** — `collapseDiscount`, `rankNormalization`, `suppressIdleTransients`
and `suppressNearZeroBaselineRise` are declared on `TopologyFaultGraphConfig`, the type of the SECOND
argument. And it then restated those same four in a hand-written literal at the call site:

```ts
      // The first argument IS the engine's option object, so every field on it —
      // `temporalWeight` and `onsetShape` included — reaches the pruner without a
      // second restatement here. The second argument is the topology config.
      new TreePruner(weights, {
        collapseDiscount: weights.collapseDiscount,
        rankNormalization: weights.rankNormalization,
        suppressIdleTransients: weights.suppressIdleTransients,
        suppressNearZeroBaselineRise: weights.suppressNearZeroBaselineRise,
      }),
```

The comment is true about `temporalWeight` and `onsetShape` and false about the four below them, which is
the interesting part: the sentence that says "without a second restatement here" sits **immediately above
the second restatement**.

## 1. The four copies were inert, and that is provable rather than assumed

- `TreePrunerOptions` (23 own members, plus the four it inherits from `RCAEngineOptions`) declares none of
  the four — read from the engine's own source, not from memory.
- The constructor spreads the first argument into `this.options`
  (`{ ...DEFAULT_TREE_PRUNER_OPTIONS, ...options }`), and every read of `this.options` in the class names a
  field it does declare.
- The fault graph is built from `...this.topologyConfig` **alone**:

```ts
    const faultGraph = buildTopologyFaultGraph(callGraph, metrics, {
      ...this.topologyConfig,
      injectTimeMs,
    });
```

So the four values rode through the first argument and were never read there. Nothing was miscomputed — the
second literal carried them correctly — and **that is the finding**: the object the engine's option type
describes was carrying four fields the type does not have, and nothing in the repository could see it.

## 2. The hazard the duplication created

A hand-written second literal is a **second owner** of the same four values. Delete one line from it and
that switch silently reverts to the engine's default, the run completes, the artifact reports a confident
confusion matrix, and no test fails — because until this iteration the second argument was covered by
nothing at all. The first argument *was* covered (the previous iteration's line join), and the two
assertions in the guard that looked like coverage of the wiring were in fact **shape pins**:

```ts
expect(source).toMatch(/createContainer\(\{[\s\S]{0,240}?stabilityWeight:\s*opts\.stabilityWeight/);
expect(source).toMatch(/function createContainer\(weights:\s*\{[\s\S]{0,240}?stabilityWeight:\s*number/);
```

They matched the literal's text, so they passed on the defect and would fail on any repair. (The previous
iteration had already replaced two of these for the same reason; these are the remaining two, and the
repair moved them as well.)

## 3. Why the FSE'26 half does not have this

`buildFse26EngineOptions` has returned the two arguments as two objects from the day it was extracted
(`Fse26EngineOptions.signals` and `.topology`), with `NON_ENGINE_OPTION_KEYS` and a completeness test. The
RCAEval half kept its hand-written literal because it was never extracted — the same asymmetry the previous
iteration's audit records for the configuration line, one level down. This iteration closes it.

## 4. The repair

- `RCAEvalSignalOptions` is now the **twelve** `TreePrunerOptions` fields; `RCAEvalTopologyOptions` is the four
  `TopologyFaultGraphConfig` fields; `buildRCAEvalEngineOptions` returns `{ signals, topology }`.
- `run-rcaeval.ts` calls `createContainer(buildRCAEvalEngineOptions(opts))` and the container does
  `new TreePruner(engine.signals, engine.topology)` — one call, no spread, no literal.
- The configuration LINE keeps naming the run's whole configuration, now as the **union** of the two
  objects, and its field order is unchanged **on purpose**: the artifact must not move, because nothing about
  the run moved.

## 5. The fence

Extending `benchmarks/__tests__/rcaeval-reported-config.test.ts`, so that one file owns the runner's reported
configuration end to end. Two of the three new assertions parse the ENGINE'S OWN source:

| assertion | derived from | what it rejects |
| --- | --- | --- |
| every `signals` key is a `TreePrunerOptions` member | `pruner.ts` + the `RCAEngineOptions` it inherits from | a field that is inert in the first argument — **the defect above** |
| every `topology` key is a `TopologyFaultGraphConfig` member | `topology-fault-graph.ts` | a second argument used as a dumping ground |
| the two key sets are disjoint and each is populated | the two objects themselves | a field whose OWNER is ambiguous, which is exactly the state that was repaired |

`interfaceMembers` follows the `extends` clause rather than ignoring it, because `TreePrunerOptions`
inherits four fields (`pruneEpsilon`, `criticalLoadThreshold`, `defaultTopK`, `maxPropagationDepth`) and a
reader that stopped at the derived interface would report those four as foreign. The base's members are read
from `packages/core/src/types/faults.ts`, and the membership lists are ASSERTED to be non-empty, so a parse
that silently broke cannot make the guard vacuous.

And the line is pinned to the artifact: an assertion renders the shipped line and compares it, byte for byte,
with the line `rcaeval-re1-results` of run `37402660140` carries. That is the control that makes the split
*checkable* rather than argued — an artifact line that moved by one byte would be evidence that something
other than the wiring changed — and it fails deliberately if a SHIPPED WEIGHT ever moves without the
artifact being re-read, because the published numbers are read through that line.

## 6. Reach, and what it does not cover

- The assertion is about MEMBERSHIP, not about values: it proves the four fields are the engine's topology
  fields, not that the values reaching the engine are the intended ones. Values are covered by the
  constant-naming assertions beside it, and by the golden readback.
- The interface parse is line-based over two declared shapes. It follows ONE level of `extends`; a deeper
  chain would need the walk generalised, and the guard would fail loudly (empty member list) rather than
  pass quietly, which is why the floors are asserted.
- `--lat-weight`, `--lat-min-rise` and `--pool-penalty` are **still not parsed** on this runner, so the
  both-runners dispatch intersection remains the six axes the register records. This iteration changes the
  shape of the arguments, not the surface of the dispatch.
