# FSE'26 — Converter Integrity Verdict (P1e)

> The Parquet → JSON bridge decides every published RCABench number. Unit-testing
> it — rather than reading it — turned up three data-integrity defects, of which
> one was already documented (`docs/fse26-metric-source-attribution.md`). This doc
> covers the other two, the CI gate that now enforces all of them, and the
> verification that the published shards carry the fixes.

## 0. Summary

| # | Defect | Signature | Effect | Fixed in |
|---|---|---|---|---|
| 1 | Label fan-out interleaved into one series | `[1, 4, 1, 4, …]`; 2304 samples for 48 timestamps | fabricated ~2× relative deviation on every emitter | `969b19a` |
| 2 | Truncated in-flight datapack converted | `ok=2 failed=0` with a case missing its abnormal window | silently deficient benchmark case | `2600a0b` |
| 3 | Non-deterministic conversion | 5 calls on identical input → 2 orderings | cache shards not reproducible | `2600a0b` |

Defect 1 was worth **+60 cases (+4.22pp)** on the full 1422 once fixed
(268 → 328, 18.85% → 23.07%). Defects 2 and 3 do not move the score; they
protect correctness and reproducibility.

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

81 → 117 tests (`2600a0b`). New tests cover the truncation discard, deterministic
conversion, the optional-source gates (which schema variation each source
tolerates), the batch CLI (`--limit`/`--include`/`--force`/skip/failure exit
codes), the streaming CLI, the shard CLI, and the `__main__` guards.

`.github/workflows/ci.yml` gains a `converter-tests` job (`89c0c22`) running
`coverage run --branch` + `coverage report --fail-under=95`. It is deliberately
independent of the `lint → typecheck → test → integration` chain: it is pure
Python, needs no `pnpm install` or build, and finishes in about a second, so it
can always report instead of being skipped behind an unrelated failure.
Verified green on `89c0c22`. `scripts/requirements-fse26.txt` pins polars and
coverage — polars reads and writes the Parquet, so a version change can move the
benchmark numbers.

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

## 6. Idle follow-ups

- `packages/kinetic/vitest.config.ts` still excludes **all** of
  `src/benchmarks/loaders/**` from coverage with the justification "tested via
  integration/benchmark pipelines, not unit tests". Measured real coverage:
  `fse26-loader.ts` **100%** on every dimension (37 unit tests), `rcaeval-loader.ts`
  86.9% stmts / 85.1% branches (91 unit tests), `aiops2025-loader.ts` and
  `rca100-loader.ts` ~6% (their datasets need a CCF/Tianchi account and a license,
  so they are genuinely untestable in CI), `types.ts` 0% (type-only, no runtime
  code). Narrowing the exclusion to the three that justify it drops the package
  to 94.2% branches — below the 95% gate — so it needs `rcaeval-loader.ts` lifted
  to ≥95% first (72 statements, 34 branches, and the two uncovered functions
  `buildFallbackCallGraph` and `loadInjectTime`). That is the next increment.
