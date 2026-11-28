# The 135 misses are four different failures, and only one of them is a budget

**Iteration 334.** The queue behind the shipped surface had two items: the retrieval block (74 cases whose truth the
model never saw) and a resolver-scope question (10 cases the pipeline renamed away from a correct engine answer). Both
were read at **¥0** from artifacts that already exist, and the reading split the misses into four populations that had
been averaged into one number — which is why every earlier plan that priced "the misses" over-paid.

## 0. Verdict

| question | reading | cost | shipped? |
| -------- | ------- | ---: | -------- |
| how are the 135 misses made? | **20 precedence · 41 reasoning · 74 breadth · 0 pool** | ¥0 | instrument |
| what does a wider seed buy? | 61 → 75 → 99 → 135 misses visible at width 5 → 10 → 22 → 44 | ¥0 | instrument |
| can the engine's own indecision trigger a widening? | **no** — precision 0.05–0.17 | ¥0 | **refuted** |
| can a single term rank the block correctly? | **no** — the best single term reads 5.4 % on the block | ¥0 | **refuted** |
| may a resolver overwrite a decided engine? | **+10 / +10 held out, precision 1.000** | ¥0 | **not yet — scope open** |

The last row is the only candidate. It is **measured and not shipped**, because the only artifact carrying scores ranks
the corpus in an order that differs from the shipped order on 83 of 1 422 cases; the reading is about that order, and
this programme does not ship a number it cannot attach to the product. §5 states the gap and what closes it.

## 1. The four failures, separated

`benchmarks/src/retrieval-block.ts` (22 tests, coverage 100/100/100/100) and `run-retrieval-block.ts`, over
`terms.ndjson` `sha256:ea103feca6864eab` joined to `query-agent.ndjson` `sha256:572952e8ab856422`:

| class | cases | what a budget would have to buy |
| ----- | ----: | ------------------------------- |
| hit | **1 287** | — |
| lost at the rank one — the engine was right, the pipeline moved it | **20** | precedence |
| seen but lost — the truth was in the seed, the model did not take it | **41** | reasoning |
| **retrieval block — the truth was never shown** | **74** | **breadth** |
| absent — the truth is not a candidate at all | **0** | pool |

**Zero absent** is itself a finding: the engine's pool is complete on this corpus, so the "add candidates" direction has
nothing to add. The 74 block cases are a *breadth* problem and the 41 are a *reasoning* problem; a plan that widens the
seed cannot touch the second, and a plan that improves the prompt cannot touch the first.

## 2. What breadth buys, and what it cannot

| seed width | cases with the truth visible | misses covered |
| ---------: | ---------------------------: | -------------: |
| 5 (shipped) | 1 249 | 61 |
| 10 | 1 278 | 75 |
| 22 | 1 317 | 99 |
| 44 | **1 421** | **135** |

Width 44 covers every miss but one, at roughly 8× the seed. The curve is a property of the ranking and the labels: it
says what becomes **visible**, never what the model would do with it. A width that covers 135 misses is a width at
which the model is shown 39 candidates it was not shown before, and the token cost of that is the real price — which is
why the shipped decision waits for a priced arm rather than for this table.

## 3. Two refutations, both cheap and both useful

**The engine's own indecision does not identify a block.** The only bar a deployed pipeline can read without the truth
is the gap between its first two candidates. Swept over the corpus:

| gap ≤ | fires | of which block | precision | recall |
| ----: | ----: | -------------: | --------: | -----: |
| 0.05 | 159 | 27 | 0.170 | 0.365 |
| 0.164 | 313 | 36 | 0.115 | 0.486 |
| 0.25 | 404 | 54 | 0.134 | 0.730 |
| 0.5 | 638 | 65 | **0.102** | 0.878 |

No threshold is usable: at the block's own median gap the rule touches 22 % of the corpus to reach half the block, and
the cases it touches are mostly hits. A widening rule keyed on this quantity would spend most of its tokens on cases
that did not need them.

**No single term ranks the block.** The block's truth is systematically *stronger* than the winner on `stability`
(64 / 74) and `temporal` (43 / 65) — which is what a source looks like against a conduit — but ranking the candidates
by that term alone localises almost nothing:

| term | accuracy over 1 422 | over the 74 |
| ---- | ------------------: | ----------: |
| `stability` | 2.9 % | 5.4 % |
| `temporal` | 4.3 % | 6.8 % |
| `selfAnomalyLog1p` | 24.5 % | 0.0 % |

The advantage is a **difference of means**, not a decision rule: `stability` is a rank-normalised bonus with mass at
its endpoints, so its ordering is dominated by ties. This is the third time in this register that a term which
separates two populations fails to order one, and it is recorded so the fourth attempt starts from the distinction.

## 4. The candidate: a resolver may not overwrite a decided engine

> When the engine's first candidate leads its second by more than **1.5** score, the resolver does not rename the case.

This is not the guard 331 refuted. That guard read the **answer's loudness**, which is the resolver's own premise read
backwards, so the two rules could not both hold on one case. This one reads a quantity about the **engine**: how far
apart its first two candidates are. A case can have a quiet answer and a decided ranking, and that intersection is
exactly where the front door has been costing cases — **12 of its 81 overrides were wrong**, with a median margin of
**3.34** against **0.03** on the 69 it got right.

`benchmarks/src/engine-certainty.ts` (15 tests, coverage 100/100/100/100) prices it held out, on the surface the
first-hop rule already ships (1 308):

| margin | fold 0 | fold 1 | repairs | breaks |
| -----: | -----: | -----: | ------: | -----: |
| 0.5 | 647 | 650 | 22 | **33** |
| 1.0 | 664 | 661 | 20 | 3 |
| **1.5** | **665** | **663** | **20** | **0** |
| 3.0 | 664 | 662 | 18 | 0 |
| 5.0 | 655 | 653 | 0 | 0 |

Chosen cell 1.5 / 1.5, held out **+10 / +10**, precision **1.000 / 1.000**, four clauses pass. Whole-corpus
counterfactual: **1 328 / 1 422 = 93.39 %**.

## 5. Why it is not shipped, and what closes the gap

The margin lives only in `terms.ndjson`, and that file's ordering is not the shipped ordering:

| comparison | agreement |
| ---------- | --------: |
| first candidate identical | 1 339 / 1 422 |
| …and second candidate identical | 1 283 / 1 339 = 95.8 % |
| guard-touching cases with both candidates identical | **12 / 13** |

So the reading is about an ordering that agrees with the product on 94 % of cases and on 12 of the 13 the guard actually
touches. That is strong enough to state and **not** strong enough to ship: a rule whose margin may be computed on a
different second candidate is a rule whose bar is not yet the product's bar.

**What closes it.** The engine already computes the gated scores; the artifact simply does not carry them. One local
re-run that writes `gatedTop1`/`gatedSecond` and their margin is **¥0 and calls no endpoint** — the engine is
deterministic. On that column the reading is either the same (ship it, +20 cases) or it is not (refuse it), and either
answer costs nothing.

## 6. Falsifiers

1. **If the gated margin reproduces the term margin on the 13 touching cases**, the guard ships at 93.39 % and the term
   ordering's 83 disagreements are recorded as a known non-identity rather than a defect.
2. **If it does not**, the reading above is withdrawn — the instrument stays, the rule does not.
3. **If a priced widening arm shows the 74 block cases are reachable at width 22**, breadth becomes the next axis and
   this guard is a +1.4 pp rung on the way; if it shows they are not, the block is a model-family question and the
   register says so.

## 7. Reproduce

```bash
pnpm exec tsx benchmarks/src/run-retrieval-block.ts \
  --terms artifacts/agentic/terms.ndjson \
  --answers artifacts/agentic/query-agent.ndjson

pnpm exec tsx benchmarks/src/run-engine-certainty.ts \
  --terms artifacts/agentic/terms.ndjson \
  --answers artifacts/agentic/query-agent.ndjson \
  --edges artifacts/agentic/corpus-edges.ndjson \
  --cases artifacts/agentic/per-case.ndjson
```

Both runners print every digest before any number. Neither calls an endpoint.
