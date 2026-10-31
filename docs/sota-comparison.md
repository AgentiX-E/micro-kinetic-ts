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

| evaluation                              | metric        | ours                  | best published competitor                                                | margin                                                                                                                                                                                                                                                                                                         | basis                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------- | --------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RCAEval, all 735 cases**              | service Top-1 | **85.85%** (631/735)  | PRISM **68%** (arXiv:2601.21359 — the benchmark author's own method)     | **+17.85 pp, ≈1.26×**                                                                                                                                                                                                                                                                                          | cross-paper (§2a)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **RCAEval, all 735 cases**              | service Top-1 | **85.85%**            | PRISM **78.91%** — _our own reimplementation, identical harness_         | **+6.94 pp** — **and this is NOT a head-to-head any more**: the PRISM figure was measured at the pre-iteration-127 configuration and has not been re-run under the demand guard, which the reimplementation would inherit. The last true head-to-head is §3's `78.75 against 78.91` (−0.16 pp = 1 case of 735) | controlled, but **stale by one default**; a re-run is owed (§3)                                                                                                                                                                                                                                                                                                                                                                             |
| **RCAEval RE2-OB (90 cases)**           | AC@1          | **88.9%** (80/90)     | RCLAgent **56.67%** (arXiv:2605.14866)                                   | **+32.2 pp**                                                                                                                                                                                                                                                                                                   | cross-paper (§2b). `86.7` was the figure before iteration 129 moved the corpus view; the 2.3 pp it cost is the price of the cell below                                                                                                                                                                                                                                                                                                      |
| **RCAEval RE2-TT (90 cases)**           | AC@1          | **83.3%** (75/90)     | GALA+ **73.3%**                                                          | **+10.0 pp**                                                                                                                                                                                                                                                                                                   | cross-paper, **the same 90-case TrainTicket population** — and the **first time this cell has been ahead**: 71.1 before iteration 129, moved by the corpus view (`40128592846`)                                                                                                                                                                                                                                                             |
| **FSE'26 RCABench**                     | Top@1         | **56.12%** (798/1422) | field avg **21%**, best **37%** (arXiv:2510.04711)                       | **+19.1 pp over the best**                                                                                                                                                                                                                                                                                     | cross-paper, and the benchmark is a _different_ fault set — see the caveat below                                                                                                                                                                                                                                                                                                                                                            |
| **RCAEval RE1-SS / RE1-OB (125 + 125)** | service Top-1 | **92.8% / 85.6%**     | RCA-DCM **0.89 / 0.78** (arXiv:2609.36771)                               | **+3.8 / +7.6 pp**                                                                                                                                                                                                                                                                                             | cross-paper, but **the same 125-case populations and the same metric** — a like-for-like comparison, and it is BELOW us (§0b)                                                                                                                                                                                                                                                                                                               |
| **RCAEval RE1 (375 cases)**             | service Top-1 | **87.20%** (327/375)  | `arXiv:2610.05009` **85.4% (`L0`) / 82.8% (`L3`)**                       | **+1.80 / +4.40 pp**                                                                                                                                                                                                                                                                                           | cross-paper, **the same 375-case population and the same metric, resolved 2026-10-14** (§0a entry 5). Re-anchored 2026-10-29 on run `40792623427` at `ea47db5`: the cell has been 327 since iteration 127 and the row's `313` was one run stale. **But the OVERALL figure was hiding a per-system deficit** — the same paper's Table 5 reports `AC@1` per system and we are BEHIND on OnlineBoutique; the row beneath this one is that cell |
| **RCAEval RE1-OB (125 cases)**          | service Top-1 | **85.6%** (107/125)   | `arXiv:2610.05009` **88.0%** (`L2+L3` / `L1+L2+L3`) and **86.4%** (`L0`) | **−2.4 / −0.8 pp — THE ONE CELL WHERE A PUBLISHED REFERENCE IS ABOVE US ON OUR OWN POPULATION**                                                                                                                                                                                                                | cross-paper, the same 125 cases; read 2026-10-29 from that paper's per-system Table 5 (§0a entry 5). Three cases of 125. Named rather than averaged away: every earlier reading of this reference compared OVERALL figures, where we lead by 1.80 pp                                                                                                                                                                                        |

**Ranking: first on RCAEval's 735 overall, first on FSE'26, first on RE2-OnlineBoutique, first on RE2-TrainTicket,
first on RE1 overall and first on RE1-SockShop and RE1-TrainTicket — and SECOND on one cell, RE1-OnlineBoutique,
where `arXiv:2610.05009`'s per-system Table 5 is above us by 2.4 pp (88.0 against 85.6, three cases of 125).**

That last clause is the correction of 2026-10-29 and it is worth stating how it was missed. Every previous reading of
that reference compared **overall** figures: its `L0` 85.4 against our RE1, which has been **327/375 = 87.20%** since
iteration 127 and which this document had left anchored at a stale 313 of 375 = 83.47% from run `40098640380`. An
overall lead of 1.80 pp is therefore real — and it **concealed a per-system deficit the paper itself publishes**:
its `AC@1` is 86.4/90.9/78.9 at `L0` and 88.0/90.9/79.2 at its best per-system configurations, against our
85.6/92.8/83.2. We are ahead on SockShop by 1.9 pp and on TrainTicket by 4.0 pp, and **behind on OnlineBoutique by
0.8 pp at `L0` and 2.4 pp at its best**. A total can hide a cell; the per-system table cannot, and the lesson is now
a rule for this document: **a cross-paper comparison is only as fine as the finest table the reference publishes, and
reading the coarser one is a choice that flatters.**

The project leads the pre-LLM causal cohort by a wide margin on RCAEval overall (BARO 19%, with its often-quoted
0.69 being a Train-Ticket RE2 Avg@5 rather than an overall Top-1) and the LLM-agent cohort by 20–40 pp. **On our
own harness the last true head-to-head remains `78.75 against 78.91` — one case behind PRISM's additive pooling —
and it is now STALE**: the demand guard of iteration 127 changed our engine and would have changed the
reimplementation too, so the current 85.85 is not a re-measurement of that pair and no margin is claimed from it.
A re-run of §3 is the only thing that can restore the sentence, and it is owed.

**What this ranking is NOT.** Every `68%` figure above is **cross-paper**: its dataset, its harness, its case
sets, its metric implementation. The controlled re-run exists (`docs/prism-head-to-head.md`, run `34246577708`)
and it is decisive — in a direction the published-numbers table cannot show: on the identical 735 cases PRISM's
additive pooling scores **78.91%** against our **78.75%**. So the standing is a **tie on the harness that
matters** and a lead of ≈1.16× on the published number, and the `+10.8 pp` row must never be quoted without the
row beneath it.

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

   Three consequences. (i) **RE1-OnlineBoutique is the one cell where a published reference is above us on a
   population we can name**, and it has been invisible because every prior reading of this reference compared the
   OVERALL figure — its `L0` 85.4 against our RE1, where we lead by 1.80 pp. A total can hide a cell. (ii) The
   overall lead survives the strongest per-system reading available: the paper's per-system oracle
   `(88.0 + 90.9 + 79.2)/3 = 86.03%` is still 1.17 pp below our 87.20 — but a per-system best across DIFFERENT
   configurations is not a run, so the honest comparison is `L0` against ours, system by system. (iii) The margin
   is **three cases of 125**, which makes it the smallest gap on this list and the natural next target: the
   campaign's own loss decomposition says 97.9% of the misses are RERANKING, so the question is which of those three
   cases a term can reach rather than whether the evidence is missing.

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
   - **And it is above us on that cell.** `73.33% (66/90)` against our published `71.1% (64/90)` is **−2.2 pp**,
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

This does not lower our published 85.85% and does not raise a competitor's: it states the floor each number was
measured above. The two RE3 cells with the largest headline gap to the leaders (SockShop, TrainTicket) are exactly
the two whose floors are highest, and that coincidence is the reason this section exists.

**Read against the floor, the three RE3 cells now stand at +33.3 (OnlineBoutique 83.3 over 50.0), +20.0 (SockShop
60.0 over 40.0) and +20.0 (TrainTicket 70.0 over 50.0)** — the last of which is iteration 153's three cases. The
remaining RE3 deficit is concentrated where the floor is highest, which is a statement about what that cell can
prove rather than about how far behind the engine is.

## 1. Our result — re-anchored 2026-10-29 on run `40811610741` at `1e3868c9` (RE1 and RE2 identical to `3d054ad`; RE3 moved by the trace floor, `docs/trace-share.md` §3a)

| suite                         | OnlineBoutique | SockShop       | TrainTicket    | suite avg           |
| ----------------------------- | -------------- | -------------- | -------------- | ------------------- |
| RE1 (metric, 125/system)      | 85.6% (107)    | 92.8% (116)    | 83.2% (104)    | **87.2%** (327/375) |
| RE2 (multi-source, 90/system) | **88.9%** (80) | **94.4%** (85) | **83.3%** (75) | **88.9%** (240/270) |
| RE3 (code-level, 30/system)   | **83.3%** (25) | 60.0% (18)     | **70.0%** (21) | **71.1%** (64/90)   |
| **overall (735 cases)**       |                |                |                | **85.85%** (631)    |

**Eight of the nine cells are byte-identical to the previous anchor; RE3 is not, and the difference is a ranking
change rather than a measurement drift.** Iteration 153 gave the trace vote a fourth threshold — the candidate must
out-rise the fleet's median move by `minFleetShare = 2` — which withdraws the five route-fault votes on a flat fleet
and the one OnlineBoutique vote on a flat fleet, and the loss census had already resolved what that buys: three
cases, on two TrainTicket routemates at rank 2 of 68 and one OnlineBoutique case at rank 2 of 9, whose winner's unit
was larger than the gap it won by. RE3 therefore moves `61 → 64` of 90 (`67.8% → 71.1%`), RE3-TrainTicket
`63.3 → 70.0` and RE3-OnlineBoutique `80.0 → 83.3`, and the corpus `85.44% → 85.85%`. RE1 and RE2 cannot move, by
two independent arguments: the term's weight is 0 on both and neither corpus supplies a span count at all.

The earlier `80.0 / 92.8 / 68.0` RE1 row was **one anchor behind** — the cell moved to `107 / 116 / 104` on
`40098640380` (iteration 127's enrolment) and this document's §1 was not re-anchored with it, which is the same
staleness that let the RE1-OnlineBoutique deficit stay hidden (§0). That correction stands; this one is a change in
the engine, not a bookkeeping repair.

---

## 2. The complete leaderboard — RCAEval, service-level Top-1

Two cohorts must be reported separately, because they are measured on different case sets.

### 2a. Full-benchmark (all 9 subsets = 735 cases)

| method                     | Top-1                                                                | paradigm                                                        | source                                                                                        |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Micro-Kinetic (ours)**   | **85.85%** (631/735)                                                 | deterministic causal fusion (graph + rank-normalized log/trace) | this repo                                                                                     |
| PRISM                      | 68% (Top-3 91%, Avg@5 87%); **78.91% reimplemented on this harness** | graph-free, internal/external property decomposition            | arXiv:2601.21359 (Luan Pham, RCAEval author); our reimplementation in `prism-head-to-head.md` |
| BARO (best pre-LLM causal) | 19% (Top-3 74%, Avg@5 63%)                                           | non-parametric causal discovery                                 | arXiv:2601.21359 / 2412.17015                                                                 |

> Two traps avoided here: (i) BARO's often-quoted **0.69** is its _Train-Ticket RE2 Avg@5_, **not** its overall
> Top-1 (which is 19%); (ii) PRISM is the benchmark author's own graph-free method — it is the correct "academic
> SOTA" anchor, **not** the nofire.ai "GALA 42%" figure. A third trap is now visible: PRISM's `68%` and our
> `85.85%` are **not** the comparison to optimise against, because our own reimplementation of PRISM reaches
> **78.91%** on the same harness. The published numbers describe two different measurements; the reimplementation
> describes one.

### 2b. RE2-OB subset (90 cases) — where all LLM agents report

| method                       | AC@1 / R@1                                                      | paradigm                             | source           |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------ | ---------------- |
| **Micro-Kinetic (ours)**     | **86.7%**                                                       | deterministic                        | this repo        |
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

| population                     | GALA+ AC@1 | GALA+ AC@3 | ours (published) |           Δ | ours (it.95 candidate) |         Δ |
| ------------------------------ | ---------: | ---------: | ---------------: | ----------: | ---------------------: | --------: |
| OnlineBoutique RE2 (90 cases)  |     74.44% |     98.89% |        **86.7%** | **+12.2pp** |                  86.7% |   +12.2pp |
| **TrainTicket RE2 (90 cases)** | **73.33%** |     85.56% |            71.1% |  **−2.2pp** |              **73.3%** | **0.0pp** |

**The population is 90 cases on both systems, and that is read off GALA+'s own AC@3 rather than assumed**:
`98.89% = 89/90` and `85.56% = 77/90`. RCAEval's RE2 is 90 cases per system (6 fault types × 15), which is the
same population size and the same suite name.

**Three consequences, and the second is the one to act on.**

1. **On RE2-OnlineBoutique we still lead, and by less than before.** GALA+ at 74.44% displaces RCLAgent
   (56.67%) as the strongest published external number on that slice — and it also sits above VerifyRCA's 72%,
   which `§0c` had recorded as the only comparable reference. Our lead there goes from being measured against
   56.67% to being measured against 74.44%: **+12.2pp, not +30.0pp.** The old table's `GALA 42.22%` row is the
   PRIOR paper's number and must not be quoted as this method's.
2. **On RE2-TrainTicket we were BEHIND, and this is the first published competitor number on any TrainTicket
   cell in this document.** §2b is titled _"where all LLM agents report"_ and carries only OnlineBoutique; the
   implicit reading was that no competitor reports TrainTicket. That reading was wrong. GALA+ reports **73.33%
   (66/90)** against our published **71.1% (64/90)** — a **two-case deficit**, and the deficit is on the one
   system where our own register says the ranking signal is starved of trace and log evidence.
3. **And the iteration-95 candidate closes it exactly.** `suppress_idle_transients=1` takes RE2-TrainTicket to
   **73.3% (66/90)** — `66/90 = 73.333%` against GALA+'s `73.33%`, i.e. **level**, and not by rounding: the same
   `66 of 90`. The same dispatch costs one regressed fault type there (`disk 73.3% → 53.3%`) while gaining
   `cpu +20.0`, `mem +6.7`, `socket +6.7`, so it is a routing candidate rather than a default — but the fact
   that a gated candidate is worth exactly the margin to a published ASE'26 method makes the routing question
   the one that now decides a standing, not a preference.

**What is NOT claimed, and the repository's own standard is why.** This is a **paper-versus-paper** comparison,
not a head-to-head: the head-to-head in `§0a` is `78.91 vs 78.75` over the _identical 735 cases_, and nothing
here establishes that GALA+'s 90 TrainTicket cases are the same 90 as ours. Two things must happen before the
`−2.2pp` is treated as a measured deficit rather than a named risk: **confirm the case set from the paper's own
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

### 2c. Single-system / other slices (not directly comparable to 85.85%)

| method     | result        | slice                                                                                                                                                               | source              |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| StableRCA  | 77% Top-1     | **Sock-Shop `[soc, 2022]` — a corpus its own text lists SEPARATELY from RCAEval**, and not RE1-SS; no case count is stated, so no gap can be read against our 92.8% | arXiv:2606.05636    |
| MARLIN     | 61.1% PR@1    | OnlineBoutique                                                                                                                                                      | sota2.com, Mar 2026 |
| DynaCausal | avg AC@1 0.63 | mixed public benchmarks (not RCAEval-only)                                                                                                                          | arXiv:2510.22613    |

---

## 3. Corrected verdict

**Headline (defensible):** On RCAEval overall Top-1, Micro-Kinetic (**85.85%**) leads the published field — ahead of
the benchmark author's own PRISM (**68%**) by ~17 pp (**~1.26×**), and ahead of every LLM agent by 20–40 pp
(RCLAgent 56.67% RE2-OB, GALA 42% — and `mABC`'s `40%`, which is **another group's re-measurement on AIOPS-2022 rather than that paper's own figure**, since its metric is RA/PA with a four-root-cause cap; see §2b and `docs/sota-populations.md`). It is also **orders of magnitude cheaper and faster** than the LLM
cohort (deterministic, sub-second, zero API cost vs LLM agents at seconds-to-hours). Against the **same harness**,
however, we are level with PRISM rather than ahead — see gap 1.

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

1. **The head-to-head is run, and it is a tie — not a win.** `docs/prism-head-to-head.md`: PRISM's additive
   pooling **78.91%** vs ours **78.75%** on the identical 735 cases. So we do **not** lead the best method we can
   actually reproduce; we are level with it, and `≈1.16×` is a statement about _published_ numbers only. This is
   the gap that matters, and it is open _in the sense that it has not been closed in our favour_ — the previous
   version of this document read it as 1.5 pp, which was mostly a corpus mismatch (v3.2's revision note).
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
RE3:OnlineBoutique is 88.9% per type and 83.3% per case, RE3:SockShop 63.6% and 60.0%, RE3:TrainTicket 74.5% and
73.3%. On the other six cells the two figures coincide.

| cell                                              | AC@1 (per type) | Avg@5 (per type) | cases                           |
| ------------------------------------------------- | --------------- | ---------------- | ------------------------------- |
| RE1:OnlineBoutique                                | 85.6%           | 93.9%            | 107/125                         |
| RE1:SockShop                                      | 93.6%           | 95.5%            | 117/125                         |
| RE1:TrainTicket                                   | 84.8%           | 93.3%            | 106/125                         |
| RE2:OnlineBoutique                                | 92.2%           | 94.4%            | 83/90                           |
| RE2:SockShop                                      | 97.8%           | 97.8%            | 88/90                           |
| RE2:TrainTicket                                   | 83.3%           | 85.8%            | 75/90                           |
| RE3:OnlineBoutique                                | 88.9%           | 91.1%            | 25/30                           |
| RE3:SockShop                                      | 63.6%           | 87.4%            | 18/30                           |
| RE3:TrainTicket                                   | 74.5%           | 81.2%            | 22/30                           |
| **RE1 (three systems, unweighted mean)**          | 88.0%           | **94.2%**        | 330/375                         |
| **nine cells (unweighted mean of the nine rows)** | **84.9%**       | **91.2%**        | **641/735 = 87.21% case-level** |

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
