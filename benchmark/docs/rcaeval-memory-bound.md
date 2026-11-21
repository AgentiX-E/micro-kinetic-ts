# The memory bound: why the 723-case grid could not finish, and the two defects that held it

**Status:** repaired. The full nine-cell grid now completes in one process — **11 m 07 s, peak RSS 1.28 GiB**,
cell-end live heap 26–59 MB on every cell — where before this iteration it died with
`FATAL ERROR: CALL_ALLOCATION_FAILED … JavaScript heap out of memory` inside `TrainTicket:RE2`. §9 has the
reproduction and §10 the numbers.

The corpus is 723 case directories, 10.0 GB of `logs.csv` alone. Everything below is measured on this host, not
estimated.

## 1. The first hypothesis was wrong, and provably so

The run OOM'd, so the obvious move was to raise the heap. It cannot work here, and the reason is not a matter of
taste:

| what                      | value                                                          |
| ------------------------- | -------------------------------------------------------------- |
| host physical memory      | 123 GB                                                         |
| host cores                | 32                                                             |
| **cgroup memory ceiling** | **8 GiB** (`/sys/fs/cgroup/memory.max = 8589934592`)           |
| cgroup kill evidence      | `memory.events` → `oom_kill 1`                                 |
| `--max-old-space-size=24576` | process OOM-killed, RSS peak 6.9 GB                         |

V8's heap limit is enforced inside a process the kernel will kill at 8 GiB. A flag that pushes the heap past
the cgroup does not buy memory; it converts a clean V8 abort into a kill by the kernel at an unpredictable
point. So the run has to fit in **8 GiB**, and the only lever is residency.

## 2. What one case costs

Measured on the corpus (`du -sm` per file, and a residency probe over the parsed structures):

| system / case                          | logs.csv | traces.csv | metrics.json | parsed residency |
| -------------------------------------- | -------: | ---------: | -----------: | ---------------: |
| `re2ss_carts_cpu_1`                    |   16 MB  | —          | 8 MB         |                   |
| `re2ob_checkoutservice_cpu_1`          |   11 MB  | 68 MB      | 8 MB         | **75.5 MB**      |
| `re2tt_ts-auth-service_mem_1`          |  181 MB  | 159 MB     | 38 MB        |                   |

The 75.5 MB figure is the case object graph after parsing — **171,322 log rows, 10,000 trace spans, 103,752
metric points** — i.e. ~440 bytes per log row once the message, the derived severity, the stack-trace and
logic-exception flags and the deepest exception class are attached.

And the corpus is not homogeneous, which decides the shape of the fix:

| system       | cases | mean corpus per case | largest |
| ------------ | ----: | -------------------: | ------: |
| SockShop     |    90 |                 23 MB |   31 MB |
| OnlineBoutique |  90 |                 80 MB |  106 MB |
| TrainTicket  |    90 |                245 MB |  401 MB |

## 3. A case-count chunk is not a bound

Chunking by case count was the first attempt, and it is `TrainTicket`'s answer that kills it: 16 cases at
245 MB mean is 3.9 GB of corpus before a single byte of the parsed graph. Measured, `tt:RE2 chunk=16` reached
**3.2 GB inside its second slice**.

So the unit of residency has two bounds, not one (`benchmarks/src/case-slicing.ts`):

```ts
export const SLICE_BYTE_BUDGET = 512 * 1024 * 1024;
sliceForMemory(metas, chunk, sizeOf) // at most `chunk` cases AND at most 512 MiB of corpus bytes
```

A single case larger than the budget gets a slice of its own — it is never dropped and never split, because a
case is the unit of load and of fold.

## 4. Why a slice is a legal unit at all

Because the cell's statistics are **statistics of per-case folds**, and no case's verdict reads another case's
telemetry. That is what makes "load a slice, fold it, release it" equal to "load everything, fold it" — provided
the fold is exact. Two folds carry the cell (`benchmarks/src/load-stats.ts`,
`packages/kinetic/src/benchmarks/runners/benchmark-runner.ts`):

| field class                 | fold law                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| counts (`cases`, `logRows`, `failedEdges`, …) | add                                                                                       |
| ratios (`logCaseShare`, `ac`, `avg5`, …)      | recomputed from the summed numerator and denominator — **never** averaged across slices    |
| `perFaultType.avg5`         | has no independent count, so the numerator is recovered as `avg5 × cases` before summing, then divided        |
| samples (`logSampleMsg`, `traceHeader`, …)    | the first NON-EMPTY slice wins, because "first in corpus order" is the property being preserved              |
| census (`latencyRoutes`, `anchors`, `logRoutes`) | the ROWS are concatenated and the owner's summariser runs once over all of them — not the summaries added |
| `failures` / `casePredictions` | concatenated in slice order, so the artifact's case order is the corpus's                                  |

`mergeLoadStats` and `mergeRunResults` are the only owners of those laws, and 26 unit tests pin them, including
the case that motivated the `avg5` clause: a naive weighted mean of two slices' averages is not the mean of the
union, and on a 90-case cell the difference was 0.4 pp.

## 5. The invariance, measured rather than argued

`ss:RE2` run twice, once with `--case-chunk 1` (90 slices, one case each) and once with `--case-chunk 16`
(6 slices):

| chunk | wall clock | output                                               |
| ----- | ---------: | ---------------------------------------------------- |
| 1     |    38.4 s  | baseline                                             |
| 16    |    34.6 s  | **identical line for line**, except the dump path name |

`diff` over the two full logs is two lines: the `diagnose dump:` line (different artifact path) and the exit
marker. Every cell figure, every per-case diagnostic block, every census line is byte-identical. That is the
claim "the chunk size is not an axis of the result" and it is now checkable, not assumed.

## 6. Releasing a reference is not collecting the memory

With slicing in place the cell-end heap still climbed monotonically — 73 → 106 → 176 → 634 → 2339 MB — by an
amount that depended on the cell's ORDINAL and not on its size. That is the signature of garbage that was never
collected, not of garbage that cannot be.

The loop said `globalThis.gc()` every ten cases. Without `--expose-gc`, `globalThis.gc` is `undefined`, so the
call did nothing, silently, and the log line that reported "collected" reported a call that never happened.
`benchmarks/src/collect-garbage.ts` acquires the collector the only way an unrelaunched process can
(`v8.setFlagsFromString('--expose_gc')` + `runInNewContext('gc')`), and a test proves it reclaims ≥16 MB rather
than asserting that a function was called.

That fixed the first three cells (cell-end 29/29/43 MB) and left `ss:RE2` at **1425 MB**.

## 7. The retainer: 1,395 MB of log text held by 22-character names

A heap snapshot taken at cell end — *after* the release and *after* the collection, so it can only hold what is
still reachable — attributed the surviving heap like this:

```
total self bytes: 1428.9 MB
--- by node type ---
string            1407.4 MB
```

and the largest nodes were 90 strings of 15–22 MB whose content begins `timestamp,container_name,message\n<ts>` —
one whole `logs.csv` per case, all 90 still alive.

The retainer chain of the largest one, walked over the snapshot's reverse edges:

```
GC roots → Stack roots → Array → Object --exceptionNames--> Array --[4]--> (sliced string) --parent--> 22.5 MB string
```

The cell keeps a handful of exception NAMES per case. Each name is `RegExp.exec(message)[0]` — a **V8
SlicedString** whose parent is the string the message was sliced out of. When the file is decoded whole
(`readFileSync(path, 'utf-8')`), that parent is the entire document, so one 22-character name pins 22 MB.

Measured on a 17 MB fixture, with one name kept and the case dropped:

| reader                                    | retained after collection |
| ----------------------------------------- | ------------------------: |
| whole-file decode, names sliced from it    |          **17.02 MB**     |
| per-cell decode (`csv-records.ts`)         |            **0.14 MB**    |

121×. On the real cell the same change took cell-end live heap from **1421 MB to 27 MB** and peak RSS from
**1808 MB to 454 MB** — with the accuracy of the cell unchanged at the time of that measurement (the fidelity
change of §8 is a separate, later step of the same repair).

## 8. The same reader was throwing away a quarter of every message

The retention fix required decoding the CSV per cell, which required reading it as CSV rather than as
`split(',')`. That exposed the second defect, and it is the larger one for the benchmark:

```
1705595459,front-end,"Posting Address: {""number"":""123"",""city"":""Paris""}"
```

`split(',')` cuts that message at the first comma **inside the quotes** and hands the tail to columns that do not
exist. No exception, no warning: `message` became `"Posting Address: {""number"":""123""`, the severity was
derived from a prefix, and the exception extractors ran on text the file's author never wrote.

Census over twelve sampled cases (`logs.csv` parsed twice, once each way):

| case                              | records  | rows the old reader produced | messages containing a comma |
| --------------------------------- | -------: | ---------------------------: | --------------------------: |
| `re2ss_carts_cpu_1`               |   86,592 |                       86,592 |                22,153 (25.6%) |
| `re2ss_orders_delay_3`            |   85,819 |                       85,819 |                21,913 (25.5%) |
| `re2ob_checkoutservice_disk_1`    |  171,176 |                      171,176 |                20,270 (11.8%) |
| `re2tt_ts-route-service_loss_2`   |  272,113 |                      272,113 |                85,455 (31.4%) |
| `re3ss_carts_f1_2`                |   85,307 |                   **91,197** |                25,634 (30.1%) |
| `re3ss_front-end_f3_1`            |   46,800 |                   **48,851** |                14,363 (30.7%) |
| `re3tt_ts-auth-service_f1_3`      |   42,072 |                   **42,622** |                13,652 (32.5%) |

Two distinct corruptions, both silent:

- **truncation** — 11–32% of messages lost everything after their first comma in every sampled case;
- **phantom rows** — RE3's messages carry embedded newlines inside quotes, so a stack trace became several
  "rows" with a garbage timestamp and a garbage service. `re3ss_carts_f1_2` produced 5,890 rows that are not
  records (6.5% of the file), and those rows were attributed to whatever the split happened to leave in the
  service column.

The reader that replaces it (`packages/kinetic/src/benchmarks/loaders/csv-records.ts`) is byte-level and
quote-aware: per-cell UTF-8 decode, `""` unescaping, quoted commas and newlines kept, CRLF, BOM, blank lines
skipped, ragged rows passed through, lazy so a capped read stops at the cap. 22 unit tests, 100% branch and
statement coverage, and the retention property of §7 falls out of it: every cell is an independent string.

## 9. What the repair costs and what it buys

The input is now faithful, so the cell figures move. Both sides are measured on the same host, same flags,
default configuration (`--data-dir /root/RCAEval-all`), old reader vs new:

| cell                 | old reader | new reader | Δ         |
| -------------------- | ---------: | ---------: | --------- |
| RE1:OnlineBoutique   |     90.4%  |     90.4%  | 0         |
| RE1:SockShop         |     95.0%  |     95.0%  | 0         |
| RE1:TrainTicket      |     90.0%  |     90.0%  | 0         |
| RE2:OnlineBoutique   |     93.1%  |     93.1%  | 0         |
| RE2:SockShop         |     98.9%  |     94.4%  | **−4.5**  |
| RE2:TrainTicket      |   *OOM*    |     84.4%  | first reading |
| RE3:OnlineBoutique   |     87.5%  |     90.0%  | **+2.5**  |
| RE3:SockShop         |     66.1%  |     55.0%  | **−11.1** |
| RE3:TrainTicket      |   *OOM*    |     74.5%  | first reading |

RE1 is untouched by design — it carries no logs — which is the control that says the change is localised to the
log path. `TrainTicket:RE2` and `TrainTicket:RE3` had **never been measured in one process**; their figures are
first readings, not regressions.

The four SockShop/OnlineBoutique RE2/RE3 losses were then traced case by case (dumps on both sides of the
change). They are not noise and they are not a reason to revert the input fix — the old figures were computed
from a corpus where a quarter of every message was missing, so they were never a measurement of the engine. The
cause is a second, independent defect that the truncation had been **masking**, and it is repaired in the same
iteration: see `docs/rcaeval-log-fidelity.md` §4 for the serialized-value and I/O-cause clauses that put the log
classifier back on the causal side.

With both clauses in, every cell the faithful input had moved comes back: `RE2:SockShop` 94.4 → **98.9**,
`RE3:SockShop` 55.0 → **66.1**, and `RE3:OnlineBoutique` holds the 90.0 the faithful input had won (from 87.5).
The per-case census says the recovery is exact rather than arithmetic: the shipped tree's top-1 equals the
truncating reader's on **all 120** SockShop cases of the two RE cells, 8 of which the faithful reader alone had
lost, and `RE3:OnlineBoutique` keeps the one case that reader won. Net effect of the whole repair against the old
reader is **+1 case and no loss**, on an input where 11–32% of every message is now what the file's author wrote.
§11 is the grid as shipped.

## 10. Reproduce

```bash
# the whole grid, one process, 8 GiB cgroup
BENCHMARK_MEM_TRACE=1 npx tsx benchmarks/src/run-rcaeval.ts --data-dir /root/RCAEval-all \
  --diagnose-dump /tmp/grid.json

# the invariance claim of §5
npx tsx benchmarks/src/run-rcaeval.ts --data-dir /root/RCAEval-all --system ss --suite 2 --case-chunk 1  > /tmp/c1.log
npx tsx benchmarks/src/run-rcaeval.ts --data-dir /root/RCAEval-all --system ss --suite 2 --case-chunk 16 > /tmp/c16.log
diff <(grep -v 'Total duration' /tmp/c1.log) <(grep -v 'Total duration' /tmp/c16.log)   # 2 lines: dump path, exit marker

# the retention measurement of §7
BENCHMARK_MEM_TRACE=1 BENCHMARK_HEAP_SNAPSHOT=1 npx tsx benchmarks/src/run-rcaeval.ts \
  --data-dir /root/RCAEval-all --system ss --suite 2
```

## 11. The numbers, now

One process, 8 GiB cgroup, shipped defaults, after both repairs of this iteration (`--case-chunk 16`):

| cell                 | AC@1  | Avg@5 | TA    | cell-end live heap | RSS     |
| -------------------- | ----: | ----: | ----: | -----------------: | ------: |
| RE1:OnlineBoutique   | 90.4% | 96.2% | 45.6% |              26 MB |  284 MB |
| RE1:SockShop         | 95.0% | 97.3% | 36.6% |              26 MB |  287 MB |
| RE1:TrainTicket      | 90.0% | 95.7% | 36.0% |              40 MB |  415 MB |
| RE2:OnlineBoutique   | 93.1% | 94.7% | 24.4% |              38 MB | 1011 MB |
| RE2:SockShop         | 98.9% | 98.9% | 34.4% |              41 MB | 1020 MB |
| RE2:TrainTicket      | 84.4% | 88.0% | 28.9% |              54 MB | 1294 MB |
| RE3:OnlineBoutique   | 90.0% | 90.0% |  0.0% |              50 MB | 1295 MB |
| RE3:SockShop         | 66.1% | 84.6% |  0.0% |              51 MB | 1279 MB |
| RE3:TrainTicket      | 74.5% | 81.2% |  0.0% |              59 MB | 1296 MB |

Wall clock **690 s** for 723 cases, peak RSS **1.33 GiB**, no cell above **59 MB** of live heap at its own
boundary. Pooled AC@1 is 89.8% against a telemetry-free frequency prior of 23.4%, i.e. 86.6% of the reachable
margin — the number a reader should compare across runs, since the nine cells are not equally populated.

The bound is no longer the machine: it is `SLICE_BYTE_BUDGET` × the largest single case.
