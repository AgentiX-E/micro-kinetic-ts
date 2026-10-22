# The per-case discriminator: how much of the headroom is learnable, and why it still cannot ship

**Status:** instrument shipped (`--discriminator`), lever measured. **Code:**
`benchmarks/src/fse26-discriminator.ts` + tests.

The register's ceiling analysis left one lever: a **per-case discriminator** that decides
which configuration to trust. Its headroom is known — a perfect chooser reaches **871/1422**
(61.25%) at the pre-pool baseline and **878** at the shipped one, against **750** and **756**
in practice. That is 115–122 cases. This iteration measures how much of it is learnable
**out of sample** from features available at inference time, and whether a rule that learns
some of it could be shipped.

**Answer: about 11% of it is learnable, and the rule that learns it cannot ship** — it is
net-positive because it TRADES cases, and the criterion's second half is zero regressed fault
types.

---

## 1. The instrument, and the discipline that makes it an instrument

**The label** is the set of configurations whose ranking names an acceptable root. The menu
is the shipped formula's four points: `log only`, `metric only`, `lat only`, `shipped`.

**The features are declared, and they cannot see the label.** `CaseSubject` is
`Pick<DiagnosedCase, 'datapack' | 'faultType' | 'services' | 'prediction'>` — a type with no
`groundTruth` — so a feature that would need to know the root cannot be written, and a rule
that would need the answer cannot typecheck. Eight features are declared, each available in a
deployment: `n`, `metricTopGap`, `metricSpread`, `logCoverage`, `latCoverage`,
`poolCoverage`, `predictedIsTop`, `predictedAnomaly`.

The discipline is asserted behaviourally as well as typed: **two cases that differ ONLY in
their ground truth must produce identical feature vectors** — a test builds exactly that pair
and requires every feature to agree, because a feature that could tell them apart is a
feature that read the answer.

## 2. The number is held out, and the net is not the whole story

Every rule is fitted on 4 folds and scored on the 5th, split by a hash of the datapack, so
two runs agree. The objective is the **net** (`fixed − broken`), because a case the baseline
already gets right is worth keeping — and the **in-sample** net is printed beside the held-out
one, because the gap between them is the overfitting.

The report also prints the held-out **split**, and that is what decides shippability: the
criterion's second half is *zero regressed fault types*, so a rule that fixes 25 cases while
breaking 11 has a positive net and still cannot ship. A report that printed only the net would
recommend it.

## 3. Validation: two numbers the instrument must reproduce

| baseline | this screen | the census (recorded earlier) |
| --- | --- | --- |
| pre-pool (`--pool-penalty 0`) | shipped **750**, any configuration **871** | 750, 871 |
| shipped | shipped **756**, any configuration **878** | 750 → 756 measured on a run; 871 was pre-pool |

Both pre-pool numbers are **exactly** the census's. The shipped ceiling is **878, not 871**,
and the difference is the pool term: with it in the base, seven more cases are named by some
configuration. So the headroom at the shipped configuration is 122 cases, not 115.

These numbers are exact for the configuration the dump was recorded at — the reconstruction
reproduces the run's own rank-1 on 1422/1422. The **±5 case** error bar in
`fse26-term-oracle-verdict.md` belongs to a RE-DERIVED log term (the counts-derived mode
pre-screen); it does not apply here, where every configuration is ranked from the recorded
fields.

## 4. What is learnable

> **Baseline, read this first (law 41, iteration 112).** Every table below was taken at `poolWeight` 0.0679, the engine's compiled default, and that reconstruction **disagrees with the run's recorded rank-1 on 103 of 1422 cases** — its `shipped` totals are the RECONSTRUCTION's, not the engine's. **§13 re-takes all of them at the configuration that reproduces the run** (`poolWeight 0`, 1422/1422) and is the authoritative table; the signs and orderings are identical, the margins are narrower. `log1p(selfAnomaly) + log + lat` alone reproduces the run exactly.


Held-out results, 5 folds, at the shipped configuration:

| config | fixes / breaks if applied to every case | held-out net | held-out split | rule chosen on every fold |
| --- | --- | --- | --- | --- |
| `lat only` | 119 / 462 | **+13** | **25 / 12** | `predictedIsTop >= 1` |
| `log only` | 2 / 88 | 0 | 0 / 0 | none |
| `metric only` | 58 / 590 | −2 | — | `poolCoverage >= 0.3137` on one fold |

At the pre-pool baseline the same rule reads **+14 (fixed 25, broken 11)** and the ceiling is
871, so:

**A single inference-time feature captures 13–14 of the 115–122 case headroom — about 11% —
and it does so by trading.** `predictedIsTop` is exactly what it sounds like: the model's own
rank-1 is also the anomaly maximum, which is a fact a deployment has without the label. When
that holds, ranking with `lat only` (the metric base plus the latency term) is right more
often than it is wrong — 25 fixed against 11 broken out of sample, on every fold — and the
populations are far too entangled for the trade to become a separation: applied to every case
the same configuration fixes 119 and breaks 462.

**The conflict the register described is therefore visible in the label itself**, and this is
the sharpest form it has taken: not "no weight serves both", but "the configuration that
serves the fixable cases also destroys four times as many".

## 5. Why it cannot ship

1. **The second half of the criterion fails outright.** 12 held-out losses are 12 regressed
   cases; the criterion is zero regressed fault types, and no threshold on any declared
   feature removes them — the feature moves the net, not the wall. Every one of the eight
   features was searched per fold, so this is "no declared feature separates them", not "the
   obvious feature did not".
2. **The first half is structurally implausible.** The winning rule is `lat only`, which sets
   `logWeight = 0`: it does not reweight the score, it removes a term for every case it fires
   on (~180 of 1422). The RCAEval golden is computed on the default path, so a per-case switch
   of that shape changes its inputs rather than its outcome — the 9 cells would have to be
   re-measured and are very unlikely to be byte-identical. Shipping it would need a golden
   that is identical, and there is no reason to expect one.
3. **A measurement is not a candidate.** The rule's value is that it quantifies the conflict
   (+13/+14 learnable, 11 unremovable losses), which is what the register asked for before any
   further work on this axis.

## 6. The bar a future proposal has to clear

The lever stays open as EVIDENCE and closed as a shippable change, and the numbers now set the
bar: a per-case discriminator must

- beat **+14** held out, at the shipped configuration, with
- **zero** held-out losses (not "few"), and
- a rule whose mechanism does not remove a term — because the golden is on the default path.

A proposal that cannot state its held-out split against these numbers has not engaged the
measurement, exactly as the register demands of any candidate.

## 7. Re-taken 2026-10-19 (iteration 108) — the shipped row's split was the pre-pool's

**The shipped row above read `25 / 11` and could not have been right, because the same row says `+13`.** The
held-out net IS `fixed − broken`, so `25 / 11` is a net of `+14`; the row's own arithmetic disproves its own split.
Two runs of the reproduce command below, 2026-10-19, both print

```
lat only         119     462     13      25/12          13   predictedIsTop >= 1.0000
best held-out: lat only net +13 (fixed 25, broken 12) → 769/1422
```

at the shipped configuration, and at the pre-pool one

```
lat only         119     469     14      25/11          14   predictedIsTop >= 1.0000
best held-out: lat only net +14 (fixed 25, broken 11) → 764/1422
```

**So `25 / 11` is the PRE-POOL measurement and `25 / 12` is the shipped one**, and the §4 table — whose every
other column on that row is shipped-configuration data (`119 / 462` is the shipped fix/break) — had one cell
carried over from the neighbouring measurement. The correction is one case, and it moves §5's load-bearing count.

**Why it drifted:** the instrument was revised twice after this verdict was written (`16c7cfa`, `79923eb`), and the
verdict's numbers were never re-taken. That is the same class as every other defect this record keeps finding — a
claim whose truth moves with the code, written down as a constant — arriving in the one document that states the
BAR for the axis. The net (+13 / +14) and the ceilings (756 / 878, 750 / 871) are reproducible and unchanged.

**And the arithmetic is now a fence**: `benchmarks/__tests__/fse26-discriminator-verdict.test.ts` parses every row
of the §4 table and asserts `net == held-out fixed − held-out broken`, so a row that mixes two measurements fails a
test instead of waiting for a reader to add the numbers up. It asserts the INVARIANT rather than today's values, so
re-taking a measurement never breaks it.

## 9. The menu was the obstacle, and it is now measured (iteration 109)

> **Baseline, read this first (law 41, iteration 112).** Every table below was taken at `poolWeight` 0.0679, the engine's compiled default, and that reconstruction **disagrees with the run's recorded rank-1 on 103 of 1422 cases** — its `shipped` totals are the RECONSTRUCTION's, not the engine's. **§13 re-takes all of them at the configuration that reproduces the run** (`poolWeight 0`, 1422/1422) and is the authoritative table; the signs and orderings are identical, the margins are narrower. `log1p(selfAnomaly) + log + lat` alone reproduces the run exactly.


**The bar in §6 has a clause nobody had tested: "a mechanism that does not remove a term".** The four-point menu
cannot satisfy it — `lat only` zeroes `logWeight`, `log only` zeroes `latWeight`, `metric only` zeroes both — so its
ONLY term-preserving member is `shipped`, which IS the baseline. **A rule choosing from that menu can therefore only
ever help by removing a term.** The bar was not unreachable because of the features; it was unreachable because of
the MENU.

**So the menu now has a second screen.** `--discriminator` prints two blocks: the recorded four-point screen, whose
numbers are unchanged, and a **term-preserving** one whose configurations scale a weight instead of zeroing it
(`lat x2`, `lat x4`, `log x0.5`, `log x2`, all with both weights positive). The constructor FILTERS rather than
promises: a probe whose scaling would leave a weight at zero is not offered, and when the shipped formula already
has a zero weight the probe menu is **empty**.

### The measurement, on the same dump and the same folds

```
Discriminator screen [term-preserving reweightings]
  cases 1422; shipped gets 756; ANY configuration gets 802 (the oracle)
  config          fixed  broken  held-out        in-sample   rule
                                  net    +/-
  lat x2            17     234     -2        0/2           1   poolCoverage >= 0.2157
  lat x4            34     251     -2        0/2           1   metricTopGap >= 0.0500
  log x0.5          21     234     -3        0/3           0   none
  log x2             6      11     -5        1/6           3   latCoverage <= 0.5294
  no rule beats the baseline out of sample
```

**Every term-preserving reweighting is net NEGATIVE**, and **none** comes close to the bar's `+14`. Two losses,
two losses, three, six — against 0, 0, 0 and 1 fixes. **The clause was not merely unmet by a small margin; the
direction is wrong.**

### And that is the sharpest statement this axis has produced

| menu | ceiling | headroom over the 756 baseline |
| --- | ---: | ---: |
| four-point (`lat only` / `log only` / `metric only` / `shipped`) | **878** | **122** |
| term-preserving reweightings | **802** | **46** |

**The 122-case headroom is reachable only by removing a term.** A menu that keeps every term can reach at most 46
of it — **38% of the prize** — and no declared feature converts even that at a positive net.

**Therefore the conflict is not a DECISION problem.** If a per-case chooser had been the answer, the term-preserving
menu would have shown a positive net somewhere: a bounded reweighting steers the same formula without deleting
anything, which is exactly the "steer, do not switch" shape the bar asked for, and it loses on every fold for every
probe. **What remains is a FORMULA problem**: the shipped blend itself has to change so that ONE formula serves both
populations, because the two populations do not want different configurations of the same blend — they want
different blends, and no per-case rule can supply a blend the menu does not contain.

**That is a different axis, and it is the one the register should now carry.** The evidence for it is the same table:
the ceiling moves with the menu (878 → 802), so the headroom is a property of the FORMULATIONS considered, not of the
chooser.

### What this does not change

- **Every recorded number is unchanged.** The four-point screen still prints 756 / 878 and `+13` with `25 / 12`; the
  second screen is additive and labelled, so a reader grepping `ANY configuration gets` can tell which menu produced
  the number.
- **The oracle is still 122 cases away from a perfect chooser over the four-point menu.** This iteration does not
  move any cell of the nine, any ablation row, or the FSE'26 aggregate.

### Reproduce the second screen

```bash
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --discriminator
# prints the four-point screen, then
# "Discriminator screen [term-preserving reweightings] ... ANY configuration gets 802"
```

## 10. The formula axis, first measurement: the SCALE is not the missing blend (iteration 110)

> **Baseline, read this first (law 41, iteration 112).** Every table below was taken at `poolWeight` 0.0679, the engine's compiled default, and that reconstruction **disagrees with the run's recorded rank-1 on 103 of 1422 cases** — its `shipped` totals are the RECONSTRUCTION's, not the engine's. **§13 re-takes all of them at the configuration that reproduces the run** (`poolWeight 0`, 1422/1422) and is the authoritative table; the signs and orderings are identical, the margins are narrower. `log1p(selfAnomaly) + log + lat` alone reproduces the run exactly.


Section 9 left one question and named it: if the populations want different BLENDS rather than different
configurations, what has to change? The cheapest answer to test is the **scale** each term is read on, because
"these two populations want different weights" is a statement about magnitude — a log score of 3 is decisive in one
case and unremarkable in another, and a latency slope's scale varies by system, so a fixed weight is a compromise
between two scales rather than a statement about either.

**So four formulations were measured, each a single rule applied to every case with nothing fitted** (a formula is
judged once, over the whole corpus — there is no fold to hold out). Every form keeps every term and every weight;
what changes is which terms are read by their **within-case rank** instead of their value:

| form | base | log | latency | correct /1422 | net | fixed / broken |
| --- | --- | --- | --- | ---: | ---: | ---: |
| shipped (reference) | magnitude | value | slope | **756** | — | — |
| `all ranks` | rank | rank | rank | 499 | **−257** | 36 / 293 |
| `base magnitude` | **magnitude** | rank | rank | 520 | **−236** | 32 / 268 |
| `log rank only` | magnitude | **rank** | slope | 509 | **−247** | 36 / 283 |
| `latency rank only` | magnitude | value | **rank** | 743 | **−13** | 1 / 14 |

**None is a candidate, and the pattern is the finding.**

1. **The base term's magnitude IS the evidence.** Replacing `log1p(selfAnomaly)` with its rank costs 236–257 cases.
   `log1p` already tames the growth; what it preserves — how many times the noise scale a service departs by — is
   exactly what the anomaly term is for. A rank throws that away and keeps only "who is first", which the blend
   then cannot distinguish from "who is barely first".
2. **The log term is the same story, and worse per unit of change**: `log rank only` alone costs 247. Its magnitude
   encodes how much evidence a service's log lines carry, and a rank keeps only the ordering.
3. **The latency term is the one that nearly survives a rank reading** — −13 with **1 fixed and 14 broken**. That is
   the only form within 2% of the shipped number, and it is informative in the opposite direction from the
   hypothesis: the latency term's magnitude carries almost nothing the ranking does not already carry, so
   **rescaling it cannot be the lever** either. Its 14 losses are not a scale artefact; they are the term's own
   ordering disagreeing with the blend's.

**Conclusion: the conflict is not in the SCALE of any term.** Four changes of scale — the whole family the
"different blends" hypothesis most naturally suggests — are all net negative, three of them catastrophically. **The
missing blend must come from a different COMPOSITION** (a term, an operator, or a gate on the signals that exist),
not from re-reading the three terms on another scale.

**And one number from section 4 is now doubly confirmed**: `lat only` (which sets `logWeight = 0`) reaches 119 cases
the shipped blend misses, while `latency rank only` (same term, rank scale, log term KEPT) reaches **one**. The
headroom genuinely lives in the log term's ABSENCE for those cases, which is why every term-preserving change has
failed to touch it in either direction.

**Reproduce**

```bash
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --discriminator
# prints the four-point screen, then [term-preserving reweightings], then the formulation table
```

## 11. The composition axis: evidence is ADDITIVE, and three families are now closed (iteration 111)

> **Baseline, read this first (law 41, iteration 112).** Every table below was taken at `poolWeight` 0.0679, the engine's compiled default, and that reconstruction **disagrees with the run's recorded rank-1 on 103 of 1422 cases** — its `shipped` totals are the RECONSTRUCTION's, not the engine's. **§13 re-takes all of them at the configuration that reproduces the run** (`poolWeight 0`, 1422/1422) and is the authoritative table; the signs and orderings are identical, the margins are narrower. `log1p(selfAnomaly) + log + lat` alone reproduces the run exactly.


Section 10 closed the question of how a term is READ. This closes the other half of "different blends": **how the same
three terms are COMBINED.** The shipped blend adds them, so a service mildly unusual on all three beats one decisive on
one; `max` and `lse` are the two standard alternatives, and `max` is exactly the shape that would explain the conflict
the chooser measurement found — the cases that want the log term switched OFF may be the ones where ONE channel is
decisive, and switching it off is a crude way to stop it diluting the others.

Three arms, each one rule over all 1422 cases with nothing fitted. **The terms are not re-spelled**: every arm composes
`ScoreTerms`, the single decomposition the shipped score is now built from, so no arm can differ from another by a
re-derived slope. **The pool penalty stays outside the combination** in all three arms — it is a demotion, not
evidence, and inside a `max` it could be escaped by being large on one channel, which is what the penalty exists to
prevent.

| arm | claim | correct /1422 | net | fixed / broken |
| --- | --- | ---: | ---: | ---: |
| `sum` | evidence is ADDITIVE | **756** | +0 | 0 / 0 — **coherence OK** |
| `max` | the strongest channel decides | 671 | **−85** | 20 / 105 |
| `lse` | a soft maximum (temperature 1) | 742 | **−14** | 6 / 20 |

**The `sum` arm is the instrument's own validation**: it is the shipped arithmetic rebuilt through a different path
(`scoreTerms` + sum versus `blendScores`), and it reproduces **756** exactly with nothing fixed and nothing broken. A
composition experiment whose baseline does not reproduce the number it is compared against is measuring its own defect;
this one's does.

**The measurement says evidence is additive, and that is not a null result.** `max` costs **85 cases** (20 fixed, 105
broken): **dilution was not the problem.** A service that is mildly unusual on three channels genuinely beats one that
is decisive on a single channel, because a single channel's extreme is often noise — which is the same reading the log
term's own magnitude gave in section 10. `lse` lands at 742, between the two and much closer to the sum: the blend is
*nearly* additive, and the 14 cases it loses are the price of softening a sum that was already right.

### Three families closed, and what that implies

| family | what was tried | best result |
| --- | --- | --- |
| **chooser** (it.108–109) | per-case configuration from a four-point menu, then from a term-preserving menu | +13 net with 12 losses; **zero losses never reached**; term-preserving arms all negative |
| **scale** (it.110) | each term read by within-case rank instead of magnitude | best −13 (`latency rank only`); base/log rank readings cost 236–257 |
| **composition** (it.111) | the same terms combined by `max` or `lse` instead of a sum | best −14 (`lse`); `max` −85 |

**Nothing that changes the READING of the three terms, and nothing that changes their COMBINATION, beats the shipped
blend.** That is now measured in five distinct families of change, and it leaves exactly one degree of freedom in the
blend: **the SET of terms.** The remaining 115–122 cases cannot be reached by choosing, re-reading or re-combining the
three signals that exist — they require evidence the blend does not currently carry.

**The next candidate is therefore a NEW TERM**, and the record already names the one with a measured channel behind it:
the failed-edge channel (`failed-edge-channel-audit.md`, `fse26-failed-edge-verdict.md`). It must be measured in the
same form this axis has used throughout: one rule over all 1422 cases, nothing fitted, the split printed beside the
net, and — because it adds a term rather than changing one — a **coherence check that the shipped total is unchanged
when the new term's weight is zero.**

**Reproduce**

```bash
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --discriminator
# four blocks: the four-point screen, [term-preserving reweightings], the formulation table, the composition table
```

## 12. The baseline was a RECONSTRUCTION, and it did not reproduce the run (iteration 112)

Sections 4–11 all compare a candidate against "the shipped blend" and print its total as `shipped gets 756`. **That
total is the reconstruction's, and the reconstruction does not reproduce the run it was reading.** Measured on
`artifacts/r34928980425/fse26-results.txt`, rank-1 against the dump's own recorded order:

| configuration | agreement with the recorded rank-1 | right (any-root rule) |
| --- | ---: | ---: |
| the current engine defaults (`poolWeight` 0.0679) | **1319 / 1422 (92.76%)** | 756 |
| `poolWeight` 0 | **1422 / 1422 (100.00%)** | 750 |

**Two facts, and the second is the one that had to be stated.**

1. **The dump predates part of the current configuration.** Its `Config:` line is 96 characters long and carries
   `logWeight logMode rankNormalization latWeight latMinRise` — and **no `poolMetricPenaltyWeight`, no
   `stabilityWeight`, no `temporalWeight`, no `onsetShape`**, every one of which the CURRENT formatter prints
   unconditionally. A run that had those fields would have printed them. So the reconstruction has been applying a
   penalty to a run that never carried it, and that single term moves rank-1 on 103 cases.
2. **"Shipped gets 756" was never the engine's number.** The engine's own recorded rank-1 is right on **750** cases
   under the same hit rule, and the six-case difference is exactly the pool penalty's effect.

### Three metrics were in circulation under one word

| what | rule | value |
| --- | --- | ---: |
| the published FSE'26 headline | **first** ground-truth label (`run-fse26.ts`) | 757 / 1422 = 53.23% |
| the engine's recorded rank-1, as this record measures it | **any** acceptable root | **750** |
| the reconstruction these screens compare against | any acceptable root | **756** |

They differ for two independent reasons — the hit rule and the reconstruction — and every document in this series
quoted one of them as "shipped". **None of the three is wrong; the mistake was using one word for three numbers.**

### What stands, and what does not

- **The relative comparisons stand.** Every arm in sections 9–11 was measured against the SAME reconstruction, so
  "`max` costs 85 cases", "`lse` costs 14", "`latency rank only` costs 13", "no term-preserving reweighting is
  positive" are statements about that blend and are unaffected by it being 6 cases better than the engine.
- **The absolute totals do not.** `shipped gets 756` must not be read as the engine's accuracy; the engine's is 750
  under this rule and 757 under the published one.
- **What it does not license is a re-run of the four screens.** A reconstruction that is exact (`poolWeight` 0) exists
  and is one flag away: at that configuration the four screens re-take cleanly, and it.113 should re-take them rather
  than argue from the mismatched baseline.

### The instrument that makes this unrepeatable

`fse26-engine-agreement.ts` compares the reconstruction against the dump's recorded ranking and prints, **above** the
screens it qualifies:

```
Engine agreement [reconstructing at logWeight 1, latWeight 0.561495, poolWeight 0.0679]:
  reconstruction reproduces the recorded rank-1 on 1319/1422 cases (92.76%) — DIFFERS
  right under the any-root rule: recorded 750, reconstruction 756
  the difference is a configuration the dump does not carry: every screen below compares against the
  RECONSTRUCTION, so their relative comparisons stand and their absolute totals are not the engine's
```

and at `--pool-penalty 0`:

```
Engine agreement [reconstructing at logWeight 1, latWeight 0.561495, poolWeight 0]:
  reconstruction reproduces the recorded rank-1 on 1422/1422 cases (100.00%) — REPRODUCES
  right under the any-root rule: recorded 750, reconstruction 750
```

**The verdict has exactly two outcomes**, `reproduces` only at total agreement. There is no "mostly reproduces": a
baseline is either the engine's ranking or it is not, and a middle category is where a six-case discrepancy goes to be
forgotten — which is precisely what happened to it for four iterations.

## 13. The re-take at the configuration that REPRODUCES the run

Section 12 established that the five families were measured against a reconstruction that disagrees with the run on
103 cases, and that `--pool-penalty 0` makes the reconstruction exact (**1422/1422**). Here is the same five-family
table at that configuration, beside the numbers sections 4–11 published. **Both columns are on one page because the
comparison is the finding**, not a correction to be quietly folded in.

| what | at `poolWeight` 0.0679 (published) | at `poolWeight` 0 (**reproduces the run**) |
| --- | ---: | ---: |
| shipped blend right (any-root) | 756 | **750** |
| four-point menu ceiling | 878 | **871** |
| best rule, four-point menu (`lat only`) | +13, split 25 / 12 | **+14, split 25 / 11** |
| term-preserving menu ceiling | 802 | **798** |
| `all ranks` | 499 (−257) | 499 (**−251**) |
| `base magnitude` | 520 (−236) | 520 (**−230**) |
| `log rank only` | 509 (−247) | 509 (**−241**) |
| `latency rank only` | 743 (−13, 1 / 14) | 743 (**−7, 2 / 9**) |
| `log only`, fixes / breaks if applied everywhere | 2 / 88 | **0 / 77** |
| composition `max` | 671 (−85, 20 / 105) | 676 (**−74, 19 / 93**) |
| composition `lse` | 742 (−14, 6 / 20) | 748 (**−2, 6 / 8**) |
| composition `sum` (coherence) | 756, 0 / 0 | **750, 0 / 0** |

**Every sign is unchanged and every ordering is unchanged.** That is the important half: the five families' verdicts
were not artifacts of the mismatched baseline. The chooser still trades cases (`+14` with **eleven** losses, and its
term-preserving arm still negative), the scale family still costs 230–251 for the base and the log term, and the
composition family still loses — `max` badly, `lse` marginally.

**The second half is what the wrong baseline had been hiding**: at the blend the engine actually computed, the gap
between the shipped sum and the alternatives is **much narrower**. `lse` falls from −14 to **−2** with a **6 / 8**
split, and `latency rank only` from −13 to **−7** with **2 / 9**. Two cases of net difference is within the noise of a
1422-case corpus, and it changes the character of the conclusion: the alternatives are not refuted by a wide margin,
they are **barely refuted** — and the refutation rests on the split (8 and 9 losses respectively) rather than on the
net.

**And `log only` now fixes NOTHING** (0 fixes, 77 breaks) where the published table said 2 — so there is no case in the
corpus where the log term alone names a root the blend misses, which removes the last reason to consider reading the
log term differently.

**What this does not change**: the target. The engine gets 750 of 1422 under this rule (757 under the published
first-label rule), the four-point ceiling is 871, and the headroom is therefore **121 cases** — one fewer than the
published 122, and still reachable only by removing a term (section 9).

## 14. The fourth term: the first family that GAINS, and it gains 105 cases (iteration 114)

Sections 9–11 closed choosing, re-reading and re-combining the three terms. That left one degree of freedom: **the set
of terms.** The candidate is the failed-edge **direction** — the callee of failed calls, the one signal the log term
cannot express because the log term credits whoever EMITS an error, which on a propagation fault is a victim.

It was already measured as an engine **switch** (+5.8pp on its own run, rejected on two narrow regressions). This is a
different question, and it is the first one in this record with a large positive answer:

| weight | what it claims | right /1422 | net | fixed / broken |
| ---: | --- | ---: | ---: | ---: |
| 0 | the engine's own blend (the baseline) | **750** | +0 | 0 / 0 |
| 0.25 | a nudge: the direction breaks near-ties only | 763 | **+13** | 19 / 6 |
| 0.5 | half the log term's strength | 790 | **+40** | 53 / 13 |
| 1 | as strong as the log term | 810 | **+60** | 86 / 26 |
| 2 | able to dominate a moderate anomaly gap | 848 | **+98** | 144 / 46 |
| **3** | **the measured maximum** | **855** | **+105** | 155 / 50 |
| 4 | 852 — declining, which is what makes 3 a maximum | 852 | +102 | 156 / 54 |

**855 of 1422 is 60.13%, against 750 (52.74%) and against the four-point menu's whole ceiling of 871 (61.25%).** One
term at one weight closes **105 of the 121 remaining cases** and leaves **16**.

**The turning point is the finding, not the maximum.** A single term whose weight can be raised without limit would be
a gate — "any candidate a failed call pointed at beats every candidate without one" — and a gate would show a
monotone rise with no optimum. This one peaks at 3 and declines through 852, 835, 827 at 4, 6, 20, so the term is
**trading** direction against anomaly rather than overriding it. That is why the arm menu now reaches past the
maximum: a menu that stopped at 2 would have reported a monotone rise and left a reader unable to tell a term from a
gate.

### Three things it does not license, stated before anyone reads the 855

1. **The weight is FIT on this corpus.** `3` was read off the same 1422 cases the net is computed on, so it is a
   measurement of potential, not a candidate. The bar the chooser failed applies unchanged — **beat the baseline with
   ZERO losses** — and this arm **trades**: 155 fixed against **50 broken**. A weight chosen out-of-sample is
   iteration 115's first task, and the decline either side of 3 is what makes that protocol worth running rather than
   a formality.
2. **It is a reconstruction number.** The engine ships `DEFAULT_FAILED_EDGE_WEIGHT = 0`, so 855 describes a
   configuration nothing has run. Shipping it means flipping that default, and the pruner's own docblock states the
   condition: ablated and read back net-positive with **zero regression on the RCAEval golden nine-cell** *and*
   **zero regressed FSE'26 fault types**. Neither has been run for weight 3.
3. **The direction is silent on 200 of the 1422 cases** — no edge carried a measured rise — so the gain comes from the
   1222 that carry it, and the per-fault-type split of the 50 losses is not yet taken.

### What is now measurable that was not

The screen is `benchmarks/src/fse26-fourth-term.ts`, and it prints the **baseline agreement first**: at weight 0 the
direction is inert, so that arm IS the engine's blend and the report says whether it reproduces the run before any net
is read (law 41). The five-family table, the corrected baseline and this fourth term now share one instrument and one
discipline: **a rule over the whole corpus, nothing fitted, the split printed beside the net.**

## 15. The fourth term, held out: the weight is STABLE, the gain is real, and the kill criterion REFUSES it

Section 14 measured 855 (+105) at weight 3 and said, before anyone read the number, that `3` was **fit on the corpus it
was scored on**. This is the protocol that answers that, and it is the same fold assignment the discriminator uses
(`foldOf`, five folds by datapack hash) rather than a second split of one corpus.

**The weight is chosen on four folds and read on the fifth**, per fold:

| fold | chosen on the other four | held-out right | baseline | net | fixed / broken |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | **3** | 167 / 278 | 133 | **+34** | 40 / 6 |
| 1 | **3** | 165 / 274 | 145 | **+20** | 25 / 5 |
| 2 | **3** | 193 / 310 | 170 | **+23** | 37 / 14 |
| 3 | **3** | 167 / 300 | 155 | **+12** | 25 / 13 |
| 4 | **3** | 163 / 260 | 147 | **+16** | 28 / 12 |
| **all** | **3 in every fold** | **855** | **750** | **+105** | 155 / 50 |

**Every fold chose the same weight, and every fold was net-positive on cases it never saw.** The held-out total
reproduces section 14's in-sample total exactly, which is the strongest form this measurement can take: **the +105 is
not a fitted artifact.** The tie-break is toward the SMALLER weight — a larger one trades more cases — so a fold that
was indifferent between two weights would have chosen the safer one, and none was indifferent.

### And then the acceptance criterion in its OWN unit refuses it

The pruner's docblock states the condition for flipping the default: net-positive with **zero regressed FSE'26 fault
types**. Fifty broken CASES is not that unit, so the split was taken by type at weight 3:

| fault type | baseline | weight 3 | Δ |
| --- | ---: | ---: | ---: |
| HTTPResponseReplaceCode | 159 | **218** | **+59** |
| NetworkPartition | 48 | **70** | +22 |
| NetworkBandwidth | 13 | **31** | +18 |
| NetworkLoss | 23 | **35** | +12 |
| NetworkCorrupt | 24 | **34** | +10 |
| JVMException | 30 | **37** | +7 |
| … | | | |
| HTTPResponseDelay | 52 | 51 | −1 |
| HTTPResponseReplaceBody | 45 | 44 | −1 |
| HTTPRequestReplacePath | 38 | 36 | −2 |
| HTTPResponseAbort | 34 | 32 | −2 |
| HTTPResponsePatchBody | 3 | **0** | **−3** |
| HTTPRequestAbort | 47 | 42 | −5 |
| HTTPRequestDelay | 54 | 48 | −6 |
| JVMMemoryStress | 12 | **3** | **−9** |

**Eight of twenty-five types regress, and no weight in the menu reaches zero:**

| weight | net | types regressed | worst type |
| ---: | ---: | ---: | --- |
| 0.25 | +13 | **2** | HTTPRequestDelay −2 |
| 0.5 | +40 | 5 | JVMMemoryStress −4 |
| 1 | +60 | 6 | JVMMemoryStress −8 |
| 1.5 | +85 | 6 | JVMMemoryStress −9 |
| 2 | +98 | 7 | JVMMemoryStress −9 |
| **3** | **+105** | **8** | JVMMemoryStress −9 |

**So the default does not flip.** The gain is large, out-of-sample, and stable, and it is **rejected on the engine's own
terms** by a margin that no weight in the menu closes — even a quarter-strength term breaks `HTTPRequestDelay`. This is
the standing rule applied to our own best result: a regression is not bought with a net, however large.

### What the split says the next candidate must be

The gain is **structural, not diffuse**: `HTTPResponseReplaceCode` alone is **+59** of the +105, and the network family
adds another **+62** between four types. The losses are the **delay / abort / memory** family — faults whose failed
edges point at a dependency that is *not* the fault site, because the fault is a latency or resource condition rather
than a failed call.

That is a mechanism, and it names the one thing worth trying next: **a gate on the direction's own evidence** — apply
the term only where the failed-edge coverage is decisive (one callee dominates) — rather than twenty-five per-type
switches, which would be a twenty-five-parameter fit wearing a mechanism's clothes. One parameter, a stated mechanism,
and the same held-out protocol.

## 16. The class gate: the first arm in this record to PASS the acceptance criterion (iteration 116)

Section 15 refused the direction term because **8 of 25 fault types regressed**. This is the arm that closes it, and it
was found by asking what the term MEANS rather than by fitting a switch per type.

### Three predicates were tried and refuted first

| predicate | what it promised | why it failed |
| --- | --- | --- |
| failed-edge **dominance** (`top/total >= d`) | a confident direction is a trustworthy one | never reaches zero regressions; **`JVMMemoryStress` regresses at every level (−8/−9)** because its failed edges are dominated exactly like the cases the term helps |
| **latency signature** (`latEdges`/`latRise` defined) | suppress where the fault is latency | **saturated — defined on every service of every case**, so the predicate is the constant `true` and "suppress where latency is measured" suppresses everywhere (net 0). Law 1 |
| **confidence gap** (`log1p(anomaly)` top1 − top2) | suppress where the blend is already sure | **saturated again** — the anomaly is RANK-NORMALISED, so the gap is **0.010 at q10 AND at q90**; a constant cannot decide |

### What the split says when it is read by CLASS rather than by type

| class | cases | base → w3 | Δ |
| --- | ---: | ---: | ---: |
| value (`Replace*`, `Patch*`) | 515 | 372 → 430 | **+58** |
| **network** (`Network*`) | **254** | 127 → **189** | **+62** |
| latency (`*Delay`, `*Latency`, `TimeSkew`) | 188 | 111 → 105 | −6 |
| resource (`*Stress`) | 173 | 12 → 3 | **−9** |
| abort (`*Abort`, `*Kill`, `PodFailure`) | 227 | 86 → 79 | −7 |
| other | 65 | 42 → 49 | +7 |

**The gross gain of the ungated term is ENTIRELY inside the network class (+62 of +62 of it), and its losses are entirely
outside it.** That is a mechanism, not a pattern: a failed call names the fault site exactly when what failed IS the
connection — partition, loss, corruption, bandwidth — and everywhere else the failed edge points at something the fault
happened TO.

### The gate, measured

**The direction term applies only to the network class** — one derived class set, no threshold, no per-type switch:

```
  weight 3: the gate admits 254/1422 cases
  right 812 against a baseline of 750 (+62)
  regressed types: NONE
```

**812 of 1422 is 57.1%, against 52.7% — +4.4pp — and zero regressed fault types.** That is the engine's own acceptance
condition for flipping the default, met for the first time in this record.

### And held out, with the SAME gate

| fold | chosen | held-out | baseline | net | fixed / broken |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 3 | 147 / 278 | 133 | **+14** | 14 / 0 |
| 1 | 3 | 159 / 274 | 145 | **+14** | 14 / 0 |
| 2 | 3 | 185 / 310 | 170 | **+15** | 16 / 1 |
| 3 | 3 | 162 / 300 | 155 | **+7** | 8 / 1 |
| 4 | 3 | 159 / 260 | 147 | **+12** | 12 / 0 |
| **all** | **3 every fold** | **812** | **750** | **+62** | **64 / 2** |

**Every fold net-positive, the same weight in every fold, 64 cases fixed against 2 broken** — and the two breaks do not
regress a TYPE, which is the criterion's unit. The gate is applied INSIDE the protocol (the fold split decides the
weight, the gate decides the cases), so the arm is not called out-of-sample on the strength of its weight alone.

### One thing this does not yet license

**The class set was chosen after the per-class table was seen.** The mechanism was stated before it (section 15: delay,
abort and memory are latency-or-resource faults whose failed edge points at a dependency that is not the fault site), and
the class is derived from the type NAMES rather than fitted per type — but a reader is entitled to ask what a DIFFERENT
class set would have done. **Iteration 117 holds the class choice out too**: with six classes there are 64 candidate sets,
the fold splits are already built, and the question "would the protocol have found `network` on four folds" is answerable
in one pass. Until that runs, this arm is a CANDIDATE that passes the criterion, not a shipped default.

## 17. The class set, held to the criterion as a FEASIBILITY test — and the answer is not `{network}` (iteration 117)

Section 16 shipped a gate on ONE class and said, with the number, that the class set had been chosen after the per-class
table was seen. This is the enumeration that answers it: **all 64 subsets of the six classes**, each scored over the
corpus with its regressed types.

### The first thing the enumeration taught: the criterion is a CONSTRAINT, not an objective

Choosing the set that maximises the training folds and checking the criterion afterwards picks
**`value+network+other`** — stable on every fold, **877 (+127)**, and **three regressed types**
(`HTTPRequestReplacePath`, `HTTPResponseReplaceBody`, `HTTPResponsePatchBody`). It is the best set and it cannot ship.

The engine's condition is a **global** property, so it belongs in the choice as a feasibility test:

| set | total | net | regressed types | admissible |
| --- | ---: | ---: | ---: | --- |
| `value+network+other` | **877** | **+127** | **3** | **no** |
| **`network+other`** | **819** | **+69** | **0** | **yes — the feasible maximum** |
| `network` | 812 | +62 | 0 | yes |
| `other` | 757 | +7 | 0 | yes |
| (none) | 750 | 0 | 0 | yes |

**Four of sixty-four sets regress nothing, and the best of them is `network+other` at +69** — seven cases above
section 16's `{network}` gate, because `other` (65 cases: `JVMException`, `JVMReturn`, `DNSRandom`, `TimeSkew`) is
**also** a class where a failed call is the fault itself: an exception IS a failed call.

### What this changes about section 16's claim, stated plainly

Section 16 reported `{network}` at +62 with zero regressions and called it the first arm to pass the criterion. **That
claim survives** — it is still feasible, and it is still held out. What it was NOT is the **maximum** feasible set: the
criterion admits one more class, worth **seven cases**, and the honest arm is the one the feasibility test selects.

### And the shape of the constraint is now visible

- **Four of 64 sets are feasible.** The constraint is tight, not decorative.
- **The infeasible maximum beats the feasible one by 58 cases (+127 against +69)** — which is the measure of what the
  criterion costs, and the reason a protocol that checks it afterwards will always be tempted to ship the wrong set.
- **The empty set is always feasible**, which is the honest floor: a term that regresses a type must be able to fall
  back to changing nothing, and the screen prints that fallback rather than an error.

### The instrument

`classSetCandidates` enumerates the 64 sets and scores each with its regressed types; `feasibleClassSet` takes the
maximum among the feasible ones and keeps the infeasible maximum beside it; `formatFeasibleClassSet` prints the
agreement (law 41), what was **refused and by how much**, and the feasible maximum with the size of the population it
was drawn from. The enumeration is two rankings per case, not sixty-four: a case's hit under any subset is one of two
numbers, so 64 candidates are arithmetic over those columns.

## 18. The class gate cannot ship: `faultType` is the LABEL, and no observable recovers it (iteration 118)

Sections 16 and 17 measured a class gate that reports **819 (+69) with zero regressed types**, and section 17 called it
the feasible maximum. Both are correct as measurements. **Neither is deployable, and this section says why in one line:**
`classifyFaultType` is keyed on `case.faultType`, which arrives in the dump's `DIAG` header as the **injected label**.
The engine never sees it. **A gate keyed on the answer is an oracle**, and "flip the default behind the gate" was never
implementable as stated.

### The question that decides it, and its answer

If the class cannot be read, can it be **inferred**? That is measurable, and it has a bar: a proxy must beat the
**base rate** — admitting every case. A proxy that cannot beat "admit everything" carries no information about the class
however plausible its mechanism reads.

| proxy | admitted | precision | recall | beats the 17.9% bar |
| --- | ---: | ---: | ---: | --- |
| `failedEdgeRecords >= 1` | 1222 | 13.6% | 65.4% | **no** |
| `failedEdgeRecords >= 5` | 410 | 13.7% | 22.0% | **no** |
| `http share >= 0.9` | 865 | 16.1% | 54.7% | **no** |

**Every proxy scores BELOW the base rate.** Two independent statistics, one conclusion:

- the count of retained failed calls has the same distribution in every class (`q50` of **1–3** across all six);
- the exception-kind share is **~1.00 in every class**, because every injected fault surfaces as an HTTP-level error —
  so "HTTP rather than logic" does not separate a link fault from a code fault at all.

**The +69 is an upper bound on what a class-aware gate COULD contribute, not a gain the engine can collect.** The
deployable value of `DEFAULT_FAILED_EDGE_WEIGHT` remains **0**, and it stays 0.

### What this changes in the record

1. **Section 16's "first arm to pass the criterion"** is a statement about a diagnostic, not a shippable arm. The
   criterion was met; the arm was never deployable. Both facts are now written where a reader will meet them together.
2. **Section 17's feasible maximum** is the best a label-keyed gate can do — and the label is unavailable, so the
   feasible maximum over *deployable* gates is the empty set.
3. **The next lever is not a model but a DATUM.** The one signal that would identify a link fault — the per-edge failure
   KIND (connect-timeout, refused, reset, HTTP 5xx, exception class) — is **discarded when the dump is written**. The
   corpus retains counts, not kinds, which is why every proxy is anti-informative. **That is a corpus-completeness gap,
   and it is the honest target of the next iteration**: retain the kind, then re-run this audit, which is already built
   to answer the question the moment the data can.

### The instrument

`benchmarks/src/fse26-proxy-audit.ts` — `proxyRows` (observables only, no label on the input side), `scoreProxy`
(precision, recall and the base rate beside them, with `informative` requiring a strict improvement over admitting
everything), `proxyAudit` (the three proxies this corpus supports), `formatProxyAudit` (agreement first, then the bar,
then the verdict: **ORACLE** or **DEPLOYABLE**). It is wired as the eighth block of the discriminator section, so the
verdict prints every time the screens are run rather than living in a paragraph.

## 8. Reproduce

```bash
# the validation: the census's own 750 and 871, from the discriminator's instrument
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0 --discriminator

# the measurement: 756 and 878, and the +13 net with 25 fixed / 11 broken
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --discriminator
```
