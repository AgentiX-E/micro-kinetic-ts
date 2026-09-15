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
  --dump artifacts/r34919714864/fse26-results.txt --window 1 --slope lat
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
    --dump artifacts/r34919714864/fse26-results.txt --window 1 --slope lat --lat-floor "$r"
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

## What is claimed, and what is not

The +77 is a **prediction from a reconstruction**, not a measurement. The
reconstruction's *net* is the validated quantity (it reproduces 694 at `w = 0.03` and
785 at `w = 0.75`); its per-case gain/loss split is not, so "nothing is lost" is a
statement inside the model and only a run can confirm the engine agrees. Two runs are
dispatched on the commit that lands the floor:

| run | configuration | what it measures |
| --- | --- | --- |
| `34921980498` | `latMinRise=10.3`, `latWeight=0.561495` | the candidate |
| `34921984651` | `latMinRise=10.3`, `latWeight=0.03` (shipped weight) | the floor alone, so the gain can be attributed to the pair rather than assumed |

The kill criterion is unchanged and has no exception: **RCAEval golden 9-cell
byte-identical** AND **FSE'26 zero regressed fault types**. A gain of +77 with one
regressed type is refused, and so is +5 with none if the golden moves.

## What would reopen the shape axis

A reshaping that is **not pointwise and not a mask on the rise** — a mask can only
delete votes and cannot separate a service's two roles. Candidates in that direction
have to key on something *other* than the rise's magnitude: for instance an
interaction with the case's own structure (which service observed the rise, not how
big it was), which is the direction `fse26-failed-edge-verdict.md` already rejected
for the failure-count signal and would have to be re-argued for this one.
