# The trace riser — why the rule did not choose the truth, asked of the candidate instead of the ranking

**Status:** the instrument ships ON, unconditionally, on every cell. No ranking change. `traceRiseFloor`, the
materiality guard the prediction proposed, is **refused by the run that measured it** (§6) — it would have cost
more of the term's wins than the five cases it was aimed at are worth. What the run leaves standing is a different
axis: **scale-relative significance** (`[trace-z]`), measured in units of each count's own fluctuation rather than
as a percentage, and not built here.

**Owner of:** `CasePrediction.traceRiser`, the `[trace-riser]` census (one line per vote plus one total), and
`riserVectorOf`.

## 1. The question the previous three instruments left open

The trace term pays one binary unit to the **unique** service whose post-injection span count rose above its own
pre-injection count. It is the only term in the formula whose value is a decision rather than a magnitude, and it
is pinned ON for RE3 alone.

Three instruments have now read it, and each one closed a shape of explanation:

| instrument             | reading                                                                                                       | what it closed                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `[term-gap]`           | `trace = +1.000` on 5 of TrainTicket RE3's 11 misses                                                          | the term is the **largest cost** on the blocking cell                                     |
| removal arm            | `trace_weight` 0 / 1 / 2 → RE3 **51 / 61 / 61**                                                               | the pin is worth **+10 cases**; the weight axis is a plateau                              |
| `[trace-vote]` + ranks | `votes=20 hits=15`, all **5** wrong votes became top-1; `atMax=2/2, rank2-3=0/0, rank4-10=3/0, rank11+=15/13` | the leader mask (`traceSkipsLeader`, null on all nine cells) and the tail-only refinement |

What survives all three: the five wrong votes are **not rank-structured**. The two loudest votes are both correct;
the non-tail votes are 2 of 2 right and 0 of 3 wrong; the errors sit at rank 4–10 and rank 11+ in a 3/2 split that
no threshold on rank can separate. So the separator, if one exists, is a property of the **candidate**.

## 2. The two candidate properties that can separate a source from a victim

A **source** does more work per request: its span count rises, and the failures beside it point AT its interface.
A **victim** is re-routed traffic or a retry storm: its span count rises because somebody else's calls arrived,
and the failures beside it are the ones it reports about its own callee.

Both are already on the case, and the rule reads neither:

| quantity                                                                   | where it comes from                                          | why it is the right shape                                                                        |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `pre`, `post`, `growth = post/pre`                                         | `countTraceActivityByService` (the same pass the rule reads) | the rise is the rule's **entire** evidence; a materiality test needs its size, not just its sign |
| `failedIn` = Σ max(0, failed − baseline) over edges **into** the candidate | `countDirectionalInputs` → `failedTraceEdges`                | a broken service is what its callers' errors are emitted ABOUT                                   |
| `failedOut` = Σ over edges **out of** it                                   | the same array                                               | a victim reports its callee; the failures it makes are not its signature                         |

`failedIn` and `failedOut` are measured on the same edges the failed-edge-DIRECTION term reads, so nothing new is
loaded, streamed or stored: the census costs one pass over an array the runner already built.

## 3. The instrument

One line per vote, and the truth beside it whenever the vote was wrong — the comparison is the data, and on a hit
the two sides are the same measurement:

```
[trace-riser] <caseId> MISS vote=<svc> pre=1770 growth=1.40 failedIn=+0 failedOut=+18 || truth=<svc> pre=310 growth=1.62 failedIn=+3 failedOut=+0
[trace-riser] <caseId> HIT  vote=<svc> pre=1770 growth=1.40 failedIn=+0 failedOut=+0
[trace-riser] total votes=20 hits=15 wrong=5 | truth-unmeasured=0 truth-pre<500=… truth-rise<1.15=… truth-qualified=0
```

Three rules the rendering keeps, because each is a distinction a reader would otherwise have to reconstruct:

- **A measurement that was not taken prints as `-`**, never as `0`. A case with no trace file has no vector at all;
  a service that appears in no span of a case that _does_ carry counts has `pre: 0, post: 0` — measured zeros, and
  the difference between them is the difference between "silent" and "unmeasured".
- **A ratio with no denominator is absent.** `growth = 0` would read as "did not rise" and `1` as "flat"; neither
  is a measurement, so the field is simply not there.
- **The sign on a failure count is explicit** (`+0`, `+18`), so a zero cannot be read as a missing value.

## 4. The attribution, and the invariant inside it

A wrong vote means the truth failed one of the rule's two candidate guards — `pre >= minPreCount` (500) and
`post/pre >= riseThreshold` (1.15) — because a truth that passed both would have been a candidate: either it would
have been the vote (a hit), or there would have been two candidates and the rule would have abstained.

So the census walks the **same two guards in the same order**, and prints a bucket for each plus
`truth-qualified`: wrong votes whose truth met both. That last bucket must be **zero**, and printing it is how the
two implementations stay tied — the thresholds come from `DEFAULT_TRACE_ACTIVITY_OPTIONS`, the rule's own constant,
so the label cannot name a number the rule stopped using, and a non-zero count means this census and the rule
disagree rather than that the corpus is strange.

## 5. The prediction, written before the run

On TrainTicket RE3, `minPreCount = 500` is an **absolute** count and TrainTicket's fleets differ by an order of
magnitude in traffic. The rule's documented basis is one service at `pre = 1770–1895`; a wrong-value fault in a
mid-volume service would sit well below 500 and never enter the window at all.

**Prediction:** most of the five wrong votes are `truth-pre<500` — the truth was never a candidate — and the rest
are `truth-rise<1.15`, a truth that was inside the window and flat. If that holds, the finding is about the GUARD
rather than about the concept: an absolute floor is a statement about one deployment's traffic, and the refinement
it proposes is `traceRiseFloor`, a **materiality** guard on the rise (`post − pre`, the extra work the source
actually did) which admits a small service that did a third more work while rejecting a 30 → 60 span doubling that
adds thirty spans.

If instead the misses are `truth-rise<1.15`, the rule's concept does not apply to those cases and the axis closes
on the mechanism rather than on a threshold. Both outcomes are decidable from one run, which is the only reason to
print the attribution rather than argue about it.

## 6. What it read: the truth FELL, and the floor is dead before it was built

Run `40735156264`, commit `8469cf2`, RE3 — the only suite where the term is on:

```
RE3 OnlineBoutique  votes=1  hits=0  | truth-pre<500=1 truth-rise<1.15=0 truth-qualified=0
RE3 SockShop        votes=0  (abstains on all 30)
RE3 TrainTicket     votes=20 hits=15 | truth-pre<500=0 truth-rise<1.15=5 truth-qualified=0
```

The five wrong votes, verbatim, because every claim below is a reading of these five lines:

```
ts-route-service_f2_2  vote=ts-order-other-service pre= 1846 growth=1.16 || truth=ts-route-service pre=12027 growth=0.91
ts-route-service_f2_3  vote=ts-station-service     pre=22497 growth=1.24 || truth=ts-route-service pre=12261 growth=0.94
ts-route-service_f3_5  vote=ts-station-service     pre=31957 growth=1.47 || truth=ts-route-service pre=12516 growth=0.82
ts-route-service_f4_2  vote=ts-station-service     pre=29769 growth=1.24 || truth=ts-route-service pre=12006 growth=0.93
ts-route-service_f4_3  vote=ts-station-service     pre=35463 growth=1.17 || truth=ts-route-service pre=12114 growth=0.92
```

All fifteen hits, by contrast, are **one service**: `ts-auth-service` at `pre = 1745–1895`, `growth = 1.17–2.22`.

**Finding 1 — the prediction is refuted on its first half, and the invariant held.** `truth-pre<500 = 0` on
TrainTicket: not one wrong vote was excluded by the absolute volume floor. The one case that was is Online
Boutique's `emailservice` at `pre = 122` — a different cell, and its only vote. `truth-qualified = 0` on both
cells, so this census and the rule still agree about what the rule accepts.

**Finding 2 — all five misses are `truth-rise<1.15`, and the truth's count went DOWN.** 0.82–0.94 on
`pre ≈ 12 000`, i.e. 700–2 200 spans that the fault removed. The rule's premise — _a source does MORE work per
request_ — is false on exactly the cases it misses: on TrainTicket's route faults the source does **less**. This
is the register's own `trace (source ratio < 1)` channel, now counted instead of mentioned: **5 of 5**.

**Finding 3 — `traceRiseFloor` is dead, and the reason is the shape of the two populations.** The misses' absolute
gains are `+295, +5 399, +7 145, +6 029, +15 020`; eight of the fifteen hits gain only `+309 … +389`. A materiality
floor high enough to exclude the misses would exclude most of the term's wins, because the misses are not small
rises at all — they are **large services with modest ratios**, while the hits are small services with large ones.

**What that leaves.** The separating axis is neither rank nor materiality: it is **scale-relative significance**. A
ratio threshold means different things at different volumes — at 1 800 spans a 17% rise is ~300 spans, at 12 000 a
7% fall is ~840 — so it is loud for small services and deaf for large ones, and `minPreCount = 500` is a crude
absolute patch on exactly that deafness. Measuring a count change in units of its own fluctuation (σ ≈ √count on
independent spans, the Gaussian fluctuation law of the kinetic limit, with the fleet's own drift removed first)
puts both populations on one axis. That is the next instrument (`[trace-z]`) and it is not built here.

## 7. What this does not license

- **It does not enrol anything.** `traceRiseFloor` was proposed by a census and killed by the run that measured it,
  before an arm was ever dispatched — which is the outcome the prediction was written down to make possible.
- **`failedIn`/`failedOut` are not yet read by any term**, and on this corpus they are nearly silent: `+0` on all
  twenty TrainTicket votes and on the Online Boutique one. A direction term built on a vector that reads zero
  everywhere would be a term that cannot fire, and that is now a measurement rather than an assumption.
- **A hit is not evidence for the vector.** The 15 correct votes say the rise rule works on one service; they say
  nothing about whether failure direction predicts the 5 it misses.
- **The five misses are not five independent findings.** They are five route-service cases from three fault types
  (`f2` twice, `f3` once, `f4` twice) and share one mechanism; a rule fitted to them is a rule about route, and the
  next instrument has to show the axis generalises before any weight moves.
