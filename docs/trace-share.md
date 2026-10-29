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

## 4. What this does not license

- **It enrols nothing.** The rule is untouched, and the census reads only `traceRiser.vote.growth` and
  `traceSignificance.drift`, both of which the runner already recorded for other instruments.
- **It is not a new term.** The trace term keeps its binary form; this asks where its single decision should be
  allowed to stand, not how much it should be worth.
- **It says nothing about RE1 or RE2.** RE1 carries no traces at all (the dataset's own index: `has_traces = 0` on
  all 375 cases), and the corpus gates span counts on `meta.suite === 'RE3'`, so the axis is a statement about 90
  of 735 cases. Those two absences are recorded, not smoothed.
- **A share is not a direction.** `share` says the candidate's work moved differently from everyone else's; it
  does not say the fault moved it. On this corpus the failure-direction vector is `+0` on all twenty votes, so
  the attribution still rests on the metric axis.

## 5. Where the numbers come from

`[trace-share]` prints one line per cell: `measured`, `unmeasured`, and one segment per floor with
`votes / hits / withdrawn / surrendered / net`. The per-vote evidence is on the `[trace-riser]` line, which now
carries `drift=` and `share=` beside `growth=` — one line per vote rather than two artifacts a reader has to join
by case id. A cell where the term never votes prints nothing, so the absence of the family is visible as an
absence rather than as a zero.

Thresholds are imported or declared in one place (`TRACE_SHARE_FLOORS`), and the rule's own defaults are imported
from the engine rather than restated, so a change to the rule cannot leave this artifact naming a number the rule
no longer uses.
