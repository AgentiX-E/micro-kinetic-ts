# The `edges=` grammar — one line, read wrongly twice

Iteration 30. The coverage report left four arms unexercised in `benchmarks/src/fse26-term-oracle.ts`
(`427`, `441`, `1956`, `2303`). Iteration 29 repaired 427 with a **caller** — a dump carrying a joint
row beside a graphless case — and called the other three *pre-existing* `?? 0` guards, which they are:
four named arms, four different sites, and, it turns out, **one defect and one smaller one**.

This records the audit, the measurement, and the gates.

---

## 1. The defect, in one line

**`indexOf` returns `-1` for "not found" and `0` for "found at the FIRST character", and the guard
tested `<= 0`.**

`-1` is a **sentinel**; `0` is a **position**. A test written `separator <= 0` cannot tell them apart, and
here the position it swallowed is the one the producer really writes:

```
  edges=ts-http>ts-root,>ts-quiet        ← the empty-named service calls ts-quiet
```

`renderDiagnostic` renders `${from}>${to}`, and `from` may be the **empty service id** — a candidate
this project reads as real rather than as a parse artefact: one printed row has no service name in
**1421 of the shipped dump's 1422 cases**, it participates in the engine's own normalisation, and the
oracle's module header says so at length. So an entry with nothing in front of the separator is an edge
**from that candidate**, and `<= 0` deleted every one of them from a graph the gate then compared.

The same single character was wrong in the other direction too: an entry with **no** separator at all
(`ts-http`) was treated as the same event — silently skipped — so a graph the reader had only *partly*
read was indistinguishable from one it had read completely.

| the entry | `indexOf` | the old `<= 0` reading | the truth |
| --- | --- | --- | --- |
| `ts-http>ts-root` | `7` | edge | edge |
| `>ts-quiet` | `0` | **skipped as malformed** | an edge FROM the empty-named service |
| `ts-http` | `-1` | **skipped as malformed** | an entry the reader cannot split — a **gap** |

## 2. What the two readings cost

**The gate's reach was a floor quoted as a reach.** `jointGateDecision` returns the emitters the
`logicHttpJoint` gate withdraws the framework-HTTP half from, and `undecidedEdges` — the count that makes
the printed share a **LOWER BOUND** and that refuses the case outright in `logSlopesForMode`. A skipped
entry incremented *nothing*, so the withdrawal share printed as exact over a graph nobody had read.

**The separator's reach signal said `tie`.** `fse26-separator.ts` reads the same `edges=` line through a
second function, `adjacencyOf`, with the same `<= 0` guard. Its `reaches` signal returns `'tie'` when
neither direction is reachable — a claim about the **GRAPH** ("it does not order them") where, with an
entry the reader could not read, the truth is a claim about the **READER**. The word this file already
has for that is `unmeasurable`, the third outcome its header says is "never a loss".

## 3. Both readers now take their split from ONE owner

```ts
export function splitEdge(entry: string): SplitEdge {
  const separator = entry.indexOf('>');
  if (separator < 0) return { read: false };
  return { read: true, from: entry.slice(0, separator), to: entry.slice(separator + 1) };
}
```

Three properties are the fix:

1. **`< 0`, not `<= 0`.** The sentinel is tested as a sentinel. `>callee` is `read: true` with
   `from: ''`, which is what the producer wrote.
2. **`read: false` is a COUNT, never a `continue`.** `JointGateDecision` gained a second refusal —
   `unreadableEdges` — beside `undecidedEdges`, because an entry whose *line* is missing and an entry
   whose *value* is missing are two different absences. `jointGateDecidable` requires both to be zero,
   `logSlopesForMode` throws with its OWN message (a case refused by one cause must not be reported as
   refused by the other), and the footprint prints **the cause that fired**.
3. **It is a function, not a line.** The grammar was spelled twice — once in each module — with a
   separate guard in each and **only one of the two copies had a test**. `fse26-separator.ts` now
   imports `splitEdge` from `fse26-term-oracle.js`, the module it already imports `latencySlopes` and
   `onsetSlopes` from, so the two readers of one line cannot disagree about it.

## 4. The other two arms: a `?? 0` that answered a question nobody asked

`1956` and `2303` are not the same defect, and neither is live. Both are **branches no input can reach**,
and both answered with a **value**:

| site | the arm | why it cannot fire | what the `0` would have said |
| --- | --- | --- | --- |
| `jointFootprint`'s `medianCaseDensity` | `sorted[len >> 1] ?? 0` | a joint row is drawn only from cases the gate can decide, so a footprint exists only over ≥1 case | "the gate withdraws **nothing**" — `0` is the **minimum** of that axis |
| `formatModeScreen`'s table denominator | `baseline?.cases ?? 0` | the loop body only runs when there IS a row, and row 0 IS the baseline | "this row measured the **whole** population" — `row.cases < 0` is false for every row |

Both are removed rather than covered, on the project's own precedent (`sourceOf`: *"a branch no input can
reach, which is a claim about the code that reads like a claim about the data"*):

- the median is read with an **assertion whose invariant is named** — the population cannot be empty here;
- the table is guarded by `if (baseline === undefined) return lines.join('\n')`, which is **byte-identical
  output** on every input and makes the denominator total **and reachable**: the formatter is exported, so
  a screen with no row is a real input, and that arm now has a caller.

## 5. Is it live? Measured, not argued.

The change touches `benchmarks/src/**`, a **golden trigger**, so "no published number can move" has to be a
reading. Two of them.

**The shape census — the population the change is ABOUT.** Every `edges=` line of the local corpus, read
as text rather than through the modules under test:

```
TOTAL lines=1320 entries=65507 no-separator=0 empty-caller=0 empty-callee=0 more-than-one-separator=0
```

**Zero of each.** Both shapes the fix acts on are absent from all 65,507 entries, which is why the fix is
**INERT** here — and it is exactly why the rule had to be **STATED**: a defect no artifact exhibits is a
defect no measurement will find.

**The A/B over the reader's whole output.** Every field the reader produces, every derived screen and the
separator census were canonically serialised under the tree that HAS the change and under its parent
(`e7e36f8`), over 7 dumps, 1320 cases and 41,426 service rows:

```
diff lines: 28      case lines differing: 0      service lines differing: 0
```

**Every differing line is the `footprint` line, and the only difference is the field the change ADDS**
(`unreadableEdges:0`). The `medianCaseDensity` printed by both trees is byte-identical
(`0.2857…`, `0.1538…`, `0.1470…` on the three artifacts that carry a joint row), which is the direct
reading that removing the two `?? 0`s moved no number. The census lines, the self-check lines and the
fidelity lines do not appear in the diff at all.

**The boundary of this claim**, stated rather than glossed: this is the RCAEval half. The FSE'26 artifact
is not local and is not dispatchable by a push, so the FSE'26 half is argued from the trigger — the
modules it changes are the DUMP readers and not the engine — rather than measured.

## 6. The mutation pass: 16 rows, 2 runners, 3 controls, 14 killed

Each row DECLARES its verdict before it runs; every mutated file is restored and **hash-verified**; a
`NO-TESTS` run is neither a kill nor a survivor.

| row | mutates | verdict | declared | how |
| --- | --- | --- | --- | --- |
| C1 | `fse26-term-oracle.ts` rewritten verbatim | SURVIVED | SURVIVED | vitest no-op control |
| C2 | `fse26-separator.ts` rewritten verbatim | SURVIVED | SURVIVED | vitest no-op control |
| S1 | restores `separator <= 0` | KILLED | KILLED | suite |
| S2 | reads an empty callee as the whole entry | KILLED | KILLED | suite |
| R1 | skips an unsplittable entry instead of counting it | KILLED | KILLED | suite |
| R2 | drops the second half of the population condition | KILLED | KILLED | suite |
| R3 | disarms the refusal in `logSlopesForMode` | KILLED | KILLED | suite |
| R4 | stops summing the refusal onto the footprint | KILLED | KILLED | suite |
| R5 | stops naming the cause that fired on the print | KILLED | KILLED | suite |
| R6 | drops the refusal at the gate itself | KILLED | KILLED | suite |
| D1 | reads the minimum instead of the upper middle | KILLED | KILLED | suite |
| D3 | restores the `?? 0` denominator by hand | KILLED | KILLED | suite |
| P1 | drops the separator's unreadable count | KILLED | KILLED | suite |
| P2 | lets `reaches` answer `false` about an unread graph | KILLED | KILLED | suite |
| P3 | lets `inDegree` count a lower bound as a count | KILLED | KILLED | suite |
| D2 | removes `if (baseline === undefined) return …` | KILLED | KILLED | **compiler**, not the suite |

**`D2` is the row worth keeping.** It was declared KILLED, the suite could not kill it, and the pass
recorded a **mismatch** rather than explaining the number away. The reason is a property of the RUNNER
and not a hole in the tests: that guard's mechanism is the **type narrowing** it performs, and `vitest`
strips types before executing — so a test runner **cannot** kill a type guard, exactly as a python control
cannot vouch for a vitest run. The row was re-run against the runner that can, with its own control:

| row | mutates | verdict | how |
| --- | --- | --- | --- |
| CT1 | `fse26-term-oracle.ts` rewritten verbatim | clean | `tsc` no-op control |
| T1 | removes the narrowing guard | KILLED — `TS18048: 'baseline' is possibly 'undefined'` | `tsc -p benchmarks/tsconfig.json` |

**A declaration is a claim about a MECHANISM, so it has to name the instrument that can falsify it.**

## 7. Gates

| | |
| --- | --- |
| the two changed suites | **180 tests**, green (`fse26-term-oracle` 117, `fse26-separator` 63) |
| the consumer suites | `fse26-diagnose-analyze` + `fse26-discriminator` + `fse26-capability-census` + `fse26-report` **492**; `fse26-cli` + `fse26-engine-options` + `fse26-diagnose-dump` + `fse26-diagnose-sink` + `coverage-scope` + `benchmark-rcaeval-trigger` **82** — all green |
| the benchmarks project | **893 tests / 23 files**, green, coverage **99.85 stmts / 97.95 branches / 100 funcs / 99.85 lines** |
| the file the arms were in | `fse26-term-oracle.ts` **100 / 100 / 100 / 100** — all four dimensions, with **no `v8 ignore`** added |
| `fse26-separator.ts` | 99.84 / **97.22** / 100 / 99.84 — branches moved **97.20 → 97.22** with this change; the single remaining line is **1146** (see §8) |
| `tsc -p benchmarks/tsconfig.json` | clean |
| `tsc -p tsconfig.workspace.json` | clean — the union leg |
| oxlint | **0 warnings, 0 errors** on the four changed files |
| prettier | all four changed files conform |
| golden | **OWED** — `benchmarks/src/**` is a `push` trigger of `benchmark-rcaeval.yml`, and the A/B above is the reason the 9 cells are expected byte-identical |

**A stale number in this table, caught by re-reading it.** The project row first read **892**; two independent
re-runs of the same 23-file population — one with `--coverage`, one without — both read **893 tests / 23
files**, and the per-file counts agree with the rows above (117 + 63 for the changed suites). The gate is the
same gate and the four percentages are identical, so this is the integer being one behind, which is the failure
this register already names: **a summary outlives its own correction.** Corrected here rather than in a later
document.

**Two readings this environment changes, recorded because they are about the INSTRUMENT and not about the
tree.** (1) The coverage run **exits 1 after printing a passing report**: `V8CoverageProvider.cleanAfterRun`
removes `benchmarks/coverage/.tmp` and this sandbox's bulk-delete guard refuses it
(`SAFE_DELETE_BULK_CONFIRM_REQUIRED {count: 56, threshold: 50}`). It happens after the report and after the
threshold check, and no threshold error is printed — so the gate's verdict is the four numbers, not the exit
code, and the same run is green on CI. (2) The register guard's `keeps a RETIRED axis retired` test **times out
at the 5 s default on this machine** (13.6 s under load) and reads **14/14 green** at `--testTimeout=180000`;
CI reads the default green. Neither is a defect in the change, and both are stated rather than worked around.

## 8. What this does NOT touch, and the one arm left named

- **Nothing in the shipped ranking.** No weight, no comparator, no term. The modules are dump readers;
  the FSE'26 Top@1 stays **53.23% (757/1422)** and the golden is expected untouched.
- **`fse26-separator.ts` line 1146 — a NAMED arm.** It is the consequent of the ternary inside
  `bestNonTerm`'s `reduce`, reached only when a later cell strictly beats the accumulator. It is
  **pre-existing** and it sits on a `?? 0` of exactly this family — `(cell.auc ?? 0) > (best.auc ?? 0)`
  reads an **unmeasurable** AUC as `0`, the **minimum** of that axis. It is not closed here because the
  rule it needs is a question this change does not answer: **whether `cell.p === undefined` implies
  `cell.auc === undefined`** — the `eligible` filter tests `p`, the comparison reads `auc`, and if the two
  can disagree then either the filter or the comparison is stating an absence it does not hold. That is a
  measurement of its own, on the separator's own population, and it is the next thing to read.
- **`0.007064`** remains the register's named follow-up on the stability axis, unchanged and unrelated.
