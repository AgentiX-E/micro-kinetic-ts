# The transient guard reads two samples — and measuring it was how we learned it is right

The transient-spike guard decides whether a metric is a **symptom of propagation** (an excursion that
came back) or **the fault itself** (a level that moved and stayed moved). It has existed since the
`#197` RE3 TrainTicket regression, where a brief cpu pulse on a non-source service outranked the real
fault.

Its test compares two numbers:

```
permanence = |values[0] − values[n−1]| / (max − min)      < 0.3  →  discard the metric
```

On a 721-sample window — the shape every RCAEval RE1 case has — **two samples out of 721 decide
whether the fault's own signature channel survives**, and the second of them is whichever sample the
window happens to end on. That is indefensible as a measurement of a LEVEL, and the first half of this
document is the case against it. The second half is the measurement, which says the estimator is wrong
and the guard is right: **the fix was reverted on the nine cells**, and the reason it loses is the
finding the iteration actually produced.

## 1. The corpus instance

`re1ob_adservice_delay_3` injects a delay at `adservice`. Its `latency-50` series is not a step. It is
**intermittent**: over the last 250 samples it alternates between the 5 ms baseline and a 106 ms
plateau, and the window ends on a baseline sample:

```
… 0.00459, 0.10184, 0.10184, 0.10676, 0.00500, 0.00435, 0.00484, 0.00484, 0.10630, … 0.00500
```

| quantity | value |
| --- | ---: |
| `head` (`values[0]`) | 0.00271 |
| `tail` (`values[720]`) | 0.00500 |
| range | 0.10834 |
| **permanence** | **0.021 → discarded as `transient-return`** |
| samples on the 106 ms plateau | 361 of 721 |

So the faulted service's latency channel was dropped, `latency-90` with it (`permanence` 0.234), and
the node was scored on `mem` — a series whose deviation is **0.010**:

```
GT breakdown=dev=0.010 trend=0.000 cv=0.000 burst=0.000 rise=0.023 drop=0.020 base=36550777.286
GT transientSkipped=[cpu,latency-50,latency-90]
```

The case is then lost to `checkoutservice`, a **caller** whose latency channel was intact
(`dev=0.754`, `rise=4.681`). The ranking did not choose wrongly between comparably-moving candidates;
it chose between a service whose evidence had been deleted and one whose had not.

Fourteen of the twenty-five failure blocks printed by run `40133362501` (RE1, the shipped
configuration) carry `latency` in the truth's `transientSkipped` list, and three of them list
`[cpu,latency-50,latency-90]` — every informative channel at the faulted service.

## 2. The candidate fix, and why it looked sufficient

Both ends become **levels** instead of samples: the mean of the first and last tenth of the series.

```
headLevel = mean(values[0 … w))          w = max(3, ceil(n × 0.1))
tailLevel = mean(values[n−w … n))
permanence = |headLevel − tailLevel| / (max − min)
```

`0.1` is a resolution rather than a fitted parameter: the estimator was unit-tested at **0.05, 0.10 and
0.20** and each window separates an intermittent fault (level moved and stayed) from a genuine return
(level came back). A change-point estimate — pre-level against post-level — was refused first, and for
a reason that survives: with the fault at the end of the window a terminal spike and a terminal step
are indistinguishable, so a change-point test would keep every trailing pulse the guard exists to
discard.

The local pair was clean. One corpus, one runner, one configuration, one variable — the 125-case
RE1-OnlineBoutique mirror, with `fraction = 0, min = 1` restoring the shipped estimator for the "before"
column:

| RE1-OnlineBoutique | before | after | Δ |
| --- | ---: | ---: | ---: |
| CPU | 92.0 | 92.0 | 0 |
| **DELAY** | **88.0** | **100.0** | **+12.0** |
| DISK | 92.0 | 92.0 → 84.0 | −8.0 |
| LOSS | 48.0 | 48.0 | 0 |
| MEM | 92.0 | 96.0 | +4.0 |
| **AVERAGE** | **82.4** | **84.0** | **+1.6** |

103/125 → 105/125, five gained and three lost. The DELAY column goes to **100%**: every delay case in
the cell now reads the delay it was given.

## 3. The nine cells, and the refusal

The dispatch (`scopes=golden`, run `40153872789`) reads the other eight cells, and the local gain does
not survive them.

| cell | shipped | window | Δ (cases) |
| --- | ---: | ---: | ---: |
| RE1-OnlineBoutique | 82.4 | **84.0** | **+2** |
| RE1-SockShop | 92.8 | **93.6** | **+1** |
| **RE1-TrainTicket** | **75.2** | **71.2** | **−5** |
| **RE1** | **83.47** | **82.93** | **−2** |
| RE3-OnlineBoutique | 73.3 | 73.3 | 0 |
| RE3-SockShop | 40.0 | **50.0** | **+3** |
| RE3-TrainTicket | 50.0 | 50.0 | 0 |
| **FSE'26 (1422)** | **56.12** | **57.8** | **+1.7 pp** |

**Fifteen cases gained, seventeen lost on RE1**, and the fault-type ledger says which:

| fault type (RE1, 375 cases) | shipped | window |
| --- | ---: | ---: |
| cpu | 71 | **67** |
| delay | 66 | **69** |
| disk | 64 | **58** |
| loss | 42 | **45** |
| mem | 70 | **72** |

**REVERTED.** The criterion this project applies to every axis is that a gain must not be bought with a
regression on the cell that blocks the goal, and RE1 is that cell: it is the one population where this
engine is **second** (`83.47` against `arXiv:2610.05009`'s `L0` 85.4), and this change moves it to
82.93, further from the only target it has not reached. FSE'26's +1.7 pp is real and lands on a cell
this engine leads by 19 pp; buying margin there with distance here is the trade that iteration 129
refused in the other direction, and refusing it in both directions is what makes the rule a rule.

## 4. Why it loses — and this is the finding

The seventeen losses are not noise, and they are not spread out. **Eleven of the seventeen lose by
exactly `0.0078`** — one rank step on a rank-normalised graph (`ln((1+1)/(1+1−1/63))`), which is the
whole dynamic range of a TrainTicket anomaly gap. The winner changes, the margin does not.

The mechanism is visible on `adservice_disk_1`:

| | winner `cartservice` decisive metric | score |
| --- | --- | ---: |
| shipped estimator | `cpu` 0.185, with `latency-90:transient-return` | 0.185 |
| window estimator | `latency-90` 2.096 (`dev=1.430 rise=25.89`) | 2.096 |

The truth `adservice` scores `cpu` 1.648 (`rise=14.35`) in **both** runs. The guard had been discarding
the **caller's** latency channel as well as the source's, and the caller's channel is the *larger* of
the two: 25.89× against 14.35×. Restoring both ends correctly restores the **symptom's** evidence too,
because a propagated latency rises further than the resource metric at its origin.

So the guard is doing two jobs. The first is discarding transients. The second is **damping the
magnitude advantage of propagated symptoms**, and nobody had named it, because it was never a term —
it was a side effect of a shape test discarding the channel that carries propagation. The second job
is load-bearing, and it is doing it *better than the mechanism built for it*: the failed-edge
direction term ships at weight 3 and contributes **exactly 0.0000 cases** on all three RE2 cells
(run `40133507548`, `whole-file` at `failed_edge_weight=0`, reproduces `40133362501`'s eighteen
fault-type cells byte for byte), and on RE1 it cannot fire at all — `direction-gate[whole-file]: weight
3 but this view supplied 0 latency rows over 125 cases`.

That is the shape of the next iteration, and it is now a target with a number on it rather than a
direction: **a suppression mechanism that recovers the six disk and four cpu cases without returning
the three delay, three loss and two mem cases** is worth **+8 cases on RE1 (83.5 → 85.6)**, which is
past `L0`, while holding FSE'26 at 57.8. The estimator fix is the *enabling* measurement: it is what
makes the magnitude advantage of a symptom observable, and it is the control arm for that mechanism.

## 5. What ships, and what does not

| change | state |
| --- | --- |
| window-mean estimator `transientPermanence`, its four unit tests, the 0.05/0.10/0.20 sweep | **REVERTED** — code byte-identical to `58972a3` apart from the docblock at the guard that records this measurement and its seventeen cases |
| `scopes` dispatch input (`golden` = the three runners and the dashboard) | **SHIPPED** — run `40133507548` had all nine cells uploaded and was still reported `cancelled` because the optimiser hit its 60-minute bound afterwards |
| the RCAEval table's four metric rows | **SHIPPED separately** — `Avg@5`, `LA` and `TA` were the `AC@1` column reprinted, because the row loop read `perFaultType[ft].accuracy` for every row and used the metric's key only for its label; see `docs/rcaeval-metric-rows.md` |

## Gates

`packages/tree` **704/704** (the four window tests went with the estimator), coverage
**100 / 100 / 100 / 100**. Repository **4837/4837**. `zsh .git/check_fences.sh` → FENCES CLEAR.
