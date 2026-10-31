# The trend-bonus ceiling — measured, refused, and what three attempts on RE3-TT say together

**Status:** `capTrendBonusAtDeviation` is IMPLEMENTED, tested, measured on both halves, and kept **OFF**.
The measurement is a small trade rather than a gain, and this document records it together with the two
attempts that preceded it, because the three read as one fact about the cell rather than three facts about
three terms.

| what | where |
| --- | --- |
| the switch | `capTrendBonusAtDeviation`, `DEFAULT_CAP_TREND_BONUS_AT_DEVIATION = false` |
| the rule | `trendBonus = min(trendStrength × w, deviation)` |
| the dispatch | RCAEval `anomaly_knobs=trendcap=1\|0`, FSE'26 `ranking_knobs=cap_trend_bonus=1\|0` |
| the runs | control `40309204462` (push, default path), `40309354516` (golden), `40309360422` (FSE'26) |

## 1. The defect it targets

Iteration 138's per-case diff, on `re3tt_ts-route-service_f1_3`: after the zero-baseline guard removed a
`latency-90` 0 → 0.023 winner, the next winner scored `latency-90` **2.35 → 0.021** — a collapse — at
`deviation = 0.301` with a **trend bonus of 0.661**.

The asymmetry is structural. A relative drift is unbounded in its denominator; a drop's deviation is capped
at `log₁₀(2)` by construction. So on the collapse side — and only there — a bonus can exceed the evidence
it augments. A bonus is an amplifier; one larger than its signal is not one.

The fix is deliberately direction-free: a rise whose bonus exceeds its deviation is capped too (it does not
occur on this corpus), so the term does not acquire a direction it has never read. That is the minimal form
of the rule, and it is why the switch is a ceiling rather than a gate.

## 2. The measurement

| population | control | `trendcap=1` | Δ |
| --- | ---: | ---: | ---: |
| RE1 | 323 (105/117/101) | **322** (104/117/101) | **−1** |
| RE2 | 231 (77/85/69) | 231 | 0 |
| RE3 | 52 (22/15/15) | 52 | 0 |
| **735** | **606** | **605** | **−1** |
| FSE'26 Top@1 / Top@3 / Top@5 | 802 / 991 / 1025 | **803 / 992 / 1024** | **+1 / +1 / −1** |

The cell that decides the goal goes **down** by one case, so the switch stays off — the criterion this
project applies to every axis, unchanged: a gain must not be bought with a regression on the cell that
blocks the goal, and here there is not even a gain to buy (FSE'26 trades +1 Top@1 for −1 Top@5).

## 3. The three attempts, read together

| attempt | mechanism | RE1 | RE3 | 735 |
| --- | --- | ---: | ---: | ---: |
| self-time share (§`self-time-share.md`) | inherited transport is not created transport | **−48 / −50** | −7 / −2 | −48 / −46 |
| zero-baseline guard (`zero-baseline-transport.md`) | a percentile with no traffic has no relative rise | 0 | 0 | 0 |
| trend-bonus ceiling (this document) | an amplifier may not exceed its signal | **−1** | 0 | −1 |

Three different mechanisms, one cell, one outcome: **each fix removes its artifact and the cell does not
move**, because the next artifact takes the place it vacated. The iteration-138 diff shows that directly —
the guard fired, the winner changed, and the case was still lost, to a *different* term's artifact.

That is not a sequence of failed experiments. It is one measurement repeated three ways: **RE3-TrainTicket
is not blocked by one term.** Its 14 deep misses are a *stack* of independent normalisation artifacts —
absences read as rises, collapses read as movement — and a single-term fix trades one for another by
construction, which is exactly what the numbers show.

## 4. Why the ceiling is near, stated channel by channel

Every evidence channel on this cell has a documented reason to be silent or hostile for the *source*:

| channel | what it does on RE3 TrainTicket |
| --- | --- |
| metric (self-anomaly) | the truth's own evidence is a `socket` **drop** 17 → 9, `dev ≈ 0.34`; the competitors are rises and collapses, and the asymmetry above bounds a drop at `log₁₀(2)` |
| log | `GATE BLIND`, measured: **12 313 rows retained in 30/30 cases and 0 admitted**, because not one is a self-caused logic exception — 8 482 `unclassified`, 3 763 with no class name, 68 propagated. `re3-log-ceiling.md` reached the same conclusion at case level: they are connectivity / IO / database **transport** exceptions, i.e. victims |
| trace | the source's span ratio is **< 1** (its spans drop with its traffic) |
| topology | reversed for a fan-in source: its callers' anomalies "explain" it |

So the cell is **information-limited**, in the same sense `re3-fault-ceiling.md` established for the earlier
era — except that the engine now scores 51.1% there instead of 3.3%, so what remains is a genuine residue
rather than an unbuilt pipeline.

## 5. What ships

| item | state |
| --- | --- |
| `capTrendBonusAtDeviation`, three tests, both dispatch keys | **SHIPPED OFF** — every cell is bit-identical on the default path |
| the enrolment | **REFUSED** at `−1` on the blocking cell |
| the cell-level synthesis (§3–§4) | **the record** — three attempts, one mechanism understood, and the channels enumerated |

**The next lever has to add evidence, not reshape a term.** The two candidates this record leaves standing:
a **new source signature** for TT's exception vocabulary (the 8 482 `unclassified` rows are the only
population large enough to matter, and no gate change can admit them without a classifier that separates
source from victim), and the **PRISM head-to-head**, which is the measurement that would say whether the
competitor's 76.7% comes from a channel this engine does not read at all — its internal/external asymmetry
term ships at weight 0 and has never been re-run against the current engine.
