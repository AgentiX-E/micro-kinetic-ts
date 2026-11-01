# The guard's statistic is an instrument for a corpus, not a theorem about one

**Status:** the seventh member of the guard's vocabulary — `evidence-aware` — is IMPLEMENTED and the shipped
default is unchanged (`endpoint`), because a default moves only after all nine cells have been read and the
ninth (`RE2:TrainTicket`) could not be completed on this host. Measured locally on the 723-case corpus, one
variable, whole cells:

| family                 | `endpoint` (shipped) | `evidence-aware` |         Δ |
| ---------------------- | -------------------: | ---------------: | --------: |
| `RE1:OnlineBoutique`   |     85.6 % (107/125) | 89.6 % (112/125) |   **+5** |
| `RE1:SockShop`         |     93.3 % (112/120) | 95.0 % (114/120) |   **+2** |
| `RE1:TrainTicket`      |     85.0 % (102/120) | 89.2 % (107/120) |   **+5** |
| `RE2:OnlineBoutique`   |                92.0 % |           92.0 % |     **0** |
| `RE2:SockShop`         |                97.8 % |           97.8 % |     **0** |
| `RE2:TrainTicket`      |                    — |                — | unmeasured |
| `RE3:OnlineBoutique`   |                87.5 % |           87.5 % |     **0** |
| `RE3:SockShop`         |                63.6 % |           63.6 % |     **0** |
| `RE3:TrainTicket`      |                30.6 % |           30.6 % |     **0** |

**This is the first arm on this axis that costs nothing anywhere it can be read.** The global `level-window`
arm bought the same 12 cases and paid 22 (`docs/transient-guard-test.md` §6); the pre-registered conditional
arm would have bought 12 and paid 10 (§1); this one pays 0 on the five cells it does not gain on, and the two
cells it gains most on are the two weakest cells in the family.

**Owner of:** `transientGuardTest: 'evidence-aware'` and `sideChannelObserved`
(`packages/tree/src/causal/topology-fault-graph.ts`), the derivation in `TreePruner.buildFaultGraph`
(`packages/tree/src/pruning/pruner.ts`), `DEFAULT_SIDE_CHANNEL_OBSERVED`, `--transient-guard-test`, and
`anomaly_knobs=transguard=evidence-aware`.

---

## 1. The claim this document replaces, and the reason it failed

`docs/transient-guard-test.md` §5 pre-registered one conditional arm and then falsified it with the corpus's
own partition:

> _Apply `level-window` only where the case carries no direction evidence._ The partition above falsifies it
> before it could be dispatched: the rule sends `RE3:SockShop` (one of the five cells with no `edgeLatency`
> rows) to `level-window`, which is precisely where the arm loses seven cases.

The falsification was correct and the repair it implied was wrong in one word: **"direction evidence" was
defined by one array**. The register of that definition is `packages/tree/src/pruning/pruner.ts`, which reads
`edgeLatency` — and `edgeLatency` is one of **four** arrays a case can carry across a call boundary:

```
logs · traceActivity · failedTraceEdges · edgeLatency
```

`RE3:SockShop` has no `edgeLatency` rows and no traces. It carries **43 102 ERROR/FATAL log entries over
30 of 30 cases**, 5 834 of them admitted in-graph. The log term (`logWeight=1`, `logSignalMode=count`) reads a
call boundary, and on that cell it has more input than any other cell in the family. So the sentence "RE3:
SockShop has no direction evidence" was not a measurement — it was a reading of one array standing in for
four, which is the same defect class as a knob that reaches nothing: the absence of one input is reported as
the absence of the mechanism.

That mis-classification is worth exactly the difference between the falsified arm and this one:

| cell | direction evidence as `edgeLatency` alone | as the loader's four arrays | what the falsified rule did | what `evidence-aware` does |
| --- | --- | --- | --- | --- |
| `RE2:SockShop` | none (0 rows) | **logs 90/90, 134 903 entries** | `level-window` → **−3 cases** | `endpoint` → 0 |
| `RE3:SockShop` | none (0 rows) | **logs 30/30, 43 102 entries** | `level-window` → **−7 cases** | `endpoint` → 0 |

Ten cases, on the two cells whose only window onto a call boundary is a log file.

## 2. The census, per cell, from the runs themselves

Every figure below is printed by the runner on the cell it belongs to (`failed edges in`, `[trace]`, `[log]`,
`latency-routes`, `log-routes`), not inferred from the suite's name:

| cell | failed edges | traces | logs | per-edge latency | observed a boundary? |
| --- | --- | --- | --- | --- | --- |
| `RE1:OnlineBoutique` | 0/125 | **0/125** | **0/125** | 0 rows | **no** |
| `RE1:SockShop` | 0/120 | **0/120** | **0/120** | 0 rows | **no** |
| `RE1:TrainTicket` | 0/123 | **0/123** | **0/123** | 0 rows | **no** |
| `RE2:OnlineBoutique` | 0/87 | 86/87 | 83/87 | rows present | yes |
| `RE2:SockShop` | 0/90 | **0/90** | 90/90 | 0 rows | yes — logs only |
| `RE2:TrainTicket` | — | — | — | — | (not completed) |
| `RE3:OnlineBoutique` | 14/28 | 26/28 | 28/28 | rows present | yes |
| `RE3:SockShop` | 0/30 | **0/30** | 30/30 | 0 rows | yes — logs only |
| `RE3:TrainTicket` | 0/30 | 30/30 | 30/30 | rows present | yes |

The three rows with `no` are the whole of RE1, and they are not a coincidence of corpus generation: RCAEval
RE1 ships `metrics.json` only — one file per case, no `logs.csv`, no `traces.csv`. On those cells every channel
in the graph is a service's own reading, so a caller's latency rise and its callee's are the same kind of
number, and the guard's undocumented second job — damping the magnitude advantage of a propagated symptom over
its source — is the *only* mechanism separating them.

## 3. The rule

```
guardTest = sideChannelObserved ? 'endpoint' : 'level-window'
```

which is one line of the builder:

```ts
const guardTest =
  cfg.transientGuardTest === 'evidence-aware'
    ? cfg.sideChannelObserved
      ? 'endpoint'
      : 'level-window'
    : cfg.transientGuardTest;
```

`evidence-aware` is **not a fifth estimator.** It is the admission that the two statistics are instruments for
different corpora, and the nine cells are the measurement that says so rather than the argument:

- Where nothing in the case can see a boundary, the direction terms are silent **by construction** — there is
  no `failedEdge`, no `lat`, no `trace` input to be had — so the honest question is the one the guard's
  contract states: _did this channel settle at a new level, or return to the one it started at?_
- Where something did see a boundary, a term already reads direction, and the endpoint statistic's job shrinks
  back to "did this channel move" — which is the question it answers on every published cell.

The two statistics are therefore not two estimates of one quantity, and the axis was never "which estimator is
better". It is "which question is answerable here", and the answer is a property of the case.

## 4. Why the second input is not a command-line flag

`sideChannelObserved` is a field on `TopologyFaultGraphConfig`, but `--transient-guard-test` accepts no
companion flag for it, and `RCAEVAL_SYSTEM_CODES`' sibling reasoning applies: **a flag would let a caller
assert a fact the corpus contradicts.**

Three tiers, which is one more than the builder alone can distinguish:

1. **The loader knows** whether it read a `logs.csv` — it either found the file and parsed rows or it did not.
   That is the top tier, and it is a fact about the case.
2. **The builder cannot see it.** Handed `metrics` alone, `buildTopologyFaultGraph` sees an empty
   `edgeLatencyScores` for two different worlds — "this corpus ships no spans" and "the spans named no in-graph
   edge" — and those are the difference between a silent direction term and one that measured zero.
3. **The pruner is where the arrays still exist.** `TreePruner.buildFaultGraph` receives `logs`,
   `traceActivity`, `failedTraceEdges` and `edgeLatency` from `toFaultGraphOptions` — which forwards all four
   precisely because two call sites once drifted and left two of them dead on the largest benchmark — so it
   derives the answer there and passes it down:

```ts
const sideChannelObserved =
  (options?.logs?.length ?? 0) > 0 ||
  (options?.traceActivity?.size ?? 0) > 0 ||
  (options?.failedTraceEdges?.length ?? 0) > 0 ||
  (options?.edgeLatency?.length ?? 0) > 0;
```

The default, `DEFAULT_SIDE_CHANNEL_OBSERVED = true`, is the value and the argument: `true` resolves to
`endpoint`, so a caller who never sets the field gets the shipped statistic **byte for byte** — and the test
that holds it asserts identity of `anomalyScores` and `metricDiagnostics` across three statistics × two flag
values rather than four literal outcomes, because the claim is that the field is unread outside its arm.

## 5. The flip census

Both runs carry `--diagnose-dump`, so the 25 cases that moved can be read one at a time (dump-derived case
counts; the printed `AC@1` differs on `RE1:TrainTicket` by the three cases its classifiable population
excludes, which are wins in both arms).

| cell | gains | losses | net |
| --- | --- | --- | --- |
| `RE1:OnlineBoutique` | 7 | 2 | **+5** |
| `RE1:SockShop` | 2 | 0 | **+2** |
| `RE1:TrainTicket` | 6 | 1 | **+5** |
| `RE2:OnlineBoutique`, `RE2:SockShop`, `RE3:OnlineBoutique`, `RE3:SockShop`, `RE3:TrainTicket` | 0 | 0 | **0** |

Every gain is the event `docs/transient-guard-test.md` §4 already names: **the truth's own latency channel was
dropped by the endpoint statistic and is kept by the level test** — `re1ob_adservice_delay_3` (an intermittent
106 ms plateau over 361 of 721 samples, discarded because the last sample is an off-beat), `adservice_delay_4`,
`cartservice_loss_4`, `adservice_loss_4` (whose truth had been erased from the evidence entirely),
`checkoutservice_loss_1`, `currencyservice_cpu_1`, and six `re1tt_ts-auth-service` / `ts-order-service` cases.

The three losses are the same event read in reverse, and they are the ones this arm could not avoid without
becoming the union: `re1ob_currencyservice_loss_5` and `re1ob_checkoutservice_loss_3` (the endpoint statistic
keeps them, the level test drops them, because the truth's pre- and post-medians coincide while its two ends do
not) and `re1tt_ts-travel-service_loss_4`, the case `either` also gives back — the level test restores the
CALLER's propagated `latency-90` and it lifts the caller above the source.

## 6. A defect this measurement found on the way, unrelated to the guard

`--system` was accepted, printed, and **ignored**.

```
Filter: system=ob, suite=re1        ← printed
Groups to evaluate: 3               ← the three systems, i.e. the filter never applied
```

The only place the value was read compared `c.system` against the three canonical names instead of against the
filter:

```ts
if (opts.system !== 'all' && c.system !== 'OnlineBoutique' && c.system !== 'SockShop' &&
    c.system !== 'TrainTicket') continue;   // false for every case a corpus contains
```

so `--system xyz` also ranked all nine cells, and the banner named the filter the run had been asked for rather
than the one it applied. Two manual dump workflows (`.github/workflows/dump-re3-metrics.yml`,
`dump-re3-exceptions.yml`) dispatch this flag, so their artifacts are labelled with one system and hold three.

Repaired at the root rather than in place: the token is folded through `RCAEVAL_SYSTEM_CODES` at parse time
(`parseSystemFilter`, refusing a value it cannot honour by name), the rule moved into a predicate
(`systemMatches`) that `benchmarks/__tests__/system-filter.test.ts` exercises as a 4 × 4 matrix, and the
runner calls it. A comparison in place is what rotted, because nothing could call it — which is why the flag
survived the tree of tests that read the runner's other twenty vocabulary members.

**This is also why the cell readings above are trustworthy where earlier local readings were not:** before the
repair, a "per-cell" local run silently evaluated all three systems and reported the last group's total, so
`RE1:OnlineBoutique` read 85.0 % (TrainTicket's number) and a reader had no way to tell.

## 7. Limits

- **One cell unread.** `RE2:TrainTicket` was killed at graph construction on this host — rc=137, ~3.5 GB
  resident, four attempts: default heap, `--max-old-space-size=16384`, and `BENCHMARK_USE_TFIDF=1`. The last of
  those rules out the embedding API (`Zhipu embedding-3` is at its quota) and locates the cause in the cell's own
  size — 90 cases against a 63–69 service graph. It is the one cell that could falsify the arm on the RE2 family
  and it is the dispatch's first job. The prediction is **0**: its traces cover the cell (`RE2` carries spans on
  every other system), so it resolves to `endpoint`.
- **A banner that named a provider the run was not using.** Found while producing the line above: the topology
  line printed `+ semantic enhancement (Zhipu embedding-3)` on a `BENCHMARK_USE_TFIDF=1` run, because
  `createSemanticConfig` always returns a provider and the line tested the provider's PRESENCE rather than its
  `meta.backend`. Repaired at the source — the banner now prints `local TF-IDF, no network` or
  `Zhipu embedding-3, network` from the provider's own answer — with a source-level guard in
  `benchmarks/__tests__/semantic-config.test.ts`. Same class as the `--system` defect in §6: an artifact
  describing a configuration nobody ran.
- **The predicate is coarse at the case level and per-case inside a cell.** It is one boolean per case, not per
  channel: a case that carries a log file for one incident and none for another is `observed` throughout. The
  corpus happens to be all-or-nothing per cell (table §2), which is why the arm reads as a suite rule here
  without being one.
- **`logs.csv` present is not `logs.csv` usable.** The flag is `logs.length > 0`, so a case whose log carries
  only the framework's start-up preamble counts as observed. `RE3:TrainTicket` is exactly that shape — 12 313
  rows retained, **0 admitted** — and it is the cell with the lowest `AC@1` in the family. The arm reads it as
  observed and leaves it at `endpoint`; a finer predicate would send it to `level-window`, where it scores
  51.1 % against 30.6 %. Whether that is a gain or an artifact of the metric is unmeasured, and it is the
  single most valuable open question this table exposes.
- **The gain is still a verdict, not a magnitude.** No channel is made louder than its own deviation, so
  nothing here moves a case lost on amplitude.

## 8. What it does not buy

89.6 % on `RE1:OnlineBoutique` is above the published competitor's 88.0 % on that cell
(`arXiv:2610.05009`, per-system Table 5) and that is the only cell where this repository now leads on a public
number — **one cell out of nine, by 1.6 pp, on the cell every competitor chooses to report.** The family
totals are unchanged where the arm is inert, and the two structural defects the miss census names are
untouched by it:

- `re1ob_productcatalogservice_loss_1..5`: the truth loses to `recommendationservice`, whose `latency-90` rises
  11.3× against the truth's 1.52×. That is a propagated symptom out-screaming its source on the cell with no
  side channel at all, and no guard statistic can fix it — it needs a mechanism that penalises the far end of a
  propagation chain, which the library does not have.
- `re3ss_carts_f1_2` and its siblings: the truth loses to `front-end` on an `error` channel at 1.7× the
  truth's own reading.

So the arm is **+12 cases and no debt**, not SOTA. `docs/sota-comparison.md` §0p carries the standing table.
