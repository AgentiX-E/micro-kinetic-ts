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

---

## 7. The cap against the promise — and why no sampling objective can close it

§3 measured the symptom (`28 of 44 strata are too small`) and §5 recorded the decision it forces: choose the
corpus's sampling objective. The arithmetic that decides it had not been done, and doing it changes the answer.

**Full held-out coverage costs `strata × boundary` cases.** The search's corpus has 44 strata and the
70/15/15 boundary is 6, so covering every stratum in both held-out splits would take **264 cases**. The run's
cap is **200** — the corpus is capped because the full dataset (735 cases) does not fit in the CI heap with
every case's logs and metrics held at once. **The cap is 64 cases short.**

That is not a shortfall a sampler can re-arrange its way out of. `equal-per-stratum` gives each stratum
`200 / 44 ≈ 4.5` cases — *below* the boundary, i.e. it would make held-out coverage WORSE — and no assignment
of 200 cases to 44 strata puts 6 in each. The options are exactly two, and the artifact now says so:

- **raise the cap** to ≥ 264 (a real question: 264 of 735 cases is 36% of the dataset's memory, and the cap
  exists because 735 did not fit);
- **reduce the stratum count** — merge the rare fault types into a coarser key, which trades the resolution of
  the held-out number for its coverage.

`requiredCasesForHeldOutCoverage(strata, ratios)` is exported from `packages/optimize/src/split.ts` (the
boundary times the count, and `0` when the ratio set asks for no held-out split, where a positive answer would
describe a split that cannot exist), and the search's artifact carries:

```
sampling objective: proportional (each system:suite stratum keeps its share of the dataset)
split capacity: 44 strata x 6 = 264 cases would give every stratum both held-out splits;
                the cap of 200 is 64 short, so 28 of 44 strata cannot reach both splits and
                NO sampling objective changes that — only a larger cap, or fewer strata
```

**The third clause is the finding.** Without it, a reader who sees `28 of 44 strata are smaller` alongside a
12.1% RE3 share would reasonably conclude the SAMPLER was poorly chosen — and would then spend an iteration
doing what the previous two did: choosing a different objective that cannot help. The line distinguishes a
choice that is available from one that is not, which is the difference between an artifact that reports and one
that informs.

**What the objective line buys while the decision is open**: it names what today's corpus IS
(`proportional`), so two runs can be told apart, and it names the alternative as absent rather than implying
it is available. A dispatch of the balanced objective is therefore not the next step; deciding between the two
options above is.

### Fence

| assertion | where | what it rejects |
| --- | --- | --- |
| the capacity is the boundary times the count, and `0` for a ratio set with no held-out split | `packages/optimize/__tests__/unit/split.test.ts` | a capacity computed from the wrong pair of numbers, or a negative requirement |
| the search's own figures: 44 × 6 = 264, which is 64 more than the 200 cap | same | the arithmetic drifting from the corpus it describes |
| the SHORT verdict names the deficit and denies that an objective can fix it | `benchmarks/__tests__/optimize-population.test.ts` | a deficiency reported without its cause, which invites the wrong repair |
| `264` funds it and `263` is one short | same | an off-by-one at the boundary |
| an uncapped corpus is not reported as short, and a no-held-out-split ratio set is called vacuous | same | a line a reader has to decode, and a requirement that does not exist |
