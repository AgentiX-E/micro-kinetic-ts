# The population a report is computed over — a reader that refused in silence

**Measured 2026-09-26.** Every verdict in this repository is computed over a set of cases, and that set is
whatever the reader happened to keep. The reader drops a whole block when its rendered candidate count
disagrees with the block's own `services=` header — deliberately, and for a documented reason: *"a short list is
not a smaller case, it is a different `n`, which changes the metric term of every service in the case."*

**The refusal is right and the silence was the defect.** `parseDiagnosticDump` returned the surviving cases and
threw the count away, so an artifact that lost blocks produced verdicts over a smaller population with nothing
on screen to say so. `cases: 89` reads exactly like an artifact that has 89 cases.

## 1. It is not hypothetical — the record already contains the one time it was noticed

`stripLogPrefix`'s own comment states it, and it is worth reading as the reason this document exists:

> on run `35107871516`, 13 of 1422 blocks had a BOM on a service row, each lost that row and was dropped whole
> for a count mismatch — **0.9% of the population**, 10 of them cases the run got right, which is how the loss
> was noticed (**the screen read 746 correct where the run published 756**).

So the loss **happened, on the artifact this record's FSE'26 numbers are read from**, and it was found by
comparing a screen against a number published elsewhere. Not by the reader: the reader had no way to say it.
**A measurement that can only be caught by an external comparison is a measurement with no guard.**

## 2. Measured on a truncated artifact: silent, and exit 0

One service row deleted from the last block of `re3.txt` (90 cases):

| | healthy `re3.txt` | the same file with one row missing |
| --- | --- | --- |
| `dump_capability.py` | `cases=90 rows=2900 short_blocks=0` | `cases=90 rows=2899 **short_blocks=1**` |
| `analyze-fse26-diagnose.ts` | `cases: 90`, exit **0** | `cases: **89**`, exit **0** |
| the separator screen | `42 wrong cases paired` | `**41** wrong cases paired` |
| anything saying so | — | **nothing** |

And the same file cut **between** two blocks (the shape a partial download produces) reads identically:
`cases: 89`, exit 0, no statement.

The sharpest form of it is in the separator's own output, which prints a completeness count about the artifact
while the block it discarded appears nowhere:

```
  41 wrong cases paired (source = the case's most anomalous ground-truth service, winner = the
     engine's rank-1); 0 wrong cases whose source the dump does not describe
```

**That `0` is true of the surviving population and misleading about the artifact**: the case the reader
refused is not in the population being described, so it cannot be counted by any line about it.

## 3. The fix: the reader reports what it refused

`DiagnosticParseReport` — `cases`, `shortBlocks`, `unclosedBlocks`, `missingServices` — and
`parseDiagnosticDumpWithReport`, which returns the surviving cases **and** the report from **one** parse.
`parseDiagnosticDump` now delegates to it (`return [...parseDiagnosticDumpWithReport(text).cases]`) rather than
scanning again: two passes over one text is how two readers of one artifact start disagreeing, and a report is
worth only as much as the certainty that it describes the **same** parse that produced the cases.

The two reasons are a **partition** of the reader's drops, and there are three drop paths in the code, all
three of which used to be silent:

| path | the code | counted as |
| --- | --- | --- |
| reached `prediction=` with a count mismatch | the `else` of the keep condition | `shortBlocks` |
| the file ended with a block open | after the loop | `unclosedBlocks` |
| **a further `DIAG` header arrived while one was open** | `if (current !== undefined)` in the header branch | `unclosedBlocks` |

The third is the one whose only trace was an assignment — `current = { … }` overwrote the block and left
nothing behind.

`missingServices` is the **shortfall** (`max(0, declared − parsed)`) rather than the difference, and the
distinction is not pedantic: a block that rendered more rows than it declared has no declared-but-missing
candidate, and adding a negative there would subtract from another block's loss — a total that understates the
damage in the one direction where it matters.

**The policy is in the testable module, not the CLI.** The CLI (`analyze-fse26-diagnose.ts`) runs `main()` at
import and cannot be loaded by a test — the module's own docstring records why that matters — so the refusal is
a pure predicate (`parseLosses`) and a pure formatter (`formatLossStatement`) in `fse26-diagnose-analyze.ts`,
and the CLI is file I/O and `process.exit`:

```
population — /tmp/re3_truncated.txt: 89 blocks kept, 1 dropped (1 short of their own `services=` header,
  0 that never reached a `prediction=` line, 1 candidate declared and not rendered)

Refusing to report over a population this reader had to shrink: a verdict computed over a smaller case
set is a verdict about a different artifact. Re-run with --allow-dropped-blocks to read the surviving
blocks instead, which prints the loss above the report.
```

**The default is to refuse, and the way past it is a named flag.** `--allow-dropped-blocks` is deliberately
not the default: *"every block parsed"* and *"I know some did not and I am reading the rest"* are different
statements about the numbers below them, and only the first is the one a reader assumes. It is a **switch**
rather than a value flag, so a number after it fails loudly instead of being swallowed (the file's own
doctrine), and it is read in **both** modes from one place, so the comparison path and the dump path cannot
disagree about it.

The refusal covers **siblings** as well as the primary artifact: a comparison is only as sound as its worse
half, so a healthy `--dump` beside a truncated one is refused, and the statement names the artifact that lost
blocks rather than the invocation.

**The healthy case is stated rather than omitted** — `nothing dropped (every block reached its own
`prediction=` line with the candidate count its header declared)` — for the same reason the artifact census
reports `every` rather than saying nothing: a reader must be able to tell *"nothing was lost"* from *"nothing
was said"*.

## 4. The census's count is NOT the reader's, and the three differences are measured

The census has answered this question for three iterations (`DumpCapability.short_blocks`), which makes it
tempting to read its number as the reader's. It is not the same number, and it is **neither a superset nor a
subset** of the reader's drops. Four shapes, both instruments, the same bytes:

| shape | census `cases` | census `short_blocks` | reader `cases` | `shortBlocks` | `unclosedBlocks` | `missingServices` |
| --- | --- | --- | --- | --- | --- | --- |
| A · 2 declared, 2 rows, footer | 1 | **0** | 1 | 0 | 0 | 0 |
| B · 2 declared, 1 row, footer | 1 | **1** | 0 | **1** | 0 | 1 |
| C · **1 declared, 2 rows**, footer | 1 | **0** | 0 | **1** | 0 | **0** |
| D · 2 declared, 2 rows, **no footer** | 1 | **0** | 0 | 0 | **1** | 0 |

1. **The census counts a STRICT shortfall** (`parsed < declared`); the reader drops on **any** inequality. So
   shape C — a block that rendered more rows than its header declared — is **zero loss** in the census and a
   whole dropped block in the reader. The reverse direction of the same rule is shape B, where they agree.
2. **A block that lost its footer but rendered every row it declared is a `0` in the census** (shape D) and a
   drop in the reader. Its rows are all there; what is missing is the block's own evidence of its population.
3. Shape B is the one they agree on, which is exactly why the census's number looked like the reader's.

The relation that does hold is a **derivation rather than an equality**: the census counts a case for every
**header**, so `cases − short_blocks` is the blocks that rendered their declared rows — **which is what the
reader keeps, less every block it dropped for a reason the census cannot see** (an over-render, or a lost
footer with no row loss). On all four shapes above: `1 − 0 = 1`, `1 − 1 = 0`, `1 − 0 = 1`, `1 − 0 = 1` against
the reader's `1, 0, 0, 0`. It is asserted per shape on the python side and per shape on the TypeScript side; it
cannot be asserted *between* them, because neither side has both numbers, and saying so is more honest than a
fence that would have to guess.

## 5. The fences

- `benchmarks/__tests__/fse26-diagnose-analyze.test.ts` — **12 new tests**: the report on an intact artifact,
  on a count mismatch, on a lost footer, on a block abandoned by a further header, the `missingServices` total
  over **both** reasons at once (so it cannot be satisfied by counting either alone), the delegation asserted in
  both directions, the zero line stated rather than omitted, the label naming the artifact that lost blocks,
  the singular pluralisation, and the four properties of the flag (default, both modes, switch-not-value,
  named in the usage). The fixtures are built with the **producer** (`formatFSE26Diagnostic`), so the shapes are
  the artifact's rather than this file's.
- `scripts/test_dump_capability.py` — **5 new tests** pinning the census's three differences from the reader,
  including the two shapes where the census reads `0` and the reader drops a block, and the `cases −
  short_blocks` derivation.
- Two pre-existing tests keep asserting that each shape yields **no cases** — they are the refusal, and they
  were passing while the loss was invisible, which is the point: **a drop that is tested and a drop that is
  reportable are different facts.**

## 6. Gates

| | |
| --- | --- |
| python gate | **473 tests · 1628 statements · 584 branches · 100.00%**, every module 100% |
| `dump_capability.py` | **100.00% branch** — 267 statements, 112 branches, **73** tests in its suite |
| `benchmarks` project | **821 tests / 23 files** (817 before: the report's 13 new tests less the two the reader's own suite already had) |
| `packages/kinetic` | **959 tests / 36 files** (954 before: the new typecheck-population fence) |
| `nx run-many --target=typecheck --all` | 15 projects clean — **and this is the leg that reported the three errors the change produced in `benchmarks/__tests__`** |
| `tsc -p tsconfig.workspace.json` | clean, and by design it never saw them |
| lint / format | 0 warnings, 0 errors on 340 files; the touched files formatted |
| mutations | **20 rows, every one as declared**; both controls (`py`, `ts`) SURVIVED; tree hash-verified |
| golden | **OWED** — `benchmarks/src/**` is a trigger, and the reader is offline but "offline" is a claim to measure: nine cells byte-identical is the second half of the criterion |

### The mutation pass found two of this iteration's own errors, and both were in the pass

1. **One row's guard could not see its subject**: the CLI calls `main()` at import and cannot be loaded by a
   test, so a row mutating the CLI's refusal condition could only come back `SURVIVED`. Rather than declare a
   kill the harness cannot witness, the condition was **extracted into the module** as the pure predicate
   `shouldRefuseToReport` — where a test can contradict it — and the residual row is declared `SURVIVED` with
   that reason written down.
2. **Two rows were EQUIVALENT mutations and came back `SURVIVED`** while the guards were fine: adding the flag
   name to `SWITCH_FLAGS` a second time is a no-op on a `Set`, and adding it to `VALUE_FLAGS` changes nothing
   because the parse loop checks `SWITCH_FLAGS` first and that branch wins. So a name in both sets has its
   placement decided by the **order** of the checks — worth knowing, and the row now removes the registration
   instead, which is the mutation with a consequence.
3. **A third row was a gap in the fence, not in the code**: `hasParseLoss` asserted for the count-mismatch
   shape but not for the unclosed one, so a predicate keyed on `shortBlocks` alone passed. Asserted on both
   shapes now, in both directions.

### And one defect of this iteration was in the RECORD rather than in the code

Adding a field to `AnalyzeDumpOptions` produced three errors inside `benchmarks/__tests__` that
`nx run-many --target=typecheck --all` **reported** and `tsc -p tsconfig.workspace.json` was clean on — which is
the reverse of what this repository had stated for two iterations about those two legs. It is the same law as
everything above: **a claim about a population, not connected to the config that decides it.** Both statements
are corrected (`docs/artifact-capability-audit.md`, the register's invariant), and the claim is now **derived**
by `packages/kinetic/__tests__/unit/typecheck-population.test.ts`, which reads each config with the compiler's
own `parseJsonConfigFileContent` and asserts on the **file list** — so a config change moves it, and it bites
in both directions (probed: giving the workspace leg `benchmarks/**` fails it; taking `__tests__` away from the
project leg fails it).

Two earlier versions of that fence were wrong in two instructive ways, both recorded in its own header: a
hand-rolled JSONC comment stripper **destroys the glob strings** (`src/**/*.ts` contains a star-slash
sequence), and a hand-rolled glob matcher disagrees about relative paths. Neither parsing nor matching is
written there now — `ts.parseJsonConfigFileContent` is what `tsc` itself uses.
