# The edge that could stand in for a channel — and the two readings that cannot tell a source from a symptom

_Iteration 308. The fifth form of the topological deduction, and the first one aimed at the channel the corpus
actually carries rather than at the one it lacks. Refused at two thresholds in each of two forms, and refused for a
reason that is not about the threshold._

## 1. What the axis asks

`docs/closed-axes-register.md` §316 established that the deduction is **undefined** on RCABench rather than
misconfigured: the corpus's 87 metric names are all `container.*` / `k8s.*`, so `isResponseChannel` is false for every
node of every case, `explained` is empty, and `deductExplainedAnomalies` returns its input. Weight, gate, scope and
closure are four descriptions of a quantity with no referent.

The axis in this document asks the next question and it is not a re-parameterisation of the four: **is there a channel
the corpus does carry that encodes the same physical fact?** There is. `traceEdgeLatency` is `[from, to, baseline,
post]` per edge, and a caller's response containing its callee's is exactly what a per-edge latency rise measures. The
axis is the predicate that lets an edge stand in for a response channel.

## 2. Why an edge, and why both sides at once

The engine already reads this array, in the other direction. `edgeLatencyScores` scores a node by its **inbound** rise
— what its callers waited — and feeds `latWeight = 0.561 495`, which is shipped. That is evidence **for** the node: a
node whose callers all slowed down is a node many requests go through. The deduction needs the opposite reading — how
long the node itself waited for each callee — which is evidence **against** it.

Admission has two sides and they ask different questions:

- the **callee side** asks whether an edge may carry an explanation at all. It reads **that edge**: "did this call
  degrade" cannot be answered by a maximum over the caller's other calls.
- the **caller side** asks whether a node's own anomaly may be reduced. It reads the **maximum over its out-edges**:
  "is this reading partly somebody else's work" is settled by one degraded response, and whose it was is not part of
  the question.

Both sides consult one predicate — `admitted(nodeId, rise)` — and it is stated once so the two cannot disagree.
Relaxing only the callee side would have been **inert on exactly the corpus the arm was built for**, because on
RCABench the caller side's channel predicate is false for the same reason the callee side's is; a predicate that
cannot fire is a spelling, not an arm. That is amendment A1 of `docs/preregistration-308.md`.

## 3. The two forms

`TopoEdgeRise` is `{ threshold, against: 'absolute' | 'inbound' } | null`, and the two members are different rules
rather than two spellings of one:

| `against` | predicate | what it says |
| --- | --- | --- |
| `absolute` | `rise(edge) ≥ θ` | the call got this much slower |
| `inbound` | `rise(edge) ≥ θ · maxInRise(caller)` | the call got slower **relative to how much this caller was itself slowed** |

The second form was added after the first was measured and refused, on the hypothesis that the first fails because the
corpus's ambient rise differs by two orders of magnitude between cases, and that dividing by the caller's own inbound
measurement would be the same fact in the units the case provides. **The hypothesis is wrong, and §5 is the
measurement that says so.**

`null` is the shipped reading and it is inert by construction: the operator visits no edge array, `admitted` returns
`false` on its first line, and the golden nine cells are byte-identical case for case. On RCAEval the array is
`undefined` (no span durations in the datapacks), so the field is absent rather than zero — an absent measurement and
a unit rise are different facts and only one of them licenses a charge.

## 4. The measurement

FSE'26 corpus, 1 422 cases, `commit 3cf160c` plus this iteration's tree. Control is the **shipped** configuration with
the fault-free profile (1 156); every arm differs from it by `--edge-explained` alone. `$0`: no model call anywhere in
this section.

| arm | Top@1 | Top@3 | Top@5 | up | down | net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| control (profile, shipped) | **1 156** | 1 228 | 1 249 | — | — | — |
| `θ = 2`, `absolute` | 1 129 | 1 207 | 1 237 | 17 | 48 | −27 |
| `θ = 10`, `absolute` | 1 153 | 1 222 | 1 246 | 18 | 19 | −3 |
| `θ = 2`, `inbound` | 1 129 | 1 205 | 1 232 | 16 | 38 | −27 |
| `θ = 5`, `inbound` | 1 140 | 1 216 | 1 238 | 4 | 18 | −16 |

The pre-registration's acceptance was `Top@1 ≥ 1 200` with the golden nine cells identical. **Every arm fails the
first half by at least 47 cases.** P1 (the observer repair ≥ 12 cases) reads **6** at both thresholds of the absolute
form and **3** and **0** in the ratio form — the form added to improve the repair makes it worse. P4 (no fault type
down by more than one) is violated by `NetworkCorrupt −5` at `θ = 2` and `HTTPResponseReplaceCode −5` at `θ = 5`
`inbound`.

The control reproduces to the case: a re-run of the same configuration reads 1 156 / 1 228 / 1 249 and produces a
per-case artifact equal to the earlier one, so the four arms are differences of one axis rather than of two builds.

## 5. Why: the statistic does not separate the classes, and the divisor separates them the wrong way

Admitting edge `from → to` is a decision to **charge `from`**, and that decision has a truth value. It is *helpful*
when `from` is a symptom of a fault downstream — the caller's rise really is partly somebody else's work — and
*harmful* when `from` is the ground-truth source, which is then demoted for waiting on the faults it caused. So the
axis is a classifier, and it can be read as one over the whole corpus: 71 560 measured edges, 5 942 of them leaving a
ground-truth service.

| statistic | charging the truth (harmful), n = 5 942 | charging a symptom (helpful), n = 65 618 |
| --- | --- | --- |
| edge rise `post/pre` — p10 / p25 / **p50** / p75 / p90 | 0.47 / 0.68 / **0.91** / 1.24 / 1.91 | 0.48 / 0.70 / **0.94** / 1.38 / 2.91 |
| rise ÷ caller's inbound rise — p10 / **median** / p90 | 0.03 / **0.65** / 1.62 | 0.08 / **0.76** / 1.70 |

**The two populations are the same population.** The medians differ by 3 % on the absolute statistic and 17 % on the
ratio, and the *helpful* class is the one with the larger values in both — the opposite of what a threshold needs.
A fault multiplies the latency of every call the faulty node makes, so a high out-rise is a property of the fault as
much as of the symptom; there is no cut to place.

The consequence, as admission purity:

| θ | `absolute`: admitted / of which charge the truth | `inbound`: admitted / of which charge the truth |
| ---: | --- | --- |
| 2 | 10 227 / 533 (5.2 %) | 5 151 / 434 (8.4 %) |
| 5 | 4 568 / 78 (1.7 %) | 1 240 / 157 (**12.7 %**) |
| 10 | 3 125 / 18 (**0.6 %**) | 510 / 80 (**15.7 %**) |

At `θ = 10` the absolute form admits 3 125 edges of which 18 charge the truth; the inbound form admits 510 of which
80 do — **a classifier 26× less pure at the same threshold**. That is the mechanism of §3's collapsed hypothesis, and
it is structural rather than numeric: a service that is called by nobody, or by one caller, has a small or absent
inbound measurement, so dividing by it *selects* for sources. The divisor does not normalise the corpus's ambient
rise; it concentrates the arm on the population the arm must not touch.

## 6. Why it fails twice: at `rho = 1` a false positive is a deletion, not a demotion

The purity above would be survivable if a wrong charge cost one rank. It does not. `topoDiscount = 1` with
`topoDiscountGate = 1` and `poolAdmission = positive`, so a caller whose callee's explained anomaly reaches its own is
deducted to a non-positive score — and the pool filter then keeps it out of the ranked list altogether. The candidate
does not fall; it disappears.

| arm | cases whose truth is absent from the ranked list | of those, correct at rank 1 in the control |
| --- | ---: | ---: |
| control | 173 | 0 |
| `θ = 2`, `absolute` | 185 | 9 |
| `θ = 10`, `absolute` | 176 | 2 |
| `θ = 2`, `inbound` | 190 | **16** |
| `θ = 5`, `inbound` | 184 | **12** |

The 173 is the structural floor — cases the pool filter already excludes for reasons of its own, present in the
control and in every arm. What the arms add is the column beside it: **16 answers that were right at rank 1 deleted
outright** by the inbound form at `θ = 2`, and 12 at `θ = 5`. The arm loses 27 and 16 cases; the deletions account for
most of each loss, and no other term in the ranking can undo one because there is no score left to reorder.

Two consequences, and the second is not about this axis.

1. **The axis closes.** It is not mis-thresholded and it is not missing a third form: the measurement in §5 says the
   two statistics available in this corpus rank the harmful and helpful populations in the same order. A third cut on
   the same statistic would be the same experiment a third time.
2. **The deletion channel is live wherever the deduction runs**, `rho = 1` being the shipped value on both corpora.
   On RCAEval it is worth +10 net (`docs/topo-share.md` §8–9), so the channel is not a defect in itself — but it means
   any future arm that widens admission is measured against a cost function with a cliff in it, and the cliff is the
   reason a 0.6 %-impure classifier can lose 19 cases.

## 7. What is closed

| Axis | Verdict |
| --- | --- |
| "the edge latency channel can stand in for the missing response channel" | **closed as measured uninformative** — the harmful and helpful populations are the same distribution (medians 0.91× vs 0.94×), so no threshold and no divisor on this statistic can separate them |
| "dividing by the caller's own inbound rise is the same fact in the case's units" | **closed as false, and worse than the null** — it is 26× less pure at `θ = 10` and it deleted 16 correct answers at `θ = 2` |
| "the observer class is repaired by an edge predicate" | **closed at 6 of 12** in all four arms, by the pre-registered P1 |
| "the deduction can be made to fire on RCABench by widening its channel predicate" | **closed** — it fires, at 10 227 admissions, and the ranking gets worse |

## 8. How to re-measure

```bash
# control: the shipped configuration with the corpus profile
npx tsx benchmarks/src/run-fse26.ts --data-dir /root/rcabench/json \
  --fault-free-profile /tmp/profile.json \
  --output /tmp/ctl.json --per-case-out /tmp/ctl.ndjson

# either form of the axis, on the same battery
npx tsx benchmarks/src/run-fse26.ts --data-dir /root/rcabench/json \
  --fault-free-profile /tmp/profile.json --edge-explained 2:inbound \
  --output /tmp/ib2.json --per-case-out /tmp/ib2.ndjson
```

The configuration line prints `topoEdgeRise=` **only when the axis is set**, because `null` is the absence of the knob
rather than a value of it; when set it prints the form as well as the threshold, so `2` and `2:inbound` are two lines
rather than one. The artifact's `config.topoEdgeRise` carries the pair for the same reason. Both are rendered through
`formatTopoEdgeRise`, the function the two CLIs parse with.
