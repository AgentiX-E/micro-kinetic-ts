# The floor priced one rule and shipped another

**Iteration 348's saving was real. Its rule was not.** The certainty floor was added as the first saving taken
*before* the call, and it settled a skipped case on `priorTop ?? engine.top1` — the name a refusal would have shipped.
The certainty guard, shipped since iteration 336 and the rule the floor is a pre-call form of, settles on
`engine.top1`. And `cost-model.skipAt`, the function that decided whether the floor was worth buying, credits a
skipped case with `engineRight` — the **guard's** answer.

So for one iteration this programme priced one rule and ran another. That is the defect `applyResolver`'s own comment
records from iteration 322 — *"a rule that is priced by one implementation and shipped by another is two rules, and
the artifact measures the one nobody runs"* — reproduced by the iteration that quoted it.

**And it was latent, which is worth stating precisely.** The run both rules were read on ships `--fallback engine`, so
`priorTop` *is* `engineWinner` — measured on the acceptance artifact: **1 422 of 1 422 cases agree**. Both rules therefore
shipped the same answer there, and the difference the arm could see was the STRATUM (`prior` instead of `certainty`) and
the boundary. A `--fallback seed` arm would have shipped a different answer, and no artifact this programme holds was
taken on one. The fix is required by the rules and the evidence, not only by the readings: the mismatch was one
configuration away from being live.

## 1. Three disagreements, one reading

| # | The floor did | The shipped rule does | What it cost |
| - | ------------- | --------------------- | ------------ |
| 1 | answered `priorTop ?? engine.top1` | the guard answers `engine.top1` | the artifact priced a different arm |
| 2 | fired on `margin >= floor` | `engineCertainty` fires on `margin > bar` | the two rules disagreed on the one margin easiest to compare |
| 3 | reported `answeredBy: 'prior'` | `'certainty'` is in the vocabulary for this | the cost table could not separate "the engine was sure" from "the gate fell back" |

(3) is the one that hid (1). The stratified bill in `cost-structure-348.md` showed a `certainty` stratum of 20 cases —
the guard's, applied *after* the call — and a `prior` stratum of 516 that silently contained every floored case. A
reader comparing the two tables could not see that a floored case and a refused case had been merged into one row.

**Fixed:** the floor ships `engine.top1`, fires strictly above the bar, and reports `certainty`. One branch, one rule,
and the rule the price was derived from.

## 2. What the correction buys: a per-case identity, not a net delta

Because the priced rule and the shipped rule are now the same rule, the artifact can be read **exactly** — and the
reading turns out to be much stronger than "the accuracy did not move":

```
 floor  skipped  saved CNY   gain   loss   accuracy
 0.300      964       7.09      5     28    91.77 %
 0.500      771       5.66      2     14    92.55 %
 0.800      603       4.43      0      2    93.25 %
 0.863      582       4.27      0      0    93.39 %  <- no case moves
 0.870      580       4.26      0      0    93.39 %
 0.900      566       4.16      0      0    93.39 %
 1.000      520       3.82      0      0    93.39 %
 1.500      360       2.65      0      0    93.39 %

the engine answer stops destroying cases above 0.8630 and stops repairing them above 0.5707: every floor above 0.8630 changes no case in this artifact
maximal no-op floor 0.8630: 582 cases (40.93 %) silenced, 4.27 CNY saved (41.07 %), 0 gained against 0 lost, accuracy 93.39 %
```

Run `45531140696`, 1 422 cases, priced on the CNY card's **off-peak** column — **1 / 4** per million, the tariff the run
was actually taken under — so the bill is **10.41 CNY** (0.0073 a case), not the 20.81 the peak column gives. The
1.07 / 4.28 in this section before iteration 353 came from converting the USD card at 7.13; `cache-hit-352.md` §2 reads
the CNY card instead, and iteration 353 prices every artifact by the column in force at its own `startedAt`.

**The `gain` and `loss` columns are new, and they are the point.** A net delta cannot tell a rule that changes no
answer from a rule that changes sixty and happens to sum to nothing. `SkipReading` now carries both, and above 0.8630
both are **zero on every one of the 1 422 cases** — not a compensating pair, an identity.

`ruleEdges` names the reason in two numbers:

> the highest margin at which shipping the engine's answer would have **destroyed** a correct case is **0.8630**;
> the highest at which it would have **repaired** one is **0.5707**.

Between those two margins the rule is a straight loss with nothing to offset it; above both it is inert. That is why
the frontier is *not* the round 0.87 the previous iteration published — 0.87 is simply the first probe above the cliff.

## 3. Why the default is 1.5 and not 0.8630

| bar | source | skipped | saved | why it is or is not the default |
| --- | ------ | ------: | ----: | ------------------------------- |
| 0.8630 | this corpus's own highest destroying margin | 582 (40.9 %) | 4.27 CNY (41.1 %) | **a fit.** It sits on a data point, 0.0 above the cliff on a corpus that will change |
| 1.5 | `ENGINE_CERTAINTY_MARGIN` | 360 (25.3 %) | 2.65 CNY (25.4 %) | **inherited.** See the proof below |

**The proof, which does not mention a corpus.** For any case whose engine margin exceeds the guard's bar, the shipped
pipeline discards whatever the model said and ships `engine.top1` — `applyResolver` applies the guard *last*, over
`door ?? settled`. So a pre-call floor at that same bar cannot change the answer; it can only stop paying for a turn
whose result was going to be overwritten. The preconditions are exact and both are checkable in the artifact the run
writes:

1. the arm's resolver is armed (`--resolve` ≠ `none`), because `applyResolver` returns before the guard otherwise;
2. the arm settles on **some** name. A case whose model returns nothing but whose arm has a prior still passes through
   the guard — the refusal exit settles on the prior and the guard then renames it — so the equivalence covers it too.
   The one shape it does not cover is a case with **no prior and no model answer**, where the arm ships silence and the
   floor ships the engine's name: a case that was already scoring zero, so the floor cannot lose it.

Run `45531140696` reports `unanswered 0` over 1 422 cases, so on this corpus both preconditions hold everywhere and the
prediction is exact rather than probabilistic.

That argument is worth **25.4 % of every future run** and it costs one constant that already existed. The extra 15.7
points available at 0.8630 are worth a fit to 1 422 cases and are available as `--certainty-floor 0.863`.

## 4. The live run, predicted before it was read

Run `45587533537`, dispatched at `--resolve edge-novel --gate contrast --fallback engine --seed none
--certainty-floor 1.5` on the full 1 422-case corpus — the disposition of run `45531140696` with one flag added, so
every difference is the floor's.

| prediction | from |
| ---------- | ---- |
| exactly **360** cases settle with `rounds: 0`, `promptTokens: 0`, `completionTokens: 0`, empty trace | `skipAt(1.5)` on the anchor |
| those 360 answer `engineWinner`, attributed `certainty` | the branch, and the artefact's own `engineWinner` column |
| **0 gained against 0 lost** among them | `ruleEdges`: nothing above 0.8630 moves |
| corpus accuracy 93.39 % ± sampling on the 1 062 cases that still call | 0 of 360 move; the rest re-sample |
| the bill ≤ 8.5 CNY | 1 − 25.3 % of the 10.41 list = 7.78, plus the 1 062-case variance |
| the 360 skips carry **no** `servedModel` | a case that never called one was served by nothing |

A prediction this specific is falsifiable by one dispatch, which is the only reason to spend the dispatch: the floor's
correctness is already established from the artifact, and what the run adds is that the *code path* does what the
arithmetic says at scale — `rounds: 0` on exactly those cases, and nothing else moved.

### The result

| predicted | measured |
| --------- | -------- |
| 360 cases at `rounds: 0`, zero tokens, empty trace | **360 / 360** |
| those 360 answer `engineWinner`, attributed `certainty` | **360 / 360** |
| 0 gained against 0 lost | **0 / 0** |
| corpus 93.39 % ± sampling on the 1 062 that still call | **93.32 %** (1 327/1 422; the 1-case gap is inside the 1 062) |
| bill ≤ 8.5 CNY | **1.69 CNY** — see below |
| no `servedModel` on the 360 | 360 empty; 1 062 `deepseek-flash` |

Six of six. The bill is the one that surprised: `cacheHitTokens` — recorded for the first time in this run — read
**6 204 649 of 7 636 769 prompt tokens as cache hits (81.25 %)**, and a hit costs 1/50th of a miss, so the run cost
**1.69 CNY, 0.00119 a case**, not the 7.77 the two-number table implied. The cost stratum now reads
`certainty 360 cases · 0.00 CNY · 360 correct` — the only row in the table that bought nothing, for nothing. Full
reading: `cache-hit-352.md`.

## 5. What still costs money, and the rule that says so

The correction changes where the remaining 54.8 % sits, not how much of it there is. After the floor, the discarded
answers that remain are settled by rules the door cannot see:

| stratum | cases in the anchor | why the floor cannot reach it |
| ------- | ------------------: | ----------------------------- |
| `prior` (refusals) | 516 | the margin there is low — the engine was *not* sure, and the gate's refusal is what settled it |
| `interface` | 148 | 148/148 correct, and the witness is read from the case, not from a score |
| `entry` | 74 | 69 correct, and the rule reads the graph |
| `door` | 28 | 28 correct, deterministic |

**The two-signal floor I had planned is not a second signal, and the column that was supposed to unlock it says so.**
`priorTop` is recorded from this iteration on — read once, written on both exits — and the first artifact that carries
it answers the question in one line: `priorTop` equals `engineWinner` on 1 422 of 1 422 cases, because the fallback
order *is* the engine's ranking. A rule that fires when they agree is therefore the engine arm, which scores 81.29 %.
The recorded column earned its place as the *proof of that identity*, and the next rule has to read something the
engine does not already know — the entry the graph names, or the interface witness — not the prior.

## 6. What ships

1. **`runQueryAgent`'s floor branch** — `engine.top1`, `> bar`, `answeredBy: 'certainty'`. The doc comment states the
   equivalence, both preconditions, and the numbers at both bars.
2. **`certainty-floor-equivalence.test.ts`** — 13 cases. The floor and the guard must ship the same answer for four
   margins *above* the bar, asserted through the shipped `engineCertainty` rather than a restatement; the boundary is
   the guard's; the stratum is `certainty`; a floored case spends nothing and reports no served model; and the floor
   fires with the resolver **off**, because `--resolve` defaults to `none` and a floor coupled to the resolver would be
   inert in the configuration that dispatches it; and `floorReadingNote` prints beside the precision line, because a
   floored case can be neither a repair nor a break and the ratio's population therefore shrank — the class of error
   iteration 347 published as a 236-case "model drift".
3. **`SkipReading.gains` / `.losses`** and **`ruleEdges`** in `cost-model.ts`, with six new cases, including one that
   pins a 30/30 coin flip as *not* a no-op — the reading the single `delta` could not express.
4. **`lossFreeFloor` derived from `ruleEdges`** rather than from its own walk, so the floor it names and the floor
   `skipAt` prices are one function. It returns the **threshold** (the cliff), not the lowest skipped margin: the
   threshold is the number a reader can act on, one step below which the saving starts costing cases.
5. **`skipAt` is exclusive**, matching the guard, and the audit prints `gain`/`loss` beside `saved`.
6. **`priorTop` on the artifact row** — the name, not only the flag, because the next rule is a two-signal rule.
7. **The banner prints the floor.** A run at 1.5 and a run at 0 spend different money and would otherwise print the
   same sentence.
8. **`query_certainty_floor` defaults to `1.5`** in the workflow, with the description corrected from "8.55 CNY /
   41.1 %" to the two tiers and the reason the default is the inherited one.

## 7. What this does not fix

- **The 0.8630 frontier is a property of this corpus.** It is reported, not shipped. A corpus with a case at margin
  0.9 that the engine gets wrong would make the 0.8630 tier lose a case, and nothing in this iteration predicts that
  margin for a corpus that does not exist yet.
- **The floor does not touch the 516 refusals.** Those are cases where the engine was *not* sure and the gate was
  right — a different problem with a different mechanism, and the one that holds the remaining 3.75 CNY (the
  off-peak price of the 516; 4.02 at the peak column).
- **The two-signal rule is closed as a negative result,** not deferred: the prior and the engine are the same reading
  under `--fallback engine`, so the rule is the engine alone.

## 8. What the run cost, and the lever it names

At 1.69 CNY the bill splits **cache-miss input 84.6 %, output 8.1 %, cached input 7.3 %** — so the first lever is no
longer the system prompt (5 842 cached tokens a call, 7.3 % of the bill) but the transcript (1 349 uncached tokens a
call, 84.6 %). `--transcript-chars` already exists; what is missing is the accuracy reading of a shorter one, and that
is the next iteration's first item rather than this one's.
