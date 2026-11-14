# The reachability of a weight vector, and the axis it reopens

Iteration 274 closed with a sentence that this iteration takes back:

> *"The remaining misses are not reachable by re-weighting, reviving or re-shaping the nineteen terms the formula has —
> only by a term with a different shape, and the pod census says this corpus cannot supply one."*

The first half of that sentence is false, and the second half is not needed. The screens behind it — 28 single-term
points, 84 revival points, a resolution floor — are all **axis-aligned**: each moved one term, or a handful, and read
the corpus. A weight vector is a point in a **14-dimensional** space, and none of those screens ever left the axes. This
iteration computes the exact boundary of that space instead of sampling it, and then fits inside it.

Two results, one negative and one positive:

| Reading | Denominator | Number | Share |
|---|---|---|---|
| `Top@1` as shipped | 1 422 | 1 073 | 75.46 % |
| Misses reachable by SOME weight vector (weight basis) | 349 | 349 | 100 % |
| Misses reachable when the formula's support is frozen (paid basis) | 349 | 217 | 62.18 % |
| Misses PROVABLY unreachable when the support is frozen | 349 | 131 | 37.54 % |
| Best single vector fitted on half the corpus, read on the other half | 711 | +47.3 mean | +6.7 pp |

---

## 1. The theorem, and why it is a theorem rather than a search

A candidate's score is a linear functional of its own term vector: `score(v) = Σᵢ wᵢ · vᵢ`. Write `a` for the
accepted candidate's vector and `V` for the others'. If `a` lies in the convex hull of `V` — that is, `a = Σᵢ λᵢ vᵢ`
with `λ` on the simplex — then for **every** `w`:

```
w·a = Σᵢ λᵢ (w·vᵢ) ≤ maxᵢ (w·vᵢ)
```

so some other candidate scores at least as high, and `a` cannot be **strictly** first. Conversely, if `a` is outside
that hull, the separating hyperplane theorem hands a `w` with `w·(a − vᵢ) > 0` for every `i`, and that `w` ranks `a`
first.

So the question *"is there a weight vector that answers this case"* is not a search over weights. It is a convex-hull
membership question with a yes/no answer per case, and no sweep can improve on it. The one qualification is exact and
is written into the code: when `a` is inside the hull, a vector can still make it **level**, and the engine's sort is
stable, so the earlier candidate keeps the position. A tie is therefore not a promotion, and the module counts only
strict separations. The ceiling it reports is a **lower bound** on the weight dimension by exactly the ties, which on
this corpus are not observable.

### Both verdicts carry a witness, and both witnesses are checked

The linear program maximises the margin `t` subject to `(vᵢ − a)·w + t ≤ 0` and `|w| ≤ 1`. At the optimum `t > 0` iff a
separator exists, and the `w` at the optimum **is** the separator. At `t = 0` the dual multipliers on the case rows are
a non-negative combination of `vᵢ − a` summing to zero — the hull certificate — because the dual's constraint on the
`t` column forces `Σ yᵢ ≥ 1` and the box columns force the combination to cancel. One tableau, both certificates.

The program is a **proposer**, not an authority. Before a case is counted:

- `separable` is re-ranked with the vector the program returned, and the answer must come out **first** — a witness
  that does not move the case is not a witness, and the case falls to `undecided`;
- `in-hull` is reconstructed from the combination, and the residual must be ≤ `1e-9` — an approximate rebuild proves
  nothing about the hull.

On the 1 422-case corpus **every verdict carries a certificate that survived substitution**: 0 undecided in the weight
basis, 1 in the paid basis (a case whose two accepted endpoints are respectively inside the hull and absent from the
ranking — no certificate covers it, and neither verdict may be published).

---

## 2. The two bases, which answer two different questions

The score is `Σᵢ wᵢ · slopeᵢ`, so a direction in **slope** space *is* a weight vector, and a term the formula ships at
zero is a dimension the direction may turn on. The **paid** space is `weight × slope` — the columns the formula
actually pays — so a direction there only re-weights the terms that already carry weight, and a term at zero stays at
zero.

That distinction is not cosmetic. It is the whole difference between the two ceilings:

```
$ npx tsx benchmarks/src/run-weight-reachability.ts --terms <dump> --basis slope
cases 1422
  hit         1073 (75.46%)
  separable   349 (24.54%)
  in-hull     0 (0.00%)
  undecided   0
CEILING       1422 (100.00%)

$ npx tsx benchmarks/src/run-weight-reachability.ts --terms <dump> --basis paid
cases 1422
  hit         1073 (75.46%)
  separable   217 (15.26%)
  in-hull     131 (9.21%)
  undecided   1
CEILING       1290 (90.72%)
```

**The support is the constraint, not the values.** Freeze which terms pay and 131 cases become provably unreachable —
no re-weighting of the paying terms can ever separate them, because their answers are convex combinations of their
competitors on those columns. Open the support and **all 349 are reachable**, each by a vector of its own.

The weight basis reading also says something the paid basis cannot: **the hull test degenerates in a space as wide as
the candidate cloud.** With 14 dimensions and ~49 candidates per case, essentially every point is a vertex, so
`in-hull = 0` is a fact about dimensionality, not about headroom. The theorem's value here is in the frozen-support
space, where it *decides* 131 cases, and in the general statement — the numbers that matter below come from the fit.

---

## 3. The positive result: a single vector transfers

The exact per-case ceiling says each case has a vector of its own. It says nothing about whether **one** vector can
serve many, and that is the question a deployable weight set asks. So `heldOutFit` fits a ranking perceptron on the
alternating even cases and reads it on the odd ones, and vice versa, over three seeds — six fits, because one fit is
an anecdote and a gain that only appears on the split it was trained on is a property of the split.

```
HELD-OUT FIT            (basis slope, 1422 cases, alternating halves of 711)
  train   711 cases   recorded   542   start   518   fitted   605   vs recorded +63
  held    711 cases   recorded   531   start   513   fitted   580   vs recorded +49
  ...                                                                          +45 +51 +52 +38 +49
```

**Six of six held-out halves improve on the recorded run, by +38 to +52, mean +47.3.** In share: the recorded half is
`531/711 = 74.7 %`, the fitted one `580/711 = 81.6 %`. The training half rises further (`605/711 = 85.1 %`), and the
gap between the two — 25 cases — is the overfit this design exists to expose rather than to hide.

That is `+6.7 pp` on a held-out half of the corpus, from re-weighting alone, with no engine change, no new term and no
model call. Iteration 274 declined to look for it because it swept axes.

### And it is a trade the pre-registered gate refuses

The family table for the seed-0 vector:

| Family | n | recorded | fitted | delta |
|---|---:|---:|---:|---:|
| HTTPResponseReplaceCode | 231 | 162 | 218 | **+56** |
| HTTPRequestReplaceMethod | 190 | 125 | 153 | **+28** |
| JVMMemoryStress | 171 | 171 | 171 | 0 |
| NetworkPartition | 97 | 64 | 75 | +11 |
| ContainerKill | 89 | 89 | 89 | 0 |
| HTTPResponseDelay | 89 | 56 | 59 | +3 |
| HTTPRequestDelay | 88 | 57 | 59 | +2 |
| HTTPRequestAbort | 60 | 46 | 43 | **−3** |
| HTTPResponseReplaceBody | 51 | 45 | 46 | +1 |
| NetworkLoss | 48 | 29 | 36 | +7 |
| NetworkCorrupt | 46 | 31 | 34 | +3 |
| HTTPResponseAbort | 44 | 34 | 35 | +1 |
| JVMException | 43 | 30 | 38 | +8 |
| NetworkBandwidth | 42 | 20 | 30 | +10 |
| HTTPRequestReplacePath | 39 | 38 | 34 | **−4** |
| NetworkDelay | 21 | 20 | 14 | **−6** |

The corpus count moves by `+112` net (`1 185` against `1 073`), the gross gain is `131` cases, and `+84` of it sits in
the two `HTTP…Replace…` families. **Three families above the 20-case floor lose cases**. The pre-registered rule in `term-weight-screen.ts` — *no family with `n ≥ 20` may lose a
case the shipped run answered* — rejects this vector. It is therefore **not shipped**, and the next iteration's subject
is the constrained fit: maximise the corpus count subject to the family floor, which is an LP-shaped problem rather
than the unconstrained perceptron.

That is the same bar that killed `prism 0.02` at iteration 274, applied to a result twenty times larger. A register
that only applies its gate to small numbers is not a gate.

---

## 4. The bug this iteration found: the shipped run is not one weight vector

The fit starts from the vector the dump recorded, and at that vector it scored **518** of the 711 training cases while
the dump recorded **542**. A 24-case gap at `Δw = 0` is not a fitting artefact; it means the recorded run was not
produced by one weight vector.

The census says exactly which term, and it is a defect in the **artefact**, not in the reader:

| `failedEdge` weight in the dump | Cases |
|---|---:|
| `0` | 1 114 |
| absent (the term never fired) | 200 |
| `3` | 108 |

One corpus, one dispatch family, two different values for the same weight. So "the shipped configuration" — the
baseline every ablation in this repository subtracts from — is a **mixture of two configurations**, and no single vector
reproduces it. The 24 cases that a uniform vector cannot match are the price of that mixture, and they are large enough
to change the sign of a small effect.

The effect on this iteration's claim is in the direction that makes the claim **stronger**, and it is worth stating
plainly: the fitted vector is compared against `recorded`, i.e. against the mixture, and still beats it by 47 on a
held-out half. Against the starting vector on that same half (`513`) the gain is `+67`. The conservative number — the
comparison with the recorded run — is the one quoted everywhere above.

*(Not yet repaired: the two values must be traced to the two dispatch batches before the corpus is re-cut, and the
repair changes every published baseline. Recorded here as an open defect with its measurement, not acted on in this
iteration.)*

---

## 5. What this changes in the roadmap

The next step is no longer "a term with a different shape". It is two steps, in this order:

1. **The constrained fit.** One vector, six seeds, both orientations, subject to the family floor. If it clears the
   gate, it is the first shipped weight change since the formula was frozen, and it is worth most of the `+6.7 pp`.
   The unconstrained fit already proves the headroom exists and that a single vector can reach it.
2. **Then the selection.** The per-case ceiling is `100 %` and a single vector gets `81.6 %`; the distance between them
   is what a **per-case choice among a few vectors** could buy, and it is the only remaining headroom the weight
   dimension has. That is the agent layer's job, with the parameter switch the project requires.

The 131 provably-unreachable cases (frozen support) are a third, separate line: they need a term **turned on**, and the
paid basis says which. Six terms ship at zero on this corpus, and none of them separates those 131 on their own — that
is what iteration 274's `podState` census and this iteration's paid-basis certificate say together.

---

## 6. Reproducing every number here

```bash
# both bases, on a terms dump produced by either runner
npx tsx benchmarks/src/run-weight-reachability.ts --terms <dump.ndjson> --basis slope
npx tsx benchmarks/src/run-weight-reachability.ts --terms <dump.ndjson> --basis paid

# the six held-out fits and the family table of the first
npx tsx benchmarks/src/run-weight-reachability.ts --terms <dump.ndjson> --basis slope --fit
```

`benchmarks/src/weight-reachability.ts` holds the theorem, the simplex, both verifiers and the fit;
`benchmarks/__tests__/weight-reachability.test.ts` holds 44 tests at **99.1 % of statements, 98.4 % of branches,
100 % of functions and 99.2 % of lines**.
