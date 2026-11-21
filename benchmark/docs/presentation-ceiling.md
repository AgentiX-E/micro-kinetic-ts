# The presentation ceiling — what a reranker can reach, as a function of what it is shown

**Status:** measured on all 1 422 RCABench cases at the published configuration (`Top@1` **1 186 = 83.40 %**), from
the run's own per-case artifact. No model was called (`$0.00`). The instrument is
`benchmarks/src/presentation-ceiling.ts` (**100 / 100 / 100 / 100**, 19 tests).

Ten agentic arms have been run against this corpus and all ten failed. Nine of them failed on a presentation whose
ceiling was **below the target**, which means the arm could not have succeeded and its failure is not evidence about
the model. That statement is arithmetic and this document is the arithmetic.

## 0. Headline

| width `K` (candidates shown) | recoverable |     ceiling | out of reach |
| ---------------------------: | ----------: | ----------: | -----------: |
|                            1 |       1 186 |      83.40% |          236 |
|                            2 |       1 222 |      85.94% |          200 |
|                            3 |       1 236 |      86.92% |          186 |
|                        **5** |   **1 255** |  **88.26%** |      **167** |
|                            8 |       1 270 |      89.31% |          152 |
|                       **10** |   **1 284** |  **90.30%** |      **138** |
|                           15 |       1 303 |      91.63% |          119 |
|                           20 |       1 320 |      92.83% |          102 |
|                           30 |       1 359 |      95.57% |           63 |
|                           40 |       1 406 |      98.87% |           16 |
|                       **44** |   **1 422** | **100.00%** |        **0** |

Three readings, and the first one is the reason this document exists:

1. **At the width every shipped agentic arm used — the engine's top five — the ceiling is 88.26 %.** The RCABench
   leader is 90.0 %. An arm at `K = 5` is **1.74 pp below the leader before the model is asked anything**, so no
   model, prompt, operator or gate applied to a five-candidate list can reach the benchmark's SOTA. The recorded
   refutations are correct and they are about the model; they are silent about the width, and the width was the
   binding constraint.
2. **`K = 10` is the smallest width at which 90.0 % is reachable at all, and it is reachable only by a perfect
   reranker** (90.30 %, a 0.30 pp margin). A width chosen to sit 0.3 pp above the target is a width that fails on
   the first mistake.
3. **The whole candidate set has a ceiling of 100 %**, because the truth is in the results on **236 of 236** misses
   (`miss-anatomy.md` §0). The corpus never hides the answer; the presentation does.

## 1. The quantity, and why the width is not the model's parameter

A reranker may only reorder what it is shown. Whatever it does, a case whose truth sits at rank 12 stays wrong when
five candidates are presented, so

```
ceiling(K) = |{ cases : 1 ≤ rank(truth) ≤ K }| / cases
```

is an upper bound on the accuracy of ANY reranker at width `K`, and it is a property of the engine's order and the
presentation's width alone. The measured arm's accuracy is then decomposed without ambiguity:

```
arm accuracy = ceiling(K) − the model's error
```

which is the decomposition every previous arm's report lacked. The 33.1 % reading of the elimination arm
(`agentic-fusion.md`, −602) is a model error of **55 pp** against an 88.26 % ceiling — a much worse number than the
one the arm was reported with, and a much more useful one: it says the presentation, not the width, was broken
there.

## 2. The precision the model has to reach, at each width

To reach 1 280 cases (90.02 %) from the engine's 1 186, a reranker has to repair **94 cases**. The width determines
the population it may repair from, so it determines the precision the model has to deliver on that population:

| width | reachable misses (rank 2…K) | precision needed for 90.02 % | what that means   |
| ----: | --------------------------: | ---------------------------: | ----------------- |
|     5 |                          69 |                      > 100 % | **impossible**    |
|    10 |                          98 |                       95.9 % | 94 of the next 98 |
|    15 |                         117 |                       80.3 % |                   |
|    20 |                         134 |                       70.1 % |                   |
|    30 |                         173 |                       54.3 % |                   |
|    44 |                         236 |                       39.8 % | two in five       |

The width and the precision are one knob seen from two sides: widening the presentation past the point where the
model can still discriminate makes the arm's accuracy fall (more candidates, more chances to move a correct case),
while narrowing it makes the target unreachable. **`K = 20` is where the requirement first looks like something a
verifier-shaped model can do** (70 % on cases the engine already ranked second-to-twentieth), and `K = 30` is where
it starts to look comfortable (54 %).

## 3. What this closes, and what it opens

**Closed:** "the agentic arms failed because the model is weak". It is now a _partial_ explanation at best. Nine of
the ten arms were shown five candidates, where the ceiling was 88.26 % and the leader 90.0 %; a perfect model would
have read 88.26 % and been recorded as a failure. The width is a free parameter that was never priced, and the
pricing is one line of arithmetic over an artifact every run already writes.

**Opened:** the arm to run next, with its width derived rather than assumed. `docs-repository:preregistration-315.md`
registers it: **`K = 30`**, the width at which the required precision is 54.3 %, with `K = 5` as the control that
reproduces the nine previous arms. The two widths are the same model, the same prompt and the same cases; the only
thing that changes is how many candidates the model is allowed to see, which makes the difference attributable to
the presentation instead of to the model.

**Not opened:** the claim that widening alone wins. At `K = 30` a chance-level model reads _worse_ than the control
(more candidates to mis-order), so the arm is a joint test of width and model together and it is registered with
that as its falsifier rather than as its prediction.

## 4. Reproduce

```bash
# The per-case artifact of the run being priced (one `truthRank` per case) is all the instrument reads.
npx tsx -e "
import { readFileSync } from 'node:fs';
import { minimumWidth, presentationCeiling, widestRank } from './benchmarks/src/presentation-ceiling.js';
const ranks = readFileSync(process.argv[1], 'utf8')
  .split('\n').filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line).truthRank ?? 0);
console.log('widest', widestRank(ranks), 'width-for-90%', minimumWidth(ranks, 0.9));
console.table(presentationCeiling(ranks, [1, 2, 3, 5, 8, 10, 15, 20, 30, 40]));
" /tmp/arm314/GM.ndjson
```

The four properties the module's tests hold are the four a ceiling has to have to be usable as a gate: monotone in
the width; a truth the results do not hold unreachable at EVERY width; the SMALLEST width that reaches a target;
and a refusal for a rank or a width the artifact could not have written, because normalising one would move the
denominator of every ceiling computed from the list.
