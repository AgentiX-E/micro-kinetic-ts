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

**What was predicted.** The breaks are dominated by cases where the promoted service is a _victim_ (§234.8: in 16 of
26 the truth never appears in the channel), so its failure RATE should be lower than the source's and the credit
should demote it without touching the 184 cases where the channel names the truth.

**What happened.** Paired over the 1 243 cases both arms reached:

| arm     | configuration                          | paired | control | arm |      net | fixed / broken | regressed families                           |
| ------- | -------------------------------------- | -----: | ------: | --: | -------: | -------------: | -------------------------------------------- |
| `ev10`  | `evidence @ 0.10`, constant credit     |  1 243 |     527 | 686 | **+159** |       184 / 25 | `st` −9, `ck` −2, `pf` −1, `rpb` −1, `rq` −1 |
| `cal10` | `evidence @ 0.10`, proportional credit |  1 243 |     527 | 679 | **+152** |   183 / **31** | `st` −8, `ck` −2, `pf` −1, `rpb` −1, `rq` −1 |

And it is not a weight artifact either: on the 1 125 cases all three arms reached, the proportional credit breaks 27 at
weight 3 and 28 at weight 6 where the constant credit breaks 21, with the fixes flat at 167 / 168 / 168. Raising the
weight does not buy back what the rate demotes.

The credit makes it **worse**: six more breaks and one fewer fix. The mechanism is the opposite of the prediction
and is worth stating precisely, because it inverts what §5 assumed about the same number:

> **A victim's failure rate is the HIGHEST in the case, not the lowest.** A service saturated by propagated load
> fails nearly every call it receives — 100% of them in 11 of the 26 breaks (their failing calls are _all_ beyond
> their own pre-window p99). The source, still answering most of its traffic, fails at a moderate rate. So the rate
> is anti-correlated with being the source on this corpus, and multiplying by it promotes the victim harder than the
> constant credit did.

That kills the reading of `fraction` as a _strength_ of evidence. It is an **admission** statistic — it answers "is
anything failing here at all", which is the question the name half could not answer — and it is not a confidence in
the _direction_. The two uses are not interchangeable and this arm is the measurement that says so.

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
> parent-child shape of the failing span are all exhausted. What remains is corroboration from a _different_ channel
> — the promoted callee must carry a metric or log anomaly of its own — and that is a cross-modal conjunction rather
> than another statistic on the same rows.

## 10. The cross-modal conjunction, and why it cannot be the next step either

§9.3 named the next hypothesis before this iteration ran: the term may speak only when the promoted callee carries
a metric or log anomaly **of its own**. The registration was specific — remove at least half of the breaks with ≥ 180
of the 195 fixes kept and no family regressing — and the hypothesis is refuted at three strengths, two of them
without a benchmark run.

The population throughout is the 221 cases the `ev10` arm moved (195 fixed, 26 broken) on the 1 303-case paired
RE3:TrainTicket sweep. Four new measurements were taken on the corpus itself, at the per-edge level the engine
cannot print: net failed calls after the pre-injection baseline, per ordered pair, per callee.

### 10.1 The literal predicate is total, so it admits nothing back

Every rankable node in these cases carries a metric anomaly, and none of the 26 breaks carries a log one:

| population | promoted callee's `selfAnomalyLog1p` contribution | log contribution                                     |
| ---------- | ------------------------------------------------- | ---------------------------------------------------- |
| 195 fixes  | min 0.021 · p25 0.617 · median 0.672 · max 0.693  | —                                                    |
| 26 breaks  | min 0.031 · median 0.545 · max 0.693              | `0.000` in 26/26 (`INPUT_MAP_EMPTY` or `VALUE_ZERO`) |

So "carries a metric or log anomaly of its own" is true of 26 of 26 breaks. The predicate is not a filter, it is a
tautology on this corpus, and the falsification condition is met at the definition rather than at an arm.

### 10.2 The two forms with teeth, both of which cost more than they buy

The hypothesis deserves its strongest readings before it is dismissed, so both were measured exactly — a rule that
only refuses is exactly evaluable offline, because a refused case returns to the control ranking, which is known per
case.

| reading of "carries an anomaly of its own"              | fixes kept / 195 | breaks killed / 26 | net vs the arm's 725 |
| ------------------------------------------------------- | ---------------: | -----------------: | -------------------: |
| magnitude: promoted anomaly ≥ 0.65                      |              135 |                 10 |              **−60** |
| magnitude: promoted anomaly ≥ 0.30                      |              175 |                  7 |                  −25 |
| ordering: promoted anomaly ≥ the displaced candidate's  |               55 |                 17 |             **−140** |
| structure: promoted callee needs ≥ 2 contributing edges |               88 |                 19 |                 −107 |
| structure: ≥ 2 distinct callers (identical population)  |               88 |                 19 |                 −107 |

The ordering row is the one that matters, because it inverts the premise the whole hypothesis rests on:

> In **140 of the 195** cases the term gets right, the service it promotes has a **lower** anomaly than the one it
> displaces. That is not a defect — it is the collision-source picture working: the propagation victim carries the
> larger response anomaly, and the source carries the smaller, earlier one. A rule that requires the promoted
> candidate to be at least as anomalous as the displaced one therefore deletes the term's successes and keeps its
> failures.

### 10.3 The channel's ceiling, measured

The per-edge ledger also answers why no gate ever fixed these 26. In **15 of the 26 breaks the truth carries
ZERO net failed-call charge**: no caller reported more failures against it after the injection than before, so the
channel has no row about the service at all. Those cases are not mis-ranked by the direction term, they are
_invisible_ to it — the best available answer is the baseline's, and the term can only be told to stay silent.

| where the 26 breaks come from                 | cases |
| --------------------------------------------- | ----: |
| truth has no charge at all (channel is blind) |    15 |
| truth has a charge, promoted callee has more  |    11 |

That is the channel's ceiling on this corpus: **206 of the 221 moves are recoverable, 15 are not.** A gate can at
most convert those 15 into refusals, which is a different acceptance question from the one the arm was measured
against.

### 10.4 Three further refutations, recorded so they are not re-proposed

- **Edge structure.** Contributing edges and distinct callers per promoted callee have identical distributions in
  the two populations — median 1 edge and top-edge share 1.0 in both. The channel is thin everywhere; thinness is
  not the discriminator.
- **Flux conservation.** Charging a callee only for what its own outgoing failures do not explain
  (`max(0, raw − out)`), and the exact push-down variant that moves the explained charge to the callee it left
  through, both recover **3 of the 26** breaks and change nothing on the fixes. The propagation is real but only
  partial: in the breaks the promoted callers explain 5–30% of their own inbound charge, not all of it.
- **Topological relation.** The FSE'26 note that the promoted callee is an ancestor of the truth holds on 25 of 26
  breaks — and on 45 of the 195 fixes as well, where the term moved _up_ correctly. Direction of the move does not
  separate the two populations either.

## 11. The one rule the measurement does support: a mutually failing pair

The ledger's per-pair view exposes a defect none of the case-level statistics could see. The direction term charges
a failed call to its **callee**, so `a → b` failing names `b`; when `b → a` fails as well, the same two services
support both statements, and the only thing that can order them is traffic — a property of the graph, not a
hypothesis about the fault.

`failedEdgeMutualRule` makes that a decision:

- `credit` — the shipped behaviour. Both charges stand, as if each had spoken alone.
- `drop` — both charges of the pair are removed **before normalisation**, so neither end is credited with a
  direction it cannot support and the survivors are rescaled against what remains. The term goes on to speak about
  the next candidate instead of falling silent, which is why this is a rule and not a gate.

The rule is a statement about a PAIR rather than a callee: a service that fails in both directions with one
neighbour may still be the right answer for another neighbour's failures. And `mutual` is read after every filter
the signal already applies — baseline subtraction, self-edges, endpoints outside the rankable graph, the record
floor — so a row the engine never counted cannot mute one it did.

Measured on the same 221 cases, in two steps that disagree, and the disagreement is the finding:

- The **offline probe** that motivated the rule compared the two services' failure counts and reported a mutual
  pair on 8 of the 26 breaks. It was reading its own join of `traces.csv`, and the pair it found was a **path**
  (the promoted callee reaches the displaced candidate through failing edges), not a pair.
- The **engine's own directional input** contains **no mutually failing pair between distinct services on any of
  the 221 cases** — 0 of 221, measured through `countDirectionalInputs`, the function that produces the rows the
  rule reads. The pairs that look mutual in a raw join are self-edges (`a → a`, a client span inside its own
  service), which the ledger already drops before the rule.

So the arm is **byte-identical to the credited one on all 1 303 paired cases** (725 correct either way), and the
rule ships off by default as the correct answer to a question this corpus does not ask. What the probe actually
measured — a _return path_ rather than a pair — is a different and stronger rule, and it is registered as the next
iteration's first task rather than smuggled in under this name:

> Refuse an override when the promoted callee can reach the displaced candidate through failing calls. Offline, on
> the same 221 cases, that reaches **8 of the 26 breaks and none of the 195 fixes**. It is not shipped here because
> the number comes from the probe's join, not from the engine's, and this section exists because that difference
> was worth catching once.

## 12. The return path: the rule that survives the engine's own join

§11 registered this before it was built, with its acceptance condition stated in advance: refuse an override when
the promoted callee can reach the displaced candidate through failing calls; refused unless it removes at least
four of the remaining eighteen breaks with at least 190 of the 195 fixes kept.

The registration also carried the reason §11 could not just ship it: the "8 of 26" it quoted came from a probe
that built its OWN join of `traces.csv`, and §11 had already caught that probe measuring a path rather than a
pair. So this iteration asked the question twice, in the two forms that matter.

### 12.1 Two readings of one rule, and why the engine can only use the second

| reading  | question it asks                                                                                       | measurable offline                                         | measurable in the engine                                                   |
| -------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| targeted | can the promoted callee reach **the displaced candidate**?                                             | yes, because the counterfactual champion is known per case | **no** — the ledger cannot see what the ranking would have said without it |
| engine   | does the promoted callee have a net failed-call edge into **another callee the channel also charges**? | yes                                                        | yes                                                                        |

The second is strictly stronger on this corpus: 12 of the 26 breaks rather than 8, and still none of the 195
fixes. It is also the only one the engine can act on, which decides the question — a rule the ledger cannot
evaluate is a rule that can only be applied outside it, and this repository does not ship ranking logic in a
runner.

### 12.2 The measurement, through `countDirectionalInputs`

Population: the 221 cases the `ev10` arm moves (195 fixed, 26 broken) on the 1 303-case paired RE3:TrainTicket
sweep. Input: `countDirectionalInputs(traces.csv, injectTimeMs)` — the function that produces the rows the ledger
reads, not a second join.

| population | cases with a net rise into another charged callee | of 195 / 26 |
| ---------- | ------------------------------------------------: | ----------: |
| fixes      |                                             **0** |    0 of 195 |
| breaks     |                                            **12** |    12 of 26 |

The pre-registered acceptance condition (≥ 4 of the remaining 18 breaks, ≥ 190 of 195 fixes) is met by a factor of
three on the first count and with nothing lost on the second, so the rule was built and armed.

### 12.3 The arm read 846, and the difference from the projection was a defect

The projection above assumed a refused override returns to the control ranking, which is exact per case but
describes only ONE way the rule can act. The arm came back at **846 of 1 303 (64.93 %)** against the projected 737:

| arm                                  |           correct | vs control |
| ------------------------------------ | ----------------: | ---------: |
| shipped (`absolute` bar, term inert) |     556 (42.67 %) |          — |
| `evidence @ 0.10`                    |     725 (55.64 %) |       +169 |
| `evidence @ 0.10` + `return-path`    | **846 (64.93 %)** |   **+290** |

`+121` over the evidence arm, ten times the projection — and 9 cases broken. Both facts have one cause, and it is
not the rule's statistics:

| how the arm differs from `ev10`                               |                       cases | the term's `failedEdge` contribution |
| ------------------------------------------------------------- | --------------------------: | ------------------------------------ |
| the gate had REFUSED the term, and admitted it under the rule | **105 recovered, 9 broken** | 0 → 3 000                            |
| the gate admitted the term in both arms                       |      23 recovered, 0 broken | unchanged                            |
| the gate admitted it before and refuses it under the rule     |                 2 recovered | 3 000 → 0                            |

**The rule was moving the gate.** `evidence.fraction` is `topNet / topCalls` over the credited callees, so removing
a large charge raises the share of the survivors — and on 105 cases that lifted the fraction over the 0.10 bar on
a case the channel had correctly refused. 105 of those flips happened to be right and 9 happened to be wrong, and
both are luck: the rule was answering a question it was never asked.

This is a defect class worth naming, because nothing in the rule's own tests could see it: the rule is about
**which credited service may override the ranking**, the gate is about **whether this case's failed calls are
enough to speak at all**, and the second answer cannot depend on the first. The 9 breaks say so directly — six of
them name `ts-basic-service`, the loudest SURVIVOR of the removal, on cases where the control ranking had already
been correct.

### 12.4 The fix: the gate reads a snapshot taken before the rule

`gateNet` and the credited set are now snapshotted **after the mutual-pair rule and before the override rule**, and
the evidence report is read from that snapshot. The split is the two rules' semantics, not an implementation
convenience:

- the **mutual-pair** rule denies that the evidence exists (both ends of the pair are not evidence), so it may
  change the gate;
- the **override** rule denies one service the right to override, which is a statement about a speaker and not
  about the case, so it may not.

| arm                                     |           correct | vs control | breaks vs `ev10` | recovers vs `ev10` |
| --------------------------------------- | ----------------: | ---------: | ---------------: | -----------------: |
| `evidence @ 0.10`                       |     725 (55.64 %) |       +169 |                — |                  — |
| `return-path`, gate fed by the rule     |     846 (64.93 %) |       +290 |            **9** |                130 |
| `return-path`, gate fed by the snapshot | **750 (57.56 %)** |   **+194** |            **0** |             **25** |

The published claim is the last row. `+25` is the rule's real contribution, and it is the first change in this
family that adds cases with **no case lost and no family made worse than the arm's own table**.

### 12.5 Why zero of 195 is not luck

The rule fires on a shape, not on a statistic: a credited callee that has its own net rise against **another
credited callee**. For it to fire on a fix, the term's winning candidate would have to be the middle of a failing
chain — a service charged by something upstream and charging something downstream, both credited. The term does not
win those cases, and the reason is the one §10.2 measured from the other side: the source carries the smaller,
earlier anomaly and the victim the larger. The population the rule removes and the population the term gets right
are disjoint by construction rather than by threshold.

The corrected arm is the evidence: **0 breaks, 25 recovers**, and the 25 are the cases where removing a middle link
let the end of the chain win.

### 12.6 Order, and what the ordering protects

Three rules now touch the same ledger, and their order is asserted rather than incidental:

1. **baseline subtraction, self-edges, out-of-graph endpoints** — the filters that decide which rows are evidence;
2. **the mutual-pair rule** (off by default) — removes both charges of a pair that fails both ways, and MAY change
   the gate, because it denies the evidence exists;
3. **the override rule** (off by default) — removes the charge of a credited callee contradicted by another
   credited callee and rescales the survivors, and may NOT change the gate, because it is about a speaker.

The override test is taken against a **snapshot** of the credited set, so it does not depend on the order the
services happen to be visited in. It reads the same `counted` rows the scores are built from, which makes both of
these true by construction: a row the engine never counted cannot contradict, and a callee below the record floor —
not a credit the term could spend — can neither contradict nor be contradicted.

### 12.7 The external statement this agrees with

An observability vendor's 2026 engineering note states the convention this rule encodes, from the operations side
rather than the measurement side: _"A depends on B. For an alarm on A, root-cause candidates follow OUTGOING
edges"_ — and, in the same note, _"an observed call is not necessarily a dependency"_, because a service may call
something and ignore the response. Both halves are the claim the ledger now makes: a failed call points DOWNSTREAM,
so the candidate is the callee, and a service that is itself calling something that failed is a candidate only if
nothing further down is also charged.

The same cycle's `TopoEvo` (topology-constrained multi-agent hypothesis–evidence–test) attacks the identical
problem — separating the initial anomaly from the cascade-amplified downstream symptoms — with role agents and
tests. That is a different instrument for the same distinction, and it is the one a single-pass ranker cannot
afford: the measurement above says the distinction is worth 25 cases here, and it is available from the call graph
alone.

### 12.8 What is left, counted

After the rule, **14 breaks remain**, and the ledger says exactly what they are:

| property                                                        |        count | meaning                                                                   |
| --------------------------------------------------------------- | -----------: | ------------------------------------------------------------------------- |
| the displaced candidate carries **no** charge                   | **14 of 14** | the anomaly champion the term overrode was invisible to the error channel |
| the truth carries no charge                                     | **13 of 14** | the channel has no row about the actual source either                     |
| the truth carries a charge but the promoted callee carries more |      1 of 14 | the only remaining case the channel can see                               |

So the 26 breaks decompose cleanly for the first time: **12 the return path removes, 14 the channel cannot see at
all.** Those 14 are `st` ×8, `rrc` ×2, `ck` ×2, `rrm` ×1, `pf` ×1, and they are also the entire remaining family
regression (`st` −10, `ck` −2, `pf` −1 — the same three the evidence arm has, because the corrected rule changes
nothing on cases whose gate refuses the term).

Nothing inside the error channel can separate them, and the measurement says why: the promoted service is the
truth's **caller** in most of them (`seat → order`, `inside-payment → payment`, `basic → station`, `route-plan →
travel2`, `consign → consign-price`), so the term names the upstream end of a call that failed while the downstream
end answered normally — which is what a saturation fault looks like when only the client side times out.

That is a statement about the MODALITY rather than the statistic, and it is where the next iteration has to work:
the error channel cannot see a service that keeps answering, and the latency channel — already in the ledger as
`edgeLatency` — is the one that records the call the client waited too long for.

---

## 13. The latency channel, read on those fourteen — and the axis this closes

§12.8 ended with a prediction: the fourteen breaks it could not explain are cases where the promoted service is
the truth's **caller**, so the latency channel — which records the call the client waited too long for — is the
one that should separate them. This section measures that prediction and refuses it.

Two corrections to §12.8 have to be made first, because the numbers below are read against the ARM and §12.8's
table was read against a PROJECTION:

| quantity                                    | §12.8 (projected) | measured on the arm |
| ------------------------------------------- | ----------------: | ------------------: |
| breaks remaining after the rule             |                14 |              **16** |
| of those, the displaced candidate uncharged |          14 of 14 |            16 of 16 |
| of those, the truth uncharged               |          13 of 14 |        **13 of 16** |

The projection assumed the rule can only REFUSE an override, so it could not see the 15 cases where removing a
middle link let a different credited callee win. The decomposition's shape survives — the channel is blind to
both ends — but the population is 16, not 14, and this section is measured on the 16.

### 13.1 The population, and the effect model that makes an offline reading exact

Population: the 1 303 paired cases of the `return-path` arm (750 correct, 210 fixed over control, 16 broken over
control). Input: `countDirectionalInputs(traces.csv, injectTimeMs)` — the same join the ledger reads.

The offline reading of a **gate** is exact rather than approximate, and the reason is structural: a refused gate
returns the baseline ranking (`if (!admitsFailedEdgeTerm(...)) return baseline`), so `new prediction = control
prediction`, case for case. Nothing else in the pipeline reads the term when it is refused. That is not true of a
RULE, which is why §12.2's projection was off by 13 cases.

### 13.2 Four parameter-free predicates, measured

Each is a statement about the **baseline rank-1** — the gate's only legitimate subject — and none carries a
fitted constant:

| predicate                                                           | fires | fixes | breaks | net |
| ------------------------------------------------------------------- | ----: | ----: | -----: | --: |
| some outbound edge of it rose more than its own inbound rise        |   285 |     0 |     38 | −38 |
| some CALLEE of it carries a larger inbound rise than it does        |   393 | **1** |     42 | −41 |
| the same, at twice the level                                        |   177 |     0 |     30 | −30 |
| some callee of it is slower AND itself carries a failed-call charge |    60 |     0 |     22 | −22 |

**Every one of them fires on at most one of the 16 breaks**, and each costs between 22 and 42 cases the term was
carrying. The reason is not a threshold: the baseline rank-1 in these 16 IS the truth, and the truth is the deepest
service in its chain — a predicate of the form "something downstream of it is slower" is false of a source by
construction. The channel cannot contradict a correct answer.

### 13.3 The structural reading, which nearly works and does not

The one predicate that reaches the population is about the relation between the gate's subject and the ledger's:

> refuse when the service the failed calls are charged to **calls** the baseline rank-1.

That is the symptom-amplification shape stated directly — the middle of the chain is charged, the end of the chain
is the current answer — and it is not circular: both quantities are already computed, and the rank-1 comes from the
baseline ranking rather than from the term.

| form of the predicate                                    | fires | fixes | breaks | net |
| -------------------------------------------------------- | ----: | ----: | -----: | --: |
| top charge calls the baseline rank-1                     |   339 |    13 |     19 |  −6 |
| … and that edge's rise clears 1                          |   178 |    11 |      9 |  +2 |
| … and the rank-1's own inbound rise exceeds the charge's |   257 |     6 |     14 |  −8 |

It finds **13 of the 16** and loses **19** cases where the term was right _because the caller is the source_ — a
fault in `t` makes `t`'s callers fail, `t` is charged, and `t` happens to call the baseline's answer. The two
populations overlap in the feature and separate in nothing else that was tried: the charge magnitude, the failure
rate, the two rises, and the rank-1's own self-anomaly were each measured, and each is bimodal with the wrong
sign or no sign (§5's `fraction` already gates the whole population at 0.10 and both halves clear it).

### 13.4 What this closes, and what it hands on

The two-regime reading is refused: **the latency channel does not separate the 16.** It is not a matter of the
statistic — no bar, share or shape over `edgeLatency` was left untried that is defined on this population — but of
the MODALITY: the cases are ones where the control was right, and a channel can only help by contradicting an
answer; a correct answer is not contradicted by its own chain.

The 16 breaks are 1.2 % of the arm's 553 remaining misses, and the census in `docs/level-blind-census.md` says the
other 98.8 % is where the work is: **182 misses where the truth's own level rose at least threefold**, of which
**61 were scored below 0.1 by the engine's own anomaly** — a detector question, measured on the input rather than
on the engine's opinion of it, and one that no amount of work inside the failed-edge ledger could reach.

So this register's failed-edge family ends here: the term is measured at +194 over control with 0 cases lost
against its own predecessor arm, the remaining breaks are structural, and the next lever is the guard.
