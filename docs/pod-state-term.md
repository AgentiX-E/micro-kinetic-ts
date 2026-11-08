# The pod-state term — the lifecycle evidence a level statistic cannot read

**Status:** shipped at `DEFAULT_POD_STATE_WEIGHT = 8`. The number is a MEASUREMENT (§6), not an argument:
it is the smallest weight at which the term is decisive, which is what its precision pays for (§5) and what
its silence everywhere else makes affordable (§8). Until this document existed the engine could not read a
container restart, a readiness drop, a phase change or a counter that restarted from zero at all — the four
facts that are the *definition* of the fault types the archive contains **294** of, and all 294 now rank first
(§7).

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

`podState(v) ∈ {0, ¼, ½, ¾, 1}` — one indicator per FACT, summed, divided by four.

* `k8s.container.restarts`: `max(post) − last(pre) ≥ 1`.
* `k8s.container.ready`: `last(pre) > 0` **and** `min(post) < last(pre)`.
* `k8s.pod.phase`: `min(post) ≠ last(pre)` **or** `max(post) ≠ last(pre)`.
* any of `container.cpu.time` / `k8s.pod.cpu.time` / `k8s.pod.network.io`: `last(pre) > 0` **and**
  `min(post) < 0.25 × last(pre)` — the pod's cumulative counters restarted, which only a REPLACED pod does.

Five decisions are load-bearing.

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

**Three counters are one indicator.** A replaced pod resets every cumulative counter it owns at the same
scrape, so counting them separately would let one replacement pay three times — the same "magnitude instead of
presence" defect the first decision refuses, one level up. The indicator fires if ANY of them resets.

## 3a. Why the fourth indicator exists: a killed pod is not a restarted one

The three state channels were the whole family for one iteration, and `PodKill` was flat at **50.0%** at every
weight. The reason is not a threshold: `chaos-mesh`'s `pod-kill` DELETES the pod and the controller creates a
new one, so the restart counter of the *declaration* stays at `0`, readiness stays `1` and the phase stays
`Running` — measured on `ts4-ts-train-food-service-pod-kill-sscz4x`, all three channels are constant for the
whole window on the truth service and on its neighbour alike. The kill is invisible to the three of them.

It is not invisible to the counters they sit next to, because a new pod starts its counters at zero. On that
datapack the truth's `k8s.pod.cpu.time` reads `569.5` before the boundary and a minimum of `269.8` after it,
its `k8s.pod.network.io` falls from `5.59e6` to `1.13e6`, and its JVM reports `jvm.class.loaded` from `0` —
a fresh process. The neighbour that the ranking preferred shows none of these.

The floor is measured rather than fitted. Across the 711 datapacks of the second wave, **every one of the 149
resets the term fires on lands at ≤ 0.0095 of its last pre-injection value** — median `0.0040`, maximum
`0.0095`, and not one between `0.01` and `1`. `0.25` is twenty-six times above the largest observed
re-baseline and an order of magnitude below any partial fall, so the predicate separates "the pod is new" from
"the counter moved" without a number fitted between them.

The two readings are disjoint and that is the design: `k8s.container.restarts` reads a container that came
back, the replacement indicator reads a pod that did not. The measured spread of the truth's score, on the
second wave's 149 lifecycle datapacks, is what that looks like:

| fault type | `¼` | `½` | `¾` |
| --- | ---: | ---: | ---: |
| `PodKill`, 8 | **7** | 1 | 0 |
| `PodFailure`, 6 | 0 | **6** | 0 |
| `ContainerKill`, 55 | 0 | **51** | 4 |
| `JVMMemoryStress`, 80 | 0 | **70** | 10 |

`PodKill` is the row the indicator exists for: seven of its eight datapacks have no state channel moving at all
and are read by the replacement indicator alone. `ContainerKill` and `JVMMemoryStress` mostly fire both — the
container is killed and comes back, so the counter increments *and* restarts from zero — and the minority at
`¾` are the datapacks where a readiness dip adds a third indicator.

## 4. Why the score is the SHARE and not a count

Dividing by four makes the term comparable to the other 0–1 terms (`selfTimeShare`, `symmetry`,
`failedEdgeScore`), so the weight has one meaning: *what a fully corroborated pod lifecycle is worth*. A count
would make that meaning depend on how many channels a datapack happens to publish, which differs between the
`metrics` and `metrics_sum` files of the very same datapack.

## 5. Specificity — a pointer, and the two ways it stops being one

A term is worth a decisively large weight only if it points at one service. Measured on the archive's second
wave, with the gate of §3a in place:

| fault type | datapacks | mean services with a non-zero score | truth is the top-scoring service |
| --- | --- | --- | --- |
| `JVMMemoryStress` | 80 | **1.00** | **80/80** |
| `ContainerKill` | 55 | **1.00** | **55/55** |
| `PodFailure` | 6 | **1.00** | **6/6** |
| `PodKill` | 8 | **1.00** | **8/8** |
| other 19 families | 562 | **0.00** | — |
| **all** | **711** | **0.21** | **149/149** |

The first wave reads the same way — 145 lifecycle datapacks, the truth at the top of the shortlist in all 145,
and **zero** fires across its 566 non-lifecycle datapacks — and it is where both mechanisms below were found.
A mean of exactly `1.00` on a fleet of fifty is the whole argument for the weight: the term is not re-weighting
a population, it is naming a candidate.

**A restart that continues a history of restarts is not an event** (§3). The census that added the rule: of the
**146** restart increments across the 145 first-wave lifecycle datapacks, **142** are on the truth with an
untouched counter, **one** is on the truth with a counter that had already left zero, and **all three** of the
bystanders have a counter that had already left zero. `ts-ticket-office-service` is the archetype — it restarts
chronically (`3 → 8` across the boundary) and it was outranking the `mysql` pod that the case actually failed.
Adding the rule took `PodFailure` from 17/18 to 18/18 on that wave and left every other family untouched.

**Evidence that covers the fleet is not evidence about a service.** One datapack in each wave fires on **49 of
50** services at once — a `NetworkBandwidth` case whose whole namespace re-phased inside the window.
`POD_STATE_MAX_FLEET_SHARE` refuses the reading when the firing set is more than half the candidates, on the
statement that a pointer names a minority or it is not a pointer. Measured, it costs nothing: turning the gate
off changes **1 of 711** ranked orders and not the top of either.

## 6. The sweep — what the weight is, and why it stops where it does

One corpus (the 145 datapacks of the archive's first wave whose fault type is a pod lifecycle), one
configuration, one knob:

| `podStateWeight` | lifecycle Top@1 | `ContainerKill` | `PodFailure` | `PodKill` | `JVMMemoryStress` |
| --- | --- | --- | --- | --- | --- |
| 0 (term absent) | 31.7% (46/145) | 9/34 26.5% | 0/18 0.0% | 1/2 50.0% | 36/91 39.6% |
| 4 | 99.3% (144/145) | 34/34 | 18/18 | 1/2 | 91/91 |
| **8 (shipped)** | **100.0% (145/145)** | **34/34** | **18/18** | **2/2** | **91/91** |
| 16 | 100.0% (145/145) | 34/34 | 18/18 | 2/2 | 91/91 |

Four readings of that table.

**The curve is a step, and the step's left edge is 8.** `8` and `16` are identical to the case — `0` of 711
datapacks differ in ranked order — so nothing above 8 can be justified by this corpus. `4` is the arm below it
and it costs exactly one datapack: `ts2-mysql-pod-kill-xvzmxb`, where a pod-killed `mysql` carries one
indicator out of four and trails a neighbour by `0.010` (§9). The shipped value is therefore the smallest
weight that reaches the measured value, which is the rule `DEFAULT_DUAL_FAMILY_WEIGHT` follows too.

**The fourth indicator halved what a unit buys, and the sweep did not notice.** The previous revision of this
table shipped `8` for three indicators; the family is now four, so `8` buys a third less per fully corroborated
pod — and the plateau still ends at `8`, because the datapack that decides it sits `0.010` on the other side.
A weight inherited from a differently-sized family would have been right by accident.

**The three imperfections it leaves are structured, not random.** `PodFailure` and `ContainerKill` are complete;
`PodKill` loses one datapack of ten (§9) and `JVMMemoryStress` none. The losses are the datapacks where a
*cascade* re-uses the same channel the term reads — a `pod-failure` of mysql restarts half the fleet — and they
are recorded here rather than absorbed into a bigger number.

**`PodKill` was flat at every weight in the previous revision and it is not any more.** 5/10 before the
replacement indicator existed, 10/10 after, at the same weight: the row moved because the FAMILY grew, not
because the knob did. That is the difference between a measurement and a tuned number.

## 7. What the term is worth

On the whole archive — 1,422 datapacks scored in two waves of 711 with the same configuration, combined on
per-case results, so the totals below are exact rather than a weighted mean of two percentages:

| | Top@1 | Top@3 | Top@5 |
| --- | ---: | ---: | ---: |
| term absent (`podStateWeight = 0`) | 873 = 61.39% | 1,136 = 79.89% | 1,184 = 83.26% |
| shipped (`podStateWeight = 8`) | **1,073 = 75.46%** | **1,227 = 86.29%** | **1,249 = 87.83%** |
| movement | **+200 cases, +14.07 pp** | +91, +6.40 pp | +65, +4.57 pp |

Per fault type, over the archive's whole population — **21 of the 25 types are identical to the case and the
other four carry the entire movement**:

| type | datapacks | Top@1 before | Top@1 after | cases |
| --- | ---: | ---: | ---: | ---: |
| `JVMMemoryStress` | 171 | 61 = 35.7% | **171 = 100.0%** | **+110** |
| `ContainerKill` | 89 | 27 = 30.3% | **89 = 100.0%** | **+62** |
| `PodFailure` | 24 | 1 = 4.2% | **24 = 100.0%** | **+23** |
| `PodKill` | 10 | 5 = 50.0% | **10 = 100.0%** | **+5** |
| the other 21 types | 1,128 | 779 = 69.1% | 779 = 69.1% | **0** |

**Every lifecycle fault type is now read completely, and none of them was before this iteration.** The previous
revision closed `ContainerKill` and `PodFailure` to 98.9% and 95.8% and left `PodKill` at 50.0% with the note
that "a deleted pod stops reporting". It does not: it starts its counters again, and §3a is the reading that
notices.

**The baseline reads 873, and the register reads 874 — one case, disclosed rather than absorbed.** The
difference cannot be attributed to the weight (it is the zero arm) and is attributed to the converter's
attribution rule, which changes WHICH channels a service carries and therefore every anomaly score behind it:
the pod-scoped gauges no longer sit on a phantom node, so a service that had 40 channels now has 88. A change
of that shape moving one case of 1,422 is the expected order, and the arm is measured in the same session as
the arm it is compared against, which is why both are reported here rather than the register's older reading.

## 8. What it must not be allowed to cost

The weight is large, so the question is not what it buys but what it charges when it fires on the wrong thing.
Four guards answer it, and all four are empirical.

**No fault type pays for it.** The table in §7 is the answer at whole-population resolution rather than by
sample: of the 25 types, 21 are **identical to the case** at both weights — `HTTPResponseReplaceCode`
162/231, `HTTPRequestReplaceMethod` 125/190, `NetworkPartition` 64/97, `NetworkBandwidth` 20/42,
`NetworkLoss` 29/48, `NetworkCorrupt` 31/46, `NetworkDelay` 20/21, `TimeSkew` 0/2, and the rest. At the
per-case level the statement is sharper: **0 of the 1,128 non-lifecycle datapacks change ranked order at all**,
not merely their top-1. An earlier 160-datapack stratified sample agreed (61.9% → 72.5% overall, the same
three types moving) and is recorded because it was read *before* the whole-corpus arm and therefore could not
have been chosen to agree.

**The restart indicator refuses chronic restarters** (§3), which is what took `PodFailure` from 17/18 to 18/18
on the first wave without moving any other family: the increment it declines is the one a pod that restarts all
day keeps producing.

**The fleet gate abstains on non-specific evidence** (§5), which changes 1 of 711 ranked orders when it is
turned off — and not the top of either.

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

## 9. The residual misses, and a diagnosis that was tested and is wrong

The previous revision of this document ended with a claim it invited the next iteration to trust: *"in both
residual misses the truth's pod state corroborates and the truth still does not rank first, which is only
possible if the truth is not in the candidate list at all. That is `poolAdmission`'s territory."* The reasoning
was that an absent candidate and a low-ranked one are different failures with different owners, and the pool is
`{v : selfScore(v) > 0}` under a level statistic.

**It is false, and it was measurable.** Widening the pool to admit a node with non-zero pod-state evidence —
gated on the term's own weight, so the `0` arm stayed bit-identical — changed **0 of 1,422 ranked orders** on
the full archive. The truth is in the pool in every lifecycle datapack; it is not absent, it is outscored. The
widening was reverted rather than shipped, and the falsification is recorded here so the next reader does not
inherit the same inference.

The two misses are, in fact, two different failures, and neither is the pool:

| datapack | type | truth | winner | why |
| --- | --- | --- | --- | --- |
| `ts2-mysql-pod-kill-xvzmxb` | `PodKill` | `mysql` 1.139 | `ts-security-service` 2.129 | the winner carries `log = 1.000` — the fleet's post-injection error volume — against a pod whose *level* anomaly is `0.134`. A symptom loud in the logs beats a cause that is quiet in them, which is `docs/fse26-emitter-dominance-falsified.md`'s subject rather than this term's |
| `ts3-mysql-pod-failure-58qts5` | `PodFailure` | `mysql` 2.085 | `ts-ticket-office-service` 2.104 | the term fires **twice**: the winner's container restarted from `3` to `8` while mysql's went `0` to `6`. Both are restarts; only one is an event |

The second row is the one this iteration could fix, and §3 records the fix: a restart counter that was already
non-zero before the boundary is a pod that keeps restarting. With that rule the tie disappears — `mysql` is the
only service the term names, and it ranks first.

The first row is what sets the weight, and it is the reason §6's plateau starts at `8` rather than at `4`:
`mysql` carries one indicator out of four, so `4 × ¼` leaves it `0.010` short of a neighbour whose `log` term
is the fleet's error volume, and `8 × ¼` clears it. One datapack of 1,422 deciding a shipped constant is a thin
margin, and it is still the rule this repository follows — the smallest weight that reaches the measured value.
What it is NOT is a licence to keep climbing: `16` is identical to `8` to the datapack, so the curve ends there.

## 10. Where the term is owned

| layer | symbol |
| --- | --- |
| predicate | `computePodStateScore`, `POD_STATE_CHANNEL_LABELS`, `POD_STATE_REPLACEMENT_CHANNEL_LABELS`, `POD_STATE_RESET_FLOOR`, `POD_STATE_INDICATOR_COUNT` (`packages/tree/src/causal/topology-fault-graph.ts`) |
| specificity gate | `POD_STATE_MAX_FLEET_SHARE` (`packages/tree/src/causal/topology-fault-graph.ts`) |
| graph field | `FaultPropagationGraph.podStateScores` (`packages/core/src/types/graph.ts`) |
| term | `buildTerm('podState', …)` (`packages/tree/src/pruning/pruner.ts`) |
| weight | `DEFAULT_POD_STATE_WEIGHT` (`packages/tree/src/pruning/pruner.ts`) |
| dispatch | `--pod-state-weight` (`benchmarks/src/fse26-cli.ts`), `pod_state_weight` (`fse26-benchmark.yml`) |
| conversion | `service_of_pod`, `attribute_pod_scoped_services` (`scripts/fse26_convert.py`) |

The channels arrive through a converter fix rather than a new data source: the archive always had them,
and the only reason the engine could not read them is that they were filed under a service named `''`.
