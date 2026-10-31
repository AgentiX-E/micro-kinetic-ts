# The transient guard's question — the estimator was never where the defect lived

**Status:** the mechanism is IMPLEMENTED with three members and ships at `endpoint`, which is bit-identical to
the published nine cells by construction. Measured on all nine cells, one variable (`7c9c5dc8` against its own
push battery): `level-window` **+13 / −22** (REFUSED, §6), `either` **+6 / −1** with five cells up and one down
by a single case (REFUSED as a shipment, kept as the evidence that the union is not noise, §6). A conditional
arm conditioned on direction evidence was pre-registered here and is **falsified by the corpus's own partition**
(§5), not deferred.

**Owner of:** `transientGuardTest` (`packages/tree/src/causal/topology-fault-graph.ts`),
`--transient-guard-test`, `anomaly_knobs=transguard=<endpoint|level-window|either>`.

---

## 1. What the guard decides

Every service's anomaly is a maximum over its channels, and before a channel may be evidence it must pass the
transient guard:

```
permanence = |values[0] − values[n−1]| / (max − min)      on a NON-zero baseline
permanence < 0.3  ⇒  the channel is dropped as `transient-return`
```

The guard exists because a **symptom** returns and a **source** does not: a resource briefly overloaded on
propagated load spikes and settles back, while the injected service shifts to a new level and stays. That
distinction is the kinetic mapping's own — the source is where the disturbance is _created_, τ is how fast it
travels, and a node that received it is a place the pulse _passed through_.

The statistic reads two samples out of 721. `docs/transient-guard-window.md` measured what that costs and
replaced it with the means of the first and last tenth — the same question asked of a better estimator — and
the arm was **reverted**: 15 cases gained, 17 lost, because restoring both ends correctly restored the
CALLER's propagated channel as well as the source's. That document's conclusion was that the fix is a
suppression mechanism and not a better estimator. This is that mechanism, and the move it makes is to change
the QUESTION rather than the estimate of the same two endpoints.

## 2. The two statistics

| value                | statistic                                                         | what it reads               |
| -------------------- | ----------------------------------------------------------------- | --------------------------- |
| `endpoint` (shipped) | `\|values[0] − values[n−1]\| / range`                             | two samples                 |
| `level-window`       | `\|median(post) − median(pre)\| / range`, split at `injectTimeMs` | every sample, by side       |
| `either`             | `max` of the two verdicts above                                   | whichever reading finds more |

`level-window` asks the guard's question — _did this channel settle at a new level_ — of the two sides of the
injection boundary. An off-beat at either end cannot decide a channel, and an intermittent plateau that fills
most of the post window reads as the permanent shift it is. The split is the same `injectTimeMs` the shipped
protocol already passes for onset, and where it is absent or a side carries fewer than three samples the
guard falls back to `endpoint` **for that channel**, so a corpus with no anchor is not silently re-populated.

## 3. The measurement

`RE1:OnlineBoutique` is 125 cases and `RE3:SockShop` is 30; both are the whole cell, not a sample. One
variable, everything else shipped:

| cell                   | `endpoint` (shipped) |       `level-window` |            Δ | per fault type                                                        |
| ---------------------- | -------------------: | -------------------: | -----------: | --------------------------------------------------------------------- |
| **RE1:OnlineBoutique** | **85.6 %** (107/125) | **89.6 %** (112/125) |       **+5** | cpu 92 → 96, delay 88 → 96, disk 96 → 96, loss 52 → 60, mem 100 → 100 |
| **RE3:SockShop**       |      **63.6 %** (30) |      **42.5 %** (30) | **−21.1 pp** | 80 → 30, 60 → 40, 14.3 → 0, 100 → 100, 63.6 → 42.5                    |

The blocking cell is where the published comparison lives, and `arXiv:2610.05009`'s 88.0 % is on it: at
`level-window` this engine reads **89.6 %** on that cell for the first time. The cell that pays is the one
this repository's own audit (`docs/re3-quiet-truth.md`) describes as inverted — on RE3 the truth is the
QUIETEST of the top five in 11 of 14 misses, so which of its channels counts is a different question there.

## 4. The flip census — seven gains, two losses, one action

Both runs carry `--diagnose-dump`, so the sixteen cases that moved can be read one at a time.

**Every gain is the same event: the truth's own latency channel was dropped by the endpoint statistic and is
kept by the level test.**

| case                     | truth's decisive channel, `endpoint` → `level-window` | what the guard did                                                                                                            |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `adservice_delay_3`      | `mem 0.01` → **`latency-90 1.70`**                 | the documented case: an intermittent 106 ms plateau over 361 of 721 samples, discarded because the last sample is an off-beat |
| `adservice_delay_4`      | `cpu 0.15` → **`latency-90 1.70`**                 | same, plateau to the end                                                                                                      |
| `cartservice_loss_4`     | `cpu 0.13` → **`latency-90 1.17`**                 | same                                                                                                                          |
| `adservice_loss_4`       | **no decisive channel at all** → `latency-90 0.04` | the truth had been erased from the evidence entirely                                                                          |
| `checkoutservice_loss_1` | `cpu 1.00` → `latency-50 0.29`                     | `latency-90` restored; the case is won on a different channel                                                                 |
| `adservice_loss_2`       | `latency-50 0.05` → `latency-90 0.03`              | channel set re-cut                                                                                                            |
| `currencyservice_cpu_1`  | `latency 1.40` → `cpu 1.07`                        | channel set re-cut                                                                                                            |

**Both losses are the same action read the other way**: `checkoutservice_loss_3` and `currencyservice_loss_5`
are cases the endpoint statistic KEEPS and the level test drops, because the truth's pre- and post-medians
coincide while its two ends do not — and in both, the channel it drops was the truth's strongest.

So the arm is not two mechanisms and it is not a better estimator. It is one verdict — the guard's answer for
the truth's own transport channel — applied to a population where that verdict happens to be the whole
difference between rank 1 and rank 2.

## 5. What refuses the global arm, and what the two populations actually disagree about

**The bar this repository has used for every refusal: no cell down.** `RE3:SockShop` — the weakest cell of the
published nine — falls 21.1 pp, and the local reading there is not a sample of the cell, it IS the cell's 30
cases.

The explanation this document first wrote was that RE1 has no direction evidence and RE2/RE3 do, so the guard
is RE1's only suppressor of a propagated symptom. **That explanation is false, and the corpus already said so.**
`packages/tree/src/pruning/pruner.ts` records the partition: `edgeLatency` is EMPTY on **five of the nine
cells — 495 of 735 cases** (all three RE1 cells, RE3:SockShop, RE2:SockShop), and `failedEdge` reads
`WEIGHT_ZERO` on 734 of 735 golden cases. `RE3:SockShop`, the cell that pays for this arm, is one of the five
with **no direction evidence at all**. The discriminator cannot be direction evidence, because the cell that
likes the arm and the cell that refuses it sit on the same side of that line.

**What the two populations actually differ in is the SHAPE of the culprit's own signature**, and it is read
case by case rather than argued. `re3ss_carts_f1_2` is the witness for the losing side, and it is the mirror
image of `re1ob_adservice_delay_3`:

| | `re1ob_adservice_delay_3` (RE1, gained) | `re3ss_carts_f1_2` (RE3, lost) |
| --- | --- | --- |
| the truth's channel | `latency-90`, 5 ms → 106 ms | `cpu`, 4 → 30 |
| shape after injection | **plateau to the end of the window**, 361 of 721 samples | **bounded burst**, ~150 of 721 samples, returns to baseline |
| median(pre) → median(post) | moves with the plateau | 3.60 → 4.29, i.e. **0.02 of the range** |
| `\|values[0] − values[n−1]\|` | 0 — the last sample is an off-beat | **25.8 → 5.6**, i.e. 0.69 of the range |
| what the shipped statistic did | dropped it (wrong) | kept it — on a **warm-up spike at index 0**, not on the injection |
| what the level test did | kept it (right) | dropped it (right by its own contract) |

So the nine RE3 cases are not evidence that the level test is a worse reading of the same quantity. They are
nine cases whose shipped-mode win is carried by a channel the guard's own contract does not consider evidence:
a start-of-series warm-up with a settled tail, or a burst that returns. The milestone that says "89.6 %" and
the milestone that says "63.6 %" are measuring different things, and the metric cannot arbitrate between them.

## 6. The third statistic the evidence leaves — `either`

`endpoint` is decided by the samples at index 0 and `n − 1`; the level test is decided by the medians of the
two sides. **Their blind spots are disjoint**, and both are exhibited above: `either` takes the LARGER of the
two verdicts, which is the same as keeping a channel when either honest reading finds a shift. It cannot
suppress more than the shipped statistic does, so no published cell can fall for the reason the global level
arm falls — only for the reason a noisier channel set re-orders a case.

**The nine cells, one variable, everything else shipped** — three arms, run on the same revision (`7c9c5dc8`)
against its own push battery, whole cells rather than samples:

| cell | `endpoint` (shipped) | `either` | Δ cases | `level-window` | Δ cases |
| --- | --- | --- | --- | --- | --- |
| `RE1:OnlineBoutique` | 85.6 % | 88.0 % | **+3** | **89.6 %** | **+5** |
| `RE1:SockShop` | 93.6 % | 94.4 % | **+1** | 95.2 % | +2 |
| `RE1:TrainTicket` | 84.8 % | 84.0 % | **−1** | 89.6 % | +6 |
| `RE2:OnlineBoutique` | 92.2 % | 93.3 % | **+1** | 92.2 % | 0 |
| `RE2:SockShop` | 97.8 % | 98.9 % | **+1** | 94.4 % | −3 |
| `RE2:TrainTicket` | 83.3 % | 84.4 % | **+1** | 86.7 % | +3 |
| `RE3:OnlineBoutique` | 88.9 % | 88.9 % | 0 | 62.2 % | −8 |
| `RE3:SockShop` | 63.6 % | 63.6 % | 0 | 42.5 % | −7 |
| `RE3:TrainTicket` | 74.5 % | 74.5 % | 0 | 51.1 % | −7 |
| **net** | | | **+6** | | **−9** |

`level-window` is refused on this table and the refusal is not close: **+13 cases on the six RE1/RE2 cells and
−22 on the three RE3 cells.** The split is not by suite but by the SHAPE of the injected signature (§5), and it
is the chart that makes the RE3 family's shipped numbers depend on the warm-up artifact: every RE3 cell loses
under a guard that refuses to read an artifact as evidence.

`either` is **+6 cases, five cells up, one cell down by a single case** — refused as a shipment on the standing
bar, because a cell may not go down, however small the step. What it does establish is that the union is not
noise: it moves five of six non-RE3 cells in the same direction, and it leaves the three RE3 cells exactly where
they were, which is what a strict superset of the shipped keeps should do.

**The one case it gives back is named, and it is this axis's own mechanism read in reverse.**
`re1tt_ts-travel-service_loss_4`: the union restores `ts-food-service`'s `latency-90` (1.677) — the CALLER of the
injected service — and that propagated channel lifts the caller's self-anomaly to `1.000` against the truth's
`0.984`. It is the same event `docs/transient-guard-window.md` recorded when the window-MEAN arm restored both
ends and lost 17 cases: the guard's second job, never named in its contract, is damping the magnitude advantage of
a propagated symptom over its source. `level-window` loses that same case and six others' worth of gains
nevertheless, which is why its `RE1:TrainTicket` reading is +6 while the union's is −1.

**What that does not buy.** `+6` cases is not SOTA, and 88.0 % on `RE1:OnlineBoutique` is the published
competitor's number on that cell rather than above it. The one arm that beats it there — `level-window` at
89.6 % — pays 21–27 pp on each of the three RE3 cells to do it.

**The rule this section replaces, and why it is dead rather than deferred.** The previous text pre-registered a
conditional arm — _apply `level-window` only where the case carries no direction evidence_ — with three
predictions and one veto. The partition above falsifies it before it could be dispatched: the rule sends
`RE3:SockShop` (one of the five cells with no `edgeLatency` rows) to `level-window`, which is precisely where
the arm loses seven cases, so the arm's own veto fires on its own prediction 3. The condition was arrived at
from `docs/topo-discount-gate.md` §7.1's sentence about explicit direction terms, and that sentence is true of
the FAMILY it was written for and false as a description of this axis: what separates the two cells is the
shape of the injected signature, which is a property of the corpus's fault and not of its trace supply.
## 7. Limits

- **Two cells, one corpus.** The measurement covers the two cells this host can rank. `RE1:SockShop`,
  `RE1:TrainTicket` and all six RE2/RE3 cells are not in it, and that gap is exactly what a dispatch closes —
  §6 states what it expects the reading to look like rather than claiming it.
- **`either` inherits the shipped statistic's exploit.** It is a union, so it keeps everything `endpoint` keeps,
  including a channel whose only credential is a warm-up spike at index 0 — the exact artifact that carries the
  nine RE3 cases. That is deliberate (the bar is no cell down, and the artifact is already in every published
  number) and it is the reason `either` is not a theory of the guard but an admission rule. A corpus whose
  windows open on a start-up transient rather than on a pre-injection baseline would be ranked partly on
  artifacts under this arm, and the honest fix there is the window boundary, not the statistic.
- **The gain is a verdict, not a magnitude.** Seven of seven gains restore a channel; the arm does not make
  any channel louder than its own deviation, so it cannot move a case that is lost on amplitude alone.
- **The median is not a level test of drift.** A channel that drifts monotonically through the injection
  boundary has different medians on the two sides whether or not a fault caused the drift, so the statistic is
  no more resistant to a trend than the shipped one.
- **The fallback is silent per channel.** A corpus with a broken anchor gets the shipped statistic channel by
  channel and the run prints the configuration it was asked for, not the one that reached each channel. The
  cell-level `direction-gate` line and this document are the only record.
