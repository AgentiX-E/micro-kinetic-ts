# How many places build the engine, and the configuration the weight search could not state

**A number nobody had counted.** Three consecutive iterations each found the same defect in a different
engine construction site — the FSE'26 runner's configuration line, the golden runner's joined two arguments,
the ablation runner's flags-to-weights mapping — and each was repaired by extracting the site's option
assembly into a module, for the reason all three share: a runner that calls `main()` at import time cannot be
imported, so neither its option assembly nor the line recording it can be called by a test.

The record then said there were **three** such sites. That was true of one CLASS of them — the three
benchmark runners that produce the register's artifacts — and it was written as if it were about construction
in general. Measured across every package's sources and the benchmark runners:

| kind | count | where |
| --- | --- | --- |
| `derived` — both arguments built by a module that also renders the line | **3** | `run-fse26.ts`, `run-rcaeval.ts`, `run-ablation.ts` |
| `shipped-defaults` — `new TreePruner()` with no arguments | **3** | `packages/kinetic/src/di/container.ts`, `run-all.ts`, `run-local-bench.ts` |
| `authored-literal` — a hand-written object at the call site | **1** | `packages/tree/src/di/factories.ts` |
| `mapped-config` — the arguments come from a function that maps a config object | **1** | `packages/optimize/src/integration.ts` |

**Eight sites, and the record said three.** `packages/kinetic/__tests__/unit/construction-site-census.test.ts`
now derives that population from the sources, classifies each site by the SHAPE of its arguments, and asserts
each kind as an exact set by path — so a ninth site, or a site that changes kind, fails there rather than
aging in prose. The three artifact-producing runners are additionally held to the derived shape by name,
because that is what the three extractions bought and it is a property rather than a diff.

The census strips comments before matching, and that is load-bearing rather than tidy: three of the matches a
raw read finds are `new TreePruner(` inside doc comments — including one in `optimize/integration.ts`
describing the equivalence `new TreePruner()` that its own code does not have. A census of syntax that counts
prose is a census of prose.

---

## 1. The site the census found that matters: the weight search

`packages/optimize/src/integration.ts` is the `mapped-config` site, and it is the one the register's
**weight-search artifact** is read from. Three findings, in the order they compound:

### (a) The mapping holds fifteen options at the engine's default and named none of them

`configToPrunerOptions` returns twelve fields. `TreePrunerOptions` declares twenty-seven. The other fifteen
were not absent from the run — they were INHERITED — and among them are the four terms that dominate the
shipped ranking: `latWeight = 0.561495`, `latMinRise = 10.3`, `poolMetricPenaltyWeight = 0.0679`,
`stabilityWeight = 0.007352`.

### (b) The artifact read seven of them and reported them as the configuration

```
baseline (default weights): train=79.3% val=81.5% test=75.0%
tuned weights: source=0.00 temporal=0.00 collision=0.00 topo=0.00 log=1.00 trace=0.00 prism=0.00
baseline test = 75.0% | tuned test = 75.0% | Δ = +0.0pp
```

`Δ = +0.0pp` is true and reads as *"the optimizer cannot improve on the default"*. The truth is narrower:
seven axes were searched, on a base that already had the four dominant terms ON, and the four were not in the
search space. With the space unstated, a reader supplies their own — and the wrong one.

### (c) The engine's second argument is never passed, so the base differs from the golden

`TreePruner(options, topologyConfig)` takes two arguments; `createEngineWithConfig` supplies one. The fault
graph is therefore built with its OWN defaults, where `rankNormalization` is **`false`** — while the golden
sets it **`true`**. `rankNormalization` is an axis this repository measured, closed, and keeps ON, so the
search and the published numbers are **different configurations in a term the register treats as shipped**,
and neither artifact said so.

`packages/optimize/src/integration.ts` also declares and exports a `TopologyFaultGraphConfig` of its own — a
**homonym** of the engine's type with a different shape (eight propagation fields against the engine's
sixteen), and `configToTopologyConfig` produces it. That function is called by **no production code**: the
only caller in the repository is its own test. So the second argument is not merely unset, it is unset beside
a function whose name and type suggest it sets it.

## 2. The repair, and what it deliberately does not change

- `HELD_AT_ENGINE_DEFAULT` — a `Record<field, reason>` naming all fifteen held options, so inheritance is
  stated rather than invisible. `UNPASSED_SECOND_ARGUMENT` records (c) beside the code that causes it.
- `formatEngineConfigLine(config)` — one line, owned by the mapping, naming what the search SETS, what is
  held at the engine's default, and the unpassed second argument. `run-optimize.ts` prints it for the
  baseline and for the tuned configuration, and prints the search space from `RANKING_AXES`, so the space
  and the configuration appear together.
- **No value changes.** `rankNormalization` stays at the engine's default for this path, because changing it
  would move the search's numbers and the register reads them. Aligning the base is a candidate change with
  its own acceptance; until then the artifact states the difference, which is the honest half of the fix and
  the half that was missing.

## 3. The fence

`packages/optimize/__tests__/unit/integration.test.ts` grows three assertions over derived sets:

| assertion | what it rejects |
| --- | --- |
| every mapped key is a `TreePrunerOptions` member, and `mapped ⊎ held === declared` | a mapping that drops a field silently, in either direction |
| every held field carries a reason, and the key set is exact | "held" becoming a synonym for "forgotten" |
| the engine is built with ONE argument, asserted in the source | the unpassed second argument going back to being invisible |
| the line names the set, the held, and the gap; and is a pure function of the config | a line that reads ambient state, or ignores its argument |
| `RANKING_AXES.length` is the space's own count and every axis is a mapped field | a search space and a mapping drifting apart |

`engineOptionMembers()` parses `TreePrunerOptions` from the engine's source and follows `extends` into the
core package. That reader is **local**, and the duplication is named rather than hidden: the benchmark guards
parse the same interface for their own forwarded sets, and the durable answer is a shared test module this
monorepo has no home for, because the boundary it would cross is a package one. The alternative — a hand
list of the engine's options inside the optimizer's test — is what the shipped-declaration census was written
to delete.

## 4. Reach, and what it does not cover

- `run-all.ts` and `run-local-bench.ts` build the engine with no arguments, which is the strongest form of
  "configured by the engine" and needs no line: the engine's own declaration IS the configuration. The census
  holds them to passing nothing, so a partial configuration cannot appear there without being classified.
- `packages/tree/src/di/factories.ts`'s literal sets five PRUNING fields and no ranking weights. It is a
  documented starting point rather than a measured artifact, so it is classified and left alone; the residue
  is that a reader of that factory cannot tell from its name which terms it leaves at the engine's value.
- The optimizer's `configToTopologyConfig` and its homonym type are RECORDED, not removed: the export is part
  of a published package's surface, and an unreachable function is a finding about its callers' reachability,
  which the census now asserts. Deleting it is a breaking change with its own decision.
