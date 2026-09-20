# Coverage-gate audit — which thresholds are enforced, and what the unenforced ones hid

Every `packages/*/vitest.config.ts` asks for **95% on statements, branches, functions and lines**.
A threshold is only a gate if something runs it. This document records what the gate actually
covered, what it did not, and the four defects that were sitting behind the difference.

## 1. The measurement

All 13 testable packages, each run with its own config (`vitest run --coverage` in the package
directory) on 2026-09-16, against `8a51173`.

| package | stmts | branch | funcs | lines | in CI matrix (before) | gate |
| --- | --- | --- | --- | --- | --- | --- |
| ai | 100 | 100 | 100 | 100 | **no** | pass |
| causal | 100 | 100 | 100 | 100 | **no** | pass |
| core | 99.88 | 96.61 | 100 | 99.88 | yes | pass |
| cutting | 98.43 | 95.17 | 100 | 98.43 | yes | pass |
| kinetic | 100 | 99.42 | 100 | 100 | yes | pass |
| noise | 100 | 100 | 100 | 100 | yes | pass |
| optimize | 100 | 100 | 100 | 100 | **no** | pass |
| scaling | 100 | 95.49 | 100 | 100 | yes | pass |
| **storage-browser** | **92.23** | **80.64** | 100 | **92.23** | **no** | **FAIL** |
| **storage-fs** | **89.79** | **85.71** | 100 | **89.79** | **no** | **FAIL** |
| **storage-remote** | **87.95** | **83.87** | 100 | **87.95** | **no** | **FAIL** |
| tree | 100 | 100 | 100 | 100 | yes | pass |
| wave | 99.61 | 95.00 | 100 | 99.61 | yes | pass |

Two independent facts in one table. **Six packages were absent from the CI matrix**
(`ai`, `causal`, `optimize`, `storage-fs`, `storage-browser`, `storage-remote`), and **three of the
six were below the threshold they had configured for themselves**. No job had ever read those
numbers. Ten packages met the gate; the three that did not were exactly the three nothing measured.

The `test` matrix in `.github/workflows/ci.yml` now lists all thirteen. `benchmarks/` keeps its own
job because the matrix assumes `packages/<name>/coverage/`; `integration-tests` has no coverage
config.

## 2. What the unenforced gate was hiding

### DEF-1 — the optimizer's model store wrote to, and deleted from, the developer's real store

`packages/optimize/__tests__/unit/persistence.test.ts` round-tripped `saveModel` / `loadModel`
against the **library default** store, because those two functions constructed it internally and
accepted no store:

```ts
export async function saveModel(records): Promise<PersistedModel> {
  const store = new ModelStore();     // -> new FileSystemStore() -> ~/.micro-kinetic/store
```

The test then cleaned up by **deleting from that store**:

```ts
const defaultStore = new FileSystemStore();
await defaultStore.delete('optimizer-latest');
await defaultStore.delete('optimizer-v1');
```

So the two convenience wrappers were untestable without touching the real user's home directory,
and the only test that reached them destroyed a trained model on any machine that had one. On this
machine the write never even completed, and the test failed with
`EPERM ... rename .../optimizer-latest.json.<uuid>.tmp -> .../optimizer-latest.json`.

**Evidence, `~/.micro-kinetic/store` on 2026-09-16:**

```
total entries: 79
tmp orphans:   79
real .json:     0
```

Seventy-nine orphaned temp files, no keys, and a green suite. (Two of the 79 were added by running
the failing test twice during this audit: the leak is per failed write.)

**Fix.** `saveModel(records, store?)` and `loadModel(store?)` take an optional `IKeyValueStore`, so
the round trip is reachable through an injected store. The default path is still measured, because
the default store became relocatable — see DEF-2 — so the test sets `MICRO_KINETIC_STORE_DIR` to a
temporary directory and asserts the model landed **inside it**. If the wrappers ever go back to
constructing their own store, that assertion fails.

### DEF-2 — the default store directory was frozen at module load

```ts
const DEFAULT_BASE_DIR = resolve(homedir(), '.micro-kinetic', 'store');   // module scope
```

A value read at import time belongs to whichever module imported first. Nothing afterwards can
point the store elsewhere — not a test, not a process that sets an environment variable before
running. `FileSystemStore` now resolves the directory **per construction**, in precedence order:

1. the `baseDir` option,
2. `MICRO_KINETIC_STORE_DIR`,
3. `~/.micro-kinetic/store`.

An empty string counts as unset in both places; the one thing it must not mean is the current
working directory, which would scatter store files into whatever repository the process ran in.

### DEF-3 — a failed atomic write leaked its temp file

`set()` wrote a temp file and renamed it, with neither half guarded. When the rename failed — for
any reason — the temp file stayed forever: nothing would rename it, and `keys()` filters to `.json`
and so would never list it. This is what produced the 79 files above, and it is why the leak was
invisible: the store's own view of its contents was clean.

```ts
try {
  await writeFile(tmpPath, json, 'utf-8');
  await rename(tmpPath, filePath);
} catch (err) {
  await rm(tmpPath, { force: true });   // covers both halves, one statement, no branch
  throw err;
}
```

The failure is reproducible without mocking anything: a directory occupying the path the key's file
must take makes `rename(file, dir)` fail with **EISDIR** on every platform Node supports.

### DEF-4 — the atomic-write test could not see the thing it claimed to check

The test guarding DEF-3 read:

```ts
it('should write atomically — no partial file on crash', async () => {
  await store.set('atomic', 'value');
  // Verify only .json files exist (no .tmp files)
  const files = await store.keys();        // keys() filters to .json: blind to .tmp by construction
  expect(files).toHaveLength(1);
```

The comment asserts a property the measurement cannot observe. It was green throughout, while 79
temp files accumulated in the one directory it was pointed at. The test now lists the **directory**,
and the failure case asserts the same directory is unchanged after a rejected write.

Two more tests in the family had the same shape and were rewritten:

- `should handle read-only directory gracefully` had `try { ... } catch {}` around both the action
  and its assertions, so neither outcome could fail it. It now asserts the contract that holds
  either way — a readable value, and no temp file — so it can fail.
- `should retry on 503 with exponential backoff` (storage-remote) never caused a 503: it wrote the
  key first, and the echo server only returns 503 for a key that has **not** been written. The
  store's whole 5xx path (`remote-store.ts` L67–70) had never executed.

### DEF-5 — two dead branches, one of them load-bearing

```ts
// set()
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });     // never taken
// clear()
try { await rm(this.baseDir, { recursive: true, force: true }); }
catch (err) { if (code !== 'ENOENT') throw err; }              // condition always true
```

`keyToPath` runs the key through `encodeURIComponent`, so a `/` in a key becomes `%2F`: every key
is exactly one path segment, its parent is always the base directory, and `ensureDir()` has already
created it. The parent-directory step is unreachable — confirmed twice, by that argument and by
`0` statement coverage, which is also why the accompanying comment ("nested keys like ns/sub/key")
and the test named `should handle nested key paths` were both describing a mechanic that does not
exist.

`rm(..., { force: true })` already swallows `ENOENT`, so `clear`'s guard is always true and the
catch is a plain rethrow — identical to no catch at all. Both branches are deleted, not covered.
The nested-key test now asserts the real behaviour: three hyphen-separated keys become three files
named `ns%2Fsub%2Fk1.json`, and `keys()` decodes them back.

### DEF-6 — `keys()` reported a directory as a key

`readdir(baseDir, { recursive: true })` returns names, and the filter was `.endsWith('.json')`. A
directory called `impostor.json` was therefore returned as the key `impostor` — a name `get` then
refuses to read. `withFileTypes: true` plus `isFile()` fixes it, and the case is now a test.

### DEF-7 — one test ran the built core against the source store

`storage-remote`'s store imports `StoreConnectionError` from `@agentix-e/micro-kinetic-core`, which
resolved to the package's build output, while its test file imported `defineStoreTests` from
`../core/src/...`. Two module instances, two distinct classes with one name: `instanceof` fails
against a correct implementation. The package now aliases core to source, as `optimize` already
did. **Without this, the new failure-handling assertions could not be written at all.**

## 3. Error paths that are now measured

`storage-fs` distinguishes "the key is missing" from "the store is broken", and only `ENOENT` means
absent. All five rethrow paths were unexecuted; each now has a real trigger, no mocks:

| method | trigger | observed |
| --- | --- | --- |
| `get` | directory at the key's path | EISDIR |
| `has` | directory at the key's path | EISDIR |
| `delete` | non-empty directory at the key's path | EPERM (macOS) / EISDIR (Linux) |
| `keys` | a file where the base directory belongs | ENOTDIR |
| `set` | directory at the key's path | EISDIR, and the temp file is removed |

`storage-browser` degrades in three ways a real browser can produce, all now covered: reading
`localStorage` throws (blocked by policy), the property is absent, and `setItem` rejects because
the quota is full (an implementation of the `Storage` contract with a real byte limit, not a stub).
In all three the in-memory tier still serves the value.

`storage-remote`'s failure handling runs against a **real HTTP server** that answers 500 to every
read and 403 to every removal: the retry budget is exhausted with the status preserved, a refused
connection is reported as a connection failure, and refused `delete` / `clear` throw.

## 4. Result

| package | before | after | tests |
| --- | --- | --- | --- |
| storage-fs | 89.79 / 85.71 / 100 / 89.79 | **100 / 100 / 100 / 100** | 17 → 28 |
| storage-browser | 92.23 / 80.64 / 100 / 92.23 | **100 / 100 / 100 / 100** | 17 → 22 |
| storage-remote | 87.95 / 83.87 / 100 / 87.95 | **100 / 100 / 100 / 100** | 17 → 21 |
| optimize | 100 / 100 / 100 / 100 | 100 / 100 / 100 / 100 | 199 → 200 |

Each storage backend's 17 is the same 17: 12 shared contract assertions
(`packages/core/src/storage/abstract-store-test.ts`) plus 5 backend-specific ones.

Repository-wide suite: **124 files, 3132 tests, 0 failures** (was 3111 tests, 1 failing — the 21
new tests are 11 + 5 + 4 in the storage backends and 1 in the optimizer's persistence file).

**Hermeticity, proved by fingerprint rather than by argument.** `~/.micro-kinetic/store` before and
after a full suite run — same file list, same `md5 d6c2dd3b6b7ea01c477106c44804c9d1`, 79 entries
both times. No test writes to `$HOME` any more.

## 5. Open — measured, not fixed

- **No retry backoff in `RemoteStore`.** The module header claimed exponential backoff; the loop
  retries immediately. The header now states what the code does. Implementing a delay is a
  behaviour change for every consumer, and it needs its own measurement (a server that rate-limits),
  so it is not bundled here.
- **`.changeset/config.json` sets `baseBranch: "main"`.** The repository's only branches are
  `master` and `gh-pages`, and `master` is the default. The mismatch has never bitten because the
  publish step is skipped — measured on run `35062526943`: step 8, *Create Release Pull Request or
  Publish* → **skipped** (`NPM_TOKEN` unset). It will bite the moment the token appears. Fixed here
  to `master`; the `linked` group still lists only the seven original packages, which is a release
  policy choice and is left alone.
- **`storage-browser`'s large-value tier is per-instance memory.** `largeStore` is a `Map` on the
  instance, and the header says "or IndexedDB in real browsers". A value above the 5KB threshold
  therefore does not survive a new `BrowserStore()`, while the header reads as though it would. Not
  fixed: what the backend promises has to change, and no other module in this repository imports
  `BrowserStore` yet, so nothing here depends on either answer.

## 6. The same shape in the lint gate

`pnpm lint` scanned `packages/*/src/`, `packages/*/__tests__/` and `integration-tests/src/` — not
`benchmarks/`, which is typechecked and coverage-gated but had never been linted. Adding it was safe
(oxlint exits 0 on warnings) but noisy: 512 `no-console` warnings, from a harness whose job is to
print its reports. An `overrides` block turns `no-console` off for `benchmarks/**` only, and once the
scope is real it pays for itself immediately — **four findings, none of them a console statement**:

| finding | location | resolution |
| --- | --- | --- |
| `computeAccuracy` declared and never called, plus the `RunResult` import that existed only to type it | `benchmarks/src/optimize-all.ts` | both deleted |
| `fromAlias` destructured and never read | `benchmarks/src/rcaeval-semantic.ts` | iterate `yamlEdgeMap.values()` |
| `new Array(dimension).fill(0.5)` — the single-argument form is ambiguous by construction | `benchmarks/__tests__/semantic-config.test.ts` | `Array.from({ length: dimension }, () => 0.5)` |
| `2 * 2 + 2 * 0` — a term that always collapses to nothing | `benchmarks/__tests__/fse26-diagnose-analyze.test.ts` | `2 * 2`, with the zero case stated in prose |

The enrolment rule is the one §1 applies to the coverage matrix: a tree that is typechecked and
measured but never *linted* is a tree whose dead code is invisible, and the gap does not have to be a
red job to be real.

## 7. The root command was not the gate: a merged workspace run loses the populations AND the thresholds

§1 measured the gate by running **each package in its own directory**, which is what `nx test <package>
-- --coverage` and the CI matrix do. The repository also had a root script — `pnpm coverage`, which the
project's own notes called *"the root coverage gate"* — and it was `vitest run --coverage`: **ONE
workspace run**. Measured on 2026-09-20, that is not a gate at all.

**The population is the whole repository, and the per-project `include`/`exclude` are not carried into
the merged report.** The merged JSON held **191 files**: all `packages/*/src/**`, `benchmarks/src/**`,
`scripts/**`, built output (`packages/ai/dist/index.cjs`, `packages/kinetic/dist/trace-validator-*.js`),
`packages/kinetic/bin/cli.js`, and even files a package explicitly EXCLUDES
(`packages/core/src/types/graph.ts`, `packages/core/src/interfaces/**`). Its `All files` row read
**58.08% over 27,432 statements**, of which **10,896 were uncovered and 40% of the denominator came from
three places the root run does not test** — `benchmarks/src/**` (8,551, whose tests are a separate CI
job), a built `packages/ai/dist/**` (1,292) and `scripts/**` (1,053). The tree under test reads **96.35%**.

**The thresholds were dropped too, and that is the part that matters.** The SAME project through the
workspace and through its own directory:

| how it ran | files in the report | `All files` | exit |
|---|---|---|---|
| `--project @agentix-e/micro-kinetic-ai` from the root (workspace) | **191** | `54.47 / 92.14 / 75.55 / 54.47` | **0** |
| `vitest run --coverage` in `packages/ai` (what `nx test` does) | **6** | `100 / 100 / 100 / 100` | 0 |

`packages/ai/vitest.config.ts` asks for 95% on all four dimensions; the workspace run printed 54.47% and
exited 0. To separate "the numbers are wrong" from "the gate is not reading them", the same run was
repeated with an impossible bar supplied on the command line:

```
vitest run --project @agentix-e/micro-kinetic-ai --coverage --coverage.thresholds.statements=100 …
ERROR: Coverage for statements (54.47%) does not meet global threshold (100%)   → exit 1
```

So a threshold supplied from outside IS enforced — **against the merged, repo-wide percentage** — while
every project's CONFIGURED threshold is silently absent from that mode. The command that the notes
called a gate enforced nothing, and printed a number that was the coverage of nothing in particular.

**A second site, the same shape.** `integration-tests/vitest.config.ts` carried a `coverage` block with
a `provider` and a reporter and **neither an `include` nor a `thresholds`**. Its population resolved to
nothing — `src/` holds one file, `pipeline.spec.ts`, and specs are excluded by default — so it printed

```
All files |       0 |        0 |        0 |        0 |
```

over **zero files**, exit 0. A table that reads as a measurement and enforces nothing; it is now gone,
with the reason written into the config: this suite measures the PACKAGES (each of which carries its own
population and bar), its own gate is that it RUNS, and the root command excludes it by name.

### The fix: one command, the gates it claims

| | |
|---|---|
| `pnpm coverage` | `nx run-many --target=test --all --exclude=@agentix-e/micro-kinetic-integration-tests --parallel=1 --skip-nx-cache -- --coverage` |
| why `nx run-many --target=test` | it is the command CI gates each package with, so a local run and the gate cannot disagree |
| why `--skip-nx-cache` | `nx.json`'s cacheable `test` target takes its `inputs` from `{projectRoot}/src/**` and `{projectRoot}/__tests__/**`, which do NOT include a `vitest.config.ts` — a threshold raised from 95 to 100 would leave the hash unchanged and a cached run would replay the old numbers as if they had been measured on this tree |
| why `--parallel=1` | one project at a time: the tables print in a fixed order instead of interleaving, and a memory-tight machine never has two vitest processes alive at once |
| why the exclusion | `integration-tests` carries no bar, so there is nothing to run — and the exclusion list is checked against the configs in both directions, below |

### The fence

`packages/kinetic/__tests__/unit/coverage-population.test.ts` makes the population a rule rather than a
habit, with a population DERIVED from the filesystem (`packages/*` by readdir, plus `benchmarks/` and
`integration-tests/`) so a new package enters it by existing:

- a config that declares coverage MUST declare `include` (non-empty) and `thresholds` on all four
  dimensions at **≥ 95**;
- the root coverage script MUST be the per-project target and MUST NOT be a merged `vitest run`, because
  that is the mode that loses the populations and the thresholds;
- the script's `--exclude` list must equal, **in both directions**, the set of projects with no bar — a
  one-sided check would let either half drift alone;
- `pnpm test`, `pnpm test:integration` and `pnpm test:all` must not grow a `--coverage`, so no second
  command can claim to be the gate.

Eight mutations, **8/8 as declared**, including a NO-OP CONTROL that survived and seven rows that remove
a mechanism (the merged script, the cache skip, the exclusion, a second gate, an empty coverage block, a
95 → 90 threshold, a dropped `include`).

### Acceptance: every dimension of every project, measured

`pnpm coverage` on this change, exit 0, `NX Successfully ran target test for 14 projects`:

| project | stmts | branch | funcs | lines | project | stmts | branch | funcs | lines |
|---|---|---|---|---|---|---|---|---|---|
| core | 99.88 | 96.61 | 100 | 99.88 | storage-fs | 100 | 100 | 100 | 100 |
| tree | 100 | 100 | 100 | 100 | storage-browser | 100 | 100 | 100 | 100 |
| cutting | 98.43 | 95.17 | 100 | 98.43 | storage-remote | 100 | 100 | 100 | 100 |
| noise | 100 | 100 | 100 | 100 | optimize | 100 | 100 | 100 | 100 |
| wave | 99.61 | 95.00 | 100 | 99.61 | causal | 100 | 100 | 100 | 100 |
| scaling | 100 | 95.49 | 100 | 100 | kinetic | 100 | 99.44 | 100 | 100 |
| ai | 100 | 100 | 100 | 100 | benchmarks | 99.84 | 97.46 | 100 | 99.84 |

**14 projects, 56 dimensions, the worst of them 95.00%** — the same numbers CI gates, now produced by
the command the record tells a reader to run. The merged 58.08% headline no longer exists.

**What deliberately did NOT change**: the CI matrix (already per package, §1), every package's own
config, and `pnpm test` — the workspace run that executes the whole suite (127 files, 3198 tests) and
carries no coverage claim. The workspace file also still exists, with vitest's own deprecation notice
(`test.projects` in a root config is where it is heading); migrating it is a separate change with its
own measurement, and it is not needed to make the coverage numbers honest.
