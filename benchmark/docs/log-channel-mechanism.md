# The log channel: one empty map, four mechanisms, and which one it is

**Question.** `logWeight` is **1.0** — the largest weight in the ranking — and on RCAEval its input is an empty map:
the loss census reads `INPUT_MAP_EMPTY(logScores)` on **719 of 735 cases**. The same artifact's own `[log]` line
reports that the corpus **supplied logs on every one of RE2's 270 and RE3's 90 cases**, with tens of thousands of
ERROR/FATAL entries. `loss-decomposition.md` §8.5 named this and left it open — _"why is the tier empty, which is a
question for the loader"_ — and it was open because one number cannot tell four mechanisms apart.

**Instrument.** `benchmarks/src/log-route.ts`, reported per system by the golden runner beside the latency census.
It counts five levels per case — rows READ, RETAINED (the ERROR/FATAL bar), ADMITTED by the mode's Level-1 gate,
ADMITTED INTO THE GRAPH, and the distinct emitters — and `logChannelVerdict` names the mechanism with exclusive
strength-ordered arms: `STARVED` (nothing to read — a corpus property), `NO ERROR ROWS` (read, nothing above the
bar), `GATE BLIND` (retained, and the mode admits none — the arm the shipped `count` mode makes live, since it
admits only `isLogicException` rows), `OFF GRAPH` (admitted, and every emitter is outside the graph — a MAPPING
question rather than a gate), and the residue `LIVE`.

**The admission rule has one owner.** Level 1 was a closure inside `computeLogScores`; it is now
`logLineAdmittedByMode(mode, log)`, a module-level export the scorer calls and this census imports. A census that
spelled its own version — _admit a row when `isLogicException`_ — would be a second answer to the question it
exists to answer, which is this repository's most-repeated defect. The tree package's **139 ranking-signals tests
pass unchanged**, so the extraction is behaviour-preserving.

## The measurement — run `38257387012` on `2afc288`, the published configuration

| suite | system         | cases |  rows read | retained | **admitted** | in-graph | cases admitting | verdict         |
| ----- | -------------- | ----: | ---------: | -------: | -----------: | -------: | --------------: | --------------- |
| RE1   | OB / SS / TT   |   375 |      **0** |        0 |            0 |        0 |               0 | `STARVED` ×3    |
| RE2   | OnlineBoutique |    90 | 15 053 223 |    9 228 |        **0** |        0 |           **0** | `GATE BLIND`    |
| RE2   | SockShop       |    90 |  7 566 220 |  134 903 |        **2** |        2 |           **1** | `LIVE` (2 rows) |
| RE2   | TrainTicket    |    90 | 21 012 021 |    2 331 |        **0** |        0 |           **0** | `GATE BLIND`    |
| RE3   | OnlineBoutique |    30 |  2 163 430 |   41 401 |    **5 275** |    5 275 |           **9** | `LIVE`          |
| RE3   | SockShop       |    30 |  2 592 666 |   43 102 |    **5 855** |    5 855 |           **8** | `LIVE`          |
| RE3   | TrainTicket    |    30 |  1 937 403 |   12 313 |        **0** |        0 |           **0** | `GATE BLIND`    |

**Three statements, and the first is the finding.**

1. **On three of the six log-bearing systems the shipped mode admits ZERO rows out of 23 872 retained** — and those
   three are `RE2 OnlineBoutique`, `RE2 TrainTicket` and `RE3 TrainTicket`, i.e. **210 of the 735 cases**. The map
   is not empty because the corpus is silent. **It is empty because the gate rejected every row the corpus
   offered.** For `RE3 TrainTicket` that is 12 313 rows across **30 of 30** cases: every case retained rows and
   every case admitted none.
2. **The whole corpus-wide rate is 4.6%**: 11 132 admitted out of 243 278 retained, and 18 of the 360 log-bearing
   cases admit a non-zero number at all. Two of the six systems account for 11 130 of it. So "the log term is
   empty" and "the log term is fed" are not two regimes — they are one regime with a tail.
3. **`RE1` is the control and it is exact**: `read 0` on all 375 cases and `no log file 125` in each of its three
   systems, so no mode could have read a row. That is what makes the rest of the table a statement about the GATE
   rather than about the loader.

**And the levels compose against the loss census, which is the cross-check the two instruments exist for.** The
census says the map is populated on **18** cases (1 + 9 + 8); the loss census records the `log` term contributing to
the rank-1 candidate on **15–16**. The two are consistent, and the difference is explained rather than absorbed: a
populated map whose emitters are not the rank-1 candidate contributes nothing to it. On the other 585 cases the
census says the tier could not have been populated at all, so `INPUT_MAP_EMPTY` there is a measurement of the INPUT
and not a failure of the engine.

## What this does NOT claim

- **It does not re-open the mode axis.** The register closes `log-signal mode` and the table that closes it is
  `fse26-term-oracle-verdict.md`'s: `recorded` 756, `logicHttp` 730, `dominant@0.2` 731, **`all` 569 with 17
  regressed types**, `count` 531. Those are case-level measurements at the shipped configuration and they stand.
  What this census adds is the **population** behind them on the other half: the gate's blindness is not a property
  of one classification, it is **0 of 23 872 on three systems**, which is a number the mode table could not supply
  and which any future proposal about this channel now has to answer.
- **It does not say the gate is WRONG.** `count` admits self-caused logic exceptions by design, and that design was
  chosen against an ablation. What is measured is the CONSEQUENCE, not a defect: on this corpus the consequence is
  that three systems receive nothing.
- **It does not claim the classifier is broken on TrainTicket.** 12 313 rows retained and 0 admitted is _consistent
  with_ a corpus whose ERROR lines are not programming exceptions — a resource/network fault class emits victim
  symptoms, which is exactly what the gate exists to ignore. Distinguishing "the format is unrecognised" from "the
  fault class is not a logic exception" needs a per-row classification census, which is the next instrument and not
  this one.
- **It does not move a number.** The nine published cells and the `signals:` lines are **byte-identical** to the run
  before it, because no default moved — verified on this run against `38240322295`, all three suites.

## The arm the table exposes as missing

`RE2 SockShop` reports `LIVE — 2 rows admitted`. The arm is correct — `admitted > 0` — and it **reads the same as
`RE3 OnlineBoutique`'s `LIVE — 5 275 rows`**. Two rows out of 134 903 retained (0.0015%) and 5 275 out of 41 401
(12.7%) are different mechanisms for any decision, and the verdict does not carry a magnitude. That is the same
shape as the latency census's `comparable 1` case, which its `CAP TRUNCATES` arm also does not cover, and the fix
is the same: the residue arm should state a RATE, not only a count, so a tail cannot present as a regime.

## The taxonomy, measured — run `38266124177` on `6c7792d`, published configuration

Iteration 92 left the discriminator open: _a gate that refuses transport noise is doing its job, and one that
refuses a whitelist-missed logic exception is a bug_, and both were `admitted 0`. `re3-log-ceiling.md` had measured
that taxonomy at CASE level on RE3's 90 cases; this classifies **every retained row**, by the loader's own
`classifyExceptionKind`, on the corpus where 180 of the 210 gate-blind cases live.

| suite | system         | retained | admitted |     logic | propagated | unclassified |   none | flag-disagreements |
| ----- | -------------- | -------: | -------: | --------: | ---------: | -----------: | -----: | -----------------: |
| RE3   | OnlineBoutique |   41 401 |    5 275 | **5 275** |          0 |           44 | 36 082 |              **0** |
| RE3   | SockShop       |   43 102 |    5 855 | **5 855** |          0 |       32 132 |  5 115 |              **0** |
| RE3   | TrainTicket    |   12 313 |    **0** |     **0** |         68 |        8 482 |  3 763 |              **0** |

**Four statements.**

1. **`admitted === logic`, exactly, on all three systems** (5 275 / 5 855 / and 0 where `logic` is 0). The census is
   an EXPLANATION of the zero rather than a second count of it — which is what makes the next statement a finding
   rather than a restatement.
2. **`RE3 TrainTicket`'s emptiness is not a classifier defect.** Not one of its 12 313 retained rows is a logic
   exception: 68 propagated, 8 482 unclassified, 3 763 with no class name. `re3-log-ceiling.md` reached the same
   conclusion at case level — _"every one of the 21 `unclassified` cases is a connectivity / IO / database
   transport exception"_ — and this is the same verdict at ROW level, where it cannot be a property of how cases
   were sampled.
3. **And it SHARPENS that document's mechanism.** `re3-log-ceiling.md` and the gate's own docblock both emphasise
   the **propagated** rule (the empty-payload parse failure a wrong-value fault leaves in a wrapper) as the reason
   a transport line is refused. At row level on this corpus the propagated bucket is **68 of 96 816 rows — 0.07%**.
   The exclusions are dominated by `unclassified` (**42%** — a class name matching neither whitelist) and `none`
   (**46%** — no class name at all). **So the gate is not refusing propagated wrappers; it is refusing everything
   that is not a whitelisted logic exception, and the propagated rule almost never fires.** That is a different
   mechanism from the one the prose names, and it points somewhere different: a whitelist whose gap is mostly
   _unrecognised class names_, not _deliberately excluded ones_.
4. **`flag-disagreements 0` on all three systems.** The stored `isLogicException` agrees with the taxonomy on
   every one of the 96 816 rows, so the pipeline defect that field exists to catch is not present — a negative
   result that closes the bug hunt rather than leaving it open.

**The residue arm now carries a rate** — `LIVE 12.74% of 41 401` and `LIVE 13.58% of 43 102` where the previous
run printed `LIVE` for both and for `RE2 SockShop`'s 2 rows, which is iteration 92's own recorded weakness closed.

**What this does NOT do.** It does not re-open the mode axis, and it does not re-run `re3-log-ceiling.md`'s LLM
hypothesis: that document's falsification is about _whether an LLM could recover a whitelist-missed logic
exception_, and statement 3 above sharpens _why_ the whitelist misses — which is an argument about the whitelist's
SCOPE, not about a classifier's capability. The LLM axis stays closed on its own measurement.

### The population that had never been classified: RE2, 270 cases

**RE2 is where 180 of the 210 gate-blind cases live, and it had never been classified.** The same run:

| suite | system | retained | admitted | logic | propagated | unclassified | none | flag-disagreements |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RE1 | OB / SS / TT | **0** | 0 | 0 | 0 | 0 | 0 | **0** |
| RE2 | OnlineBoutique | 9 228 | **0** | **0** | 0 | 140 | **9 088** | **0** |
| RE2 | SockShop | 134 903 | **2** | **2** | 0 | 131 269 | 3 632 | **0** |
| RE2 | TrainTicket | 2 331 | **0** | **0** | 14 | 1 269 | 1 048 | **0** |

**And the mechanism is not the same one the RE3 half showed.** On RE3 the refusals were dominated by
`unclassified` — a class name matching neither whitelist. On **RE2 OnlineBoutique, 9 088 of its 9 228 retained rows
(98.5%) carry NO class name at all**, and it admits zero. RE2's ERROR/FATAL lines are application messages
(`failed to retrieve ads`) rather than exception-bearing stack lines, which is what a resource fault looks like:
the source is throttled, nothing throws, and the victims log a business failure.

**Across the whole 735-case corpus the picture is one sentence:** of **243 278** retained rows the gate admits
**11 132 (4.6%)** — exactly the `logic` rows, since `admitted === logic` on every system — while the **propagated
rule the docblock names fires on 82 rows (0.03%)**. The refusals are **`none` (no class name) 46%** and
**`unclassified` (an unrecognised class name) 42%**. So the gate is not refusing propagated wrappers: it is
refusing everything that is not a whitelisted logic exception, and the named rule is almost never the one that
fires. Which means the open question about this channel is now about the **whitelist's SCOPE** — and the 46% that
carry no class name at all are not a scope question but a corpus answer: those logs contain nothing to classify.

## Fences

- `benchmarks/__tests__/log-routes.test.ts` — every arm, the four levels, the `undefined`-and-empty totality, FATAL
  treated as ERROR, the "read but nothing above the bar" state counted APART from "no file", and the source-shape
  assertions: the exported gate with the scorer calling it, the local closure it replaced gone, the package entry
  exporting it, and the runner reporting the census rather than re-rendering it.
- `benchmarks/vitest.config.ts` — `src/log-route.ts` in `coverage.include`. `coverage-scope.test.ts` **refused the
  module** until it was listed, which is the sixth time that fence has caught the allow-list's own hole.
- Coverage, every dimension: benchmarks **35 files / 1200 tests, 99.93 / 99.87 / 100 / 99.93** with `log-route.ts`
  at **100 on all four**; tree **15 / 677, 100 on all four**; kinetic **41 / 1025, 99.97 / 99.29 / 100 / 99.97**.
