# 338 — What each implementation contributes, and the first competitor's theorem

Iteration 338 is **¥0**. It replaces the programme's oldest missing table — the quantified contribution of each term in
the score, in the units the target is measured in — and it runs the first competitor that ships a **theorem** against
our own pool. Neither reading dispatches a model; the four published-surface ablations below are local runs against
the corpus the repository already pins.

The surface is unchanged: **1 328 / 1 422 = 93.39 %** on the arm's answers, **1 156 / 1 422 = 81.29 %** for the engine
alone, **1 073** for the score's own order.

## 1. The term ledger, and why a weight is not a contribution

Every published number in this programme is an accuracy, and every term in the score is a weight times a value. Those
two facts had never been joined. A term can carry weight `8` and decide 294 cases, and a term can carry weight `1` and
decide nothing, and until this iteration the register could not tell a reader which was which.

`benchmarks/src/term-marginal.ts` removes one term from every sum, re-orders every pool, and reports the change in
Top-1 — the **marginal**. On the shipped configuration, over the 1 422 graded cases and 69 688 candidates:

| term | weight(s) | present | max \|c\| | decided | correct | marginal | ties | role |
| ---- | --------- | ------: | --------: | ------: | ------: | -------: | ---: | ---- |
| `log` | 1.0000 | 1 000 | 1.0000 | 793 | 643 (81.08 %) | **−341** | 6 | load-bearing |
| `podState` | 8.0000 | 294 | 6.0000 | 294 | 294 (100.00 %) | **−200** | 2 | load-bearing |
| `selfAnomalyLog1p` | 1.0000 | 1 422 | 0.6931 | 1 422 | 1 073 (75.46 %) | **+5** | 60 | **tie-maker** |
| `lat` | 0.5615 | 760 | 0.5615 | 435 | 316 (72.64 %) | −58 | 2 | load-bearing |
| `failedEdge` | 0 / 3.0000 | 1 222 | 3.0000 | 108 | 95 (87.96 %) | −42 | 0 | load-bearing |
| `dualFamily` | 0.2500 | 1 003 | 0.2500 | 702 | 577 (82.19 %) | 0 | 2 | decorative |
| `stability` | 0.0074 | 1 422 | 0.0073 | 1 405 | 1 062 (75.59 %) | 0 | 0 | decorative |
| `pool` | −0.0679 | 1 422 | 0.0679 | 88 | 64 (72.73 %) | 0 | 0 | decorative |
| `source`, `temporal`, `collision`, `topo`, `rise`, `prism` | 0.0000 | 1 422 | 0.0000 | 0 | — | 0 | 0 | inert |
| `trace`, `faultFree`, `selfTime`, `emission`, `victim` | — | 0 | 0.0000 | 0 | — | 0 | 0 | inert |

Four readings change what the next plan can claim.

### 1.1 The kinetic term is a tie-maker, not the load-bearing term

`selfAnomalyLog1p` is measured on every candidate and is on every published first choice. Its marginal is **+5**: with
it removed the score-order surface is five cases *better*. That is not a gain and the ledger says so — 60 pools become
ties when the term is removed, and a tie is settled by the pool's arrival order, which is the engine's published
order. The term is, on this corpus, mostly a **tie-breaker between candidates the evidence terms cannot separate**.

The structural reason is visible in the same table: the kinetic term's whole range is `log1p(1) = 0.6931`, while a
single binary `log` bonus is worth `1.0` and a `podState` bonus up to `8.0`. The theory's own quantity is the smallest
continuous term in the score, and the two largest are evidence bonuses.

### 1.2 Two terms carry 541 of the 1 073 decisions

`log` (−341) and `podState` (−200) are worth **541** cases between them, and `podState` decides **294 cases at 100 %
precision** — the only term in the score with a perfect record on the population it fires on. `lat` (−58) and
`failedEdge` (−42) are the next two. Everything else is decorative or inert.

**Eleven of nineteen terms are inert on this corpus**: six carry weight `0.0000` and five were never measured
(`trace`, `faultFree`, `selfTime`, `emission`, `victim`). That is the shipped vector doing its job — the propagation
terms were pruned by earlier iterations — but it is also the reason §2's experiment could not work, and the register
should say so rather than rediscover it.

### 1.3 `lat` refuted the classifier, and the classifier was fixed

The first version of the ledger classified a term `decorative` when its largest possible contribution was below the
corpus's **median decision gap** (0.6277). On the real dump that rule called `lat` decorative — and removing `lat`
costs 58 cases. The bound is over the whole corpus; the cases `lat` decides are exactly the ones whose gap is
*smaller* than the median. A statistic over a heterogeneous population cannot classify a term that decides a
sub-population, so the classification is now entirely measured — `inert` (contributes nothing anywhere),
`load-bearing` (removal costs cases), `decorative` (removal changes nothing), `tie-maker` (removal helps only by
creating ties), `harmful` (removal helps outright) — and the median gap is printed as context rather than used as a
threshold.

This is the second instrument defect this programme has caught by running a new module on real data rather than on its
own fixtures (§336 caught a `NaN` read as "decided"). Both were in the *instrument*, not the product.

### 1.4 The sum's order is not the engine's order

The ledger's base is **1 073**, the order the written sum produces. The engine publishes **1 156**: two relational
passes reorder the list *after* scoring, and they are worth **83 cases**. Every marginal above is therefore a property
of the sum, not of the published answer, and the runner now prints both numbers side by side with the count of cases
on which the two orders disagree, so neither can be quoted as the other.

## 2. CIE: the first competitor with a theorem, measured and refused

*arXiv:2601.21359v2* (**Graph-Free Root Cause Analysis**) is the first competitor in this field to ship a proof. A root
deviates in its **internal** properties (resource usage) *and* in the **external** ones its neighbours observe
(latency, errors); a component that merely propagates a failure deviates externally only. A **conjunctive** score
therefore ranks the root first **provably under arbitrary amplification**, where an additive score needs a bound. On
735 failures across nine datasets from three systems it reaches **68 % Top-1**, +21 % relative over the best of twelve
baselines, at 8 ms a diagnosis.

Our score is additive, so CIE's guarantee is the conditional one; that is not in dispute. The question is whether the
conjunction **wins cases here**, and the term dump answers it for ¥0: both axes are reconstructed per candidate and
the pool is re-ranked with no engine run.

| mode | conjunctive | additive | gain | fold 0 | fold 1 |
| ---- | ----------: | -------: | ---: | -----: | -----: |
| `normMin` (min of the two normalised axes) | 800 (56.26 %) | 1 073 | **−273** | −133 | −140 |
| `normProduct` (product of the two normalised axes) | 800 (56.26 %) | 1 073 | **−273** | −135 | −138 |
| `product` (raw product) | 800 (56.26 %) | 1 073 | **−273** | −135 | −138 |

**Refused, on every mode and on both folds.** The reason is structural and it is the more valuable half of the finding:

1. **The external axis is not measured on this corpus.** Under the shipped vector the propagation terms carry weight
   `0.0000` (§1.2), so the external axis reduces to `lat` (0.5615, on 14.5 % of candidates) and `failedEdge` (3.0, on
   5.6 %). A conjunction over an axis that is zero for 85 % of the pool ranks the 15 % that carry it and discards the
   rest — 800 cases.
2. **Rebuilding the axis from the unweighted values does not rescue it.** The dump carries the *values* of `rise`,
   `temporal` and `collision` even though their weights are zero, so a faithful CIE mapping is computable: internal =
   `selfAnomalyLog1p`, external = the propagation values. Measured, `normMin` gives **745**, `normProduct` **748**,
   `product` **748** — worse, not better, and with only **2 400 of 69 688** candidates carrying any external deviation
   once `log`/`podState` are classed as internal (they describe the component itself).
3. **Adding the propagation values to the additive score is catastrophic at every weight.** The scan is flat because
   the effect is not a weight: any non-zero weight on `rise` gives **209**, on `temporal` **60**, on `collision` **80**,
   at 0.02 and at 0.4 alike. The terms are not weak — they are **anti-predictive** as written, which is why the vector
   carries them at zero, and why re-enabling them is not a route to anything.

So the axis CIE's theorem needs does not exist in our engine in a form that carries ranking signal. That is a
statement about our decomposition, not about their proof, and it names the only experiment that could reopen it:
**a pool-relative external axis** — the candidate's share of the pool's total propagated failure — rather than a
per-candidate bonus. Nothing in the current dump computes that, and it is not a weight change.

## 3. The published-surface ablations (¥0, local, no endpoint)

The nine runs below are the engine on the full corpus with one weight moved, `--data-dir ~/rcabench/json`, no
endpoint, six of them dispatched concurrently. The baseline reproduces the published artifact **byte for byte**
(`sha256 da336800ec7c0ce1…`, `0.8129395218002813` = 1 156 / 1 422), so every delta is attributable to the flag. The
repairs/breaks column counts the cases whose published first choice changed to a correct one and to an incorrect one.

| configuration | flag | Top@1 | delta | repairs / breaks | folds |
| ------------- | ---- | ----: | ----: | ---------------: | ----- |
| shipped | — | **1 156** (81.29 %) | — | — | — |
| kinetic term off | `--self-anomaly-weight 0` | 1 158 (81.43 %) | +2 | 16 / 14 | +2 / 0 |
| kinetic term halved | `--self-anomaly-weight 0.5` | **1 159** (81.50 %) | **+3** | 5 / 2 | +1 / +2 |
| kinetic term doubled | `--self-anomaly-weight 2` | 1 119 (78.69 %) | **−37** | 0 / 37 | −19 / −18 |
| log evidence doubled | `--log-weight 2` | 1 148 (80.73 %) | −8 | 4 / 12 | −5 / −3 |
| latency channel off | `--lat-weight 0` | 1 086 (76.37 %) | **−70** | 3 / 73 | −34 / −36 |
| failing-edge term off | `--failed-edge-weight 0` | 1 110 (78.06 %) | **−46** | 0 / 46 | −22 / −24 |
| pod state at 4 | `--pod-state-weight 4` | 1 155 (81.22 %) | −1 | 0 / 1 | −1 / 0 |
| both decorative terms off | `--dual-family-weight 0 --stability-weight 0` | 1 156 (81.29 %) | 0 | 6 / 6 | +1 / −1 |

Five readings, and the asymmetry between them is the finding.

1. **`lat` and `failedEdge` are load-bearing in one direction only.** Removing them repairs 3 and 0 cases and breaks
   **73** and **46**. A term whose removal is almost pure loss is doing work no other term does.
2. **`podState` is at a plateau.** Halving an 8.0 bonus changes **one** case. The term's value is in its presence, not
   its magnitude.
3. **The two decorative terms are exactly neutral**: 6 repairs and 6 breaks, 81 cases moved, net **0** — which is what
   §1's `decorative` role predicted, and the first time a role has been confirmed by an independent instrument.
4. **The log bonus is at its right scale**: doubling it repairs 4 and breaks 12.
5. **The kinetic term has an interior optimum and a cliff.** Doubling it repairs **nothing** and breaks **37**; halving
   it repairs 5 and breaks 2. The shipped weight of 1.0 therefore sits just inside the cliff, and 0.5 is both slightly
   better (+3, positive in both folds) and far more robust. The +3 is small — seven flips, 5 to 2 — and is recorded as
   a *calibration* reading, not as a gain: the strong half of the evidence is the −37 with zero repairs, which says the
   weight is over-tuned against a cliff rather than under-tuned.

## 4. Cost

| item | cost |
| ---- | ---- |
| term ledger (two artifacts, re-summation) | **¥0** |
| CIE conjunction, three modes + faithful mapping | **¥0** |
| seven published-surface ablations (local, no endpoint) | **¥0** |
| **iteration total** | **¥0** |

## 5. Reproduce

```bash
# The ledger, with the published headline beside the sum's order (¥0, seconds).
npx tsx benchmarks/src/run-term-marginal.ts \
  --terms <terms.ndjson> --answers <query-agent.ndjson> --cases <per-case.ndjson>

# The first competitor's theorem, on our pool (¥0, seconds).
npx tsx benchmarks/src/run-conjunctive.ts \
  --terms <terms.ndjson> --answers <query-agent.ndjson>

# One ablation (¥0 in tokens, ~16 min of CPU, no endpoint).
npx tsx benchmarks/src/run-fse26.ts \
  --data-dir "$HOME/rcabench/json" --fault-free-profile "$HOME/fault-free-profile.json" \
  --self-anomaly-weight 0 \
  --per-case-out /tmp/art338/self0/per-case.ndjson --output /tmp/art338/self0/results.json
```

## 6. What this does not close

1. **The 1 328 surface is untouched.** The ledger prices implementations; it does not add a case. The arm's 94 misses
   are unchanged, and §337's four refusals stand.
2. **A weight change is not shippable on this evidence.** `--self-anomaly-weight 0.5` is +3 cases on the engine's own
   surface and positive in both folds, but the arm's answers were produced from the shipped engine, so the *published*
   1 328 cannot be verified without a dispatch, and seven flips are not a mandate. What the ladder does establish is
   that the shipped weight sits just inside a cliff (×2 costs 37 cases and repairs none), which is a robustness
   argument for 0.5 that the next dispatch can settle for ≈¥21.
3. **The external axis remains unbuilt.** §2's conclusion is a specification, not a result: the pool-relative
   propagation share has to be computed by the engine before the conjunction can be tested for real.
