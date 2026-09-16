# The separator screen: which dump-visible signal prefers the true source to the engine's rank-1

**Status:** instrument shipped (`--separator-screen`), axis measured. **Code:**
`benchmarks/src/fse26-separator.ts` + `benchmarks/__tests__/fse26-separator.test.ts` (28 tests).
**Measured on:** the shipped-configuration dump `35035314921` (`b023b1f`'s ancestor run,
pool-ON, 1422 cases, 666 misses).

The register's instruction for this axis is a precondition, not a suggestion:

> A candidate here must name the context feature and **show it separates, on a free read,
> before any run**.

Every feature named before this iteration was measured marginally — how often a source carries
a latency rise (9.3%), how much of its inventory a guard discards (44%) — and a marginal rate
cannot say whether a feature prefers the source to the *particular service that beat it*. Two
services in one case can both carry a feature, or neither, and the case is still decided one
way. So the screen asks the paired question, of every signal a dump carries, 666 times.

**Answer, in one line: no signal separates globally (the best non-term signal is `onset` at AUC
0.537, below the 0.60 bar), 4 of 250 per-type cells separate *for* the source at the
multiplicity-corrected bar, 35 separate *against* it — and two of the four hold in every fold of
the dump.**

---

## 1. The instrument

**The pair.** For each miss: `source` = the case's most anomalous ground-truth service
(self-anomaly descending, id ascending — the printer's own comparator); `winner` = the engine's
rank-1. Hits are excluded, because there the source *is* the winner and the comparison would be
a structural tie — the same trap the guard census records.

**The signals.** 14, each declared with a role, so the report can say what class of evidence it
is and the register's closing conditions can be applied mechanically:

| role | signals |
| --- | --- |
| `term` (already scored by the engine) | `metric`, `log`, `lat`, `temporal`, `failedEdge` |
| `inventory` (what the guards did to it) | `kept`, `transientDrops`, `bestDev`, `bestRise` |
| `evidence` (raw counts the terms are built from) | `sigLines` (the admitted union), `errLines` (all ERROR/FATAL), `inLatEdges` |
| `time` | `onset` (the delay; smaller is evidence, so the direction is inverted) |
| `topology` | `inDegree`, and the one PAIR signal `reaches` |

A **`term` can never become a candidate**, at any AUC. The register closes every axis that is "a
function of the service's own metric score"; a screen that could hand one back would reopen
those axes through the side door. It is tested: a fixture where the source wins on the metric
gives `metric` an AUC of exactly 1.0 and the candidate list stays empty.

**Three outcomes, not two.** `source` / `winner` / `tie`, plus `unmeasurable` for a pair one side
cannot be measured on. `n/a` is left **out of the rate** and counted, never folded in as a loss.
The `tie` column is also load-bearing: `lat` ties on 432 of 666 pairs, because the shipped floor
(`latMinRise = 10.3`) masks most rises — a fact about the floor that an AUC without its tie count
would hide.

**The bar is pre-registered in the code**, not in a document: a non-term signal passes only if
AUC >= 0.60 over >= 10 measurable pairs **and** never below 0.5 on any fault type with >= 10
pairs. A global rate cannot see the type it is wrong on, and a fault type is the unit that can
regress.

## 2. Two defects the instrument caught in itself

Both were found by running it, and both are recorded because they are the same defect class the
whole analyzer exists to find.

1. **A p-value is symmetric, so ranking on it promotes losses.** The first version selected each
   row's "best" non-term cell by the smallest p. On the real dump that immediately made
   `JVMMemoryStress/transientDrops` — AUC **0.000**, p = 2.7e-48 — the top row, presented as the
   block's best separator. The two classes are now separate lists (`survivors` for the source,
   `dominated` for the mirror), the per-type column ranks by AUC, and a test pins a
   significantly-wrong-way cell out of the candidate list.
2. **`stable` was defined for one population and printed for two.** The fold-consistency flag
   read "every fold above 0.5", which marked all 35 dominated cells UNSTABLE — including ones
   whose five folds were all 0.00, the most uniform result in the table. It is now
   direction-consistent (every fold agrees with the whole-set direction), and there is a test on
   the mirror population as well as the candidate one.

## 3. The measurement

`666` pairs, `250` non-term cells scanned, so the per-test bar is
`Šidák(0.05, 250) = p < 2.05e-4`.

### 3.1 No global separator

| signal | role | AUC | source–winner–tie |
| --- | --- | --- | --- |
| `onset` | time | **0.537** | 333–286–11 (36 `n/a`) |
| `temporal` | term | 0.544 | 357–298–11 |
| `inDegree` | topology | 0.525 | 294–261–111 |
| `lat` | term | 0.511 | 124–110–**432** |
| `inLatEdges` | evidence | 0.487 | 222–239–205 |
| `failedEdge` | term | 0.457 | 193–250–223 |
| `errLines` | evidence | 0.405 | 152–279–235 |
| `reaches` | topology | 0.336 | 160–379–127 |
| `transientDrops` | inventory | 0.330 | 208–434–24 |
| `metric` | term | 0.279 | 185–480–1 |
| `bestRise` / `bestDev` | inventory | 0.270 | 180–486–0 |
| `sigLines` | evidence | 0.260 | 12–332–322 |
| `log` | term | 0.255 | 8–335–323 |
| `kept` | inventory | 0.209 | 126–514–26 |

The engine's own three terms read the way the register describes: the winner leads on the metric
in 72% of misses, the log term is decisive but sparse (323 ties), and the latency term is masked.

**`43/666` pairs carry no non-term preference for the source at all** — every non-term signal
ties or prefers the winner. Those are the population only new evidence can reach, and the number
is printed with the table rather than inferred from a total.

### 3.2 What separates, and just as importantly, what is *owned*

**4 of 250 cells separate FOR the source at the bar** (fold vector, `foldOf` imported from the
discriminator so both modules hold out the same fifth):

| cell | source–winner | AUC | p | folds | |
| --- | --- | --- | --- | --- | --- |
| `NetworkPartition` / `errLines` | 30–3 (15 tie) | 0.781 | 1.4e-6 | .77/.70/.83/.92/.77 | **stable** |
| `JVMMemoryStress` / `inDegree` | 98–48 (13 tie) | 0.657 | 4.3e-5 | .68/.68/**.50**/.76/.64 | unstable |
| `HTTPResponseReplaceCode` / `reaches` | 49–16 (6 tie) | 0.732 | 5.1e-5 | .64/.70/.75/.82/.75 | **stable** |
| `NetworkLoss` / `inDegree` | 21–2 (2 tie) | 0.880 | 6.6e-5 | .94/**.50**/.88/1.00/.88 | unstable |

The two "unstable" rows are not noise; they are cells whose *fifth* of the dump is a coin flip
(AUC exactly 0.500). That is the fold vector doing its job: the same cells read as clean
survivors in-sample.

**35 of 250 separate AGAINST it, and six of them are deterministic.**

| cell | source–winner | AUC | p |
| --- | --- | --- | --- |
| `JVMMemoryStress` / `transientDrops` | **0–159** | 0.000 | 2.7e-48 |
| `JVMMemoryStress` / `kept` | **0–158** | 0.003 | 5.5e-48 |
| `JVMMemoryStress` / `sigLines` | 0–105 | 0.170 | 4.9e-32 |
| `ContainerKill` / `kept` | **0–83** | 0.000 | 2.1e-25 |
| `ContainerKill` / `transientDrops` | 1–82 | 0.012 | 1.7e-23 |
| `JVMMemoryStress` / `reaches` | 11–110 | 0.189 | 1.1e-21 |

This is the strongest statement the census can make about the block, and it is the opposite of a
candidate: on the whole inventory/evidence class, the engine's rank-1 does not edge the source
out, it **owns it** — in `JVMMemoryStress` the source keeps fewer metrics and loses more to the
transient guard than the wrong winner in 158 and 159 of 159 misses respectively. The guard census
(`fse26-guard-census-verdict.md`) showed the same guard firing at the same *rate* in the cases
the engine gets right; this shows why that did not make it irrelevant — the pairing inside a
wrong case is deterministic.

## 4. The two stable cells, and what each names

### 4.1 `HTTPResponseReplaceCode` / `reaches` — the engine names a downstream consequence

In the largest miss population (71 cases), the true source **reaches** the engine's rank-1 along
the recorded call graph while the rank-1 does **not** reach the source, in 49 of the 65 decisive
pairs (75%), holding in all five folds. The degree signal points the *other* way in the same
type (`inDegree` 11–40, p = 5.7e-5), which is what makes the reading directional rather than a
connectivity artefact: it is not that the source is more connected, it is that the edge points
from the source to the pick.

This refines the register's sentence "the call graph's ancestry does not [separate]". Measured
globally it is right (`reaches` 0.336 overall) — because it **reverses** in the network
population: `NetworkPartition` 8–32 (AUC 0.250, p = 1.8e-4) and `NetworkLoss` 0–19. The same
conflict the register keeps finding, a fourth time:

| population | graph direction | what the engine picked |
| --- | --- | --- |
| replace-code (71) | source → winner, 49–16 | a downstream **consequence** |
| network partition / loss (73) | winner → source, 8–32 / 0–19 | an upstream **cause** |

A global graph bonus therefore cannot exist. That is consistent with what closed the axis the
first time (`failedEdgeWeight = 0`: +5.8pp with 2 regressed types).

### 4.2 `NetworkPartition` / `errLines` — the gate discards the class's own errors

The crispest pair of numbers in the census, over the same 48 cases:

| signal | source–winner | AUC | p |
| --- | --- | --- | --- |
| `errLines` (every ERROR/FATAL line) | **30–3** | 0.781 | 1.4e-6 |
| `sigLines` (the lines the engine's gate admits) | **0–29** | 0.198 | 3.7e-9 |

The source emits more error lines than the engine's pick in 30 of 33 decisive pairs, and more
*source-signature* lines in **none** of 29. So in this population the log term's level-1 gate is
what discards the source's evidence, and the discarded lines are the fault class's own errors
(connection/timeout lines, which are neither a logic exception nor a framework-HTTP exception).

The engine already has a mode that admits every ERROR/FATAL — `all`, named in the register's
log-signal row as built and never measured — and the dump already carries the two counts it needs
(`err`, `fatal`). So this cell is a **precondition the register asked for, met**, and the mode's
free pre-screen is the next iteration, not this one.

## 5. What a proposal must now do

1. **State its cell** from this census — `type/signal`, with the pair counts and the fold vector.
   A proposal resting on a global AUC has the table above to answer to.
2. **Not be a `term`.** Not new advice: it is `SeparatorRole` in the code and tested.
3. **Be a per-population rule, or name the discriminator that makes it one.** Both stable cells
   come from families that reverse elsewhere; the census prints the reversing cells.
4. **Clear the shared kill criterion** — golden 9-cell byte-identical and zero regressed FSE'26
   fault types — and be screened on a **different** held-out fifth than the cell was selected
   from. The 4 survivors were selected by scanning 250 cells; the fold vector is the weakest
   correction, not the last word.

## 6. The field audit, and the five signals it named

The register asks any candidate to *name the context feature*. That makes "which fields does no
signal read" a question with a checkable answer, and the answer is now structural rather than
rhetorical: every scalar declares the `DiagnosedService` fields it reads
(`SeparatorScalar.reads`), and `SERVICE_FIELD_AUDIT` is typed
`Record<keyof DiagnosedService, string>` — **adding a field to the reader breaks the build until it
is classified**. The audit names three fields nothing screens, each with its reason:

| field | why no signal reads it |
| --- | --- |
| `isGroundTruth` | it is the LABEL — a scalar that read it would be reading the answer |
| `predictedRank` | degenerate: the winner is rank 1 by construction, so the comparison would restate the pairing |
| `dominantMetric` | a LABEL, not a magnitude — the family axis is closed by `fse26-family-screen-verdict.md` |

The audit then named fields that were **read but not screened**: the decomposition of the metric that
drove the score (`trend`, `cv`, `burst`, `baselineMean`), and the raw `failedEdge` record COUNT behind
its normalised score. Five scalars were added for them — `decisiveTrend`, `decisiveCv`,
`decisiveBurst`, `decisiveBaseline`, `edgeRecords` — and the census re-run over **375 non-term cells**,
which raises the multiplicity bar to `p < 1.4e-4`.

The new fields are the strongest this screen has ever found, and two of them invert a previous
conclusion:

| cell | source–winner | AUC | p | folds |
| --- | --- | --- | --- | --- |
| `HTTPResponseReplaceCode` / `edgeRecords` | **60–2** | **0.908** | 8.5e-16 | .81/.85/1.00/.97/.93 stable |
| `HTTPResponseReplaceCode` / `decisiveCv` | 59–3 | 0.884 | 1.7e-14 | .92/.75/.88/.91/.96 stable |
| `HTTPResponseReplaceCode` / `decisiveBaseline` | 61–10 | 0.823 | 4.6e-10 | .83/.80/1.00/.88/.79 stable |
| `HTTPRequestReplaceMethod` / `edgeRecords` | 39–4 | 0.815 | 3.1e-8 | .68/.79/.82/.79/.79 stable |
| `JVMMemoryStress` / `decisiveCv` | 98–40 | 0.682 | 8.5e-7 | .66/.57/.74/.72/.71 stable |
| `NetworkPartition` / `errLines` | 30–3 | 0.781 | 1.4e-6 | .77/.70/.83/.92/.77 stable |

Overall the screen now reports **13/375 cells for the source and 37/375 against** it (from 4 and 35
over 250), and the global leader is `decisiveCv` at **AUC 0.734, p = 2.0e-40** — a non-term,
non-graph feature.

**Two of those three hold, and one does not — because the confound check has no power.**

**The four `decisive*` signals cannot be separated from the renderer's own brevity.** All four are
read from the block's rendered decomposition, and the block renders a decomposition for a service in
proportion to how many metrics it KEEPS — which the paired screen already shows is nearly
deterministic in the wrong direction (`JVMMemoryStress/kept` **0–158**). The conditioning that would
settle it — same number of kept metrics on both sides — has almost nothing to stand on:

| type | pairs | same `kept` count (`kept=`, printed by the command) |
| --- | --- | --- |
| `JVMMemoryStress` | 159 | **1** |
| `ContainerKill` | 83 | **0** |
| `HTTPResponseReplaceCode` | 71 | **5** |
| `PodFailure` | 24 | **1** |

The conditioned rates themselves (AUC 0.000 on `JVMMemoryStress` at n=1, n/a on `ContainerKill`,
0.333 at n=3 on `ReplaceCode`) are computed by a one-off probe over the same pairs and are reported
here as such — with three pairs or fewer they carry no information, which is the point. The count
that establishes the saturation is a column of the shipped table, so the reason is reproducible even
though the conditioned rate is not.

So the honest reading is not "`cv` survives the confound" but **"the confound is saturated, and this
instrument cannot tell the two apart"**. `decisiveCv`, `decisiveBaseline`, `decisiveBurst` and
`decisiveTrend` are therefore recorded as **not established** — their separation is a fact about the
pair, and the pair's rendering is what produces it. (The `0–158` above is also the sharpest
statement of the block's inventory asymmetry: in the weak block's misses the engine's pick keeps more
metrics than the source in every one of 158 decisive pairs.)

### 6.1 The reader was wrong — and correcting it does not reopen the block

The four composition signals were not merely confounded; the quantity they read was the wrong one.

`inventoryOf` (this screen's reader) selected the decomposition by **largest `riseRatio`**, on the
stated premise that "the metric that drove the score is the one with the largest rise". The dump
contradicts it, and the dump is one read away from saying so: the engine prints **`dominant=<label>`**
on the same service line, which is the metric it actually maximised over, and the rendered list is
sorted by score — so the decisive metric is the FIRST entry, and it is the one the engine named.

| measured on the shipped dump (`r35006947938`, 1422 cases) | count |
| --- | --- |
| service rows | 72,527 |
| rows with a rendered decomposition (`metricTop`) | 7,781 |
| rows whose `dominant` IS the first rendered entry | **7,781 (100.0%)** |
| rendered counts of the truncated form `metricTop(3/N)` | **7,781 (100.0%)** |
| rows where the largest-rise entry is NOT the first (score) entry | **758 (9.7%)** |

So for one row in ten, the old reader described a metric the ranking had not been decided by — and it
could never describe a metric outside the rendered three. The fix reads the named metric, falls back
to the highest-scoring entry (never to the rise), and reports **no composition as absent rather than
as zero**: a `cv` of 0 is a measurement (a perfectly stable series), so returning it where nothing
was decomposed would fabricate a tie between the two sides.

Re-measured on the same dump with only the reader changed — and the check that the dump is the one
the register's row was written from is that the old reader reproduces **exactly** the numbers that row
quotes (`decisiveCv` 0.734 at p = 2.0e-40):

| signal | before | after |
| --- | --- | --- |
| `decisiveCv` | 0.734, p=2.0e-40, 444-132-90 | **0.738, p=7.9e-42, 446-129-91** |
| `decisiveBaseline` | 0.628, p=4.6e-11 | **0.644, p=8.4e-14** |
| `decisiveBurst` | 0.571, p=1.2e-9 | **0.577, p=1.1e-10** |
| `JVMMemoryStress` / `decisiveCv` | 0.682, p=8.5e-7 | **0.689, p=3.4e-7** |
| `PodFailure` / `decisiveCv` | 0.958, p=3.0e-6 | **1.000, 24–0, p=1.2e-7, stable in all five folds** |

Every aggregate moves in one direction, and one type-level cell becomes perfect. **The unconditional
rate does not reopen the block**, and the reason is a number rather than an inference:

| confound check | value |
| --- | --- |
| Pearson `r(kept, decisiveCv)` over the pairs' 1,332 services | **0.4325** |
| Spearman `ρ(kept, decisiveCv)` | **0.4086** |
| pairs where the source keeps MORE metrics than the winner | 126 of 666 |
| pairs where the source keeps FEWER | **514 of 666** |
| pairs with an exact `kept` match (the `kept=` column) | 26 of 666 |

The signals separate in the same direction as inventory size, and the two are correlated well above
chance, so the unconditional rate cannot be attributed to the decisive composition rather than to
`kept`. **That also excludes the reopening condition this section used to state.** "A dump that
renders the decisive metric for every service" would not help: the decisive metric is already
rendered for every service a pair compares (that is why `n/a` is 0 for all four). What is asymmetric
is how many metrics each side KEEPS — so what the confound check needs is an **inventory-MATCHED**
comparison, and that is now in the tool rather than in a paragraph.

### 6.2 The matched comparison, and the verdict it changes

`INVENTORY_MATCH_BAND = 2` (a ratio) is exported with `inventoryComparable`; every row counts its
`kept<=` pairs beside its exact `kept=` ones; and every cell carries a `near` sub-cell read on that
stratum, printed in both tables. The band is stated in the legend together with the sentence that
keeps it honest: *the matched stratum is not the whole population, because the pairs it drops are the
ones whose inventories differ most.*

The instrument was validated against an independent probe before it was trusted: the probe's
unmatched rates reproduce the printed table exactly (`decisiveCv` 0.742 on 446-125-91, `decisiveBurst`
0.585, `decisiveBaseline` 0.647, `edgeRecords` 0.453), and the probe's matched rates reproduce the new
columns (`decisiveCv` 0.722 on 484, and 0.657 / 0.637 / 0.865 / 1.000 per type).

| signal | AUC (all 666) | matched n | AUC (kept ratio ≤ 2) |
| --- | --- | --- | --- |
| `decisiveCv` | 0.738 | 487 | **0.718** |
| `decisiveBaseline` | 0.644 | 487 | 0.598 |
| `decisiveBurst` | 0.577 | 487 | 0.556 |
| `inDegree` (best non-`decisive*` non-term) | 0.529 | 487 | 0.533 |
| `edgeRecords` | 0.453 | 487 | 0.467 |
| `kept` — the confound itself | 0.209 | 487 | **0.271** |

Per type, the row's best signal with its matched rate:

| type | best non-term | AUC | matched n | AUC (matched) |
| --- | --- | --- | --- | --- |
| `HTTPResponseReplaceCode` | `edgeRecords` | 0.908 | 48 | 0.865 |
| `HTTPResponseReplaceCode` | `decisiveCv` | 0.884 | 48 | 0.885 |
| `HTTPRequestReplaceMethod` | `decisiveBaseline` | 0.794 | 50 | 0.780 |
| `NetworkPartition` | `errLines` | 0.781 | 46 | 0.793 |
| `ContainerKill` | `decisiveCv` | 0.699 | 40 | 0.637 |
| `JVMMemoryStress` | `decisiveCv` | 0.689 | 87 | 0.661 |
| `PodFailure` | `decisiveCv` | 1.000 | 23 | **1.000** |

**The confound is now excluded rather than saturated, and `decisiveCv` survives it.** Matching removes
the inventory difference by construction — and the check that it did is that the confound stops being
a separator: `kept` falls from 0.209 to 0.271, still far below the criterion, while `decisiveCv`
retains **0.718 on 487 pairs**, which is the ONLY non-term rate in the table that clears the 0.6
criterion on the matched stratum (`decisiveBaseline` 0.598 is next and falls short).

So the block's status changes, and the change is the instrument's, not the numbers': `decisiveCv`
moves from **not established** to **established as a separator under a stated inventory match**, with
a candidate at the top of the table for the first time. Three caveats travel with it, all measured:

1. The balanced stratum is 487 of 666 pairs, and the 179 it drops are systematically the ones where
   the source keeps far fewer metrics — so the matched rate describes that stratum, not the whole
   population. The unconditional 0.738 is an upper bound; **0.718 is the number to quote.**
2. `decisiveCv`'s separations are per-population, like `edgeRecords`': the two `decisive*` siblings
   point the same way (`Baseline` 0.598, `Burst` 0.556) but `decisiveTrend` is the other way at
   **0.372** on the matched stratum, so the family is not one signal.
3. **A paired preference is still not a term.** `decisiveCv` is a candidate, and what it needs is the
   window solver on both benchmarks — it cannot be promoted from this table, for the reason
   `fse26-term-oracle-verdict.md` §9 records at length. That solver now exists
   (`fse26-cv-screen.md`, behind `--cv-screen`).
4. **The statistic is a clamped BONUS, not a coefficient of variation.** `breakdown.cv` holds the
   engine's `cvBonus = cv > 0.5 ? Math.min(cv, 1.5) * 0.05 : 0`, so it is `0` (raw `cv ≤ 0.5`), the
   ceiling `0.075`, or one of 50 steps between `0.025` and `0.075` — measured over the 20,787
   services of a 409-case snapshot, **20.36% sit at exactly 0 and 23.24% at exactly the clamp**. The
   RATE above is unaffected (an AUC is a rank statistic and the field is monotone in dispersion), but
   it means the order is the measured part and the magnitude is not: a term built on this field must
   say which reading it is, and `rank` is the faithful one.

**A provenance correction, recorded rather than quietly fixed.** The reader defect and the matched
comparison were first measured on `r35029055764`, and both documents called that dump "the shipped
configuration". Its header says otherwise:
`temporalWeight=0.036552 onsetShape=earliest-only` — the onset pair the golden REJECTED and `301c430`
reverted — and it yields **662** pairs where the shipped configuration yields **666**. Every number in
this section has been re-measured on the shipped dump `r35006947938`
(`poolMetricPenaltyWeight=0.0679`, `latWeight=0.561495`, `latMinRise=10.3`, no temporal override), with
three stages on that one dump: the old reader, the fixed reader, and the fixed reader with the matched
columns. The conclusion is unchanged — `decisiveCv` still survives the match — and the numbers moved
by under 0.005. The lesson is the one `b7da5b4` records: a recorded run may have been taken with a
value PINNED, so the dump's own header, not its filename, is what says which configuration it is.

Two things moved as a consequence of the reader fix rather than beside it: the audit's
`dominantMetric` entry had to be reclassified from `NOT read` to `read:` (the four scalars now declare
it in `SeparatorScalar.reads`, and the field audit's two-directional check fails the build otherwise),
and the reader's own test suite was validated by **mutation** — restoring the old largest-rise rule
fails four of the new tests, so the assertions measure the fix rather than the fixture.



**`edgeRecords` does hold, and it refines a register sentence.** It reads `failedEdgeRecords`, a raw
count that the rendering does not touch, so the confound above does not reach it: **60–2 on
`HTTPResponseReplaceCode` (AUC 0.908, p=8.5e-16, stable in all five folds)** and **39–4 on
`HTTPRequestReplaceMethod` (0.815)**. The register says per-edge failure counts "do not separate
source from victim at any weight" — and the *score* does not (`failedEdge` 0.457; its direction gate
is a mask, and the register's row is about the weighted score). The raw COUNT separates at 0.908 in
the population the mode was built for. Both statements are true, and the distance between them is
the finding: the engine's failed-edge term divides by a case maximum and applies a floor, and what
survives is a quantity that no longer separates.

**And a paired preference is still not a term** — the lesson `fse26-term-oracle-verdict.md` §9 records
at length. `edgeRecords` is a candidate, not a change: it needs the window solver on both benchmarks,
and it is a per-POPULATION signal (the two network types point the other way: `NetworkLoss` 0–19,
`NetworkPartition` 8–32), so the same conflict that closed the graph-direction axis applies to it.

**And one of the census's own lines had to change with the menu.** "Pairs with no non-term
preference" read **43/666** over ten signals and **0/666** over fifteen. Nothing about those pairs
became easier; the question "is there any evidence at all" is answered by the MENU. The line now
prints its menu size, because a statistic whose meaning moves with an input must say so — the same
discipline as the `defaultPath` guard on the recorded-runs table.

## 7. Reproduce

```bash
# the census, on the shipped-configuration dump (no run, no rebuild)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r35035314921/fse26-results.txt --separator-screen --lat-floor 10.3

# the module's own tests, including both defects of section 2
cd benchmarks && npx vitest run __tests__/fse26-separator.test.ts
```

Every number in this document is printed by that command and recomputed from the dump on each run,
with one stated exception: the conditioned rates in §6's confound paragraph come from a one-off probe
over the same pairs, and §6 says so where they appear. The counts that establish the saturation —
the `kept=` column — are printed by the command.
