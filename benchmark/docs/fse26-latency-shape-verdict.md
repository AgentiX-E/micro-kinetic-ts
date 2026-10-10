# The per-edge latency term's SHAPE — verdict

The weight axis is settled: `w = 0.03`, measured, +21 cases, zero regressed fault
types (`fse26-latency-term-verdict.md`). This document asks the next question, which
is the one the register's reopening condition names: **can the term keep more, without
regressing anything?** A weight is not the only knob on an affine term —
`score(v) = A(v) + w·φ(L(v))` has a *shape* `φ` as well, and a shape is a knob no run
is needed to evaluate, because both terms are recorded per service in the dump.

## Result 1 — every pointwise reshaping is excluded, and one command says so

The shipped window's cap is bound by exactly one case, and `--window` now prints the
arithmetic that decided it:

```
tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34919714864/fse26-results.txt --log-weight 1 --window --slope lat --lat-floor 1
```

```
  cap weight: 0.030459   binder ts1-ts-food-service-exception-ch2v8l
  cap detail: ts-ui-dashboard overtakes ts-food-service — lead 0.030459 /
              slope gap 1.000000 (slopes 0.000000 -> 1.000000)
```

The target's slope is **0** and the rival's is **1** — the case maximum. So the
`slope gap` is maximal *by construction*, and the maximal gap is the one thing no
monotone reshaping can touch: any `φ` with `φ(0) = 0` keeps the target at 0, and any
`φ` preserves the ordering that makes the rival the maximum, so after
max-normalisation the rival stays at 1. The gap stays 1 and the cap stays
`lead / 1`. That excludes, at zero cost, **every** compression, exponent, logarithm,
sqrt, rank normalisation and monotone rescale of the term — the whole family, without
building or measuring any of them.

This is worth stating plainly because the family is large and inviting, and because
the exclusion is a *proof about the geometry of this case*, not a measurement that
happened to come out negative.

## Result 2 — a MASK is not pointwise, and it is the generalisation of the shipped shape

A floor on the rise is not a monotone map of the slope: it deletes observations
instead of compressing them. It is implemented as `latMinRise` and its defining
property is that **`latMinRise = 1` is byte-identical to the shipped term** — the
shipped transform credits every rise above 1, so a floor of 1 removes nothing. Every
comparison below therefore starts from the shipped configuration rather than from an
approximation of it.

The floor is a **pure mask**, and this bounds it in a way that predicts its own
result. It removes rises strictly between 1 and the floor, so the surviving maximum
is always the case maximum, the divisor never moves, and **no slope is ever raised**.
Two consequences:

- the term can only ever lose votes — a floor cannot make the term stronger;
- it cannot delete a spurious **COMPETITOR** without deleting that same service as a
  **CREDITED source**. The two roles are the same service, with the same rise, in
  different cases.

So a floor pays exactly when the evidence it deletes as *interference* is worth less
than the evidence it deletes as *credit*. That is a computable question, and it is the
same question `failedEdgeMinRecords` answered NO: there, the floor recovered both
regressions and spent all +82 cases of gain.

## Result 3 — the cap is a STEP function of the floor, and the step is large

For each floor the window is solved **exactly** in `w` (the interval algebra is
unchanged — only the slope vector is), so the floor is the sole sampled axis:

```bash
# the step, and the optimum inside it
for r in 1 3 10.3 12 50 137 300; do
  tsx benchmarks/src/analyze-fse26-diagnose.ts \
    --dump artifacts/r34919714864/fse26-results.txt --log-weight 1 --window --slope lat --lat-floor "$r"
done
```

| floor | cap weight | best `w` | correct | gained |
| --- | --- | --- | --- | --- |
| 1 (shipped) | 0.030459 | 0.030 | **694** | +21 |
| 1.5 | 0.030459 | 0.030 | 694 | +21 |
| 3 | 0.030459 | 0.030 | 694 | +21 |
| 5 | 0.030459 | 0.030 | 692 | +19 |
| **10.3** | **0.561495** | **0.561** | **750** | **+77** |
| 12 | 0.561495 | 0.561 | 747 | +74 |
| 50 | 0.561495 | 0.561 | 717 | +44 |
| 137 | 0.596522 | 0.561 | 703 | +30 |
| 300 | 0.969541 | 0.750 | 692 | +19 |

The `floor = 1` row reproduces the shipped numbers exactly — 0.030459, 694, +21 — which
is the validation that this driver measures the shipped term and not a variant of it.

The cap does not move smoothly: it holds at 0.030459 until the floor passes
**10.283**, then jumps to 0.561495. 10.283 is the rise of the single competitor that
bound the shipped window — `ts-ui-dashboard`, in the JVMException case above. The whole
of the shipped cap was one spurious competitor, and removing it **multiplies the window
by 18**.

## Result 4 — inside a step, the smallest floor wins; beyond it, gains fall

Within one step the cap is fixed, and raising the floor only deletes more votes — so
the optimum inside a step is at its **lower boundary**, and the search collapses to
"which step, and how small a floor reaches it". The table is monotone decreasing
across the 0.561495 step (750 → 747 → 717) and lower again on the next step, so the
answer is the **smallest floor that reaches the best step**.

That makes `latMinRise = 10.3` a *solved threshold with a named binder*, exactly like
the weight's cap: 10.283 is the evidence that had to be excluded, and 10.3 is the
first value that excludes it. It is not a preference and not a round number — a round
10 does **not** work (it leaves the competitor in place and the cap at 0.030459).

## The measurement: 750, exactly the prediction

The +77 was a prediction from a reconstruction. It was then measured, on one commit and
one cache, and the **floor was measured both with and without the weight** so the gain
could be attributed to the pair rather than assumed:

| run | floor | weight | Top@1 | correct | regressed fault types |
| --- | --- | --- | --- | --- | --- |
| `34877815364` | 1 | 0.03 (shipped) | 48.80% | 694 | 0 |
| `34921984651` | 10.3 | **0.03 (the floor ALONE)** | 48.38% | 688 | **6** |
| `34921980498` | **10.3** | **0.561495 (shipped)** | **52.74%** | **750** | **0** |

The candidate measured **750** — the reconstruction's prediction to the case — with
**zero regressed fault types**, Top@3 65.75% and Top@5 70.11%.

The middle row is the reason the two values ship as a PAIR and the reason the guard in
`fse26-reported-config.test.ts` requires a measurement of the *pair*: at the old weight
a floor of 10.3 is a **6-case regression across 6 fault types** (JVMMemoryStress −3,
ContainerKill −1, HTTPResponseDelay −1, NetworkBandwidth −1, NetworkDelay −1,
JVMLatency −1). Neither half is defensible alone. The floor removes a competitor that
only matters at a large weight, and the large weight only survives with the floor.

Per fault type against the previously shipped 694 — 10 types gain, none regress:

| fault type | shipped | candidate | delta |
| --- | --- | --- | --- |
| HTTPRequestDelay | 42 | **54** | +12 |
| NetworkLoss | 14 | **23** | +9 |
| HTTPResponseDelay | 44 | **52** | +8 |
| NetworkPartition | 41 | **48** | +7 |
| NetworkCorrupt | 18 | **24** | +6 |
| JVMMemoryStress | 7 | **12** | +5 |
| HTTPRequestReplaceMethod | 123 | **127** | +4 |
| ContainerKill | 2 | **4** | +2 |
| JVMLatency | 3 | **5** | +2 |
| NetworkDelay | 18 | **19** | +1 |
| **all 14 others (incl. ReplaceCode, 231 cases)** | — | — | **+0** |

The largest type, `HTTPResponseReplaceCode` (231 cases), is untouched — which matters,
because it is the type the earlier 0.75 ablation cost two cases on. The gains are
concentrated in the delay and network families, which is exactly where a *duration*
signal has evidence and the failure counts do not.

The kill criterion is unchanged and has no exception: **RCAEval golden 9-cell
byte-identical** AND **FSE'26 zero regressed fault types**. The second half is measured
above; the first is measured on the flip commit itself, because a half that is skipped
because it "must" pass is not a test.

## What would reopen the shape axis

A reshaping that is **not pointwise and not a mask on the rise** — a mask can only
delete votes and cannot separate a service's two roles. Candidates in that direction
have to key on something *other* than the rise's magnitude: for instance an
interaction with the case's own structure (which service observed the rise, not how
big it was), which is the direction `fse26-failed-edge-verdict.md` already rejected
for the failure-count signal and would have to be re-argued for this one.

## Both halves of the kill criterion, on the flip commit

The candidate was then re-measured on the commit that carries it, with no override at
all, because a half that is skipped because it "must" pass is not a test:

| half | run | result |
| --- | --- | --- |
| FSE'26 through the **DEFAULT** path (no `lat_weight` input) | `34923701046` | **52.74% / 750 / +56**, zero regressed fault types, per-fault-type cells **byte-identical** to the flagged candidate `34921980498`, and the `Config:` line reads `latWeight=0.561495 latMinRise=10.3` from the defaults |
| RCAEval golden 9-cell | `34923687812` (against `34877797128`) | RE1 80.0/92.8/68.0, RE2 82.4/88.9/68.1, RE3 80.0/45.0/51.1 — all nine exactly the recorded golden, artifacts **byte-identical** apart from the `Total duration` line |

The flag and the default are therefore one configuration, not two that agree by
accident: the per-type cells are the same bytes. The second half is structurally
invisible to the RCAEval suite, since only the FSE'26 loader emits
`traceEdgeLatency`; it was measured anyway.

## Where the shipped pair sits: exactly on its own cap

The window for the shipped pair, from the same instrument:

```
Weight window (slope=lat, latFloor=10.3; logWeight=1; ...)
  cases: 1422   correct at 0: 673   unreachable at every weight: 549
  cap weight: 0.561495   binder ts0-ts-travel2-service-response-abort-bvl7cs
  cap detail: ts-consign-price-service overtakes ts-travel2-service — lead 0.561495 /
              slope gap 1.000000 (slopes 0.000000 -> 1.000000)
  0.030000         688      15     0
  0.561495         750      77     0
```

Three things follow, and all three are load-bearing:

1. **The shipped weight IS the cap.** `0.561495` is both the value that was measured and
   the right end of the window — unlike `0.03`, which was deliberately chosen 1.5% inside
   `0.030459`. That is acceptable only because the value was *measured at that exact
   point*: the rule the earlier choice honoured was "a default must be a number that was
   run", and this number was.
2. **The reconstruction reproduces the run in its SPLIT, not only its net**: 750 =
   673 + 77 − 0, and the measured run gained 77 with zero regressed fault types. The
   earlier caution still stands in general (at `w = 0.75` the same instrument predicted
   785 as `+132/−20` where the engine reached `+121/−9`), so this is a validated
   instance, not a licence to read decompositions off the model.
3. **The binder's gap is maximal again** — target slope 0 against a rival at the case
   maximum 1 — so the shape axis is exhausted at this floor too: no pointwise reshaping
   of the term can widen it, and the only remaining lever is another mask, which pays
   only if the interference it removes is worth more than the credit it spends.

## What the flip exposed in the TOOLING

- **The run's log weight was accepted on four flags** — `--log-weight`, `--misses <w>`,
  `--weight-sweep <w>` and `--window <w>` — and passing a LATENCY weight to `--window`
  printed a self-consistent report with `correct at 0: 669` and `cap 0.122990` instead of
  `673` and `0.561495`. Every number in it was wrong, including the one the register
  quotes. The value now has one owner and the sections are switches, so a section cannot
  be requested without the weight it is computed at.
- **The parser was unreachable by tests**, which is why that got in: the entry point calls
  `main()` at import time, so nothing loaded it and its ~235 lines of flags were outside
  the coverage denominator. The parser now lives in the covered module.
- **The binder search reported the opposite of the truth for a tie.** A case held only by
  a tie at zero has `cap = 0` and `lead = 0`; the search required `lead > 0`, so it
  returned nothing and the report printed *"no case can be overtaken at any weight"* about
  a case every weight above zero overtakes.
- **The "first weight above the cap" probe could fall back inside the window.** It added
  `Number.EPSILON`, which is smaller than the `WEIGHT_EPSILON` the interval test inflates
  by, so for a cap of zero the row claimed the case survived the weight that beat it.
