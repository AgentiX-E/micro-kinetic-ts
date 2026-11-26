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
   input on the admission / scheduling / startup families. **Counted in §7: 170 of 754 cases carry the file.**
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

The table above is the PAPER's taxonomy and its guess about readability, and §7 replaced the guess with a count:
`metrics.csv` is present in **170** cases — including all 98 `codedefect` cases, which this table had marked
unreadable — and 166 of those name a service their own series carry. It is not 754 and it is not 0 — and stating the
number is the whole point of this file: a "connection" that reported 754 cases would be reporting a denominator the
engine cannot see.

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
**170 metric-bearing cases, 166 service-scoped**, not 754 — corrected in §7, which replaced this file's own
iteration-310 estimate of 76 with a count.

## 7. Measured, iteration 361: 170 readable, 166 comparable, and the closure axis priced by reach

§3's readability column was the paper's own account and this file's estimate; §5 called the loader "a small
fraction of a 3.9 GB checkout" without ever listing it. Both are now counts, produced by
`benchmarks/src/run-cloudopsbench-census.ts` against a full checkout, at ¥0 and with no model call:

```
cases (directories)            754      read 754 · refused 0 · labels 754 · tool_cache 754
metrics.csv                    170  (22.5 %)   alert window 164 · truth in own series 166 (97.6 %)
rows / services per case       46–53 / 15–51
category                     cases  metrics      admission 58/0 · codedefect 98/98 · infrastructure 40/0
                                                 performance 76/72 · runtime 141/0 · scheduling 164/0
                                                 service 91/0 · startup 86/0
```

**Two corrections follow.** `boutique/codedefect` carries time series in all 98 of its cases — the table in §3 marked
it unreadable — so the readable population is **170**, not 76, and the error was in the direction that understates
what is comparable. Four of the 170 are `node/worker-02` truths (`boutique/performance/{22,25,27,29}`), outside this
engine's answer alphabet by construction, so the **comparable** population is **166** — the same fence this record
applies to RCAEval's node- and namespace-scoped labels.

**And the closure axis is not one field away.** §5's third bullet priced `ECR` as a metric "a non-agentic engine can
only report as 0", and register §360 priced the axis at one recorded field for 678 cases. The reach census says
otherwise: of 2 478 milestones, **472 (19.0 %) have an admissible use this arm's metric/log/edge surface can emit,
and 0 of 754 cases have every milestone inside it** — 363 have some, 391 have none. The corpus's twelve tools read
Kubernetes objects; four are producible here, and the arm's own strongest channels (`metric`, `fleet`) are evidence
for none of them, because no tool of the twelve returns a series. The price of that axis is a **tool family**.

**The corpus is 96.0 % checkable against its own replay surface.** `tool_cache.json` doubles as an oracle, and
auditing the labels against it gives 6 437 of 6 654 admissible uses (96.7 %) and **2 379 of 2 478 milestones
(96.0 %)**, with 655 of 754 cases fully checkable. The 4.0 % residual is named: `GetSourceCode` (98 uses) and
`GetRecentLogs` (72) appear in **no** case's cache, and 47 `GetResources` calls are absent where a label demands
them. Two of twelve tools never cached, 170 admissible uses no replay can serve.

**What the 166 buy.** Their published best component accuracy is `CA` 0.88 on Online Boutique and 0.70 on Train
Ticket, with `ECR` 0.15–0.46 — a leaderboard this engine has never been scored on. Building a `BenchmarkCase` from
`metrics.csv` with `alert.json`'s window as the injection time is the next iteration's work; no cell is claimed
here, and the numbers above are a denominator and an audit, not a score.

## 8. Scored, iteration 362: 156 cases, `CA@1` 0.5128, and the denominator is the Hard bucket

§7 fenced 166 cases and said the next iteration's work was a `BenchmarkCase` built from `metrics.csv` with
`alert.json`'s window as the injection time. That is now done, and the number exists:

```
case directories  754   scorable 156   refused: no-series 584 · no-alert-window 10
                                         truth-outside-alphabet 4 · truth-absent-from-series 0

cell                      cases    CA@1   Top@3   Top@5  ranked
boutique/performance         21  0.8095  0.9048  0.9524  1.0000
trainticket/performance      47  0.6596  0.7447  0.8085  1.0000
boutique/codedefect          88  0.3636  0.6364  0.8068  1.0000
all                         156  0.5128  0.7051  0.8269  1.0000
```

**`ranked` 1.0000 everywhere.** The truth is in every ranking, so the entire 34.9 pp of headroom is ORDER, not
recall. Any claim that this engine "cannot see" a cause on this corpus is now falsifiable against a pool of 15–51
services per case.

**The ablation.** `--no-inject-time` over the same 156 cases: 0.2885 overall (−22.4 pp), with
`boutique/performance` at 0.2857 (−52.4 pp) and `trainticket/performance` at 0.1915 (−46.8 pp) but
`boutique/codedefect` at 0.3409 (−2.3 pp). The alert window is the largest single contributor measured on this
corpus, and its contribution is concentrated exactly where the corpus's capture contains a healthy baseline.

**Why `codedefect` is a different quantity.** In **87 of its 88 cases** the fleet's mean `success_rate` bottoms out
BEFORE the alert window opens (median −105 s on a 230–265 s series): the capture starts inside the incident. A
`CA` computed against a baseline that is itself degraded is not the same measurement as one computed against a
clean baseline, and this file will not put them in one column without saying which is which.

**Two numbers this file must not let a reader conflate.** The corpus's `CA` is over all 550 Online Boutique and 204
Train Ticket cases — Table 5 best 0.88 / 0.70, Table 7 best 0.95 / 0.80 — and this engine's 156 cases are exactly
the Hard bucket (174, of which 18 carry no series, no window, or a `node/` truth). **0.5128 over 89.7 % of Hard**
is the honest statement; "0.5128 versus 0.88" is a denominator difference dressed as a capability one.

**And one hypothesis was tested and refused.** Replacing the window with a parameter-free data-defined t₀ (first
sample of the fleet mean `success_rate` below `median − 3 × 1.4826 × MAD`) moved 24 cases and produced +3.4 pp on
`codedefect`, −4.8 pp on `boutique/performance`, −2.1 pp on `trainticket/performance`, +0.6 pp overall. A transfer
that helps its own cell and costs three times as much elsewhere is a coincidence; the window stays.
