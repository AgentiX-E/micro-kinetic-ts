# Cloud-OpsBench: read, released, and connectable — with one qualification that decides how

**Iteration 310.** Every progress note since 2026-11-18 has carried the same line under benchmark-set
completeness: *Cloud-OpsBench not connected*. This file replaces that line with a reading of what it actually is,
what of it this engine can be scored on, and what a connection costs. The short version: it is released, it is
public, it is MIT, its Train-Ticket half is 204 cases, and **only the performance category carries the time-series
the engine reads** — so the comparable population is smaller than the case count and larger than zero.

## 1. What it is

| | |
| --- | --- |
| artefact | `github.com/LLM4Ops/Cloud-OpsBench`, MIT, with a Hugging Face dataset link in the README |
| paper | `arXiv:2603.00468` (v3), *Cloud-OpsBench: A Reproducible Benchmark for Agentic Root Cause Analysis in Cloud Systems* — Wang, Yu, Huang, Huang, Wang, Chen, Lyu |
| cases | **754**, across **57 fault types**, on **two** systems: Online Boutique **550**, Train Ticket **204** |
| paradigm | state snapshot + deterministic replay: no live cluster, no runtime noise |
| interface | a ReAct agent (`agents/cloudops_agent`, `agents/cloudops_skill_agent`) and an **MCP server** (`cloudopsbench_mcp`, 12 tools for Boutique / 10 for Train Ticket) |

## 2. The case layout, which is what a loader has to read

```
benchmark/<system>/<fault_category>/<case_id>/
├── metadata.json        fault label, namespace, query, difficulty, ground-truth diagnosis
├── tool_cache.json      pre-rendered tool outputs (the agent's view)
├── code/                trimmed business source (Boutique only — Train Ticket has no `code/`)
└── raw_data/
    ├── alert.json       anomaly signals derived from metrics and requests
    ├── k8s_states.json  Kubernetes object snapshots
    ├── logs.json        service and container logs
    └── metrics.csv      time-series metrics
```

Two facts in that tree decide the connection:

1. **`raw_data/metrics.csv` is not in every case.** The README states it plainly: faults that occur before the
   pod reaches its running stage produce no runtime performance metrics at all. So a metric-reading engine has no
   input on the admission / scheduling / startup families.
2. **`metadata.json` carries the ground truth and a difficulty tier**, so a cell can be reported per category the
   way this repository reports RCAEval's nine.

## 3. The taxonomy, and how much of it is metric-shaped

| category | cases | difficulty | metric-readable by this engine? |
| --- | ---: | --- | --- |
| Scheduling | 164 | Easy | **no** — pod never runs |
| Runtime | 141 | Easy | partly: 12 fault types, of which the crash/credential/probe ones are log-and-state |
| Application Code Defect | 98 | Hard | **no** for this engine — `code/` is the evidence, Boutique only |
| Service Routing | 91 | Medium | **no** — a misroute is a configuration fact, not a deviation |
| Startup | 86 | Easy | **no** — no runtime window |
| Performance | **76** | **Hard** | **yes** — saturation and network drops are deviations in `metrics.csv` |
| Admission Control | 58 | Medium | **no** — API-server rejection |
| Infrastructure | 40 | Medium | partly: `ContainerdUnavailable` / `KubeletUnavailable` surface as node-level signals |

The comparable population is therefore the **76 performance cases** (`PodCPUOverload`, `PodNetworkDelay`,
`NodeNetworkDelay`, `NodeNetworkPacketLoss`) plus whatever subset of Runtime and Infrastructure carries a
`metrics.csv`. It is not 754 and it is not 0 — and stating the number is the whole point of this file: a
"connection" that reported 754 cases would be reporting a denominator the engine cannot see.

## 4. The published numbers, so the cell has an anchor

The paper's own tables report eleven models on both systems. Component accuracy (`CA`) is the column comparable to
this repository's `Top@1`; `JRA` requires the component *and* the fault type, which no version of this engine
predicts.

| Online Boutique (550) | `CA` | `JRA` | `ECR` | steps |
| --- | ---: | ---: | ---: | ---: |
| DeepSeek-V4-Flash | **0.88** | 0.76 | 0.38 | 6.45 |
| GPT-5 | 0.86 | 0.68 | 0.21 | 5.56 |
| Qwen3.5-27B | 0.85 | 0.70 | 0.43 | 6.87 |
| Gemini-2.5-Pro | 0.81 | 0.67 | 0.46 | 6.21 |
| Claude-Sonnet-4 | 0.71 | 0.52 | 0.44 | 6.04 |
| Qwen3-8B | 0.35 | 0.19 | 0.16 | 16.01 |

| Train Ticket (204) | `CA` | `JRA` | `ECR` | steps |
| --- | ---: | ---: | ---: | ---: |
| GPT-5 | **0.70** | 0.68 | 0.15 | 7.03 |
| DeepSeek-V4-Flash | 0.69 | 0.63 | 0.24 | 7.68 |
| Qwen3.5-Plus | 0.67 | 0.64 | 0.25 | 5.90 |
| Gemini-2.5-Pro | 0.62 | 0.58 | 0.14 | 7.13 |
| Claude-Sonnet-4 | 0.60 | 0.59 | 0.15 | 7.42 |
| Qwen3-8B | 0.38 | 0.22 | 0.06 | 11.55 |

A vendor claim rides beside the paper's numbers and is recorded as a claim rather than as a baseline: CloudWise /
Castrel reports **82.8 %** root-cause accuracy on all 204 Train Ticket cases (linked from the README). It is not
a per-category table and it does not name its metric, so it cannot be placed in the column above.

**The paper's own finding is this repository's thesis, measured independently.** `ECR` — evidence closure — sits
at 0.15–0.46 while `CA` sits at 0.35–0.88: a correct answer does not imply a closed investigation, and the gap is
largest exactly where the fault is hardest (`Performance`, `Hard`). That is the same asymmetry register §306
records between a ranked answer and a causal path — 48 of 94 misses are winners the call graph does not connect to
the truth — measured from the other side of the problem.

## 5. What a connection costs, and what it would buy

**Cost.** A loader for `metadata.json` + `raw_data/metrics.csv` (the metric cases are a small fraction of a 3.9 GB
checkout), a label map from the case's `ground-truth diagnosis` to the service ids, and a cell table by category and
difficulty. No live cluster, no model calls, so the measurement is `$0` per arm like the other two corpora.

**What it buys.** Three things the current route does not have:

1. **A third corpus with a published leaderboard whose best `CA` is 0.70 on Train Ticket** — and this engine's cell
   on Train Ticket is already its strongest (`RE1:TrainTicket` 84.8 %, RCABench's 49-candidate surface). A cell at
   or above 0.70 on the 204 would be the first *external* leaderboard on which a zero-model-call configuration is
   competitive.
2. **A fault taxonomy the engine has never been scored on**: four `Performance` types, all of them deviations, and
   `PodCPUOverload` is precisely the `cpu`-saturation family the `external` scope refuses to explain by a callee.
3. **A process metric with a published scale** (`ECR`, `MC`, `EOC`) that a non-agentic engine can only report as
   `0` — which is the honest way to state what a ranking engine is not.

**Priority.** Behind RCAtlas, which needs a runner for a corpus already published as 90 cases, and ahead of nothing
else on the benchmark list: the two remaining unconnected suites are this one and RCAtlas, and both are now
readings rather than unknowns.

## 6. What this file does NOT claim

It does not claim a measurement. Nothing here was run; there is no cell on this corpus in any table of this
repository, and the four performance types are named in the taxonomy table above because the README names them,
not because this engine has been scored on them. The one number this file adds to the record is a **denominator**:
76 metric-bearing cases, not 754.
