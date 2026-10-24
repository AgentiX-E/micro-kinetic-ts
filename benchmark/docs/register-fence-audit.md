# The register's fence was keyed on a FILENAME — nine closures were invisible to it

`docs/closed-axes-register.md` opens with an instruction: *read this before proposing an experiment.* Its
guards are structural and they were green. And nine documents that close an axis were invisible to them.

## The measurement

| what | count |
| --- | --- |
| `docs/*.md` | 50 |
| named by the register (before this iteration) | 27 |
| **documents whose H1 declares a closure** (`falsified` / `ceiling`) | **10** |
| **of those, invisible to the register's row rule** | **9** |

The nine, with the axis each one closed:

| document | axis it closed |
| --- | --- |
| `re3-fault-ceiling.md` | `ratioContrib` / `collisionWeight`, `topoSource`, trace-activity, drop-symmetrisation |
| `silent-source-ceiling.md` | the same signal's *under-power* bound and the `temporalWeight` reverse |
| `reverse-propagation-falsified.md` | Direction 2 — the callee→caller mirror `topoSource` |
| `near-zero-rise-suppression-falsified.md` | `suppressNearZeroBaselineRise` (a measured no-op) |
| `rank-collapse-falsified.md` | the `log(1.0) = 0` collapse, and the `log1p` correctness fix |
| `re3-log-ceiling.md` | the LLM code-level exception classifier (Direction B) |
| `re1-re2-ceiling.md` | the RE1/RE2 residual as a separate frontier |
| `fse26-emitter-dominance-falsified.md` | `logicHttpDominant` as an emitter-dominance signal |
| `fse26-logicHttpJoint-falsified.md` | the relative callee-anomaly gate (`logicHttpJoint`) |

## Why the fence missed them

`verdictDocs()` — the function both row rules are built on — is `readdirSync(DOCS).filter((name) =>
name.endsWith('-verdict.md'))`. **Discovery was a naming convention.** Every guard was then correct about the
set it had, and the set was the wrong set: a document that closes an axis without the suffix is not a verdict
as far as the fence is concerned, and nothing else in the file looked for one.

The register knew this shape of failure — it has a row for the *previous* version of it, where
`fse26-httpnet-miss-verdict.md` closed five families and carried no row, and the fix was "every verdict must
be a ROW, not a passing mention". That fix tightened the remedy while leaving discovery unchanged, so the
same class of defect survived one level down, in the part of the guard that decides what to look at.

## The failure it caused, measured in this repo

The iteration that found this began by reading the register, as its instructions require, and proposed
**`ratioContrib` as the missing signal** — on the strength of the engine's own type comment (*"a source has
`ratioContrib ≈ 0`, a fan-in symptom ≈ 1"*), the fact that the value is computed per service, and the census's
finding that three channels the screens read are absent from the dump. The register contains **no occurrence
of the word `collision` at all**. The axis had been measured and closed, and the closure was sitting in two
documents the register never named.

That is the register's founding failure mode — "an axis that has been measured and closed is re-derived and
proposed again" — reached through the fence rather than through the register's content.

## The fix

**1. Discovery reads the DOCUMENT, not the name.** The predicate is a pure function of a document's first H1:
a heading that says `falsified` or `ceiling` is a declaration that a direction is closed. A rename cannot
hide a claim, and the claim is checked where it is made.

```ts
function declaresClosure(heading: string): boolean {
  return /falsified|ceiling/i.test(heading);
}
```

**2. A declaration owes a ROW.** Not a mention: the register's own row on the previous defect says a mention
in prose is not what a reader scans for an axis. So `re3-fault-ceiling.md`, `silent-source-ceiling.md`,
`reverse-propagation-falsified.md`, `near-zero-rise-suppression-falsified.md`, `rank-collapse-falsified.md`,
`re3-log-ceiling.md` and `re1-re2-ceiling.md` now own rows, and the two FSE'26 records are named in the row
that already carries their numbers.

**3. A NAME may not claim more than the document does.** The inverse loophole is closed with it: a file whose
name says `falsified` while its heading claims nothing fails the guard, so the fence cannot decay back into a
naming convention from the other side. Measured today: **0** documents are in that state.

**4. Nothing in `docs/` is unreachable.** Every document is now named by the register — the thirteen records
and probes that are not axes (the type-check audits, the SOTA calibration, the PRISM head-to-head, the
converter-integrity verdict…) live in a section of their own, so a record cannot be invisible even when its
subject is not an axis.

**5. And the extractor that reads names was wrong.** `referencedDocs()` matched `[a-z0-9-]+\.md`, so a
camelCase name matched from its first lowercase run: `logicHttpJoint-falsified.md` was read as
`oint-falsified.md` and reported as a dangling reference the moment a row named it. The pattern now anchors at
the first letter and stops at the extension, and a test pins both directions. That false positive had never
fired because **no row had ever named a camelCase document** — which is the same statement as "the nine
documents were not named".

## Gates

Register guard **14 of 14** (was 7), and the new fence was verified to FAIL on the pre-fix register — it named
all nine offenders — before the rows were added. Seven mutations, **all killed on the first pass**, including
the three that only a vacuity check catches: the closure predicate returning `false`, the closure rule reading
the document NAME (the defect it replaced), and either population coming back empty. `kinetic` **926** at
100 / 99.44 / 100 / 100 · `benchmarks` **721** at 99.81 / 97.23 / 100 / 99.81 · both typechecks · lint 0/0 on
333 files · format clean.

This iteration touches `docs/` and `__tests__/` only, so **no benchmark run is owed** — and the golden is not
merely un-run: the paths rule does not trigger it, which is why a fence repair costs an hour less than a
signal does.
