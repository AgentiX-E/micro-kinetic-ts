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
| `lat only` | 119 / 462 | **+13** | **25 / 11** | `predictedIsTop >= 1` |
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

1. **The second half of the criterion fails outright.** 11 held-out losses are 11 regressed
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

## 7. Reproduce

```bash
# the validation: the census's own 750 and 871, from the discriminator's instrument
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0 --discriminator

# the measurement: 756 and 878, and the +13 net with 25 fixed / 11 broken
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --discriminator
```
