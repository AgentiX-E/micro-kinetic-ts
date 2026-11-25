# PROGRESS 2026-11-26a — iteration 355: the standing table was three weeks behind its own text, and the entry gate is refused on protocol grounds

**One-line:** RCABench's standing is **93.32 % (1 327/1 422)** against the published leader's **90.0 %**, at
**¥0.0012 a case against ¥32.9** — and the table that is supposed to say so still printed `−28.5 pp` and `88.82 %`.
This iteration repairs the table, merges the two repositories' copies of it (which had diverged in **both**
directions), redraws the accuracy × cost figure, and closes the `entry-prior` gate with a negative result and a
refusal that is about the evaluation protocol rather than about the numbers.

## 1. The standing, stated once and then used

| evaluation | metric | ours | best published | margin |
| --- | --- | ---: | --- | --- |
| RCABench, all 1 422 cases, gated LLM arm | Acc@1 | **93.32 %** (1 327) | **90.0 %** Sonnet · ThinkDepth.ai | **+3.32 pp** |
| RCABench, engine alone, no model call | Acc@1 | **81.29 %** (1 156) | 90.0 % | −8.71 pp |
| RCABench, cost | ¥ per case | **0.0012** | **32.9** ($4.64) | **≈ 27 000×** |
| RCAEval, all 735 | service Top-1 | **90.61 %** (666) | 68 % (PRISM, author's own) | +22.61 pp |
| RCAEval RE2-OB (90) | AC@1 | **93.3 %** | 74.44 % (GALA+) | +18.9 pp |
| RCAEval RE2-TT (90) | AC@1 | **84.4 %** | 73.3 % (GALA+) | +11.1 pp |

**The +3.32 is not a significance test and the document now says so in the row.** The panel's 90.0 is a **500-case
sample** of 1 430; ours is the whole 1 422. Downsampled to 500, this arm reads 90.40–94.20 % at 95 % confidence
(20 000 draws), and the point-estimate difference carries z = 1.59 on a pooled standard error of 1.51 pp. The
direction is not a sampling artefact; the magnitude is not proven. The cost ratio does not depend on either: it is
computed from the two published token counts.

**The counterweight stays in the row and is not softened:** the model alone, with no prior shown, answers **345 of
1 422 (24.26 %)**. The arm is an engine plus four deterministic readers with a model in the loop. Any reader who
takes 93.32 % as "an LLM beats a graph engine" has the wrong denominator; the engine is 81.29 % of it.

## 2. What the table said, and why it could say it

`docs/sota-comparison.md` §22 already recorded **93.39 % (1 328/1 422)** on 2026-11-25, and §23 already recorded the
cost axis. The STANDING table at the top of the same file still read:

```
| RCABench, agentic LLM class | not applicable | 90.0 % | −28.5 pp, and this row is the correction of the one above |
| RCABench, this project's gated LLM arm | 88.82 % (1263/1422) | ... | −1.18 pp against the leader |
| RCABench, accuracy against cost | ¥0.029 (W30) | $4.64 = ¥32.9 | ≈1 100× cheaper at 81.3 % against 90.0 % |
```

Three rows, all of them older than the prose beneath them, and one of them — `not applicable` — asserting that this
programme has no number in the class it has been winning for a day. **A table is read first and updated last**, and
that ordering is the defect. It is the fourth instance of one class in four iterations: 351 priced a rule the arm did
not run, 353 printed a bill it had not computed, 354 moved a lever that was not connected, and 355's table described
a standing three weeks old. The difference is that this one needed no dispatch to find, only a read.

Corrected in three rows, with every superseded figure named rather than deleted: `75.46 % → 81.29 %` on the FSE'26
engine cell (the containment pass's `+15`, measured in §0p-ix), `not applicable → 93.32 %` on the class row, and
`¥0.029 → ¥0.0012` on the cost row.

## 3. The two repositories disagreed in both directions

`micro-kinetic-ts/docs/sota-comparison.md` was **2 746 lines** and `micro-kinetic-ts-docs/sota-comparison.md` was
**3 780**, and neither was a subset of the other:

| only in the code repository | only in the docs repository |
| --- | --- |
| `0p-vi`, `0p-vii`, `0p-viii`, `0p-ix` — four configuration-fingerprint corrections | `2026-11-22` through `2026-11-25 (27)` — twenty-seven iteration records |
| `0c-iv`, `0c-v`, `0c-vi` — three competitor sweeps | `93.39 %` reproduced with its own dispatch id |
| `2c-ii` — where two configurations differ, by fault family | the four-population frontier and the DiagGuard reading |

So the "mirror" claim was false in the one direction that matters: **a reader of the code repository could not find
the standing, and a reader of the docs repository could not find the corrections that explain it.** Merged at section
granularity into **4 108 lines**, with the summary entry placed before the per-iteration records it summarises, and a
reading-order note that says which wins on a disagreement (the section with a dispatch id). Both repositories now hold
byte-identical copies, and `rcabench-cost-accuracy.html` / `rcabench-2026-panel.html` — which existed in only one of
them — are mirrored too.

## 4. The figure, redrawn

`rcabench-cost-accuracy.html` now plots the shipped arm at **93.32 % / ¥0.0012** on the accuracy × log-cost frontier,
beside the engine at 81.29 % / ¥0 and the published leader at 90.0 % / ¥32.9. The bar chart gained the same row, and
the dashed reference line's caption moved from "the model's 30 cases" to "the 171 cases the gate, the resolvers and
the guards repair", because the gap it annotates is no longer 30.

One thing the figure now states that a chart usually hides: **the same configuration has been dispatched twice, and
the two runs read 1 328 and 1 327.** The panel chart carries 93.39 %, the cost chart carries 93.32 %, and the note
under the cost chart says which dispatch each came from and that the one-case difference is not reconciled. A reader
comparing two files should see a disagreement rather than a figure that was quietly rounded.

## 5. The ablation, on one artifact, in one table

Every row below is a **re-score of the same 1 422 rows** (`45595943761`, `8294c792`), so no row costs a model call.
`correct` is raw Top@1 under the policy; `resolved` adds the resolvers the loop actually applies.

| policy | admitted | refused | repairs | breaks | precision | correct | resolved | retention |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `none` (control, no fallback) | 681 | 0 | 53 | 504 | 0.095 | **345** | 548 | 0.253 |
| `cited` (+ answer must be queried) | 676 | 5 | 53 | 501 | 0.096 | 708 | 904 | 0.567 |
| `cone` (+ answer must be downstream) | 618 | 63 | 51 | 469 | 0.098 | 738 | 948 | 0.594 |
| `contrast` (+ onset must lead) | 184 | 497 | 42 | 116 | 0.266 | 1 082 | **1 294** | 0.900 |
| `lag` (+ onset must lag the prior's) | 64 | 617 | 34 | 5 | **0.872** | 1 185 | 1 288 | **0.996** |

**The ladder, read as increments rather than as five totals.** Each clause is worth what it adds to the one before:

| what was added | cases | where it comes from |
| --- | ---: | --- |
| model answering with no fallback | 345 (24.26 %) | the arm's raw accuracy, the number the row above keeps honest |
| the answer must have been queried | **+363** | the `cited` clause — evidence the model itself produced |
| the answer must sit downstream of the prior | **+30** | the call graph's direction |
| the onset contrast must lead | **+344** | the kinetic term: the collision source's onset against the prior's |
| the three resolvers read what the model cannot see | **+212** | `interface` 152/152, `entry` 70/75, `door` 27/27 |
| the `door` rule, which the offline replay cannot apply | **+33** | 27 `door` answers plus 6 the replay refuses — `door` reads `entryInboundFails`, a column no answer artifact carries |
| **total** | **1 327 (93.32 %)** | against the engine's own 1 156 on the same cases |

Two notes on what this table is not. **The re-score is a LOWER bound on the resolvers**, because `door` needs a column
(`entryInboundFails`) that an answer artifact does not carry and therefore refuses offline; the 27 answers it settles in
the real loop are inside the +33. And **the 1.5 floor contributes no accuracy at all** — 351 established that every
floor above margin 0.863 changes zero cases — it converts 360 calls into zero calls, which is a cost mechanism listed in
§23 and not an accuracy one.

**The kinetic term is the largest single mechanism in the arm** — 344 cases, 26 % of the final score, and 8× the call
graph's contribution. That is the quantified answer to *what the theory is worth here*: it is not decoration on a
ranking, it is the clause that turns a 54 % arm (738) into an 82 % one (1 082) before any resolver speaks.

**And the cost of that clause is zero.** Onset is read from the pre-extracted telemetry the case already carries;
`contrast` needs no extra call, which is why the arm's 6 366 calls are spent on investigation and not on evidence
collection. A competing agent pays 30–140 rounds a case for the same discrimination.

## 6. The `entry-prior` gate: measured, then refused, and the refusal is the finding

The 75 cases the entry rule renames split **70 repaired / 5 broken**, and the five breaks are the whole argument
against the rule as it ships. This iteration tried to gate them out, and three gates were tested on the artifact at
zero cost.

| gate | repairs kept | breaks kept | net | verdict |
| --- | ---: | ---: | ---: | --- |
| none (as shipped) | 70 | 5 | +65 | baseline |
| `engineMargin <= 0.5` | 66 | 4 | **+62** | worse than baseline |
| `priorSurprise <= 100` | 37 | 2 | **+35** | worse |
| `engineRank != 1` | 69 | 2 | +67 | **illegal — `engineRank` is the truth's rank, i.e. the label** |
| `faultType ∉ {NetworkBandwidth, NetworkDelay}` | 69 | 1 | **+68** | **refused on protocol grounds** |

**The margin gate cannot work, and the reason is arithmetic rather than a bar that was not tuned.** The highest-margin
repair sits at **0.569** and the highest-margin break at **0.571**. Two cases, two thousandths apart, on opposite
sides of the outcome. No threshold separates a population from itself, and the earlier iteration that reported "the
distributions overlap" now has the witness: the overlap is two cases deep at the very top of the range.

**The `faultType` gate does work, and that is precisely why it is refused.** It is worth **+3 cases on all four arms**
(1 327 → 1 330, 1 318 → 1 321, 1 308 → 1 311, 1 314 → 1 317), and 5-fold cross-validation by `(hash(family) +
index-in-family) mod 2` returns **+3 on held-out folds** — identical to in-sample, which is the signature of a real
constraint rather than a fitted one. The mechanism is sound too: the entry rule's premise is "no failure crossed the
door", and it reads "failure" from the **error** channel, which a bandwidth or delay fault never raises. So the
premise is vacuously true exactly where the rule is wrong.

**And it is still refused, because `faultType` is not in the evaluation protocol's input.** In this corpus it sits in
`case.json` beside `groundTruthServices` — the label's own file. The harness gives the arm telemetry and nothing else;
`buildTelemetry` never reads it, and no prompt carries it. A resolver that read it would be a system scoring itself
with a field the benchmark reserves, and the +3 would be bought with a rule the field would rightly refuse to compare.
**This is the first time in this programme that a measured positive was rejected for a reason that is not about the
measurement**, and the reason is written down here so the next iteration does not rediscover the +3 and ship it.

What remains legal is the observable version: a departure-channel gate, which already exists and already ships
disabled (`ENTRY_PRIOR_TRAFFIC_KAPPA = null`, §324). Its pricing read a peak at one grid point on one corpus, which is
the shape this programme has refused twice. The axis stays closed, and the register entry says so.

## 7. Where this leaves the route

| stage | state |
| --- | --- |
| accuracy on RCABench | **ahead of the published leader by 3.32 pp**, not significant at 95 % |
| accuracy on RCAEval (735) | **ahead of the author's own method by 22.61 pp** |
| cost | **≈ 27 000× cheaper per case** than the leader; 59× cheaper than the panel's cheapest |
| the metric the field has moved to | **not scored here**: trajectory quality, evidence closure, propagation reconstruction |

The remaining gap is no longer a leaderboard position; it is **what the field scores that this programme does not**.
`arXiv:2608.21310` scores the trajectory; `arXiv:2603.00468` scores evidence closure and finds ~30 % of correctly
answered cases had not collected the evidence their answer implied. This arm cannot see that property at all — it
answers in six turns whatever it looked at — and it is the next axis worth building, because it is the only one where
a competitor's published finding names a defect that would apply to us.

The other two open items are priced and small by comparison: **49 reachable misses** inside the engine's own top ten
(width-11 re-ranker, ceiling 2.23 pp), and **the 5 break cases** of the entry rule, which are now known to be
inseparable from the repairs by any legal observable.
