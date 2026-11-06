# The RCABench archive read in full through the RCAEval loader: 459/1422 against the other path's 869/1422

**Status:** measured on the **whole archive** — 1 422 datapacks, the same 1 422 injections the FSE'26 row is
scored on. The reading is **32.28% (459/1422)** and the other path reads **61.10% (869/1422)** on the same
injections. **This document opens that 28.8 pp; it does not explain all of it.** One of the four candidate
causes the first draft listed is now **dead**, one has a **measured effect** (+6.9 pp, paired), and the
remaining structural difference is named in §5 as the object of the next arm. **Instruments:**
`scripts/convert-rcabench-to-rcaeval.py`, the shipped runner, the shipped loader, and four repairs the reading
forced (two in the engine, two in the bridge).

> **Two corrections, in the order they were earned.**
>
> **(1)** An earlier draft called this "a corpus the engine has never been scored on". That was false and the
> repository already said so: `docs/sota-comparison.md` §2 publishes **61.10% (869/1422) Top@1 on FSE'26
> RCABench**. What is new is a **second data path** to that corpus, not a new corpus.
>
> **(2)** That same draft read **40.0% (24/60)** on a stride sample and called it a reading. It was not a
> reading of the archive — it was a reading of **893 of the 1 422 packs**, because the download was still in
> flight when the sample was drawn (namespaces `ts0`–`ts5` only; `ts6`, `ts7` and most of `ts8` were absent). A
> sample's population is a property of the download, and nobody had said which download. **The full-archive
> reading below supersedes it and does not agree with it**: 32.28% against 40.0%.

---

## 1. What was built, and what it costs to run

RCABench publishes its raw datapacks on Zenodo (`10.5281/zenodo.17105974`, CC-BY-4.0, 13.4 GB): one directory
per fault injection with `{normal,abnormal}_{metrics,logs,traces}.parquet`,
`{normal,abnormal}_metrics_{histogram,sum}.parquet`, `env.json`, `injection.json` and `conclusion.parquet`.

`scripts/convert-rcabench-to-rcaeval.py` converts a datapack into the RCAEval case layout, so the shipped
runner and the shipped loader score it with **no second harness and no second ranking code**. Every mapping is
a stated decision in the script's header; the two that matter for interpretation:

- **metrics** are the families the engine has channels for, renamed to the RCAEval vocabulary
  (`hubble_http_request_duration_p{50,90,95,99}_seconds` → `latency-50/90/95/99`, `container.cpu.usage` →
  `cpu`, `container.memory.working_set` → `mem`, `queueSize` → `queue-size`). The hubble family is an **edge**
  measurement — `service_name` is the caller, `attr.destination_workload` the callee — so a per-service series
  is the per-second **maximum over callers into** that service.
- **traces** are carried whole, including `attr.status_code`, which is the column the RCAEval RE3 TrainTicket
  packs do not carry (189 488 spans, none with a status).

Everything else in the pack is dropped **rather than renamed**: a renamed gauge the engine has no estimator for
would sit in the case looking like evidence and score nothing. §4 prices that rule and finds it was too broad.

**The archive is 1 422 packs, and the run is 1 422 cases.** Two facts about running it are worth recording
because both cost hours:

- **The loader materialises every case before ranking any.** A single 1 422-case run was killed twice: first
  `FATAL ERROR: Ineffective mark-compacts near heap limit` at the default 4 GB heap, then `SIGKILL` (exit 137)
  at `--max-old-space-size=12288`, because this container's memory limit is **8 GiB** and the heap flag does
  not raise it. The reading below is **24 shards of ≤60 cases**, each shard a full run of the shipped
  configuration, aggregated per case from `--loss-census` rows. The sharding is a paging device, not a
  different experiment: no shard contains a second copy of a case, and the 24 shards together are the archive.
- **One pack was unreadable, and it was this environment's fault, not the archive's.** `ts5-mysql-bandwidth-r5tp67/
  normal_traces.parquet` was 1 247 744 bytes where the tarball's member is 5 246 265 — truncated by an
  interrupted extraction that had already written the pack's `.finished` marker. A footer scan of all
  **15 642** parquet files found exactly this one bad; the member was re-extracted and the pack converted.

## 2. What it reads

```
python3 scripts/convert-rcabench-to-rcaeval.py --src ~/RCABench-raw --dst ~/RCABench-full
pnpm exec tsx benchmarks/src/run-rcaeval.ts --suite re3 --system tt --data-dir <shard> --loss-census <shard>.jsonl
```

| reading (whole archive, injection source only, shipped configuration) |                     value |
| -------------------------------------------------------------------- | ------------------------: |
| **AC@1**                                                             | **32.28%** (**459/1422**) |
| Top@5                                                                |         53.30% (758/1422) |
| truth ranked 2–3 / 4–5 / 6–10 / 11+ / unranked                        |    205 / 94 / 127 / 533 / 4 |
| cases whose ground truth is **not a node** of the graph               |               **0 of 1422** |
| of the 963 misses, the winner is a **caller or callee** of the truth   |  **633 (65.7%)** — 330 unrelated |

Per family (cases won / cases): `rrb` **48/51**, `ex` **37/43**, `l` 5/7, `dly` 13/21, `rt` 10/21, `rq`
**50/88**, `rd` **49/89**, `lo` 19/48, `rrm` **69/190**, `pa` 27/97, `co` 12/46, `st` **44/173**, `ra` 14/60,
`bw` 7/42, `ck` 13/89, `rsa` 6/44, `rrc` **26/231**, `rrp` 5/39, `pf` 3/24, `pk` 1/10, `rpb` 1/4.

Three things in that table are the reading rather than decoration:

1. **Nothing is lost to retrieval.** Every one of the 1 422 ground truths is a node the ranking could return.
   The loss is a ranking loss in all 1 422 cases, which makes it the same class of problem the nine RCAEval
   cells pose, and unlike a corpus where a third of the truths are simply absent from the graph.
2. **`rrc` is 231 cases at 11.3%** — the largest single family in the archive and the worst. A
   `response-replace-code` fault rewrites the response a service returns; its only signature is that the
   service's calls START FAILING, and failure rate is the one channel this path did not carry (§4).
3. **Two thirds of the misses name a NEIGHBOUR.** The winner is a caller or a callee of the injected service in
   633 of 963 misses. That is the direction problem `docs/evidence-starvation-audit.md` describes — a symptom
   beside the source outranking the source — quantified here on 1 422 cases with `attr.status_code` present.

## 3. The 28.8 pp the two paths do not share

| path                                       | harness                        | cases    |              AC@1 |
| ------------------------------------------ | ------------------------------ | -------- | ----------------: |
| FSE'26 RCABench (`sota-comparison.md` §2)  | `run-fse26.ts` + FSE26 loader   | 1 422    | **61.10%** (869)  |
| RCABench through the RCAEval loader        | `run-rcaeval.ts` + RCAEval loader | 1 422  | **32.28%** (459)  |

**The population cause is dead.** The first draft's first candidate was that 60 cases cannot represent 1 422.
Both numbers are now read on the same 1 422 injections, and the gap is 28.8 pp.

What is left is the **loader contract**, and it is not a small difference. The two loaders read the same
archive into **different sufficient statistics**:

| the FSE'26 loader hands the engine                                             | the RCAEval loader hands the engine            |
| ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `traceEdges`: distinct caller → callee pairs                                    | raw spans (`traces.csv`, one row per span)      |
| `failedTraceEdges`: caller → callee, call count, **failed-call count**           | spans with a `status` string, aggregated by the engine into `traceActivity` per service |
| metrics from **four** sources: gauges, `_metrics_sum`, `_metrics_histogram` (`{metric}.max`), and trace-derived golden signals (`http.server.request.duration`, `http.response.error_rate`) | metrics from ONE source: seven families, §4 |

That table is the whole of the remaining question, and §4 prices the last row of it.

## 4. The families this path was dropping, and what they are worth (paired)

A census of the archive says the "drop rather than rename" rule was too broad:

| family                        | lives in                 | packs carrying it |
| ----------------------------- | ------------------------ | ----------------: |
| `jvm.gc.duration`             | `*_metrics_histogram`    | **40 of 40**      |
| `jvm.memory.used`             | `*_metrics_sum`          | **40 of 40**      |
| `hubble_http_request_duration_*` | `*_metrics` (the only source carried) | **23 of 40** |
| `attr.status_code`            | `*_traces`               | **40 of 40**, values `Unset`/`Ok`/`Error` |

So the core mode deleted the only two channels a JVM fault has, and — because hubble latency is in 23 of 40
packs — **17 of 40 packs had no latency channel at all**. `--families full` carries all three parquet sources
(mapped families keep their mapped name, so the modes differ only by what `full` ADDS) plus two signals derived
from the spans: a per-service **error rate** and a per-service **latency**, in 10-second buckets, attributed to
the span's own service.

Two arms, **same 158 cases**, one flag apart (`--stride 9` of the same archive, paired case by case):

| arm                    |              AC@1 | truth at rank 1 | truth at rank 11+ |
| ---------------------- | ----------------: | --------------: | ----------------: |
| `--families core`      | **30.4%** (48/158) |              48 |                65 |
| `--families full`      | **37.3%** (59/158) |          **59** |            **49** |

**+6.9 pp, +11 cases net: 15 gained, 4 lost.** The movement is out of the deep ranks into rank 1, which is the
signature of a ranking term finding evidence rather than a candidate appearing. By family, the gains land where
the added families describe the fault: `ck` container-kill **0/10 → 4/10**, `st` **5/15 → 9/15**, `rq`
**2/5 → 4/5**, `rrm` **6/23 → 8/23**, `rrc` **5/27 → 6/27**; the four lost cases are `pa` 1, `pf` 1, `ra` 1,
`rrc` 1. `ck` at 0/10 was the family §2's predecessor called unwinnable on magnitude — it is winnable on the
`k8s.pod.*` availability gauges, which this path was throwing away.

**This is 7 of the 28.8 points.** The remaining ≈22 pp is not explained here, and the next arm is the row of §3
that has not been priced: **the trace statistics**. The FSE'26 loader hands the engine `failedTraceEdges` —
caller, callee, count, failed-count — and this path hands it raw spans and lets the engine re-derive a per-service
count. Whether that difference is the remaining 22 pp is a question with a measurement, not a paragraph.

## 5. What the reading establishes, and what it does not

**Establishes.**

- The second path reads **32.28%** of the archive, exactly, with no case lost to retrieval and no case lost to a
  load error (`1422 discovered / 1422 scored`).
- **Metric-family starvation costs 6.9 pp** on a paired 158-case read, concentrated on the availability and
  JVM-adjacent families — measured, not argued, and the first time this project has priced a family set rather
  than a weight.
- On this corpus two thirds of the misses name a caller or callee of the source, and `attr.status_code` is
  populated where the RCAEval RE3 TrainTicket packs carry it empty. The `failedEdge` term (weight 3) has a
  subject here that it never had there.

**Does not establish.**

- **Not a leaderboard row.** RCABench's published frame scores root-cause identification, topology distance and
  evidence jointly (40/30/30) over a **set-valued** ground truth; `AC@1` asks whether the injection point's
  source is top-ranked. 32.28% and their 21%-average / 37%-best are different statistics of the same runs, and
  the 61.10% comparison is between two of OUR harnesses, not between us and the field.
- **Not a resolution of the 28.8 pp.** One cause is dead and one is priced; ≈22 pp is unattributed.
- **Not a tuning result.** Nothing was fitted to these cases; the engine is the shipped configuration. The four
  repairs below change no published cell — the nine RCAEval cells read `startTime`/`start_time`, which
  short-circuit the ladder, and none of them reads a republished file.

## 6. The four instrument defects the reading found

Two were in the **engine**, and they would outlive this corpus:

- **A span clock the loader could not read, and did not say so.** The converter's first version wrote its clock
  in a column called `ts`; the loader reads `startTimeMillis`, `startTime`, `start_time`, `timestamp` and
  nothing else, so every span normalised to `0` and the run reported `traceActivity … post=0` on 60 of 60 cases
  while ~5 000 spans sat in each file. `BARE_TIMESTAMP_HEADERS` (`timestamp`, `ts`, `time`) is now consulted by
  the row-object reader and both streaming readers.
- **The magnitude ladder had two rungs, not four.** `ns` and `ms` were answered and the other two were silently
  mis-scaled in opposite directions — seconds landed 1000× in the future (every span post-injection, every
  window empty), microseconds 1000× in the past. `normalizeTraceStartTime` now reads s → ms → µs → ns by
  magnitude, refuses a non-positive or unparsable cell instead of guessing, and is exported so the unit test
  pins one instant at all four scales.

Two were in the **bridge**, and both are about surviving a corpus rather than a file:

- **`NaN` is not JSON.** Missing hubble observations arrive as `NaN`; `json.dumps` writes the literal and the
  loader rejects the whole case — 5 of 5 sampled cases on the first conversion. Dropped at the boundary.
- **One unreadable pack ended a 1 422-pack walk.** The first full conversion died at pack 1 059 on the truncated
  parquet of §1 — after writing 59 GB, naming nothing, and taking the remaining 363 packs with it. A corpus is
  an input; an input with one bad member is a fact to report, not an exception to propagate. Skipped packs are
  now counted and printed last, because that count is the denominator every later percentage is a share of, and
  `--start N` resumes without renumbering the cases already on disk.

A third unit trap is converter-side and permanent: RCABench durations are **nanoseconds** and RCAEval's are
Jaeger **microseconds**, so a plausible gRPC span reads `88 089 622` instead of `88 089`.

## 7. What it changes

Three steps, in dependency order:

1. **Price the trace statistics** (§3's last row). Emit `traceEdges` / `failedTraceEdges` equivalents on this
   path — or feed the engine the same aggregate from the RCAEval loader — and pair the arm. This is the largest
   unattributed part of the 28.8 pp and the only one left with a mechanism rather than a suspicion.
2. **Re-open `failedEdge` (weight 3) and `logSignalMode='logicHttp'`** on this corpus, where both have a
   subject: the status column is populated, 65.7% of misses name a neighbour, and on RCAEval the first was
   data-inert and the second a measured regression.
3. **Run `--families full` on the whole archive.** The arm here is 158 cases (±7.7 pp at 95%); the effect is
   large enough to survive that interval but not large enough to stop there, and the availability families
   (`ck`, `pk`, `pf`, `pa`) are the ones whose mechanism — the source goes ABSENT rather than up — still has no
   channel of its own.
