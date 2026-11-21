# What a comparator is asked, and the census iteration 39 never ran

Iteration 40. One claim is corrected, one claim is measured for the first time, and one site is changed.

**Corrected.** `docs/separator-tie-break-audit.md` writes that "a `? -1 : 1` tie-break appears **24 times** in
this repository", that "two of those are not comparators at all", and that "the remaining **22 are comparators
that cannot return `0`**" — followed by: "**One site has a key that repeats: this one**." The arithmetic is
wrong — the tree holds **23** occurrences and **20** comparators — and the sentence after it is a claim about
the other nineteen that **no instrument had ever been pointed at**. That is the register's own four-iteration
mistake one level up: a count written down as if it were a measurement, standing immediately beside the
sentence that says counts are not.

**Measured.** A comparison function is *consistent* iff `cmp(x, y) === -cmp(y, x)`. A
`key(a) - key(b) || (name(a) < name(b) ? -1 : 1)` shape breaks that identity on exactly the pairs whose keys
are EQUAL — it answers `1` in both directions — so **asking every comparator both ways is a site-independent
witness** for "this comparator was handed two elements it cannot order". Over two disjoint populations, **all
twenty sites are reached and not one is ever handed such a pair**, and the zero is carried by a positive
control that proves the instrument can see the thing it is counting.

**Changed.** One of the twenty had a uniqueness that belonged to its CALLER rather than to its own
construction. It is a property of the function now, and a spec holds it.

---

## 1. The census that was wrong, and why the number mattered

| what | iteration 39 wrote | the tree holds |
| --- | --- | --- |
| `? -1 : 1` occurrences | 24 | **23** |
| of which not comparators | 2 | **3** |
| comparators | 22 | **20** |

The three non-comparators are one COMMENT and two SIGN computations. The comment
(`benchmarks/src/fse26-diagnose-analyze.ts:3576`) names a comparator that was REMOVED in an earlier iteration,
and the two signs (`granger-causality.ts:252`, `statistics-provider.ts:410`) are `z < 0 ? -1 : 1`, where two
values are the whole domain. Counting a comment as an occurrence is what the extra one is: a census of a
PATTERN rather than of a thing.

The arithmetic is the smaller half. The larger half is that iteration 39 measured exactly ONE site — its own —
and then wrote down a property of the other twenty-one. It had the argument for doing better: the same document
says a tie-break's safety "is a property of each CALL SITE rather than of the shape", and "nothing in the code
says which is which". It then said which is which anyway.

---

## 2. The instrument

`.git/comparator_census.ts` patches `Array.prototype.sort`. The comparator it is handed is wrapped so that the
wrapper (a) answers with the comparator's own value, which is what the sort sees, and (b) asks the SAME pair the
other way round and records a pair answered `> 0` **in both directions**. The extra call is discarded.

Two properties make that sound rather than merely convenient:

- **the sort is not perturbed.** The value returned is byte-for-byte the value the unpatched comparator would
  have returned, so a patched run orders a list exactly as an unpatched one does. The census changes what is
  OBSERVED, never what happens;
- **the second call is free of side effects.** Every comparator in this repository is a pure function of two
  operands — field reads, `Math.max`, arithmetic — which is what §5 checks site by site rather than assumes.

The site is attributed from the stack, and V8 pushes no JS frame for its own `Array.prototype.sort`, so the
frames inside the comparator go wrapper, `Array.sort`, patched `sort`, and then straight to the frame that
called `.sort()`. That last one is the attribution. Records are keyed by the call site **and** the comparator's
own source text, because two comparators can be built at one call site and a site-keyed map would have had to
either merge two shapes or silently replace a record whose counts it had already taken.

---

## 3. The control, because a zero is not evidence on its own

The first thing the corpus probe does is run `byP`'s **pre-iteration-39 shape** — `a.p - b.p || (a.faultType <
b.faultType ? -1 : 1)` — over a two-element list whose keys are equal, through the same instrument.

```
CONTROL two-valued-byP-on-a-repeated-key unordered=1
```

The instrument sees it. And the corpus census then reports `sites_with_unordered=1`, whose single entry is that
control's own call site — so the reading is not "the corpus contains one bad comparison", it is "the corpus
contains one bad comparison **and the probe wrote it**".

Without this row, every `unordered=0` below would be indistinguishable from an instrument that cannot see
comparators at all — which is the error iteration 37 made and iteration 38 corrected, and it is why the control
is printed by the probe rather than asserted in this document.

---

## 4. The two populations

Neither population is the other, and the sites they reach are different, so both are reported.

| population | sites | lists | elements | comparisons | unordered | never asked |
| --- | --- | --- | --- | --- | --- | --- |
| the corpus (8 dumps, every screen the analyzer renders) | 25 | 12,136,986 | 60,420,445 | **200,735,977** | **1** (the control) | 2 |
| the suite (`benchmarks`, `packages/tree`, `packages/kinetic`) | 78 | 2,638,074 | 4,093,135 | **2,128,688** | **0** | 9 |

The suite population is the three projects whose sources hold a `? -1 : 1` comparator — `benchmarks` (23 files,
931 tests), `packages/tree` (15 files, 650) and `packages/kinetic` (37 files, 968) — run through the projects'
OWN vitest configs, merged with a setup file that installs the instrument, so the census is taken over the same
tests that gate the repository rather than over a fixture written to be observed. One config line is not
cosmetic: the instrument asks every comparator both directions, and three of the benchmarks project's tests
were already within 2 s of the 5 s default timeout. Their failure under the instrument is a TIMEOUT and not a
verdict — a census that reported it as a failure would be reporting its own cost as a defect.

The suite's 78th site is `<unattributed>`: the repository's `only-allow pnpm` guard compares two operands from
a stack with no JS frame in it. It is named here rather than dropped, because a total that silently excludes a
site is a total that cannot be checked.

**Nine sites are reached and never ASKED** (`calls=0`): a sort over a list that never had two elements to
compare still attributes the call site. That is a different state from "asked and always orderable", and the
two are printed apart — §5's `calls` columns are the reason the table can say which is which.

---

## 5. The twenty

Every site, its tie-break key, what builds the list, and what each population asked it. `calls` is comparisons;
`sort line` is the line of the `.sort(` call the census keys on, which is the tie-break's own line wherever the
two are the same statement.

| site | key | sort line | builds the list | corpus calls | suite calls | unordered |
| --- | --- | --- | --- | --- | --- | --- |
| `fse26-diagnose-analyze.ts` | `faultType` | 1201 | `byType.entries()`, a Map | not reached | **0** | 0 |
| `fse26-diagnose-analyze.ts` | `id` | 3479 | `one.scores`, a Map by service | **0** | 16 | 0 |
| `fse26-diagnose-analyze.ts` | `family` | 5807 | `rows`, one per screened family | 128 | 116 | 0 |
| `fse26-diagnose-analyze.ts` | `key` | 5828 | `counter.entries()`, a Map | 133 | **0** | 0 |
| `fse26-diagnose-analyze.ts` | `faultType` | 6945 | `byType.values()`, a Map | not reached | 6 | 0 |
| `fse26-discriminator.ts` | `config` | 513 | `configDeltas`, a `new Set` of names | 28 | 8 | 0 |
| `fse26-report.ts` | `faultType` | 362 | `perFaultType.entries()`, a Map | not reached | 24 | 0 |
| `fse26-separator.ts` | `faultType` | 1124 | `byType.entries()`, a Map | 88 | 14 | 0 |
| `fse26-separator.ts` | `name` | 1156 | `candidates`, one per signal | 58 | 7 | 0 |
| `fse26-separator.ts` | `name` | 1354 | `census.total.cells`, one per signal | 896 | 1,208 | 0 |
| `fse26-term-oracle.ts` | `key` | 1441 | `keys`, a `new Set` of family names | 111 | 3 | 0 |
| `fse26-term-oracle.ts` | `key` | 1536 | `counter.entries()`, a Map | 528 | 12 | 0 |
| `fse26-term-oracle.ts` | `key` | 1962 | `perType.entries()`, a Map | 210 | 15 | 0 |
| `pruner.ts` | `serviceId` | 1626 | `scoredNodes`, one per `allNodes` key | not reached | 239 | 0 |
| `pruner.ts` | `id` | 1806 | `defined`, from `postInjectOnsetDelays` | 35,988,882 | 1,377,835 | 0 |
| `fse26-diagnose.ts` | `label` | 348 | `kept` outcomes, one per metric | not reached | 32 | 0 |
| `fse26-diagnose.ts` | `label` | 387 | `withBreakdown`, one per metric | not reached | 49 | 0 |
| `fse26-diagnose.ts` | `label` | 391 | `dropped`, one per metric | not reached | 8 | 0 |
| `fse26-diagnose.ts` | `serviceId` | 454 | the case's `services` | not reached | 2,062 | 0 |
| `prism.ts` | `serviceId` | 104 | `scores`, one per service | not reached | 5 | 0 |

**Twenty of twenty are reached; not one is reached-and-unordered.** By CONSTRUCTION — an argument that holds
for every input rather than for these bytes — the tie-break key is unique in **seventeen** of them, and by
three different arguments: **fourteen** read the list out of a `Map` or a `Set`, whose keys cannot repeat at
all; **two** read the separator's statically declared signal list, whose uniqueness `fse26-separator.test.ts`
already asserts as a spec; and **one** reads the service ids of a case, which the producer takes from
`input.callGraph.nodes.keys()`.

That leaves **three**, and they are the reason this section is not a sentence about `Map`.

### 5.1 The three whose key belongs to the artifact

`packages/kinetic/src/benchmarks/fse26-diagnose.ts` sorts a service's metric outcomes by `label` three times
(`:348`, `:387`, `:391`), and the labels come from `graph.metricDiagnostics?.get(serviceId)` — the engine's
list, filled by one `metricDiagnostics.push` per entry of `metrics.get(serviceId)`, which is the LOADER's
array. Nothing in that chain dedupes a label.

The building module knows the difference, and says so in code: `fse26-diagnostic-builder.ts` computes the
rendered inventory as `[...new Set(series.map((s) => s.label))].sort()` — deduplicated — while passing
`metricOutcomes` through RAW, three lines apart. The read side is no firmer: `parseDiagnosticDumpWithReport`
accepts an inventory whose LENGTH matches the count `metricKept(n)` declared and whose scores are finite, and
checks no NAME, so an artifact rendering one metric twice parses.

So for these three the verdict is a measurement and not a proof, and it is stated as what it is: **the key can
repeat if an artifact carries two series of one metric name for one service, and the sites have been asked 89
times across the three suites without one.** The corpus never reaches this formatter at all, which is why the
suite is the population named here. No guard was added for it. A check on the READER would be an arm nothing in
the tree draws — the register's own class of unexercised contract — and a dedupe here would merge two entries
the artifact really carried, which is the opposite of what a reader of a dump should do.

Two sites need their `calls` read carefully and are named rather than summed away:

- **`fse26-diagnose-analyze.ts:3479`** — 194 lists of **one element each** on the corpus, so the comparator was
  asked NOTHING there and its `ord=0` is an absence. The suite asks it 16 times, which is where the reading
  comes from.
- **`fse26-diagnose-analyze.ts:1201`, `:5828`** — the corpus and the suite each reach one of them and never ask
  it. Neither population asks `:1201` at all.

---

## 6. The one whose uniqueness belonged to its caller

`familyScreen(cases, weights, families?)` builds its rows from

```ts
const requested = families ?? [...labelsByFamily.keys()];
```

and sorts them by gain, then by window width, then by **family name** — a `? -1 : 1` comparator, so a tie on
the name is a tie it cannot express. On the default path `requested` is a `Map`'s keys and the name is unique
by construction. On the explicit path it is the CALLER's array, and `['k8s', 'k8s']` puts two rows of one
family in front of that comparator.

That is not a hypothetical shape: it is one call away, in an exported function, and removing it costs an
expression with no arm in it:

```ts
const requested = [...new Set(families ?? labelsByFamily.keys())];
```

`[...new Set(xs)]` preserves insertion order, so the DEFAULT path is byte-identical **by construction** — the
argument is not that the corpus did not move but that it cannot — and the A/B in §8 turns that argument into a
measurement over the whole corpus. Where a caller named a family twice, the screen now answers with one row,
which is what the request means.

The `0` arm was NOT added, and that is a decision with a number behind it: with the request made a set, the
names in `rows` are unique, so the arm cannot be reached — sheet one's M4 adds it and the suite SURVIVES, which
is what an unreachable arm does. The separator's `byP` needed one because its key genuinely repeats; this
comparator does not.

### The spec, and the control sheet that shows why it is not decorative

```
screens a family named twice in the request ONCE, because the row order cannot say equal
```

It asserts the whole screen (`twice` equals `once`), not only the row count, so a dedupe that reordered or
re-solved the row behind it fails. It is also the ONLY producer of a duplicate request in the repository, which
sheet two measures rather than assumes.

---

## 7. The sheets

**Sheet one — the suite runner (`benchmarks/__tests__/fse26-diagnose-analyze.test.ts`, its own 446 tests, 5
rows, 0 mismatches).**

| row | mechanism | verdict | ran | failed |
| --- | --- | --- | --- | --- |
| C1 | — (control) | SURVIVED | 446 | 0 |
| M1 | the dedupe removed, back to the caller-trusted form | KILLED | 446 | 1 |
| M2 | the request UNIONED with the dump's families | KILLED | 446 | 2 |
| M3 | the name tie-break inverted | KILLED | 446 | 3 |
| M4 | the `0` arm ADDED | **SURVIVED** | 446 | 0 |

M1's single failure is the new spec, and M4's survival is the finding: the arm the separator owes is one this
comparator does not, and a sheet of killing rows could not tell the two apart. M2 and M3 kill more because the
row order is asserted in several places — which is the point of running the whole file rather than the new
spec alone.

**Sheet two — can the census see THIS site present an unorderable pair.** Sheet one is a statement about the
suite; this one is the statement about the instrument. It runs the same mutation with `Array.prototype.sort`
patched and asks whether the site the mutation corrupts is the site the census reports.

| row | tree | `calls` at the site | `unordered` at the site | suite |
| --- | --- | --- | --- | --- |
| P1 | as shipped | 58 | 0 | green |
| P2 | the dedupe removed | 59 | **1**, operands named | one failure |
| P3 | the dedupe removed AND the new spec deleted | 58 | 0 | green |

P2's witness reads `{family=k8s,services=2,cases=2,gain=1} vs {family=k8s,services=2,cases=2,gain=1}` — the two
rows the run order puts in front of the comparator. P3 is P2's control. Without it, P2 would read as "the ENGINE
presents the duplicate" rather than "the SPEC does" — and a repository whose only duplicate request is written
by a test is exactly the state this iteration had to distinguish from a repository that has none.

---

## 8. The A/B

`.git/probe_ab_40.sh` renders every analyzer report the earlier iterations' probe renders — the onset and cv
screens at three weights and both shapes, the family screen, the miss report at two log weights, and the
criterion over four artifacts, three of them `protect` — from the tree WITH the change and from the parent
`61716e6` with the parent's source installed, and hashes both.

```
lines=461   lines=1717
HASH 2c19a6404fad633d564a105b29eeb92d6d4c7e54a7b81c788efb6610e9946f61
HASH 2c19a6404fad633d564a105b29eeb92d6d4c7e54a7b81c788efb6610e9946f61
diff lines: 0   NUMBERS lines differing: 0   report lines differing: 0
RESTORE VERIFIED
```

One hash on both sides. The parent's source is installed through a `trap` and the working copy is
hash-verified before the script reports anything.

---

## 9. The gates

`prettier` clean over the repository's format glob, `oxlint` clean (341 files, 102 rules, 0 warnings and 0
errors), `tsc -p tsconfig.workspace.json` clean, and all fourteen project configs clean — the per-project leg
run directly rather than through `nx`, because this sandbox has no `pnpm` on `PATH` and `nx` invokes the
`typecheck` target through it. The register fence is green at 14 tests.

The three suites whose sources hold a `? -1 : 1` comparator: `benchmarks` 23 files / 931 tests, `packages/tree`
15 / 650, `packages/kinetic` 37 / 968 — all passing. Coverage on `benchmarks`: **statements 99.95, branches
99.88, functions 100.00, lines 99.95**, every dimension above the 95% bar. The uncovered surface is unchanged
from iteration 39 and re-read through `.git/cov_lines.py` rather than the reporter's column: **3 arms and 3
statements**, all in `fse26-diagnose-analyze.ts` (two loop exits at 2815–2818 and the `'unbounded'` clause at
5084), with `fse26-separator.ts` at zero of both. The change in §6 adds no arm: a `Set` over an iterable is one
expression, and both of its outcomes are on covered lines.

The whole instrument remains reproducible from `.git/comparator_census.ts`,
`.git/comparator_suite_setup.ts`, `.git/vitest.census.benchmarks|packages_tree|packages_kinetic.config.ts`,
`.git/probe_comparators_40.ts`, `.git/census_sum.py`, `.git/mutation_pass_40.py` and
`.git/mutation_census_40.py`; the joined table in §5 and §6 is produced by `.git/comparator_sites_40.py`, which
lists the twenty BY HAND so the table can be checked against the code rather than against a grep.

**One harness defect is recorded because it was caught before it was published.** The suite census file had
been APPENDED to across two source revisions of `fse26-diagnose-analyze.ts`, and the first aggregate therefore
carried every `benchmarks` site TWICE, five lines apart — the `5802`/`5807` pairs in the table above are that
offset, and each pair was one site wearing two revisions' line numbers. A record whose blocks come from two
trees is two populations sharing one file's name, which is exactly the defect this repository has a law about:
**a record must be connected to the artifact it records**. The run was killed, the file removed, and every
number in §4 and §5 re-taken from a single tree.

---

## 10. What is not claimed

- **A zero over a site with `calls = 0` is an absence.** Two of the twenty are in that state on one population
  each and one on both; the table prints it rather than averaging it away.
- **`unordered = 0` is a property of the populations measured, not of the code.** The argument for the
  seventeen is a construction and holds for every input; the argument for the corpus and the suite is an
  observation and holds for those bytes. Both are stated, and neither is offered for the other.
- **The census is not a proof that no comparator is ever inconsistent.** For **seventeen** of the twenty the
  key is unique by construction and that is a proof about every input; for the other **three** it is a
  measurement over 89 calls and about nothing else. The instrument's own control is what makes either worth
  printing, and neither is offered for the other.
- **`Array.prototype.sort` being stable is not used anywhere.** The one site whose key could repeat has a key
  that no longer can; the instrument's own report is what says so, and no argument here rests on what the
  engine does with a pair it is told is unequal.

---

## 11. The push, and the two halves of the criterion

Two commits: `32bac0a` (the source and the spec) and `d630da9` (this document and the register). The source
commit changed `benchmarks/src/**`, so it owed a golden; the docs commit's push started only `CI` + `Release`,
which this repository's own rule reads as **no golden owed**.

**CI, run `36869017671` on the last commit.** The source commit's own CI reads `cancelled`, which is `ci.yml`
cancelling itself, so the last commit's run is the one that counts: **19 jobs, 18 succeeded and `benchmark-diff`
skipped** — that job is `if: pull_request` and is skipped on every push by design, so the reading is 18 of 18
runnable and never 19 of 19. `benchmark-tests` read **23 files / 931 tests** at **99.95 / 99.88 / 100 / 99.95**,
with the same two per-file rows the local run produced: `fse26-diagnose-analyze.ts` 99.9 / 99.76 / 100 / 99.9
(2816-2818) and `fse26-separator.ts` 100 on all four. The Python gate read `Ran 480 tests` and
`TOTAL 1637 0 588 0 100.00%` — its sixth consecutive hundred, on a commit that touches no Python.

**Golden, run `36868994008`** (dispatched by the source commit; `ablation-re2` was still running when these
cells were read, and no cell depends on it):

| | OB | SS | TT |
| --- | --- | --- | --- |
| RE1 | 80.0 | 92.8 | 68.0 |
| RE2 | 82.4 | 88.9 | 68.1 |
| RE3 | 80.0 | 45.0 | 51.1 |

Nine cells, every one identical to the invariant — **the criterion's first half**. The second half is not
measured by a push and cannot be, because `fse26-benchmark.yml` is `workflow_dispatch:`-only: what holds it
here is §8's A/B, one hash over the whole corpus with `diff 0`, labelled dispatchable-but-not-dispatched.

The panels are checked too, and against the PREVIOUS iteration's run rather than against a tolerance — the
per-fault-type tables are the nine cells' own composition, so a cell can hold while a row below it moves. Both
runs' `AC@1`/`Avg@5`/`LA`/`TA` rows, whitespace-normalised and compared as sets:

```
re1: old=24 lines  new=24 lines  identical=True
re2: old=24 lines  new=24 lines  identical=True
re3: old=36 lines  new=36 lines  identical=True
TOTAL panel lines: old=84 new=84
```

84 lines, zero on either side of the diff. The change this iteration ships cannot move any of them — a `Set`
over a `Map`'s keys cannot reorder a list — and that argument and this measurement are the two halves of the
same claim.
