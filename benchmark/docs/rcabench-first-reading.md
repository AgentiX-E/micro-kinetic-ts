# The RCABench archive, read through a second data path

**Status:** reading of OUR instrument, not a competitor ranking. Established 2026-11-05, corrected 2026-11-06.

This document exists because this project made **two different claims about one corpus** and only the second was
checked against the corpus itself. Everything below is either a measured number with the command that produced it,
or a named hypothesis with the arm that would settle it. Nothing here is entered in `sota-comparison.md`'s
leaderboard, and §2c there says why.

---

## 0. Two corrections, both in the direction that flattered the earlier number

| reading | population | rule | value | why it moved |
| --- | --- | --- | ---: | --- |
| iteration 230 | 60 cases, **stride-7 sample of the 893 packs that had finished downloading** | single declared label | 40.0% | the download was at 12.3 GB of 13.4 GB, so namespaces `ts6/ts7/ts8` were **absent from the sample frame**, not sampled |
| iteration 231 | **1 422 cases — the whole archive** | single declared label | 32.28% (459) | the frame was repaired; the rule was not |
| iteration 232 | **1 422 cases** | **the corpus's declared set** | **42.69% (607)** | the rule was wrong: 1 053 of 1 422 packs declare a TWO-element truth |

The 40.0% was never a reading of this corpus. The 32.28% was a reading of this corpus **through a scoring rule the
corpus does not use**. The number to quote is **42.69%**, and the rest of this document is what it is made of, what
it is not comparable to, and what the remaining 18.4 pp are.

---

## 1. The defect: one type, two runners, two rules

`BenchmarkGroundTruth.serviceIds` has carried this docblock since it was written:

> Some benchmarks mark MULTIPLE services as correct for a single case. … `serviceIds` is the complete accepted
> set and `serviceId` is its first member … **Ranking is scored against the accepted set, not against
> `serviceId` alone.**

Two runners read that type.

| runner | scoring expression | path |
| --- | --- | --- |
| `benchmarks/src/run-fse26.ts` | `accepted.includes(ranking[0].serviceId)` | FSE'26 harness |
| `packages/kinetic/…/benchmark-runner.ts` | `ranking[0].serviceId === groundTruth.serviceId` | **every RCAEval cell, and every loss-census row** |

So the 61.10% FSE'26 row and the 32.28% second-path row were read under **different scoring rules**, and the
divergence was invisible because it lived between two files rather than between two branches of one expression. The
repair is one owner — `acceptedTruthServiceIds` in `loaders/types.ts` — called by both, with `bestAcceptedRank`
beside it so the rank a diagnostic reports and the verdict the counters take cannot be two readings of two rules.

### Why 1 053 packs declare two answers

`injection.json` carries the corpus's own ground truth, keyed by injection layer:

```json
"ground_truth": { "container": ["mysql"], "pod": ["mysql-0"], "service": ["mysql", "ts-order-service"] }
```

For an **edge-injected** fault the fault is between two services, so neither endpoint alone is the answer. Counted
over all 1 422 packs: **369 declare one service, 1 053 declare two.** The bridge that writes these directories had
been recording the set in `rcabench_ground_truth` as provenance and writing only its first member into
`root_cause_service` — the field the loader reads. The set was already on disk, and nothing read it.

---

## 2. The reading

```
python3 scripts/convert-rcabench-to-rcaeval.py --src ~/RCABench-raw --dst ~/RCABench-full   # 1 422 cases
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir .../t<k> --suite re3 --system tt --loss-census ...
```

| reading, 1 422 cases, shipped configuration | value |
| --- | ---: |
| **AC@1** | **42.69% (607/1 422)** |
| Top@5 | 68.70% (977/1 422) |
| truth absent from the graph | **0 / 1 422** |
| truth ranked 2–3 | 253 |
| truth ranked 4–5 | 117 |
| truth ranked 6–10 | 137 |
| truth ranked 11+ | 305 |
| truth in the graph but not ranked (pool admission) | 3 |

**Retrieval is not the problem; ranking is.** Not one truth is missing from the graph and 68.7% are inside the first
five — so 26.0 pp of the 57.3 pp miss is a **reranking** problem, and only the 305 cases ranked 11+ are a scoring
problem.

### Per fault family

| family | n | correct | AC@1 | family | n | correct | AC@1 |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| `rrb` response-replace-body | 51 | 48 | 94.1% | `rq` request-abort | 88 | 52 | 59.1% |
| `dly` delay | 21 | 19 | 90.5% | `rd` response-delay | 89 | 49 | 55.1% |
| `ex` exception | 43 | 37 | 86.0% | `rt` return | 21 | 10 | 47.6% |
| `co` corrupt | 46 | 34 | 73.9% | `rrm` request-replace-method | 190 | 83 | 43.7% |
| `l` latency | 7 | 5 | 71.4% | `rrp` request-replace-path | 39 | 10 | 25.6% |
| `lo` loss | 48 | 34 | 70.8% | `st` stress | 173 | 44 | 25.4% |
| `pa` partition | 97 | 65 | 67.0% | `ra` response-abort | 60 | 15 | 25.0% |
| `bw` bandwidth | 42 | 26 | 61.9% | `rrc` response-replace-code | 231 | 49 | 21.2% |
| `rsa` request-replace-* | 44 | 9 | 20.5% | `ck` container-kill | 89 | 13 | 14.6% |
| `pf` pod-failure | 24 | 3 | 12.5% | `pk` pod-kill | 10 | 1 | 10.0% |
| `rpb` response-patch-body | 4 | 1 | 25.0% | `t`/`m`/`d` | 5 | 0 | 0.0% |

Where the misses point: of **815** misses, **547 (67.1%)** name a caller or a callee of the truth (`caller` 263,
`callee` 284) and 268 name something unrelated. The engine is not lost in the graph; it is one hop away.

### Why the 10.4 pp is not a ranking change

The set rule does not touch the order. It was verified two ways that must agree, and they do:

1. **Analytically** — the 1 422 per-case predictions from the *previous* (single-label) run, re-scored against the
   sets declared in `injection.json`: **607/1 422 = 42.69%**.
2. **By re-running the shipped engine** after the fix, on 24 shards of ≤60 cases: **607/1 422 = 42.69%**.

Shards, not one run, because the loader materialises every case before ranking any: one 1 422-case run is killed at
the cgroup's **8 GiB** limit (first `FATAL … mark-compacts near heap limit` at the 4 GB default heap, then `SIGKILL`
exit 137 at `--max-old-space-size=12288`). Sharding is a paging device; no case appears twice. That was checked and
not assumed — the first aggregate read `1 482` rows for `1 422` cases, because one shard had been run twice, and the
duplicate was found by counting unique case IDs rather than by trusting the file count.

### And the nine published cells did not move

`RE1-OnlineBoutique`, re-run after the change: **89.6% (112/125)**, byte-identical to the published cell. The reason
is structural rather than lucky — the loader records `serviceIds` **only when the declared list has more than one
member**, and no RCAEval directory declares one. A unit test pins the no-op by running one suite twice, once with no
set and once with an explicit single-member set, and requiring case-for-case agreement.

---

## 3. What the remaining gap is — and it is not 18.4 pp of scoring rule

The FSE'26 harness reads **61.10% (869/1 422)** on the same injections. After the repair both paths use the same
*form* of rule, and the residual is **18.4 pp**. Two things about that residual matter:

1. **Our rule is now the MORE permissive of the two.** `scripts/fse26_convert.py` grants a dual label only to fault
   types whose name starts with `Network`; `HTTPResponseReplaceCode` — 231 cases here, our worst family at 21.2% — is
   category `HTTP` and gets a **single** label on that path. So the FSE'26 reading is achieved under a *stricter*
   rule than the one that produced 42.69%. The gap is not an artefact of truth width in our favour; it runs against
   it.
2. **The difference is in the input contract, not in the ranking code.** The FSE'26 loader hands the engine
   `traceEdges` / `failedTraceEdges` (caller → callee, calls, failed calls) and metrics from four parquet sources
   plus trace-derived golden signals; the RCAEval loader hands it raw spans, a topology document, and — in `core`
   mode — one metric source.

What is priced so far:

| arm | population | effect |
| --- | --- | --- |
| metric families `core` → `full` (adds `jvm.gc.*`, `jvm.memory.used`, every pod gauge, plus trace-derived error rate and latency) | paired 158 cases | **30.4% → 37.3% (+6.9 pp)**; `ck` 0/10 → 4/10, `st` 5/15 → 9/15 |
| scoring rule single-label → declared set | 1 422 cases | **32.28% → 42.69% (+10.4 pp)** |
| **direction term's BAR read against the case's own champion (`fleet`) + `whole-file` latency view, at the shipped weight 3** | **paired 1 421 cases** | **42.72% → 45.81% (+44 cases; 59 fixed / 15 broken)** — **a candidate, not a ship** (six families regress) |

### The direction arm, and what its own gate says about the ceiling

**What this arm changes is not the weight.** The shipped configuration has carried the direction term at
`failedEdgeWeight = 3` with `failedEdgeGateMode = absolute` since iteration 125, and on this corpus the absolute
bar — 300 ms, fitted on FSE'26 injections that add hundreds of milliseconds to a sub-millisecond baseline — is
almost never met by goldens whose latencies are seconds. The arm keeps the weight and changes the two things that
decide whether the term may speak: the BAR (a share of the case's own champion, `fleet`) and the VIEW that supplies
its second observable (`whole-file`, because the shipped view supplies zero `edgeLatency` rows).

The arm is live rather than nominal, and the run's own census says exactly how live: `direction-gate[whole-file]`
reports the view supplied **4 457 latency rows over 60 cases** (the shipped view supplies zero, which is why a
weight on that view buys a term that cannot fire), and the failed-edge input is present on **1 195** of the 1 422
cases (**7 725** failed-call records).

What it buys is concentrated where this corpus is worst — `rrc` **49 → 72 of 231 (+23)**, `rrm` **83 → 95 of 190
(+12)**, `rrp` +8, `rsa` +7, `ra` +5 — and what it costs is concentrated in the families whose dominant metric is
not a duration: **`st` 44 → 38 (−6)**, `pa` −3, `co` −2, `ck` −1, `lo` −1, `rq` −1. Six families regress, so the
standing acceptance rule refuses it: the net is bought with a regression, and this repository does not ship that.

**The gate is the binding constraint, and the census makes it a number**: of the 1 422 cases, the dominant-metric
gate refuses **1 030 (72.4%)**, the bar refuses another **220**, and **139** are admissible. A term that can act on
one case in seven cannot close a 47 pp deficit, and the next arm on this axis is therefore not a weight — it is a
gate observable that does not require the fault's dominant metric to be duration-shaped.

Unpriced: the call-graph contract. The FSE'26 path builds the graph from every observed caller → callee edge; this
path builds it from a topology document and then **prunes** it (`71 → 55` edges, −23%, on 59 of 60 cases in one
shard). Pruning never removes the truth — `truthInGraph` is 0 of 1 422 — but it removes the *competition*, and the
competition is what a rank-1 verdict is made of. That arm is the next measurement.

---

## 4. The class this benchmark is now led by

`arXiv:2608.21310` evaluates **ten LLM-agent configurations on RCABench** under the same set-valued rule, and its
table runs **42.6% → 90.0% Acc@1** (Sonnet · ThinkDepth.ai at the top; `Qwen · ClaudeCode` 79.6%, `Qwen · AIQ`
77.6%). Our 42.69% is level with the *worst* of them and 47 pp below the best.

Three qualifications, none of which rescues the number:

- Their population is a **500-case random sample** of the 1 430, so it is not case-for-case comparable.
- Their comparison boundary contains **no non-LLM method** — the statistical / graph / causal class appears only in
  their related work, with no numbers. On RCABench the only non-LLM entry with per-case results is this one.
- They pay **$0.01–$4.64 per case** and 30–140 rounds of tool use; this engine is **one deterministic pass with zero
  per-case cost**.

Being alone in a class is not leading a benchmark. The honest statement of where this project stands on RCABench is
**mid-field among agents, and unopposed among engines** — and §2c of `sota-comparison.md` carries the deficit.

---

## 5. A hypothesis this corpus kills

`docs/evidence-starvation-audit.md` records availability faults as *the* case where evidence is an **absence**: a
killed container's telemetry stops, so an anomaly-maximising ranker cannot see it. That predicts a mass-sink
operator — "the service whose mass went to zero is the source, not the victim" — and it is the most attractive
Deng-Yu-flavoured lever left.

Measured, over every case in the five families it would apply to, counting the truth service's spans before and
after the injection (`normal_traces.parquet` / `abnormal_traces.parquet`, `service_name` column):

| family | n | truth vanishes (pre>0, post=0) | halved | stable | grew |
| --- | ---: | ---: | ---: | ---: | ---: |
| `response-replace-code` | 231 | 1 | 20 | 115 | 95 |
| `stress` | 173 | 1 | 47 | 121 | 4 |
| `container-kill` | 89 | **0** | 17 | 69 | 1 |
| `pod-failure` | 24 | **12** | 10 | 0 | 0 |
| `pod-kill` | 10 | **0** | 1 | 8 | 0 |
| **total** | **527** | **14** | 95 | 313 | 100 |

**`container-kill`, the family the hypothesis was built for, vanishes in ZERO of 89 cases.** TrainTicket runs
replicas, so killing one container does not remove the service from the trace — it keeps answering. Only
`pod-failure` behaves as the audit predicted, and only for half of its 24 cases.

A disappearance operator therefore caps at **14 of 1 422 cases (1.0 pp)**. It is not the lever. What does move `ck`
is the `k8s.pod.*` availability gauge set — the `full` family arm took it from 0/10 to 4/10 — which is a *presence*
signal about the pod, not an absence signal about the service.

---

## 6. What is still open

1. **Price the call-graph contract.** Emit the FSE'26 loader's `traceEdges` shape from this path (unpruned) and pair
   the arm: the largest named, unmeasured part of the 18.4 pp.
2. **Run `--families full` on all 1 422 cases.** Priced at +6.9 pp on 158 cases (±7.7 pp at 95%); the family-level
   effect (`ck` 0/10 → 4/10) is the part that matters, and it has been seen on ten cases.
3. **`rrc`, 231 cases at 21.2%.** The largest family and the worst. Its only distinctive evidence is the response
   code, and `attr.status_code` is populated here (240-second window sample: 4 738 `Unset`, 237 `Ok`, **128
   `Error`**). `failedEdge` (weight 3.0) is live on this corpus — `[term-gap] costs: failedEdge=+50.625(17)` on one
   shard — and it is *costing*, not earning. That is a weight or a gate question, not a data question.
4. **`st`, 173 cases at 25.4%.** Resource faults; the pod gauges lifted `st` from 5/15 to 9/15 on the paired arm.
5. **`conclusion.parquet`** — per-span-name duration and success-rate deltas across both windows — is still read by
   no reader. It is the only artefact that states both windows per edge.

---

## 7. Reproducing it

```bash
# 1. archive → RCAEval case layout (1 422 cases; --start resumes, --stride subsamples, --families full widens)
python3 scripts/convert-rcabench-to-rcaeval.py --src ~/RCABench-raw --dst ~/RCABench-full

# 2. score. The loader materialises every case, so shard to ≤60 on an 8 GiB cgroup.
pnpm exec tsx benchmarks/src/run-rcaeval.ts \
    --data-dir ~/RCABench-full-shard-00 --suite re3 --system tt --loss-census loss-00.jsonl
```

A case directory carries `metrics.json`, `traces.csv` (`startTimeMillis,…`), `logs.csv`, `inject_time.txt` and
`ground_truth.json`, whose `root_cause_services` is the declared set and whose `root_cause_service` is its first
member. Four instrument defects were found and repaired by taking this reading, and all four are pinned by tests:
`NaN` is not valid JSON in `metrics.json`; a `ts` clock column that **no branch read**; a timestamp ladder that
mis-scaled seconds and microseconds by 1000×; and a bridge that let one unreadable pack end a 1 422-pack walk after
writing 59 GB.
