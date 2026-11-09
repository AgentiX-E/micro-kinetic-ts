# The idle guard's denominator was the recording, and half the recording is quiet by construction

**The finding, in one sentence.** The `duty-cycled-idle` guard refuses a channel that sits at ~0 for more than
40% of its samples, its denominator is the WHOLE recording, and the first half of every recording is the
pre-injection period — so on `RE3:SockShop` the guard refused the **truth's own `error` channel on 18 of the 30
cases and the winner's on none**, which is a confound rather than an instrument.

This document is the proof, the census of what the repair admits, and the nine-cell result of making it.

## 1. The confound, measured

A diagnose dump of the shipped configuration over all 30 `RE3:SockShop` cases (`/root/work/dumps/base252_re3_ss.txt`)
carries, for every service, the reason each of its channels was refused. Reading the refusals of the `error`
channel against the case's outcome:

| truth's `error` channel | cases | rank-1 correct | rate |
| ----------------------- | ----: | -------------: | ---: |
| refused (`duty-cycled-idle`) | 18 | 8 | **44.4%** |
| kept | 12 | 11 | **91.7%** |
| **winner's** `error` channel refused | **0** | — | — |

Eighteen refusals of the truth's error channel, none of the winner's — the guard is not a witness here, it is
part of the ranking. The four refusal reasons seen anywhere in the dump are `non-positive-mean` (66, the
event-less services), `duty-cycled-idle` (34), `transient-return` (4); the 34 are all on the `error` channel and
never on a winner that was not also the truth.

## 2. Why the denominator could not be right

The guard's own docblock states its purpose: a channel at ~0 for most of its history is an event/activity
instrument, and its idle→active transition produces an unbounded relative rise that is not an anomaly. That
reasoning is sound for the channel it was written for — a latency percentile that is zero whenever no request
completed.

It cannot be sound for a series split 50/50 at an injection boundary. If the fault raises the error rate at all,
the pre-injection half is quiet **by construction**, so the near-zero fraction over the whole recording is at
least ≈ 0.5 before a single post-injection sample is counted — and the threshold is 0.4. The guard is therefore
not measuring "this channel is an idle instrument"; it is measuring "this channel was quiet before the fault",
which is what a fault looks like.

The corpus confirms the arithmetic rather than the anecdote. Measured over all 735 cases
(`/root/work/duty-census.py`), every `(case, service, channel)` that reaches this guard, counted three ways:

| channel | refused before and after | **admitted** by the window rule | refused by the window rule only | kept both |
| ------- | -----------------------: | ------------------------------: | ------------------------------: | --------: |
| `error` | 486 | **39** | **0** | 44 |
| `latency-50` | 419 | 20 | 39 | 9 517 |
| `latency-90` | 422 | 25 | 38 | 9 510 |
| `diskio` | 249 | 42 | 0 | 6 731 |
| `cpu` | 13 | 0 | 9 | 22 349 |
| `load` | 95 | 0 | 16 | 428 |
| `workload` (dropped earlier as demand) | 1 885 | 19 | 95 | 8 157 |

The last two columns are why the repair is **family-scoped** rather than general. Applying the window rule to
every channel would newly refuse 39 `latency-50`, 38 `latency-90`, 9 `cpu` and 16 `load` channels — a blast
radius on the cells the engine already wins — while the `error` family admits 39 and refuses **none**.

## 3. The repair

One predicate, one family, one window: for a member of `EVENT_METRIC_LABELS` — the exact-list family whose zero
is a MEASURED zero, `['error']`, beside `DEMAND_METRIC_LABELS = ['workload']` — the near-zero fraction is
counted over `[inject, end)` with the post-injection peak as its reference. A level channel keeps the
whole-recording rule. When the boundary is unknown, or leaves fewer than two samples on the claimed side, the
whole-recording rule applies again: a window cannot be one sample, and no boundary means no window to prefer.

Five unit tests hold both halves (`packages/tree/__tests__/causal/duty-cycle-window.test.ts`): the corpus shape
is admitted, a channel that is sporadic *inside* the fault window is still refused, a latency channel keeps the
old rule, a boundary at the last sample falls back, and an unknown boundary is inert.

## 4. What it does to the nine cells

Complete 735-case corpus, shipped configuration, one variable:

| cell | AC@1 before | AC@1 after | Δ | Avg@5 (type mean) before | after |
| ---- | ----------: | ---------: | -: | -----------------------: | ----: |
| RE1:OnlineBoutique | 113 | 113 | 0 | 96.2% | 96.2% |
| RE1:SockShop | 119 | 119 | 0 | 97.4% | 97.4% |
| RE1:TrainTicket | 112 | 112 | 0 | 95.2% | 95.2% |
| RE2:OnlineBoutique | 84 | 84 | 0 | 94.9% | 94.9% |
| RE2:SockShop | 89 | 89 | 0 | 98.9% | 98.9% |
| RE2:TrainTicket | 76 | 76 | 0 | 88.0% | 88.0% |
| RE3:OnlineBoutique | 26 | 26 | 0 | 91.1% | 91.1% |
| RE3:SockShop | 19 | 19 | 0 | **84.6%** | **85.6%** |
| RE3:TrainTicket | 22 | 22 | 0 | 81.2% | 81.2% |
| **total** | **660** | **660** | **0** | — | — |

**Every cell's AC@1 is unchanged and the RE3:SockShop ranking moved inside the top-5** (type-mean Avg@5 84.6 →
85.6). That is the honest reading of a correctness fix whose effect the published metric cannot see: the
evidence the guard was discarding is now admitted, and on this cell it is not yet decisive because the truth's
remaining competitors carry a larger *relative* rise — which is the axis `docs/rcaeval-error-scale.md` §3
identified and `docs/emission-intensity.md` prices.

An unchanged AC@1 is not a licence to skip the fix: the refusal was asymmetric between the truth and its
competitors, so it biased the ranking whether or not the bias happened to move this cell's top-1. The change
ships on the argument in §2 plus the census in §3 (39 admissions, 0 new refusals on the family), and the
measurement above is what says it is free.
