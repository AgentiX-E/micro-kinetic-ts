# What an artifact carries — three iterations of one defect, generalised

Three consecutive iterations found the same shape of defect by hand, each time in a different place, and each
time the repair was about one field:

| where it was found | the claim | the artifact's answer |
| --- | --- | --- |
| `ARTIFACT_PRECISION_AUDIT.md` | the reader modelled a cell's width on a precision it never asked for | the dump states `decimals=N`; before that it stated nothing, and the constant it fell back to was a copy of `3` |
| `DUMP_PROVENANCE_AUDIT.md` | a comparison of two renders | one side was an exact **TrainTicket-only subset**, so every number read from it was about one system reported as three |
| `SCREEN_INERT_AUDIT.md` | the FSE'26 stability rows, cited by run | the run the record named holds **no** decisive composition; the rows belong to a different run's report |

Repairing them one at a time left the question one level up unanswered — *what does this artifact carry at
all?* — and it is the question every screen, screen-menu and verdict in this repo silently depends on. So it
is now an instrument, and it is the first thing a candidate has to read.

## The instrument

`scripts/dump_capability.py`, in the same CI python gate as `dump_coverage.py` (100% branch, 132 statements,
56 branches, 26 tests, 8 mutations all killed on the first pass).

A channel's reach has **three** values, not two, and that is the whole point:

- `every` — rendered on every row (or every case, for a header field);
- `some` — rendered, but not everywhere: **this is the value that keeps being read as `every`**;
- `none` — the artifact never renders it, which is a fact about the PRODUCER, not "the value is zero".

`some` always prints both of its numbers (`some (9991/11557 rows)`), because "some" without a denominator is
the reading the module exists to stop. `require_channel` refuses a read before any number is attributed to
it, and the refusal names the artifact, the channel, the measured coverage, the population the number is over
and the code that has to change.

## The measured matrix

| artifact | cases | rows | declared precision | decisive composition |
| --- | --- | --- | --- | --- |
| `rcaeval-dumps/re1.txt` (run `35318624817`) | 375 | 11557 | `every` | **`some` (9991/11557)** |
| `rcaeval-dumps/re2.txt` | 150 | 4806 | `every` | **`some` (4219/4806)** |
| `rcaeval-dumps/re3.txt` | 90 | 2900 | `every` | **`some` (2631/2900)** |
| `dump-35035314921.txt` (FSE'26, shipped config) | 1422 | 72527 | **`none`** | **`none`** |

`onset`, `latEdges`, `failedEdge` and `dominant` reach `every` on all four; `both=` (the union primitive)
reaches `every` on the three RCAEval artifacts and `none` on the FSE'26 one.

## Finding 1 — the artifact the record's FSE'26 rows are read from answers neither question

The FSE'26 dump's header carries no `decimals=`, and 141 MB of it contains **zero** `metricDecisive` lines.
So on that artifact the precision is a reader's inference (which `describe` already distinguishes: *states
N* vs *does not state its precision*) and the decisive composition is simply **UNEVALUABLE** — not zero, and
not "no evidence". Any FSE'26 statement about a composition, or about the union the log term divides by, has
to name an artifact that carries it, exactly as the stability rows had to.

## Finding 2 — "it exists for EVERY service" was the wrong half of its own comment

`DiagnosedService.decisiveOutcome`'s comment opened with *"it exists for EVERY service"* and closed, two
sentences later, with *"a service whose named metric the block did not decompose"* — i.e. it admitted in the
same breath that the line is printed selectively. Measured: **86.45%** of `re1`'s rows, **90.72%** of
`re3`'s, **0.00%** of the FSE'26 artifact's. The reason the field is separate from the inventory is that *"a
term built on the decisive composition has to be SIMULATED over every candidate a case could promote"* — and
that requirement is not met by the line it names. The comment is corrected in place and names the guard that
measures it; the consequence is that a composition-based candidate needs a **producer change** before it can
be simulated, which is a precondition rather than an optimisation.

## Finding 3 — the census had the defect it exists to catch, and the artifact's own header caught it

The first row grammar required a non-empty service id and so dropped the **unlabelled series** the engine
ranks (one row per case: `   [#4] selfAnomaly=…` and `   selfAnomaly=…`), 1422 rows on the FSE'26 artifact.
That error can only run one way — an uncounted row can never make a channel look *less* universal — so every
`every` it produced was optimistic. The engine's own parser was repaired for the same reason (`SERVICE_RE`
required a non-empty id, and its parsed count disagreed with the header's `services=` in 1421 of 1422 cases,
unchecked).

The census now counts those rows and, more importantly, **checks itself against the artifact's declaration**:
a block that renders fewer rows than the `services=` it declares is counted and named in `describe`, because
a coverage verdict computed over a short block is an artifact of the READER. On all four artifacts the count
is **0**, and the FSE'26 total (**72527**) is the number the engine's parser reaches on the same file — two
readers agreeing on the population is what makes the cross-check worth printing.

## Finding 4 — the guard's suite was red on the machine that holds the evidence

`scripts/test_dump_coverage.py` pinned the DEFECT: `RealArtifactsTest` asserted that `rcaeval-dumps/re3.txt`
holds **30 cases** and states **no precision**, which was true of the TrainTicket-only copy and false of the
archive the previous iteration had just replaced with the workflow's own artifacts (90 cases, three systems,
`decimals=3`). It failed here and **passed in CI**, because the `skipTest` guard skips when the archive is
absent — and the archive is absent from every CI checkout. A green CI was therefore evidence about a machine
that does not have the artifact, while the machine that does had a failing gate.

The claim is now the **shape** (`a suite is three systems at equal share`, so a single-system artifact under
a suite's name is a subset however many cases it holds) and the subset it refuses is **rebuilt from the
current artifact** rather than recalled. Fixing the archive can no longer make the test vacuous, and it can
no longer pass by being skipped where the evidence lives.

## What a candidate must now say

1. **Which channels it reads**, and the **reach** it needs of each — `every` if it sums or simulates over
   every candidate, `some` if it only asks whether the artifact has the channel.
2. **Which artifact** it reads them from, by run, with that artifact's coverage — because the two FSE'26
   artifacts differ in exactly the channel the composition family depends on.
3. If the reach it needs is not `every`, the **producer change** that would make it so, stated before the
   measurement rather than after.

## Gates

`benchmarks` 721 at 99.81 / 97.23 / 100 / 99.81 · `kinetic` 919 at 100 / 99.44 / 100 / 100 · both typechecks ·
lint 0/0 · format clean · register guard 7/7 · python gate 290 tests with **100.00% branch coverage on all
eight scripts** (1016 statements, 380 branches), the new module included.

**And its golden passed.** `9943b6c` touches `benchmarks/src/**` (the corrected comment), so the paths rule
owed one, and run **`35336041761`** reproduces **9 of 9 cells byte-identical** (`RE1 80.0 / 92.8 / 68.0`,
`RE2 82.4 / 88.9 / 68.1`, `RE3 80.0 / 45.0 / 51.1`), with `CI` (run `35336041695`) and `Release` (run
`35336041714`) green on the same commit. A cell could only move if the comment had altered a verdict; the
change is text, and the same seven-channel census prints either way.
