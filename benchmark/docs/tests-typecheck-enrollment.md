# The test suites, and the tool configs, were the last TypeScript no compiler read

> Status: **closed.** `pnpm typecheck` now compiles `packages/*/__tests__`,
> `packages/*/*.ts` and `integration-tests/*.ts` in addition to the 15 nx
> projects. Enrolling the suites reported **178 errors across 29 files**; four
> of them were production defects and most of the rest were tests asserting
> contracts that do not exist.

## Why the hole existed, and why it could not be closed in place

Each package's `tsconfig.json` is a **build** config: it includes `src/**` and
`rootDir: ./src`, because `tsup` emits `dist` from it. A test file there would
be a `TS6059` error, not merely unwanted output. So "add `__tests__` to the
package tsconfig" is not available, and the only honest option is a separate
`noEmit` project over exactly the files the build projects must exclude.

Three sets of files were in that situation:

| set | files | what a defect here costs |
|---|---|---|
| `packages/*/__tests__/**` | 121 | the assertion is the only check on the contract it names |
| `packages/*/*.ts` (`vitest.config.ts`, `tsup.config.ts`) | 25 | a typo'd option is a configuration defect with **no execution path**: every line can be covered while the tooling does something else |
| `integration-tests/*.ts` | 1 | same as the above |

## Production defects (fixed at the owner)

| # | defect | consequence |
|---|---|---|
| 1 | `TopologyFusionResult.graph` was declared `ServiceCallGraph`, which erases `FusedEdge` — but every edge in it carries `providerId`, `fusedConfidence` and `provenance`, ring-connect edges included | consumers needing the enrichment had to cast, and a cast is how a renamed field goes unnoticed while the assertion reading it keeps passing on `undefined`. Now `FusedServiceCallGraph`, still assignable to `ServiceCallGraph` |
| 2 | `TopologyFusionConfig` declared `ringConnectUnmatched` / `ringConnectType` / `minEdgeConfidence` **required**, while the constructor spreads `DEFAULT_TOPOLOGY_FUSION_CONFIG` over them and their own doc comments say "default: true / REST / 0" | the type contradicted the code it documents; `new TopologyFusion({ providers })` was a type error at 21 call sites. Optional now, resolved internally with `Required<>` |
| 3 | `HistoricalConfig` (optimize) declared `traceWeight` / `prismWeight` **required**, while core's `RankingWeights` declares both OPTIONAL and documents them as "absent means 0 (disabled)" — and two other readers in the same package already did `?? 0` | a record describing a run with them disabled made the meta-learner fuse `w × undefined` = **NaN** straight into an `RCAConfiguration`, which seeds the optimizer's GP prior. Three tests written from the caller's side first were RED (the fused weight really was NaN) |
| 4 | `expectCloseTo` accepted the private class `CloseToPrimitive` while its own public factory `expectCloseTo.primitive()` returns the public `CloseToMatcher` interface | the factory's value could not be passed back to the function that produced it |

Nos. 2 and 3 are the **same bug family** as the `SemanticAlignmentProvider`
defect found one increment earlier: *a required parameter where every caller
holds only a partial object*. Three instances in two increments; the shape is
worth looking for deliberately (see the closing note).

## Test-side defects (each one a test that did not verify what it claimed)

| defect | why it mattered |
|---|---|
| `new SyntheticBenchmarkGenerator({ seed: 42 })` at four sites, while the constructor is `(seed?: number)` (six other sites in the same file pass `42`) | an object makes `Random`'s `this.seed * 1664525` NaN and `NaN & 0x7fffffff` zero, so the seed was **silently ignored**: all four generators ran the same sequence, including the `{ seed: 33 }` one that existed to differ |
| `rca-pipeline.test.ts`: `makeCallGraph()` returned `{ nodes: Map<id, {serviceId, dependencies}>, edges: [{from, to, weight}] }` and `makeMetrics()` did not return a `MetricMap` | neither is a `ServiceCallGraph`/`MetricMap` — different fields entirely. The suite passed because the container is mocked |
| `static-topology.test.ts` imported `'../../src/providers/static-topology'` without `.js` | unresolvable under NodeNext; the symbol became an error type and cascaded ten implicit-`any` errors. Only the bundler's lenient resolution kept the suite running |
| 37 × `container.resolve(DI_TOKENS.X)` with no type argument | returned `unknown`, so the call was unchecked. Naming the owning interface turns it into a conformance assertion |
| `persistence.test.ts` used `IKeyValueStore` without importing it | the test named "should work with any IKeyValueStore (injectable)" never checked the interface. It does now, and the stub satisfies it |
| `time-series.test.ts` built `CuttingQualityMetrics` with `totalWindows` / `adaptiveRefinements` | neither is declared, and no production code sets either |
| `causal-direction.test.ts` built a context with trace spans and then passed a **fresh empty** one | measured: the empty context yields `acceptedTier 'none'`, `edgesResolved 1`, `coverage 0.5`; the built one yields `'trace' / 1 / 1`. Both satisfied the thresholds, so the suite was green either way — only the built context exercises the trace tier. The stale comment described a third scenario neither form produces; it now records the measurement and marks the scenario as needing re-derivation |
| `decimal-provider.test.ts` asserted `toBeCloseTo(Math.pow(1.0000000000000001, 10), 14)` | `1.0000000000000001` is exactly `1` in float64, so the comparison is one that `1` satisfies — a test named "50-digit precision" that could not observe precision. It now checks the decimal string, where the 16th significant digit is the first float64 cannot hold |
| dead fixtures/helpers: `UNKNOWN_SPAN_SERVICES`, `makeTiming`, `makeNodeScore`, `prevSpanId` (written, never read), `trueOptimum` (the scoring closure restated its values inline, so the two copies could drift) | each was an unused declaration; `trueOptimum` is now the single source for the "known optimum" the test scores against |
| `tree-rca.test.ts` assigned to `readonly CallEdge.p99Latency`; `correlation-decay.test.ts` pushed onto a `readonly` array; `weight-calibrator.test.ts` read a private field; `sota-leaderboard.test.ts`'s filter did not narrow the element type | four more places where the test worked around the type instead of using the contract |

## The gate

- **`tsconfig.workspace.json`** (repo root, `noEmit`) includes the three sets
  above. Separate from the per-package configs so `dist` keeps containing only
  `src`.
- **`pnpm typecheck`** = `nx run-many --target=typecheck --all && tsc -p
  tsconfig.workspace.json`, with `typecheck:src` / `typecheck:workspace` for the
  halves. One entry point, so CI's `typecheck` job and the pre-push hook both
  pick it up with **no workflow edit**.
- **`format:check` and `lint`** were extended to `packages/*/__tests__` in the
  same pass, because a gate that type-checks a tree but never formats or lints it
  is how that tree drifted in the first place: 66 test files were unformatted and
  oxlint reported 17 warnings, of which several were the dead code above.
- The pre-push hook's hand-rolled **"benchmark script typecheck" was removed**.
  It ran `tsc` per file and grepped six error codes in the target file only, so
  it ignored transitive dependencies and every other error class — a gate that
  could not fail for most real errors. `benchmarks/tsconfig.json` type-checks
  that tree as a real project now (it is one of the 15).

## Verification

| check | result |
|---|---|
| `tsc -p tsconfig.workspace.json` | **178 errors / 29 files → 0** |
| `pnpm typecheck` | exit 0 — nx: 15 projects, plus the workspace project |
| every package suite | green (ai 113, causal 176, core 412, cutting 170, kinetic 830, noise 152, scaling 161, tree 541, wave 144) |
| lint | 0 warnings / 0 errors over **280 files** (was 159) |
| format:check | green, now covering the suites |
| `as any` / `@ts-ignore` / `@ts-expect-error` under `packages/*/__tests__` | unchanged (28 / 0 / 0) — nothing was silenced |

One failure persists and is **not** from this work: `optimize`'s
`persistence.test.ts` "should round-trip through the default FileSystemStore"
hits `EPERM` renaming into `~/.micro-kinetic/store`. Re-verified by stashing the
tree and running the file at `HEAD` — same single failure. Note that CI's test
matrix covers only `core, tree, cutting, noise, scaling, wave, kinetic`, so CI
green says nothing about `optimize`; the sandbox is what makes it visible at all.

## Closing note: the family to look for

Three of the four production defects are one shape — **a type that requires more
than its own implementation or its own callers provide**:

- `SemanticAlignmentConfig` required 5 fields; the constructor merged defaults and
  every caller passed 2 → three mechanisms silently dead (previous increment).
- `TopologyFusionConfig` required 3 fields; the constructor merged defaults.
- `HistoricalConfig` required `traceWeight`/`prismWeight`; core declares them
  optional and two readers in the same package already treated them as such.

The tell is a `{ ...DEFAULT_X, ...config }` spread (or a `?? 0`) next to a
parameter declared with the *resolved* type. Grep for that pair before trusting
any config-handling code: 25 more such spreads exist in this repo and each one is
a place where "the caller always passes everything" is an assumption, not a
checked fact.
