# The failed-edge evidence gate — asking the channel, not the metric's name

**Status:** measured on the RCABench archive (1 422 cases), established 2026-11-06. The mode is implemented and
arm-ready; whether it ships is decided by the paired arm recorded in §6, not by this document.

---

## 1. What the shipped gate asks, and why neither half transfers

The failed-edge direction term credits the **callee** of a failed call: when a service's interface fails, the
service that owns that interface is the source, and the callers are the victims that log about it. The term is not
shipped bare — ungated it takes FSE'26 from 750 to 855 and regresses two fault types — so it is gated on two
observables of the engine's own rank-1:

| half      | question                                               | refusal rate on the archive |
| --------- | ------------------------------------------------------ | --------------------------: |
| name      | is the rank-1's dominant metric a **duration series**? |   **1 030 / 1 422 (72.4%)** |
| magnitude | did the rank-1's inbound latency rise clear a bar?     |  220 of the 392 that passed |

The name half is a proxy fitted on FSE'26, where the faults were network- and HTTP-shaped and a failed call shows
in `http.server.request.duration`. On RCABench the dominant metrics are `cpu_usage`, `memory` and pod gauges, so
the half refuses seven cases in ten **before any bar is consulted** — the term is present, weighted 3, and silent.
That is a property of the corpus rather than of the number, and no choice of bar (300, a fleet share, or 0) can
lift a gate.

## 2. The question the name half was standing in for

_Is this interface actually failing?_ — and the channel that answers it directly is the failed calls themselves,
which the archive carries on every case (`attr.status_code` on 100% of spans, 1 422 of 1 422 packs).

Two counts, from the same edge set:

```
fraction = max over callees of [ Σ max(0, failed − baseline) ] / [ calls that reached that callee after injection ]
```

- the **numerator** is the term's own quantity: failures beyond the edge's own pre-injection baseline, so a
  permanently broken dependency does not read as this fault's signature;
- the **denominator** is the callee's traffic — **every call it served**, not only the failing ones. A callee that
  fails 5 of its 10 calls from one caller and serves 90 healthy calls from another is failing at 5%, and a divisor
  built from the failing edges alone would report 50% and call the interface broken.

The ratio carries no corpus's units, no corpus's latency scale, and no metric name. It is computable on every case
that carries a status column — including the four cells where `edgeLatency` is empty.

## 3. Where the two counts come from, and why they cost nothing

`countDirectionalInputs` already streams `traces.csv` once per case to build `failedTraceEdges` and `edgeLatency`.
It already counted the calls on each edge (`nPost`, needed for a mean duration) and then **discarded the count**
when it wrote the array. The evidence gate needed exactly that number, summed per callee, and it is now emitted as
`failedEdgeCalls` instead of being dropped — one accumulator per edge, no second read of a 200 000-row file.

This is the repository's oldest defect family in its cheapest form: a quantity computed and thrown away. The same
class as the `ts` column nothing read, the `statusCode` that was always empty, and `root_cause_services` written to
disk with no reader.

## 4. What the channel says about the archive, measured before any arm

Over the 1 422 cases, with the truth defined as the corpus's declared accepted set:

| measurement                                                                                                 |           value |
| ----------------------------------------------------------------------------------------------------------- | --------------: |
| misses under the shipped configuration                                                                      |             814 |
| **misses whose truth is the TOP callee by net failed calls**                                                | **321 (39.4%)** |
| misses in the response-manipulation families (`rrc` 129, `rrm` 67, `ra` 30, `rsa` 26, `rrp` 25)             |             277 |
| misses in the resource/kill families where the channel is empty (`st` 0 of 167, `ck` 0 of 87, `pf` 0 of 23) |               0 |

The split is not a coincidence and it is not a fit: a response-code replacement makes the target's own spans fail,
so the channel names it; a stress or kill fault makes callers time out, and the caller-side spans are self-edges
that the term's own construction already excludes. **Promoting the top failing callee to rank 1 would fix at most
321 cases and break at most 243** — the 243 being the currently-correct cases whose truth is not that callee.

## 5. The bar, and its refusal to be a fitted constant

`fraction` clears a share. The pre-registered scan, over the same 1 422 cases, counting a fix where the truth is
the top callee on a case the engine currently loses and a break where it is not on a case it currently wins:

|    share | admitted | would fix | would break |      net |      final |
| -------: | -------: | --------: | ----------: | -------: | ---------: |
|     0.01 |      945 |       296 |         103 |     +193 |     56.33% |
| **0.05** |      636 |       262 |          64 |     +198 |     56.68% |
| **0.10** |  **492** |   **237** |      **35** | **+202** | **56.96%** |
|     0.20 |      381 |       187 |          18 |     +169 |     54.64% |
|     0.30 |      245 |       123 |           6 |     +117 |     50.98% |
|     0.50 |       65 |        29 |           0 |      +29 |     44.80% |

Both columns are **upper bounds**, because a term over `+3 × normalized` only displaces a baseline gap smaller
than 3: the table prices the gate, not the weight. What it does say is where the population is — the net is flat
across `[0.05, 0.10]` while the breakage halves, so the arms are dispatched at 0.10 and 0.30 rather than at a
point chosen to maximise a bound.

The default `share` stays **0.5** (the strictest, 65 cases, zero predicted breaks), and a run that names no share
gets the bar that cannot hurt: the conservative direction is the default and the arm states its own number.

### The three refusals

- **no evidence** — the graph carries no report (a producer that cannot count calls, e.g. the FSE'26 cache, which
  records failures only). A `0` there would be a measurement of nothing;
- **no fraction** — the callee received no counted call, so the divisor does not exist. Folding it into zero would
  let the absence of a measurement pass a bar of zero;
- **a malformed share** is read as `1`, and a negative one as `0` — the clamp `failedEdgeRiseBar` already applies,
  for the same reason: a number the arithmetic cannot place must not become the loosest bar by accident.

## 6. The arms, and what would make this document wrong

| arm    | configuration                                                    | reads                                              |
| ------ | ---------------------------------------------------------------- | -------------------------------------------------- |
| `ctl`  | shipped (`absolute`, 300 ms)                                     | the published configuration, re-run at this commit |
| `ev10` | `--failed-edge-gate-mode evidence --failed-edge-gate-share 0.10` | the channel                                        |
| `ev30` | the same at `0.30`                                               | the channel, stricter                              |

The prediction this document stakes is **falsifiable in one number**: the paired delta over 1 421 cases must be
positive with **no regressed fault family**, or the gate is refused exactly as the fleet arm was refused
(+44 cases, six families regressed, refused in iteration 233). The engine's acceptance condition has not changed
and this mode gets no exemption from it.

## 7. What this mode does NOT claim

- **It is not a new ranking term.** It is a predicate on the existing one; the weight, the aggregation and the
  normalisation are the shipped ones. The gate decides _whether_ the term speaks, not _what it says_.
- **It says nothing about FSE'26.** That corpus records failure counts and no call counts, so the fraction is
  undefined there and the mode fails closed. Whether the same predicate helps on that corpus is a separate
  measurement that requires a corpus change (a call count per edge), not a code change.
- **It is not the only mechanism in this space.** The deepest-failing-span rule — "attribute the failure to the
  service the operation was actually targeting, not the caller that saw the timeout" — is the same mechanism,
  stated independently by a commercial system that reports 90% on RCAEval and describes fixing exactly this one-hop
  error in its own history. §8 records that as a competitor datum rather than as a corroboration of our number.

## 8. The external statements, and what they are worth

| source                | claim                                                                                                                                        | what it is worth here                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| TheDex (ZOOZ), 2026   | 90% on RCAEval, blind, deterministic; "find the failing span with no failing children"; explicitly excludes pure-latency and resource faults | a claim with no per-case artifact, and the same family split this document measures (§4). Its 90% is stated over an unstated subset of 735 cases |
| `arXiv:2608.21310`    | ten agent configurations on RCABench, Acc@1 42.6% → 90.0%; "correct localization can hide deficiencies in causal reconstruction"             | the frontier on this corpus, and a 500-case random sample rather than a full pass                                                                |
| Alibaba RCA Benchmark | four-layer ground truth including a **causal propagation chain** and evidence checkpoints                                                    | if the chain is released per case, the 547 one-hop misses in §4 stop being a residual and become a measurable target                             |

## 9. The credit: how much of the weight the evidence buys, and why it does not rescue the population

§6 ends with the arm refused: +169 cases and 26 broken, five families regressed. The bar was not the lever
(`ev30`: +166, `st` still −7) and neither was the weight (iteration 234 §234.8: weights 1 / 3 / 6 give 24 / 26 / 28
breaks and 184 / 195 / 195 fixes, with **21 breaks common to all three**). What neither dial touched is the size of
what the term says:

```
contribution(promoted) = failedEdgeWeight × 1.0        — the winner is 1.0 BY CONSTRUCTION
selfAnomaly contribution, median over the same cases   — 0.617
```

A max-normalised score cannot express doubt. The callee failing a tenth of its calls and the callee failing all of
them take the full 3.000, so on every admitted case the term is not a vote but an override, and every break costs a
case the baseline had already answered. The rate that the gate reads — `net / calls` — was used as a boolean and
then discarded.

**The change.** `failedEdgeCredit: 'proportional'` multiplies the normalised standing by that rate and deliberately
does **not** renormalise, so a lone callee failing one call in a thousand scores 0.001 rather than 1.0. A callee
whose calls were never counted scores 0, on the same refusal direction the gate takes. `constant` remains the
default and is byte-identical to the shipped behaviour, and the configuration line names the field unconditionally
because at `constant` it is inert.

**What was predicted.** The breaks are dominated by cases where the promoted service is a *victim* (§234.8: in 16 of
26 the truth never appears in the channel), so its failure RATE should be lower than the source's and the credit
should demote it without touching the 184 cases where the channel names the truth.

**What happened.** Paired over the 1 243 cases both arms reached:

| arm | configuration | paired | control | arm | net | fixed / broken | regressed families |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `ev10` | `evidence @ 0.10`, constant credit | 1 243 | 527 | 686 | **+159** | 184 / 25 | `st` −9, `ck` −2, `pf` −1, `rpb` −1, `rq` −1 |
| `cal10` | `evidence @ 0.10`, proportional credit | 1 243 | 527 | 679 | **+152** | 183 / **31** | `st` −8, `ck` −2, `pf` −1, `rpb` −1, `rq` −1 |

And it is not a weight artifact either: on the 1 125 cases all three arms reached, the proportional credit breaks 27 at
weight 3 and 28 at weight 6 where the constant credit breaks 21, with the fixes flat at 167 / 168 / 168. Raising the
weight does not buy back what the rate demotes.

The credit makes it **worse**: six more breaks and one fewer fix. The mechanism is the opposite of the prediction
and is worth stating precisely, because it inverts what §5 assumed about the same number:

> **A victim's failure rate is the HIGHEST in the case, not the lowest.** A service saturated by propagated load
> fails nearly every call it receives — 100% of them in 11 of the 26 breaks (their failing calls are *all* beyond
> their own pre-window p99). The source, still answering most of its traffic, fails at a moderate rate. So the rate
> is anti-correlated with being the source on this corpus, and multiplying by it promotes the victim harder than the
> constant credit did.

That kills the reading of `fraction` as a *strength* of evidence. It is an **admission** statistic — it answers "is
anything failing here at all", which is the question the name half could not answer — and it is not a confidence in
the *direction*. The two uses are not interchangeable and this arm is the measurement that says so.

### 9.1 The pre-registered falsification, and its result

Iteration 234 §234.9 registered the condition before the arm ran: the change is falsified if the paired sweeps do
not (a) keep at least 180 of the 195 fixes and (b) remove at least half of the 16 blind breaks, with no family
regressing. Measured: (a) 183 kept — passed; (b) blind breaks not reduced, total breaks 25 → 31, families still
regressing — **failed**. The change is retained, tested and off by default, as the recorded answer to the question
rather than a live option, on the same terms `mean` was kept in `failedEdgeMode`.

### 9.2 The last span observable, measured and also empty

Before closing the axis, the client/server split was measured as the remaining form of "which side of the edge the
failure started on". A failing span whose PARENT belongs to its own service is a caller giving up (a deadline); one
whose parent belongs to another service is an interface answering with an error. On the 221 break-and-fix cases the
share of failures that are caller-side is **0.66–0.67 in both populations** (fix p10 0.65, p90 0.67; break p50
0.66). It is a structural property of how these traces are instrumented — roughly two server spans per client span —
and carries no information about the fault. Refuted, cheaply.

### 9.3 What this closes

Five observables have now been measured against the same 16 blind breaks and the same 10 within-channel
mis-rankings: failure onset order, the caller's own onset, the failure-duration ratio, the callee's own p99-ruler
expiry share, the client/server side of the failing span, and the failure rate as a credit. None separates them. The
targeted conclusion is specific and it is the one worth carrying forward:

> **On this corpus the failed-call channel cannot say whether it is looking at the source or at a victim, from span
> data alone.** Counts, timings, durations, durations relative to a service's own healthy distribution, and the
> parent-child shape of the failing span are all exhausted. What remains is corroboration from a *different* channel
> — the promoted callee must carry a metric or log anomaly of its own — and that is a cross-modal conjunction rather
> than another statistic on the same rows.
