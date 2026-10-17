# Three verdicts a report can state, and the arm no input can reach

Iteration 32. `fse26-discriminator.ts`'s report left **three uncovered branch arms and four uncovered
statements**, all inside `formatDiscriminatorReport`, and each of the three turned out to be a different KIND
of claim: one is dead by construction, one is the sentence the shipped measurement itself is an instance of,
and one is a skip that keeps a fabricated sentence out of the report. The file is now at
**100 / 100 / 100 / 100**.

This also records what the report's own `Uncovered Line #s` column can and cannot show — from the reporter's
source this time, not from its habits.

---

## 1. The reading, and the column that could not have shown it

`.git/cov_lines.py` on the full-project `coverage-final.json`, before this iteration:

```
uncovered statements: 4  lines [552, 553, 555, 556]
uncovered branch ARMS: 3  by type {'branch': 3}
    line 545 type=branch uncovered arms [0] at ['545']
    line 549 type=branch uncovered arms [0] at ['549']
    line 558 type=branch uncovered arms [0] at ['558']
```

and the SAME run's text report rendered that file as

```
 ...scriminator.ts |   98.63 |    97.72 |     100 |   98.63 | 552-556
```

**Not one of the three arm lines appears in that cell**, and no elision is needed to explain it: the cell is
seven characters wide. The mechanism is in the reporter's own source
(`node_modules/istanbul-reports/lib/text/index.js`, `nodeMissing`):

```js
if (lines === 100) {
  const branches = fileCoverage.getBranchCoverageByLine();
  coveredLines = Object.entries(branches).map(([key, { coverage }]) => [key, coverage === 100]);
} else {
  coveredLines = Object.entries(fileCoverage.getLineCoverage());   // ← LINE coverage
}
```

so the column names **LINES**: the branch map only when the file's line coverage is already complete, and
otherwise the line map — which cannot contain a branch arm whose LINE executed. Every one of the three arms
sits on a line that runs, so the file's `97.72%` branch figure had **no representation in the report at all**.

That is a second, independent failure of the same column, and it is worse than the one iteration 31 recorded:
there the list was complete and *elided* (a leading `...`, so a reader saw the tail — and the cap that causes
it is visible a few lines up in the same file, `missingWidth` clamped by `maxCols`). Here nothing was elided
and nothing was shown. The two cases together are why this record reads `coverage-final.json` through
`.git/cov_lines.py`, which names each arm's **TYPE** and its **source text** — and why the "arm" and "line"
distinction the register keeps making is not pedantry: `98.63%` statements and `97.72%` branches were
*visible* as percentages and *invisible* as locations.

**And after the iteration the same cell reads empty**, because the file is at 100% on all four dimensions —
which is also the check on the reading above: with line coverage complete, the column falls back to the
branch map, so an arm could not hide there now even if one remained.

## 2. The three arms, and which instrument decides each

| line | the code | what it is | decided by |
| --- | --- | --- | --- |
| 545 | `best.heldOutNet >= 0 ? '+' : ''` | a sign for a value the guard twelve lines above proves positive | **A PROOF** — dead, removed |
| 549 (+ statements 552–556) | `if (best.heldOutBroken > 0) { … this rule TRADES cases … }` | the verdict that the criterion's second half FAILS | **A FIXTURE** — and the shipped measurement is its instance |
| 558 | `if (rule.delta.broken.length === 0) continue;` | the skip that keeps "breaks 0" out of the report | **A FIXTURE** |

A coverage arm is only ever one of three things — **dead**, a **gap**, or a **guard whose subject is another
population** — and the three arms here are one of the first two each. What they are NOT is one kind of claim:
the first is settled by reading the code above it, and the second and third are settled by building the input
that reaches them. This register has said "a test is evidence about a mechanism, not about a reach" before;
this is the mirror of it, and the interesting half is that one of the three had a **measurement** standing in
for the fixture it needed.

## 3. The arm that is dead by construction, and the instrument that holds it

```ts
  const best = screen.rules[0];
  if (best === undefined || best.heldOutNet <= 0) {
    lines.push(/* "no rule beats the baseline out of sample" */);
    return lines.join('\n');
  }
  lines.push(
    `  best held-out: ${best.config} net ${best.heldOutNet >= 0 ? '+' : ''}${best.heldOutNet} ` + …
  );
```

The guard **returns** unless `best.heldOutNet > 0`, so `heldOutNet >= 0` is true for every input that reaches
the line, and the `''` arm cannot be produced. It is the same defect iteration 31 removed from the separator's
rate — a fallback written for a state a guard above has already excluded — and, as there, the fix is to
**remove the fallback and state the invariant** (`net +${n}`), not to write a test for an unreachable state.

**No test can hold this claim, and that is measured rather than asserted.** `.git/mutation_coverage_32.py`
re-introduces the conditional and runs the SUITE beside it:

```
COV1 OK  arms= 1 exp= 1 lines=[117] extra=[] tests=  27 suite_green=True   99s restore=ok
M5   OK  arms= 2 exp= 2 lines=[117, 556] extra=[556] tests=  27 suite_green=True  139s restore=ok
```

The suite is green in BOTH rows and executes the same 27 tests, while the arm count goes from one to two and
the extra arm is at the headline. So the claim is about **reach**, the instrument that holds a reach claim is
**the coverage reading**, and this sheet therefore uses `cov_lines.py` as its runner with its own no-op
control. A runner cannot vouch for a claim about its own reach; the row that tries to would report a
survivor and call it a gap.

The control's expected count is **1, not 0**, and the reason is a population fact worth keeping: this runner
is the discriminator's own suite, which does not exercise `metricTopGap`'s second-candidate branch — another
file's suite does. Row `M5` is therefore stated as a **difference** against the control (one extra arm, at
the headline) and not against zero, which is the register's first law applied to a harness.

## 4. The arm whose instance is the SHIPPED measurement

`docs/fse26-discriminator-verdict.md` §4 records, at the shipped configuration:

| config | fixes / breaks if applied to every case | held-out net | held-out split |
| --- | --- | --- | --- |
| `lat only` | 119 / 462 | **+13** | **25 / 11** |

and that document's §5 — "**the second half of the criterion fails outright**. 11 held-out losses are 11
regressed cases" — is *this clause's own sentence*. So the branch that states the verdict the experiment
actually produced was the branch no test had ever run, and until this iteration the report's most
consequential line had been **printed exactly once, by hand, in the one run it was written for**.

Why no fixture reached it: the clause fires only when the **best** rule — chosen by held-out net, ties by
config name — is net-positive AND its held-out split is not clean. Every fixture in the suite had a best rule
that broke nothing out of sample, so the guard's own precondition was never met. The fixture added here
reproduces the SHAPE rather than the numbers:

- **16 cases** the baseline gets wrong and `log only` gets right, and **8** the baseline gets right and
  `log only` gets wrong;
- **all 24 carry the SAME feature value** (`metricTopGap: 0.9`), which is what makes the trade structural
  rather than a fitting failure: no threshold separates the two populations, so every rule that fires on the
  fixes fires on the breaks as well;
- the fold split is by datapack hash and is `4/3/2/3/4` fixes and `2/2/1/1/2` breaks, so every training set
  chooses the rule and every held-out fold contributes both — measured: `net +8 (fixed 16, broken 8)`, with
  `→ 16/24` off a baseline of 8.

The spec asserts the clause's **precondition** (`best.config`, `heldOutNet > 0`, `heldOutBroken > 0`) before
it asserts the sentence, so it cannot pass on a fixture that never reached the arm — the failure mode this
whole iteration is about.

## 5. The arm that keeps a fabricated sentence out of the report

```ts
  for (const rule of screen.rules) {
    if (rule.delta.broken.length === 0) continue;
    lines.push(`  ${rule.config}: fixes ${…} and breaks ${…} if applied to every case`);
  }
```

`delta` is the configuration's effect on **every** case, which is a different number from the held-out split
of §4 — a rule can break nothing on all cases and still be the one the report names. The skip exists so a
configuration that breaks nothing is not printed as "breaks 0", which would be the report claiming a
measurement it does not have.

The real corpus does not reach it: every configuration there breaks 88 to 590 cases in sample. The fixture
added here does: 5 cases `['log only']` and 5 `['shipped', 'log only']`, so `delta.broken` is empty while the
held-out net is `+5` — and the spec asserts exactly that combination (the empty delta, the positive net, the
zero held-out break) before asserting that the sentence is ABSENT and the headline is present.

## 6. The mutation pass — 5 suite rows + 2 coverage rows, 3 controls, 0 mismatches

**Runner one: `vitest`, on the discriminator's own suite.** Every row declares its verdict before it runs,
every mutated file is restored and hash-verified, and a run that executed nothing would be neither a kill nor
a survivor.

| row | mutates | declared | verdict | tests executed |
| --- | --- | --- | --- | --- |
| `C1` | the file rewritten verbatim | SURVIVED | **SURVIVED** | 27 |
| `M1` | the TRADES sentence deleted | KILLED | **KILLED** | 1 |
| `M2` | the clause fires on a clean rule too (`>= 0`) | KILLED | **KILLED** | 1 |
| `M3` | the skip removed | KILLED | **KILLED** | 1 |
| `M4` | the skip inverted | KILLED | **KILLED** | 3 |

**Runner two: the coverage reading, on the one claim that is about reach.** Declared in advance, with its
own control:

| row | mutates | declared | verdict | arm count |
| --- | --- | --- | --- | --- |
| `COV1` | nothing (this runner's control) | arms = 1 | **OK** — one arm, at 117 | 27 tests, suite green |
| `M5` | the conditional sign re-introduced | arms = 2, the extra at the headline | **OK** — `{117, 556}`, extra 556 | 27 tests, suite green |

**Both rows of the second sheet are green suites**, which is the point of having them: the two runners
partition the claims, and a single sheet would have had to report either a survivor that is not a gap or a
kill it did not make.

## 7. Does anything a reader sees move? The corpus A/B

The change is inside a renderer, so "no published number moves" has to be a reading of the REPORT rather than
of the fields behind it. `.git/probe_disc_report_32.ts` parses every dump the cache holds, reduces the cases
to outcomes, fits and cross-validates the screen at the shipped configuration, and prints each rule's
numbers beside the rendered report and a hash of the whole thing; `.git/probe_ab_32.sh` runs it under this
tree and under the parent (`3572614`) with a `trap` and a hash-verified restore.

```
lines=47   diff lines: 0   rule lines differing: 0   report lines differing: 0   RESTORE VERIFIED
```

**And the corpus is not enough to make that reading mean anything, which this iteration had to discover by
looking.** Every screen the seven dumps build takes the report's EARLY RETURN — no rule beats the baseline out
of sample on any of them (`re3.txt` comes closest, at a held-out net of **−1**) — so an A/B over the corpus
alone would compare two renderings of the same three sentences and say nothing about the line that changed.
The probe therefore renders four hand-built screens as well, and the eleven screens partition like this:

| screen | the branch it exercises |
| --- | --- |
| the 7 corpus dumps | the early return |
| `a-clean-best-rule` (10 fix / 10 keep) | the early return, from a net of exactly 0 |
| `no-rule-at-all` (6 shipped-only) | the early return, from an empty rule list |
| `a-trading-best-rule` (16 fix / 8 break, one feature value) | **the headline sign and the TRADES clause** |
| `a-dominating-configuration` (5 fix / 5 neutral) | **the headline sign and the SKIP** |

so the changed line and both newly-reached arms are ON the reading, and the two trees render all eleven
byte-identically — which for a branch removal with no output change is the whole of the claim. The corpus
half is what says no PUBLISHED number moves; the fixture half is what says the comparison was not vacuous.

## 8. The arms, before and after

| | before | after |
| --- | --- | --- |
| uncovered **statements** | 4 (552, 553, 555, 556) | **0** |
| uncovered **branch arms** | 3 (545, 549, 558) | **0** |
| `fse26-discriminator.ts` | 98.63 stmts / **97.72** branches / 100 / 98.63 | **100 / 100 / 100 / 100** |
| the same file, as the report renders it | `98.63 \| 97.72 \| 100 \| 98.63 \| 552-556` | `100 \| 100 \| 100 \| 100 \|` (empty) |
| the project | 99.86 / 98.23 / 100 / 99.86 | **99.93 / 98.35 / 100 / 99.93** |

Two of the four arm-and-statement numbers were closed by FIXTURES and two by the removal — and the counts do
not partition the same way, which is worth stating: `M1` (the sentence deleted) is killed by the new spec,
`M3`/`M4` (the skip) by the other, and `M5` (the sign) by no test at all.

## 9. What this does NOT touch — and the inventory it leaves

`fse26-diagnose-analyze.ts` still carries **41** uncovered arms and **4** uncovered statements, and this
iteration did not go near it: that file is the engine's own analysis and formatting layer, its arms are a
different population from a single report's, and an inventory is not an audit. They are listed here so that
the next iteration starts from a reading rather than from a grep:

```
fse26-diagnose-analyze.ts   uncovered statements [2790, 2791, 2792, 5079]
                            uncovered branch ARMS 41, over 41 entries (one dead arm each)

  the verdict sentence    4476  (s.lostAtShip > 0 ? ' — the criterion's second half FAILS' : '')
                          5142  (s.lostAtShip > 0 ? ' — the criterion's second half FAILS' : '')
  the sign                1882  `fixed … broken … net ${reconciled.net >= 0 ? '+' : ''}${reconciled.net}`
  the duplicated bump     4315  for (const datapack of solved.gained) bump(gainTypes, faultTypeOf.get(datapack) ?? '')
                          4919  (the same line)
                          5691  (the same line)
  tie-breaks              3429  [...roots].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
                          3528  .sort((a, b) => a.margin - b.margin || (a.datapack < b.datapack ? -1 : 1))
                          5731  return a.family < b.family ? -1 : 1
                          5781  const marker = row.enginePoolFamily ? ' *' : '  '
  reducers                5510  (best, one) => (best === undefined || one.losesFrom < best.losesFrom ? one : best)   x2
                          5514  (best, one) => (best === undefined || one.permittedFrom < best.permittedFrom ? one : best)  x2
  guards on a missing input 1153  if (sourceService === undefined) continue;
                          2762  if (!Number.isFinite(cap)) return undefined;
                          2765  if (t === undefined) continue;
                          2789  }
                          2879  if (measured === undefined) return [];
                          2881  if (n < 2) return [];
                          2890  if (target === undefined || !measured.weighed.has(name)) continue;
                          2894  if (other.base >= target.base) continue;
                          2961  if (target === undefined) continue;
                          3293  if (targets.length === 0) continue;
                          4369  if (first === undefined) return 'Temporal (onset) screen: no shape was screened'
                          5078  (binder === undefined …)
                          5207  if (first === undefined) return 'Decisive-stability screen: no shape was screened'
                          5978  if (seen.size === 0) return { decimals: HISTORICAL_FIELD_DECIMALS, stated: false }
  fallbacks               1140  outcome.breakdown?.deviation ?? 0
                          1156  kase.prediction[0] ?? ''
                          1157  winnerId === '' ? undefined : shape(kase, winnerId)
                          1732  temporalWeight * ((onset.get(winner!) ?? 0) - (onset.get(source) ?? 0))   x2
                          1922  weights.onsetShape ?? SHIPPED_ONSET_SHAPE
                          5016  Number.isFinite(value) ? value.toFixed(6) : 'unbounded'
                          5632  `ADMISSIBLE [${at(verdict.gainsFrom ?? 0)}, ${at(verdict.ceiling)}) width `
                          7605  rawShape !== undefined && isOnsetShape(rawShape) ? rawShape : DEFAULT_ONSET_SHAPE  x2
  report formatting       5018  law.range === 1 ? '' : `, each position worth ${at(law.range)}`
                          5809  row.gained.length > 4 ? ', …' : ''
                          6628  box.extraDigits === 0 ? body : `${body} (at ${box.extraDigits} digits beyond that)`
```

Three clusters in that list are worth naming before anything is proposed:

- **`(s.lostAtShip > 0 ? ' — the criterion's second half FAILS' : '')` appears twice** (4476, 5142) and it is
  the SAME shape as this iteration's §4 arm: a verdict sentence that no fixture prints. Whatever holds the
  first one holds the second, and the pattern has now been found in two files.
- **`reconciled.net >= 0 ? '+' : ''` (1882)** is the same sign shape as §3's dead arm. Whether it is dead or
  merely unreached is a question about the code above it, and until it is answered the arm is named rather
  than removed.
- **`?? ''` inside a `bump(...)` call appears three times** (4315, 4919, 5691) — one line, three copies, which
  is the cross-file duplication this register has already treated as a coverage smell.

## 10. Gates

| | |
| --- | --- |
| the changed suite | **27 tests** green (`fse26-discriminator`, 25 → 27) |
| `fse26-discriminator.ts` | **100 / 100 / 100 / 100** — no arm left, no statement left |
| the benchmarks project | **903 tests / 23 files**, coverage **99.93 / 98.35 / 100 / 99.93** |
| `fse26-separator.ts` | 100 / 99.65 / 100 / 100 — iteration 31's one named arm holds |
| `fse26-term-oracle.ts` | 100 / 100 / 100 / 100 |
| `.git/cov_lines.py` | the runner for the reach claim, and the reading behind §1 |
| `tsc -p benchmarks/tsconfig.json` · `tsc -p tsconfig.workspace.json` | clean · clean |
| oxlint / prettier | 0 warnings, 0 errors on the `benchmarks` subtree · the changed files conform |
| the register's own fence | **14 / 14** green with the new index row and the two invariants |
| golden | **OWED** — `benchmarks/src/**` is a `push` trigger, and §7 is why the 9 cells are expected byte-identical |
