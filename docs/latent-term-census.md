# The weight a term would need, measured on one run

`finalScore` is a sum of sixteen terms and **fourteen of them ship at weight 0**. Each was measured once, on one
cell, at a handful of weights, and rejected — and what each rejection recorded was a table of accuracies. That is a
measurement of the **arm**, not of the **term**: it says "at this weight the cell moved like this", and it cannot
separate the four things the corpus knows — whether the term pointed the right way on the misses at all, how far it
had to move to win one back, how far it could move before a correct case was lost, and whether it had an input.

The reason none of that had ever been asked is one line of arithmetic. A term's contribution is

    contribution = weight × value

and the artifact recorded the **product** only. `weight === 0` and `value === 0` therefore produce the same zero, so
a term that was switched off and a term that read nothing were the same record, and "this term would have added 0.4
here" was invisible in every file this repository writes. Fourteen rows of `WEIGHT_ZERO` with no number beside them
is what that costs: an axis with fourteen positions and no way to order them.

## 1. The two factors, and what makes the counterfactual exact

`ScoreTerm` now carries `weight` (the formula's own factor, sign included, so `collision`, `pool` and `victim` read
negative because they are subtracted) and `slope` (the value it multiplied), present together **exactly where the
term read a measurement**:

| presence of the input | `weight` | `slope` | reading |
| --- | --- | --- | --- |
| `PRESENT` | present | present | the term read something; a weight change moves this candidate by `Δw × slope` |
| `ENTRY_ABSENT` | absent | absent | this candidate has no measurement — not the same claim as a measured zero |
| `MAP_EMPTY` / `MAP_ABSENT` | absent | absent | the producer emitted nothing, or never ran |

The counterfactual is exact **because of what a breakdown is**, not because of an assumption about the engine: every
entry is `weight × value`, so changing a weight moves that entry by `Δw × value` and moves nothing else. The claim
therefore covers the sixteen terms and **not** an operator that runs between them — the topological deduction
rescales the anomaly the base term reads before any term is assembled, so it is not a member of the list and cannot
be read through one. A term whose weight also decides *which candidates exist* (a gate that admits or refuses) is
affine only conditional on the population it admitted; the numbers below are computed on the population the run had.

## 2. The two numbers

For one term `t`, one candidate and one weight `w₀`:

- **On a miss**, the truth needs `w > w₀ + gap / (slope_truth − slope_rival)` to be placed above that rival. Finite
  only when the term reads the truth HIGHER than the rival, which is "the term points the right way" expressed as a
  number rather than as an opinion. The requirement is the **maximum** over every rival above the truth: passing the
  recorded winner and leaving the truth third is not winning the case.
- **On a correct case**, a rival takes the truth's place at `w > w₀ + margin / (slope_rival − slope_truth)`. The
  smallest such bound over a cell is its **cap** — the weight at which the term costs the cell its first case.

A term that wins `k` misses strictly below its cap gains `k` net cases, and every term can be compared on that one
number. The cap is computed from the cell's own correct cases rather than from a tolerance, which is what makes the
reading a measurement of *this* corpus.

## 3. Both bounds were wrong in the optimistic direction, and the arms said so

The first implementation bounded the requirement against the recorded winner and the cap against the runner-up. Two
arms measured what that costs:

| cell | term | prediction (winner / runner-up only) | arm | what happened |
| --- | --- | --- | --- | --- |
| RE3-SockShop | `prism` | 2 recoverable below cap `0.396` | `prismWeight = 0.30` → **64.6%** (+1, −1) | the case it lost was broken by a candidate two places down |
| RE1-OnlineBoutique | `temporal` | 2 recoverable below cap `0.123` | `temporalWeight = 0.02` → **86.4%** (+1) | the second case needs a third rival passed as well |

Both bounds were then taken over the whole ranking (`rankedTerms`, carried by reference from the run), and the census
now reproduces both arms exactly:

| cell | reading | arm |
| --- | --- | --- |
| RE1-OnlineBoutique | `temporal=1(0.123,0.016)` — one case, any weight in (0.016, 0.123) | +1 at 0.02, 0.05 and 0.10; unchanged from 0.02 to 0.10 |
| RE3-SockShop | `prism=0(0.158,0.263)` — the cap is BELOW the cheapest requirement, so no safe weight exists | +1 −1 at 0.30: the gain is real, the loss is the cap |

The second row is the more useful one. A window of width zero is a term that cannot be shipped **at any weight**, and
that is a different decision from "rejected at 0.25, 0.5 and 1.0".

## 4. What the two cells say today

Shipped configuration, 125 + 30 cases:

```
RE1:OnlineBoutique  [latent] misses=17 guarded=107 unmeasured=1
                    | win:  temporal=1(0.123,0.016) topo=1(0.215,0.028) selfAnomalyLog1p=1(1.971,1.152)
                    | shut: source(cap=0.003,need=0.033) prism(cap=0.016,need=0.072)
                            stability(cap=0.019,need=0.399) +3
RE3:SockShop        [latent] misses=12 guarded=18
                    | win:  none
                    | shut: rise(cap=0.024,need=0.108) source(cap=0.031,need=0.077)
                            topo(cap=0.053,need=0.527) +6
```

Read as arithmetic rather than as a leaderboard:

- **RE1:OnlineBoutique** has exactly **one** free case in the entire formula, and it is the injection-anchored
  temporal prior at a weight between 0.016 and 0.123. `topo` is also worth one case but its window opens at 0.028 and
  closes at 0.215, so the two cannot both be taken to their ceilings at one weight without checking the joint effect.
- **RE3:SockShop** has **no** free case: `win: none`. Every dormant term sits in `shut:` with its cap below its
  cheapest requirement — the widest window on the cell belongs to `rise`, and it opens at 0.108 against a cap of
  0.024.

That is the honest statement of where the ranking stands: on these two cells the sixteen-term formula is not
under-tuned, it is **out of separating evidence**. It is also the per-term form of what
`closed-axes-register.md` states from the other end — that the obstacle is *conflict between cases*, demands for
opposite weightings that no single weight can serve at once. An empty window **is** that conflict, localized: the
cap is the first case demanding less weight and the requirement is the first case demanding more, and the interval
between them is empty. `selfAnomalyLog1p` needs a weight of 1.152 against a cap of 1.971
on the one RE1 miss it could recover — i.e. the base term would have to be more than doubled to beat the magnitude
advantage of the winner, which is the same finding the loss census records from the other side: the truth's own
deviation is a tenth of its caller's on 7 of RE1's 18 misses.

## 5. Where this sits against the 2026 literature

The 2026 NeurIPS Evaluations & Datasets paper *Where Root Cause Analysis Fails: A Retrieval-Reranking Decomposition*
(arXiv:2609.36686, code at `cruiseresearchgroup/DecompRCA`) argues the metric-level version of the same thing:
`top@k` conflates "the cause was never in the pool" with "the cause was in the pool and ranked too low", and on
microservice benchmarks the first is nearly solved (98–100%) while the second is where the loss lives. Their answer
is a two-stage pipeline — multi-signal retrieval (magnitude, **earliest onset**, discrete state change) then an LLM
reranker with a system-description document — reported as matching or beating the best baseline's `top@1` on all six
suites.

Two things follow for this repository, and one of them is uncomfortable:

1. The decomposition is the right frame and this project's numbers agree with it: on RCAEval the truth is in the top
   five 91.2% of the time and ranked first 87.2% of the time, so the remaining gap is a **reranking** gap. The
   latent census is the first artifact here that measures the reranking side term by term instead of arm by arm.
2. "Earliest onset" is one of their three retrieval signals, and on these two cells the temporal prior is also the
   only dormant term with a free window — which is a convergent result, from a completely different method, that the
   onset order carries information the magnitudes do not.

## 6. Limits, stated rather than discovered later

- The caps are computed on the population the run admitted. A knob that changes admission (a gate, a threshold that
  removes candidates) is not affine and is out of scope here.
- The census is per cell. A weight is global, so the shippable window is the **intersection** over the nine cells,
  and this sandbox can see two of them — which is why the line prints per cell in every battery rather than being
  reconstructed offline.
- A term whose `slope` is absent on both sides of a case contributes nothing to that case, and a term may be absent
  from a cell's list entirely because it could not move any of that cell's misses. Both are different statements
  from "a narrow window": the first is printed in the `shut:` segment as `need=none` when the term carries a cap,
  and omitted altogether when it carries none — because a term with no cap and no requirement cannot cost this cell
  anything either, which is `inert` rather than `closed` (§8).

## 7. The first arm the census predicted, and the cell it did not warn about

`temporalWeight = 0.02` was dispatched against a control on the same commit (`6bd27da3`): control `41172335109` at
0.0, arm `41172340473` at 0.02. The control reproduced the shipped nine cells **exactly** — 85.6 / 93.6 / 84.8 on
RE1 and 88.9 / 63.6 / 74.5 on RE3, six of six identical to the push battery's own numbers — so the arm's differences
are the weight's and not a second sample's:

| cell | control | arm (0.02) | Δ |
| --- | --- | --- | --- |
| RE1-OnlineBoutique | 85.6 | **86.4** | +1 case (LOSS 52.0 → 56.0) |
| RE1-SockShop | 93.6 | 93.6 | 0 |
| RE1-TrainTicket | 84.8 | **85.6** | +1 case (LOSS 48.0 → 52.0) |
| RE3-OnlineBoutique | 88.9 | 88.9 | 0 |
| RE3-SockShop | 63.6 | 63.6 | 0 |
| RE3-TrainTicket | 74.5 | **71.0** | −1 case (CPU 100.0 → 85.7) |

Both gains were predicted. §4 read `temporal=1(0.123,0.016)` on RE1-OnlineBoutique and `temporal=3(0.069,0.017)` on
RE1-TrainTicket: the windows overlap on **[0.017, 0.069)**, 0.02 sits at the floor of that overlap, and one case per
cell is what a weight at the floor buys. The loss was **not** predicted, and the reason is the subject of §8.

The trade is +2 for −1, and the criterion this axis was registered against is *ship only on a zero-regression body*,
so it does not ship — but the number worth recording is not the net. It is that the term **points the right way on 17
misses and the wrong way on 33** of the 50 decided ones, with the split being a property of the cell rather than of
the case (RE1 decides 29 and the term is right on 14 of them; RE3 decides 21 and it is right on 3):

| cell | misses | right | wrong | no input | cheapest requirement |
| --- | --- | --- | --- | --- | --- |
| RE1-OnlineBoutique | 18 | 5 | 7 | 6 | 0.016 |
| RE1-SockShop | 8 | 0 | 2 | 6 | — |
| RE1-TrainTicket | 19 | 9 | 6 | 4 | 0.017 |
| RE3-OnlineBoutique | 5 | 1 | 0 | 4 | 0.172 |
| RE3-SockShop | 12 | 2 | 10 | 0 | 0.905 |
| RE3-TrainTicket | 8 | **0** | 8 | 0 | — |

**A term can be net-positive while pointing right one miss in three.** The arm gained two cases because a
gain requires the term to be right only where the gap is CHEAP — 0.016 and 0.017 on the two RE1 cells — while the
cases where it is wrong carry gaps large enough that 0.02 does not reach them. That is the whole reason "is the prior
accurate?" was the wrong question: accuracy weights every miss equally, and a weight change does not.

RE3-TrainTicket is where the asymmetry turns into a loss. The term reads the truth higher than the winner on **0 of 8**
misses, so its window there is empty at every weight — and a weight above its cap is pure risk with no upside. 0.02 is
above that cap, and one case was the price. The axis therefore closes as a global constant; what it waits on is a
per-case discriminator that recognises the RE1-like onset signature before the weight is applied, which is the same
conclusion `closed-axes-register.md` reaches for the pool family and for PRISM's pooling.

## 8. Two segments, because a filter that prints only the wins hides the cost

§4 printed one segment, the head of the terms with `flips > 0`. That filter is why the RE3-TrainTicket loss arrived as
a surprise: the term that decided the arm has **no** reachable miss there, so it had no requirement to print and was
removed before the head was taken — and the one number that said "do not dispatch here" was `cap`, which the line
could not carry for a term with no requirement.

The line now has two segments, and the second is ordered by the smallest cap rather than by gain:

```
[latent] misses=17 guarded=107 unmeasured=1
         | win: temporal=1(0.123,0.016) topo=1(0.215,0.028) ...
         | shut: source(cap=0.005,need=0.033) rise(cap=0.019,need=0.048) ...
```

- `win:` answers *what is a dispatch on this cell worth* — a term, a count of free cases, and the interval it is free
  in. Unchanged.
- `shut:` answers *what does a dispatch on this cell cost* — the term's cap, and its cheapest requirement when it has
  one. `need=none` is the strongest reading on the line: a price with no upside at any weight.

Three are printed and the rest are counted (`+N`), because the question this segment answers has one number in it —
the smallest cap, the cell's weight budget — and a silently truncated list would let a reader believe the tail does
not exist. A cell that lost nothing but guarded its cases now prints too: every term in it is closed, so `shut:` is
that cell's entire budget, which is the most useful thing a perfect cell can say.

The two runs also cross-validate the reading against the artifact: recomputing each miss's requirement offline from
`top1Terms` + `truthEvidence` reproduces the in-run `temporal=1(0.123,0.016)` and `temporal=3(0.069,0.017)` to the
printed digit. The census is a function of what the run wrote down, not of the run that wrote it — which is what makes
it usable on a battery whose artifacts are the only thing kept.
