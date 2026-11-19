# The failure channel cannot name a role

**Arms:** `failedEdgeFirst=true` with `failedEdgeFirstScope=unexplained` (iteration 313), then
`failureContainmentScope ∈ {global, global-measured}` (iteration 314). **Control:** the same commit, no flag.
**Corpus:** 1 422 RCABench cases, one run each, no model call, `$0`. **Read:** the second arm on the
failed-edge axis is refused at **1 049 against 1 156 `Top@1`** — and the arm that follows from *why* it failed
reads **1 186 with 30 gained and none lost** — and it is the scope the FSE'26 dispatch now states (§6).

This document is the read. `docs-repository:preregistration-312.md` and `docs-repository:preregistration-313.md`
are the priors.

---

## 1. What the residual membership measured

Iteration 312 partitioned the ranking on membership in the failed-edge ledger (credited first) and measured
**−170**. Iteration 313 partitioned it on a narrower membership — the candidates whose failures their own calls
do not explain, `unexplainedFailures(v) = max(0, inbound(v) − outgoing(v))` — and the hypothesis was that the
narrower set excludes the relay.

| | control | `credited` (312) | `unexplained` (313) |
| --- | ---: | ---: | ---: |
| `Top@1` | **1 156** | 986 | **1 049** |
| `Top@3` | 1 228 | 1 232 | **1 323** |
| `Top@5` | 1 249 | 1 293 | **1 348** |
| gained / lost | — | 71 / 241 | **135 / 242** |

The narrower membership bought 64 more gains and **one more loss**. That is the shape of a statistic that is
more specific on the population it *reaches* and exactly as unspecific on the population that *defeats* it.

| fault type | control | `unexplained` | Δ |
| --- | ---: | ---: | ---: |
| `HTTPResponseReplaceCode` | 171 | **229** | **+58** |
| `HTTPRequestReplaceMethod` | 139 | **174** | +35 |
| `JVMException` | 32 | **41** | +9 |
| `NetworkBandwidth` | 23 | **31** | +8 |
| `NetworkPartition` | 72 | 78 | +6 |
| `HTTPResponseDelay` | 68 | 73 | +5 |
| `JVMMemoryStress` | **171** | **26** | **−145** |
| `ContainerKill` | **89** | **23** | **−66** |
| `PodFailure` | **24** | **4** | **−20** |
| `PodKill` | **10** | **6** | **−4** |

The four loss families are the same four iteration 312 lost, at the same counts, ±1. So the second arm's
membership change did nothing to the failure and everything to the reach. **The hypothesis that the residual
separates a source from a relay is refuted** — and the reason is one measurement away.

## 2. What the ledger actually contains, per service

`scripts/dump-failure-flows.ts` prints, per case, the four counts the pass reads and the residual both ways.
Sampled 20 cases per family (150 total, `$0`):

| fault type | n | ground truth has **no** flow row | truth is a lead | control's rank-1 is a lead |
| --- | ---: | ---: | ---: | ---: |
| `JVMMemoryStress` | 20 | **20 (100 %)** | 0 | 0 |
| `ContainerKill` | 20 | **20 (100 %)** | 0 | 0 |
| `PodFailure` | 20 | **20 (100 %)** | 0 | 0 |
| `PodKill` | 10 | **10 (100 %)** | 0 | 0 |
| `HTTPResponseReplaceCode` | 20 | 0 | **20** | **20** |
| `HTTPRequestReplaceMethod` | 20 | 0 | **20** | 18 |
| `JVMException` | 20 | 1 | 19 | 18 |
| `NetworkBandwidth` | 20 | 2 | 18 | 12 |

Two rows carry the whole result.

### 2.1 In the four loss families the truth is not in the ledger at all

```
ts0-ts-auth-service-stress-nlpsfx          truth ts-auth-service   in=0  out=0   residual 0
                                            rank 1 ts-auth-service  in=0  out=0
                                            rank 4 ts-ui-dashboard  in=57 out=0   residual 57  share 1.00
```

A `JVMMemoryStress` (or kill, or pod-failure) fault **fails no call at its own service**: the requests that
arrive there are slow, and the ones that fail are the load source's, at the front door. So the ground truth has
no `knownIn`, no `knownOut`, no `novelIn`, no `novelOut` — it is *absent from the population the rule ranks*, and
no membership rule over that population can ever promote it.

The control already answers these cases correctly (`rank 1` above). The arm demotes the truth only because
promotion is a **displacement**: the relay is put first, and the truth moves down by one. Iteration 312 said this
in ranks ("93 fall from 1 to 2"); this is the same fact in the channel's own units.

### 2.2 In the two gain families the truth *is* a lead — and so is the relay

```
ts0-ts-basic-service-response-replace-code-4vn4gg   truth ts-basic-service  in=439 out=0  residual 439
                                                     rank 1 ts-basic-service
                                                     rank 2 ts-travel2-service in=97 out=439 residual 0
```

Here the partition is right, because the relay's failures are fully explained by its own calls. That is the
asymmetry the pass was built to read, and it is real: 58 of the 58 convert.

## 3. Why no threshold, weight or reading rescues it

The two signatures are **identical** on the channel:

| | entry-point fault | stress downstream |
| --- | --- | --- |
| rank-1 node's `knownIn` | 439 (fails) | 57 (fails) |
| rank-1 node's `knownOut` | 0 | **0** |
| rank-1 node's residual share | 1.00 | **1.00** |
| ground truth present in the ledger | yes (it *is* the rank-1 node) | **no** |

A monotone credit cannot separate them (same sign, same share). A threshold cannot (same 1.00). A choice of
reading (`shape` vs `counts`) cannot (no novel rises in either). And the difference that *does* separate them —
whether the truth is in the ledger — is not a function of the case: it is a function of **which fault family the
case belongs to**, which is the label.

That is the closure, stated as a property rather than as a measurement:

> On this corpus the failure channel is a statement about **which interface failed**, not about **which service
> caused it**. In the four families where the fault does not fail a call at its own site, the causal service is
> absent from the channel entirely; in the families where it does, the causal service is present. The channel
> therefore carries the label, not a feature of the case — and any rule that promotes ledger members over
> non-members is trading one family's gain for another family's loss at a rate the corpus fixes in advance.

## 4. What is left to try: REACH, not membership

The one thing the read does *not* close is the shipped pass's own restriction. `applyFailureContainment` is
stated over **neighbouring positions**: a caller is inverted with its callee only when the fusion placed them
next to each other. The correct inversions the 313 arm found are mostly pairs the fusion placed apart (the truth
at 37 or 43, its caller at 1). Adjacency is a property of the *fusion's order*; the failing edge is a property of
the *case*, and the rule needs only the second.

So iteration 314 keeps the rule and widens the population of pairs it may compare — **a caller/callee pair on a
failing edge, at any distance** — which cannot demote a candidate no edge relates, and therefore cannot repeat
the 242 losses by construction. Two states, because there is a second restriction that is not obviously safe:

| state | pairs it may compare | why it exists |
| --- | --- | --- |
| `adjacent` | neighbours only | the traversal every number published before this iteration was measured on |
| `global` | any pair on a failing edge | adjacency is the fusion's property, not the case's |
| `global-measured` | as `global`, both sides measured | `unexplainedFailures(undefined) = 0` reads an **unmeasured** candidate as a fully explained one, so the unguarded rule can demote a node it has no evidence about |

The guard is not invented here: the latency pass in the same class already refuses pairs on exactly this ground
("an unmeasured candidate read as a measured zero would invert on evidence nobody collected"), and §2.1 is that
defect made visible — the truth in a stress case *is* the unmeasured candidate.

**Bar**, fixed before the run: `Top@1 > 1 156`, no fault type below its control cell, and `JVMMemoryStress`,
`ContainerKill`, `PodFailure` and `PodKill` at their control counts (the four the axis has cost twice).

## 5. What the reach measured

| arm | `Top@1` | `Top@3` | `Top@5` | gained | lost |
| --- | ---: | ---: | ---: | ---: | ---: |
| control (`adjacent`) | 1 156 | 1 228 | 1 249 | — | — |
| `global` | **1 186** | **1 236** | **1 255** | 30 | **0** |
| `global-measured` | **1 186** | **1 236** | **1 255** | 30 | **0** |

**Thirty gained, none lost, and no fault type below its control cell** — the bar is met by the strictest of its
four conditions, because a rule that only compares pairs a failing edge relates cannot demote a candidate no edge
relates.

| fault type | Δ `Top@1` |
| --- | ---: |
| `NetworkBandwidth` | **+7** |
| `HTTPRequestReplaceMethod` | **+7** |
| `NetworkPartition` | **+5** |
| `JVMException` | +3 |
| `HTTPResponseReplaceCode` | +2 |
| `HTTPResponseReplaceBody` | +2 |
| `NetworkLoss` | +2 |
| `HTTPResponseDelay` | +2 |
| the other thirteen types | **0** |

The movement is the shape the mechanism predicts. **Thirty cases reached rank 1**: 21 from rank 3, one from rank 2,
four from rank 4, and four from ranks 7, 29, 31 and 41. Twenty-eight more changed rank without reaching first
place: six rose into the top ten from as deep as rank 41, and **two fell**, 2 → 4 and 3 → 4, so `Top@3` gains 10 and
loses 2 on the way to its net +8 while `Top@5` gains 6. **The rule is not monotone at every position**, and the
two demotions are the honest part of this table: an inversion that is right about a pair can still be wrong about
the case, and the bar was set on `Top@1` — where no case lost ground — rather than on a profile nobody stated.

**The two wide states are byte-identical over 1 422 cases**, so the evidence guard costs nothing here. It is still
the state that the flag names when it is passed: §2.1 is the defect it refuses, and a future corpus that *does*
record a failed call at a stress-injected service would meet it on the first case.

## 6. What ships, and the half it now has been measured on

**Two numbers, one flag, one owner.**

| where | configuration | `Top@1` | how it is stated |
| --- | --- | ---: | --- |
| FSE'26 dispatch (the published RCABench cell) | `global-measured` | **1 186 (83.40 %)** | stated on the command line in `.github/workflows/fse26-benchmark.yml`, printed on every artifact |
| engine default, anything that does not ask | `adjacent` | **1 156 (81.29 %)** | `DEFAULT_FAILURE_CONTAINMENT_SCOPE`, one constant, one owner |
| RCAEval dispatch | `adjacent` (it does not pass the flag) | 666/735 (90.61 %) | measured identical under both, below |

The FSE'26 dispatch **states** the arm rather than defaulting it, and that is the whole release surface: no
runner-side constant exists (`packages/kinetic/__tests__/unit/ranking-default-owners.test.ts` forbids one, and the
first draft of the CLI was refused by it), and `ranking_knobs` is at its input budget, so a dispatch cannot select
a scope — it runs the one scope it names. Because the flag is passed, `formatFSE26ConfigLine` prints
`failureContainmentScope=global-measured` and the arm cannot travel unlabelled.

**The golden half has now been measured, and it is identical.** The measurement cost nothing and was not planned:
the Benchmark run dispatched on `accc80d` built a tree whose engine default *was* `global-measured`, so its six
RCAEval artifacts are the wide reach's reading on the golden half, and the run dispatched on `f48b3de` — a tree with
no scope option at all — is the control.

| protocol | control (`f48b3de`, run `44510333154`) | wide (`accc80d`, run `44526586296`) | differing lines |
| --- | ---: | ---: | ---: |
| RE1, inject-time | 92.0 % | 92.0 % | 1 (`Total duration`) |
| RE2, inject-time | 92.2 % | 92.2 % | 1 (`Total duration`) |
| RE3, inject-time | 80.0 % | 80.0 % | 1 (`Total duration`) |
| RE1, no inject-time | 86.1 % | 86.1 % | 1 (`Total duration`) |
| RE2, no inject-time | 87.8 % | 87.8 % | 1 (`Total duration`) |
| RE3, no inject-time | 63.3 % | 63.3 % | 1 (`Total duration`) |
| RE3, novelty signal | 63.3 % | 63.3 % | 1 (`Total duration`) |

**735 cases × six protocols, and the only byte that differs in any of the six artifacts is the wall clock.** So the
sentence this section carried one revision ago — *"the RCAEval cells are not measured under the wide reach"* — is
retired by a measurement rather than by an argument: the pass is built and live on that half (the correction recorded
below stands), and on this corpus it produces the same ranking as the neighbour-only rule, case for case.

**The shipped cell was re-verified after the refactor, not assumed.** The same commit that added the three scopes
split `applyFailureContainment` into `invertAdjacent` and `liftCallers`. A no-flag run of the 1 422-case archive
reproduces the iteration-313 control **case for case** — 1 422 of 1 422 per-case rows identical, `Top@1` 1 156, and
the flagged run reproduces the arm **case for case** as well (1 186, `Top@3` 1 236, `Top@5` 1 255, 0 of 1 422 rows
differing from the pre-refactor arm). The split is therefore a refactor in the strict sense.

**And the golden half was re-read a third time on the commit that ships this**, for the same reason: the Benchmark
run on that commit (`3742e97`, run `44553978275`) reads RE1 92.0 %, RE2 92.2 %, RE3 80.0 % — 666/735, the published
90.61 % — with **zero non-timing differences** against the `f48b3de` control. Three trees, three release surfaces,
one set of golden cells.

Two drafts of this section were wrong before it, and both are kept because both errors are one command away:

> **Error 1 — "the golden half is inert by construction".** The claim was that the RCAEval cells carry no per-call
> failure column. `run-rcaeval.ts` attaches `failedTraceEdges` from a **streaming pass over `traces.csv`**, so the
> failure flow IS built on that half and the pass IS live there. The claim was false, it was checkable in one
> `grep`, and acting on it would have shipped an unmeasured change to half of the published record.
>
> **Error 2 — "so the runner's default can move".** `packages/kinetic/__tests__/unit/ranking-default-owners.test.ts`
> holds that an option has **one** default and the engine owns it: a runner that declares its own copy fails
> "declares every shared default by NAME rather than repeating it". The first draft of the CLI added
> `DEFAULT_FSE26_FAILURE_CONTAINMENT_SCOPE` to `benchmarks/src/fse26-cli.ts` and the census refused it. The
> refusal is right for a reason beyond style: a second copy publishes the arm's number under a name its owner does
> not hold, and no reader of the artifact can tell afterwards.

Consequences, stated rather than implied:

1. **The published FSE'26 cell moves to 1 186 (83.40 %)** because its dispatch states the flag, and the artifact
   prints the token. A run that does not pass it reads 1 156 and says nothing about the reach — which is exactly
   one number, not two under one name.
2. **The RCAEval cells do not move**, and this is now a measurement rather than a caution: identical outcomes on 735
   cases over six protocols. Their runner does not pass the flag, so they read `adjacent`, and the two states agree
   there anyway.
3. **The configuration line renders the reach CONDITIONALLY**, on the rule every other non-boolean field follows: it
   appears only when the effective value deviates from `DEFAULT_FAILURE_CONTAINMENT_SCOPE`. With the default
   unchanged, "absent" names exactly one population (1 156) and 1 186 always carries its token.
4. **Any published ablation row whose `failureContainment` pole was `1`** was measured with the narrow traversal and
   is still the `adjacent` reading. Re-running such a row with the flag measures a different pass and must carry it.
   The ablation battery builds its options in code from the engine defaults, so it is the `adjacent` pole; the
   headline cell is the dispatch's, and the two are labelled differently on purpose.


