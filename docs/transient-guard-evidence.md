# The guard's statistic is an instrument for a corpus, not a theorem about one

**Status:** the fourth member of the union — `evidence-aware` — is IMPLEMENTED, **measured on all nine cells**
(dispatch `41263011254`, one variable, whole cells, both arms on the anchored protocol), and it is the first arm
on this axis with **no cell down**:

| cell                   | `endpoint` (shipped) | `evidence-aware` |         Δ |
| ---------------------- | -------------------: | ---------------: | --------: |
| `RE1:OnlineBoutique`   |     85.6 % (107/125) | 89.6 % (112/125) |   **+5** |
| `RE1:SockShop`         |     93.6 % (117/125) | 95.2 % (119/125) |   **+2** |
| `RE1:TrainTicket`      |     84.8 % (106/125) | 89.6 % (112/125) |   **+6** |
| `RE2:OnlineBoutique`   |      92.2 % (83/90)  |     92.2 % (83/90) |     **0** |
| `RE2:SockShop`         |      97.8 % (88/90)  |     97.8 % (88/90) |     **0** |
| `RE2:TrainTicket`      |      83.3 % (75/90)  |     83.3 % (75/90) |     **0** |
| `RE3:OnlineBoutique`   |     88.9 %           |           88.9 % |     **0** |
| `RE3:SockShop`         |     63.6 %           |           63.6 % |     **0** |
| `RE3:TrainTicket`      |     74.5 %           |           74.5 % |     **0** |
| **total**              | **87.21 % (641/735)** | **88.98 % (654/735)** | **+13** |

**This is the first arm on this axis that costs nothing anywhere.** The global `level-window` arm bought 13 cases
and paid 22 (`docs/transient-guard-test.md` §6); the pre-registered conditional arm would have bought 13 and paid
10 (§1); this one pays 0 on the six cells it does not gain on. It is measured and **not yet shipped as the
default**: the default moves when the FSE'26 half is read too, because `sideChannelObserved` is derived per case
there rather than known per suite, and a default that moved one half without the other would be the defect this
repository keeps finding.

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

Both arms of the local 723-case run carry `--diagnose-dump`, so the cases that moved can be read one at a time
(dump-derived case counts; the printed `AC@1` differs on `RE1:TrainTicket` by the three cases its classifiable
population excludes, which are wins in both arms). The numbers below are that run's; the dispatch reproduces the
same **+13 net** on the full 735-case corpus, where `RE1:SockShop` is 125 cases rather than 120:

| cell | gains | losses | net | CI Δ cases |
| --- | --- | --- | --- | --- |
| `RE1:OnlineBoutique` | 7 | 2 | **+5** | **+5** |
| `RE1:SockShop` | 2 | 0 | **+2** | **+2** |
| `RE1:TrainTicket` | 6 | 1 | **+5** | **+6** |
| `RE2:OnlineBoutique`, `RE2:SockShop`, `RE2:TrainTicket`, `RE3:OnlineBoutique`, `RE3:SockShop`, `RE3:TrainTicket` | 0 | 0 | **0** | **0** |

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

- **The one cell this host cannot read is read elsewhere, and it agreed.** `RE2:TrainTicket` was killed at graph
  construction locally — rc=137, ~3.5 GB resident, four attempts: default heap, `--max-old-space-size=16384`, and
  `BENCHMARK_USE_TFIDF=1`. The last of those rules out the embedding API (`Zhipu embedding-3` is at its quota) and
  locates the cause in the cell's own size — 90 cases against a 63–69 service graph. `41263011254` measured it at
  **83.3 %, unchanged**, i.e. the prediction held and the cell resolves to `endpoint` as the census said it would.
  A local-harness limit is not a corpus fact, and this is the first time the difference was demonstrated rather
  than asserted.
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
- **One of the six zeros rests on the coarseness of the predicate, and it is the one that would go the other
  way.** `RE2:SockShop` has no traces, no per-edge latency and no failed edges; its only side channel is a log
  file of which **2 rows in the whole cell** are admitted in-graph. The term therefore does not really fire
  there, and a predicate written as "the direction terms had content" would send that cell to `level-window` —
  where it reads **94.4 % against 97.8 %**, i.e. **−3 cases**. So the arm's zero on that cell is bought by
  reading the ARRAY rather than the term, and the coarse reading is the conservative one here by luck rather
  than by argument. Any move to a finer predicate has to carry this cell as its first test, and the honest
  default until then is the coarse one, which costs nothing on the six cells it does not gain on.
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

So the arm is **+13 cases and no debt**, not SOTA. `docs/sota-comparison.md` §0p carries the standing table.

## 9. The other half of the AND was never unreachable — it was unmeasured, and one sentence stood in for it

`dispatch-surface-census.test.ts` carried this row for the axis:

> `transientGuardTest` … **Not mirrored on FSE'26** — that corpus carries no injection boundary in the units
> this test splits on, so the fallback would be the shipped statistic on every case and a `ranking_knobs` row
> would advertise a state it could never enter.

and the golden half's own flag table repeated it from the other side — *"the guard consumes the injection
boundary this half's cases carry and FSE'26's do not, so the knob has no meaningful FSE'26 state to expose"*.
**Neither sentence cites a measurement, and both are about a corpus fact that costs one grep to check.** The
loader rebuilds every series' timestamps from the bridge's compact `{start, step, values}` form
(`expandMetricTimestamps`) and forwards the case's own `raw.injectTimeMs` — the two inputs `levelPermanence`
reads. So the axis may well be reachable there, and if it is, an arm measured at **+13 / −0** on the golden
half has had one side of the kill criterion's AND refused on the strength of a comment.

That is the most-repeated defect shape in this repository — an artifact describing a configuration nobody
ran, a workflow input a runner dropped, a semantics label nothing enforced — and the only difference here is
that the artifact is a **sentence**.

### 9.1 What was built

- `--transient-guard-test` on `fse26-cli.ts`, refusing an unknown member by name and listing the union's own
  vocabulary (read from `TRANSIENT_GUARD_TESTS`, so a fifth member cannot become unparseable silently).
- `transientGuardTest` forwarded in `fse26-engine-options.ts`'s `topology` object, rendered on the `Config:`
  line and recorded in the JSON `config` block, and named on the ablation battery's line — the last of those
  matters more here than anywhere: **the two statistics are byte-identical on every case whose boundary
  cannot be placed**, so a field that varied and was not printed produces an artifact indistinguishable from
  the row it is read against.
- `transient_guard_test` in the FSE'26 workflow's packed `ranking_knobs` block, with an unknown value
  exiting non-zero like every other name in that block.
- The census row moved from `fse26: null` to `'ranking_knobs'`, and `transientGuardTest` therefore joined
  `DISPATCHABLE_ON_BOTH` — which is the whole point: the AND is now askable on both halves.

### 9.2 The census that makes a zero interpretable

Adding the knob is not enough to read the result, because **a zero has two causes that look identical**:
the level test agreed with the endpoint test on every case, or the level test never ran. So the FSE'26 runner
now prints a second census line beside the failed-edge coverage one:

```
[guard] boundary placeable=N/M injectTime=P noSplit=Q
```

`N` counts cases where any channel can actually be split — the predicate is `injectionSplitIndex`, which was
**extracted from `levelPermanence` rather than retyped** and now has two readers, so the census and the
estimator cannot drift apart on the three-sample floor or on the timestamp-alignment rule. `P` and `Q` are
kept apart on purpose: a corpus that knows no injection time and a corpus that knows every injection time
and can still split none of them are the same ratio and opposite findings, which is why the line names four
numbers and no percentage.

### 9.3 The reading: three runs on one commit, and the axis is bigger on the other half

Three full FSE'26 dispatches on `f92e88f`, one variable, 1422 cases each:

| arm | `Top@1` | `Top@3` | `Top@5` | Δ Top@1 |
| --- | ---: | ---: | ---: | ---: |
| `endpoint` (shipped) | 60.5 % (860/1422) | 79.0 % | 82.2 % | — |
| `evidence-aware` | 60.5 % (860/1422) | 79.0 % | 82.2 % | **0** |
| `level-window` | **63.1 % (897/1422)** | **80.8 %** | **85.0 %** | **+37 cases** |

and the census line every one of them printed:

```
[guard] boundary placeable=1422/1422 injectTime=1422 noSplit=0
```

**Two claims die here and one is born.**

*The census row was false.* Every FSE'26 case places an injection boundary — `placeable=1422/1422`, not the
"no injection boundary in the units this test splits on" that `dispatch-surface-census.test.ts` had carried
since the axis existed. The row has been corrected, and the correction is the cheap half of this finding:
the sentence was checkable with one grep for two iterations.

*`evidence-aware` is a no-op on FSE'26, as designed and as measured.* It resolves to `endpoint` there (the
corpus observes a call boundary on 1222 of 1422 cases through failed edges alone, and the rest through logs),
so it reproduces 60.5 % exactly — which is the zero-debt property the arm was built for, now demonstrated on
the half that had never been read rather than asserted from the half that had.

*And the level test is worth **+37 cases** there.* Not inert, not a no-op: FSE'26's `Top@1` goes **60.5 % →
63.1 %**, `Top@3` 79.0 → 80.8, `Top@5` 82.2 → 85.0, with **one regressed fault type out of 26** — `DNSRandom`,
1/1 → 0/1, a single case in a single-case type. Every other type is up or flat:

| type | Δ | type | Δ | type | Δ |
| --- | ---: | --- | ---: | --- | ---: |
| `JVMMemoryStress` | **+7** | `HTTPResponseReplaceCode` | +4 | `NetworkPartition` | +3 |
| `ContainerKill` | **+7** | `HTTPRequestReplaceMethod` | +5 | `HTTPResponseDelay` | +3 |
| `HTTPResponseReplaceBody` | +2 | `HTTPRequestDelay` | +1 | `HTTPResponseAbort` | +1 |
| `HTTPRequestReplacePath` | +1 | `PodFailure` | +1 | `PodKill` | +1 |
| `NetworkDelay` | +1 | `TimeSkew` | +1 | `DNSRandom` | **−1** |
| 10 types | 0 | | | | |

**So `sideChannelObserved` is not the separator it was believed to be.** It partitions RCAEval correctly —
the three RE1 cells (0 side channels) gain 13 and the six cells that observe a boundary stay byte-identical —
and it partitions FSE'26 exactly wrong: that corpus observes a boundary on every case, resolves to `endpoint`,
and forfeits 37 cases that `level-window` wins. The predicate correlates with the split on one corpus and
anti-correlates on the other, which is what a proxy does when the real cause is something else.

That is now the blocking question, and it is a measurement rather than an argument: a case-level predicate
that separates FSE'26's 37 gains from RCAEval's RE3 losses (7, 8 and 7 cases on the three cells). Until it
exists, three arms are on the table and none of them is shippable:

| arm | golden nine cells | FSE'26 | verdict |
| --- | --- | --- | --- |
| `endpoint` (shipped) | 641/735 = 87.21 % | 60.5 % | the incumbent |
| `evidence-aware` | **654/735 = 88.98 %** (+13) | 60.5 % (0) | +13 and no debt, **and it leaves 37 on the table** |
| `level-window` | 619/735 (−22) | **63.1 %** (+37) | rejected on the golden half, and the best FSE'26 number ever measured here |

Until the predicate is found, `DEFAULT_TRANSIENT_GUARD_TEST` stays `endpoint`.
