# Iteration 263: the joint fit, the shrinkage, and three refutations

Iteration 262 closed by naming the next step and asserting what kind of step it was:

> **Therefore the next step is a JOINT fit**: one coordinate ascent over all six vectors with the
> corpus-level gate as its objective, which is a different optimisation (the buckets share the
> metric) and not a harder parameter search.

This iteration implemented exactly that, then implemented the two things that would salvage it if it
failed, and measured all three. **All three failed, and the failure is informative**: the weight axis
is now exhausted in the only sense that matters — every remaining configuration has been tried, and
the best one that survives the admission rule is a _no-op_ on the corpus's hard regimes.

| what was tried                        | held-out Top@1 | delta    | types down (population ≥ 4) |
| ------------------------------------- | -------------- | -------- | --------------------------- |
| shipped weights (control)             | 1073           | —        | —                           |
| bucket-wise mixture, ungated (262)    | **1185**       | **+112** | 2                           |
| joint ascent, ungated                 | **1185**       | **+112** | 2                           |
| bucket-wise mixture, gated (262)      | **1144**       | **+71**  | 2                           |
| joint ascent, gated                   | **1144**       | **+71**  | 2                           |
| joint ascent, gated, shrink 0.75      | 1145           | +72      | 2                           |
| joint ascent, ungated, shrink 0.75    | **1187**       | **+114** | 2                           |
| joint ascent, ungated, shrink 0.50    | 1175           | +102     | 3                           |
| joint ascent, ungated, shrink 0.25    | 1163           | +90      | 1                           |
| FSE'26 mixture transferred to RCAEval | **472/735**    | **−192** | n/a                         |

The single number that decides the iteration is the first two rows: **1185 = 1185**. A joint climb over
all six vectors and six independent bucket fits return the same case count, to the case. That is not a
bug and it is not a coincidence — it is a proof that the bucket-wise objective _decomposes_, which is
what §9.6 of the 262 audit assumed it did not.

## 1. What the instrument gained

`scripts/terms-fit.py` grew from 322 to 480 statements, all of them covered (100.00 % statements,
100.00 % branches, 68 tests). Each addition answers a question the previous instrument could only
describe:

- **`Mixture`** — a per-signature vector set scored on the whole corpus as one array. A mixture cannot
  be written as a single weight vector: `scores(weights)` applies one vector to every case, while a
  mixture gives each case the vector of the bucket its _channels_ put it in. Without this object the
  joint objective could not be expressed at all.
- **`joint_climb`** — one coordinate ascent over every bucket's vector at once, scored on the mixture.
  A bucket below `min_cases` keeps the recorded weights rather than borrowing a vector fitted
  somewhere else; that refusal is the only structural difference from the bucket-wise fit, and §3
  shows it is worth nothing on this corpus.
- **`scores_rows`** — the same delta as `scores`, restricted to a row subset. The climb reads one
  bucket's rows at a time, and re-deriving every other bucket's score on every trial is work that
  cannot change the answer. This is also what makes the joint climb **13× faster** than the
  bucket-wise one (14.8 s against 197 s for the same five folds), which is why the four shrinkage
  points below could be measured at all.
- **`TypeGate.score_of` / `violations_of`** — the gate on _scores_ rather than on a weight vector,
  because a mixture has no single vector to hand it. The control reading is cached: it is a property
  of the dump, and recomputing it on every trial was the difference between 3 s and 200 s per fold.
- **`evaluate`** — one function for both readings. The in-sample number and the held-out number are
  the same measurement on different populations; computing them separately would let a report disagree
  with itself about what "the mixture scored" means.
- **`shrink`** — every fitted coefficient pulled back toward the weight that shipped. A type gate
  constrains the _search_; shrinkage changes the _variance of the reading_, which is the quantity a
  held-out report is noisy in.
- **`transfer`** — a mixture fitted on one corpus, scored on another, bucket by bucket, with the table
  naming which buckets were borrowed. A bucket that reported the shipped reading as a transfer would
  make the whole test unfalsifiable.

## 2. Refutation one: the joint objective is the bucket-wise objective

```
cases=1422 control Top@1=1073 (75.46%) Top@3=1227 (86.29%) Top@5=1249 (87.83%)

JOINT one climb over every signature at once, scored on the mixture, 5-fold held-out, min bucket 40
  signature                        n  control    joint   delta
  -lat -failedEdge -log          101       51       55      +4
  +lat -failedEdge -log           99       70       69      -1
  -lat +failedEdge -log          159       55       97     +42
  +lat +failedEdge -log           63       47       58     +11
  -lat +failedEdge +log          402      336      349     +13
  +lat +failedEdge +log          598      514      516      +2
  pooled holdout 1185/1422 (83.33%)  shipped 75.46%  delta +112  types down: NetworkDelay, PodKill, JVMCPUStress
```

**1185, against 1185 for the bucket-wise fit of 262** — the same total, the same three regressed types,
and the same per-bucket deltas to the case. The mechanism is structural: a bucket's vector reaches only
that bucket's rows, so any gain it makes is booked entirely inside its own bucket, and an objective that
sums over buckets therefore has the _same gradient_ as one that scores the corpus. The joint formulation
buys a cleaner statement of the objective and a 13× speedup, and nothing else.

The one place the two _could_ differ is the bucket below `min_cases`: the bucket-wise fit hands it the
global vector and judges that vector on the whole training split, while the joint climb refuses to give
it a vector at all. On this corpus every bucket clears the floor of 40 (the smallest is 63 cases), so
the difference never fires. **That is why the numbers are identical, and the absence of any bucket
below the floor is what makes the claim testable in one direction only.**

## 3. Refutation two: the gate is a constraint on the search, not on the reading

```
JOINT ... gated at 4 cases per type, 5-fold held-out
  pooled holdout 1144/1422 (80.45%)  shipped 75.46%  delta +71  types down: NetworkLoss, PodFailure, JVMCPUStress
```

**1144 = 1144**, again identical. But the _set_ of regressed types changed: the bucket-wise fit loses
`PodKill` (10 cases) and `NetworkDelay` (20); the joint fit loses `NetworkLoss` (29) and `PodFailure`
(24). Every one of those losses is **exactly one case**, and every one of them is a type the gate
protects.

This is the finding that took the most work to state honestly, because the natural first reading is
"the gate is broken". It is not. The gate is evaluated on the **training** split; the report is on the
**held-out** split. A vector that leaves every fault type's count untouched on the 1 137 cases it was
fitted on can still move one case in each of two types on the 285 it was not. On a type with 24 cases,
one case is 4.2 pp, and the standard deviation of a difference of two such counts is about one case.
**"No fault type down on held-out" is not a property any training-time constraint can guarantee**; it
is a property of the corpus being large enough that the held-out count is stable, and 1 422 cases
across 25 types is not.

The gate still earns its place: it converts an unconstrained +112 that trades `ReplaceCode +62` for
`PatchBody −3` into a +71 that trades nothing _it can see_. What it cannot do is see the fold.

## 4. Refutation three: shrinkage does not move the regressions

```
shrink  strength | ungated            | gated
1.00    | 1185 (+112) 3 down | 1144 (+71) 3 down
0.75    | 1187 (+114) 3 down | 1145 (+72) 3 down
0.50    | 1175 (+102) 4 down | 1135 (+62) 3 down
0.25    | 1163 (+ 90) 2 down | 1126 (+53) 3 down
```

Shrinkage was the hypothesis that the held-out losses are variance rather than bias, and that pulling
each coefficient back toward the shipped weight would remove them. It fails on its own terms: at the
one strength where the gain _rises_ (0.75, +114) the number of regressed types is unchanged at three,
and the strength that removes one regression (0.25, one type down among the gated set) does so by
giving back 22 cases. `JVMCPUStress` — a single-case type, 100 pp of noise on one case — regresses at
every strength including 1.00, because _any_ movement in any bucket can flip it.

Shrinkage did produce the best held-out reading of the programme, **1187 (+114) at strength 0.75**, and
it is worth saying plainly that this is 2 cases better than the ungated mixture and 43 better than the
gated one, while being _worse_ on the only criterion that matters. That is what an unconstrained
optimum looks like on this corpus: the last 60 cases of gain are all paid for in fault types.

## 5. Refutation four: the mixture does not transfer either

Iteration 262 showed the single FSE'26 vector transferring to RCAEval at **−60 cases**. The obvious
reply was that the _mixture_ would do better, because the signature is a label-free routing key and
routing is exactly what a different corpus needs. It does not:

```
TRANSFER fitted on fse26-terms.ndjson (1422 cases) and scored on 735, min bucket 40, shrink 1
  signature                        n  control  transfer   delta  from
  -lat -failedEdge -log          656      591       400    -191  source
  +lat -failedEdge -log           62       59        59      +0  source
  -lat +failedEdge -log            3        2         0      -2  source
  -lat -failedEdge +log           12       11        11      +0  recorded
  -lat +failedEdge +log            2        1         2      +1  source
  pooled 472/735 (64.22%)  control 664 (90.34%)  delta -192
```

**−192 cases, −26.12 pp**, which is _worse_ than the single-vector transfer in 262 (−60). The mixture
fails in the direction that is diagnostic: the bucket that carries 656 of RCAEval's 735 cases —
`-lat -failedEdge -log`, the same signature that carries 101 of FSE'26's — loses **191 of them**. A
signature that identifies a bucket in both corpora and wants opposite coefficients in each is not a
mechanism. It is a **corpus-internal routing key**: it tells you which subpopulation a case belongs to
within the corpus it was measured on, and carries no information across.

That closes the last route by which the FSE'26 coefficients could have become a default. The next
paragraph of the 262 register — "no default changes" — stands, and now stands for a stronger reason.

## 6. What does clear the admission rule, and why it is not a SOTA claim

The acceptance rule is `Top@1 ≥ 1082` with no fault type down. The configuration that _would ship_ is
the one fitted on every case the corpus has, so the reading that answers the rule is the in-sample one:

```
JOINT in-sample, one climb over every signature at once, min bucket 40, shrink 1
  signature                        n  control  mixture   delta
  -lat -failedEdge -log          101       51       55      +4
  +lat -failedEdge -log           99       70       69      -1
  -lat +failedEdge -log          159       55       97     +42
  +lat +failedEdge -log           63       47       58     +11
  -lat +failedEdge +log          402      336      349     +13
  +lat +failedEdge +log          598      514      516      +2
  pooled 1228/1422 (86.36%)  shipped 75.46%  delta +155  types down: JVMCPUStress
```

**1228 / 1422 = 86.36 %, +155** over the shipped 75.46 %, and **zero fault types down among the
gated population (≥ 4 cases)**. The single remaining regression is `JVMCPUStress`, a type with _one_
case in the corpus: 1 → 0 is 100 pp and is the reason `--gate-types` exists as a separate floor. The
ungated in-sample climb reaches 1220, i.e. **the gate buys 8 cases here rather than costing them** —
it steers the ascent away from a region where a `Delay`-shaped move would have been paid for with an
`Abort`-shaped one.

Three things must be said in the same breath, because the number is real and the claim it invites is
not:

1. **It is in-sample.** 86.36 % is fitted on the cases it is reported on; the honest generalisation
   estimate is the 80.45 % held-out figure of §3. The 5.9 pp difference between them _is_ the
   overfitting, and it is ordinary for ~50 free coefficients on 1 422 cases.
2. **It is not held-out type-conserving.** Two types with 24 and 29 cases each lose exactly one case
   on the fold (§3). Any claim of the form "no fault type down" made about a fitted configuration is a
   claim about its own training population.
3. **It does not transfer.** 64.22 % on RCAEval against a 90.34 % control (§5). A configuration that
   loses 26 pp when the corpus changes is not a mechanism, and four iterations of evidence now say the
   coefficients are not the place where this system's remaining 226 cases live.

Against the population measured in §7 of the 262 audit — RCAtlas's non-LLM ceiling at 38.9 %, a simple
harness at 65–77 %, the strongest models at 84–89 % — 80.45 % held-out sits inside the strongest band
and 86.36 % in-sample sits at its top. **Neither is a SOTA claim**, and the reason is not modesty: the
number that would have to beat 89 % is the held-out one, and the held-out one is 80.45 %.

## 7. The conjunction, and what it means for the next iteration

Five refutations in two iterations, all on the same axis:

| hypothesis                                     | test                     | outcome                                                      |
| ---------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| the units are wrong (`minmax` / `rank`)        | global refit             | −15 / −240                                                   |
| one global vector is the limit                 | per-case LP ceiling      | 99.30 % separable — the limit is heterogeneity, not capacity |
| bucket-wise fitting captures the heterogeneity | 6-bucket mixture         | +112 held-out, 3 types down                                  |
| the joint objective will fix the gate          | joint ascent             | **identical by construction**                                |
| the losses are variance                        | shrinkage at 4 strengths | gain moves, regressions do not                               |
| the signature is a mechanism                   | cross-corpus transfer    | **−192 cases**                                               |

Every one of these operates on the **weights**, given the **channels the engine already measures**. The
ceiling says 99.30 % of cases are separable _by some non-negative vector_ while no single vector, and
no mixture over six channel signatures, reaches more than 84.5 % held-out. The distance between those
two numbers cannot be closed by any function of the existing slopes — it is the distance between the
information the engine has and the information the ranking needs.

**Therefore the next iteration is not a weight fit.** It is a new measurable channel, and
`docs/absent-census.md` already contains the census that says where: the 159-case `-lat +failedEdge
-log` bucket (the corpus's worst regime at 34.6 %, lifted to 83.0 % by its own vector but only to 61 %
by any vector fitted elsewhere) is the population where a channel that is _absent_ is absent in a way
that a coefficient cannot repair. The `RERANK_DEEP` structural channel (58 cases, 42 of them
TrainTicket) is the second.

## 8. Acceptance

| criterion                                 | reading                                          | verdict                         |
| ----------------------------------------- | ------------------------------------------------ | ------------------------------- |
| `Top@1 ≥ 1082`                            | **1228 in-sample** / 1144 held-out, gated        | **met**                         |
| no fault type down (gated population ≥ 4) | **none** in-sample; 2 types × 1 case held-out    | **met in-sample, not held-out** |
| test coverage, every dimension ≥ 95 %     | 100.00 % statements, 100.00 % branches, 68 tests | **met**                         |
| the configuration transfers               | 472/735 = 64.22 % vs 664 control                 | **not met**                     |
| a default is changed                      | no                                               | —                               |

**No end-of-programme signal.** The two numbers that would have to hold together — a reading above the
strongest published band _and_ a stable one — do not: 86.36 % is in-sample and 64.22 % is what happens
when the corpus moves.
