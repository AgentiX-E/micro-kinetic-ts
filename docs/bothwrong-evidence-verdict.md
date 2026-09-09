# bothWrong Evidence Probe — Verdict (run 34339785041)

## Question

Before building a gated LLM judge to attack the 77-case bothWrong floor
(12.5% of 615, the deterministic ceiling), we probed whether the 39 RE2/RE3
bothWrong cases carry enough *LLM-exploitable* signal (topology + metric
deviation + deepest exceptions) to separate source from victim. If the
information wall is absolute, an LLM judge cannot help; if the failure is a
deterministic ranking defect, the highest-value fix is deterministic, not LLM.

## Method

`scripts/dump-bothwrong-evidence.ts` (commit `edeff64`) dumped, for each
RE2/RE3 bothWrong case: call topology (parentSpanId → service), the top-6
metric deviations (direction + magnitude, GT flagged), and per-service deepest
exceptions. Joined against the routing-probe records (`engineTop1`,
`engineTop2`, `engineTop1Score`, `prismTop1`).

## Objective signal distribution (39 cases)

| Signal | Count | Meaning |
|---|---|---|
| Has call topology | 25 / 39 | RE2/RE3 trace edges present |
| GT absent from top-6 devs | 8 / 39 | **No magnitude signal at all** |
| GT best-dev rank == 1 | 10 / 39 | Clear magnitude winner |
| GT best-dev rank ≤ 2 | 16 / 39 | Near-top |
| GT distinctive non-latency metric (diskio/socket/cpu/error/workload) | 19 / 39 | Metric-type discriminability |
| GT has its own exception line | 10 / 39 | Mostly `unclassified` (connectivity/IO) |

GT best-dev rank distribution: `{1: 10, 2: 6, 3: 5, 4: 4, 5: 3, 6: 3}`.

## The decisive finding: two *deterministic* failure modes, not one wall

The 39 cases do not split into "LLM-crackable vs information-wall". They split
into **three** buckets, and the largest actionable one is a **ranking defect**:

### Mode 1 — TT degenerate ranking (`finalScore == 0.000` exactly)

On the re2tt / re3tt cases the engine's top-1 `finalScore` is *exactly* `0.000`
and it picks a service that is **not** the magnitude winner:

| case | GT (dev) | engineTop1 (score) | engineTop2 | prismTop1 |
|---|---|---|---|---|
| ts-auth-service_delay_2 | ts-auth-service (diskio 2.92 DROP) | ts-preserve-service (0.000) | ts-contacts-service | ts-security-mongo |
| ts-auth-service_delay_3 | ts-auth-service (diskio 2.82 DROP) | ts-preserve-other-service (0.000) | ts-consign-service | ts-auth-mongo |
| ts-auth-service_loss_1 | ts-auth-service (diskio 1.56 RISE) | ts-preserve-other-service (0.000) | ts-assurance-service | ts-verification-code-service |
| ts-order-service_loss_1 | ts-order-service (latency 1.58 RISE) | ts-preserve-other-service (0.000) | ts-assurance-service | ts-seat-service |
| ts-route-service_f3_4 | ts-route-service (latency 1.63 RISE) | ts-order-service (0.000) | ts-ticketinfo-service | ts-station-service |

**Root cause** — an interaction between `rankNormalizeScores` and the log-space
base term:

- `rankNormalizeScores` (`topology-fault-graph.ts:337`) maps the top anomaly to
  exactly `1.0` (`(n−1)/(n−1)`) and the next rank to `≈(n−2)/(n−1)`.
- `finalScore(v) = Math.log(selfScore(v)) + Σ wᵢ·signalᵢ(v)`
  (`pruner.ts:1111`) feeds that `[0,1]` value into `Math.log`.

`Math.log(1.0) === 0` — so the *strongest* anomaly contributes **zero** base
term, and the next ranks contribute only `≈ −0.05`. A single secondary signal
of weight 1 (e.g. `logWeight × logScore`, or the `traceWeight` flag on RE3)
swamps the entire base-term spread and decides the winner, or a service-id
tie-break (`pruner.ts:1128`) does.

The `rankNormalizeScores` docstring states the intent — "the outlier and the
second-ranked source land at ≈1.0 vs ≈(n−2)/(n−1), so downstream causal signals
can decide between them" — but the *log-space* base term was written for RAW
anomaly scores (where a strong source gives `log(dev) > 0`), not for the
`[0,1]` rank output (where the top gives `0`). This is a **genuine defect**,
superseding the earlier "0-score zombie is not a bug" note: those zero scores
are exactly the TT bothWrong floor, and the GT magnitude is recoverable.

### Mode 2 — SS degenerate ranking (non-positive `finalScore`)

On the re3ss cases the top-1 score is **non-positive** and the GT sits at #2:

| case | GT (dev) | engineTop1 (score) | engineTop2 |
|---|---|---|---|
| front-end_f3_2 | front-end (socket 1.08 RISE) | user (−0.283) | front-end |
| orders_f3_2 | orders (latency 1.43 RISE) | orders-db (−0.071) | orders |
| orders_f4_1 | orders (latency 1.44 DROP) | front-end (0.848) | orders |
| orders_f4_3 | orders (latency 1.57 RISE) | front-end (0.551) | orders |

Here the source and its front-door victim trade places — the classic weak-source
pattern — but the GT is frequently the engine's *own #2*, so the ranking is
*close* rather than arbitrary.

### Mode 3 — true information wall

The 8 GT-absent cases (`re2ss_orders_delay_1`, `re3ss_front-end_f3_1`, the
`ts-route-service f2_*`/`f3_*` cases, etc.) and the ~23 GT-rank-3..6 cases
contain no signal a human or LLM could use. The exceptions are almost entirely
`unclassified` (connectivity/IO), matching the prior `re3-log-ceiling` verdict.

## Verdict

1. **The gated LLM judge is demoted.** For ~2/3 of the bothWrong floor the
   information wall is absolute (Mode 3) — the LLM reads the same metrics +
   topology + logs as the engine and has no extra evidence. For the ~1/4 that
   are "clear magnitude" (Mode 1/2), the engine fails through a **deterministic
   ranking defect**, not a reasoning gap: the `Math.log(1.0) === 0` collapse
   throws away the strongest signal. An LLM would need no reasoning to recover
   those — a correct base term does it for free.

2. **The highest-value next step is a deterministic fix to the
   `rankNormalizeScores` × `Math.log` interaction**, not an LLM subsystem. The
   base term must remain positive and monotonic for the top anomaly. Candidates:
   - `Math.log1p(selfScore)` (top → `log1p(1.0) = 0.693`, floor → `0`), or
   - rank-normalize into `[1, 2]` (top → `log(2.0) = 0.693`, floor → `0`).

3. **Risk** — `rankNormalization` is load-bearing: it drove TT RE3 3.6% → 51.1%.
   The fix must NOT revert that. It must be TDD'd, ablated as a new slice, and
   read back for **net-positive + zero-regression** before flipping the default.

## Next steps

1. Reproduce the `0.000` collapse in a failing unit test (TDD red): a
   rank-normalized score map fed through `finalScoreOf` must give the top
   anomaly a strictly positive base term.
2. Implement the base-term fix (smallest, most principled change).
3. Ablation slice (`+Rank Base Fix`) and read back the 615-case delta vs the
   76.1% / 81.3% baselines.
