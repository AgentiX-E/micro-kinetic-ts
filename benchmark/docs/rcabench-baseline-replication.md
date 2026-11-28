# The RCABench field replicates — and the first head-to-head found where we lose

> **The answer to "can a leader on RCABench be re-run?" is yes, and it is the only benchmark in this project's
> record where that is true.** The benchmark's authors released the harness, the data, *and their own
> containerised re-implementations of the baselines*. One of them has now been run on all 1,422 cases, paired
> case by case against this engine, under both judgements the corpus supports.
>
> The lead survives — **+20.96 pp** set-valued, **+18.35 pp** endpoint-only, McNemar `p < 1e-28` — and the run
> also found a defect of our own that the cross-paper comparison could never have shown: **the competitor wins
> 174 cases on four fault types where we win 6, and the mechanism is a converter that keeps 7 of 48 metrics.**

## 1. What makes this field replicable, in four layers

`docs/competitor-artefact-availability.md` records that the RCAEval-side leaders cannot be re-run (GALA+
withholds its implementation, DecompRCA's URL 404s, MICA declares nothing). RCABench is the opposite shape, and
the difference is structural:

| layer | artefact | verified |
| --- | --- | --- |
| metric harness | `rcabench-platform` **0.4.46** on PyPI, 110 releases — the package the paper's own table was produced with | 2026-11-07, PyPI API |
| data | Zenodo `10.5281/zenodo.17105974`: `rcabench-absolute_anomaly.tar.gz` (13,444,974,981 B), 1,422 case directories, 21,413 members, md5 `96d32ae290e06be7d4e251be02b36cb8` | 2026-11-07, Zenodo API + `tar tzf` |
| baselines | `OperationsPAI/rca-algo-contrib`, whose `.gitmodules` names **twelve** repositories under `LGU-SE-Internal/` — the authors' own re-implementations, not third-party code | 2026-11-07, GitHub API + `.gitmodules` |
| invocation | every repository ships `main.py` (registry entry), `run.py` (platform client), `Dockerfile`, `entrypoint.sh`, `info.toml`, `uv.lock` | 2026-11-07, `LGU-SE-Internal/baro@master` |

The paper states it plainly (§1, §9): *"we re-engineer 11 SOTA algorithms into a unified, containerized
framework"* and *"We promise that we will release all the code, baseline implementations, and datasets."*

## 2. The twelve, resolved one by one

`GET /repos/LGU-SE-Internal/<repo>`, 2026-11-07:

| repository | HTTP | private | licence | last push | size |
| --- | --- | --- | --- | --- | --- |
| `CausalRCA` | 200 | no | none | 2025-12-26 | 328 KB |
| `baro` | 200 | no | none | 2025-12-26 | 537 KB |
| `Simple-RCA` | 200 | no | none | 2025-08-27 | 579 KB |
| `Nezha` | 200 | no | **MIT** | 2026-07-30 | 342,664 KB |
| `ShapleyIQ` | 200 | no | **NOASSERTION** | 2025-12-27 | 1,078 KB |
| `MicroDig` | 200 | no | none | 2026-07-29 | 572 KB |
| `DiagFusion` | 200 | no | none | 2026-07-31 | 35,231 KB |
| `ART` | 200 | no | none | 2026-07-31 | 153,676 KB |
| `Eadro` | 200 | no | none | 2026-08-01 | 14,380 KB |
| `RUN` | 200 | no | none | 2025-08-03 | 261 KB |
| `rcd` | 200 | no | none | 2025-08-11 | 354 KB |
| `PaDi-RCA` | **404** | — | — | — | — |

Eleven of twelve resolve. **Eleven carry no licence** (two exceptions above) — the same status this project
already records for `RCA-DCM`: readable, runnable, quotable, **not vendorable**. "Integrate" can only ever mean
*integrate the comparison*.

The set is also **not** the paper's eleven (§5.3): that list is MicroRank / MicroRCA / MicroHECL / MicroDig /
DiagFusion / Eadro / Art / ShapleyIQ / Nezha / CausalRCA / Baro, while the repository carries `rcd`, `RUN`,
`Simple-RCA`, `PaDi-RCA` and **not** MicroRank, MicroRCA or MicroHECL. **The published table and the published
code do not describe the same eleven**, so a number copied from the table can never be checked against a run of
the repository that carries the same name.

## 3. Replication, executed

Three environment facts decide whether a re-run is real, and each is a fact a reader would otherwise assume:

1. **The archive is already in the loader's layout.** `tar tzf` yields
   `<injection>/{normal,abnormal}_{metrics,logs,traces}.parquet`, `conclusion.parquet`, `env.json`,
   `injection.json`, `.finished` — exactly the folder `RcabenchDatapackLoader(src_folder=…)` reads. **No
   converter sits between the published artefact and the competitor** — which matters, because *our* side of the
   comparison does pass through one (§5).
2. **No platform server is needed.** The authors' `run.py` is a *submission* client; the algorithm is invoked
   locally as `Algorithm(input_folder)` and returns `list[AlgorithmAnswer]`.
3. **The pin is load-bearing.** `baro/uv.lock` pins `polars==1.31.0`, `pandas==2.3.1`; on `polars 2.0` the first
   call dies in `Expr.replace(default=…)`, removed in 2.0.

Measured here (32 vCPU): `LGU-SE-Internal/baro@master`, `rcabench-platform==0.4.46`, **0.19 s/case**, 1,422 cases
in **274 s**, zero failures.

## 4. The controlled comparison — both judgements, all 1,422 cases

RCABench's ground truth is a **set** for edge-shaped faults: `ground_truth.service` names both endpoints, while
`display_config.injection_point.app_name` names the injected one. Both judgements are computable from the same
corpus, and this engine's published figure is the set-valued one (`sota-comparison.md` §0, "the SAME set-valued
rule, `Acc@1 = 1[r̂ ∈ R*]`"). A per-case verdict record was added to the runner (`--per-case-out`) precisely so
neither judgement has to be assumed:

| all 1,422 cases | this engine | `LGU-SE-Internal/baro` | margin | McNemar |
| --- | ---: | ---: | ---: | --- |
| **set-valued** (`top-1 ∈ ground_truth.service`) | **884 / 1422 = 62.17%** | 586 / 1422 = 41.21% | **+20.96 pp** | p = 4.8e-29 |
| **endpoint-only** (`top-1 == injection_point`) | **683 / 1422 = 48.03%** | 422 / 1422 = 29.68% | **+18.35 pp** | p = 2.1e-30 |

Paired, not two independent proportions: 512 cases resolved only by this engine, 214 only by `baro` (set-valued);
399 / 138 endpoint-only.

**This replaces a cross-paper figure with a measured one.** The standing row compares 61.46% against the paper's
`avg 21% / best 37%` — a number produced by a different implementation of a different method on the same corpus,
with no shared harness. Against the one competitor that can actually be run, the margin is **+20.96 pp**, not
+24.5 pp, and the difference is not luck: `p` is `4.8e-29`.

Two numbers for our own side must be stated together, because they do not agree: this run reads **62.17%**
(884/1,422, batched, per-case recoverable), while `sota-comparison.md` §0 carries **61.46%** (874/1,422,
dispatch `41034020065`). **Ten cases apart.** The difference is not randomness in the engine — a re-run of a
batch reproduces its own count exactly — it is a difference between the dispatch and `HEAD` (or between the
shards CI reads and the Zenodo archive this run reads). It is named here rather than averaged away, and is P1
below.

## 5. Where the competitor wins, and why — the converter keeps 7 of 48 metrics

`baro` is not uniformly behind. On four fault types it is far ahead, and the four share a mechanism:

| fault type | cases | this engine | `baro` | only ours | only `baro` |
| --- | ---: | ---: | ---: | ---: | ---: |
| `JVMMemoryStress` | 171 | 35.7% | **93.6%** | 4 | **103** |
| `ContainerKill` | 89 | 29.2% | **86.5%** | 2 | **53** |
| `PodFailure` | 24 | 4.2% | **66.7%** | 0 | **15** |
| `PodKill` | 10 | 60.0% | **90.0%** | 0 | **3** |
| **those four** | **294** | **34.4%** | **91.2%** | **6** | **174** |

**Net −168 cases = −11.8 pp of the whole corpus.** If those four types were answered at `baro`'s rate the total
would be **74.0%** rather than 62.17%.

The mechanism is in this repository's own converter, not in the engine:

```
scripts/fse26_convert.py, the mapping it documents:
  hubble_http_request_duration_p50/p90/p95/p99_seconds -> latency-50/90/95/99
  container.cpu.usage                                 -> cpu
  container.memory.working_set                        -> mem
  queueSize                                           -> queue-size
  everything else                                     -> DROPPED, deliberately
```

A `JVMMemoryStress` case carries **48 metric names**. Those seven are carried; **41 are dropped**, and the
dropped set is exactly the direct evidence for the four types above:

| what the fault does | the metric that says so | kept? |
| --- | --- | --- |
| container is killed | `k8s.container.restarts`, `k8s.container.ready` | **no** |
| pod is failed / killed | `k8s.pod.phase`, `k8s.pod.memory.usage`, `k8s.pod.memory_limit_utilization` | **no** |
| JVM heap pressure | `jvm.cpu.recent_utilization`, `jvm.system.cpu.load_1m`, `k8s.pod.memory.rss` | **no** |

`baro` reads `abnormal_metrics.parquet` directly — all 48. So on these four types the comparison is not two
rankers over one signal set: **it is a ranker with the evidence against a ranker without it.** The converter's
header says the drop was deliberate ("a renamed gauge the engine has no estimator for would sit in the case
looking like evidence and scoring nothing"), and that reasoning was sound for the seven families the engine had.
It stopped being sound the moment the engine was measured on a corpus where 20% of the cases are resource faults.

**This is the defect the cross-paper comparison was hiding**, and no amount of reading the paper could have
produced it: it required running an opponent that reads the metrics we throw away.

### 5.1 The evidence is in the parquet — measured, with the crudest rule that could work

The claim above would be an argument if it stopped there. It is a measurement: take the ten gauges the converter
drops, and rank services by the crudest statistic that could possibly work — the abnormal-window maximum over the
normal-window maximum, plus a "collapsed to zero" flag for `k8s.container.ready`, which can only fall. No
thresholds, no graph, no engine, no tuning.

| fault type | cases | crudest rule, top-1 == injected endpoint | this engine |
| --- | ---: | ---: | ---: |
| `JVMMemoryStress` | 171 | **85.4%** (146) | 35.7% |
| `PodFailure` | 24 | **91.7%** (22) | 4.2% |
| `PodKill` | 10 | **100.0%** (10) | 60.0% |
| `ContainerKill` | 89 | **0.0%** (0) | 29.2% |
| **all four** | **294** | **60.5%** (178) | 34.4% |

**Three of the four types are answered at 86.8% by a rule that reads ten columns and compares two maxima**, where
the engine answers 33.2% — the deficit is not modelling difficulty, it is evidence the case never carried.

`ContainerKill` scores 0%, and that is a fact about the rule rather than about the type: a restart counter is
monotone, so "abnormal max over normal max" reads ~1.0 for the killed container as readily as for its neighbours,
and the statistic that separates them is the *increment across the window*, not the level. Recorded because a
0% in a table of 85–100% is the row a reader will (rightly) trust least, and because it names the second thing
P0 has to get right: the k8s counters need a differencing rule, not a ratio.

## 6. What this changes in the record

| claim | before | after |
| --- | --- | --- |
| RCABench standing | **+24.5 pp over the best**, cross-paper (61.46% vs 37%) | **+20.96 pp over a competitor run here**, paired, p = 4.8e-29 |
| is a leader re-runnable | answered for RCAEval only (no) | answered for RCABench (**yes** — harness + data + 11 of 12 implementations) |
| where the remaining headroom is | "hard cases", unnamed | **four fault types, −168 cases, one converter line** |

Nothing here touches an RCAEval figure. The 735 was measured with its own pairwise harness and its own
controlled gap (0.16 pp against PRISM's additive pooling); this document is a second, independent measurement on
a different corpus.

## 7. Next, in the order that settles the most

| priority | action | cost | what it settles |
| --- | --- | --- | --- |
| **P0** | carry the k8s/JVM metric families into the case (no new estimator — presence, deviation and the existing channels), re-run the four types | 1 iteration | whether 34.4% → `baro`'s 91.2% is available to an engine that can see the evidence. **The single largest measured headroom in this project (−11.8 pp of the corpus)** |
| **P0** | reconcile 62.17% (this run) with 61.46% (dispatch `41034020065`) case by case | 1 h | which of the two the record should carry; ten cases is small but a record may not hold two numbers |
| **P1** | run a second baseline (`Simple-RCA` 0.9 s/case, `MicroDig` 19 s/case) | 3 min / 8 h | whether 41.21% is `baro`-specific or the field's real level |
| **P2** | `CausalRCA` (927 s/case) and the three training-dependent models (Art / DiagFusion / Eadro) | days | not an experiment at 15 days per arm; revisit only if P0 fails |

## 8. Provenance

| item | value |
| --- | --- |
| data | Zenodo `10.5281/zenodo.17105974`, md5 `96d32ae290e06be7d4e251be02b36cb8`, 1,422 cases |
| harness | `rcabench-platform==0.4.46`, `polars==1.31.0`, `pandas==2.3.1` |
| competitor | `LGU-SE-Internal/baro@master`, `info.toml` tag `6038cdc` |
| our converter | `scripts/fse26_convert.py` (unchanged), 7 of 48 metric names carried |
| our run | `run-fse26.ts --per-case-out`, 1,422 cases in 8 batches against a 12 GB disk, 0 failures |
| verdicts | `{datapack, faultType, accepted[], ranked[5]}` per case — the judgement is a post-processing choice |

## 9. Where the field moved while this was being measured — November 2026

A search of the last 30 days (2026-11-07) returns three **live-cluster agentic** evaluations, and none of them
is comparable to a Top@1 ranking. They are recorded because "the field is complete" is a claim this document
would otherwise be making silently:

| evaluation | what it grades | published state |
| --- | --- | --- |
| **SREGym** (NeurIPS 2026, MIT) | a fleet of AI SRE agents on a **live Kubernetes cluster**: 90 faults, three attempts, diagnosis + fix graded against the *running system* | leaderboard live; top entry 95.2% end-to-end (Radar + Claude Code), #2 72.2% |
| **Tymfi Labs** (Edition 2) | 100 live-K8s incidents, symptom-only paging, `kubectl` in a sandbox, fix verified on the system, shortcuts auto-fail | best of seven frontier models 79% fixed; DeepSeek V4 Pro 45% |
| **SWEOps-Bench** (`arXiv:2611.06099`, 2026-11-04) | 55 reproducible incidents from 16 Kubernetes operator projects; agent edits source/config, harness builds and deploys | six agent-model configurations: faulty-state detection 72.7–90.9%, **verified recovery only 14.5–52.7%** |

Three consequences, none of them comfortable:

1. **None of the three measures a ranking.** Their unit is "was the incident resolved", which is a different
   task from "was the injected service named first". Quoting our Top@1 beside their recovery rate would be the
   same class error §0 of `sota-comparison.md` already refuses for the 90.0% agentic row.
2. **They confirm the defect found in §5 from the other side.** Every one of them is built on **resource and
   platform faults** — crashed kubelets, CoreDNS config, HPA traps, silent data corruption — not on HTTP
   response-code rewrites. A ranker that cannot see `k8s.container.restarts` is not competitive in the class the
   field has moved to, whatever its Top@1 on a static corpus.
3. **They set the next horizon honestly.** `SWEOps-Bench`'s gap (72.7–90.9% detection against 14.5–52.7%
   recovery) says the field's own bottleneck is no longer localisation. This engine's route therefore has an
   ordering: make the evidence plane complete (§5), then measure, and only then consider a remediation claim.

None of this changes a number in this document. It changes what "SOTA" has to mean next.
