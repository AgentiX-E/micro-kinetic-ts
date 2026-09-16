# The decisive-stability (cv) screen: the separator's rate turned into a term

**Status:** instrument shipped and gated; **the population measurement is PENDING** the run that
renders `metricDecisive` for every service. Deliberately NOT a `-verdict` document: the axis is
neither closed nor established, and the register's rows are for axes that have been measured to a
conclusion — one direction or the other. The verdict lands here, in §4, when the run does.

**Code:** `cvSlopes` + `cvAvailability` + `cvScreen` + `cvShapeMenu` + `formatCvScreenReport` +
`formatCvMenuReport`, behind `--cv-screen`. **Producer:** the `metricDecisive` line,
`packages/kinetic/src/benchmarks/fse26-diagnose.ts`.

`fse26-separator-verdict.md` §6.2 ended with a candidate and a condition. The candidate is
`decisiveCv` — the only non-term signal above the 0.6 criterion on the inventory-matched stratum
(**AUC 0.718 on 487 of 666 pairs** of the shipped dump `r35006947938`; the unconditional 0.738 is an
upper bound). The condition was a **window solver**: a paired preference is not a term, and the
question is never "does it separate" but "does any weight help without losing a case". This is that
solver, pointed at that statistic.

---

## 1. The model

```
score_cv(v) = shipped(v) + w × cvShape(v),   w ≥ 0
```

`shipped(v)` is the engine's own score from `shippedScores`, so the configuration this is a distance
from is the engine that actually RAN — the latency and pool terms are in the base, not dropped. A
screen built on a two-term blend would report a window for a ranking nobody had.

Two shapes, declared as a menu rather than left to the next proposal, for the reason the onset
shapes are: "no weight on THIS shape works" leaves the axis open on a technicality.

| shape | `cvShape(v)` | what it hypothesises |
| --- | --- | --- |
| `flip` (default) | `(max − cv) / max` | the MAGNITUDE of the dispersion is the evidence |
| `rank` | `(n − 1 − avgRank) / (n − 1)`, ascending in `cv` | only the ORDER is; the magnitude is noise |

`flip` is max-normalised like every other fusion term, so the least stable service in the case is the
origin and the term is a **distance** rather than a level. Both shapes are inert when the case holds
fewer than two measured cvs — one cv is not a comparison — and both average the ranks of equal cvs,
because two services the statistic cannot tell apart must not be separated by whichever one a sort
left first.

## 2. Absent is not zero, and it is measured

A service whose decisive composition the block did not render gets a slope of **0** — no credit.
Returning it the term's maximum for a measurement nobody made is the error this family exists to
avoid, and `flip` would do exactly that if `undefined` were read as `cv = 0`.

That choice is not hypothetical, so the instrument prints its footprint: on the first 267 cases of
run `35107871516`, **13,353 of 13,619 services (98.0%)** carry a composition. The gate is on the
report, not on the reader's goodwill:

```
  evidence: 267 cases; with a decisive composition 13353 of 13619 services; with a SPREAD the term
  can act on 267
```

A case with two measurements that AGREE is listed as measured and is not counted as comparable —
a distinction a bare "measured" count cannot express, and the one that separates a data gap from a
negative result.

## 3. The instrument defect this found before it could matter

The parser's own contract says it "can also be pointed at a downloaded CI artifact". It could not:

| input | cases read |
| --- | --- |
| a saved dump (fixtures, stripped) | 1422 |
| a raw job log, as a download gives it | **0** |

GitHub's log transport prefixes **every line** with `YYYY-MM-DDTHH:MM:SS.fffffffZ `. The dump's
grammar is column-anchored — `DIAG` at column 0, two spaces for a service, four for a metric — so a
tagged log parses to nothing, and nothing reads exactly like a run that produced no cases. Three
saved fixtures on this repo's disk are the stripped form, which is why the gap survived: nothing had
ever pointed the reader at its raw input. `stripLogPrefix` does it once, at the entry, rather than as
a leading `\s*` in every pattern — that would be a second, weaker definition of the indentation the
parser is actually reading. It is idempotent, and the census output on a stripped fixture is
**byte-identical** before and after, so both forms are accepted by construction rather than by
review.

## 4. What was measured, and what is still owed

The instrument's first act is to check itself: the base IS `shippedScores`, so `correct at 0` is also
the number of cases the dump's own ranking got right. On a frozen 409-case snapshot of run
`35107871516` (48 MiB of a 151 MiB log — a growing file cannot be measured twice):

| quantity | value |
| --- | --- |
| cases the screen solves | 409 |
| cases the dump's own `prediction` gets right | **251** |
| the screen's `correct at 0` | **251** |
| cases no weight can fix | 141 |

**251 = 251 exactly.** The reconstruction reproduces the run's own rank-1 correctness case for case,
which is what makes a gain against it meaningful rather than a gain against a second implementation.

Solved on the same snapshot — **provisional: a window is a function of the population, and more cases
can only add constraints**:

| shape | gain | window | width | ship | lost at ship | cap binder |
| --- | --- | --- | --- | --- | --- | --- |
| `flip` | 5 | `[0.047350, 0.050507]` | 0.003157 | 0.048928 | 0 | `ts1-ts-food-service-exception-ch2v8l` |
| `rank` | 2 | `[0.029860, 0.031282]` | 0.001422 | 0.030571 | 0 | `ts1-ts-food-service-exception-ch2v8l` |

Enough to say the term is **not inert and not immediately worthless**, and nothing more: five cases of
409 is a rate, not a verdict, and the full-population window is what the kill criterion asks about.
The two shapes do NOT agree, which is itself the point of the menu — the magnitude buys two and a half
times what the order does on this stratum. Note also that the window did not move between 267 and 409
cases, which is reassuring and is not evidence: the added cases can only bind the cap further, and a
cap that has not moved is a cap that has not been tested.

**The measurement is owed on:**
1. the full 1422 cases of `35107871516` — the same run, the whole log;
2. the golden 9-cell, which cannot be measured offline at all: the cv term does not exist in the
   engine yet, so the RCAEval half of the kill criterion needs a candidate run. What that run can be
   is constrained by construction — a new fusion weight defaults to 0, so an opt-in weight leaves the
   golden configuration bit-for-bit unchanged and the candidate is measured by passing the flag, not
   by moving the default.

Both are recorded here rather than inferred: an instrument read on 29% of its population has not
answered the question it was built for.

## 5. Acceptance of the instrument itself

| gate | result |
| --- | --- |
| `benchmarks` tests | 602, 0 failures (was 575) |
| `benchmarks` coverage | **99.82 / 97.16 / 100 / 99.82** |
| `packages` typecheck | 15 projects |
| lint / prettier | 0 warnings / clean |
| regression proof | `--separator-screen` on the shipped dump is **byte-identical** across the change; the register's guarded numbers are untouched |

The tests that carry the design, and why each exists:

- **`cvSlopes` does NOT credit an unmeasured service** — the load-bearing assertion of the family.
- **`cvScreen` satisfies at `w = 0` a case the LATENCY term decided**, and does not when the latency
  weight is zeroed. That is the base's proof: with two candidates the metric term's top-to-bottom gap
  is `log1p(1)`, which the latency term's own maximum cannot cross, so the fixture is a 26-candidate
  field. Measured, not argued.
- **the promotion weight is `log1p(1) / slopeGap` exactly** — the metric term is a RANK
  normalisation, not the raw anomaly, and a fixture written against `log1p(selfAnomaly)` would have
  pinned the wrong closed form (it did, on the first pass).
- **`--cv-screen` is enrolled in the weight guard as well as in the dispatch** — a flag wired into
  the dispatch but not the guard reconstructs `shippedScores` at a weight nobody chose.
- **every section the parser accepts renders through the dispatcher** — the census sections had no
  end-to-end test, which left the one place where a flag that parses and validates can still render
  nothing outside the gate.
