# The transient guard's question — the estimator was never where the defect lived

**Status:** the mechanism is IMPLEMENTED and ships at `endpoint`, which is bit-identical to the published nine
cells by construction. Measured on the two cells this repository can rank offline — one up by five cases, one
down by roughly six — so the GLOBAL arm is **REFUSED** (§5) and the conditional form is **PRE-REGISTERED** (§6)
rather than dispatched on the strength of the cell that likes it.

**Owner of:** `transientGuardTest` (`packages/tree/src/causal/topology-fault-graph.ts`),
`--transient-guard-test`, `anomaly_knobs=transguard=<endpoint|level-window>`.

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

| value                | statistic                                                         | what it reads         |
| -------------------- | ----------------------------------------------------------------- | --------------------- |
| `endpoint` (shipped) | `\|values[0] − values[n−1]\| / range`                             | two samples           |
| `level-window`       | `\|median(post) − median(pre)\| / range`, split at `injectTimeMs` | every sample, by side |

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

## 5. What refuses it

**The bar this repository has used for every refusal: no cell down.** `RE3:SockShop` — the weakest cell of the
published nine — falls 21.1 pp, and the local reading there is not a sample of the cell, it IS the cell's 30
cases. A five-case gain on a cell we already lead for a six-case loss on the cell with the most headroom is a
bad trade by the same arithmetic that refused `dualfamily = 0.34` (§8 of `docs/miss-reachability.md`).

That the two populations disagree is not a surprise in hindsight, and the disagreement is measurable rather
than atmospherical: **RE1 has no direction evidence at all.** On all 375 RE1 cases the `trace`, `failedEdge`
and `lat` terms are `WEIGHT_ZERO` or `INPUT_MAP_EMPTY` (the run's own `why the zero terms are zero` block
prints 100.0 % for each), so the transient guard is the ONLY mechanism suppressing a propagated symptom
there. Where `failedEdge` and `lat` are live, the ranking already knows who called whom, and re-deciding which
channels are evidence re-cuts a question that has been answered.

## 6. Pre-registered — the conditional arm, not a third statistic

**Rule.** Apply `level-window` only where the case carries NO direction evidence — no per-edge latency rows
and no failed-edge records — and `endpoint` everywhere else. That is the same condition
`docs/topo-discount-gate.md` §7.1 arrived at from the other end ("the family must be conditioned on the
absence of an explicit direction term"), and it is checkable before the ranking runs: the runner already
prints `[failed-edge-gate] … carried no per-edge latency` and `direction-gate[whole-view]` per cell.

**Predictions, written before an arm exists.**

1. The three RE1 cells rise and the six RE2/RE3 cells are bit-identical to the shipped run, because the flag
   cannot fire on a case that supplied a direction row.
2. `RE1:OnlineBoutique` reads **112/125** and `RE1:TrainTicket` moves by more than the ±1 case a rank surface
   hands out for free: it is 125 cases of which 19 are misses and 9 of those are `reversed`, and the guard's
   verdict on the truth's transport channel is exactly the event that decides them.
3. `RE3:SockShop` returns to **63.6 %** — the number the shipped run reads — because every RE3 case carries
   trace rows.

**Veto.** Any RE2 or RE3 cell differs from the shipped run, or any RE1 cell goes down. Either one means the
condition is not "direction evidence absent" but "OnlineBoutique", and the conditional form is refused on the
same bar as the global one.

**Instrument owed before the arm ships.** The per-case direction supply the condition reads is printed per
CELL and not per case; a case-level `directionEvidence` field on the loss record is what makes §6's rule
falsifiable at the granularity it is written at. Until it exists, the arm can only be read at cell
granularity, which is what predictions 1 and 3 are stated at.

## 7. Limits

- **Two cells, one corpus.** The measurement covers the two cells this host can rank. `RE1:SockShop`,
  `RE1:TrainTicket` and all six RE2/RE3 cells are not in it, and §6's predictions are exactly the part of that
  gap a dispatch can close.
- **The gain is a verdict, not a magnitude.** Seven of seven gains restore a channel; the arm does not make
  any channel louder than its own deviation, so it cannot move a case that is lost on amplitude alone.
- **The median is not a level test of drift.** A channel that drifts monotonically through the injection
  boundary has different medians on the two sides whether or not a fault caused the drift, so the statistic is
  no more resistant to a trend than the shipped one.
- **The fallback is silent per channel.** A corpus with a broken anchor gets the shipped statistic channel by
  channel and the run prints the configuration it was asked for, not the one that reached each channel. The
  cell-level `direction-gate` line and this document are the only record.
