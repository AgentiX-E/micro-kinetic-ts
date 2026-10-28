# The trace riser — why the rule did not choose the truth, asked of the candidate instead of the ranking

**Status:** the instrument ships ON, unconditionally, on every cell. No ranking change. The refinement it is built
to decide (`traceRiseFloor`, a materiality guard on the rise) is **proposed**, not enrolled: a census proposes and
an arm decides.

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

## 6. What this does not license

- **It does not enrol anything.** The floor is a proposal; the nine cells decide it. Every refinement this axis
  has produced so far (`traceSkipsLeader`, `traceTailOnly`) was killed by measurement, and the prediction above is
  written down precisely so that this one can be too.
- **`failedIn`/`failedOut` are not yet read by any term.** They are recorded here because a source/victim split is
  the shape the evidence has; whether the split holds is what the run says, and a term built on a vector nobody
  measured is the defect this file exists to avoid.
- **A hit is not evidence for the vector.** The 15 correct votes say the rise rule works; they say nothing about
  whether failure direction predicts the 5 it misses.
