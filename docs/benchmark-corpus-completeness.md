# The corpus a claim is weighted by — RE2 was ranked 50 of its 90 cases per system

**Status:** defect found, repaired (`b5f0951`) and **re-measured** (run `37872246084`). The corpus now is the
benchmark; §6 carries the acceptance, §7 the law.

## 1. What the benchmark contains

Verbatim from RCAEval's own repository (read 2026-10-09; the paper is `arXiv:2412.17015`, its Table 2):

| dataset | system | cases | fault types | logs | traces |
| --- | --- | ---: | --- | --- | --- |
| RE1-OB / SS / TT | Online Boutique / Sock Shop / Train Ticket | **125 each** | cpu, mem, disk, delay, loss | **N/A** | **N/A** |
| RE2-OB / SS / TT | as above | **90 each** | cpu, mem, disk, delay, loss, socket | Yes | Yes / **N/A** / Yes |
| RE3-OB / SS / TT | as above | **30 each** | f1…f5 (OB) / f1…f4 (SS, TT) | Yes | Yes / **N/A** / Yes |

**735 = 375 + 270 + 90**, which is the population PRISM reports 68% on and the population every claim in this
repository is written against.

Two of these rows this repository had already measured without having read the page: **SockShop carries no
traces in RE2 or RE3**, which the input census reports as `capped spans 0 … STARVED` on exactly those two
cells, and **RE3-SS has four fault types**, which its per-fault-type table shows as `f1 f2 f3 f4`.

## 2. What we ranked

`benchmark-rcaeval.yml` passed `--max-cases 50` to **three** RE2 invocations — the published cells, their
no-inject fidelity control, and the ablation that produces the ledger. RE1 and RE3 were never capped. So the
corpus was

| suite | published | ranked | share |
| --- | ---: | ---: | ---: |
| RE1 | 375 | 375 | 100% |
| RE2 | 270 | **150** | **56%** |
| RE3 | 90 | 90 | 100% |
| **total** | **735** | **615** | **84%** |

and 120 RE2 cases — 40 of each system's 90 — were never ranked.

**The composition of that sample is now measured, and the inference an earlier draft made was false.** The
per-fault-type cells in the study's own artifact print their case counts, and on the capped corpus RE2's six types
held **27, 27, 27, 27, 24, 18** case-reps (150 in total) — so the sample was neither the "9 of each type's 15" an
earlier draft asserted, nor any designed sample. On the corrected corpus the same six cells read **45, 45, 45, 45,
45, 45** (270), i.e. exactly **15 per fault type per system** — the dataset's own `90 = 6 × 15`, and the first RE2
population this repository has held whose fault types are balanced. Two consequences: the earlier inference is
**removed rather than softened**, and the study's `AVG`/`CW` columns stop disagreeing on RE2 (79.8 vs 79.3 capped;
83.7 vs 83.7 full) — which also falsified an unrelated line in that artifact's header (§5.3).

## 3. The claim it fed

**One cause, two published consequences.**

1. **The fold.** `docs/sota-comparison.md` derives the headline with the *dataset's* sizes:

   ```
   (375 x 0.803 + 270 x 0.798 + 90 x 0.587) / 735 = 0.7738
   ```

   The `0.798` is the three RE2 cells' mean — computed from **150** cases — and it is multiplied by **270**. A
   fold weighted by a corpus it did not rank is not a measurement of that corpus; it is an extrapolation wearing
   a measurement's clothes.
2. **The head-to-head.** `docs/prism-head-to-head.md` prints that same 150-case mean in a column its own header
   labels **"engine (golden)"**, beside a competitor evaluated on all 735, under the sentence *"Cases: 735
   discovered, 735 evaluated"* — which is the PRISM runner's own line and describes the PRISM side. Its
   headline comparison, *"PRISM 78.9% vs ours 77.4% on the identical 735 cases"*, therefore compared **735
   against 615**.

**Neither number is a lie and neither is a measurement.** The competitor's 68% is over 735; what we cannot say
is what our own number would be over the same 735 — and that is the only comparison worth optimizing against.

## 4. Why all three invocations had to move

The no-inject invocation is the **fidelity control** for the published one (what the injection anchor
contributes), and the ablation's RE2 baseline is the ledger's reference row. Removing the cap from the
published cells alone would have left the control comparing a full corpus against a subset, and the ledger
measuring a corpus the cells are not published on — which is the *same* defect one level up, and precisely what
iteration 72 repaired when it bought the study's 14-of-14 parity with the published cells.

## 5. The repair, and what holds it

Three `--max-cases 50` arguments are removed, with the reason at the call site. The ablation's
`timeout-minutes` moves 90 → 180, because the bound follows the corpus: `ablation-re2` measured **54.3 min** at
150 cases, the full 270 is 1.8x the case-runs, and a bound a WORKING job exceeds classifies a healthy run as
STUCK. `scripts/test_golden_run_landing.py`'s fixture is the record of that bound and moves with it — for
`ablation-re2` only.

### 5.1 The corpus did not fit, and that is what the cap was really about

The first run carrying the repair **did not finish**: `rcaeval-re2` died with `FATAL ERROR: Reached heap limit —
Allocation failed — JavaScript heap out of memory` (exit 134) after completing OnlineBoutique and SockShop,
and its dependent ablation was skipped. Ninety cases per system do not fit the runner's 12 GB heap where fifty
did.

**The heap's dominant term is the logs.** `tryLoadLogs` parses every row of a `logs.csv` into an object and the
case then holds all of them for the life of a group; RCAEval's RE2 log files run to millions of lines per case
and TrainTicket's are the largest, so the retained array costs on the order of **240 MB per case**. That is the
resource pressure a silent `--max-cases 50` had been absorbing — **a workaround for a bookkeeping cost the
ranking never reads, promoted into a claim about the benchmark.**

The repair is a filter in the ONE assembly owner (`assembleRCAEvalCase`), so the golden, the study and the
weight search all get it: the assembled case retains only rows whose level is `ERROR` or `FATAL`. It is
**provably inert rather than argued to be** — every consumer of a case's logs discards a non-error row before
reading anything else from it, which is five ranking loops in `packages/tree/src/pruning/ranking-signals.ts`
plus this repository's own log diagnostics, and `corpus-owner.test.ts` asserts that of the **consumers** rather
than of the filter, so a future signal that reads an INFO row breaks the invariant where it is written.

The LOADER is untouched: parsing every row, deriving severity from the message (RCAEval ships no level column)
and normalising the timestamp units is its contract, its own suite asserts it, and it is what the filter reads.
`logRowsRead` carries the pre-filter count so the `N cases with logs` diagnostic keeps its meaning — counting
the retained array would report "cases with ERROR/FATAL logs" under a label that says something else.

`benchmarks/__tests__/benchmark-rcaeval-trigger.test.ts` holds three things:

- **An absence**: no `run-rcaeval.ts`/`run-ablation.ts` invocation in this workflow may carry `--max-cases`.
- **A count**: exactly three RE2 invocations, so removing the cap from the published run and leaving it on the
  control cannot pass as a fix.
- **An exact set** for the workflows that may still SAMPLE — the four probes/sweeps, each of which states its
  own `max N cases` in its artifact. The check reads **invocations**, not file text: its first version scanned
  the whole file, and the comment explaining why the flag is gone made `benchmark-rcaeval.yml` a member of its
  own sampler list. *A count of a syntactic form is not a statement about a group.*

And the dispatch-surface census, which the cap removal broke, now carries the decision as a **DIRECTION**:
`--max-cases` is required reachable from the FSE'26 dispatch and **required unreachable** from the RCAEval
benchmark. A future commit that re-adds a cap to this side fails that assertion instead of passing as an
omission.

**RE1 and RE3 are the control for the change**: the corpus grows for RE2 alone, so their cells must not move.
A movement there is the signal that something other than the corpus changed.

### 5.2 A fourth defect, found while verifying the third: the discovery walk is unsorted

`discoverAllCases` in both runners walks `readdirSync` breadth-first and **unsorted**, so `--max-cases N` took
*whatever the filesystem yielded first*. The capped sample's case SET was therefore arbitrary, and it could differ
between two machines evaluating the same suite.

This is why the capped suites were never reproducible at the case level while the uncapped ones were: the nine
cells are means, and a mean is order-independent. Removing the cap retires the question for the published cells,
and the sort is **deliberately not folded into this commit**, because it is **not a no-op**. The `selfLearning`
rows share a calibrator across cases, so the order in which cases are presented is part of what those rows
measure — a fix that silently reorders training is a change to a measurement, and it gets its own run.

### 5.3 A fifth defect, found by the re-run: the artifact's header described the defect, not the corpus

The study prints its own legend above the results table:

```
AVG = per-system mean over FAULT TYPES (the published convention; the nine cells are in it).  CW = per-system mean over CASES.
They coincide only where every fault type holds the same case count, which is RE1 alone.
```

That second line was **true of the capped corpus** and the correction made it **false**. On the full corpus RE2's
`AVG` and `CW` both read `83.7%`, with all six fault types at 45 case-reps — so `RE2` is a second suite where the
two folds coincide, and the parenthetical that excluded it is wrong. It said "RE1 alone" because RE2's *arbitrary
50-case sample* happened not to be balanced (`AVG` 79.8 vs `CW` 79.3), i.e. **the line was a correct description of
the defect and a false description of the benchmark.**

The repair is to stop naming a suite at all: the line now states the rule and points at the per-fault-type cells,
which print their counts and therefore settle it for whatever population the run actually has. *A named answer to
a population question goes stale the next time the population moves; a rule does not.*

**And the repair had to be ONE OWNER rather than two edits.** Correcting the table's copy exposed a **second,
independently-worded copy of the same rule** above the PRISM sweep's own frontier table, still reading
`which is RE1 alone` — so the artifact went on printing the falsified claim in one of its two tables. The
statement now lives in `FOLD_CONVENTIONS` and both renderings print it, because two wordings of one fact is the
register's *"a quantity with N implementations is a quantity with no convention"*, in prose.

### 5.4 The fence for §5.3 was itself defeated by the comment explaining §5.3

The absence fence — `expect(RUNNER).not.toContain('which is RE1 alone')` — **failed on its first run**, because
the comment directly above it quotes the phrase in order to explain why it was removed. *A text assertion is
satisfied or defeated by the prose that describes the defect.*

This is the second time this repository has paid for exactly this, and the first is already in the register:
`benchmark-rcaeval-trigger`'s sampler check scanned the whole workflow file and thereby matched **the comment
explaining why the flag was removed**, making `benchmark-rcaeval.yml` a member of its own sampler list. So the
repair here is general rather than local: the check reads **comment-stripped** source
(`stripLineComments`, whole-line `//` comments only — not trailing comments and not `//` inside string literals,
so a URL in a literal cannot be mangled), and then the assertion is about the **statement** rather than about the
file.

**The law, for the third time in this repository's own language:** *a count of a syntactic form is not a statement
about a group* — and it is not a statement about a **statement** either, until the prose around it is removed.

## 6. Measured acceptance (run `37872246084` on `db57ffb`; 10/10 jobs green, 79.3 min)

### 6.1 The nine cells, and the control that tests the repair

| suite | OnlineBoutique | SockShop | TrainTicket | suite mean |
| --- | ---: | ---: | ---: | ---: |
| RE1 | 80.0% | 92.8% | 68.0% | 80.27% |
| RE2 (was 82.4 / 88.9 / 68.1) | **86.7%** | **92.2%** | **71.1%** | **83.33%** |
| RE3 | 80.0% | 45.0% | 51.1% | 58.70% |

**RE1 and RE3 are unchanged, and asserted rather than eyeballed**: their `AC@1` table rows compare equal
line-for-line against the previous run, and the only differing lines anywhere in their artifacts are the wall-clock
duration and the `[log] sample` line (§6.4).

| | before (615 ranked) | after (735 ranked) |
| --- | ---: | ---: |
| overall, weighted by the dataset's own 375 / 270 / 90 | **77.45%** | **78.75%** |
| contribution of RE1 / RE2 / RE3 to the movement | — | 0.000 / **+1.298** / 0.000 |

The movement is **+1.30 pp and every part of it is RE2** — the prediction the control existed to test. RE2's own
suite mean moved 79.80% → **83.33%**.

### 6.2 What it does to the two claims §3 named

- `docs/sota-comparison.md` reads **78.8%** overall; against the published 68% that is ≈**1.16×**.
- `docs/prism-head-to-head.md` now compares two 735-case measurements: PRISM additive **78.91%** against ours
  **78.75%**. **The 1.5 pp deficit decomposes into 1.30 pp of corpus mismatch and 0.16 pp of engine** — one case
  of 735.

### 6.3 The heap repair, measured — and the projection it refutes

It was asserted inert on the **consumers** before it was measured. The measurement agrees, and sizes what it
removed: RE2-OB's retained entries went from a heap-limit failure to fitting, and RE3's retained volume fell by
one to two orders of magnitude **while its census case count did not move at all** (30/30 before and after):

| RE3 system | retained entries before | after |
| --- | ---: | ---: |
| OnlineBoutique | 2,163,430 | **41,401** |
| SockShop | 2,592,666 | **43,102** |
| TrainTicket | 1,937,403 | **12,313** |

And the bound: `ablation-re2` was raised 90 → 180 on a projection of 1.8× the case-runs, and measured **52.2 min** —
*less* than the **54.3 min** it took on the capped 150-case corpus. **The projection was wrong, in the safe
direction, and its error is informative: the heap was the cost, not the corpus.** Doubling the corpus while
ceasing to retain 240 MB per case per suite is *cheaper* than the capped run was. 180 is now 3.4× the measured
worst case, i.e. loose rather than binding, and it stays because a bound a working job exceeds misclassifies
healthy work while a loose one only delays detecting a hang — and the number to tighten it against is now
measured rather than projected.

**And a third measurement changed the story again.** The next run on the same corpus (`37886983273`, commit
`62bac15`) took **86.3 min** for the same job — with no change to any code path the job measures, since that
commit's edits are three console statements and a field rename. Its siblings moved by under a minute
(`rcaeval-re2` 27.3 → 27.5, `ablation-re3` 31.5 → 32.5, `ablation-re1` 16.9 → 14.3). So `ablation-re2` has been
observed at **52.2 and 86.3 min — a 65% spread**, and the old 90-minute bound would have **killed the second
run**. The 90 → 180 raise was therefore necessary, but for a reason the record did not have: **run-to-run variance
on the heaviest job, not "1.8× the case-runs"**. 180 is 2.1× the observed worst case. *A bound set from one
measurement is a bound with no margin, and a precedent is not a measurement* — this repository's own law, here
with a number attached. A future iteration should set this from a distribution (several runs) rather than from the
newest sample.

### 6.4 A third correction: two instruments now print the same word for different quantities

The heap repair changed one instrument's meaning while leaving an identically-worded line in another.
`run-rcaeval.ts` prints `90/90 cases with logs`, counted from `logRowsRead` — the **pre-filter** count, cases whose
file yielded any row. `directional-evidence.ts` prints `logs 21/90`, counted from the retained array — cases with
at least one **readable** row. On RE2-OB those are the same corpus and differ by a factor of four. `TERM_CHANNELS`
decides `logWeight`'s measurability from the second, which is the correct quantity, because a case with no
ERROR/FATAL row contributes nothing to the signal — but **neither label says which quantity it is.** Fixed by
naming the field; see `docs/ablation-input-census.md`.

### 6.5 A correction to the PREVIOUS iteration's headline

Iteration 74 measured `LAT WHOLE FILE` — the run that finally feeds the propagation channel, the one place the
Deng-Yu mathematics enters the ranking — at **+1.9 pp on RE2**, and reported it as that term's first live
measurement. On the corrected 270-case corpus it reads **Δ+0.0**.

The term is **not inert**: it moves RE2-OB 86.7% → 84.4% and RE2-TT 71.1% → 73.3%. But the two movements are
opposite in sign and the published convention's mean absorbs both. Its control (`LAT WHOLE FILE + LAT OFF`)
returns to the baseline **exactly**, so the zero belongs to the channel and not to the corpus row.

**The +1.9 is withdrawn as a statement about the benchmark.** It was a real measurement on a real corpus; it was
not a measurement of the corpus the claim is about. That is this document's own law, applied to the iteration that
wrote it.

## 7. The law

**A benchmark claim cannot be weighted by a corpus it did not rank.** The generalisation is the one this
repository keeps re-learning in new clothes: a summary must be a function of the population that was measured.
Here the population was written down in the *dataset* rather than the *run*, and nothing failed — no test, no
gate, no artifact — because every artifact printed its own case count and only the prose that folded them read
from somewhere else.
