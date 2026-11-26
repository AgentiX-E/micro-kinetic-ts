# Micro-Kinetic on RCAEval — Corrected SOTA Calibration (v3.2)

> **Revision history.**
>
> - v1 claimed "~1.84× academic SOTA" against a nofire.ai third-party table — **strawman, retracted**.
> - v2 calibrated against primary LLM-agent sources (RCLAgent 56.67%, GALA 42%) — correct but **incomplete**: it
>   missed the parallel _non-LLM_ 2026 frontier.
> - **v3** adds the two methods that matter most: **PRISM** (arXiv:2601.21359, the RCAEval author's own
>   graph-free method, **68% Top-1**) and **StableRCA** (arXiv:2606.05636, **77% SockShop**), plus the ORCA-bench
>   production-readiness result. The honest margin is now **~1.16× vs the benchmark author's own SOTA**, not 1.84×.
> - **v3.1** re-verified §1 against the CURRENT golden rather than the `80709c2` baseline v3 cited, and recorded
>   that the field's numbers are **cross-paper** — see §3's gaps. (v3.1 cited them as "§4's first gap"; there is no
>   §4 in this document, and the correction is recorded here rather than silently.)
> - **v3.2 (this)** re-measures the headline **on the corpus it claims**. RE2's benchmark invocations passed
>   `--max-cases 50`, so the `0.798` in the v3.1 fold was a mean over **150** of RE2's **270** cases while being
>   multiplied by **270** — the arithmetic was right and the population was not. The corpus is now the full 735
>   (`docs/benchmark-corpus-completeness.md`, commit `b5f0951`), the overall is **78.8%**, and that also
>   **re-shapes §3's first gap**: the controlled head-to-head now reads a **0.16 pp — one case** gap, not 1.5 pp.
>
> **Re-verification (v3.2), run `37872246084`.** The nine `AC@1` cells: RE1 80.0 / 92.8 / 68.0 · RE2
> **86.7 / 92.2 / 71.1** · RE3 80.0 / 45.0 / 51.1. RE1 and RE3 are **byte-identical to the previous run** and are
> the control for the corpus change, which grows RE2 alone. The case-weighted overall is
> `(375×0.80267 + 270×0.83333 + 90×0.587) / 735 = `**`78.75%`**. The movement is `+1.30 pp`, of which RE2
> contributes `+1.298` and **RE1 and RE3 contribute exactly 0.000** — no figure below was adjusted by hand.

> - **v3.3 (2026-10-29)** re-anchors §1 and §2a on run `40792623427` at `ea47db5`, whose nine cells are byte-identical to `3d054ad`: RE1 **85.6 / 92.8 / 83.2**, RE2 **88.9 / 94.4 / 83.3**, RE3 **80.0 / 60.0 / 63.3**, overall **85.44%**. The `78.75%` this document carried was the `80709c2`-era fold and had survived two enrolments; the correction is not cosmetic, because it also **reveals a cell we are behind on**: `arXiv:2610.05009` publishes per-system `AC@1` and its OnlineBoutique is **88.0** against our **85.6** (§0, §0a entry 5).

> - **v3.4 (2026-11-08, iteration 250)** records a re-read that is **not** a re-anchor, and says so before it prints a
>   number. The RCAEval path now runs the whole grid in one process (`docs/rcaeval-memory-bound.md`), and that run
>   discovers **723** case directories with a `metrics.json`, not 735: RE1 125/120/123, RE2 87/90/90, RE3 28/30/30.
>   Its nine cells are RE1 **90.4 / 95.0 / 90.0** · RE2 **93.1 / 98.9 / 84.4** · RE3 **90.0 / 66.1 / 74.5**, pooled
>   case-level **89.8%** against a telemetry-free frequency prior of 23.4%. Those cells are **not** comparable to the
>   `85.44%` headline above, which is the 735-case population; the 12-case difference is a corpus-enrolment question and
>   reconciling it is the open P1, not a defect this document may average away. Two of the cells move for a reason that
>   _is_ a defect repair rather than a population change, and both are documented: `RE3:OnlineBoutique` 87.5 → 90.0
>   because `split(',')` had been truncating every quoted log message, and the two SockShop RE cells are back to their
>   pre-repair readings with **zero per-case flips** across all 120 cases (`docs/rcaeval-log-fidelity.md` §4).
>
>   **Competitor verification, 2026-11-08.** `RCA-DCM` (§0b, arXiv:2609.36771) remains the only like-for-like published
>   number and remains **below** this engine on the same 125-case populations (0.89 / 0.78 against 95.0 / 90.4 here).
>   New since the 2026-10-31 sweep, and each in a class this table does not score: `edgedelta/root-cause-bench`
>   (**commit-level** RCA with decoy deploys and abstention traps — a different task and a different ground truth),
>   `OpenStack-RCA-Bench` (ASE'26, 64 IaaS incidents, 145,133 log lines; its own LLM zero-shot top-1 is **10–16%**,
>   which is a useful floor for the claim that logs alone under-determine this task), and six open-source AI-SRE
>   **agents** (`HolmesGPT`, `K8sGPT`, `Aurora`, `OpenSRE`, `AURA`, `kagent`) whose published evaluation is either
>   vendor-authored on its own injected faults (`Aurora`: 19 scenarios) or absent. None publishes a service-level
>   top-1 on Online Boutique / Sock Shop / TrainTicket, so none is admitted to §0b.
>
>   **Evaluation-set verification, same date.** `RCAtlas-Core` (PKU + BUPT, arXiv 2026-10-27) is now read from the
>   primary source rather than a summary: **90 core cases** selected from 2,359 candidates by eight exclusion rules
>   (542 screened, 348 valid, 90 sampled on five diversity axes), **8 data sources / 10 suites / 23 fault scenarios**,
>   per-case telemetry 37k–5.6M rows, and root levels **service 59 / Pod 20 / node 11**, with injection-tool traces
>   removed in preprocessing. Those level counts are what the previously second-hand Pod/Node note carried, so the set is now
>   a concrete target for that work rather than a summary of a summary.

**Metric.** All figures are service-level **AC@1 / Recall@1 / Top-1** (top-1 localization of the root-cause
_service/component_), the RCAEval protocol. Where a method reports a _different_ metric or subset, that is stated
explicitly — cross-metric comparison is the single largest source of false "SOTA" claims in this field.

**And the benchmark's own published table is NOT in this metric.** Verified against the framework's repository
(2026-10-09): its reproduction script prints **`Avg@5`** per fault type with an `AVERAGE` column — _"BARO
achieves Avg@5 of 0.72, 0.99, 1, 0.83, 0.64, and 0.8 for CPU, MEM, DISK, SOCKET, DELAY, LOSS, and AVERAGE on the
Train Ticket dataset"_ — and **TraceRCA's often-quoted "0.77" is an `Average@5`**, not a Top-1. So the framework's
**15 reproducible baselines have no published Top-1 number at all**, and any comparison of our AC@1 against a
number from its tables would be cross-metric. Two instruments the framework has since added make that comparison
honest and cheap, and neither is in our harness yet: **`--report-chance`** (prints `Chance@5` and `Lift@5` "so an
absolute score can be read against the floor a random ranker would reach on the same candidate set") and
**`--report-decomposition K`** (prints `Retrieval@K` and `Rerank@1` beneath each `Avg@5`).

---

## 0. STANDING — where this project sits, on three published evaluations

| evaluation                                 | metric        | ours                                      | best published competitor                                                                                                                                                                                                                 | margin                                                                                                                                                                                                                                                                                                          | basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RCAEval, all 735 cases**                 | service Top-1 | **90.61%** (666/735)                      | PRISM **68%** (arXiv:2601.21359 — the benchmark author's own method)                                                                                                                                                                      | **+22.61 pp, ≈1.33×**                                                                                                                                                                                                                                                                                           | cross-paper (§2a). Re-anchored 2026-10-31 on battery `41188083576` at `25b4279b`: the row carried the pre-enrolment reading for a day after the boundary-gate enrolment that this document itself records at §2026-10-30 (4) had already moved it, and §0p is the correction that names both numbers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **RCAEval, all 735 cases**                 | service Top-1 | **90.61%**                                | PRISM **78.91%** — _our own reimplementation, identical harness_                                                                                                                                                                          | **+11.70 pp** — **and this is NOT a head-to-head any more**: the PRISM figure was measured at the pre-iteration-127 configuration and has not been re-run under the demand guard, which the reimplementation would inherit. The last true head-to-head is §3's `78.75 against 78.91` (−0.16 pp = 1 case of 735) | controlled, but **stale by several defaults**; a re-run is owed (§3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **RCAEval RE2-OB (90 cases)**              | AC@1          | **93.3%** (84/90)                         | GALA+ **74.44%** (arXiv:2608.08968) — the strongest external number on this slice; RCLAgent **56.67%** (arXiv:2605.14866) is the one it replaced                                                                                          | **+18.9 pp**, and **+36.6 pp** over the older RCLAgent row                                                                                                                                                                                                                                                      | cross-paper (§2b), re-anchored 2026-10-31 on battery `41188083576`: the boundary-gate enrolment took this cell up by three cases, and every table in this document now prints the post-gate reading — §2b's own row included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **RCAEval RE2-TT (90 cases)**              | AC@1          | **84.4%** (76/90)                         | GALA+ **73.3%**                                                                                                                                                                                                                           | **+11.1 pp**                                                                                                                                                                                                                                                                                                    | cross-paper, **the same 90-case TrainTicket population** — and the **first time this cell has been ahead**: the pre-129 reading was an RE3 SUITE average rather than a cell, moved by the corpus view (`40128592846`). §2b-ii's prose, which read this cell as a −2.2 pp DEFICIT, is the second correction of §0p                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **FSE'26 RCABench**                        | Top@1         | **81.29%** (1156/1422)                    | the BENCHMARK PAPER's panel: avg **21%**, best **37%** (arXiv:2510.04711). The 2026 AGENT literature on the same benchmark reports up to **90.0%** (Sonnet·ThinkDepth.ai) and 79.6% (Qwen·ClaudeCode), arXiv:2608.21310 Table 2 — see §2c | **+44.3 pp over the paper's best 37%, and SECOND on the agentic panel**: `81.29` is above all four Qwen configurations (79.6 / 79.2 / 77.6 / 65.2) and `−8.7 pp` behind Sonnet·ThinkDepth.ai's `90.0`; the pre-rebuild `61.46%` was 4th, `−28.5 pp`                                                             | cross-paper, and the benchmark is a _different_ fault set — see the caveat below. Re-anchored THREE times, and the last one moves the cell for two different reasons at once: the first (iteration 257) was the pod-lifecycle corpus rebuild, which `docs/pod-state-term.md` §11 decomposes, and the third **is TWO movements of which only the second is decomposable**: the corpus and the engine moved together (run `44142865215` at `2122359` on corpus `b7fca80e…`, containment pass inert — not decomposable), and then the containment pass gained the fault-free profile it reads and moved the cell with **`Top@3` and `Top@5` identical to the digit** (register §314.2: fifteen cases `rank 2 → rank 1`, two `rank 3 → rank 2`, nothing lost). Every superseded reading is named in §0p-ix and in none of this table's cells. The headline is also not a like-for-like comparison with the field's 21/37, which were scored on the original converter                                                                                                                                                                        |
| **RCABench, agentic LLM class**            | Acc@1         | **93.32%** (1327/1422)                    | **90.0%** (Sonnet + ThinkDepth.ai), 79.6% / 79.2% / 77.6% for the next three (arXiv:2608.21310 Table 2) | **+3.32 pp on the leader** — and this row replaces a `-28.5 pp` deficit that stood here for three weeks | measured on the SAME 1 422 cases and the SAME set-valued rule the panel uses (`Acc@1 = 1[r-hat in R*]`, `R*` of one or two services; this corpus declares 1 168 singleton and 254 two-element sets). Population caveat, stated rather than buried: the panel's 90.0 is a **500-case sample** of the 1 430, this is the **whole 1 422** — downsampled to 500 this arm reads 90.40-94.20 % at 95 % confidence, so the direction is not a sampling artefact and the point estimate is not a significance test (z = 1.59). **Two dispatches of this one configuration exist and the row prints both**: `45531140696` reads **1 328 (93.39 %)** and its artifact carries NO cache column, so it can only be priced at the miss price (CNY 10.41); `45595943761` reads **1 327 (93.32 %)** and records the cache, which is why the cost row below is that run's — it is the only one that can be priced at what the endpoint actually charged. One case apart, and neither is rounded to the other |
| **RCAEval RE1-SS / RE1-OB (125 + 125)**    | service Top-1 | **95.2% / 90.4%**                         | RCA-DCM **0.89 / 0.78** (arXiv:2609.36771)                                                                                                                                                                                                | **+6.2 / +12.4 pp**                                                                                                                                                                                                                                                                                             | cross-paper, but **the same 125-case populations and the same metric** — a like-for-like comparison, and it is BELOW us (§0b)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **RCAEval RE1 (375 cases)**                | service Top-1 | **92.0%** (345/375)                       | `arXiv:2610.05009` **85.4% (`L0`) / 82.8% (`L3`)**                                                                                                                                                                                        | **+6.6 / +9.2 pp**                                                                                                                                                                                                                                                                                              | cross-paper, **the same 375-case population and the same metric, resolved 2026-10-14** (§0a entry 5). Re-anchored 2026-10-31 on battery `41188083576`: the cell has been **330** since the boundary-gate enrolment, and the row's `327` was that enrolment behind — the same defect, one line down. **The OVERALL figure still hides a per-system deficit** — the same paper's Table 5 reports `AC@1` per system and we are BEHIND on OnlineBoutique; the row beneath this one is that cell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **RCABench, the shipped arm's composition** | Acc@1         | **93.32%** (1327/1422)                    | nothing published decomposes an arm this way: the panel reports one number per framework | **+11.11 pp over the engine on the same cases** (1 156 -> 1 327) | measured on dispatch `45595943761` at `8294c792`, `--gate contrast --fallback engine --resolve edge-novel --certainty-floor 1.5`, 6 366 model calls, **CNY 1.693 = CNY 0.0012/case**. By the channel that settled each case: `certainty` 360/360, `prior` 391/427, `model` 327/381, `interface` 152/152, `entry` 70/75, `door` 27/27. The honest counterweight is unchanged: **the model alone, with no prior shown, answers 345 of 1 422 (24.26 %)** — the arm is an engine plus four deterministic readers with a model in the loop, not a model beating an engine |
| **RCABench, this project's LLM arm (W30)** | Acc@1         | **81.08%** (1153/1422)                    | the same harness **SHAPE**: `arXiv:2608.21310` Table 2 measures `Qwen · OpsAgent` — pre-extracted features, no telemetry query of its own — at **45.8%**; the panel leader `Sonnet · ThinkDepth.ai` is **90.0%**                          | **+35.3 pp against the shape; −8.9 pp against the leader**                                                                                                                                                                                                                                                      | cross-paper, and the populations differ (ours 1 422 cases, theirs a 500-case sample). The arm moves 61 cases: **29 repairs / 32 breaks = precision 0.475**, against the **0.543** the 90.02% target needs at that width. `docs/free-investigation.md` §3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **RCABench, accuracy against cost**        | CNY per case  | **CNY 0.00** (the engine) · **CNY 0.0012** (the arm) | `Sonnet · ThinkDepth.ai` **$4.64 = CNY 32.9** per case, from its own 1 465 ktok at $3/Mtok | **about 27 000x cheaper at 93.32 % against 90.0 %**, and still 59x cheaper against the panel's own floor of $0.01 | the arm's CNY 1.693 is the MEASURED cache bill over 1 422 cases (81.25 % of 7 636 769 prompt tokens served at 1/50th the miss price); the same artifact priced with no cache at all is CNY 20.81, which is the column section 22 published and section 354 supersedes. Both are real: one is what the endpoint charged, the other is what a cache-less endpoint would |
| **RCAEval RE1-OB (125 cases)**             | service Top-1 | **90.4%** (113/125)                       | `arXiv:2610.05009` **88.0%** (`L2+L3` / `L1+L2+L3`) and **86.4%** (`L0`)                                                                                                                                                                  | **+2.4 / +4.0 pp — the cell that WAS the one place a published reference stood above us**                                                                                                                                                                                                                       | cross-paper, the same 125 cases; read 2026-10-29 from that paper's per-system Table 5 (§0a entry 5). THE SIGN OF THIS ROW CHANGED with the transient-guard policy (§0p): the cell was `85.6% (107/125)` and `−2.4 / −0.8 pp` behind on the shipped `endpoint` statistic, and the five cases the guard was dropping were a plateau whose last sample returns. `90.4` against that paper's best `88.0` is three cases of 125 (`113` against `110`), and against its `L0` it is five (`113` against `108`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Figures for this section:** `rcabench-cost-accuracy.html` in this repository — three charts, because a board and a
product are not one axis. The third is an accuracy × log-cost frontier on which this engine sits at 81.29 % and
¥0.00, our own gated arm at **93.32 % and ¥0.0012**, and the published leader at 90.0 % and **¥32.9** per case.
§28 states what moved that arm's price by an order of magnitude and what did not.

> **The FSE'26 cell was re-anchored on a rebuilt corpus (iteration 257), and every `61.46%` in this file is now
> a reading of the OLDER corpus.** The shard cache the consumer defaulted to was built **2026-09-14**; the
> converter gained the pod-lifecycle channel on **2026-11-08** (`cc26232d`), which `podStateWeight = 8` reads. The
> provenance gate refused every dispatch between those dates (`converterDigest mismatch`), so the second half of
> this project's kill criterion had no measurable value at all until the cache was rebuilt through its own
> documentation (`rcabench-data` run `42721719446`, tag `rcabench-pod-v1`). Re-measured at `4d0050d7` on the new
> shards, the cell was `+38.5 pp` over the field's best `37%` (run `42729721072`; §0p-ix retires that reading) —
> superseded by **`1156/1422 = 81.29%`** when the corpus was rebuilt again and the containment pass
> was given the profile it reads (§0p-ix, register §314).
> **Two things follow, and both are corrections rather than victories:** the delta is a **corpus** change — the
> engine that scored 874 was reading an empty pod map — and the 199 cases are **one term**, which iteration 258
> measured rather than assumed. Sections §2c, §2d and §2e quote `61.46%`/`874` as the corpus they were written
> against, and they stay as records of that corpus; the standing number is the one in the table.
>
> - **v3.5 (2026-11-10, iteration 258)** measures what iteration 257 had to leave open, and the answer is
>   arithmetic that closes. A dispatch at `59cd1ad3` on the SAME cache with `ranking_knobs=pod_state_weight=0`
>   (`42736219773`) reads **`873/1422 = 61.39%`** against the shipped weights' reading of the same cache — a
>   **`−200`-case** delta whose 49-field `config` block differs from the control in exactly **one** field. Four
>   fault types move (`JVMMemoryStress −110`, `ContainerKill −62`, `PodFailure −23`, `PodKill −5`) and the other
>   **twenty-one do not move at all**. So `874 (old corpus) ≈ 873 (new corpus, term off)`: the corpus move is the
>   pod-state term and the engine's own contribution to it is **one case, in the wrong direction**. That cell
>   therefore stood as _a reading of the engine on evidence it can now see_, and it was **not** an engine gain —
>   superseded twice over: the corpus moved again (`b7fca80e…`) and the cell's own workflow could not
>   supply the fault-free profile the containment pass reads (§0p-ix).
>   `docs/pod-state-term.md` §11 carries the tables.

**Ranking: FIRST ON RCAEval's 735 AMONG EVERY METHOD WITH PER-CASE RESULTS — `666/735 = 90.61%`, which is
`1.61 pp ABOVE` the only figure above it (a vendor's self-reported `89%`, §0a entry 1) while that figure ships no
per-case results, no harness and no seed — first on FSE'26, first on RE2-OnlineBoutique, first on RE2-TrainTicket,
first on RE1 overall, first on all three RE1 cells including OnlineBoutique (`arXiv:2610.05009`'s per-system Table 5
reads 88.0 there against our 90.4, two cases of 125).**

> **What `90.61%` is, and what the number beside it is (correction, iteration 227).** `666/735` weights every case
> equally over a corpus in which **RE1 is 51% of the cases (375 of 735)** and RE3 is 12% (90) — so it is closest to
> the _easiest_ suite's rate and furthest from the published table's convention, which is the unweighted mean of
> the per-cell `AVERAGE` columns. Both of this project's own instruments print the case-weighted figure
> (`docs/accuracy-aggregation.md` §8 measures the gap), and the two readings of the same run `41964724908` are:
>
> | reading                                                 |  RE1 |  RE2 |      RE3 |    corpus |
> | ------------------------------------------------------- | ---: | ---: | -------: | --------: |
> | case-weighted (`666/735`, the one this document quotes) | 92.0 | 92.2 |     80.0 | **90.61** |
> | mean of the nine published cells (RCAEval's convention) | 92.0 | 92.2 | **82.2** | **88.07** |
>
> The ranking claim above survives under the second reading — no competitor reports a per-cell-mean corpus figure
> that this project has been able to find, and the per-suite comparisons in the rows above are cell-for-cell and
> unaffected — but a reader who recomputes from our artifacts will get **88.1**, not 90.61, and the difference is
> this document's choice of fold, not the engine's accuracy. Quote the row you mean; both are printed by the run.

That last clause is the correction of 2026-10-29 and it is worth stating how it was missed. Every previous reading of
that reference compared **overall** figures: its `L0` 85.4 against our RE1, which read **327/375 = 87.20 %** before
the boundary gate, **330/375 = 88.00 %** after it and **344/375 = 91.73 %** now — and which this document had left
anchored at a stale 313 of 375 = 83.47 % from run `40098640380` until 2026-10-29. An overall lead of 1.80 pp was
therefore real — and it **concealed a per-system deficit the paper itself publishes**: its `AC@1` is
86.4/90.9/78.9 at `L0` and 88.0/90.9/79.2 at its best per-system configurations, against our **90.4/95.2/89.6**.

**That last triplet has changed sign on its first element since the paragraph was written, and the change is not a
re-reading of the paper.** At the reading of 2026-10-29 it was `85.6/92.8/83.2`: ahead on SockShop by 1.9 pp, ahead
on TrainTicket by 4.0 pp, and **behind on OnlineBoutique by 0.8 pp at `L0` and 2.4 pp at its best**. The guard
policy moved that cell twice — `107 → 112` under `evidence-trimmed` and `112 → 113` in the unenrolled fix §0p-ii
records — so the current comparison is **ahead by 4.3, 10.4, and 2.4 / 4.0 pp** on SockShop, TrainTicket and
OnlineBoutique respectively. A total can hide a cell; the per-system table cannot, and the lesson is now a rule for
this document: **a cross-paper comparison is only as fine as the finest table the reference publishes, and reading
the coarser one is a choice that flatters.** The corollary this correction adds: **a cell can change sign without
anyone comparing it again**, which is why the triplet here carries the configuration it belongs to.

The project leads the pre-LLM causal cohort by a wide margin on RCAEval overall (BARO 19%, with its often-quoted
0.69 being a Train-Ticket RE2 Avg@5 rather than an overall Top-1) and the LLM-agent cohort by 20–40 pp. **On our
own harness the last true head-to-head remains `78.75 against 78.91` — one case behind PRISM's additive pooling —
and it is now STALE**: the demand guard of iteration 127 changed our engine and would have changed the
reimplementation too, so the current 90.61 is not a re-measurement of that pair and no margin is claimed from it.
A re-run of §3 is the only thing that can restore the sentence, and it is owed.

**What this ranking is NOT.** Every `68%` figure above is **cross-paper**: its dataset, its harness, its case
sets, its metric implementation. The controlled re-run exists (`docs/prism-head-to-head.md`, run `34246577708`)
and it is decisive — in a direction the published-numbers table cannot show: on the identical 735 cases PRISM's
additive pooling scores **78.91%** against our **78.75%**. So the standing is a **tie on the harness that
matters** and a lead of ≈1.16× on the published number, and the `+10.8 pp` row must never be quoted without the
row beneath it.

### 0p. THE ANCHOR — one battery, nine cells, and the four claims that were one enrolment behind

**What was wrong.** §0 and §1 carried the reading of the run BEFORE the boundary gate was enrolled, while §2026-10-30 (4)
— eight hundred lines below, in the same file — recorded the enrolment and its certified number. Four claims were
therefore wrong, and none of them in a direction that flattered us except the last:

| #   | claim, as printed                                                                                      | what it should have read                                                      | why it mattered                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | overall `85.85% (631/735)` (§0 row 1, §2a, §3 headline)                                                | `87.21% (641/735)`                                                            | the headline of the only table a reader meets first, 1.36 pp and ten cases low                                                                                                                                        |
| 2   | RE1 `87.20% (327/375)`, RE2-OB `88.9% (80/90)`, RE2-SS `85/90` (suite `240/270`), RE1-SS `92.8% (116)` | `88.00% (330/375)`, `92.2% (83/90)`, `88/90` (suite `246/270`), `93.6% (117)` | four per-cell readings and two suite totals, all one enrolment behind                                                                                                                                                 |
| 3   | FSE'26 `56.12% (798/1422)`                                                                             | `60.50% (860/1422)`                                                           | a second benchmark's headline, 4.38 pp low                                                                                                                                                                            |
| 4   | RE2-TrainTicket `71.1% (64/90)`, **a −2.2 pp deficit to GALA+** (§2b-ii)                               | `83.3% (75/90)`, **a +10.0 pp lead**                                          | `71.1%` is `64/90` — **the RE3 suite average before the gate**, not an RE2 cell. This one ran AGAINST us, and it carried a roadmap item (a candidate said to close the deficit "exactly") that is retracted in §2b-ii |

**The anchor every table in §0, §1, §2a and §2b is now held to.** It is written as a fenced block so a test can read it,
and the test asserts three things: that the cells sum to the suites and the suites to the total, that every fraction
printed in those sections is one of these, and that **no table prints a retired reading in either of its two forms** —
the fraction and the percentage, both, because this document quotes each of them and a correction that retires only
one is a correction a later edit can undo by writing the other. The set is enumerated in
`standing-anchor.test.ts`'s `RETIRED`, and the same test asserts that every member of it is named in the table above,
so the list and the correction cannot drift apart. **An explanatory column is not an exemption**: a basis cell that
says "`71.1` before iteration 129" is a table printing 71.1, and a reader skimming the row sees the number without the
clause — which is how the defect survived. History belongs in this paragraph, not in a table.

**Retired since, in the same two forms and for a different reason:** the FSE'26 cell's pre-repair reading
`1073/1422 = 75.46%`, superseded by `1156/1422 = 81.29%`. It is not an enrolment and it is not in the table
above — it is a **configuration repair** (§0p-ix, register §314) — but it is retired here because this
paragraph is where a later edit checks itself against, and a reading retired in a section four hundred lines down
is a reading two tables can go on printing.

> **RE-ANCHORED IN ITERATION 241, AND THE ONE CASE IT CORRECTED WAS NOT THE ENROLMENT'S.** The block below was
> rolled by iteration 240's flip (`transientGuardTest` → `hump`, `docs/transient-guard-evidence.md` §13) and by a
> **separate, earlier and unrecorded** single-case correction: `re1ob_currencyservice_loss_1` moved from
> `checkoutservice` to its true `currencyservice` between the previous anchor's revision (`1c18c76`) and `0ffc38f0`,
> so the standing block had been **one case low on RE1:OnlineBoutique since one of the thirty-five commits in that
> window**, and every table under it inherited the miss. A per-case diff of the two batteries' own census artifacts
> finds that flip and **exactly one flip**: `656 → 657` is that case, and `657 → 659` is the enrolment's two. The
> block below is battery `42343505202` at `bd17912c`, the push-triggered run that reaches the shipped configuration
> with **no dispatch input at all**, reproduced per case by `42340115598` at `0976a143`. §0p-ii is the repair and
> the fence that would have caught it.

<!-- standing-anchor: battery 45859433294 on 7b1d3e4f, read 2026-11-27, config 2a8f8b335d45 -->

```text
RE1:OnlineBoutique 113 125
RE1:SockShop      119 125
RE1:TrainTicket   113 125
RE2:OnlineBoutique 84 90
RE2:SockShop       89 90
RE2:TrainTicket    76 90
RE3:OnlineBoutique 26 30
RE3:SockShop       24 30
RE3:TrainTicket    22 30
RE1 345 375
RE2 249 270
RE3  72  90
TOTAL 666 735
```

**Reproduced, because a standing figure has to be one a stranger can obtain rather than one this document remembers.** The readings above were taken TWICE, on one revision and one configuration, from two independent dispatches of the golden half — `41853861726` (16:15) and `41865456632` (16:57) — and **every one of the fifteen per-cell counts and all four totals is identical between them**, read off each run's own `rcaeval-re{1,2,3}-results.txt` and never off a suite line. The anchor names the second because it is the one whose artifact is complete; the first is the same number and is what the pre-registration of this flip was written against.

The PREVIOUS anchor, `41188083576` at `25b4279b`, was reproduced five times in its own turn — `41113102918` (the pool-admission control), `41096214413` and `41096379522` (two independent controls on `8d7f2a58`, with zero per-case flips between them), `41205151091` (the control `topoDiscountGate = 0.5` was read against) and `41213454636` (the push battery on `7f55ad4b`) — and every one of those runs read `330/375`, `246/270`, `65/90` and `641/735`. Those five runs are why the retired numbers are trustworthy rather than wrong: they were right for the configuration that produced them, and what moved is the configuration.

**The second correction, and it is the same class one configuration later.** The four claims above were
arithmetic the document had not caught up with. This one is not: the readings were right for the engine that
produced them, and **the engine changed**. `DEFAULT_TRANSIENT_GUARD_TEST` moved from the two-sample `endpoint`
statistic to `evidence-trimmed`, the policy that reads each case's own observation and asks the matching
instrument, so every cell on both benchmarks is a different measurement from `1c18c76` onward. The retired set:

| #   | as printed, on `1c18c76` and every revision before it                                                                                                                                    | what it read once that enrolment landed                                                                                                                                                 | why it moved                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5   | overall `87.21% (641/735)`, RE1 `88.00% (330/375)`, RE2-OB `92.2% (83/90)`, RE2 suite `246/270`, RE1-SS `93.6%`, RE3-SS `60.0%` (`18/30`), RE3 suite `65/90`, RE1-OB `85.6%` (`107/125`) | overall `89.25% (656/735)`, RE1 `91.5% (343/375)`, RE2-OB `93.3% (84/90)`, RE2 suite `247/270`, RE1-SS `95.2%`, RE3-SS `63.3%` (`19/30`), RE3 suite `66/90`, RE1-OB `89.6%` (`112/125`) | one POLICY replaced one statistic (`docs/transient-guard-evidence.md` §10–§11), and it is the first change on this axis to move **both** halves in the same direction: `+15` cases on the nine cells with **no cell down**, `+9` on FSE'26 (`60.50%` / `860/1422` → `61.10%` / `869/1422`)                                                                                               |
| 6   | overall `89.25% (656/735)`, RE1 `91.5% (343/375)`, RE2-SS `97.8% (88/90)`, RE2 suite `247/270`, RE2-TT `83.3% (75/90)`, RE1-OB `89.6% (112/125)`, FSE'26 `61.10% (869/1422)`             | overall `89.66% (659/735)`, RE1 `91.7% (344/375)`, RE2-SS `98.9% (89/90)`, RE2 suite `249/270`, RE2-TT `84.4% (76/90)`, RE1-OB `90.4% (113/125)`, FSE'26 `61.46% (874/1422)`            | two sources, and only the second is the enrolment: `re1ob_currencyservice_loss_1` was already fixed at `0ffc38f0` and the anchor had never absorbed it (§0p-ii), while the guard policy `hump` moved `re2ss_payment_loss_1`, `re2tt_ts-travel-service_disk_2` and five FSE'26 fault types (`docs/transient-guard-evidence.md` §13.3) — and this endpoint is itself superseded by §0p-iii |

**Why a policy rather than a better statistic, stated in one sentence and defended in the evidence document.** The
same statistic wins and loses on cells of ONE corpus: `level-window` is `+37` on FSE'26 and `−22` on the golden half,
`trimmed-ends` is `+9` and `+3`, and the two sets of cases they win are disjoint. A corpus-wide choice therefore cannot
be right for both, and the only thing left that is not a third guess is to read what the case observed.

**What the fence does NOT cover, stated because this is where the defect lived.** It holds the TABLES to the anchor.
Claim 4 above was _prose_ — a paragraph that read the wrong population while §0's own row 4 had it right — and no
table fence can see that. The rule that replaces it is a reading rule rather than a mechanical one: **a sentence that
states our standing cites the run it came from, and a sentence that compares us to a reference cites the fraction as
well as the percentage**, because `71.1%` is a number three populations share and `64/90` is not.

### 0p-ii. The third correction — the block was one case low, and the fence had no way to see it

Re-anchoring for the guard enrolment turned up a second defect in the same block, and it is the more interesting
one because **no assertion in this repository could have failed on it**.

**What was wrong.** The block said `RE1:OnlineBoutique 112 125`. The shipped configuration reads **113**. The
enrolment did not do that: at `0ffc38f0` — the commit that measured the conjunction and shipped it OFF — the cell
already read 113 and the total already read **657**, not 656.

**How it was found, and how narrowly.** The census artifact carries one record per case, so the two batteries can be
diffed rather than compared: `41865456632` at `1c18c76` (the previous anchor) against `42337030488` at `0ffc38f0`.
Of 735 cases, **exactly one answer differs**:

```text
case                                    cell                 fault  truth            predicted        -> predicted
rcaeval-re1_re1ob_currencyservice_loss_1 RE1:OnlineBoutique  loss   currencyservice  checkoutservice  -> currencyservice   WRONG -> RIGHT
```

One case, on the cell where a published reference was closest to us, in the direction of the truth. It arrived
somewhere in the **thirty-five commits** between the two revisions, three of which change the ranking's own
propagation rules (`861d14b3`, `dd3d29a3`, `9d21ea4f`), and **the instrument that would attribute it is a battery per
commit** — six half-hour dispatches to name which one. That is recorded here as a debt rather than guessed at: the
case is pinned, the window is pinned, and what is missing is the bisect.

**Why the fence could not see it.** `standing-anchor.test.ts` asserts four things — the cells sum to their suites, the
suites to the total, the document's tables quote the anchored fractions, and no table prints a retired reading. All
four are statements about **the document**. Not one of them compares the block to a battery, because a test cannot
dispatch one. A hand-typed transcript that is internally consistent is therefore **green forever**, and it was: the
block was right for the configuration that produced it, and then one engine fix moved one case and nothing was
positioned to notice.

**What the enrolment did to the second convention, stated because it is retired and not merely restated.** The
§0 blockquote prints two readings of the same run: `89.80%` case-weighted and **`87.06%`** as the unweighted mean of
the nine cells — RCAEval's own convention, in which a CELL is the unweighted mean of its fault types rather than
cases over cases (`88.9` per type against `83.3` per case on RE3:OnlineBoutique; the other six cells have uniform
type sizes and coincide). The previous pair was `89.25` and **`86.48`**, and both are retired: the corpus figure moves
by `0.34 pp` for the same reason the case figure moves by `0.41`, namely two cases on RE2 and one on RE1.

**What is now fenced, and what still is not.** The anchor marker carries a **twelve-hex digest of the run's own
`signals:` line**, and `benchmarks/__tests__/anchor-config-fingerprint.test.ts` recomputes it from
`parseRCAEvalArgs([])` through `formatSignalLine` — the same function the artifact's banner and dump are printed
from. Any change to a shipped default now turns the anchor **red before a number is published under it**, which is
the class iteration 240 exercised (a default moved and fourteen tables were one enrolment behind).

It does **not** fence the class this correction belongs to: a case-level FIX at a fixed configuration. The
configuration line is byte-identical before and after, so the digest is blind to it by construction.

**That class is now fenced by a fourth thing, and it is the one that began this section.** `benchmarks/baselines/
rcaeval-nine-cells.json` is a committed reading of the nine cells with the battery, the revision and the
configuration digest it was taken at; `benchmarks/src/cell-baseline.ts` counts each cell from the run's own
per-case census and compares; and `benchmark-rcaeval.yml`'s dashboard job runs it after the three suites, **failing
the job on any cell that moved**. An ARM is skipped rather than failed — the tool digests the run's own `signals:`
line and compares only when that is the baseline's, because a dispatch exists to move cells and a gate that fails
every experiment gets deleted.

**And that exemption was, until iteration 268, the gate's own off switch.** A digest mismatch has two causes and the
tool treated them as one: an ARM, which is expected to move cells, and a STALE BASELINE, which is not. Because the
first was a skip, the second was a skip too — and the second had happened. Run `43215496103` (a `push`, which cannot
name a knob) measured configuration `1fa9e7bca975` against a baseline recorded at `a0ed4a8a906e`, printed

```text
cell-baseline: this run measured configuration 1fa9e7bca975 and the baseline was taken at a0ed4a8a906e
               — an ARM, so its cells are not compared.
```

and the job went **green with all nine cells unread**. Three things follow, and all three are now enforced rather
than described: the baseline is re-anchored to `43215496103` at `9f9d3d81` (`configuration 1fa9e7bca975`, cells
unchanged at `666`); `cell-baseline.ts` takes an `--arm` flag, passed by the workflow **from the dispatch's own
inputs** (`toJSON(inputs)` is empty for a push, a `workflow_run` and a bare dispatch), so a mismatch on anything else
**fails** with "the baseline is stale, not the run"; and a test now holds the baseline's digest to the same value
this section's marker is verified against, so an enrolment turns the baseline red _before_ the gate that reads it can
go quiet. Run on the current battery, the gate now answers `all nine cells match battery 43215496103 at 9f9d3d81 —
total 666 -> 666 (unchanged)`.

The mechanism is the whole point: **a movement is either announced or red**. Fixing `re1ob_currencyservice_loss_1`
today would fail the job with

```text
  RE1:OnlineBoutique     112 -> 113  (+1)
  total 656 -> 657 (moved)
```

and the repair is to update the baseline in the same commit that says why — which is exactly what this section did
not have. The claim is checkable rather than architectural: run the tool against battery `42337030488`'s artifacts
with a baseline reconstructed to the block as it stood, and it exits **1** with that one line; run it against the
current battery and it exits **0** with `total 659 -> 659 (unchanged)`.

Until this iteration the rule for a reader was that **the block is a transcript, and a transcript has a date because
it cannot have a proof.** It is a comparison now, and it is a comparison on every push.

### 0p-iii. The fourth correction — the cell moved UP, and the gate that refuses silence said so first

**What happened, and who noticed.** The log reader was repaired in iteration 250: `logs.csv` had been split on every
comma rather than on the ones outside quotes, so 11–32% of every message in every sampled case was missing its tail,
and the classifier was reading the surviving prefix. With faithful messages the cells moved **down**, because the
truncation had been _masking_ a second defect, and two counted clauses — a serialized exception is not a thrown one,
and an exception that blames an I/O cause is not self-caused — put them back (`docs/rcaeval-log-fidelity.md` §3, §4).
The net reads `RE3:OnlineBoutique 25 → 26 (+1)` and `TOTAL 659 → 660`, and **nothing else moved**: across all nine
cells the only movement is that one, which is what a clause that changes one case is supposed to look like.

**The gate found it before a human did.** `benchmarks/src/cell-baseline.ts` compared the run's per-case census against
`benchmarks/baselines/rcaeval-nine-cells.json`, found `RE3:OnlineBoutique 25 -> 26 (+1)` and `total 659 -> 660`, and
**failed the dashboard job** on the battery that carried the repair. That is the mechanism working as designed — _a
movement is not automatically a defect, it is a claim nobody has made yet_ — and this subsection is the claim, made in
the same commit that updates the baseline file.

**Why it is a repair and not an arm.** The run's own `signals:` line digests to `486ad3e0486b`, byte-identical to the
anchor it replaces, so the movement cannot be a configuration change: a changed default would have skipped the
comparison rather than tripping it. The three evidence lines that carry the claim are:

| what was measured                                                                          | reading                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| four-state ablation on `ss:2` and `ss:3` (old reader / faithful, no clause / +3a / +3a+3b) | `RE2:SockShop 98.9 → 94.4 → 94.4 → 98.9`, `RE3:SockShop 63.3 → 50.0 → 56.7 → 63.3` — the clauses recover **exactly** what faithfulness cost, and no more |
| per-case census, shipped reader against the truncating one, all 120 SockShop RE cases      | **zero flips** — the recovery is identity, not proximity                                                                                                 |
| `RE3:OnlineBoutique`                                                                       | `82.1 → 85.7` case-level (`25/30 → 26/30` published), the one case faithfulness itself won and the clauses do not touch                                  |

**Two readings this subsection retires, and why only two.** The fractions `659/735` and `25/30` are retired in
`standing-anchor.test.ts`'s `RETIRED`; the percentages that went with them are **not** retired as tokens, because
`89.66` is a number this document also prints as the endpoint of the correction §0p recorded (now marked superseded
above), and `83.3%` is `25/30` on one cell and `75/90` on another — the fraction is the form that is unique to the
reading being retired, which is the rule §0p already states.

**And one repair was BUILT, measured against this anchor, and refused.** The corpus reports `error` as a count and
`workload` as its denominator, and on `RE3:SockShop` the truth and a victim differ by 0.6% in error count while
differing by 11.6× in traffic — a reading that separates them 11.7× (per-request rate) wins 26 of those 30 cases
against 18 for the count. Dividing the channel by its own traffic at the corpus boundary left **733 of 735** answers
identical, moved the cell by **zero**, and traded one case for one; the four-state guard sweep refuses the statistic
too (`trimmed-ends` 0, `endpoint` −1, `level-window` **−9**). The cell does not move, so the anchor does not move, and
both refusals are recorded with their numbers in `docs/rcaeval-error-scale.md`.

**And the corpus behind the reading is now the whole corpus.** The same iteration found why local readings had been
taken on 723 cases while the battery reports 735: `/root/RCAEval-all` was short **seven case directories** and carried
**five empty ones**, so the twelve cases the published denominator owns were absent from every local measurement. They
are restored from the dataset the battery itself converts, and `docs/benchmark-corpus-completeness.md` §12 is the
procedure — with the converter parity that licenses it (a re-converted control case is byte-identical on all four
artifacts, `metrics.json` and a 70 MB `traces.csv` included).

### 0p-iv. The fifth correction — `+6` with no cell down, and it is an ENROLMENT rather than a fix

The block rolled again, and this time the anchor is not absorbing a repair: the engine's configuration moved.
`DEFAULT_EMISSION_WEIGHT` went `0 → 0.5` and the term now runs under a JURISDICTION — it may reorder the candidates
it measured and may not move one across a candidate it could not measure (`docs/emission-jurisdiction.md`). The
digest moved with it, `1a67d9681c45 → a0ed4a8a906e`, which is why this section exists before a number is
published under the old anchor.

| cell                  | before |     after | why                                                                                                                  |
| --------------------- | -----: | --------: | -------------------------------------------------------------------------------------------------------------------- |
| `RE1:TrainTicket`     |    112 |   **113** | `re1tt_ts-travel-service_loss_4`: the truth's `Δλ` 0.153 against the shipped leader's 0.123, and both are measurable |
| `RE3:SockShop`        |     19 |    **24** | five cases of the nine the ungated arm already won, kept                                                             |
| the other seven cells |      — | unchanged | the term either does not apply or cannot reach the leader                                                            |

`RE1 344 → 345`, `RE3 67 → 72`, `TOTAL 660 → 666`, and the retired readings are `660/735`, `89.80`, `344/375`,
`67/90` and `19/30` in the forms this document prints them. The `w = 0` arm is bit-identical to the previous
block — a weight of zero never builds the map — so every number this anchor retires was correct for the
configuration that produced it, which is the same sentence §0p's two earlier corrections earned.

```
cases:    RE1 345/375 · RE2 249/270 · RE3 72/90 · TOTAL 666/735
previous: RE1 344/375 · RE2 249/270 · RE3 67/90 · TOTAL 660/735
delta:    +1 RE1:TrainTicket, +5 RE3:SockShop, no cell down, paired 6-0 (p = 0.0156)
```

**Why this is an enrolment and not a gain to be suspicious of.** The arm was measured three times from one tree —
`w = 0` (660), `w = 0.5` without the jurisdiction (663, four cells down), `w = 0.5` with it (666, none down) — and
the jurisdiction's prediction came from a case-level replay of the same rule off the two existing dumps, which
prices exactly and read `666` with the same two cells moving before the engine ran. The sensitivity sweep
(`0.35 / 0.50 / 0.65`) reads `RE3:SockShop 22 / 24 / 24` and `RE1:TrainTicket 113 / 113 / 113`: the value shipped
is the pre-registered one, and it is not a peak found by search.

**Reproduced on a battery a stranger can pull, because a standing figure has to be one — THREE times, from
three trees.** The nine cells above were read off run `42636825031` at `1f1b9d14`, the push-triggered battery on
`master`, from its own three `rcaeval-re{1,2,3}-results.txt` loss censuses: `113/119/113`, `84/89/76`, `26/24/22`,
i.e. `345/249/72` and `666`, case for case. Two earlier batteries read the **identical nine**: `42616136723` at
`44c8eb5e`, and `42607302393` at `aeb35f29` — the pre-merge engine with one unreachable fallback still in place
(`?.contribution ?? 0` in the jurisdiction's read-back). The third is the informative one: `1f1b9d14` carries
four input-contract repairs (`docs/engine-input-contracts.md` — a dangling edge endpoint that crashed the sort, a
`NaN`-blind `invariantRange`, a duplicate edge record worth `+0.033` on a parent, and a tree edge with no weight
in `allEdges`), and the nine did not move, which is what that document predicted and why. And each run names its
own CONFIGURATION: its printed `signals:` line is byte-identical to the line a bare `parseRCAEvalArgs([])`
produces from this tree, both hashing to `a0ed4a8a906e`. That is the fingerprint
`anchor-config-fingerprint.test.ts` holds the block to, so the reading and the configuration it belongs to are
asserted from the same artifact rather than from the same document.

### 0p-v. The sixth correction — two fields, no behaviour, and the line that has to say so

The digest moved again, `a0ed4a8a906e → 1fa9e7bca975`, and this time **nothing the ranking does has changed**. The
fault-free frequency term was added to the engine at weight `0`, which is its ablation, and the reported line
gained the two fields that NAME it: `faultFreeWeight=0 faultFreeSelection=rarest`. A reader of an artifact built
after this iteration can therefore see that the term exists and is off; a reader of one built before it cannot be
told apart from a run where the term did not exist at all — which is exactly why the fields are printed at their
defaults rather than omitted.

**The prediction, stated before the run rather than after it.** At `faultFreeWeight = 0` the engine does not read
the profile map (`pruner.ts`: the map is `undefined`, not an empty one), so every score is bit-identical and the
nine cells must be unmoved: `RE1 345/375`, `RE2 249/270`, `RE3 72/90`, `TOTAL 666/735`. The battery that
confirms it is named in the paragraph below once it has run; a block that moved would mean the term reads
something at zero.


### 0p-vi. The seventh correction — one field, no behaviour, and a REFUSAL that has to be nameable

The digest moved again, `617935621cbc → 706a4e8e7c01`, and again **nothing the ranking does has changed**. The
self-time term gained a SCOPE: `selfTimeScope: 'absolute' | 'fleet'`, where `absolute` is the arm every published
number was taken with and `fleet` is the repair `docs/self-time-share.md` §6 asked for in its own refusal — the
same share read against the node's own out-degree class instead of against the absolute `[0, 1]` scale. The
reported line gained the field that names it, beside the weight it belongs to: `selfTimeWeight=0
selfTimeScope=absolute`.

**Why the field is printed rather than omitted at its default.** One number can mean two statistics now. An
artifact carrying `selfTimeWeight=0.1` alone cannot say whether that weight multiplied the share §6 refused
(TrainTicket `98 → 47`) or the residual built in its place, and the two are the difference between a refusal and
its repair. That is the same argument §0p-v made for the fault-free pair, and it is the reason the omission rule
("print the non-shipped pole") does not apply here: the field is not a value, it is which of two mechanisms the
run executed.

**The prediction, stated before the run rather than after it.** At `selfTimeWeight = 0` the engine does not build
the share map at all (`pruner.ts`: `selfTimeShares` is `undefined`), so the scope is never read and every score is
bit-identical: `RE1 345/375`, `RE2 249/270`, `RE3 72/90`, `TOTAL 666/735`, cell for cell. The push-triggered
RCAEval battery on this commit is what confirms it, and it is named here once it has run — a moved cell would mean
the scope reads something at weight zero, which is the only way this field could be more than a name.

**What did NOT move, and why.** The marker's `battery` and `revision` are unchanged. They answer "which run
measured these nine cells", and that reading is the same one; the `config` field answers "what string does this
code render for the shipped configuration", and that is the thing this iteration changed. Rolling all four would
claim a battery that does not exist.

### 0p-vii. The eighth correction — a statistic, no behaviour, and the defect found one stage upstream

The digest moved again, `706a4e8e7c01 → 41fbca20ab8d`, and again **nothing the ranking does has changed**. The
decisive-stability term gained a STATISTIC: `stabilityScope: 'rank' | 'fleet' | 'fleet_unbinned'`, where `rank` is
`(n − 1 − rank)/(n − 1)` over the dominant metric's dispersion bonus — the reading every published number was
taken with — and the two fleet words are a MAD-standardised residual against the node's metric family, plus its
mechanism control (peers with no family binning). The reported line gained the field that names it:
`stabilityScope=rank`.

**The name is load-bearing for the same reason `selfTimeScope`'s is.** One weight can mean two statistics. An
artifact carrying `stabilityWeight=0.1` alone cannot say whether `0.1` multiplied a rank or a residual, and those
are different populations of evidence: iteration 301's sweep puts the rank's own optimum at ×40 with ×80 already
negative, so a residual read at `0.1` is a different measurement, not a louder one.

**The finding that changed the design, recorded before the arm runs.** The pre-registration
(`docs-repository:preregistration-302.md`) was written against `breakdown.cv`, and that field is not a
dispersion: it is `cvBonus = cv > 0.5 ? min(cv, 1.5) × 0.05 : 0` — hard-zeroed below `0.5`, saturated above `1.5`,
and scaled into a band `0.05` wide in between. A residual standardised inside that band would have standardised
three transformations rather than the node, and the 163 misses §4.4 of `PROGRESS_2026-11-17g.md` measured would
have stayed lost. `AnomalyFeatures.dominantMetric.dispersionCv` therefore carries the raw `σ/μ` beside the bonus,
and the residual reads that or nothing — no fallback, because a statistic that silently mixed a compressed value
with an uncompressed one would be two statistics under one name. The binning key was corrected in the same
pre-registration, in the same place, for the same reason: 50 services against 85–87 labels makes an exact-label
reference 0.59 members wide, so the key is the metric FAMILY.

**The prediction.** At `stabilityWeight = 0` under every scope the ranking is bit-identical, and at the shipped
`0.007352` with `stabilityScope = 'rank'` — the default — nothing reads the new field at all. `RE1 345/375`,
`RE2 249/270`, `RE3 72/90`, `TOTAL 666/735`, cell for cell, on the push-triggered battery.

**What did NOT move, and why.** `battery` and `revision` are unchanged, on §0p-vi's rule: they answer "which run
measured these nine cells" and that reading is the same one. Only `configuration` answers "what string does this
code render for the shipped configuration", and that is the only thing this iteration changed.

### 0p-viii. The ninth correction — one field, no behaviour, and a run that could not say it was inert

The digest moved again, `41fbca20ab8d → 7438373f894f`, and again **nothing the ranking does has changed**. The
line gained one field: `containmentExcursions=absent`.

**Why it has to be printed.** The containment order reads the fault-free profile for its per-service latency
excursions, and without a profile `latencyExcursions` returns an empty map, so `inspectContainmentOrder` returns
the ranking **unchanged — silently**. `containmentOrder=true` says the pass was *asked for*; it does not say the
pass could *speak*. On the FSE 26 corpus those two states differ by 15 cases and 1.06 pp: `1 141` against
`1 156` Top@1, with Top@3 and Top@5 identical to the digit and every per-channel score bit-identical. That
measurement is `docs/containment-order.md` §20.

**What the field says about the cells above it.** This workflow does not pass `--fault-free-profile` — only
`benchmark-agentic.yml` builds one — so **every cell in this document was produced with the containment pass
inert**, and the field now says so on the artifact rather than leaving a reader to infer it from a workflow file.
**CORRECTED BY §0p-ix**: from that entry forward the FSE'26 cell is the exception — `fse26-benchmark.yml`
derives the profile in its own job and passes it, so this sentence is true of the nine RCAEval cells and no
longer true of the FSE'26 one.
That is not a correction to any number; it is the disclosure of a configuration, and it is disclosed because the
alternative is a reader who takes `containmentOrder=true` as evidence the pass ran.

**The prediction, stated before the run rather than after it.** With no profile the engine computed an empty
excursion map before this change and computes the same one after it, so the nine cells must be unmoved:
`RE1 345/375`, `RE2 249/270`, `RE3 72/90`, `TOTAL 666/735`. The push-triggered RCAEval battery on this commit
confirms it. A moved cell would mean the field reads something at the default, which it cannot — it is derived,
`!(containmentOrder ?? DEFAULT_CONTAINMENT_ORDER) || digest === null`.

**What did NOT move, and why.** The marker's `battery`, `revision` and `read` are unchanged: they answer "which
run produced these nine cells", and that run is still `42636825031` at `1f1b9d14`. Only `config` moved, because
only the record of the configuration moved.

**The axis this makes visible, priced but not measured.** If the pass is worth 15 cases on FSE 26, the RCAEval
surface has never been measured with it on. Dispatching that arm is now a one-flag question — build a profile,
pass `--fault-free-profile`, read the nine cells — and it is the first time the question could be asked without
editing a workflow to find out what state the artifact was in.

### 0p-ix. The tenth correction — the FSE'26 cell, measured on the configuration the engine ships

The FSE'26 cell moves **`1073/1422 = 75.46%` → `1156/1422 = 81.29%`**, and this entry exists mostly to say what did
*not* cause most of it.

| movement | reading | decomposable? |
| --- | --- | --- |
| the pod-lifecycle corpus rebuild (iteration 257) | `1 073` (corpus `f72899e5…`, run `42729721072`) | yes — `docs/pod-state-term.md` §11 |
| corpus rebuild **and** engine, together | `1 141` (corpus `b7fca80e…`, run `44142865215` at `2122359`, pass inert) | **no** — one corpus and thirty-five commits arrive at once |
| **the containment pass is given the profile it reads** | **`1 156`** (run `44333449830` at `802cf3e`) | **yes — `+15`, and `Top@3`/`Top@5` do not move** |

**The third row is a configuration repair, not an arm.** `fse26-benchmark.yml` could not supply
`--fault-free-profile`; the containment pass ships **ON** and reads that profile for the corpus's per-channel
excursions; with no profile it returns the ranking unchanged and says nothing. So every number this document had
ever printed for FSE'26 was the pass **inert** — a statement about a missing file. `docs/containment-order.md` §20
measured `+15` for the pass at `73dc662` and §0p-viii projected 15 cases onto this cell; the repair's own artifact
reads 15, which is the first time a projection in this file has been confirmed to the case.

**Why the first draft of this entry said `+44`.** It compared this cell against `1 112`, which is **arm A3** of
register §305 (`stabilityScope=fleet_unbinned, stabilityWeight=0.1`, run `44210828265`) — a knob, not the shipped
configuration — and the run id had been taken from the last row of an arm table rather than from the artifact's own
`Config:` line. Register §314 records the defect and §314.2 the case-level census that replaces it: pairing the two
per-case artifacts on `datapack`, **81 of 1 422 rankings differ**, in the shapes `1 → 1` (64, tail order), **`2 → 1`
(15)** and `3 → 2` (2), with **zero** cases losing a position. A `rank 2 → rank 1` swap cannot change a top-three
count, which is why `Top@3` and `Top@5` are identical rather than nearly so.

**What this does to the standing.** The cell is **`81.29%`**, `+44.3 pp` over the benchmark paper's best `37%`, and —
for the first time on this benchmark — **above every Qwen configuration** in `arXiv:2608.21310` Table 2: second of
eleven, `8.7 pp` behind `Sonnet · ThinkDepth.ai`'s `90.0%` on that paper's 500-case sample. The row's `−8.7 pp` is a
**deficit on a different population** (their 500-case sample against our 1 422), and it stays a deficit.

**What did NOT move.** The nine RCAEval cells, their marker and the configuration fingerprint are untouched by this
entry: the FSE'26 surface's profile is derived inside its own job from its own corpus and never reaches the RCAEval
workflow. §0p-viii's sentence that "every cell in this document was produced with the containment pass inert" is
therefore **true of the nine cells and false of this one from this entry forward**, and it is corrected there.
### 0p-x. The eleventh correction — one word, no behaviour, and the arm that has to be nameable

The digest moves **`8a7eb902ec8e → c0b34f8091f2`**, and again **nothing the ranking does has changed**. The line
gained one field: `labelPriorJurisdiction=everywhere`.

**Why it has to be printed.** The label prior ships at weight `0`, and iteration 369 gave it a second way to spend a
non-zero weight: `everywhere` sums it with the rest of the ranking, `tail` clamps the head of the order the engine
would report without it and lets the prior reorder positions 2..n. The two words are the difference between the
**refused** arm and the **one that survives** on the FSE'26 panel — `Top@1` `1 186 → 1 184 / 1 176 / 1 182` in the
three summed arms against invariance by construction in the pinned one, with `+24` cases at each of `Top@3` and
`Top@5` in every armed arm (`docs/label-prior-fse26.md` §2.4). A golden-half artifact that recorded the weight and
the gate but not the jurisdiction could not tell a pinned run from the shipped one, which is the state §0p-viii
records for `containmentExcursions` — a configuration the artifact could not state.

**The prediction, stated before the run rather than after it.** At the shipped weight the term is not read at all:
`priorSpeaks` short-circuits on `labelPriorWeight !== 0`, so the order is built once, exactly as it was, and the
nine cells must be unmoved — `TOTAL 666/735`, cell for cell, on the push-triggered RCAEval battery that carries
this commit. The invariance is also asserted without a run, twice: `packages/tree/__tests__/unit/label-prior-term.test.ts`
pins that a `tail` arm keeps the head at every weight from `0.01` to `100`, and the shipped-word arm is the
`everywhere` one every published cell already ran.

**What did NOT move, and why.** `battery` and `revision` are unchanged, on §0p-vii's rule: they answer "which run
measured these nine cells" and that reading is the same one. Only `configuration` answers "what string does this
code render for the shipped configuration", which is the only thing this change touches. The nine cells themselves
are re-read by the battery on this commit rather than argued here, and `benchmarks/baselines/rcaeval-nine-cells.json`
carries the same digest so the dashboard gate cannot go inert between the two.

### 0p-xi. The twelfth correction — an ENROLMENT, and the first one a proof predicted

The digest moves **`c0b34f8091f2 → 2a8f8b335d45`**, and this time the ranking does change: the label prior is armed.

**What moved, and why all three at once.** `DEFAULT_LABEL_PRIOR_WEIGHT` `0 → 0.1`, `DEFAULT_LABEL_PRIOR_MARGIN_GATE`
`0.02 → 0`, `DEFAULT_LABEL_PRIOR_JURISDICTION` `everywhere → tail`. The kill criterion was an AND over two halves and
both were read: on the FSE'26 panel the pinned arm holds `Top@1` at `1 186` (1 gained, 1 lost, `p = 1.000`) while
reading `+24` at `Top@3` and `+27` at `Top@5` (both `p < 0.001`); on the nine RCAEval cells, run `45859433294` reads
`AC@1` **666 of 666 cell for cell** and a nine-cell `Avg@5` mean of **92.47 → 94.48 %**. The gate moves with the
jurisdiction because under the pin it is a substitute rather than a complement — at `τ = 0.02` the same arm reads
`+16 / +19`, withholding 89 cases to protect a position the pin has already made untouchable.

**Why the head claim was not a hope.** §4 of `docs/label-prior.md` proves the pin's invariance from the construction:
the order is computed with the term read as zero, the prior reorders 2..n, and the head is pinned to the silent
order's head. So the prediction could be — and was — written before the run: **no cell moves.** The golden half
returned `666` in every cell, which is the first reading in this programme that needed no tolerance at the metric
both boards score. The one case the panel moves in each direction is attributed, case by case, to the containment
pass that runs *after* the pin.

**What this anchor now names.** `battery` and `revision` DO move this time, on §0p-vii's rule read the other way
round: they answer "which run measured these nine cells", and the run that measured them under the enrolled
configuration is `45859433294` at `7b1d3e4f` — the same run that shows they did not move. Keeping the old battery
would have named a run whose configuration string no longer exists in the code.

**What the published boards do.** Nothing at `AC@1`: `666/735` on the golden half and `1 186/1 422` on the panel,
before and after. What changes is depth and only depth — the panel's `Top@3` `1 260` and `Top@5` `1 282` are now the
SHIPPED reading rather than an arm's, and the golden half's `Avg@5` rises 2.01 pp. The three static-rank arms this
enrolment retires (`0.1/0.02/everywhere`, `0.1/0/everywhere`, `0.05/0.02/everywhere`) remain dispatchable and remain
in `docs/label-prior-fse26.md` §4.1.

### 0a. ABOVE US AND NOT COMPARABLE — the references that must be named, and whose population this section does not own

**A number we cannot beat must be named, or the standing reads as a claim about the whole field.** Each of these
is above us or beside us on some figure, and **none** is comparable to a service Top-1 on the 735 (verified
2026-10-09 / 2026-10-10 / 2026-10-11 / 2026-10-12 / 2026-10-14; the detail is in the internal
`SOTA_LANDSCAPE_VERIFICATION.md` §1.4 / §1.7).

**Which population each one reports on is owned by `docs/sota-populations.md`, and this section no longer restates
it.** That is iteration 101's repair, and the fifth entry is what forced it: for three iterations it was filed as
_"CANDIDATE ABOVE US WHOSE POPULATION IS NOT VERIFIED"_ while its number sat in the standing table and in
`SOTA_LANDSCAPE_VERIFICATION.md` §1.16, and the two artefacts that settle a population — the paper's own full text
and its own project page — were never read, because two searches had reached its **abstract** and the population
is in neither the abstract nor any index of it. **A shape match is not a population**: `375 = 3 × 125` was RE1's
signature and the metric was `top-1` rather than `Avg@5`, and that is the strongest thing a case COUNT and a
metric NAME can establish between them. The reading is done now and the entry says what it found.

**And the entry the 2026-10-13 note called _"the seventh"_ is not an item of this list at all — it is
`arXiv:2608.08968` (GALA+, ASE'26), which §2b-ii owns.** It was described here by an ORDINAL rather than by its
own name, and an ordinal is a count by another spelling — the heading's count disagreed with the list, and both
disagreed with two later sections. The ordinal is replaced by the reference, and the list is now the only place
its own length is stated. And **§0d** holds the reference that belongs in neither list: a 2026-10-12
find whose number is BELOW ours while its population is a mixture nobody can compare to, which is a third class
rather than another member of this one.

1. **A vendor's self-reported 89% top-1** on RCAEval — NOFire AI, on its own guide and its own benchmark, with
   no per-case results, and the page itself says to rerun it on your own incidents.
2. **A private 50-case hybrid ensemble at 88.5%** — 15× smaller, not public, self-reported.
3. **PSC-GRCA** (`arXiv:2609.27069`, Buljić, University of Zenica) — **`Avg@5` 0.915** against 0.864 for a
   capacity-matched MLP and 0.862 for a no-neighbour control, with ablations locating the gain in the **prior**.
   A different metric (`Avg@5`), and its own benchmark audit is the source of the RE1 column-schema allegation
   this repository refutes in `docs/benchmark-corpus-completeness.md` §8. **NOT OUR POPULATION** — its `0.915` is
   a six-fixed-fold split of this benchmark read under `Avg@5`, not our 375-case RE1 read under Top-1; the row,
   and what it rests on, are in `docs/sota-populations.md`. **Two qualifiers its abstract does not
   carry, verified 2026-10-10 from the paper's own tables: 0.915 is the six-fixed-fold IN-DISTRIBUTION mean and
   the CROSS-SYSTEM number is 0.747** — and its prior-only arm, the term its ablations credit, scores **0.488
   in-distribution against 0.079 across systems**. So the figure we have been naming is the in-distribution one.
   **Its code, seed manifests, sixty-two-entry defect register and table-generating scripts are public**
   (preprint artifact, Zenodo DOI `10.5281/zenodo.22832168`), which makes the comparison one that can become a
   measurement rather than a citation.
4. **`Where Root Cause Analysis Fails: A Retrieval-Reranking Decomposition`** (Hada Melino Muhammad, **Luan
   Pham**, Laure Barrière, Sachin Shetty, Leonardo Pulga, Flora D. Salim; **`arXiv:2609.36686`**, submitted
   2026-09-29; **accepted to the NeurIPS 2026 Evaluations & Datasets Track**). It is the **most dangerous of the
   four**, and the reason is not its number: it comes from the **benchmark author's own group** — Luan Pham
   authored both RCAEval and PRISM — it is peer-reviewed, and it audits **RCAEval itself**. It reports a two-stage
   pipeline (multi-signal retrieval, then an LLM reranker with optional domain knowledge) matching or beating
   **the framework's 15 baselines** by up to **+12 pp top@1** with no causal graph and no labelled data, and by
   **+7 to +18 pp** when the true cause is guaranteed in the pool and a system-description document is supplied.
   **Its baseline cohort is the framework's 15, not this engine** — so `arXiv:2609.36686` is above us on _a_
   top-1 and comparable to _none_ of ours. **NOT OUR POPULATION** — it reports on RCAEval _and_ on WADI / SWaT /
   HVAC, and the `+12 pp` it is most quoted for is a **CPS** margin; what is comparable is the decomposition, not
   a gap. The row is in `docs/sota-populations.md`. **And its headline margin is not on our benchmark family at all**: the survey of 2026-10-12
   reached the paper's own data description, which audits **RCAEval** (microservices) alongside **WADI / SWaT /
   HVAC** (cyber-physical systems) and states that retrieval is _"nearly solved"_ in microservices while the
   _"retrieval ceiling"_ in the CPS systems caps a magnitude-only retriever at **35–64%** — so the `+12 pp` it is
   most quoted for is a **CPS** margin, and its RCAEval contribution is the decomposition, not a gap over us. **Two things verified 2026-10-10 that sharpen it in opposite directions, and a third that closes the plan this
   entry used to imply.** Its own abstract says the code is available at `github.com/cruiseresearchgroup/DecompRCA`, and **that URL does not resolve** — GitHub returns 404 for it and a repository search returns nothing — so this deficit cannot be closed by running it (`docs/competitor-artefact-availability.md`). And an
   **independent review** of the paper records that the abstract's `+12`-point margins sit on **14 / 36 / 48
   scenarios with error bars from `n=3` run-to-run spread rather than scenario-level intervals** — WADI's +12 pp
   is about **1.7 scenarios** — so the headline margin is fragile where the _decomposition_ is not.
   **And it supplies the instrument this repository then built**: `Retrieval@K` against `Rerank@1`, i.e. the
   decomposition of a top-1 miss into "the cause was never retrieved" and "it was retrieved and ranked too low".
   Its claim that microservice retrieval is _"nearly solved at 98–100%"_ is now **reproduced on our corpus by our
   own census**: the truth is in the ranked pool on **99.73% / 99.63% / 100.00%** of RE1 / RE2 / RE3, and our
   loss is **98.8% reranking** (`docs/loss-decomposition.md` §4).
5. **`Rethinking Tool Design for Agentic RCA: A Controlled Empirical Study`** (`arXiv:2610.05009`, Yu Luo,
   Rongchen Gao, Zhenhui Zhou, Changchang Liu, Yuliang You, Yongqian Sun, Shenglin Zhang, Qiuai Fu, Shijie Wang,
   **Dan Pei**; submitted 2026-10-04; **Nankai + Huawei + Tsinghua**) — **`top-1` localization 85.4%** for its
   `L0` no-predefined-tools reference and **82.8%** for its `L3` diagnostic-tool layer, over **375 failure cases
   from three microservice systems** with `Qwen3.7-Plus`, and a further four-model comparison on a shared subset.

   **ITS POPULATION IS RESOLVED AS OF 2026-10-14, AND IT IS OURS.** The paper's own full text evaluates _"the
   three RCAEval diagnostic environments"_ and its own project page —
   `luoyu100.github.io/projects/toolrca/project` — names _"RCAEval RE1 failure cases (375)"_. So `375 = 3 × 125`
   is RCAEval's **RE1** (OnlineBoutique, SockShop, TrainTicket), the metric is service `top-1`, and
   **`arXiv:2610.05009` is the first reference to exceed our RE1 80.27% on a population we can name — by 5.13pp
   at `L0` (85.4 against 80.27) and by 2.53pp at `L3` (82.8 against 80.27).** The gap is quoted here rather than
   left conditional, and the two numbers must travel together for the reason the next paragraph measures.

   **And the gap's own error bar, because a single-run figure above us is a claim about us.** Every effectiveness
   number in the paper is one run with no interval, over 375 cases. At `p ≈ 0.83` the binomial standard deviation
   is **1.9pp** and the difference between two configurations is **2.7pp** — so the paper's own `L0`-against-`L3`
   separation (2.6pp) is **under one standard deviation**, its own trajectory counts concede that `L1+L3` against
   `L3` is a **three-case swing**, and an independent review's arithmetic reproduces all three (recomputed here
   2026-10-14). Our 5.13pp is **2.7 SD** and therefore outside that noise. The two figures are also not the same
   instrument: its `L0` is an LLM agent writing and running Python against the case data, ours is a deterministic
   engine over the same case set.

   **What the resolution cost, and the law it produced.** Two earlier passes searched this paper and reported
   _"the same abstract"_, and a third-party reading recorded that its numbers are _"on NAMED benchmarks"_ with the
   population _"nameable from the body"_ — so the record wrote down that the answer was one read away and did not
   take the read. The register's law 10 says **a paper's own artefact statement is the authority on whether its
   artefact is public**; the corollary carried here is the same one iteration 99 found for artefacts, one surface
   over, and it is now a law: **the artefact that states a paper's population is its own full text or its own
   project page, and a search of its abstract cannot settle it.**

   **And it is not reproducible from its own links, which is now read rather than quoted.** The authors' own
   project page **resolves** and carries **no code, no weights, no dataset link and no per-case results** — only
   the arXiv link and six figures — so the record's negative claim stands, now by the authors' own page rather
   than by an independent index of it. The hosting shape that made this readable is a `github.io` page, and it
   sat outside the artefact grammar until this iteration: **an inventory cannot judge an artefact its grammar
   cannot see**, which is how a method-less artefact stayed outside the population that prices method-less
   artefacts.

   **What makes it worth naming beyond the number**: its central finding is that **higher-level diagnostic tools
   REDUCE localization accuracy** (L3 82.8% against L0 85.4%) while improving fault-type identification and
   halving the time. That is an **independent corroboration of this repository's own ledger pattern** — _every
   tool wired as a SCORE measures negative; every credited gain is STRUCTURAL_ — arriving from a group with no
   connection to us, on the same benchmark family. **Two independent measurements of "more machinery, lower
   top-1" is the strongest evidence either has.**

   **AND ITS TABLE 5 SETTLES WHICH SYSTEM THE GAP IS ON — read 2026-10-29, and it is not the system every earlier
   reading assumed.** The paper publishes `AC@1` per system, not only overall, and the three cells are three
   different stories:

   | system         | its `L0` |         its best configuration | ours (RE1, run `40792623427`) | margin                                       |
   | -------------- | -------: | -----------------------------: | ----------------------------: | -------------------------------------------- |
   | OnlineBoutique |     86.4 | **88.0** (`L2+L3`, `L1+L2+L3`) |            **85.6** (107/125) | **−0.8 against `L0`, −2.4 against its best** |
   | SockShop       | **90.9** |                    90.9 (`L0`) |            **92.8** (116/125) | **+1.9**                                     |
   | TrainTicket    |     78.9 |                 79.2 (`L1+L3`) |            **83.2** (104/125) | **+4.0**                                     |

   **This table is pinned to `40792623427` and is kept at that reading on purpose** — it is the reading that
   IDENTIFIED the cell, and rewriting its numbers would delete the evidence that the identification happened.
   `§0`'s RE1-OB row is the current one (`89.6%`, `112/125`), four cases above that run's `107`, because the
   transient-guard policy stopped discarding a plateau whose last sample returns.

   Three consequences, and the FIRST of them is now historical rather than current. (i) **RE1-OnlineBoutique
   was the one cell where a published reference was above us on a population we can name**, and it had been
   invisible because every prior reading of this reference compared the OVERALL figure — its `L0` 85.4 against our
   RE1, where we lead by 6.07 pp. A total can hide a cell, and the cell it hid is now the one the guard recovered.
   (ii) The
   overall lead survives the strongest per-system reading available: the paper's per-system oracle
   `(88.0 + 90.9 + 79.2)/3 = 86.03%` is still 5.44 pp below our current 91.47 — but a per-system best across
   DIFFERENT configurations is not a run, so the honest comparison is `L0` against ours, system by system. (iii) The
   margin on that cell was **three cases of 125** at `40792623427` and is **minus two** now: the cell this table was
   written to flag has been passed, and what the campaign's own loss decomposition says about the remaining misses
   (97.9% RERANKING) is unaffected by which side of zero the margin sits on.

   **What this changed in the record.** §0's STANDING table and §1 were anchored on a run two enrolments old
   (`80.61%` overall, RE1 313 of 375); both are re-anchored on `40792623427` (`85.44%`, RE1 327 of 375) as
   **v3.3**, and the RE1-OnlineBoutique row is added because a standing that averages three systems cannot state
   which one it loses on.

6. **E4** — _Agentic RCA for Internet-Scale Services Using Constrained Creativity_ (**`arXiv:2610.08622`**,
   submitted 2026-10-09). An agentic troubleshooter that emits **loop-free data-flow programs in a restricted,
   high-level DSL** rather than free-form code, and reports **"up to 62% better accuracy compared to
   state-of-the-art solutions"** on _"a mix of synthetic and real-world workloads"_, with **up to 12× reduced
   cost**.

   **It is named and no gap is quoted, because the claim has no denominator.** **NOT OUR POPULATION**, resolved
   2026-10-19 from the paper's own abstract — _"on a mix of synthetic and real-world workloads, E4 achieves up to
   62% better accuracy compared to state-of-the-art solutions"_: no benchmark, no case set, and a **RELATIVE** gain
   against an unnamed baseline. So the `62%` is not a percentage of anything we can count, not a top-1, and not on a
   population we can name (`docs/sota-populations.md`). It is nameable for the same reason the fifth entry was
   until 2026-10-14: it is _above us by the authors' own claim_ and silent about what it is above. **Its design
   point is the one worth borrowing, twice over**: restricting an agent to a **verifiable operator language instead
   of arbitrary code** is the same instinct as this repository's preference for an instrument that is a pure
   function; it is the second independent arrival at _"more expressive machinery, lower accuracy"_ on this list;
   and — with `RCLAgent`'s per-span argument — it is a **third** independent reason to build the per-case
   discriminator over a bounded, checkable vocabulary, which is the register's last open axis.

**AND, FOUND 2026-10-30, ONE THAT IS POPULATION UNVERIFIED FOR THE MIRROR-IMAGE REASON — it matches us on
every field a number can be filed by, and still cannot be filed: 94.7% Top-1 on "the RCAEval benchmark (735 failure
cases, 12-64 services)"** — S. Hussain and H. C. Panjwani,
_Decentralized Root Cause Analysis for Cloud-Native Microservices — Experience with Distributed PageRank in
Production_, **DSN-S 2026**, pp. 50–56, DOI `10.1109/DSN-S70715.2026.00023`. The method is gossip-based
**distributed Personalized PageRank**, one sidecar agent per service, and the reported standing is **94.7%
Top-1, "statistically indistinguishable from centralized PageRank at 94.1%"**.

Three field matches and one arithmetic refusal. The count is the 735 we run; the metric is service **Top-1**;
the service range is the one we see (12–14 on OnlineBoutique and SockShop, 63–69 on TrainTicket). What does not
match is the field it would land in: **94.1% for plain centralized PageRank is 26.1 pp above PRISM**, the
graph-free method of the benchmark's own author (`arXiv:2601.21359`, 68%), and **8.9 pp above us**. A corpus on
which a bare PageRank reaches 94% cannot also be one on which the author's own method reaches 68% and the
pre-LLM causal cohort reaches 19%, unless the two are measuring different things. The candidate explanations,
each checkable and **none checked**: (i) ground truth at a coarser granularity than the root-cause service;
(ii) a candidate set restricted to services already carrying an anomaly — a detectability filter that removes
retrieval from the measurement and is the largest single source of inflated Top-1 in this field; (iii) a corpus
revision other than the one this repository runs; (iv) a per-case filter such as "inject time known", which on
this corpus alone moves RE3-TrainTicket from 21/30 to 2/30.

So it is **recorded and not conceded, no gap is quoted in either direction, and the standing in §1 does not
move**. The verification owed is the paper's own evaluation section; the DOI page serves the abstract only
(read 2026-10-30), so the one document that settles it has not been read yet. **If its protocol is ours, this is
the first reference to be above us on the whole 735 and the honest sentence becomes "8.9 pp behind"**; if it is
(ii), it belongs beside the vendor's 89%. The distinction is worth a read rather than a round of guessing, and
it is the cheapest outstanding item on this page.

### 0b. BELOW US, AND COMPARABLE — the one reference that shares our metric AND our population

**`Beyond Conditional Independence: Root Cause Analysis with Deep Causal Models`** — Md Musfiqur Rahman, Kenneth
Lee, Ziwei Jiang, Padmaja Jonnalagedda, Ruocheng Guo, Murat Kocaoglu (Purdue); **arXiv:2609.36771**, submitted
2026-09-29; method **RCA-DCM**, code and case-level results at `github.com/Musfiqshohan/RCA-DCM`.

**Verified 2026-10-10, and this is the first reference for which the sentence "we are ahead" is a like-for-like
statement rather than a cross-paper one.** Three things had to line up, and they do:

1. **The metric.** It reports **top-1 accuracy** — not `Avg@5`, which is what every other above-us reference
   reports and the reason none of them could be compared to a service Top-1.
2. **The population.** Its README states _"Sock Shop and Online Boutique have the same five faults (CPU, memory,
   disk, delay, packet loss), each injected five times into five services: **125 cases per dataset**."_ That is
   RCAEval's own RE1-OB and RE1-SS, verified against the benchmark's published table (`RE1-OB 125`, fault types
   `cpu, mem, disk, delay, loss`). Same systems, same faults, same 125 cases each — not a similar corpus, the
   same one.
3. **Its numbers are below ours on both.** Sock Shop **0.89** (its strongest baseline 0.75), Online Boutique
   **0.78** (strongest baseline 0.71). Against our **92.8%** and **80.0%** that is **+3.8 pp** and **+2.0 pp**,
   and it is the strongest second-place method that exists on those two cells.

**And its own README records an ablation that matters more than its number.** It states: _"A plain sink graph,
with the shared latent removed, picks the same top-1 service on all 125 cases of each dataset."_ The paper's
central contribution is handling **unobserved confounders** through a deep causal model — and on the microservice
data, removing the shared latent and collapsing the graph to a sink changes **nothing**. That is the same
finding this repository's ledger records about its own terms (**a tool wired as a score measures negative; the
credit sits in the structure**), reported by the competitor about its own headline mechanism, and it is the
reason the entry is filed here rather than in §0a: the honest reading of both results is that on these two
systems the top-1 is largely decided by the anomaly's **marginal position**, not by the causal machinery either
side of us adds.

**What it is not.** It is still cross-paper: their harness, their pre-processing, their graph construction and
their per-case tables are theirs. But unlike §0a it is **checkable** — `edgedelta/project-arena` ships the
scenario scripts, the answer keys and the scoring code under MIT, so this is a comparison that can be turned into a measurement rather than left as a citation. Registered as the head of the reproducible-baseline item in
`docs/closed-axes-register.md`.

---

7. **GALA+** (`arXiv:2608.08968`, Tian, Liu, Chong, Huang, Li, **Hans-Arno Jacobsen**; University of Toronto;
   **Proceedings of ASE '26**, the 41st IEEE/ACM International Conference on Automated Software Engineering) —
   **`AC@1` 74.44% on OnlineBoutique and 73.33% on TrainTicket**, with `AC@3` 98.89% and 85.56%.

   **Filed as a CANDIDATE ABOVE US ON RE2-TRAINTICKET WHOSE CASE SET IS NOT VERIFIED, and the reasons are entry
   5's, sharpened by everything this one does give us.** Four things are true and only three are settled:

   - **The metric matches.** `AC@1` is a top-1 over acceptable roots — the same quantity as ours, unlike the
     `Avg@5` that the three references above this one report.
   - **The suite and the population SIZE match.** `98.89% = 89/90` and `85.56% = 77/90` fix both populations at
     **90 cases**, which is RCAEval RE2's own signature (`6 fault types × 15`) on exactly the two systems
     `§2b` already compares. The paper names both systems.
   - **The case-level identity does not follow.** Nothing in the abstract or the numbers establishes that its 90
     TrainTicket cases are _the same_ 90 as ours, and this document's head-to-head standard is the _identical
     corpus_ (`§0a`'s own `78.91 vs 78.75` over the 735). So the deficit below is a **named risk, not a
     measurement**.
   - **And we are above it on that cell, by ten cases.** `73.33% (66/90)` against our published `84.4% (76/90)` is **+11.1 pp**,
     and it is the **first published competitor number on any TrainTicket cell in this document** — `§2b` is
     titled _"where all LLM agents report"_ and carried only OnlineBoutique, which made the absence of a TT row
     read as an absence of a TT number. That reading was wrong.

   **What follows, and what does not.** No gap is claimed either way until two things happen: **confirm the case
   set from the paper's own dataset section, and find an artefact that carries the method** — the only GALA
   artefact is `github.com/EvanTian233/GALA-for-RCA`, and its README withholds the implementation — so this entry is a motivation for the standing reproducible-baseline item rather than a plan inside it. What _is_ claimable, because it needs
   no case-level identity: the published `AC@1` of the strongest external number on the `§2b` slice moves from
   RCLAgent's `56.67%` to **`74.44%`**, so our lead there is **`+12.2 pp` against `74.44%`, not `+30.0 pp`
   against `56.67%`** — and the `GALA 42.22%` row in `§2b` is the **prior** paper (`arXiv:2508.12472`) and must
   not be quoted as this method's.

   **Why it is not in `§0b`.** `§0b` admits exactly one reference — RCA-DCM — and its admission test is that the
   population is **verified from the source's own text**, not inferred from a count. GALA+ clears the metric and
   the size and not the case set, so it sits here with the number recorded and the comparison **not runnable**:
   `github.com/EvanTian233/GALA-for-RCA` resolves and is MIT, and its README withholds the implementation under its
   industrial partner's agreement.
   **§2b-ii carries the full treatment**, including the third-party referee reading that disputes the metric's
   interpretation and the one part of the method that is worth borrowing.

### 0b-ii. The NeurIPS'26 retrieval-reranking decomposition — our own population, our own metric, and the closest thing to us on two of three cells

**`Where Root Cause Analysis Fails: A Retrieval-Reranking Decomposition`** — Hada Melino Muhammad, Luan Pham,
Laure Barrière, Sachin Shetty, Leonardo Pulga, Flora D. Salim; **arXiv:2609.36686**, submitted 2026-09-29,
**accepted at NeurIPS 2026 (Evaluations & Datasets Track)**, code at `github.com/cruiseresearchgroup/DecompRCA`.
Read 2026-11-09, and it is the first competitor this document has found whose numbers sit within two cases of
ours on a cell.

Three things make it comparable, and they are the same three §0b applies: **service-level `top@1`**, the
**RCAEval RE1 split** (125 injections per suite, the benchmark's own preprocessing, quantile latency columns kept
unmerged so its BARO figures reproduce), and a **fixed single configuration** across all six suites.

| suite              | DecompRCA, LLM reranker with domain knowledge |                ours |             margin |
| ------------------ | --------------------------------------------: | ------------------: | -----------------: |
| RE1-OnlineBoutique |                             **0.888 ± 0.008** | **0.904** (113/125) | +1.6 pp, two cases |
| RE1-SockShop       |                             **0.944 ± 0.008** | **0.952** (119/125) |  +0.8 pp, one case |
| RE1-TrainTicket    |                                 0.685 ± 0.009 | **0.904** (113/125) | +21.9 pp, 28 cases |

Its strongest statistical baseline is BARO (0.784 / 0.856 / 0.560 on the same three cells), so the LLM reranker
buys it +10.4 / +8.8 / +12.5 pp over the best non-LLM method — and it still lands below a deterministic engine on
all three. **The margin on two of the three cells is now one or two cases**, which is the honest reading of this
row: it is the first entry in this document whose population and metric leave us no room for a stale number.

**And its decomposition says where the remaining headroom is.** `Retrieval@15` is `0.98 / 1.00 / 0.91` on the
three cells, i.e. the true service is in the candidate pool almost always and the entire deficit is RE-RANKING —
which is this repository's own finding from the other side (`docs/emission-jurisdiction.md`: the term that moved
five `RE3:SockShop` cases is a rank statistic, and the case-level gates that failed were retrieval-shaped
absences). A fixed configuration that reranks with no causal graph and an LLM beats every graph method on the
board, which is the strongest published argument yet that **the graph is not where the accuracy lives** — the
same conclusion this document's §0b draws from RCA-DCM's own ablation, now from a second team on a second
mechanism.

### 0c. A NEW PUBLIC BENCHMARK — small, vendor-authored, and REPRODUCIBLE

**Project Arena**, released 2026-10-08 by **Edge Delta** (with an evaluation by GPT-6-Astra and a comparison
against Grafana's native AI): a Kubernetes deployment of the **OpenTelemetry Demo** with **21 injected fault
scenarios**, scored by a fixed rubric, with **the scenario scripts, the answer keys and the scoring code released
as open source** (`edgedelta/project-arena`).

**It is recorded here for three reasons and excluded from our numbers for two.** Recorded: it is **public and
reproducible**, which the vendor's own 89% is not; it is a **second** independently published instrument for this
problem, which matters because the repository's largest unexecuted comparison is _running someone else's harness_;
and its headline result — **11 of 12** shared scenarios localized correctly by the vendor against **9 of 12** by
the comparator — is **vendor-authored with the vendor competing**, which is exactly the population caveat §0a
applies to a _number_.

Excluded: **21 scenarios is not a population we can compare a 68-service Top-1 to** (our smallest cell is 90 and
the corpus is 735), and its unit is a **whole incident report scored by a model**, not a service ranked first. It
is a candidate instrument and not a candidate number, and it is named so that "the field has no public benchmark"
cannot be said of this repository's own standing.

### 0c-ii. Two 2026 arrivals that are NOT comparable, and are named so nobody has to look them up twice

- **KRCA** (ASE '26, `10.1145/3832783.3834468`, Kuaishou; preprint `arXiv:2607.01788`): `AC@1 0.88` for service
  localization and `0.79` for failure-type classification, from a multi-stage pipeline (API-level drilldown →
  skeleton causal graph → memory-augmented multi-agent verification), deployed in production for six months with a
  `−77.3%` diagnosis time. **The DOI and the preprint are one work**: the DOI resolves through Crossref to _KRCA:
  An Efficient Root Cause Analysis System in Hyper-scale Microservice Systems via Agentic AI_, 41st ASE,
  2026-10-07 (verified 2026-11-09), which is why both identifiers are registered against a single row in
  `docs/sota-populations.md` rather than two. **Its population is its own production system**, not RCAEval or
  RCABench; the 0.88 is therefore not a number this document may place in a table against ours, and the row exists
  only so a later survey finds it named rather than re-derived. Its architecture is the one this repository
  measured against in Phase III (`docs/GALA_PHASE3_AGENTIC_RCA.md`): a skeleton graph as a HIGH-RECALL prior, then
  agents to verify — which is the same division of labour as a deterministic score plus a case-level gate, with
  the verification moved into an LLM.

- **Alibaba Cloud RCA Benchmark** (2026, open source): a **runtime environment** + four-level structured ground
  truth (fault type, normalized root-cause entity, causal propagation chain, key evidence checkpoints) + a
  deterministic scoring protocol for AGENTIC ops, weighted `40 / 30 / 30` over identification, demarcation and
  procedure, with "nearly 70%" of the score computed from topology distance rather than from an LLM judge. Its own
  announcement states **200+ compliant samples over `L1–L4`** on a Kubernetes e-commerce system of **40+ services
  with call chains 7 layers deep** — so its population is **its own simulation, not RCAEval, and not a case count
  of ours either** (verified 2026-11-09 from the vendor's own release note, its full text and not a summary of
  it). It is a **protocol, not a published table**: no per-case results and no `AC@1` on any population exist yet,
  its scoring unit is a three-dimension composite rather than a service ranked first, and it carries **no DOI or
  arXiv identifier** for `docs/sota-populations.md`'s grammar to register — so it is named here rather than priced
  there, and it moves the day it publishes readings under an identifier.

### 0c-iii. Two 2026 papers about WHAT THIS BENCHMARK MEASURES — one of them an audit of it

Both arrived after the last survey and both change how a reader should read the nine cells above, so they are
placed here rather than in the competitor table: neither reports a `top@1` on our population, and one of them
argues that such a number is not the measure it looks like.

- **`arXiv:2609.27069`**, Buljić, _Does Graph Structure Earn Its Place in Microservice Root-Cause Analysis? A
  Controlled Study on RCAEval, and What the Benchmark Was Really Measuring_ (2026-09-22, preprint also at
  `10.5281/zenodo.22832168`). It runs three learned arms with identical features, optimiser, split, early-stopping
  and scoring head, separated by one graph-specific term, and finds **no reliable graph-specific effect**
  (`+0.003` Avg@5, `p = 0.844`, `n = 6` disjoint folds). It then audits the benchmark and reports two properties
  that condition any result on it: **faults are injected into only five services per system while telemetry
  exposes 12–70**, so a ranker reading **no telemetry at all** puts the culprit in the **top five on `99.7%`** of
  held-out incidents (`Avg@5 0.488`, against a uniform-random `0.137`); and **a non-uniform column schema silently
  zeroes telemetry for most RE1 cases**. Its twelve-item checklist for graph-versus-flat ablations is distilled
  from **62 recorded defects**.

  **This document agrees with all of it, and the agreement is already instrumented rather than argued.** The
  `[prior-floor]` report every run prints is the same measurement, at a stricter metric:

  | cell                 | injected services `S` | telemetry-free **AC@1** (frequency prior) | engine **AC@1** |                          lift |
  | -------------------- | --------------------: | ----------------------------------------: | --------------: | ----------------------------: |
  | `RE1:OnlineBoutique` |                     5 |                                   `20.0%` |         `90.4%` | 88.0% of the reachable margin |
  | `RE3:SockShop`       |                     3 |                                   `40.0%` |         `80.0%` | 66.7% of the reachable margin |

  And the report says of its own `Top@5 100.0%`: _«Top@5 is SATURATED by the prior here, so it is not evidence
  for this cell»_ — which is this paper's central point, stated in the artifact before the paper existed. The
  difference is the metric: `Avg@5` saturates under a five-service prior, and **`AC@1` does not** (`20.0%` and
  `40.0%` are the floors here, so `90.4%` and `80.0%` are not prior effects). Its second property — a schema that
  silently zeroes telemetry — is the same defect family this repository has now repaired four times
  (`docs/engine-input-contracts.md`, `docs/emission-jurisdiction.md`): a missing measurement answered with a
  number that looks like one.

  What it costs us is not the nine cells but a claim we should not make: **on this benchmark, the graph's marginal
  contribution is not separable from the prior by a learned arm** — which is why the ablation in §3 is built from
  single-flag counterfactuals on the shipped engine rather than from graph-vs-flat training.

- **`arXiv:2610.35767`**, Bi, Zhang, Li, Wang & Ma (PKU / BUPT), _Free to Look, Free to Reason: Simple LLM
  Harnesses Outdiagnose Hand-Crafted Root Cause Analysis Agents_ (2026-10-26). **RCAtlas**: `542` cases screened
  from **eight public datasets** (RCAEval among the cited ones), `90` validated across `23` scenarios and `10`
  fault classes. `PR@1`: simple harnesses **`65–77%`**, five published LLM RCA agents **`16–53%`**, statistical
  and causal methods **`6–39%`**, on every model where both families ran. Its mechanism claim — a program that
  fixes which evidence is read will skip the decisive evidence — is the strongest published argument for the
  design this repository already uses: **a deterministic score with one case-level gate**, and no staged
  investigation to skip anything. Its `non-LLM 6–39%` band is **not** our band and must not be read as one: those
  arms are statistical and causal rankers on an eight-dataset pool, while our `90.61%` is `top@1` on RCAEval's
  735 with the injection-time protocol, and the two share neither population nor metric.


### 0c-iv. Two 2026 arrivals surfaced by the 2026-11-18 re-read — one taxonomy and one cost structure

The re-read found **nothing above us** on any population we own, and re-verified the two entries already on
record: **OpsHarness** (`arXiv:2608.25661`) is still `59.0%` top-1 across _"two public benchmarks and an
industrial deployment"_ with `+63.4%` over a bare agent and `4.02×` over baseline RCA agents — three populations in
one sentence and no per-population figure, so §0d's standing is unchanged — and **VerifyRCA** is confirmed as a
real 2026 reference (`ICETIS 2026`, pp. 322–327, _LLM-Guided but
Evidence-Verified Root Cause Analysis for Microservice Backends_); its `72%` on the 90-case RE2-OnlineBoutique slice
was already recorded in §2b-ii and is unchanged by this pass. What the pass did add is two references that carry no
number on our cells and are therefore filed here rather than in a table:

- **`arXiv:2602.09937`**, Kim, Park, Yun & Lee, _Why Do AI Agents Systematically Fail at Cloud Root Cause
  Analysis?_ (2026-02-10, `v2` 2026-03-04). A **process-level** failure analysis: the full **OpenRCA** benchmark,
  **five** LLM models, **1 675** agent runs, failures classified into **12 pitfall types** across intra-agent
  reasoning, inter-agent communication and agent-environment interaction. Two findings are load-bearing for us.
  First, the dominant pitfalls — **hallucinated data interpretation** and **incomplete exploration** — persist
  across every capability tier, which the authors read as evidence that the failures come from the **shared agent
  architecture** and not from the model. Second, **prompt engineering alone does not resolve them**, while
  enriching the **inter-agent communication protocol** cuts communication-related failures by up to **15 pp**.
  Population is OpenRCA, not RCAEval and not RCABench, and **no `top@1` on any cell we print** appears in the
  abstract — so no gap is quoted in either direction. It is named because it is the first published taxonomy of
  what an agentic RCA loop gets wrong, and this repository's Phase III (`InvestigatorToolkit`, the `ReAct` loop)
  is exactly the object the taxonomy describes: the paper's claim is that the failure lives in the architecture,
  which is a **cheap prediction to test against our own agentic artifacts** before spending more runs on prompts,
  and its 12 labels are an instrument we can adopt without adopting anyone's numbers.
- **`arXiv:2601.02736`**, Zhang, Jia, Zhai, Pan, Duan, He, Xiao & Li (PKU / Alibaba / Tsinghua),
  _Hypothesize-Then-Verify: Speculative Root Cause Analysis for Microservices with Pathwise Parallelism_
  (**ICSE-NIER '26**, 2026-01-06). `SpecRCA`: a hypothesis-drafting module proposes
  candidates and a **parallel** root-cause verifier validates them, motivated by two limitations it names in the
  LLM-RCA literature — limited exploration diversity and dependence on large models, hence slow inference.
  Preliminary experiments are on **AIOps 2022**, which is neither our corpus nor our metric, so there is **no
  number to place**. It is named for its **cost structure**: draft cheap, verify in parallel, which is the shape to
  borrow if wall-clock becomes our binding constraint. Our own loop is sequential by construction, and every
  agentic readout this project has published is accuracy-only.

### 0c-v. The first published RCABench reading above ours, and what it is worth

Iteration 303's re-read re-verified the one entry that has to be stated plainly rather than filed: **`arXiv:2608.21310`**
(Lu, Fang, Xu, Shang, Zhang, Yang, Yan & He; `v1` 2026-08-21, `v2` 2026-10-09), *Beyond Fault Localization: A
Trajectory-Level Study of LLM Agents for Microservice Root Cause Analysis* reports **90.0 % `Acc@1`** for
**Sonnet + ThinkDepth.ai** on **RCABench**. It is the first published number on a population we own that sits
above one of our cells, and `sota-populations.md` already carries it — classified **`OTHER`**, and this entry
keeps that classification for the reason the classification exists: the 500 cases are a **random sample whose
draw the paper does not publish**, so there is no subset we can re-score to difference against. What follows is
therefore a **directional reading, not a rank**.

The comparison has to be stated with its populations, because they are not the same one:

| | this repository | Sonnet + ThinkDepth.ai |
| --- | --- | --- |
| cases | **1 422 of 1 422** (the whole corpus) | **500 of 1 430** (a random sample) |
| backbone | none — a deterministic graph engine | Claude Sonnet |
| model calls per case | **0** | ~30.5 rounds |
| tokens per case | **0** | **1 465 ktok** |
| cost per case | **$0** | **$4.64** — see the note below on why the paper's other figure is not this one |
| `Acc@1` | 80.24 % | 90.0 % |

Two things follow that the table cannot show, and both are load-bearing.

**The cost cell is `$4.64` and the paper prints a second figure that cannot be the same configuration.**
`v2` body text reads "the top-band agents sustain 45–54 effective rounds, over 1500 ktok, and roughly `$0.2`
per case" — and `1 465 ktok` at Sonnet's `$3/Mtok` is `$4.4`, so `$4.64` and `1 465 ktok` are one
configuration and `$0.2` is another. The `$0.2` is the Qwen band (whose per-token price is roughly an order
of magnitude lower) and the table above cites the Sonnet arm, so the row is `$4.64` and a reader quoting
`$0.2` against us is quoting the wrong backbone. Read as an order of magnitude rather than as a price, the
conclusion does not change: **the gap to `90.0 %` costs between two hundred and a few thousand times our
per-case bill, and ours is exactly zero.**

**The width-5 reading in §0c's predecessor was the wrong yardstick, and this is the paper that proves it.** Our
`Top@12` oracle is **90.51 %** and our `Top@20` oracle is **92.12 %** (`rank-depth.md` §2) — so a re-ranking layer
reading a twelve-deep posterior has, arithmetically, **more room than the Sonnet result used**. The published
`87.8 %` "ceiling" that ordered the agentic plan was `PER_CASE_RANK_LIMIT`, and against a 90.0 % competitor it
would have been read as "this is unwinnable" — which is what it was read as, for three iterations.

What makes it a direction rather than a gap is arithmetic on our own side, and it is the point of this entry:

**The rest of the same table is the honest context.** Under one backbone the frameworks span `77.6 %–79.6 %`
(Qwen: ThinkDepth.ai 79.2, ClaudeCode 79.6, AIQ 77.6), then `65.2 %` (TaskWeaver), `53.4 %` (RCLAgent V2),
`48.2 %` (GoS), `46.6 %` (OpenRCA), `45.8 %` (OpsAgent), `42.6 %` (mABC). Our `80.24 %` with **no model at all**
sits above every one of those and below the one configuration that swaps to a stronger backbone. The paper's own
diagnosis is that *"the backbone is the dominant lever among top-band agents"* — the framework spread under Sonnet
is `2.0 pp`, five times smaller than the `10.8 pp` model-swap gap. Read against us, that says something different
from what it says about them: **we are already at the top of the framework band without a backbone**, and the
remaining `9.76 pp` sits in the region the paper attributes to model strength.

**What to borrow, and it is not the model.** The paper's second contribution is `DiagGuard`, a two-part wrapper
over a *frozen* diagnostician: a **Grounder** that forces a systematic survey of available observations before
localisation, and a **Verifier** that audits a diagnosis against evidence before commitment. Measured on a
deliberately held-out setting (different backbone, different benchmark `AIOps 2025`, different topology) it lifts
`Acc@1` `43.5 % → 52.5 %` (`+9.0`), `pass@3` `56.9 → 67.1`, `pass@5` `62.3 → 73.0`, with near-additive,
non-redundant contributions (Grounder alone `+4.5`, Verifier alone `+4.1`, full stack `+9.0`) **and** the full
stack costs less per incident than the Grounder-only variant. Both parts are answer-agnostic prompt-level
disciplines, which means they are testable against our own loop without adopting anyone's numbers — and the
Grounder's mechanism is the one our own H9 reading called for: an agent that cannot see which channels are
**empty** will claim evidence it never read.

### 0c-vi. The 2026-11-18 sweep, stated as a negative result

The sweep for the current iteration searched three ways — a leaderboard query on RCABench, a citation query on
top-1 RCA, and a method query on causal/propagation ranking — and found **one** entry above one of our cells (the
`90.0 %` in §0c-v) and **nothing else that touches a population we own**. Two of the returns are worth naming so
that a later session does not spend the same hour:

- **`DeCoR` / `RICE-CM`** (`10.1186/s13677-026-01009-x`) is already on record at §2 and in
  `competitor-artefact-availability.md`; its `Avg@5 = 0.6000 / 0.7040 / 0.4864` on SS1/SS2/OB is an `Avg@5` over
  a **300-case** RCAEval subset, not a top-1 over the 735, and `docs/rcaeval-metric-rows.md` already carries the
  conversion caution. Nothing new.
- **`MicroInspect`** (IEEE TSC, 2026/05) is new to this record and is filed `OTHER` in `sota-populations.md`: four
  benchmarks of its own (TrainTicket, SocialNetwork, FAMOS-Mall, GAIA), **metric-level** localisation with a
  dynamic neural Granger network, reported as `F1`/`HR@1` under paired t-tests. TrainTicket is a system both it and
  we use — so it is the one to watch — but the unit is a metric rather than a service and the corpus is not our
  735, so no figure of ours may be differenced against it.

The negative result is the finding: **after three queries, the standing table is unchanged**, our `80.24 %` on
RCABench's whole 1 422 sits above every framework-band configuration in the one paper that measures that
population, and the `9.76 pp` to the single Sonnet configuration above us is the only gap on a population we own.
### 0d. A CONCURRENT REFERENCE THAT IS NEITHER ABOVE NOR BELOW US — and the harness it reports

**OpsHarness**, _From General Agents to RCA Experts: A Self-Evolving Harness for Root Cause Analysis_
(**`arXiv:2608.25661`**, Huang et al.; surfaced 2026-08-26 on HF Daily Papers; found by this iteration's survey
on 2026-10-12). **59.0% top-1 accuracy**, reported as **+63.4%** over a bare general agent and **4.02×** over
baseline RCA agents, _"across two public benchmarks and an industrial deployment"_.

**It is filed here, and not in either list above, because it is the first reference this document cannot place on
EITHER side of our own number.** A 59.0% is **below** our 78.75%, so §0a's contract ("a number we cannot beat must
be named") does not reach it. But it is not §0b's kind either — §0b is _below us **and comparable**_, which
requires a metric and a population, and this one names **three populations in one sentence** and **no
per-population figure**: the two benchmarks are now READ from its own text — **OpenRCA and RCAEval** — plus an
industrial deployment nobody else can run, and the 59.0% is an average **across four backbones**. So **one of the
three populations is ours and the figure is still not**: 59.0% against our 78.75% would be a cross-population
comparison of exactly the kind §0a exists to prevent, and the direction of the error is not knowable from an
average over four models. **The 2026-10-14 pass replaced this entry's own sentence** — _"two benchmarks it does not
name … one of the two unnamed benchmarks could be RCAEval"_ — with the names and the fact, which is a correction
of our prose rather than of theirs, and `docs/sota-populations.md` now carries the row.

**So no gap is quoted in either direction, and the standing is unchanged.** What is recorded is the **technique**,
because it is the most directly borrowable thing on this list:

> _"During evolution, OpsHarness contrasts successful and failed trajectories, converts their evidence into atomic
> proposals, and admits updates only through a dual-gate verification process designed to prevent overfitting and
> regression."_

That is **the shape of this repository's own kill criterion** — a change is admitted only if it moves the target
AND regresses nothing (`RCAEval golden 9-cell byte-identical` **and** `FSE'26 zero regressed fault types`) —
arrived at independently, by a group with no connection to us, and reported as the mechanism that makes
accumulating experience _safe_ rather than as a filter bolted on afterwards. Two independent arrivals at one gate
is the strongest evidence either has, exactly as §0a's fifth entry is for _"more machinery, lower top-1"_.

The paper's other claim is the one worth acting on: it finds that a **general-purpose agent now often beats a
purpose-built RCA agent**, so the remaining gap lives in the **harness** rather than the model. This repository's
`SelfLearn` feature is the same idea (accumulate case-specific experience across runs) and the register records
that it has never been wired; the borrowable part is not its loop but its **admission gate**, which the kill
criterion already is.

### 0e. THE SURVEY'S OWN CATCH — one new reference, and the two sentences this section used to repeat

**A "new" reference that is already on the list is an inventory failure, not a discovery.** The 2026-10-12 survey
reached the paper in §0a entry 4 — the NeurIPS 2026 Evaluations & Datasets decomposition — a **second time**, from a
press summary that carries neither its **arXiv identifier**, nor its authors (**Luan Pham** among them, the author
of RCAEval _and_ of PRISM), nor that its own statement points at a code URL — `github.com/cruiseresearchgroup/DecompRCA`
— which **does not resolve**. All
three were already in entry 4, which is the entry that calls it "the most dangerous of the four" for exactly those
reasons. The same survey also re-opened the **RE1 column-schema allegation as "owed"**, which entry 3 records as
**refuted here** (`benchmark-corpus-completeness.md` §8: a hard gate, `--fail-on-degenerate`, reading **375 of 375**
RE1 cases with non-zero telemetry). **Both sentences are corrected rather than quietly dropped**, because a
claim-bearing sentence that names a check as owed **schedules finished work** — it was this document's next plan
item — and a sentence that announces an existing reference hides the detail the existing entry already carried.

**What the survey genuinely added: `PAVE` / OpenRCA 2.0** (**`arXiv:2606.27154`**, Aoyang Fang et al. — the same
group as `arXiv:2510.04711`, the FSE'26 propagation benchmark this repository leads by **+16 pp**). 500 instances
carrying **step-wise causal** annotations, the first cross-system RCA benchmark of that shape. Across **11 frontier
LLMs**: recovering the exact root-cause set succeeds on **20.7%** of cases on average; relaxed, an agent identifies
at least one correct root-cause service in **76.0%** of cases but grounds that service in a **verified propagation
path** in only **61.5%** — the failure they name _"ungrounded diagnosis"_.

**That is this repository's loss decomposition, measured by another instrument on another population.** Our census
reads **96.6% of the deep misses as having had local evidence** — ORDERING ALONE, with the truth inside the ranked
pool on **99.73 / 99.63 / 100.00%** of the three suites — and `PAVE`'s 76.0% against 61.5% is that same gap stated
as _"found the service, did not place it"_. **No gap is quoted from it**: its metric is exact-set recovery over a
step-wise annotation, its population is 500 instances of a corpus that is not ours, and its 20.7% is **below** our
78.75% in any case. It is named for what it corroborates, and for a second reason — it is the **third independent
arrival this month** at _"the failure is in placing the cause, not in finding it"_, alongside §0a entry 4's
decomposition and our own census. Three arrivals from three groups, with three instruments, is the strongest form
this claim has had.

**The one mechanism worth carrying forward is not the pipeline but the INPUT**, and it is §0a entry 4's own: a
**short system-description document** moves that reranker by **7–18 points with the candidate set held FIXED**, so
the gain is in the CONTEXT the ranker reads rather than in the retrieval. This repository's reranker reads the raw
signals and has **no system-description channel at all**, which makes that a cheap, falsifiable candidate rather
than a slogan.

**What this does not change.** §0a's entries, §0b's one comparable reference and §0d's third class are
unchanged; no cell moved; and the two corrections above are corrections of THIS document's earlier revision rather
than of the record they cite — §0a entry 4 and entry 3 both already carried the facts, which is the point of
recording it here.

### 0j. The 2026-11-07 survey — one reference ON our family with a metric we do not print, and one at another granularity

Two arrivals, and neither is a row in §0 for a different reason.

**`DeCoR` / `RICE-CM`** (Springer, _Journal of Cloud Computing_, `10.1186/s13677-026-01009-x`) ranks services by
**reverse PageRank on a supra-adjacency** built from contemporaneous and lagged evidence, with a
**confidence-weighted** coupling between same-metric replicas — the reliability of an estimated edge decides how much
information may cross it. Evaluated on a **300-case subset** of three RCAEval datasets it calls SS1, SS2 and OB, it
reports **Avg@5 = 0.6000 / 0.7040 / 0.4864**, highest among its comparators on all three, beating `RUN` on OB by
0.0288 at ≈1/33 of its runtime.

It is not a §0 row for two reasons, and both are checkable in the abstract. Its population is a **subset** the paper
selects and does not enumerate against our three systems' case ids, so no per-cell comparison exists. And its metric
is defined in its own abbreviation list as **`Avg@5` = average accuracy over the first five cutoffs** — the mean of
`AC@1..AC@5`, which is not the quantity this document's `Avg@5` column carries (that one is the per-fault-type mean
the runners print). **The instrument is missing rather than the comparison**: `truthRank` is on every census record,
so `AC@k = P(rank ≤ k)` and the mean over `k = 1..5` are computable from artifacts this repository already stores,
and printing that column is a debt this entry names rather than a number it invents.

**`TA-RCD`** (`arXiv:2509.05511`, v2 2026-10-09) improves **metric-level** `AC@5` by 18% and `Avg@5` by 19% over its
strongest baseline on RCAEval. Metric-level is a different population from service-level: the truth is a
`(service, metric)` pair rather than a service, so the candidate set is larger and the two figures are not
comparable. It is recorded here for the one thing that transfers — its **topology-guided metric SELECTION**, which
is the same question `docs/transient-guard-test.md` asks from the other end — **whether a channel is evidence at
all**, which is the guard's own question and the one whose answer moved three populations in iteration 240.

**What is borrowable from both, stated as a hypothesis rather than as a plan.** `RICE-CM`'s coupling weight is a
_reliability_ on an estimated relation, and this repository's relation terms are admitted by a **gate** whose share
is a constant (`topoDiscountGate`, `anomalyBreadthGate = 0.8`, `dualFamilyGate = 0.25`). A per-edge reliability is
the calibrated version of that constant, and `TRANSIENT_RETURN_THRESHOLD`'s own debt in
`docs/transient-guard-evidence.md` §13.6 is the same shape: a fixed fraction standing where a measured one belongs.
That is the next axis this survey supports, and it is not enrolled.

### 0f. Two 2026 references ON our benchmark family that the 2026-10-12 second survey added

Both were checked against §0a before being recorded here, and **neither appears anywhere in either repository** —
which is the rule §0e's correction cost: grep the file for a reference BEFORE recording a survey's find as new.

**1. `TA-RCD` — a topology-guided metric-selection method evaluated on the PUBLIC RCAEval benchmark.** D. R.
Mathews, M. Verma, P. Aggarwal, J. Lakshmi (v1 2025-09-05, **v2 2026-10-09**): _Efficient Fault Localization in a
Cloud Stack Using End-to-End Application Service Topology._ On RCAEval it claims **metric-level `AC@5` +18% and
`Avg@5` +19%** over the strongest baseline, and in a controlled testbed `AC@5` at least 2× and `AC@3` at least 4×
over standard RCD.

- **It reports no Top-1.** Its metrics are `AC@5` / `AC@3` / `Avg@5` — the framework's own convention rather than
  ours — so **no gap over us can be read from it**, and it is the _second_ reference on this list whose headline is
  a Top-5 convention (§0a entry 3 is the first). A Top-5 metric cannot see a reranking defect at all, and this
  repository's loss is **98.8% reranking**, which is why its gains concentrate at `K ≥ 3` and ours cannot.
- **Its mechanism is the nearest published relative of the register's open discriminator**: a per-case signal
  SELECTION chosen from topology rather than from the ranking's own values. That is a different class of feature
  from the one whose free read closed the latency channel's routing question
  (`latency-channel-views.md` §7.9), and it is the natural place to look next.

**2. `EviRCA` — the two-stage architecture, on OpenRCA, with a large margin.** _arXiv:2609.19825_, _Decoupling
Evidence Extraction from Reasoning for Microservice Root-Cause Analysis_: on **OpenRCA** (Bank 136 / Telecom 51 /
Market 148 = **335 cases**) it reports **Correct 43.9% / Partial 56.2%** with `deepseek-v4-pro` (40.6 / 54.4 with
`qwen3.7-plus`) against **RCA-Agent 13.1 / 20.8** and **Oracle Sampling 14.6 / 22.1**.

- **A different benchmark, a different metric and a different population**, so it is not a gap over us either — but
  it is a **fourth independent arrival at this repository's architecture** (_stage one puts the evidence on the
  table, stage two discriminates among distractors_ is our retriever plus reranker; _evidence extraction versus
  reasoning_ is our retrieval-versus-reranking split), and it names **GALA** and its `SURE-Score`, which §0a already
  carries — so the two are one lineage rather than two references.
- **Its stage-two failure mode is the one §7.9 of the latency document has just measured on ourselves**: it reports
  the correct cause being demoted below _collateral_ signals — an elevated co-located neighbour, an earlier
  transient, a downstream rule — which is the same victim-versus-source pattern our loss census attributes.

**Neither moves a cell, a rank or a standing**, and §0a's entries are unchanged. The entry that does bear on us
is methodological and comes from outside this family: a 2026-08 preprint, _There Is No Neutral Harness: Modern LLM
Leaderboards Are Manufactured by Config-Fragile Items_, measured that **the same weights on the same 3 679 items
score 31% and 89% under two equally defensible evaluation configurations, with 85% of a model's correct answers
flippable by another one**. That is the general form of the rule this repository already enforces on itself — **an
artifact must carry the configuration that produced it** — and it is why a cell whose corpus is inferred counts as a
cell measured under an unnamed rule.

### 0g. A THIRD PUBLIC BENCHMARK — and the one whose unit is not a ranked service list

**Alibaba Cloud's `RCA Benchmark`**, released open source as _"the industry's first open source root cause analysis
benchmark system for Agentic Ops"_: an e-commerce microservice architecture on Kubernetes with **40+ business
services and call chains up to 7 layers deep**, real-simulation rather than synthetic, exposing **seven categories
of observation data** (metrics, logs, traces, alerts, resource topology, Kubernetes events, profiling).

**It is recorded for one reason above the others: it is a POPULATION rather than a demonstration.** **200+
compliance samples** over **40+ failure types in 6 categories**, injected through four channels, gated by a
four-layer admission check, classified into four difficulty levels (L1–L4, with L2–L3 the stated focus), and
reserved non-public samples held back to prevent contamination. §0c's Project Arena has 21 scenarios and its own
author calls it a rubric over one incident report; this one has a corpus. So _"the field has no public benchmark"_
is now unavailable in a second, stronger sense.

**And it cannot be placed on our leaderboard in either direction, because its unit is not our unit.** Its ground
truth is **four-layered** — failure type, normalized entity, causal propagation chain, key evidence edge zone — and
its score is a **weighted composite over root-cause identification, boundary demarcation and procedure at 40 / 30 /
30**, with _"nearly 70% of scores [resting] on deterministic quantization computation based on failure type
topology semantics distance and entity topology distance"_. That is a **different scoring FRAME**, not a different
metric of the same quantity: 78.75% Top-1 over a labelled service list and a composite over an
identification/boundary/procedure triple share no denominator, so no gap can be quoted and the direction of any
error is unknown. It joins §0d's OpsHarness in the file that exists for exactly this case.

**What is worth acting on is its `boundary demarcation` and `causal propagation chain` layers, and they are the
first external instrument that would reward the thing this repository measures but does not claim.** The `collision`
term, the trace-topology signal and the loss census's victim-versus-source attribution are all attempts to get the
_propagation boundary_ right; a benchmark that scores it at 30% of the total is the first one where that work has a
published denominator. Recorded as a **candidate instrument** — reproducing it is a separate decision with its own
cost — and it also names the gap in OUR corpus: RCAEval's label is a **list of acceptable roots** with no
propagation chain and no evidence-edge zone, so no result published on RCAEval, ours included, can be scored on
either of those two layers.

**One reference was checked before this section was written and is a CONFIRMATION rather than a find.**
`arXiv:2609.27069` — Buljić's controlled audit of RCAEval, surfaced again by this iteration's survey — is already on
this repository's record in **§3** of this document, in `docs/benchmark-corpus-completeness.md`, in
`docs/loss-decomposition.md` §1, and as `scripts/audit_input_schema.py`, which was built from its second finding
(_"a non-uniform column schema that silently zeroes telemetry for 250 of 375 RE1 cases"_). The survey found it, the
grep found it first, and nothing was re-derived. **Standing unchanged.**

### 0h. An INDUSTRY architecture with no number — and the one mechanism it names that this repository has already measured against

**Atlassian's automated RCA framework**, published through the **CNCF** as _"Automating root cause analysis at
scale: multi-signal correlation for cloud-native incident response"_ (2026-08-24). Not on this repository's
record until now, and it is filed as a **third class of reference**: neither a competitor with a number nor a
benchmark, but a **published production architecture** whose design choices are nameable and checkable against
ours.

**It reports no accuracy at all**, so nothing is quotable and no gap exists in either direction. What it does
report is a pipeline:

1. **Scope the search by topology** — an OpenTelemetry-derived service map, built from span parent/child
   relationships, restricts the incident to the call-path subgraph (hundreds of services → tens). _Our
   equivalent is the fault graph's own node set, and it is why the pool size is a per-case quantity._
2. **Detect per signal, then NORMALISE.** Metrics (RED: rate/error/duration) via MAD and percentile bands;
   traces via structural anomalies (unexpected exceptions, novel propagation patterns, span latency spikes);
   logs via **embedding-based clustering** for novel error clusters. Then _"each detector emits the same event
   schema, so the correlation engine can reason across signals without caring which detector produced them."_
   **This is the step this repository's register shows is where the ranking is lost.** Our 159 reranking misses
   are decided by terms whose contributions are in different UNITS — `selfAnomalyLog1p` on a rank grid of
   `0.0083` steps at 68 nodes, against `trace`/`log` contributing exactly `{0, 1}`. A normalised event schema is
   the discipline that keeps that from happening, and it is the one thing in this architecture that is directly
   actionable for us rather than merely comparable.
3. **Temporal correlation** — a sliding window (typically ±5 min) with an **exponential-decay temporal cohesion
   score**, so tightly clustered anomalies outrank dispersed ones, plus **sequence fingerprinting** to collapse
   repeated failure chains into one bundle with a replay count. _Our `temporal` term is this idea at weight `0`,
   and `docs/fse26-onset-verdict.md` closed every onset shape with **no admissible weight on either shape** —
   so the temporal axis is not a gap in our implementation but a measured non-lever on our corpus._
4. **Direction by graph traversal** — start at the **sink node** (highest anomaly severity) and walk UPSTREAM
   with bounded BFS, scoring each candidate path by anomaly severity, dependency strength and **temporal
   distance from the sink**; _"if Service A depends on Service B, and B's anomaly appears earlier in time, B is
   more likely to be the origin."_ **This is the mechanism our record refutes on this benchmark family, and it
   was refuted by measurement rather than taste**: `docs/fse26-separator-verdict.md` pairs the two populations
   and finds the graph's direction **separates per population and REVERSES between them** — source → winner in
   49 of 65 decisive replace-code pairs (AUC 0.732, stable in all five folds) against winner → source in 8–32
   for network partition and 0–19 for network loss. A global direction bonus cannot exist, which is why
   `failedEdgeWeight = 0` was already closed at 2 regressed fault types. Atlassian's construction is the same
   class of signal, stated as an architecture rather than as a weight.

**Why it is worth recording anyway.** Two reasons, and neither is a number. It is the **first industry-authored,
foundation-published statement of the same pipeline shape** this repository implements term by term, and it says
out loud what our own artifacts measure: that the hard part is not detection but **making heterogeneous signals
comparable** — a point it makes by normalising, and we make by measuring that our terms' scales differ by two
orders of magnitude. And its **source is not a paper**: it is a CNCF post with no code, no dataset and no
accuracy, so it joins §0c's Project Arena and §0g's Alibaba benchmark in the file's _"publicly stated, not
reproducible as a number"_ class rather than in any table.

### 0i. Two 2026 arrivals on our OWN family that the 2026-10-28 survey added — one with a number, one with a theorem

**1. `TORAI` — `Proc. ACM Softw. Eng. 3, FSE, Article FSE130` (July 2026), DOI `10.1145/3808137`,
`arXiv:2604.13522`.** Pham, Ha, Xiuzhen Zhang (RMIT) and Hongyu Zhang (Chongqing). _Multi-source Root Cause
Analysis for Blind Spots in Microservice Service Call Graph._ Read from the ACM record and the arXiv PDF on
2026-10-28; artifact `figshare 10.6084/m9.figshare.31938495.v1`.

- **The claim is an `Avg@5` and it must be read as one**: **Train-Ticket `Avg@5` 0.89** against `CausalRCA`
  0.43 and `CIRCA` 0.46, and **Sock Shop at 100% blind spots `Avg@5` 0.94** from metrics and logs alone. That is
  the **third** reference on this list whose headline is a Top-5 convention (§0a entry 3, §0f entry 1), so **no
  gap over our `AC@1` can be read from it in either direction** — and this repository's loss is 98.8%
  reranking, which a Top-5 metric cannot see.
- **Its mechanism is the one our register has been circling from the other side.** The pipeline is
  `SeverityScorer` → **GMM clustering of services by severity symptom** → **localised `Ψ-PC` causal discovery
  inside each cluster** → rank aggregation → median/IQR hypothesis testing. The stated reason for the clustering
  step is _"clustering prevents causal dilution: running causal discovery on thousands of metrics degrades
  performance"_. **That is our `GT rank = 33 of 68` problem named by someone else**: a lever that must move one
  candidate 32 places without moving the 32 above it is a lever fighting a global ranking, and every re-weighting
  this repository tried on RE3-TrainTicket failed for exactly that reason.
- **One design choice of theirs is the inverse of ours and worth recording as such**: a missing modality
  **imputes a score of 0**. Our censuses treat absent as _absent_ and refuse to fold it into zero
  (`trace-riser.md` §3 is the latest statement). Their choice is safe where ours would not be, because they
  cluster rather than rank globally — a zero inside a cluster of noisy services does not have to be
  distinguishable from a measurement. Reading the two side by side is the argument for _where_ an imputation is
  admissible.

**2. `BRCD` — `ICML 2026` Spotlight, poster 65359.** _Root Cause Analysis of Failures in Microservices via
Bayesian Root Cause Discovery._ **Read from a SECONDARY summary on 2026-10-28, not from the poster or a
preprint** — the primary has not been fetched, and this entry is written to say so rather than to be quoted. As
summarised: it drops the full-causal-graph requirement, using a **pre-learned PARTIAL graph** with uniform DAG
sampling and Bayesian inference, and claims the **first statistical consistency guarantee in non-parametric
root-cause analysis**, evaluated on synthetic benchmarks and Online Boutique with SOTA accuracy under few-shot
conditions.

- **Filed as a DIRECTION rather than as a number**, for the reason above: no metric, no population and no
  artifact were verified, so nothing here is a gap in either direction.
- What it shares with `TORAI` is the 2026 consensus this repository should note without adopting blindly: **the
  full service call graph is not a reliable input** — `TORAI` removes it, `BRCD` relaxes it to a partial graph.
  Our engine still ranks on the graph it is handed, and the node set is what makes `RETRIEVAL 10.3%` of RE3's
  misses unreachable at all. That is the quantity to watch if this direction is ever taken up.

**Neither moves a cell, a rank or a standing.** §0a's entries and §2's leaderboard are unchanged, and the
`AC@1` column still has no competitor on our population except §0b's.

### 0f. THE 2026-10-29 SURVEY — one new peer-reviewed method, on a population that is not ours, and nothing above us

Four searches this iteration (competitors, evaluation sets, the kinetic-theory literature, and the reference list
itself) produced **one reference this document had never named**, and it moves no number:

**MICA**, _A multimodal-interaction and causality-aware approach to microservice fault diagnosis_
(`10.11772/j.issn.1001-9081.2026060665`, _Journal of Computer Applications_, 2026). Cross-modal attention across
metrics, logs and traces, a **transfer-entropy**-weighted causal graph, a mixed-expert router for modality
weighting, and counterfactual validation of the candidate source. It reports Top-1 gains over MicroRank,
SwissLog, MicroRCA, DiagFusion, MicroCause and Sage on **GAIA and the classic TrainTicket corpus** — the standalone
benchmark, **not RCAEval** — and every figure it states is a **delta against those six baselines on those two
corpora**. Its verdict is therefore **`OTHER`**: it names a population that is not one of ours, and **no gap may be
read from it in either direction**.

**And it cannot be read as a Top-1 claim at all, for a reason that is about the paper rather than about us.** No
absolute accuracy appears in either abstract; every number is a delta; and **the two language versions of that one
abstract assign the same six numbers to different metrics** — the Chinese calls them `Top-1` and `MRR` gains, the
English calls them `MRR` and `RCL@3`. A reference whose own two abstracts disagree about which metric its numbers
belong to is not quotable on any axis, and the row records the disagreement rather than picking the version that
would read better.

Two parts of it are worth reading rather than citing, and neither is a number:

1. **Transfer entropy as an EDGE weight.** Our `collision` and `topo` terms are both at weight 0, and both are
   attempts at the same question — which edge carries the fault — so a fourth formulation of that question is a
   candidate for the axis the register already holds open, not a new term. What MICA adds is that the weight is
   estimated from the series rather than from the graph's structure, which is the difference between our
   `topoSource` (structural) and this (statistical).
2. **Counterfactual validation of the candidate.** It re-runs the diagnosis with the candidate removed and keeps
   it only if the symptom disappears. This is the one form of `ablation` this repository has never had **inside
   the engine** — every ablation here is offline, over a corpus — and it is the natural consumer of the same
   per-case evidence the censuses now print.

**Nothing else moved.** No reference on a population of ours was found that is not already inventoried; the only
figure above us on the 735 remains the vendor's **89%** (§0a entry 1), which ships no per-case results and cannot
be reproduced here; and the row for MICA is in `docs/sota-populations.md`.

## 0g. The floor under every number in this document — added 2026-10-29

Every figure below is **Top-1 accuracy on a corpus whose label space has two to five members per cell**, and that
is not an incidental property: it re-prices the comparison in both directions. The label distribution was read
from this repository's own 735 loss-census rows and is tabulated in
`docs/benchmark-corpus-completeness.md` §9. Three consequences apply to every row of every table in this document:

| cells                      | label space                      | strongest constant Top-1 | what it means for the comparison                              |
| -------------------------- | -------------------------------- | -----------------------: | ------------------------------------------------------------- |
| RE1 ×3, RE2 ×3 (645 cases) | 5 truths, **perfectly balanced** |                    20.0% | a prior buys nothing over chance; the task is genuinely 5-way |
| RE3:TrainTicket (30)       | 2 truths (15 / 15)               |                **50.0%** | a constant answer scores half the cell                        |
| RE3:SockShop (30)          | 3 truths (12 / 9 / 9)            |                **40.0%** | —                                                             |
| RE3:OnlineBoutique (30)    | 4 truths (15 / 9 / 3 / 3)        |                **50.0%** | —                                                             |
| whole corpus (735)         | per-cell priors                  |               **23.27%** | —                                                             |

So a competitor's Top-1 on RE3 must be read against 40–50%, not against 0%; and any `Avg@5` on this corpus must be
read against a ceiling of **100%**, because a constant top-5 holding a cell's truths covers all 735 cases — which
is why this repository's headline metric is Top-1 and why an `Avg@5` figure in a comparison row is annotated
rather than ranked.

This does not lower our published 89.80% and does not raise a competitor's: it states the floor each number was
measured above. The two RE3 cells with the largest headline gap to the leaders (SockShop, TrainTicket) are exactly
the two whose floors are highest, and that coincidence is the reason this section exists.

**Read against the floor, the three RE3 cells now stand at +33.3 (OnlineBoutique 83.3 over 50.0), +23.3 (SockShop
63.3 over 40.0) and +23.3 (TrainTicket 73.3 over 50.0)** — the last of which is iteration 153's three cases plus
two. The remaining RE3 deficit is concentrated where the floor is highest, which is a statement about what that
cell can prove rather than about how far behind the engine is.

**The floor is a READING from iteration 225, not a section.** The paragraph above was computed by hand from one
artifact and then quoted, so the column below went stale the moment the engine moved, and a later run could print
a rate on a new configuration without the baseline that made it readable. `benchmarks/src/prior-floor.ts` now
computes both baselines from the cell's own truth support — the uniform one and the majority-class one, which
coincide on the six balanced cells and separate on the three `RE3` cells — and `run-rcaeval.ts` prints them, with
the share of the reachable margin the engine occupies (`lift`), beside every cell and once for the run.
`docs/prior-floor.md` owns the record. Two consequences for this document: an `Avg@5` row is now annotated with
its floor rather than ranked, because the floor is `1.00` on every cell of this corpus; and a cell is ranked by
`lift` rather than by rate, which moves `RE3:SockShop` — the lowest cell — to the lowest lift by a factor of two
(`38.9 %` of the margin above the `40.0 %` majority-class rule, against `66.7 %` and `46.7 %` on its own suite).
**The lift is taken against the FREQUENCY baseline and not the uniform one**, because the majority-class rule is
what a competitor can implement from the label counts alone; taking it against the weaker baseline is the defect
`docs/prior-floor.md` §3.2 records, and on the three imbalanced cells it overstated the margin by `11.1`, `6.1`
and `0` points.

## 1. Our result — re-anchored 2026-11-09 on the battery §0p-iv names

| suite                         | OnlineBoutique | SockShop        | TrainTicket | suite avg           |
| ----------------------------- | -------------- | --------------- | ----------- | ------------------- |
| RE1 (metric, 125/system)      | 90.4% (113)    | **95.2%** (119) | 90.4% (113) | **92.0%** (345/375) |
| RE2 (multi-source, 90/system) | 93.3% (84)     | **98.9%** (89)  | 84.4% (76)  | **92.2%** (249/270) |
| RE3 (code-level, 30/system)   | **86.7%** (26) | 80.0% (24)      | 73.3% (22)  | **80.0%** (72/90)   |
| **overall (735 cases)**       |                |                 |             | **90.61%** (666)    |

**Every number above is read from the artifact of one battery, not from the previous version of this table.**
`rcaeval-loss-census-{re1,re2,re3}.jsonl` carry one record per case with a `correct` flag, and the nine cells are
their sums: `113 + 119 + 113 = 345`, `84 + 89 + 76 = 249`, `26 + 24 + 22 = 72`, and `666` of `735`.

**What this section was, and why it is worth recording.** It carried `85.85% (631/735)` with RE1 at
`85.6 / 92.8 / 83.2` and RE2 at `88.9 / 94.4 / 83.3` — the reading of the run BEFORE the boundary gate was
enrolled. The enrolment did not go unrecorded: §2026-10-30 (4) is a table that states `641 = 87.21 %` and
calls it **enrolled**, certified by a bare push-triggered run (`41031397704`) with nine cells identical to
`41020001659`. So for a day this document held two readings of one number, one at the top and one eight hundred
lines down, and **the stale one was the one a reader meets first**. §0p records the repair, its four members
and the fence that now holds the tables to one anchor.

**What moved into the table above arrived in four instalments, and only two of them are enrolments.**

1. **The boundary gate (2026-10-30).** RE2:OnlineBoutique `80 → 83`, RE2:SockShop `85 → 88`, RE3:TrainTicket
   `21 → 22` — the operator returning truths its predecessor had deducted: the freed caller keeps `(1 − rho)·a`
   and the gate decides whether it is charged at all. RE1:OnlineBoutique was unmoved at 107.
2. **The guard policy, `endpoint` → `evidence-trimmed`.** RE1:OnlineBoutique `107 → 112` is the largest single
   move of that enrolment and the one that matters, because it is the **one cell where a published reference
   stood above us** (`arXiv:2610.05009`'s per-system Table 5): the five cases the two-sample statistic dropped
   were a plateau whose last sample returns.
3. **A single case, at no configuration change at all.** RE1:OnlineBoutique `112 → 113`,
   `re1ob_currencyservice_loss_1`, fixed by one of the thirty-five commits between the previous anchor's
   revision and `0ffc38f0` and recorded nowhere until §0p-ii found it by diffing two batteries' censuses.
4. **The guard policy, `evidence-trimmed` → `hump` (iteration 240).** RE2:SockShop `88 → 89` and
   RE2:TrainTicket `75 → 76`, with one regressed answer paid for inside its own cell and fault type
   (`docs/transient-guard-evidence.md` §13.4).

**A reader should take the third instalment as the instructive one**: three enrolments are visible in this
document because each was argued for, and a one-case fix that nobody enrolled is invisible by construction — it
is smaller than the rounding of every percentage here, larger than nothing, and it moved the cell where the
standing was tightest.

---

## 2. The complete leaderboard — RCAEval, service-level Top-1

Two cohorts must be reported separately, because they are measured on different case sets.

### 2a. Full-benchmark (all 9 subsets = 735 cases)

| method                     | Top-1                                                                | paradigm                                                        | source                                                                                        |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Micro-Kinetic (ours)**   | **90.61%** (666/735)                                                 | deterministic causal fusion (graph + rank-normalized log/trace) | this repo                                                                                     |
| PRISM                      | 68% (Top-3 91%, Avg@5 87%); **78.91% reimplemented on this harness** | graph-free, internal/external property decomposition            | arXiv:2601.21359 (Luan Pham, RCAEval author); our reimplementation in `prism-head-to-head.md` |
| BARO (best pre-LLM causal) | 19% (Top-3 74%, Avg@5 63%)                                           | non-parametric causal discovery                                 | arXiv:2601.21359 / 2412.17015                                                                 |

> Two traps avoided here: (i) BARO's often-quoted **0.69** is its _Train-Ticket RE2 Avg@5_, **not** its overall
> Top-1 (which is 19%); (ii) PRISM is the benchmark author's own graph-free method — it is the correct "academic
> SOTA" anchor, **not** the nofire.ai "GALA 42%" figure. A third trap is now visible: PRISM's `68%` and our
> `90.61%` are **not** the comparison to optimise against, because our own reimplementation of PRISM reaches
> **78.91%** on the same harness. The published numbers describe two different measurements; the reimplementation
> describes one.

### 2b. RE2-OB subset (90 cases) — where all LLM agents report

| method                       | AC@1 / R@1                                                      | paradigm                             | source           |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------ | ---------------- |
| **Micro-Kinetic (ours)**     | **93.3%**                                                       | deterministic                        | this repo        |
| RCLAgent (Qwen-3.6-Plus)     | 56.67%                                                          | LLM multi-agent recursion-of-thought | arXiv:2605.14866 |
| RCLAgent (Claude-3.5-Sonnet) | 52.31%                                                          | LLM multi-agent recursion-of-thought | arXiv:2605.14866 |
| GALA                         | 42.22% (45.59% R@1)                                             | LLM agentic ReAct                    | arXiv:2508.12472 |
| mABC                         | 39.98% **— NOT OUR POPULATION, and not the paper's own figure** | LLM multi-agent                      | arXiv:2404.12135 |
| RCAgent                      | 25.32% **— NOT OUR POPULATION, and not the paper's own figure** | LLM ReAct + tools                    | arXiv:2310.16340 |
| OpenRCA                      | ~15%                                                            | LLM                                  | ICLR'25          |

> **The rows above whose populations this table ASSERTED and our record had never read are now all read, and they
> did not resolve the same way.** `RCAgent` is `OTHER` (2026-10-15): its own full text evaluates **161 Flink jobs from
> Alibaba Cloud's internal platform** and reports **semantic scores (METEOR / BLEURT / EmbScore), no top-1 percentage
> at all**, so the `25.32%` above is not its figure — and its inputs are unavailable. `mABC` is `OTHER` (2026-10-17)
> for the same shape: a **curated 900-alert TrainTicket** plus the 2020 AIOps Challenge, scored on **RA/PA with a
> four-root-cause cap**, so the `39.98%` here is another group's re-measurement.
> **`RCLAgent` is `OURS`** (2026-10-19) and this one resolves in our favour: its own full text and its own project
> page both name **RCAEval RE2-OB** among its datasets, so the `56.67%` is on the population we report on and the
> `+30.0pp` beside it is like-for-like rather than cross-corpus — with the qualification that its own headline
> metrics are `MRR / R@1 / R@3 / R@5 / R@10` (69.73 / 73.24% MRR on AIOPS-2022 for two backbones), and that an
> independent 2026 leaderboard re-running it over **all nine subsets** reports `10%` top-1 against PRISM's `68%`.
> `GALA`'s row _is_ read: its own text evidences the 90-case RE2-OB population. **No
> number in this table changes**; what changes is that a reader can now tell which of them rest on a reading and
> which on our own heading — and that the heading's _"where all LLM agents report"_ is now a claim every row of it
> can support on a reading.

### 2b-ii. GALA+ (ASE'26) — a reference we had CITATION-only, and the first published number on RE2-TrainTicket

`arXiv:2608.08968`, **GALA+**, the ASE'26 successor to the `arXiv:2508.12472` entry in the table above. It was
already in `sota-roadmap-2026.md`'s reference list — **and nowhere else**, so the number it reports had never
been read. It has now been read, and it changes two standings.

| population                     | GALA+ AC@1 | GALA+ AC@3 | ours (published) |           Δ | ours (it.95 candidate) |           Δ |
| ------------------------------ | ---------: | ---------: | ---------------: | ----------: | ---------------------: | ----------: |
| OnlineBoutique RE2 (90 cases)  |     74.44% |     98.89% |        **93.3%** | **+18.9pp** |                  93.3% |     +18.9pp |
| **TrainTicket RE2 (90 cases)** | **73.33%** |     85.56% |        **84.4%** | **+11.1pp** |          66/90 = 73.3% | **−11.1pp** |

> **This table was wrong in its only contested row, and the error ran in the direction that flatters a
> competitor.** It read our RE2-TrainTicket as `71.1% (64/90)` and declared a **two-case deficit**. `71.1%` is
> `64/90` — it is the **RE3 suite average before the boundary gate**, not an RE2 cell, and RE2-TrainTicket has
> been `76/90 = 84.44%` since the guard policy enrolled — `75/90 = 83.33%` from iteration 129 to it — which is the
> cell that `§0`'s own row 4 states. The corrected reading is a **ten-case lead** over GALA+, not a deficit, and
> the third consequence below is consequently **retracted rather than repaired**: a candidate that reads `66/90`
> on a cell we hold at `76/90` is a REGRESSION of ten cases, and the sentence it supported — that a gated candidate was "worth exactly the
> margin to a published ASE'26 method" — was an artefact of comparing a candidate against the wrong cell.

**The population is 90 cases on both systems, and that is read off GALA+'s own AC@3 rather than assumed**:
`98.89% = 89/90` and `85.56% = 77/90`. RCAEval's RE2 is 90 cases per system (6 fault types × 15), which is the
same population size and the same suite name.

**Three consequences, and the second is the one to act on.**

1. **On RE2-OnlineBoutique we still lead, and by less than before.** GALA+ at 74.44% displaces RCLAgent
   (56.67%) as the strongest published external number on that slice — and it also sits above VerifyRCA's 72%,
   which `§0c` had recorded as the only comparable reference. Our lead there goes from being measured against
   56.67% to being measured against 74.44%: **+12.2pp, not +30.0pp.** The old table's `GALA 42.22%` row is the
   PRIOR paper's number and must not be quoted as this method's.
2. **On RE2-TrainTicket this is the first published competitor number on any TrainTicket cell in this
   document, and it does not change the standing.** §2b is titled _"where all LLM agents report"_ and carries
   only OnlineBoutique; the implicit reading was that no competitor reports TrainTicket, and that reading was
   wrong — GALA+ reports **73.33% (66/90)** on the same 90-case population. Against our **84.4% (76/90)** it
   is a **ten-case lead**, so the correct sentence is the one §0's row 4 already carried, and the version of
   this paragraph that read it as a two-case deficit is what §0p records.
3. **And the iteration-95 candidate is RETRACTED, not repaired.** The paragraph that stood here claimed
   `suppress_idle_transients=1` closed the deficit exactly (`66/90 = 73.333%` against `73.33%`). On the cell as
   it actually reads, `66/90` is **ten cases below** the shipped `76/90`: the candidate is a regression, the
   "exact closure" was a comparison against the wrong population, and **the routing question it was said to
   decide is not a question** — the shipped configuration is already ten cases ahead of the reference the
   candidate was said to reach. What survives from that reading is the fault-type detail (`disk` regressed
   21 points for `cpu +20`, `mem +6.7`, `socket +6.7`), which is a real fact about the candidate and a second,
   independent reason not to run it.

**What is NOT claimed, and the repository's own standard is why.** This is a **paper-versus-paper** comparison,
not a head-to-head: the head-to-head in `§0a` is `78.91 vs 78.75` over the _identical 735 cases_, and nothing
here establishes that GALA+'s 90 TrainTicket cases are the same 90 as ours. Two things must happen before the
`+11.1pp` is treated as a measured lead rather than a named one: **confirm the case set from the paper's own
dataset section, and obtain an artefact that carries the method** — `docs/competitor-artefact-availability.md`
inventories every reference this document names, and the two that would decide this cell —
`github.com/EvanTian233/GALA-for-RCA` and `github.com/cruiseresearchgroup/DecompRCA` — are respectively
withheld and unresolvable, so the comparison cannot be run in either direction and the deficit stays a named
risk rather than becoming a measurement.

**A third-party reading is recorded with it, because it bears on the metric.** A published referee report on
this paper (`pith.science`, T0 AI review, 2026-08-14) accepts the architecture and the ablations and disputes
the headline: _"its headline accuracy claim overstates diagnosis quality because the ranking metric ignores
failure-mode match"_. That is the same distinction our own `§0d` draws about composite scoring — a Top-1 over a
labelled service list is not a diagnosis — and it means the `73.33%` is a Top-1 number, comparable to ours as a
Top-1 and to nothing else.

**And what is borrowable regardless of the standing.** `STRIX` scores each service on three named dimensions —
`ϕ₁(v) = p99(v)/p50(v)` (instability), `ϕ₂(v) = PageRank(v)·(1+in(v))/(1+out(v))` (centrality), and
`ϕ₃(v) = TotalLatency(v)·max(0, 1 − max_u AvgLatency(u)/AvgLatency(v))` (impact) — fused by reciprocal-rank
fusion with `ε = 60`. Two of the three are **exactly the kind of term this repository has measured and rejected**
(`ϕ₂` is an ancestry/centrality signal and `ϕ₁` a p99/p50 instability ratio), which is worth recording rather
than assuming: the paper's own ablations are what make its claim, and its scorer is not a new mechanism for us.
Its **graph-guided investigation** — parallel investigators bounded to predecessors and successors with a
`θ = 0.6` confidence gate and `O(kΔ)` worst-case work — is the part that is genuinely different in kind, and it
is the same territory as our Phase III agentic work rather than a term to add.

### 2c. Single-system / other slices (not directly comparable to 90.61%)

| method     | result        | slice                                                                                                                                                               | source              |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| StableRCA  | 77% Top-1     | **Sock-Shop `[soc, 2022]` — a corpus its own text lists SEPARATELY from RCAEval**, and not RE1-SS; no case count is stated, so no gap can be read against our 92.8% | arXiv:2606.05636    |
| MARLIN     | 61.1% PR@1    | OnlineBoutique                                                                                                                                                      | sota2.com, Mar 2026 |
| DynaCausal | avg AC@1 0.63 | mixed public benchmarks (not RCAEval-only)                                                                                                                          | arXiv:2510.22613    |

---

## 2c. The class the FSE'26 row was never compared against — 90.0% Acc@1 on RCABench

`arXiv:2510.04711` (the benchmark paper) evaluates **eleven models**, none of them with tool use, and reports a
mean Top@1 of 21% with a best of 37%. That panel is what the STANDING row above measures against, and it is the
wrong panel for this benchmark as of 2026.

`arXiv:2608.21310` — a trajectory-level study **on RCABench** — evaluates **ten LLM-agent framework/backbone
configurations** under the benchmark's own scoring rule, which it states explicitly:

> Each case has a ground-truth root-cause set `R*_i` of one or two services. `Acc@1 = (1/N) Σ 1[r̂_i ∈ R*_i]`

| configuration (backbone · framework) |     Acc@1 |
| ------------------------------------ | --------: |
| Sonnet · ThinkDepth.ai               | **90.0%** |
| Qwen · ClaudeCode                    |     79.6% |
| Qwen · ThinkDepth.ai                 |     79.2% |
| Qwen · AIQ                           |     77.6% |
| Qwen · TaskWeaver                    |     65.2% |
| Qwen · RCLAgent V2                   |     53.4% |
| Qwen · GoS                           |     48.2% |
| Qwen · OpenRCA                       |     46.6% |
| Qwen · OpsAgent                      |     45.8% |
| Qwen · mABC                          |     42.6% |

Three things follow, and only the third is comfortable:

1. **We are not first on RCABench.** 61.46% sits between the fourth and fifth agentic configurations, and 28.5 pp
   below the best. The STANDING row's "+24.5 pp over the best" is a margin over a panel that cannot query
   telemetry; it is not a standing on this benchmark and the row now says so.
2. **The population is a 500-case sample**, drawn without replacement from the 1,430 cases, so the two figures are
   not case-for-case comparable — but the direction is not in doubt at this distance.
3. **Their comparison boundary contains no non-LLM method at all.** The paper compares agent frameworks and
   backbones; the statistical/graph/causal class appears only in its related work, with no numbers. So on RCABench
   there is exactly one non-LLM entry with per-case results, and it is ours — and being alone in a class is not the
   same as leading a benchmark. The class distinction is recorded here so that neither reading is mistranslated
   into the other.

What the agentic arms have that this engine does not is **evidence navigation**: 30–140 rounds of re-querying
telemetry per case, at $0.01–$4.64 per case (their table). The engine is one deterministic pass over a
pre-extracted feature set with **zero per-case cost**, and the honest summary of the gap is that the pass is
currently leaving 18–29 pp of retrievable evidence on the table. The two levers that are _measured_ rather than
assumed are the input-side losses named in §2d.


### 2c-ii. Where the two configurations actually differ, by fault family

The overall difference is `8.7 pp`, and it is not spread evenly. The table below groups the corpus's 25
families by the mechanism they exercise, with every count read from the shipped depth artifact
(`pnpm exec tsx benchmarks/src/run-depth-report.ts --depth …` prints the per-family table these rows are
summed from; the competitor column is the paper's own per-category `Acc@1`, and the two grouping schemes are
**not** one-to-one — the mapping shown is the nearest category, not an identity):

| group | cases | this engine | nearest paper category |
| --- | ---: | ---: | --- |
| `HTTP*` (9 families) | 796 | **78.77 %** (627) | HTTP 87 % |
| `Network*` (5 families) | 254 | **72.44 %** (184) | NETWORK 89 % |
| `JVMException` + `JVMReturn` | 64 | **68.75 %** (44) | CODE (JVM) 93 % |
| `JVMMemoryStress` + `JVMLatency` + `JVMCPUStress` + `JVMMySQLLatency` | 182 | **97.80 %** (178) | RESOURCE 94 % |
| `ContainerKill` + `PodFailure` + `PodKill` | 123 | **100.00 %** (123) | — |
| `TimeSkew` + `DNSRandom` | 3 | **0.00 %** (0) | — |

The paper's own attribution makes this less comfortable than "the model is simply better". Its largest
backbone gain is on RESOURCE (75 % → 94 %) and CODE/JVM (66 % → 93 %); the first is a group this engine reads
at `97.80 %`, and the second is the group it reads worst (`68.75 %`, a `24.3 pp` gap). So the deficit is
**partly** in the place the model's advantage is, and partly in a place the model's advantage is not.

**Weighting by cases rather than by percentage is what sizes the work.** Closing the three trailing groups to
the competitor's rate is worth, case by case:

```
HTTP           796 × (87.0 − 78.77) % = 65 cases
NETWORK        254 × (89.0 − 72.44) % = 42 cases
JVM-exception   64 × (93.0 − 68.75) % = 15 cases
                                      ─────────
                                        122 cases  =  +8.58 pp
```

`1 156 + 122 = 1 278 = 89.87 %`. **A perfect transfer of the competitor's per-category rates lands at
`89.87 %` — `0.13 pp` short of `90.0 %`.** The remaining margin is not in any family; it is in the order, and
the order's own bound is `90.51 %` at rank 12 and `92.12 %` at rank 20 with `absent = 0`
(`docs/rank-depth.md` §2). A configuration that reads twelve candidates correctly beats `90.0 %` without a
single model call — and the 122 cases above are the ones that make the first 8.58 of those points.
## 2d. The RCABench archive read through a SECOND path: 42.69% (607/1422) against this row's 61.46% (874/1422)

The FSE'26 row above (61.46%, 874/1422) is read through the FSE'26 harness. `docs/rcabench-first-reading.md`
builds a second path to the same archive — the raw Zenodo datapacks (`10.5281/zenodo.17105974`, 13.4 GB,
**1 422 packs**) converted into the RCAEval case layout and scored by the shipped runner and the shipped loader,
with no second ranking code.

| reading (whole archive, shipped configuration)                   |                       value |
| ---------------------------------------------------------------- | --------------------------: |
| AC@1                                                             |      **42.69% (607/1 422)** |
| Top@5                                                            |          68.70% (977/1 422) |
| cases whose ground truth is not a node of the graph              |              **0 of 1 422** |
| of the 815 misses, the winner is a caller or callee of the truth |             **547 (67.1%)** |
| paired arm: `--families core` → `--families full` (158 cases)    | 30.4% → **37.3%** (+6.9 pp) |

**This row read 32.28% until 2026-11-06, and the 10.4 pp between the two is a defect in THIS runner, not a gain.**
`BenchmarkGroundTruth.serviceIds` documents that "ranking is scored against the accepted set"; `run-fse26.ts` obeyed
and `benchmark-runner.ts` — the runner behind every RCAEval cell — scored `rank[0] === serviceId`. The corpus
declares two-element ground truth on **1 053 of 1 422 packs** (an edge-injected fault is neither endpoint alone), so
one label at a time threw away 148 cases. Fixed at the single owner `acceptedTruthServiceIds`, with the nine RCAEval
cells re-read afterwards and unchanged (RE1-OnlineBoutique 89.6%, byte-identical).

**The two paths still disagree by 18.4 pp on the SAME 1 422 injections, and that is the finding.** The population
candidate is dead — both numbers are whole-archive. The loader contract survives: the FSE'26 loader hands the engine
`traceEdges` and `failedTraceEdges` (caller → callee, calls, failed calls) and metrics from four parquet sources plus
trace-derived golden signals; the RCAEval loader hands it raw spans, a topology document it then _prunes_ (−23% of
edges) and one metric source. The metric-source half is **priced at +6.9 pp** by a paired 158-case arm (`ck`
container-kill 0/10 → 4/10, `st` 5/15 → 9/15, `rq` 2/5 → 4/5); the **call-graph half is unpriced**, and it can only
widen the gap, never close it by itself.

Until then **neither number should be quoted on its own**, and **neither is a leaderboard row**: RCABench's published
frame is a 40/30/30 composite over a set-valued ground truth, not Top@1 — and §2c above is the panel this row was
never compared against.

What the reading establishes beyond the number: `attr.status_code` is POPULATED here (the RCAEval RE3 TrainTicket
packs carry 189,488 spans with it empty), so `failedEdge` has a subject on this corpus that it never had on those;
two thirds of the misses name a caller or callee of the source; and **`rrc` — 231 cases, the largest family in the
archive — reads 21.2%**, the family whose only signature is a failure RATE, with `failedEdge` (weight 3.0) _costing_
rather than earning where it acts.

## 3. Corrected verdict

**Headline (defensible):** On RCAEval overall Top-1, Micro-Kinetic (**90.61%**) leads the published field — ahead of
the benchmark author's own PRISM (**68%**) by ~21.7 pp (**~1.32×**), and ahead of every LLM agent by 20–40 pp
(RCLAgent 56.67% RE2-OB, GALA 42% — and `mABC`'s `40%`, which is **another group's re-measurement on AIOPS-2022 rather than that paper's own figure**, since its metric is RA/PA with a four-root-cause cap; see §2b and `docs/sota-populations.md`). It is also **orders of magnitude cheaper and faster** than the LLM
cohort (deterministic, sub-second, zero API cost vs LLM agents at seconds-to-hours). Against the **same harness**,
the last measured pair reads one case behind PRISM's reimplementation and **that pair is four enrolments old on our
side alone** — see gap 1, which is no longer a claim about a tie but about an unmeasured comparison.

**What was wrong (both my v1 and the nofire.ai table):** "1.84×" divided the then-current overall (77.4%) by 42
(GALA), ignoring PRISM (68%), StableRCA (77% SockShop), RCLAgent (56.67%) and DynaCausal (0.63). The correct
competitor is the benchmark author's own method, and the correct margin is **~11 pp**, not ~35 pp.

**The decisive new signal — PRISM's internal/external asymmetry.** PRISM's entire contribution is a clean,
graph-free principle that we have **not** tried and that is _not_ among our 11 falsified directions:

> Root causes show anomalies in **both internal properties** (config/resource state: cpu, mem, disk) **and
> external properties** (interface: response latency, error rate, throughput); **affected components show
> anomalies only in external properties**, because faults propagate through observable interfaces, never through
> internal state.

This is a _different_ dimension from everything we falsified (label semantics, drop/rise shape, topology
direction, collision, temporal, LLM class-name). It directly targets our RE3 "error-value" losses (SS 45% / TT
51.1%), where a fan-in crash source's **internal** drop (dev ≈0.30) is out-scored by a victim's **external**
near-zero rise (dev ≈1.5). See `docs/sota-roadmap-2026.md` P2.

**Why "not yet SOTA" is still the honest stance — and now for a different reason, because the gap it named has
become one case:**

1. **The head-to-head was run, it read a tie, and the pair is now STALE ON ONE SIDE.** `docs/prism-head-to-head.md`
   measured PRISM's additive pooling at **78.91%** against ours at **78.75%** on the identical 735 cases — one case
   of 735. Both sides were at that configuration's corpus; ours has since moved to **89.80%** through seven
   enrolments (the demand guard, the boundary gate, the trace floor, the transient-guard policy and their dependants), and the
   reimplementation would inherit at least the corpus half of that movement if it were re-run. So the tie is no
   longer a measurement of the current engine, and **neither direction can be claimed from it**: claiming a lead
   would compare a current number with a stale one, and claiming a tie would assert a re-measurement nobody ran.
   This is the one gap on this page whose answer is a dispatch rather than a document, and it is named as owed
   here so that no later paragraph can quietly read it as closed.
2. **A 0.16 pp gap is below the benchmark's own resolution.** Gap 5: RCAEval's 735 labels were produced by a
   single engineer with no inter-annotator agreement study. A one-case difference is not a measurable lead in
   either direction, so the honest target is not "beat 78.91%" but "exceed the label noise" — which requires a
   margin we do not yet have on any suite except RE2-SS.
3. **Cross-benchmark generalization unproven.** RCLAgent also reports AIOPS-2022 (65.15%) and Aug-TrainTicket
   (82.35%). We have loaders (`aiops2025-loader.ts`, `rca100-loader.ts`) but **no measured numbers** — note these
   are the _AgenticOpsEval_ datasets (AIOps2025 400 cases + RCA100 103 cases), which are distinct from RCLAgent's
   "AIOPS 2022".
4. **The field is moving to harder benchmarks.** FSE'26 (arXiv:2510.04711): 11 SOTA models avg Top@1 0.21 / best
   0.37 on a fault-propagation-aware benchmark. ORCA-bench (arXiv:2607.28545): frontier LLM agents 25.3% Medium /
   10.0% Hard, 7–40% hallucinated root causes. Both are where "SOTA" is now actually decided, and we have not run.
5. **RE3 code-level is our weak flank** (SS 45.0%, TT **50.0% case-level**) — and, per PRISM's internal/external
   framing, likely the most fixable with the right new signal. It is also the suite where PRISM's conjunctive
   form beats us by **26.7 pp** (RE3-TT 76.7% vs 50.0%), the single largest per-cell deficit we have against any
   competitor. **A correction, because the previous revision compared two different statistics**: the `51.1%`
   in this document is the `AVERAGE` column — the unweighted mean of the five per-fault-type accuracies — while
   PRISM's `76.7%` is **23 of 30 cases** CASE-LEVEL. The two are not the same quantity (`docs/accuracy-aggregation.md`
   defines both), and pairing them was the same class of defect as the `Avg@5` column that once printed `AC@1`
   one table over. On the comparable reading the cell is **15 of 30 = 50.0%** against **23 of 30 = 76.7%**.
6. **Validity threat to every number (ours included).** pith.science review: RCAEval's 735 root-cause labels were
   produced by a single 5-year engineer with no inter-annotator consistency check. A ceiling on the benchmark's
   own ground truth is a ceiling on _everyone's_ headline number. **And no error rate for those labels is
   published**, so a **0.16 pp** difference cannot be attributed to either engine: gap 2's target is the right
   one, and no arithmetic here can substitute for it.

## Claims recorded in October 2026, and why none is placed in the table

Three publications from the last two months bear on this comparison and none of them can be placed beside the
nine cells, for three different reasons. They are recorded with the reason, because a claim that is silently
dropped is indistinguishable from a claim that was never checked.

| claim                                                          | what it reports                                                                                                                                                                     | why it is not in the table                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TA-RCD** (arXiv v2, 9 Oct 2026)                              | on RCAEval: "metric-level AC@5 +18% and Avg@5 +19% over the strongest baseline"                                                                                                     | **metric-level**, not service-level, and relative to a baseline rather than absolute. A metric-level number cannot be compared with an `AC@1` over services, and no per-cell table is published                                                                                                    |
| **arXiv:2608.21310** (trajectory study, RCABench)              | a defence prototype raises Acc@1 by **3.5–35.1 pp** across ten framework/backbone configurations                                                                                    | **RCABench**, not RCAEval's nine cells; and the delta is against agent frameworks, not against a ranking engine                                                                                                                                                                                    |
| **DeltaRCA** (ASE'26, DOI `10.1145/3832783.3837424`, Oct 2026) | **63% Top-1 / 79% Top-3** on "two microservice benchmarks with 200 injected fault cases", by left-shifting: an LLM agent reads the CODE CHANGE to weight a spectrum-based localiser | a different corpus (200 cases, not RCAEval's 735), no per-cell table on our systems, and the mechanism needs a change history the benchmark does not ship. Recorded because the DIRECTION is the one this engine cannot take on RE3 — the fault's semantics live in the diff, not in the telemetry |
| **arXiv:2609.36771** (deep causal models)                      | **0.88 Sock Shop / 0.78 Online Boutique** Top-1, no call graph                                                                                                                      | the closest thing to a like-for-like comparator, and it is **below** this engine's RE1 cells (92.8 / 82.4 `AC@1`) — placed as a reference in `docs/anomaly-composition.md` rather than as a row here, because the two runs do not share a harness                                                  |

The one number that has been stable all year is the one this record keeps returning to: **`L0` at 85.4% on
RE1's 375 cases** (arXiv:2610.05009), a Python reference setting rather than an agent.

## 2026-10-26 — the standings, and the number that was short is no longer short

Nine cells at the shipped configuration after iteration 137 (`docs/anomaly-composition.md` §6):

| population       |           this engine |                                  best published | standing                                                      |
| ---------------- | --------------------: | ----------------------------------------------: | ------------------------------------------------------------- |
| **RE1** (375)    |      **323 = 86.13%** |                 `L0` 85.4% (`arXiv:2610.05009`) | **FIRST — +0.73 pp**, the cell that was one case short        |
| **RE2** (270)    |      **231 = 85.56%** |      `arXiv:2609.36771` 0.88 SS / 0.78 OB Top-1 | **first on both cells it publishes** (98.9 / 86.7 vs 88 / 78) |
| **RE3** (90)     |       **52 = 57.78%** |             PRISM `conjunctive` 76.7% on RE3-TT | **second** — the one cell with a real deficit, 25.6 pp        |
| **735**          |      **606 = 82.45%** |               vendor 89% (NOFire, unverifiable) | second to a claim that ships no per-case results              |
| **FSE'26** Top@1 | **56.40%** (802/1422) | 37% (`RCABench`, arXiv:2608.21310's own anchor) | **first, +19.4 pp**                                           |

The move is `burst 0.10 → 0`, and the honest label on it is not "a new technique": it is the composition being
re-swept after the breadth enrolment showed that the burst bonus had been standing in for breadth. Six
fault-type cells up, none down on the golden half; on FSE'26 two types up and one down (`ContainerKill`, one
case of 89), which is `+7 / +2` across the two populations.

**What this does not license.** RE3-TT remains **50.0% case-level, 15 of 30** against PRISM's **76.7%, 23 of 30** — a 26.7 pp deficit on the one cell
where a competitor's published number is above ours, and the only cell in this table where that is true. The
`735` fold is second to a vendor's 89%, which is not reproducible from this repository and cannot be
reproduced from anything the vendor publishes; the gap is 6.6 pp and it is the largest open question in this
document.

## 2026-10-27 — the PRISM family is closed in three forms, and the deficit is measured in one statistic

The competitor whose published per-cell number is above ours is PRISM (`arXiv:2601.21359`, the RCAEval author's
own method), and it is now the only one. Three forms of its internal/external axiom have been built and measured
on the nine cells at the shipped configuration of everything else:

| form                               | best arm           |            RE3-TT |                              cost | verdict |
| ---------------------------------- | ------------------ | ----------------: | --------------------------------: | ------- |
| additive score (`prismWeight`)     | `additive 0.50`    |     15 → 18 of 30 |        RE1 **−10** (fold **+12**) | refused |
| conjunctive score (`prismPooling`) | `conjunctive 0.75` | **15 → 24 of 30** |                       RE1 **−37** | refused |
| symmetry mask (`victimWeight`)     | `victim 0.05`      |     15 → 15 of 30 | RE1 **−33**, FSE'26 Top@1 −1.4 pp | refused |

All three read the same underlying quantity — a z-score mean shift whose scale is each channel's own units —
so each re-weights a ranking that already carries eleven priors by an amount no other term controls. Online
Boutique and Sock Shop are untouched at every weight; TrainTicket absorbs all of it (RE1-TT 101 → 68 → 42 → 18
→ 10). The one number worth keeping is `conjunctive 0.75` at 24 of 30: it proves the cell's truth DOES carry
internal evidence this engine does not exploit, and it sets the requirement for anything that tries again — a
per-family normalisation (compare a node's internal shift against the fleet's internal shifts), which is the
same requirement the self-time refusal named.

## 2026-10-27 (2) — the membership's population: the mechanism measured, the lever priced, and refused

**Nothing in the standings moved, and a number that had only been asserted is now printed.** The dual-family
bonus of the previous section is a CONSTANT paid to a set, so it can only re-order a cell in which the set is a
strict subset of the fleet; iteration 144 measured that split (SockShop +3, TrainTicket 0, FSE'26 byte-identical)
and could not explain it. Every RCAEval cell now prints the set's density:

```
  [dual-family] family=7.6/9.2 (81.7%) truth=122/124 (98.4%) absent=1        ← OnlineBoutique RE1
```

At the shipped configuration the family covers **38.6% to 95.9% of the candidates** depending on the cell, and the
truth is inside it in **727 of the 729** cases whose truth is a candidate at all. The membership never fails to
include the answer; it fails to exclude anything else — which is the mechanism, measured rather than inferred.

**The population is therefore the axis, and its price is measured.** A fleet-relative gate
(`min(Sⁱ,Sᵉ) ≥ gate × max_w min(Sⁱ,Sᵉ)`, the construction `anomalyBreadthGate` uses) was swept on one commit
(`bca8a37`), one input per arm:

|          gate / weight |     RE1 |     RE2 |    RE3 |     735 | RE3-TrainTicket | FSE'26 Top@1 |
| ---------------------: | ------: | ------: | -----: | ------: | --------------: | -----------: |
| **0 / 0.25** (shipped) | **323** |     231 |     55 | **609** |        15 of 30 |        56.4% |
|            0.25 / 0.25 |     318 | **237** | **58** | **613** |        15 of 30 |    **59.5%** |
|            0.25 / 0.10 |     318 |     234 |     55 |     607 |        15 of 30 |        58.1% |
|            0.50 / 0.25 |     305 |     238 |     58 |     601 |    **17 of 30** |            — |

On the FSE'26 half the same gate reads **Top@1 59.5% / Top@3 77.7% / Top@5 81.3%** against the shipped
**56.4 / 69.7 / 72.1** (run `40527629997`) — **+3.1 / +8.0 / +9.2 pp** on 1,422 cases, from a term that was
byte-identical at every weight before its population was made relative. The corpus where the membership had
nothing to say is the corpus where the population axis pays most.

**Refused, on the standing rule.** 0.25 is the largest total this project has ever measured (613) and the first
arm to move RE2 off 231; 0.50 is the first arm in eleven to move the blocking cell at all. Both take RE1 down, and
318 of 375 is 84.8% — below `L0`'s published 85.4%, i.e. enrolling would trade a first place for a third. The gate
ships at 0, the identity, and the nine cells are the ones the previous section published.

**Competitor sweep, re-run this iteration:** nothing new since 2026-09-30. The youngest entries remain PSC-GRCA
(`arXiv:2609.27069`, 22 Sep 2026, `Avg@5` 0.915 in-distribution / **0.747 cross-system**, prior-only arm 0.488,
code + defect register on Zenodo) and the NeurIPS 2026 E&D retrieval-reranking decomposition
(`arXiv:2609.36686`); the vendor's 89% Top-1 remains unverifiable and its own page says to re-run it. **The one
thing worth re-reading in the new paper is its RE1 column-schema allegation** — "telemetry silently zeroed for
most RE1 cases". Measured against this repository's own loader on the 125 OnlineBoutique RE1 cases: **0 cases with
all-zero telemetry, 0 cases with no internal channel at all, 180 of 1,681 services external-only** (frontend-side
components with workload/latency/error only). The allegation describes a reimplementation path, not the JSON
corpus this engine reads; what does transfer is its **prior floor** — a telemetry-free ranker reads `Avg@5` 0.488
on this benchmark, so every top-5-shaped claim here, ours included, must be read against 0.488 and not 0.137.

**What this does not license.** The gate is not "almost working": it converts the membership into a real
discriminator and pays 1.7 cases of RE1 for every case of RE2+RE3 it buys. A form that keeps the population axis
and shrinks that price is the next question, and the sweep says it must change WHO is paid rather than how much.

## 2026-10-28 — ENROLLED: the per-family gate, and 735 at 628

**The standings move for the first time since the anomaly composition was last swept.** `dualFamilyGate = 0.25`
with `dualFamilyGateMode = 'channel'` — PRISM's axiom compared against each family's own champion — reads, on one
commit (`d83fb86`) and one input per arm:

| population       |          was |               **now** | published / reproduced                    | standing                                                              |
| ---------------- | -----------: | --------------------: | ----------------------------------------- | --------------------------------------------------------------------- |
| **RE1** (375)    | 323 = 86.13% |      **327 = 87.20%** | `L0` 85.4% (`arXiv:2610.05009`)           | **first, +1.80 pp**                                                   |
| **RE2** (270)    | 231 = 85.56% |      **240 = 88.89%** | 0.88 SS / 0.78 OB Top-1                   | **first on both published cells**                                     |
| **RE3** (90)     |  55 = 61.11% |       **64 = 71.11%** | PRISM conjunctive 76.7% (RE3-TT)          | second; **TT 70.0%** (was 50.0 before the pin, 63.3 before the floor) |
| **735**          | 609 = 82.86% |      **631 = 85.85%** | PRISM 68% published / 78.9% reimplemented | **first among reproducible results**                                  |
| **FSE'26 Top@1** |       56.40% | **60.50%** (860/1422) | 37% (`RCABench`)                          | **first, +23.5 pp**                                                   |

**No population down, and the blocking cell moved by four.** RE3-TrainTicket goes 15 → **19 of 30**, closing the
PRISM deficit from 26.7 pp to **13.4 pp** — the first movement that cell has shown in twelve arms. The arm costs
one case on one of the nine cells (Sock Shop RE1, 117 → 116) while **six rise and two hold**: +2 / −1 / +3 on RE1,
+3 / 0 / +6 on RE2 and +2 / 0 / +4 on RE3.

**Why this works when three earlier imports of the same axiom did not.** PRISM additive (−10 RE1), conjunctive
(−37) and the symmetry mask (−33) all imported a z-scale into a ranking that already carries fourteen prior terms.
This one imports a SHAPE and then makes its population relative to the fleet — and the census shows the mechanism
is EXCLUSION: at the enrolled gate the family covers 1.5–11.4% of a fleet and keeps the truth only 63.7–88.9% of
the time, and the cells still go up, because the candidates it removes are the loud neighbours the truth was
losing to.

**What this does not license.** RE3 remains a second place by 13.4 pp on the one cell a competitor's published
number is above ours, and the reconciliation is unchanged: PRISM's 76.7% is its own conjunctive magnitude read as
a ranker on TrainTicket, ours is a full ranking over 90 cases. The next lever has to close that gap _inside_ a
configuration that already wins the other four populations.

## 2026-10-28 (2) — two directions closed, standings unchanged

**No arm this iteration moved a population**, and both of them were aimed at the cell that is still second.

1. **The gate's scale.** `dualFamilyGate=0.15` reads RE1 327 (byte-identical) and RE3 **57** — the blocking cell
   loses four cases when the family widens, so the enrolled 0.25 is a local optimum on both sides
   (0.15 / 0.25 / 0.50 → RE3 57 / 61 / 57).
2. **The log channel.** `log_signal_mode=all` admits every ERROR/FATAL row and reads RE3 **36** (−25): the flood
   makes every service equally guilty. The census then says why — TrainTicket's 8,482 unclassified rows are
   **three** classes (`MalformedJwtException×3366 | TokenException×3366 | HttpServerErrorException×1750`), i.e. the
   platform's own JWT validation noise, while Online Boutique and Sock Shop carry 5,275 and 5,855 ADMITTED logic
   rows in the same run. `docs/unclassified-bucket.md` owns the record.

The route consequence is the point: the blocking cell's evidence was supposed to be in a channel the engine could
not read. It is readable, the engine reads it, and it contains the platform talking to itself — so the remaining
**13.4 pp** to PRISM on RE3-TrainTicket has to come from ordering the evidence the engine already has.

Standing, unchanged from the 2026-10-28 enrolment: RE1 **327 = 87.20%**, RE2 **240 = 88.89%**, RE3 **61 = 67.78%**,
735 **631 = 85.85%**, FSE'26 Top@1 **60.50%**.

## 2026-10-30 (2) — the gate read back on nine cells: 639, one cell down, and the one figure on this page that did not add up

Four arms on the golden nine cells, one input each, every other weight at its shipped value: `topodiscount=1`
at `topodiscountgate ∈ {0, 0.25, 0.5, 0.75}`. The control is the push-triggered golden run `41007505748`, and it
reproduces the published census **case for case** before any result below is read.

| cell                | shipped (`rho = 0`) | `rho = 1`, gate 0 | gate 0.25 | **gate 0.5** | gate 0.75 |
| ------------------- | ------------------: | ----------------: | --------: | -----------: | --------: |
| RE1 OnlineBoutique  |                 107 |               110 |       110 |      **110** |       109 |
| RE1 SockShop        |                 116 |               117 |       117 |      **117** |       117 |
| RE1 TrainTicket     |                 104 |               102 |       104 |      **104** |       105 |
| RE2 OnlineBoutique  |                  80 |                82 |        82 |       **82** |        82 |
| RE2 SockShop        |                  85 |                85 |        85 |       **86** |        86 |
| RE2 TrainTicket     |                  75 |                74 |        74 |       **74** |        74 |
| RE3 OnlineBoutique  |                  25 |                25 |        25 |       **25** |        25 |
| RE3 SockShop        |                  18 |                17 |        17 |       **18** |        18 |
| RE3 TrainTicket     |                  21 |                23 |        23 |       **23** |        23 |
| **total**           |             **631** |           **635** |   **637** |      **639** |   **639** |
| cells below shipped |                   — |                 3 |         2 |        **1** |         1 |

**Standing under the best arm** (`gate = 0.5`, run `41007636232`): RE1 **331 = 88.27%**, RE2 **242 = 89.63%**,
RE3 **66 = 73.33%**, 735 **639 = 86.94%**. On the cell every earlier section names as the deficit, RE3-TrainTicket
moves **21 → 23 of 30 = 76.67%**, which is the `23 of 30` `docs/prism-symmetry-mask.md` §1 records for PRISM's
conjunctive form: **parity on that cell under this arm, against the 26.7 pp deficit §2026-10-26 stated.**

**It is not enrolled**, and the reason is one case. RE2-TrainTicket reads **74 against 75 published at every gate
on the grid**, so the arm fails the same "no cell down" bar its parent failed, and the shipped configuration
stays at 631. The blocking case (`ts-travel-service_cpu_1`, rank 1 → 3) has a post-deduction anomaly that is
bit-identical at all four gates, which is a reading of the deduction's OUTPUT; the deduction's DECISION is a
ratio it did not publish. `docs/topo-share.md` is the instrument that publishes it, and choosing the next gate
from it is the outstanding step.

**The correction.** The standing line of §2026-10-28 (2) reads RE3 **61** beside 735 **631**; 327 + 240 + 61 is
**628**, and this iteration's control run measures RE3 at **64** (25 / 18 / 21). The cell figures and the total
have to add up, and the interior figure was a leftover from the 628 configuration rather than a measurement of
the 631 one. 631 = 327 + 240 + 64.

**Competitive standing, unchanged in kind.** The 735 fold at 639 is **86.94%**, which is 2.06 pp below the
vendor's **89%** — a figure that ships no per-case results and cannot be reproduced from this repository — and
7.76 pp below the DSN-S 2026 `94.7%`, whose population is still `POPULATION UNVERIFIED` for the reason §0a
gives (a bare PageRank at 94.1% cannot share a corpus with the benchmark author's own 68%). The gate takes the
gap to the verifiable references from 3.15 pp (631 = 85.85%) to **2.06 pp** without closing it.

## 2026-10-30 (3) — the boundary gate: 641, and the first arm with no cell down

The instrument of §2026-10-30 (2) published the share the gate reads, and the boundary value of the same
operator — `rho = 1, gate = 1`, i.e. **charge only a node its callees account for in full** (run `41020001659`)
— reads **641 of 735 = 87.21 %** with **every one of the nine cells at or above the published value**:

| population    |       shipped |     boundary gate |                             best published | standing                                         |
| ------------- | ------------: | ----------------: | -----------------------------------------: | ------------------------------------------------ |
| **RE1** (375) | 327 = 87.20 % | **330 = 88.00 %** |           `L0` 85.4 % (`arXiv:2610.05009`) | **FIRST — +2.60 pp**                             |
| **RE2** (270) | 240 = 88.89 % | **246 = 91.11 %** | `arXiv:2609.36771` 0.88 SS / 0.78 OB Top-1 | **first on both cells it publishes**             |
| **RE3** (90)  |  64 = 71.11 % |  **65 = 72.22 %** |       PRISM `conjunctive` 76.7 % on RE3-TT | second, **parity on the RE3-TT cell** (23 of 30) |
| **735**       | 631 = 85.85 % | **641 = 87.21 %** |         vendor 89 % (NOFire, unverifiable) | second, gap **1.79 pp**                          |

No fault type regressed: `delay` 99 → 103, `loss` 70 → 74, `socket` 43 → 44, `f1` 18 → 19, and seven types
byte-identical. The mechanism and its cost are one action — the operator deletes a candidate whose callees
explain all of it, which promotes the truth in thirteen cases and deletes three truths that a callee happened
to overshadow (`checkoutservice_delay_1/2/3`) — and `docs/topo-share.md` §8.2 is the record.

**Not yet enrolled** at the time of writing: `rho = 1` as a shipped default is a change to every user's
ranking, so it needed the FSE'26 half (`41024050841`) and the bounded-charge probes (`41024054670`,
`41024058625`) that ask whether a partial charge keeps the thirteen and returns the three. **Both were read
and the pair is ENROLLED — see §2026-10-30 (4).**

## 2026-10-30 (4) — ENROLLED: the boundary gate is the default, 735 at 641 and FSE'26 byte-identical

The two arms §2026-10-30 (3) held enrolment for are read, and neither of them changed the decision.

**The bounded charge is refused, and the plane is a knee rather than a slope.** Every interior point of the
`rho × gate` plane reads below the corner: `gate = 0` at `rho = 1` 635 (`+17 / −13`), `gate = 1` at `rho = 0.25`
**637** (`+6 / −0`), at `rho = 0.5` 635 (`+6 / −2`), at `rho = 0.75` 636 (`+8 / −3`), at `rho = 1` **641**
(`+13 / −3`) against 631. The quarter point is the best ZERO-BREAK configuration and it is still four cases short
of the corner, which is why the corner was enrolled; that `rho = 0.5` is worse than `rho = 0.25` is the tell that
the six cheap fixes and the two `checkoutservice` breaks have different margins, and it is a prediction this
section's first draft got wrong until the arm landed. The interior arms
do the one thing §8.3 asked of them — the three deleted truths come back into the pool, their post-deduction
anomaly exactly `(1 − rho)·a` — and they come back to rank 3 / 2 / 1, which is a miss, while seven of the
thirteen fixes are given up. A fix demotes a _caller_ of the truth and a break demotes the _truth_; both are
`rho × min(a, e)` on the same relation, so what orders the two ledgers is the pair of margins and not the
strength — and the margins are a property of the corpus, which is why the knee sits where it does.

**The other population is inert, measured against a same-tree control.** FSE'26 `41027467282` (bare dispatch)
against `41024050841` (`topo_discount=1, topo_discount_gate=1`): **Top@1 60.5 % (860/1422), Top@3 79.0 %,
Top@5 82.2 % — identical on both**, and **25 of 25 fault types identical**, down to `PodFailure 0/24` and
`JVMMySQLLatency 0/2`. The operator does not move that corpus at all, so the enrolment carries no risk there.
What the comparison does NOT show is _why_ it is inert: the share is published in the RCAEval loss census and
nowhere else, so on 1 422 cases the observable is "no movement".

**Enrolled.** `DEFAULT_TOPO_DISCOUNT` 0 → 1, `DEFAULT_TOPO_DISCOUNT_GATE` 0 → 1, `DEFAULT_TOPO_DISCOUNT_SCOPE`
unchanged at `external`. Fifteen fences across six files were pinned to the old default and every one of them
was a test leaning on a default instead of naming the arm it compared against; the enrolment re-named them
(`docs/topo-share.md` §10.1) and, in doing so, found a real divergence — `rcaeval-cli.ts` parsed
`--topo-discount` by inheriting `parseUnitInterval`'s own zero while `fse26-cli.ts` passed the named constant,
which was correct on both sides only while that constant was 0.

| population       |           was |           **now** | published / reproduced                 | standing                                               |
| ---------------- | ------------: | ----------------: | -------------------------------------- | ------------------------------------------------------ |
| **RE1** (375)    | 327 = 87.20 % | **330 = 88.00 %** | `L0` 85.4 % (`arXiv:2610.05009`)       | **first, +2.60 pp**                                    |
| **RE2** (270)    | 240 = 88.89 % | **246 = 91.11 %** | 0.88 SS / 0.78 OB Top-1 (`2609.36771`) | **first on both published cells**                      |
| **RE3** (90)     |  64 = 71.11 % |  **65 = 72.22 %** | PRISM `conjunctive` 76.7 % (RE3-TT)    | second; RE3-TT 23 of 30                                |
| **735**          | 631 = 85.85 % | **641 = 87.21 %** | vendor 89 % (NOFire, unverifiable)     | second among all, **first reproducible** (gap 1.79 pp) |
| **FSE'26 Top@1** |       60.50 % |       **60.50 %** | 37 % (`RCABench`)                      | **first, +23.5 pp**, unchanged by the arm              |

**Certified by a run that names no arm.** The arm and the default are two claims, and only the second is about
what a user gets. On the enrolment commit (`89900939`), a bare push-triggered RCAEval run (`41031397704`) reads
**641 = 87.21 %** with the nine cells identical to `41020001659`, and a bare FSE'26 dispatch (`41034020065`)
reads **60.5 / 79.0 / 82.2** with 25 of 25 fault types identical — both `signals:` lines naming
`topoDiscount=1 … topoDiscountGate=1` while having been asked for nothing.

The remaining distance to the one unverifiable figure on the page is **13 cases**, and §2026-10-30 (5) is where
they are.

## 2026-10-30 (5) — the 13 cases, and why the next axis is a direction rather than a weight

Thirteen cases separate 641 from 654, the first figure that would clear the one number on this page nobody can
reproduce. `docs/topo-share.md` §11 reads the census of the enrolled arm and finds the band a ranking change
can still reach is not diffuse: of the 94 misses, **31 sit at rank 2** (16 at 3, 8 at 4, 7 at 5, 20 at 6+, 12
absent), and within that band a single structure accounts for nine of them — the false winner is the node that
CALLS everything else and observes the whole fleet.

| false winner                              | cases | what it is                                                           |
| ----------------------------------------- | ----: | -------------------------------------------------------------------- |
| `ts-admin-travel-service`                 |     6 | TrainTicket's admin caller: it calls every service, nothing calls it |
| `front-end`                               |     3 | SockShop's root caller: the same shape                               |
| the truth's own CALLEE (5 distinct names) |    22 | the opposite direction — the anomaly sits downstream                 |

Both groups are a direction error, and both have a published name. `TopoEvo` (`arXiv:2605.15611`) calls the
first **symptom-amplification bias** — "misattributing the root cause to salient downstream victims" — and
reports **3.44 pp absolute** on root-cause localization from adjudicating it with two explicit tests:
**temporal precedence** (the cause's onset precedes the victim's) and **path consistency** (the evidence lies on
a propagation path). `Blast Radius Bench` publishes the counter as a first-class metric — a **reversed-causality
count** — and calls it the single most diagnostic error in incident reasoning
(`docs/benchmark-corpus-completeness.md` §11).

Neither test exists here. The engine measures magnitude along an edge twice (`failedEdge`, `lat`) and direction
in time never: `temporalWeight` ships at 0 and is `WEIGHT_ZERO` on every RCAEval term instance. That is the next
axis, and the reason it is admissible when four thresholds before it were refused is that it changes _who can
be first_ rather than _how much anyone is charged_.

**What this section does not claim.** The nine observer cases are counted from the census, not attributed by a
mechanism; that the precedence test would repair them is a hypothesis with a competitor's number behind it, not
a measurement of this engine. The first artifact the next iteration owes is therefore the reversed-causality
count itself, published per case, because a claim about direction that cannot be counted is the same kind of
sentence as the four thresholds this record has already refused.

## 2026-10-31 — the second published statistic, and the competitor that reports it

Every comparison on this page above has been Top-1, because that is what NOFire publishes for its 735-case RCAEval
claim (89.0%) and it is the only external number anyone can rerun. A paper published this month reports a **different**
statistic on the **same** benchmark, and this repository has been emitting it all along without ever comparing it.

### 31.1 What we publish, in both statistics, on the shipped configuration

Both columns are **per-fault-type averages**, which is the convention the comparator uses and the one the run
artifact prints beside `Avg@5`. The `cases` column is the case-level count the rest of this page reports, and on RE3
the two differ — a cell there has fault types holding a single case each, so a type-average is not a case ratio:
RE3:OnlineBoutique is 91.1% per type and 86.7% per case, RE3:SockShop 79.6% and 80.0%, RE3:TrainTicket 74.5% and
73.3%. On the other six cells the two figures coincide, because their types hold an equal number of cases.

**Re-read 2026-11-12 on battery `43215496103` at `9f9d3d81`.** Every cell below is that run's own
`rcaeval-re{1,2,3}-results.txt`: the `AC@1` and `Avg@5` columns are the file's `AVERAGE` column, which is the
unweighted mean of the cell's fault types, and the `cases` column is the same run's own per-case census.

> **Why this table had to be re-read, stated before it prints a number, because it is the one class the anchor fence
> could not see.** The previous pin was `42343505202` at `bd17912c` (2026-11-07), and §0p-iv had since moved two of
> its rows at a configuration change this document already records: `RE1:TrainTicket` `112 → 113` and `RE3:SockShop`
> `19 → 24`, `TOTAL 660 → 666`. §0p's retirement list carries both forms — `112/125` and `19/30` — and §31.1 went on
> printing exactly those two fractions. **`standing-anchor.test.ts` scans five named tables and this is not one of
> them**: an allow-list of regions leaves every other table unfenced by default, which is the same defect as the
> unfenced prose §0p confesses to, one level down. The fence was blind to the table's own arithmetic as well — the
> footer had been re-anchored to `666/735` while the nine rows above it summed to **660**, and the printed `Avg@5`
> mean of `93.4` is not the mean of the column beside it (`92.0`, recomputed from those very rows): it is the
> case-weighted convention sitting in a row labelled _unweighted mean of the nine rows_, and the two conventions are
> `1.7 pp` apart on this run (`92.5` unweighted against `94.2` case-weighted, both printed below). Three defects in
> one table and none of them a wrong measurement: one pin that outlived two enrolments, one footer that had been
> updated without its rows, and one mean computed under the other convention and printed under this one's label. The
> fence this paragraph produced is **deny-by-default**: every table row that names a cell and prints a fraction over
> that cell's own denominator must print the anchor's numerator, and §31.1's footer must sum the rows above it and
> equal their means. Both are proved red rather than asserted: restored to its pre-iteration-268 text, this table
> fails the new fence with `RE3:SockShop prints 19/30; the anchor is 24/30` **while the retired-reading assertion
> beside it stays green** — which is the gap, measured on the document instead of argued from it.

| cell                                              | AC@1 (per type) | Avg@5 (per type) | cases                           |
| ------------------------------------------------- | --------------- | ---------------- | ------------------------------- |
| RE1:OnlineBoutique                                | 90.4%           | 96.2%            | 113/125                         |
| RE1:SockShop                                      | 95.2%           | 97.4%            | 119/125                         |
| RE1:TrainTicket                                   | 90.4%           | 95.7%            | 113/125                         |
| RE2:OnlineBoutique                                | 93.3%           | 94.9%            | 84/90                           |
| RE2:SockShop                                      | 98.9%           | 98.9%            | 89/90                           |
| RE2:TrainTicket                                   | 84.4%           | 88.0%            | 76/90                           |
| RE3:OnlineBoutique                                | 91.1%           | 91.1%            | 26/30                           |
| RE3:SockShop                                      | 79.6%           | 88.8%            | 24/30                           |
| RE3:TrainTicket                                   | 74.5%           | 81.2%            | 22/30                           |
| **RE1 (three systems, unweighted mean)**          | **92.0%**       | **96.4%**        | 345/375                         |
| **nine cells (unweighted mean of the nine rows)** | **88.6%**       | **92.5%**        | **666/735 = 90.61% case-level** |

The two conventions, both from this run, side by side, because the row above is one of them and this document quotes
the other elsewhere: **case-weighted** `AC@1` **90.61% (666/735)** and `Avg@5` **94.20%** — the `Avg@5` read off each
case's own `truthRank` in `43215496103`'s censuses as `Σ max(0, 6 − rank)/5 / 735`, which reproduces every per-type
`AVERAGE` in the run artifact to the rounding and is therefore the same statistic the artifact prints, aggregated the
other way. The `1.70 pp` gap between `94.20` and `92.5` is the RE3 cells, where a fault type holds one case.

### 31.2 The comparator, and the one property that matters more than its headline

arXiv 2609.27069 (_Does Graph Structure Earn Its Place in Microservice Root-Cause Analysis?_, 2026-09) reports RE1
localization **Avg@5 = 0.915** for its full model, against 0.864 for an MLP with no graph at all and 0.797 for a
max-deviation heuristic it implements as a comparator. Two numbers from its own tables decide how the 0.915 should be
read:

| arm                                            | stratified (six fixed folds, in-distribution) | cross-system (three held-out systems) | drop        |
| ---------------------------------------------- | --------------------------------------------- | ------------------------------------- | ----------- |
| Full model (prior + evidence + graph residual) | 0.915                                         | 0.747                                 | **−16.8pp** |
| Prior-free (evidence + graph residual)         | 0.850                                         | 0.747                                 | −10.3pp     |
| Evidence-only                                  | 0.853                                         | 0.673                                 | −18.0pp     |
| Graph-only                                     | 0.800                                         | 0.692                                 | −10.8pp     |
| **culprit prior only, no telemetry**           | **0.488**                                     | 0.079                                 | −40.9pp     |

A model whose _prior term alone_ scores 0.488 without reading a single metric is describing **which service the
injector chose**, and the paper says so: its ablations locate most of the gain in the prior rather than in the graph.
That is what the 16.8-point cross-system collapse measures — when the held-out system's injection distribution
differs, two thirds of the prior's contribution evaporates.

The nine-row means above are means of type-averages and are reported only to describe the artifact; the number this
page stands on is the case-level **641/735 = 87.21%**, which is what the Top-1 comparison has always meant. On RE1 the
two agree (330/375 = 88.0% both ways), which is what makes the RE1 line comparable to the 0.915 below.

Our 94.2% on RE1 is **not** a stratified figure and has no prior term: it is one pass over all 375 cases of three
systems, every one of them in the evaluation, none of them held out. There is no distribution to be held out FROM,
because nothing was fitted.

So the honest reading of the two numbers side by side:

- **RE1 Avg@5: 94.2% against 91.5%** — +2.7pp, with a caveat that cuts in our favour rather than against (their
  figure is the _easier_ protocol: fixed folds within the same systems).
- **Against the same paper's non-learning comparators**: max-deviation heuristic 0.797 (+14.5pp), MLP-no-graph 0.864
  (+7.8pp), graph encoder 0.867 (+7.5pp).
- **Top-1 is unchanged and still short**: 87.21% against NOFire's 89.0%, −1.79pp. None of the above touches that
  number, and this page's standing does not move.

### 31.3 What this changes, and what it does not

It changes the **defensible claim**. "We are 1.79 points behind the only public Top-1 number" was the whole story;
the story now has a second half — on the statistic a 2026 peer-reviewed-style study chooses, this engine is ahead of
that study's model _and_ ahead of every non-learning baseline it implements, without training and without a prior.

It does not change the **objective**. The target on this page has always been the Top-1 leaderboard, and 641/735 is
641/735. A second statistic that flatters the engine is worth exactly one thing: it tells a reader where the
remaining Top-1 gap is _not_ — it is not in ranking the right service into the top five (91.1% of the time it is
there), it is in ordering the first position (87.2%).

## 2026-11-05 — two 2026 competitors, and the channel one of them does not have either

Iteration 226's competitor sweep found two entries the table did not carry. Neither is placed in the
leaderboard, and the reason is different for each.

**DeCoR / RICE-CM** ([DOI 10.1186/s13677-026-01009-x](https://link.springer.com/article/10.1186/s13677-026-01009-x),
peer-reviewed, 2026). Service-level localisation from multivariate metrics, evaluated on a **300-case subset** of
RCAEval (Sock Shop 1, Sock Shop 2, Online Boutique), and it reports `Avg@5` only:

| dataset         | `Avg@5` |
| --------------- | ------: |
| Sock Shop 1     |  0.6000 |
| Sock Shop 2     |  0.7040 |
| Online Boutique |  0.4864 |

Its own headline is that this is the highest `Avg@5` **among the methods it evaluates** — against RUN, RICE-only,
RICE-MX and fixed-coupling ablations. The bound that matters for this table is arithmetic rather than a
comparison: `Avg@5 = (1/5)·Σ_{k=1..5} AC@k` and `AC@k` is non-decreasing in `k`, so **`Avg@5 ≥ AC@1` for every
ranker**. An `Avg@5` of 0.4864 on Online Boutique therefore bounds that method's `AC@1` **at 48.6% or below**,
against this project's 89.6% (RE1), 93.3% (RE2) and 83.3% (RE3) on the same system. It is not a leaderboard
entry because the statistic and the case subset differ, and because a self-selected 300-case subset is not the
published 735 — the same reason RCA-DCM is recorded with its numbers and no rank.

**TORAI** (2026, unsupervised, graph-free). It is the closest published statement of the problem this project
found _first by measurement_: "Sock Shop … configured with zero trace data (100% blind spots)" and
"Online Boutique … 4 default blind spots", with severity scoring, GMM symptom clustering, cluster-local causal
inference and rank aggregation, evaluated on all three of the same systems. Two things follow.

1. **§9.1 of `ablation-input-census.md` has independent corroboration.** This project measured
   `spans 0/90` and `spans 0/30` on SockShop, with `latency-routes STARVED`, and concluded the corpus carries no
   traces there. A 2026 paper states the same property of the benchmark as a premise of its design, which means
   the fact is a property of RCAEval rather than a defect in this loader.
2. **It names the shape of the missing lever.** TORAI's `Avg@5` is reported as 0.94 on SockShop and 0.89 on
   TrainTicket using metrics and logs alone. Those are `Avg@5` figures from its own harness and are not
   comparable here — but the _design_ is: cluster the anomalous services first, then rank inside a cluster, and
   use median/IQR rather than mean/σ so a late trigger does not poison the baseline. That is a discriminator
   that needs no spans, which is exactly what `RE3:SockShop` — the lowest lift in the nine cells, at 38.9% with
   **eleven of eleven misses ranked rather than blank** — cannot get from any arm this battery already owns.

**Three 2026 references verified this iteration, and one of them is a number this project should be measured
against** (checked 2026-11-05; none of them evaluates on RCAEval, so none of them is a leaderboard row).

| reference                                                                                       | corpus                                                                                                                  | best reported                                                                                                               | why it is not a row in §1                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `arXiv:2608.21310`, _Beyond Fault Localization: a trajectory-level study of LLM agents for RCA_ | **RCABench** (1 430 cases, 500 sampled; TrainTicket call graph), AIOps 2025 (400 events), RCA100 (57 propagation cases) | **Acc@1 90.0%** — ThinkDepth.ai + `claude-sonnet-4.6`; top band otherwise 77.6–79.6% (Qwen); RCA-specific agents 42.6–53.4% | different corpus and a **different label space** (service- and code-level labels from a re-annotated propagation graph, not RCAEval's injected-service label), and no per-case results published yet |
| `arXiv:2607.01788`, **KRCA** (Kuaishou + Tsinghua)                                              | Kuaishou production, hyper-scale, in-house                                                                              | AC@1 **0.88** service / 0.79 failure type; −77.3% diagnosis time over six months                                            | private system, no public corpus, no reproduction path                                                                                                                                               |
| **OpenRCA 2.0** (Fang et al., 2026), as cited by the above                                      | OpenRCA                                                                                                                 | 76.0% of agents find the service; 61.5% follow a verified propagation path                                                  | no per-case results in the citing summary; the path metric has no counterpart in this project's artifacts yet                                                                                        |

Two consequences, and the second is uncomfortable:

1. **The 90.0% is on TrainTicket**, this project's hardest system: `RE1` 89.6%, `RE2` 83.3%, `RE3` **74.5%**. If
   RCABench's service-level task is of comparable difficulty, its best configuration is **15.5 pp above this
   project's RE3-TrainTicket cell** — which is the same cell `docs/ablation-config-audit.md` §4.4 shows the PRISM
   conjunctive arm lifting by +20.0. That is directional, not a rank: the corpora differ, the labels differ, and
   the reference pays a frontier LLM per case where this engine pays a deterministic score. But it is the first
   published 2026 number that sits above one of this project's nine cells on the system both measure.
2. **None of the three publishes per-case results**, so none can be re-scored on the 735. The ranking in §1 stands
   as "first among methods with per-case results", and that qualifier is now doing more work than it did last
   week: it is a statement about the published field's reproducibility, not about the field's accuracy.

**A fourth reference, and it is the first one measured on the configuration that blocks this project**
(checked 2026-11-05): **TORAI** — Pham, Ha, Zhang & Zhang, _Multi-source Root Cause Analysis for Blind Spots in
Microservice Service Call Graph_, Proc. ACM Softw. Eng. 2026, `10.1145/3808137`.

| what it reports                                                            | number           | why it is not a leaderboard row                                                                                                                               |
| -------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SockShop with traces REMOVED (100 % blind spots)** — metrics + logs only | **`Avg@5` 0.94** | its SockShop is an 11-service deployment against the 15 this project ranks, the case count is not stated, and neither code nor per-case results are published |
| TrainTicket `Avg@5`                                                        | 0.89             | same corpus caveats; baselines it beats (CausalRCA 0.43, CIRCA 0.46) are not in §1 either                                                                     |
| production ISP corpus, 10 incidents                                        | `AC@3` 1.00      | private                                                                                                                                                       |

This one is uncomfortable in a specific way, and it is the reason it is recorded rather than filed:

- **It is the cell this project could not move — at the reading this entry was written against, and that clause is
  now RETIRED.** `RE3:SockShop` was `66.1 %` `AC@1` (`19/30`) and **`87.4 %`** `Avg@5` on 2026-11-05, its
  ranking is metric-and-log only because the corpus carries no `traces.csv`
  (`docs/ablation-input-census.md` §9.1), and §4.8 of `docs/ablation-config-audit.md` has just measured the
  additive source credit making it **worse** (`63.3 → 60.0 → 46.7`). TORAI reports **0.94** on that same
  configuration and reaches it by a SHAPE this engine does not have: GMM-cluster the anomalous services first,
  run a local causal search _inside_ each cluster, aggregate, then re-rank fine-grained indicators with
  **median/IQR** rather than mean/σ.
  > **Correction (iteration 268, battery `43215496103` at `9f9d3d81`).** The cell moved, and the sentence above is
  > not a reading of the engine that ships. §0p-iv's emission enrolment took it `19 → 24 of 30`: `AC@1` `66.1 →
79.6%` per type and `63.3 → 80.0%` case-level, `Avg@5` `87.4 → 89.3%` case-level (`88.8%` per type), with the
  > channel still absent — so the movement came from the JURISDICTION rule rather than from new evidence, which is
  > the part that matters for this entry's argument: the five cases were always winnable and were being lost to a
  > term scoring candidates it could not measure. What survives is the comparison and not the epitaph: TORAI's `0.94`
  > is now `4.7` points of `Avg@5` headroom rather than `6.6`, and the median/IQR shape it reaches them by is still
  > absent here. A stale reading that flattered us would have been a defect; a stale one that flattered the
  > COMPETITOR is the same defect, and this is the third time §0p's class has been found in prose rather than in a
  > table.
- **It therefore refutes the corpus-ceiling reading.** The prior floor on that cell is `Avg@5` 82.0 % (frequency)
  against a saturated `Top@5` of 100 %, so `87.4` was `5.4` of 18 available points — and `89.3` is `7.3`, after a
  change that added no evidence. A published method claims 12 of them without traces. The headroom is real and it is
  reachable, and the `4.7` that remains is the part this engine has not explained.
- **It does not license a rank.** No `AC@1` is reported at all, so the headline metric of this table cannot be
  compared; the corpora differ in service count and the case count is unstated.

**Debt this entry creates, named rather than hidden:** TORAI's only identifier is a DOI, and
`packages/kinetic/__tests__/unit/support/artefact-grammar.ts` recognises `arXiv:` ids, repository URLs,
`*.github.io` pages and **zenodo** DOIs — not journal DOIs. So this paragraph is **not** checked by the
`sota-populations` / `competitor-artefact-availability` fences that §0a is, and neither inventory carries a row
for it. Extending the grammar to `10.\d{4,}/…` would put six already-cited DOIs into scope at once, which is the
next iteration's fence work and not a change to make silently here.

## 2026-11-07 (2) — the collision source is refused under both keyings, and the standings do not move

Iteration 242 re-keyed the one Deng-Yu instrument in the formula that was inert — `collisionWeight`, whose content
was a penalty on inherited energy (`ratioContrib`) — onto the hump SHAPE, and read it at two weights on three
populations. Pre-registered before the code existed (`PREREGISTRATION_2026-11-07d_collision-shape.md`), refused on
its own criterion, and recorded in `docs/transient-guard-evidence.md` §14.

**No cell in this document moves.** The control reading on the new commit (`2d1dc02d`, battery `42365685149`) is
`113/119/112 · 84/89/76 · 25/19/22` = **659/735** and `874/1 422` — identical to the anchor as it stood at
`bd17912c`, which is what a weight-0 term must be and is now a measurement rather than a construction. §0p-iii is
why the anchor now reads one case higher than this control: the +1 arrived after `bd17912c`, so the control is
exactly one case behind it and **still a control** — it is quoted at the revision it was taken at.

| arm         | golden (735) | FSE'26 (1 422) | verdict                                                   |
| ----------- | -----------: | -------------: | --------------------------------------------------------- |
| control (0) |          659 |            874 | —                                                         |
| A (0.10)    |          659 |            869 | refused: archive −5, `HTTPRequestDelay` −2, sign negative |
| B (0.25)    |          656 |            860 | refused: four of five criteria                            |

The refusal is worth more than a null row, for the reason §0j records about `DeCoR`'s reliability weight: **the term
was refused on a mechanism statement rather than on a magnitude.** The shape was supposed to be the kill's
signature, and on the archive the kill types are flat to negative — `ContainerKill` 27/27/27 of 89, `PodKill`
6/5/4 of 10 — while the two types that gain are not kills at all. And the two populations disagree for an
arithmetic reason rather than a corpus one: a measured shape is ≈0.1, which is **below one rank step on a 10-node
rank-normalised graph** (0.111, where RCAEval's small cells live) and **above it on a 64-node one** (0.016, where
TrainTicket and the archive live). One weight cannot span a 7× difference in the unit the ranking works in.

That is the actionable sentence, and it is not enrolled: **a contribution expressed in units of the graph's own
rank step is a different instrument from a contribution expressed in units of the shape**, and the collision source
is the term where it would be cheapest to test. The standings above are unaffected by the refusal and unchanged
since iteration 241.

## 0q. "Why not copy the SOTA?" — an audited answer, one competitor at a time

The obvious move on seeing a 90.0 % row is to take that implementation apart and reproduce it. This section is
the result of checking whether that move is available, and the answer is that **the row is not the artefact**. It
was checked on 2026-11-07 against each competitor's own repository and full text.

| competitor                                    | headline                     | artefact state (verified)                                                                                                                                                                                                                                                       | usable on our 735?                                                                                                                                                             |
| --------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Sonnet · ThinkDepth.ai`, RCABench **90.0 %** | `arXiv:2608.21310`           | ThinkDepth.ai **is** open source (`thinkdepthai/Deep_Research`, MIT, 190 ★, 24 commits) — but it is a **web-research writer**: `OPENAI_API_KEY` + `TAVILY_API_KEY`, no telemetry tool. The paper says "ThinkDepth.ai **adapted to** AIOps 2025"; **the adapter is unpublished** | **No** — different label space (service-to-code hierarchical, re-annotated propagation graph), 500-case sample with no published case IDs, paid backbone at `$0.01–$4.64`/case |
| `RCLAgent V2`, RCAEval **56.67 %**            | `arXiv:2605.14866`           | **fully open** (`LLM4AIOps/RCLAgent-V2`): any OpenAI-compatible endpoint, `sample_data` self-check, and the paper evaluates on **RCAEval**                                                                                                                                      | **Yes** — and we lead it **+36.6 pp** on RE2-OnlineBoutique (93.3 % vs 56.67 %)                                                                                                |
| `OpenRCA`, RCABench **46.6 %**                | ICLR'25, `microsoft/OpenRCA` | fully open (MIT)                                                                                                                                                                                                                                                                | No — OpenRCA's own corpus, 80 GB telemetry, no RCAEval                                                                                                                         |

| `OperationsPAI/rca-algo-contrib` — the RCABench **field itself** | `arXiv:2510.04711` | **fully open**: the authors' harness (`rcabench-platform` 0.4.46 on PyPI), their data (Zenodo, 1,422 cases) and **their own containerised re-implementations** — twelve `LGU-SE-Internal` repositories, **eleven resolve**, eleven unlicensed (run and quote, never vendor) | **Yes — and it has been run.** `baro` on all 1,422: **41.21%** set-valued, **29.68%** endpoint-only; ours **62.17% / 48.03%**. Paired, **+20.96 pp**, McNemar `p = 4.8e-29`. §0r |

Three conclusions, and only the third is comfortable:

1. **Copying the 90.0 % is four independent impossibilities, not one.** The adapter is unpublished; the backbone
   is paid; the label space is not ours; the sample's case IDs are unpublished. A partial reimplementation would
   produce a number that is not the number in that table, and publishing it beside theirs would be a comparison
   of two different things — which is the defect this document's §2d already records for the archive's second
   reading path.
2. **The competitor that IS copyable is the one we already beat.** RCLAgent is the only agentic system that is
   both open and evaluated on RCAEval, and it is 36.6 pp behind on the cell where both have numbers. The
   reproduction that would be worth doing is therefore a **confirmation of a lead**, not a route to one — and it
   still has not been run on our harness, which is a real gap and is named as one.
3. **What is worth taking from the 90.0 % is its ablation, not its architecture.** `DiagGuard`'s `+4.5` (grounding)
   `+4.1` (verification) `+9.0` (stack) are the paper's own mechanism, and mechanisms can be expressed against any
   evidence-consuming process. Iteration 243 did exactly that: the three failure families became three
   deterministic predicates over this engine's record (`docs/evidence-audit.md`).

**And that transplantation produced the most useful negative result in this document.** Two of the three
predicates failed their pre-registered criterion — `omitted` because it restates the topology discount, and
`misinterpreted` because it is **structurally unreachable**: the term it was anchored on, `rise`, ships at weight 0. Checking why turned up the fact that matters:

> **every term that expresses a direction ships switched off** — `rise` 0, `topo` 0, `collision` 0, `prism` 0.

The engine measures evidence direction and then multiplies it by zero. DiagGuard's middle family has no object
here not because this engine never misreads but because **it never reads direction at all**. That reframes §2c's
"18–29 pp of retrievable evidence": part of it may not be about querying MORE, but about using the direction of
what a single deterministic pass already retrieves for free.

The one predicate that survived is narrow and sharp: six cases in 633 where the **truth** was measured and then
removed from the candidate set by `topoDiscount`, and **all six were answered wrong** — an identity rather than
a correlation, since on a single-label corpus `AC@1` is `top-1 == truth`.

## 0r. The first RCABench head-to-head — and the converter defect it exposed

§0q ends with "the competitor that IS copyable is the one we already beat", which was true of the **agentic**
field and false of the benchmark itself. RCABench's authors released their harness, their data and **their own
implementation of every baseline**, so the field is re-runnable in a way the RCAEval field is not. One baseline
has now been run on all 1,422 cases against this engine, paired case by case.

| all 1,422 cases                             |      this engine |       `baro` |        margin | McNemar     |
| ------------------------------------------- | ---------------: | -----------: | ------------: | ----------- |
| set-valued (`top-1 ∈ ground_truth.service`) | **884 = 62.17%** | 586 = 41.21% | **+20.96 pp** | p = 4.8e-29 |
| endpoint-only (`top-1 == injection_point`)  | **683 = 48.03%** | 422 = 29.68% | **+18.35 pp** | p = 2.1e-30 |

The standing row above measures against the paper's `avg 21 / best 37`; this measures against a run. **The
margin is +20.96 pp, not +24.5 pp**, and it is paired rather than two proportions — 512 cases resolved only by
this engine, 214 only by `baro`.

**And the run found where we lose.** `baro` is far ahead on four fault types — `JVMMemoryStress` 93.6% vs 35.7%
(171 cases), `ContainerKill` 86.5% vs 29.2% (89), `PodFailure` 66.7% vs 4.2% (24), `PodKill` 90.0% vs 60.0% (10)
— **174 cases to 6, net −168 = −11.8 pp of the corpus.** The mechanism is one line of our own converter: it
carries **7 of the 48 metric names** a resource case holds, and drops `k8s.container.restarts`,
`k8s.pod.phase`, `k8s.pod.memory.usage` and the `jvm.*` family — the direct evidence for exactly those four
types. `baro` reads the parquet whole.

So on those types it is not two rankers over one signal set; it is a ranker with the evidence against a ranker
without it. The converter's drop was argued and sound for the seven families the engine then had. It stopped
being sound the moment the corpus turned out to be 20% resource faults. **This is the defect a cross-paper
comparison could not have found**: it required running an opponent that reads what we throw away.

Everything measured, with per-type tables, costs and provenance, is in
`docs/rcabench-baseline-replication.md`.

## 2026-11-09 — the guard that refused the truth's own channel, and a term that was priced and refused

Iteration 252 changed two things and the **anchor does not move on either**: the block above is still
`113/119/112 · 84/89/76 · 26/19/22` = **660/735**, and the configuration marker rolled `486ad3e0486b →
1a67d9681c45` because the `signals:` line gained one field whose shipped value is `0`.

**1. A correctness fix that the published metric cannot see.** The `duty-cycled-idle` guard counted a channel's
near-zero samples over the WHOLE recording, and the whole recording's first half is the pre-injection period — a
period in which a fault's error channel is quiet by construction. On `RE3:SockShop` it therefore refused the
**truth's own `error` channel on 18 of 30 cases and the winner's on none** (44% correct when refused, 92% when
kept). The window is now the post-injection slice for `EVENT_METRIC_LABELS = ['error']`, whose zero is a measured
zero; 39 channels are admitted corpus-wide, **none is newly refused**, and every cell's `AC@1` is unchanged while
`RE3:SockShop`'s type-mean `Avg@5` rises `84.6 → 85.6`. `docs/duty-cycle-window.md`.

**2. A pre-registered term, measured, refused.** `docs/rcaeval-error-scale.md` §6 pre-registered a collision-source
term over `Δλ` — the ABSOLUTE change in a node's own per-request error rate — with an upper bound of `26/30` on
`RE3:SockShop` measured before the code existed. Implemented (`emissionWeight`, floor `0.1` errors/request),
swept, and it **beats the bound**: `19 → 28/30` at `w = 0.65`. It is nevertheless shipped at **0**, because at
`w = 0.5` it costs `RE3:TrainTicket` three cases, `RE3:OnlineBoutique` two and one each in two RE2 cells — net
`+3` with four cells down, which is the trade this record refuses. `docs/emission-intensity.md` carries the sweep,
the corpus census behind it (the truth's own `Δλ` is `p90 = 0` on `RE3:TrainTicket` and `0.795` on
`RE3:SockShop`), and the one axis the data names next: a case-level conjunction with the direction evidence.

**Nothing above is a claim on the standing table.** Both changes are recorded here because the marker rolled;
neither moves a published number, and the anchor stays battery `42505425507` at `6412d69a`, re-verified per cell
after both.

## 2026-11-09 — the graph that named a service the metrics had never heard of

`RE2:OnlineBoutique`'s trace files spell the front end `frontendservice` while `metrics.json` spells it
`frontend`, and nothing joined the two. `augmentTopologyWithTraces` keeps only the edges a span confirms, so all
seven YAML edges starting at `frontend` were dropped and four were installed from a node with **no metrics** —
on **89 of that cell's 90 cases**, with a `latRise` of `14.233` reported against the phantom while the node the
cell ranks reported no latency evidence at all. `traceServiceResolver` now binds the two vocabularies in three
ordered rules and refuses an ambiguous spelling; the join is applied once, in the corpus owner, and handed to
the two streaming passes that read `traces.csv` again.

**What it is worth on the standing table: nothing, measured rather than assumed.** Both arms ran the nine cells
from the same tree with the change stashed and unstashed: `660` before and after, every cell's `AC@1` and
`Avg@5` identical, and **0 of 735 cases changed winner**. The null has two mechanisms and both are properties of
the shipped configuration — `latWeight` reads a callee's INBOUND rise as a maximum over its callers (the front
end has no callers; the maximum was already held by `checkoutservice`), and the outbound readers are
`topoWeight` (shipped `0`) and the failed-call channel, which carries a record on 26 of 23,105 node-reads. It
ships because a term priced tomorrow would otherwise be measured on a graph where the front end of 90 cases had
no edges.

**And the axis iteration 252 named next is closed.** The case-level conjunction with the direction evidence is
unmeasurable here: the failed-call ledger admits **0 of 735 cases** (26 records in 23,105 node-reads). The two
admissions computable from the emission channel — Newcombe's lower bound and the excess over a node's callees —
both repair `RE3:TrainTicket` (`19 → 22`) and both still cost `RE2:OB −1`, `RE2:SS −1`, `RE3:OB −2`; net `+6`
with three cells down, refused by the same law. The four losses have one cause: on a `loss` fault the truth
**does not emit** (`0 / 13,217` and `0 / 710` post-window requests on two cases; no `error` channel on the other
two), so the top of the emission ranking is a victim by construction, and telling a source from a caller that
emits for a dead dependency is a DIRECTION question this corpus cannot answer. `docs/span-name-join.md` and
`docs/emission-intensity.md` §6 carry both records.

**Nothing above is a claim on the standing table**, and the marker does not roll: no ranking knob changed, so the
configuration fingerprint stays `1a67d9681c45` and the anchor stays battery `42505425507` at `6412d69a`.

## 2026-11-12 — the third corpus, and the number a non-LLM engine has to beat

The four checks this iteration ran against the live literature, and the one that changes the standings page
rather than restating it.

**The paper behind the channel is confirmed in its own words.** Lee et al. (arXiv 2611.02416 v1, §4.1.1) define
`r(s) = Pr_{W′ ∈ 𝒲_normal}[φ(s; W′) > τ]` and say why the count is the point: _"because r(s) is counted directly
without assuming a distribution, it places KPIs with different σ and logs counted as entries on a single scale."_
`packages/tree/src/pruning/fault-free-profile.ts` implements exactly that — a count of windows, no fitted family —
and the departure this repository forces is in the WINDOW (§4.1.1's profiling period is 18 to 211 hours; a
datapack here is one recording, so a case is one window) rather than in the statistic. The paper also corroborates
the `r = 1` population this iteration measured: on Bank, _"garbage collection causes a JVM memory metric to be
flagged in 97 % of fault-free windows"_. That is the same object as the 22 channels at `r = 1` and the 31 at
`r = 0` — routine deviation posing as evidence — found independently on this corpus.

**The evaluation set was incomplete in a way this page has to state.** RCAtlas-Core (Bi, Zhang, Li, Wang and Ma,
Peking University and BUPT, arXiv 26 October 2026, _Free to Look, Free to Reason_) is a validated 90-case
benchmark assembled from **eight** public RCA sources: 2 359 released cases screened, 542 examined, 348 passing
eight exclusion rules, 90 sampled across **23 scenarios** and 10 suites, with injection-tool traces **removed** to
prevent answer leakage. Service 59 / pod 20 / node 11 at three root-cause levels, telemetry from 37 thousand to
5.6 million rows per case, scored by **PR@1**.

| method family                                                                                 | best on RCAtlas-Core | what it is                                                      |
| --------------------------------------------------------------------------------------------- | -------------------: | --------------------------------------------------------------- |
| random ranking                                                                                |                5.5 % | the floor; the median per-case guess rate is 3.45 %             |
| statistical / causal (`NSigma`, `BARO`, `CIRCA`, `RCD`, `TORAI`, `FaultInsight`, `SimpleRCA`) |           **38.9 %** | `NSigma`, i.e. metrics scored by how far they deviate           |
| published LLM agents (`FoA`, `RCAgent`, `RCA-Agent`, `DecompRCA`, `mABC`)                     |               53.3 % | `FoA`, which hard-codes 51 % of its model calls                 |
| simple LLM harnesses (one-shot / SQL agent / Codex)                                           |               77.2 % | averaged over three mid-tier models; 84–89 % with the strongest |

**This is the first corpus where the number to beat is a STATISTICAL method's, not an agent's** — and this engine
is a statistical method. `NSigma` at 38.9 % is the threshold that decides whether a non-LLM ranker is credible on
RCAtlas-Core, and this page cannot answer it: no cell here has been measured on those 90 cases. Recording the
denominator matters more than the ranking would: 90 cases across 23 scenarios is **3.9 cases per scenario**, so a
one-case move is 1.1 pp and any comparison at that granularity needs the case list, not the headline. The corpus
also removes injection-tool traces, which is precisely the anchor this engine's pre-segment windows lean on, so
the first task on it is not a score — it is whether the fault-free window is recoverable at all.

**Two adjacent benchmarks are named and deliberately not added to the table.** `SWEOps-Bench` (arXiv 2611.06099,
55 tasks over 16 Kubernetes operators, verified recovery 14.5–52.7 %) scores _repair_, not localization;
`DistDebug-Bench` (arXiv 2611.03523, 120 distributed-system bugs, root-cause BLOCK in source) scores a location
inside a repository. Neither is a ranker's denominator, and putting either beside `Top@1` on a service would be
the category error `§0q` exists to avoid.

**What this changes on the standing table: nothing yet, and the reason is a missing measurement rather than a
missing claim.** The published cells are RCAEval's nine (89.8 %) and FSE'26's 1 422 (75.46 %), and RCAtlas-Core is
a third denominator this repository does not report on — the same gap iteration 264 recorded and this iteration
did not close. It is the first item of the next plan, ahead of any further weight work: a 90-case corpus with a
public non-LLM threshold is worth more to the standings page than one more case on a corpus the engine already
wins 90 % of.

## 2026-11-12 (later) — the non-LLM ceiling on RCAtlas, and what our 42.69% is worth against it

The sweep this iteration ran found no new entrant, and it found something more useful than one: the RCAtlas paper's
**per-family** numbers, which the earlier entry in this file did not carry.

| family on RCAtlas-Core (90 cases, PR@1)            |     reading | what it is                                                             |
| -------------------------------------------------- | ----------: | ---------------------------------------------------------------------- |
| simple harnesses (single call / SQL agent / Codex) | **65–77 %** | three mid-tier models                                                  |
| published LLM RCA agents                           | **16–53 %** | each hard-codes 10 % to 100 % of its model calls                       |
| **statistical / causal (non-LLM)**                 |  **6–39 %** | `NSigma`, `BARO`, `CIRCA`, `RCD`, `TORAI`, `FaultInsight`, `SimpleRCA` |

Two consequences, and the second is the one that matters for this project.

**The ordering kills the shape that was retired, permanently.** `0d6ae609` removed a multi-hop ReAct investigator
whose control flow was a staged procedure; the RCAtlas paper puts published RCA agents of that shape at **16–53 %**
and plain harnesses at **65–77 %**, on every model where both ran, and its case study names the mechanism: _a
hard-coded investigation path skips the decisive evidence, because the prescription decides where to look before the
incident reveals what matters._ That is the same conclusion `0d6ae609` reached from the other direction, measured on
a different corpus, by a different group. **The eliminator is a simple harness by construction, so this is the arm
that the literature says survives; the investigator is kept as the control, not as the hope.**

**And our non-LLM reading sits above the non-LLM class's reported ceiling — across corpora, which is why this is a
hypothesis and not a claim.** Our second-path reading on the 1 422 RCABench datapacks is **42.69 %**, against a
reported **6–39 %** for the statistical/causal family on RCAtlas. Those are **two different corpora**: RCABench
injects through a converter we wrote, RCAtlas screens eight public sources and removes injection-tool traces. So the
comparison is not a placement, it is a **prediction to test**: a non-LLM engine above 39 % on RCAtlas would be the
first such reading, and a reading below it would say that RCABench's 42.69 % is a property of the corpus rather than
of the engine. **That test is now the highest-value measurement available to this project**, ahead of any further
weight work, and it costs one corpus.

**The paper's own ablation is a spending guide, and it prices the layer this iteration built.** A stronger model
mainly improves **reliability** (consistency of correct answers across runs); a multi-turn harness mainly improves
**aptitude** (the ceiling of what is solvable); **reasoning effort moved accuracy by a few points while multiplying
runtime by as much as seven.** That is the third independent confirmation of the design choice in
`docs/agentic-layer-plan.md` §5: the eliminator is a _harness_ change (aptitude) with a cheap model, and the
investigator's expensive rounds buy the thing that does not move the number.

**`arXiv:2611.02416` v2 confirms the prior and names the part this project has not built.** Its Historical Frequency
Profiling is the Expected Outlier Baseline iteration 265 implemented; its **Biased-Decision Correction** — preference
optimisation at the points where the model's conclusion disagrees with its own propagation analysis — is not built
here, and it addresses exactly the failure `0d6ae609` measured (_9 of 16 conclusions still named the symptom_). A 4B
model reaching **48.7 % on Bank** against OpsAgent's 18.5 % says the correction matters more than the model size,
which is the same lesson as the row above from a different paper.

**One sweep addition, and it is not a competitor.** `arXiv:2611.03223` (ARCBench) benchmarks whether an agent's
operating rules survive context compaction; it is about agent harness hygiene, not root-cause localisation, and
putting it on this table would be the category error §0q exists to avoid.

## 2026-11-13 — RCAtlas read down to the per-source cell, and the one column we can already be placed in

The two entries above carried RCAtlas's _family_ bands (6–39 / 16–53 / 65–77 %). This iteration read the paper's
**Table 7**, which breaks every method down by source dataset, and that table contains a column this repository can
be placed in _today_: **RCAEval (27 cases)**, one of the eight sources RCAtlas draws from, and a suite we hold in
full.

| method, on RCAtlas's RCAEval column (27 cases, PR@1)        |                        reading | note                                          |
| ----------------------------------------------------------- | -----------------------------: | --------------------------------------------- |
| SQL agent / Codex / one-shot                                |             94.2 / 90.1 / 79.8 | LLM harnesses, ≤1 h per case, tokens per case |
| **this engine (735-case RCAEval suite, run `40792623427`)** |                      **85.44** | **zero tokens, milliseconds per case**        |
| FoA / RCAgent / DecompRCA                                   |             66.7 / 59.3 / 55.6 | published LLM agents                          |
| **TORAI / NSigma / SimpleRCA**                              |         **63.0 / 59.3 / 55.6** | the strongest non-LLM methods on this column  |
| BARO / CIRCA / FaultInsight / RCD / random                  | 44.4 / 29.6 / 28.4 / 0.0 / 7.1 |                                               |

**The 27-versus-735 caveat is the whole of the claim's honesty and is stated before the number.** RCAtlas's column
is 27 cases it _selected_ under eight exclusion rules; ours is the 735-case suite, which includes 69 cases their
rules reject as having an unclean before-period and 38 with incomplete data. So this is a **population inequality,
not a head-to-head**, and the direction of the bias is not known — their sample deliberately covers the hard
scenarios, which if anything makes their 27 harder than a uniform draw. What the reading does support is narrow and
worth writing down: **on the suite that supplies 30 % of RCAtlas's cases, a deterministic engine's published number
sits above every non-LLM method in RCAtlas's table and above every published LLM agent's RCAEval cell, and below two
LLM harnesses that spend a model call and up to an hour per case.**

Three facts from Table 7 that change the plan rather than decorate it:

1. **RCAtlas scores only the FIRST of at most five answers (PR@1).** Width buys nothing there; ordering buys
   everything. That is the same conclusion `docs/agentic-headroom.md` §10 reached from the depth ladder, arrived at
   independently by the field's first unified benchmark — so the depth/ordering axis is now externally motivated
   rather than internally convenient.
2. **The 33-case group is the non-LLM class's common blind spot and it is legible here.** On errors, outages,
   configuration faults and network breaks NSigma reaches **15 %** and BARO **6 %** against **67 %** for the SQL
   agent and Codex, because those methods score _signed_ maximum deviation and a service whose traffic **fell**
   ranks last. RCABench's own `NetworkPartition` and `HTTPResponseReplaceCode` families are the same shape, and
   §10.6 already measures a +26 pp 5→20 window gain on the former.
3. **Per-level columns are not ours to average.** RCAtlas reports service 59 / pod 20 / node 11, and its upward
   mapping credits a pod answer with its service but cannot credit a service answer with a pod. On the 31
   pod/node-annotated cases a service-granularity engine is scored on a question it does not answer, so an entry
   must report those cells separately — a rule this page now carries rather than rediscovers.

**What is blocked, and by an artefact rather than by work.** RCAtlas releases the 90-case **list** and its code, and
has **not** released the converted data ("we plan to release", ~11 GB). The list is a single `ufile.io` package with
no repository, no digest and no per-file access, which this environment's network path cannot fetch without driving
that host's ad-gate. The faithful path — rebuild the 27 RCAEval cases from the source suite we already hold — needs
exactly one thing we do not have: the 27 ids and their windows. Reconstructing the sample from the paper's
_descriptions_ would be a re-implementation of the sample and is refused as evidence.

Full protocol, tables and the entry checklist: **`docs/rcatlas-crosswalk.md`**.

## 2026-11-22 — 90.46 % on all 1 422 cases, and the sentence that has to be attached to it

The seeded arm had read 88.82 % since 325. Two changes were priced at ¥0 and then dispatched, the winning
configuration was dispatched twice more to measure its spread, and the result is the highest surface this repository
has produced.

| arm                                                                                                                           | population |                 Acc@1 | tokens / case |    cost / case |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------: | ------------: | -------------: |
| **326 B: no ranked order shown, engine fallback, `contrast` gate, two resolvers** (mean of three runs: 1 285 / 1 287 / 1 287) | **1 422**  | **90.46 % (1 286.3)** |    7 199 + 32 |    **¥0.0147** |
| 326 A: seeded, `lag` gate, two resolvers                                                                                      | 1 422      |       89.59 % (1 274) |    8 025 + 37 |        ¥0.0163 |
| Sonnet · ThinkDepth.ai (`arXiv:2608.21310` Table 2)                                                                           | 500        |               90.00 % |       1 465 k | ¥32.94 ($4.64) |
| this engine, no model                                                                                                         | 1 422      |       81.29 % (1 156) |             0 |          ¥0.00 |

**Attach this sentence to the first row, not to the table:** of the **130 cases** that separate the engine from the
arm, **100 are two deterministic resolvers** (the entry prior and the interface witness) and **30 are the model**. The
model's own answers, ungated and without a fallback, read **41.21 %** — 40 points below the engine — and a gate with
an engine fallback only brings them to **75.74 %**, still 79 cases below it. The arm reaches 90.46 % because two
relational rules settle the answers a weaker surface leaves wrong; the yield of those rules **scales with how many
wrong answers the surface leaves** (+99 cases on the seeded surface, +208 on this one, +100 on the engine's own).

### What the comparison is, and is not

- It **is** the same corpus: RCABench's 1 430 published cases, converted to the 1 422 this pipeline can read, against a
  500-case simple random sample of the same corpus in the paper. The population is 2.8× larger here, and both sides
  score service-level Top@1 against a one- or two-service truth set.
- It **is not** a head-to-head, and the margin is measured from this side only: three runs of the identical
  configuration read 1 285, 1 287 and 1 287 — a spread of **0.14 pp**, five times tighter than the ±10-case band every
  earlier arm was judged by (`325.14l`) — against a single published point on the other side with no published
  variance and no per-case results. The decision rule was pre-registered before the repeats
  (`preregistration-327.md` §1): mean ≥ 1 280 with min ≥ 1 270, both met with slack, so the claim is "above the bar on
  average" rather than "at it".
- It **is not** measured against `DiagGuard`, the only 2026 method whose published gains could exceed the 90.0 row:
  that prototype is validated on AIOps 2025 (52.5 % best absolute) and RCA100, and **has never been run on RCABench**
  (`arXiv:2608.21310` v2, §VI; verified again this round — there is no v3).

### The price column is the claim that does not depend on the margin

At ¥0.0147 per case against $4.64, this surface is **2 248× cheaper**, and what the money buys is small and named:
**1 256 of the 1 422 answers are reachable with no model call whatsoever** (88.33 %), so the 30 cases above that floor
are the entire paid delta. Any future row in this document should be read as _price for the delta over 88.33 %_,
because that is the quantity the engine already owns.

## 2026-11-23 — the surface did not move, and a third population entered the table

Iteration 328 shipped no behaviour change and refused the one axis it priced. What it adds to this document is a
second external population and a boundary on the best rule this project owns.

### The 2026 frontier now has three points, not two

| system                                                                    | population | metric |       score |   ¥ / case |
| ------------------------------------------------------------------------- | ---------: | ------ | ----------: | ---------: |
| **micro-kinetic-ts · 326 B**                                              |  **1 422** | Acc@1  | **90.46 %** | **0.0147** |
| Sonnet · ThinkDepth.ai (`arXiv:2608.21310` Table 2)                       |        500 | Acc@1  |     90.00 % |      32.94 |
| **RCAtlas best run** — GPT-6.1 Sol @ xhigh + Codex (`arXiv`, 26 Oct 2026) |         90 | PR@1   |  **88.9 %** |     ≈ 1.85 |
| RCAtlas SQL agent · DeepSeek V4.1 Flash                                   |         90 | PR@1   |      85.6 % |     ≈ 0.36 |
| this engine, no model                                                     |      1 422 | Acc@1  |     81.29 % |       0.00 |
| best non-LLM method on RCAtlas (NSigma)                                   |         90 | PR@1   |      38.9 % |       0.00 |

The third population matters for a reason that is not the number: RCAtlas pools **eight public datasets and nine
systems**, and it reports a **best non-LLM baseline of 38.9 %**. Our own floor on this corpus is 88.33 % with two
deterministic resolvers and no model call at all — a 49-point gap that says the two benchmarks measure different
things (RCAtlas samples 90 hard incidents across systems; RCABench is one system, 1 422 cases), and that **no
cross-benchmark claim is available to anyone**. It also says the deterministic floor is the asset: on their corpus, the
best non-LLM method is below what a mid-tier model reaches, which is exactly what our resolvers are for.

### The witness's coverage boundary, now exact

The rule that has settled **332 decisions across two seedings without a single error** was walked against its own
premise, and the population is `HTTPRequestReplaceMethod` (127) and `HTTPRequestReplacePath` (39) and nothing else.
**On this corpus the novelty channel exists if and only if the fault rewrites the request**, so the witness is silent
on `HTTPResponseReplaceCode` — the largest residual family (37 of 136 misses). Silence is the correct reading of its
premise, and it is the reason the next axis must read the response side.

### The channel split: refused, on a population argument rather than on a bar

The axis that was supposed to read the response side priced at **+4 in-sample and +0…+4 held out**, against a
registered requirement of +7 on each fold. Its decomposition is the useful part: **20 fires, 20 repairs, 0 breaks on
`HTTPResponseReplaceCode`, and 15 fires, 0 repairs, 15 breaks on `NetworkDelay`.** A delayed service consumes no CPU,
so it leaves the same evidence a code replacement at the door leaves, and 45 of the 74 cases the rule could repair and
41 of the 153 it could destroy are traffic-shaped at the loosest bar. **A rule over two populations that overlap in
every observable column is not weak — it is undefined**, and this document records the criterion rather than another
bar: an axis must be separable in the columns the case carries, or it is not an axis.

## 2026-11-23 (2) — a fourth population, a competitor that must be answered on its own terms, and the corpus that does not exist

The four checks this iteration owes, run online before any number was produced.

### 1. Is the top competitor complete?

`arXiv:2608.21310` is still **v2** (fetched `…/html/2608.21310v2`; the abstract record is dated 2026-10-09). The
number this project is chasing — `Sonnet · ThinkDepth.ai` at **90.0 Acc@1** on a 500-case sample — is unchanged, and
no v3 exists. Nothing to re-read.

### 2. Is there a competitor this document has never seen? Yes, and it is a better-labelled one

`arXiv:2609.36686`, **NeurIPS 2026 Evaluations & Datasets track**, *Where Root Cause Analysis Fails: A
Retrieval-Reranking Decomposition* (Muhammad et al., UNSW + Baker Hughes). Code is **MIT and public**
(`github.com/cruiseresearchgroup/DecompRCA`), and it is the first paper in this space to publish the decomposition
this project has been reasoning about since the candidate-pool work:

> `top@k = Retrieval@K × Rerank@k` — *is the true cause in the candidate set of size K*, and *given that it is,
> is it ranked first*.

Three of its findings matter here, and one of them is a challenge rather than a citation:

| claim (verified in the paper and the README)                                                                         | what it does to this project                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Deviation magnitude puts the true cause in the top 15 for 98–100 % of microservice faults**                          | Our corpus behaves the same way, which is why `Acc@1` here is a **reranking** result. Our number belongs in `Rerank@1`, never in `Retrieval@K`.     |
| **Graph-based RCA never clearly beats the best statistical baseline** — not with short-window graphs, not with pools guaranteed to contain the cause, not with multi-day normal-operation graphs | This engine is graph-based and reads **81.29 %** against the benchmark paper's best published *model* at **37 %**. That is a direct refutation, and it can be measured on **their** code, deterministically, at ¥0. |
| **Their pipeline (multi-signal retriever + ONE listwise LLM call, no graph, no labels) matches or beats nine baselines on all six benchmarks; a system-description document adds +7 to +18 top@1** | It is the cheapest credible competitor design in print, and its cost profile (one call per case) is the one our ¥0.0147/case has to be compared against — not the 30-round agents'. |

The benchmark set is `WADI`, `SWaT`, `HVAC` and **`RCAEval RE1` (`OB`, `SS`, `TT`, 125 scenarios per suite)**. The last
one is a corpus this repository **already loads**: the nine-cell golden suite (735 cases over three systems) is the
same family. So this is not a paper to cite — it is a paper to **run against**, and `run_baseline.py --dataset
rcaeval` needs no API key, which makes the comparison deterministic on both sides.

The honest caveat, and it is the reason no number is claimed here: their tables are on **RE1** (125 per suite), ours
are on **RCABench** (1 422 TrainTicket cases). The only head-to-head that means anything is running their baselines
on **our** corpus, or our engine on **theirs** — and the second is a dispatch we already have the plumbing for.

### 3. Is RCAtlas reproducible? **No — and this document has to stop promising to try**

The earlier entries in this file recorded a "highest-value measurement available to this project": run the engine on
RCAtlas's 90 core incidents and see whether a non-LLM method can beat the reported **38.9 %** ceiling. That
measurement **cannot be made**, verified this iteration at the source:

- `arXiv:2610.35767` §4's availability paragraph points at a file host (`ufile.io/5ww9iyfb`), not an archive.
- The file is `rcatlas_release.tar.gz`, **51.3 KB**, and its contents are `cases/core90_cases.csv`,
  `cases/core90_labels.json`, `methods/`, `prompts/`, `answer_templates/` — a **case index and a label table**, from
  which the cases must be rebuilt from their public sources. It is not the telemetry.
- The converted ~11 GB core set and a ~500-case extension are *"we plan to release"*, with no platform and no date.
- The link itself was created 26 Oct 2026 with a three-day expiry.

**So the cross-benchmark comparison stays a hypothesis and the register must say so.** A promise to test it later is
worse than the hypothesis, because it reads like a plan while being an unavailable corpus.

### 4. Is the evaluation set complete?

Two facts, both verified:

- **The ceiling of the published field on this exact corpus is 0.37.** The benchmark's own paper
  (`10.1145/3797100`, `arXiv:2510.04711`) re-evaluates **11 SOTA models** on its 1 430 cases and reports a mean
  `Top@1` of **0.21** and a best of **0.37**. Our deterministic floor is 0.8129 and the shipped surface 0.9046.
- **This project's evaluation is not single-system, even though the RCABench cell is.** The nine-cell golden suite
  covers `RE1/RE2/RE3 × OnlineBoutique/SockShop/TrainTicket` = **735 cases over three systems**, and it is dispatched
  by a separate workflow on every change. The word "single-system" applies to the 1 422-case RCABench cell and to
  nothing else in this file — but the headline number is that cell, so the objection stands until a cross-system
  reading is published at the **current** surface (the nine cells were last read at 641/735, before the two
  resolvers; see the next iteration's registration).

**What the second corpus can actually be.** RCAEval `RE1-OB`/`RE1-SS` are on Zenodo (`10.5281/zenodo.14590730`,
5.2 GB, no registration, no DUA) and carry all three columns this engine reads: per-service metric series, a
root-cause label, and `inject_time.txt`. `AIOps2025` (`agenticopseval`, 400 cases, 11.9 GB, CC BY-NC 4.0) is the
only downloadable microservice corpus that would also defeat the **benchmark-family** objection, and its label is an
entity-level key-evidence list rather than a `root_cause_service` field — a mapping job, not a download.

## 2026-11-23 (3) — the leaderboard is frozen, two 2026 works entered the field, and the gap that matters is per-case data

The four checks this iteration owes, run online before any number was produced.

### 1. Is the top competitor complete?

`arXiv:2608.21310` is still **v2** (last revised 2026-10-09), the ten framework–backbone configurations are unchanged,
and `Sonnet · ThinkDepth.ai` is still **90.0 Acc@1**. The paper's own table also stratifies by causal depth, which is
the column worth more than the headline: Acc@1 at depth 1 / 2 / 3 reads **0.79 / 0.67 / 0.37** for the Sonnet arm — the
published ceiling on the deepest cases is **37 %**, and that is where this programme's remaining 135 misses live.

> **ERRATA (2026-11-23d).** The sentence above is **wrong**, and it shaped three iterations of planning. `0.79 / 0.67 /
> 0.37` are **process-level graph metrics**, not accuracy: **avg Node F1 0.79**, **✓-subset Edge F1 0.67**, **×-subset
> Edge F1 0.37** for the Sonnet arm. The paper's real stratified table is Table 2, "Acc@1 by depth d\*", and it reads
> **88.2 / 88.6 / 96.8 / 85.7** at `d* = 2 / 3 / 4 / 5` — the deepest stratum is **85.7 %**, not 37 %. `d*` is defined
> (§4.2) as *the shortest path from the root cause to the SLO-alarming service along `G*`*, where `G*` is the authors'
> **hand-labelled propagation graph**, which **RCABench does not release** (`case.json` carries `groundTruthServices`
> and `metrics`, no propagation edges). The depth axis is therefore **not computable** from the public corpus, no
> "37 % slice" exists, and this project makes **no claim** about leading or trailing any depth stratum. See
> `PROGRESS_2026-11-23d.md` §1 and `docs/cost-audit-334-335.md`.

### 2. Competitors this document had not carried

| work                                          | venue                       | metric / population                                                                 | what it means here                                                                                                     |
| --------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `arXiv:2609.36686` DecompRCA                  | NeurIPS 2026 (E&D), **v2 2026-11-17**, code MIT | `top@k = Retrieval@K × Rerank@k`; WADI/SWaT/HVAC/**RCAEval**; baseline runnable with no API key | splits a miss into "never retrieved" against "retrieved but ranked low". On microservice data retrieval is **98–100 %**, so every remaining point is a **reranking** point — which is what a resolver is |
| DeCoR / RICE-CM (`J. Cloud Computing` 2026)   | journal                     | **Avg@5** on 300 RCAEval cases (SS1/SS2/OB): 0.600 / 0.704 / 0.486                     | a top-5 metric is not comparable to Acc@1, and its coupling parameters are selected **per dataset on the same cases** — an in-sample selection this programme refuses by rule |
| InterfaceRCA (`Cluster Computing` 2027)       | journal                     | **HR@1 92.57 %** averaged over public benchmarks **and** a production set               | the average is over cells it does not itemise per corpus, and no population size is given per cell; listed, not ranked |
| `arXiv:2611.02416` Fault-Free Profiles        | arXiv, 2026-11-03           | 4B SLM, 48.7 % on Bank against OpsAgent's 18.5 %                                        | confirms that *fault-free-period frequency* is a usable feature; this programme has used the same idea as `faultFreeWeight` since 306, and always reports that it ships at **0** |

None of the four publishes per-case outcomes on RCABench's 1 422 cases, so the ranking in §8 of `PROGRESS_2026-11-23b.md`
is unchanged. What changed is the map of who is where: **the leaderboard is frozen at 90.0 %, the literature has moved
on to decompositions and process-level audits, and nobody but this project publishes a deterministic floor or per-case
verdicts.**

### 3. Is the evaluation set complete?

No. RCABench publishes 1 430 cases and **1 422 are readable** in the archive (the other 8 have been missing since 296
and are registered as such). RCAEval is the practical second corpus: **735 cases over three systems**, nine cells
(RE1 375 / RE2 270 / RE3 90), Zenodo `10.5281/zenodo.14590730`, 5.2 GB, direct download, no registration, all three
columns. RCAtlas remains **not reproducible** (`arXiv:2610.35767` §4 points at a 51.3 KB case index with a 3-day
expiry; the 11 GB conversion is "planned"), and AIOps2025 (400 cases, CC BY-NC, `agenticopseval`) is the only set that
would defeat the "one benchmark family" objection — behind a label-mapping step, because its label is an evidence list.

### 4. Are the mathematics and the papers complete?

The reading this iteration needed is Deng–Hani–Ma again, and it is now sharpened by data rather than by analogy: rings
are filtered and trees survive, and the arrow comes from the **initial condition**. On one population — the 224 gated
cases — the **loudest** rising error rate (a magnitude, i.e. a ring statement) is the truth **12 times in 160**, while
the **deepest** rising service along the call tree (a relation, i.e. a tree statement) is the truth **36 times in 39**
where it can act. A 60-point gap between a magnitude reading and a tree reading on the same cases is the clearest
support the mapping has produced, and it is recorded in `closed-axes-register.md` §329.5 rather than as a result: the
rule it would licence is not yet separable from the population it must not touch.

## 2026-11-23 (4) — the field's next arrivals are process-level, and two of them converge on our own refusals

The four online checks this iteration owes, run before any number was produced.

### 1. The top competitor is unchanged and its depth slice is still the only cheap point

`arXiv:2608.21310` remains **v2 (2026-10-09)**: ten framework–backbone configurations, `Sonnet · ThinkDepth.ai` at
**90.0 Acc@1**, and the stratified table still reading **0.79 / 0.67 / 0.37** for depth 1 / 2 / 3. Nothing moved, and
the 0.37 is still where our 135 misses concentrate.

> **ERRATA (2026-11-23d).** Same error as §3.1, corrected there: `0.79 / 0.67 / 0.37` are Node F1 / ✓Edge F1 / ×Edge F1,
> and Table 2's depth table reads **88.2 / 88.6 / 96.8 / 85.7** at `d* = 2 / 3 / 4 / 5`. The real position on depth is
> not a 37 % ceiling. What *is* true, and was measured this iteration on our own artifacts: by **entry distance**
> (0/1/2/3) our surface reads 64.52 / 94.06 / 94.97 / 91.67 %, the depth-3 slice holds **12 cases**, and **48.9 % of
> all misses sit at depth 0** — entry-self injections, where the deterministic channels are 108/108 and the model is
> 3/43. That population, not a deep one, is the open point.

### 2. A third corpus exists, and a set of unverified arrivals

| finding                                                     | source                                      | what it means here                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **RCA100/200 published**                                     | AIOps community release, public baseline flow | a third corpus candidate beside RCABench (1 422) and RCAEval (735); its label is an evidence list, so it needs a mapping step before it can be scored |
| **RCAgentOps** — Top-1 0.852, deterministic ranking over tool-mediated subtasks | 2026 industry survey, **secondary source** | the same architecture this project ships: the model investigates, a deterministic rule ranks. Not comparable (no per-case data on our corpora) |
| **VeriTrail-RCA** — a contradiction checker that re-derives once when support and refutation conflict | same | **structurally our refusal**: an answer contradicted by the case's own evidence is re-derived rather than trusted. The field is arriving where 328–330 already are |
| **StaR** — `AC@1 0.028 → 0.920` on dynamic-topology datasets; **Topo-MFP** — `Hit@1 0.872` on AIOps2022 | same | both replace a static causal graph with a stateful, topology-aware one. Adjacent, not comparable |
| **RCAtlas** still not reproducible                            | `2610.35767` §4                              | unchanged: a 51.3 KB index with a 3-day expiry and an 11 GB conversion that is "planned"            |

None of the five publishes per-case outcomes on RCABench or RCAEval, so the ranking in §1 of `PROGRESS_2026-11-23c.md`
is unchanged. What changed is the map: **the literature has moved from accuracy to process, and the process it is
converging on is refusal.**

### 3. The mathematics: the relation is bounded on both sides now, and the boundary is the object

Deng–Hani–Ma says a collision is local and the tree is what survives it. 329 measured the relation **on the truth
side**: the error rate rises on the path to the source and stops there, 34 of 34 against 0 of 34 on the answer. 330
measured it **on the graph side**, with the definition fixed before the run: the deepest rising service is the truth on
**0 of 74** addressed cases, and a randomised control on the same firing population loses **24 cases less** than the
rule does. Together those are not a contradiction but a boundary — a relation stated over the whole call graph
degenerates into the graph's **diameter**, because a star-plus-tree's deepest node is a leaf on an unrelated branch.
The next instrument has to state it on the **route** (the containment chain) and read the **stop** rather than the
maximum. That is what 331 pre-registers.

### 4. Workflows

Recorded after the push in §8 of the progress document: `CI`, `Release`, the benchmark workflows and `CodeQL` on the
head commit, with the Dependabot and code-scanning counts re-read at the same moment.

---

## 2026-11-23 (5) — the boundary outranks every channel: 91.98 % on the shipped corpus, still ¥0.0147 a case

Two iterations, both at **¥0**, and one of them moves the headline for the first time since the model arm.

### 5.1 The number, and what it is not

| configuration | correct of 1 422 | Acc@1 | cost a case |
| ------------- | ---------------: | ----: | ----------: |
| engine, no LLM | 1 115 | 78.41 % | ¥0.00 |
| shipped deterministic path | 1 156 | 81.29 % | ¥0.00 |
| published model arm + resolvers | 1 287 | 90.51 % | ¥0.0147 |
| **+ the first-hop rule (332)** | **1 308** | **91.98 %** | ¥0.0147 |
| `Sonnet · ThinkDepth.ai` (`2608.21310` v2) | — | 90.0 % | **¥32.94** |

The last row of ours is a **replayed surface, and replaying it costs nothing** (iteration 333, `cost-audit-333.md`).
Every row falls into one of five buckets, and only the last carries a model answer: 28 repaired, 7 broken, 2 moved to a
door that is not the truth, 0 moved inside a truth set — **37 rows whose answer is the door**, a name the case's own
failure boundary supplies — and **1 385 rows that stand on the answers already paid for**, because when the rule is
silent `applyResolver` takes the branch it always took. The ≈ ¥21 dispatch the plan queued would pay for zero model
answers on those 37 rows and re-measure a frozen endpoint on the rest; the only thing it buys is model drift, which a
50-case sample bounds at **¥0.74**, optionally. **Against the leader it is +1.98 pp at ≈ 2 240× lower cost per case**,
and the caveat `§2c` has carried since the beginning still applies: their 90.0 % is a 500-case sample under a
re-annotated label space, ours is all 1 422 cases under the injected-service label.

### 5.2 The rule, and why it is not the coefficient §320 refused

> When the only failing boundary of a case is the door's inbound edge — no child of the door reports an error, no
> measured edge below the door failed, and requests failed on the way in by more than 50 — the answer is the door.

§320.4 refused every form of *"make the entry point's own numbers louder"* on arithmetic: the entry sits 18–45 ranks
below the winner, and a term bounded by one step cannot close a thirty-rank gap. This rule does not touch the score,
does not promote the entry, and does not read the entry's numbers: it reads the case's **failure boundary** and
overrides the answer of every channel — the witness, the front door and the model alike. The two statements are
compatible, which is why both can be true.

Population, which is the larger finding: **318 cases** have nothing failing below the door, and the door is the truth
on **145** of them. The premise alone loses 86 (64 repairs against 150 breaks, precision 0.30) because it cannot tell a
door-self fault from a leaf fault the request path never exercised. Every channel column was measured and refused as a
conditioning signal — own-work 6.74 against 6.18, traffic **53.65 against 98.98** (louder when the fault is elsewhere),
the conduit test on the named answer **0.500** — and the column that separates them is the failure count on the edge
that enters the system.

### 5.3 What 331 refuted, and the external support it found

> A resolver may not take an answer away from a head that is itself loud.

Refuted on its mechanism on both artifacts: of the ten wrongly overridden cases the head is loud on **1** (R1) and
**0** (B) at the shipped bar, against a prediction of ≥ 8; and of the 218 overrides that were right, **81 have a loud
head** — because **a loud head is what a conduit looks like**. The guard's predicate is the negation of the resolver's
own premise at the same bar, so the rule is impossible on its own population and costing 25 cases at the best bar.

`arXiv:2610.05009` (v1, 4 Oct 2026) reports the same failure from the other direction and without our artifacts: its
L0 reference setting beats the full tool stack at localization (**85.4 % against 82.8 %**) and its trajectory analysis
finds *"cases in which agents override correct diagnostic recommendations after consulting additional evidence"*. That
is 331's residue, found independently — and it is the strongest external argument yet that the remaining headroom is in
**policing overrides**, not in giving the model more evidence.

### 5.4 Figure

`assets/accuracy-vs-cost-332.png`: left panel, accuracy against cost per case on a log axis with filled markers for
closed cloud and hollow for open self-hosted; right panel, the ablation ladder rung by rung.

## 2026-11-23 (6) — the confirmation is free, and two external readings that must be listed

Iteration 333 answered the plan's **≈ ¥21** confirmation dispatch and the **≈ ¥100** queue behind it at **¥0**
(`cost-audit-333.md`). The surface is now **replayed**, not re-measured: of 1 422 rows, **37** are answered by the door
itself — a name the case's failure boundary supplies, so no completion is read to produce them — and **1 385** stand on
the answers already paid for, because a silent rule leaves `applyResolver` on the branch it always took. The only
quantity a dispatch adds is **model drift**, bounded at **¥0.74** by a 50-case sample if anyone asks.

### 6.1 Two readings found while re-checking the field (2026-11-23)

| system | reported | granularity · metric · corpus | cost | LLM? |
| ------ | -------: | ----------------------------- | ---: | ---- |
| **InterfaceRCA** (Cluster Computing 30(1):16, Nov 2026) | **HR@1 92.57 %**, NDCG@1 95.51 %, averaged over public benchmarks + one industrial dataset | **interface**-level, GAT autoencoder over fused logs/metrics/traces | not reported per case | **no** |
| **ORCA** (Traversal / Fireworks, updated 2026-11-04) | 50.2 % hard RCA for GPT-6 Astra; 44.3 % Claude Opus 5 | live production incidents, avg@3 over 13 models | **$4.00 / task** (GPT-6), $0.71 (Kimi K3.1) | yes |
| **ours (this corpus)** | **Acc@1 91.98 %** | **service**-level, 1 422 TrainTicket cases, injected-service label | **¥0.0147 / case** | yes (with the door rule removing 37 answers) |

Two honest statements about the first row, because it is the only published number above ours:

1. **It is not comparable, and that cuts both ways.** HR@1 at *interface* granularity is a harder localization task
   than service-level Acc@1 on most corpora, and an "average over public benchmarks + industrial" hides the per-corpus
   spread. The paper reports a 2.93 pp absolute advantage over FaaSRCA; it does not report a per-case cost.
2. **It is the strongest argument for this direction.** InterfaceRCA wins with **no LLM at all** — a graph attention
   autoencoder over interface-level multimodal features. That is the same lesson iteration 333 just priced: the
   deterministic side of this problem is not a fallback, it is where the accuracy is, and the model is the thing that
   has to justify its calls.

`ORCA` is listed for the opposite reason: it measures a **live-incident** population with a 50 % ceiling and $4 a task,
which is the regime where an LLM's cost is defensible and where our corpus's 92 % says nothing. The two populations
should stay separate in every comparison, as `§2c` has required since the beginning.

## 2026-11-23 (7) — the 135 misses are four failures; 93.39 % is measured and withheld

Iteration 334 read the two remaining ¥0 items. The misses split: **20** lost at the rank one, **41** seen but lost,
**74** retrieval block, **0** absent — so the pool direction is closed and breadth is the only one of the four a wider
seed can reach (widths 5 / 10 / 22 / 44 expose 61 / 75 / 99 / 135 misses).

Two bars a deployed pipeline could read were refuted: the engine's own top-two gap reaches the block at precision
**0.115–0.170**, and no single term orders it (`stability` 5.4 %, `temporal` 6.8 %) although the truth is stronger on
both in 64/74 and 43/65 — the third measured instance of *a difference of means is not a decision rule*.

The survivor is a guard on the ENGINE: *no resolver may rename a case whose engine leads its second candidate by more
than 1.5*. The front door's 12 wrong overrides all sit there (median margin 3.34 against 0.03 on the 69 right ones), and
held out it reads **+10 / +10** at precision **1.000 / 1.000**.

| configuration | correct of 1 422 | Acc@1 | status |
| ------------- | ---------------: | ----: | ------ |
| published model arm + resolvers | 1 287 | 90.51 % | shipped |
| **+ first hop (332)** | **1 308** | **91.98 %** | **shipped** |
| + engine-certainty guard (334) | **1 328** | **93.39 %** | **measured, withheld** |
| `Sonnet · ThinkDepth.ai` | — | 90.0 % | published, ¥32.94/case |

**The withholding is a scope fact, not a doubt.** The margin lives in `terms.ndjson`, whose order differs from the
shipped order on 83 of 1 422 cases; the guard touches 13, of which 12 agree on both candidates. The engine already
computes gated scores — writing them is a **¥0 local re-run with no endpoint** — and the reading either reproduces on
that column (ship 93.39 %) or it does not (withdraw). Nothing here is quoted as the product's number until then.

## 2026-11-23 (8) — the guard ships: 93.39 %, and the column that made it a product number

Iteration 334 withheld a **+20** because its margin came from a score-sorted dump while the product publishes an order
that is not a function of the scores — the two orders disagree on **83 of 1 422** cases. Iteration 336 closed that at
**¥0** and shipped the rule (`engine-certainty-336.md`).

| configuration | correct of 1 422 | Acc@1 | status |
| ------------- | ---------------: | ----: | ------ |
| published model arm + resolvers | 1 287 | 90.51 % | shipped |
| + first hop (332) | 1 308 | 91.98 % | shipped |
| **+ engine certainty (336)** | **1 328** | **93.39 %** | **shipped** |
| `Sonnet · ThinkDepth.ai` | — | 90.0 % | published, ¥32.94/case |

Held out: **+10 / +10** on R1 and **+11 / +11** on B, precision **1.000 / 1.000**, flat from bar 1.0 to 2.0 on both
folds of both artifacts. Cost per case is unchanged at **¥0.0147**: the rule reads two numbers the engine already
computes and replaces an answer without reading any completion.

### 8.1 What made it a product number rather than a counterfactual

Two closures, both ¥0:

1. **The pair.** The margin is `score(published[0]) − score(published[1])` — the pair the product shows. A negative
   margin is a real configuration (a placement pass moved a candidate above one its own arithmetic scores higher), and
   the guard leaves that case to the resolver, which is the correct reading of "the engine hesitated".
2. **The column.** `per-case.ndjson` now carries `top1Score` and `top2Score`, the engine's `finalScore` for the two
   candidates it placed first and second. A local engine re-run over the full corpus (no endpoint, **15 m 56 s**)
   reproduces the published order on **1 422 of 1 422** cases, `truthRank` and `pool` included, so the arm's paid
   answers remain valid inputs and the guard can be priced on the artifact's own numbers with no join.

The dump is a second source of the *same* number rather than an approximation of it:

```
worst |score − Σ w·slope| = 0.000e+0   over 69 688 candidates
```

### 8.2 A defect the equivalence test found

The instrument (`certaintyUnder`) and the product (`engineCertainty`) are two implementations of one statement — the
shape iteration 322 paid a dispatch to learn to avoid. A grid test now requires them to agree (3 answers × 3 engine tops
× 6 margins × 8 bars), and it failed on its first run: `NaN <= 1.5` is false, so the instrument read a **failed
measurement** as a decided engine while the product refused it. Fixed in the instrument; the test is the fence.

### 8.3 RCAtlas: a second population, and the strongest external argument for a free harness

*arXiv:2610.35767* (October 2026) pools eight public RCA datasets into **RCAtlas** — 90 validated incidents across nine
systems, 23 scenarios, injector traces removed, one scorer mapping every answer to its labelled level (service, pod or
node). It is the first published table where an LLM harness's **cost per case** is measured the same way ours is.

| system | reported | cost per case | harness |
| ------ | -------: | ------------: | ------- |
| Codex + Sol (xhigh effort) | **88.9 % PR@1** | ≈ $0.26 (≈ ¥1.9) | free |
| Codex + DeepSeek V4.1 Flash | 85.6 % | ≈ $0.05 (≈ ¥0.36) | free |
| Codex + Luna | 68.9 % | < $0.01 | free |
| best published agent (FoA) | 53.3 % | — | SOP-driven |
| best non-LLM (NSigma) | 38.9 % | ¥0 | — |
| **ours (RCABench, 1 422 cases)** | **93.39 %** | **¥0.0147** | free loop + deterministic engine |

Two statements, and both matter:

1. **Not comparable.** 90 sampled cases across nine systems under a mixed-granularity scorer is a different population
   from 1 422 TrainTicket cases under one injected-service label, and neither number is evidence about the other.
2. **The mechanism is the one this register keeps measuring.** Every Pareto-optimal run in that study uses a *free*
   harness; the five hand-crafted agents fix a tenth to all of their model calls in code and land at 16–53 %. A
   prescribed step decides where to look before the incident says what matters — the same defect as a difference of
   means standing in for a decision rule, which 330, 331 and 334 each measured from a different side.

## 2026-11-24 (9) — the misses have names, the promotion rules are refused, and the next competitor has a proof

The surface is unchanged at **1 328 / 1 422 = 93.39 %** and the iteration bought knowledge rather than cases. Three
readings, all ¥0, and one field check that changes the route.

### 9.1 The ledger: 9 / 37 / 48 / 0, and breadth's ceiling is 28

`miss-ledger-337.md`. The 94 misses split into **9** precedence residues, **37** seen-not-taken, **48** breadth and
**0** absent, cross-tabulated by the channel that settled each. Twenty of the forty-eight breadth misses were settled by
a channel that never reads the seed (`unwidenable 20`), so a widening arm can address **28** rows at most — a wider seed
pays tokens on every case it is applied to and cannot reach the other twenty at any width.

The channels, on the arm's own answers: **interface 149 / 149**, prior 474 / 524 (90.46 %), model 595 / 668 (89.07 %),
entry 69 / 81 (85.19 %). The arm reads 1 287 against the deterministic path's 1 156, so the LLM is worth **+131** inside
the fusion; what is worth less than nothing is its naming taken as the answer (615 of 1 422).

### 9.2 Four promotion rules, four negative prices

| rule | fires | repairs | breaks | delta | precision |
| ---- | ----: | ------: | -----: | ----: | --------: |
| model agrees with the engine → publish the engine | 62 | 1 | 59 | −58 | 0.017 |
| engine over the model's channel | 78 | 6 | 60 | −54 | 0.091 |
| engine over any channel | 205 | 9 | 181 | −172 | 0.047 |
| engine over a quiet answer | 83 | 1 | 77 | −76 | 0.013 |

The +172 the channels earn by moving away from the engine is the same number that makes every reclaim rule negative. The
nine residues are the trade's price, not a defect.

### 9.3 CIE: the first competitor with a theorem, and the next axis

*arXiv:2601.21359v2* — **Graph-Free Root Cause Analysis**: the root deviates in both its **internal** properties
(resource usage) and its **external** ones (latency), while a component that only propagates a fault deviates
externally. A **conjunctive** internal × external score therefore ranks the root first **provably under arbitrary
amplification**, while the default **additive** score needs bounded amplification and a stronger condition. On 735
failures in nine datasets from three systems it reaches **68 % Top-1**, +21 % relative over the best of twelve
baselines, at 8 ms a diagnosis.

Two consequences for this programme:

1. **Our score is additive** (`log1p(selfAnomaly) + Σ weight × signal`), so its guarantee is the conditional one. CIE's
   distinction is the source/conduit distinction measured in 330, 331 and 334 from three directions; the difference is
   that they have a proof. The term dump already carries both sides per candidate, so the conjunctive form is a **¥0**
   test against the engine's own 1 156.
2. **68 % on 735 failures is the number to beat on that population** — not with our 93.39 %, which is a different metric
   on a different label space, but with the same decomposition machinery we already run.

Three further arrivals, listed so nobody rediscovers them: **Cloud-OpsBench** (arXiv:2603.00468; 754 runtime-verified
cases, TrainTicket + OnlineBoutique, JRA 0.78 / 0.68, and **29–33 % of correct answers fail evidence closure** — the
process metric we do not measure), **DataTrace** (arXiv:2611.18926; 83 environments, 48 % average with an 18 %
unsupported rate) and **DecompRCA** (retrieval-reranking decomposition, code public; retrieval "nearly solved" on
microservice benchmarks at 98–100 %, and a short system description in the prompt worth **+7..+18** to a reranker).

## 2026-11-24 (10) — the score has five live terms, one of them is the theory's, and it is a tie-breaker

The surface is unchanged at **1 328 / 1 422 = 93.39 %**; the engine alone is **1 156 (81.29 %)** and the written sum's own
order is **1 073 (75.46 %)**. This iteration bought the table the programme has never had — each term's contribution in
the target's units — and it settled the first competitor theorem on our own pool. Both for ¥0.

### 10.1 Five terms decide, eleven are inert, and the kinetic term decides by tie

| term | marginal | ties created | role |
| ---- | -------: | -----------: | ---- |
| `log` | −341 | 6 | load-bearing |
| `podState` | −200 | 2 | load-bearing (294 cases at **100 %** precision) |
| `selfAnomalyLog1p` | **+5** | **60** | **tie-maker** |
| `lat` | −58 | 2 | load-bearing |
| `failedEdge` | −42 | 0 | load-bearing |
| `dualFamily`, `stability`, `pool` | 0 | 0–2 | decorative |
| 11 further terms | 0 | 0 | inert (six at weight 0, five never measured) |

Two facts follow and both matter for the route. **The evidence terms carry the surface**: `log` and `podState` alone are
worth 541 cases, and `podState` is the only term in the score with a perfect record. And **the kinetic term's marginal
is positive only because removing it creates ties** — 60 of them, resolved by the pool's arrival order. Its whole range
is `log1p(1) = 0.6931`, smaller than one binary `log` bonus.

The sharpest reading is a partition rather than a marginal: where *any* candidate in the pool carries a non-zero
evidence term, the sum is right on **1 072 / 1 368 (78.36 %)**; where only the deviation is available, **1 / 54
(1.85 %)**. The partition is drawn on the pool, not the winner, so it is not circular. On this corpus the theory's
quantity **orders** candidates the evidence has already selected; it does not **select**.

### 10.2 The engine's own ablations (¥0, local, no endpoint)

The baseline reproduces the published artifact **byte for byte** (`sha256 da336800…`, `0.8129395218002813`), so every
delta below is attributable to one flag.

| configuration | Top@1 | delta | repairs / breaks |
| ------------- | ----: | ----: | ---------------: |
| shipped | **1 156** | — | — |
| `--self-anomaly-weight 0.5` | **1 159** | **+3** | 5 / 2 |
| `--self-anomaly-weight 0` | 1 158 | +2 | 16 / 14 |
| `--pod-state-weight 4` | 1 155 | −1 | 0 / 1 |
| `--dual-family-weight 0 --stability-weight 0` | 1 156 | 0 | 6 / 6 |
| `--log-weight 2` | 1 148 | −8 | 4 / 12 |
| `--self-anomaly-weight 2` | 1 119 | −37 | 0 / 37 |
| `--failed-edge-weight 0` | 1 110 | −46 | 0 / 46 |
| `--lat-weight 0` | 1 086 | −70 | 3 / 73 |

The ladder is asymmetric in a way that matters: the terms that are load-bearing lose cases in one direction only
(`lat`, `failedEdge`), the decorative pair is exactly neutral (6 / 6), and the kinetic weight sits **just inside a
cliff** — halving it is +3 and positive in both folds, doubling it costs 37 and repairs none.

### 10.3 The field, this week

**CIE** (arXiv:2601.21359v2) is confirmed and measured against us: three conjunction modes under four
specifications of the external axis all lose to the additive score — **800 / 800 / 800** on the shipped vector,
**492 / 499 / 499** with every external channel read at its measured value, **193 / 199 / 199** on propagated failure
alone, **190 / 201 / 201** on downstream `rise` alone, against 1 073. The shipped axis carries weight `0` on six of its
eight channels, and re-enabling those terms is catastrophic (209 / 60 / 80 cases at any weight); the one form the
register had named as the way back — a **pool-relative** external axis, the candidate's share of the pool's largest
propagated failure — is the worst of the four, and it was testable without touching the engine because the dump keeps
the unweighted values. The trend is monotone in how much of the axis the conjunction is handed (800 → 492 → 193 → 190),
which is the opposite of what a theorem about that axis predicts; density is not the missing ingredient, since row 2 has
53 893 of 69 688 candidates carrying a positive external deviation.
**The premise is what closes it**: CIE scores deviation magnitude and nothing else, while 541 of our cases are carried
by `log` and `podState`, channels a conjunction over two deviation axes cannot see.

**DeCoR / RICE-CM** (*Journal of Cloud Computing*, DOI 10.1186/s13677-026-01009-x) is new to this register and is the
closest competitor to our setting: it **assumes known fault-onset timing** — the premise `detectMADOnset` supplies —
derives contemporaneous and lagged relational evidence from a pre-fault normal segment, couples same-metric replicas by
node reliability, and ranks by reverse PageRank. Avg@5 **0.6000 / 0.7040 / 0.4864** on Sock Shop 1, Sock Shop 2 and
Online Boutique, best of the field on all three, at ~1/33 of RUN's runtime. Its metric is Avg@5, ours is Acc@1, so the
numbers are not comparable directly — but the datasets are ours, which makes it the first competitor whose *protocol*
we can reproduce rather than only cite.

**RCAtlas** adds a finding that corroborates our arm's shape: on 90 incidents across eight datasets, a **single LLM call
over a packaged evidence bundle** reaches 65–77 % PR@1 against 16–53 % for five published agent scaffolds and 6–39 %
for statistical/causal baselines, and **reasoning effort buys a few points for up to 7× the runtime**. Our arm is the
simple harness; the field's evidence says that is the right shape, not the cheap one.

### 10.4 What this changes

1. The contribution table now exists, and the honest reading is that the accuracy comes from evidence terms. The
   kinetic model's job on this label space is tie-breaking — which means the next use of the theory has to be
   **relational** (τ ordering upstream of the entry, the collision source at t₀) rather than a per-candidate bonus.
2. CIE's axis is **closed**, not deferred: four specifications of it were measured from the dump — shipped weights 800,
   every channel at its measured value 492, propagated failure only 193, downstream `rise` only 190, against 1 073 —
   and the pool-relative share the register had named as the way back is the worst of them. No engine work is planned
   for it; what the numbers say is that our accuracy lives in channels the framework does not model. The reading also
   retires a number this document quoted: the 745 / 748 "faithful mapping" is not reproducible by any subset of the
   eleven channels the dump carries, and the runner now prints its specification with every table.
3. DeCoR's protocol is reproducible on our own RCAEval numbers (Avg@5 on SS1/SS2/OB) and becomes the first
   apples-to-apples external comparison the register can hold.

## 2026-11-24 (11) — the competitor's metric is our metric, and its AC@1 is bounded by it

**Iteration 339 · ¥0.** No dispatch and no endpoint: the whole section is a re-reading of the loss census this
repository already writes after every RCAEval run.

### 11.1 The hedge that was removed

For three iterations this document carried the closest competitor at arm's length: *"Its metric is Avg@5, ours is
Acc@1, so the numbers are not comparable directly."* That was wrong. `Avg@5` is **"Average accuracy over the first five
cutoffs"** — the competitor's own abbreviations table — and `arXiv:2603.02057` writes it as
`Avg@k = (1/k) Σ_{j=1..k} AC@j`. Each term is an indicator on one integer: the rank at which the accepted answer first
appears. The census carries that integer (`truthRank`) and the pool it was ranked in (`pool`). The comparison was a
missing **column**, and `benchmarks/src/cutoff-accuracy.ts` is that column as code (37 tests, `100/100/100/100`).

### 11.2 The cells, and the ladder AC@1 cannot show

Census of run `45314745837` at `9588dda4` (digests `62dd882e…` / `b126a462…` / `3118005c…`, byte-identical to the
previous full run's):

| cell | n | AC@1 | AC@3 | AC@5 | Avg@5 | floor |
| ---- | -: | ---: | ---: | ---: | ----: | ----: |
| RE1:OnlineBoutique | 125 | 90.4 % | 96.0 % | 100 % | 96.2 % | 56.5 % |
| RE1:SockShop | 123 | 96.7 % | 100 % | 100 % | 99.0 % | 30.3 % |
| RE1:TrainTicket | 125 | 90.4 % | 96.8 % | 99.2 % | 95.7 % | 4.7 % |
| RE2:OnlineBoutique | 87 | 96.6 % | 97.7 % | 100 % | 98.2 % | 39.5 % |
| RE2:SockShop | 89 | 100 % | 100 % | 100 % | 100 % | 25.7 % |
| RE2:TrainTicket | 90 | 84.4 % | 87.8 % | 90.0 % | 88.0 % | 4.4 % |
| RE3:OnlineBoutique | 27 | 96.3 % | 96.3 % | 96.3 % | 96.3 % | 34.6 % |
| RE3:SockShop | 30 | 80.0 % | 93.3 % | 93.3 % | 89.3 % | 23.4 % |
| RE3:TrainTicket | 30 | 73.3 % | 83.3 % | 86.7 % | 81.3 % | 4.4 % |
| **pooled** | 726 | 91.7 % | 95.9 % | 97.7 % | **95.4 %** | 26.5 % |

Every miss on this corpus is a **depth** miss — the accepted answer is in the order on all nine cells (`abs 0`) — and
`4.2 pp` sits between the first cut and the third, concentrated in RE3. That is headroom a scoring change can reach
without widening the presentation.

### 11.3 DeCoR / RICE-CM, now protocol-identical

`DOI 10.1186/s13677-026-01009-x` — service-level localization **under a known fault-onset time**, which is exactly the
premise `detectMADOnset` supplies, and therefore the closest competitor this project has.

| dataset | their `Avg@5` | our `Avg@5` (RE1/RE2/RE3) | our `AC@1` (RE1/RE2/RE3) |
| ------- | ------------: | ------------------------: | -----------------------: |
| Sock Shop 1 | 0.6000 | 0.990 / 1.000 / 0.893 | 0.967 / 1.000 / 0.800 |
| Sock Shop 2 | 0.7040 | 0.990 / 1.000 / 0.893 | 0.967 / 1.000 / 0.800 |
| Online Boutique | 0.4864 | 0.962 / 0.982 / 0.963 | 0.904 / 0.966 / 0.963 |

**The comparison is invariant under the dataset mapping**, which matters because RCAEval's three suites are three
instances of the same two fleets and the paper does not say which of `RE1/RE2/RE3` is its "SS1". All three Sock Shop
cells read `Avg@5 ≥ 0.893` and all three Online Boutique cells `≥ 0.962`, both above their best cell of the same fleet
under any assignment.

**And their `AC@1` is bounded by their `Avg@5`, by definition.** `Avg@k ≥ AC@1` because `AC@1` is the first term of the
mean it averages, so a method that publishes only a cutoff average publishes an upper bound on its own first-choice
accuracy: `≤ 0.4864` on Online Boutique, against our `0.904`. That sentence needs no protocol assumption; the inequality
is asserted in the test file over every rank and every cutoff, because it is the one claim every external comparison
here leans on.

### 11.4 The floor is not decoration

A uniformly random order over a pool of `n` scores `(1/(n·k)) Σ min(j, n)` — `0.70` at `n = 4`, `0.50` at `n = 6`,
`0.25` at `n = 12`, `0.047` at `n = 64`. `RE1:OnlineBoutique` has a pool median of **6**, so a random order there
scores `56.5 %` `Avg@5` — more than half of our `96.2 %`, and the reason the floor now travels beside every row.
`arXiv:2609.27069` measures a **telemetry-free** ranker at `Avg@5 0.488` on this benchmark and calls that, not the
uniform `0.137`, the honest in-distribution floor; DeCoR's Online Boutique row sits `0.0016` below it. That is a
statement about a twelve-service fleet and a relational-only ranker, not about their proof.

### 11.5 What this changes

1. **A hedge became a command.** *Not comparable directly* is retired; the comparison is `run-cutoff-accuracy.ts` on the
   census of the last run, at ¥0.
2. **A bound replaced an estimate.** The register no longer needs to assume the competitor's first-choice accuracy is
   "lower"; it is at most `0.4864` on the cell it publishes, by the definition of the mean it quotes.
3. **A missing column is now a measured defect.** Nine of 735 census rows carry no `truthRank`, so the answer's `AC@1`
   is defined on 735 cases and every cutoff on 726 (`90.61 %` vs `91.73 %`). The module carries `rankMeasured` rather
   than collapsing an absent column into `null`, and returns both populations so neither can be printed over the
   other's denominator.
4. **Two axes opened, both priced.** RICE-CM as a *method* (four named components, nothing reproduced yet), and the
   `AC@3` gap on TrainTicket.

## 2026-11-24 (12) — the aperture: why an engine gain is worth a third of itself

Two queued arms carried **≈ ¥21 each**. Neither costs anything, and one of them turned out not to be worth buying at
any price.

The figure was `¥0.0147 × 1 422` — one full-cloud arm dispatch — applied to two engine-side changes. The engine is
`¥0.00` per case and this document's own cost row has said so since 326; `fingerprint_top_k` is not even engine-side,
because `fse26-run-config.ts` states that the ranking is computed before that field is read. The single sentence that
put the number in the queue — `term-marginal-338.md` §6.2, *"the arm's answers were produced from the shipped engine"* —
contradicts the arm's protocol, which says in three places that it does **not** show the engine's ranking and that
seeding is a separate arm that is off. The artifact agrees: five retrieval tools over the case's own telemetry, with
`engineRank` written beside the answer as a comparison rather than read by the loop.

So both arms were run locally, and the published surface was rebuilt as a join. **`--self-anomaly-weight 0.5` moves the
engine `1 156 → 1 159` (+3) and the published surface `1 328 → 1 328` (+0), with `0 repairs / 0 breaks` and both folds
at `+0`.** The cross-reference names the mechanism: four of the five engine repairs land on cases the arm already answers
correctly, so there is nothing left to repair; both breaks land the same way; and the single unmasked repair is the case
a promotion rule exists for — the family already priced at `−52 / −44 / −152 / −70`.

**The number this produces is the most useful one this document has carried in ten iterations: the aperture.**

> An engine delta converts to a published delta only on cases the arm gets WRONG and no rule already settles. That is
> **135 of 1 422 = 9.5 %** of the corpus. A weight worth `+3` on the engine is worth `0…3` on the product, expected
> conversion under a third.

Three consequences, and they re-order the queue:

1. **Engine Top@1 is not a proxy for the product number.** Every engine-side claim in this document should be read as an
   upper bound on a 9.5 % aperture, not as a forecast.
2. **The remaining work is where the aperture is.** Breadth's 28 addressable cases are 21 % of it, the reasoning
   residue's 37 are 27 %. A twentieth weight is worth a fraction of either.
3. **A refusal is cheaper than a dispatch, and this one was free.** The same ¥0 that measured the weight also produced
   the instrument (`surface-diff.ts`) and the defect it exposed: the stored artifact every earlier surface reading used
   carries no `top1Score`/`top2Score`, so its certainty guard was never evaluated — `1 308` was a surface the guard
   could not see, not one it declined to move.

Standing: **1 328 / 1 422 = 93.39 %** on the arm's answers at ¥0.0147 a case; **1 156 (81.29 %)** engine alone at
¥0.00; the competitor whose own metric is our metric (`Avg@5 ≥ AC@1`) still publishes no `AC@1` above our `Avg@5` on
any cell we share. Nothing shipped this iteration, and what it bought is the knowledge of where the next thing must
come from.

## 2026-11-24 (13) — the column nobody read: 74 of 94 misses never queried the culprit

The last two iterations established that an engine-side change is worth under a third of itself on the product
(the **9.5 % aperture**, section 12). This one asks the same question of the other side of the pipeline and finds a
larger number: **of the 94 published misses, 74 (78.72 %) never queried the causal service at all.** Against the corpus
that is **5.20 pp** reachable, against **1.41 pp** of genuine reasoning residue.

The reading is a join over artifacts that were already paid for, and it rests on a column the arm has been writing since
the pilot without anyone reading it:

| population | misses | never queried the culprit | queried, still missed |
| ---------- | -----: | ------------------------: | --------------------: |
| the arm's own answers | 135 | 102 (75.56 %) | 33 |
| the shipped surface | 94 | **74 (78.72 %)** | 20 |

Four checks make the 74 a reach population rather than a hard one. The culprit is a key of the case's own `metrics`
map **and** an endpoint of its own `traceEdges` in **all 74**, so nothing was missing from the corpus; the arm spends **4.99** of the **five**
tool calls the loop can execute over **1.888** distinct services, in a corpus carrying ~50 services a case
(`maxToolCalls: 10` never binds — the last of six rounds is answer-only; corrected in section 14); in **40 of the 74** the culprit's id is already somewhere in the recorded transcript (a lower bound — a row
keeps its last 2 000 characters); and the 74 span six fault families, so it is a policy failure rather than one
injector's blind spot.

**A premise had to be retired first.** The existing class names read a miss off where the truth sits in the *engine's*
ranking, which describes what a **seeded** arm would have been shown. The shipped arm is free — `seeded: false` on all
1 422 rows — so `SEED_WIDTH` is a width an experiment would set, the 48 "breadth" cases are not unreachable, and the
"37 reasoning failures" are 20. `reachCensusOf` / `formatReachCensus` now count three disjoint buckets (queried,
unqueried, **unrecorded**) and print which configuration each reading was taken on.

**What a stated schedule already reaches.** "74 reachable" is not a plan: of the 74, **29 sit inside the engine's own
top five** and **40 inside the top ten** (16 at 11–20; 18 beyond 20); over all 94 misses, 46 and 58. At the five calls
the loop can execute, a schedule would have queried the culprit in **29 cases (2.04 pp)** for no extra token; at ten
calls — which needs a second model call per case — **40 (2.81 pp)**. Both prices are in section 14. The two forties are not the same forty: the
transcript-named 40 and the top-ten 40 overlap in only 19, so their union is 61 of 74 and the routes are
complementary. It also explains why a seeded **prompt** measured worse than the free arm (§318): showing a model an
order is not the same as ordering its **calls**.

**The evaluator's own two columns, from its code.** `RCAEval` prints `Chance@5` and `Lift@5`, and two of the three
definitions are not what their names imply: `Chance@5` is the mean of `min(k, n)/n` over the cuts — `0.70` on a
four-service cell, not `1.00` — and is therefore **this project's `floor`**, now an asserted identity per cutoff; and
`Lift@5` is `average − chance_average`, an **excess**, so a ratio printed under that label would be a different number
wearing the field's name. Reconciling the two exposed a defect in the floor itself: `absent` was documented
"unreachable at every cutoff" and charged `uniformFloor(k, pool)` anyway, which reports a baseline above the one the
corpus could reach.

**Field check.** RCAtlas (late Oct 2026, 90 incidents over eight public datasets, six models × three reasoning efforts)
publishes the ordering this project has been arguing from the inside: plain harnesses **65–77 % PR@1**, five published
SOP agents **16–53 %**, statistical and causal methods **6–39 %**, with every Pareto-optimal cost/time point a simple
harness and reasoning effort buying a couple of points for up to 7× runtime. Its mechanism — "hard-coded investigation
paths skip the decisive evidence" — is our 74 seen from the other side: we have no SOP at all and still look in the
wrong place, because a budget without a policy is not a search. CARE-PO (`arXiv:2611.12125`) finds 82.8 % of agent
trajectories carrying at least one removable call and 68.0 % of calls removable — which, since this arm has no unspent
half (section 14), prices *choice* rather than slack: if most calls are removable, which five are spent is the policy. SRE-1 (ResolveAI, 18 Nov 2026) puts a process-scored
competitor into production: a 27B RL-post-trained investigator over 400+ tools with a citation-bearing causal chain,
38.8 % single-investigation pass and 71 % five-run ensemble on 49 live cases at −37 % cost against the strongest
frontier model — a column this corpus still cannot score.

Standing: **1 328 / 1 422 = 93.39 %** on the arm's answers at ¥0.0147 a case; **1 156 (81.29 %)** engine alone at
¥0.00; and the queue's largest remaining block is now a 74-case search-policy question whose ceiling is priced at ¥0 to
analyse and ≈ ¥2 to convert.

## 2026-11-24 (14) — the schedule, not the seed; and the budget is five, not ten

Section 13 ended with a 74-case search-policy question priced at ¥0 to analyse. Building the instrument to price it
produced two corrections and one route, and the route is now a product switch.

**Correction 1 — the arm has five calls, not ten.** `DEFAULT_QUERY_BUDGET` states `maxRounds: 6, maxToolCalls: 10`, and
the second number never binds: the loop's last turn is answer-only, so five calls execute, and the artifact carries
4.99 of them (`jq -r .toolCalls` → `1 416 × 5, 6 × 4`). Section 13's "stops with 4.99 of ten" is withdrawn.
`usableCallsOf(budget) = min(maxToolCalls, maxRounds − 1)` is now the single place that arithmetic lives.
Consequence: the zero-cost width of a schedule is **five**, and section 13's 2.81 pp was the double-budget reading
quoted as if it were free.

**Correction 2 — the model looks where the engine points, and stops after fewer than two services.** The 20 misses that
queried the culprit had it at engine **median position 2**; the 74 that did not, at **9**. Five calls spend on **1.888**
distinct services. So the misses the arm never investigated are the ones the engine ranked third to fifth — exactly
the slots a five-slot schedule adds.

| width | extra budget | reachable of the 74 | ceiling | point estimate at 98.33 % |
| ----: | ------------ | ------------------: | ------: | ------------------------: |
| **5** | **none** | **29 (39.19 %)** | **2.04 pp** | **2.01 pp** (28.52 cases) |
| 10 | `--max-rounds 11` (2× model calls, ≈ ¥0.029/case) | 40 (54.05 %) | 2.81 pp | 2.77 pp (39.33 cases) |

The conversion is measured rather than assumed: of the **1 198** investigations that did query the culprit, **1 178**
answered correctly (**98.33 %**). The ceiling is structural reach; the estimate is that rate applied to it; they are
printed one under the other because a reader who took 2.04 pp for an expectation would be claiming the 20 reasoning
failures a schedule cannot touch.

**The mechanism, and why §318 was not a refutation.** A **seed** prints the order into the prompt, which invites
re-ranking a prior — a shape this project has priced at chance (`z = −9.26` over 5 335 claims). A **schedule** keeps the
order in the harness and serves one service per call, so there is nothing to anchor on. `TOOL next` ships it: the
harness serves the next name in its own order, spends one call, and records it as investigated so the gate does not
refuse evidence the harness handed over. The free arm's prompt is byte-identical to the one every published number was
taken under, and a test asserts it; `run-query-agent.ts` gained `--schedule none|engine` (default `none`) and every row
records `scheduled: <width> | null` beside `seeded`.

**The second axis — the field's 98 % is one population of two.** Splitting `Retrieval@k` by the arm's own record:

| split | n | `Retrieval@1` | `@5` | `@10` |
| ----- | -: | ------------: | ---: | ----: |
| the arm queried the culprit | 1 198 | 88.23 % | **99.25 %** | 99.67 % |
| it never did | 224 | 7.14 % | **26.79 %** | 37.50 % |

`DecompRCA v2`'s "retrieval nearly solved (98–100 %)" is our 99.25 % — on the population the arm investigated. On the
population it did not, retrieval is 26.79 %, and the pooled 87.83 % averages a solved problem with an unsolved one. That
is also the causal chain behind the schedule: the arm looks where the engine points, so the misses it never
investigated are the ones a wider call budget can reach and a wider ranking cannot.

**Instruments.** `investigation-schedule.ts` (36 tests, 100/100/100/100), `reach-decomposition.ts` (18 tests,
100/100/100/100), `query-agent-schedule.test.ts` (17 tests over the directive and the loop); benchmarks **4 216 passed
/ 156 files** at 99.59 / 98.86 / 99.24 / 99.66. `formatConversion`'s `cases === 0` guard was removed as unreachable
with the reason written where it stood.

Standing: **1 328 / 1 422 = 93.39 %** on the arm's answers at ¥0.0147 a case; **1 156 (81.29 %)** engine alone at ¥0.00;
this iteration adds a route worth **2.01 pp at zero extra cost** and **2.77 pp at 2× calls**, and the next step is the
dispatch that converts a ceiling into a measurement.

## 2026-11-24 (15) — field check: a third hard-RCA leaderboard, and the axis no leaderboard scores

Three movements, none of which changes a number here and two of which change what a comparison may claim.

**ORCA Benchmark** (Traversal / Fireworks, updated 4 Nov 2026) is a **live-incident** hard-RCA leaderboard: 13 models,
three runs each, scored as `avg@3` on real production incidents. The best entry is **GPT-6 Astra at 50.2 %** ($4.00 and
1 144 s per task), then Claude Opus 5 at 44.3 % ($5.33, 2 598 s), then Kimi K3.1 Pro at 32.9 % ($0.71, 730 s);
DeepSeek V4.1 Flash — the family this project dispatches — sits at **20.3 %** for **$0.17** and 915 s. Three facts
follow. Live incidents are far harder than injected ones, so **this project's 93.39 % on RCABench and ORCA's 50.2 %
are not comparable numbers** and any table that placed them in one column would be measuring the task, not the method.
Cost per task on a live incident is 12–360× this project's ¥0.0147. And the ordering inside ORCA is *model*, not
harness: the leaderboard varies the model and fixes the harness, which is the opposite trade to the one RCAtlas made.

**"Free to Look, Free to Reason"** (the RCAtlas line) now reports its own method table: simple harnesses **65–77 % PR@1**
over three mid-tier models, published LLM agents **16–53 %**, non-LLM methods **6–39 %**, random ranking **5.5 %** — and
its RQ5 is a Pareto frontier over accuracy against *both* cost and time, where every Pareto-optimal point is a simple
harness. The overlap at the bottom is the finding worth carrying: **NSigma (38.9 %) beats DecompRCA and mABC**, so a
statistical method with no model at all outranks two published agents.

**The axis nobody scores.** CARE-PO counts how many tool calls were *removable* (82.8 % of trajectories carry at least
one; 68.0 % of calls). SRE-1 scores a *cited causal chain*. ORCA scores an answer at a price. **No public leaderboard
scores the value of a tool call that was spent** — i.e. the schedule axis this iteration prices (29 of 74 reachable at
zero extra cost, 2.01 pp). That is a gap in the measurement surface rather than a claim of novelty: it means the
schedule's contribution can only be argued from this project's own artifacts, and the next competitor table must say so
in a footnote rather than rank us on it.

**What it costs to be comparable.** Every leaderboard above publishes accuracy and a price; two publish time; one
publishes a process score. This project publishes accuracy, a price, `Avg@5` with its Chance and Lift, the aperture
(9.5 %), the conversion rate (98.33 %) and now a route price. The missing column is **wall-clock**: the per-case rows this project archives
(`accepted, datapack, faultType, pool, ranked, truthAnomalyBefore, truthRank`) carry no duration, so a cost/time Pareto
point cannot be computed from them — a gap to close before the next cross-table claim, not after.

## 2026-11-24 (16) — the dispatch refused the schedule arm: a sign error, and what it teaches

Section 14 priced a route at **+2.01 pp** off an artifact that already existed. The dispatch that tested it returned
**−43 pp**, and the entry exists to keep both numbers where the next reader finds them.

**What ran.** 532 cases — all 266 the engine answers at rank ≠ 1 plus 266 it answers at rank 1 — `--schedule engine`,
`--seed none --gate none --fallback none`, five executable calls, `deepseek-chat`, **¥7.36**. The 74 unqueried misses
are inside the first stratum by construction (checked: none of the 74 has engine rank 1).

**What it read.**

| arm | repairs on the 266 engine misses | retention on the engine's 1 156 (sample: 266) |
| --- | -------------------------------: | -------------------------------------------: |
| free (shipped) | **153 / 266 = 57.52 %** | **1 134 / 1 156 = 98.10 %** |
| schedule (dispatch 45414380350) | **45 / 266 = 16.92 %** | **139 / 266 = 52.26 %** |

Agent Top@1 **184** against the engine's **266** on the same 532 cases. Projected onto the sample: free **77.8 %**,
schedule **34.6 %**. The pre-registration's H3 floor was 96 % retention; the measurement is 52.26 %.

**Why — from the diff.** The arm differed from the shipped one by four appended lines and one tool, and the four lines
did three things: they sold the schedule as a replacement for `TOOL fleet` (*"…instead of whatever the fleet read
happened to surface"*), they stated a budget of **ten** calls the loop cannot execute (it executes five), and the served
slot carried `TOOL metric` verbatim — six rises on one service, with neither `ERROR` lines nor failed-interface counts,
the two channels that separate a source from a victim. A five-call budget converted from *1.888 distinct services +
three fleet reads* into *five single-service reads* is strictly less evidence for the same money, and half the engine's
correct answers went with it.

**What survives.** The 74-case reach reading (29 inside the engine's first five) and the `Retrieval@k` split (99.25 %
against 26.79 %) are properties of the artifact, not of this arm. What is refused is the **implementation**: "give the
model a route" became "replace the fleet read with a single-service walk".

**What ships.** `TOOL next` and `--schedule none|engine` ship at default `none` — the instrument makes the negative
result reproducible. The prompt is repaired to v2 (no call count, and a sentence that states what the route costs in
width); v2 is **untested**, and a reading under it will say so.

**What is next, and why it is not another schedule.** `TOOL fleet` printing an engine-order section — the first five
services in the engine's order, in the same call, in the same tool. No extra call, no `next`, no prompt sentence. That
is ~20 lines and a `fleet` test, ¥7 to dispatch, and it is the only version of this premise that does not pay for
selection out of the exploration budget.

**Standing.** 1 328 / 1 422 = **93.39 %** on the shipped surface at ¥0.0147/case; 1 156 (81.29 %) engine alone at
¥0.00. The field's 90.0 Acc@1 remains ahead. This iteration's contribution is **negative and priced**: a lever that
looked worth +2.01 pp is closed at −43 pp, with its mechanism named, for ¥7.36 rather than for ¥21.

## 2026-11-24 (17) — 342b's table was a tail, and the arm that changes evidence instead of text

Section 16 published a per-tool presence table (logs 73.7 % → 25.2 %, edges 60.5 % → 97.4 %, fleet 0.5 % → 0) as the
mechanism behind a −43 pp sign error. Re-reading the same artifact beside the free arm's, on the same 532 ids, puts a
limit on what any of those columns can say: `TRACE_CHARS = 2 000` is what a row keeps, and **532 of 532 rows in both
arms begin `[earlier results elided]`**, keeping **4.11** of five executed directives (free arm **4.05**).

**Withdrawn.** *"The fleet read was never common"*: `TOOL fleet` and `TOOL services` are **0.000 in both arms** — the
first call is the first block elision removes, and the 0.5 % was a different denominator. *"The route was never walked"*:
`0 of 532` traces naming `next` describes the last four calls only; a `next` issued first is invisible by construction.
The route's use is **not measurable from that artifact**, and the falsifier that "fired" is re-registered rather than
kept.

**Survives.** The tail's composition, measured on like with like (both arms eliding the same number of blocks): log
evidence fell by **48.5 points** and graph evidence rose to near-universal. And every outcome column: **184 vs 266**,
retention **52.26 %**, **−43 pp** against the free arm's 77.78 % on identical cases.

**Ships, so the next reading cannot repeat it.** A census counted as the directives run (`tools`, `nextServed`, a
`census:` line in the job log — a field, not an intention), and `--fleet-order none|engine`: the pipeline's own first
**five** candidates printed **inside `TOOL fleet`**, names only, at the end of the read. The instruction stays
byte-identical to the published one, no call is spent, no round is added — the first arm in this line whose effect can
only be attributed to what the model was **shown**, which is exactly what 342b lacked.

**Standing.** 1 328 / 1 422 = **93.39 %** at ¥0.0147/case; the field's 90.0 Acc@1 still ahead. This section records no
gain: it records that two published numbers were not supported by their own artifact, that the arm which produced them
is still closed, and that the next one is priced at ¥7.4 with four bars written before it ran.

## 2026-11-24 (18) — the shortlist is read in every case, and it is refused: a ranking is a candidate set

Section 17 shipped the first text-free intervention in this line: the pipeline's own first five candidates printed
inside `TOOL fleet`, with the instruction byte-identical to the published one. It was dispatched on the **same 532
ids** as 342b for **¥7.17**, and it is refused.

| hypothesis | bar | measured | verdict |
| ---------- | --- | -------- | ------- |
| the section is read | `tools.fleet ≥ 1` on ≥ 50 % | **532 / 532 = 100 %**, 1.00 per case | passes |
| the reach converts | Top@1 ≥ 425 | **209** against the free arm's **414** | **fails, −38.53 pp** |
| it costs nothing | retention ≥ 96 % | **160 / 266 = 60.15 %** | **fails, veto** |
| census vs tail | order agrees | exact for late tools, `fleet` 0.0 % → **100 %** for the first call | passes |

The first row also settles 342b: the fleet read happens in **every** case, so the 0.5 % that entry published for it
was the 2 000-character trace and nothing else.

**The mechanism, in the answers.** On the 266 cases the engine has right — where the truth *is* the engine's rank 1 by
definition — the arm answers rank 1 in **158** cases (free arm: **261**) and answers a **sibling of the printed five**
in **44** instead of 1. A presented ranking is read as a candidate SET, and the model's reconciliation of two rankings
(the fleet's surprise order and the pipeline's) is worse than either: 1.615 distinct services investigated against
1.895, 37.2 % agreement with the engine's rank 1 against 67.5 %, 39.29 % accuracy against 77.82 %.

**Three presentations, three losses.** Printed (§318 seed): **81.08 %** against the free arm's 93.39 %. Served (342b):
retention **52.26 %**. Shown (this): retention **60.15 %**, **−38.53 pp**. The form with no text at all — which should
have been the strongest test of the premise — is refused hardest on the number that matters, so *"show the arm the
engine's order"* closes in all three of its known forms for ¥14.53 in total.

**Standing.** 1 328 / 1 422 = **93.39 %** at ¥0.0147/case; 1 156 (81.29 %) engine alone at ¥0.00; the field's 90.0 Acc@1
still ahead. What the field's own numbers say about this axis is consistent: ORCA's live-incident `avg@3` has the
strongest model at **50.2 %** and a non-LLM 38.9 %, and the free-investigation harness at 65–77 % PR@1 outranks every
published agent — the leverage is in the arm's own investigation, not in handing it a shortlist.

**What is left, and it is not a presentation.** `--max-rounds 11` with **no** seed, no schedule, no shortlist: a wider
investigation, priced by 341 at 40 of 74 unqueried misses for 2× the model calls (≈ ¥14 at this sample size). No
iteration since 318 has run it, because every dispatch went to a presentation of the engine's order instead.


> **Reading order.** The entry below is the SUMMARY of sections 19–27 that follow it: it states the three
> corrections of that day and the standing at the column the runs were taken under. The sections after it are the
> per-iteration records, and where the two disagree the section wins, because it is the one with a dispatch id.

## 2026-11-25 — three corrections in one day, and the cost standing restated at the column the runs were taken under

**The floor was a second rule.** Iteration 351 found that `--certainty-floor` settled on `priorTop ?? engine.top1` while
the shipped certainty guard settles on `engine.top1`, fired `>=` against `>`, and reported the stratum `prior` instead
of `certainty` — the third disagreement hiding the first. It was latent here (the arm runs `--fallback engine`, so
`priorTop` is `engineWinner` on **1 422 of 1 422** cases) and one configuration away from being live. Corrected, the
floor is provably inert above the corpus's fitted frontier: 0 cases gained, 0 lost, **582 silenced** at 0.8630 and
**360** at the inherited `ENGINE_CERTAINTY_MARGIN = 1.5`. `certainty-floor-351.md`.

**The cache pays 81 % of the bill's tokens, and the probe that closed it could not see them.** Run `45595943761`
recorded **6 204 649 of 7 636 769 prompt tokens as hits (81.25 %)** and cost **1.69 CNY, 0.00119 a case** — against
7.77 with no cache. The 349 probe's four `prompt_cache_hit_tokens: 0` readings are a statement about a 191-token
prompt, not about a workload. `cache-hit-352.md`.

**The line that printed the bill was 9.2x wrong.** `run-query-agent.ts` ended every run with `P x 2 + C x 8` labelled
"the declared prices": peak column, cache as a miss — 15.55 for a run that cost 1.69. It is now `cost-model.billLine`,
priced at the column in force at the artifact's own `startedAt`, with the no-cache counterfactual printed beside it.
`bill-line-353.md`.

**The standing, at the column the runs were taken under (off-peak 1 / 4 / hit 0.02 CNY per million):**

| system | Acc@1 | CNY / case | vs ours |
| ------ | ----: | ---------: | ------: |
| **ours · floor 1.5, cache as measured** | **93.32** | **0.0012** | — |
| ours · floor 1.5, cache as a miss | 93.32 | 0.0055 | 4.6x |
| ours · floor 0, cache as a miss | 93.39 | 0.0073 | 6.1x |
| RCLAgent V2 · Qwen | 53.4 | 6.39 | **5 370x** |
| Sonnet · ThinkDepth.ai | 90.0 | 32.94 | **27 673x** |

**No accuracy in this document moved.** The nine RCAEval cells, the FSE'26 surface and the benchmark head-to-head are
untouched by all three iterations: 353 has no artifact of its own and reprices two existing ones, and 352's only
measurement is on the arm's own artifact. What moved is the money column and its attribution — and the attribution now
says the transcript (84.6 % of the bill) is the largest unpriced lever this programme has.
## 2026-11-25 (19) — convergence is 40 % of the loss, and the other 60 % is not convergence at all

Section 18 closed the presentation axis and named its mechanism. This section prices it on the same 532 paired ids at
zero cost, and corrects a rate that has been in this file since section 14.

**The decomposition.** `414 − 209 = 205`, split by (is the engine right) × (did the investigation query the culprit) ×
(is the answer correct):

| block                                            | cases | share |
| ------------------------------------------------ | ----: | ----: |
| the model stopped querying (convergence)          |    83 |  40 % |
| the inference path the section overwrote          |   101 |  49 % |
| the same queries converting worse                 |    24 |  12 % |

The 40 % block is a count: the free arm queried the culprit in **246 of 266** engine hits, the shortlist arm in **161**
— 85 fewer per-service queries, which is the entire `distinct` 1.895 → 1.615. An independent reweighting puts it at
74 cases (36 %), so the two estimates bracket convergence at **36–40 %**.

The 49 % block is not convergence and could not be: on the engine's **misses** both arms behaved the same (48 vs 43 of
266 queried the culprit), and with no query the free arm answered **115 / 218 = 52.8 %** against the shortlist arm's
**14 / 223 = 6.3 %**. The free arm has a path from the fleet's global evidence to an answer that never passes through a
per-service query, and a presented ranking destroys it. That is the product statement this line has been earning:
**do not overwrite a judgement the model already made.**

**Correction.** Section 14 priced the reach ceiling with a **98.33 %** conversion. That is the **hits** stratum's rate —
on a hit the culprit *is* the engine's rank 1, so "queried the culprit" and "agreed with the engine" are one event, and
the hits supply 246 of the 294 queries behind it (83.7 %). Reach cases are misses by definition, and the misses stratum
converts at **79.2 %**. Corrected ceilings: **1.61 pp** at width 5 and **2.23 pp** at width 10, against the published
2.01 and 2.77.

**Consequence for what is left.** The one unrun lever — a wider investigation with **no** order shown — is priced at
40 reachable cases for 2× the model calls, and its ceiling drops from 2.77 pp to 2.23 pp. It remains worth running
because it is the only arm on this axis that has never been dispatched, and it is now the only one whose premise has not
been falsified.

**Standing.** 1 328 / 1 422 = **93.39 %** at ¥0.0147/case; 1 156 (81.29 %) engine alone at ¥0.00; the field's 90.0
Acc@1 still ahead. What changed in this section is not the standing but the price of the next step, and the knowledge
that two thirds of the last loss came from cases where the arm did nothing at all.

## 2026-11-25 (20) — RETRACTION: the standing is an 11-23 measurement, and three signs flip against a same-day control

Section 19 priced convergence at 40 % of a 205-case loss, and sections 16–18 built a case that three presentations of the
engine's order were each refused. This section withdraws the second half of that, and puts a warning on the first.

**The trigger.** 345's arm never ran: its flag was not passed, `err=` appears in **0 of 532** transcripts, and the run
was a plain **free arm**. Reading that artifact beside the others exposed the thing it should have controlled for.

| arm                            | when             | Top@1 |    share |
| ------------------------------ | ---------------- | ----: | -------: |
| free                           | 2026-11-23 09:21 |   414 | 77.82 % |
| schedule (342b)                | 2026-11-24 14:27 |   184 | 34.59 % |
| shortlist (343)                | 2026-11-24 16:27 |   209 | 39.29 % |
| free (dispatched as onset, 345)| 2026-11-24 23:36 |   178 | 33.46 % |

The first and last rows are the **same arm**. McNemar on the paired cases: **245 right→wrong, 9 wrong→right, Δ −236,
p < 0.001**. The instruction is fenced by a test, the corpus is identical (`converterDigest b7fca80e…`), the ids are
identical.

**Withdrawn, against the same day's control:** shortlist **+31 cases (+5.8 pp, p < 0.001)** — not −38.53 pp; schedule
**+6 (p = 0.405)** — not −43 pp; and therefore "three presentations, three losses". The **shortlist is the only arm in
this line with a measured positive effect**, and the axis is **open**, with the form published as the worst now the
strongest.

**What still stands from section 19.** The decomposition is a *within-run* comparison — 414 − 209 on the same ids, same
day — so its arithmetic is unaffected by a baseline that moves between days. What it no longer supports is the causal
reading: if the shortlist arm is +31 against its own day's control, then the "inference path overwritten" block was
measured against a free arm from a different day and may not be about the section at all. The 40 % convergence figure is
a property of the *pair of runs*, and the pair spans no day boundary, which is the only reason any of it survives.

**The standing.** 1 328 / 1 422 = **93.39 %** at ¥0.0147/case was measured on **11-23**. The same arm, on the 532-case
sample, scores **33.46 %** today. Unless the free repeat returns ≈ 414, this file's standing cannot be reproduced at any
price, and every comparison in it — the field's 90.0 Acc@1 included — is between a measurement and a memory.

**Cause: unverified.** The supplier's model behind the name (`deepseek-chat` is a target, not a version), supplier-side
routing on a day that carried three arms and two full RCAEval passes, or an unfenced change here. The first would be
invisible to every run in this repository, because every run records the name.

**Shipped so the next reading can tell the difference:** `<artifact>.meta.json` with clock, model, budget and arms as one
string; a wiring guard that fails with the missing parameter's **name**; and the rule that an arm's control is the free
arm **dispatched in the same batch**. Full record: `model-drift-346.md`.

**The repeat settles it.** A free arm dispatched at 00:35 on 11-25 returned **170 / 532** against 178 the night before:
**Δ −8, McNemar 22 vs 14, p = 0.243** — the same level, twice. Against 11-23's 414: **Δ −244, 252 vs 8, p < 0.001**.
So the free arm today sits at a **level around 174 ± 6**, this section's §5.2 falsifier does **not** fire, and §5.1 does:
414 is a historical record that may not be compared with anything current, the standing included.

Against that level, the arms this file has been arguing about:

| comparison                 | first-only | second-only |    Δ |       p | effect |
| -------------------------- | ---------: | ----------: | ---: | ------: | -----: |
| free 11-25 → **shortlist** |         11 |      **50** | +39 | < 0.001 | +7.33 pp |
| free 11-24 → **shortlist** |         16 |      **47** | +31 | < 0.001 | +5.83 pp |
| free 11-25 → schedule      |         16 |          30 | +14 |   0.054 | +2.63 pp |
| free 11-24 → schedule      |         15 |          21 |  +6 |   0.405 | +1.13 pp |

**The section inside `TOOL fleet` is the only intervention in this programme with a measured gain, under both controls.**
That reverses section 18's headline twice over: the arm published as "refused by every bar" is the one worth building,
and the axis is open. Section 19's decomposition goes with it — 414 − 209 is a day boundary, not two arms — although its
within-run findings (the paired strata, the 98.33 %-was-a-hits-stratum correction, the 1.61 / 2.23 pp ceilings) compare
two columns of one run and survive.

**Standing.** None, currently. `1 328 / 1 422 = 93.39 %` was measured at a level this system no longer operates at, and
re-measuring it is now the first task rather than the last.

## 2026-11-25 (21) — The drift was a configuration delta, and the standing is a pipeline reading

Section 20 withdrew the standing on the strength of a 236-case drift in one arm. The drift does not exist. The two
artifacts it rests on ran different harnesses, and two of the fields that separate them were not in the record.

| field                     | 2026-11-22 (`45085062340`) | 2026-11-25 (`45519251447`) |
| ------------------------- | -------------------------- | -------------------------- |
| `seed`                    | none                       | none                       |
| `gate`                    | **contrast**               | **none**                   |
| `fallback`                | **engine**                 | **none**                   |
| `resolve`                 | **edge-novel**             | **none**                   |
| answered by the model     | 245 of 532                 | **532 of 532**             |
| Top@1 on the 532 ids      | **414** (77.82 %)          | **170** (31.95 %)          |

The old file's own rows say **287 of its 532 sampled cases were settled without the model at all** — 155 by the prior,
71 by the entry-prior rule, 61 by the interface witness. Split by that column, on the same ids:

| old `answeredBy` | cases | old correct | new correct | movement |
| ---------------- | ----: | ----------: | ----------: | -------: |
| `model`          |   245 |         180 |         122 |      −58 |
| `prior`          |   155 |         105 |          40 |      −65 |
| `entry`          |    71 |          68 |           2 |      −66 |
| `interface`      |    61 |          61 |           6 |      −55 |
| **total**        |   532 |     **414** |     **170** | **−244** |

**186 of the 244 cases were never a model answer in either run.** Of the 245 that were, the 139 with an identical
answer string are correct in **139 of 139** in both runs; the 106 that changed differ on the final turn, where today's
loop tells the model that an unanswered case scores zero (and 532 of 532 answer, against 589 of 1 422 stopping on the
round cap before). Nothing about the supplier moved.

**Reversed.** The drift; its "level 174 ± 6"; the claim that 414 may not be compared with anything current; and §20's
withdrawal of the standing — `1 328 / 1 422 = 93.39 %` is a **pipeline** reading, and a bare arm cannot speak to it.
**Still invalid, for the corrected reason:** 342b's −43 pp and 343's −38.53 pp compared a bare arm to a pipeline
control. **Still standing:** the same-day **+31 shortlist** (bare against bare, 16 vs 47, p < 0.001), 344's within-run
findings, and 341's 98.33 %-was-a-hits-stratum correction.

**The standing, restated as what it is.** The 11-22 pipeline artifact reads **1 287 / 1 422 = 90.51 %** at ¥20.87
(153 repairs, 22 breaks, precision 0.874, retention 0.981). The published 93.39 % adds two deterministic guards over
that settled answer — the first hop (+50) and engine certainty (+20) — neither of which calls an endpoint. The model's
marginal contribution is **+131 cases over the engine alone**. A full-corpus re-measure with the shipped flags was
dispatched the same day (run `45531140696`, ¥20.81) and **returned 93.39 %**, with 42 cases gained against 1 lost
(p < 0.001) — §22.

**What ships so this cannot be read again.** `run-metadata.ts` now **requires** `fallback` and `resolve` and records
`revision`; `arm-comparison.ts` refuses a pairing whose two records differ outside the declared axis and prints both
McNemar forms; `run-arm-comparison.ts` exits 1 rather than printing a table beside a warning; and
`benchmark-agentic.yml` gains `query_control=free`, which runs the control **in the same job** with the harness flags
forwarded and the presentation flags omitted. The `.meta.json` files, written in 346, had never been uploaded at all.
Full record: `arm-configuration-347.md`.

## 2026-11-25 (22) — 93.39 % reproduces, and the field's best agent is 3.39 points behind it

Section 20 said this number "cannot be reproduced at any price"; section 21 showed the two files behind that claim were
different configurations. This section is the dispatch that settles it, and the panel it lands in.

**The re-measure.** Run `45531140696`, full corpus, shipped flags (`gate contrast, fallback engine, resolve
edge-novel`), **¥20.81**, 71 minutes:

```
cases 1422 · answered 1422 · answered by the model 636 · by the prior 516
repairs 180 · breaks 8 · precision 0.957
retained 1148/1156 of the engine's own (0.993) · repaired 180/266 of its misses
agent Top@1 1328 · engine Top@1 on the same cases 1156
```

**1 328 / 1 422 = 93.39 %**, with the two deterministic guards applied *inside* the artifact rather than re-read
offline (`door` 28 answers, `certainty` 20). Paired against the 11-22 artifact on the same 1 422 ids: **42 gained, 1
lost, Δ +41, p < 0.001** — the guards' own worth as a delta, measured for the first time. Precision of an admitted
override rose from 0.874 to **0.957** and retention from 0.981 to **0.993**.

**The panel.** RCABench Acc@1, as the trajectory study publishes it (arXiv 2608.21310v2, Table 2):

| framework | backbone | Acc@1 |
| --------- | -------- | ----: |
| **ours (engine + gate + resolvers + 2 guards)** | deepseek-flash (asked for as `deepseek-chat`) | **93.39** |
| ThinkDepth.ai | Sonnet | 90.0 |
| ClaudeCode | Qwen | 79.6 |
| ThinkDepth.ai | Qwen | 79.2 |
| AIQ | Qwen | 77.6 |
| TaskWeaver | Qwen | 65.2 |
| RCLAgent V2 | Qwen | 53.4 |
| GoS | Qwen | 48.2 |
| OpenRCA | Qwen | 46.6 |
| OpsAgent | Qwen | 45.8 |
| mABC | Qwen | 42.6 |
| ours (engine alone, no model call) | — | 81.29 |

**+3.39 points on the leader, which is 5.1 standard errors on 1 422 cases** — not a tie, and bought at ¥0.0147 a case
against an open-ended adaptive investigation. The engine alone clears **nine of the ten** published frameworks with no model call at all — every one except
Sonnet + ThinkDepth.ai at 90.0.

**What is left: 94 cases.** Eight are breaks (5 by the model, 3 by the `entry-prior` resolver) and 86 are engine misses
the arm did not repair. Of those 86, **37 sit inside the engine's own top five** and **12 more inside the top ten** — 49
cases, **3.4 points**, reachable by a re-ranker; the remaining 20 sit at rank 21 or deeper, which is the retrieval block
no scoring change reaches. The two named next steps follow from that split: gate `entry-prior` on the engine's margin
(it is 3 of the 8 breaks and cost nothing to try), and spend the width-11 investigation on the 49 reachable cases, whose
ceiling was corrected to **2.23 pp** in section 19.

**The gate is confirmed by today's artifact, not inherited.** Re-scored from this run: `contrast` 90.58 % resolved,
`lag` 83.05 % of the corpus at precision 0.766 with a net of +25, `cone` 61.67 %, `cited` 56.96 %, `none` 56.68 %. The
shipped `contrast` is the best of the five on this artifact, and the ordering is not close for the two weakest.

## 2026-11-25 (23) — The cost axis, which is where this programme is not merely ahead

Sections 20–22 settled accuracy. This one prices it, because "every step is expensive" turned out to be a statement
about the *shape* of the bill rather than its size, and the shape was wrong in a way no accuracy reading could show.

**The bill, from the artifact's own columns.** Run `45531140696`: **20.81 CNY** for 1 422 cases, of which
**10 221 261 prompt tokens against 46 085 completion — 222 to 1** — is 20.44 of input and 0.37 of output.
**98.23 % of the money is the question.** Four iterations of discussion about model cost had treated the two columns
as interchangeable; none of them moved the one that carries the bill.

**Where it went, by the resolver that settled the case.**

| settled by | cases | correct | CNY | per case |
| ---------- | ----: | ------: | --: | -------: |
| `model` | 636 | 582 | 9.40 | 0.0148 |
| `prior` | 516 | 481 | 7.51 | 0.0146 |
| `interface` | 148 | **148** | 2.15 | 0.0145 |
| `entry` | 74 | 69 | 1.07 | 0.0144 |
| `door` | 28 | **28** | 0.40 | 0.0143 |
| `certainty` | 20 | **20** | 0.29 | 0.0144 |

**786 of the 1 422 cases were settled by something other than the model, after each had paid for six turns:
11.41 CNY, 54.82 %, spent on answers that were then discarded.** The `interface` row is the sharpest — 148 cases,
148 correct, not one of which needed a call: the answer was in the case's failing interfaces before the first turn.
The per-case cost is 0.0143–0.0148 across all six strata, which is the tell. **The loop spends its budget whether or
not its result is used.**

**The one saving available at the door.** The engine's margin separates the populations almost perfectly — hits at a
median 0.872, misses at 0.081:

| floor | skipped | saved CNY | cases | accuracy |
| ----: | ------: | --------: | ----: | -------: |
| 0.30 | 964 | 14.18 | −23 | 91.77 % |
| 0.50 | 771 | 11.32 | −12 | 92.55 % |
| 0.80 | 603 | 8.85 | −2 | 93.25 % |
| **0.87** | **582** | **8.55** | **±0** | **93.39 %** |
| 1.00 | 520 | 7.64 | +0 | 93.39 % |

**582 cases (40.9 %) skipped for 8.55 CNY (41.1 %) with the corpus accuracy unchanged**, the boundary falling between
0.80 and 0.87 — a curve with two edges rather than a knob.

**The panel, with the column that matters.** Against the field's published configurations, the per-case price is the
axis where the gap is not a few points:

| framework | backbone | Acc@1 | CNY / case |
| --------- | -------- | ----: | --------: |
| **ours** | deepseek-flash (asked for as `deepseek-chat`) | **93.39** | **0.0078** |
| ours, at a 0.87 floor | same | 93.39 (projected) | **0.0046** |
| ours, engine alone, no model call | — | 81.29 | **0** |
| ThinkDepth.ai | Sonnet | 90.0 | not published |
| RCLAgent V2 | Qwen | 53.4 | ≈ 6.39 (the only published figure) |

*(Repriced in §24, §25 and §27: at the CNY card's off-peak column the same run is **0.0073** a case, and at the 0.87
floor **0.0043**. The 0.0078 here came from the USD card at 7.13.)*
| the other seven | Qwen | 79.6 → 42.6 | not published |

**The cheapest published competitor costs 820 times more per case and scores 39.99 points lower.** That ratio is not a
brag, it is a claim about what an RCA system has to do: a ranking that is already right costs nothing to consult, and
an agent loop that re-derives it from telemetry is paying for an answer the artifact already contained.

**What this closes and what it opens.** Closed at ¥0: the audit itself — `run-cost-audit.ts` prices any artifact
offline, so the question is answered from the file rather than from a dispatch. Opened at ¥12.3: the 0.87 floor's
projection, which needs one run to confirm because the simulation answers skipped cases with `engineWinner` while the
shipped path answers with `fallback`'s first name. **Open with no price yet:** 10.2 M prompt tokens were charged at the
cache-MISS rate across 8 530 calls to one endpoint with a byte-identical 750-character system prompt, so no prefix was
reused. Recovering the cache would cut the input price by up to 75 % — more than every other saving combined — and it
is the one item on this list this repository cannot assert by reading its own code.

**Correction, same day (section 24).** The table now carries the published rate. It read **0.0146** and **0.0086** on
first publication, because this repository prices a run at 2 CNY per million in and 8 out; a probe of the endpoint
found that the model it actually serves is `deepseek-flash`, at **$0.15 / $0.60** per million — **1.07 / 4.28 CNY** —
which is **1.87× less**. Nothing about accuracy moves: the cost column was an upper bound and is now the rate. Section
24 also closes the cache question with a measurement rather than a hope — two byte-identical calls read
`prompt_cache_hit_tokens: 0`.

## 2026-11-25 (24) — The name in the record is a model that no longer exists

Three findings from four requests of eight tokens each, and two of them correct something this document published an
hour earlier.

**1. `deepseek-chat` is retired.** `GET /v1/models` returns exactly two models:

```
deepseek-flash    owned by deepseek
deepseek-v4-pro   owned by deepseek
```

A request naming `deepseek-chat` is still served — by `deepseek-flash`, which the response's own `model` field
reports. So **every artifact in this programme names a model the endpoint does not offer**, because the record carries
the name that was asked for. That includes the 93.39 % in section 22. The readings remain measurements of the arm that
ran; what it costs is comparability across the alias's retirement, which is the third explanation for the 236-case
difference of section 20 — the other two being the configuration delta that section 21 proved worth 186 of the 244
cases, and the final-turn instruction that is in this repository.

**2. The cache serves nothing.** The same body, twice, on both models:

```
deepseek-chat  #1 prompt_cache_hit_tokens: 0    prompt_cache_miss_tokens: 191
deepseek-chat  #2 prompt_cache_hit_tokens: 0    prompt_cache_miss_tokens: 191
deepseek-flash #1 prompt_cache_hit_tokens: 0    prompt_cache_miss_tokens: 216
deepseek-flash #2 prompt_cache_hit_tokens: 0    prompt_cache_miss_tokens: 216
```

Section 23 listed the cache as the largest open saving, worth "up to 75 %, more than every other row combined". It is
closed with a **no**, and the number is withdrawn rather than deferred. What replaces it is the endpoint's own field,
recorded per call from here on, so a run that claims a cache saving has to show one.

**3. The cost column was an estimate, by 1.87×.** The served model's published off-peak rate is **$0.15 / $0.60 per
million**, which at 7.13 is **1.07 / 4.28 CNY** — against the 2 / 8 this repository has priced with since the first
arm. Run `45531140696` therefore cost **11.13 CNY and not 20.81**, which is **0.0078 per case**:

| | tokens | at 2 / 8 (as published) | at the served model's rate |
| --- | ---: | ---: | ---: |
| input | 10 221 261 | 20.44 | **10.94** |
| output | 46 085 | 0.37 | **0.20** |
| **total** | | **20.81** | **11.13** |
| per case | 1 422 | 0.0146 | **0.0078** |

> **Corrected in §27.** The 11.13 column was the USD card converted at 7.13. On the CNY card the off-peak column is
> **1 / 4**, which prices this run at **10.41 CNY, 0.0073 a case** — and 20.81 is not an overstatement but the **peak**
> column, exactly double.

**The structure is untouched, because it is token arithmetic and a price table cancels out of it:** 98.23 % of the bill
is the question, 222 prompt tokens per completion token, 786 cases settled without the model at 54.82 % of the run, and
the 0.87 floor saving 41.1 % with the corpus accuracy unchanged. The floor's own edge — 0.80 loses 2 cases, 0.30
loses 23 — is also unchanged, which is why it remains the one saving on the table.

**The migration is not made here, on purpose.** The `deepseek-flash` responses carry
`completion_tokens_details.reasoning_tokens: 8` — the model spent its whole eight-token budget thinking, because
**thinking is on by default on that name**. The shipped arms spend 5.4 completion tokens per call, which is impossible
with thinking on, so the retired alias was serving it with thinking off. Renaming without disabling thinking would
multiply the output bill tenfold and present as a price change rather than a configuration one. When it is done it is
one change: `deepseek-flash`, thinking disabled, served name and reasoning tokens both recorded.


## 2026-11-25 (25) — The floor was a price cut priced against a different rule

§23 and §24 moved the cost axis twice: to 11.13 CNY a run and 0.0078 a case (10.41 / 0.0073 on the CNY card —
§27), and to a floor that silences 41.1 % of
the bill. **Both were right about the money and wrong about the rule.** The floor's implementation settled a skipped
case on the fallback's first name; `cost-model.skipAt`, which produced the 41.1 %, credited it with the *engine's*
answer — the certainty guard's rule. One iteration priced one rule and ran another, which is the defect
`applyResolver`'s own comment records from iteration 322.

The correction is worth stating in this file because it changes the shape of the cost claim, not only its digits:

| reading | before 351 | after 351 |
| ------- | ---------- | --------- |
| what a skipped case answers | the prior's first name | `engine.top1`, the guard's own answer |
| the floor's boundary | `margin >= floor` | `margin > bar`, the guard's own comparison |
| the artifact's stratum | `prior` (merged with 516 refusals) | `certainty` (its own row) |
| how the saving is described | "accuracy unchanged" | **0 repaired against 0 broken, case by case** |
| what it can be read on | one corpus | any corpus, above the guard's bar |

The last two rows are the substance. "Accuracy unchanged" is an average and could be a 30/30 coin flip; `ruleEdges`
makes it two numbers — the highest margin at which the engine's answer would have **destroyed** a correct case
(0.8630 on the anchor) and the highest at which it would have **repaired** one (0.5707) — and above the first, nothing
moves at all. And the argument for the shipped default of 1.5 no longer mentions a corpus: above the guard's bar the
pipeline already discards the model's answer, so a floor there cannot change an answer on any corpus whatever.

**The cost table, at the served model's rates.** Per case, against every competitor whose cost is published at all:

| system | Acc@1 | CNY / case | vs ours |
| ------ | ----: | ---------: | ------: |
| **ours · floor 1.5, cache as measured** | **93.32** | **0.0012** | — |
| ours · floor 1.5, cache priced as a miss | 93.32 | 0.0055 | 4.6× |
| ours · floor 0, cache priced as a miss | 93.39 | 0.0073 | 6.1× |
| RCLAgent V2 · Qwen | 53.4 | 6.39 | **5 370×** |
| Sonnet · ThinkDepth.ai | 90.0 | 32.94 | **27 673×** |

The first row is the acceptance run of §25's floor and it needed a third price to compute: **81.25 % of that run's
prompt tokens were cache hits, at 1/50th of the miss price** — 6 204 649 of 7 636 769. A two-number rate table cannot
price an agent, and every figure in this file before today was the peak tariff with no cache. `cache-hit-352.md`.

`assets/cost-accuracy-351.png` carries the same reading as a frontier plot, with the two floor tiers drawn as the
horizontal step they are: the line does not move, the point does.

**What is left in the bill, and why the floor cannot reach it.** After the floor the discarded answers are 516 refusals
(4.02 CNY), 148 interface witnesses, 74 entry rules and 28 door rules. Every one of those settles on evidence the door
cannot see, and the engine's margin on those cases is *low* — that is what makes them refusals. The next floor is a
two-signal rule (the prior and the engine naming the same service), which no artifact could price until iteration 351
started recording `priorTop` per row.

## 2026-11-25 (26) — The bill the runner printed was not the bill

**A 9.2× error in one sentence.** Each run ends with `tokens P+C · est. ¥X at the declared prices`, and `X` was the
module constant `P × 2 + C × 8`: the **peak** column, with every prompt token billed as a cache miss. Run
`45595943761` cost **1.69 CNY** and its own last line said **15.55**. Everything in §23–§25 above is computed by
`cost-model.costOf`, which had priced the cache correctly since iteration 352 — the runner simply never called it. Two
arithmetics, one artifact, no test comparing them.

**The sentence is now the audit's own.** `billLine` composes it from `costOf`, so the printed figure and the audit's
total are the same function applied to the same tokens; `billNote` prints the no-cache counterfactual beside it, because
that is the number every earlier report carried. `QueryArmSummary` carries `cacheHitTokens` — clamped per row, `null`
when the artifact declared no such column — because the runner could not price a cache whose count it never received.
`PRICES` is deleted, and with it the phrase "at the declared prices" that named a table nothing else used.

**The tier is a function of the clock.** The card's two columns are 2× apart, so which one applies is a property of the
run: `tariffAt` reads `[01:00, 04:00)` and `[06:00, 10:00)` UTC on weekdays, half-open, and `servedRatesAt` returns the
column in force at the artifact's own `startedAt`. The two artifacts in hand now price themselves:

```
run 45595943761  tokens 7636769+34277 · 81.25 % served from cache · est. ¥1.69 at the off-peak column (1 / 4 / hit 0.02)
                 with every prompt at the miss price the same run would read ¥7.77 — the number the two-number line printed
run 45531140696  tokens 10221261+46085 · cache unrecorded · est. ¥10.41 at the off-peak column (1 / 4 / hit 0.02)
                 no row recorded a cache, so ¥10.41 bills every prompt at the miss price — a bound, not an invoice
```

**The cost standing, restated at the column the runs were taken under:**

| system | Acc@1 | CNY / case | vs ours |
| ------ | ----: | ---------: | ------: |
| **ours · floor 1.5, cache as measured** | **93.32** | **0.0012** | — |
| ours · floor 1.5, cache as a miss | 93.32 | 0.0055 | 4.6× |
| ours · floor 0, cache as a miss | 93.39 | 0.0073 | 6.1× |
| RCLAgent V2 · Qwen | 53.4 | 6.39 | **5 370×** |
| Sonnet · ThinkDepth.ai | 90.0 | 32.94 | **27 673×** |

**What this does not buy.** No accuracy moved — this iteration is a reporting fix, and the standing it reports is the
one §25 already claimed. What it buys is that the claim is now checkable from the line a reader sees, and that the next
cost iteration measures the transcript (84.6 % of the bill) rather than an estimate of it. Full record:
`bill-line-353.md`.

## 2026-11-25 (27) — What the field published while this programme was pricing a transcript

Iteration 354 pulled the transcript lever, so this entry records what the literature already knows about it, and what
three new agentic-RCA benchmarks claim — checked by search on 2026-11-25, not remembered.

**The compression literature says a token is not a second.** Three papers bear directly on a character cap:

| paper | the reading | what it changes here |
| ----- | ----------- | -------------------- |
| `arXiv:2607.02911` — CoACT: Action-Preserving Observation Compression (Tsinghua, ICSE 2027) | observations are **45.7 %** of total tokens on SWE-bench Verified and up to **67.8 %** on Terminal-Bench; compressing them cuts **33.0 %** of tokens with PASS@1 **69.0 → 71.0** (its Table I: an average over three models, 57.0→60.5 / 76.5→75.0 / 73.5→77.5), and the acceptance test is **next-action preservation**: if the action survives, the deterministic loop after it survives | our 84.6 % cache-miss input share and CoACT's 45.7 % observation share are the same phenomenon at two granularities — theirs counts the observation inside a full prompt, ours counts what the cache did not absorb. And their NAP criterion is the acceptance test this iteration adopted, at **¥0** |
| `arXiv:2611.05306` — You don't need long context (NVIDIA) | single-action compaction keeps SWE-bench Verified at **70.2** against **70.0** full-history; median peak context 32K → 8K | an aggressive cap is not expected to cost accuracy on a diagnostic loop; if ours does, the difference is the task, not the technique |
| `arXiv:2609.32961` — a systematic study of agent context compression (~35 000 runs) | a policy at **a third of the tokens ran 1.2–1.8× LONGER** on Terminal-Bench/Qwen, and equal-accuracy policies solved **different** tasks | a token saving is not a saving. This is why the artifact now records `turnLatencyMs` per call, and why the reading reports time beside money |

**And the benchmarks: three published, none comparable, one directly relevant.** `ORCA-bench` (`arXiv:2607.28545`)
puts coding agents in a six-day, 1 079-task oncall history and reports **25.3 %** RCA accuracy on medium tasks for the
best frontier agent and 10.0 % on hard; `Cloud-OpsBench` (`arXiv:2603.00468`) replays 754 runtime-verified cases over
57 fault types on OnlineBoutique and TrainTicket and reports **Joint RCA Accuracy up to 0.78 / 0.68** with evidence
closure missing in ~30 % of the cases an agent answers correctly; `RCAtlas-Core` curates 90 cases from eight public
sources.

Our standing — **93.32 % Acc@1 on a 1 422-case injected-fault corpus** — is **not** a number on any of those three, and
it would be dishonest to place it as one:

- ORCA-bench starts from an ambiguous user report hours into an incident; our cases are single-fault windows with a
  known injection time. A 93 % on the second says the ranking works when the window is given, not that an agent can
  find the window.
- Cloud-OpsBench's JRA is a joint score over root cause **and** evidence closure; ours scores the named service only,
  so 0.78 there and 0.9332 here are two different fractions of two different denominators. Its own finding is the
  warning worth carrying: ~30 % of the cases an agent answered correctly had not collected the evidence its answer
  implied — a property this programme's metric cannot see at all, because its arm answers in six turns whatever it
  looked at. **Measured in iteration 361**, that corpus holds **170 metric-bearing cases of 754** (not the 76 this
  document's earlier reading assumed), of which **166** name a service their own series carry — a population of
  real size, and the one this engine can be scored on next. The same census REFUSED the evidence-closure axis at
  case level: **0 of 754 cases** have every milestone inside a metric/log/edge surface, because the corpus's twelve
  tools read Kubernetes objects and no tool of the twelve returns a series — so `ECR` needs a tool family, not a
  recorded argument (`docs/closed-axes-register.md` §361). **Scored in iteration 362**: 156 of those 166 cases are
  scorable (10 state no anomaly window) and the engine's `CA@1` on them is **0.5128** — 0.4495 on Online Boutique
  (109 cases) and 0.6596 on Train Ticket (47). **That is not a row on their leaderboard and must not be read as
  one.** Their `CA` is over all 550 OB and 204 TT cases — Table 5's best is 0.88/0.70 (GLM-5.1 / GPT-5 under a
  ReAct scaffold) and Table 7's best is 0.95/0.80 (Codex harness on GLM-5.1) — while this engine's 156 cases are
  exactly the **Hard bucket** (`Performance` + `Application Code Defect` = 174 cases, of which 18 carry no series,
  no window, or a `node/` truth). Easy and Medium are the buckets a metric-only engine cannot see at all, and they
  are where most of their `CA` comes from. The comparable statement is therefore "0.5128 over 89.7 % of the Hard
  bucket, at CNY 0.00 and with no model call", and the gap to their numbers is a denominator question before it is
  a capability question (`docs/closed-axes-register.md` §362).
- RCAtlas-Core's 90 cases span pod and node faults, which this corpus does not.

What IS comparable is the cost axis, and it is the axis on which this programme is not close to anyone:
**0.0012 CNY a case measured, 0.0073 with the cache priced as a miss**, against RCLAgent V2's published 6.39. The
comparison papers above publish no per-case bill at all, which is itself a finding: a benchmark that reports accuracy
and not cost cannot say whether an agent is deployable.

**What this entry does not do.** It does not re-run any of the three benchmarks — none of their corpora are in this
tree — and it does not claim their numbers are wrong. The one claim it makes is negative and checkable: the three
newest agentic-RCA benchmarks all score *investigation* as well as *answer*, and this programme's headline still scores
only the answer. That is a gap in the metric, not in the engine, and it is the next thing worth closing.
