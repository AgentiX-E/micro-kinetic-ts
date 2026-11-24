# 337 — The 94 misses have names, and no promotion rule buys them

**Iteration 337 · 2026-11-24 · cost ¥0 (no dispatch, no endpoint) · surface unchanged at 1 328 / 1 422 = 93.39 %**

The surface did not move this iteration, and that is the result rather than a shortfall. Every remaining miss was
classified from artifacts that were already paid for, and the three rule families that could have bought them were
priced on the shipped surface and **refused by their own arithmetic**. What is left is not a queue of cases a rule can
reach; it is a statement about where the information ends.

---

## 1. The ledger

`benchmarks/src/miss-ledger.ts` (42 tests, coverage **100 / 98.03 / 100 / 100**) and `run-miss-ledger.ts`, over four
pinned artifacts:

| input | sha256 |
| ----- | ------ |
| answers `query-agent.ndjson` | `572952e8ab856422` |
| verdicts `per-case.ndjson` (336) | `da336800ec7c0ce1` |
| failing edges (corpus walk) | `d03c7cac63d2fc12` |
| term dump `terms.ndjson` | `ea103feca6864eab` |

```
surfaces: arm answers 1287 -> first hop 1308 -> shipped 1328 / 1422 (93.39 %)
class             cases
engine-was-right  9
seen-not-taken    37
breadth           48
absent            0
```

The classes are read from the engine's own `truthRank` — the truth's rank among **all** its candidates — so the seed
boundary is a fact about the artifact rather than about a configuration: rank 1 is a precedence failure, 2–5 is a
reasoning failure, 6 and beyond is a breadth failure, and an unranked truth is a pool failure. **Absent is zero**,
which closes the "add candidates" direction a second time and on a better surface than 334's.

## 2. The channel that settled each miss

| class | model | prior | interface | entry |
| ----- | ----: | ----: | --------: | ----: |
| engine-was-right | 6 | — | — | 3 |
| seen-not-taken | 17 | 19 | — | 1 |
| breadth | 28 | 19 | — | 1 |

Two readings, both consequential:

1. **`unwidenable 20`.** Twenty of the forty-eight breadth misses were settled by a channel that never reads the seed.
   A wider seed pays tokens on every case it is applied to and cannot touch these twenty at any width, so breadth's
   addressable ceiling is **28**, not 48.
2. **The interface channel is 149 / 149.** On the arm's own answers the four channels read: interface **149 / 149
   (100 %)**, prior 474 / 524 (90.46 %), model 595 / 668 (89.07 %), entry 69 / 81 (85.19 %). The strongest channel is
   the one that reads interface-level evidence, and it is the one with no misses at all.

## 3. The promotion sweep: four scopings, four refusals

The obvious repair for the nine precedence residues is "publish the engine's own first choice when the pipeline moved
away from it". Priced on the shipped surface:

| rule | fires | repairs | breaks | delta | precision |
| ---- | ----: | ------: | -----: | ----: | --------: |
| model agrees with the engine, publish the engine | 62 | 1 | 59 | **−58** | 0.017 |
| engine over the model's channel | 78 | 6 | 60 | **−54** | 0.091 |
| engine over any channel | 205 | 9 | 181 | **−172** | 0.047 |
| engine over a quiet answer (ratio < 0.5) | 83 | 1 | 77 | **−76** | 0.013 |

The engine's own first choice is right on **1 156** cases; the shipped pipeline is right on **1 328**. Every rule that
could reclaim the nine cases where the engine led with the truth also reclaims 181 cases where it did not, because the
channels earn **+172** by moving away from the engine and the nine are that trade's price. This is the fourth time this
register has refuted a precedence family (§331 loudness, §332 head, §336 margin, §337 promotion), and the first time the
price is stated in the same table as the prize.

**This is also the answer to the counterintuitive question.** An arm that is switched on is not worse than the engine:
the arm reads 1 287 against the deterministic path's 1 156 (**+131**), and the model's own naming is right on 595 of the
668 cases it settles (89.07 %). What is worse than the engine is the model's *naming taken as the answer* — 615 of 1 422
— which is the comparison a "trust the model" rule makes. The LLM is worth 131 cases inside the fusion and less than
nothing as the authority over it.

## 4. The stability statistic, priced and refused

§336 named the margin's stability as the next axis: whether a case is decided by one number at the injection time or by
the whole window. The cheapest reading of "one number" is the score's own decomposition — `finalScore = log1p(selfAnomaly)
+ Σ weight × signal`, so the share of the margin carried by its largest single term is exact per case and free.

| bar | moved | repairs | breaks | repairs' share (min / median / max) | breaks' share |
| --: | ----: | ------: | -----: | ----------------------------------- | ------------ |
| 0.5 | 38 | 22 | 14 | 0.867 / 1.011 / 1.377 | 0.404 / 1.114 / 1.570 |
| 1.0 | 20 | 20 | 0 | 0.867 / 1.013 / 1.377 | — |
| 1.5 | 20 | 20 | 0 | 0.867 / 1.013 / 1.377 | — |
| 3.0 | 18 | 18 | 0 | 0.867 / 0.999 / 1.176 | — |

At the only bar where the trade-off exists, the breaks' interval **contains** the repairs': no floor keeps one and drops
the other, `separates false`. The reason is structural rather than statistical — every one of the twenty shipped repairs
carries at least **86.7 %** of its margin on a single term, and that term is the kinetic onset gap. A statistic whose
whole population is dominated by the theory's own quantity cannot separate good decisions from bad ones; it can only
report that the theory is doing the work. The axis is closed, and the closure is a statement about the score's design.

## 5. What the four inputs cost, and what the next axis costs

| axis | population | reachable by a rule? | cost to test |
| ---- | ---------: | -------------------- | -----------: |
| precedence residue | 9 | **no** — 4 scopings, all negative | ¥0, done |
| reasoning (`seen-not-taken`) | 37 | only by changing the evidence in the prompt | ≈ ¥21 (full arm) |
| breadth | 48 (28 addressable) | only by widening the seed, and 20 rows never reach the model | ≈ ¥2 (74-case ceiling arm) |
| absent | 0 | — | — |

The next axis with a *theory* behind it is external, not internal: **CIE** (arXiv:2601.21359v2) proves that a
**conjunctive** internal × external score ranks the root first under arbitrary amplification, while an additive score
needs bounded amplification. Our score is additive. The term dump already carries both sides per candidate, so the
conjunctive form is a ¥0 test on this corpus and the natural next iteration.

## 6. Falsifiers

1. **If a conjunctive score ranks above 1 156 on the same dump**, the engine's formula changes and every rung above it
   is re-priced; if it does not, CIE's guarantee is about a population this corpus does not contain and the register
   says so with the number.
2. **If a 74-case widening arm at width 22 shows the block cases are reachable**, breadth becomes a budget and its
   ceiling is 28; if it shows they are not, the block is a model-family question and no width is bought.
3. **If any promotion rule's precision exceeds 0.5 on a held-out fold**, the sweep above is withdrawn and the rule is
   priced properly; the sweep is printed per rule so that outcome is visible without a re-read.

## 7. Reproduce

```bash
npx tsx benchmarks/src/run-miss-ledger.ts \
  --answers artifacts/agentic/query-agent.ndjson \
  --cases artifacts/agentic/per-case.ndjson \
  --edges artifacts/agentic/corpus-walk.ndjson \
  --terms artifacts/agentic/terms.ndjson
```

The runner prints every digest before any number and calls no endpoint.
