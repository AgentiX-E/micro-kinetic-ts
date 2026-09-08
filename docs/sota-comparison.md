# Micro-Kinetic on RCAEval — SOTA Comparison

**Status:** measured on the golden baseline (`80709c2`, read back as bit-identical
in run `34176635640`). All figures are AC@1 (top-1 accuracy), the RCAEval
protocol.

## Our result

| suite | OnlineBoutique | SockShop | TrainTicket | suite avg |
|-------|----------------|----------|-------------|-----------|
| RE1 (metric) | 80.0% | 92.8% | 68.0% | **80.3%** |
| RE2 (multi-source) | 82.4% | 88.9% | 68.1% | **79.8%** |
| RE3 (code-level) | 80.0% | 45.0% | 51.1% | **58.7%** |
| **overall (735 cases)** | | | | **≈77.4%** |

Per-fault-type AC@1 (the columns behind the averages):

- **RE1** — OB cpu 92 / delay 88 / disk 84 / loss 44 / mem 92 · SS 100/100/100/68/96 · TT 80/72/48/48/92
- **RE2** — OB 88.9/66.7/100/55.6/100/83.3 · SS 100/66.7/100/100/100/66.7 · TT 77.8/55.6/66.7/33.3/75/100
- **RE3** — OB f3 83.3 / f4 50 / f5 100 / f1 33.3 / f2 100 · SS f1 60 / f3 20 / f4 0 / f2 100 · TT f1 57.1 / f2 57.1 / f3 40 / f4 50

## Comparison vs academic baselines

Third-party reproduction of the RCAEval baselines (nofire.ai AI-SRE benchmark,
peer-reviewed methods, overall top-1 across the 735 cases):

| method | overall Top-1 |
|--------|---------------|
| **Micro-Kinetic (ours)** | **≈77.4%** |
| GALA + BARO M2 (academic SOTA) | 42% |
| GALA + BARO M1 | 38% |
| DiagFusion | 35% |
| RCD | 33% |
| CloudRanger | 31% |
| MicroCause | 28% |
| CausalRCA | 27% |
| Nezha | 9% |
| NOFire (commercial, full multi-modal + LLM agentic) | 89% |

**Micro-Kinetic is ~1.84× the published academic state-of-the-art**, and
achieves this with a purely deterministic + embedding-aligned engine — no
LLM-API coupling in the ranking path (`@agentix-e/micro-kinetic-ai` supplies
embeddings only; the tree/kinetic/optimize classifiers use DeepSeek).

## Method contrast

| | Micro-Kinetic | GALA/BARO/DiagFusion | NOFire |
|---|---|---|---|
| ranking | deterministic causal fusion + semantic embedding | statistical causal discovery / Bayesian | LLM agentic (BARO) + production context graph |
| LLM in ranking | none | none | yes |
| signals | log + trace + rank-normalized anomaly (RE3), 7 opt-in causal priors | metric/trace/log graphs | full multi-modal |
| reproducibility | fully deterministic, bit-identical re-runs | method-dependent | closed |

## Remaining gap

The gap to a commercial multi-modal system is concentrated in the RE3
"error-value" (code-level) cells — SS f4 0%, SS f1 60%, TT f3 40%. Those are the
structural ceiling of pure data-driven, metric-agnostic ranking: the crash
source's drop deviation is hard-capped at `log10(2) ≈ 0.30` while a symptom's
near-zero-baseline rise is unbounded, and the fan-in crash source is directionally
mis-explained by its callers. See `docs/re3-fault-ceiling.md` and
`docs/silent-source-ceiling.md` for the full falsification record.
