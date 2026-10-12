# Micro-Kinetic on RCAEval — Corrected SOTA Calibration (v3.2)

> **Revision history.**
> - v1 claimed "~1.84× academic SOTA" against a nofire.ai third-party table — **strawman, retracted**.
> - v2 calibrated against primary LLM-agent sources (RCLAgent 56.67%, GALA 42%) — correct but **incomplete**: it
>   missed the parallel *non-LLM* 2026 frontier.
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

**Metric.** All figures are service-level **AC@1 / Recall@1 / Top-1** (top-1 localization of the root-cause
*service/component*), the RCAEval protocol. Where a method reports a *different* metric or subset, that is stated
explicitly — cross-metric comparison is the single largest source of false "SOTA" claims in this field.

**And the benchmark's own published table is NOT in this metric.** Verified against the framework's repository
(2026-10-09): its reproduction script prints **`Avg@5`** per fault type with an `AVERAGE` column — *"BARO
achieves Avg@5 of 0.72, 0.99, 1, 0.83, 0.64, and 0.8 for CPU, MEM, DISK, SOCKET, DELAY, LOSS, and AVERAGE on the
Train Ticket dataset"* — and **TraceRCA's often-quoted "0.77" is an `Average@5`**, not a Top-1. So the framework's
**15 reproducible baselines have no published Top-1 number at all**, and any comparison of our AC@1 against a
number from its tables would be cross-metric. Two instruments the framework has since added make that comparison
honest and cheap, and neither is in our harness yet: **`--report-chance`** (prints `Chance@5` and `Lift@5` "so an
absolute score can be read against the floor a random ranker would reach on the same candidate set") and
**`--report-decomposition K`** (prints `Retrieval@K` and `Rerank@1` beneath each `Avg@5`).

---

## 0. STANDING — where this project sits, on three published evaluations

| evaluation | metric | ours | best published competitor | margin | basis |
| --- | --- | --- | --- | --- | --- |
| **RCAEval, all 735 cases** | service Top-1 | **78.8%** | PRISM **68%** (arXiv:2601.21359 — the benchmark author's own method) | **+10.8 pp, ≈1.16×** | cross-paper (§2a) |
| **RCAEval, all 735 cases** | service Top-1 | **78.75%** | PRISM **78.91%** — *our own reimplementation, identical harness* | **−0.16 pp = 1 case of 735** | controlled head-to-head (§3) |
| **RCAEval RE2-OB (90 cases)** | AC@1 | **86.7%** | RCLAgent **56.67%** (arXiv:2605.14866) | **+30.0 pp** | cross-paper (§2b) |
| **FSE'26 RCABench** | Top@1 | **53.23%** (757/1422) | field avg **21%**, best **37%** (arXiv:2510.04711) | **+16 pp over the best** | cross-paper, and the benchmark is a *different* fault set — see the caveat below |
| **RCAEval RE1-SS / RE1-OB (125 + 125)** | service Top-1 | **92.8% / 80.0%** | RCA-DCM **0.89 / 0.78** (arXiv:2609.36771) | **+3.8 / +2.0 pp** | cross-paper, but **the same 125-case populations and the same metric** — the closest like-for-like that exists, and it is BELOW us (§0b) |

**Ranking: first on all three published evaluations, and level with the best controlled competitor.** The
project leads the pre-LLM causal cohort by a wide margin on RCAEval overall (BARO 19%, with its
often-quoted 0.69 being a Train-Ticket RE2 Avg@5 rather than an overall Top-1) and the LLM-agent cohort by
20–40 pp. On our own harness — the only comparison with no cross-paper confound — we are **0.16 pp, i.e. one
case, behind** PRISM's additive pooling, not ahead.

**What this ranking is NOT.** Every `68%` figure above is **cross-paper**: its dataset, its harness, its case
sets, its metric implementation. The controlled re-run exists (`docs/prism-head-to-head.md`, run `34246577708`)
and it is decisive — in a direction the published-numbers table cannot show: on the identical 735 cases PRISM's
additive pooling scores **78.91%** against our **78.75%**. So the standing is a **tie on the harness that
matters** and a lead of ≈1.16× on the published number, and the `+10.8 pp` row must never be quoted without the
row beneath it.

### 0a. ABOVE US, AND NOT COMPARABLE — the six references that must be named

**A number we cannot beat must be named, or the standing reads as a claim about the whole field.** Each of these
is above us or beside us on some figure, and **none** is comparable to a service Top-1 on the 735 (verified
2026-10-09 / 2026-10-10 / 2026-10-11 / 2026-10-12; the detail is in the internal
`SOTA_LANDSCAPE_VERIFICATION.md` §1.4 / §1.7). **The
fifth entry arrived on 2026-10-11 and is the first whose SHAPE matches one of our populations exactly while its
abstract does not confirm it — read its entry before quoting any gap it implies.** And **§0d holds the reference
that belongs in neither list**: a 2026-10-12 find whose number is BELOW ours while its population is a mixture
nobody can compare to, which is a third class rather than a seventh member of this one.

1. **A vendor's self-reported 89% top-1** on RCAEval — NOFire AI, on its own guide and its own benchmark, with
   no per-case results, and the page itself says to rerun it on your own incidents.
2. **A private 50-case hybrid ensemble at 88.5%** — 15× smaller, not public, self-reported.
3. **PSC-GRCA** (`arXiv:2609.27069`, Buljić, University of Zenica) — **`Avg@5` 0.915** against 0.864 for a
   capacity-matched MLP and 0.862 for a no-neighbour control, with ablations locating the gain in the **prior**.
   A different metric (`Avg@5`), and its own benchmark audit is the source of the RE1 column-schema allegation
   this repository refutes in `docs/benchmark-corpus-completeness.md` §8. **Two qualifiers its abstract does not
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
   **Its baseline cohort is the framework's 15, not this engine** — so it is above us on *a* top-1 and comparable
   to *none* of ours. **And its headline margin is not on our benchmark family at all**: the survey of 2026-10-12
   reached the paper's own data description, which audits **RCAEval** (microservices) alongside **WADI / SWaT /
   HVAC** (cyber-physical systems) and states that retrieval is *"nearly solved"* in microservices while the
   *"retrieval ceiling"* in the CPS systems caps a magnitude-only retriever at **35–64%** — so the `+12 pp` it is
   most quoted for is a **CPS** margin, and its RCAEval contribution is the decomposition, not a gap over us. **Two things verified 2026-10-10 that sharpen it in opposite directions.** Its code is
   public (`github.com/cruiseresearchgroup/DecompRCA`), so the comparison is available to run. And an
   **independent review** of the paper records that the abstract's `+12`-point margins sit on **14 / 36 / 48
   scenarios with error bars from `n=3` run-to-run spread rather than scenario-level intervals** — WADI's +12 pp
   is about **1.7 scenarios** — so the headline margin is fragile where the *decomposition* is not.
   **And it supplies the instrument this repository then built**: `Retrieval@K` against `Rerank@1`, i.e. the
   decomposition of a top-1 miss into "the cause was never retrieved" and "it was retrieved and ranked too low".
   Its claim that microservice retrieval is *"nearly solved at 98–100%"* is now **reproduced on our corpus by our
   own census**: the truth is in the ranked pool on **99.73% / 99.63% / 100.00%** of RE1 / RE2 / RE3, and our
   loss is **98.8% reranking** (`docs/loss-decomposition.md` §4).
5. **`Rethinking Tool Design for Agentic RCA: A Controlled Empirical Study`** (`arXiv:2610.05009`, Yu Luo,
   Rongchen Gao, Zhenhui Zhou, Changchang Liu, Yuliang You, Yongqian Sun, Shenglin Zhang, Qiuai Fu, Shijie Wang,
   **Dan Pei**; submitted 2026-10-04; **Huawei + Tsinghua**) — **`top-1` localization 85.4%** for its `L0`
   no-predefined-tools reference and **82.8%** for its `L3` diagnostic-tool layer, over **375 failure cases from
   three microservice systems** with `Qwen3.7-Plus`, and a further four-model comparison on a shared subset.

   **Filed as a CANDIDATE ABOVE US WHOSE POPULATION IS NOT VERIFIED, and the distinction matters more here than
   anywhere else on this list.** Two things are true and only one of them is settled:

   - **The shape matches our RE1 exactly.** `375 = 3 × 125` is RE1's signature (RE2 is 270, RE3 is 90, FSE'26 is
     1430), and the metric is `top-1` rather than `Avg@5` — so if the cohort is RCAEval's RE1, this would be the
     **first reference to exceed our 80.27% on a population we can name**, by **5.1pp**.
   - **The abstract does not say so.** It names neither RCAEval nor a system, and the full text was not reachable
     in this pass. **A 5.1pp gap asserted on an unverified cohort is exactly the corpus-mismatch defect this
     document exists to prevent** — so the number is recorded and the population is marked unverified, not assumed
     to match.

   **And it is not reproducible from its own links.** An independent index records *"No code link found · No
   weights link found · No dataset link found"*, so this entry sits in the same class as the vendor's 89% for
   runnability, differing only in that it is peer-reviewable and gives a count.

   **What makes it worth naming anyway, beyond the number**: its central finding is that **higher-level diagnostic
   tools REDUCE localization accuracy** (L3 82.8% against L0 85.4%) while improving fault-type identification and
   halving the time. That is an **independent corroboration of this repository's own ledger pattern** — *every tool
   wired as a SCORE measures negative; every credited gain is STRUCTURAL* — arriving from a group with no
   connection to us, on the same benchmark family. **Two independent measurements of "more machinery, lower
   top-1" is the strongest evidence either has.** A third-party reading of the paper text (2026-10-11) adds that
   it **reports its numbers on NAMED benchmarks** while finding **no code, weights or dataset link** — so the
   population is *nameable from the body* even though the abstract omits it, and it is still **not reproducible
   from what the authors shipped.** No gap is quoted from it either way.

6. **E4** — *Agentic RCA for Internet-Scale Services Using Constrained Creativity* (**`arXiv:2610.08622`**,
   submitted 2026-10-09). An agentic troubleshooter that emits **loop-free data-flow programs in a restricted,
   high-level DSL** rather than free-form code, and reports **"up to 62% better accuracy compared to
   state-of-the-art solutions"** on *"a mix of synthetic and real-world workloads"*, with **up to 12× reduced
   cost**.

   **It is named and no gap is quoted, because the claim has no denominator.** "62% better" is a **relative**
   figure against an unnamed baseline on an unnamed mix of workloads — not a percentage of anything we can count,
   not a top-1, and not on a population we can name. Nameable for the same reason the fifth entry is: it is
   *above us by the authors' own claim* and it is silent about what it is above. **Its design point is the one
   worth borrowing**: restricting an agent to a **verifiable operator language instead of arbitrary code** is the
   same instinct as this repository's preference for an instrument that is a pure function, and it is the second
   independent arrival at *"more expressive machinery, lower accuracy"* on this list.

### 0b. BELOW US, AND COMPARABLE — the one reference that shares our metric AND our population

**`Beyond Conditional Independence: Root Cause Analysis with Deep Causal Models`** — Md Musfiqur Rahman, Kenneth
Lee, Ziwei Jiang, Padmaja Jonnalagedda, Ruocheng Guo, Murat Kocaoglu (Purdue); **arXiv:2609.36771**, submitted
2026-09-29; method **RCA-DCM**, code and case-level results at `github.com/Musfiqshohan/RCA-DCM`.

**Verified 2026-10-10, and this is the first reference for which the sentence "we are ahead" is a like-for-like
statement rather than a cross-paper one.** Three things had to line up, and they do:

1. **The metric.** It reports **top-1 accuracy** — not `Avg@5`, which is what every other above-us reference
   reports and the reason none of them could be compared to a service Top-1.
2. **The population.** Its README states *"Sock Shop and Online Boutique have the same five faults (CPU, memory,
   disk, delay, packet loss), each injected five times into five services: **125 cases per dataset**."* That is
   RCAEval's own RE1-OB and RE1-SS, verified against the benchmark's published table (`RE1-OB 125`, fault types
   `cpu, mem, disk, delay, loss`). Same systems, same faults, same 125 cases each — not a similar corpus, the
   same one.
3. **Its numbers are below ours on both.** Sock Shop **0.89** (its strongest baseline 0.75), Online Boutique
   **0.78** (strongest baseline 0.71). Against our **92.8%** and **80.0%** that is **+3.8 pp** and **+2.0 pp**,
   and it is the strongest second-place method that exists on those two cells.

**And its own README records an ablation that matters more than its number.** It states: *"A plain sink graph,
with the shared latent removed, picks the same top-1 service on all 125 cases of each dataset."* The paper's
central contribution is handling **unobserved confounders** through a deep causal model — and on the microservice
data, removing the shared latent and collapsing the graph to a sink changes **nothing**. That is the same
finding this repository's ledger records about its own terms (**a tool wired as a score measures negative; the
credit sits in the structure**), reported by the competitor about its own headline mechanism, and it is the
reason the entry is filed here rather than in §0a: the honest reading of both results is that on these two
systems the top-1 is largely decided by the anomaly's **marginal position**, not by the causal machinery either
side of us adds.

**What it is not.** It is still cross-paper: their harness, their pre-processing, their graph construction and
their per-case tables are theirs. But unlike §0a it is **checkable** — the code, the reproduction commands and the
`examples/results/` case tables are public, so this is a comparison that can be turned into a measurement rather
than left as a citation. Registered as the head of the reproducible-baseline item in `docs/closed-axes-register.md`.

---

### 0c. A NEW PUBLIC BENCHMARK — small, vendor-authored, and REPRODUCIBLE

**Project Arena**, released 2026-10-08 by **Edge Delta** (with an evaluation by GPT-6-Astra and a comparison
against Grafana's native AI): a Kubernetes deployment of the **OpenTelemetry Demo** with **21 injected fault
scenarios**, scored by a fixed rubric, with **the scenario scripts, the answer keys and the scoring code released
as open source** (`edgedelta/project-arena`).

**It is recorded here for three reasons and excluded from our numbers for two.** Recorded: it is **public and
reproducible**, which the vendor's own 89% is not; it is a **second** independently published instrument for this
problem, which matters because the repository's largest unexecuted comparison is *running someone else's harness*;
and its headline result — **11 of 12** shared scenarios localized correctly by the vendor against **9 of 12** by
the comparator — is **vendor-authored with the vendor competing**, which is exactly the population caveat §0a
applies to a *number*.

Excluded: **21 scenarios is not a population we can compare a 68-service Top-1 to** (our smallest cell is 90 and
the corpus is 735), and its unit is a **whole incident report scored by a model**, not a service ranked first. It
is a candidate instrument and not a candidate number, and it is named so that "the field has no public benchmark"
cannot be said of this repository's own standing.

### 0d. A CONCURRENT REFERENCE THAT IS NEITHER ABOVE NOR BELOW US — and the harness it reports

**OpsHarness**, *From General Agents to RCA Experts: A Self-Evolving Harness for Root Cause Analysis*
(**`arXiv:2608.25661`**, Huang et al.; surfaced 2026-08-26 on HF Daily Papers; found by this iteration's survey
on 2026-10-12). **59.0% top-1 accuracy**, reported as **+63.4%** over a bare general agent and **4.02×** over
baseline RCA agents, *"across two public benchmarks and an industrial deployment"*.

**It is filed here, and not in either list above, because it is the first reference this document cannot place on
EITHER side of our own number.** A 59.0% is **below** our 78.75%, so §0a's contract ("a number we cannot beat must
be named") does not reach it. But it is not §0b's kind either — §0b is *below us **and comparable***, which
requires a metric and a population, and this one names **three populations in one sentence** and **no
per-population figure**: two benchmarks it does not name and an industrial deployment nobody else can run. A
59.0% against our 78.75% would therefore be a cross-population comparison of exactly the kind §0a exists to
prevent — and the direction of the error is not even known, since one of the two unnamed benchmarks could be
RCAEval and its per-benchmark number could be above or below ours.

**So no gap is quoted in either direction, and the standing is unchanged.** What is recorded is the **technique**,
because it is the most directly borrowable thing on this list:

> *"During evolution, OpsHarness contrasts successful and failed trajectories, converts their evidence into atomic
> proposals, and admits updates only through a dual-gate verification process designed to prevent overfitting and
> regression."*

That is **the shape of this repository's own kill criterion** — a change is admitted only if it moves the target
AND regresses nothing (`RCAEval golden 9-cell byte-identical` **and** `FSE'26 zero regressed fault types`) —
arrived at independently, by a group with no connection to us, and reported as the mechanism that makes
accumulating experience *safe* rather than as a filter bolted on afterwards. Two independent arrivals at one gate
is the strongest evidence either has, exactly as §0a's fifth entry is for *"more machinery, lower top-1"*.

The paper's other claim is the one worth acting on: it finds that a **general-purpose agent now often beats a
purpose-built RCA agent**, so the remaining gap lives in the **harness** rather than the model. This repository's
`SelfLearn` feature is the same idea (accumulate case-specific experience across runs) and the register records
that it has never been wired; the borrowable part is not its loop but its **admission gate**, which the kill
criterion already is.

### 0e. THE SURVEY'S OWN CATCH — one new reference, and the two sentences this section used to repeat

**A "new" reference that is already on the list is an inventory failure, not a discovery.** The 2026-10-12 survey
reached the paper in §0a entry 4 — the NeurIPS 2026 Evaluations & Datasets decomposition — a **second time**, from a
press summary that carries neither its **arXiv identifier**, nor its authors (**Luan Pham** among them, the author
of RCAEval *and* of PRISM), nor the fact that its code is public at `github.com/cruiseresearchgroup/DecompRCA`. All
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
path** in only **61.5%** — the failure they name *"ungrounded diagnosis"*.

**That is this repository's loss decomposition, measured by another instrument on another population.** Our census
reads **96.6% of the deep misses as having had local evidence** — ORDERING ALONE, with the truth inside the ranked
pool on **99.73 / 99.63 / 100.00%** of the three suites — and `PAVE`'s 76.0% against 61.5% is that same gap stated
as *"found the service, did not place it"*. **No gap is quoted from it**: its metric is exact-set recovery over a
step-wise annotation, its population is 500 instances of a corpus that is not ours, and its 20.7% is **below** our
78.75% in any case. It is named for what it corroborates, and for a second reason — it is the **third independent
arrival this month** at *"the failure is in placing the cause, not in finding it"*, alongside §0a entry 4's
decomposition and our own census. Three arrivals from three groups, with three instruments, is the strongest form
this claim has had.

**The one mechanism worth carrying forward is not the pipeline but the INPUT**, and it is §0a entry 4's own: a
**short system-description document** moves that reranker by **7–18 points with the candidate set held FIXED**, so
the gain is in the CONTEXT the ranker reads rather than in the retrieval. This repository's reranker reads the raw
signals and has **no system-description channel at all**, which makes that a cheap, falsifiable candidate rather
than a slogan.

**What this does not change.** §0a's six entries, §0b's one comparable reference and §0d's third class are
unchanged; no cell moved; and the two corrections above are corrections of THIS document's earlier revision rather
than of the record they cite — §0a entry 4 and entry 3 both already carried the facts, which is the point of
recording it here.

### 0f. Two 2026 references ON our benchmark family that the 2026-10-12 second survey added

Both were checked against §0a before being recorded here, and **neither appears anywhere in either repository** —
which is the rule §0e's correction cost: grep the file for a reference BEFORE recording a survey's find as new.

**1. `TA-RCD` — a topology-guided metric-selection method evaluated on the PUBLIC RCAEval benchmark.** D. R.
Mathews, M. Verma, P. Aggarwal, J. Lakshmi (v1 2025-09-05, **v2 2026-10-09**): *Efficient Fault Localization in a
Cloud Stack Using End-to-End Application Service Topology.* On RCAEval it claims **metric-level `AC@5` +18% and
`Avg@5` +19%** over the strongest baseline, and in a controlled testbed `AC@5` at least 2× and `AC@3` at least 4×
over standard RCD.

- **It reports no Top-1.** Its metrics are `AC@5` / `AC@3` / `Avg@5` — the framework's own convention rather than
  ours — so **no gap over us can be read from it**, and it is the *second* reference on this list whose headline is
  a Top-5 convention (§0a entry 3 is the first). A Top-5 metric cannot see a reranking defect at all, and this
  repository's loss is **98.8% reranking**, which is why its gains concentrate at `K ≥ 3` and ours cannot.
- **Its mechanism is the nearest published relative of the register's open discriminator**: a per-case signal
  SELECTION chosen from topology rather than from the ranking's own values. That is a different class of feature
  from the one whose free read closed the latency channel's routing question
  (`latency-channel-views.md` §7.9), and it is the natural place to look next.

**2. `EviRCA` — the two-stage architecture, on OpenRCA, with a large margin.** *arXiv:2609.19825*, *Decoupling
Evidence Extraction from Reasoning for Microservice Root-Cause Analysis*: on **OpenRCA** (Bank 136 / Telecom 51 /
Market 148 = **335 cases**) it reports **Correct 43.9% / Partial 56.2%** with `deepseek-v4-pro` (40.6 / 54.4 with
`qwen3.7-plus`) against **RCA-Agent 13.1 / 20.8** and **Oracle Sampling 14.6 / 22.1**.

- **A different benchmark, a different metric and a different population**, so it is not a gap over us either — but
  it is a **fourth independent arrival at this repository's architecture** (*stage one puts the evidence on the
  table, stage two discriminates among distractors* is our retriever plus reranker; *evidence extraction versus
  reasoning* is our retrieval-versus-reranking split), and it names **GALA** and its `SURE-Score`, which §0a already
  carries — so the two are one lineage rather than two references.
- **Its stage-two failure mode is the one §7.9 of the latency document has just measured on ourselves**: it reports
  the correct cause being demoted below *collateral* signals — an elevated co-located neighbour, an earlier
  transient, a downstream rule — which is the same victim-versus-source pattern our loss census attributes.

**Neither moves a cell, a rank or a standing**, and §0a's six entries are unchanged. The entry that does bear on us
is methodological and comes from outside this family: a 2026-08 preprint, *There Is No Neutral Harness: Modern LLM
Leaderboards Are Manufactured by Config-Fragile Items*, measured that **the same weights on the same 3 679 items
score 31% and 89% under two equally defensible evaluation configurations, with 85% of a model's correct answers
flippable by another one**. That is the general form of the rule this repository already enforces on itself — **an
artifact must carry the configuration that produced it** — and it is why a cell whose corpus is inferred counts as a
cell measured under an unnamed rule.

### 0g. A THIRD PUBLIC BENCHMARK — and the one whose unit is not a ranked service list

**Alibaba Cloud's `RCA Benchmark`**, released open source as *"the industry's first open source root cause analysis
benchmark system for Agentic Ops"*: an e-commerce microservice architecture on Kubernetes with **40+ business
services and call chains up to 7 layers deep**, real-simulation rather than synthetic, exposing **seven categories
of observation data** (metrics, logs, traces, alerts, resource topology, Kubernetes events, profiling).

**It is recorded for one reason above the others: it is a POPULATION rather than a demonstration.** **200+
compliance samples** over **40+ failure types in 6 categories**, injected through four channels, gated by a
four-layer admission check, classified into four difficulty levels (L1–L4, with L2–L3 the stated focus), and
reserved non-public samples held back to prevent contamination. §0c's Project Arena has 21 scenarios and its own
author calls it a rubric over one incident report; this one has a corpus. So *"the field has no public benchmark"*
is now unavailable in a second, stronger sense.

**And it cannot be placed on our leaderboard in either direction, because its unit is not our unit.** Its ground
truth is **four-layered** — failure type, normalized entity, causal propagation chain, key evidence edge zone — and
its score is a **weighted composite over root-cause identification, boundary demarcation and procedure at 40 / 30 /
30**, with *"nearly 70% of scores [resting] on deterministic quantization computation based on failure type
topology semantics distance and entity topology distance"*. That is a **different scoring FRAME**, not a different
metric of the same quantity: 78.75% Top-1 over a labelled service list and a composite over an
identification/boundary/procedure triple share no denominator, so no gap can be quoted and the direction of any
error is unknown. It joins §0d's OpsHarness in the file that exists for exactly this case.

**What is worth acting on is its `boundary demarcation` and `causal propagation chain` layers, and they are the
first external instrument that would reward the thing this repository measures but does not claim.** The `collision`
term, the trace-topology signal and the loss census's victim-versus-source attribution are all attempts to get the
*propagation boundary* right; a benchmark that scores it at 30% of the total is the first one where that work has a
published denominator. Recorded as a **candidate instrument** — reproducing it is a separate decision with its own
cost — and it also names the gap in OUR corpus: RCAEval's label is a **list of acceptable roots** with no
propagation chain and no evidence-edge zone, so no result published on RCAEval, ours included, can be scored on
either of those two layers.

**One reference was checked before this section was written and is a CONFIRMATION rather than a find.**
`arXiv:2609.27069` — Buljić's controlled audit of RCAEval, surfaced again by this iteration's survey — is already on
this repository's record in **§3** of this document, in `docs/benchmark-corpus-completeness.md`, in
`docs/loss-decomposition.md` §1, and as `scripts/audit_input_schema.py`, which was built from its second finding
(*"a non-uniform column schema that silently zeroes telemetry for 250 of 375 RE1 cases"*). The survey found it, the
grep found it first, and nothing was re-derived. **Standing unchanged.**

## 1. Our result (run `37872246084`; RE1 and RE3 unchanged, RE2 re-measured on its full 270 cases)

| suite | OnlineBoutique | SockShop | TrainTicket | suite avg |
|-------|----------------|----------|-------------|-----------|
| RE1 (metric) | 80.0% | 92.8% | 68.0% | **80.3%** |
| RE2 (multi-source) | **86.7%** | **92.2%** | **71.1%** | **83.3%** |
| RE3 (code-level) | 80.0% | 45.0% | 51.1% | **58.7%** |
| **overall (735 cases)** | | | | **78.75%** |

---

## 2. The complete leaderboard — RCAEval, service-level Top-1

Two cohorts must be reported separately, because they are measured on different case sets.

### 2a. Full-benchmark (all 9 subsets = 735 cases)

| method | Top-1 | paradigm | source |
|--------|-------|----------|--------|
| **Micro-Kinetic (ours)** | **78.8%** | deterministic causal fusion (graph + rank-normalized log/trace) | this repo |
| PRISM | 68% (Top-3 91%, Avg@5 87%); **78.91% reimplemented on this harness** | graph-free, internal/external property decomposition | arXiv:2601.21359 (Luan Pham, RCAEval author); our reimplementation in `prism-head-to-head.md` |
| BARO (best pre-LLM causal) | 19% (Top-3 74%, Avg@5 63%) | non-parametric causal discovery | arXiv:2601.21359 / 2412.17015 |

> Two traps avoided here: (i) BARO's often-quoted **0.69** is its *Train-Ticket RE2 Avg@5*, **not** its overall
> Top-1 (which is 19%); (ii) PRISM is the benchmark author's own graph-free method — it is the correct "academic
> SOTA" anchor, **not** the nofire.ai "GALA 42%" figure. A third trap is now visible: PRISM's `68%` and our
> `78.8%` are **not** the comparison to optimise against, because our own reimplementation of PRISM reaches
> **78.91%** on the same harness. The published numbers describe two different measurements; the reimplementation
> describes one.

### 2b. RE2-OB subset (90 cases) — where all LLM agents report

| method | AC@1 / R@1 | paradigm | source |
|--------|-----------|----------|--------|
| **Micro-Kinetic (ours)** | **86.7%** | deterministic | this repo |
| RCLAgent (Qwen-3.6-Plus) | 56.67% | LLM multi-agent recursion-of-thought | arXiv:2605.14866 |
| RCLAgent (Claude-3.5-Sonnet) | 52.31% | LLM multi-agent recursion-of-thought | arXiv:2605.14866 |
| GALA | 42.22% (45.59% R@1) | LLM agentic ReAct | arXiv:2508.12472 |
| mABC | 39.98% | LLM multi-agent | arXiv:2404.12135 |
| RCAgent | 25.32% | LLM ReAct + tools | arXiv:2310.16340 |
| OpenRCA | ~15% | LLM | ICLR'25 |

### 2c. Single-system / other slices (not directly comparable to 78.8%)

| method | result | slice | source |
|--------|--------|-------|--------|
| StableRCA | 77% Top-1 | SockShop | arXiv:2606.05636 |
| MARLIN | 61.1% PR@1 | OnlineBoutique | sota2.com, Mar 2026 |
| DynaCausal | avg AC@1 0.63 | mixed public benchmarks (not RCAEval-only) | arXiv:2510.22613 |

---

## 3. Corrected verdict

**Headline (defensible):** On RCAEval overall Top-1, Micro-Kinetic (**78.8%**) leads the published field — ahead of
the benchmark author's own PRISM (**68%**) by ~11 pp (**~1.16×**), and ahead of every LLM agent by 20–40 pp
(RCLAgent 56.67% RE2-OB, GALA 42%, mABC 40%). It is also **orders of magnitude cheaper and faster** than the LLM
cohort (deterministic, sub-second, zero API cost vs LLM agents at seconds-to-hours). Against the **same harness**,
however, we are level with PRISM rather than ahead — see gap 1.

**What was wrong (both my v1 and the nofire.ai table):** "1.84×" divided the then-current overall (77.4%) by 42
(GALA), ignoring PRISM (68%), StableRCA (77% SockShop), RCLAgent (56.67%) and DynaCausal (0.63). The correct
competitor is the benchmark author's own method, and the correct margin is **~11 pp**, not ~35 pp.

**The decisive new signal — PRISM's internal/external asymmetry.** PRISM's entire contribution is a clean,
graph-free principle that we have **not** tried and that is *not* among our 11 falsified directions:

> Root causes show anomalies in **both internal properties** (config/resource state: cpu, mem, disk) **and
> external properties** (interface: response latency, error rate, throughput); **affected components show
> anomalies only in external properties**, because faults propagate through observable interfaces, never through
> internal state.

This is a *different* dimension from everything we falsified (label semantics, drop/rise shape, topology
direction, collision, temporal, LLM class-name). It directly targets our RE3 "error-value" losses (SS 45% / TT
51.1%), where a fan-in crash source's **internal** drop (dev ≈0.30) is out-scored by a victim's **external**
near-zero rise (dev ≈1.5). See `docs/sota-roadmap-2026.md` P2.

**Why "not yet SOTA" is still the honest stance — and now for a different reason, because the gap it named has
become one case:**

1. **The head-to-head is run, and it is a tie — not a win.** `docs/prism-head-to-head.md`: PRISM's additive
   pooling **78.91%** vs ours **78.75%** on the identical 735 cases. So we do **not** lead the best method we can
   actually reproduce; we are level with it, and `≈1.16×` is a statement about *published* numbers only. This is
   the gap that matters, and it is open *in the sense that it has not been closed in our favour* — the previous
   version of this document read it as 1.5 pp, which was mostly a corpus mismatch (v3.2's revision note).
2. **A 0.16 pp gap is below the benchmark's own resolution.** Gap 5: RCAEval's 735 labels were produced by a
   single engineer with no inter-annotator agreement study. A one-case difference is not a measurable lead in
   either direction, so the honest target is not "beat 78.91%" but "exceed the label noise" — which requires a
   margin we do not yet have on any suite except RE2-SS.
3. **Cross-benchmark generalization unproven.** RCLAgent also reports AIOPS-2022 (65.15%) and Aug-TrainTicket
   (82.35%). We have loaders (`aiops2025-loader.ts`, `rca100-loader.ts`) but **no measured numbers** — note these
   are the *AgenticOpsEval* datasets (AIOps2025 400 cases + RCA100 103 cases), which are distinct from RCLAgent's
   "AIOPS 2022".
4. **The field is moving to harder benchmarks.** FSE'26 (arXiv:2510.04711): 11 SOTA models avg Top@1 0.21 / best
   0.37 on a fault-propagation-aware benchmark. ORCA-bench (arXiv:2607.28545): frontier LLM agents 25.3% Medium /
   10.0% Hard, 7–40% hallucinated root causes. Both are where "SOTA" is now actually decided, and we have not run.
5. **RE3 code-level is our weak flank** (SS 45%, TT 51.1%) — and, per PRISM's internal/external framing, likely
   the most fixable with the right new signal. It is also the suite where PRISM's conjunctive form beats us by
   25.6 pp (RE3-TT 76.7% vs 51.1%), which is the single largest per-cell deficit we have against any competitor.
6. **Validity threat to every number (ours included).** pith.science review: RCAEval's 735 root-cause labels were
   produced by a single 5-year engineer with no inter-annotator consistency check. A ceiling on the benchmark's
   own ground truth is a ceiling on *everyone's* headline number. **And no error rate for those labels is
   published**, so a **0.16 pp** difference cannot be attributed to either engine: gap 2's target is the right
   one, and no arithmetic here can substitute for it.
