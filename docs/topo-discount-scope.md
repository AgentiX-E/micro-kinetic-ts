# The topological deduction, and the channel it is allowed to act on

_Iteration 190. The third form of a term that has been refused twice, and the reason the third one is
admissible where the first two were not._

## 1. What the term is for

A caller's response time CONTAINS its callees' response time, and a caller's error rate contains the
errors its failed calls produced. On a benchmark that asks "which service is the origin", that containment
is a systematic bias toward the caller: a single faulty leaf lifts every service on the path to it, so the
magnitudes that decide the ranking favour the symptom.

The engine already carries three attempts at this. Two of them are off at the shipped weights, and both
were turned off by measurement rather than by taste:

| term                        | form                                                   | why it is off                                                                                                                                         |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topoWeight`                | `+ w · (1 − max over callees of propWeight × anomaly)` | additive on a score that is raw on OnlineBoutique (1–3) and rank-normalised on TrainTicket (steps of 1/63); at `w = 0.1` RE1-TrainTicket lost 46.4 pp |
| `topoDiscount` (ratio form) | `anomaly × (1 − ρ·(1 − topoSource))`                   | deducts the node's WHOLE anomaly, so a callee-origin's own `cpu` reading is deducted by its caller's response; RE1 83.47 → 68.53 at ρ = 0.25          |
| `victimWeight`              | `− w · (1 − symmetry) · log1p(anomaly)`                | PRISM's internal/external axiom as a multiplier; −33 cases at its first weight                                                                        |

All three describe the same correction and all three were refused by the same population. The reason is
not that the correction is wrong; it is that each of them applies it to the wrong QUANTITY.

## 2. The physical claim

Only a response crosses a call boundary.

- A **response** channel — `latency*`, `delay`, `error`, `loss`, `socket` — is observable at the boundary.
  A caller's value contains its callee's, so a callee's rise is a sufficient explanation of the caller's
  rise, and the caller's own rise is therefore ambiguous.
- An **internal** channel — `cpu`, `mem`, `disk` — is a property of the component's own machine. Nothing
  transmits it outward. A busy callee does not make its caller's CPU reading rise, so no callee can
  explain it away, and deducting it is an error of category.
- A **demand** channel — `workload`, `load` — is what was HANDED to the component: the opposite direction.
  It is the family the decisive-evidence guard already excludes.

The ratio form and the symmetry mask both act on a node's single per-node anomaly, which is the MAXIMUM
over all its channels. On RE3/SockShop the origin of `carts_f1_*` reports its fault in `cpu`, and the
victim `front-end` reports it in `error`; a per-node discount cannot separate them, so it deducts the
origin and leaves the victim — the exact inversion that made the term look like a population trade.

## 3. The form

```
explained(v) = max over callees c with propWeight(v→c) > 0 of propWeight(v→c) × anomaly(c)
anomaly'(v)  = max(0, anomaly(v) − ρ · explained(v))
```

applied only where the scope allows it (`external` = both sides must carry a response-channel dominant
metric; `all` = the ablation arm).

**It is a deduction rather than a ratio, and that is what makes it scale-free.** Its relative effect is
`ρ · explained(v) / anomaly(v)` — a ratio of two quantities on the same scale — so the same weight means
the same thing on OnlineBoutique's raw deviation (order 1–3) and on TrainTicket's rank-normalised one
(steps of 1/63), which is the property the additive term never had and the one the ratio form had at the
cost of deducting the wrong channel.

The clamp is written as a branch rather than `Math.max(0, …)` so a fully explained node reads exactly `0`
instead of `-0`, which the ranking's id tie-break would see as a different value.

## 4. The measurement, locally

RE1:OnlineBoutique is 125 cases, RE3:SockShop is 30; both are the assembled local corpus. One variable per
row. `AC@1` per fault type in the golden column order (cpu, delay, disk, loss, mem).

|               ρ | scope    |   OB AC@1 | OB cells                     |   SS AC@1 |
| --------------: | -------- | --------: | ---------------------------- | --------: |
| **0 (shipped)** | external | **85.6%** | 92 / 88 / 96 / 52 / 100      | **63.6%** |
|            0.25 | external | **86.4%** | 92 / 88 / 100 / 52 / 100     | **63.6%** |
|             0.5 | external | **87.2%** | 92 / **92** / 100 / 52 / 100 | **63.6%** |
|            0.75 | external | **88.0%** | 92 / 92 / 100 / **56** / 100 |     61.1% |
|             1.0 | external |     88.0% | 92 / 92 / 100 / 56 / 100     |     61.1% |
|             0.5 | **all**  |     87.2% | 92 / 92 / 100 / 52 / 100     | **53.6%** |

Two things are being read here.

**The scope is the whole of the difference on SockShop.** At ρ = 0.5 the two scopes score the same on
OnlineBoutique (87.2%) and differ by **10 pp** on SockShop — `all` costs six cases, `external` costs none.
That is the inversion of §2 reproduced by an ablation of one field, on one corpus, at one weight.

**The weight has an interior optimum that is not a plateau artefact.** On OnlineBoutique the curve is
85.6 → 86.4 → 87.2 → 88.0 → 88.0, and the cell that moves at each step is a different one (disk at 0.25,
delay at 0.5, loss at 0.75). Nothing moves down at 0.25 or 0.5, which is the pair the shipped default may
be chosen from; 0.75 is where SockShop starts paying.

## 5. What is NOT measured yet

- **Nine cells.** Only RE1:OnlineBoutique and RE3:SockShop are assembled locally. RE1:SockShop has six
  cases, RE1/RE2/RE3 TrainTicket and all of RE2 are reached through the workflow only.
- **FSE'26.** 1422 cases, and the half where this project is first by 24.2 pp. The term is inert at ρ = 0,
  so a bare dispatch is unchanged by construction — but the ADOPTED value has to be measured there before
  the default moves.
- The shipped default is therefore still **ρ = 0** and the axis is opt-in until those two reads exist.

## 6. How to re-measure

```bash
# local, both assembled cells
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite re1 --system ob \
  --topo-discount 0.5
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir ~/RCAEval-json --suite re3 --system ss \
  --topo-discount 0.5 --topo-discount-scope all

# golden half, nine cells, one input
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=0.5
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=topodiscount=0.5,toposcope=all
# FSE'26 half
gh workflow run fse26-benchmark.yml -f ranking_knobs=topo_discount=0.5
```

The `signals:` line names `topoDiscount` and `topoDiscountScope` unconditionally on the golden artifacts,
because a scope combined with a zero weight is not a configuration the engine can distinguish — the map is
never built — and an omitted-when-default scope would render the two arms byte-identically.
