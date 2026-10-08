# Ablation input census — making every zero say whether it is starved or inert

**Status:** instrument landed and fenced; the two priors the battery had never varied are now rows.

## 1. The defect: a table of identical-looking zeros

`ABLATION_FINDINGS.md` v5 reports a table in which most rows read `Δ+0.0%`. **Two of those zeros are not the
same statement**, and nothing on the artifact said which kind each was:

- **RE1 carries no `logs.csv` and no `traces.csv`.** The golden's own artifact records
  `[log] No log data available for 125 cases` three times and `[trace] No trace data available for 125 cases`
  three times. Every boolean signal there multiplies an empty channel, so its zero is **STARVED** — it says
  nothing about the term's worth.
- **RE2 carries 50 of 50 cases with logs and 50 of 50 with traces**, and *every* engine term still reads
  `Δ+0.0%` (`+Log Signal`, `+Trace Activity Signal`, `+Rank Normalization`, `+Collapse Discount`,
  `+Idle Transient Suppression`, and the whole `+Log +Trace Activity +Rank` production row). That zero is
  **INERT**: the input arrived and the ranking did not move.

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
