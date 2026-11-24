# The cutoff average — the competitor metric, on our cells, with its floor

**Iteration 339 · 2026-11-24 · cost ¥0 (no dispatch, no endpoint, two artifacts already on disk) · surface
unchanged**

**Owner of:** `benchmarks/src/cutoff-accuracy.ts`, `benchmarks/src/run-cutoff-accuracy.ts`,
`docs/cutoff-accuracy-339.md`.

**Reading taken on:** the loss census of benchmark run `45314745837` at `9588dda4` — `rcaeval-re1/2/3-results`,
sha256 `62dd882e51daa5d0` / `b126a4620e5395d1` / `3118005cf1b058e0`. Those three digests are byte-identical to the
census of the previous full run, which is the first thing this instrument establishes: the cell readings below are
reproducible across runs, not a snapshot of one.

---

## 1. The sentence this replaces

`sota-comparison.md` has carried the closest competitor at arm's length for three iterations:

> "Its metric is Avg@5, ours is Acc@1, so the numbers are not comparable directly."

That sentence was the register's most expensive hedge, and it was **wrong**. `Avg@5` is not an exotic metric. The
competitor's own abbreviations table defines it — "Average accuracy over the first five cutoffs" — and
`arXiv:2603.02057` writes it out: `Avg@k = (1/k) Σ_{j=1..k} AC@j`. Every term of that mean is an indicator on one
integer, the rank at which the accepted answer first appears, and the census this project has been writing after
every RCAEval run carries exactly that integer (`truthRank`) plus the pool it was ranked in (`pool`).

So the comparison was never a missing population. It was a **missing column**, and this iteration adds it as a
module rather than as a paragraph: `cutoff-accuracy.ts` computes `AC@k`, `Avg@k`, the floor of both, and reads the
census with the same refusals every other reader in this repository makes.

## 2. The nine cells

| cell                 |   n |  AC@1 |  AC@2 |  AC@3 |  AC@4 |  AC@5 |  Avg@5 | floor | abs |
| -------------------- | --: | ----: | ----: | ----: | ----: | ----: | -----: | ----: | --: |
| RE1:OnlineBoutique   | 125 | 90.4% | 95.2% | 96.0% | 99.2% |  100% |  96.2% | 56.5% |   0 |
| RE1:SockShop         | 123 | 96.7% | 98.4% |  100% |  100% |  100% |  99.0% | 30.3% |   0 |
| RE1:TrainTicket      | 125 | 90.4% | 95.2% | 96.8% | 96.8% | 99.2% |  95.7% |  4.7% |   0 |
| RE2:OnlineBoutique   |  87 | 96.6% | 97.7% | 97.7% | 98.9% |  100% |  98.2% | 39.5% |   0 |
| RE2:SockShop         |  89 |  100% |  100% |  100% |  100% |  100% |   100% | 25.7% |   0 |
| RE2:TrainTicket      |  90 | 84.4% | 87.8% | 87.8% | 90.0% | 90.0% |  88.0% |  4.4% |   0 |
| RE3:OnlineBoutique   |  27 | 96.3% | 96.3% | 96.3% | 96.3% | 96.3% |  96.3% | 34.6% |   0 |
| RE3:SockShop         |  30 | 80.0% | 86.7% | 93.3% | 93.3% | 93.3% |  89.3% | 23.4% |   0 |
| RE3:TrainTicket      |  30 | 73.3% | 76.7% | 83.3% | 86.7% | 86.7% |  81.3% |  4.4% |   0 |
| **pooled**           | 726 | 91.7% | 94.6% | 95.9% | 97.0% | 97.7% | **95.4%** | 26.5% |   0 |

`abs` is zero on every cell: there is no case whose accepted answer is absent from the engine's order. The misses
this corpus has are all **depth** misses — the answer was ranked, just not first — which is the same shape the
1 422-case surface reports and the reason the ledger there can name a ceiling for widening.

Three things the table says that `AC@1` alone cannot:

1. **The ranking is better than its first choice on every cell** — pooled `AC@3` is `95.9 %` against `AC@1` `91.7 %`.
   A `4.2 pp` gap between the first cut and the third is a statement about ties and near-ties, and it is the
   quantity a re-ranking layer can act on.
2. **TrainTicket carries the depth.** Its three cells are `95.7 / 88.0 / 81.3` `Avg@5`, the lowest three of the nine,
   and its pools are the largest (`63–69` candidates against `1–28` for the two small fleets). The two facts are the
   same fact: on a 64-service fleet a rank-2 answer is one rank away among sixty-four, and on a 6-service fleet it is
   one among six.
3. **RE3 is the only suite where the first cut and the fifth are far apart** (`73.3 %` → `86.7 %` on TrainTicket,
   `80.0 %` → `93.3 %` on SockShop). RE3 is the suite the register has carried as the weakest, and the ladder says
   its weakness is concentrated in `AC@1` rather than spread across depth.

## 3. The floor, which is not decoration

A cutoff average is not scale-free. For a pool of `n` and a cutoff `k`, a **uniformly random order** already scores

```
E[Avg@k] = (1/(n·k)) · Σ_{j=1..k} min(j, n)        →  (k+1)/(2n)  when n ≥ k
```

so `0.700` at `n = 4`, `0.500` at `n = 6`, `0.250` at `n = 12`, `0.047` at `n = 64`. The floor is computed per case
over that case's own pool and then averaged, never assumed from a nominal pool size, and it is printed beside every
row because of one consequence: **a cell whose `Avg@5` sits at its floor is a cell the metric cannot rank**, and a
competitor number quoted without its floor has an unknown scale.

`RE1:OnlineBoutique` makes the point at our own expense: its pool has a **median of 6** and a minimum of 1, so a
random order over those pools scores `56.5 %` `Avg@5`. Our `96.2 %` is `39.7 pp` above that floor — a real signal,
but the floor is more than half the number. On `RE1:TrainTicket`, with pools of 63–64, the floor is `4.7 %` and the
metric is nearly free of it.

The floor is a property of the **pool**, and our pool is post-elimination, so these floors are ours and not the
competitor's. What transfers is the rule, not the number: `arXiv:2609.27069` audits the same benchmark and measures a
ranker that reads **no telemetry at all** at `Avg@5 0.488` on held-out incidents, calling that — not the uniform
`0.137` — the honest in-distribution floor. A cutoff average below `0.488` on this benchmark is therefore below a
method that looks at nothing.

## 4. The competitor, measured instead of cited

DeCoR / RICE-CM (`DOI 10.1186/s13677-026-01009-x`) reports `Avg@5` on a 300-case subset of RCAEval's Sock Shop 1,
Sock Shop 2 and Online Boutique: **0.6000 / 0.7040 / 0.4864**, the best of the field it evaluates, at ~1/33 of
RUN's runtime per case. It is the closest competitor this project has, because it **assumes a known fault-onset
time** — precisely the premise `detectMADOnset` supplies.

On the same cell populations:

| dataset | their `Avg@5` | our `Avg@5` (worst → best cell) | our `AC@1` (worst → best) |
| ------- | ------------: | ------------------------------: | ------------------------: |
| Sock Shop 1 / 2 | 0.6000 / 0.7040 | **0.893 – 1.000** | 0.800 – 1.000 |
| Online Boutique | 0.4864 | **0.962 – 0.982** | 0.904 – 0.966 |

Two properties make that comparison stronger than a side-by-side of numbers:

1. **It is invariant under the dataset mapping.** RCAEval's three suites are three *instances* of the same two
   fleets, so which of `RE1/RE2/RE3:SockShop` is their "SS1" and which is "SS2" is not stated. It does not matter:
   **all three** Sock Shop cells read `≥ 0.893` and **all three** Online Boutique cells read `≥ 0.962`, both above
   their best cell of the same fleet (`0.7040` and `0.4864`). The conclusion holds under every assignment of the
   three suites to their two labels.
2. **Their `AC@1` is bounded by their `Avg@5`, by definition.** `Avg@k ≥ AC@1` always, because `AC@1` is the first
   term of the mean it averages. So a method that publishes only a cutoff average publishes an **upper bound** on its
   own first-choice accuracy: on Online Boutique theirs is `≤ 0.4864`, against our `AC@1` of `0.904`. No protocol
   assumption is needed for that sentence — only the definition, which is why the inequality is asserted in
   `cutoff-accuracy.test.ts` over every rank and every cutoff rather than reasoned about in prose.

And the floor of §3 gives the sharper reading: their Online Boutique row, `0.4864`, is **0.0016 below** the
`0.488` a telemetry-free ranker scores on the same benchmark. That is not a criticism of their proof; it is what the
benchmark's own label space does to a method that ranks by relational evidence alone on a twelve-service fleet.

## 5. Nine rows the metric cannot reach

The reader refuses to treat an absent column as a zero, and the first run against the real artifact is why. Of the
**735** census rows, **nine** carry no `truthRank` at all:

| suite | rows | no `truthRank` |
| ----- | ---: | -------------: |
| RE1   |  375 |              2 |
| RE2   |  270 |              4 |
| RE3   |   90 |              3 |

So `correct` — the published answer's `AC@1` — is defined on 735 cases and **every cutoff is defined on 726**. Those
are two different populations, and the difference is `0.9 pp` on the pooled first cut: the answer's `AC@1` is
**90.61 % (666/735)** and the order's is **91.73 % (666/726)**. A reader that scored the nine as misses would print
the second number and call it the first. The module therefore carries `rankMeasured` as a field rather than
collapsing a missing column into `null`, and `censusPopulations` returns both populations so no caller can report
one over the other's denominator.

## 6. The answer and the order are two columns, and here they agree

The census carries the published answer's correctness **and** the truth's rank. On this artifact they agree to the
case on all nine cells — `passes 0` on every row — and that is a property worth stating rather than a redundancy to
delete: `truthRank` is a position in the **published** order, so this artifact structurally cannot see the reordering
the engine applies after it scores. The `1 422`-case surface, whose term dump carries the sum's own order beside the
published one, shows the two differ by **83 cases** there. Printing both columns is what keeps a future divergence
visible instead of silently changing what a published percentage means.

## 7. What this does not say

1. **It does not re-anchor the headline.** The corpus here is the census of run `45314745837` (`90.61 %` pooled
   `AC@1` over 735); the register's headline is quoted on the population that run enrolled. This iteration adds
   cells to that population's reading and changes none of its numbers.
2. **It does not run the competitor.** `Avg@5` is now protocol-identical; the **method** is not. Reproducing
   RICE-CM — a shared dynamics model on the pre-fault segment, edge confidence aggregated into node reliability,
   non-uniform diagonal coupling across same-metric replicas, reverse PageRank on a supra-adjacency matrix — is a
   build, not a reading, and it is the next item on the list rather than a claim in this one.
3. **It does not settle the benchmark's own defects.** `arXiv:2609.27069` reports that RCAEval injects faults into
   five services per system while exposing 12–70 in telemetry, and that this prior alone scores `Avg@5 0.488`. Our
   `AC@1` is not exposed to that floor in the same way — a five-service prior gives `AC@1 ≤ 0.42` — but the
   observation is a constraint on every number on this page and belongs in the register, not in a footnote.

## 8. Reproduce

```bash
# The nine cells, their ladder, their floors, and the two populations (§2, §3, §5, §6). ¥0.
npx tsx benchmarks/src/run-cutoff-accuracy.ts \
  --census rcaeval-loss-census-re1.jsonl,rcaeval-loss-census-re2.jsonl,rcaeval-loss-census-re3.jsonl --k 5
```

```bash
# The same reading restricted to the competitor's two fleets — the rows of §4.
npx tsx benchmarks/src/run-cutoff-accuracy.ts \
  --census rcaeval-loss-census-re1.jsonl,rcaeval-loss-census-re2.jsonl,rcaeval-loss-census-re3.jsonl \
  --cells RE1:SockShop,RE2:SockShop,RE3:SockShop,RE1:OnlineBoutique,RE2:OnlineBoutique,RE3:OnlineBoutique
```

The module is `100 / 100 / 100 / 100` on 37 tests; the two properties the external comparison leans on — the
`Avg@k` closed form against its definition, and the sandwich `AC@k ≥ Avg@k ≥ AC@1` — are asserted rather than
assumed.

## 9. Open

1. **RICE-CM, reproduced.** The protocol is now comparable; the method is not. A reproduction on our own cells is
   the first external method this project could measure rather than cite.
2. **The nine unmeasured rows.** A census row that carries no `truthRank` is a writer branch that did not run. Which
   branch, and whether it is the same nine cases every run, is a corpus question with a `1.2 pp` denominator.
3. **`AC@3` on TrainTicket.** `95.9 %` pooled at the third cut against `91.7 %` at the first is headroom that a
   scoring change can reach without widening anything; the three TrainTicket cells are where it sits.
