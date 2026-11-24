# 341 — The arm's own reach: 74 of 94 published misses never queried the causal service

## 1. The reading

Every number below is a join over artifacts that were already paid for: the arm's answer rows, the engine's per-case
verdict, the corpus walk, and the term dump. No endpoint was called, and no case was re-run.

| population | misses | never queried the culprit | queried it and still missed |
| ---------- | -----: | ------------------------: | --------------------------: |
| the arm's own answers | 135 | **102 (75.56 %)** | 33 |
| the shipped surface (arm + two local rules) | 94 | **74 (78.72 %)** | 20 |

Read against the whole corpus, the second row is the number that matters: **5.20 % of 1 422 cases are published wrong
because the investigation never looked at the service that was broken**, against 1.41 % that looked and missed.

Four facts make the 74 a *reach* population rather than a hard one:

1. **The evidence was there in every one of them.** For all 74, the labelled culprit is a key of the case's own
   `metrics` map AND an endpoint of its own `traceEdges`; 51 of the 74 also carry log lines for it. Nothing was
   missing from the corpus; the arm did not ask.
2. **The budget was not the wall.** `DEFAULT_QUERY_BUDGET` allows six rounds and **ten** tool calls; the artifact's own
   rows average **4.99** calls and **1.888** distinct services. The arm stops early with half its budget unspent, and a
   case carries ~50 services (`query-agent.ts`, the fleet-read rationale).
3. **The name was often already on screen.** In 40 of the 74 the culprit's id appears somewhere in the recorded
   transcript — a lower bound, because the transcript a row keeps is its last 2 000 characters (`TRACE_CHARS`). So the
   failure is not "the name never appeared"; in at least half of the 74 it appeared and the investigation moved on.
4. **It is not one fault family.** The 74 are spread across `NetworkBandwidth` (10), `JVMReturn` (9),
   `NetworkPartition` (8), `HTTPResponseDelay` (8), `HTTPResponseReplaceCode` (7), `HTTPRequestDelay` (6) and the rest
   in smaller counts — i.e. this is a policy failure, not a blind spot of one injector.

## 2. Why the existing class names misled the plan

`retrieval-block.ts` classifies a miss by where the truth sits in the **engine's** ranking: `seen-but-lost` (rank
≤ `SEED_WIDTH`) was read as "the model was shown it and did not take it", and `retrieval-block` (rank > `SEED_WIDTH`)
as "no prompt can reach it". Both sentences assume a **seeded** arm.

The shipped arm is not seeded, and its artifact says so on every row:

```
$ jq -r .seeded /tmp/art328/query-agent.ndjson | sort | uniq -c
   1422 false
```

So `SEED_WIDTH` is a width an *experiment* would set, not one the product uses, and the two class names describe the
**pipeline's** reach — what a seeded arm would have been shown — rather than what the model read. Three consequences:

* the 48 "breadth" cases are not unreachable: the free arm's reach is set by its own tools, not by a seed it never sees;
* the 37 "seen-not-taken" cases are not 37 reasoning failures. Only **20** of the 94 shipped misses actually queried the
  culprit (33 of the arm's 135), and those 20 are the only population a reasoning-shaped repair can act on;
* `unwidenable 20` counted cases settled by a channel that does not read the seed — true, and now beside the larger
  fact that **no** channel reads the seed in the shipped configuration.

`SEED_WIDTH`'s own docblock and the module header now say this, and `formatReachCensus` prints the seed state beside
every reading, so the two questions cannot be confused silently again.

## 3. Instrument: `reachCensusOf` / `formatReachCensus`

`benchmarks/src/retrieval-block.ts`, 34 tests over the module, **100 / 100 / 100 / 100**.

Three miss buckets, disjoint and exhaustive:

| bucket | meaning |
| ------ | ------- |
| `queried` | the arm queried the causal service and still answered wrong |
| `unqueried` | it never queried it |
| `unrecorded` | the artifact carries no `calls` column for that row |

Collapsing `unrecorded` into either neighbour would report a population that was never seen as one that was measured —
the same defect the certainty guard's census closed in 340. The share is printed over the **classifiable** misses and
names its denominator, and `hitsQueried` is carried as a control: a reader that never records a query cannot pass as
one that does.

`run-miss-ledger.ts` prints the census twice — over the arm's own answers and over the shipped surface — because the
two are one rule apart and a reader needs to see that the rules neither repair nor break a reach failure.

## 4. The field's own baseline, defined by its code

`RCAEval` now prints two columns under every `Avg@5` (`main.py --report-chance`, contributed in #79). Read from its
source rather than from its changelog, because two of the three definitions are not what their names suggest:

```python
def chance_accuracy(self, k):        # AC@k of a uniformly random ranking over the same candidates
    return sum(min(k, n) / n if n and found else 0.0
               for n, found in zip(self._n_candidates, self._answer_in_candidates)) / self.num

def chance_average(self, k):         # Avg@k of that ranking: the mean of chance_accuracy(1..k)
    return sum(self.chance_accuracy(i) for i in range(1, k + 1)) / k

def lift(self, k):                   # printed as `Lift@5`
    return self.average(k) - self.chance_average(k)
```

Three facts follow, and the third is the one that would have been got wrong by assumption:

1. **Their `Chance@5` is the average of the per-cut chances, not `min(5, n)/n`.** On a four-service cell it is
   `0.70`, not `1.00`.
2. **Their `Chance@5` is this module's `floor`.** `uniformFloor`'s closed form and `chance_average` are the same sum,
   and the identity is now asserted per cutoff rather than argued: `readCutoffs(cases, k).floor ===
   chanceAverageOf(cases, k)`.
3. **`Lift@5` is an EXCESS, not a multiple.** `lift = average − chance_average`. A ratio printed under that label
   would be a different number wearing the field's name — the defect this module was written to stop repeating — so
   `CutoffReading` now carries `lift` beside `avg` and `floor`, `formatCutoffs` prints both columns, and a test asserts
   that the ratio is **not** the lift on the same reading.

## 5. The defect that reconciling the two definitions exposed

`CutoffReading.absent` has always been documented as "unreachable at every cutoff, by construction", and the floor was
computed as `uniformFloor(k, pool)` for **every** case — including those whose answer the pool never held. Those two
statements cannot both be true: an answer that is not in the pool cannot be found by any order over it, so charging it
`min(k,n)/n` *raises* the quoted baseline above the one the corpus could reach.

The evaluator carries the same distinction as `answer_in_candidates`, and its docstring states the assumption it
defaults to — *"the answer is an injected member of the ranked system"* — which is exactly the assumption that fails on
the rows this corpus cannot measure. Fixed: `chanceAt(k, pool, inPool)` returns `0` for an absent answer, the floor is
the mean over cuts of that per case, and the corpus's own three row states are now distinct:

| state | meaning | how the reading treats it |
| ----- | ------- | ------------------------- |
| measured, in pool | `truthRank ≥ 1` | contributes `AC@k` and `min(k, pool)/pool` |
| measured, absent | `truthRank === 0` | contributes `0` and `0` |
| unmeasured | no `truthRank` column (9 rows of the last census) | excluded by `censusPopulations` from **both** |

The third row is why `censusPopulations` returns two populations: the answer metric is defined on 735 rows and the
order metric on 726, and printing one number over the other's denominator is how 0.9 pp of phantom accuracy appears.

## 6. What this re-prices

| axis | population | price in the queue | reading now | verdict |
| ---- | ---------: | -----------------: | ----------- | ------- |
| arm reach — never queried the culprit | 74 (5.20 pp) | not in the queue | the culprit is in `metrics` and `traceEdges` in **all 74**; budget is 10 calls, 4.99 used | **P0**, the largest single block |
| reasoning — queried and missed | 20 (1.41 pp) | ≈ ¥21 (labelled "37 cases") | the true reasoning residue is 20, not 37 | P1, ceiling cut by 46 % |
| breadth — engine rank > 5 | 48 | ≈ ¥2 (74-case ceiling arm) | the arm is free (`seeded: false` × 1 422); a seed it never reads cannot move it | **retired** as an arm lever |
| precedence residue | 9 | — | four scopings, all negative | closed |
| absent | 0 | — | — | closed |

The rewritten law, to sit beside 340's aperture:

> An engine-side change converts to a published change only on cases the arm gets **wrong and no rule settles** (135,
> 9.5 %). An **arm-side** change converts on cases the arm never investigated, and that population is 74 (5.2 %) — with
> the evidence already in the case file. The two are disjoint levers, and the second is the larger one.

## 7. Falsifiers

1. **If a second run of the arm produces a different `calls` set on the same cases**, the census is one sample's
   attention rather than a property of the configuration, and every number above is that sample's. The 74 is a
   *lower* bound on the reach failure only if the sample is representative; the artifact is a single run, and this
   document says so rather than calling it a rate.
2. **If any of the 74 carried no telemetry for the culprit**, querying it could not have helped and the ceiling shrinks
   by that case. All 74 carry it in both `metrics` and `traceEdges`; the check is one pass over the corpus and is in
   the reproduce block below.
3. **If a policy that spends the same ten calls on higher-error services does not convert**, the reach reading is
   right about where the attention went and wrong about why, and the next entry records the refutation with its number
   instead of a widened queue.

## 8. Field check, 341

Four movements, none of which changes a number in this repository but two of which change what the queue is worth:

* **RCAtlas** (arXiv, late Oct 2026): 90 validated incidents from eight public datasets, six models × three
  reasoning-effort settings. Its ordering is the one this register has been arguing from the inside: **plain harnesses
  reach PR@1 65–77 %** on three mid-tier models, five published LLM RCA agents land at **16–53 %**, and statistical and
  causal methods at **6–39 %**; every Pareto-optimal configuration for cost or time used a simple harness, and raising
  reasoning effort moved accuracy a couple of points while multiplying runtime up to 7×. Its stated mechanism —
  "hard-coded investigation paths skip the decisive evidence, because the prescription decides where to look before the
  incident reveals what matters" — is this iteration's 74 cases seen from the other side: ours is a free arm with no
  SOP at all, and it still looks in the wrong place, because a *budget* without a *policy* is not a search.
* **CARE-PO** (`arXiv:2611.12125`): 82.8 % of agent trajectories contain at least one removable tool call and 68.0 % of
  all calls were judged removable, which reframes the unused half of our budget as the normal state of agent harnesses
  rather than a defect of this one — and makes "spend the calls you have on the right service" the question, not
  "spend more".
* **SRE-1** (ResolveAI, 18 Nov 2026): a 27B RL-post-trained investigator over 400+ tools answering with a citation-
  bearing causal chain, 38.8 % single / 71 % five-run ensemble pass on 49 live cases at −37 % cost against the strongest
  frontier model. A **process-scored** competitor now exists with a deployed product behind it; our corpus cannot score
  a chain, and §340's note on the BRiSE family applies unchanged.
* **DecompRCA v2** (`arXiv:2609.36686v2`): microservice retrieval "nearly solved (98–100 %)", no causal graph "clearly
  beat[s] the best statistical baseline", and +7…+18 points from a short system-description document. Our `abs 0` is
  the same statement measured independently — and this iteration's 74 says the microservice bottleneck is not
  *retrieval from the ranking* but *selection of what to look at*, which their decomposition does not separate.

## 9. Reproduce

```bash
# the two censuses, over the stored artifacts (¥0, no endpoint)
npx tsx benchmarks/src/run-miss-ledger.ts \
  --answers /tmp/art328/query-agent.ndjson \
  --cases   /tmp/cost0/base2/per-case.ndjson \
  --edges   /tmp/cost0/edges.ndjson \
  --terms   /tmp/cost0/base2/terms.ndjson

# the chance/lift columns, on any census
npx tsx benchmarks/src/run-cutoff-accuracy.ts --census <census.ndjson> --k 5

# falsifier 2: is the culprit observable in the case the arm read?
python3 - <<'PY'
import json, os
rows = {json.loads(l)['datapack']: json.loads(l) for l in open('/tmp/art328/query-agent.ndjson') if l.strip()}
surf = {json.loads(l)['datapack']: json.loads(l) for l in open('/tmp/art340/base-surface.ndjson') if l.strip()}
unq = [d for k, d in rows.items()
       if not surf[k]['correct'] and not (set(d['calls'] or []) & set(d['truth']))]
for d in unq:
    c = json.load(open(os.path.join('/root/rcabench/json', d['datapack'], 'case.json')))
    assert set(d['truth']) & set(c['metrics']), d['datapack']
print(len(unq), 'unqueried misses, all with the culprit in the case metrics')
PY
```

## 10. Next

1. **P0, ¥0** — a *selection* arm: the same ten calls, ordered by the case's own failing subgraph rather than by the
   model's first instinct. The ceiling is the 74; the measurable question is how many of them a deterministic ordering
   would have reached, and that is computable from the artifacts before any dispatch.
2. **P1, ¥2** — a 74-case ceiling arm at the same budget with the selection change, to convert the ceiling into a rate.
3. **P1, ¥0** — write the `Retrieval@K`/`Rerank@1` split of *this* corpus into the same three buckets, so the next
   competitor table compares two axes rather than one.
