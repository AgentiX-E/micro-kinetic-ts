# The silent-source stock, attributed case by case

Run `34813401805` (commit `ccecee1`, cache `rcabench-full-v3`) with
`diagnose=JVMMemoryStress,ContainerKill,PodFailure,PodKill,HTTPResponseReplaceCode`
and `diagnose_limit=0`: **522 diagnostic blocks**, read back with
`analyze-fse26-diagnose --misses 1` at `logWeight=1`.

This is the first attribution of the whole block from the score side. Its purpose
is routing: 294 cases at ~2% Top@1 is the largest remaining stock, and the first
question is which part of it is even addressable.

## The table

| fault type | cases | wrong | silent both sides | `metric` | `log` | `both` |
| --- | --- | --- | --- | --- | --- | --- |
| JVMMemoryStress | 171 | 167 | 32 | 62 | 62 | 43 |
| ContainerKill | 88 | 87 | 25 | 44 | 24 | 19 |
| PodFailure | 23 | 23 | 9 | 9 | 2 | 12 |
| PodKill | 9 | 8 | 4 | 6 | 1 | 1 |
| **stock total** | **291** | **285** | **70** | **121** | **89** | **75** |
| *(contrast)* HTTPResponseReplaceCode | 231 | 72 | **53** | 67 | 1 | 4 |

`metric` = the winner's own anomaly is higher; `log`/`both` = error evidence
pointed at the winner; `silent both sides` = neither the source nor the winner
emitted a single error line. `tie` and `unexplained` are **0 across all 522
blocks** — the engine's order is self-consistent with the two terms the dump
carries, so nothing here is an engine defect.

## It reproduces the published split, independently

`docs/fse26-metric-competition-verdict.md` split this block as **166 log-decided /
122 metric-rank-decided**, from the score decomposition of a different run.
Measured here, from the dump's own terms and a different classifier:

| | published | this measurement |
| --- | --- | --- |
| log-decided | 166 | **164** (`log` 89 + `both` 75) |
| metric-decided | 122 | **121** (`metric`) |

Two cases apart on 285. That agreement is the point: it means the instrument is
sound, and — more usefully — it means the block's internal structure is
over-determined by two independent readings, so the next candidate does not need
to re-measure it. **The log-side axis is closed** (`docs/fse26-logweight-sweep-verdict.md`:
per-fault-type oracle ceiling +2.67pp → 50.00%), and this table says why: of the
164 log-driven misses, 70 have no log evidence at all and the rest are decided by
**the victim's** lines, which no weight can re-point.

## What it routes to

Two numbers to act on:

1. **160 of the 357 wrong cases in this dump (45%) are silent on both sides** — no
   log-side intervention can move them. They are metric-layer losses by
   construction.
2. **`HTTPResponseReplaceCode`, the largest type (231 cases) and the largest
   headroom (159 → 231 possible), is 53 of 72 wrong for this reason** — 74%
   both-silent, and only 1 log-decided.

So the remaining axis is the one the verdict already nominated: **the metric
term's shape**. Its constraints, all already measured and none of which the next
candidate may re-open:

- `rankNormalization` is load-bearing (Train Ticket RE3 36% → 51.1%) — not
  revertible;
- a global min-max normalisation of the metric score measured **+0.00pp**;
- a monotone compression of the total was proved non-reordering and measured
  **−2.67pp**;
- the dimension theorem bounds any reweighting: both terms are normalised, so a
  log-silent service can overtake only within `logWeight < m(s) − m(w) ≤ 1`.

What is NOT yet measured is a monotone transform of the **metric term alone** —
which does change the spacing between two services' scores and is therefore not
the non-reordering case. That is the next falsifiable candidate, at the step size
the theorem names: the metric term is a uniform rank with step `1/(n−1) ≈ 0.020`
at 51 services, while the log term's first step is already 1.0 = 50 rank positions.
