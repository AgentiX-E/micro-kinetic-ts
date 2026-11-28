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

The dump carries every channel, so the external axis is not one object — it is a **specification**, and four of them
are worth reading. All four are printed by `run-conjunctive.ts` from the same dump, and every reading carries its own
specification line (`ConjunctionReading.spec`), because two specifications of the same rule give different numbers and
a table that cannot name its own axis can be quoted as another table:

| external axis | basis | normMin | normProduct | product | candidates with a positive external deviation |
| ------------- | ----- | ------: | ----------: | ------: | --------------------------------------------: |
| the eight external channels, shipped weights | `weighted` | 800 (56.26 %) | 800 (56.26 %) | 800 (56.26 %) | 15 % (`lat`, `failedEdge` only) |
| the same eight, at their measured values | `raw` | **492** (34.60 %) | 499 (35.09 %) | 499 (35.09 %) | 53 893 / 69 688 |
| propagated failure only — `rise`, `temporal`, `collision` | `raw` | 193 (13.57 %) | 199 (13.99 %) | 199 (13.99 %) | 53 693 / 69 688 |
| downstream `rise` only | `raw` | 190 (13.36 %) | 201 (14.14 %) | 201 (14.14 %) | 38 417 / 69 688 |

Additive reference: the written sum's own order, **1 073 (75.46 %)**.

**Refused under every specification, on every mode and on both folds.** On the shipped specification the fold split is
−133 / −140, −135 / −138 and −135 / −138. The reason is structural and it is the more valuable half of the finding:

1. **The external axis is not measured on this corpus.** Under the shipped vector the propagation terms carry weight
   `0.0000` (§1.2), so the external axis reduces to `lat` (0.5615, on 14.5 % of candidates) and `failedEdge` (3.0, on
   5.6 %). A conjunction over an axis that is zero for 85 % of the pool ranks the 15 % that carry it and discards the
   rest — 800 cases.
2. **Rebuilding the axis from the unweighted values makes it worse, not better.** This is the direct test of the one
   hypothesis the first reading leaves open — that the axis is merely under-scaled — and it fails on a dense axis:
   **53 893 of 69 688** candidates carry a positive external deviation once the values are read, and the conjunction
   still loses **574** cases (492 / 499). Density is not the missing ingredient.
3. **Narrowing the axis to propagated failure does not rescue it either.** With the external axis defined as the
   channels that measure what the component is *seen to cause* — `rise`, `temporal`, `collision` — the reading is
   **193 / 199**, and with downstream `rise` alone **190 / 201**. The ordering across the four specifications is
   monotone in how much of the external axis the conjunction is handed: **800 → 492 → 193 → 190**. A theorem whose
   subject is the external axis predicts the opposite trend.
4. **Adding the propagation values to the additive score is catastrophic at every weight.** The scan is flat because
   the effect is not a weight: any non-zero weight on `rise` gives **209**, on `temporal` **60**, on `collision` **80**,
   at 0.02 and at 0.4 alike. The terms are not weak — they are **anti-predictive** as written, which is why the vector
   carries them at zero, and why re-enabling them is not a route to anything.
5. **The pool-relative axis was this iteration's own specification and it is the worst of the four.** The previous
   draft closed §2 by naming the one experiment that could reopen the conjunction: an external axis defined as the
   candidate's share of the pool's largest propagated failure rather than a per-candidate bonus. Rows 3 and 4 of the
   table *are* that experiment (the normalised modes divide by the pool's maximum, so the axis is a share), and it is
   where the conjunction does worst.

**Correction.** The previous draft of this section quoted a "faithful mapping" at `normMin` **745**, `normProduct`
**748**, `product` **748**, together with a claim that only 2 400 of 69 688 candidates carried an external deviation.
Those numbers came from a hand script whose external set is not recoverable, and no specification in the repository
reproduces them: exhaustively measuring all **2 048** subsets of the eleven non-internal channels the dump carries —
under internal = `selfAnomalyLog1p` + `selfTime`, and again under internal = those plus the two evidence terms the
prose classed as internal — produces no subset whose `normMin` is 745. The claim is therefore **withdrawn**, and the
2 400 is contradicted by measurement: the narrowest of the four specifications still has 38 417 candidates with a
positive external deviation. The conclusion the withdrawn number was supporting is unchanged and is now carried by
four readings the runner prints.

The five readings together close the direction, and the reason is not the axis's sparsity or its scale — it is the
framework's **premise**. CIE ranks by deviation magnitude alone: its score is a function of the internal and external
axes and of nothing else. Our surface is carried by channels the theorem does not model — `log` and `podState` alone
are worth 541 cases — so any conjunction over two deviation axes *discards the evidence that produces the accuracy*.
The 800 of row 1 is what remains when the evidence is thrown away and the axes are sparse; the 492 of row 2 is what
remains when they are dense; the 190 of row 4 is what remains when the axis is narrowed to the one channel the theorem
was written for. None is a statement about CIE's proof; all are statements about our regime.

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

# The first competitor's theorem, on our pool (¥0, seconds). Prints all four specifications of the
# external axis, each with the line that names it, so no row of §2 needs a script that is not here.
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
   surface and positive in both folds, but seven flips are not a mandate. What the ladder does establish is that the
   shipped weight sits just inside a cliff (×2 costs 37 cases and repairs none), which is a robustness argument for
   0.5.

   **Correction (iteration 340).** This clause originally continued *"the arm's answers were produced from the shipped
   engine, so the published 1 328 cannot be verified without a dispatch … which the next dispatch can settle for
   ≈¥21"*. **That sentence was wrong, and the ¥21 it put in the queue was never a measurement of this arm.** The arm
   does not read the engine's ranking — its module doc, `docs/closed-axes-register.md:8067` and
   `docs/free-investigation.md:156` all say so in the same words ("Seeding is a SEPARATE arm and is off here"), and its
   transcript confirms it: five retrieval tools over the case's own telemetry, with `engineRank` written beside the
   answer as a comparison rather than read by the loop. A weight cannot move an answer the weight never entered, so the
   published surface is a **join** of two artifacts that change with the weight (`per-case`, `terms`) onto two that do
   not (`answers`, corpus walk) — `¥0`, seconds, no endpoint. The instrument for that join is `surface-diff.ts` plus
   `run-miss-ledger.ts --surface-out` (iteration 340), and it is what the next reading of this weight uses.
   `docs/cost-audit-340.md` records the full correction, the price structure it corrects, and the guard census built
   while making it — which found that the stored artifact every earlier surface reading was taken on carries no
   `top1Score`/`top2Score`, so its certainty guard was never evaluated at all.

3. **The external axis is refuted rather than unbuilt.** §2 measured four specifications of it — shipped weights,
   every channel at its measured value, propagated failure only, and downstream rise alone — and the best of them is
   the one the engine already has (800), with the narrowing axis strictly worse (492 → 193 → 190). No engine work is
   required, and none is planned: the direction is closed by the framework's premise, not by our coverage.
