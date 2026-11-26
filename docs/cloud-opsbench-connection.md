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

## 9. Iteration 363: the graph arm, the neighbour arm, and the name

### 9.1 The graph this corpus was scored on was a ring, and the fix is a guard

`selectScorable` builds every case's `BenchmarkCase`, and that includes its call graph through `callGraphOf` →
`buildSystemCallGraph`, which falls back to a RING when the topology registry is not initialised. The runner
initialised the registry after the selection, so all 156 cases of §8 were scored on a ring while this file's §6 and the
module's docblock both claimed the graph builder was shared with the RCAEval cells.

Two things changed. The order is fixed (`initRCAEvalTopology()` runs before `loadSelection`), and `callGraphOf` now
**throws** when a registered system's graph would be the ring fallback — a precondition that can be checked rather
than a comment that can be missed. `benchmarks/__tests__/cloudopsbench-topology-guard.test.ts` asserts the refusal,
in a file with no initialisation, because module state is per file.

### 9.2 What it cost: nothing, and that is the finding

`--topology ring` is now an arm of the runner, so the two graphs can be compared on the population rather than
argued about:

| arm | cases | top-1 moved | truth rank moved | `CA@1` |
| --- | ---: | ---: | ---: | ---: |
| `registry` (the deployment) | 156 | — | — | 0.5128 |
| `ring` (the ablation) | 156 | **0** | **0** | 0.5128 |

**Not one of 156 cases moves.** Every cell is identical to four decimal places. The defect was real, the docblock was
false, and the number it produced was correct — because the ordering on this corpus does not depend on the graph at
all. With `topoWeight = 0` by default and `topoDiscount` deducting only what a callee explains, a metric-only corpus
whose candidates all deviate is decided by the per-service anomaly term alone.

### 9.3 The neighbour arm: refused at both ends of the sign

§8's characterisation — half the misses lead with a neighbour — was priced as a reranker over the engine's own
published scores, `xᵢ′ = (1 − α)·xᵢ + α·mean_{N(i)} xⱼ`, with the within-case min–max scale making `α = 0` the engine
bit for bit and `α = 1` the neighbour-only baseline. The full tables, the Poisson-binomial null (38 observed against
22.21 expected, p = 0.0001), the symmetric 19 downstream / 19 upstream split, and both refusals are in
`closed-axes-register.md` §363. The two numbers worth carrying here:

- **neighbour-only scores 0.0577**, against 0.5 if the ordering were propagation and a 5.5 % floor for a random order
  of the same pools;
- **anti-propagation is the mirror and it crosses**: +6.8 pp on `boutique/codedefect`, −21.3 pp on
  `trainticket/performance`, +0.6 pp overall at p = 1.0000.

### 9.4 The name collides with a different benchmark, and this file must say so

"CloudOpsBench" is also the name of a 45-task **AWS DevOps agent** benchmark (University of Michigan, v1.0, Apache
2.0) whose published leaderboard is `claude-fable-5-1` 60.6 %, `gpt-6-astra` 58.9 %, and so on, and whose metric is
the fraction of infrastructure tasks an agent completes. That benchmark shares a name with this corpus and nothing
else: it publishes no component accuracy, no joint score and no case directory with a `metrics.csv`. A reader who
puts this engine's **0.5128** beside that **60.6 %** would be comparing a location rate with a task-completion rate
on two different populations. This file's §4 anchor — `CA` 0.88 / 0.70 and `JRA` — belongs to the corpus this
repository reads, not to that one.

### 9.5 What is left on this corpus, and where it is

Not the topology (§9.2), not the propagation (§9.3), not the alert window (§8), and not the closure axis (§361's
reach: 0 of 754 cases). What is left is the anomaly measurement itself — which metric, over which window, against
which baseline — and the tool that answers it term by term already exists (`benchmarks/src/miss-anatomy.ts`), has
never been run on this corpus, and costs CNY 0.00.

## 10. Iteration 365: which candidate the flag paid, and the one arm that moves the score

§9.5 named the remaining headroom as the anomaly measurement, and §364 then counted it: 61 of 76 misses decided by
`selfAnomalyLog1p` and 15 by `dualFamily`. This section closes the second of those fifteen.

### 10.1 The flag never found the truth alone

Reading the membership of both candidates a miss is about, off the ranking's own term row:

| cell | cases | misses | both paid | winner only | **truth only** | neither |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `boutique/codedefect` | 88 | 56 | 0 | 9 | **0** | 47 |
| `boutique/performance` | 21 | 4 | 0 | 2 | **0** | 2 |
| `trainticket/performance` | 47 | 16 | 1 | 4 | **0** | 11 |
| **all** | **156** | **76** | **1** | **15** | **0** | **60** |

The zero column is the result. `truthOnly` — the flag paying the answer and not the symptom — **never occurs in this
corpus**, while 15 of the 16 misses the term participates in have it paying the symptom and excluding the answer. And
on 103 of 156 cases (66.0 %) the family is empty, so the term cannot participate at all.

### 10.2 The weight is refused in both signs; the gate is not a weight

| weight | all | gained | lost | exact p |
| ---: | ---: | ---: | ---: | ---: |
| 0.5 / 1.0 | 0.5000 | 0 | 2 | 0.5000 |
| **0.25 (shipped)** | **0.5128** | — | — | — |
| 0 | 0.5192 | 5 | 4 | 1.0000 |
| −0.25 | 0.4744 | 7 | 13 | 0.2632 |
| −0.50 | 0.4231 | 7 | 21 | **0.0125** |

Upwards the term only breaks cases; downwards it is a coin, and discounting a member is significantly worse than
shipping it — because 64.3 % of paid winners **are** the truth, so a penalty charges the answer for every symptom it
discounts. What the weight cannot do, the membership threshold can:

| gate (`channel`) | `CA@1` | `Top@3` | `Top@5` | gained | lost |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.02 | 0.4872 | 0.7179 | **0.8846** | 6 | 10 |
| **0.08** | **0.5513** | **0.7564** | 0.8590 | 8 | 2 |
| 0.10 | 0.5449 | 0.7500 | 0.8462 | 7 | 2 |
| 0.15 | 0.5321 | 0.7244 | 0.8205 | **3** | **0** |
| **0.25 (shipped)** | **0.5128** | **0.7051** | **0.8269** | — | — |
| 0.40 | 0.5128 | 0.7051 | 0.8141 | 3 | 3 |
| 0.75 | 0.5256 | 0.7051 | 0.8141 | 5 | 3 |

`0.08` is the maximum of `CA@1` and of `Top@3` and the only arm whose `CA@1` is at or above the shipped value in every
cell; `0.15` and `0.20` never lose a case. Both halves of a disjoint split improve at `0.08` (0.5128 / 0.5897 against
0.4872 / 0.5385) and at `0.15`. `Top@5` peaks elsewhere (gate 0.02, 0.8846, where `CA@1` collapses to 0.4872) — a wider
family flattens the head of the ranking, so the gate moves a fixed budget of order between ranks rather than buying
accuracy in general.

### 10.3 Why the default did not move

Shipping 0.08 would move `benchmark-rcaeval.yml`'s nine cells and the FSE'26 panel, and this iteration measured
neither; the shipped 0.25 is the enrolment that bought RE1 +4 / RE2 +9 / RE3 +6 / FSE'26 +4.1 pp there. A corpus-local
preference is not evidence against a cross-corpus enrolment, so 0.08 and 0.15 are **documented arms**
(`--dual-family-gate`, `--dual-family-gate-mode`) and the nine-cell A/B is the next iteration's first task.

### 10.4 One methodological result worth carrying to every axis

The harmful cell's pairwise gap — the weight that would put the truth first — says 9 of 15 cases sit inside the shipped
0.25. Turning the term off flips **5**. The four missing repairs are cases where removing the winner's bonus does not
hand the case to the truth but to whichever candidate was **third**: a pairwise gap is necessary and not sufficient, and
a probe that reported "9 repairable" from the budget alone would have promised repairs the axis cannot deliver.

## 11. Iteration 366: the engine's own margin is the gate, and the first significant gain

§10 left one axis open — the anomaly measurement — and one number unexplained: every arm this file has priced
(neighbour propagation, the alert window, the gate's high end, the raw label prior) lifted one cell and charged
another. This section shows the four reversals share a cause, and prices it.

### 11.1 The cause is the ranking's own margin

| cell | median `top1 − top2` | cases with a gap below 0.05 |
| --- | ---: | ---: |
| `boutique/performance` | 0.5294 | 4.8 % |
| `boutique/codedefect` | 0.1376 | 29.5 % |
| `trainticket/performance` | **0.0102** | **74.5 %** |

`trainticket`'s score is held by a head separated by one hundredth of a point; three quarters of its cases are
separated by less than 0.05. Every external term is larger than that, which is why that cell is the payer in every
table this file has printed. A deployment does not know its cell and always knows this margin.

### 11.2 The prior, and the honest floor it needs beside it

Ranking a case's candidates by how often each was the labelled root cause elsewhere in the same system — leave-one-out,
no telemetry — scores `CA@1` **0.1731** overall against a uniform floor of 0.0525 (pools average 25.8 candidates), and
**zero** on both `performance` cells, whose labels are spread over 11 and 18 services. So this engine's 0.5128 is
**33.9 pp above a telemetry-free ranker**: the score is telemetry, not a prior.

One weakness that baseline exposes: on `codedefect`, where only **four** services are ever labelled, the prior reaches
`Top@5` **1.0000** while the engine reaches **0.8068**. Four candidates fit into five slots, and the engine misses that
ceiling. `Top@5` has never been priced on this corpus; it should be.

### 11.3 Ungated it swaps cells; gated by the margin it does not

`score′ = score + β · log p` moves `codedefect` from 0.3636 to **0.5795** at β = 0.2 and `trainticket` from 0.6596 to
**0.1915** at the same weight. Adding the margin gate (the prior speaks only when `top1 − top2 ≥ τ`):

| `β` | `τ` | scope | all | half A | half B | gained | lost | exact p |
| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **no prior** | — | — | 0.5128 | 0.4872 | 0.5385 | — | — | — |
| 0.1 | 0.02 | system | **0.5769** | **0.5256** | **0.6282** | **11** | **1** | **0.0063** |
| 0.05 | 0.02 | system | 0.5577 | 0.5128 | 0.6026 | 7 | **0** | 0.0156 |
| 0.1 | 0.02 | cell | **0.5833** | 0.5256 | 0.6410 | 11 | **0** | **0.0010** |
| 0.2 | 0.05 | cell | 0.5769 | 0.5128 | 0.6410 | 10 | **0** | 0.0020 |

**`β = 0.1, τ = 0.02` on the system scope is deployable and significant**: +6.4 pp, 11 gained against 1 lost,
p = 0.0063, both disjoint halves up, `trainticket` **exactly unchanged**, `codedefect` +12.5 pp. The `cell` scope is the
ceiling (0.5833, zero losses) and not a configuration, because the category is the label being predicted.

### 11.4 What this does not establish

The prior is estimated from the same corpus's labels, leave-one-out — the deployable analogue of "this system's past
incidents", and **not** evidence that it transfers to a corpus with a different label distribution. No default moved:
the arm lives in `benchmarks/src/run-margin-prior.ts` and shipping it needs a new engine term, a CLI flag, the 25-input
dispatch budget, and a green nine-cell A/B. That A/B is the next iteration's first task, as the gate's was.
