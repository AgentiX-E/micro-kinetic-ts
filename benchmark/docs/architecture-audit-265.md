# Iteration 265 — the coordinate that is not in the case

Iteration 264 closed on a diagnosis rather than a gain: the shipped ranking wins 1 073 of 1 422 cases, the 36 it
loses are its thinnest wins, and **no vector in the twelve coordinates it already has can win them back** without
handing others over. The conclusion named the shape of the missing thing — _a coordinate that is zero on the cases
the ranking wins thinly_ — and a reference: Lee et al. (2026, arXiv 2611.02416) call it the **Expected Outlier
Baseline**.

This iteration builds it, measures whether the mechanism it rests on exists, and reports **no shipped change**.

---

## 0. What was built, and what it reads

| module                                            | what it is                                                     |           tests |                   coverage |
| ------------------------------------------------- | -------------------------------------------------------------- | --------------: | -------------------------: |
| `packages/tree/src/pruning/fault-free-profile.ts` | the profile's type, its two builders and the scoring           |              35 | 99.14 % stmts / 95.52 % br |
| `packages/tree/src/pruning/pruner.ts`             | `faultFreeWeight` option, `faultFree` term, `toRankingWeights` | 7 (integration) |        by the package gate |
| `benchmarks/src/fault-free-profile-file.ts`       | the on-disk artifact, and its two refusals                     |              12 |                      100 % |
| `benchmarks/src/fault-free-profile-build.ts`      | the corpus walk, the floors, the CLI parser                    |              22 |                      100 % |
| `benchmarks/src/case-discovery.ts`                | the ONE walk two runners and one builder now share             |               — |                      100 % |

The two benchmark modules read 100 % on all four dimensions, not on the two a row would show: the builder's branch
figure was **93.61 %** when the first measurement was taken, and the four points of that gap were two real holes
rather than a formatting accident — a `--max-cases` arm no test drove, and a chain that ended in silence (§5). Both
are now closed by tests, and the third module that shares their population (`fse26-engine-options.ts`) moved from
50 % branch to 100 % when the projection's profile key was given a test in each direction.

`faultFreeWeight` ships at **0**, which is the ablation: the map is not read, no term is computed, and the ranking
is bit-identical to the engine that had no such term. An integration test asserts that directly — the same corpus
ranked with a profile at weight 0 and with no profile at all produces the same order, which an `?? 0` around a map
lookup would fail.

---

## 1. The paper's definition, and the one place this implementation departs from it

Lee et al. define, in §4.1.1:

> The EOB `r(s)` of signal `s` is the fraction of fault-free windows `W′ ∈ 𝒲_normal` in which its anomaly score
> exceeds τ.

with τ = 3 for metrics, μ and σ estimated **from all of `𝒲_normal`** rather than from the minutes before the
incident, and the aggregation at ranking time being the **rarest** signal of a component:

> `r(e) ← min_{s ∈ M_e} r(s)`

Their profiles come from 18 to 211 hours of fault-free operation per dataset. **This repository's corpora have no
such period.** A datapack is one recording with one injection time: everything before `t₀` is fault-free, and it is
minutes long.

The departure is therefore forced, and it is the corpus that makes it possible:

> **One window per case.** The same `(service, channel)` pair re-appears in every case that touches that service,
> and each case contributes its OWN pre-segment — fault-free by construction, because every corpus here labels
> `t₀`. A case is one window; the rate is counted over the cases that carried the channel.

That is a weaker estimate in exactly one direction — a channel that swings _within_ a case but holds its level
_across_ cases reads as clean here, where the paper's 10-minute windowing would catch it — and stronger in another:
one whole pre-segment admits no boundary choice to bias it.

The EOB is then `count(departure > 3σ) / windows`, and the score the term contributes is `1 − r_e`, because every
other slope in the fusion lives in `[0, 1]` and a term that spent a negative slope would need a negative weight — a
region a multiplicative grid cannot reach.

---

## 2. Does the mechanism exist? Measured on the corpus that is local

The first question is not whether the term helps; it is whether `r` varies at all. A statistic that is 0 for every
channel is a constant, and a constant is not a coordinate.

Read on the 131 RCAEval datapacks whose raw metrics are present in this sandbox (735 exist; 131 were fetched), one
window per case, three-σ band, `minWindows = 3`:

| quantity                                         | reading                                   |
| ------------------------------------------------ | ----------------------------------------- |
| channels published                               | 138 (152 seen; 14 below the floor)        |
| `r` quantiles 0 / 10 / 25 / 50 / 75 / 90 / 100 % | 0 · 0 · 0.077 · **0.332** · 0.686 · 1 · 1 |
| channels with `r = 0` (never fired)              | **31**                                    |
| channels with `r = 1` (fired in every window)    | **22**                                    |

**The statistic varies over its whole range**, and the two ends are the two populations the term was built to
separate: `frontend_mem`, `currencyservice_latency`, `productcatalogservice_latency` at `r = 0` against
`front-end_cpu`, `orders-db_cpu`, `rabbitmq_cpu`, `catalogue_workload` at `r = 1`. A channel that fires in every
fault-free window it was ever observed in is a channel whose "anomaly" is its normal behaviour.

### 2.1 The prior alone is weak, and the paper says so

Ranking each case by `r_e` ascending (the paper's Algorithm 1) and asking whether the truth is first:

| population         |   n |      Top@1 |  Top@3 |
| ------------------ | --: | ---------: | -----: |
| all scored cases   | 130 | **12.3 %** | 40.0 % |
| RE1:OnlineBoutique | 124 |     12.9 % | 37.1 % |
| RE1:SockShop       |   6 |      0.0 % |  100 % |

12.3 % against a uniform baseline of about 7 % (the mean candidate count is ~14) is real information and it is not
a ranker. The paper's own "Statistical EOB" baseline reads Exact **7.1 %** on Bank, and its 48.7 % headline belongs
to the small language model reading the profile as _context_, not to the profile sorting the list. **This is
consistent with the paper, and it is the reason the term enters as one slope in a fusion rather than as a
re-ranker.**

### 2.2 As an added coordinate, on 130 cases

The shipped dump (735 cases, `it263-rca-merged.ndjson`) joined to the 131 local datapacks leaves 130 scored cases.
Each candidate's shipped score gains `w · (1 − r_e)`, with a leave-one-out band so no case profiles itself:

|             w |            Top@1 |      Δ |
| ------------: | ---------------: | -----: |
| 0.0 (control) | 118/130 = 90.8 % |      — |
|           0.1 | 119/130 = 91.5 % | **+1** |
|           0.2 | 119/130 = 91.5 % |     +1 |
|           0.3 | 119/130 = 91.5 % |     +1 |
|           0.5 | 116/130 = 89.2 % |     −2 |
|           0.8 | 113/130 = 86.9 % |     −5 |
|           1.2 | 102/130 = 78.5 % |    −16 |
|           2.0 |  79/130 = 60.8 % |    −39 |

**One case on 130 is not a result.** It is 0.77 pp and the 95 % interval on a one-case move at this n spans zero.
Two facts about the population make that unsurprising and make this measurement the wrong one to conclude from:

- RE1:OnlineBoutique is the corpus this sandbox holds, and the shipped engine already reads **90.8 %** there. The
  cases this term was built for are the 173 absent ones and the 176 top-five ones — 24.6 % of the corpus — and they
  live overwhelmingly in RE3:TrainTicket and in the FSE'26 archive, neither of which is local.
- The paper's gain comes from the profile _reordering the prompt_ for a model that then reasons. A linear
  coefficient spends the same information at a fixed exchange rate against twelve other slopes.

`w` falling below the control past 0.5 is the second half of the same reading: the prior is not noise, it is
**mis-scaled against the terms it joins**, and the scale at which it stops helping is 0.3 — a band, not a point,
which is what a real signal looks like when its magnitude is wrong but its direction is right.

---

## 3. What this iteration does NOT claim

- **No shipped change.** `DEFAULT_FAULT_FREE_WEIGHT` is 0. No published number moved, and the standing anchor's
  digest moved only because the reported line gained the two fields that name the term at their defaults
  (`docs/sota-comparison.md` §0p-v).
- **No all-corpus reading.** The 1 422-case FSE'26 archive and the 735-case RCAEval archive are read by the
  workflows, not by this sandbox, and the arm that decides whether this coordinate ships is a two-arm dispatch
  neither has been run yet.
- **No claim that the mechanism explains the absent class.** The mechanism is _available_; whether `ts-ui-dashboard`'s
  `k8s.pod.network.io` carries a high `r` on the FSE'26 archive is a question for that archive. §4 says how it is
  answered.

---

## 4. The measurement this iteration hands to the next one

Three steps, in this order, and each is cheap because the profile is an artifact:

1. **Build the profile once per corpus.** `pnpm exec tsx benchmarks/src/build-fault-free-profile.ts --data-dir
<corpus> --out <profile.json>`. Cost is one pass over the metrics; the output is a few hundred numbers.
2. **Run the control and one arm, on the same profile.** `--fault-free-weight 0` and `--fault-free-weight 0.3`,
   both with `--fault-free-profile <profile.json>` and `--terms-dump`, so the exchange rate is measured rather than
   searched.
3. **Read the held-out number, not the in-sample one.** `scripts/terms-fit.py --only repair` on the arm's dump gives
   the fold-generalised reading, which is the only one this project has ever shipped a weight on.

The prediction this iteration is willing to be wrong about, stated before the run: on the FSE'26 archive the prior
moves the **absent** bucket (173 cases) far more than the top-1 bucket, because the dashboard's evidence is exactly
a channel with a high fault-free frequency, and the term's whole content is that such evidence should be discounted.
If that prediction fails, the profile is measuring the wrong window.

---

## 5. Two implementation notes that are not preferences

**The scale is σ, not MAD.** The first implementation used `1.4826 × MAD` per window. On the corpora this
repository reads, a large share of channels hold one level exactly — an error count of zero, a queue depth of zero —
so an MAD of **zero** is the common case, not the tail. A median-of-positive-MADs then has no members to take a
median of and the channel is either refused (losing the cleanest evidence there is) or banded from the spread of
the window medians (which is not a scale). Switching to the window's own population σ fixes both: a channel that
never moved gets `σ = 0`, and the comparison `departure > 3σ` is strict, so **every window of it is clean** — which
is the correct reading of a channel that has never once moved, and needs no special case. Two dead guards
(`centre === undefined`, `!isFinite(acrossWindows)`) were removed with the change rather than kept as defensive
code; both were unreachable, and this repository counts an unreachable branch as dead.

**The `rarest` aggregation and the `dominant` one are two hypotheses.** `rarest` is the paper's (`min` over the
node's channels); `dominant` is this engine's own reading — the EOB of the channel the candidate's anomaly came
from, on the argument that a fact about a channel the score did not use is not evidence about the candidate. Both
are implemented (`--fault-free-selection`), because the two arguments are both sound and only the corpus can
choose, and a single spelling would have made the choice untestable.

**The profile is a second ARGUMENT, not a parsed option, and the projections must say so in their key SET.**
`buildFse26EngineOptions(opts, profile)` and `buildRCAEvalEngineOptions(opts, profile)` forward it only when one
was handed in, and the first draft assigned it unconditionally (`faultFreeProfile: profile`, `undefined` when
absent). That is the same object to the pruner — the engine's option is optional — and it is **not** the same object
to the census: `forwarded ∪ nonEngine = parsed` is asserted over key SETS, and the profile is not something the
parser produced, so a present key enters the forwarded set and breaks the partition. Six guards failed at once, in
three packages, which is how the claim was found rather than argued. The conditional spread stays, and the cost it
carries — an arm no test in the other direction can reach — is paid by one test per projection that drives both
arms, rather than by a coverage exemption.

**A parser with no `else` is the defect this repository has already paid for twice, and the new one had it too.**
The profile builder's chain ended at its last `else if`, so a mistyped `--min-sample 8` matched nothing, the sample
floor stayed at its default of three, and the artifact was a band fitted at a threshold nobody typed — a file every
later arm reads as evidence. It now refuses an unknown token by name. The reading that found it was coverage rather
than review: `fse26-cli.ts`'s own refusal had been the only uncovered line in that module too, and both were the
`else` of a chain.

---

## 6. Acceptance

**Not met, and nothing is shipped.** The iteration's own bar was a held-out `Top@1` gain on the full archive with
no fault type down. What exists instead is a measured mechanism (§2), a working coordinate at its ablation (§0), and
a reproducible three-step arm (§4) that the next iteration runs.

The honest summary of the local reading: the coordinate carries real information (r spans 0 to 1 over 138
channels), it is not a ranker (12.3 % alone), and its exchange rate against the existing twelve is small on the one
corpus this sandbox holds (90.8 % → 91.5 % across a three-value band). Everything that would make it a result is
outside this machine.
