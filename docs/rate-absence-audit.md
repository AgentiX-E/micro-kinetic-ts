# A rate that cannot be absent, read with the minimum of its axis

Iteration 31. `fse26-separator.ts` reads a cell's rate with `(cell.auc ?? 0)` in **five** places, and
the coverage report named four of them as uncovered branch arms. This records what those arms are, the
theorem that makes the fallbacks dead, the one place the two readings genuinely differ, and the gates.

It also records **two defects in the instruments used to find it**, one in the report's own column and
one in a claim this audit made before it was measured.

---

## 1. The defect, in one line

**A cell's rate is `undefined` exactly when nothing was measurable, and every reader that had already
excluded that state still defaulted it to `0` — the MINIMUM of the axis.**

Two readings of one tally live on a cell:

```ts
auc: measurable === 0 ? undefined : (tally.source + tally.tie / 2) / measurable,   // the rate
p:   separationPValue(tally.source, tally.winner),                                 // the test
```

and their absences are **not independent**:

- `p` is `undefined` exactly when the non-tie pairs are zero — the test answers for the flips, and no
  flips is no test;
- the rate's denominator is those non-tie pairs **plus the ties**.

So `p !== undefined` implies `measurable > 0` implies `auc !== undefined`, **by construction**, and a
`(cell.auc ?? 0)` written for a population that has already excluded the absent case is a fallback for a
state `toCell` cannot produce — one that reads a missing rate as `0.00`, which is the minimum of the
axis the reader is comparing on.

## 2. The reading, and the column that is not an instrument

The `benchmarks` coverage report left **seven** uncovered branch arms in this file, and naming them
took an instrument of its own. The reporter's `Uncovered Line #s` column is printed as

```
 ...6-separator.ts | 99.84 | 97.22 | 100 | 99.84 | 1146
```

— `1146`, one line. It is **not** one line. The column elides a long list with a **leading** `...`, so
what a reader sees is the TAIL, and the same file's true list was `1103,1144-1145,1146`. **Iteration
30's audit recorded "the single remaining line is 1146", which was a claim about a column rather than
about the file**; `.git/cov_lines.py` reads `coverage-final.json` instead and names every arm with its
TYPE and its source text. That reading, before this change:

| line | the code | arms uncovered |
| --- | --- | --- |
| 1052 | `(overall.auc ?? 0) < criterion.minAuc` | 1 |
| 1057 | `measurableOf(cell) < criterion.minCases \|\| (cell.auc ?? 0) >= 0.5` | 1 |
| 1103 | `a.p - b.p \|\| (a.faultType < b.faultType ? -1 : 1)` | 1 |
| 1144 | `(cell.auc ?? 0) > (best.auc ?? 0)` | 2 |
| 1145 | `((cell.auc ?? 0) === (best.auc ?? 0) && cell.name < best.name)` | 2 |

Six of the seven are the `?? 0` fallbacks; the seventh is a sort tie-break, dealt with in §9.

**And the report does not count every `??`.** Line 1061's
`(cellOf(total, b).auc ?? 0) - (cellOf(total, a).auc ?? 0)` had **no branch entry at all** — v8 does
not instrument a coalesce inside the subtraction a comparator returns. Silence in that column is not
evidence that a fallback is taken: it can be evidence that nobody is counting it.

## 3. What the corpus says about the two absences

`.git/probe_cell_classes_31.ts` walks **every cell of every census** the 7 local dumps can build and
classifies each by the two absences:

```
every cell of every census                     both-defined=524  p-only=0  auc-only=273  both-absent=23
the population bestNonTerm scans (role!='term') both-defined=459  p-only=0  auc-only=133  both-absent=23
```

`p-only` — a test with no rate — is **zero in 615 non-term cells**. The converse, `auc-only`, is
**133**: a cell whose every measurable pair is a tie has a rate of exactly `0.5`, which is the absence
of support, and no p-value. That asymmetry is why `bestNonTerm` filters on the **test** and compares on
the **rate**, and why the two are not interchangeable in either direction — filtering on the rate would
admit the all-tie cells at `0.5`, and ranking on the test would order by significance, which its own
doc records as backwards (the test is symmetric, so it would name a cell at rate `0.00` the row's best).

## 4. The fix

**One type and two functions, each the owner of one thing.**

```ts
export type TestedCell = SeparatorCell & { readonly p: number; readonly auc: number };

function testedCells(row: SeparatorRow): readonly TestedCell[] { … }   // the population
function rateClearing(cell: SeparatorCell, bar: number): number | undefined { … }  // the bar
```

- **`TestedCell`** states the implication, its derivation and the reachable converse, and
  `testedCells` is the **one** narrowing: the survivor scan and `bestNonTerm` now read the same
  population, so the test a filter applies and the rate a comparison reads cannot drift apart. Four
  `(cell.auc ?? 0)` disappear with the type.
- **`rateClearing` returns the RATE rather than a boolean**, which is what makes the absence impossible
  to lose: the caller that admits a cell receives the number it must then order by, so the candidate
  pass no longer re-reads the cell with a second fallback in its sort. Two `?? 0` disappear there.
- **`SeparatorSurvivor.auc` is `number`**, the same theorem applied to a declaration.
- **The table's `mark` loses an assertion and a fallback of the same value**: it read
  `best.p! < census.adjustedAlpha && best.p !== undefined`, which is one number asserted and defaulted
  in one breath, of which one had to be wrong. With `best` typed, both go.

Behaviourally the change is inert on every artifact this project ships — the seven corpus dumps, and
every fixture whose census has a ROW — which is the point: it removes a number that stood in for an absence
and gives the absence an owner. It is **not** inert on a census with no pairs, and that is the fix rather than
a side effect: §5 measures it, and what disappears there is a **fabricated candidate list**.

## 5. A claim this audit made, the measurement that refuted it — and the fixture that confirmed it

The first draft of `rateClearing`'s doc asserted that the old fallback was *"wrong in the same gesture"* — that
under a negative bar a fabricated `0.00` **admitted** a rate-less cell as a candidate. Enumerating the surface
over **four** fixtures × **sixteen** `minCases`/`minAuc` settings returned

```
diff lines: 0
```

and the draft recorded the claim as refuted. **The refutation was true, and the claim is true too**, and what
separates them is a POPULATION — which is why what this section corrects is not either measurement but the
conclusion that either could be read as general:

- **All four fixtures had per-type ROWS.** A rate-less cell that reached the first comparison was then refused
  by the per-type test — `rows.every(...)` reads `(cell.auc ?? 0) >= 0.5`, and `0` is below `0.5` — and a
  rate-less total implies a rate-less every row, because the total's counts are the rows' counts summed. The
  mask is real, and it holds for every census that has a row.
- **The mutation pass reported the same fact from the other side**: the row that restores the fabrication
  (`S1`) **survived every test**, because a census with rows cannot tell the two trees apart.
- So a **fifth** fixture was added — `no-pairs-at-all`, an EMPTY case list, which is a legal artifact (a tiny
  or entirely-correct dump produces exactly this). With no wrong cases there are no per-type rows,
  `rows.every(...)` is **vacuously true**, and nothing masks the comparison.

Re-run over the probe **as it now stands** — five fixtures, 80 rows — the two trees differ on **2 of 80**:

```
no-pairs-at-all minCases=0 minAuc=-1 | candidates=[15 signals] …   →   candidates=[]
no-pairs-at-all minCases=0 minAuc=0  | candidates=[15 signals] …   →   candidates=[]
```

The old tree admits **all fifteen** non-term signals as candidates from a census that measured **nothing**;
the new tree admits none. The `survivors` and `dominated` lists never differ on any of the 80 rows.

**So the claim holds and its refutation also held, and neither was a mistake: they are statements about
different populations.** That is this register's first law applied to an ARGUMENT rather than to a number.
§6 is not weakened by it: all seven corpus artifacts have rows, so the mask holds on every one of them, which
is exactly why the diff there is 0.

## 6. Is it live? The corpus A/B — inert on every artifact the corpus holds

The change touches `benchmarks/src/**`, a golden trigger, so "no published number moves" has to be a
reading. Every field the reader produces, every derived screen, the separator census **and its
structured per-cell line** were canonically serialised under the tree that has the change and under its
parent (`0469ccb`), over 7 dumps, 1320 cases and 41,426 service rows — 43,639 lines each:

```
diff lines: 0      case lines differing: 0      cell lines differing: 0      service lines differing: 0
```

The structured line is this iteration's addition to the probe, and it exists so a diff would name the
CASE AND CELL that moved instead of the one long census line it sits inside.

**The boundary of this claim, stated rather than implied**: `diff 0` says no artifact *the corpus holds* can
move, and it does **not** say the change is unobservable. §5 is the row that differs — a census with no pairs,
where the old tree's candidate list was fabricated — and every corpus artifact has rows, so the mask §5
describes is present in all of them. A reader who took this line as "nothing can change" would be reading a
population claim as a rule, which is the mistake §5 exists to record.

## 7. The mutation pass — 12 rows, 1 runner, 2 controls, 10 killed, 2 declared survivors

Each row DECLARES its verdict before it runs; every mutated file is restored and **hash-verified**; a
`NO-TESTS` run is neither a kill nor a survivor.

| row | mutates | verdict | declared | tests executed |
| --- | --- | --- | --- | --- |
| C1 | the file rewritten verbatim | SURVIVED | SURVIVED | 71 |
| S1 | restores the fabrication: an absent rate answers `0` | KILLED | KILLED | — (by §5's rowless fixture) |
| P1 | filters on the RATE instead of the TEST | KILLED | KILLED | — |
| P2 | drops the `auc` half of the predicate | SURVIVED | SURVIVED | 71 |
| B1 | `>` becomes `>=` in the best-cell comparison | KILLED | KILLED | — |
| B2 | the best-cell name tie-break is inverted | KILLED | KILLED | — |
| B3 | the best-cell name tie-break is removed | SURVIVED | SURVIVED | 71 |
| N1 | the candidate tie-break is inverted | KILLED | KILLED | — |
| N2 | the candidate tie-break is removed | KILLED | KILLED | — |
| N3 | the candidate sort is ascending | KILLED | KILLED | — |
| R2 | the per-type direction check is disarmed | KILLED | KILLED | — |
| R3 | the population floor is disarmed | KILLED | KILLED | — |

**The two declared survivors are the boundaries of the claims, and both were declared before they ran.**

- **P2** — a cell that ran a test and carries no rate is excluded by the `auc` half of the predicate,
  and **no artifact can produce that state** (§3: 0 in 615), so no behaviour test can falsify the half.
  It is there because only a check narrows a type; the *behavioural* half of the same predicate is P1,
  and P1 is killed. **A type predicate has a half no runner can reach, and saying which half is which is
  the honest form of the claim.**
- **B3** — a fold keeps the FIRST of two equal cells, which is what the tie-break also picks whenever
  the first name is smaller. The two differ only in the direction B2 covers, so B3 needs its own
  fixture to be killed and does not have one; recorded rather than explained away.

**And the row the suite cannot kill at all**: `SeparatorSurvivor.auc` widened back to
`number | undefined` leaves every test green, because `aucText` accepts an absent rate. The claim is a
TYPE, so it belongs to the compiler: the suite gained the **demand** (a `const rate: number` assignment,
which is checked even though a runner strips it), and the row was run against `tsc` with its own no-op
control — `CT1` clean, `D1` killed by `TS2322`. **A declaration nothing demands is a declaration nothing
holds.**

## 8. The arms, before and after

`.git/cov_lines.py`, on the full-project `coverage-final.json`:

| | before | after |
| --- | --- | --- |
| uncovered **statements** | 0 | 0 |
| uncovered **branch arms** | **7** | **1** |
| `fse26-separator.ts` branches | 97.22 (as iteration 30 left it) | **99.65** |
| statements / functions / lines | 100 / 100 / 100 | 100 / 100 / 100 |

The six `?? 0` arms are gone because the code is gone. And the exit is not "six closed": the candidate
sort's `?? 0` — the one the report could not even see (§2) — was replaced by a carried `number`, and
**two fixtures** now assert that tie-break in both directions (one where it must reorder the list, one
where it must leave the order alone), which closed it and moved the file to a single remaining arm.

## 9. The one arm left NAMED

`byP`, the survivor sort's tie-break: `a.p - b.p || (a.faultType < b.faultType ? -1 : 1)`, whose `? -1`
arm no input reached. It is **not** a candidate for the same repair, and the reason is a finite table:

- for two survivors with **equal** `p`, the input order is `built`'s — pairs descending, then faultType
  ascending — so the later item is always the alphabetically larger and the `? -1` half is never PRODUCED.
  The `||`'s right-hand side IS evaluated and it answers `1` (the uncovered arm is `[0]`, not `[0, 1]`),
  which is the distinction the earlier wording blurred;
- for two survivors with **different** pair counts, an equal `p` requires a collision, and the collisions
  are `0.5`, `0.0625`, … — the two smallest being `f=5,w=5` against `f=7,w=6` at `0.0625`. A survivor
  must clear `adjustedAlphaOver(readings)`, and the bar exceeds `0.0625` for every `readings ≥ 1`, so a
  colliding pair can never both survive. Below that, `2/2^f` collisions require `f = g`.

So the arm is unreachable **for any survivor-producing corpus**, and it is named rather than deleted
because deleting it would rest on a language guarantee (`Array.prototype.sort` is stable) rather than on
a measured fact — and this register does not spend a guarantee to remove an arm nobody is paying for.

## 10. Gates

| | |
| --- | --- |
| the changed suite | **71 tests** green (`fse26-separator`, 63 → 71 across the iteration) |
| the benchmarks project | **901 tests / 23 files**, coverage **99.86 stmts / 98.23 branches / 100 funcs / 99.86 lines** |
| `fse26-separator.ts` | **100 / 99.65 / 100 / 100**, one arm named |
| `fse26-term-oracle.ts` | **100 / 100 / 100 / 100** — iteration 30's arms hold |
| `.git/cov_lines.py` | `coverage-final.json`, naming each arm's TYPE and source text |
| `tsc -p benchmarks/tsconfig.json` | clean |
| oxlint / prettier | clean |
| golden | **OWED** — `benchmarks/src/**` is a `push` trigger, and §6 is why the 9 cells are expected byte-identical |

## 11. The tree lost the change, and the record described a state that did not exist

**Found at the start of the resumed session**: `benchmarks/src/fse26-separator.ts` and
`benchmarks/__tests__/fse26-separator.test.ts` were **byte-identical to their parent commit** (`0469ccb`),
while this audit, the register's row, the mutation sheets, the A/B scripts and the coverage readings all
described the change as done. `rateClearing`, `TestedCell` and `testedCells` did not exist in the tree at all.

The instruments agreed with each other, and **nothing connected any of them to the artifact they described** —
a chain with every edge but the last. The loss has a named cause: the last thing the previous session did was
measure the **parent's** coverage, which requires the parent's sources, and that measurement replaced the two
working files and had **no restore step at all** — unlike `.git/probe_ab_31.sh`, whose restore is correct, and
unlike the mutation harnesses, which hash-verify theirs. This session's own criterion-surface A/B therefore
installs a `trap` and verifies the restore by hash before it reports anything.

**The change survived only because its snapshots lived OUTSIDE the tree.** `/tmp/iter31-parent-run/` (a 13:04
snapshot with its own `ALL.sha256`) and `/tmp/iter31-ab-backup/` both held the final source, and the four files
were restored and **verified against those hashes**:

```
4b9181f3…  benchmarks/src/fse26-separator.ts            ← the recovered source
528c4586…  benchmarks/__tests__/fse26-separator.test.ts
7dc8690d…  docs/rate-absence-audit.md
256464a0…  docs/closed-axes-register.md
```

Three independent confirmations that the recovered source is the one the sheets were written FOR: **all
eleven** of `mutation_pass_31.py`'s anchors appear in it **exactly once**; the suite reads the **71** tests
§7 and §10 describe; and its coverage signature — one uncovered arm, at `byP` — is the one §8 and §9 claim.

**Two lessons, and the second is the expensive one.**

1. **An instrument that writes the tree must restore it on EVERY exit path.** A backup outside the tree, a
   `trap`, and a hash check of the restore is the minimum, and it is cheap: the alternative cost a session's
   work and nearly the entire record of it.
2. **A record must be CONNECTED to the artifact it records, or its internal consistency is worth nothing.**
   Every document, script and number here agreed with every other one, and the tree contradicted all of them.
   This is the same shape as the register's other fences — *a declaration is a claim only if something
   connects it to what it names* — and the connection that would have caught it in seconds is a hash of the
   files the record is about, checked before the record is believed.

**And one number this re-run found stale in §10, in the same way iteration 30 found one**: the suite is **71**
tests, not 70, and the project **901**, not 900 — a summary outliving its own correction, twice in two
iterations. The readings above are the re-run's.
