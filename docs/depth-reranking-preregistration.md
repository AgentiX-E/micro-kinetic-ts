# Pre-registration: the depth re-ranking axis, and how it is allowed to fail

**Written 2026-11-13, before any measurement of it.** Iteration 270 established two facts that make this the next
axis and closed two that would have made it a repeat: the corpus answer sits somewhere in the order in 106 of 106
sampled cases (median miss depth 4, maximum 42), and the fingerprint's own columns — onset, band deviation,
fault-free rate, channel count — do **not** separate the source from the wrong leader over the 176 cases an
eliminator can fix (`docs/agentic-headroom.md` §10). So the question is no longer "can a layer reorder the top
five"; it is "**which term paid for the lead a symptom holds over the source**, and is that term's sign stable
enough across cases to be corrected".

## 1. The hypothesis, stated so it can be wrong

A deep miss is not a close call. In the cases at depth 6–42 the engine put a symptom several lines above the
source, and every candidate's score is a **sum of named terms** whose `(weight, slope)` pairs the engine already
attaches (`--terms-dump`). The hypothesis:

> **H1.** For a deep miss, the leader's advantage over the truth is concentrated in a SMALL set of terms — at most
> three of the eighteen — and the same terms carry it in a majority of deep misses within a fault family.

H1 is what would make a correction possible without a model: a term that is systematically mispaid on a family is
a defect in that term's slope, not a weighting to be tuned.

> **H1′ (the alternative, and it is the likely one).** The advantage is spread across many terms with no stable
> sign, i.e. each deep miss is its own story. Under H1′ the term axis closes and the model arm is the only
> remaining route to the depth headroom.

## 2. The measurement

Population: the **176 `top5` cases and the sampled deep cases** from the depth artifact, joined to a terms dump of
the same run. For each case:

1. take the leader `L = order[0]` and the first truth `T = order[depth]`;
2. compute `Δt = slope_t(T) − slope_t(L)` for every term `t` present on either candidate, and `Δscore = score(T) − score(L)`;
3. record the **sign** of `Δt` and its share of `|Δscore|`.

The statistic is, per term: **the fraction of deep cases in which `Δt > 0`** (the term favours the truth). Under a
null of no signal that fraction is 0.5.

## 3. Thresholds, fixed now

| quantity                    | value                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| significance                | exact binomial, two-sided, **Bonferroni over the 18 terms → α = 0.0028** |
| minimum effect to act on a term | `Δt > 0` in **≥ 65 %** of a family's deep cases, with n ≥ 20        |
| held-out rule               | the family is split by `hashId(case) % 2`; the sign is fitted on `in` and read on `out` |
| corpus-level gate           | Top@1 must not fall on either half, and no fault family with n ≥ 20 may lose a case that the shipped run answered |
| cost                        | one dispatch, `--depth-out` + `--terms-dump` on the full corpus      |

The corpus-level gate is the one every accepted change in this repository has had to clear; the family-level
non-regression is the one that refused the fitted weight vector in iteration 262 (+114 held out, three shapes
traded, worth one admissible case).

## 4. The kill criterion, written before the data

**If no term reaches 65 % in any family with n ≥ 20, H1 is refused and the term axis is closed** — recorded in
`closed-axes-register.md` with the counts, not deferred. The depth headroom then belongs to a model arm over a
twenty-wide presentation, priced at the ledger's own rate rather than at prose, and the elimination layer's
`maxCandidates` becomes the parameter that arm is measured at.

A partial result — one or two families clear, the rest do not — is a **per-family term correction**, which is a
different design from a global weight and has to be measured as one: the correction applies where the family says
so, and its cost is the families it cannot speak about.

## 5. What this pre-registration does NOT permit

1. It does not permit re-opening `faultFreeWeight` in any form: the fingerprint column that failed as a decider
   stays a column.
2. It does not permit a threshold fitted on the whole corpus and reported as held out; the split is
   `hashId(case) % 2` and is stated with every number.
3. It does not permit a term whose sign is fitted per CASE (the LP bound's 99.30 % is an upper bound over
   per-case vectors and is not achievable by any fixed rule — `PROGRESS_2026-11-12.md` §4).
