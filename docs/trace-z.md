# The scale-free axis — a count change in units of its own fluctuation

**Status:** the instrument ships ON, unconditionally, on every cell. **No ranking change**: it records a
`CasePrediction.traceSignificance` for every case that carries a trace file, prints one line per case and one total
per cell, and is read by no term of the engine. The two selectors it simulates (`zUp`, `zAbs`) are readings, not
configurations — nothing in the engine can be set to either.

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

## 6. What this does not license

- **It enrols nothing.** No weight, threshold or gate moves on this iteration's evidence. A selector has to win on
  `withdrawn − surrendered` before it is built, and this census is what makes that arithmetic available.
- **A loud truth is not a source.** `|z| ≈ 9` on a falling service says the count moved far more than its own
  fluctuation allows; it does not say the fault moved it. On this corpus the failure-direction vector that would
  arbitrate is silent (`+0` on all 21 votes), so the axis alone cannot make the attribution.
- **`z` is a one-window statistic.** It compares the whole post-injection window with the whole pre-injection one,
  so a fault that ends before the window does is diluted, and a fault that starts late is under-counted. The two
  windows are symmetric (~900 s each) on this corpus, which is what makes the comparison a rate comparison at all.
