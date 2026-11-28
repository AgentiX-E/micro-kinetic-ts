# The trace vote's rise measured against the fleet's own move

**Status:** instrument only. `[trace-share]` ships ON, unconditionally, on every cell, and reads evidence the
runner already records. **No ranking change**: the trace rule still votes on `post/pre >= 1.15` with
`pre >= 500`, and the floors this census simulates are not reachable from any configuration. The arm that flips
the rule is a separate iteration with its own dispatch.

## 1. The five refusals, and what they have in common

The trace term pays one binary unit to the unique service whose span count rose. Five refinements have been
refused by measurement on TrainTicket's 30 RE3 cases, where the term votes 20 times and is right 15:

| refinement | refused because |
| --- | --- |
| a WEIGHT (any magnitude) | the term is binary; a magnitude is a second decision the data does not support |
| `traceSkipsLeader` (withhold from the loudest) | the mask's population is 2 votes and both are correct |
| `traceTailOnly` (tail votes only) | the non-tail votes are 2 of 2 right |
| `traceRiseFloor` (a materiality floor on the rise) | the misses gain `+295 … +15 020` spans while eight of the fifteen hits gain only `+309 … +389` |
| `[trace-z]` (Poisson significance, `z >= 3`) | big counts make everything significant: `zAbs` votes 0 on TrainTicket, `zUp` surrenders 13 of the 15 hits |

Every one of the five is a statement about the **size of the rise** or about the **standing of the riser**. And
the riser census's per-case lines say why they all had to fail:

```
15 hits    vote=ts-auth-service            growth 1.17-2.22    fleet drift 0.05-0.11
 5 misses  vote=ts-station-service / ts-order-other-service
                                           growth 1.16-1.47    fleet drift 0.79-0.99
```

**The rise is the same in both populations.** 1.16 appears on both sides of the ledger. No function of the rise
alone — no threshold, no floor, no exponent, no significance bar — can order a set whose two classes overlap on
that variable. That is not a claim about thresholds; it is why five of them failed.

What differs is what the **rest of the system** was doing. On the fifteen hits the fleet lost about 92% of its
spans and the candidate kept its count. On the five misses the fleet was stable and the candidate rose by a
fifth. The first is a service holding a system together; the second is ordinary load variation in a service that
happens to be the largest riser of thirty.

## 2. The axis

```
share = growth / drift,      drift = median over graph members of (post / pre)
```

`drift` is the fleet's **common-mode move**: under the kinetic reading it is the change every service would show
if none of them changed its work per request, so the quotient is the change in the candidate's **share** of the
system's work. Three properties follow, and each is a case in the tests:

| situation | `share` | reading |
| --- | ---: | --- |
| the candidate rises exactly with the fleet | 1.00 | its share did not move: nothing happened here |
| the candidate holds its count while the fleet collapses to 8% | ≈ 12.5 | whatever happened, this service is where the work still is |
| the fleet emitted nothing after the injection | — | no yardstick, so no share; the census reports `unmeasured` |

The estimator for `drift` is the one `trace-z.md` measured and kept: the **unweighted median** of the per-service
ratios. A volume ratio `Σpost / Σpre` absorbs the fault's own service into the denominator, and the five misses'
truth is exactly a large service; weighted medians have the same defect for the same reason. One observation per
service means the fault is one vote out of sixty-eight rather than the ruler.

## 3. The four floors, and why the sweep is the instrument

A single floor would be a number chosen out of a range, which is the defect the weight search was corrected for
(`docs/fse26-discriminator-verdict.md` §20–§22). Four are simulated instead — `2, 3, 5, 8` — and the record is
the pair `withdrawn` against `surrendered`:

- `withdrawn` — votes the floor withholds;
- `surrendered` — withheld votes that **would have named the truth**;
- `net = withdrawn - surrendered` — the **wrong** votes removed, i.e. the cases a floor could win.

`net` is the only quantity the decision is read on, and it is printed rather than left to the reader. It is an
**upper bound**: withholding a vote does not make a case correct, it hands the case back to the rest of the
ranking. The honest claim from this record is "this floor removes five wrong votes and gives up none"; the arm
that flips the mode is what converts it into cases.

The corpus's own gap is what makes a floor findable at all. Over both RE3 cells' top-ranked services the largest
non-source share measured is `4.3` and the smallest source share is `10.7` — a 2.5× empty interval. A floor
inside it is a statement about the data; a floor outside it is a fitted constant.

## 3a. The upper bound, resolved from the loss census

The bound was not left to the next arm. The run that produced the sweep also wrote a loss census, and that record
carries, for every case, the winner's full term breakdown **and the truth's own total score** — so "hands the case
back to the rest of the ranking" is answerable by subtraction without changing the rule. Withdrawing the unit costs
the winner exactly its `trace` contribution (1.000 on all six), and the truth's rank improves by one iff the
winner's reduced score falls below the truth's total:

| case | winner | winner − trace | truth | truth's rank | after |
| --- | ---: | ---: | ---: | ---: | --- |
| `re3tt_ts-route-service_f2_3` | 1.5918 | **0.5918** | 0.9210 | 2 / 68 | **1 — win** |
| `re3tt_ts-route-service_f4_2` | 1.6245 | **0.6245** | 0.7230 | 2 / 68 | **1 — win** |
| `re3ob_emailservice_f4_1` | 1.2745 | **0.2745** | 0.5963 | 2 / 9 | **1 — win** |
| `re3tt_ts-route-service_f2_2` | 1.6245 | 0.6245 | 0.6053 | 13 / 68 | 13 — no move (by 0.019) |
| `re3tt_ts-route-service_f3_5` | 1.3954 | 0.3954 | 0.6753 | 6 / 68 | 5 — no win |
| `re3tt_ts-route-service_f4_3` | 1.6559 | 0.6559 | 0.5509 | 20 / 68 | 20 — no move |

**So the floor is worth three cases, not two**, and the third is the one an argument from rank normalisation would
have got wrong: RE3-OnlineBoutique sits at 9 nodes, below the normalisation threshold of 20, so "a unit is not the
whole gap" was a plausible reasoning and the arithmetic says otherwise — the gap was 0.678, which is less than one
unit. The lesson is the one this repository keeps re-learning: the bound was decidable from the artifact, and a
plausible prior about the metric's scale was not a substitute for subtracting two numbers.

Three cases of ninety is `67.78% → 71.11%` on RE3 and `85.44% → 85.85%` on the 735, with the other eight cells
untouched by construction.

The three winning rows share a shape worth naming, because it inverts the term's premise: on a `ts-route-service`
fault the truth **falls** (0.91–0.94) and the fleet is flat (0.79–0.99), so the unique riser is not a silent
source at all — it is re-routed traffic, and the vote was paying for the victim's signature. The fifteen hits have
the opposite shape: the truth holds its counts while the fleet loses 92% of its spans.

## 3b. What shipped

`minFleetShare = 2` is now a default of the trace rule (`DEFAULT_TRACE_ACTIVITY_OPTIONS`), the fourth threshold
beside `minPreCount`, `minPostCount` and `riseThreshold`, and `0` disables it. It is inert on RE1 and RE2 for two
independent reasons — the term's weight is 0 there *and* the corpus supplies no span counts at all
(`[trace-vote] cases=125 votes=0 abstained=125` on RE1, the same on RE2) — so the shipped nine cells can only move
on the two RE3 cells where the vote exists.

`2` is the smallest integer above the largest measured miss (1.85) and far below the smallest measured hit (10.56);
every value in `[2, 10]` classifies all twenty-one votes identically and the four-floor sweep returned
byte-identical counts. The value is an interpolation across a 5.7× gap, not a fit to the sample — which is the
distinction the sweep exists to make checkable.

The estimator is not restated: `traceFleetDrift` lives in `packages/tree` and `traceSignificanceOf` — the
`[trace-z]` instrument — calls it, so the artifact printed beside a vote cannot report a baseline the rule never
saw.

## 3c. The arm — measured, and it landed on the predicted number

Run `40811610741` at `1e3868c9`, `scopes=golden`, nine cells:

| cell | before | after | delta |
| --- | ---: | ---: | --- |
| RE3:TrainTicket | 63.3% (19/30) | **70.0% (21/30)** | **+2 cases** |
| RE3:OnlineBoutique | 80.0% (24/30) | **83.3% (25/30)** | **+1 case** |
| RE3:SockShop | 60.0% (18/30) | 60.0% (18/30) | 0 |
| **RE3** | **67.8% (61/90)** | **71.1% (64/90)** | **+3 cases, +3.3pp** |
| **735** | 85.44% (628) | **85.85% (631)** | +3 cases |
| RE1 ×3, RE2 ×3 | 87.2% / 88.9% | **87.2% / 88.9%** | identical, as the two inertness arguments require |

The three cases are exactly the three the subtraction in §3a named — not two, not four — so the record now carries a
prediction that a run confirmed to the case. The `[trace-riser]` total reads `votes=15 hits=15 wrong=0` (from
`20 / 15 / 5`) and `[trace-share]` reads `withdrawn=0 surrendered=0 net=0` at all four floors, because there is
nothing left to withdraw: every vote the rule now casts is correct.

That last line is the honest frame for what this bought. The term did not get *better at finding sources*; it
stopped casting six votes it could not justify, and three of those six were cases where the rest of the ranking was
already about to name the truth. The two TrainTicket routemates and the OnlineBoutique email case were not lost to a
weak engine — they were lost to a unit that promoted a victim.

## 4. What this does not license

- **It was a census before it was a rule.** The rule changed only after the sweep returned identical counts at four
  floors *and* the loss census resolved the upper bound; the census reads `traceRiser.vote.growth` and
  `traceSignificance.drift`, both of which the runner already recorded for other instruments.
- **It is not a new term.** The trace term keeps its binary form; this asks where its single decision should be
  allowed to stand, not how much it should be worth.
- **It says nothing about RE1 or RE2.** RE1 carries no traces at all (the dataset's own index: `has_traces = 0` on
  all 375 cases), and the corpus gates span counts on `meta.suite === 'RE3'`, so the axis is a statement about 90
  of 735 cases. Those two absences are recorded, not smoothed.
- **A share is not a direction.** `share` says the candidate's work moved differently from everyone else's; it
  does not say the fault moved it. On this corpus the failure-direction vector is `+0` on all twenty votes, so
  the attribution still rests on the metric axis.
- **A fleet of one cannot vote.** The median of a single member is that member, so the quotient is 1 and the vote
  is withheld by the arithmetic rather than by a special case — a rise with no fleet around it is a claim about a
  baseline that does not exist. This is not a tuned constant and there is no population floor beside it.

## 5. Where the numbers come from

`[trace-share]` prints one line per cell: `measured`, `unmeasured`, and one segment per floor with
`votes / hits / withdrawn / surrendered / net`. The per-vote evidence is on the `[trace-riser]` line, which now
carries `drift=` and `share=` beside `growth=` — one line per vote rather than two artifacts a reader has to join
by case id. A cell where the term never votes prints nothing, so the absence of the family is visible as an
absence rather than as a zero.

Thresholds are imported or declared in one place (`TRACE_SHARE_FLOORS`), and the rule's own defaults are imported
from the engine rather than restated, so a change to the rule cannot leave this artifact naming a number the rule
no longer uses.
