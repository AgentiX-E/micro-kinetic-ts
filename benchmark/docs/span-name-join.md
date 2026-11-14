# The graph spoke one name and the metrics another, and only the graph was wrong

**The finding, in one sentence.** On `RE2:OnlineBoutique` the traces name the front end `frontendservice`
and `metrics.json` names it `frontend`; nothing joined the two vocabularies, so the topology augmenter — which
keeps only the edges a span confirms — dropped all seven YAML edges starting at `frontend` and installed four
from a node with **no metrics at all**. On **89 of that cell's 90 cases** the dump carried a phantom service
with a real-looking latency reading, and the node the cell actually ranks was disconnected from its own graph.

## 1. What the two artefacts say

| artefact                                     | front end spelled               | evidence              |
| -------------------------------------------- | ------------------------------- | --------------------- |
| `configs/topology/onlineboutique.yaml`       | `frontend`                      | 7 edges out, 12 nodes |
| case `metrics.json` (RE2:OB, RE1:OB, RE3:OB) | `frontend`, `frontend-external` | 12 services           |
| RE2:OB `traces.csv`                          | **`frontendservice`**           | 7 services per file   |
| RE3:OB `traces.csv`                          | `frontend`                      | 7 services per file   |

The same system, two suites, two spellings — and only the RE2 files disagree. So the defect is a property of
**the trace file**, not of the topology: `augmentTopologyWithTraces` prunes every edge no span confirms, and
`frontend>` was never confirmed because no span in that file says `frontend`.

The assembled graph, before and after, on `re2ob_currencyservice_loss_1`:

```
before   edges=checkoutservice>…,frontendservice>checkoutservice,frontendservice>currencyservice,…   services=13
after    edges=checkoutservice>…,frontend>checkoutservice,frontend>currencyservice,…                 services=12
```

## 2. What the phantom did to the reading

A node with no metrics still reached the diagnostic dump, because the dump describes the GRAPH and the graph
had it. In the per-service block it carried a `latRise` and a `latEdges` count — a measured-looking number on
a service that has no telemetry:

| `re2ob_currencyservice_loss_1` |  `latRise` | `latEdges` | `metrics` |
| ------------------------------ | ---------: | ---------: | --------- |
| `frontendservice` (before)     | **14.233** |          1 | **0**     |
| `frontend` (before)            |          — |          0 | 7         |
| `frontend` (after)             | **14.233** |          1 | 7         |

So the channel was not absent on that cell; it was **attached to a node the ranking cannot express**, and the
node it belonged to reported "no latency evidence". The cell's own graph also carried one more node than the
case has services (13 against 12), which is the phantom, counted.

Corpus-wide, over the 735 cases: **89 phantom nodes, all on `RE2:OnlineBoutique`, one per case**, and every
other cell — including RE3:OnlineBoutique, the same system — had none.

## 3. The rule, and why it is three rules rather than a similarity score

`traceServiceResolver(serviceIds)` binds a span's service name to the case's own id, in this order:

1. **Identity** — a name that is already an id is that id, and nothing reshapes it.
2. **Spelling** — lower-case, drop everything not alphanumeric, so `front-end`, `front_end` and `FrontEnd`
   are one key.
3. **The `service` token** — retry (2) after removing a trailing `service`/`services`, because the two
   vocabularies disagree by exactly that suffix (`frontend` / `frontendservice`).

A name that matches nothing is **refused**, and a normalised spelling that two different ids both claim is
**refused too** — attributing one node's spans to another is the one error this join cannot repair
downstream. There is deliberately no embedding fallback here: the repository already has a semantic aligner
for the cases where the spelling distance is large (`rcaeval-semantic.ts`, TF-IDF + LLM), and a deterministic
rule that covers the artefact's actual disagreement is a different instrument with a different failure mode.

The join lives in the **corpus owner** (`benchmarks/src/rcaeval-corpus.ts`), not in the loader, for two
reasons that are both measurable. It is a join — the loader reads one artefact, and the owner is the single
owner of what is applied when several are combined. And moving it into the loader rewrote a contract its own
suite pins: a `traces.csv` with no service column is attributed to `unknown` (7 tests state that), which is a
statement about the FILE rather than about a case's ranking.

## 4. Where the join had to be applied, and why once was not enough

Three consumers key rows on the service column, and they do not share a code path:

| consumer                      | reads                        | why it needed the join                                              |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `augmentTopologyWithTraces`   | `rawCase.traces`             | the pruning rule is "no span, no edge"                              |
| `deriveLatencyViews`          | `rawCase.traces`             | edge latency is keyed `(caller, callee)`                            |
| `countDirectionalInputs`      | `traces.csv` again, streamed | RE2:TT traces exceed a million spans, so this pass cannot hold them |
| `countTraceActivityByService` | `traces.csv`, streamed       | per-service span counts, RE3 only                                   |

The two streaming passes took an optional `resolve` argument instead of re-parsing names, and a name the
caller refuses is dropped **entirely** — including out of `calleeCalls`, whose divisor is the traffic an
interface served rather than the traffic a phantom carried. Without the argument the passes behave exactly as
before, which is what makes the change measurable rather than global.

## 5. What it is worth on the published numbers: nothing, and that is the measurement

`--suite` × nine cells, both arms from the same tree, one stashed and one not, 735 cases each:

| cell               | AC@1 before | AC@1 after | Avg@5 before | Avg@5 after |
| ------------------ | ----------: | ---------: | -----------: | ----------: |
| RE1:OnlineBoutique |         113 |        113 |        96.2% |       96.2% |
| RE1:SockShop       |         119 |        119 |        97.4% |       97.4% |
| RE1:TrainTicket    |         112 |        112 |        95.2% |       95.2% |
| RE2:OnlineBoutique |          84 |         84 |        94.9% |       94.9% |
| RE2:SockShop       |          89 |         89 |        98.9% |       98.9% |
| RE2:TrainTicket    |          76 |         76 |        88.0% |       88.0% |
| RE3:OnlineBoutique |          26 |         26 |        91.1% |       91.1% |
| RE3:SockShop       |          19 |         19 |        85.6% |       85.6% |
| RE3:TrainTicket    |          22 |         22 |        81.2% |       81.2% |
| **total**          |     **660** |    **660** |            — |           — |

**Zero of 735 cases changed winner**, checked case by case against the stashed tree rather than inferred from
the totals. Two mechanisms explain the neutrality, and both are properties of the shipped configuration:

1. `latWeight` reads a callee's **inbound** rise, taken as a MAXIMUM over its callers. The front end has no
   callers of its own, so its edges only ever entered a callee's inbound set — and on this cell the maximum
   was already held by `checkoutservice` or `recommendationservice`, which is why `currencyservice`'s
   `latRise` is `1.071` in both arms.
2. The other readers of outbound edges are `topoWeight` (shipped `0`) and the failed-call channel, which on
   this corpus carries a record on **26 of 23,105 node-reads** (`docs/evidence-starvation-audit.md`).

So the repair is a **correctness** change with a measured null effect, and the null is the useful part: the
nine published cells never depended on a fabricated edge, and the next edge-walking term to be priced on this
cell will not be measured against a phantom. That is also why it ships: a term added tomorrow would have been
evaluated on a graph where the front end of 90 cases had no edges, and the first victim would have been the
measurement itself.

## 6. What a reader can check without rerunning anything

Each assembled case now reports the join in numbers — `spanServices: { total, renamed, dropped }` — because
"the spans were in another vocabulary" and "the spans named services this case does not measure" are two
different facts, and folding them into one count would hide the first behind the second.

The disagreement is confined to one cell, and that was measured rather than assumed: outside
`RE2:OnlineBoutique`, every span service is already a metric id — 0 of 25–26 span services outside the metric
set on `RE2:TrainTicket`, 0 of 26 on `RE3:TrainTicket`, 0 of 7 on both OnlineBoutique RE3 files — and the
SockShop files carry **no spans at all**, so the join is a no-op there by construction. Only
`RE2:OnlineBoutique` disagrees, on 1 of its 7 span services, which is the `frontendservice` spelling.
