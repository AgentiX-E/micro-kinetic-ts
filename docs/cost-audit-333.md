# The confirmation costs nothing: the rule answers 37 rows itself and 1 385 rows are already paid for

**Iteration 333.** The plan's first item was a full-corpus dispatch (≈ ¥21) to turn **91.98 %** from a counterfactual
into a measurement, followed by ≈ ¥100 for the rest of the queue. Both prices are answered here from artifacts that
were already paid for, at **¥0**, and the answer is not a discount — it is a structural fact about what the rule
reads.

## 0. Verdict

| item | quoted | this iteration | what makes the difference |
| ---- | -----: | -------------: | ------------------------- |
| confirm 91.98 % | ¥21 | **¥0** | 37 rows are answered by the door itself; 1 385 rows are the paid answers, unchanged |
| drift of those 1 385 rows | not priced | **¥0.74** (optional, 50-case sample) | the only thing a dispatch measures that a replay does not |
| the remaining queue | ≈ ¥100 | **¥0** (ceiling ¥2.94) | every remaining item is a join, a local re-rank or a code change |
| **total** | **≈ ¥121** | **¥0 – ¥0.74** | a dispatch was being priced for work no model does |

The surface is now **replayed** rather than re-measured, and the replay is a command in the repository rather than a
table in a document:

```
the surface this ships (bar 50): 1308 / 1422 (91.98 %), from 1287 (90.51 %)
  answered by the door 37: 28 repaired, 7 broken, 2 moved to a door that is not the truth, 0 moved inside the truth set
  1385 rows stand on the answers already paid for: the bar is silent on them and the pipeline takes the branch it always took
```

## 1. Where ¥21 came from, and why the number was right about the dispatch

10 249 721 prompt tokens and 46 143 completion tokens are what the last full-corpus dispatch reported; at DeepSeek's
input price that is **¥20.88**, rounded to ¥21 in the plan. **The arithmetic was never wrong.** What was wrong is the
assumption that confirming the surface requires the same dispatch again.

## 2. What a dispatch would actually buy: five buckets, not one number

Every one of the 1 422 rows falls into exactly one of five buckets, and the partition is asserted in the instrument
rather than assumed (`replaySurface`, `benchmarks/src/first-hop.ts`, 40 tests, coverage 100/100/100/100).

| bucket | R1 | B | is the model read to produce this answer? |
| ------ | -: | -: | ----------------------------------------- |
| repaired — moved to the door, wrong before | 28 | 29 | **no**, the door is named by the case |
| broken — moved to the door, right before | 7 | 9 | **no**, same |
| moved to a door that is not the truth | 2 | 0 | **no**, same |
| moved inside a multi-service truth set | 0 | 0 | **no**, same |
| untouched — the paid answer stands | 1 385 | 1 384 | **yes, and it was already paid for** |

The first four rows are **37 of 1 422** (B: 38). The fifth is the artifact.

## 3. Why the 37 changed rows need no model call

`doorAttribution` returns the case's **entry service** — a name the case carries in its own topology, decided by
three of the case's own columns (`entryChildErrors`, `belowFails`, the inbound failure count). Nothing in that path
reads a completion. The rule is applied **last** in `applyResolver`, so it does not matter what the model said: the
answer is replaced.

A dispatch over these rows would produce the same 37 answers by construction, and would pay a model call whose output
is then discarded. That is the only place in the pipeline where a dispatch is provably unable to change the reading.

## 4. Why the 1 385 unchanged rows need no re-run

When the rule does not speak, `doorAttribution` returns `null` and `applyResolver` falls through to the branch it
always took — witness, then front door, then the model's answer. Iteration 332 already paid for the test that says
this byte for byte: `null` as the bar reproduces the 324–331 surface exactly. The one column the rule adds
(`entryInboundFails`) is **read-only**: it is computed in `readEntryPrior` from the same edge list `belowFails`
already walks, and no other field is touched.

So for these rows the shipping pipeline and the pipeline that produced the artifact are the **same program on the same
input**, and the answer is the one already in the file.

## 5. The one residual, which is not about the rule: model drift

The replay assumes the paid answers are what the model would answer today. That is a property of the **endpoint**, not
of the rule, and it is the only thing a dispatch measures that this replay does not.

It is also cheap to bound: `temperature` is 0 and the prompt is fixed, so a **50-case stratified sample** re-dispatched
costs `50 × ¥0.0147 ≈ **¥0.74**` and reports a reproduction rate directly. If it reads 50/50, the replay's
uncertainty is the drift rate of a frozen endpoint on a frozen prompt — and if it does not, the number to publish is
the dispatched one, not the replayed one. **This is the only purchase in this document, and it is optional.**

## 6. The rest of the ¥100

| item | was | how it is ¥0 |
| ---- | --: | ------------ |
| retrieval block, 74 misses | part of ¥100 | the truth sits at engine rank 6–44 (median 22); widening the seed is **local scoring** — the engine is deterministic and calls no endpoint — so the new top-1 is computed, not sampled |
| resolver scope, 10 cases | part of ¥100 | a code change plus the evidence columns already in the artifact |
| RCAEval nine-cell replication | part of ¥100 | joins existing artifacts |
| process-level evidence | ¥2.94 | the taxonomy ran in 243 at ¥0; the per-row `rounds`/`toolCalls`/`stop`/`answeredBy`/`gateRefusals` columns already answer the cheap claims, and a full-trace sample is publication-only |

`grep` confirms the engine side of this: no embedding or completion call is on the ranking path
(`packages/ai/src/providers/api-embedding.ts` is a provider the arm may use, never the engine), so widening a seed
cannot trip the Zhipu 429 that paused the embedding benchmark.

## 7. A counting correction found while building the replay

The runner's per-bar table counted a repair as *"the paid answer was wrong"*. That credits a row the rule moved to a
door that is **not** the truth with a gain it did not earn — 30 repairs at bar 50 where the instrument reads 28, the
difference being exactly the two stuck rows above. The table now reads `replaySurface`, so the table and the surface
line cannot disagree; the register's **+21** was already correct because it came from the instrument, and the table was
the only place the wrong count appeared.

## 8. Falsifiers

1. **If the rule read any model output**, the 37 rows would need a dispatch and the ¥21 would stand. It does not: the
   three columns it reads are case metadata.
2. **If `applyResolver` changed the untouched rows** — a re-ordered branch, a new default — the 1 385 rows would need
   a re-run. The `null`-reproduces-324–331 test is the check, and it passes.
3. **If the 50-case sample reproduces below 50/50**, drift dominates and the published number must come from a
   dispatch — at which point ¥21 is the right price again, and this document's claim is scoped to a frozen endpoint.

## 9. Reproduce

```bash
pnpm exec tsx benchmarks/src/run-first-hop.ts \
  --artifact /tmp/art328/query-agent.ndjson \
  --edges /tmp/edges324.ndjson
```

The runner prints the artifact digest, the sweep, the held-out reading, the four refusals — and the surface replay with
its five buckets. Nothing in it calls an endpoint.
