# Micro-Kinetic → Defensible SOTA: Roadmap & Validation Method (v2)

> Companion to `docs/sota-comparison.md` (v3). This defines the scientific path from
> "ranking leader on RCAEval" to "defensible SOTA", with a falsifiable validation
> method for every step. Every claim is benchmark-readback-gated (net-positive,
> zero-regression, else revert) — the same discipline applied to all prior work.

## 0. Strategic principle (updated with the 2026 non-LLM frontier)

The evidence now spans **three** cohorts, and it reverses the earlier "LLM agent is
the next step" assumption twice over:

- **LLM agents are the *weakest* cohort on RCAEval.** GALA (42.22%), mABC (39.98%),
  RCLAgent (56.67%) are all below our 82.4% on RE2-OB. ORCA-bench (arXiv:2607.28545)
  shows the *production-grade* gap is worse: frontier agents score 25.3% Medium /
  10.0% Hard and hallucinate 7–40% of root causes. LLM-agentic ranking is not the moat.
- **The *closest* competitor is graph-free and deterministic — PRISM** (arXiv:2601.21359,
  the RCAEval author Luan Pham's own method), at **68% Top-1** on the same 735 cases.
  Our margin over it is ~9 pp, not the ~35 pp the old "1.84×" implied. **PRISM is the
  correct SOTA anchor.**
- **PRISM's core signal — internal/external property decomposition — is precisely the
  one we have not tried**, and it directly addresses our RE3 "error-value" losses.

Therefore the SOTA play is, in order:

1. **Calibrate** (primary-source leaderboard + a real head-to-head vs PRISM).
2. **Generalize** (prove the engine, not the benchmark — FSE'26 hard benchmark,
   ORCA-bench, and the AgenticOpsEval datasets we already have loaders for).
3. **Close RE3** with near-zero-baseline suppression first, then PRISM's internal/external
   signal as a secondary refinement (both new, deterministic, untried).

---

## 1. P0 — Calibration: primary-source leaderboard + PRISM head-to-head

**Goal.** Kill the strawman for good and establish the *measured* margin.

**P0a — leaderboard harness.** `packages/kinetic/src/benchmarks/leaderboard/sota-leaderboard.ts`
emitting a table keyed by `(suite, system, fault-type)`, each cell tagged
`ours-measured` or `published:arxiv:ID`. Must reproduce golden baseline cells and
cite DOI/arXiv for every external cell.

**P0b — PRISM head-to-head (the decisive test).** PRISM is graph-free, 8 ms/diagnosis,
authored by the RCAEval maintainer (Luan Pham) — locate its code (likely in or linked
from `github.com/phamquiluan/RCAEval`), run it over our exact 735-case harness, and
report our 77.4% vs PRISM's measured 68% on a *single identical* case set.

**Exit criterion.** `sota-comparison.md` §2 fully sourced; headline is
"**77.4% vs PRISM 68% (~1.14×), measured on the same cases**" — no cross-paper
comparison, no "1.84×".

---

## 2. P1 — Generalization: run the frontier benchmarks

The single highest-value proof of SOTA is cross-benchmark survival. Four targets:

### P1a. FSE'26 fault-propagation benchmark (hard, decisive)

- **What.** Fang et al. (arXiv:2510.04711). 1,430 cases, 25 fault types / 6 categories,
  dynamic workload, SLI-validated. Zenodo `10.5281/zenodo.17105974`.
- **Why.** 11 SOTA models collapse to Top@1 avg 0.21 / best 0.37. Beating 0.37 here is
  a *stronger* SOTA claim than any RCAEval number.
- **Risk.** Multi-GB data; sandbox proxy only allows `api.github.com` → download via the
  Git Data API / artifact path already used for benchmark dispatch.

### P1b. AgenticOpsEval — AIOps2025 + RCA100 (loaders already present)

- **What.** `aiops2025-loader.ts` (AIOps2025, 400 cases, HipsterShop) and
  `rca100-loader.ts` (RCA100, 103 cases, 4-layer causal chain). These are the
  **AgenticOpsEval** datasets, validated by the 2025 CCF AIOps Challenge (561 teams)
  + Alibaba Tianchi (5,532 teams).
- **Why.** We already parse them — this is the **fastest** way to close the
  "cross-benchmark unproven" gap. Note the distinction: RCLAgent evaluated on
  **AIOPS 2022** (7 services, 44 pods, 65.15% R@1), which is *not* the same as
  AIOps2025; we should report against the closest published anchor per dataset.
- **Validation.** Our AC@1/MRR at service level vs the published anchor for each.

### P1c. TrainTicket (standalone)

- Confirm our TT numbers (RE1/RE2/RE3-TT) against RCLAgent's Augmented-TrainTicket
  (82.35% R@1, Qwen) *with the caveat that "Augmented" is their own augmentation*;
  run their augmented set only if obtainable.

### P1d. ORCA-bench (production-readiness, optional but high-signal)

- **What.** Cornell Tech / Traversal (arXiv:2607.28545). 1,079 tasks, Astronomy Shop
  (19 services, 13 languages), multi-cause scoring. Frontier LLM agents: 25.3% Medium /
  10.0% Hard, 40% hallucination.
- **Why.** It is the *strongest* published evidence that deterministic/classical beats
  LLM-agentic RCA. If our engine (or a thin deterministic wrapper) lands meaningfully
  above 25.3%/10.0% here, that is a headline production-readiness claim.
- **Caveat.** Its "accuracy" requires naming *every* plausible root cause (multi-cause),
  a different rubric from RCAEval single-cause Top-1 — report under ORCA-bench's own
  rubric, not ours.

### P1 validation method (uniform)

For each: load GT → run engine deterministically → compute AC@1/MRR (or the benchmark's
native rubric) → compare against the published anchor on the **same metric and case
set** → record a paired table. **No number is claimed without a matching published anchor.**

---

## 3. P2 — Close the RE3 gap with PRISM's internal/external signal

The absolute losses are RE3 code-level "error-value" cells (SS f4 = 0%, SS f1 = 60%,
TT f3 = 40%). Root cause (proven): crash-source `drop` dev is hard-capped at
`log10(2)≈0.30` while a symptom's near-zero `rise` dev is unbounded (~1.5) — a 5×
monotone gap no monotone transform crosses (`docs/re3-fault-ceiling.md`).

### The new signal (verified, not in the 11 falsified directions)

**PRISM's Component-Property Model** (arXiv:2601.21359, 68% Top-1, theoretical
guarantees):

> Root causes show anomalies in **both internal properties** (config/resource state:
> cpu, mem, disk) **and external properties** (interface: response latency, error rate,
> throughput). **Affected components show anomalies only in external properties**,
> because faults propagate through observable interfaces, never through internal state.

This is a *structural* internal/external dimension — distinct from everything we
falsified (label semantics, drop/rise shape, topology direction, collision, temporal,
LLM class-name). The empirical check below tempers the initial hypothesis: the naive
signal does **not** cleanly separate, so it is scoped to a secondary refinement.

### Empirical check against the SS RE3 dump (2026-09-08) — the naive signal does NOT hold

Before writing code we checked PRISM's "victim = external-only" against our 30-case SS
RE3 metric dump (`artifacts/dump-ss`). **The false positives that outrank the GT source
are internal/external *mixed*, not external-only.** In the worst cells the #1 false
positive is an **internal** near-zero-baseline metric:

| cell | #1 false positive | channel | head (baseline) |
|------|-------------------|---------|-----------------|
| carts_f4_1 (GT rank 10) | rabbitmq-exporter::cpu dev 1.519 | **internal** | 0.0001 |
| carts_f4_3 (GT rank 5)  | rabbitmq-exporter::cpu dev 1.360 | **internal** | 0.0001 |
| front-end_f3_1 (GT rank 2) | carts-db::diskio dev 1.316 | **internal** | 0.0 |
| orders_f4_2 (GT rank 4) | orders-db::diskio dev 0.740 | **internal** | ~0 |

So the *naive* "internal anomaly ⇒ root candidate" scoring would **boost** these
near-zero internal spikes, not demote them — the opposite of the intent. The real
driver is the drop/rise asymmetry (`docs/re3-fault-ceiling.md`): these metrics have a
**near-zero baseline** whose relative rise is unbounded (dev 1.3–1.5), while the crash
source's drop is hard-capped at 0.30.

**Refined plan.** The first lever is therefore *near-zero-baseline rise suppression*
(refining the idle guard, which currently leaks at 30–38% near-zero fraction), **not**
internal/external. Internal/external is kept only as a *secondary* refinement applied
**after** (and conditioned on) the near-zero guard — an internal metric whose baseline
is near-zero is noise first and must never be promoted as a root merely because it is
"internal".

### P2 implementation (TDD, opt-in, default-off)

1. **Classify each metric as internal vs external** (resource/state: cpu, mem, disk,
   gc, thread-count, config → internal; interface: latency, error-rate, request-count,
   throughput → external). This is a *dimension* classification, not a label-semantics
   suppression (falsified #1).
2. **Two-channel anomaly score** per service: `internalAnomaly` (max over internal
   metrics) and `externalAnomaly` (max over external metrics). A source candidate must
   clear a threshold on **both**; a service with external-only anomaly is demoted as a
   propagation victim.
3. **Fuse into the existing TreePruner ranking** as an opt-in prior (default off),
   alongside the 7 existing priors — never replacing the proven logWeight+traceWeight+rank
   path.

### P2 validation method (the gate)

1. **TDD first**: unit tests pin the current failures (SS f4, TT f3, SS f1) as red, then
   the internal/external score as green — no mock, real RCAEval cases, ≥95% coverage.
2. **Ablation**: `--feature` on/off across all 735 cases. Accepted only if **net-positive
   on RE3** AND **zero-regression on RE1/RE2**.
3. **Benchmark readback**: dispatch the standard workflow, read `AC@1` back, diff against
   golden `80709c2`. Net-negative → revert.
4. **Cross-check vs PRISM**: if our internal/external signal + our graph priors land above
   PRISM's 68% *and* above our own 77.4% baseline, we have a defensible new SOTA.

If the internal/external signal does not clear the gate, the honest conclusion stands:
RE3 error-value requires a multi-modal/semantic layer, and we reopen P3 as a *thin,
gated* LLM layer — not a blanket agentic rewrite.

---

## 4. P3 — Decision gate: multi-modal/LLM layer (only if P2 fails)

The commercial 89% (NOFire) and GALA+ add *semantic* reasoning on top of ranking. We
falsified one specific LLM lever (`classifyExceptionKind` — `docs/re3-log-ceiling.md`),
but that is **narrow**. ORCA-bench and GALA+/KylinRCA/KRCA all point to *multi-modal
evidence fusion* as the frontier — but ORCA-bench also shows raw LLM agents are not
production-ready (25.3%/10%, 40% hallucination).

**Gate criteria for even proposing P3:** (i) P2 falsified; (ii) a concrete, falsifiable
hypothesis of *what semantic evidence* discriminates RE3 error-value cases; (iii) a
cost/latency budget that does not regress RE1/RE2 or add ranking-path nondeterminism.

**Default stance: do not add an LLM to the ranking path unless P2 is exhausted** — the
published evidence says LLM ranking is *weaker*, not stronger, here.

---

## 5. Priority & risk table

| # | Item | Priority | Risk | Depends on |
|---|------|----------|------|------------|
| P0a | primary-source leaderboard harness | P0 | low | — |
| P0b | PRISM head-to-head reproduction | P0 | low (code locate) | P0a |
| P1b | AgenticOpsEval (RCA100 + AIOps2025) | P0 | low (loaders exist) | P0a |
| P1a | FSE'26 hard benchmark | P0 | med (data access) | P0a |
| P1c | TrainTicket standalone | P1 | low | P0a |
| P1d | ORCA-bench | P1 | med (rubric mismatch) | P0a |
| P2 | RE3 near-zero-baseline suppression → internal/external | P1 | med (may falsify) | P0b, P1 |
| P3 | gated multi-modal/LLM layer | P2 (only if P2 fails) | high | P2 falsified |

**Order of execution (recommended):** P0a → P0b (head-to-head vs PRISM) → P1b
(fastest generalization win, loaders ready) → P1a (decisive hard benchmark) → P1c/P1d →
P2 (internal/external) → P3 (gate). Rationale: P0b turns our ~1.14× claim from
cross-paper to *measured*; P1b/P1a lock in cross-benchmark survival; P2 is the only
path to the ~89% ceiling and is the most likely to falsify, so it runs last.

---

## 6. References (primary sources)

- RCAEval (WWW'25): Pham et al., arXiv:2412.17015.
- **PRISM (graph-free, 68%): Pham, "Graph-Free Root Cause Analysis", arXiv:2601.21359.**
- **StableRCA (77% SockShop): Lin et al., "Robust Graph-Agnostic Mechanism-Level RCA", arXiv:2606.05636.**
- GALA: Tian et al., arXiv:2508.12472. · GALA+ (ASE'26): arXiv:2608.08968.
- RCLAgent (PKU/Huawei): Zhang et al., arXiv:2605.14866.
- mABC: arXiv:2404.12135. · RCAgent: arXiv:2310.16340.
- DynaCausal (CUHK-SZ): Zhang et al., arXiv:2510.22613.
- **FaultInsight (KDD'24): pure-metric dynamic causal discovery** (TCN + perturbation +
  causal-strength PageRank).
- Hard benchmark (FSE'26): Fang et al., arXiv:2510.04711; Zenodo `10.5281/zenodo.17105974`.
- **ORCA-bench (Cornell Tech/Traversal): "How Ready Are Language Model Agents for Oncall?",
  arXiv:2607.28545.**
- OpenRCA (ICLR'25): Xu et al.
- AgenticOpsEval: AIOps2025 (400 cases) + RCA100 (103 cases) — loaders in-repo.
