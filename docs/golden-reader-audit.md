# Golden-reader audit — a "nothing to check" answer that was never checked

The kill criterion's second half is *RCAEval golden 9-cell byte-identical*, and that is a claim about
a **run**. The tool that finds the run is `.bench-cache/poll_sha.py`, which asks GitHub which workflow
runs belong to a commit. On 2026-09-18 it answered **"no golden is owed"** about commit `d2625d0` — a
commit whose own push had started a benchmark run half an hour earlier.

Nothing in the recorded golden table is affected (see §5). What was affected is every golden that had
not been read yet, which is the only kind that matters.

## 1. The measurement

One commit, two queries, differing only in how the revision was written:

| query | `total_count` | runs returned |
| --- | --- | --- |
| `…/actions/runs?head_sha=d2625d0` | **0** | none |
| `…/actions/runs?head_sha=d2625d05d33576f8d2575858c3d04ed3c6d309ca` | **3** | `ci.yml`, `release.yml`, `benchmark-rcaeval.yml` |

GitHub's `head_sha` filter matches the **full forty-character SHA**. An abbreviation is not an error to
the API and not an error to `git` — it answers an empty list, which is byte-identical to the answer for a
commit that genuinely has no runs. The tool's argument is a *revision*, and a short one is the normal
case: every golden poll of this session passed one.

## 2. Two faults, and the sentence that hid both

Fix either one alone and the defect disappears; both had to be present for it to be silent.

1. **A revision was never resolved.** The string the caller typed went straight into the URL. A
   `git rev-parse` in between is the whole remedy — and it is also what *rejects* a revision that does
   not exist, so it cannot be skipped for input that already looks like a full SHA.
2. **A zero-run answer was explained by a sentence.** On an empty response the tool printed:

   > `no benchmark run: this push does not touch a path that can move the engine, so no golden is owed`

   That is `benchmark-rcaeval.yml`'s own `push.paths` rule, restated in prose and applied to a commit it
   had never been evaluated against. "The query was wrong" and "no run is owed" produced the identical
   line, so the wrong one could not be told from the right one — the same shape as a search that cannot
   fail, and the same shape as the register's warning that a copy needs a guard.

The second fault is the one worth generalising: **the tool's silence was more confident than its
knowledge.** A reader who saw that line had been told a fact about the workflow's trigger list by a
program that had read neither the trigger list nor the commit's change set.

## 3. The fix: one owner, in the repository

The rule now lives in `scripts/golden_run_selector.py`, because `.bench-cache/` is untracked and nothing
in it can be covered, while `scripts/` is under the repo's own python gate (`converter-tests`: unittest
with **branch coverage, `--fail-under=95`**).

| function | what it owns |
| --- | --- |
| `resolve_commit` | any revision → the full SHA, loudly, via `git rev-parse --verify <rev>^{commit}` |
| `changed_files` | the commit's own change set (`git show`), or a range when a base is named |
| `trigger_paths` | the workflow's `on.push.paths`, read from the workflow and scoped to the `push:` block |
| `path_matches` | the implemented subset of GitHub's glob syntax, and a REFUSAL outside it |
| `benchmark_run_owed` | the question itself, returning the entries that matched |
| `runs_path` | the URL, and the full-SHA requirement at the only place a URL is built |
| `explain_absent_run` | the sentence — reachable only after a measurement, and RAISING when the push matches |

Three properties are worth naming, because each was a choice against the easier thing:

- **A push that matches a trigger cannot be told "none is owed".** `explain_absent_run` raises
  `GoldenOwedError` naming the matched entry. The innocent sentence is reachable only for a change set
  measured against the workflow's own filter and matching none of it.
- **`trigger_paths` reads the workflow** rather than restating the list. Its companion is
  `benchmarks/__tests__/benchmark-rcaeval-trigger.test.ts`, which asks a different question about the
  same list — whether an entry is *present*. Presence and matching are different claims, and neither
  substitutes for the other.
- **A pattern outside the implemented subset raises.** `?`, `!`, a character class, an escape, a
  segment-internal `**`, a doubled separator — all refused rather than read as literal text. A filter
  read as something it is not is a golden that silently is not run.

## 4. What the tests prove

`scripts/test_golden_run_selector.py`: **44 tests**, and the module is at **100% branch coverage**
(111 statements, 52 branches) inside the CI's own command, which is unchanged:

```
coverage run --branch --source=. --omit='test_*,convert-parquet-to-json.py,…' -m unittest discover -s . -p 'test_*.py'
coverage report --fail-under=95 --precision=2
TOTAL   832 stmts   0 miss   314 branch   0 partial   100.00%
```

Six mutations, each one a way this file could have been written and still passed:

| mutation | result |
| --- | --- |
| drop the full-SHA guard in `runs_path` | **bites** (1 failure) |
| let a matching push be explained away | **bites** (1) |
| read an unsupported pattern construct as a literal | **bites** (4) |
| scan the whole document for `paths:` instead of the `push:` block | **bites** (1) |
| keep the first run per file instead of the most recent | **bites** (1) |
| ignore `changed_files`' `base` argument | **bites** (1) |

The fourth mutation **survived the first pass**, which is the reason the table is here rather than a
sentence saying "mutations were run": the scoping test's decoy entries were never reached, because the
entry loop carries its own indentation guard. The test that kills it is the one where `push:` has *no*
`paths:` and a decoy `paths:` sits further down the file — the case where a whole-document scan answers
with a different block's filter, confidently.

Two tests are worth pointing out for what they avoid:

- the real-`git` test compares `HEAD` with `HEAD`, not with `HEAD~1`: CI checks out at
  `fetch-depth: 1`, so a parent commit does not exist there and the test would pass locally and fail in
  the gate;
- one test asserts the poller *does not* re-implement any of this — no hand-built `head_sha` query, no
  restated paths rule. Two owners is how the sentence survived four passes of instrument repair.

## 5. What this does NOT prove

- **No recorded cell is affected, and that is a fact about provenance rather than luck.** Every golden
  row in `fse26-cv-screen.md` was read by **run id** (`35223783105`, `35242705643`,
  `35208713413`, …) through `verify_cells.py`, which takes the id directly and never consults
  `head_sha`. The exposure was entirely forward-looking, and the false answer never reached a document.
- **The paths rule itself is unchanged.** `scripts/golden_run_selector.py` is not one of the four
  trigger entries; only `scripts/convert-parquet-to-json.py` is, because only it decides a published
  benchmark number. So the push carrying this fix owes **no** golden — and the repaired tool now
  *measures* that instead of asserting it. That is the difference this document is about.
- **The engine cannot move, and that is not what needed proving.** Nothing here is on the RCAEval path;
  the gate that runs is `CI`'s `converter-tests` job. A golden on this push would prove nothing about
  the change, which is precisely why the rule does not ask for one.
