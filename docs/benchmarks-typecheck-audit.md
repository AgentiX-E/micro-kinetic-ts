# `benchmarks/` — type-check and coverage audit

> Status: **closed.** `benchmarks/` is now type-checked *and* test-gated in CI.
> It was the only workspace package with no `tsconfig.json`, so nothing under
> `benchmarks/src/**` had ever been compiled — including `src/run-fse26.ts` and
> `src/run-rcaeval.ts`, which produce every number this project has published.
> Its test suite, it turned out, had never been run either, and could not have
> passed its own coverage floor if it had.

## Why this mattered

A package that is never type-checked is not "probably fine". It is a place where
imports can point at modules that do not exist, identifiers can be out of scope,
and a value can sit outside the union its own field declares — all without a
single failing signal, because no job ever looks. The first run of
`tsc -p benchmarks/tsconfig.json` reported **44 errors across 9 files**.

The errors were not cosmetic. Three of them were the visible face of defects that
had been silently shaping the ablation evidence.

## Method

Mirror what `integration-tests/` does (see commit `2fcfc02`):

| piece | file |
|---|---|
| compiler project | `benchmarks/tsconfig.json` (`src/**` **and** `__tests__/**`) |
| nx target | `"typecheck": "tsc --noEmit"` in `benchmarks/package.json` |

`pnpm typecheck` is `nx run-many --target=typecheck --all`, so the target alone
enrols the package: the gate went from 14 to **15 projects**, and the test tree is
included because test files were exactly where the last batch of drift hid.

## Findings

| # | File | Defect | Fix |
|---|---|---|---|
| 1 | `src/diag-rca.ts` | An RCAEval per-case diagnostic script that **could never run**: it imports `@micro-kinetic/di` and `./loaders/rcaeval-loader.js`, neither of which exists in this workspace, calls a DI token (`RCA_ENGINE_DEFAULT`) that has never existed, and reads `predictions`, a variable out of scope in the function that uses it. Nothing referenced it. | Deleted. The maintained runner (`run-fse26.ts --diagnose`) already provides per-case signal dumps. |
| 2 | `src/rcaeval-topology.ts` | Ring-connect edges were tagged `type: 'INTERNAL'`, a value **outside `EdgeType`** (`'REST' \| 'gRPC' \| 'MQ' \| 'CALLBACK' \| 'ASYNC'`), and `isRingConnectEdge` identified them by that marker. The provenance vocabulary the type system already declares — `SemanticCallEdge.source: 'exact-yaml' \| 'semantic-embedding' \| 'semantic-llm' \| 'ring-connect'` — was never adopted. | Synthetic edges now carry `type: 'REST'` (matching the engine's own ring-connect in `causal/providers/static-topology.ts`) plus `source: 'ring-connect'`; `isRingConnectEdge` / `isEdgeFromSource` read provenance via the shared `edgeProvenance()` helper. |
| 3 | `src/rcaeval-topology.ts` | The builder annotated nodes by writing `node.labels = …` on `ServiceNode.labels`, which is readonly. It worked only because the flag had never been checked. | Local `AnnotatableNode` (mutable `labels`) + `BenchmarkCallGraph` types describe what the module owns before hand-over; the public functions still return `ServiceCallGraph`. |
| 4 | `ai: SemanticAlignmentProvider` | The constructor required a **complete** `SemanticAlignmentConfig` while every in-repo caller passed a partial one. At runtime `dailyCostCapUSD`, `cacheTtlMs` and `fallbackStrategy` were `undefined`, so `withinBudget()` computed `0 < undefined` — **false** — and the LLM fallback was refused outright, its 24h cache never hit, best-effort acceptance never applied, and `alignByLLM` broke out of its loop after the first span. | Constructor takes `Partial<SemanticAlignmentConfig>` and merges over `DEFAULT_SEMANTIC_ALIGNMENT_CONFIG`. Five new tests in `packages/ai/__tests__/unit/semantic-alignment.test.ts` pin the defaults from the caller's side (4 red before the fix). |
| 5 | `__tests__/semantic-config.test.ts` | The suite held a **hand-maintained copy** of `run-rcaeval.ts`'s `createSemanticConfig()`, so it could only prove the copy agreed with itself — and it had already drifted (it asserted an `llmProvider: null` field the real factory no longer returns). | The factory moved to `benchmarks/src/semantic-config.ts`; the test imports the real one. |
| 6 | `src/run-ablation.ts` | Two of three branches logged `Semantic: TF-IDF …` while leaving the embedding provider **unset**, i.e. semantic enhancement off. An ablation report could therefore describe a configuration it never ran. | Log lines now state what happens; behaviour is unchanged. The divergence from `run-rcaeval` (which *does* build TF-IDF) is documented in place as a behavioural change that needs its own ablation. |
| 7 | `ai: IEmbeddingProvider` | `meta` was exposed by both built-in providers and declared by `EmbeddingProviderMeta`, but missing from the interface — so no consumer typed against the contract could read it. `embed`'s result was an inline object type nobody could name, and one test imported an `EmbeddingResult` that does not exist. | `EmbeddingResult` named and exported; `meta?: EmbeddingProviderMeta` added as an **optional** extension, because the interface is deliberately aligned with `@agentix-e/log-parser-core` and a required member would force every external provider to implement it. |
| 8 | `src/run-rcaeval.ts`, `src/run-ablation.ts`, `__tests__/*` | `null` used where the config type says `undefined`; `_diag_*` labels read from a `Record` without handling `string \| undefined`; tuple destructuring producing `string \| undefined`; nullable `createApiEmbeddingFromEnv` assigned to a non-null type. | Fixed at the source; the integration suites now throw a named error instead of silently disabling semantic enhancement and then asserting over an empty result set. |

## Round 2 — the coverage floor was a fiction too

Enrolling the package in `typecheck` did not make it *tested*. `npm test` was
still not wired into CI, and when the suite was finally run with `--coverage` it
**failed its own configured gate**: `functions 78.26%` against a floor of 80.
It could never have passed, which is consistent with it never having been run.

Raising the bar to the repository's 95% found more dead code, because the
uncovered remainder was not "hard to test" — it was unreachable:

| # | Site | Why it was unreachable | Fix |
|---|---|---|---|
| 9 | `initRCAEvalTopology` — `catch` around `collectServiceIds` + `provider.discover` | `collectServiceIds` wraps its whole body in its own `try/catch`, and `StaticTopologyProvider.discover` routes every I/O and parse error through `loadAll`, which catches them all. Neither call can throw. | Deleted, with the reasoning recorded in place (the same-shaped catch inside the provider had already been removed for the same reason). |
| 10 | `System → config file` map | Declared at module scope, referenced nowhere. | Deleted. |
| 11 | `identifyBenchmarkSystem` — `?? null` after the system-code lookup | The regex alternation captures exactly `ob \| ss \| tt`, and the record had all three keys, so the lookup could not miss. | The record is now keyed on the capture union, which makes the lookup total and removes both the `?? null` and a cast to `… \| undefined`. |
| 12 | Three `?? []` fallbacks on registry reads | The registry was a `Map<string, …>` written once for exactly the three systems, so a lookup could never miss. An empty topology is the wrong thing to hide a lookup bug behind. | The registry is keyed `Record<SystemName, …>`, so every read is total. |
| 13 | `enhanceRCAEvalCallGraph` — "keep this synthetic edge" branch | No test had a ring whose surviving edge touched neither endpoint of an aligned service. | Covered with a three-service ring, not deleted: unlike the others, this branch is genuinely reachable. |

Test changes that came with it:

- `benchmarks/__tests__/helpers/embedding-fixtures.ts` — the deterministic
  embedding provider and the match/partial-match builders moved here from
  `rcaeval-semantic.test.ts`, which had its own copy. The helper also gains a
  typed `TableLLMProvider`, replacing an `as any` stub.
- `benchmarks/__tests__/rcaeval-topology-init.test.ts` — new. The registry
  freezes on first init, so each scenario takes its own module instance through
  `vi.resetModules()` + dynamic import rather than reaching into the module with
  a test-only reset hook. Covers the uninitialized → initialized transition, a
  missing config directory, a config path that is a *file* (the directory scan
  throws), a directory whose files belong to no system, `.yml` acceptance, and
  both ring-connect branches.
- `benchmarks/__tests__/rcaeval-topology-semantic.test.ts` — new. Initializes
  *with* an embedding provider, which is the only way to reach the semantic
  branch of `enhanceRCAEvalCallGraph`: the early return, the
  statistics-only path, the ring-connect replacement, the dangling-neighbour
  filter (of `ts-order-service`'s fifteen YAML edges, exactly two survive for
  this case), and a case whose system cannot be identified.
- `rcaeval-semantic.test.ts` — gains the LLM-fallback path (a 0.55-similarity
  embedding match below a 0.9 threshold), which is what makes `isLLMResolved`
  true and tags edges `semantic-llm`; plus direct tests for `edgeProvenance`.
  That LLM test also re-tests the `Partial<SemanticAlignmentConfig>` merge from
  the previous commit from a layer above it: without the merge the daily cost
  cap is `undefined` and the fallback is refused, so the test cannot pass.

**`__tests__/integration/**` is now excluded from the default run**, in its own
`vitest.integration.config.ts` reachable through `test:integration`. It calls the
real Zhipu embedding API; a gate cannot depend on a network service, a
credential, or a quota. The suite had been running against a live endpoint on
every local test invocation whenever a gitignored `.env` was present.

## Verification

| check | result |
|---|---|
| `tsc -p benchmarks/tsconfig.json` | 44 errors / 9 files → **0** |
| `nx run-many --target=typecheck --all` | 14 → **15 projects**, exit 0 |
| `nx run-many --target=test --all` | every package green (ai 113/113, kinetic 830/830, tree 541/541, core 412/412); the one failure is the pre-existing sandbox-only EPERM in `optimize`'s `FileSystemStore` round-trip, reproduced on a clean HEAD |
| `nx test @agentix-e/micro-kinetic-benchmarks -- --coverage` | **89 tests / 6 files**, coverage **100 / 100 / 100 / 100** against 95% thresholds; CI job `benchmark-tests` |
| `benchmarks` coverage, before | topology 76.13 / 76 / 71.42 / 76.13, semantic 97.95 / 86.95 / 88.88 / 97.95 — **gate already failing** |
| `packages/ai` semantic-alignment suite | **26 tests**, 5 new, **4 of them red before the fix** |
| `packages/ai` coverage | 100 / 100 / 100 / 100 |
| lint | 0 warnings / 0 errors |
| format:check | green, now covering `benchmarks/*.ts` and `benchmarks/**` |
| deleted | `benchmarks/src/diag-rca.ts` (13 of the 44 errors, unreachable), plus five unreachable branches |

## Not yet done (deliberately)

1. **Two runners, two semantic policies.** `run-rcaeval.ts` builds a TF-IDF
   provider when no key is present; `run-ablation.ts` leaves semantics off. The
   44-error audit made the difference visible but did not change it, because it
   changes the call graph and therefore every ablation cell.
2. **`run-rcaeval.ts` mutates `RCAEvalCase.traces` to release memory.** The field
   is now non-readonly with a documented reason. Whether that release is even
   effective (the converted `BenchmarkCase` may retain the same array) has not
   been measured.
3. **The rest of `benchmarks/src` has no coverage.** Eleven CLI entry points call
   `main()` at import time, so their argument parsing and reporting are
   untestable without restructuring them. Coverage is scoped to the two modules
   that decide the call graph, and the config says so.
4. **`oxlint` still does not cover `benchmarks/src`**, and `pnpm lint:eslint`
   points at a binary that is not installed.
