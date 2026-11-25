# 347 — The two files were never the same arm

**Iteration 347 · 2026-11-25 · cost ¥0 to establish (two artifacts read) · the 236-case "drift" of iteration 346 is a
configuration delta**

Iteration 346 published a **236-case drift in a single arm** between two days and hung this programme's standing on it:
"the free arm is a level around 174 ± 6 today, 414 is a historical record, and `1 328 / 1 422 = 93.39 %` cannot be
reproduced at any price." That reading came from comparing two artifacts called _the free arm_.

They were not the same arm. One of them ran a **pipeline** and the other ran a **bare model**, and the gap between them
is the pipeline's non-model half, not a supplier's model changing under us. This entry is the decomposition, and it
reverses 346's §1–§5.

---

## 1. The two files, in their own words

Both artifacts carry a banner the runner writes at the end. It is the only place either file says what configuration it
was:

```
2026-11-22  run 45085062340   Free-investigation arm — deepseek-chat, budget 6 rounds, seed none,
                              gate contrast, fallback engine
2026-11-25  run 45519251447   Free-investigation arm — deepseek-chat, budget 6 rounds, seed none,
                              gate none, fallback none, schedule none, fleet none, onset none
```

The first line is missing one field the artifact does carry: **the resolvers**. Its rows record who answered —
`answeredBy`, one of `model`, `prior`, `interface`, `entry` — and on the 532 sampled cases it says **287 were not
answered by the model at all**: 155 fell back to the engine's own answer, 71 were settled by the entry-prior rule, 61 by
the interface witness. The second line answered **532 of 532** from the model.

| field                      | 2026-11-22 (414) | 2026-11-25 (170) |
| -------------------------- | ---------------- | ---------------- |
| `seed`                     | none             | none             |
| `gate`                     | **contrast**     | **none**         |
| `fallback`                 | **engine**       | **none**         |
| `resolve`                  | **edge-novel**   | **none**         |
| `schedule`/`fleet`/`onset` | none             | none             |
| answered by the model      | 245 of 532       | **532 of 532**   |

Three of the four harness decisions differ, and **two of them were not in the record** written in 346 to make
comparisons safe (`run-metadata.ts` carried `seed`, `gate`, `schedule`, `fleet`, `onset` — not `fallback`, not
`resolve`). Two files both reading `free`+`gate=contrast` are two configurations a reader cannot tell apart.

**A provenance note, because this entry is about provenance.** 346's table dates the 414 to "2026-11-23 09:21". No
dispatch of `benchmark-agentic.yml` ran its arm at that time: the arm step of run `45094723902` (09:27 +0800) is
**`skipped`**, and the artifact that actually holds 414 is `45085062340`, whose arm ran **00:26–00:58Z on 11-23**
(08:26–08:58 +0800). The number is right; the row that dated it was pointing at a run that measured nothing.

## 2. The 244 cases, split by who answered

Both files cover the same 532 ids (`stride` over the same corpus, `converterDigest b7fca80e…`). Reading the old file's
`answeredBy` against both files' `correct`:

| old `answeredBy` | cases |  old correct |  new correct | movement |
| ---------------- | ----: | -----------: | -----------: | -------: |
| `model`          |   245 | 180 (73.5 %) | 122 (49.8 %) |      −58 |
| `prior`          |   155 | 105 (67.7 %) |  40 (25.8 %) |      −65 |
| `entry`          |    71 |  68 (95.8 %) |   2 ( 2.8 %) |      −66 |
| `interface`      |    61 |   61 (100 %) |   6 ( 9.8 %) |      −55 |
| **total**        |   532 |      **414** |      **170** | **−244** |

**186 of the 244 cases (76 %) were never a model answer in either run.** They are the rows the pipeline settled
without asking the model — 234 of those 287 were right on 11-22 (81.5 %), and the same cases answered by the model
alone today are right 48 times (16.7 %). A fallback and two resolvers were worth **+186 cases** on this sample, and
346 read their absence as the model getting worse.

The remaining **58 cases** are the model's own answers, and they are not a drift either:

| old `answeredBy = model` | cases | old correct | new correct |
| ------------------------ | ----: | ----------: | ----------: |
| same answer string today |   139 |         119 |     **119** |
| different answer today   |   106 |          61 |           3 |

On the 139 cases where both runs produced the **same answer**, correctness agrees on **139 of 139** — zero
disagreements. The 106 that changed are the cases where the final turn of the investigation differs: 589 of the old
run's 1 422 investigations ended on the round cap (`stop: rounds`) because a fallback existed and nothing forced an
answer, while today's loop tells the model on its last turn that an unanswered case scores zero and 532 of 532 answer.
That instruction is in this repository's own code. **No supplier-side change is required to explain any part of the 244.**

## 3. What this reverses

| published in 346                                                               | status after this reading                                                               |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| "free arm drifted 236 cases between 11-23 and 11-24"                           | **withdrawn** — 186 cases are the fallback and the resolvers, 58 are a final-turn rule  |
| "the free arm's accuracy today is a level around 174 ± 6"                      | **withdrawn as a product statement** — it is the level of a _bare_ arm with no fallback |
| "the standing `1 328 / 1 422 = 93.39 %` cannot be reproduced at any price"     | **withdrawn** — the standing is a pipeline number and a bare arm cannot speak to it     |
| "§5.1 fires: 414 is a historical record that may not be compared"              | **withdrawn** — 414 is a pipeline reading, comparable with other pipeline readings      |
| 344's decomposition: "its gap is a day boundary rather than two arms"          | **stands withdrawn, for a different reason** — 209 was a bare arm and 414 a pipeline    |
| 342b/343 baselines: "−43 pp", "−38.53 pp"                                      | **still invalid** — both compared a bare arm to a pipeline control                      |
| 346's "+31 shortlist, +39 shortlist"                                           | **stands** — 178 and 209 are both bare arms on the same ids, on adjacent days           |
| 341's ceiling correction (98.33 % was the hits stratum, ceilings 1.61/2.23 pp) | **stands** — a within-run decomposition of one artifact                                 |

The uncomfortable pattern is worth naming: this programme has now published a **sign flip** (343), a **decomposition**
(344) and a **drift with a retraction attached** (346), and all three came from the same missing step — no run recorded
which configuration it was, so the reader reconstructed it from the numbers. The numbers were consistent with the arm
effect and with the configuration delta, and the reader chose the arm effect.

## 4. What the standing actually is

The 11-22 pipeline artifact reads itself:

```
cases 1422 · answered 1422 · answered by the model 668 · by the prior 524
repairs 153 · breaks 22 · precision 0.874
retained 1134/1156 of the engine's own (0.981) · repaired 153/266 of its misses
agent Top@1 1287 · engine Top@1 on the same cases 1156
tokens 10 249 721 + 46 143 · est. ¥20.87
```

**1 287 / 1 422 = 90.51 %** with `gate contrast, fallback engine, resolve edge-novel`. The published **93.39 %** adds
two deterministic guards over that settled answer — the first hop (`ENTRY_FIRST_HOP_BETA = 50`, +50 cases on the
11-22/23 artifacts) and engine certainty (`ENGINE_CERTAINTY_MARGIN = 1.5`, +20) — neither of which calls an endpoint,
so both are re-reads rather than measurements.

The model's marginal contribution to the pipeline is **+131 cases over the engine alone** (1 287 − 1 156), bought with
153 repairs against 22 breaks at precision 0.874. That is the number the "does the LLM help" question is answered by,
and it was never the number being compared.

### 4.1 The re-measure, and what it returned

Dispatched at 02:11 on 11-25 over the full corpus with the same flags (`gate contrast, fallback engine, resolve
edge-novel`), run `45531140696`, **¥20.81**:

```
cases 1422 · answered 1422 · answered by the model 636 · by the prior 516
repairs 180 · breaks 8 · precision 0.957
retained 1148/1156 of the engine's own (0.993) · repaired 180/266 of its misses
agent Top@1 1328 · engine Top@1 on the same cases 1156
```

**1 328 / 1 422 = 93.39 %**, in one artifact, with the two deterministic guards applied inside it (`door` 28 answers,
`certainty` 20). Against the 11-22 artifact on the same 1 422 ids: **42 cases gained, 1 lost, Δ +41, p < 0.001** — which
is the guards' own worth, measured as a paired delta for the first time. The model's marginal contribution is now
**+172 over the engine alone** (180 repairs − 8 breaks), and the precision of an admitted override is **0.957** against
0.874 in November.

The "cannot be reproduced at any price" claim of 346 is answered by a ¥21 dispatch: the number reproduces, and it
reproduces *higher*.

**What is left: 94 cases.** Eight are breaks (5 by the model, 3 by the `entry-prior` resolver) and 86 are engine misses
the arm did not repair. Of those 86, **37 sit inside the engine's own top five** and 12 more inside the top ten — 49
cases, 3.4 points, reachable by a re-ranker. The remaining 20 sit at rank 21 or deeper, which is the retrieval block no
scoring change can reach.

## 5. What ships, so that this cannot be read again

Three changes, each a field or a check rather than a paragraph:

1. **`run-metadata.ts` names `fallback` and `resolve`, and requires them.** They are not optional: the 11-22 record
   would have read `gate=contrast+fallback=engine+resolve=edge-novel` instead of `gate=contrast`, and the first line of
   this entry would have been a `cat` instead of an afternoon.
2. **`run-metadata.ts` records `revision`** (`GITHUB_SHA`), because the instruction the model reads is a function of
   the tree: two artifacts from different commits are two instruments, and a comparison across them is a bisect.
3. **`arm-comparison.ts` refuses the pairing.** `comparisonRefusal(first, second, axis)` returns a sentence naming
   every difference outside the declared axis — model, budget, revision, and every `arms` key, with a flag **absent**
   from one record counted as a difference rather than a default. `run-arm-comparison.ts` exits 1 rather than printing
   a table beside a warning, and prints the paired 2 × 2 with **both** McNemar forms (the exact conditional binomial,
   and the continuity-corrected chi-square whose 0.243 for 22 against 14 is the figure already in print).

   It is also the first instrument in this package that computes the test at all: every p-value this programme has
   published was computed outside it, in a shell one-liner nobody could re-run.

4. **The control runs in the same job.** `benchmark-agentic.yml` gains `query_control=free`: the same runner, the same
   sample, minutes apart, with the HARNESS flags (`seed`, `gate`, `fallback`, `resolve`) forwarded exactly as
   dispatched and the three PRESENTATION flags (`schedule`, `fleet`, `onset`) omitted — because those three are the
   axis. The comparison step derives the axis from the dispatch rather than from a typed string, so it cannot name a
   flag that did not move and cannot omit one that did.

Guarded by `benchmarks/__tests__/arm-comparison.test.ts` (26 cases, 100 % statements / branches / functions / lines),
`run-metadata.test.ts` (the two new fields are compile-time requirements) and five new assertions in
`agentic-workflow-wiring.test.ts` that read the workflow as text — the control's flags, the comparison's inputs, the
derived axis, and the four files the artifact must now carry (the `meta.json` files were written last iteration and
**never uploaded**).

## 6. What this closes and what it opens

**Closes the drift:** the hypothesis itself, and with it the reason 346 withheld the standing. The measurement line's oldest defect — a delta between two files whose configurations differ — now has an executable refusal.

**Closes the standing, at ¥21:** the dispatch returned **1 328 / 1 422 = 93.39 %** (§4.1), and its own gate
table re-scores `none`/`cited`/`cone`/`contrast`/`lag` from one artifact at no extra cost: `lag` reads 83.05 % of the
corpus at precision 0.766 and `contrast` 90.58 % resolved, so the shipped gate is confirmed by today's artifact rather
than inherited from November's.

**Does not open:** the bare arm is still the wrong instrument for this question, and the presentation axis
(`fleet`/`schedule`/`onset`) has never been measured against a pipeline control. The +31 the shortlist earned was
against a bare arm, and a bare arm is a _replacement_, not a repair — which is why it loses 139 cases to breaks on a
population where the engine is 81.29 % right.
