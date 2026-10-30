# The pool: the set a ranking is a ranking OF

`docs/topo-discount-scope.md` §7.4 ends with a sentence about the ranking's **candidate pool**, and the sentence
was forced by the data rather than chosen: twelve of the 94 misses in the published 641/735 arm are a truth that
is `truthInGraph: true` with `truthRank: undefined`. A retrieval census reads those twelve as "unreachable", and
they are nothing of the kind. This document owns the object they were hiding: the set the ranker admits.

## 1. Two sets, one name

| set       | definition                   | size on a 14-node OnlineBoutique graph |
| --------- | ---------------------------- | -------------------------------------- |
| the graph | `faultGraph.callGraph.nodes` | 14                                     |
| the pool  | `{v : selfScore(v) > 0}`     | 8 or 9                                 |

`performTreeRCA` builds `scoredNodes` from the graph's nodes and then admits a node only when its
**post-deduction** self-anomaly is positive:

```ts
// packages/tree/src/pruning/pruner.ts, until iteration 167
for (const [nodeId] of allNodes) {
  const selfScore = selfScores.get(nodeId)!;
  // Only include nodes with significant self anomaly
  if (selfScore > 0) scoredNodes.push({ serviceId: nodeId, score: selfScore, depth });
}
```

Two comments in this repository called that set the graph — `run-rcaeval.ts`'s record docblock (corrected in
iteration 166) and `loss-census.ts`'s module header (**corrected in iteration 167**). Neither was a typo: both
were written before the deduction existed, when `selfScore` was the graph's own anomaly and only a genuinely
silent node could read zero. The deduction made the filter observable by producing zeros on purpose.

## 2. Why a zero is not a small number

The charge is `ρ · min(a_v, e_v)`. At the shipped boundary — `ρ = 1`, `gate = 1`, charging only a node its
callees account for **in full** — a caller whose explaining callee is at least as large as itself is charged its
entire anomaly and reads exactly `0`. It then fails `selfScore > 0` and leaves `scoredNodes`.

So the operator's output is not "the victim placed low". It is **the victim absent**, and the difference is not
rhetorical:

- an absent truth has no `truthRank`, so `classifyLoss` files it as `RETRIEVAL` — a class whose own definition is
  _no ranking of that set could have returned it_, which is true and useless, because the set was built by
  deleting it;
- a low-ranked truth is `RERANK_DEEP` and is a statement about the priors;
- the two require different work, and until `truthAnomalyBefore` existed the census could not tell them apart.

The three largest single-case movements in the refused `caller` scope arm are exactly this shape:
`checkoutservice_loss_3` 1.976 → 0.099, `orders_delay_2` 2.260 → 0.041, `orders_delay_3` 2.237 → 0.004.

**But "absent" does not mean "deleted", and this document's predecessor said it did.** §7.4 of
`docs/topo-discount-scope.md` read the twelve `truthRank: null` cases as nodes the operator had explained away.
That was an inference from a census that carried no way to check it, and the first measurement of it — §8 below —
finds **none of them deleted** on the two cells a local corpus can run: the one absent truth there reads
`truthAnomalyBefore = 0`, i.e. it was **silent**, and no callee could have explained an anomaly that did not
exist. The class is real and the pool is genuinely narrower than the graph; the CAUSE of the narrowness is what
was unmeasured, and it splits into the six answers below.

## 3. The knob, and why it is not a coefficient

`PoolAdmission = 'positive' | 'graph'`, shipped as `positive`
(`packages/tree/src/causal/topology-fault-graph.ts`, `TreePrunerOptions.poolAdmission`). `graph` admits every node
the engine was handed, each still ranked by its own `finalScore`.

This is the first knob on the dispatch surface that is **not a term of the score**. The four deduction knobs
(weight, gate, scope, closure) all scale or gate one term and all failed one after another in
`docs/topo-discount-scope.md` §7.3, for the reason that document states: none of them can change the form
`min(a_v, e_v)`. `poolAdmission` does not touch that form at all — it changes the **denominator**, which is why it
survives the closure of that axis rather than extending it.

Two consequences a reader must hold onto:

1. **Admission is not promotion.** A node admitted with `selfScore = 0` enters with `log1p(0) = 0` on the base
   term and can only be carried upward by a prior — `failedEdgeWeight` (shipped at 3, the largest weight in the
   formula), the trace vote, the log term. Whether a prior is enough is the measurement, not an assumption:
   `packages/tree/__tests__/unit/pool-admission.test.ts` pins that an admitted silent node lands **last**.
2. **The reading is a rate over a different population.** `pool` rises, so an accuracy fraction's denominator
   changes and the two arms' percentages are not the same quantity. That is why the value is printed on the
   configuration line of both runners — `poolAdmission=positive` — and why `fse26-report.test.ts` asserts it is
   printed unconditionally rather than omitted at its default.

## 4. What the local instrument already says

Admitting the zero-anomaly nodes instead of filtering them, on RE1:OnlineBoutique, moves **107 → 108**, and the
single recovered case is `re1ob_adservice_loss_4` — the one case in that cell whose truth was absent from its
pool. The other eleven of the twelve are in cells without a local corpus, which is why this is a dispatch and not
a reading.

## 5. The instrument that makes the arm readable

`LossRecord.truthAnomalyBefore` — the truth's anomaly **before** the deduction, read off `faultGraph.anomalyScores`
(which `deductExplainedAnomalies` never mutates; it returns a new map). One number, one threshold, six answers:

| `classifyTruthAbsence` | condition                          | owner of the failure                       |
| ---------------------- | ---------------------------------- | ------------------------------------------ |
| `ranked`               | `truthRank` present                | none — the truth is in the ranking         |
| `explained`            | absent, `truthAnomalyBefore > 0`   | the operator deleted a node that had moved |
| `silent`               | absent, `truthAnomalyBefore === 0` | the corpus or the detector                 |
| `not-in-graph`         | `truthInGraph: false`              | graph construction                         |
| `errored`              | the analysis threw                 | the engine                                 |
| `unmeasured`           | absent, no `truthAnomalyBefore`    | the artifact predates the column           |

The last row is the rule this repository applies to every absence: a missing measurement is never reported as a
measured zero. The split is what turns §7.4's sentence into a count, and the count is what the next arm is read
against.

## 6. Predictions for the dispatch, recorded before it

Written before any arm of `poolAdmission=graph` exists, so that the reading can refuse them rather than explain
them. The control is the shipped configuration on the same commit, re-taken bare (641/735 expected, zero flips).

- **P1 — the mechanism.** At least **eight of the twelve** `truthInGraph: true, truthRank: null` cases change
  classification: they gain a `truthRank` (any value) instead of `undefined`. If fewer than eight do, the twelve
  are not the class this knob addresses and the arm's total, whatever it is, is not that mechanism.
- **P2 — the total.** ≥ **645 of 735**. Admission can only add candidates, so a caller that outranked the truth
  cannot be displaced by it; what admission adds is the truth's own `finalScore` back into the comparison. The
  local reading is +1 on 125 cases, so proportional transfer predicts ~+6, and anything below 645 is a refusal.
- **P3 — no cell down.** No cell below its published value by **≥ 3 cases**. Admission cannot remove a candidate,
  so a fall of three in one cell is not a cost of the knob; it is a different engine.
- **P4 — the mechanism is the prior, not the anomaly.** Every case P1 recovers has the truth entering with
  `rca_score = 0`, so it is ranked by the signals alone. If the recovered cases' truths enter with a positive
  `rca_score`, the zeros were not zeros and `selfScore > 0` was never the filter this document describes.

**Refusal rule, written in advance:** refuse the arm if P1 or P3 fails, whatever the total. A total that rises
without the mechanism is the class of result `docs/topo-closure.md` §9 refused for the label defect: not an
explanation, and not publishable as one.

## 7. How to re-measure locally

```bash
# the control — the shipped configuration, and the same command without the flag
pnpm exec tsx benchmarks/src/run-rcaeval.ts \
  --data-dir /root/rcaeval-local --suite re1 --system ob \
  --pool-admission positive --loss-census /tmp/pool-positive.jsonl

# the arm
pnpm exec tsx benchmarks/src/run-rcaeval.ts \
  --data-dir /root/rcaeval-local --suite re1 --system ob \
  --pool-admission graph --loss-census /tmp/pool-graph.jsonl

# read the two classifications, not the two totals
python3 - <<'PY'
import json
for arm in ('positive', 'graph'):
    rows = [json.loads(l) for l in open(f'/tmp/pool-{arm}.jsonl')]
    absent = [r for r in rows if r.get('truthRank') is None and r.get('truthInGraph')]
    print(arm, 'absent:', len(absent),
          'explained:', sum(1 for r in absent if (r.get('truthAnomalyBefore') or 0) > 0),
          'silent:', sum(1 for r in absent if r.get('truthAnomalyBefore') == 0))
PY
```

On the workflow side the knob travels through the packed `anomaly_knobs` block (golden half) and
`ranking_knobs` (FSE'26 half) as `pooladmission=graph` / `pool_admission=graph`; both refuse a third name rather
than resolving it to the default.

## 8. The local readback: two cells, four arms, and one correction

Two assembled cells (RE1:OnlineBoutique 125, RE3:SockShop 30), shipped configuration otherwise untouched
(`ρ = 1`, `gate = 1`, `external`, `max`), one variable per pair of rows.

| arm                  | RE1:OB AC@1 | RE3:SS AC@1 | total /155 | mean `pool` OB | mean `pool` SS |
| -------------------- | ----------: | ----------: | ---------: | -------------: | -------------: |
| `positive` (shipped) |     107/125 |       18/30 |    **125** |            9.0 |           12.0 |
| `graph`              |     108/125 |       18/30 |    **126** |           13.0 |           15.0 |

Three findings, and the second is why the instrument shipped with the knob rather than after it.

1. **The knob is worth exactly one case on these cells, and the arm is therefore not decidable locally.** +1 on
   155 is far inside one standard error; the dispatch is the measurement, as it was for the scope arm.
2. **The one recovered case is `re1ob_adservice_loss_4`, and it is `silent`, not `explained`.** Its
   `truthAnomalyBefore` is `0`: the truth carried no deviation of its own before the deduction, so the deduction
   had nothing to delete, and the shipped filter dropped it for the only reason that filter ever had. §7.4's
   reading of the class — "the truth was explained away" — is refuted on the one case it can be checked against.
3. **Across both cells, the count of truths that are `absent` with `truthAnomalyBefore > 0` is ZERO.** Not one
   published-style miss in 155 local cases is a deleted truth. So the twelve are, on this evidence, mostly the
   other thing: a truth with no deviation at its own origin, which is a signal problem dressed as a pool problem.

What that changes is the arm's expected mechanism, not its expected sign. Admission restores a candidate whose
base term is `log1p(0) = 0`, so it can only be carried by a prior — which is exactly what
`re1ob_adservice_loss_4` needed, and which is why P4 below is the prediction that matters rather than P2. A
`graph` arm that moves nothing would say the priors cannot lift a silent origin on these corpora, and that is a
stronger and more useful result than the +1 is.
