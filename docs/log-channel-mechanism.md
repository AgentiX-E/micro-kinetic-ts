# The log channel: one empty map, four mechanisms, and which one it is

**Question.** `logWeight` is **1.0** — the largest weight in the ranking — and on RCAEval its input is an empty map:
the loss census reads `INPUT_MAP_EMPTY(logScores)` on **719 of 735 cases**. The same artifact's own `[log]` line
reports that the corpus **supplied logs on every one of RE2's 270 and RE3's 90 cases**, with tens of thousands of
ERROR/FATAL entries. `loss-decomposition.md` §8.5 named this and left it open — *"why is the tier empty, which is a
question for the loader"* — and it was open because one number cannot tell four mechanisms apart.

**Instrument.** `benchmarks/src/log-route.ts`, reported per system by the golden runner beside the latency census.
It counts five levels per case — rows READ, RETAINED (the ERROR/FATAL bar), ADMITTED by the mode's Level-1 gate,
ADMITTED INTO THE GRAPH, and the distinct emitters — and `logChannelVerdict` names the mechanism with exclusive
strength-ordered arms: `STARVED` (nothing to read — a corpus property), `NO ERROR ROWS` (read, nothing above the
bar), `GATE BLIND` (retained, and the mode admits none — the arm the shipped `count` mode makes live, since it
admits only `isLogicException` rows), `OFF GRAPH` (admitted, and every emitter is outside the graph — a MAPPING
question rather than a gate), and the residue `LIVE`.

**The admission rule has one owner.** Level 1 was a closure inside `computeLogScores`; it is now
`logLineAdmittedByMode(mode, log)`, a module-level export the scorer calls and this census imports. A census that
spelled its own version — *admit a row when `isLogicException`* — would be a second answer to the question it
exists to answer, which is this repository's most-repeated defect. The tree package's **139 ranking-signals tests
pass unchanged**, so the extraction is behaviour-preserving.

## The measurement — run `38257387012` on `2afc288`, the published configuration

| suite | system | cases | rows read | retained | **admitted** | in-graph | cases admitting | verdict |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| RE1 | OB / SS / TT | 375 | **0** | 0 | 0 | 0 | 0 | `STARVED` ×3 |
| RE2 | OnlineBoutique | 90 | 15 053 223 | 9 228 | **0** | 0 | **0** | `GATE BLIND` |
| RE2 | SockShop | 90 | 7 566 220 | 134 903 | **2** | 2 | **1** | `LIVE` (2 rows) |
| RE2 | TrainTicket | 90 | 21 012 021 | 2 331 | **0** | 0 | **0** | `GATE BLIND` |
| RE3 | OnlineBoutique | 30 | 2 163 430 | 41 401 | **5 275** | 5 275 | **9** | `LIVE` |
| RE3 | SockShop | 30 | 2 592 666 | 43 102 | **5 855** | 5 855 | **8** | `LIVE` |
| RE3 | TrainTicket | 30 | 1 937 403 | 12 313 | **0** | 0 | **0** | `GATE BLIND` |

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
- **It does not claim the classifier is broken on TrainTicket.** 12 313 rows retained and 0 admitted is *consistent
  with* a corpus whose ERROR lines are not programming exceptions — a resource/network fault class emits victim
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

## Fences

- `benchmarks/__tests__/log-routes.test.ts` — every arm, the four levels, the `undefined`-and-empty totality, FATAL
  treated as ERROR, the "read but nothing above the bar" state counted APART from "no file", and the source-shape
  assertions: the exported gate with the scorer calling it, the local closure it replaced gone, the package entry
  exporting it, and the runner reporting the census rather than re-rendering it.
- `benchmarks/vitest.config.ts` — `src/log-route.ts` in `coverage.include`. `coverage-scope.test.ts` **refused the
  module** until it was listed, which is the sixth time that fence has caught the allow-list's own hole.
- Coverage, every dimension: benchmarks **35 files / 1200 tests, 99.93 / 99.87 / 100 / 99.93** with `log-route.ts`
  at **100 on all four**; tree **15 / 677, 100 on all four**; kinetic **41 / 1025, 99.97 / 99.29 / 100 / 99.97**.
