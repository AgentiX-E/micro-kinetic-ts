# 336 — The margin is a column of the product, and the guard ships

**Iteration 336 · 2026-11-23 · cost ¥0 (no dispatch, no endpoint) · surface 1 308 → 1 328 / 1 422 (91.98 % → 93.39 %)**

Iteration 334 measured a guard that refuses to let a resolver rename a case the engine was decided about, read
**+10 / +10** held out at precision **1.000 / 1.000**, and then **withheld it** — not out of doubt, but because its input
was a margin taken between the two candidates a *score-sorted dump* placed first and second, while the product publishes
an order that is not a function of the scores. The two orders disagree on **83 of 1 422** cases. A bar computed on one
pair is not the product's bar.

This iteration closes that gap twice and ships the rule.

---

## 1. The pair: the product's, not the sorted one

The engine's published order and its score order differ because two relational passes — `containmentOrder` and the
failure flow — permute a finished list by reading instruments no term scores. A margin taken from the score order is
therefore a margin about a pair the reader never saw.

The guard now reads `score(published[0]) − score(published[1])`. The consequence is stated rather than smoothed over:
the margin **may be negative**, and on those cases the engine's published first choice is one its own arithmetic scores
below the runner-up — which is exactly the population a "do not rename a decided engine" rule must leave alone.

Whole-corpus deltas (repairs − breaks), R1 / B, under the two definitions of "the pair":

| definition of the margin | bar 0.5 | bar 1.0 | bar 1.5 | bar 2.0 |
| ------------------------ | ------: | ------: | ------: | ------: |
| score-sorted pair (334) | −11 / −9 | +17 / +19 | +20 / +21 | +20 / +21 |
| **published pair (336)** | **+8 / +11** | **+20 / +22** | **+20 / +21** | **+20 / +21** |

The two definitions agree at the shipped bar and diverge below it, where the sorted pair breaks far more than it
repairs (33 breaks against 22 repairs at 0.5, against 14 breaks on the published pair). The reading was never fragile;
it was, however, **about the wrong pair** — and a margin whose two ends are candidates the product never placed first
and second is a statement about the dump, not about the engine.

## 2. The column: the verdict file now carries the engine's own two values

`per-case.ndjson` deliberately carried **no score of the engine's own** — a score invites a reader to re-derive the
order from it, and the order is not a function of the scores. Iteration 334 paid for that rule from the other side.

The row now carries `top1Score` and `top2Score`: the engine's `finalScore` for the two candidates it placed first and
second, in that order, with no threshold applied. They do not invite a re-sort — `ranked` keeps that authority, and the
pair the values describe is the pair `ranked` names. Three states are distinguished and each is asserted:

| state | written as | read as |
| ----- | ---------- | ------- |
| the engine computed both | two numbers | measured |
| a one-candidate ranking | `top1Score` only | unmeasured margin |
| a producer that does not sum its terms | the column is absent | unmeasured margin |

`marginColumns(ranking)` is the single owner of the derivation, so the runner cannot answer it with a second rule, and
`engineOpinionOf({ winner, top1Score, top2Score })` is the single owner of the sign — including the negative case,
which a clamped reader would report as decided.

### 2.1 The dump's `score` IS the engine's `finalScore`, recomputed on every candidate

`finalScore(v) = log1p(selfAnomaly(v)) + Σ signalWeight × signal(v)`, and the dump records `(name, weight, slope)` for
every candidate beside its `score`. Recomputing the sum:

```
worst |score − Σ w·slope| = 0.000e+0   over 69 688 candidates   (1 422 cases × 49–50 services)
```

Exact, not close. That is what makes the dump a second source of the same number rather than an approximation of it, and
it is why the reading taken through the dump in §3 and the reading taken through the artifact's own columns in §4 are
the same number rather than two numbers that happen to agree.

## 3. The engine re-run: the published order reproduces on 1 422 of 1 422

A local run of the FSE'26 engine over the full corpus (`--data-dir /root/rcabench/json`, no endpoint, **¥0**, 15 m 56 s)
wrote a verdict file that carries the new columns. Comparing it with the artifact the paid arm was dispatched from:

| field | agreement |
| ----- | --------- |
| `ranked` (the engine's order, five wide) | **1 422 / 1 422** |
| `truthRank` | 1 422 / 1 422 |
| `pool` | 1 422 / 1 422 |
| rows carrying `top1Score` / `top2Score` | 1 422 / 1 422 |

The engine is deterministic and calls no endpoint, so the re-run is not a second measurement of the arm: it is the
**same verdict** with one column added. The arm's paid answers therefore remain valid inputs — it consumes `ranked` and
nothing else — and the guard can be priced on the artifact's own numbers with no join.

## 4. The reading

`run-engine-certainty.ts`, all four inputs pinned by sha256, `margin source: 1422 rows read the artifact's own columns,
0 fell back to the dump`:

```
  margin  fold0  fold1   repairs  breaks
     0.5    659    657        22      14
     1.0    665    663        20       0
     1.5    665    663        20       0
     2.0    665    663        20       0
     3.0    664    662        18       0
     4.0    660    657         9       0
     5.0    655    653         0       0
  shipped 655 / 653, chosen 1 / 1, held out 665 / 663, delta 10 / 10
P4 -- precision 1.000 / 1.000
verdict: passes every clause
```

| artifact | first-hop surface | + guard | Acc@1 | moved | repairs / breaks | precision |
| -------- | ----------------: | ------: | ----: | ----: | ---------------: | --------: |
| R1 | 1 308 | **1 328** | **93.39 %** | 20 | 20 / 0 | 1.000 / 1.000 |
| B | 1 305 | **1 327** | **93.32 %** | 21 | 21 / 0 | 1.000 / 1.000 |

The chosen cell is 1.0 on both folds of both artifacts and the reading is **flat from 1.0 to 2.0** on both, so the
shipped constant 1.5 sits inside a plateau rather than on its slope. At 0.5 the rule starts breaking cases — 14 of the
36 it moves on R1 — which is the failure mode the precision floor exists to catch, and it is caught: 0.5 is
selected on neither fold, so the clause that reads the chosen cells never has to refuse it.

**Two folds, selected on one and read on the other.** Fold sizes are 655 / 653; the delta is +10 on each for R1 and
+11 on each for B, so neither the sign nor the magnitude depends on which half chose the bar.

## 5. A defect the equivalence test found

The instrument (`certaintyUnder`) and the product (`engineCertainty`) are two implementations of one statement, which
is the shape iteration 322 paid a dispatch to learn to avoid. A test now walks the whole grid — 3 answers × 3 engine
tops × 6 margins × 8 bars — and requires the two to settle on the same name.

It failed on the first run. `certaintyUnder` compared `one.margin <= bar`; `NaN <= 1.5` is **false**, so a margin that
was a failed measurement fell through and the guard **fired**. The product had already narrowed by measurement
(`Number.isFinite`) and refused. The instrument would have read a `NaN` margin as "the engine was decided", which on a
real artifact would report a repair for a rule that never saw a number.

Fixed in the instrument, not in the product: `null` and `NaN` are the same absence, and both must leave the pipeline
alone. The test is the fence — the two cannot drift apart again without it failing.

## 6. What ships, and what it costs to turn off

| surface | rule | constant | reads |
| ------- | ---- | -------- | ----- |
| 1 115 | engine | — | — |
| 1 114 | + gate | `GatePolicy` | the cone |
| 1 073 | + fusion | `FusionPolicy` | the fusion head |
| 1 156 | + deterministic path | `Resolution` | the channels |
| 1 287 | + model arm and resolvers | `Resolution` | the answers |
| 1 308 | + first hop | `ENTRY_FIRST_HOP_BETA = 50` | the door's own boundary |
| **1 328** | **+ engine certainty** | **`ENGINE_CERTAINTY_MARGIN = 1.5`** | **the engine's pair** |

`ENGINE_CERTAINTY_MARGIN = null` restores the 335 surface byte for byte — the same constant is the product switch and
the ablation switch, as every rule in this file has been. The arm reads it from the verdict it was handed
(`readVerdicts` → `engineOpinionOf` → `applyResolver`), and records the input it read as `engineMargin` on every row,
so an artifact can be asked which cases the rule was **allowed** to answer for, not only which it answered.

The guard is applied **last**, over what the pipeline would actually publish, and it can therefore overrule the first
hop. That ordering is the one the reading prices; applying it before the door would price a pipeline nobody runs.

## 7. What this does not close

1. **The 74 retrieval misses are untouched.** Their truth sits at engine rank 6–44 (median 22) and never reached the
   model. Breadth is the only axis that reaches them, and §`retrieval-block-334.md` §3 refuted both deployable bars for
   buying it.
2. **The arm's next dispatch is the only thing that can move `engineMargin` from "the column exists" to "the column was
   produced by a dispatch".** Nothing in this iteration depends on that happening; it is how the next artifact will
   carry the input natively rather than by re-run.
3. **Model drift remains unmeasured** and belongs to the endpoint: 50 cases stratify-bounded at `50 × ¥0.0147 ≈ ¥0.74`.

## 8. Reproduce

```bash
# 1. The engine's own verdict, with the two columns (¥0, ~16 min, no endpoint).
npx tsx benchmarks/src/run-fse26.ts \
  --data-dir "$HOME/rcabench/json" \
  --fault-free-profile "$HOME/fault-free-profile.json" \
  --per-case-out /tmp/art336/per-case.ndjson \
  --output /tmp/art336/results.json

# 2. The reading, on the artifact's own columns.
npx tsx benchmarks/src/run-engine-certainty.ts \
  --terms <terms.ndjson> --answers <query-agent.ndjson> \
  --edges <corpus-walk.ndjson> --cases /tmp/art336/per-case.ndjson
```
