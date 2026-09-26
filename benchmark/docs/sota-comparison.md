# Micro-Kinetic on RCAEval — Corrected SOTA Calibration (v3)

> **Revision history.**
> - v1 claimed "~1.84× academic SOTA" against a nofire.ai third-party table — **strawman, retracted**.
> - v2 calibrated against primary LLM-agent sources (RCLAgent 56.67%, GALA 42%) — correct but **incomplete**: it
>   missed the parallel *non-LLM* 2026 frontier.
> - **v3 (this)** adds the two methods that matter most: **PRISM** (arXiv:2601.21359, the RCAEval author's own
>   graph-free method, **68% Top-1**) and **StableRCA** (arXiv:2606.05636, **77% SockShop**), plus the ORCA-bench
>   production-readiness result. The honest margin is now **~1.14× vs the benchmark author's own SOTA**, not 1.84×.

**Metric.** All figures are service-level **AC@1 / Recall@1 / Top-1** (top-1 localization of the root-cause
*service/component*), the RCAEval protocol. Where a method reports a *different* metric or subset, that is stated
explicitly — cross-metric comparison is the single largest source of false "SOTA" claims in this field.

---

## 1. Our result (unchanged, bit-reproducible golden baseline `80709c2`)

| suite | OnlineBoutique | SockShop | TrainTicket | suite avg |
|-------|----------------|----------|-------------|-----------|
| RE1 (metric) | 80.0% | 92.8% | 68.0% | **80.3%** |
| RE2 (multi-source) | 82.4% | 88.9% | 68.1% | **79.8%** |
| RE3 (code-level) | 80.0% | 45.0% | 51.1% | **58.7%** |
| **overall (735 cases)** | | | | **≈77.4%** |

---

## 2. The complete leaderboard — RCAEval, service-level Top-1

Two cohorts must be reported separately, because they are measured on different case sets.

### 2a. Full-benchmark (all 9 subsets = 735 cases)

| method | Top-1 | paradigm | source |
|--------|-------|----------|--------|
| **Micro-Kinetic (ours)** | **77.4%** | deterministic causal fusion (graph + rank-normalized log/trace) | this repo |
| PRISM | 68% (Top-3 91%, Avg@5 87%) | graph-free, internal/external property decomposition | arXiv:2601.21359 (Luan Pham, RCAEval author) |
| BARO (best pre-LLM causal) | 19% (Top-3 74%, Avg@5 63%) | non-parametric causal discovery | arXiv:2601.21359 / 2412.17015 |

> Two traps avoided here: (i) BARO's often-quoted **0.69** is its *Train-Ticket RE2 Avg@5*, **not** its overall
> Top-1 (which is 19%); (ii) PRISM is the benchmark author's own graph-free method — it is the correct "academic
> SOTA" anchor, **not** the nofire.ai "GALA 42%" figure.

### 2b. RE2-OB subset (90 cases) — where all LLM agents report

| method | AC@1 / R@1 | paradigm | source |
|--------|-----------|----------|--------|
| **Micro-Kinetic (ours)** | **82.4%** | deterministic | this repo |
| RCLAgent (Qwen-3.6-Plus) | 56.67% | LLM multi-agent recursion-of-thought | arXiv:2605.14866 |
| RCLAgent (Claude-3.5-Sonnet) | 52.31% | LLM multi-agent recursion-of-thought | arXiv:2605.14866 |
| GALA | 42.22% (45.59% R@1) | LLM agentic ReAct | arXiv:2508.12472 |
| mABC | 39.98% | LLM multi-agent | arXiv:2404.12135 |
| RCAgent | 25.32% | LLM ReAct + tools | arXiv:2310.16340 |
| OpenRCA | ~15% | LLM | ICLR'25 |

### 2c. Single-system / other slices (not directly comparable to 77.4%)

| method | result | slice | source |
|--------|--------|-------|--------|
| StableRCA | 77% Top-1 | SockShop | arXiv:2606.05636 |
| MARLIN | 61.1% PR@1 | OnlineBoutique | sota2.com, Mar 2026 |
| DynaCausal | avg AC@1 0.63 | mixed public benchmarks (not RCAEval-only) | arXiv:2510.22613 |

---

## 3. Corrected verdict

**Headline (defensible):** On RCAEval overall Top-1, Micro-Kinetic (**77.4%**) leads the published field — ahead of
the benchmark author's own PRISM (**68%**) by ~9 pp (**~1.14×**), and ahead of every LLM agent by 20–40 pp
(RCLAgent 56.67% RE2-OB, GALA 42%, mABC 40%). It is also **orders of magnitude cheaper and faster** than the LLM
cohort (deterministic, sub-second, zero API cost vs LLM agents at seconds-to-hours).

**What was wrong (both my v1 and the nofire.ai table):** "1.84×" divided 77.4 by 42 (GALA), ignoring PRISM (68%),
StableRCA (77% SockShop), RCLAgent (56.67%) and DynaCausal (0.63). The correct competitor is the benchmark
author's own method, and the correct margin is **~9 pp**, not ~35 pp.

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

**Why "not yet SOTA" is still the honest stance (unchanged gaps):**

1. **No head-to-head.** Cross-paper comparison — even to PRISM's 68% — is weaker than a controlled re-run. We have
   the 735 cases; PRISM is 8 ms/diagnosis and (likely) reproducible. Running it is the decisive test.
2. **Cross-benchmark generalization unproven.** RCLAgent also reports AIOPS-2022 (65.15%) and Aug-TrainTicket
   (82.35%). We have loaders (`aiops2025-loader.ts`, `rca100-loader.ts`) but **no measured numbers** — note these
   are the *AgenticOpsEval* datasets (AIOps2025 400 cases + RCA100 103 cases), which are distinct from RCLAgent's
   "AIOPS 2022".
3. **The field is moving to harder benchmarks.** FSE'26 (arXiv:2510.04711): 11 SOTA models avg Top@1 0.21 / best
   0.37 on a fault-propagation-aware benchmark. ORCA-bench (arXiv:2607.28545): frontier LLM agents 25.3% Medium /
   10.0% Hard, 7–40% hallucinated root causes. Both are where "SOTA" is now actually decided, and we have not run.
4. **RE3 code-level is our weak flank** (SS 45%, TT 51.1%) — and, per PRISM's internal/external framing, likely
   the most fixable with the right new signal.
5. **Validity threat to every number (ours included).** pith.science review: RCAEval's 735 root-cause labels were
   produced by a single 5-year engineer with no inter-annotator consistency check. A ceiling on the benchmark's
   own ground truth is a ceiling on *everyone's* headline number.
