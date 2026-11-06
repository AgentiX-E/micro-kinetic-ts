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
