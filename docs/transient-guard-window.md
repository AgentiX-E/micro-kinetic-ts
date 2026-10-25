# The transient guard read two samples, and they decided whether the fault was visible

The transient-spike guard decides whether a metric is a **symptom of propagation** (an excursion that
came back) or **the fault itself** (a level that moved and stayed moved). It has existed since the
`#197` RE3 TrainTicket regression, where a brief cpu pulse on a non-source service outranked the real
fault, and it has been the only thing standing between a resource pulse and the ranking ever since.

Its test compared two numbers: `values[0]` and `values[n-1]`.

```
permanence = |values[0] − values[n−1]| / (max − min)      < 0.3  →  discard the metric
```

On a 721-sample window — the shape every RCAEval RE1 case has — **two samples out of 721 decide
whether the fault's own signature channel survives**, and the second of them is whichever sample the
window happens to end on.

## The corpus instance

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
(`dev=0.754`, `rise=4.681`). The ranking did not choose the wrong service between comparably-moving
candidates; it chose between a service whose evidence had been deleted and one whose had not.

Fourteen of the twenty-five failure blocks printed by run `40133362501` (RE1, the shipped
configuration) carry `latency` in the truth's `transientSkipped` list, and three of them list
`[cpu,latency-50,latency-90]` — every informative channel at the faulted service.

## The fix, and the fix it is not

Both ends are now **levels**, not samples: the mean of the first and last tenth of the series.

```
headLevel = mean(values[0 … w))          w = max(3, ceil(n × 0.1))
tailLevel = mean(values[n−w … n))
permanence = |headLevel − tailLevel| / (max − min)
```

`0.1` is a resolution rather than a fitted parameter, and it is measured as one: the
`transientPermanence` unit test evaluates the same three shapes at **0.05, 0.10 and 0.20** and requires
every window to separate an intermittent fault (level moved and stayed) from a genuine return (level
came back). A window whose size changes the verdict would be a parameter wearing a constant's clothes.

A change-point estimate — `pre-level` against `post-level` — was considered and refused: with the fault
at the end of the window, a terminal spike and a terminal step are indistinguishable, so a
change-point test would keep every trailing pulse the guard exists to discard. Comparing the two ends
is the right *kind* of test; only the estimator was wrong.

## The measurement, and it is a pair

One corpus, one runner, one configuration, one variable. `--suite re1` over the 125-case
RE1-OnlineBoutique mirror (923 MB, 7.3 s), the window restored to `fraction = 0, min = 1` for the
"before" column so that the two runs differ **only** in the estimator.

| RE1-OnlineBoutique | before | after | Δ |
| --- | ---: | ---: | ---: |
| CPU | 92.0 | 92.0 | 0 |
| **DELAY** | **88.0** | **100.0** | **+12.0** |
| DISK | 92.0 | 84.0 | −8.0 |
| LOSS | 48.0 | 48.0 | 0 |
| MEM | 92.0 | 96.0 | +4.0 |
| **AVERAGE** | **82.4** | **84.0** | **+1.6** |

103/125 → 105/125. Five cases gained, three lost:

| case | before | after |
| --- | --- | --- |
| `adservice_delay_3` | checkoutservice | **adservice** |
| `adservice_delay_4` | checkoutservice | **adservice** |
| `productcatalogservice_delay_1` | frontend | **productcatalogservice** |
| `cartservice_loss_4` | redis | **cartservice** |
| `currencyservice_mem_1` | checkoutservice | **currencyservice** |
| `adservice_disk_1` | adservice | cartservice (truth rank 2) |
| `adservice_disk_3` | adservice | cartservice (truth rank 2) |
| `currencyservice_loss_4` | currencyservice | recommendationservice (truth rank 2) |

The DELAY column goes to **100%**: every delay case in the cell now reads the delay.

## The three losses are the finding, not the cost

All three are the same mechanism, and it names the next unsolved problem. `adservice_disk_1`:

| | winner `cartservice` decisive metric | score |
| --- | --- | ---: |
| before | `cpu` 0.185, with `latency-90:transient-return` | 0.185 |
| after | `latency-90` 2.096 (`dev=1.430 rise=25.89`) | 2.096 |

The truth `adservice` scores `cpu` 1.648 (`rise=14.35`) in **both** runs. The guard had been discarding
the **caller's** latency channel as well as the source's, and the caller's channel is the *larger* of
the two: 25.89× against 14.35×. Restoring both ends correctly restores the **symptom's** evidence too,
and propagated latency rises more than the source's resource metric.

So the guard was doing two jobs — discarding transients, and incidentally damping latency channels
that carry propagated load — and the second was load-bearing. The first job is now done by a
statistic. The second is a ranking problem: **magnitude favours the symptom**, and it is the same
problem the failed-edge direction term exists to solve, currently inert on this cell because
`edgeLatency` is empty there (`direction-gate[whole-file]: weight 3 but this view supplied 0 latency
rows over 125 cases`).

That is a measured statement about the next iteration rather than a guess, which is why the three
losses are recorded case by case instead of netted.

## What ships

| the change | where |
| --- | --- |
| `transientPermanence(values, fraction)` — the two end LEVELS and their spread over the range | `packages/tree/src/causal/topology-fault-graph.ts` |
| `TRANSIENT_LEVEL_WINDOW_FRACTION = 0.1`, `TRANSIENT_PERMANENCE_FLOOR = 0.3` named once | same file |
| four unit tests: the intermittent shape, the end-sample SYMMETRY (same series, two last samples, same verdict), the 0.05/0.10/0.20 window sweep, and the surviving protection | `packages/tree/__tests__/causal/topology-fault-graph.test.ts` |
| `scopes` dispatch input: `golden` runs the three RCAEval runners and the dashboard, leaving the optimiser and the 34-config ablation out | `.github/workflows/benchmark-rcaeval.yml` |

`scopes` exists because of run `40133507548`: all nine cells had been uploaded and the RUN was still
reported `cancelled`, because `optimize-rcaeval` hit its 60-minute bound afterwards. A job that did not
run is not a job that failed, and a dispatch that asks one question should not pay two hours for it.

## Gates

`packages/tree` **708/708** tests, coverage **100 / 100 / 100 / 100**. Repository **4837/4837**.
`zsh .git/check_fences.sh` → FENCES CLEAR.

## The nine cells

This document's measurement is the local pair, which is the only instrument that can hold both
configurations of one variable at once. The nine-cell reading is the dispatch's, because the corpus it
needs is the CI cache and no local mirror carries RE1-SS, RE1-TT, RE2 or RE3. The verdict, the per-cell
table and the accept/refuse decision are recorded in `PROGRESS_2026-10-06.md` under the iteration that
dispatched it, against the rule this repository applies to every axis: **a cell that regresses must be
named with its fault types, and the trade must be stated rather than netted.**
