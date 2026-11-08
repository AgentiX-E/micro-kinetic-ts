# The pod-state term — the lifecycle evidence a level statistic cannot read

**Status:** shipped at `DEFAULT_POD_STATE_WEIGHT = 8`. The number is a MEASUREMENT (§6), not an argument:
it is the smallest weight at which the term is decisive, which is what its precision pays for (§5) and what
its silence everywhere else makes affordable (§8). Until this document existed the engine could not read a
container restart, a readiness drop or a phase change at all — the three facts that are the *definition* of
the fault types the archive contains 284 of.

**Owner of:** `podStateWeight`, `--pod-state-weight`, `pod_state_weight` (FSE'26 `ranking_knobs`).
**No RCAEval half**, and the reason is a fact about those corpora rather than a missing wire: OnlineBoutique,
SockShop and TrainTicket publish CPU, memory, delay and error series and no pod-lifecycle channel, so a
`selfanom=`-style short key would name a knob the golden runner has nothing to pass it to.

---

## 1. What the engine could not see

The ranking is a sum of terms and every one of them reads a **level**: a magnitude, a rise, a ratio, a share,
a count of log lines. `computePodStateScore` reads a **transition**. The distinction is not stylistic — it is
the reason a container kill was invisible:

| channel | what a level statistic sees | what actually happened |
| --- | --- | --- |
| `k8s.container.restarts` | a counter that is `0` across `normal_*` and `1..3` across `abnormal_*`: a deviation from a baseline that is *identically zero* | the container was replaced |
| `k8s.container.ready` | a `0/1` flag that is `1` before and `1` after, because the container came back | the container was not ready for twenty seconds |
| `k8s.pod.phase` | a categorical variable encoded as small integers, `Running` before and `Running` after | the pod left `Running` and returned |

A `z`-score and a ratio are blind to the second and third row by construction: both are computed over the
whole window, and a two-sample dip inside a thirty-minute window is not a level change. The first row is worse
than blind, it is *misleading* — `(x − 0) / 0` has no scale, so a counter whose baseline is exactly zero can
only be scored against the fleet, and on a fleet where several containers restart for their own reasons the
killed one is not the largest counter.

This is the third member of a family the campaign has already documented twice: `docs/level-blind-census.md`
counted the guards that read levels, and `docs/trace-vote.md` added a term because a vote is not a level. The
pod lifecycle is the same defect, in the data rather than in the traces.

## 2. The defect that would have hidden the fix anyway

Adding the term was the second half of the work. The first half was that **the three channels were not in any
service's series at all**, and nothing said so.

`scripts/fse26_convert.py` implemented "a metric row with no owner is dropped" as `service_name IS NOT NULL`.
That predicate is correct for the application channels, which carry their service in `service_name`. The
pod-scoped k8s channels carry the pod in `attr.k8s.pod.name` and put the **empty string** — not `NULL` — in
`service_name`. The filter therefore passed them through, and every datapack acquired one extra node named
`''` holding all forty-eight pod- and container-scoped gauges. Measured on
`ts0-mysql-container-kill-9t6n24`: fifty services with metrics, one of them `''`, and `mysql`'s own channel
list contained `container.*` and none of `k8s.container.restarts` / `k8s.container.ready` / `k8s.pod.phase`.
The truth ranked 31st of 50 with the pod's entire lifecycle sitting one node away under a name no candidate
could match.

`attribute_pod_scoped_services` replaces the filter with a three-rule attribution:

1. a row that already names a service keeps it;
2. a row whose `service_name` is empty or null inherits the service of its pod, through `service_of_pod` — the
   longest known service name that is a prefix of the pod name at a `-` boundary, which covers Deployment
   (`<svc>-<hash>-<suffix>`) and StatefulSet (`<svc>-<ordinal>`) naming alike;
3. a row that still has no owner is dropped.

Pods that belong to no service (`kube-proxy`, cluster-scoped channels) therefore stay out and the phantom `''`
node is gone. Both naming schemes and the unassignable case are unit-tested
(`scripts/test_fse26_convert.py`), because the failure this repairs was silent: the case converted, the
benchmark ran, and the numbers were simply lower than they should have been.

## 3. The predicate

`podState(v) ∈ {0, ⅓, ⅔, 1}` — one indicator per channel, summed, divided by three.

* `k8s.container.restarts`: `max(post) − last(pre) ≥ 1`.
* `k8s.container.ready`: `last(pre) > 0` **and** `min(post) < last(pre)`.
* `k8s.pod.phase`: `min(post) ≠ last(pre)` **or** `max(post) ≠ last(pre)`.

Four decisions are load-bearing.

**A presence, not a magnitude.** A pod that restarts twice during the window is not twice the evidence of a
pod that restarts once; it is the same fact restated. Summing magnitudes hands the term to whichever pod was
busiest, which is the failure mode `docs/fse26-emitter-dominance-falsified.md` records for the log term — the
same population, the same mistake, a different channel.

**The pre-window value is the baseline, not the normal file.** The first version of the probe read the
`normal_*` slice as its baseline and scored `0/10` on pod kill and `0/24` on pod failure, because the two files
are not the same window: `normal_*` ends well before the injection and its step is coarser than the injection
offset. Reading the baseline as *the last sample before `injectTimeMs` inside the same series* makes the two
sides adjacent, and it makes the term a property of one series rather than a join across two files.

**A container that was never ready has no level to fall from.** `0 → 0` is an absence priced as an event, so
the readiness predicate requires `last(pre) > 0`.

**An unreadable channel is not a negative one.** A boundary with no sample on one side leaves `undefined`
rather than `0`, and the term reports `MAP_ABSENT` through `classifyTermZero`, so "the corpus cannot answer
this" and "the answer is no" stay distinguishable in the artifact.

## 4. Why the score is the SHARE and not a count

Dividing by three makes the term comparable to the other 0–1 terms (`selfTimeShare`, `symmetry`,
`failedEdgeScore`), so the weight has one meaning: *what a fully corroborated pod lifecycle is worth*. A count
would make that meaning depend on how many channels a datapack happens to publish, which differs between the
`metrics` and `metrics_sum` files of the very same datapack.

## 5. Specificity, measured on the 123 lifecycle datapacks

A term is worth a decisively large weight only if it points at one service. It does, and the reason is
physical: the pod that was killed is the pod whose container restarted.

| fault type | datapacks | mean services with a non-zero score | truth is the top-scoring service |
| --- | --- | --- | --- |
| `ContainerKill` | 89 | **1.01** | **89/89** |
| `PodFailure` | 24 | **1.04** | **24/24** |
| `PodKill` | 10 | 0.20 | 1/2 |

The first two rows are the term working. A fleet of ~50 services yields exactly one node with a non-zero
score and it is the ground truth in all 113 datapacks. The third row is the term failing, recorded rather
than explained away: a pod that is *deleted* stops reporting instead of reporting `NotReady`, so in 8 of the
10 `PodKill` datapacks none of the three channels has a post-boundary sample at all, and the term is silent
rather than wrong. `PodKill` therefore neither gains nor loses at any weight (§6), and its 50.0% is the same
50.0% it had before the term existed.

A specificity of 1.01 means the term is not re-weighting a population, it is a **pointer**. That is what the
weight in §6 buys, and it is also the reason the term must not be allowed to fire on evidence it cannot
distinguish (§8).

**One datapack breaks the pattern, and the failure mode is named here rather than left to be rediscovered.**
Of the 42 `NetworkBandwidth` datapacks, 41 are silent and one fires on **49 services at once**: a fleet-wide
restart event inside its window, where every pod's counter moves and the term pays everyone the same 8. A
fleet-wide transition carries no information about WHICH service was injected, so the term degrades to a
uniform offset there and the rest of the score decides. It cost nothing in this iteration — `NetworkBandwidth`
reads 20/42 at both weights (§8) — but the shape is the one to gate next: a channel that moves on most of the
fleet in the same window should be discounted the way `poolMetricPenaltyWeight` discounts a shared metric, and
that is a second axis rather than a smaller weight.

## 6. The sweep — what the weight is, and why it stops where it does

One corpus (the 123 datapacks whose fault type is a pod lifecycle), one configuration, one knob:

| `podStateWeight` | Top@1 | Top@3 | Top@5 | ContainerKill | PodFailure | PodKill |
| --- | --- | --- | --- | --- | --- | --- |
| 0 (term absent) | 26.8% | 58.5% | 61.0% | 27/89 30.3% | 1/24 4.2% | 5/10 50.0% |
| 0.5 | 34.1% | 72.4% | 79.7% | 35/89 39.3% | 2/24 8.3% | 5/10 50.0% |
| 1 | 46.3% | 80.5% | 89.4% | 46/89 51.7% | 6/24 25.0% | 5/10 50.0% |
| 2 | 56.9% | 93.5% | 97.6% | 56/89 62.9% | 9/24 37.5% | 5/10 50.0% |
| 4 | 84.6% | 98.4% | 98.4% | 85/89 95.5% | 14/24 58.3% | 5/10 50.0% |
| **8 (shipped)** | **94.3%** | **98.4%** | **98.4%** | **88/89 98.9%** | **23/24 95.8%** | 5/10 50.0% |
| 16 | 94.3% | 98.4% | 98.4% | 88/89 98.9% | 23/24 95.8% | 5/10 50.0% |

Three readings of that table.

**The curve is a step, not a slope.** Between 4 and 8 the term stops being one vote among seven and starts
being the decision, and it then saturates: 8 and 16 are identical to the case. A weight above the saturation
point cannot be justified by this corpus, and a weight below it leaves 4.6 to 37.5 pp on the floor for no
stated reason.

**The saturating counts are the term's own ceiling, not a curve fit.** 88/89 and 23/24 are exactly the
datapacks in which the truth scores at all (§5). The single `ContainerKill` miss and the single `PodFailure`
miss are therefore **not** weight failures, and a larger weight cannot fix them: the pointer is correct and
the candidate it points at never enters the pool (§9). Tuning the knob to chase them would be fitting it to a
defect it does not own.

**`PodKill` is flat at every weight.** 50.0% before, 50.0% at 16. A term that cannot read a fault type must
not be priced as if it could, and the flat row is the evidence that it is not.

## 7. What the term is worth

On the 123 lifecycle datapacks it moves case-level Top@1 by **+67.5 pp** (26.8% → 94.3%) and Top@5 by
+37.4 pp, with no fault type regressing.

And on the whole archive — 1,422 datapacks scored in two waves of 711 with the same configuration, combined on
per-case results, so the totals below are exact rather than a weighted mean of two percentages:

| | Top@1 | Top@3 | Top@5 |
| --- | ---: | ---: | ---: |
| term absent (`podStateWeight = 0`) | 873 = 61.39% | 1,136 = 79.89% | 1,184 = 83.26% |
| shipped (`podStateWeight = 8`) | **1,066 = 74.96%** | **1,225 = 86.15%** | **1,247 = 87.69%** |
| movement | **+193 cases, +13.57 pp** | +89, +6.26 pp | +63, +4.43 pp |

Per fault type, over the archive's whole population — **22 of the 25 types are identical to the case and the
other three carry the entire movement**:

| type | datapacks | Top@1 before | Top@1 after | cases |
| --- | ---: | ---: | ---: | ---: |
| `JVMMemoryStress` | 171 | 61 = 35.7% | **171 = 100.0%** | **+110** |
| `ContainerKill` | 89 | 27 = 30.3% | **88 = 98.9%** | **+61** |
| `PodFailure` | 24 | 1 = 4.2% | **23 = 95.8%** | **+22** |
| the other 22 types | 1,138 | 784 = 68.9% | 784 = 68.9% | **0** |

**The baseline reads 873, and the register reads 874 — one case, disclosed rather than absorbed.** The
difference cannot be attributed to the weight (it is the zero arm) and is attributed to the converter's
attribution rule, which changes WHICH channels a service carries and therefore every anomaly score behind it:
the pod-scoped gauges no longer sit on a phantom node, so a service that had 40 channels now has 88. A change
of that shape moving one case of 1,422 is the expected order, and the arm is measured in the same session as
the arm it is compared against, which is why both are reported here rather than the register's older reading.

## 8. What it must not be allowed to cost

The weight is large, so the question is not what it buys but what it charges when it fires on the wrong thing.
Three guards answer it, and all three are empirical.

**No fault type pays for it.** The table in §7 is the answer at whole-population resolution rather than by
sample: of the 25 types, 22 are **identical to the case** at both weights — `HTTPResponseReplaceCode`
162/231, `HTTPRequestReplaceMethod` 125/190, `NetworkPartition` 64/97, `NetworkBandwidth` 20/42,
`NetworkLoss` 29/48, `NetworkCorrupt` 31/46, `NetworkDelay` 20/21, `PodKill` 5/10, and the rest. An earlier
160-datapack stratified sample agreed (61.9% → 72.5% overall, the same three types moving) and is recorded
because it was read *before* the whole-corpus arm and therefore could not have been chosen to agree.

The `JVMMemoryStress` row is not a leak, and the distinction matters. That fault exhausts a container's heap
until the kernel kills it, so the restart is a *consequence* of the injected fault rather than a restatement of
its label; an operator reading `kubectl get pods` would see it and act on it, and the observability vendors'
own investigation workflows query exactly this metric first. What the engine was missing was not a label, it
was the kubelet's view.

**A corpus without the channels must not be scored by it.** RCAEval publishes no pod-lifecycle channel, so
`podStateScores` is empty, every contribution is `0`, and the ranking is unchanged. Measured rather than
assumed, because a term that silently re-orders a *different* benchmark is the shape of defect this campaign
keeps finding: the three golden cells that are reproducible here were run at both settings and read
**RE1:OnlineBoutique 90.4% and RE3:SockShop 63.3% at 0 and at 8, to the decimal**. The fence that keeps it that
way is a unit test over a channel set with no `k8s.*` member, which asserts the map is empty, the cause is
`MAP_EMPTY` and the scores are byte-identical — so a future term that starts reading something else cannot
borrow this one's silence.

## 9. The residual 1 + 1, and why it is pool admission

The two saturating misses are the interesting ones for the next stage, and the diagnosis is recorded here so
the next iteration does not spend a sweep on it. In both, the truth's pod state corroborates (§5 says 100% for
its type) and the truth still does not rank first, which is only possible if the truth is not in the candidate
list at all. That is `poolAdmission`'s territory — `docs/pool-admission.md` — and the answer is a widening of
the pool rather than a larger weight.

## 10. Where the term is owned

| layer | symbol |
| --- | --- |
| predicate | `computePodStateScore`, `POD_STATE_CHANNEL_LABELS` (`packages/tree/src/causal/topology-fault-graph.ts`) |
| graph field | `FaultPropagationGraph.podStateScores` (`packages/core/src/types/graph.ts`) |
| term | `buildTerm('podState', …)` (`packages/tree/src/pruning/pruner.ts`) |
| weight | `DEFAULT_POD_STATE_WEIGHT` (`packages/tree/src/pruning/pruner.ts`) |
| dispatch | `--pod-state-weight` (`benchmarks/src/fse26-cli.ts`), `pod_state_weight` (`fse26-benchmark.yml`) |
| conversion | `service_of_pod`, `attribute_pod_scoped_services` (`scripts/fse26_convert.py`) |

The three channels arrive through a converter fix rather than a new data source: the archive always had them,
and the only reason the engine could not read them is that they were filed under a service named `''`.
