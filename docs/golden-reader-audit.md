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
- **The classification has one timing edge, and it errs toward noise rather than silence.** GitHub can take a
  few seconds to list a run, so a commit whose paths *do* match a trigger can meet the empty response before
  its run exists and get a `GoldenOwedError`. That is the safe direction — the remedy the message names
  (re-run) is the right one, and the alternative is the silent false "none is owed" that this document is
  about — but it is a reason to repeat a failing pass before drawing a conclusion from it.
- **The rule itself is unchanged.** `scripts/golden_run_selector.py` is not one of the four trigger entries;
  only `scripts/convert-parquet-to-json.py` is, because only it decides a published benchmark number. So the
  push carrying this fix owes **no** golden — and the repaired tool now *measures* that instead of asserting
  it. Measured on the commit that carried it (`c75c8c6`): `ci.yml` and `release.yml` were triggered and no
  benchmark run was, and the classifier named all four changed paths before saying so.
- **The engine cannot move, and that is not what needed proving.** Nothing here is on the RCAEval path; the
  gate that runs is `CI`'s `converter-tests` job, which is where the 44 tests and the branch-coverage floor
  were read. A golden on this push would prove nothing about the change, which is precisely why the rule does
  not ask for one.

## 6. The other half: a run reported as hung that was never measured (2026-09-20)

§1–§5 are about a "nothing to check" answer that was never checked. This section is the same defect one
layer out, and it cost more: a **"they never finish" answer that was never measured**, acted on with an
irreversible remedy.

The record said, of three consecutive golden runs:

> the workflow's three `ablation-*` jobs **do not finish**. On the previous golden (§12's run
> `35482507910`) they were still `in_progress` **eight hours** after starting … Since the whole-run log
> archive answers **404 until the run completes**, *a job that never finishes denies the record its own
> standard reader* … Making them land — or making the reader independent of them — is a named follow-up.

Every clause is false, and the causation is inverted.

## 6.1 The measurement

Twenty-five `benchmark-rcaeval.yml` runs, every job interval each of them produced — **222 intervals**:

| longest intervals (minutes) | job | run | conclusion |
| --- | --- | --- | --- |
| **53.0** | `ablation-re2` | `35366331873` | success |
| 52.5 | `ablation-re2` | `35357010476` | success |
| 51.0 | `ablation-re2` | `35411810992` | success |
| 50.7 | `ablation-re2` | `35497179322` | success |
| 49.9 | `ablation-re2` | `35411790522` | success |

**No interval exceeds one hour. None exceeds three.** The figure of *eight hours* is not a misreading of
one run — it is outside the range of anything this workflow has ever produced or can produce, because
every job declares `timeout-minutes: 60` and GitHub enforces it.

The three runs in question, and the four that were left alone:

| run | total | `re1` | `re2` | `re3` | conclusions |
| --- | --- | --- | --- | --- | --- |
| `35497182235` | 61.1 | 13.4 | 48.6 | 27.9 | all `success` |
| `35443324311` | 62.1 | 13.5 | 49.4 | 30.1 | all `success` |
| `35435866603` | 45.1 | 12.9 | 32.4 | 30.3 | all `success` |
| `35433489124` | 62.4 | 13.8 | 49.7 | 30.5 | all `success` |
| `35482507910` | 37.4 | 13.4 `success` | 26.0 `cancelled` | 27.5 `cancelled` | cancelled at **37.4** min |
| `35485933840` | 22.3 | 10.9 | 10.6 | 10.7 | cancelled at **22.3** min |
| `35489493441` | 13.5 | 1.1 | 1.4 | 3.4 | cancelled at **13.5** min |

**Every run that was not cancelled has all three ablations `success`.** Every cancelled run is one this
session cancelled, at 13.5 / 22.3 / 37.4 minutes, into work that needs 45–62 minutes. The jobs were never
the problem.

## 6.2 Why the record believed it

There was no instrument that could tell "still working" from "stuck", so the answer was a **feeling** —
*this is taking too long* — and the action taken on a feeling (cancel) is irreversible. Two things then
compounded it:

1. **The rows were read back as evidence of the claim.** After the cancel, the jobs read `cancelled`, and
   `cancelled` was cited as proof that the jobs do not finish. The cancellation was the *cause* of the
   observation being cited as the *effect*.
2. **The remedy manufactured the symptom.** The whole-run archive answers 404 until a run completes, so
   the cancel was applied "to make the archive land" — and then the resulting 404 on the *next* run was
   read as further evidence of the hang. Two consecutive runs, same three jobs, "no completion" was
   recorded as *a property of those jobs*, when it was a property of the operator.

The number that explains the whole episode needs no mystery: **`ablation-re2` is the long pole at 49–53
minutes against its own 60-minute bound.** A waiter with a constant of "twenty minutes" cancels it every
single time.

## 6.3 The fix: a wait licensed by the subject's own bound

`scripts/golden_run_landing.py`, under the same python gate as `golden_run_selector.py` (100% statements
and 100% branch):

| element | what it does | why it is not a constant |
| --- | --- | --- |
| `job_bounds` | reads each job's `timeout-minutes` **from the workflow that declares it**, scoped to the `jobs:` block | `on:`'s trigger keys sit at the same two-space indentation and are not jobs — eleven indented keys, nine of them jobs |
| `resolve_bound` | falls back to GitHub's own **360-minute** default and **names which owner answered** | a job the workflow does not bound is not unbounded; it is bounded at six hours, and a waiter must know which of the two it got |
| `classify_job` | judges each job against **its own** bound | `dashboard` declares ten minutes where the ablations declare sixty, so one constant calls one of the two wrong |
| `landing` | one verdict, plus the licence: the **soonest** pending boundary | the number that licenses "read again in N minutes" is a property of the subject |
| the module | **has no cancel path** — no HTTP, no subprocess, no socket | the tool cannot do the thing it warns against, checked by a test over its own source rather than left to discipline |

Replayed against run `35482507910` at the instant of the cancellation, from that run's own timestamps:

```
golden landing — run in_progress
  ablation-re1      completed    60 min (workflow)    13.4     —    COMPLETED success
  ablation-re2      in_progress  60 min (workflow)    26.0  34.0    WORKING
  ablation-re3      in_progress  60 min (workflow)    27.5  32.5    WORKING

verdict WORKING — every pending job is inside its OWN bound; the longest licensed wait is 32.5 min left.
```

**The cancel was issued with 32.5 minutes of licensed wait left.**

## 6.4 Two defects found while building it

- **The fixture vouched for a payload the API never sends.** The first version accepted a bare array for
  the jobs payload — because that is what the *tests* handed it — and refused every real invocation with
  `expected a JSON list of jobs`. Running it once on a real response is what found it. The runs endpoint
  returns the run object and the jobs endpoint returns an **envelope** around the array; the tool now
  reads what the API sends and refuses anything else, and the fixture was corrected rather than the tool.
- **A fence no test could fail.** The block's "a line at the mapping's own indentation ends the scan"
  guard was written WITH a test, and the mutation that removes the guard **survived**: the fixture put
  only a top-level key after the block, so a two-space bound under it matched nothing either way. The
  fixture now carries a key that *would* be picked up as a job, and the guard is killed. **A guard whose
  test cannot fail is not a guard** — the same lesson as §2, arrived at by mutation rather than by reading.

## 6.5 What did not change

- **No cell, window, cap or floor moves.** The change is a reader of run *liveness* under `scripts/`,
  which is not a golden trigger; the nine cells are produced by the workflow and are untouched.
- **No golden is owed, and that is measured rather than assumed.** `golden_run_selector.benchmark_run_owed`
  over this change set returns `(False, ())`, and the same predicate returns `(True, ('packages/*/src/**',))`
  for a path that does match — so the trigger list is read, not bypassed.
- **The archive still needs the run to finish.** Nothing here makes the reader independent of that, and
  nothing should: the corrected rule is to wait for the run's own bound rather than pre-empt it, and the
  four uncancelled runs show the wait is 45–62 minutes, once.
