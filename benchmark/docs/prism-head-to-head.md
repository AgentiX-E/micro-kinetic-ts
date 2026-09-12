# PRISM Head-to-Head Readback (P0b)

**Status:** complete — PRISM reimplemented and read back on the same 735-case
RCAEval harness our engine evaluates. Result: **additive pooling scores 78.9%
Overall Top-1**, marginally above our engine's 77.4%, with **strong
complementarity** that makes fusion the highest-value P2 direction.

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

| cell | PRISM additive | PRISM conjunctive | engine (golden) |
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

## 3. Three-layer conclusion

### 3.1 Reproduction is successful and slightly above the paper

- Additive Overall 78.9% > the paper's reported 68%; RE2OB 92.2% > the paper's
  90%. The gap is most plausibly an evaluation-granularity / tie-break
  difference; it does not affect the apples-to-apples comparison below, because
  both PRISM (our reimplementation) and our engine are scored on the **identical
  harness** (same 735 cases, same service-level AC@1, same tie-break).
- Conjunctive (69.8%) is clearly weaker and RE1-OB collapses to 51.2%,
  confirming the paper's additive-default choice.

### 3.2 PRISM's single graph-free signal beats our full engine by +1.5pp

A graph-free, 8ms-per-diagnosis, single-signal method scores 78.9% vs our full
graph + trace + log + rank-normalization pipeline at 77.4%. This overturns the
prior assumption that PRISM's internal/external signal is weak. It is a
genuinely strong signal.

### 3.3 Strong complementarity is the decisive finding

Per-cell delta (PRISM additive − engine):

| cell | Δ |
| --- | ---: |
| RE1 OB | +4.0 |
| RE1 SS | −4.8 |
| RE1 TT | −3.2 |
| RE2 OB | **+9.8** |
| RE2 SS | −1.1 |
| RE2 TT | **+13.0** |
| RE3 OB | 0.0 |
| RE3 SS | +5.0 |
| RE3 TT | **−17.8** |

PRISM dominates the resource-fault suites (RE2: cpu/mem/disk/socket/loss/delay)
by +9.8 to +13.0pp. Our engine dominates the error-value / crash suites (RE3
TT +17.8pp, RE1 SS +4.8pp). The two engines win **different case populations**,
so their union is strictly larger than either alone.

## 4. Fusion decision

**Verdict: fusion is the highest-value P2 direction.**

The fusion ceiling is the union of both engines' correct sets. A perfect
case-level oracle that picks the correct engine would score
`union = 1 − P(both wrong)`. Given the cell-level complementarity, the union is
expected to sit meaningfully above 78.9%.

Next step (`#310`): compute the **fusion ceiling** exactly via a per-case join
(dump per-case top-1 from both engines on the 735 cases, then count
both-correct / engine-only / prism-only / both-wrong). Decision rule:

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
