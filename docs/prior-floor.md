# The prior floor — the baseline is a property of the corpus, and on one cell it is 40 %

_Iteration 225. Every rate this project publishes is a rate over a candidate pool that the benchmark, not the
fleet, decides. This is the instrument that measures what the pool gives away._

## 1. The number this audits

The standing anchor is **656 / 735 = 89.25 %** `AC@1`, and every document that quotes it compares it with
`1 / 14` or with `1 / n` — the uniform-random rate over the services the telemetry exposes. That comparison
was never the right one, and the most recent published audit of this benchmark says so in numbers:

> RCAEval injects faults into only five services per system while exposing 12 to 70 in telemetry, and the
> headline metric is `Avg@5`: **a ranker reading no telemetry at all places the true culprit in the top five
> on 99.7 % of held-out incidents, scoring `Avg@5` 0.488.** That prior, not the uniform-random 0.137, is the
> honest in-distribution floor. — [`arXiv:2609.27069`](https://arxiv.org/abs/2609.27069)

The claim is not that the benchmark is broken. It is that a rate over a restricted pool is not comparable with
a rate over the fleet, and that the difference is large enough to account for effects that papers attribute to
their models. This engine publishes rates over that pool too, so the critique applies to it, and quoting a
larger number against random does not answer it.

## 2. What the floor is, exactly

The floor is a function of the corpus and of nothing else. The distinct truth services of a cell **are** the
services the benchmark injected into, so a ranker that knows the label support and reads no telemetry has two
closed forms:

```
uniform(S):  AC@k = min(k, S) / S        Avg@5 = (1/5)·Σ_{k=1..5} min(k, S)/S
ordered:     AC@k = #{cases whose truth has support-rank ≤ k} / n
```

The second is the majority-class rule, and the two differ only by what the LABELS give away — so a balanced
cell must produce the same number from both, and the difference on an unbalanced one is the part of the floor
that came from the labels rather than from the pool size. Both are printed rather than one, because "the prior
is `1/S`" and "the prior is `1/S` on this corpus" are different claims.

`Avg@5` has two regimes and the boundary is `S = 5`:

| `S` | `Avg@5` at the floor | `Top@5` at the floor |
| --: | -------------------: | -------------------: |
|   3 |                 0.80 |                 1.00 |
|   5 |                 0.60 |                 1.00 |
|   6 |                 0.50 |                 0.83 |

Every published cell of this corpus has `S ≤ 6`. **`Top@5` and `Avg@5` are therefore 50–100 % before the
engine reads a single metric**, and the top-five family cannot separate methods on this benchmark at all.

## 3. The measurement

The instrument is `benchmarks/src/prior-floor.ts`, wired into `run-rcaeval.ts` beside the other censuses and
printed unconditionally, so every artifact says what its own pool gave away:

```
[prior-floor] OnlineBoutique/RE1: | S=5 | telemetry-free AC@1 20.0% (uniform) 20.0% (frequency)
              | Avg@5 60.0% | Top@5 100.0% | engine AC@1 89.6% | lift 87.0% of the reachable margin
              | — Top@5 is SATURATED by the prior here, so it is not evidence for this cell
```

### 3.1 The two cells a workspace can assemble

| cell | cases | `S` | prior `AC@1` (uniform) | prior `AC@1` (frequency) | prior `Avg@5` | engine `AC@1` | lift |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `RE1:OnlineBoutique` | 125 | 5 | 20.0 % | 20.0 % | 60.0 % | **89.6 %** | **87.0 %** |
| `RE3:SockShop` | 30 | 3 | 33.3 % | **40.0 %** | 80.0 % | **63.3 %** | **45.0 %** |

"lift" is `(engine − prior) / (1 − prior)`: the share of the margin the prior left that the engine actually
takes. It is the only one of the four numbers that is comparable between cells.

### 3.2 What the RE3:SockShop cell actually is

`30` cases with **three** possible answers — `carts` 12, `front-end` 9, `orders` 9 — and the distribution is
not flat. A ranker that always answers `carts` and reads nothing scores **40.0 %** on that cell, which is
**above** the `33.3 %` the uniform baseline assumes and only 23.3 pp below the engine.

That is not the number the cell was read against. `sota-comparison.md` §0p compares it with a published
`66.1 %` on the same 30 cases and with `1/3` as the random floor, and both readings flatter the engine: the
per-fault-type mean `66.1 %` is over five types of six cases, and the floor is the majority class, not
uniform.

The per-class split makes the same point from the other side:

| truth class | cases | engine correct | majority-class prior correct |
| --- | ---: | ---: | ---: |
| `front-end` | 9 | **9** (100 %) | 0 |
| `carts` | 12 | **5** (41.7 %) | 12 (100 %) |
| `orders` | 9 | **5** (55.6 %) | 0 |

**On the majority class the engine is 7 cases behind a blind guess, and its whole lead on the cell comes from
solving `front-end` completely.** A cell read as "63.3 %, above random" hides that; a cell read as "45 % of
the available margin, and negative on the largest class" does not.

## 4. What it changes

1. **The headline is a lift, not a rate.** `89.25 %` over a `0.20` floor is `87 %` of the available margin;
   `63.3 %` over a `0.40` floor is `45 %`. The two are not comparably good, and only the second is worth the
   campaign's attention.
2. **`Top@5` is retired as a headline.** It is `100 %` at the floor on every cell with `S ≤ 5`, so an engine
   cannot be said to beat a prior on it. `Top@3` survives only where `S > 3`.
3. **A competitor's top-five number is now readable.** A vendor publishing `89 % / 96 % / 99 %` on the same
   735 cases publishes a `Top@5` that the prior reaches on its own; the `Top@1` is the number that is not.
4. **The next cell to attack is chosen by lift, not by rate.** `RE3:SockShop` was already the lowest cell; it
   is also the lowest lift by a factor of two, and its deficit is concentrated on the majority class.

## 5. What it does not license

**The prior is not a feature.** Restricting the candidate pool to the injected-service set would raise
`AC@1` to at least `33 %` and `Top@5` to `100 %` on every cell, and it is exactly the shortcut `2609.27069`
identifies. The floor is computed from ground truth that the engine must never see, it is printed *beside*
the run rather than fed into it, and the module takes `truth` only from the prediction record the correctness
count is already built from. A test asserts the census is a function of `(truth, correct)` pairs and nothing
else, which is the strongest statement this repository can make about a quantity it computes from labels.

## 6. Limits

- **The floor is only as good as `S`.** `S` is read as "distinct truths in the cell", which is the injected set
  exactly when every injected service appears at least once — true of every RCAEval cell, and stated rather than
  assumed.
- **It is not a floor for FSE'26.** That corpus injects on edges with two accepted labels per case, so its
  candidate pool is a different object; the census is wired into the RCAEval runner only.
- **The frequency baseline is a label statistic.** On a cell whose truth distribution was itself sampled to be
  unbalanced it is stronger than `1/S`, and `RE3:SockShop` is such a cell; the line prints both so the reader
  can see which one the cell earned.
- **A lift is a ratio of two rates with the same denominator**, so it inherits the cell's sampling error. On 30
  cases one case is 3.3 pp of rate and about 1.7 pp of lift at this floor; the numbers above are not
  differences of that size being read as findings.

## 7. How to reproduce

```bash
# both assembled cells; the line prints beside every other census
pnpm exec tsx benchmarks/src/run-rcaeval.ts --suite re1 --system ob
pnpm exec tsx benchmarks/src/run-rcaeval.ts --suite re3 --system ss

# the closed forms, without a corpus
pnpm exec vitest run benchmarks/__tests__/prior-floor.test.ts
```
