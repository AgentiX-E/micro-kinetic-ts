# The held-out splits, and the strata too small to reach them

**A symptom the previous iteration printed, and the cause this one measured.** The weight search's artifact
now reports its corpus, and one line of it was:

```
strata: corpus=44 distinct (system:suite:fault)
strata: train=44
strata: val=26
strata: test=28
```

So `Generalization (held-out)` was measured on a set missing **16 of the 44 combinations** — and the reason is
arithmetic, not chance.

## 1. The cause

`stratifiedSplit` allocates each stratum independently with
`train = Math.round(n × 0.7)`, `val = Math.round(n × 0.15)`, and test taking the remainder. Two consequences
follow, and both are visible in the corpus's own composition:

| stratum size | train | val | test | what happens |
| --- | --- | --- | --- | --- |
| 1 (`f2`, `f5` in the corpus) | **1** | 0 | 0 | `Math.round(0.7 × 1) = 1` — the whole stratum goes to training |
| 5 (`f4`) | 4 | **1** | **0** | `Math.round(5 × 0.15) = 1` leaves the remainder at zero — absent from test |
| 6 and above | ≥ 4 | ≥ 1 | ≥ 1 | the first size at which BOTH held-out splits are populated |

So the boundary is a size, and a corpus can be checked against it before a held-out number is quoted.

## 2. Two documents said otherwise

- `allocateCounts`' doc: *"so the counts sum to exactly `n` and honour `ratios` as closely as possible"* — true,
  and silent about the case where "as closely as possible" means zero.
- `stratifiedSplit`'s doc: *"assigned to the three buckets so that every stratum is proportionally represented
  in each split (subject to integer rounding)"* — **false for a 1-case stratum and for a 5-case one**, which is
  to say for the strata where the question matters. The parenthetical reads as a caveat and is really the whole
  story: at 70/15/15 the rounding IS the policy.

Both are corrected. This is the same class as the ablation artifact's `BASELINE (all OFF)` label and the engine
doc's "shipped behaviour": **a claim that is exactly true in aggregate and false for the case a reader is
looking at.**

## 3. The repair

`minimumStratumSizeForHeldOutCoverage(ratios)` is exported from `packages/optimize/src/split.ts`, and it is
derived by **running the splitter upwards** rather than by solving the rounding on paper — a closed form would
be a second implementation of `allocateCounts`, free to disagree with it, and this value exists to describe
what the splitter actually does. It returns `-1` when no size qualifies, which is what `val: 0` produces: the
down-sample's shape asks for no validation split, and a helper that invented a boundary there would be
answering a different question than the caller asked.

The search's artifact now carries, in the same block as the population:

```
split capability: a stratum needs 6+ cases for BOTH held-out splits at 70%/15%/15%;
                  N of 44 strata are smaller — smallest: <stratum>(size) …
```

It names the smallest strata rather than only counting them: "N of 44 are too small" invites the reader to
assume they are uninteresting, and the names are what let that be checked.

## 4. The fence

`packages/optimize/__tests__/unit/split.test.ts` and `benchmarks/__tests__/optimize-population.test.ts`:

| assertion | what it rejects |
| --- | --- |
| the exported minimum EQUALS the value its own experiment finds | the constant drifting from the splitter it describes |
| below the boundary, at least one held-out split is EMPTY | a boundary stated one size too small |
| a 1-case stratum is all-train and a 5-case stratum reaches val but not test, with the arithmetic in the comment | the two sizes that put 16 of 44 combinations outside the test split |
| three OTHER ratio sets, each checked against the experiment | a hardcoded `6` wearing a function's name |
| `val: 0` returns `-1` and the line says there is no threshold to meet | a helper answering a question nobody asked |
| the smallest strata are NAMED, truncated with an ellipsis | a count with no way to check it |
| the rendering is stable under reordering | a line whose diff between runs is noise |

## 5. What this does and does not fix

**It measures and discloses.** It does not rebalance the corpus, and that is deliberate: how much of a tuning
corpus should be RE3 is a methodology decision, and the two objectives are genuinely different — a
dataset-proportional corpus optimizes the aggregate, and an equal-per-stratum corpus optimizes the weakest
cells. The corpus currently embodies the first, which is why `Δ = +0.0pp` is a statement about RE1 (51.3% of
the corpus) as much as about the search; choosing differently is a candidate change with its own acceptance,
and the roadmap now names it as the first remaining step.

What the iteration does buy is that the choice is now VISIBLE: any claim drawn from this artifact can be read
against the corpus composition, the acting population of each flag, and the number of strata its held-out
splits cannot reach.

## 6. SOTA roadmap

**Position: Stage 2 of 4.** The gap Stage 2 aims at is unchanged — RE3 TrainTicket 51.1% and RE3 SockShop
45.0% are the weakest cells; the FSE'26 headline is 757/1422 = 53.23% — and this iteration makes one of the
two reasons those cells are hard to move measurable: they are 12.1% of the tuning corpus, and the corpus's
small strata cannot populate both held-out splits.

**Remaining steps**, in order: (1) decide and dispatch the corpus's sampling objective — proportional (today)
or equal-per-stratum — with the artifact stating which; (2) derive a label-free directional evidence channel
for the network-class misses; (3) open `--lat-weight` / `--pool-penalty` on the golden half (six axes to
eight); (4) dispatch FSE'26 for any candidate that changes the ranking; (5) compare against the competitor
list through this repository's own artifacts.

**What would falsify**: if the label-free proxy in step 2 shows no separation, the network-class hypothesis is
wrong and Stage 2 changes direction.
