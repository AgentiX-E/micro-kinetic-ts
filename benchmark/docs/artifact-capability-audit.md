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

**And a channel is two quantities, not one: RENDERED and VALUED.** The producer has two ways of writing
"rendered and undetermined" — `-` (`onset=-`, `latRise=-`, and now `metricDecisive: -`) and an EMPTY value
(`dominant= err=0`) — and folding them into one number made `onset every` read as "every row carries an
onset" while **12.5%** of the FSE'26 artifact prints `onset=-`. The census reports both, and prints the second
only when it differs:

| artifact | `onset` | `dominant-metric` |
| --- | --- | --- |
| `re1.txt` | `every`, valued **4299/11557** | `every`, valued **9991/11557** |
| `re3.txt` | `every`, valued **1635/2900** | `every`, valued **2631/2900** |
| `dump-35035314921.txt` | `every`, valued **63489/72527** | `every`, valued **71161/72527** |
| `artifacts/r35107871516/fse26-results.txt` | `every`, valued **63489/72527** | `every`, valued **71161/72527** |

The `63489/72527` is **87.5%**, which is the number `fse26-onset-verdict.md` had recorded independently — a
cross-check of the census by a document written before it.

## The measured matrix

| artifact | cases | rows | declared precision | decisive composition |
| --- | --- | --- | --- | --- |
| `rcaeval-dumps/re1.txt` (run `35318624817`) | 375 | 11557 | `every` | **`some` (9991/11557)** |
| `rcaeval-dumps/re2.txt` | 150 | 4806 | `every` | **`some` (4219/4806)** |
| `rcaeval-dumps/re3.txt` | 90 | 2900 | `every` | **`some` (2631/2900)** |
| `dump-35035314921.txt` (FSE'26, shipped config) | 1422 | 72527 | **`none`** | **`none`** |
| `artifacts/r35107871516/fse26-results.txt` | 1422 | 72527 | **`none`** | **`some` (71161/72527)** |

`onset`, `latEdges`, `failedEdge` and `dominant` reach `every` on all five; `both=` (the union primitive)
reaches `every` on the three RCAEval artifacts and `none` on both FSE'26 ones.

The two FSE'26 runs are the pair the record needs: the same 1422 cases, one carrying the decisive composition
on **71161** rows and one carrying none. That is also the cross-check behind the composition's own value
reach — `71161` is the number of rows naming a dominant metric on the run that does NOT render the
composition, and the number of compositions the other run DOES render, which is the same set measured from
two sides.

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

## Finding 5 — the composition's absence was unattributable, and the producer now says so

`formatDecisiveComposition` rendered the line only where the service's NAMED metric turned out to be a `kept`
outcome carrying a decomposition, and **omitted it otherwise**. On `re1.txt` that left **1566 rows** with no
line — and those rows are exactly the ones whose inventory is not rendered either, because the inventory is
printed only for the ground truth and the engine's predictions. So for 1566 rows a reader could not tell
*"this service's dominant metric was not decomposed"* from *"this dump predates the line"*, which is the same
silence for two different facts — precisely the distinction the INERT/UNEVALUABLE work exists to keep.

The line is now **rendered for every row**, carrying `-` where there is no composition, the marker `onset`,
`latRise` and `dominant` already use. The CHANNEL becomes universal and the VALUE is what it reports, which
is why the census needed the rendered/valued split in the same iteration: the two changes are one statement.
Measured after: `decisive-composition` reaches **every** row of a fresh dump, and the composition itself
reaches **98.13%** of them (`71161/72527`) — the remainder are rows that name no dominant metric at all, and
now say so.

## Finding 6 — the census measured the TRANSPORT on a fetched artifact

Pointing the census at `artifacts/r35107871516/fse26-results.txt` — the other FSE'26 run, fetched through the
log transport, so every line carries a BOM and an ISO timestamp — returned **`0 cases, 0 rows`** with every
channel `none`, for a file holding **1422 cases and 71161 compositions**. Every anchor in the grammar is `^`,
so the prefix hid the whole artifact, and the answer was a reading about the fetch reported as a property of
the artifact. This is the third time this repository has paid for that: a probe once recorded
`metricDecisive lines: 0` for the same file by counting lines that *start* with the literal.

The prefix is stripped now (BOM, then an ISO timestamp and **exactly one** space — the producer's own
indentation follows it, and consuming the run of spaces turns a two-space service row into one that starts a
row nowhere). After: the same file reads `1422 cases, 72527 rows; … decisive-composition some
(71161/72527 rows)`.

## What a candidate must now say

1. **Which channels it reads**, and the **reach** it needs of each — `every` if it sums or simulates over
   every candidate, `some` if it only asks whether the artifact has the channel.
2. **Whether it needs the channel or the VALUE**, because a channel can reach every row and carry nothing on
   a third of them (`onset`).
3. **Which artifact** it reads them from, by run, with that artifact's coverage — because the two FSE'26
   artifacts differ in exactly the channel the composition family depends on.
4. If the reach it needs is not `every`, the **producer change** that would make it so, stated before the
   measurement rather than after.

## Gates

`benchmarks` **724** at 99.81 / **97.40** / 100 / 99.81 · `kinetic` **926** at 100 / 99.44 / 100 / 100 · both
typechecks · lint 0/0 · format clean · register guard 14/14 · the census module at **100.00% branch coverage**
(174 statements, 74 branches, 30 tests).

**One gate is red for an environment reason, recorded rather than worked around.** The python gate's
`test_golden_run_selector.py` reads `.github/workflows/benchmark-rcaeval.yml` at import time, and this sandbox's
file broker answers that sensitive path with `PermissionError: Sensitive content approval timed out`. The same
gate ran 290 tests green earlier in the same session, the failure is inside the module's own `read_text`, and
no file this iteration touched is involved — so **CI is the authority for the python gate here**, and the local
run is not evidence either way. It is written down because a gate that is quietly skipped is the defect this
whole document is about.

**And its golden passed.** `aa702ba` touches `packages/kinetic/src/**` and `benchmarks/src/**` (a rendered
line), so the paths rule owed one, and run **`35357010476`** reproduces **9 of 9 cells byte-identical**
(`RE1 80.0 / 92.8 / 68.0`, `RE2 82.4 / 88.9 / 68.1`, `RE3 80.0 / 45.0 / 51.1`), with `CI` (run `35357010442`)
and `Release` (run `35357010444`) green on the same commit. A cell could only move if the rendered marker had
altered a verdict, and no ranking term reads it.
