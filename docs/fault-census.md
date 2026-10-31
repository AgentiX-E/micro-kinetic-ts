# The fault census — the axis that names an owner

Every roadmap decision in this campaign has been read off a nine-cell accuracy. Each cell is five fault types
averaged together, and the campaign has now spent eight iterations discovering that changes which look principled
move that average by nothing. This document records the measurement that explains why, and the instrument that makes
the explanation a standing one.

## 1. The unit problem

The nine cells are `RE1/RE2/RE3 × {OnlineBoutique, SockShop, TrainTicket}`. Each holds 25 or 15 cases per fault type.
The types are not comparable populations:

- A `cpu`, `mem` or `disk` fault is a **permanent resource shift** at the injected service. Its signature is a large,
  stable deviation in the service's own metrics, and the ranking finds it: 118/120, 119/120 and 118/120 respectively.
- A `delay` fault is a latency injection at the injected service. Its signature is a moderate rise there and a larger
  one at its callers: 103/120.
- A `loss` fault is a **fractional** network degradation. Its signature at the injected service is a modest tail rise —
  median post/pre ratio **1.86×** against **12.6×** for `disk` and **46×** for `mem` — and a caller can be louder:
  **74/120**.
- The RE3 `f1`–`f5` labels are code-level fault families, and the suite does not say what each one is. They read
  **65/90**.

Averaging them means the headline number is moved by whichever population is largest, and a change that trades one
population for another reads as noise. `docs/closed-axes-register.md` records four such trades without naming the
mechanism; this is the mechanism.

## 2. The three buckets

A miss is one of three things, and only two of them are ranking problems.

| bucket | what it means | owner |
| --- | --- | --- |
| **blank** | The truth carried no breakdown: the ranking never surfaced it. | candidate generation |
| **outweighed** | The truth was ranked and its own evidence read **strictly lower** than the candidate that beat it. | the evidence, not the formula |
| **outvoted** | The truth's own evidence read **at least as high** and the case was lost anyway. | the formula, and the census names the term |

`outweighed` is the bucket that matters. The base term is `log1p(selfAnomaly(v))`, and **every prior in the formula
is multiplied by a magnitude the base term already decided**. If the truth is quieter than the winner, no weight on
`temporal`, `collision`, `topo`, `rise`, `prism` or `source` can repair the case unless that term is loud enough to
overturn a difference in the base — which is what the `outvoted` bucket counts, and it is small.

## 3. Why the comparison is on the base term and not on the total

The total is the quantity under suspicion. `finalScore = base + Σ wᵢ·signalᵢ`, so comparing totals asks "did the priors
decide this?" and answers *yes* for every miss by construction — the split would be a constant. The base term is the
one contribution that is a measurement of the candidate rather than a prior over the candidates, so comparing it asks
the only question with two possible answers: **was the truth loud enough to be found, and lost anyway?**

The name is spelled out in `benchmarks/src/fault-census.ts` rather than imported, on the rule `loss-census.ts` records
for every mirror in this package. A rename upstream would be visible as every miss turning `outvoted`.

## 4. The nine readings

The census costs nothing at run time — it is a function of the per-case breakdowns the ranking already emits — so
every RCAEval job prints it. All nine cells have now been read, under the shipped protocol (`injectTime` ON), from the
batteries on `d030fb2d` and `25b4279b`:

| cell | n | correct | pooled | published | miss | blank | outweighed | outvoted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `RE1:OnlineBoutique` | 125 | 107 | 85.6% | 85.6% | 18 | 1 | 16 | 1 |
| `RE1:SockShop` | 125 | 117 | 93.6% | 93.6% | 8 | 2 | 6 | 0 |
| `RE1:TrainTicket` | 125 | 106 | 84.8% | 84.8% | 19 | 0 | 15 | 4 |
| `RE2:OnlineBoutique` | 90 | 83 | 92.2% | 92.2% | 7 | 4 | 3 | 0 |
| `RE2:SockShop` | 90 | 88 | 97.8% | 97.8% | 2 | 2 | 0 | 0 |
| `RE2:TrainTicket` | 90 | 75 | 83.3% | 83.3% | 15 | 0 | 14 | 1 |
| `RE3:OnlineBoutique` | 30 | 25 | 83.3% | 88.9% | 5 | 3 | 2 | 0 |
| `RE3:SockShop` | 30 | 18 | 60.0% | 63.6% | 12 | 0 | 11 | 1 |
| `RE3:TrainTicket` | 30 | 22 | 73.3% | 74.5% | 8 | 0 | 8 | 0 |
| **total** | **735** | **641** | **87.21%** | — | **94** | **12** | **75** | **7** |

The total is exactly the published nine-cell number, 641 of 735 = 87.21%: the same cases, counted once for accuracy and
once for owner.

**75 of the 94 misses are `outweighed`** — 79.8%. Twelve are `blank` (12.8%) and seven are `outvoted` (7.4%).

`pooled` is cases over cases; `published` is the number the campaign reports, which is the **unweighted mean of the
per-type rates**. They coincide in eight of the nine cells because every type there is equally sized, and they differ
on RE3, where a three-case `f2` carries the same weight as a ten-case `f3`: `RE3:OnlineBoutique` reads 88.9% published
against 83.3% pooled, and its three `blank`s on a nine-case type cost the published number **6.7 pp** where they cost
the pooled one **10 pp**. That is §1's unit problem one level down, inside a single cell.

### 4.1 The split is not the same on the two graph sizes

The nine cells fall into exactly two groups by graph size, and the groups differ in the buckets as well as in the rate:

| group | n | rate | miss | blank | outweighed | outvoted | outweighed share |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TrainTicket, 63–69 nodes (rank-normalised) | 245 | 82.9% | 42 | **0** | 37 | 5 | **88.1%** |
| OnlineBoutique / SockShop, 12–15 nodes | 490 | 89.4% | 52 | **12** | 38 | 2 | 73.1% |

Two things separate the groups. **Every `blank` miss in the corpus is on a small graph**: on 63–69 nodes the ranking
always surfaces the truth, and on 12–15 nodes it fails to 12 times. And the small graphs *lose* a larger share of their
misses to candidate generation than to the evidence, which is why a weight searched on them is aimed at a population
that is not the one it is measured on.

### 4.2 The seven `outvoted` cases are the whole reachable population

| cell | fault type | blame |
| --- | --- | --- |
| `RE1:OnlineBoutique` | `loss` | `dualFamily 1` |
| `RE1:TrainTicket` | `loss` ×2, `delay` ×2 | `dualFamily 4`, `stability 4` |
| `RE2:TrainTicket` | `loss` | `dualFamily 1` |
| `RE3:SockShop` | `f4` | `dualFamily 1`, `stability 1` |

**All seven name `dualFamily`, five also name `stability`**, and nothing that measures magnitude appears at all. Those
are the formula's only two magnitude-free signals: a flat `0.25` in log space for having a moving channel in both
metric families, and an ordinal rank in `[0, 1]` over the candidates' dispersion bonus at weight `0.007352`.

Two consequences, both arithmetic rather than opinion.

1. **The margin on these seven cases is at most `0.25 + 0.007352`.** If the truth's base was at least the winner's and
   the only terms paying the winner more were these two, the whole difference fits inside the presence bonus and one
   stability rank. These are ties, and the formula breaks them with a bonus for being instrumented.
2. **The other 87 misses are unreachable by any weight.** A prior is multiplied by a magnitude term, and the bucket
   says the magnitude was already smaller — or that the truth never entered the ranking at all. This is what closes §5.

### 4.3 The two passes that are excluded, and why the exclusion is not cherry-picking

Every RCAEval job runs each suite three times: the shipped protocol, a `--no-inject-time` pass, and a
`--no-inject-time --log-signal-mode novelty` pass. The table above uses the first only, and on RE3 that is not a
preference — the other two are not measurements of the same population.

With the anchor removed, `RE3:TrainTicket` reads **2/30** against **22/30** with it, and the diagnostic says why:
the truth's own onset is undefined (`onset GT=9007199254740991`, the `MAX_SAFE_INTEGER` sentinel) and its own
anomaly is `0.0224` against the leader's `1.0000`. The corpus for that suite does not carry the injection into the
metrics the decoupled pass reads, so the pass compares a truth that has no event against candidates that do. Its
`[faults]` line would have added **28** misses, all `outweighed`, to a bucket of 75 — the contamination would have
looked like agreement with the thesis rather than like a bug, which is exactly why it is written down here rather
than silently dropped.

The `novelty` pass is excluded on the same ground: it is a different ranking configuration (`logSignalMode` is a
`signals:` field), and a census of a configuration that is not shipped answers a question nobody asked.

Because one log now holds three censuses of the same cases, the line declares which pass it belongs to:
`[faults:inject-time] …` against `[faults:dataset-decoupled] …`. The parameter has no default, so a caller cannot omit
the one field that decides comparability.

## 5. What this retires

The weight-search axis is closed by arithmetic rather than by another arm.

The latent-term census (`docs/latent-term-census.md`) prices every dormant term: at what weight it wins a case back,
and at what weight it costs one. It reported one or two free cases per term per cell, and the two arms dispatched
against those readings came back at **+2/−2** and **+2/−1/−1** — the same total. This census says why. A weight
multiplies a signal, the signal is one of the priors in `finalScore = base + Σ wᵢ·signalᵢ`, and on **75 of the 94
misses the base term itself was already the smaller number** — so the arm is asked to overturn a magnitude deficit
with a term that is scaled by the same magnitude it is supposed to overturn. The reachable population per cell is
**1** of 18 (`RE1:OnlineBoutique`), **0** of 8 (`RE1:SockShop`), **4** of 19 (`RE1:TrainTicket`), **0** of 7, **0** of
2, **1** of 15 (RE2), **0** of 5, **1** of 12, **0** of 8 (RE3) — seven cases in 735. An arm that can move at most one case per cell cannot be distinguished from the noise in a 25-case population, and
the last eight iterations are that sentence measured eight times.

That is also the honest reading of the eight iterations before this one. Each measured something real, and each was
aimed at a population of at most two cases per cell.

**Corrections, recorded rather than folded in.** The first version of this section said "47 of 51 misses are
`outweighed`", because the miss counts had been read off the cells' case counts — 125 cases on `RE1:OnlineBoutique` —
instead of off their misses, which are 18. The second version said 37 of 43, which was right for the four cells it was
computed from and printed only two of them, so a reader could not check it. The table in §4 is the third version and
the first one computed from every cell's own line. The instrument was correct in all three; the prose about it was
not, twice.

## 6. What it points at

The next lever is the **evidence at the truth**, not the formula over the candidates. Three questions this census
makes askable, in the order the numbers rank them:

1. **Why is the truth quieter?** On `loss` the truth's own tail latency rises 1.5–2× while a caller rises more. The
   channel that carries it is `latency-90` and it survives the guards (`1` of 12 misses loses a strong channel to
   `transient-return`), so this is not a filtering defect — it is that the injected service's own measurement is
   genuinely weaker than the propagated symptom's.
2. **Is the deviation comparable across services? Half-answered here, and the answer is no.** The base term is
   `log1p` of a per-service anomaly built from each service's own baseline, and on graphs of 20 nodes or more the
   anomaly is **rank-normalised before it is scored** (`anomalyNormalizeNodeThreshold`) — which is exactly the
   rescaling that removes a cross-service scale difference. TrainTicket is 63–69 nodes, so its base term is an
   ordinal rank, and there the bucket is **worse**, not better: **37 of 42** TT misses are `outweighed` (88.1%),
   against **38 of 52** (73.1%) on the small systems where no rescaling runs. Normalisation does not move the bucket,
   so the deficit is not scale — it is the ordering itself.
3. **Is a magnitude-free signal available?** Two already are, and they are the only two that appear in the
   `outvoted` bucket: `dualFamily` on all six cases and `stability` on five. The question is no longer whether such a
   signal exists but whether the shipped weights say anything true about it. `dualFamily` pays a flat `0.25` for
   instrumentation, which is large enough to decide a tie on its own; `stability` pays at most `0.007352`, which is
   small enough to decide one only when nothing else is left. Between them they hold six cases, and those six are the
   only cases in this corpus that any change to the formula can win.

   The size of the bonus is worth stating in the base term's own units. On a rank-normalised graph the base term is
   `log1p` of a rank in `[0, 1]`, so its whole range is `log1p(1) = 0.693` and one rank step near the top is about
   `0.007`. `dualFamily` pays `0.25` for instrumentation — **36% of the entire measured range**, or roughly 34 rank
   positions on a 68-node graph. That is not a tie-break; it is a second measurement, and it is the one that decides
   every case in the bucket.

## 7. Limits

- **Population-conditional.** The buckets describe this corpus at this configuration. A `loss` case whose injected
  service reports a large deviation would move from `outweighed` to `outvoted` without any code change.
- **`blank` is not a zero.** A truth the ranking never surfaced has no breakdown, and the bucket counts absences
  rather than attributing them.
- **Blame needs both sides.** A record written before `top1Terms` existed carries the truth's evidence and nothing to
  compare it with; the census reports the miss and names no owner, rather than inventing one.
- **The base term is not the only measurement.** `log`, `trace`, `lat`, `pool` and `stability` are also measurements
  of a candidate, at non-zero weight. `outweighed` therefore means "the base measurement was smaller", and a case
  could in principle be won by one of the others — which is the `outvoted` bucket's job to reveal, and it holds six
  cases across six cells, every one of them blamed on `dualFamily` and five on `stability`.
- **One battery, nine cells, one configuration.** The table is the shipped configuration on the corpora these two
  batteries carried. It is not a claim about a different weight, and it is not a claim about a corpus those jobs do not
  hold.
- **The buckets are a partition of misses, not of errors.** A case outside the top-1 is a miss whether the engine was
  slow, wrong by one hop, or never asked; the census says nothing about which.
- **The blame is a lower bound.** A term is named when the winner was paid more than the truth by it, which requires
  both sides to carry a breakdown. A case whose winner predates `top1Terms` is counted as `outvoted` and names
  nobody, so a bucket of six may hide a seventh whose owner was never recorded.
