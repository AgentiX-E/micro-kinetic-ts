# The drop-deviation symmetry — reopening #193 where its precondition now exists

**Status:** the mechanism is IMPLEMENTED, tested, shipped at the mode **`bounded`** (i.e. OFF), and
**REFUSED in all three arms it was measured in** (§4). The #193 refusal is now quantified, and §5 states the
exchange rate every lever on this corpus has paid.

**Owner of:** `--drop-deviation-mode` and `--rise-ceiling` (both runners), `anomaly_knobs=dropdev=log,ceil=10`
on the golden half, `ranking_knobs=drop_deviation=log` on FSE'26.

---

## 1. The defect the axis is about

A metric's deviation is

```
deviation = log₁₀(1 + max(riseRatio, dropRatio × (1 − collapseDiscount)))
riseRatio = (max − base)/base        unbounded
dropRatio = (base − min)/base        ≤ 1, so the deviation is capped at log₁₀2 ≈ 0.301
```

The cap is not a modelling choice anyone made; it is arithmetic. A metric that loses **89% of its value** —
`ts-route-service`'s `socket` count going 18 → 11 because the service lost its database connections — scores
`0.214`, while a victim whose latency rises 10× scores `1.0`. The most severe thing a metric can do is the
least it can say.

And that is precisely the blocking cell's signature. Every RE3-TrainTicket failure block in the acceptance
artifact has the same shape:

```
GT    dominant=socket  head=[18,18,18,18,18,18] tail=[11,11,11,11]      dev=0.356   (a DROP)
top1  metric=latency-90 head=[0,0,0,0,0,0] tail=[0.0375,…]              dev=1.688   (a RISE)
```

The competitor that beats us on that cell — PRISM, 23 of 30 against our 15 — has no such asymmetry: its
scorer is `|mean shift| / scale`, direction-agnostic and unbounded in both.

## 2. Why it cannot simply be switched on

This is the axis #193 tried and reverted. `docs/re3-fault-ceiling.md` records the reason verbatim: measuring a
drop against the post-drop minimum "re-exploded drop-noise", because a counter collapsing to a near-zero floor
produces an unbounded ratio, and `paymentservice 2.19 > adservice 1.84` on an RE3 Online Boutique case was the
result.

Two guards have been added SINCE, and they are what make the axis readable now rather than then:

| guard | what it removes |
| --- | --- |
| the event/idle guard (`min < max × 0.001` → the channel is dropped) | the degenerate collision-to-zero |
| `metricRiseCeiling` (a bound on the RATIO, not the score) | any single metric claiming an unbounded amount |

So the axis is a **pair**, and neither half is a measurement on its own: `log` without a ceiling is the #193
explosion, and a ceiling without `log` only deflates rises.

## 3. The form

```
dropRatio_log = dropRatio × (1 − collapseDiscount) / (1 − dropRatio × (1 − collapseDiscount))
unboundedRatio = max(riseRatio, dropRatio_log)
ratio          = metricRiseCeiling > 0 ? min(unboundedRatio, metricRiseCeiling) : unboundedRatio
deviation      = log₁₀(1 + ratio)
```

Three properties, each asserted:

1. **Identical for rises.** For a rise, `post/base = 1 + riseRatio`, so the log form and the bounded form
   produce the same number. A 10× rise reads `1.0` in both. The change is about drops and nothing else.
2. **Symmetric for drops.** A 10× drop now reads `1.0` — what a 10× rise reads — instead of `0.279`.
3. **Bounded by construction, not by a constant of its own.** `dropRatio < 1` is guaranteed by the event/idle
   guard above, so `1 − dropRatio` is a positive denominator and no clamp is needed inside this function; the
   only bound is `metricRiseCeiling`, which is the knob that already exists for the rise side and is now
   forwarded by BOTH runners.

`bounded` (the shipped mode) is not a rewrite of the old expression: `max` of the two directional logarithms
equals the logarithm of the maximum ratio, so the shipped arm is bit-identical by construction, and the
acceptance run at the shipped configuration is the evidence.

## 4. The measurement — REFUSED, and the refusal of #193 is now quantified

Four arms at the commit that built it (`864c5b0`), one input each, everything else at its shipped value.

| arm | run | RE1 (375) | RE2 (270) | RE3 (90) | 735 |
| --- | --- | ---: | ---: | ---: | ---: |
| shipped (`bounded`, no ceiling) | control | **323** (105/117/101) | **231** (77/85/69) | **52** (22/15/15) | **606** |
| `dropdev=log` | `40420960344` | 288 (93/113/82) | **156** (65/60/31) | 36 (7/14/15) | **480** |
| `ceil=10` | `40420969461` | 316 (99/116/101) | 228 (77/85/66) | **56** (22/**19**/15) | 600 |
| `dropdev=log,ceil=10` | `40420979032` | 314 (104/115/95) | 214 (76/80/58) | 48 (20/13/15) | 576 |
| FSE'26 `drop_deviation=log` | `40420987867` | — | — | — | Top@1 **51.5%** (was 56.4%) |

**The refusal is reproduced, with a magnitude.** `dropdev=log` alone costs **126 cases** on the fold and
**4.9 pp** on FSE'26 — the #193 explosion, exactly as recorded, now with a number rather than a sentence.
RE2 is where it is most violent (231 → 156): a resource metric that collapses is the *victim's* signature
on that suite, and making drops unbounded hands it the ranking.

**The ceiling recovers most of it and not all of it**: `log + ceil=10` reads 576, i.e. **+96 of the 126**
lost. What remains (−30) is the part that is genuinely a loss rather than an explosion, so the pair is not
a repair of the form — it is a smaller version of the same error.

**And the ceiling alone is the best arm this iteration produced**: 600 (−6 net) with **RE3 52 → 56**, +4,
all four in SockShop (`15 → 19`). That is the only arm in three iterations that has moved the blocking
suite upward by bounding a metric rather than by adding one. It is REFUSED for the reason every arm this
month has been: it costs RE1 **7** cases (`105 → 99` on Online Boutique), and RE1's lead over `L0` is four
cases — a gain on the cell that blocks the goal, bought with the cell we lead by less than the price.

## 5. Verdict, and what the axis taught

| form | fold | blocking suite | RE1 | verdict |
| --- | ---: | ---: | ---: | --- |
| `bounded` (shipped) | **606** | 52 | **323** | — |
| `log` | 480 | 36 | 288 | refused: the #193 mechanism, quantified |
| `log` + ceiling 10 | 576 | 48 | 314 | refused: the ceiling recovers 96 of 126, not 126 |
| ceiling 10 only | 600 | **56** | 316 | refused: −7 on the cell we lead by 4 |

The axis itself is not the finding; the finding is the **exchange rate** it measures. On this corpus, every
lever that raises RE3 lowers RE1, and the ratio has now been observed four times: the conjunctive PRISM
score (+9 RE3-TT, −37 RE1), the symmetry mask (0 RE3-TT, −33 RE1), the ratio ceiling (+4 RE3, −7 RE1), and
the burst removal — the one exception — (+2 RE3, +4 RE1). Only a lever that is **orthogonal** to the
rise/drop direction has ever moved both. That is now a stated requirement rather than a hope, and it is why
the next lever in the register is a new evidence channel (the exception vocabulary) rather than another
reshaping of `deviation`.

`bounded` ships, with the mode and the ceiling both dispatchable on both halves, so the axis can be
re-measured in four dispatches if the corpus or the guards change.
