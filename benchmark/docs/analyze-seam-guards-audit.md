# Five guards a seam admits, and the cluster they finish

Iteration 36. `docs/analyze-guard-reach-audit.md` §7 left **24 arms** and five guards in the missing-input
cluster, with the instruments already named. This iteration closes all five — every one of them by a
**FIXTURE**, because every one of them is reachable through an exported API — and with them **the cluster that
iteration 34's inventory opened with thirteen entries is empty**.

```
before  24 arms over 24 entries, 3 statements
after   19 arms over 19 entries, 3 statements
```

**No source line changed.** The five guards are contracts rather than defects: the iteration's diff is
`benchmarks/__tests__/**` only, and `.git/mutation_pass_36.py` asserts that by hashing the source against the
parent's bytes before it runs a row. That has three consequences the record should state plainly: there is no
A/B to run (nothing a reader sees can move), **no golden is owed** (`benchmarks/src/**` is the trigger and no
file under it changed), and the whole verification is one sheet.

## 1. The five guards, and the seam each one is reachable through

| the guard | the seam | the fixture's precondition |
| --- | --- | --- |
| `formatOnsetMenuReport`'s `screens[0] === undefined` | the function is exported and takes the menu as an ARGUMENT | an EMPTY array — a caller with nothing to screen |
| `formatCvMenuReport`'s twin | same | same |
| `guardCensus`'s `sourceOf(kase) === undefined` | `guardCensus` is exported and takes parsed cases | a dump whose ground truth names no listed service |
| `unreachableCause`'s `scores.get(name) === undefined` | reached through the exported `computeZeroRegressionWindow` | a case with a root the dump does not describe, which is ALSO unsatisfiable and has a slope SPREAD |
| `buildFamilyCases`'s `targets.length === 0` | reached through the exported `familyScreen` | a dump whose ground truth is EMPTY |

**Every one of the five is an exported API taking its subject as an argument**, which is what makes the
question "does every caller exclude it" the wrong question to end on: the callers are wherever a caller is. The
in-tree call sites are the CLI and two screens, and none of them can produce these inputs — which is exactly
the reading iteration 34 recorded, and the reason four of the thirteen guards needed a seam rather than a proof.

## 2. What each fixture asserts, and the shape that makes it load-bearing

- **The two menus** assert the exact SENTENCE (`'Temporal (onset) screen: no shape was screened'`, its
  decisive-stability twin) and then the other direction on the same call one menu wide, because an early return
  that fired on every input would print the sentence about a screen that ran.
- **The census** asserts NO ROW for a case whose roots the dump does not list — `sourceOf` elects the
  highest-anomaly service AMONG THE GROUND TRUTH, so a case with no listed root elects nothing, and a census
  that counted it anyway would divide by a case it cannot describe a side of. The control is the same case with
  its root listed, asserted on `cases` and `sourceKept` so the row is not merely PRESENT.
- **The attribution scan** needs TWO preconditions the fixture states rather than assumes: a SPREAD of slopes,
  because the second step answers `noSpread` before the scan is reached, and a root that loses to a steeper
  rival at every weight, so the interval is empty and the cause is asked for at all. The ghost is listed FIRST,
  the same ordering rule iteration 35's fixture needed. And the assertion names the cause it must NOT be —
  `rootWithoutRow` is 0, because a case whose OTHER root is described is not a data gap.
- **The family builder** asserts the population rather than the row: a case naming no root is not a case the
  weight failed to satisfy — **it is not a case**. Without the guard it would be built with `targets: []`, and
  `every(...)` over no targets is **vacuously true**, so it would be filed as `rootWithoutRow`: a data gap this
  dump does not have, in the denominator of a report a reader is supposed to audit. The control is the same
  dump with its root listed, where `satisfied` is 1.

## 3. The mutation pass — **6 rows, 0 mismatches** — the control survived with all 434 tests executed, and every one of the five killed
the spec written for it.

Every claim in this iteration is a BEHAVIOUR claim, so every row lives on the suite runner: nothing here is a
claim about reach, and a coverage row would have nothing to add. The sheet asserts the iteration is test-only
before it runs anything.

```
C1  OK  SURVIVED  exp=SURVIVED  tests= 434   70s  restore=ok  [no-op control: the file rewritten verbatim]
M1  OK  KILLED    exp=KILLED    tests=   1   65s  restore=ok  [the temporal menu's empty-menu answer removed]
M2  OK  KILLED    exp=KILLED    tests=   1   64s  restore=ok  [the decisive-stability menu's twin removed]
M3  OK  KILLED    exp=KILLED    tests=   1   64s  restore=ok  [the census source guard removed]
M4  OK  KILLED    exp=KILLED    tests=   1   64s  restore=ok  [the attribution scan's root guard removed]
M5  OK  KILLED    exp=KILLED    tests=   1   62s  restore=ok  [the family builder's root guard removed]
rows=6  mismatches=0
```

## 4. What the cluster's thirteen turned out to be

```
excused by the CALLER's own arithmetic ............ 2   (a proof each)
removed as REDUNDANT .............................. 1   (a mutation that survived)
reachable through an EXPORTED seam ................ 9   (a fixture each)
  · four of them via functions taking the subject as an argument
  · three via a case type a hand-written caller can populate
  · two via a menu ARGUMENT
```

**Not one of the thirteen was left as "unexercised, reason unknown"**, which is the state the arm reading
prints for all of them, and the distribution is the finding: the cluster was not a pile of defensive dead code
(it had one redundant member) and not a pile of gaps (two were excluded by their callers) — it was mostly
**contracts on exported seams**, which is what a report module's entry points should be full of.

## 5. What is left: 19 arms, and none of them a guard on a missing input

| family | arms | where |
| --- | --- | --- |
| `?? fallback` lookups | 7 | `guardCensus`'s `?? 0` and `?? ''`, `classifyMiss`'s two `onset.get(...) ?? 0`, `formatMissReport`'s `?? SHIPPED_ONSET_SHAPE`, `parseAnalyzeArgs`'s two |
| `? -1 : 1` tie-breaks and markers | 4 | `marginOf`, `solveZeroRegressionWindow`, `familyScreen`, `formatFamilyScreenReport`'s marker |
| report-only qualifications | 5 | `lawDerivationClause` ×2, `formatCriterionReport`, `formatFamilyScreenReport`'s `, …`, `drawnResolutionClause` |
| `capBinderOf`'s loop exits | 2 | the two braces, unreachable for the reason iteration 35 proved |
| uncovered STATEMENTS | 3 | `2806–2808`: the `throw` and the braces around it |

The tie-break family is the one the register already has a standing example for (`byP`'s unreached `? -1` in the
separator), and the report-only family is where a fixture is cheapest.

**Iteration 37 took this family and found the reason in the INSTRUMENT** — `docs/analyze-comparator-audit.md`
measures, in one pass, a comparator arm taken 26 times and counted 0 — so the two rows above that remain
(`marginOf`'s and `familyScreen`'s) are **FALSE ZEROS rather than open questions**, each held by a spec and a
mutation row. And the sentence about `byP` needed re-reading for the same reason: it was **probed**, eight ties
came back and every one was the `1` arm, so the register's example stands — on a probe now, rather than on a
reading this iteration has shown to be unreliable for comparators. The four `??` lookups and the four report-only
qualifications are unaffected: neither operator sits inside a comparator.

## 6. Gates

| | |
| --- | --- |
| the changed suite | **434 tests** green (`fse26-diagnose-analyze`, 430 → 434) |
| `fse26-diagnose-analyze.ts` | **99.9 / 98.53 / 100 / 99.9** — **19** arms (was 24), 3 statements |
| the benchmarks project | **917 tests / 23 files**, coverage **99.95 / 99.21 / 100 / 99.95** |
| `tsc` both legs · oxlint · prettier | clean · 0 warnings 0 errors · prettier reformatted the new block once, before the commit |
| the register's own fence | **14 / 14** green with the new index row |
| golden | **NOT OWED** — no file under `benchmarks/src/**` changed, and §"no source line changed" is the check |
