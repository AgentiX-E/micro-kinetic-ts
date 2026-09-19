# FSE'26 — Converter Integrity Verdict (P1e)

> The Parquet → JSON bridge decides every published RCABench number. Unit-testing
> it — rather than reading it — turned up three data-integrity defects, of which
> one was already documented (`docs/fse26-metric-source-attribution.md`). The
> same audit then caught two more *outside* the bridge, in the pipeline that
> ships its output. This doc covers the four new ones, the CI gates that now
> enforce them, and what has been verified about the published shards (§6 was
> still mid-verification when this was written; the state is stated there).

## 0. Summary

| # | Defect | Signature | Effect | Fixed in |
|---|---|---|---|---|
| 1 | Label fan-out interleaved into one series | `[1, 4, 1, 4, …]`; 2304 samples for 48 timestamps | fabricated ~2× relative deviation on every emitter | `969b19a` |
| 2 | Truncated in-flight datapack converted | `ok=2 failed=0` with a case missing its abnormal window | silently deficient benchmark case | `2600a0b` |
| 3 | Non-deterministic conversion | 5 calls on identical input → 2 orderings | cache shards not reproducible | `2600a0b` |
| 4 | CI consumed a superseded release | `releases/latest` → `rcabench-full-v2`, whose assets predate `969b19a`, while the rebuild sat on `rcabench-full` | a dispatched run would have published the pre-fix score as the post-fix one | `6a15947` |
| 5 | Manifest carried no provenance | no revision, no digest, no per-shard hash | a stale cache was byte-indistinguishable from a current one | `6a15947` |

Defect 1 was worth **+60 cases (+4.22pp)** on the full 1422 once fixed
(268 → 328, 18.85% → 23.07%). Defects 2–5 do not move the score; they protect
correctness, reproducibility, and the trustworthiness of a score once published.

## 1. Defect 2 — the truncated datapack was converted, not discarded

`stream_convert_tar` walks the archive in one sequential pass, converting each
datapack when the walk moves on to the next. The datapack *in flight* when the
stream ends early was converted too — from whatever members had been extracted.

`build_case` treats every telemetry source as optional by design (a missing
file contributes nothing, so the bridge survives the archive's per-datapack
schema differences). A truncated datapack therefore converted successfully into
a valid-looking `case.json` missing its whole abnormal window — and its traces
and logs — while still counting as a success:

```
$ stream_convert_tar(<archive cut 1 MiB from the end>, out)
ok=2 failed=0
PRODUCED ts5-ts-order-service-network-svfvxk: metrics=2 logs=2 edges=1
PRODUCED ts5-ts-order-service-stress-svfvxk: metrics=1 logs=0 edges=0
                                    ^ reference: metrics=2 logs=2 edges=1
```

The module docstring already promised *"the final, incomplete datapack is
discarded"*; the code did not, so a short download injected deficient cases into
the cache and depressed the published benchmark with no signal that anything was
wrong. A sweep across truncation points found deficient cases admitted as
successes at 70%, 96% and 98% of the archive length.

**Fix.** The walk records that the stream was truncated (both the `tar.next()`
and the `tar.extract()` exit paths) and discards the datapack in flight, logging
`DISCARD <name> (archive truncated mid-datapack)`. It is discarded, not counted
as a failure, because truncation is a *designed* mode (prefix downloads) — but a
truncated datapack must never become a case. Datapacks completed before the
truncation point were already finalised on the way and are untouched.

## 2. Defect 3 — the conversion was not reproducible

`build_case` returned a different document for the same input on every call:
a service's metric series swapped order between runs, and so did the edge list.

```
$ for _ in range(5): build_case(<same datapack>)
run0 ts-order-service: container.memory.usage, container.cpu.usage, http.server.request.duration
run2 ts-order-service: container.cpu.usage, container.memory.usage, http.server.request.duration
```

Root cause: polars' `group_by(..., maintain_order=False)` and `unique()` keep no
stable order — they return hash-table order, which varies between calls. Several
readers relied on that order, and two other sorts were not total orders
(`sort("window")`, `sort("time")`).

Consequences: the cache shards are not byte-reproducible, so a rebuild can differ
from the previous one with no code change, and any content-level cache check
would report spurious changes.

**Fix.** `maintain_order=True` over explicitly sorted frames in `read_metrics`,
`read_metrics_histogram` and `read_trace_derived_metrics`; a total order for the
edge list (`.unique().sort([...])`) and for the logs (`sort([time, service, level,
message])`). Verified byte-identical across `PYTHONHASHSEED` 0/1/12345 and
`POLARS_MAX_THREADS` 1/8:

```
sha256(case.json) = 45726b67424f45d4   (all six combinations)
```

**Benchmark neutrality was measured, not assumed.** Re-running the 796-case HTTP
shard after the change reproduces the pre-change post-fix result exactly:

| | correct/796 | Top@1 |
|---|---|---|
| before the determinism change | 149 | 18.72% |
| after | 149 | 18.72% |

Identical on all 9 HTTP fault types. This is expected — the engine scores each
metric series independently and takes the max — but the ordering is
diagnostically visible in `--diagnose` (`dominantMetrics`), which is why it is
worth pinning.

## 3. Dead code removed

`read_metrics` and `read_metrics_histogram` carried `if series:` guards before
writing each service's list. A service group always contains at least one metric
group, so the false branch is unreachable and no test could ever cover it. The
guards were removed rather than left as permanently-uncoverable branches.

## 4. Coverage

`scripts/` was at **80%** statements with no CI enforcement at all — the
converter and sharder unit tests were never run by any workflow, so even the
TDD tests added for the fan-out fix were unenforced.

| file | before | after |
|---|---|---|
| `fse26_convert.py` | 82% | 100% stmts / 100% branches |
| `fse26_convert_tar.py` | 76% | 100% / 100% |
| `fse26_shard.py` | 70% | 100% / 100% |
| **total** | **80%** | **100% / 100%** |

81 → 117 tests (`2600a0b`), then 166 tests once the provenance module landed
(`6a15947`). New tests cover the truncation discard, deterministic conversion,
the optional-source gates (which schema variation each source tolerates), the
batch CLI (`--limit`/`--include`/`--force`/skip/failure exit codes), the
streaming CLI, the shard CLI, the `__main__` guards, and the whole provenance
surface.

`.github/workflows/ci.yml` gains a `converter-tests` job (`89c0c22`) running
`coverage run --branch` + `coverage report --fail-under=95`. It is deliberately
independent of the `lint → typecheck → test → integration` chain: it is pure
Python, needs no `pnpm install` or build, and finishes in about a second, so it
can always report instead of being skipped behind an unrelated failure.
Verified green on `89c0c22`.

Dependencies split in two (`6a15947`). `requirements-fse26.txt` holds the
runtime pin (polars) and is part of the provenance digest, because polars reads
and writes the Parquet and a version bump can therefore move the numbers.
`requirements-fse26-dev.txt` holds the test-only tooling (coverage) and is
deliberately *not* hashed: a gate that fires when a test runner is bumped would
be trained away within a week.

## 5. Published shards carry the fixes

The `rcabench-data` cache was rebuilt (`34563132915`, assets re-uploaded
06:40–06:41 UTC) from a fresh clone, so it picked up the fan-out fix. Verified
on the rebuilt 73-case JVM shard (199,489 series):

```
cases=73 series=199489 series_with_duplicate_timestamps=19
```

19 of 199,489 series (0.0095%) carry a single duplicate timestamp — the
normal/abnormal window boundary, which the roll-up scopes per source file and
deliberately does not merge. Every high-volume metric now has at most **97**
samples (one per scrape); before the fix `k8s.container.cpu_request` had **2304
samples for 48 timestamps**. The tell-tale sawtooth is gone.

## 6. Defects 4 and 5 — the pipeline shipped the right bytes to the wrong place

The four defects above are all *inside* the bridge. Auditing how its output
reaches the benchmark found two more outside it, and one of them had already
fired: a full CI run was dispatched against shards built **before** the fan-out
fix, and would have reported 18.85% as the post-fix number.

### 6.1 The floating pointer

`fse26-benchmark.yml` downloaded from

```
https://github.com/AgentiX-E/rcabench-data/releases/latest/download/manifest.json
```

`latest` is not "most recently uploaded" — GitHub resolves it to the release
with the greatest `published_at`, which is set at **creation**. The cache build
re-uploads with `gh release upload --clobber`, which never refreshes it. So the
sequence

```
09-10 04:11Z  rcabench-full      created
09-10 16:16Z  rcabench-full-v2   created   (assets frozen here, pre-fix)
09-11 04:09Z  969b19a            fan-out fix committed
09-11 06:40Z  rcabench-full      assets re-uploaded --clobber
```

left `latest` pointing at `rcabench-full-v2`, the only release whose assets
predate the fix. The tell is unmistakable once you look for it: the stale set has
3/3/2/2 downloads (the dispatched run) while the fixed set has none, and every
stale shard is uniformly larger, since the roll-up drops rows.

| shard | `rcabench-full-v2` (stale) | `rcabench-full` (fixed) |
|---|---|---|
| JVM | 168,737,714 | 161,044,382 |
| HTTP | 1,695,473,994 | 1,599,388,330 |
| Network | 439,473,045 | 411,978,370 |

**Fix.** The workflow takes an explicit `shard_tag` input (default
`rcabench-full`) and never consults `latest`. Pinning alone is not enough — a tag
is a mutable pointer too — so the run also verifies what it downloaded.

### 6.2 The cache could not describe itself

The manifest listed only `totalCases` and per-shard `bytes`. Nothing said which
converter produced it, and since the bridge is never re-run at consume time,
a cache from any revision is byte-indistinguishable from a current one. That is
the defect underneath 6.1: the wrong release was not merely reachable, it was
*undetectable*.

**Fix.** `scripts/fse26_provenance.py` hashes everything that decides the
converted bytes — the three converter modules plus the runtime dependency pin —
and `fse26_shard.py` stamps `schemaVersion`, `builtAt`, `converterRevision` and
`converterDigest` into the manifest, with `bytes` + `sha256` per shard. Before
running, the benchmark recomputes the digest from its own checkout and checks
every downloaded asset against the manifest. A manifest with no digest **fails**
rather than passing vacuously: an unknown cache is not a trusted cache.

The gate was verified in both directions.

Negative — against the stale `rcabench-full` tag (run `34586303472`, only the
2-case `Time` shard, so it costs seconds):

```
ERROR: manifest schemaVersion=None, expected 2
ERROR: manifest has no converterDigest (predates provenance): the cache's converter revision is unknown
ERROR: Time: manifest entry has no sha256
```

Every downstream step reports `skipped`; no number is published.

Positive — **pending**. The tag the gate should accept does not exist yet: the
rebuild that stamps provenance (run `34586313254`) is still downloading the
13.4 GB archive, so `rcabench-full` still carries the provenance-free manifest
written before `fse26_shard.py` learned to emit one. The gate therefore cannot
pass against *any* published tag today, which is the property under test — and
the reason the negative run above is a real verification rather than a
formality. Once the upload completes, the digest will match, the shards will
verify, and the manifest will be copied into the run artifact so each published
figure is traceable to the exact cache it came from.

## 7. Coverage of the loaders themselves

`packages/kinetic/vitest.config.ts` excluded **all** of
`src/benchmarks/loaders/**` from coverage with the justification "tested via
integration/benchmark pipelines, not unit tests". Measured, that was false for
every file it covered: `fse26-loader.ts` was already at 100% from 37 unit tests
and `rcaeval-loader.ts` at 86.9% from 91, so the exclusion was hiding live code
behind a claim about a pipeline that never touches it. `aiops2025-loader.ts` and
`rca100-loader.ts` are what made the shape of the omission visible: 6%
statements over ~1000 lines of real parsing logic, excluded for having no tests
rather than for being untestable — both take a case directory, so both are
testable from synthetic fixtures.

Retired in two steps. `rcaeval-loader.ts` first (`8f24762`), then the two
dataset loaders (`b5e3186`, 141 tests). The exclusion is now one file:

| file | status |
|---|---|
| `types.ts` | every export is an `interface`/`type` — no runtime code, so it cannot contribute a covered statement |

The 141 tests cover every optional source in both directions (present and
absent), the camelCase and snake_case aliases each benchmark actually ships, the
`metrics.json` / `metrics/` precedence — and the fact that the two loaders
resolve it in *opposite* orders — the RCA100 four-layer ground truth, the
topology-derived call graph and its chain fallback, and the `catch` blocks that
turn a path which exists but cannot be read into a benign default.

Writing them found a real defect, of the same family as the fan-out bug in §1: a
value derived from the wrong input. Both loaders built the fallback span id from
the raw camelCase fields while resolving the span's own `traceId` and `service`
from the aliases first:

```ts
traceId: String(span.traceId ?? span.trace_id ?? 'unknown'),
spanId: String(span.spanId ?? span.span_id ?? `${span.traceId}_${span.service}`),
```

A snake_case span (`trace_id` + `serviceId`, which is what the OTel-derived
exports contain) therefore resolved its `traceId` to `t1` but its `spanId` to
`undefined_<service>`. Every unnamed span in a case collides onto one id, so the
parent/child topology rebuilt from `parentSpanId` is destroyed — the same class
of silent corruption as the interleaved series, and equally invisible without
reading the parser. `undefined_undefined` event and alert ids came from the same
pattern. The fix resolves the identity fields once and derives from those, which
is what `rcaeval-loader.ts` already did.

`rca100-loader.ts` additionally iterated `Object.keys(topology)` and guarded the
lookup with `?? []`; iterating entries makes the downstream list provably
present and deletes a fallback no input can reach.

| dimension | kinetic package | `aiops2025-loader.ts` | `rca100-loader.ts` |
|---|---|---|---|
| statements | 99.17% | 100% | 100% |
| branches | 97.74% | 100% | 100% |
| functions | 100% | 100% | 100% |

811 unit tests, 9 integration tests, and `lint`/`format:check`/`typecheck`/
`build` green (the build forced with `--skip-nx-cache`, since Nx otherwise
reports a cached result).

`benchmark-runner.ts` then became the weakest file in the package, at 93.5%
statements / 86.6% branches — and it turned out to be a coverage illusion rather
than a defect. `createMockEngine` always answers `service_1`, the synthetic
generator keys metrics by `SERVICE_NAMES`, so `enrichPrediction` returned at its
`!serviceMetrics` guard on every run; the five tests that claimed to cover the
classifier asserted only that type accuracy stayed within `[0, 1]`, which holds
whether or not the classifier is ever consulted. Cases whose metric map contains
the predicted service make the claim checkable: the classifier overrides the
engine's CPU answer to MEM and type accuracy moves **0 → 1** (`f8a9a884`).

| dimension | kinetic package | `benchmark-runner.ts` |
|---|---|---|
| statements | 100% | 100% |
| branches | 99.46% | 100% |
| functions | 100% | 100% |

`__tests__/**` is the gap that remains, and it is larger than it looks: it is
excluded from every `tsconfig.json`, so CI transpiles the tests but never
type-checks them. A probe carrying the workspace path mappings and
`types: ["node", "vitest/globals"]` reports **178 errors across 67 of the test
files** — 72 `TS2345` (argument types), 37 `TS18046` (possibly-undefined: the
`noUncheckedIndexedAccess` discipline the source follows and the tests do not),
16 `TS7006` (implicit `any`), 9 `TS2532`, 9 `TS2322`, 6 `TS2739`, plus 3 `TS2834`
(relative imports missing the `.js` extension, which resolves under Vitest's
bundler resolution but not under `nodenext`). The two test files added in
`b5e3186` type-check clean, and the 457 lines added to `benchmark-runner.test.ts`
in `f8a9a884` contribute none of that file's 30 errors — that is the standard the
other 67 files need to reach before a `typecheck-tests` job can be wired in.
