# A clause that cannot print, twice, and a lookup that cannot miss, three times

Iteration 33. `fse26-diagnose-analyze.ts` carried **41 uncovered branch arms** and four uncovered statements.
This takes the **five whose deadness is provable from the code above them**, collapses the two duplications
they sat in into one owner each, and leaves the other 36 as a NAMED inventory (§9). The file goes from
**96.83** to **97.20** branches, and every rendered report is byte-identical.

---

## 1. The five arms, and why they are one family

| line | the code | the proof |
| --- | --- | --- |
| 4476 | `s.lostAtShip > 0 ? ' — the criterion’s second half FAILS' : ''` (the temporal screen's report) | **the ship weight is inside the cap** (§2) |
| 5142 | the same clause, byte for byte, in the decisive-stability screen's report | the same proof |
| 4315 | `for (const datapack of solved.gained) bump(gainTypes, faultTypeOf.get(datapack) ?? '')` (the temporal screen) | **the map is built from the array the builders copy the datapack from** (§3) |
| 4919 | the same line, byte for byte, in the decisive-stability screen | the same proof |
| 5691 | the same line, byte for byte, in the family screen's per-family loop | the same proof |

So the five are two families of ONE thing each: a clause that states a verdict from a number that cannot move,
and a lookup with a fallback for a key that cannot be missing. Both are the shape this register has now recorded
twice before — a fallback written for a state the code above it has already excluded — and both come with a
**duplication**, which is what makes the fix an ownership decision rather than a deletion.

## 2. The clause: the ship weight is inside the cap, so the loss there is zero

`SolvedWindow.ship` is the midpoint of the widest maximal-gain plateau, and that plateau's weights come from
`gainProfile(window.gains, window.cap)`, whose every sample is at or below `window.cap`. `cap` is the smallest
component-end among the cases satisfied at zero, so a case that was correct at `w = 0` is still correct at any
weight up to and including `cap` — and `zeroRegressionSamples(built, [ship])[0].lost` therefore counts nothing.

Three independent readings agree, and the file's own comment said it first:

- **the geometry**, above;
- **the file's own note**, twelve lines above the first copy: *"The NAMED weight's own verdict, not
  `lostAtShip`: that one is measured at the SOLVED ship, which `--at-weight` does not move … so a loss there
  has to be read from `at.lost` **or the branch never fires**."* The author knew, and had already removed one
  earlier copy of the same test for the same reason;
- **the measurement**, over every dump the cache holds, both shapes of both screens and five named weights:
  `.git/probe_invariants_33.ts` reads **199 windows, 259 gained cases, `lostAtShip` non-zero ZERO times** — and
  the named weights are in the population precisely because the note says the flag cannot move this number.

The verdict that the criterion's second half fails is **not** lost with the clause: it has an owner,
`admissibilityOf`, and that owner reads a quantity that CAN move — `at.lost`, a weight the caller named, which
the cap does not bound.

## 3. The lookup: the map is built from the same array the builders copy from

All three copies read `faultTypeOf.get(datapack) ?? ''`, where `faultTypeOf` is
`new Map(cases.map((kase) => [kase.datapack, kase.faultType]))` — built from the screen's own `cases`
parameter. And `solved.gained` comes from `solveZeroRegressionWindow(built)`, whose `built` is produced by

- `onsetCase(kase, …)` — `datapack: kase.datapack`;
- `stabilityCase(kase, …)` — `datapack: kase.datapack`;
- `buildFamilyCases(cases, weights, family)` — the same.

Both builders carry the datapack **verbatim**, so every gained datapack is a key of a map built from the array
those cases came from, and `?? ''` could only fire for a gained case that is not among the cases it was drawn
from. Measured: **259 gained cases over the corpus, ZERO misses**, and **zero tallies holding the empty key**.

## 4. The fix: one owner each, and a form that makes the fallback unwritable

**`shipLine(s)`** replaces the two byte-identical lines. It does not carry the clause, and the deletion is
recorded in its own doc with the proof, so the next reader does not re-derive it. The invariant is also stated
where the number is declared — `SolvedWindow.lostAtShip` now says it reads zero for every window this solver
produces, why, and which reading DOES move (with a pointer to the same name on a different type,
`CapResolution.lostAtShip`, which is a real reading).

**`faultTypeTally(cases, gained)`** replaces the three byte-identical trios, and it removes the **lookup**
rather than the fallback:

```ts
function faultTypeTally(cases: readonly DiagnosedCase[], gained: readonly string[]): … {
  const wanted = new Set(gained);
  const counts = new Map<string, number>();
  for (const kase of cases) if (wanted.has(kase.datapack)) bump(counts, kase.faultType);
  return tallyCounter(counts);
}
```

Reading the cases and asking which of them was gained means there is no `get`, no `!`, and no place to write a
fallback — **the defect is removed by removing the operation it was attached to**, which is the strongest form
available. It also reads `gained` as a SET, which is what makes the count a partition of the CASES rather than
of a list: a datapack named twice is one case.

## 5. What the change does NOT do

- **It does not stop printing `lost at ship 0`.** The number is what the two reports print, and a reader is owed
  the reading rather than the argument; what changed is that the invariant is now stated where the field is
  declared instead of being half-asserted by a clause that cannot print.
- **It does not touch the other 36 arms.** An inventory is not an audit, and three of the remaining clusters
  need their own instrument (§9).
- **It does not change one byte of any report.** §7 is the reading.

## 6. The mutation passes — 4 suite rows and 3 coverage rows, 3 controls, 0 mismatches

**Runner one: `vitest`, on the analyzer's own suite.** Every row declares its verdict before it runs, every
mutated file is restored and hash-verified, and a run that executed nothing would be neither a kill nor a
survivor.

| row | mutates | declared | verdict | tests executed |
| --- | --- | --- | --- | --- |
| `C1` | the file rewritten verbatim | SURVIVED | **SURVIVED** | 423 |
| `M1` | the tally counts by DATAPACK instead of by fault type | KILLED | **KILLED** | 6 |
| `M2` | a fault type is counted ONCE however many of its cases were gained | KILLED | **KILLED** | 1 |
| `M3` | only the FIRST gained case is counted | KILLED | **KILLED** | 1 |

**Runner two: the coverage reading, for the two claims that are about REACH.** Both removed branches are dead,
so re-introducing either changes no output and a suite row for one would report a survivor and call it a gap.

| row | mutates | declared | verdict | arms |
| --- | --- | --- | --- | --- |
| `COV1` | nothing (this runner's control) | arms = 37 | **OK** | 423 tests, suite green |
| `M4` | the FAILS clause re-introduced into `shipLine` | arms = 38, the extra carrying `second half FAILS` | **OK** | 423 tests, suite green |
| `M5` | the `?? ''` lookup re-introduced into `faultTypeTally` | arms = 38, the extra carrying `?? ''` | **OK** | 423 tests, suite green |

The control's declared count is **37 rather than 36** and the reason is a population fact worth keeping: this
runner is the analyzer's OWN suite, which leaves arms uncovered that other suites cover (`main`'s argument
handling, for one). Row `M4`/`M5` are therefore stated as **one extra arm against the control**, with the extra
arm's SOURCE TEXT asserted — a count alone would pass on a mutation that uncovered something else.

**And the sheet found a defect in itself on its first run**, which is why its rows are stated the way they are:
the first version compared the baseline by LINE NUMBER, and a mutation that adds a line to the file shifts
every arm below it — so `M4` reported thirty "new" arms and the row failed on a mutation that was perfectly
correct. **Arms are named by what they ARE**: the baseline is now a multiset of arm TEXTS, and shifted lines
cancel against each other.

## 7. Does anything a reader sees move? The corpus A/B

The change is inside a renderer and in how a screen builds its tally, so "nothing moves" has to be a reading of
BOTH the formatted text and the numbers behind it. `.git/probe_analyze_reports_33.ts` renders the temporal, the
decisive-stability and the family reports for every dump, both shapes of each screen, at three named weights,
and prints each screen's `gainTypes` beside its `solved` reading.

```
lines=431   diff lines: 0   report lines differing: 0   NUMBERS lines differing: 0   RESTORE VERIFIED
```

## 8. The arms, before and after

| | before | after |
| --- | --- | --- |
| uncovered **branch arms** | **41** (41 entries) | **36** |
| uncovered **statements** | 4 (`2790–2792`, `5079`) | 4 (`2790–2792`, `5105`) |
| `fse26-diagnose-analyze.ts` branches | **96.83** | **97.20** |
| the project | 99.93 / 98.35 / 100 / 99.93 | **99.93 / 98.54 / 100 / 99.93** |
| the changed suite | 420 tests | **423** |
| the benchmarks project | 903 tests / 23 files | **906 tests / 23 files** |

## 9. The 36 arms this leaves, and what each cluster needs

The `/tmp` reading behind this list is `.git/cov_lines.py` on `coverage-final.json`; the numbers below are the
committed file's own numbering.

```
uncovered statements [2790, 2791, 2792, 5105]

  fallbacks written for a value the code above may already have ruled out
    1140  outcome.breakdown?.deviation ?? 0
    1156  kase.prediction[0] ?? ''
    1157  winnerId === '' ? undefined : shape(kase, winnerId)
    1732  temporalWeight * ((onset.get(winner!) ?? 0) - (onset.get(source) ?? 0))            x2
    1922  weights.onsetShape ?? SHIPPED_ONSET_SHAPE
    5042  Number.isFinite(value) ? value.toFixed(6) : 'unbounded'
    5655  `ADMISSIBLE [${at(verdict.gainsFrom ?? 0)}, ${at(verdict.ceiling)}) width `
    7656  rawShape !== undefined && isOnsetShape(rawShape) ? rawShape : DEFAULT_ONSET_SHAPE  x2
  guards on a missing input — a TEST GAP unless a caller's own guard precedes them
    1153  if (sourceService === undefined) continue;
    2762  if (!Number.isFinite(cap)) return undefined;
    2765  if (t === undefined) continue;
    2789  }
    2879  if (measured === undefined) return [];
    2881  if (n < 2) return [];
    2890  if (target === undefined || !measured.weighed.has(name)) continue;
    2894  if (other.base >= target.base) continue;
    2961  if (target === undefined) continue;
    3293  if (targets.length === 0) continue;
    4401  if (first === undefined) return 'Temporal (onset) screen: no shape was screened'
    5230  if (first === undefined) return 'Decisive-stability screen: no shape was screened'
    6029  if (seen.size === 0) return { decimals: HISTORICAL_FIELD_DECIMALS, stated: false }
  tie-breaks and markers in the same `? -1 : 1` family as `byP`
    3443  [...roots].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))[0]!
    3542  .sort((a, b) => a.margin - b.margin || (a.datapack < b.datapack ? -1 : 1))
    5751  return a.family < b.family ? -1 : 1
    5832  const marker = row.enginePoolFamily ? ' *' : '  '
  reducers whose FIRST value is `undefined` — reachable only when the side is EMPTY
    5533  (best, one) => (best === undefined || one.losesFrom < best.losesFrom ? one : best)        x2
    5537  (best, one) => (best === undefined || one.permittedFrom < best.permittedFrom ? one : best) x2
  report-only qualifications
    1882  `… net ${reconciled.net >= 0 ? '+' : ''}${reconciled.net}`   ← the entry this list omitted
    5044  law.range === 1 ? '' : `, each position worth ${at(law.range)}`
    5860  row.gained.length > 4 ? ', …' : ''
    6679  box.extraDigits === 0 ? body : `${body} (at ${box.extraDigits} digits beyond that)`
    5104  (binder === undefined …)
```

**This block listed 35 arms under a heading that said 36, and the difference was `1882`** — the sign
`reconciled.net >= 0 ? '+' : ''`, which the third bullet below discusses but which the list itself omitted. An
inventory is read as the set of arms to decide one at a time, so a list that is one short is a claim about the
list. The entry is added below, and the sign is closed by iteration 34's negative-net fixture
(`docs/analyze-caller-reach-audit.md` §4).

Three of those clusters have a reading attached, and the next iteration should start from them rather than from
a grep:

- **`(binder === undefined …)` at 5104 is DEAD — this audit called it a GAP, and the third caller's guard is
  on the line ABOVE its call.** `capUpperBoundClause` has three callers: two guard inside the call expression
  (`if (u.cases > 0) lines.push(…)`, at 4548 and 5217) and the third guards in the ENCLOSING BLOCK
  (`if (s.gain === 0 && s.at === undefined && s.window.capUnrepresentable.cases > 0)`, the line above the call
  at 5310). So the arm is unreachable at all three, and the proof is a property of the construction rather
  than of a corpus: `cases` counts the members pushed under `pairs.length > 0`, and the binder is assigned in
  the same loop under the same predicate — `renderedTiePairs` skips a pair the root does not lead
  (`lead > 0`) and a zero-width cell (`span > 0`), so the first `floor = lead / span` is finite and below the
  `Number.POSITIVE_INFINITY` the floor starts at. **A guard written beside a call instead of inside its
  argument list is still a guard**, which is what this bullet read past; iteration 34 removes the two
  fallbacks and records the proof (`docs/analyze-caller-reach-audit.md` §3).
- **The four reducer arms at 5533/5537 are also a GAP**, and a fixture rather than a proof can close them: a
  criterion reading with a `protect`-role artifact whose side is empty, which the surrounding comment already
  describes ("An empty side is NOT a permissive one").
- **`reconciled.net >= 0 ? '+' : ''` at 1882 is the same sign shape iteration 32 removed as dead from the
  discriminator** — and here it is NOT obviously dead, because `net = modelledCorrect - recordedCorrect` can be
  negative for a screened configuration. Whether any caller reaches it is a question about the reconciliation's
  callers, and it is named rather than removed.

## 10. Gates

| | |
| --- | --- |
| the changed suite | **423 tests** green (`fse26-diagnose-analyze`, 420 → 423) |
| `fse26-diagnose-analyze.ts` | **99.87 / 97.20 / 100 / 99.87** — 36 arms and 4 statements, from 41 and 4 |
| `fse26-discriminator.ts` · `fse26-separator.ts` · `fse26-term-oracle.ts` | 100 / 100 / 100 / 100 · 100 / 99.65 / 100 / 100 · 100 / 100 / 100 / 100 — iterations 32 and 31 hold |
| the benchmarks project | **906 tests / 23 files**, coverage **99.93 stmts / 98.54 branches / 100 funcs / 99.93 lines** |
| both mutation sheets | 4 suite rows (1 control, 3 killed) and 3 coverage rows (1 control, 2 verified) — **0 mismatches** |
| the corpus A/B | **431 lines, diff 0** on the reports and on the numbers behind them |
| `tsc -p benchmarks/tsconfig.json` · `tsc -p tsconfig.workspace.json` | clean · clean |
| oxlint / prettier | 0 warnings, 0 errors on the `benchmarks` subtree · the changed files conform |
| the register's own fence | **14 / 14** green with the new index row and the three invariants |
| golden | **OWED** — `benchmarks/src/**` is a `push` trigger, and §7 is why the 9 cells are expected byte-identical |
