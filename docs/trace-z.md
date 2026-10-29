# The scale-free axis — a count change in units of its own fluctuation

**Status:** the instrument ships ON, unconditionally, on every cell. **No ranking change**: it records a
`CasePrediction.traceSignificance` for every case that carries a trace file, prints one line per case and one total
per cell, and is read by no term of the engine. The two selectors it simulates (`zUp`, `zAbs`) are readings, not
configurations — nothing in the engine can be set to either.

**And the reading is a REFUSAL** (§6): the axis carries the signal — on TrainTicket the truth is a ≥ 3σ deviator on
23 of 30 cases and the loudest on 15 — but neither selector recovers a single case the engine does not already
answer, while `zUp` surrenders 13 of the engine's 15 hits. The trace family is now closed in **five** forms.

**Owner of:** `traceSignificanceOf` (the normalisation), `CasePrediction.traceSignificance`, and `[trace-z]`.

## 1. What the four refusals left

The trace term pays one binary unit to the **unique** service whose post-injection span count rose above its own
pre-injection count (`minPreCount = 500`, `riseThreshold = 1.15`). It is pinned ON for RE3 alone, votes on 20 of
TrainTicket RE3's 30 cases, and is right on 15. Four refinements have been refused, and every refusal was a
statement about the **shape** of the evidence rather than about the term:

| refinement                 | what refused it                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `traceSkipsLeader`         | null on all nine cells; the rank histogram shows why — `atMax=2/2`, the two loudest votes are right  |
| `traceTailOnly`            | the non-tail votes are 2 of 2 right and 0 of 3 wrong, so tail-ness carries no signal                |
| failure DIRECTION          | `failedIn`/`failedOut` are `+0` on all 21 votes: a term built on it could not fire                   |
| `traceRiseFloor`           | the misses gain `+295 … +15 020` spans, eight of the fifteen hits only `+309 … +389` — dead on arrival |

What survives all four is `[trace-riser]`'s finding: on the five misses the truth's count **fell** (0.82–0.94 on
`pre ≈ 12 000`), so the rule's premise — *a source does MORE work per request* — is false on exactly the cases it
misses. A ratio threshold cannot express that, for a reason that is arithmetic rather than conceptual: **17% at
1 800 spans is ~300 spans; 7% at 12 000 is ~840.** The ratio is loud for small services and deaf for large ones, and
`minPreCount = 500` is an absolute patch on exactly that deafness.

## 2. The normalisation

Under the kinetic limit a service's span count in a window counts independent arrivals, so its variance is its
mean: `Var(N) = N`. A service that emitted `pre` spans before the injection is expected to emit `r · pre` after it,
where `r` is the fleet's **common-mode drift** — what every service would show if none changed its work per request.
Its fluctuation is `sqrt(r · pre)`, so

```
z = (post − r · pre) / sqrt(r · pre)
```

is the change in units of the change that would have happened anyway. 300 spans on 1 800 and 840 on 12 000 land on
one axis instead of two.

`r` is the **unweighted median of the per-service ratios**, and the qualifier was measured rather than preferred:

| estimator                 | why it is not the one                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Σpost / Σpre`            | on the five misses the truth carries a large share of the fleet, so its own fall enters the denominator: 1 000 missing spans on `pre = 12 000` normalise to `z ≈ −1.3` instead of `−9.1` |
| pre-weighted median       | the same defect for the same reason — the median SPAN belongs to a large service, and the large service may be the fault            |
| **unweighted median**     | every service is one observation of "did the world change", so the fault's own service is one vote out of sixty-eight               |

The population is the **ranking's** population: `effectiveCallGraph.nodes`, the set `computeTraceActivityScores` was
handed. A service the graph does not carry cannot be ranked, so measuring it would report a significance no term
could spend — and counting it in the drift would let an unrankable service move every ranked one's baseline. A
service with no pre-injection baseline is excluded for a different reason: `post / 0` is not a level of anything.

## 3. The two selectors this census simulates

Neither is an engine option. Both are applied to the same population the rule sees, and both keep the rule's
**uniqueness** requirement — a policy that always named the loudest service would be measuring a different term and
its totals would not be comparable with the rule's:

- **`zUp`** — vote for the unique service with `z ≥ 3`.
- **`zAbs`** — vote for the unique service with `|z| ≥ 3`.

Three sigma rather than two because a cell is a multiple-comparison setting: sixty-eight services are tested per
case, so a two-sigma bar admits a false candidate on roughly one case in twenty **by construction**, and the whole
difficulty of this cell is that one plausible extra candidate turns a vote into an abstention.

Each policy is scored twice — against the truth, and against the engine's own vote on the same case. An abstention
is scored by what it does to the engine's unit, and the two directions are counted apart because they are not the
same magnitude:

- **`withdrawn`** — the engine voted wrong and the policy abstains. The wrong unit is removed; the ranking is then
  decided by its other terms, which may or may not be right.
- **`surrendered`** — the engine voted right and the policy abstains. A right unit is given away.

## 4. The instrument

```
[trace-z] <caseId> drift=1.02 | 1 <svc> +36.2 22497→27900 | 2 <svc> -9.9 12027→10944 | 3 … | truth=<svc> z=-9.9 rank=2 | engine=<svc> MISS | zUp=- zAbs=-
[trace-z] total cases=30 truth-measured=30 truth-loudest=… truth-rising=… truth-falling=… truth-|z|>=3=… | engine votes=… hits=… withdrawn=… surrendered=… | zUp … | zAbs …
```

Four properties the rendering keeps, because each is a distinction a reader would otherwise have to reconstruct:

- **The drift is printed**, because a `z` is meaningless without the baseline it was taken against, and the drift is
  the one number that says whether the cell's traffic moved at all.
- **`z` carries an explicit sign** — the axis is signed, and `0.0` must not read as "absent".
- **The truth's own column is always printed**, including when it is already among the three loudest: it is the
  subject of the line, and a reader should not have to check whether the subject fell inside the sample.
- **A policy that abstains prints `-`**, never an empty string or a zero: an abstention is a decision, not a
  missing measurement.

## 5. The prediction, written before the run

**P1 — the axis carries the magnitude even where the sign is wrong.** The five misses' truth is `pre ≈ 12 000` with
~1 000 spans missing, i.e. `z ≈ −9`; the victim that took the vote is at `pre = 22 000–35 000` with a +17–47% rise,
i.e. `z ≈ +20 … +36`. So `truth-falling` should read **5** on TrainTicket, `truth-|z|>=3` should read **at least
20 of 30**, and `truth-loudest` should be **low** — the truth is loud but a victim is louder.

**P2 — two-sidedness buys nothing by itself.** If P1 holds, `zAbs` finds two significant services on those five cases
(the source and its victim) and abstains — the same abstention the ratio rule produces by finding two candidates.
`zAbs votes` should therefore be **no larger** than `zUp votes`, and neither should beat the engine's 15 hits.
This is the prediction that decides whether an arm is worth dispatching at all.

**P3 — the falsifier.** If `truth-|z|>=3` reads near zero on TrainTicket, the axis does not carry the separation and
the trace family is **closed in five forms** rather than four: the remaining +10 cases the pin is worth would then be
a fact about the cell's evidence rather than a refinement waiting to be found.

## 6. What it read: the axis carries the magnitude and refuses the selection

Run `40792623427` on `ea47db5` — the census prints on the three RE3 cells and nowhere else, because the corpus
computes span counts only where the term is pinned (`rcaeval-corpus.ts` gates on `meta.suite === 'RE3'`, for the
memory reason in §7). RE1 carries no traces at all and RE3-SockShop carries none either, so their silence is the
absence of the family rather than a row of zeros.

```
RE3-OnlineBoutique cases=30 truth-measured=18 truth-loudest=12 truth-rising=5  truth-falling=13 truth-|z|>=3=15
                    | engine  votes=1  hits=0 | zUp votes=6  hits=0 | zAbs votes=11 hits=4
RE3-TrainTicket    cases=30 truth-measured=30 truth-loudest=15 truth-rising=18 truth-falling=12 truth-|z|>=3=23
                    | engine  votes=20 hits=15 | zUp votes=2 hits=2 withdrawn=5 surrendered=13
                    | zAbs votes=0 hits=0 withdrawn=5 surrendered=15
```

**Finding 1 — the axis carries the signal, and this is the best evidence the term has ever had.** On TrainTicket
the truth is a ≥ 3σ deviator on **23 of 30** cases and the **loudest** deviator on **15 of 30**. Compare the
anomaly axis this project has been fighting on: there the truth is **mid-pack, 33 of 68**, and the quiet-truth
hypothesis died on the same reading. The span counts know where the source is; the RATIO threshold is what fails
to read them. That reframes the term's worth: the +10 cases the pin is worth are not an accident of one service.

**Finding 2 — P2 is confirmed: two-sidedness buys nothing.** `zAbs` casts **zero** votes on TrainTicket, because a
fleet-wide collapse makes *every* service significant — on the auth cases the drift reads 0.05–0.11, i.e. the
median service kept 5–11% of its spans, so `|z| ≥ 3` is satisfied by dozens of services at once and the uniqueness
requirement never holds. `zUp` casts two votes and is right twice, but **surrenders 13 of the engine's 15 hits**:
the abstentions it would impose are exactly the cell's wins.

**Finding 3 — P1 is refuted on the five misses.** I predicted the misses' truth would be loud with a negative
sign (`z ≈ −9`). It is not: the per-case drift on those cases is 0.92–0.99 rather than the ~1.15 the ratio rule
imposes, so the same fall normalises to

| case                  | truth `z` | `|z|` rank | engine             |
| --------------------- | --------: | ---------: | ------------------ |
| `ts-route-service_f2_2` | −0.7    | 21         | `ts-order-other-service` MISS |
| `ts-route-service_f2_3` | −6.0    | 5          | `ts-station-service` MISS     |
| `ts-route-service_f3_5` | +3.0    | 18         | `ts-station-service` MISS     |
| `ts-route-service_f4_2` | −4.1    | 7          | `ts-station-service` MISS     |
| `ts-route-service_f4_3` | −0.7    | 22         | `ts-station-service` MISS     |

Four of the five sit **below the 3σ bar** and the fifth is at rank 18. The truth on these cases is not merely
falling — it is **unremarkable against its own fluctuation**, which is a stronger and more decisive statement than
"the sign was wrong": the missing 1 000–2 200 spans are within what a 12 000-span service does anyway once the
fleet's own collapse is divided out.

**Finding 4 — on OnlineBoutique the policy's four hits are worth exactly zero.** `zAbs` votes 11 times and is
right 4, which reads like a gain over the engine's 1 vote and 0 hits — until the hits are named: they are
`emailservice` `f5_1`, `f1_1`, `f2_1` and `f2_2`, and the cell's six misses are `emailservice_f4_1`, two
`cartservice_f1_*` and three `currencyservice_f1_*`. **Every hit is a case the engine already answers correctly**,
and the seven remaining votes are wrong. On the six misses the policy abstains twice over: on the cart cases the
truth is not in the trace population at all (`truth-measured=18 of 30`), and on the currency cases three services
cross 3σ together.

**Finding 5 — the axis's population is a corpus property, not an engine one.** RE3-SockShop has no trace file and
RE1 has none in any cell, so 90 of 735 cases can carry this axis at all, and only 60 of those have a truth with a
pre-injection baseline on OnlineBoutique. Any selector built here is a statement about TrainTicket.

**Verdict: the trace family closes in five forms** — weight, leader mask, tail-only, materiality floor, and now
scale-relative significance. `zAbs` recovers **none** of the six OnlineBoutique misses and **none** of the five
TrainTicket misses; `zUp` surrenders 13 of 15 hits. Nothing is enrolled, and the ratio rule keeps the cell.

## 7. What this does not license

- **No weight, threshold or gate moved.** The census prints on every cell, every run, and no term reads it. The
  arithmetic a future selector would have to win — `withdrawn` against `surrendered`, and a hit on a case the
  engine does not already answer — now exists, and on this corpus both policies lose it.
- **A deviation is not an attribution.** `z = +196` on `ts-auth-service` says its count moved 196 of its own
  fluctuations beyond the fleet; it does not say the fault moved it. The vector that would arbitrate — failed
  edges in and out — is silent on this corpus (`+0` on all 21 votes, `trace-riser.md` §6), so the axis can rank
  deviations but cannot separate a source from a victim.
- **`z` is a one-window statistic.** It compares the whole post-injection window with the whole pre-injection one,
  so a fault that ends early is diluted and one that starts late is under-counted. The windows are symmetric
  (~900 s) on this corpus, which is what makes the comparison a rate comparison at all — and it is why the axis
  must never be read as onset timing (that is `detectMADOnset`'s job, on the metric channel).
- **The drift is a population statistic and inherits its population.** It is an unweighted median over the graph's
  nodes, so a case whose graph carries many services the trace does not name gets a drift measured on the few it
  does. Print the drift beside any `z` read from another corpus; on this one it ranges 0.05–1.15, and the two ends
  mean opposite things.

