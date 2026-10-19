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

## 8. Reproduce

```bash
# the validation: the census's own 750 and 871, from the discriminator's instrument
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0 --discriminator

# the measurement: 756 and 878, and the +13 net with 25 fixed / 11 broken
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --discriminator
```
