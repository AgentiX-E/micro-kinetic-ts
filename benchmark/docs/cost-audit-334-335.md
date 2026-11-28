# The 334/335 cost audit: two prices that were quoted before the slice was read

**Iteration 334a.** This is an audit, not an arm. It was triggered by a question about the two remaining line items in
the plan — `334 depth-3 instrument (needs a dispatch per arm) ≈ ¥40–80` and `335 process-level evidence (trajectory
fields) ≈ ¥20` — and it answers three things: what those numbers were derived from, whether the spend is necessary, and
where the money should go instead. Both were answered from artifacts that had already been paid for, at **¥0**.

## 0. Verdict

| item | quoted            | measured                                                                 | necessary?                                                                                 |
| ---- | ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 334  | ¥40–80 / 2 sess.  | **¥0** — the slice is 12 cases and was read in one local pass            | **No.** Ceiling of the whole item is **+0.07 pp**; the remaining miss is 1 case.            |
| 335  | ¥20 / 1 sess.     | **¥0** for the taxonomy (iteration 243 already ran it) · **¥2.94** for a sampled full trace | **No.** Ranking contribution is 0, and the ¥20 assumed a full-corpus dispatch.   |

The two numbers were not arithmetic errors. They were **unit errors**: both priced a *measurement* as if it required a
*dispatch*, and both sized that dispatch at the full corpus (1 422 cases) when the runner's default is a 200-case
sample.

## 1. What "depth 3" actually is

The plan's premise was that the leader's stratified table reads `0.79 / 0.67 / 0.37` by causal depth, that the deepest
stratum is therefore a 37 % ceiling, and that this is where our misses concentrate. **All three clauses are false**, and
the correction is the most valuable thing this audit produced.

`arXiv:2608.21310` v2, re-read at the source: `0.79 / 0.67 / 0.37` are **avg Node F1 / ✓-subset Edge F1 / ×-subset
Edge F1** — process-level graph-reconstruction metrics on the Sonnet arm, not accuracy. The paper's depth table is
**Table 2, "Acc@1 by depth d\*"**, and it reads:

| backbone | framework | d\*=2 | d\*=3 | d\*=4 | d\*=5 |
| -------- | --------- | ----: | ----: | ----: | ----: |
| Qwen   | ThinkDepth.ai | 85.5 | 82.0 | 66.0 | 57.1 |
| Qwen   | ClaudeCode    | 89.5 | 79.8 | 68.1 | 57.1 |
| **Sonnet** | **ThinkDepth.ai** | **88.2** | **88.6** | **96.8** | **85.7** |

The deepest stratum is **85.7 %**, not 37 %, and `d*` is defined (§4.2) as the shortest path from the root cause to the
SLO-alarming service **along `G*`** — the authors' hand-labelled propagation graph, which **RCABench does not release**
(a case carries `datapack`, `faultType`, `groundTruthServices`, `injectTimeMs`, `metrics`; there are no propagation
edges). So `d*` cannot be recomputed by anyone, and no third party can reproduce that table.

What remains true is the part that decides the budget: **causal depth is a property of the case, and whatever
approximation of it we can compute, we compute from files we already hold.** The approximation used here is **entry
distance** — the smallest reachable directed distance from `ts-ui-dashboard` to the truth over the call graph the
containment artifact carries — joined to the answers in the query artifact.

Read from `query-agent.ndjson` `sha256:572952e8ab856422` (1 287 correct, 90.51 %) joined to `containment.ndjson`
`sha256:f82c13b2d1598937`, entry `ts-ui-dashboard`, depth = smallest reachable directed distance over a multi-service
truth:

| depth | cases | correct | misses |   share |
| ----: | ----: | ------: | -----: | ------: |
|     0 |   186 |     120 |     66 |  64.52 % |
|     1 |   707 |     665 |     42 |  94.06 % |
|     2 |   517 |     491 |     26 |  94.97 % |
|     3 |  **12** |   **11** |  **1** | **91.67 %** |
| unattached | 0 | — | — | — |

Two facts settle 334:

1. **The slice is 12 cases — 0.84 % of the corpus — and we already get 11 of them.** The single remaining case is worth
   `1/1422 = 0.07 pp`. Buying it at ¥40–80 is roughly ¥600–1 100 per tenth of a point, against a deterministic path
   that already ships at ¥0.0147 per case.
2. **The measurement needs no dispatch, because it is not a property of our answer.** It is a join of two files. The
   instrument is now in the repository (`benchmarks/src/causal-depth-slice.ts`, 14 tests, coverage 100/100/100/100,
   runner `run-depth-slice.ts`), so the number is reproducible in one command rather than remembered in a table.

### What the table is *not* comparing

Nothing in the leader's paper. Our depth is entry distance over a call graph the artifact carries; the leader's `d*` is
a path over a hand-labelled propagation graph that is not published, so the two tables are **not** comparable and this
document makes no claim about leading or trailing any leader stratum. What the table establishes is narrower and
sufficient for the budget: **on the definition computable from this corpus, the slice the plan wanted ¥40–80 to attack
contains one miss.** The definition was also checked for sensitivity — undirected and directed distances produce
identical tables on this graph, because the 49-service graph is a tree in practice.

## 2. Where the misses actually are

The same join, read the other way, is the finding that replaces 334:

| depth | cases | misses | share of all 135 misses |
| ----: | ----: | -----: | ----------------------: |
| **0** | **186** | **66** | **48.9 %** |
|     1 |   707 |     42 |                  31.1 % |
|     2 |   517 |     26 |                  19.3 % |
|     3 |    12 |      1 |                   0.7 % |

All 186 depth-0 cases are injections **on `ts-ui-dashboard` itself** (`truth` is the entry). Their answers, by the arm
that produced them:

| answered by | correct | cases | share |
| ----------- | ------: | ----: | ----: |
| `entry`     |  **69** |    69 |  100 % |
| `interface` |  **39** |    39 |  100 % |
| `prior`     |       9 |    35 | 25.7 % |
| `model`     |   **3** |    43 | **7.0 %** |

This is the sharpest reading in the whole audit, and it is the same reversal the closing questions asked about,
appearing at case level: **when the fault is the entry itself, the deterministic channels are perfect (108 / 108) and
the model is nearly always wrong (3 / 43).** The shipped path lets the model speak on 43 of these 186 cases; it is
right on 3.

The ceiling is therefore real and large: answering all 186 correctly would read **1 353 / 1 422 = 95.15 %**, i.e.
**+4.58 pp** — the largest single-rule headroom left anywhere in this register, and it is ¥0 to attempt, because the
evidence is in the artifacts already.

An exploratory (NOT pre-registered) separability probe, recorded only so the next iteration can pre-register a
falsifiable version of it:

| group        | `entryChildErrors` median | p90 | `belowFails` |
| ------------ | ------------------------: | --: | -----------: |
| depth 0      |                     **0** | 100 |        22.0 % |
| depth 1–3    |                   **100** | 100 |        84.8 % |

The shape is what one would expect if the statistic means what it says — a fault at the entry has no upstream error
column to fill, while a fault downstream leaves the entry's child edges failing — but a median split is not a rule,
and treating it as one would be the exact mistake 328, 329 and 330 each paid for.

## 3. Why 335 was over-priced by 7×

Three separate corrections, any one of which breaks the ¥20:

1. **The taxonomy has already been run.** `arXiv:2608.21310`'s transferable contribution is a three-family
   evidence-handling taxonomy; this repository operationalised it as deterministic predicates in iteration 243
   (`packages/tree/src/audit/evidence-audit.ts`, census `evidence-audit-census.ts`) and published nine cells across
   RE1/RE2/RE3 on all three systems, at **¥0** — the predicates read `metricDiagnostics` and `ScoreTerm`, no model
   call. The reading was that two of the three families fired (see `evidence-audit.md`). "Process-level evidence" as a
   *taxonomy* is done.
2. **The artifact's trace is truncated by design, not by accident.** `TRACE_CHARS = 2 000` in
   `benchmarks/src/query-agent.ts` keeps the END of the investigation — the part the answer was made from — and every
   one of the 1 422 rows carries `rounds` (6 for 1 417 cases), `toolCalls` (5 for 1 416), `stop`
   (`answered` 833 / `rounds` 589), `answeredBy`, `gateRefusals` (590 cases with at least one), and the visited-service
   sequence in `calls`. So the *cheap* process-level claims are already answerable from this file; only a full
   step-by-step transcript would need a new dispatch.
3. **A full trace does not need a full corpus.** `run-query-agent.ts` samples by default: `--sample-misses 100`
   `--sample-correct 100`. The ¥20.88 figure is the price of the full-corpus flag we used for the final surface
   (10 249 721 prompt + 46 143 completion tokens). A 200-case trace dispatch is `20.88 × 200 / 1422 ≈ **¥2.94**`.

And the ranking contribution of a full trace is **zero**: no published leaderboard in this field scores trajectories,
and the leader's process-level analysis is a paper section, not a metric. 335 is publication completeness, and it
should be named as such if it is done — not funded as if it were a point.

## 4. What the plan becomes

| slot | was                                   | becomes                                                                 | cost |
| ---- | ------------------------------------- | ----------------------------------------------------------------------- | ---: |
| 331  | chain-restricted bound (pre-registered) | unchanged                                                             |   ¥0 |
| 332  | DecompRCA baseline on RE1             | unchanged                                                               |   ¥0 |
| 333  | RCAEval RE1 replication at this surface | unchanged                                                             |   ¥0 |
| ~~334~~ | depth-3 instrument, ¥40–80         | **deleted** — 12 cases, 11 already correct, measurement is ¥0            |   ¥0 |
| **334′** | —                                  | **entry-self slice**: pre-register the rule that a model answer may not override the entry when the fault is the entry (186 cases, 66 misses, +4.58 pp ceiling) | ¥0 |
| ~~335~~ | process-level evidence, ¥20        | **downgraded**: taxonomy done in 243; a full-trace sample is ¥2.94 and is publication-only | ¥0 or ¥2.94 |

## 5. Falsifiers

1. **If the depth definition is wrong**, the slice sizes move and §1's table is void — but §1's claim is not "12", it
   is "the measurement is a join, not a dispatch", and no definition of depth makes a join cost money. The 334 budget
   stays dead under every definition.
2. **If a venue requires full transcripts**, 335 returns at ¥2.94 per 200-case sample, not ¥20 — and the sample must be
   stated with its strata, since the default is half misses and half hits by construction.
3. **If depth-0's 66 misses are not separable**, 334′ dies the way 328–330 died, and the register gains a fourth entry
   rather than a fifth point. That is the expected outcome of a rule family that reads a graph, and it costs ¥0 to find
   out.

## 6. Reproduce

```bash
pnpm exec tsx benchmarks/src/run-depth-slice.ts \
  --containment artifacts/agentic/containment.ndjson \
  --queries artifacts/agentic/query-agent.ndjson
```

The runner prints both digests before the table, so a reading is attached to the files it came from — the lesson 329
paid for when 644/641 and 645/642 turned out to be two dispatches.
