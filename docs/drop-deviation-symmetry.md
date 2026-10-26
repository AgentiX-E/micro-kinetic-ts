# The drop-deviation symmetry — reopening #193 where its precondition now exists

**Status:** the mechanism is IMPLEMENTED, tested, and shipped at the mode **`bounded`** (i.e. OFF). The
measurement is §4.

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

## 4. The measurement

Three arms on the golden nine cells and one on FSE'26, all at the commit that built it, one input each:

| arm | what it isolates | RE1 | RE2 | RE3 | 735 |
| --- | --- | ---: | ---: | ---: | ---: |
| shipped (`bounded`, no ceiling) | control | 323 | 231 | 52 | 606 |
| `dropdev=log` alone | the #193 failure, reproduced deliberately | | | | |
| `ceil=10` alone | the ceiling's own effect | | | | |
| `dropdev=log,ceil=10` | the PAIR | | | | |
| FSE'26 `drop_deviation=log` | the other half | — | — | — | Top@1 |

`dropdev=log` alone is dispatched **on purpose**, and it is the arm that makes the others readable: if it
loses cases, the loss is the #193 mechanism and the pair's difference from it is the ceiling's contribution.
An axis reopened after a documented refusal owes the reproduction of that refusal.

*(filled in by the acceptance commit.)*
