# The failed-edge partition — the mechanism is real, the membership is not specific

**Arm:** `failedEdgeFirst = true`, everything else shipped. **Control:** the same commit, no flag. **Corpus:**
1 422 RCABench cases, one run each, no model call, `$0`. **Verdict: refused — net −170**, with one family gaining
56 and three families paying 241 for it.

This document is the read. `docs-repository:preregistration-312.md` is the prior, and the two are compared
row by row in §5.

---

## 1. What was measured before the arm was built

Iteration 311 registered a prior on the request entry point (`docs-repository:preregistration-311.md` §10). Two readings on the
existing 421-case dump disposed of it without a run, and both are worth keeping because they are statements about
the corpus rather than about the arm.

### 1.1 "No measured inbound edge" names thirteen nodes, not one

| nodes matching the registered predicate | cases |
| --- | ---: |
| 12 | 1 |
| **13** | **127** |
| **14** | **286** |
| 15 | 7 |

`loadgenerator` and `ts-ui-dashboard` are joined by every `ts-admin-*`, `ts-*-delivery`, `ts-wait-order`,
`ts-consign` and `ts-execution-*` service: the graph is built from observed spans, so a node nothing in the trace
called has in-degree zero whether it is the front door or an admin endpoint nobody exercised.

The fact §10 asserted survives and is narrower than it read: `loadgenerator → ts-ui-dashboard` is the unique
out-edge of `loadgenerator` **and** the unique in-edge of the dashboard. That is a statement about one node, not a
predicate a run can apply to a case it has not seen.

### 1.2 The entry point's own evidence does not separate the two strata

Split the 421 cases by whether the entry point is the truth (97) or not (324):

| reading at `ts-ui-dashboard` | root is truth | root is not | AUC |
| --- | ---: | ---: | ---: |
| rank (median) | **34** | **29** | 0.601 |
| `selfAnomaly` (median) | **0.286** | **0.388** | **0.401** |
| onset, ms (median) | 10 850 | 13 848 | 0.474 |
| `failedEdge` | 1.000 (95/97) | 1.000 (97/324) | 0.848 |
| dominant is a transport channel | — | — | 0.488 |

`AUC = 0.401` means the entry point is **less** anomalous when it is the fault. Every monotone credit to it is a
credit in the wrong direction for 324 of the 421 cases it would act on, and the 97 it is meant to recover sit
*deeper* in the ranking than the 324.

The one reading that separates is `failedEdge` — because the entry point is the callee of the load source, so an
entry-point fault fails the load source's calls. §2 turns that into an arm.

---

## 2. The statistic, measured on the 421 cases

| quantity | value |
| --- | ---: |
| candidates the ledger credited | **1 372 of 20 632 (6.6 %)** |
| truths the ledger credited | **418 of 421 (99.3 %)** |
| precision of a credited candidate | 30.5 % |
| credited candidates per case | 1–8, median **3**, mean 3.26 |

And the partition read on the same dump, keeping the engine's own order inside each half:

| order | Top@1 on the 421 | share |
| --- | ---: | ---: |
| shipped | 308 | 73.2 % |
| **partitioned** | **365** | **86.7 %** |

The within-set ordering was checked against four alternatives before the score was trusted: `selfAnomaly` 200,
earliest onset 171, `logScore` 344, the ledger's own magnitude 298, **the score 365**.

---

## 3. The corpus reading

Same commit (`1496d28`), same corpus, same profile, one flag.

| arm | `Top@1` | `Top@3` | `Top@5` | lost | gained | net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| control | **1 156 (81.29 %)** | 1 228 | 1 249 | — | — | — |
| `failedEdgeFirst` | 986 (69.34 %) | 1 232 | 1 293 | **241** | **71** | **−170** |

`Top@3` and `Top@5` both RISE (+4 and +44 cases). The partition is doing exactly what it was built to do to the
*order* — it is moving a candidate to the front — and it is wrong about which candidate often enough to lose more
first places than it wins.

### 3.1 The per-type decomposition, and it is not a diffuse loss

| fault type | n | control | arm | Δ |
| --- | ---: | ---: | ---: | ---: |
| **`HTTPResponseReplaceCode`** | 231 | 171 | **227** | **+56** |
| `HTTPRequestReplaceMethod` | 190 | 139 | 138 | −1 |
| **`JVMMemoryStress`** | 171 | 171 | **26** | **−145** |
| **`ContainerKill`** | 89 | 89 | **23** | **−66** |
| `HTTPResponseDelay` | 89 | 68 | 71 | +3 |
| `HTTPRequestDelay` | 88 | 69 | 72 | +3 |
| `HTTPRequestAbort` | 60 | 49 | 50 | +1 |
| **`PodFailure`** | 24 | 24 | **4** | **−20** |
| `JVMException` | 43 | 32 | 35 | +3 |
| `NetworkBandwidth` | 42 | 23 | 24 | +1 |
| **`PodKill`** | 10 | 10 | **6** | **−4** |
| `JVMCPUStress` | 2 | 1 | 0 | −1 |
| the other 12 types | — | — | — | **0** |

**The gain is exactly the class the arm was aimed at, and it is almost exactly the size the 421-case read
predicted.** `HTTPResponseReplaceCode` is the family whose truth is the entry point in 58 of its 231 cases
(`docs/fse26-entry-point.md` §320.2), and +56 of those 58 are converted. The prediction said +40 or better; the
measurement says +56.

**The loss is three families, and they share one property: their fault does not fail a call at its own site.**
`JVMMemoryStress` (145 of 171 lost), `ContainerKill` (66 of 89), `PodFailure` (20 of 24) and `PodKill` (4 of 10)
are 235 of the 241 losses. In all four the injected fault is a *slowdown* or a *lifecycle event*: the faulted
service's own inbound calls mostly still SUCCEED (slowly, or after a restart), while the **load source's** calls
time out somewhere downstream.

### 3.2 Why the entry point is credited on a case it has nothing to do with

The ledger credits the CALLEE of a failed call. The entry point is the callee of `loadgenerator` — the one edge in
every case that is under load from outside the system. When a service deep in the graph is stressed, the load
source's request eventually times out, so `loadgenerator → ts-ui-dashboard` is a failed edge and the dashboard
takes the credit. **The root of the call graph is the first node to see anyone else's timeout.**

That is not a defect in the ledger; it is the ledger answering the question it was built to answer ("whose
interface did a call fail against"). It is a defect in the *partition*, which treated membership as evidence of
causation.

The rank movement says the same thing in one number: of the 241 lost cases, **93 fall from 1 to 2** and 48 from 1
to 3 — one or two credited nodes stepped over the truth. No case was deleted; the partition never removes a
candidate, which is why the loss is a displacement and `Top@5` rises while `Top@1` falls.

### 3.3 What this says about the shipped gate rather than about the arm

`failedEdgeWeight`'s gate (`admitsFailedEdgeTerm`) exists to stop exactly this: it asks whether the *champion's*
own dominant channel is a duration that rose, so a stress case cannot hand the top to a relay. `docs/
ablation-input-census.md` prices the term with the caveat "whose gate refuses almost every case here". This
iteration supplies the reason from the other direction: **the gate is refusing 235 cases it would be right to
refuse.** A looser gate would not be an improvement; it would be this arm.

---

## 4. What the failure rules out, stated as a property

| candidate mechanism | status after this read |
| --- | --- |
| credit the entry point additively | refused before implementation (§1.2: AUC 0.401, wrong sign) |
| rank the ledger's members first | **refused here (−170)** |
| a weaker form: rank only members whose credit is large | not measurable on this corpus — the sign of the failure is not the magnitude. `JVMMemoryStress`'s relay is credited 1.000 in the same way the true entry-point fault is |
| **rank members whose failures are NOT explained by their own outgoing failures** | **opened — §5** |

---

## 5. The four predictions, against the artifact

| # | pre-registered | outcome |
| --- | --- | --- |
| 1 | `Top@1 ≥ 1 196`, concentrated in the two audited types | **HALF**: +56 in `HTTPResponseReplaceCode` (predicted ≥ 40), −1 in `HTTPRequestReplaceMethod`, and the corpus is 986 — **falsified on the total** |
| 2 | at most two types decline, each by ≤ 5 | **FALSIFIED**, and by the largest margin of the four: three types lose more than 5, one of them 145 |
| 3 | `Top@5` gains less than `Top@1` | **FALSIFIED in the informative direction**: `Top@5` gains 44 while `Top@1` loses 170 — the partition improves reachability and destroys precision |
| 4 | cases with an empty ledger are byte-identical | **CONFIRMED where it is observable**: **1 056 of 1 422 cases did not move at all** (366 moved), and the twelve types the arm never touched carry 383 cases between them. A case with an empty ledger cannot move by construction; the 1 056 is the measured superset |

Prediction 2 is the one that was available before the run and was not taken: *"a type that loses more is a type
whose failures are reported nowhere"* was written as a guard, and the actual failure is the mirror image — a type
whose failures are reported **everywhere**, at the node every call passes through.

## 6. The successor arm, registered rather than described

The partition needs a *specificity* condition, and the engine already computes one: `unexplainedFailures(v) =
max(0, inbound(v) − outgoing(v))` over the failure flow, which is what `failureContainment` uses to decide whose
failure a rise is.

- **Entry point in an entry-point fault:** its inbound calls fail, its outbound calls succeed — residual > 0.
- **Entry point in a stress or kill downstream:** its inbound calls fail *and* its outbound calls to the faulted
  service fail — residual ≈ 0, because the failures it reports are the ones it received.

The arm is therefore: rank first the candidates whose **unexplained** failures are positive, keeping the shipped
order inside each half. Bar: beat 1 156 with no type below its published cell. This is a different statistic from
the one measured here, so it needs its own pre-registration and its own control — and the prediction it has to
survive is stated in advance: **it must keep at least 40 of the 56 `HTTPResponseReplaceCode` gains while
restoring `JVMMemoryStress` above 160.**
