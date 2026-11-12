# The absent class — the twelve per cent the ranking never shows

Every accuracy number this project publishes is a rate over cases, and a case can fail in two ways that no
single rate separates: the truth was ranked lower than something else, or the truth was **not in the ranking
at all**. The second is not a worse version of the first. A lower-ranked truth is a statement about evidence
and can be repaired by re-weighting; an absent truth is a statement about the candidate SET, and no coefficient
of a term it never entered can reach it.

`docs/pool-admission.md` measured this class on the nine golden cells: 12 of the 641 misses were a truth the
ranking never surfaced, and the arm that admits every graph node recovered all twelve as candidates and one as
an answer. That was 1.6 % of the corpus. On the FSE'26 archive the same class is **12.2 %**, and this document
is what it turned out to be.

## 1. The three buckets, on 1422 datapacks

| bucket | what it means | cases | share |
| --- | --- | --: | --: |
| `top1` | the truth is the ranking's first answer | 1073 | 75.46 % |
| `top5` | the truth is in the top five but not first | 176 | 12.38 % |
| **`absent`** | the truth is in **none** of the five | **173** | **12.17 %** |

> **Corrected in iteration 270 — the bucket's NAME overstated its meaning, and §4 already said so.** "Absent" here
> means absent from the **reported five**, not from the order: a stratified 106-case reading with the full ranking
> dumped (`--depth-out`, `docs/agentic-headroom.md` §10) finds the corpus answer somewhere in the order in **106 of
> 106** cases, median miss depth 4, maximum 42, zero absent from the order. The 173 are therefore *deep*, and the
> owner of the loss is the same one the `top5` bucket has — ordering — not the candidate SET this document's
> opening paragraph distinguishes it from. §4's own diagnostic already contradicted the name: it renders the node
> with `selfAnomaly=0.551` and concludes the service "is **not invisible** … It loses because every competitor
> carries more." Column 4 below still counts the right thing (a truth outside the reported five); only the
> interpretation of what that costs changed, and the next iteration's terms are re-aimed accordingly.

The per-type split is where the campaign's type tables come from, and it says the two buckets have different
owners:

| fault type | n | top1 | top5 | absent | miss % |
| --- | --: | --: | --: | --: | --: |
| HTTPResponseReplaceCode | 231 | 162 | 14 | **55** | 29.9 |
| HTTPRequestReplaceMethod | 190 | 125 | 27 | **36** | 34.2 |
| NetworkPartition | 97 | 64 | 18 | 15 | 34.0 |
| HTTPResponseDelay | 89 | 56 | 26 | 7 | 37.1 |
| HTTPRequestDelay | 88 | 57 | 20 | 11 | 35.2 |
| NetworkBandwidth | 42 | 20 | 16 | 6 | 52.4 |
| NetworkLoss | 48 | 29 | 12 | 7 | 39.6 |
| NetworkCorrupt | 46 | 31 | 9 | 6 | 32.6 |
| HTTPRequestAbort | 60 | 46 | 4 | 10 | 23.3 |
| JVMException | 43 | 30 | 9 | 4 | 30.2 |
| HTTPResponseAbort | 44 | 34 | 6 | 4 | 22.7 |
| JVMReturn | 21 | 12 | 2 | 7 | 42.9 |
| HTTPResponseReplaceBody | 51 | 45 | 6 | 0 | 11.8 |
| HTTPRequestReplacePath | 39 | 38 | 1 | 0 | 2.6 |
| NetworkDelay | 21 | 20 | 1 | 0 | 4.8 |
| ContainerKill | 89 | 89 | 0 | 0 | 0.0 |
| JVMMemoryStress | 171 | 171 | 0 | 0 | 0.0 |
| PodFailure | 24 | 24 | 0 | 0 | 0.0 |
| PodKill | 10 | 10 | 0 | 0 | 0.0 |

The four resource classes are complete (0 misses), which is the fact `docs/fault-census.md` records on the
other corpus: a permanent resource shift is a large stable deviation at the injected service and every corpus
finds it. Everything this document is about is in the classes whose signature is at a call boundary.

## 2. The absent class is nearly one service

Of the 173 absent cases, **149 (86.1 %) carry `ts-ui-dashboard` as an accepted root cause**, and the remaining
24 are spread over fifteen services:

| truth service | absent cases |
| --- | --: |
| `ts-ui-dashboard` | **149** |
| `ts-travel-service` | 6 |
| `ts-assurance-service` | 6 |
| `ts-preserve-service` | 5 |
| `ts-order-service` | 4 |
| `ts-config-service` | 3 |
| `ts-consign-service` | 3 |
| `ts-seat-service` | 3 |
| `ts-travel2-service` | 3 |
| `ts-route-plan-service` | 3 |
| (twelve others) | 12 |

Thirty-four of the 173 are multi-label (the corpus accepts both the injection point and the affected
endpoint); 139 are single-label.

The asymmetry that makes this a defect rather than a property of the service:

| population | n | in the top five |
| --- | --: | --: |
| cases whose truth INCLUDES `ts-ui-dashboard` | 186 | 37 (19.9 %) |
| cases whose truth EXCLUDES it | 1236 | 191 (15.5 %) |

`ts-ui-dashboard` is found as often when it is **irrelevant** as when it is the answer. A ranking whose answer
is less retrievable than its distractors is not measuring the same thing in the two populations.

## 3. It is not the topological discount — measured, not argued

`docs/topo-discount-scope.md` §9.3 shows that at the shipped `gate = 1` the deduction cannot charge the
argmax, and §9.4 shows the caller-side predicate was additionally blind on this corpus (`isLatencyMetric` is a
`startsWith('latency')` test, and the FSE'26 converter writes `http.server.request.duration.max`). Together
those make it a natural suspect for a truth that vanishes.

It is not the cause, and one arm says so. On the 142 absent datapacks whose shards were converted locally:

| arm | Top@1 | Top@3 | Top@5 |
| --- | --: | --: | --: |
| shipped | 0/142 | 0/142 | 0/142 |
| `--topo-discount 0` | 0/142 | 0/142 | 0/142 |

Zero gained, zero lost, and `ts-ui-dashboard` appears in the top five of four cases instead of none — four
non-answers. **The deduction is not why the truth is missing.** (The 0 % baseline is the definition of the
subset, not a reading: these are exactly the cases whose truth is outside the top five.)

## 4. What the truth actually carries

A single-case diagnostic on `ts0-ts-ui-dashboard-response-replace-code-69j7gg` (truth `ts-ui-dashboard`)
prints the node the ranking cannot find:

```
ts-ui-dashboard [GT] selfAnomaly=0.551 logScore=0.000 failedEdge=1.000 failedEdgeRecords=1
                     latRise=1.386 latEdges=1 dominant=k8s.pod.network.io err=0 onset=818
```

So the service is **not invisible**. It carries 0.551 of deviation, all of it from `k8s.pod.network.io` and a
failed edge, with a **moderate** latency rise (1.386 against the 2472–5972 that a bandwidth fault produces at a
caller). It loses because every competitor carries more.

The channel that would name it is the one the corpus writes as `http.response.error_rate`, and its dominant is
a **pod** channel — which is what a node's profile looks like when its only fault-carrying channel was dropped
before scoring. `docs/duty-cycle-window.md` §5 measures that drop: the idle guard applies the whole-recording
rule to a channel the family does not name, and the whole recording's first half is pre-injection, so the
channel is idle by construction in exactly the period that makes it look idle.

## 5. The second spelling, on this subset and on the corpus

`eventExtraLabels=['http.response.error_rate']` is the switch that repairs the drop. On the same 142 cases:

| arm | Top@1 | Top@3 | Top@5 | gained vs shipped | lost |
| --- | --: | --: | --: | --: | --: |
| shipped | 0 | 0 | 0 | — | — |
| `topoDiscount=0` | 0 | 0 | 0 | 0 | 0 |
| **admission, shipped discount** | **6** | **24** | **33** | **+33** | **0** |
| admission + `topoDiscount=0` | 7 | 26 | 37 | +37 | 0 |

**No case is lost on this subset by either admission arm.** The four-case difference between the two is the
deduction's whole contribution here: it charges four nodes the admission had just given evidence to.

On the full archive the same switch, re-measured on this iteration's code (run `43040001015`, HEAD `25ca7783`,
control `43021484829` on the same HEAD), reads **`Top@1 1073 → 1082` (75.46 % → 76.09 %), `Top@3 86.29 → 87.97 %`,
`Top@5 87.83 → 90.44 %`**. Iteration 259 measured the same arm at `87.90 / 90.51` on the pre-260 predicate; the
0.07 pp difference is the family-aware `isResponseChannel` of iteration 260 and nothing else.

The type-level split is what refuses it, and it is **seven types up, four down**:

| Δ | fault type | control | arm | n |
| --: | --- | --: | --: | --: |
| **−4** | NetworkPartition | 64 | 60 | 97 |
| **−3** | NetworkBandwidth | 20 | 17 | 42 |
| **−2** | HTTPRequestReplacePath | 38 | 36 | 39 |
| **−1** | NetworkLoss | 29 | 28 | 48 |
| +1 | HTTPRequestAbort | 46 | 47 | 60 |
| +1 | HTTPRequestReplaceMethod | 125 | 126 | 190 |
| +1 | JVMException | 30 | 31 | 43 |
| +1 | NetworkCorrupt | 31 | 32 | 46 |
| +3 | HTTPResponseAbort | 34 | 37 | 44 |
| +3 | HTTPResponseReplaceBody | 45 | 48 | 51 |
| **+9** | HTTPResponseReplaceCode | 162 | 171 | 231 |

A gain of nine cases is not worth four regressed network types, on this project's rule that a regressed type
ends an arm whatever the total did. The rule has now been applied to this switch in three iterations (259 wrote
it, 260 re-read it under a repaired predicate, 261 re-measured it on a fresh control) and has not been relaxed.

The per-case reason is a population split, not a defect:

- The 33 cases gained on the absent subset are nodes the family cannot see at all, and they are **86 % one
  service**.
- The 14 lost on the corpus are nodes the family **can** see, whose score the second spelling inflates: a
  physical truth that emits no HTTP span (`mysql`) cannot produce the channel, so its callers' rises — genuine
  responses to a fault beneath them — are read as each caller's own evidence.

The mechanism, read off one of the lost datapacks under the admitted spelling:

| node | shipped score | admitted score | dominant (admitted) | rank |
| --- | --: | --: | --- | --- |
| `ts-seat-service` | 1.000 | 1.000 | **`http.response.error_rate`** | **1** |
| `ts-config-service` (truth) | 0.980 | **0.939** | `hubble_http_request_duration_p99` | 3 |
| `mysql` (truth) | 0.327 | 0.327 | `k8s.pod.cpu.node.utilization` | — |

The winner saturates at 1.000 and its dominant channel switches to the admitted spelling. The truth does not
merely fail to gain — it **loses 0.041**, because `anomalyNormalization` is `rank` above
`anomalyNormalizeNodeThreshold` nodes, so any node whose raw score moves re-orders a surface every node is then
read against.

Also visible in that block, and recorded here because it is a separate lead rather than part of this one:
`ts-config-service` carries **108 ERROR log lines and `logScore = 0.000`**, while the node that outranks it
carries **18 and `logScore = 1.000`**. The shipped `logicHttp` mode admits logic exceptions and framework HTTP
exceptions and nothing else, and the truth's hundred and eight lines are neither. The modes that would count
them (`count`, `novelty`, `all`) were measured on the 142 absent cases and move Top@1 by two cases
(1.4 % against 0.0 %) — real, small, and not this class's owner.

## 6. The conditional admission, and why it is not the repair

The natural repair is to admit the second spelling **only for the nodes that need it**, since the two
populations above are separable in the aggregate. Two conditions were tried and both are refuted by
measurement:

- **"only when the shipped reading is zero"** — `selfAnomaly` is 0.551 on the truth in §4, so the condition
  never fires. Measured: the arm reads 0/142, identical to shipped.
- **"only when the node has no event channel at all"** — true for the dashboard (the family does not name its
  channel) and true for the mysql callers (they have no `error` channel on this corpus either), so the
  condition cannot separate the two populations. It would admit exactly the cases that cost the corpus 14.

What separates them is not a property of the node but a property of the **pair**: whether the node's rise is
explained by a callee's. That is what `topoDiscount` computes — and §3 measures that at the shipped gate it
cannot charge the argmax, while `docs/closed-axes-register.md` records that every interior gate value is
unprofitable. So the axis is the one the register already carries as open: a **source-versus-symptom** reading
that does not scale a charge by a magnitude the same term decided, and it needs its own pre-registration
rather than another admission flag.

## 7. Where this leaves the number

The absent class is 173 cases and the admission arm recovers 33 of them at Top@5 with none lost **on that
subset**, while costing 14 at Top@1 elsewhere. Neither half can be shipped alone, so the shipped reading is
unchanged: `Top@1 1073/1422 = 75.46 %`, `@3 86.29 %`, `@5 87.83 %`.

What this document adds is that the class is now **named, sized, and instrumented**: 86 % of it is one
service, the service's evidence is present and quantified, the deduction is exonerated by a zero-delta arm,
and the two conditions that would have made the admission safe are refuted with numbers rather than with
judgement. The next arm is a source/symptom reading, and it inherits a 33-case target with a 14-case
counter-example to test against.
