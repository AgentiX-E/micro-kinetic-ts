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

---

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
