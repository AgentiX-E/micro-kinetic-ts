# The ninety-three — what a `Top@1` miss is worth, and the corpus that cannot pay it

**Status:** measured on all 1 422 RCABench cases from the shipped depth artifact (`@1 = 1 156`) plus a
20-case local probe. No model was called for either (`$0.00`). The census is a reusable instrument
(`benchmarks/src/near-miss-census.ts`, **100/100/100/100**, 43 tests), not a one-off script.

## 0. Headline

| | cases | share of 1 422 |
| --- | ---: | ---: |
| correct@1 | 1 156 | 81.29 % |
| **near miss (rank 2–5)** | **93** | **6.54 %** |
| deeper (rank ≥ 6) | 173 | 12.17 % |
| absent | 0 | 0.00 % |

**A perfect reader of the published five would print 87.83 % (1 249/1 422), not 100 %** — which is
`+6.54 pp` over shipped and still `−2.2 pp` behind `Sonnet·ThinkDepth.ai`'s 90.0 %. The window that
clears 90.0 % is rank 12 (`1 287/1 422 = 90.51 %`), so the near-miss class is the FIRST half of the
gap and not the whole of it.

Two findings, and the second one is the expensive one:

1. **The class is not a tie-break class.** 51 of the 93 (54.84 %) sit at a margin of ≥ 20 % against the
   answer, and only 5 (5.38 %) are within two percent. A tie-break rule would have nothing to act on.
2. **The class is dominated by one shape, and the operator that exists for that shape cannot fire on
   this corpus at all.** Three services win 41 of 93 (44.1 %), and the top two — `ts-route-plan-service`
   (23) and `ts-travel-plan-service` (15) — are the corpus's fan-out orchestrators. `docs/topo-closure.md`
   names exactly this class and refused the aggregate (`sum`) on the golden half. This document shows it
   was never going to work here, for a reason no knob can reach: **RCABench's telemetry carries no
   response channel.**

## 1. The margin is measured against the TRUTH, and that choice reverses the verdict

The first draft of this census computed `(top[0] − top[1]) / top[0]` — the gap between the winner and the
runner-up. On the 72 cases at rank 2–3 that reads **22 under 2 %**, which makes the class look like a
tie-break class and sends the next arm into arithmetic.

That reading is wrong, and the error is a single wrong subtrahend. When the answer sits at rank 4, the gap
to rank 2 says nothing about the case. Measured against the answer instead:

| band | cases | share of 93 |
| --- | ---: | ---: |
| under 1 % | 1 | 1.08 % |
| under 2 % | 5 | 5.38 % |
| under 5 % | 9 | 9.68 % |
| under 10 % | 15 | 16.13 % |
| under 20 % | 12 | 12.90 % |
| **at least 20 %** | **51** | **54.84 %** |
| unmeasurable | 0 | 0.00 % |

`unmeasurable` is zero on this artifact, which is itself a reading: no case has a non-positive winner
score and none has the truth outscoring the winner, so the order is internally consistent everywhere.

The instrument reports its own verdict from these numbers: `tie share (under-2pct): 5.38% — verdict
evidence`. The threshold is `TIE_BREAK_SHARE = 0.5`, stated in the module rather than fitted, on the
argument that a tie-break rule can only close a gap that is small relative to the scores it compares.

## 2. Who wins instead

| winner | cases | share |
| --- | ---: | ---: |
| `ts-route-plan-service` | 23 | 24.73 % |
| `ts-travel-plan-service` | 15 | 16.13 % |
| `ts-preserve-service` | 7 | 7.53 % |
| `ts-travel-service` | 6 | 6.45 % |
| `ts-consign-service` | 5 | 5.38 % |
| `ts-order-other-service` | 4 | 4.30 % |
| `ts-travel2-service` | 4 | 4.30 % |

**This table is a description and cannot be a feature.** A count of how often a service wins across the
corpus is computed WITH the labels of the other cases, so a rule that read it would be reading the test
set. It says which mechanism to go and look for; the mechanism has to be re-expressed as something the
engine can observe within one case, and for this class that observable is the call graph's fan-out.

By family:

| family | cases | rank 2 | ranks 3–5 |
| --- | ---: | ---: | ---: |
| HTTPResponseDelay | 14 | 7 | 7 |
| HTTPRequestReplaceMethod | 13 | 5 | 8 |
| NetworkBandwidth | 13 | 1 | 12 |
| NetworkPartition | 10 | 2 | 8 |
| HTTPRequestDelay | 8 | 3 | 5 |
| NetworkLoss | 8 | 4 | 4 |
| JVMException | 7 | 4 | 3 |
| HTTPResponseReplaceCode | 5 | 4 | 1 |
| NetworkCorrupt | 4 | 2 | 2 |

No family dominates, which is the second reason a per-family rule is the wrong shape: the class is
defined by the WINNER's position in the graph, not by the fault type.

## 3. The operator exists, and it cannot fire here

`docs/topo-closure.md` §1 asked the same question on the golden half and found the same shape
("a node that calls everything and is called by nothing", `ts-admin-travel-service` ×6, `front-end` ×3).
Its `sum` arm was refused at `632/735` against `641`. Its FSE'26 arm read **860/1422 on both Top@1 and
Top@3 with all 25 fault types identical** and the closure was recorded as inert on that corpus.

Inert is the symptom. This is the cause, and it is one line of the scope predicate:

```ts
explained(v) = ⊕ over callees c with weight(v→c) > 0 of weight(v→c) × anomaly(c)
// admitted only when isResponseChannel(dominantLabel(c))
isResponseChannel ⇔ label is latency* / event* / 'delay' / 'loss' / 'socket'
```

RCABench's telemetry has **87 distinct metric names and not one of them is a response channel**:

```
container.cpu.usage              k8s.pod.cpu.usage
container.memory.rss             k8s.pod.memory.rss
container.filesystem.available   k8s.pod.filesystem.available
k8s.container.ready              k8s.container.restarts
   … 83 more, every one a resource or a container state
```

Under the shipped `external` scope, `explainsThrough(callee)` is therefore **false for every node on
every case**, `explained` stays empty, and the operator returns the anomaly it was given. The discount
is not misconfigured on RCABench; it is undefined there, because the physical fact it encodes — *a
caller's response time contains its callees'* — is a fact this corpus never measures.

The probe below closes the question by measuring every knob at once.

## 4. The probe: 20 cases, five configurations, one md5

Population: 10 near misses won by `ts-route-plan-service` and 10 won by other services, drawn from the
census dump. It is a **constructed** sample, so the absolute `Top@1 = 0 %` of the control is a property of
the draw and not of the engine — only the DIFFERENCES between rows are readable.

| configuration | Top@1 | Top@3 | Top@5 | per-case artifact |
| --- | ---: | ---: | ---: | --- |
| `external`, `max` (**shipped**) | 0 % | 75 % | 100 % | `be9ac3fb…` |
| `external`, `sum` | 0 % | 75 % | 100 % | `be9ac3fb…` |
| `caller`, `max` | 0 % | 75 % | 100 % | `be9ac3fb…` |
| `all`, `max` | 5 % | 65 % | 80 % | `96b0e4a3…` |
| `all`, `sum` | 0 % | 60 % | 75 % | — |
| `all`, `sum`, `gate = 0` | 5 % | 65 % | 75 % | — |

Three of the four knobs move **not one byte**. Only `topoDiscountScope = all` changes anything, and what
it changes is `+1 / −2 / −4`: it repairs one case and breaks four, which is the same verdict
`docs/topo-discount-scope.md` §7 reached on the golden half from the other direction.

That is four independent refusals of one operator on two corpora — weight, gate, scope, closure — and the
probe adds the reason they all failed: **on a corpus with no response channel, "explained" has no
referent.** No value of any knob can restore a quantity the telemetry does not carry.

## 5. What this changes

Three sentences elsewhere in this repository are now load-bearing and were not:

1. **`docs/topo-closure.md` §8.3's "inert on 1 422 cases" is not an observation about the closure.** It is
   an observation about the scope, and it would read the same for every closure. The document's own
   conclusion — that the class is real and the aggregate is the wrong lever — is correct, and this
   document supplies the missing half: the class is real, the aggregate is unavailable here, and the
   lever has to be built out of a channel this corpus actually measures.
2. **`sota-comparison.md` §2c's "the pass is currently leaving 18–29 pp of retrievable evidence on the
   table" now has a floor.** 6.54 pp of it is inside the published window and nothing outside the engine
   can reach it either: 51 of 93 are ≥ 20 % behind their winner.
3. **The next arm is not a fifth value of this operator.** It is a per-edge direction observable built
   from `traceEdges` / `traceEdgeLatency`, which RCABench does carry and the ranker does not read. See
   `preregistration-308.md`.

## 6. What this document does not claim

- **It does not claim the 93 are winnable.** 87.83 % is what a perfect reader of the published five would
  print; that bound is arithmetic, and whether a reader can reach it is the question the next arm is for.
- **It does not claim the corpus is exhausted.** `deeper` is 173 cases, and the ladder reaches
  `90.51 %` at rank 12 and `92.12 %` at rank 20. Those are a different instrument
  (`docs/rank-depth.md`) and a different arm.
- **It does not claim a like-for-like comparison with 90.0 %.** That figure is a 500-of-1 430 random
  sample with an unpublished draw and a re-annotated label space (`sota-comparison.md` §0c-v). The
  direction is not in doubt at 8.7 pp; the rank is.

## 7. Reproduce

```
pnpm exec tsx benchmarks/src/run-near-miss-census.ts \
  --depth artifacts/agentic/depth.ndjson --cases-out artifacts/agentic/near-misses.ndjson

# the probe, on a directory of case folders
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir /tmp/probe --topo-discount 0 --per-case-out /tmp/a.ndjson
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir /tmp/probe --topo-discount 1 --per-case-out /tmp/b.ndjson
md5sum /tmp/a.ndjson /tmp/b.ndjson     # equal
```
