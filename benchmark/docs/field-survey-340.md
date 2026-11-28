**Iteration 340 · 2026-11-24 · the field check, and what it changes in the queue**

# Field survey: four movements since 339, one of them a new benchmark family

Every iteration re-reads the field. This one found four items that change what the project should do next, and three
that do not. The pattern is worth stating before the items: **the field is converging on the two refusals this
register already made** — retrieval is nearly solved on microservice corpora, and a graph built on a short fault window
does not beat a statistical baseline — while **opening one front this repository has not entered**: process-scored
benchmarks with causal-chain ground truth.

## 1. DecompRCA reached v2, and its microservice half now has the weight of an accepted paper

| item | status |
| ---- | ------ |
| `arXiv:2609.36686v2` (2026-11-17) | accepted, **NeurIPS 2026 Evaluations & Datasets Track** |
| code | `github.com/cruiseresearchgroup/DecompRCA`, public |
| their microservice claim | "retrieval is nearly solved (**98–100 %**)" |
| their graph claim | "graph-based methods **never clearly beat the best statistical baseline**", whether the graph is learned on a short fault window, on a retrieved pool guaranteed to contain the cause, or on multi-day normal data |
| their largest effect | **+7 … +18** points from "a short **system-description document**" when every method ranks the same retrieved candidates |

Three readings follow, and the third is the one with money behind it.

1. **`abs 0` is now a published result, not our instrument's opinion.** Iteration 339 measured `abs 0` on all nine
   cells — every miss is a depth miss — and DecompRCA reports the same shape from a different benchmark family with a
   different instrument. Two instruments that share no mechanism agreeing is the strongest corroboration this register
   has recorded for a claim it made first.
2. **Our causal graph survives their result, and the reason is a distinction they do not draw.** Their graph is built
   on a *fault window*; ours is built on the corpus's own topology plus a containment order over the failing edges
   (`applyResolver`, `containmentOrder`). Their statement is about **learned** causality from a short window, which is
   the construction §264's audit already refused on arithmetic grounds. This does **not** refute them; it locates the
   disagreement, and the location is testable: the same ablation they ran (`no causal graph`) is `topoWeight = 0` here.
3. **The +7 … +18 is a pricing question, not a modelling question.** Their gain comes from a **hand-written** system
   description. Our derived brief (arm T) moved **+1** (`1 166` vs `1 165`). The gap is therefore not the reranker — the
   reranker is shared — it is the **document**. The open item from 339 stands exactly as written: settle whether
   *purpose* is derivable from this corpus, at ¥0, before buying anything.

## 2. RCAEval shipped the decomposition as an official flag, which changes what "comparable" means

The benchmark repository's own change log (Sep 2026) adds:

> `main.py --report-decomposition K` prints **Retrieval@K** and **Rerank@1** beneath each `Avg@5` … the
> retrieval–reranking decomposition of *Where Root Cause Analysis Fails* (NeurIPS'26).

and, in the same release, `--report-chance`, which prints `Chance@5` and `Lift@5` — an opt-in chance-level baseline
contributed through a pull request.

| what this means | consequence for us |
| --------------- | ------------------ |
| the decomposition is now a **published metric of the benchmark we report on** | our `abs 0` reading must be re-expressed in their two numbers (`Retrieval@K`, `Rerank@1`) so a reader can compare without translating |
| the chance floor is now **official** | 339's `uniformFloor` and their `Chance@5` are the same quantity; ours is computed from `truthRank` + `pool`, theirs from the candidate set, and the two must agree or one of us is wrong |
| both are **free** | no dispatch is needed to print either |

This is the cheapest item in this survey and the one most likely to be quoted against us if we do not do it: a
competitor's benchmark now prints two numbers we can compute from artifacts we already hold.

## 3. A new benchmark family entered the field: process-scored, causal-chain ground truth

Alibaba's **BRiSE / RCA-100 / AIOps2025** family (open-sourced with UModel under Apache-2.0) scores more than the
final answer:

| dataset | cases | modalities | ground truth | validation |
| ------- | ----: | ---------- | ------------ | ---------- |
| **RCA-100** | 103 | six (metrics, logs, traces, events, alerts, topology) | **3–4-step causal propagation chain with 661 numeric checkpoints** | Tianchi 2025, 5 532 teams |
| **AIOps2025** | 400 | three | per-modality key observations | CCF AIOps 2025, 561 teams |

Their scoring has three pillars — **Localization**, **Identification**, **Reason** — where `Reason` is two interlocking
metrics: *explainability* (share of expert-labelled checkpoints the agent's trace hits) and *efficiency* (a penalty for
bloated traces, explicitly to stop keyword-stuffing).

Two of their findings are already this register's findings under different names:

- **"Fault injections ≠ fault cases"** — many injections are masked by retries or autoscaling, or leave footprints too
  faint for a human expert. That is §335's `unwidenable 20` and §337's four refusal classes, measured on a different
  corpus.
- **62.5 % of cases need ≥ 2 modalities and 31 % need all three** — which is the arithmetic behind this register's
  refusal to score a single-channel arm against a multi-source one.

What is genuinely new to us is the **Reason pillar**. Every number this project publishes is an outcome; a
checkpoint-based score would grade the *transcript*, and our arm already writes one per case (`trace`, `calls`,
`toolCalls`). Whether that transcript carries the checkpoints is unmeasured here and cannot be measured on RCAEval,
which has no checkpoints.

## 4. The query interface is a measured variable, and it favours our design

Greptime's **Agent RCA Bench** (Sep 2026, 504 runs, six models, 14 incidents, public protocols and artifacts) holds the
model and the prompt fixed and changes only the interface:

| interface | correct | cost per investigation |
| --------- | ------: | ---------------------: |
| Prometheus + Loki + Tempo, tool wrappers | 105 / 168 | $1.09–1.12 |
| one SQL/PromQL surface over the same telemetry | **130 / 168** | **$0.59–0.60** |
| the same surface plus a semantic layer | 112 / 168 on component and edge faults, 12 / 24 on node faults | — |

They report 40 % fewer wrong diagnoses at about half the input tokens, and honestly note that only 3 of 12
pre-specified endpoints passed Holm correction — all of them input-reduction ones.

This matters to us for a reason that is not about their result: **our arm already queries one surface**, and
`buildTelemetry` is exactly the "unified interface" their arm re-implements. Their experiment is the ablation we have
never run — a *split three-pillar* interface against ours — and it is the first external evidence that the choice this
repository made for cost reasons is also the better one for accuracy.

## 5. What this survey changes, and what it does not

| queue item | before | after |
| ---------- | ------ | ----- |
| `--self-anomaly-weight 0.5` | ¥21, deferred | **¥0, refused** (iteration 340: `+0` on the published surface) |
| `fingerprint_top_k = 22` | ¥21 | ¥0, a file width |
| print `Retrieval@K` / `Rerank@1` in our own report | not on the queue | **new P1, ¥0, seconds** — the benchmark now prints it, so we must too |
| check `uniformFloor` against their `Chance@5` | not on the queue | **new P1, ¥0** — two independent definitions of one floor |
| settle whether *purpose* is derivable (arm T's gap to +7…+18) | ¥0, open | unchanged, and now the largest single gap in the field |
| run RCA-100 / AIOps2025 | not on the queue | **new, not yet priced**: needs a converter and a checkpoint scorer, which is a corpus question and not a weight |

**The honest summary.** The field has not overtaken us on accuracy: on the corpora we share, our published surface is
`93.39 %` and the competitor whose metric we can now compute publishes nothing that beats our `Avg@5` on any shared
cell. What the field has done is **change the scoreboard**: retrieval-vs-rerank is now an official column, the chance
floor is an official column, and a whole benchmark family grades the transcript rather than the answer. Two of those
three we can match this week for ¥0. The third is a corpus we do not have.
