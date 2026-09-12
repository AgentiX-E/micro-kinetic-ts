# `benchmarks/` — type-check audit

> Status: **closed.** `benchmarks/` is now type-checked in CI. It was the only
> workspace package with no `tsconfig.json`, so nothing under
> `benchmarks/src/**` had ever been compiled — including
> `src/run-fse26.ts` and `src/run-rcaeval.ts`, which produce every number this
> project has published.

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

## Verification

| check | before | after |
|---|---|---|
| `tsc -p benchmarks/tsconfig.json` | 44 errors / 9 files | **0** |
| `nx run-many --target=typecheck --all` | 14 projects | **15 projects** |
| `packages/ai` unit tests | 22 (in this suite) | **26**, coverage 100 / 100 / 100 / 100 |
| `packages/ai` package total | 110 | **113** |
| deleted | — | `benchmarks/src/diag-rca.ts` (13 errors, unreachable) |

## Not yet done (deliberately)

1. **`benchmarks/__tests__` still does not run in CI.** The package has a
   `vitest.config.ts` with coverage thresholds and 6 test files, but no `test`
   script, so `nx run-many --target=test --all` and the CI matrix (a fixed list of
   seven packages) both skip it. Wiring it needs the integration suites separated
   from the unit ones first: `__tests__/integration/*` call the real Zhipu API and
   are only skipped when `ZHIPU_API_KEY` is absent.
2. **Two runners, two semantic policies.** `run-rcaeval.ts` builds a TF-IDF
   provider when no key is present; `run-ablation.ts` leaves semantics off. The
   44-error audit made the difference visible but did not change it, because it
   changes the call graph and therefore every ablation cell.
3. **`run-rcaeval.ts` mutates `RCAEvalCase.traces` to release memory.** The field
   is now non-readonly with a documented reason. Whether that release is even
   effective (the converted `BenchmarkCase` may retain the same array) has not
   been measured.
