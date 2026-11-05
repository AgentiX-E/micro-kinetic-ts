# The RCABench archive read through the RCAEval loader: a second path to a corpus we already lead, and the 21 pp it does not reproduce

**Status:** measured, and the measurement is a **DISCREPANCY this document opens rather than a result it
claims**. **Instruments:** `scripts/convert-rcabench-to-rcaeval.py` (new), the shipped RCAEval runner, and
one loader repair the conversion forced.

> **Correction, first**: an earlier draft of this document called this "a corpus the engine has never been
> scored on". That is false and this repository already says so — `docs/sota-comparison.md` §2 publishes
> **61.10% (869/1422) Top@1 on FSE'26 RCABench** against the field's 21% average and 37% best, and
> `docs/fse26-data-gap-verdict.md` analyses the same archive's `hubble_http_request_duration_*`,
> `*_metrics_histogram.parquet` and nanosecond trace durations in detail. What is new here is a **second
> data path** to that corpus, not a new corpus.

---

## 1. What was built

RCABench publishes its raw datapacks on Zenodo (`10.5281/zenodo.17105974`, CC-BY-4.0, 13.4 GB): one directory
per fault injection, each with `{normal,abnormal}_{metrics,logs,traces}.parquet`,
`{normal,abnormal}_metrics_{histogram,sum}.parquet`, `env.json`, `injection.json` and `conclusion.parquet`.

Until now the only way this repository read that archive was the FSE'26 harness, on its own pre-processed
dump. `scripts/convert-rcabench-to-rcaeval.py` builds the second path: it converts a datapack into the
RCAEval case layout (`metrics.json`, `logs.csv`, `traces.csv`, `inject_time.txt`, `ground_truth.json`), so
the shipped runner and the shipped loader score it with **no second harness and no second ranking code**.

The mapping is a set of decisions, each stated in the script's own header: seven metric families carried and
renamed (`hubble_http_request_duration_p{50,90,95,99}_seconds` → `latency-50/90/95/99`,
`container.cpu.usage` → `cpu`, `container.memory.working_set` → `mem`, `queueSize` → `queue-size`), the
hubble family attributed to the CALLEE (`attr.destination_workload`) as the per-second maximum over callers,
everything else dropped rather than renamed — a renamed gauge the engine has no estimator for would sit in
the case looking like evidence and scoring nothing.

893 datapacks were available (the 12.3 GB of the 13.4 GB archive that had arrived when this was written).
The sample is **every 7th pack, first 60** — deterministic, so it is reproducible without a seed.

## 2. What it reads

```
python3 scripts/convert-rcabench-to-rcaeval.py \
  --src ~/RCABench-raw --dst ~/RCABench-conv --stride 7 --limit 60
pnpm exec tsx benchmarks/src/run-rcaeval.ts --suite re3 --system tt --data-dir ~/RCABench-conv
```

The run's header states `Data: ~/RCABench-conv` and `TrainTicket:RE3: 60 cases`, so the artifact says which
corpus it ranked on; the `RE3` label is the multimodal PROTOCOL, not a claim that these are RE3's cases.

| reading                           |                                     value |
| --------------------------------- | ----------------------------------------: |
| **AC@1**                          |                         **40.0%** (24/60) |
| Top@5                             |                                     50.0% |
| type-averaged AC@1 over 20 groups |                                     50.1% |
| telemetry-free prior, frequency   |                                     18.3% |
| telemetry-free prior, uniform     |                                      5.0% |
| lift                              | 26.5% of the reachable margin above 18.3% |

Per family (cases won / cases):

| family                      | reading | family                           |          reading |
| --------------------------- | ------: | -------------------------------- | ---------------: |
| `ex` exception              | **5/5** | `rrc` response-replace-code      |         **4/16** |
| `rd` response-delay         | **3/3** | `rrm` request-replace-method     |         **3/11** |
| `rrb` response-replace-body | **3/3** | `ra` request-abort               |          **2/7** |
| `rq` request-delay          | **1/1** | `st` stress                      |          **1/5** |
| `rt` return                 | **1/1** | `pa` partition                   |          **0/3** |
| `dly` delay                 | **1/1** | `ck` container-kill              |          **0/2** |
|                             |         | `pk` pod-kill / `pf` pod-failure | **0/1**, **0/1** |

## 3. The 21 pp this path does not reproduce, and the four reasons it might not

`docs/sota-comparison.md` publishes **61.10% (869/1422)** on FSE'26 RCABench. This path reads **40.0%** on 60
cases of the same archive. Both are real readings of the same corpus family, and the gap is **21 points in
the direction that flatters this project** — which is exactly the direction in which a discrepancy must be
resolved before either number is quoted again.

Four candidate causes, in the order they can be settled:

1. **Population.** 60 stratified cases against 1422; the stride sample spans all twenty families, while the
   FSE'26 set's composition is in `docs/fse26-data-gap-verdict.md` (four weak types at 40.7%). One case is
   1.7 pp here, so the 95% interval is roughly ±12 pp — most of the gap could be sample.
2. **Ground-truth element.** RCABench's ground truth is a SET (`service`, `pod`, `container`, `span`), and for
   a network fault it is the edge's two ENDPOINTS. This path scores the injection point's **source** only,
   which is the strictest single-element reading; a harness that credits the target, or any member, would
   read higher on the same ranking.
3. **The dropped families.** This path carries seven metric families. `jvm.gc.*` lives in
   `*_metrics_histogram.parquet` and is not carried; `docs/fse26-data-gap-verdict.md` already names that as
   one of the three reasons `JVMMemoryStress` is weak (171 cases there).
4. **The graph.** The converted cases are scored on a graph built from the TrainTicket YAML plus trace edges
   (71 edges before pruning, 55 after, over 49 nodes) — not the graph the FSE'26 dump was scored on.

None of the four is established, and this document does not pick one. It records the gap and the order in
which it can be closed; the run that closes it is the full archive through this path, per case, against the
FSE'26 dump's own per-case answers.

## 4. Two instrument defects the conversion found, and one of them was in the engine

### 4.1 `NaN` is not JSON

Missing hubble observations arrive as `NaN`. `json.dumps` writes the literal `NaN`, which is not JSON, and
the loader rejects the whole case: **5 of 5** sampled cases failed to load on the first conversion. Fixed at
the boundary — non-finite values are dropped before serialisation.

### 4.2 A span clock the loader could not read, and did not say so

The converter's first version wrote its span clock in a column called `ts`. The loader reads
`startTimeMillis`, `startTime`, `start_time` and `timestamp` — and **nothing else** — so `ts` was read by no
branch, every span normalised to start time `0`, and the first reading reported `traceActivity … post=0` on
**60 of 60 cases** while ~5,000 spans sat in each file. No warning, no error, a plausible-looking `0.000`
ratio.

Two repairs, both in the engine (`packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts`):

- `BARE_TIMESTAMP_HEADERS` (`timestamp`, `ts`, `time`) is now consulted by the row-object reader **and** by
  the two index-based streaming readers, so a corpus can name its clock the obvious way.
- The magnitude ladder had **two rungs**, not four. It answered `ns` and `ms` and silently mis-scaled the
  other two in opposite directions: a **seconds** column landed 1000× in the future (every span
  post-injection, every window empty) and a **microseconds** column 1000× in the past.
  `normalizeTraceStartTime` now reads s → ms → µs → ns by magnitude and is exported, so
  `packages/kinetic/__tests__/unit/loaders/rcaeval-loader.test.ts` pins one instant exported at all four
  scales, plus one end-to-end case that loads a `ts`-clocked `traces.csv`.

`duration` was the third unit trap, and it is converter-side: RCABench durations are **nanoseconds** and
RCAEval's are Jaeger **microseconds**, so a plausible gRPC span reads `88,089,622` instead of `88,089`.

### 4.3 What the trace channel is worth on this sample, as a controlled pair

Two arms on the same converted corpus, differing in one flag:

| arm                          |              AC@1 | type-averaged | Top@5 | `rrc` |  `ra` | `rrm` |
| ---------------------------- | ----------------: | ------------: | ----: | ----: | ----: | ----: |
| `--trace-weight 1` (shipped) | **40.0%** (24/60) |         50.1% | 50.0% | 25.0% | 28.6% | 27.3% |
| `--trace-weight 0`           |     36.7% (22/60) |         48.6% | 50.0% | 18.8% | 14.3% | 27.3% |

The trace channel buys **+2 cases** case-weighted and **+1.5 pp** type-averaged, and the two families it
moves are `rrc` (+1) and `ra` (+1) — the two where a call is answered with a rewritten code or aborted, i.e.
the two where the edge itself is the evidence. Small, but it is measured rather than argued, and it is the
first time this term has been ablated on a corpus where `attr.status_code` is populated.

**One reading is deliberately NOT an arm.** The run taken while the clock was broken read 41.7% (25/60) —
higher than either arm above. It is not a third arm because the broken clock also changed the graph the
pruning built (53 edges against 55), so it differs from both by more than the trace term. It is recorded only
because deleting it would leave the impression that the repair improved the reading, and it did not.

## 5. What this is not

- **Not a leaderboard row.** RCABench's published frame scores root cause identification, topology distance
  and evidence jointly (40/30/30) over a set-valued ground truth; `AC@1` asks whether the injection point's
  source is top-ranked. 40.0% and their 21%-average / 37%-best are different statistics of the same runs.
- **Not a first reading.** See the correction at the top: the 61.10% number predates this document.
- **Not the full corpus.** 60 of 893 converted of ≈1,430 available.
- **Not a tuning result.** Nothing was fitted to these 60 cases; the engine is the shipped configuration, and
  the loader repair changes no published cell (the nine RCAEval cells read `startTime`/`start_time`, which
  short-circuit the ladder).

## 6. What it changes

The corpus-side question `docs/evidence-starvation-audit.md` leaves open — _a second artefact that carries
non-magnitude evidence for the source_ — now has a concrete candidate: `attr.status_code` is populated here
and was empty in the RCAEval RE3 TrainTicket packs, so `failedEdge` (weight 3) has a subject on this corpus
that it never had on that one. And the four families that read **0%** (`container-kill`, `pod-kill`,
`pod-failure`, `partition`, 0 of 7) are the availability faults, where the source goes ABSENT rather than up
— the same mechanism the audit names, reproduced on a second path.

Three steps, in dependency order:

1. Convert the whole archive and read it per case; reconcile against the FSE'26 dump case by case. Nothing
   about the 21 pp can be decided before that, and one of the four causes above should turn out to be most of
   it.
2. Re-open `failedEdge` (weight 3) and `logSignalMode='logicHttp'` **on this corpus**, where both have a
   subject; on RCAEval the first was data-inert and the second was a measured regression.
3. Attack the availability families with something that is not a magnitude — absence is a different
   observation from a small rise.
