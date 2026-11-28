# The RCAtlas crosswalk: where this engine stands on the field's first unified benchmark

**Written 2026-11-13 (iteration 271), after reading `arXiv:2610.35767` from the primary source.** Every third-party
number below is quoted from that paper's Table 3 and Table 7 and is labelled with the population it was taken over.
Every number of ours is quoted from `docs/sota-comparison.md` §1 at the run it names. No figure in this document is
an average of two populations, and none is a comparison the paper itself would admit.

## 0. Why this document exists

Until October 2026 the field had no common evaluation: each RCA paper published its own corpus and its own
baselines, so "SOTA" meant "best on my data". `RCAtlas-Core` (Bi, Zhang, Li, Wang, Ma — Peking University and
BUPT, `arXiv:2610.35767`, 26 Oct 2026) is the first attempt to fix that. It takes **2 359** released cases from
**eight** public sources, screens 542 with eight exclusion rules, keeps the **348** that pass, and samples **90**
across 23 scenarios and ten fault classes. Those 90 are the population every method in the paper is scored on.

That matters here for one reason: this repository's headline (`75.46 %` Top@1) is measured on **RCABench**, which
RCAtlas does not draw from at all, and its RCAEval numbers are measured on **735 cases** while RCAtlas draws
**27** from the same suite. Neither of those is a comparison with the field. This document states what *is*.

## 1. The protocol, stated exactly, because the differences are where false SOTA claims live

| element                 | RCAtlas rule                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| answer                  | a **ranked list of candidate entities**; at most the first **five** distinct entities are scored                                             |
| upward mapping          | before matching, each answered entity is replaced by itself and its parents (container → pod → service) **at the level the dataset annotates**, deduplicated |
| labels                  | one root-cause entity per case (three cases have two); levels are **service 59 / pod 20 / node 11**                                            |
| PR@1                    | `(1/N) Σ 1[∃g ∈ Tᵢ : rᵢ(g) = 1]` — the share of cases whose **first** answer is a root cause                                                            |
| RR                      | `(1/N) Σ (1/tᵢ) Σ_{g∈Tᵢ} 1/(1 + max(0, rᵢ(g) − tᵢ))`                                                                                        |
| no answer               | scored **0**, not dropped: an abstention is not excluded from the denominator                                                                          |
| budget                  | one hour per case                                                                                                                                       |
| random floor            | exact random-guess hit rate per case ranges 0.25 %–16.7 %, **median 3.45 %**; a uniform random ranking scores PR@1 **5.5 %**                     |

Two consequences that are easy to miss and that this repository has to honour in any future entry:

1. **The presentation window is five, and only the first position is scored.** RCAtlas pays for *ordering*, not for
   width. A sixth candidate is worth nothing under PR@1 and something under RR. That is the same conclusion
   `docs/agentic-headroom.md` §10 reaches from the other direction: a wider window is only worth paying for if
   something reorders it.
2. **The upward mapping is generous to pod-level answers on service-level cases.** A method that names any pod of
   the right service is credited with the service. This repository's engine answers at service granularity, so the
   mapping is the identity for it on the RCABench and RCAEval families — but it is *not* the identity on the
   pod-annotated sources (LEMMA 5 cases, AIOps 2022 3, AIOps 2025 3), where a service-level answer has no pod to
   map upward from and therefore cannot be credited by the same rule. Any entry we make must report those cells
   separately rather than average them away.

## 2. The published field, as printed

Non-LLM methods (Table 3 / Table 7, 90 core cases):

| method         | PR@1 | RR   | service (59) | pod (20) | node (11) | RCAEval (27) |
| -------------- | ---- | ---- | ------------ | -------- | --------- | ------------ |
| NSigma         | 38.9 | 47.5 | 33.9         | 55.0     | 36.4      | **59.3**     |
| TORAI‡         | 33.3 | 46.8 | 35.6         | 40.0     | 9.1       | 63.0         |
| SimpleRCA      | 33.3 | 45.1 | 39.0         | 15.0     | 36.4      | 55.6         |
| BARO           | 22.2 | 31.7 | 25.4         | 20.0     | 9.1       | 44.4         |
| FaultInsight‡  | 18.9 | 29.7 | 24.3         | 5.0      | 15.2      | 28.4         |
| CIRCA          | 17.8 | 29.2 | 16.9         | 10.0     | 36.4      | 29.6         |
| RCD‡           | 5.9  | 10.5 | 5.1          | 3.3      | 15.2      | 0.0          |
| *random*       | *5.5*| *12.0*| *6.3*       | *3.6*    | *4.8*     | *7.1*        |

LLM families, same tables: **published agents** FoA 53.3 · RCAgent 49.3 · RCA-Agent 43.3 · DecompRCA 28.5 · mABC
15.6; **simple harnesses** Codex 77.2 · SQL agent 72.8 · one-shot 65.3 (three mid-tier models averaged).

‡ = mean over three passes. Table 7 reports each run's **first pass**, so its per-source cells need not reconcile
cell-for-cell with Table 3's three-pass averages — the paper says so, and this document does not average them.

The paper's own decomposition of *why* the non-LLM band is where it is: on **resource saturation** (34 cases) NSigma
reaches 62 %; on **errors, outages, configuration faults and network breaks** (33 cases) NSigma reaches **15 %** and
BARO 6 %, against 67 % for the SQL agent and Codex. Its stated mechanism is that NSigma and BARO score *signed*
maximum standardised deviation, so a service whose traffic **fell** ranks 372nd of 373 columns in the case the
paper dissects.

## 3. Ours, on the populations we actually hold

| benchmark                       | population            | metric                | ours                   | run                  |
| ------------------------------- | --------------------- | --------------------- | ---------------------- | -------------------- |
| RCAEval RE1–3 (the RCAtlas source) | 735 cases          | AC@1 = PR@1           | **85.44 %**            | `40792623427` @ `ea47db5` |
| RCAEval RE1–3, re-read          | 723 cases (12 without `metrics.json`) | AC@1  | **89.8 %**             | iteration 250        |
| RCABench (FSE'26)               | 1 422 cases           | Top@1                 | **75.46 %** (Top@5 87.83 %) | run `43276123043` |

**RCABench is not an RCAtlas source.** It enters this document only as context and is not used in any comparison
below.

## 4. The one comparison that is currently admissible, with its caveat stated first

RCAtlas draws **27 of its 90** cases from RCAEval RE1–3, and reports each method's PR@1 on that 27-case column. We
hold the **735**-case suite. So the honest statement is a **population-inequality**, not a head-to-head:

> On the suite RCAtlas sources 27 of its 90 cases from, this engine scores **85.44 %** AC@1 over **735** cases
> (run `40792623427`) while the paper's strongest non-LLM method scores **59.3 %** on the **27** it selected, its
> strongest published agent 66.7 %, its one-shot harness 79.8 %, and its SQL agent 94.2 %.

Every clause of that sentence carries its population. What it does **not** license:

- it does not license "we beat NSigma on RCAtlas", because the 27 are a diversity sample and the 735 include the 69
  cases the paper's own rules reject as having an unclean before-period, plus 38 with incomplete data;
- it does not license "we beat the one-shot harness", for the same reason, and because that column is an average
  over three mid-tier models on the 27;
- it does not license a claim about the pod or node levels, where our engine's service-granularity answer cannot be
  credited by the upward rule at all.

The direction of the selection bias is **not known** and is not guessed here. The paper's sample is deliberately
diverse across *hard* scenarios (it minimises per-scenario coverage before diversifying), which if anything makes
its 27 harder than a uniform draw from the 735; but that is an argument, not a measurement.

## 5. What entering the table would take, and what is blocking it

The core set's **case list** is distributed, the **converted data is not**:

| artefact                        | status                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `cases/core90_cases.csv`        | released — per case the source-dataset id, time window, data kinds and answer template            |
| `cases/core90_labels.json`      | released — the 90 labels and their levels (59 service / 20 pod / 11 node)                          |
| `methods/`, `prompts/`, `rcatlas/` | released — the three harnesses, our reimplementations of FoA/RCAgent/DecompRCA/SimpleRCA     |
| converted core-set data (~11 GB) | **not yet released** ("we plan to release"); the extended ~500-case set likewise               |
| distribution                    | a single `ufile.io` package link; no repository, no digest, no per-file access                    |

So the only faithful path is: obtain the case list, rebuild the 90 cases from their eight public sources through
the same conversion the paper describes (one inventory per case plus metrics, traces, logs and Kubernetes events in
UTC, with injection-tool traces removed), and score with the upward mapping. For the **27 RCAEval cases** that is
tractable *today* — we hold RCAEval RE1–3 in full — and it is the cheapest way to turn §4's inequality into a
head-to-head. It requires exactly one artefact we do not have: the list of 27 case ids with their windows. Rebuilding
RCAEval's 735 cases under RCAtlas's eight exclusion rules from the paper's *descriptions* would be a
re-implementation of the sample, not the sample, and is refused as evidence.

**Recorded as P0 for the next iteration**: fetch the package once (a browser-driven download, not an automated gate
bypass), verify `core90_cases.csv` against Table 1's per-source counts (6/9/5/5/14/12/12/27), and admit the 27 into
the nine-cell battery as a tenth cell with the upward mapping applied.

## 6. What this changes about the roadmap

1. **The depth/ordering axis is now externally motivated.** RCAtlas pays only for the first answer, so the entire
   remaining headroom is *ordering*, which is exactly the axis `docs/depth-reranking-preregistration.md` opened. A
   wider presentation is worth nothing to PR@1 on its own.
2. **The 33-case group is the field's common blind spot, and it is ours too.** Non-LLM methods score 15 % there
   because they read magnitudes and signs carelessly; the LLM harnesses score 67 % because they read logs, traces
   and events. This engine already reads logs and traces as separate terms, so the group is a *measurable* target:
   RCABench's own families include the same shapes (`HTTPResponseReplaceCode`, `NetworkPartition`,
   `NetworkCorrupt`), and `docs/agentic-headroom.md` §10.6 shows two of them with 5→20 window gains of +4 pp and
   +26 pp respectively.
3. **A zero-token entry into this table is a claim no LLM paper can make.** Cost is a first-class column in
   RCAtlas (Table 8), and every Pareto-optimal run in the paper's cost/time frontier uses an LLM call. A
   deterministic engine at 85 % on the RCAEval source, at zero tokens and milliseconds per case, is a different
   point on that frontier rather than a worse one.
