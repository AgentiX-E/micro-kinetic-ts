# Ablation input census — making every zero say whether it is starved or inert

**Status:** instrument landed and fenced; the two priors the battery had never varied are now rows.

## 1. The defect: a table of identical-looking zeros

`ABLATION_FINDINGS.md` v5 reports a table in which most rows read `Δ+0.0%`. **Two of those zeros are not the
same statement**, and nothing on the artifact said which kind each was:

- **RE1 carries no `logs.csv` and no `traces.csv`.** The golden's own artifact records
  `[log] No log data available for 125 cases` three times and `[trace] No trace data available for 125 cases`
  three times. Every boolean signal there multiplies an empty channel, so its zero is **STARVED** — it says
  nothing about the term's worth.
- **RE2 carries 90 of 90 cases with logs and 90 of 90 with traces on each system**, and *every* engine term still
  reads `Δ+0.0%` (`+Log Signal`, `+Trace Activity Signal`, `+Rank Normalization`, `+Collapse Discount`,
  `+Idle Transient Suppression`, and the whole `+Log +Trace Activity +Rank` production row). That zero is
  **INERT**: the input arrived and the ranking did not move. (This bullet read `50 of 50` while RE2 was ranked at
  its capped 150 cases; the corpus is now the full 270 — see `docs/benchmark-corpus-completeness.md`.)

Reporting both as `+0.0%` is what made the ledger unreadable, and it is the register's own requirement that a
zero be readable: *a zero can be read as starved or inert, and the artifact must say which.*

The distribution is asymmetric in a way that matters: **RE1 is the suite that blocks every global PRISM weight**
(its `delay`/`loss` cells regress under any positive weight, in both poolings), and it is also the suite with
**no channels at all**. So the only levers left on the blocking suite are the terms that act on the one channel
it does have — its metrics. Two of those, `poolMetricPenaltyWeight` and `stabilityWeight`, had **never been
varied in any battery**: the register recorded the gap itself, naming the never-ablated numeric terms as the
candidates for the contributor its rows did not account for.

## 2. The instrument

`benchmarks/src/directional-evidence.ts` gains a census and a verdict, and `ablation-engine-options.ts` gains a
configuration diff:

| export | what it answers |
| --- | --- |
| `TERM_CHANNELS` | which channel each signal term reads — `logWeight`→logs, `traceWeight`→spanActivity, `topoWeight`→spans, `latWeight`→latency, and the metric terms (`collisionWeight`, `poolMetricPenaltyWeight`, `stabilityWeight`) →metrics. Owned here rather than beside the print statement, because the verdict is a function of it and a mapping beside a `console.log` is a mapping nobody can test. |
| `summarizeInputCoverage(cases)` | per-channel case counts: logs and entries, spans, span activity, failed edges, latency edges and cases. |
| `channelCases(coverage, channel)` | the count for one channel; `metrics` is the population, since every RCAEval case has metrics. |
| `readZero(delta, coveredCases)` | **`moved` / `INERT` / `STARVED`** — the distinction, as a value. |
| `formatInputCoverage(coverage, label)` | the census as lines, naming every starved channel **and the terms it makes unmeasurable**. |
| `configDiff(baseLine, rowLine)` | which fields a row's configuration line differs from the baseline's in — i.e. **the TERMS a row varied**, since a label names a flag and a verdict needs a term. |

The study prints both, and gains a `0.0 VERDICTS` block after its results table that meets each row's varied
terms with each system's census, so a reader never has to reconstruct either. `AblationRun` now carries its
`overrides` (it did not), because without them the row's configuration line could not be rebuilt from its own
record — the same defect the artifact's line was added to repair, one level down.

## 3. The three rows the battery had never had

As siblings of the shipped configuration, one override apart, so each delta is attributable:

| row | varies |
| --- | --- |
| `POOL PENALTY OFF (poolMetricPenaltyWeight=0)` | the pool-dominance penalty, shipped at `0.0679` |
| `STABILITY OFF (stabilityWeight=0)` | the decisive-stability prior, shipped at `0.007352` |
| `POOL PENALTY + STABILITY OFF` | both, so their interaction is separable |

Both overrides read through `??`, because `0` is the only value these rows express and `||` cannot express it.
Their effect is measured on the next run; what this document fixes is that they are now **measurable at all**,
and that the artifact states the value (not the flag) they ran at.

## 4. The survivor this iteration's own fence produced

The row-label assertion was written as `toContain('STABILITY OFF')` — and the mutation that renamed that row's
label **survived**, because the row labelled `POOL PENALTY + STABILITY OFF` is a **superstring** of it. The
assertion now requires the quoted literal, `label: 'STABILITY OFF`, and the mutation is killed.

**A substring assertion is satisfied by any superstring.** This is the same law as the `prismPooling` survivor
of iteration 69 in a different guise: *an assertion that is true of a different member of the population is not
an assertion about this member.*

## 5. Fences

`benchmarks/__tests__/input-coverage.test.ts` (7 tests): the census counts every channel and treats metrics as
the population; the truth table of `readZero` including the signed case and float dust; the starved-terms line
names the unmeasurable terms **and stays silent when no channel is empty**; `TERM_CHANNELS` covers every signal
term and its channel set is exactly the union `channelCases` is total over; the three rows exist as label
literals; the overrides read through `??`; and `configDiff` returns the varied terms in the baseline line's
order. **Four mutations, four killed** — one of them only after the fence was strengthened by its own survivor.

## 6. The measurement — run `37832140805`, and the two defects the census found in ITSELF

The three new rows landed, and on **RE1 — the suite where nothing else can be measured — the verdict is
`INERT` on all three systems**:

```
POOL PENALTY OFF (poolMetricPenaltyWeight=0)   varies=poolMetricPenaltyWeight
  OnlineBoutique:INERT  SockShop:INERT  TrainTicket:INERT
STABILITY OFF (stabilityWeight=0)              varies=stabilityWeight
  OnlineBoutique:INERT  SockShop:INERT  TrainTicket:INERT
POOL PENALTY + STABILITY OFF                   varies=poolMetricPenaltyWeight,stabilityWeight
  OnlineBoutique:INERT  SockShop:INERT  TrainTicket:INERT
```

**Not `STARVED`.** Their channel is metrics, and RE1 carries 125 of 125 cases with metrics. So this is the first
measurement of either prior in this repository's history, and it is a verdict rather than an excuse: the two
priors the register named as the candidates for its unattributed RE1 contributor are worth **exactly 0.0**
there. RE3's census is richer still and reads the same way — logs 30/30 on every system (2.16 M / 2.59 M /
1.94 M entries), span activity 30/30 on two of three, `topoWeight` and `latWeight` the only starved terms — and
its three rows are `INERT` there too.

**And reading the first output found two defects in the census itself**, which is what a census is for:

1. **A switch row had no verdict at all.** The block rendered `UNKNOWN-CHANNEL` for a varied field absent from
   `TERM_CHANNELS` — and the fields that are absent are SWITCHES, FLOORS and FORM SELECTORS. `+Rank
   Normalization` and `+Idle Transient Suppression` both read `Δ+0.0%` on RE1, and both got a token that
   explained nothing. **A switch multiplies no input, so it cannot be starved of one, and its zero is always
   the statement that the ordering did not move**: the block now falls back to the population for such a term,
   and `UNKNOWN-CHANNEL` no longer exists. The non-signal set is pinned by name in the fence, so it is a
   declaration rather than an omission. (`riseWeight` and `prismWeight` were moved INTO the map in the same
   pass: both are metric-derived, so both act on the channel every case has.)
2. **`spans` counted what a case RETAINS, not what it HAD.** The census read `case.traces`, which the assembly
   frees after deriving everything from it — so it reported **`spans 0/30` on RE3**, a corpus whose graph *was*
   augmented from traces, and declared `topoWeight` **UNMEASURABLE** there. The loader now takes the count from
   the assembly's own `traceUsed`. *This is the defect the census exists to prevent, committed by the census*,
   and it was visible only because the census printed a line that could be checked against the golden's own
   `[trace] … pruned` line for the same suite.

## 7. The question it left open, and the answer — `docs/latency-channel-views.md`

This census could say that the latency channel held nothing and could not say why, and the difference is the
whole of iteration 74. On RE3 OnlineBoutique it read

```
failedTraceEdges 15/30 cases, 30 edges | edgeLatency 0/30 cases, 0 edges
```

— two outputs of ONE relation, one populated and one empty in the same cases. `STARVED` names the term's verdict;
it does not name the mechanism, and three mechanisms predict that same zero while disagreeing about what to do
next: a **missing injection anchor**, a **start time scaled twice**, and a **cap that truncates before the
post-injection window**. `latency-routes[<system>]` now counts the anchor's presence, the capped list's pre/post
split, and each of the three derivations' row counts, and prints a verdict computed from them.

The answer, and the correction it forces on the record: **`latWeight` is starved by the DERIVATION, not by the
corpus.** The published composition scales a start time the loader had already normalised to milliseconds, so
every span lands after the anchor and no edge can have a pre-side mean — and the whole-file route, which holds
exactly the same quantity and was computed in the same streaming pass, was dropped one line later. That makes the
nine published cells a corpus whose dominant latency term multiplied an empty array; it also **withdraws the
attribution** this repository had recorded for the earlier signed readings of this channel (see
`docs/corpus-assembly.md` §6 and `docs/latency-channel-views.md` §6).

## 8. The census on the corrected corpus, and the word it was sharing

Run `37872246084`, the full 735. The three suites' censuses:

```
input-coverage[OnlineBoutique]: 125 cases | logs 0/125 readable (0 entries) | spans 0/125 | spanActivity 0/125 | failedEdges 0/125 | latency 0/125 (0 edges)      [RE1]
input-coverage[OnlineBoutique]:  90 cases | logs 21/90 readable (9228 entries) | spans 90/90 | spanActivity 0/90 | failedEdges 0/90 | latency 0/90 (0 edges)  [RE2]
input-coverage[OnlineBoutique]:  30 cases | logs 30/30 readable (41401 entries) | spans 30/30 | spanActivity 30/30 | failedEdges 15/30 | latency 0/30 (0 edges) [RE3]
```

Three things changed for the better and one for the worse.

**Better: the heap repair is visible here.** RE3's readable volume fell from 2,163,430 / 2,592,666 / 1,937,403
entries to 41,401 / 43,102 / 12,313, **with the case count unchanged at 30/30** — which is the census confirming a
targeted filter rather than a loss of input.

**Better: RE2's `delay`/`loss` question now has a full population.** `+Log Signal` on RE2 reads `−0.4` on the
corrected corpus (it was `+0.0` on the capped one) — a movement that is only visible once all six fault types are
present in every system.

**Better: RE3's `failedEdges 15/30` is now a number with a cause.** `latency-routes` (§7) resolves it to
`CAP TRUNCATES` on every trace-bearing cell.

**Worse, and it is this instrument's own naming.** When the assembly began retaining only readable rows, this
census's `logs N/M` silently stopped counting the same quantity as the golden's identically-worded line:

| instrument | line | counts | RE2-OB reads |
| --- | --- | --- | --- |
| `run-rcaeval.ts` | `90/90 cases with logs` | cases whose file yielded **any** row (`logRowsRead`, pre-filter) | **90/90** |
| `directional-evidence.ts` | `logs N/M readable` | cases **retaining** a readable row (post-filter) | **21/90** |

A factor of four, under one word, for one corpus. The intent on both sides is defensible — the golden reports
what the LOADER saw, the census reports what the SIGNAL can read, and a case with no ERROR/FATAL row contributes
nothing to `logWeight`, so the census's is the quantity `TERM_CHANNELS` must decide on. What was not defensible
was that neither label said which it was. The field is renamed `casesWithReadableLogs` and the printed token is
`readable`, so the two can no longer be read for one another — and a fence asserts the label, because a number
alone cannot distinguish them. **Having two instruments is not the defect; having two instruments with one word
is.**
