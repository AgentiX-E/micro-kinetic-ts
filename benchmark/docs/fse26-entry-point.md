# FSE'26 entry point — 58 % of the remaining error is one service

**Status:** measured 2026-11-19 (iteration 311) on the RCABench archive, 1 422 cases, `$0`, no model call.
**Instrument:** `--diagnose HTTPResponseReplaceCode,HTTPRequestReplaceMethod --diagnose-limit 0`, i.e. all 421 cases
of both types dumped rather than a sample, 100 MB of per-service lines.
**Pre-registration:** `docs-repository:preregistration-311.md` — written before the dump existed.
**Knobs:** none. This iteration changes no engine code.

---

## 1. Why this audit existed

Iteration 310 closed the `poolAdmission` axis and, in closing it, printed the number that re-pointed the programme:
the published cell's remaining Top@1 misses are `1 422 − 1 156 = 266`, and **111 of them are two fault types**,
`HTTPResponseReplaceCode` (60 of 231) and `HTTPRequestReplaceMethod` (51 of 190). Five iterations had been spent on
an axis worth 55 cases net. The class twice that size had never been audited as a class — three arms had been aimed
at it on a guess about the mechanism, and two of them worked, which is what made a fourth guess indefensible.

## 2. The one reading that has to be stated first

The dump was taken **without `--fault-free-profile`**, so the run reads **1 141**, not the published **1 156**. That
is the first of the three failure modes `docs-repository:preregistration-311.md` §5 named, it is a defect of the dispatch rather
than of the read, and its size is measurable rather than arguable: 18 of 1 422 cases carry a different `truthRank`,
and **2 of them are in this population** — both `HTTPRequestReplaceMethod`, both `1 → 2`, both in the class this
document calls H2. Every figure below is reported on the audit population and corrected to the published one in the
same row, so no reader has to reconstruct which population a number came from.

## 3. The classification, against the four registered hypotheses

| class | audit (113) | published (111) | share | definition applied |
| --- | ---: | ---: | ---: | --- |
| **H1** absent | **0** | **0** | 0 % | truth's `selfAnomaly = 0` (or off-graph) |
| **H2** outranked by a caller | 15 | **13** | 11.7 % | winner is a **caller** of the truth, read off the case's own edge list |
| **H3** in-band | 8 | **8** | 7.2 % | truth has a real anomaly and sits at rank ≤ 5 |
| **H5** the class with no slot | 90 | **90** | 81.1 % | truth has a real anomaly, winner is not its caller, rank 6–45 |
| **H4** instrument | **0** | **0** | 0 % | truth off-graph or unresolvable |

Two of the four hypotheses die outright and they are the two that would have been cheapest to act on:

- **H1 is empty.** In all 421 dumped cases the truth carries a nonzero `selfAnomaly`. The sentence a coefficient
  argument would have needed — "no metric moves, so add an observable" — is **false** on this corpus.
- **H4 is empty.** Every truth resolved to a node in the graph, in every case of both types.

**H5 is the fifth class, and it was not registered.** `docs-repository:preregistration-311.md` offered four mechanisms and the read
produced a fifth: the truth has a real deviation, the winner is not above it in the call tree, and it sits **20–45
places down** (median 35 of 50). §6 records the defect rather than smoothing it over.

## 4. The finding: it is not a fault class at all, it is one service

Grouping by the **truth service** over the whole published corpus — the per-case artifact, all 1 422 cases, not the
dump's 421 — gives the table that decides where the next arm goes:

| truth service | cases | Top@1 | rate |
| --- | ---: | ---: | ---: |
| **ts-ui-dashboard** | **165** | **10** | **6.1 %** |
| ts-price-service | 8 | 6 | 75.0 % |
| ts-station-service | 22 | 17 | 77.3 % |
| ts-assurance-service | 19 | 15 | 78.9 % |
| mysql | 73 | 60 | 82.2 % |
| ts-consign-service | 30 | 25 | 83.3 % |
| ts-seat-service | 79 | 67 | 84.8 % |
| ts-order-other-service | 27 | 23 | 85.2 % |
| ts-config-service | 14 | 12 | 85.7 % |
| ts-travel-service | 94 | 81 | 86.2 % |
| ts-order-service | 45 | 39 | 86.7 % |
| ts-contacts-service | 16 | 14 | 87.5 % |
| ts-train-service | 18 | 16 | 88.9 % |
| ts-train-food-service | 9 | 8 | 88.9 % |
| ts-route-service | 25 | 23 | 92.0 % |
| ts-auth-service | 27 | 25 | 92.6 % |
| ts-basic-service | 202 | 188 | 93.1 % |
| ts-route-plan-service | 139 | 132 | 95.0 % |
| ts-preserve-service | 96 | 92 | 95.8 % |
| ts-security-service | 33 | 32 | 97.0 % |
| ts-travel-plan-service | 74 | 72 | 97.3 % |
| ts-food-service | 55 | 54 | 98.2 % |
| ts-inside-payment-service / ts-user-service / ts-payment-service / ts-consign-price-service / ts-station-food-service / ts-verification-code-service | 12 / 16 / 12 / 9 / 9 / 4 | all | **100 %** |
| ts-cancel-service | 4 | 2 | 50.0 % (n = 4) |
| **corpus** | **1 422** | **1 156** | **81.3 %** |

**`ts-ui-dashboard` — the request entry point — is 6.1 % against 81.3 %, and it holds 155 of the 266 misses: 58 % of
all remaining error in one node.** Twenty-four of the thirty services sit between 75 % and 100 %. There is no second
outlier: the next-worst service with a population worth quoting is `ts-price-service` at 8 cases.

The pattern is not a fault type. Within the dashboard's own 165 cases the misses are spread across every family it
carries — `response-replace-code` 57 of 58, `request-replace-method` 39 of 39, `response-delay` 15 of 18,
`request-delay` 15 of 16, `request-abort` 10 of 10, `partition` 8 of 9, `loss` 5 of 7, `response-abort` 4 of 4,
`corrupt` 2 of 3, `bandwidth` 0 of 1 — i.e. **the ten it answers are not a family, they are ten individual cases**,
and no family is above 17 %. The two fault types this iteration was dispatched to audit were a **proxy** for the
service, and the proxy is what made the class look like a mechanism.

## 5. What the entry point looks like inside the winning configuration

One case, `ts0-ts-ui-dashboard-request-replace-method-2lnwn5`, read off the dump:

| node | rank | selfAnomaly | decisive metric | onset |
| --- | ---: | ---: | --- | ---: |
| `ts-ui-dashboard` (**truth**) | **18** | 0.673 | `http.server.request.duration = 1.020` (`dev` 0.517) | **0** |
| `ts-verification-code-service` (winner) | 1 | 0.898 | `container.cpu.usage = 1.240` (`dev` 0.958) | 22 007 |

The entry point **is** the earliest node in the case — its onset is the injection instant — and it still ranks
eighteenth, because its own deviation (1.020) is smaller than eighteen downstream nodes' JVM and CPU deviations
(1.7–2.5). That is not a mis-ordered tie. It is the metric layer correctly reporting that a proxy pass-through is
less anomalous than the services whose CPU it just drove up, and it is why no coefficient on this configuration
recovers the case.

## 6. The registered prior that cannot act, and the arithmetic that says so

The obvious correction is the engine's own onset prior (`temporalWeight`, `onsetShape: 'earliness'`), and it was
already measured and closed on this corpus: **no admissible weight on either shape**, `earliness` gaining 0 over
`[0, 0.005361]`, capped by one case whose lead is `0.010050` — the metric term's own top step. This audit supplies
the population that explains *why* that interval is so narrow, and it points the other way:

| reading | count |
| --- | ---: |
| misses whose truth has an **earlier onset** than the winner | **80 of 111** |
| … restricted to H5 | **67 of 90** |
| misses whose winner has the earlier onset | 20 |
| ties / onset absent | 3 / 10 |

The signal is right on 72 % of the class and the axis is closed anyway, because the class sits 18–45 metric ranks
down: a metric gap of ≈ `0.18–0.45` in log space against a term whose admissible contribution is `≤ 0.005`. **A
tie-break cannot close a thirty-rank gap**, which is the general form of the reason the onset axis closed: an
additive term bounded by the admissible interval can only reorder inside one step, and this class is thirty steps
down.

## 7. What this licenses, and what it refuses

**Refused by the record:** every form of "make the entry point's own numbers louder". The onset prior cannot reach
it (this document's §6), the log term is silent on both sides of these cases, the failed-edge direction term already
credits the callee of failed calls and is worth +41 with zero regressed types — it is *the* term that reads the
right edge for this class and it is already shipped, and the dispersion residual is refused at −411.

**Licensed, and it is a prior rather than a term:** the engine has no concept of a **request root**. `ts-ui-dashboard`
is the unique callee of `loadgenerator` in every case of this corpus — a structural fact about the graph, not a
service name — and the shipped scoring has nothing that treats "this node is where requests enter" as evidence.
`failedEdgeScore` credits it on the right edge and pays it `1.000` on the case above; so does the winner. The
crediting is there; the *plausibility* is not.

The arm to pre-register is therefore: **a request-root prior — an additive credit to the node with no measured
inbound edge other than the synthetic load source, gated on that node's own deviation being nonzero** — and its
acceptance condition is the standing one (beat 1 156 with no fault type below its published cell), which on this
population means it has to win ≥ 60 of the 155 while losing essentially none of the 1 257. That gate is the whole
risk and it is stated here rather than discovered later: the prior promotes a node in *every* case, and in 1 257
cases the root is not the truth.

## 8. What this document does not claim

- It does not claim the dashboard cases are winnable. It claims they are **separable**: nonzero deviation, earliest
  onset, structural root, and — from `failed-edge-evidence-gate.md` §2 — a status-code channel present on 100 % of
  spans. Four independent readings agree on the same node.
- It does not claim the corpus is mislabelled. The load generator is the traffic source, never the truth, and
  `ts-ui-dashboard` is the service the injected fault was applied to.
- It does not re-open the onset axis. §6 states the arithmetic that closed it.
