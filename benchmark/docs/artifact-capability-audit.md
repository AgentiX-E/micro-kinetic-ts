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

`scripts/dump_capability.py`, in the same CI python gate as `dump_coverage.py` (**100.00% branch**, 256
statements, 110 branches, 61 tests).

Its population is **thirty-one** channels — every field the producer renders, declared once in `DECLARATIONS`
with the producer's own key literal, with each marker DERIVED from that literal. `keyof DiagnosedService` is
covered exactly: the TypeScript fence asserts the declared fields equal `SERVICE_FIELD_AUDIT`'s keys in both
directions, and the artifact's emitted keys equal the declared key column in both directions. Finding 7 is why:
the list used to be seven names written by hand, paired with seven regexes written by hand, and neither half
was connected to the dump.

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
(`dominant= err=0`, and `metricKept(0):` with nothing after the colon) — and folding them into one number made
`onset every` read as "every row carries an onset" while **12.5%** of the FSE'26 artifact prints `onset=-`. The
census reports both, and prints the second whenever the two **counts** differ (Finding 7: keying it on the
verdicts hid a one-row difference where both read `some`).

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

## Finding 7 — the census's own POPULATION was the defect it exists to catch

`docs/artifact-capability-audit.md`'s instrument claims to report **every channel**. It reported **seven**,
from a hand-written list, and nothing connected either the list or its hand-written regexes to the artifact.
The artifact renders **thirty-one** fields, and they are declared exhaustively and *type-enforced* one module
away — `SERVICE_FIELD_AUDIT` is a `Record<keyof DiagnosedService, string>`, so a new parsed field breaks the
build until it is classified there — while the signals that read them carry a `reads:` list naming the field of
each. Three declarations over one subject, and no edge between any two of them.

The list was wrong in the two directions that matter, and both were measured:

**Both two-part families were covered in the half the OTHER one covers.**

| family | the channel that existed | key it read | the quantity left with no channel | who reads that quantity |
| --- | --- | --- | --- | --- |
| failed edge | `failed-edge` | `failedEdge=` — the **SCORE** | `failedEdgeRecords=` — the **COUNT** | `edgeRecords`, the one signal `fse26-separator-verdict.md` reports as HOLDING (**AUC 0.908**, 60–2, stable in all five folds) where the score reads 0.457 |
| latency | `latency-edges` | `latEdges=` — the **COUNT** | `latRise=` — the **VALUE** | `lat`, the engine's own term |

So a candidate reading either half of either family had to name the **other half's** channel, and the reach it
was told was that half's. The reach is not a formality: on the shipped FSE'26 artifact `latEdges` is valued on
**100%** of rows while `latRise` is valued on **37714 of 72527 — 52.0%**. The two halves of that pair differ by
half the artifact, and the register's own sentence — per-edge counts *"do not separate source from victim at
any weight"* — is true of the score and **false of the count**, which is the distance the missing channel hid.

**And six quantities the record's declared signals read had no channel at all** — so the gate "name the
channels you read and the reach you need of each" could not be satisfied by the candidates the record says are
live: `failedEdgeRecords`, `latRise`, `metricKept` (`kept`), `metrics`, `err`/`fatal` (`errLines`),
`logic`/`http` (`sigLines`).

### The fix is a table whose key column IS the producer's literal

`DECLARATIONS` declares every field once, with the producer's own key literal, and each marker is **DERIVED**
from that literal — so the name and the matcher cannot drift apart again, which is exactly how `latEdges` came
to be the pattern for a `latRise` read. Two fences hold the population, and they close a **two-edge chain**
because neither alone would have found the defect (the table was self-consistent — eight tests passed on it —
and the producer was correct; the missing edge was between them):

1. `scripts/test_dump_capability.py` holds `scripts/dump_capability.channels.json` equal to the table, by
   bytes and as data, and holds the regeneration command's output equal to the file.
2. `benchmarks/__tests__/fse26-capability-census.test.ts` builds a dump with the PRODUCER and holds three
   things equal in both directions: the artifact's emitted keys to the table's `key` column, per scope; the
   table's `fields` column to `Object.keys(SERVICE_FIELD_AUDIT)` — the typed map; and every `reads` name across
   `SEPARATOR_SCALARS` to a declared field.

The file is read rather than the python parsed: a fence that depends on another language's formatting can be
disarmed by reindenting the thing it guards. The TS half was validated by three mutations that each failed the
intended assertion — a channel deleted from the projection (5 of 7 assertions red), an undeclared key added to
the producer (the per-scope equality, naming `extraCensusProbe`), and a signal given an undeclared `reads`
field (the signal-coverage assertion, naming the field).

### What the complete population reads, on the shipped artifact

`artifacts/r35107871516/fse26-results.txt`, **1422 cases / 72527 rows** (``*` marks the channels this iteration
added). The verdicts that were already reported are **unchanged** — verified by running the previous module and
this one over all **15** local artifacts and diffing all seven pre-existing channels: **identical**.

| scope | channel | reach | valued |
| --- | --- | --- | --- |
| identity | `*` `service-id` | **`some` (71105/72527)** | — |
| identity | `*` `row-labels` | **`some` (7781/72527)** | — |
| header | `*` `datapack`, `*` `fault-type`, `*` `ground-truth`, `*` `services-declared`, `*` `log-mode`, `*` `inject-time` | `every` (1422/1422) | — |
| header | `declared-precision` | **`none`** | — |
| case | `*` `failed-edge-graph`, `*` `prediction` | `every` (1422/1422) | — |
| row | `*` `self-anomaly`, `*` `log-score`, `failed-edge`, `*` `failed-edge-records`, `latency-edges`, `*` `error-count`, `*` `fatal-count`, `*` `logic-count`, `*` `http-count`, `signature-overlap`, `*` `metric-list` | `every` (72527/72527) | — |
| row | `latency-rise` | `every` | **`some` 37714/72527** |
| row | `dominant-metric` | `every` | **`some` 71161/72527** |
| row | `onset` | `every` | **`some` 63489/72527** |
| sub | `decisive-composition` | `some` (71161/72527) | `some` |
| sub | `*` `error-messages` | **`some` (9313/72527)** | — |
| sub | `*` `exceptions` | **`some` (3945/72527)** | — |
| sub | `*` `metric-kept`, `*` `metric-drop`, `*` `metric-top` | **`some` (7781/72527)** | `metric-kept`/`metric-drop` **7781**, `metric-top` **7781**; the `re1` row below is where they separate |

Two of the new rows are findings on their own, and both are about what the record has been calling one thing:

- **`error-messages` and `exceptions` are rendered and parsed by NOBODY.** 9313 of 72527 rows carry an `ERR:`
  message and 3945 carry an `exc(…)` class list; no reader in the tree parses either, and `metric-list` (the
  metric-name list, `every` row) is not parsed either. `SEPARATOR_SCALARS`'s own docstring says a field nobody
  screens is a measurement nobody ran: there are **three** of them, and they now have names.
- **`service-id` is `some`, at 98.0%** — 1422 rows carry no id at all, which is exactly one per case: the
  unlabelled `k8s.*` series the engine ranks. The register records that dropping those rows from the engine
  measures 750 → 749 and that `n` is the divisor of every metric term; the row count and the case count are
  now the same number, and a test asserts that equality on the artifact rather than quoting it.

### The four inventory signals read TWO lines, and the lines are not written under the same condition

The `kept`/`transientDrops` pair reads the competition line; `bestDev`/`bestRise` reads the `metricTop`
**decomposition**. Both are "the inventory" in every document in this repository, and the census now reports
them separately:

| artifact | rows | `metric-kept` | `metric-drop` | `metric-top` |
| --- | --- | --- | --- | --- |
| `re1.txt` | 11557 | **1888** (valued **1888**) | 1888 | **1887** |
| `re2.txt` | 4806 | 763 | 763 | **762** |
| `re3.txt` | 2900 | 472 | 472 | 472 |
| `artifacts/r35107871516` (FSE'26) | 72527 | 7781 | 7781 | 7781 |
| `artifacts/diag-34684319273` | 18820 | 2095 | 2095 | **`none`** |
| `artifacts/diag-34678188226` | 41721 | **`none`** | `none` | `none` |

Three distinct producers are on record and the reach moves across all three: the oldest renders **no**
inventory; the next renders the competition and **no** decomposition; the newest renders both. So a `kept`
reach and a `bestRise` reach are **different claims about the same artifact**, and on `diag-34684319273` one is
measurable while the other is UNEVALUABLE.

The one-row gap on `re1` is attributed rather than asserted: **`re1ob_adservice_loss_4`'s `adservice [GT]`**
renders

```
  adservice [GT] selfAnomaly=0.000 logScore=0.000 … dominant= err=0 fatal=0 …
    metrics(5): cpu,latency-50,latency-90,mem,workload
    metricKept(0):
    metricDrop(5): cpu:transient-return latency-50:transient-return latency-90:transient-return …
```

— the case's own ground truth, whose every metric was dropped as a **transient return**, so the kept line is
rendered with an **empty body** and the decomposition is omitted. A candidate on `bestDev`/`bestRise` cannot
be evaluated on that row; a candidate on `kept` reads a well-defined **zero** there — and the `1888` in the
`metric-kept` column above is exactly that claim: the row **reaches** the channel and the channel **carries a
value** on it, because the value is the `0` in the parentheses and not the body beside it (Finding 8). Since
the label tag reaches the same 1888 rows, the gap is a property of the `metricTop` line rather than of the
selection.

**And the reach difference is not a curiosity — it named a live defect the next iteration found and fixed.**
The row above is one of **2095** on an artifact the record also holds (`artifacts/diag-34684319273`: 2095
inventories, **zero** decompositions, 2094 of them labelled and keeping ≥1 metric), and the reader that turns
this line into a signal reported **zero** for `bestDev` and `bestRise` on every one of them — 319 pairs decided
as ties at 0.500, with the `n/a` column at zero. `docs/fse26-separator-verdict.md` §2 records it as the third
defect the separator's own instrument caught, with the before/after on six artifacts. **This section is what
made it findable**: the census is the only place in the tree that answers "how many rows carry an inventory
without a decomposition", and before this iteration both lines had no channel at all.

### And one reading was hidden by the report itself

`latency-rise` reaches **every** row and carries a value on **37714 of 72527**; `onset` reaches every row and
carries one on **63489**. Both verdicts read `every`, and `describe` printed the value count only when the two
**verdicts** differed — so the report showed `latency-rise every` and said nothing about the half of the
artifact on which a candidate reading a rise or a delay cannot be evaluated at all. The rule is now the two
**counts**, which is the module's own doctrine one level up: *"some" without a denominator is the reading this
module exists to stop.* A channel whose counts agree still prints one number, so the ones that differ are not
buried.

### One defect in this iteration's own work, found by a pre-existing test

Fixing the two identity channels, the first version of `reach` made their verdict a statement about the CASE
count for a ROW channel — and they read **`none`** while **71105 of 72527 rows** carried them. That is the
same class as everything above, one level down: a count standing in for a population. It was caught by
`test_a_sub_line_that_names_no_row_still_reaches_its_CASE_and_no_row`, a test written three iterations earlier
for the opposite question — `reach`'s first clause is deliberate (*"a block may print one outside any row"*),
and the defect was in the **scanner**, which did not credit the case for the identity markers the way it does
for every other row marker. Repaired there; the property keeps its documented semantics with **two** clauses
pinned by hand-built coverage objects, including `total_rows == 0` → `none`, because `0 == 0` satisfies
`reached == total` and an artifact with no rows would otherwise answer `every` about nothing.

## Finding 8 — a count channel read its value from the list beside it, so a rendered ZERO was reported as a gap

**Measured 2026-09-26, and it is the only defect in this document that was found by comparing the census
against a SECOND parser rather than against the producer.**

`metric-kept` and `metric-drop` declared their value as the text after the colon — the list of metric names —
while the field they declare, `metricOutcomes`, carries the **count**. The producer writes that count in the
parentheses and writes it **unconditionally**:

```js
`    metricKept(${kept.length}):${kept.length > 0 ? ` ${kept.join(' ')}` : ''}`
```

so a block that kept nothing renders `metricKept(0):` with **no body at all**. Read as the body, that zero
came back as *"the channel is rendered and carries no value"* — the one reading that makes a measurement
indistinguishable from a gap, and precisely the distinction iteration 21 had just repaired **inside** the
separator for `bestDev`/`bestRise`.

**The evidence is a disagreement between two independent parsers over the same bytes.** The reader reads the
parenthesised number as the authority — `declaredOutcomeCount += Number(dropped[1])` — and the producer's own
doc states the principle for the analogous field: `both=0` *"is NEVER omitted because it is zero … `both=0` is a
measurement (the sets are disjoint) and an absent field is the different claim 'not measured'"*. Compared per
channel and per row over **7 artifacts**, on the **19** row- or sub-line-scoped channels that declare a
`DiagnosedService` field:

| artifact | rows | channel | census valued | reader | delta |
| --- | --- | --- | --- | --- | --- |
| `artifacts/r35107871516` (FSE'26) | 72527 | `metric-drop` | 7777 | 7781 | **+4** |
| `artifacts/r34919714864` | 72527 | `metric-drop` | 7827 | 7831 | **+4** |
| `artifacts/diag-34742498321` | 53350 | `metric-drop` | 5709 | 5712 | **+3** |
| `artifacts/diag-34684319273` | 18820 | `metric-drop` | 2094 | 2095 | **+1** |
| `re1.txt` | 11557 | `metric-kept` | 1887 | 1888 | **+1** |
| `re1.txt` | 11557 | `metric-drop` | 1784 | 1888 | **+104** |
| `re2.txt` | 4806 | `metric-kept` | 762 | 763 | **+1** |
| `re2.txt` | 4806 | `metric-drop` | 746 | 763 | **+17** |
| `re3.txt` | 2900 | `metric-drop` | 452 | 472 | **+20** |

**Nine disagreements, on exactly those two channels, while all seventeen other field-carrying channels agreed
on all seven artifacts.** The asymmetry is the finding: `metric-top` — the third sibling, on the same lines,
read by the same four `decisive*` scalars — agreed everywhere, because for it the value genuinely IS the
decomposition. Only the two channels whose declared field is a COUNT were wrong.

### And the record had already quoted the wrong number, in the sentence that made the point

Finding 7's own summary of this contrast reads *"`metric-kept` 1888 of `re1`'s rows against `metric-top`
1887"* — a REACH against a REACH, which is right — while the value column the census printed said
`metric-kept` was **valued** on 1887, i.e. equal to `metric-top`'s 1887. **The paragraph's evidence and the
instrument's own value column contradicted each other, and only the paragraph was read.** After the fix both
numbers are 1888 against 1887, and the difference is what it always was: a **reach** difference, one row on
which the `metricTop` line is not written.

### The fix states WHERE a channel's value is, because one grammar carries two quantities

A value pattern cannot say which half of a line it belongs to. `ChannelDeclaration` gains
`value_in ∈ {field, paren, body}`, the marker is still **derived** from the key, and the builder now
**asserts** it: a sub-line must be `paren` or `body` (a `field` placement would silently build a `key=value`
pattern for a line with no `=` and read as a channel nothing renders), and a non-sub-line must be `field`. The
two count channels take `paren` with `value=r'\d+'`; `metric-top`, `metric-list`, `error-messages`,
`exceptions` and `decisive-composition` state `body` explicitly; the other twenty-four are `field`.

**The regression is exactly the fix's own scope.** The previous module and this one, diffed over the **31**
channels of **22** local artifacts: **21 readings moved, every one of them a VALUE count on one of the two
channels, every one of them upward, and not one reach, case count or row count changed anywhere.**

### The third edge, which is what found it

The fence had two edges and both are satisfied by the wrong form: the table was **self-consistent** (the
census's own eight tests passed on the broken table) and the reader was **correct**. What was missing is the
edge between them, so it now exists, and it is the same edge shape as the other two — the projection carries
what the other side needs and both sides are held to it:

| edge | subject | how it is held |
| --- | --- | --- |
| 1 | the table ↔ the keys the PRODUCER emits | the producer builds a block; every declared key is emitted and every emitted key is declared, per scope |
| 2 | the table ↔ the READER's typed field map | `O(1)` in both directions against `Object.keys(SERVICE_FIELD_AUDIT)` |
| **3** | **the census's valuation ↔ the READER's own parse** | **the projection carries the census's own `pattern`, `valueIn` and `absent`; the TypeScript side applies that regex to a producer-built block and compares PER ROW with the reader's fields** |

The projection carrying the derived pattern is the point rather than a convenience: a regex re-derived on the
other side would be a second spelling of the grammar, and **a fence whose two halves disagreed about what a
line means would pass on its own bug while both halves stayed self-consistent** — the shape of the two
preceding iterations. `absent` travels for the same reason: *"rendered and undetermined"* is a rule, not a
predicate a second language can guess.

Its population is stated in both directions, because a one-sided equality passes on an empty set: **19**
declared channels qualify (row- or sub-line-scoped, with a field), **4** are excluded **by name with a reason**
— `service-id` (an absent id is spelled `''`), `row-labels` (two fields, and the tag is their disjunction),
`dominant-metric` (`dominant=-` becomes `''`), `metric-top` (the value is the decomposition, a nested
condition) — and the test asserts the excluded set is exactly those four, so a channel cannot join it by
silence.

**And the fence was shown to bite.** Regressing the projection to the body-placed form fails **exactly the two
new tests**, with `metric-kept valued true (reader) vs false (census)` — while the **seven pre-existing tests
still pass**, which is the whole reason this defect survived three iterations: the old edges cannot see it.

### Two defects in this iteration's own work

1. **The row-boundary pattern in the new fence is the `self-anomaly` channel's own pattern**, and the first
   version `continue`d past a row line after opening a row with it — so `self-anomaly` reported zero rows,
   which reads as a broken table rather than as a broken harness. A row line opens a row **and** is read.
2. **A probe typed for one channel does not exercise the other.** The new test built its probe line as
   `metricKept(0):` for both count channels, so the `metric-drop` half matched nothing; it now builds the
   probe from the declaration's own `key`.

## What a candidate must now say

1. **Which channels it reads**, and the **reach** it needs of each — `every` if it sums or simulates over
   every candidate, `some` if it only asks whether the artifact has the channel.
2. **Whether it needs the channel or the VALUE**, because a channel can reach every row and carry nothing on
   a third of them (`onset`, `latRise`, and `decisive-composition` on a block whose named metric has no
   breakdown). **A rendered zero is a value**: `both=0`, `err=0`, `metricKept(0):` and `metricDrop(0):` are
   measurements, and the placement that says so is now part of the declaration (Finding 8).
3. **Which artifact** it reads them from, by run, with that artifact's coverage — because the two FSE'26
   artifacts differ in exactly the channel the composition family depends on.
4. If the reach it needs is not `every`, the **producer change** that would make it so, stated before the
   measurement rather than after.
5. **Which half of the family**, when the quantity is one of a pair that the census names twice. `failed-edge`
   is the SCORE and `failed-edge-records` the COUNT; `latency-edges` is the edge count and `latency-rise` the
   rise. They are read by different signals, and on the shipped artifact one half of one pair is valued on half
   the rows. And for the inventory, `metric-kept`/`metric-drop` and `metric-top` are **not** interchangeable:
   they are different lines with different reaches, and an artifact exists in this repository that carries one
   and not the other.

## Gates

**CI green on `e40639f`: 19 of 19 jobs**, `Release` green on the same commit — and the first commit of this
iteration (`863c58f`) is the one CI caught a real defect in, recorded below rather than smoothed over.

| | |
| --- | --- |
| python gate (CI's `converter-tests`) | **461 tests · 1617 statements · 582 branches · 100.00%**, every module 100% |
| `dump_capability.py` | **100.00% branch** — 256 statements, 110 branches, 61 tests |
| 14 projects × 4 dimensions, **read from CI's own logs** | **56 dimensions, worst `95.00`** (`wave` branches); the project-by-project table is below |
| the new TypeScript fence | 7 tests, in the `benchmarks` project now at **799 tests / 23 files** |
| the seven pre-existing channels | **IDENTICAL** on all **15** local artifacts, by running the previous module and this one and diffing every reading |
| mutations | **24 of 24** as declared, both controls (`py` and `ts`) SURVIVED, tree restored and hash-verified |
| golden | **none owed** — `__tests__/`, `scripts/*.py` and `docs/` are outside every trigger path; the selector returns `(False, ())` and its control fires on `packages/*/src/**` |

Every dimension is **unchanged** from the reading taken before this iteration — the new population moved no
published number, which is what the seven-channel diff above says independently:

| job | stmts | branch | funcs | lines | tests |
| --- | --- | --- | --- | --- | --- |
| `benchmark-tests` | 99.84 | 97.46 | 100.00 | 99.84 | 799 |
| `test (kinetic)` | 100.00 | 99.44 | 100.00 | 100.00 | 954 |
| `test (tree)` | 100.00 | 100.00 | 100.00 | 100.00 | 650 |
| `test (core)` | 99.88 | 96.61 | 100.00 | 99.88 | 415 |
| `test (optimize)` | 100.00 | 100.00 | 100.00 | 100.00 | 200 |
| `test (causal)` | 100.00 | 100.00 | 100.00 | 100.00 | 176 |
| `test (cutting)` | 98.43 | 95.17 | 100.00 | 98.43 | 170 |
| `test (scaling)` | 100.00 | 95.49 | 100.00 | 100.00 | 161 |
| `test (noise)` | 100.00 | 100.00 | 100.00 | 100.00 | 152 |
| `test (wave)` | 99.61 | **95.00** | 100.00 | 99.61 | 144 |
| `test (ai)` | 100.00 | 100.00 | 100.00 | 100.00 | 113 |
| `test (storage-fs)` | 100.00 | 100.00 | 100.00 | 100.00 | 28 |
| `test (storage-browser)` | 100.00 | 100.00 | 100.00 | 100.00 | 22 |
| `test (storage-remote)` | 100.00 | 100.00 | 100.00 | 100.00 | 21 |
| **56 dimensions** | | **worst 95.00** | | | **4,005** |

### One defect in this iteration's own work, caught by CI

The first commit's `typecheck` job failed in two places in the fence this iteration adds, and **neither was
visible to the per-project check that passed here**:

```
__tests__/fse26-capability-census.test.ts(158,5): error TS2322: Type 'Map<string, { label: string;
  outcome: string; … }[]>' is not assignable to type 'ReadonlyMap<string, readonly MetricDiagnostic[]>'
__tests__/fse26-capability-census.test.ts(302,66): error TS2345: Argument of type 'string' is not
  assignable to parameter of type 'keyof DiagnosedService'
```

The first was `outcome: 'dropped:transient-return' as string` — a cast that widened the whole array past
`MetricDiagnostic`, where the union's own member is what the fixture needs. The second is
`scalar.reads.includes(field)`, whose `reads` is `readonly (keyof DiagnosedService)[]`.

**Why it reached CI is the lesson, and it is the same one the coverage gate taught from the other side:**
**a number belongs to its population, and the population of a typecheck is decided by its `tsconfig`.** Both
commands are run together, and the fix commit (`e40639f`) records the two errors verbatim.

**And this paragraph had the two populations the wrong way round.** It said the project leg misses
`benchmarks/__tests__` while the workspace config covers it; measured 2026-09-26 from the two `include` lists
and from a run of each, it is the reverse:

| leg | its config says | covers |
| --- | --- | --- |
| `nx run-many --target=typecheck --all` | `benchmarks/tsconfig.json` → `["*.ts", "src/**/*.ts", "__tests__/**/*.ts"]` | **`benchmarks/src` and `benchmarks/__tests__`** |
| `tsc -p tsconfig.workspace.json` | `["packages/*/*.ts", "packages/*/__tests__/**/*.ts", "integration-tests/*.ts"]` | **neither** — it does not reach into `benchmarks/` at all |

The evidence is a run rather than a reading: adding a field to `AnalyzeDumpOptions` produced **three errors
inside `benchmarks/__tests__` that the project leg reported and the workspace leg was clean on**. So the rule
survives and its reason is better than the one it was stated with — **the two legs cover a UNION and neither
covers both**, which is why both are run — and the claim about which leg sees which tree is now asserted
against the two `include` lists rather than restated from memory.

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

## Gates of the count-placement fix (Finding 8)

**CI green on `d4ca223`: 19 of 19 jobs**, `Release` green on the same commit — and the push started **only**
those two workflows, which is the paths rule confirming no golden was owed.

| | |
| --- | --- |
| python gate (`converter-tests`) | **468 tests · 1628 statements · 584 branches · 100.00%**, every module 100% — identical to the local run, and 1.680 s in CI against 260 s here |
| `dump_capability.py` | **100.00% branch** — 267 statements, 112 branches, 68 tests in the module's own suite |
| `benchmarks` project | **804 tests / 23 files** (was 802: the two new edge tests) |
| 14 jobs × 4 dimensions, **read from CI's own logs** | **56 dimensions, worst `95.00`** (`wave` branches), **4,010** tests |
| every percentage | **UNCHANGED** from the reading before the change; only `benchmark-tests`' **count** moved, 802 → 804 |
| `nx run-many --target=typecheck --all` | 15 projects clean |
| `tsc -p tsconfig.workspace.json` | clean — **CI's population, which the per-project command does not cover** |
| lint / format | 0 warnings, 0 errors on 339 files; the touched test formatted |
| the 31 channels over 22 artifacts | **21 readings moved, all VALUE counts on the two count channels, all upward**; no reach, case count or row count moved anywhere |
| the reader cross-check | **9 disagreements before, 0 after**, over 7 artifacts × 19 field-carrying channels |
| the fence bites | regressing the projection to the body-placed form fails **exactly the two new tests** while the **seven pre-existing tests still pass** |
| mutations | **18 rows, every one as declared**; both controls (`py`, `ts`) SURVIVED; tree hash-verified byte-identical |
| golden | **not owed** — `scripts/*.py`, `__tests__/**` and `docs/**` are outside every trigger path; the selector returns `(False, ())` and its control fires on `packages/*/src/**` |

**A branch was added and no dimension moved**, which is what says the new placement path is exercised by the
tests that assert it — a branch added without a test would have shown up here as a drop. That is why the
numbers are quoted per project rather than as a workspace total.
