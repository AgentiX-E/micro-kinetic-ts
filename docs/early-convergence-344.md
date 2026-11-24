# Early convergence, measured: how much of the shortlist's loss is the model stopping sooner

Iteration 343 closed the axis "show the arm the engine's order" in its third form. Its reading named a mechanism —
_substitution_: a presented ranking is read as a candidate set, and the model's reconciliation of two rankings is worse
than either. This entry does what that reading only asserted: **it prices early convergence against the other halves of
the loss**, on the same 532 paired cases, at ¥0, from artifacts already paid for.

The answer in advance: **convergence is real, it is the smaller half, and it accounts for about 40 % of the 205-case
gap.** The rest is not the model stopping sooner — it is the model, having stopped at the same place, no longer able to
reason its way to the answer.

## 1. What "convergence" can and cannot mean here

Three facts bound the measurement before any table is read:

1. **The budget is spent, not saved.** All three arms run `rounds` 5.99 / 6.00 / 6.00 out of a 6-round budget whose last
   round can only answer. No arm stops early; the loop's round count is a constant.
2. **`calls` is de-duplicated by construction** — the field is "services the investigation executed a per-service query
   against, in first-query order" — so "repeat queries" are not visible in it. Convergence therefore cannot be measured
   as wasted repeats; it has to be measured as **coverage**, which is what `distinct` counts.
3. **The trace cannot supply a timeline.** 532 of 532 rows in both 342b arms are elided to their last 2 000 characters,
   so "at which exchange did the model stop exploring" is not in the artifact. The `census` added in 343 counts
   _whether_ a tool ran, not _when_.

So the measured quantity is: **how many distinct services the five executable calls end up covering, and what that
coverage is worth at the margin.** That is a weaker object than a timeline and it is enough to answer the question,
because the answer turns out to be "coverage is worth almost nothing".

## 2. Coverage, on the same 532 ids

| arm             | correct | distinct services / case | rounds | queried the culprit |
| --------------- | ------: | -----------------------: | -----: | ------------------: |
| free (no order) | **414** |                **1.895** |   5.99 |        294 (55.3 %) |
| schedule (342b) |     184 |                    1.718 |   6.00 |        199 (37.4 %) |
| shortlist (343) |     209 |                **1.615** |   6.00 |        204 (38.3 %) |

Coverage falls monotonically across the three presentations, and so does accuracy — which is exactly the correlation
that made "it stops sooner" look like the mechanism. It is a correlation of the wrong shape: **the schedule arm covers
more than the shortlist arm and scores lower** (1.718 → 1.615 is a _rise_ in coverage in the wrong direction, from 184
to 209 it is a fall in accuracy). If coverage drove accuracy, that pair would be ordered the other way.

## 3. The stratified table that decides it

`truth` in this corpus is a **two-element list** (`['mysql', 'ts-train-service']`); the service is its last element.
Splitting the 532 cases by (is the engine right) × (did the investigation ever query the culprit) × (is the answer
correct) gives the whole loss:

| stratum                 |             |                free |          shortlist | Δ correct |
| ----------------------- | ----------- | ------------------: | -----------------: | --------: |
| engine **hits** (266)   | queried     |   241 ✓ / 5 ✗ (246) | 134 ✓ / 27 ✗ (161) |  **−107** |
| engine **hits** (266)   | did **not** |     20 ✓ / 0 ✗ (20) |  26 ✓ / 79 ✗ (105) |        +6 |
| engine **misses** (266) | queried     |    38 ✓ / 10 ✗ (48) |    35 ✓ / 8 ✗ (43) |        −3 |
| engine **misses** (266) | did **not** | 115 ✓ / 103 ✗ (218) | 14 ✓ / 209 ✗ (223) |  **−101** |

Sum: −107 + 6 − 3 − 101 = **−205**, which is 414 − 209 exactly.

Two rows carry the finding and they are not the two that were expected.

**The `−107` row is the convergence block.** On the cases the engine already answers, the free arm queries the culprit in
246 of 266 and the shortlist arm in 161 — **85 fewer per-service queries**, i.e. `distinct` −0.280 is this. If those 85
kept the free arm's 98.0 % conversion, they would return **83 cases (40 % of the 205)**. That is the entire value of the
convergence, and it is the ceiling rather than the estimate: it assumes the arm would have answered as well as the free
arm had it only looked.

**The `−101` row is not convergence at all.** On the cases the engine gets WRONG, neither arm queries the culprit
(48 / 43 of 266) — the queries are comparable, so this block cannot be "stopped sooner". With **no** query of the
culprit, the free arm still answers correctly in **115 of 218 = 52.8 %**, and the shortlist arm in **14 of 223 = 6.3 %**.
The free arm has a path from the fleet's global evidence to the right service that never passes through a per-service
query, and the shortlist **destroys it**: a 46.5-point collapse in a block where both arms did the same thing 218 and
223 times.

**The residual 24 cases** are inside the `−107` row: the same 161 queries convert at 83.2 % instead of 98.0 %.

| block                                    | cases | share of 205 |
| ---------------------------------------- | ----: | -----------: |
| the model stopped querying (convergence) |    83 |     **40 %** |
| the inference path the section overwrote |   101 |     **49 %** |
| the same queries converting worse        |    24 |         12 % |

A second, independent estimate of the first block — reweight the shortlist arm's queries up to the free arm's 294 and
apply the shortlist arm's own conversion (82.8 %) — returns **+74 cases (36 %)**, not 83. The two estimates bracket the
convergence at **36–40 %**, and the ordering of the three blocks is the same under both: the overwritten inference path
is the largest single block.

## 4. What this does to the reach ceiling of 341

341 quoted a **98.33 % conversion** (1 178 / 1 198 investigations that queried the culprit answered correctly) and
multiplied the reach counts by it: 29 reachable cases × 98.33 % = **2.01 pp**, 40 cases = **2.77 pp**. The same
conversion, split by stratum on these 532 ids:

| arm       | engine hits | engine misses | blended |
| --------- | ----------: | ------------: | ------: |
| free      |  **98.0 %** |    **79.2 %** |  94.9 % |
| shortlist |      83.2 % |        81.4 % |  82.8 % |
| schedule  |      76.6 % |        75.6 % |  76.4 % |

The published 98.33 % is the **hits stratum's** number, and the hits stratum supplies 246 of the 294 culprits the free
arm queries (83.7 %) — because on a hit the culprit _is_ the engine's rank 1, so "queried the culprit" and "agreed with
the engine" are the same event counted once. The reach cases of 341 are by definition **misses**, and the misses stratum
converts at **79.2 %**, not 98.33 %.

Restated at the stratum the ceiling actually applies to:

| width | reach cases | 341's arithmetic | at the misses stratum |     Δ |
| ----: | ----------: | ---------------: | --------------------: | ----: |
|     5 |          29 |          2.01 pp |           **1.61 pp** | −0.40 |
|    10 |          40 |          2.77 pp |           **2.23 pp** | −0.54 |

The ceiling survives as a ceiling; it was overstated by about a fifth, by a rate measured mostly on cases that did not
need the mechanism it was pricing. **This is the second time this programme has used a blended rate on a stratified
question**, and the first time the blend was caught before a dispatch rather than after one.

## 5. Why the free arm can answer without querying

On the 115 cases the free arm answers correctly without ever querying the culprit, and the 103 it answers wrongly, the
investigations are **indistinguishable**: 1.90 vs 1.86 distinct services, 7 102 vs 7 046 prompt tokens, and the culprit's
position in the engine's order is spread across ranks 2–5 in both groups (97 / 103 at rank 5+). There is no behavioural
signature here to strengthen — the difference is in what the model does with evidence it already has, not in what it
goes and gets.

That is also why no tool-weighting change can be justified by this table: the block that collapses is the one where the
arm did **not** act. The lever is what the context contains, not the order the tools are offered in.

## 6. Falsifiers

1. **If a future arm raises `distinct` above the free arm's 1.895 and does not raise accuracy**, then coverage carries no
   signal at all and the 40 % above is an upper bound on a quantity that is zero. 341 prices that arm (`--max-rounds 11`,
   ¥14) and it has never been run.
2. **If, on the `misses / did not query` block, an arm reaches 52.8 % while showing no ranking**, then the collapse in
   §3 is not about the section's authority but about this sample, and the block must be re-measured on another sample
   before the axis is closed.
3. **If the `−107` row is reproduced with the shortlist printed but `distinct` held at 1.895** — e.g. by charging a
   call for looking away — then convergence is caused by the section rather than accompanying it, and the decomposition
   in §3 is wrong in the direction that would make the axis _more_ dangerous, not less.

## 7. Cost and reproducibility

¥0. Every number here is a re-read of `/tmp` artifacts already paid for: 343's `query-agent.ndjson` (532 rows, ¥7.17),
342b's (532 rows, ¥7.36) and the free arm's (1 422 rows, ¥9.05 — of which the 532 paired ids are used). The free arm
covers all 532 ids of the shortlist sample, so no case is imputed.

```bash
python3 /tmp/converge.py            # replicate §2 and §3
```

## 8. What follows

The product statement this measures is not "let the model investigate more" — it is **"do not overwrite a judgement the
model already made"**. Three presentations, three losses, and now a decomposition of the third: the majority of the
damage happens in cases where the arm's _behaviour_ is unchanged, which means the repair is not a budget knob and not a
tool weight. It is the absence of a competing ranking in the context.

The one lever this leaves open is the one nobody has pulled: more rounds with **no** order shown. 341 prices it at 40
reachable cases for 2× the model calls, and §4 corrects that price from 2.77 pp to 2.23 pp — a smaller prize than
advertised, for the same cost, and still the only untested arm on this axis.
