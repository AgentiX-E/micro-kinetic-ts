# The golden artifact's configuration line, and the three weights it could not name

**One artifact, three missing fields.** The line every published RCAEval number is read from named
**thirteen** options and omitted `latWeight`, `latMinRise` and `poolMetricPenaltyWeight` — three of the
first fifteen entries of `REPORTED_CONFIG_FIELDS`, the list `fse26-report.ts` declares in code as the
fields a run artifact MUST carry to be attributable, and the three that dominate the shipped ranking.

> **`REPORTED_CONFIG_FIELDS`, in its own words:** *"Each of these can change the headline metric on its
> own, so an artifact that omits one cannot be compared with another artifact — the difference is
> unexplained."*

The FSE'26 half obeys that on its own line, and states the rule it obeys: a field may be omitted while
it holds its default **only because that default is ZERO**, which is why `latWeight` and
`poolMetricPenaltyWeight` are printed unconditionally there —

> *"The shipped latency weight is not zero, so an omitted-when-default field would print a
> byte-identical `Config:` line for the 694-case run and the 673-case ablation — which is the exact
> defect this line exists to prevent."*

— and the golden half did not. The values are not marginal: `latWeight=0.561495` with
`latMinRise=10.3` were measured as a PAIR worth **+56 cases across 10 fault types with none regressed**,
and the pool penalty worth **+6**. The artifact that carries the nine cells could not state the
configuration that produced them.

---

## 1. Why it survived: the line could not be called by anything

`formatSignalLine` lived inside `run-rcaeval.ts`, which ends with

```ts
main().catch((err) => { … });
```

so importing the module RUNS the benchmark. Nothing can import it, and therefore no test could call the
line, compare it with the options, or notice a field missing from one and present in the other.

**That is not a mistake this repository has to guess about — it already named it and already fixed it,
on the other half.** `fse26-engine-options.ts` opens by recording exactly this:

> *"This lived inside `run-fse26.ts`'s `main()`, which calls itself on import and therefore cannot be
> called from a test — so nothing could check that an option reached the engine. … a dispatch input that
> the workflow accepted and the runner dropped would run the CONTROL while the `Config:` line reported
> the ablation, and the run would 'prove' the ablation changes nothing."*

The same hole was closed on the FSE'26 side, and left open on the side that produces the golden. The
same audit that fixed it wrote the reason it matters, one file over, in
`benchmarks/vitest.config.ts`: *"What remains unmeasured is the runner entry points (`run-*.ts` …): they
execute at import time … That is a known gap, not a claim that they are trivial."* This iteration closes
the part of that gap that carries the artifact.

**And the omission is the second time this file's own neighbourhood has been the cause.** The
`REPORTED_CONFIG_FIELDS` doc records the first: two published runs carrying `{ logWeight, rankNormalization }`
and nothing else, which is what the field list was written for.

## 2. The repair is the precedent, not an invention

- `benchmarks/src/rcaeval-engine-options.ts` — new, exporting `buildRCAEvalEngineOptions` (the exact
  object the engine's constructor receives), `formatSignalLine` (the artifact's record of it),
  `NON_ENGINE_OPTION_KEYS` and `UNREPORTED_BY_RCAEVAL`.
- `benchmarks/src/rcaeval-cli.ts` — `CliOptions` gains `latWeight`, `latMinRise`, `poolMetricPenaltyWeight`,
  each defaulted from the engine's own constant (`DEFAULT_LAT_WEIGHT`, `DEFAULT_LAT_MIN_RISE`,
  `DEFAULT_POOL_METRIC_PENALTY_WEIGHT`) rather than restated.
- `benchmarks/src/run-rcaeval.ts` — the local copy is gone, the hand-written thirteen-key literal at the
  construction site is gone, and both call sites consume the module. The injection line no longer
  repeats `temporalWeight` and `onsetShape`: they are on the signals line, once, beside every other
  forwarded option, which is what makes the line and the object the same list written twice.

The rule the line now obeys is **stricter** than the FSE'26 one and stated in the module: every
forwarded option is named unconditionally. That rule is available here precisely because the omissions
the FSE'26 line allows are the ones whose defaults are zero, and none of the three was.

**No number moved, and that is checkable rather than asserted.** The three keys are now present with
the values the pruner was already filling from the same constants
(`DEFAULT_TREE_PRUNER_OPTIONS`: `latWeight: DEFAULT_LAT_WEIGHT`, `latMinRise: DEFAULT_LAT_MIN_RISE`,
`poolMetricPenaltyWeight: DEFAULT_POOL_METRIC_PENALTY_WEIGHT`), and the pruner reads all three directly
(`const latWeight = options.latWeight`, `const poolPenaltyWeight = options.poolMetricPenaltyWeight`) with
a value fallback rather than a presence branch for the floor. The engine therefore receives an object
that differs from the old one only by keys whose values equal its own defaults — so the nine cells are
expected to be **byte-identical**, and the expected artifact delta is confined to the header line.

## 3. The fence, and the owner it already had

`benchmarks/__tests__/rcaeval-reported-config.test.ts` — **not a new file.** A guard for the RCAEval
runner's reported configuration already existed under that name, written for the `temporalWeight` pin
defect, and it read the runner and the parser as TEXT. The findings below were first written as a
separate census and then **merged into it**, because two files holding one invariant is the defect this
repository keeps finding one level up ("a second copy is a second owner").

Merging it also required correcting the existing guard, and the correction is a finding of its own:
**its assertions pinned the runner's source SHAPE** —

```ts
expect(source).toMatch(/createContainer\(\{[\s\S]{0,240}?stabilityWeight:\s*opts\.stabilityWeight/);
expect(source).toMatch(/function createContainer\(weights:\s*\{[\s\S]{0,240}?stabilityWeight:\s*number/);
```

— a `file:shape` coordinate of exactly the kind `comparator-population-audit.md` records rotting: the
refactor that FIXED the omission moved the shape, and those two assertions failed for the change that
repaired them rather than for a regression. They are now statements about the PROPERTY the shape stood
for (the container takes the module's type; the runner has exactly one construction site; no object
literal returns to it), and the values they were approximating are asserted directly on the object the
engine receives.

Five joins over three DERIVED sets:

1. the **forwarded** set is `Object.keys(buildRCAEvalEngineOptions(opts).signals)`;
2. the **parsed** set is `Object.keys(parseRCAEvalArgs([]))`;
3. the **named** set is read off the rendered line by its `name=` tokens — so the check is about the
   artifact rather than about a list of names that ought to be on it.

| test | the join it holds | would fail if |
| --- | --- | --- |
| declares the three omitted terms as the engine constants | value identity per field, plus non-zero | a value were restated instead of named |
| names exactly the options it forwards | `named === forwarded`, both directions | the line omits a forwarded field, or invents one |
| names every reported field whose shipped value is non-zero | `named ∪ exempt === REPORTED_CONFIG_FIELDS`, disjoint | a reported field is neither printed nor exempted |
| classifies every parsed option as forwarded or non-engine | `forwarded ⊎ NON_ENGINE_OPTION_KEYS === parsed` | an option is parsed and then silently dropped |
| renders the line from the options alone | two calls equal; a flag changes its own field | the line read ambient state, or ignored its argument |

The **fourth** is the guard that would have caught this defect at any point in the last several
iterations: *parsed but dropped* and *parsed and deliberately not an engine option* are the same shape in
a set, and they are now a partition the suite requires to be exact, with a stated floor on both sides.

The **third** is the repository's own standard made executable. `UNREPORTED_BY_RCAEVAL` is a
`Record<field, reason>` — deliberately not a list, for the reason `OPERATIONAL_OPTIONS` is not one — and
its exact key set is asserted so a new exemption has to be added on purpose:

| exempt | why |
| --- | --- |
| `dropMetrics` | a load-time input ablation; this runner has no loader that can apply it |
| `metricRiseCeiling` | a topology-config option; the RCAEval construction site never passes it |
| `metricFleetBaseline` | a topology-config option; the RCAEval construction site never passes it |
| `failedEdgeWeight` | ships at 0 and is never forwarded, so the term is off for every RCAEval run |
| `failedEdgeMode` | meaningless without a weight to aggregate; ships at `sum`, not forwarded |
| `failedEdgeMinRecords` | meaningless without a weight to threshold; ships at 1, not forwarded |

## 4. Reach, and what it does not cover

- The fence reads the line as a STRING and the options as an OBJECT. It does not prove the *values* on
  the line are the values the engine used — that is what the constant-naming assertions and the golden
  readback are for, and it is why each forwarded field's default is asserted against its owner constant
  rather than against a literal.
- The module is enrolled in `benchmarks/vitest.config.ts`'s allow-list, which
  `__tests__/coverage-scope.test.ts` diffs against the modules the tests import in both directions — so
  the extraction cannot leave an unmeasured module behind, and the module cannot be listed without a
  test that imports it.
- `--lat-weight` / `--lat-min-rise` / `--pool-penalty` are **still not parsed** on this runner, so this
  change does NOT grow the dispatch surface and the both-runners intersection stays at the six axes the
  register records. The golden half can now *describe* those terms; it still cannot *ablate* them, which
  is a separate change and needs a candidate that wants it.
