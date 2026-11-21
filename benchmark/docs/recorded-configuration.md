# What the dump recorded, and what the gate actually decided

**The claim, first.** The archive dump answers **1 073 of 1 422** cases when it is read with the coefficients it
recorded, which is **75.46 %** — the number the RCABench cell publishes. No weight vector reproduces it, and none
should: one name in the fusion is not a weight but a **decision**, and the dump records that decision case by case.
Every screen in this repository read the first zero it saw for that name as "the shipped weight is 0", scored
**1 031** (72.50 %), and measured its deltas against a configuration that never ran.

| Reading | Cases | Share | What it is |
|---|---:|---:|---|
| The configuration read as one vector, a gated term forced **off** | 1 031 | 72.50 % | what `Δw = 0` meant until iteration 277 |
| **The run, read with the coefficients it recorded** | **1 073** | **75.46 %** | the published RCABench cell |
| The configuration read as one vector, the term forced **on** | 1 096 | 77.07 % | the gate deleted |
| The per-case oracle over those two arms | 1 186 | 83.40 % | what a perfect switch on this one term would score |

## 1. The engine does not apply this term unconditionally

`performTreeRCA` runs twice when the direction term is live:

```
baseline  ←  rank with failedEdgeWeight = 0
rank-1    ←  baseline[0]                     ← the engine's OWN answer, never the injected label
if !admitsFailedEdgeTerm(rank-1's dominant metric, rank-1's inbound rise) → return baseline
else                                                                      → return the re-ranked list
```

so the coefficient the dump writes for a refused case is `0` and for an admitted case is the configured weight. One
coefficient, two values, decided per case.

`DEFAULT_FAILED_EDGE_WEIGHT` is **3**, and the archive dump records:

| State | Cases | What it means |
|---|---:|---|
| `failedEdge = 0` | 1 114 | the gate refused: this case kept the baseline ranking |
| `failedEdge = 3` | 108 | the gate admitted: this case was re-ranked with the term |
| not recorded | 200 | the term was not in the case's fusion at all; the gate was never consulted |

## 2. The theorem, and the two caveats it owes

Let `S` be the set of coefficients a dump records for one name and `w` its configured weight. Every recorded value is
`w` (admitted) or `0` (refused), so `S ⊆ {0, w}` and therefore

> **`w = max S`**, whenever `S` holds anything other than zero.

- `S = {0}` is **ambiguous**: a term configured at 0 and a term refused on every case record the same thing. The
  census marks such a name `0-or-refused` and no reader may claim the difference. Six names in this dump are in that
  state (`collision`, `prism`, `rise`, `source`, `temporal`, `topo`).
- `|S| > 1` is **proof the name is conditional**. A configuration is one number; a name that records two is a decision
  procedure, and no single vector can reproduce a run that contains one.

The census of the archive dump is `19` names, of which exactly one is conditional:

```
cases 1422   candidates 69688   residual mismatches 0
conditional names: failedEdge

name                 configured  recorded  absent   states
failedEdge                    3      1222     200   0 x1114  3 x108  (GATED)
dualFamily                 0.25      1003     419   0.25 x1003
lat                    0.561495       760     662   0.561495 x760
log                           1      1000     422   1 x1000
podState                      8       294    1128   8 x294
pool                    -0.0679      1422       0   -0.0679 x1422
...
```

`residual mismatches 0` over 69 688 candidates is the check that makes all of this a measurement: `Σ coefficient ×
slope` reproduces every recorded `score` to `1e-9`, so the coefficients in the dump are the ones the run scored with,
and the order the dump stores IS the order the run emitted.

## 3. The gate's ledger

The recorded coefficients say what the gate decided, case by case, and the two arms replay both outcomes:

| | cases | the term fixed | the term broke | neutral |
|---|---:|---:|---:|---:|
| **admitted** | 108 | 44 | 2 | 62 |
| **refused** | 1 114 | *111 would have* | *88 would have* | 915 |

Admission is precise — 44 gains against 2 losses — and refusal is where the money is: the gate gives up **111** cases
the term would have fixed in order to avoid **88** it would have broken. That trade is worth **+23** net, which is
exactly `1 096 − 1 073`.

The magnitude half of the predicate is what does this. The name half admits every case whose dominant metric is
duration-shaped — which on this corpus is nearly everything, including the two types the term harms — and the rise
bar then cuts the 765 the name half admits down to 108 on this dump. A `ReplaceCode` fault makes calls *fail*, not *slow*: its
rank-1 inbound rise sits at ~0.98, so the bar refuses all 231 of them, and they are 58 of the 111 cases the gate
costs itself. **The gate's second half is the wrong observable for the term it guards** — that is the next subject,
and it now has a number.

## 4. The three arms, per family

```
arm        answers    share   optimistic
off           1031   72.50%         1031
recorded      1073   75.46%         1073
on            1096   77.07%         1096
union         1186   83.40%   (per-case oracle)
```

| faultType | n | off | **as shipped** | on | on − off | oracle |
|---|---:|---:|---:|---:|---:|---:|
| HTTPResponseReplaceCode | 231 | 162 | **162** | 220 | +58 | 223 |
| HTTPRequestReplaceMethod | 190 | 123 | **125** | 131 | +8 | 135 |
| JVMMemoryStress | 171 | 171 | **171** | 153 | −18 | 171 |
| NetworkPartition | 97 | 48 | **64** | 70 | +22 | 71 |
| ContainerKill | 89 | 89 | **89** | 79 | −10 | 89 |
| HTTPResponseDelay | 89 | 56 | **56** | 51 | −5 | 59 |
| HTTPRequestDelay | 88 | 57 | **57** | 48 | −9 | 61 |
| HTTPRequestAbort | 60 | 46 | **46** | 43 | −3 | 48 |
| HTTPResponseReplaceBody | 51 | 45 | **45** | 46 | +1 | 47 |
| NetworkLoss | 48 | 21 | **29** | 33 | +12 | 34 |
| NetworkCorrupt | 46 | 23 | **31** | 32 | +9 | 32 |
| HTTPResponseAbort | 44 | 34 | **34** | 32 | −2 | 34 |
| JVMException | 43 | 30 | **30** | 37 | +7 | 37 |
| NetworkBandwidth | 42 | 12 | **20** | 30 | +18 | 30 |
| HTTPRequestReplacePath | 39 | 38 | **38** | 35 | −3 | 38 |
| PodFailure | 24 | 24 | **24** | 12 | −12 | 24 |
| JVMReturn | 21 | 12 | **12** | 12 | 0 | 13 |
| NetworkDelay | 21 | 20 | **20** | 20 | 0 | 20 |
| PodKill | 10 | 10 | **10** | 6 | −4 | 10 |
| JVMLatency | 7 | 6 | **6** | 6 | 0 | 6 |
| HTTPResponsePatchBody | 4 | 3 | **3** | 0 | −3 | 3 |
| JVMCPUStress | 2 | 1 | **1** | 0 | −1 | 1 |
| JVMMySQLLatency | 2 | 0 | **0** | 0 | 0 | 0 |
| TimeSkew | 2 | 0 | **0** | 0 | 0 | 0 |
| DNSRandom | 1 | 0 | **0** | 0 | 0 | 0 |

Three things this table says that no earlier reading could:

1. **The term is worth +42 net as shipped and +65 net ungated**, and the shipped gate's own price is the family
   pattern in the `on − off` column: `ReplaceCode +58`, `NetworkPartition +22`, `NetworkBandwidth +18`,
   `NetworkLoss +12`, `NetworkCorrupt +9`, `ReplaceMethod +8`, `JVMException +7` against `JVMMemoryStress −18`,
   `PodFailure −12`, `ContainerKill −10`, `HTTPRequestDelay −9`, `HTTPResponseDelay −5`, `PodKill −4`.
2. **The families that lose are the families the baseline has already saturated** — 171/171, 89/89, 24/24. A prior
   cannot gain where nothing is missing; it can only interfere. The gate is protecting exactly those, and it is doing
   it with a predicate that cannot see saturation.
3. **The oracle is not evenly spread.** `HTTPResponseReplaceCode` alone has 61 cases between the run and the union,
   and the six families the gate currently resists account for the rest. A selector does not have to be uniformly
   good to be worth double digits; it has to be right where the mass is.

## 5. What this invalidates

- **Every `Δw = 0` baseline since iteration 272.** They read 1 031, which is the gated term forced off everywhere:
  a configuration that was never deployed.
- **Iteration 276's `+19`.** The gate-clean vector it fitted answers 1 050. Against the run's 1 073 that is **−23**.
  The gate's *price* — 1 185 for the unconstrained fit against 1 050 for the gate-clean one, `−135` — is a difference
  of two vectors and survives the correction; what does not survive is calling either of them an improvement. The
  direction of 276's conclusion holds — the family gate refuses about six sevenths of the reachable gain — but every
  delta in it is stated against a configuration that was never deployed, and the sign of the headline flips.
- **Iteration 276's reading of the zero vector.** It said the zero vector's 1 073 was the published run "won entirely
  by tie". The ties are real and harmless; the number is the run's own top-1, which the zero vector reproduces
  because with every score level the stable sort keeps the dump's order. **The dump's first candidate IS the run's
  answer**, so `Top@1` over this artifact must be read as "the top-1 the run emitted", not as "the best-scoring
  candidate under some vector".

## 6. The fix

| Where | What changed |
|---|---|
| `benchmarks/src/term-weight-screen.ts` | `shippedWeightsOf` returns the **largest** recorded coefficient per name, which is the configuration, instead of the first, which was a refusal |
| `benchmarks/src/gate-fit.ts` | `readScores` is the single owner of the tie rule; `readUnder` delegates. Two copies of that loop is how the same artifact came to score 1 031 and 1 073 in two places |
| `benchmarks/src/conditional-weight.ts` | the census (theorem, states, conflicts, residual) and `ablateTerm` (three arms, the gate's ledger, the oracle) |
| `benchmarks/src/run-conditional-ablation.ts` | the console: census, the dump's own top-1, and the ablation for every conditional name |
| `benchmarks/src/run-gate-fit.ts` | prints the configuration, the dump's own top-1 and the zero vector as three separate numbers, because a reader cannot tell which one a `Δw = 0` row is against |

## 7. What this does not establish

- **The oracle is not a score.** 1 186 decides each case knowing the answer. It bounds what a gate can be worth; it
  is not a thing to ship, and a selector fitted on this corpus will not reach it.
- **One corpus, one term.** The census is over the 1 422-case archive dump and the ablation over `failedEdge`. Nothing
  here says another dataset has a conditional name, or that this one's gate refuses the same cases there.
- **No engine run.** Every number is arithmetic over a dump. The confirmation that the gate's predicate can be
  narrowed needs the corpus and one dispatch, neither of which runs here.
- **The union is over two arms, not over all vectors.** A per-case choice of *weight vector* still has the ceiling
  iteration 275 measured (349 of 391 misses separable); this document is about one binary decision inside the fusion.

## 8. Reproducing it

```
npx tsx benchmarks/src/run-conditional-ablation.ts --terms <archive-dump.ndjson>
npx tsx benchmarks/src/run-conditional-ablation.ts --terms <dump> --term lat --all
```

The first prints the census, the dump's own top-1, and the three arms with the gate's ledger and per-family rows. The
second repeats the ablation for any name, which is what makes this a tool rather than a note about one term.
