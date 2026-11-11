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

## 5. The second producer: the repair was right, it reached one corpus — and completing it is refused

Everything above was measured on RCAEval, whose converter names the error family `error`. The FSE'26 converter
derives **the same quantity** — the share of a service's spans whose HTTP response status is `>= 400` — and
names it `http.response.error_rate`. Membership of the event family is an exact list of literal labels, and that
name was never in it, so on the archive where the published score is measured the guard kept the
whole-recording denominator and refused the truth's own error channel.

It was refused on the shape the guard exists to protect. `ts2-ts-ui-dashboard-response-replace-code-7nldtm`:
the truth's series reads `0.00` for 24 samples, then `16.1 / 16.7 / 16.9 / …`, and every other service reads
`0.00` throughout. The dump for that case prints

```
metricDecisive: http.response.error_rate=0.820{dev=0.328, …}     the channel that decides this node
metricDrop(30): … http.response.error_rate:duty-cycled-idle …    dropped, with reason
prediction = [ts-auth-service, ts-route-service, ts-gateway-service, …]   truth not in the top five
```

### Population, replayed rather than argued

`scripts/fse26_duty_cycle_sweep.py` rebuilds the converter's series and asks the guard's question twice on the
ground-truth service of every datapack:

| reading | cases | share of judgeable |
| --- | --: | --: |
| datapacks in the archive | 1422 | — |
| truth carries no rate series at all | 74 | — |
| too short to judge | 1 | — |
| **judgeable** | **1347** | 100 % |
| whole-recording rule drops the truth channel | **1344** | **99.8 %** |
| post-injection window keeps it | **661** | 49.1 % |

The `683` the window still refuses are the sporadic shape the guard was written for. The rescued population is
concentrated exactly where the archive's remaining gap is — `response-replace-code` `219`,
`request-replace-method` `177`, `response-replace-body` `48`, `request-abort` `46`, `exception` `39`,
`request-replace-path` `38`, `response-abort` `38`. The defect is real, and one label closes it.

### What one label does to the corpus, and why it is NOT shipped

Measured at `31971bf1` on cache `rcabench-pod-v1`, 1422 cases, per-case verdicts against the shipped arm at
`59cd1ad3`:

| metric | shipped | one label added | Δ |
| --- | --: | --: | --: |
| Top@1 | 75.46 % (1073) | **76.09 % (1082)** | **+0.63 pp** |
| Top@3 | 86.29 % | 87.90 % | +1.61 pp |
| Top@5 | 87.83 % | 90.51 % | +2.68 pp |

And **eight fault types move, six up and four down**:

| fault type | Δ | | fault type | Δ |
| --- | --: | --- | --- | --: |
| `HTTPResponseReplaceCode` | **+9** | | `NetworkPartition` | **−4** |
| `HTTPRequestReplaceMethod` | **+4** | | `NetworkBandwidth` | **−3** |
| `HTTPResponseAbort` | +2 | | `HTTPRequestReplacePath` | −1 |
| `HTTPResponseReplaceBody` | +1 | | `NetworkLoss` | −1 |
| `JVMException` | +1 | | | |
| `NetworkCorrupt` | +1 | | | |

**That is a trade, and this register refuses trades.** The rule it has applied to every candidate — `cv=0`, the
`pre-injection` anchor, the trend weight — is *no regressed fault type*, and it does not have an exception for
arms whose total rises. So the label stays out, and the reason it stays out is written down where the next
session reads it (`event-family-census.test.ts` carries the FSE'26 family as a NAMED exemption with its number).

### The mechanism, which is not the one that was predicted

The 14 lost cases are one shape, and it is not the fleet-share shape the pod term abstains on: the affected
fleet reads **23–38 %**, under that gate. The truth in those cases is a service that **cannot produce the
channel at all** — `mysql` has no HTTP spans — while its callers can. During a network fault on `mysql`, every
caller's error rate rises, and once the channel is admitted that rise is priced as evidence *for the caller*.
Six of nineteen services move; the truth contributes nothing because it has nothing to contribute.

| lost case | fault | accepted pair | rank of the pair | new rank-1 |
| --- | --- | --- | --- | --- |
| `ts2-mysql-bandwidth-jlzd96` | NetworkBandwidth | `mysql`, `ts-config-service` | 1 → out of five | **`ts-seat-service`** |
| `ts3-mysql-partition-xgmtkl` | NetworkPartition | `mysql`, `ts-station-service` | 1 → out of five | **`ts-basic-service`** |
| `ts3-ts-config-service-partition-gpznpx` | NetworkPartition | `ts-config-service`, `mysql` | 1 → out of five | **`ts-seat-service`** |
| `ts5-mysql-bandwidth-2ctlcv` | NetworkBandwidth | `mysql`, `ts-train-service` | 1 → out of five | **`ts-basic-service`** |
| `ts5-mysql-bandwidth-r5tp67` | NetworkBandwidth | `mysql`, `ts-order-service` | 1 → 3 | **`ts-seat-service`** |
| `ts2-ts-order-service-loss-lp8wln` | NetworkLoss | `ts-order-service`, `mysql` | 1 → 4 | **`ts-seat-service`** |
| `ts2-mysql-partition-995nz4` | NetworkPartition | `mysql`, `ts-config-service` | 1 → 5 | **`ts-seat-service`** |
| `ts3-ts-train-service-partition-r58pxm` | NetworkPartition | `ts-train-service`, `mysql` | 1 → 5 | **`ts-basic-service`** |

**Corrected in iteration 260.** Four of these eight rows carried the wrong winner, because the first reading
took the accepted pair's second member for the arm's rank 1 instead of reading the arm's own ranking. The pair
column is new and it is what makes the shape legible: the corpus accepts **two** services per datapack (the
injected one and the affected one), and both were ranked first before the arm. Every new rank-1 is a **caller**
of the accepted pair — `ts-seat-service > ts-config-service > mysql` in the graph — which is the asymmetry the
section above describes, now with the right names attached. The identity of all fourteen lost datapacks was
recomputed with the corpus's own multi-label rule
(`scripts/compare_fse26_per_case.py`, `any(s in accepted for s in ranked[:k])`) and agrees with the aggregate
`23 gained / 14 lost / net +9`.


The other six are a sibling swap — `ts-route-plan-service` losing to `ts-travel-plan-service` by one rank in
four `route-plan` cases, plus two single-rank moves — which is the same shape at lower magnitude: two candidates
that both carry the channel, separated by noise.

So the completion is a **victim/source asymmetry**, not a fleet-share gate: the engine ships `victimWeight = 0`,
and a channel that proves a caller was *affected* is being priced as proof that it is the *cause*. The
acceptance test that would let the label in is pre-registered and falsifiable — `Top@1 >= 1082` **with no fault
type down**, on this cache, measured per case — and it is carried in the exemption record itself so it cannot be
forgotten.

**Status of that repair, iteration 260.** The precondition named above — making the caller chargeable — was built
and measured, and it is not sufficient. The caller *is* chargeable once `isResponseChannel` is expressed over the
event family instead of a literal (a real defect, fixed and fenced), and the arm still reads **0/8** on these
eight datapacks. The blocker turned out to be in the operator rather than in the predicate: at the shipped
`topoDiscountGate = 1` the condition `min(a, e) >= a` reduces to `e >= a`, which the **argmax** can never
satisfy, so the deduction cannot charge the highest-anomaly node at all. `docs/topo-discount-scope.md` §9 carries
the arithmetic, the two independent mechanisms that additionally made the term inert on this corpus, and the four
arms that were refused. The acceptance test above is unchanged and unmet.
