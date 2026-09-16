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

## 6. Reproduce

```bash
# the census, on the shipped-configuration dump (no run, no rebuild)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r35035314921/fse26-results.txt --separator-screen --lat-floor 10.3

# the module's own tests, including both defects of section 2
cd benchmarks && npx vitest run __tests__/fse26-separator.test.ts
```

Every number in this document is printed by that command and recomputed from the dump on each
run; none of them is pasted.
