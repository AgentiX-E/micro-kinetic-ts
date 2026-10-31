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

## 4. The two measurable readings

The sandbox corpus holds one system per suite, so these are `RE1:OnlineBoutique` and `RE3:SockShop` — the two cells
every previous arm in this campaign was decided on:

```
RE1:OnlineBoutique
[faults] loss 13/25: miss 12 = blank 1 + outweighed 10 + outvoted 1 [dualFamily 1]
       | delay 22/25: miss 3  = blank 0 + outweighed 3  + outvoted 0
       | cpu   23/25: miss 2  = blank 0 + outweighed 2  + outvoted 0
       | disk  24/25: miss 1  = blank 0 + outweighed 1  + outvoted 0
       | mem   25/25: miss 0

RE3:SockShop
[faults] f4 1/7:  miss 6 = blank 0 + outweighed 5 + outvoted 1 [dualFamily 1 stability 1]
       | f3 6/10: miss 4 = blank 0 + outweighed 4 + outvoted 0
       | f1 8/10: miss 2 = blank 0 + outweighed 2 + outvoted 0
       | f2 3/3:  miss 0
```

**47 of the 51 misses are `outweighed`.** Three are `blank` and one is `outvoted`; the single `outvoted` case on each
cell names `dualFamily` — the presence bonus, which pays a constant `0.25` in log space for having a moving channel in
both metric families, independent of the fault's magnitude.

## 5. What this retires

The weight-search axis is closed by arithmetic rather than by another arm.

The latent-term census (`docs/latent-term-census.md`) prices every dormant term: at what weight it wins a case back,
and at what weight it costs one. It reported one or two free cases per term per cell, and the two arms dispatched
against those readings came back at **+2/−2** and **+2/−1/−1** — the same total. This census says why: those arms were
being asked to repair cases that are not in the bucket a weight can reach. On RE1:OnlineBoutique **zero** of the 39
misses are reachable by a weight on a dormant term, because the truth's base term was already the smaller number on
37 of them.

That is also the honest reading of the eight iterations before this one. Each measured something real, and each was
aimed at a population of at most two cases per cell.

## 6. What it points at

The next lever is the **evidence at the truth**, not the formula over the candidates. Three questions this census
makes askable, in the order the numbers rank them:

1. **Why is the truth quieter?** On `loss` the truth's own tail latency rises 1.5–2× while a caller rises more. The
   channel that carries it is `latency-90` and it survives the guards (`1` of 12 misses loses a strong channel to
   `transient-return`), so this is not a filtering defect — it is that the injected service's own measurement is
   genuinely weaker than the propagated symptom's.
2. **Is the deviation comparable across services?** The base term is `log1p` of a per-service anomaly, and the
   anomaly is built from each service's own baseline. A service whose baseline is noisy reads a smaller anomaly for
   the same absolute effect.
3. **Is a magnitude-free signal available?** `dualFamily` is the only term in the formula that is not a magnitude, and
   it is the only one that appears in the `outvoted` bucket at all.

## 7. Limits

- **Population-conditional.** The buckets describe this corpus at this configuration. A `loss` case whose injected
  service reports a large deviation would move from `outweighed` to `outvoted` without any code change.
- **`blank` is not a zero.** A truth the ranking never surfaced has no breakdown, and the bucket counts absences
  rather than attributing them.
- **Blame needs both sides.** A record written before `top1Terms` existed carries the truth's evidence and nothing to
  compare it with; the census reports the miss and names no owner, rather than inventing one.
- **The base term is not the only measurement.** `log`, `trace`, `lat`, `pool` and `stability` are also measurements
  of a candidate, at non-zero weight. `outweighed` therefore means "the base measurement was smaller", and a case
  could in principle be won by one of the others — which is the `outvoted` bucket's job to reveal, and it is empty on
  both cells.
