# PRISM Head-to-Head Readback (P0b)

**Status:** complete, and **revised**. PRISM reimplemented and read back on the same 735-case RCAEval harness our
engine evaluates. PRISM's additive pooling scores **78.9%** Overall Top-1. Our column in §2 was the *published*
cells, which ranked **615** of those 735 cases — RE2's invocation passed `--max-cases 50` — so that table compared
**735 against 615**. §2.1 restates it on the corpus both sides actually ranked, where the gap is **0.16 pp, one
case of 735**. The complementarity finding survives the correction with narrower RE2 margins.

## 1. What was reproduced

PRISM (arXiv:2601.21359, Luan Pham — the RCAEval benchmark author himself) is a
graph-free RCA method. Its single signal is the **internal-vs-external attribute
asymmetry**: the root cause's *internal* attributes (cpu/mem/disk/socket) and
*external* attributes (latency/error/throughput/workload) are both anomalous,
whereas a victim component only shows external anomalies.

Algorithm (faithful reimplementation in
`packages/kinetic/src/benchmarks/leaderboard/prism.ts`):

1. Classify each metric channel as `internal` (cpu/mem/memory/disk/socket) or
   `external` (everything else).
2. Deviation z-score `S(P) = |mean_fault − mean_baseline| / scale`, where
   `scale` degrades `std → |mean| → 1` when the baseline is flat.
3. Max-pool per service: `S^I = max(internal)`, `S^E = max(external)`.
4. Combine (additive, default) `M = S^I + S^E − log1p(S^I + S^E)`, or
   (conjunctive) `M = min(S^I, S^E)`.
5. Sort descending; top-1 = root cause (service level).

The runner (`scripts/run-prism.ts`) evaluates the identical 735 cases the
engine benchmark evaluates (BFS over the RCAEval-json cache, same
`metrics.json` grouping, same `groundTruth.serviceId` AC@1 protocol).

## 2. Readback results (run `34246577708`)

| cell | PRISM additive | PRISM conjunctive | engine (golden, over its 615 ranked cases) |
| --- | ---: | ---: | ---: |
| RE1 OnlineBoutique | 84.0% | 51.2% | 80.0% |
| RE1 SockShop | 88.0% | 80.8% | 92.8% |
| RE1 TrainTicket | 64.8% | 64.0% | 68.0% |
| RE2 OnlineBoutique | **92.2%** | 82.2% | 82.4% |
| RE2 SockShop | 87.8% | 78.9% | 88.9% |
| RE2 TrainTicket | **81.1%** | 74.4% | 68.1% |
| RE3 OnlineBoutique | 80.0% | 83.3% | 80.0% |
| RE3 SockShop | 50.0% | 26.7% | 45.0% |
| RE3 TrainTicket | 33.3% | **76.7%** | 51.1% |
| **Overall** | **78.9%** | 69.8% | **77.4%** |

Cases: 735 discovered, 735 evaluated, 0 load errors.

> That line is **the PRISM runner's own**, and it describes the PRISM side only. PRISM's runner never capped;
> ours did. Read the table above as *735 against 615* — which is what §2.1 corrects.

### 2.1 The same comparison on the corpus both sides ranked

Three RE2 invocations carried `--max-cases 50` (the published cells, their no-inject control, and the ablation),
so the engine's RE2 cells above are means over **150** of RE2's **270** cases. Commit `b5f0951` removed the cap
(owner document: `benchmark-corpus-completeness.md`) and run `37872246084` re-measured. RE1 and RE3 are
**byte-identical** to the previous run and are the control for a change that grows RE2 alone.

| cell | PRISM additive | engine (full corpus) | Δ (PRISM − engine) | was |
| --- | ---: | ---: | ---: | ---: |
| RE1 OnlineBoutique | 84.0% | 80.0% | +4.0 | +4.0 |
| RE1 SockShop | 88.0% | 92.8% | −4.8 | −4.8 |
| RE1 TrainTicket | 64.8% | 68.0% | −3.2 | −3.2 |
| RE2 OnlineBoutique | 92.2% | **86.7%** | **+5.5** | +9.8 |
| RE2 SockShop | 87.8% | **92.2%** | **−4.4** | −1.1 |
| RE2 TrainTicket | 81.1% | **71.1%** | **+10.0** | +13.0 |
| RE3 OnlineBoutique | 80.0% | 80.0% | 0.0 | 0.0 |
| RE3 SockShop | 50.0% | 45.0% | +5.0 | +5.0 |
| RE3 TrainTicket | 33.3% | 51.1% | **−17.8** | −17.8 |
| **Overall (weighted by 735)** | **78.91%** | **78.75%** | **+0.16** | +1.45 |

**The 1.5 pp deficit was 1.30 pp of corpus mismatch and 0.16 pp of engine.** The decomposition is exact: RE2
contributes `+1.298 pp` to the weighted total and RE1 and RE3 contribute `0.000`.

Complementarity is real but **narrower than the capped table suggested on the suite where it mattered most**: our
two RE2 deficits shrink (+9.8 → +5.5 and +13.0 → +10.0) and our RE2-SS lead widens (−1.1 → −4.4). So on the
corrected corpus we win more of RE2 than §2 showed, and the case for fusion is weaker on that suite and unchanged
everywhere else.

## 3. Three-layer conclusion

### 3.1 Reproduction is successful and slightly above the paper

- Additive Overall 78.9% > the paper's reported 68%; RE2OB 92.2% > the paper's
  90%. The gap is most plausibly an evaluation-granularity / tie-break
  difference; it does not affect the apples-to-apples comparison, because both
  PRISM (our reimplementation) and our engine are scored by the **same code on the same cases**, the same
  service-level AC@1 and the same tie-break. (An earlier version of this bullet said "same 735 cases" and was
  **wrong for the engine column**, which covered 615 until §2.1's correction — PRISM was on 735 throughout.)
- Conjunctive (69.8%) is clearly weaker and RE1-OB collapses to 51.2%,
  confirming the paper's additive-default choice.

### 3.2 PRISM's single graph-free signal ties our full engine, and leads it on the capped corpus by +1.5pp

A graph-free, 8 ms-per-diagnosis, single-signal method scores 78.9% against our full graph + trace + log +
rank-normalization pipeline. On the capped corpus that was 77.4% (+1.5 pp); on the corpus both sides ranked it is
78.75% (**+0.16 pp, one case**). The bound is what matters, not the point estimate: PRISM's internal/external
asymmetry is a **strong** signal and the prior assumption that it was weak is overturned either way — the
correction changes how much of the deficit is *ours*, not whether the deficit exists.

### 3.3 Complementarity — the deltas are in §2.1 and are not repeated here

Per-cell deltas live in §2.1's table; this document does not carry a second copy of them, because two copies of
one quantity drift. What survives: PRISM dominates the resource-fault suite (RE2, now by +5.5 and +10.0 pp rather
than +9.8 and +13.0), our engine dominates the error-value / crash suites (RE3 TT −17.8 pp, RE1 SS −4.8 pp), and
the two engines win **different case populations** — so their union is larger than either alone. What changes is
the **size of the prize**: fusion's headroom on RE2 is smaller than §2 implied.

## 4. Fusion decision

**Verdict: fusion remains the highest-value P2 direction, on a smaller headroom than §2 estimated.**

The fusion ceiling is the union of both engines' correct sets. A perfect
case-level oracle that picks the correct engine would score
`union = 1 − P(both wrong)`. Given the cell-level complementarity, the union sits
above 78.9% — but by **less** than the capped table implied, because both RE2 deficits narrowed when our side was
measured on the same cases. **The ceiling must be recomputed before the decision rule below is applied**: its
input is a per-case join of the two engines, and one of the two engines' inputs has changed.

Next step (`#310`): compute the **fusion ceiling** exactly via a per-case join
(dump per-case top-1 from both engines on the 735 cases, then count
both-correct / engine-only / prism-only / both-wrong). The engine half must come from a run on the **uncapped**
corpus — a join against the 615-case column would rebuild the very defect §2.1 corrects, at the level of
individual cases. Decision rule:

- union ≈ 80% → fusion marginal, deprioritize.
- union ≈ 85%+ → high value, proceed to design an **adaptive fusion** that
  injects PRISM's M-score as a new signal channel into `TreePruner`
  (TDD + per-signal ablation + benchmark readback; flip default only on
  net-positive + zero-regression).

Note: fusion does not "solve RE3" per se — PRISM's own RE3 TT is 33.3% (worse
than our 51.1%). The net gain comes from **complementarity**: PRISM patches our
RE2 shortfall, and our engine patches PRISM's RE3 shortfall.

## 5. Files

- `packages/kinetic/src/benchmarks/leaderboard/prism.ts` — faithful PRISM
  reimplementation (pure functions, 38 unit tests, 100/97.43/100/100 coverage).
- `packages/kinetic/__tests__/unit/leaderboard/prism.test.ts` — 38 tests.
- `scripts/run-prism.ts` — head-to-head runner (9-cell AC@1 table).
- `.github/workflows/benchmark-prism.yml` — additive + conjunctive readback.
