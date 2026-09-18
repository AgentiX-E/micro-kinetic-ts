# The decisive-stability (cv) screen: the separator's rate turned into a term

**Status:** instrument shipped and gated; the population measurement is **done on both benchmarks**,
and the first weight anyone solved for it **fails the golden**. §4 records a weight-level veto, not a
term-level one: the term is admitted behind `--stability-weight` and the default does not move. **The
screens this document is built on rested on a base with the engine's order and not its gaps; that base
has since been CORRECTED and every figure re-measured — see §"The cause, and the fix". The veto does
not depend on the correction (it is a run's own measurement), and neither does any fidelity number: the
correction moved the golden's window figures and left all seven `correct at 0` counts and the whole
FSE'26 half bit-identical, because 0 of that dump's 1422 cases is below the threshold the base got
wrong.**
**What the instrument now says about its own verdict.** Every ensemble draws the box ITS SCREEN reads and
names it in the report (§"The ensemble's box was ONE screen's"), so a resolution figure can no longer be a
statement about a column the screen cannot read. The counts above are conditional on an artifact that
renders every input at three decimals, and both sides of the count now carry their own frontier: the
unreachable count partitions into five causes, **two of which are the artifact's resolution** (236 of
FSE'26's 569 unreachable cases read a deciding pair as EQUAL and 25 of `re3-noinject`'s 37), and the
satisfied side reports that **the cap is an UPPER bound** — 510 of FSE'26's 756 protected cases and 31 of
`re1`'s 301 hold a rival the artifact cannot order, with the level it can be undercut to derived rather
than acknowledged (`lossFloor`: **0.003873 against a cap of 0.030480 on FSE'26**, i.e. 8× — and the one
engine run that measured it lost **no** fault type at the recommended weight, so the bound is loose).
The second channel — the base's own render — is measured as well, and it is the harsher of the two: on
FSE'26's `rank` shape, the shape the engine's coefficient IS, the window's `lost at ship 0` survives the
discarded digits in **15 of 100 draws**. See §"The unreachable count now says WHY", §"The cap is an UPPER
bound" and §"The second channel".

Deliberately NOT a `-verdict` document: the register's rows are for axes measured to a conclusion,
and what closed here is a WEIGHT — the statistic the row names (`decisiveCv` on the matched
stratum) is still the only non-term candidate above the criterion.

**The correction, in one paragraph.** The reconstructor the screens are built on took `log1p` of a
RE-DERIVED rank rescale of the metric term while the engine takes `log1p` of the node's own anomaly
(`pruner.ts` 1400/1575) — and the engine applies that rescale **only when the graph has at least
`ANOMALY_NORMALIZE_NODE_THRESHOLD` nodes** (`topology-fault-graph.ts` step 1b). Above the threshold
the substitute was the same quantity; below it the reconstruction had the engine's ORDER (the rescale
is strictly monotone, so no order-only check could ever fail) and invented its gaps. That is **407 of
the golden's 615 cases** (re1 250 of 375, re2 100 of 150, re3 57 of 90 — the OB and SS systems, 12–19
services) and **0 of the 1422 cases on the FSE'26 side**, where every case is a 51- or 52-service
system. The fidelity line that should have caught it was printing the wrong thing instead: on `re1` it
read `metric term: max |recomputed - printed| = 2.51e+0; services above 5e-4: 3500`, a deviation with
no unit and no interpretation, and it was read as a rounding detail for as long as the defect existed.
See §"The cause, and the fix" for the fix, the two engine-arbitrated residuals, and the measured
before/after.

**Code:** `cvSlopes` + `cvAvailability` + `cvScreen` + `cvShapeMenu` + `gainResolution` +
`formatCvScreenReport` + `formatCvMenuReport`, behind `--cv-screen`. **Producer:** the
`metricDecisive` line, `packages/kinetic/src/benchmarks/fse26-diagnose.ts`.

`fse26-separator-verdict.md` §6.2 ended with a candidate and a condition. The candidate is
`decisiveCv` — the only non-term signal above the 0.6 criterion on the inventory-matched stratum
(**AUC 0.718 on 487 of 666 pairs** of the shipped dump `r35006947938`; the unconditional 0.738 is an
upper bound). The condition was a **window solver**: a paired preference is not a term, and the
question is never "does it separate" but "does any weight help without losing a case". This is that
solver, pointed at that statistic.

---

## 1. The model

```
score_cv(v) = shipped(v) + w × cvShape(v),   w ≥ 0
```

`shipped(v)` is the engine's own score from `shippedScores`, so the configuration this is a distance
from is the engine that actually RAN — the latency and pool terms are in the base, not dropped. A
screen built on a two-term blend would report a window for a ranking nobody had.

Two shapes, declared as a menu rather than left to the next proposal, for the reason the onset
shapes are: "no weight on THIS shape works" leaves the axis open on a technicality.

| shape | `cvShape(v)` | what it hypothesises |
| --- | --- | --- |
| `flip` (default) | `(max − b) / max` over the decisive **bonus** `b` | the MAGNITUDE of the bonus is the evidence |
| `rank` | `(n − 1 − avgRank) / (n − 1)`, ascending in `b` | only the ORDER is; the magnitude is noise |

### The field is a CLAMPED BONUS, not a coefficient of variation

`metricDecisive` prints `breakdown.cv`, and that field holds the engine's `cvBonus`, not the raw
dispersion:

```ts
// packages/tree/src/causal/topology-fault-graph.ts
const cvBonus = cv > 0.5 ? Math.min(cv, 1.5) * 0.05 : 0;
```

So it takes only three kinds of value — `0` (raw `cv ≤ 0.5`), the ceiling `0.075` (`Math.min`
saturating), and the 50 steps between `0.025` and `0.075`. Measured on the first 409 cases of run
`35107871516`, over the 20,787 services carrying a composition:

| value | services | share |
| --- | --- | --- |
| exactly `0` | 4,232 | **20.36%** |
| exactly `0.075` (the clamp) | 4,830 | **23.24%** |
| the 50 interior values | 11,725 | 56.40% |

**43.6% of services sit on one of the two endpoints**, so `flip`'s "magnitude" is for most of the
population a two-level bucket and for the rest a 1/40 grid. This is not a defect in the term — the
separator's rate was measured on this same field — but it decides which shape is FAITHFUL: an AUC is
a rank statistic, so **`rank` is the faithful translation of the finding**, and `flip` additionally
assumes the magnitude carries information that a clamped bonus largely does not. Both are therefore
reported, and any verdict has to name the shape it is about.

The public declaration of this shape said "Raw feature-score decomposition" next to seven bare field
names while the tree package's own copy carried the formulas — which is how a screen came to read a
clamped bonus as a coefficient of variation. `MetricScoreBreakdown` in `packages/core` is now the one
documented declaration, and the tree's `MetricBreakdown` extends it rather than restating it, so the
compiler is the guard against the two drifting apart.

`flip` is max-normalised like every other fusion term, so the service carrying the LARGEST bonus —
the most dispersed one — is the origin and the term is a **distance** rather than a level. Both shapes
are inert when the case holds fewer than two measured compositions (one bonus is not a comparison),
and both average the ranks of equal values, because two services the statistic cannot tell apart must
not be separated by whichever one a sort left first.

## 2. Absent is not zero, and it is measured

A service whose decisive composition the block did not render gets a slope of **0** — no credit.
Returning it the term's maximum for a measurement nobody made is the error this family exists to
avoid, and `flip` would do exactly that if `undefined` were read as `cv = 0`.

That choice is not hypothetical, so the instrument prints its footprint: on the first 409 cases of
run `35107871516`, **20,436 of 20,862 services (98.0%)** carry a composition. The gate is on the
report, not on the reader's goodwill:

```
  evidence: 409 cases; with a decisive composition 20436 of 20862 services; with a SPREAD the term
  can act on 409
```

A case with two measurements that AGREE is listed as measured and is not counted as comparable —
a distinction a bare "measured" count cannot express, and the one that separates a data gap from a
negative result.

### The two provenances are the same measurement, checked rather than assumed

`metricDecisive` renders the decisive metric for EVERY service, while `metricTop` renders at most
three and only for the ground truth and the engine's predictions. A term may only be simulated over
the candidates `metricTop` never mentions if the two lines agree where they OVERLAP, so they were
compared: on the same 409-case snapshot, **2,200 of 2,200 services carrying both** agree on all seven
decomposition fields AND on the score — **100.00%**. The pair table's reading and the simulation's
reading are therefore one measurement, not two that happen to look alike.

## 3. The instrument defect this found before it could matter

The parser's own contract says it "can also be pointed at a downloaded CI artifact". It could not:

| input | cases read |
| --- | --- |
| a saved dump (fixtures, stripped) | 1422 |
| a raw job log, as a download gives it | **0** |

GitHub's log transport prefixes **every line** with `YYYY-MM-DDTHH:MM:SS.fffffffZ `. The dump's
grammar is column-anchored — `DIAG` at column 0, two spaces for a service, four for a metric — so a
tagged log parses to nothing, and nothing reads exactly like a run that produced no cases. Three
saved fixtures on this repo's disk are the stripped form, which is why the gap survived: nothing had
ever pointed the reader at its raw input. `stripLogPrefix` does it once, at the entry, rather than as
a leading `\s*` in every pattern — that would be a second, weaker definition of the indentation the
parser is actually reading. It is idempotent, and the census output on a stripped fixture is
**byte-identical** before and after, so both forms are accepted by construction rather than by
review.

## 4. The full-population verdict

Solved on **all 1422 cases** of run `35107871516` (shipped configuration; 159 MiB log):

```
cases 1422; correct at 0 756
unreachable at every weight: flip 569, rank 526
  flip   3  [0.021536, 0.024882]  width 0.003345  ship 0.023209  lostAtShip 0
  rank   6  [0.029860, 0.030480]  width 0.000620  ship 0.030170  lostAtShip 0
```

`unreachable` is printed **per shape**, because it is: an empty admissible set is decided by the
slopes, and the two shapes give the same cv order different spacing. The report used to print one
shape's number above a two-row table, on the claim that both counts came from the base — true of
`cases` and `correct at 0`, false of this one. The smallest input that separates them is a
three-service case whose root is capped in one spacing and not the other; the instrument's own
tests carry it.

**The instrument's self-check is exact.** `correct at 0` is 756, and 756/1422 = **53.16%** is the
run's own published Top@1 — the reconstruction reproduces the engine's ranking case for case, so a
gain measured against it is a gain against the engine rather than against a second implementation.

| shape | gain | window | width | ship | lost at ship | Top@1 claimed | cap binder |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `flip` | 3 | `[0.021536, 0.024882]` | 0.003345 | 0.023209 | **0** | 756 → 759 (+0.21pp) | `ts5-ts-security-service-request-replace-method-7xn7ks` |
| `rank` | **6** | `[0.029860, 0.030480]` | 0.000620 | 0.030170 | **0** | 756 → **762 (+0.42pp)** | same case |

The `rank` claim of 762 was **not** delivered: the run at that weight reached 761 (§4, "The
dispatched run"). The prediction stands as the reconstruction's own number, and the margin list
that now accompanies it is the reason the two differ.

Gains by fault type (`rank`): `JVMMemoryStress +2`, `HTTPResponseDelay +1`,
`HTTPResponseReplaceBody +1`, `HTTPResponseReplaceCode +1`, `JVMException +1`. `flip` collects three
of them.

### Verified twice, by two paths

1. **Per-case closed forms.** Re-deriving each gained case's requirement weight from its own
   affine scores gives `0.006672, 0.016982, 0.027498, 0.027916, 0.029710, 0.029860` — the solver's
   gain profile **value for value**. (The first attempt at this audit re-wrote the slope as
   `(max − cv) / max` instead of calling `cvSlopes`, which reported the `flip` floors for a `rank`
   solve and "3 promoted" against a gain of 6. One owner, including in a throwaway script.)
2. **Direct re-ranking**, at five weights, with no interval arithmetic involved:

| `w` | `rank` correct | lost | `flip` correct | lost |
| --- | --- | --- | --- | --- |
| 0 | 756 | 0 | 756 | 0 |
| `gainFloor` | 761 | 0 | 758 | 0 |
| `cap` | **762** | 0 | **759** | 0 |
| `cap + ε` | 761 | **1** (`…7xn7ks`) | 758 | **1** (`…7xn7ks`) |
| `ship` | **762** | 0 | **759** | 0 |

So the two-sided claim holds: nothing is lost up to the cap, the binder case is lost immediately
past it, and the cap is TIGHT. Note the floor is a **knife edge** — at exactly `gainFloor` the
direct count is one short on both shapes — which is precisely why the shipping rule takes the
MIDPOINT of `[gainFloor, cap]` rather than the floor.

### The dispatched run: what the engine delivered, against what the screen claimed

Neither path above is independent of the other — both are the same reconstruction from the same
dump, so they agree by construction. The third path is the engine, and it disagrees by one case.
The pair (`stabilityWeight` is an opt-in fusion weight defaulting to 0, so the control needs no
pin):

| run | configuration | Top@1 | Top@3 | Top@5 |
| --- | --- | --- | --- | --- |
| `35125285784` | shipped (`stabilityWeight=0`) | 53.2% (**756**) | 66.5% | 70.3% |
| `35125277962` | candidate (`stabilityWeight=0.03017`) | 53.5% (**761**) | 66.7% | 70.5% |

The control reproduces the published headline exactly, which is what licenses reading the
difference as the term's. The candidate gains **five** cases, one per type, and regresses **none of
the 25 fault types**:

| fault type | control | candidate |
| --- | --- | --- |
| `HTTPResponseReplaceCode` | 160/231 | **161/231** |
| `JVMMemoryStress` | 12/171 | **13/171** |
| `HTTPResponseDelay` | 52/89 | **53/89** |
| `HTTPResponseReplaceBody` | 45/51 | **46/51** |
| `JVMException` | 30/43 | **31/43** |

So the screen claimed **6** and the engine delivered **5**. The case it did not collect is the one
the screen's own six-way margin list names as thinnest:

```
margin: thinnest 1.054e-4 (ts0-ts-inside-payment-service-stress-5qd9rl vs ts-station-service);
        one rank step 6.034e-4; 2 of 6 gains inside one step
```

`1.054e-4` is a sixth of one rank position of the term (`0.03017 / 50`), and the next-thinnest gain
holds `3.129e-4`. The dump renders every input at three decimals (`fmt` = `toFixed(3)`), so the
reconstructed base is itself only good to about `1e-3` — an order of magnitude above the margin the
sixth gain rested on. **The sixth gain was never resolvable from the dump**, and the count alone
could not say so: `gain 6` reads identically whether the six are separated by `1e-2` or by `1e-4`.

**That is now the WHOLE explanation rather than one of two.** While the reconstructor's metric term was
building a different quantity on part of the population, this paragraph had to leave room for a second
cause — a base whose gaps are wrong by a comparable amount produces the same one-case error with no
rounding involved. Measured after the correction (§"The cause, and the fix"), the FSE'26 dump has **0
of its 1422 cases below the engine's rescale threshold** (all 1417 + 5 are 51- or 52-service systems),
so the old base could not have contributed anything on this benchmark at all, and the gap is the
render's. The two statements are not in tension: the resolution bound is a SCALE and was already
measured, and the base defect is now known to have had an empty population here.

The resolution bound is *not* a threshold that reproduces the split — `3.129e-4` is also under
`1e-3` and the engine did collect that case — so nothing here is calibrated to the observed five.
What the margin does is make the frontier readable **before** a run: a gain a tenth of a rank from
losing its lead is a different claim from one that would survive a whole rank, and the report now
says which is which. The engine remains the arbiter, which is the standing rule for this axis — the
screen licenses a candidate run, not a weight.

### The resolution, as a distribution rather than a bound

The paragraph above states the bound; the instrument now measures it. `gainResolution` redraws every
field a screen reads at the quantum the producer discarded (`selfAnomaly`, `logScore`, `latRise`,
`cv`, each `±5.0e-4` for the formatter's three decimals) and re-solves each named gain through the
**screen's own** builder, so the ensemble is a property of the artifact rather than of a second
implementation. 400 draws from a seeded sequence, so two runs over one dump print the same numbers:

| shape | count distribution at `ship` | gains holding in every draw |
| --- | --- | --- |
| `flip` | 3 in **95.3%**, 2 in 4.8% | 2 of 3 |
| `rank` | 6 in 22.5%, **5 in 36.0%**, 4 in 30.5%, 3 in 8.8%, 2 in 2.3% | 1 of 6 |

**The engine's five is the modal outcome.** That is the strongest form of the claim the margin could
only gesture at: `gain 6` was not merely at a knife edge, it was the *least* likely of the three
largest counts, and the run that delivered five landed on the peak of the distribution the dump
itself implies. The `flip` shape, whose three gains hold 95% of the time, is the control: the
instrument is not pessimistic by construction, it is sharp enough to separate the two shapes.

Three properties make this usable rather than decorative:

- **the quantum is imported, not restated.** `SERVICE_FIELD_DECIMALS` is the producer's own
  constant, `fmt` renders with it, and the analyzer derives `DUMP_HALF_QUANTUM` from it — so a
  producer that starts printing six decimals moves the reported bar without anyone editing the
  analyzer. A local `3` would keep printing `1.0e-3` at exactly the moment the claim became wrong.
- **the draw is a constant, not a clock.** Two runs over one dump print the same ensemble; a number
  that moved between them would be a property of the draw and not of the dump.
- **the box is drawn uniformly, not adversarially.** Every gain can be lost by putting the whole
  quantum on one side of its lead, so the adversarial corner says nothing; what a reader needs is
  how much of the box still satisfies it, which is what the histogram is and what `least` reports as
  a sound lower bound.

### The golden, measured AT the weight: the veto

The nine-cell gate at the enrolling commit is the default path, where the weight is 0 — so it verifies
the enrolment and says nothing about 0.03017. `earliest-only` is the precedent for caring: it passed
the FSE'26 half of this criterion completely and then moved six of nine cells by up to 41pp. A
measurement was therefore impossible from CI until the second benchmark could spend a flag, and it
now can: `run-rcaeval.ts` gained `--stability-weight` (default read from the engine's
`DEFAULT_STABILITY_WEIGHT`, malformed values falling back to the published one, the value forwarded
and printed in the banner) and `benchmark-rcaeval.yml` the matching `workflow_dispatch` input.

| run | configuration | RE1 OB | RE1 SS | RE1 TT | RE2 OB | RE2 SS | RE2 TT | RE3 OB | RE3 SS | RE3 TT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| golden | default (`stabilityWeight=0`) | 80.0 | 92.8 | 68.0 | 82.4 | 88.9 | 68.1 | 80.0 | 45.0 | 51.1 |
| `35132525118` | `stability_weight=0.03017` | **79.2** | 92.8 | **67.2** | 82.4 | 88.9 | **52.3** | 80.0 | **47.5** | 51.1 |

**Four of nine cells move, one of them by 15.8pp** (`RE2 TrainTicket` 68.1 → 52.3). The term buys
**+5** on FSE'26 and costs four golden cells: under the shared kill criterion — golden 9-cell
identical AND zero regressed fault types — this weight is **rejected**, and the default stays 0. The
dispatch returned 204, which is itself the proof that the input name matched the workflow definition
(GitHub rejects an unknown input with 422), so the run genuinely carried the flag.

What that settles is the WEIGHT and not the statistic. The reopening condition is therefore narrower
than the one this document was written under, and it is now two-sided: a weight whose golden is
identical **and** whose FSE'26 gain is not inside the dump's rounding — the second half being what
§"The resolution" above now measures offline, before spending a dispatch.

### The second benchmark now produces the same artifact

Every screen in this document reads one input: a diagnostic dump. Until now only the FSE'26 runner
produced one, so a weight's golden half had to be measured by a dispatch — one run per weight, ~50
minutes each, and the answer arrives only after the money is spent. `run-rcaeval.ts` now emits the
SAME dump (`--diagnose-dump <path>`, driven by `benchmark-rcaeval.yml`'s `diagnose_dump` input), so
one dispatch buys every subsequent weight: the screens run on the golden's own case set, offline.

Three things had to be true for that to be one artifact rather than two that look alike:

- **One writer.** The block is assembled by `buildFSE26Diagnostic`, which moved out of the FSE'26
  runner into the engine's package beside the formatter. It is what found the second defect: that
  runner read the two per-case quantities it derives — the failed-edge RECORD count and the inbound
  latency rise — out of the raw converter's tuples, while the loaded case already carried the
  loader's normalised form of both, filtered the same way (the conversion is 1:1, asserted). Two
  sources for one number is a defect even when they agree, and it was the reason a second runner
  could not reuse the builder at all.
- **One hook.** `BenchmarkRunner.runSuite` takes an optional per-case sink and hands it the case, the
  graph the engine built and the ranking it returned — nothing pre-chewed, and nothing for a case
  whose analysis threw. The runner does not know the format; the sink does.
- **The mapping is a function, not a closure.** `renderDiagnosedCase` decides the three things that
  are benchmark-specific and each of them can make a dump lie: the accepted SET (multi-label cases
  must be whole), the injection ANCHOR (`0` when the run disabled it — reporting the case's own time
  would license a temporal window the engine never ran), and the case id (or no reader can join the
  dump to the results table).

What an RCAEval dump does NOT carry, stated because a reader will notice it: RCAEval cases have no
`edgeLatency` and no `failedTraceEdges`, so `latRise` renders as `-` (absent, never `0`) and
`failedEdgeRecords` is `0` for every service — the truth about the engine's INPUT, not a measurement
of the case. The instrument says so itself: `correct at 0` in the screen's own header is the
reconstruction's fidelity line, and a dump whose latency term cannot be reproduced lowers it
visibly instead of silently.

The measurement this unlocks is the next one: dispatch `diagnose_dump`, then solve the stability
window (and the family and onset windows) against the golden's own cases and compare the weight the
golden side permits with the `0.03017` the FSE'26 side wants.

### What the first dispatch measured — and the two defects it exposed

The dispatch ran (`35170948792`, `diagnose_dump=1`, `5233678`), the artifacts came back, and the
dumps are readable. Two of the seven described less of their run than they appeared to.

**The dump held one system of three.** `--suite re1` evaluates 125 cases in each of Online Boutique,
SockShop and Train Ticket; the artifact held **125 blocks and every one of them was tagged `re1tt`**.
The runner built the text per group and called `writeFileSync` INSIDE the group loop, so each system
truncated the last one's, and the console printed the same `125 cases, 125 blocks` three times while
it happened — a number that reads as complete precisely because it is plausible for RE1. It is the
same failure the workflow's own per-invocation filenames were added to prevent, one layer down: three
systems share one invocation.

**The dump carried no configuration.** `Config:` appears **0** times in all seven RCAEval dumps,
against the FSE'26 dump, which opens with the run's own line. The consequence is not aesthetic: the
`re3` dump is the only one dispatched with `traceWeight=1`, and it reconstructs to `correct at 0 1`
against its own `prediction=` 15 — an alarm no reader of that file could explain, because the file
did not say the trace term was on.

Both are fixed by one owner for the file (`DiagnoseDump`, `benchmarks/src/fse26-diagnose-dump.ts`):
records accumulate across every group, `write()` happens once after the last group, a record after
the write and a second write both RAISE, and the file opens with `formatSignalLine(opts)` — the very
string the console banner prints, so the two cannot describe different modes. The console line now
reports the count with its groups: `9 cases: OnlineBoutique:RE1 3, SockShop:RE1 3, TrainTicket:RE1 3`.

Measured on a three-system fixture, same input, old code vs new: **3 blocks, all `re1tt`, no header**
versus **9 blocks, `re1ob 3 / re1ss 3 / re1tt 3`, header = the banner line.**

### Fidelity: which dumps the screens may be run on

`correct at 0` is the reconstruction's own fidelity line. The comparison is against the dump's OWN
`prediction=` list — the rank the engine returned — because that is the only headline an artifact can
be held to, and because it is the one number a reconstruction cannot talk its way around. Measured on
the dumps the fixed runner produced (`35175577233` at `ecfc439`, all SEVEN of them now holding every
system the suite covered):

| dump | cases | groups | `traceWeight` | dump `prediction=` | screen `correct at 0` | Δ | cases raw / rescaled |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `re1` | 375 | ob 125 / ss 125 / tt 125 | 0 | 301 | **301** | 0 | 250 / 125 |
| `re1-noinject` | 375 | ob 125 / ss 125 / tt 125 | 0 | 301 | **301** | 0 | 250 / 125 |
| `re2` | 150 | ob 50 / ss 50 / tt 50 | 0 | 119 | **119** | 0 | 100 / 50 |
| `re2-noinject` | 150 | ob 50 / ss 50 / tt 50 | 0 | 119 | **119** | 0 | 100 / 50 |
| `re3` | 90 | ob 30 / ss 30 / tt 30 | **1** | 48 | 35 | **−13** | 57 / 33 |
| `re3-noinject` | 90 | ob 30 / ss 30 / tt 30 | 0 | 37 | **37** | 0 | 57 / 33 |
| `re3-novelty` | 90 | ob 30 / ss 30 / tt 30 | 0 | 37 | **37** | 0 | 57 / 33 |

The last column is the base correction's own footprint, read off the instrument
(`metric term: read from each row (N cases raw, below the engine's rescale at 20 nodes; M rescaled)`,
with `values above 1: 0 cases` on all seven): **407 of the golden's 615 cases are below the
threshold the old base got wrong**, and every one of them is an OnlineBoutique or SockShop case.

**Six of seven exact, and the seventh is the one term the reconstruction does not model.** The `re1`
number is the strongest single check available, because it is checkable against the published table
independently of the dump: `80.0% × 125 + 92.8% × 125 + 68.0% × 125 = 100 + 116 + 85 = 301`, i.e. the
pooled counter reproduces all three of RE1's golden cells at once. And the divergence is not small
noise — 48 against 35 — which is the point: a reconstruction that cannot express a term must not
return a number that looks like a slightly worse run. **So a `traceWeight=0` dump is screenable and a
`traceWeight>0` dump is not, and the instrument says which it is holding.**

The denominator trap is worth stating in the same breath, because it makes a correct reconstruction
look like a defect: the published tables quote an AVERAGE of per-fault-type rates, while a
reconstruction produces a POOLED count. For `re2` the golden cells are `82.4 / 88.9 / 68.1`, whose
`× 50` gives `41.2 + 44.45 + 34.05 = 119.7` against the pooled 119 — and for a single system, `re2`'s
TrainTicket is `68.1%` averaged over seven fault types where the pooled rate is `33/50 = 66.0%`.
Compare against the dump's `prediction=` list, never against the average.

### A weight the CALLER names, read on the golden's own cases

The window answers "which weight is best here". The re-opening condition asks the other question —
"is candidate W neutral on this benchmark" — and until now that could only be answered by buying a
run, which states it as cells moved rather than as cases gained and lost. `--cv-screen` and
`--onset-screen` now take `--at-weight <w>` and report the SAME case set read at the weight the caller
named, with the datapacks behind both counts:

```
  at 0.030170: correct 294, gained 6, lost 13
    lost: rcaeval-re1_re1tt_ts-auth-service_delay_4, ... (13 named)
    gained: rcaeval-re1_re1tt_ts-auth-service_cpu_5, ... (6 named)
```

Measured on the dumps the fixed runner produced (`35175577233` at `ecfc439`), for the weight FSE'26
solves for and the golden vetoes, at the screen's DEFAULT (`flip`) shape:

| dump | cases | correct at 0 | at `0.030170` | gained | lost |
| --- | --- | --- | --- | --- | --- |
| `re1` | 375 | 301 | **294** | **6** | **13** |
| `re2` | 150 | 119 | **107** | **0** | **12** |
| `re3-noinject` | 90 | 37 | 37 | 0 | 0 |

(These three rows were `295 / 7 / 13` for `re1` before the base correction; the other two are unchanged.
Relative to the engine's OWN term — the `rank` shape — the counts are `300 / 1 / 2`, `111 / 0 / 8` and
`37 / 0 / 0`, and those are the rows to compare against a run: see §"The cause, and the fix".)

So the trade the veto rests on, in the units the FSE'26 side reported (`+5 cases, 0 regressed fault
types`), is **+5 there against `+6 / −13` on RE1 and `+0 / −12` on RE2** — a net −19 on the golden,
and every one of the 25 given-up cases is NAMED rather than inferred from a rounded cell. Note too
that the window on `re1` closes at `0.015233`, so `0.030170` is twice past the cap the screen would
have shipped under: the recommendation and the veto are not in tension, they are two readings of one
model at two different weights.

Two properties make the number usable, and both are asserted. It is absent from the report when no
weight is named, so the default output is byte-identical to what it was before the flag existed. And
the flag is REFUSED unless `--cv-screen` or `--onset-screen` was also requested — the file's own
`--log-weight` rule, applied to the other side of the same question, because a flag accepted and
rendered nowhere is how a flag becomes ritual.

**That verdict is measured on the shape the ENGINE does not use, and the shape it does use agrees with
the engine on 613 of 615 flips.** The table above is the screen's DEFAULT row — the `flip` shape, which
reads the MAGNITUDE of the clamped bonus — while the engine's own term is a RANK of it:
`computeStabilityScores` assigns `(n − 1 − avgRank) / (n − 1)` over the dominant metrics' `breakdown.cv`
(`ranking-signals.ts` 707), i.e. the screen's `rank` shape, which §1 calls the faithful translation. The
paired dispatch (`35181249060`, `stability_weight` AND `diagnose_dump` together) makes the dump's own
`prediction=` list the engine's ranking AT the weight, so the three counts are one measurement by two
routes:

| dump | screen `rank` at 0.030170 | engine at 0.030170 | screen gained / lost | engine gained / lost |
| --- | --- | --- | --- | --- |
| `re1` | 300 | **299** | 1 / 2 | **1 / 3** |
| `re2` | **111** | **111** | **0 / 8** | **0 / 8** |
| `re3-noinject` | 37 | **38** | 0 / 0 | **1 / 0** |

The engine's columns are a case-by-case diff of the two dumps' `prediction=` lists, so they are the
engine's OWN flips. On `re2` the screen reproduces the engine exactly, names included. The two cases
where it still does not are NAMED rather than inferred, and both are the same mechanism — see the end
of §"The cause, and the fix".

### The cause, and the fix

A wrong QUANTITY in `blendScores`, and a CONDITION on the engine's side that the reconstruction did not
have. The engine's `finalScore` takes `Math.log1p(selfScores.get(id))`, and `selfScores` is filled by
`selfScores.set(node, nodeAnomaly)` — the node's anomaly score **as the topology builder left it**
(`pruner.ts` 1400 and 1575). That builder rescales the vector in step 1b, and step 1b is guarded:

```ts
if (callGraph.nodes.size >= ANOMALY_NORMALIZE_NODE_THRESHOLD) {   // 20, now an exported owner
  if (cfg.rankNormalization) { … rankNormalizeScores(anomalyScores) } else { … min-max … }
}
```

So the column is a **rescaled position** at or above 20 nodes and a **raw deviation** below it — and the
reconstruction substituted `Math.log1p(metricSlopes(...))` for it UNCONDITIONALLY. `metricSlopes` was
the engine's rank rescale (`(n − 1 − i) / (n − 1)`, tie groups averaged), which is the same quantity
only where the engine rescaled. Below the threshold the reconstruction had the engine's ORDER (any
rescale here is strictly monotone, so every order-only check passed and always would have) and invented
its GAPS — and every flip under a perturbation is decided by a gap.

**The population the substitution could not have been right on is 407 of the golden's 615 cases** (re1
250 of 375, re2 100 of 150, re3 57 of 90 — the OB and SS systems, at 12–19 services) and **0 of the
1422 cases on the FSE'26 side**, where every case is a 51- or 52-service system (measured: `{51: 1417,
52: 5}`, below-20 count `0`). Which is why the FSE'26 half of this document never saw it.

**The fidelity line was printing a number that could not fail.** `metric term: max |recomputed −
printed| = 2.51e+0; services above 5e-4: 3500` on `re1` — a maximum deviation of 2.51 across 3500 of
11557 services, rendered as one more figure in a section whose entire job is to say whether the
reconstruction reproduces the run. It has no unit: a reader cannot tell "the last printed digit" from "a
different quantity", and 5e-4 was quoted as a threshold without one. The check that CAN fail was not
being made, and the direction it can fail is the one the defect lived in: at or above the threshold no
value may EXCEED 1, because both of the engine's rescales put the case maximum at 1 and neither can
produce anything above it. Below the threshold no claim is made, since a raw deviation is unbounded in
the rise direction and is whatever the case's data made it.

**The stronger form of that check was written first, and the first dump it was pointed at falsified
it.** "At or above the threshold the maximum IS exactly `1.000`" reads 34 failures on the FSE'26 dump —
and the dump is right, the claim was wrong. `rankNormalizeScores` gives a value's TIE GROUP the MEAN of
the ranks it occupies, so a case whose largest anomaly is shared by six services reads
`47.5 / 50 = 0.95` (one of the 34, `ts2-ts-route-plan-service-request-abort-rnjzzl`, is exactly that);
only a strictly unique maximum maps to 1. So the line reports `values above 1: N cases` as the defect
claim and the sub-1.000 maxima as a POPULATION fact with its cause named — because a reader who sees a
0.95 maximum needs to know it is arithmetic rather than a missing rescale.

**The fix is to READ the column.** `blendScores` and `rankCase` now take `Math.log1p(service.selfAnomaly)`
— the engine's own `selfScores` entry, the value the producer prints on the row — so the reconstruction
is faithful on both sides of the boundary without having to know where the boundary is. `metricSlopes` is
gone: it existed only to derive a quantity the artifact already carries, and it is the mechanism by which
a consumer could silently substitute a transformation for a measurement. The threshold is now an exported
owner (`ANOMALY_NORMALIZE_NODE_THRESHOLD`, with a test that pins both sides of it on a real graph), the
producer's `selfAnomaly` contract no longer claims "[0, 1] rank-normalised" — which was false for every
case below the threshold — and the fidelity section reports the POPULATION the threshold decides plus the
falsifiable check, instead of a deviation. On the golden's four dumps the check reads `0` across the 208
rescaled cases and the population line reads `250 raw / 125 rescaled` (re1), `100 / 50` (re2), `57 / 33`
(re3) — the defect's size, printed by the instrument, for the dump being read. On the FSE'26 dump the
same two counters read `0 raw / 1422 rescaled`, `values above 1: 0` and `below 1.000: 34`.

**What the correction moved, and what it did not** (same dumps, `35175577233` at `ecfc439`, before →
after):

| measurement | before | after |
| --- | --- | --- |
| `correct at 0`, all seven dumps | 301 / 301 / 119 / 119 / 35 / 37 / 37 | **identical** |
| `rank-1 same as the dump’s own recorded` | 375/375, 150/150, 90/90, 70/90 | **identical** |
| `re1` `flip` ship / window | `0.007968` / `[0.007968, 0.007968]` | `0.008032` / `[0.008032, 0.008032]` |
| `re1` `rank` cap | `0.015112` | `0.015233` |
| `re1` at `0.030170`, `flip` | 295, gained 7, lost 13 | **294, gained 6, lost 13** |
| `re1` at `0.030170`, `rank` | 300, gained 1, lost 2 | **identical** |
| `re2` at `0.030170`, both shapes | 107 (0/12) and 111 (0/8) | **identical** |
| `re3-noinject` at `0.030170`, both shapes | 37 (0/0) | **identical** |
| `re1` `unreachable` at every weight, `flip` / `rank` | 48 / 56 | **46 / 52** |
| FSE'26 (1422 cases): `correct at 0` 756, `rank` gain 6 at `[0.029860, 0.030480]`, ship `0.030170`, `flip` gain 3 at `[0.021536, 0.024882]`, both margins | — | **identical, byte for byte** |

So every fidelity number survived, the whole FSE'26 half is unchanged, and what moved is exactly the
golden's window arithmetic — restated above and nowhere else in this document, because the other
figures in §"The resolution" are the FSE'26 ones that did not move. The one FSE'26 number that DID move
is the resolution histogram, and for a reason worth stating: `gainResolution` resamples the render's
discarded digits, and under the old base a resampled row was re-RANKED, so a jittered input could move
the term by a whole rank step (≈`1/50`) instead of by the digit error it was meant to represent. At
`0.030170` the `rank` shape's six gains now hold in 23.5% of the 400 seeded draws, five in 37.3%, four
in 29.3%, three in 9.3%, two in 0.8%, and **2 of 6 in every draw** (the old base read 22.5 / 36.0 / 30.5
/ 8.8 / 2.3 and **1 of 6**). The claim that matters is unchanged: the count the screen ships is not the
count the dump can decide.

### The two residuals, named — and one of them is now a CLASS

The screen and the engine still disagree on two of the golden's 615 flips, and both are the artifact's
own precision rather than the reconstruction's arithmetic:

- `re3ss_front-end_f3_2` (15 services): the engine flips `user` (0.753) to `front-end` (0.751), the
  ground truth, and the deciding pair both renders `cv=0.045`. **This one is the GAIN side**, and it is
  now a class the instrument counts: the root is behind a rival the term reads as EQUAL, so no weight
  can satisfy the case at all and it is one of the `tied at the render` cases below.
- `re1ob_currencyservice_delay_4` (13 services): the engine flips `currencyservice` (anomaly 2.207) to
  `checkoutservice` (2.199) — a metric gap of `log1p` difference `0.0080` — and the two contenders'
  decisive compositions both render `cv=0.050`. **This one is the CAP side**: the case is correct at
  `w = 0` and the model keeps it correct at every weight, so it is NOT in the unreachable count at all.
  **It is now named by the instrument**: it is one of the 31 members of the `cap UPPER bound` class on
  `re1` (§"The cap is an UPPER bound"), which is the class a reader is told to distrust rather than a
  case that has to be found by diffing two runs.

The engine's stability term ranks on the UNROUNDED `breakdown.cv` (`ranking-signals.ts` 707 reads the
field, not the dump), so a pair the artifact renders as one tie is a pair the engine can order — and no
weight can reorder it from the dump, at any magnitude. The tie group can hide several rank positions at
once: at 3 decimals two services can render `0.050` while their ranks differ by 2 of 8.

### The unreachable count now says WHY

`unreachable at every weight` was one number, and it read the same whether the term had no input, read a
pair as equal, or genuinely could not reach. It is now a partition, measured on the same dumps:

| dump | shape | total | root without a row | no spread | unweighed | **tied at the render** | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- |
| FSE'26 (`35107871516`, 1422 cases) | `flip` | 569 | 0 | 0 | 0 | **236** | 333 |
| FSE'26 | `rank` | 526 | 0 | 0 | 0 | **226** | 300 |
| `re1` (375 cases) | `flip` | 46 | 0 | 3 | 0 | **18** | 25 |
| `re1` | `rank` | 52 | 0 | 0 | 0 | **20** | 32 |
| `re2` (150) | `rank` | 24 | 0 | 0 | 0 | **11** | 13 |
| `re3-noinject` (90) | `rank` | 37 | 0 | 0 | 0 | **25** | 12 |

**41.5% of the FSE'26 unreachable population and 68% of `re3-noinject`'s are cases no weight can decide
from this artifact** — they are the resolution limit of the `cv` field, printed as a class instead of
being discovered by hand. The totals themselves did not move — measured before and after the split on the
same dumps: 46/52, 25/24, 39/37 and 569/526, identical — which is what makes this a refinement of the
count rather than a new count.

**The fifth class is the one the split had been conflating, and it reads `0` everywhere above**: an equal
slope where the term weighed NEITHER side. Equal slopes arrive two ways — the render collapsed two
measured services, or one of them was never measured at all — and they have opposite fixes, so they are
now two classes. On these five dumps every equal pair is a render tie, so no attribution moved; the class
is pinned by a fixture (`cvs: [undefined, undefined, 0.1, 0.9]`) and by a mutation of the classifier that
merges it back into `tied at the render` and fails exactly two assertions.

### The cap is an UPPER bound, and now says so

The mirror of `tied at the render`, on the side the window promises to PROTECT. A satisfied case whose
acceptable root LEADS a rival the term reads as EQUAL carries no bound from that pair in the model —
equal slopes mean the score gap between them is the base gap at every weight — while the engine, ranking
the unrounded field, splits the pair and gets a real bound out of the same two services. So the cap is
not the cap; it is an upper end, and one case the engine lost at `0.030170` was exactly this.

Measured on the same dumps, for both shapes (the class is a property of the INPUTS — both shapes are
strictly monotone in `cv`, so a tied pair is tied under either — and every dump below reports the same
count twice):

| dump | satisfied | cases the artifact cannot order | of which the cap's own case |
| --- | --- | --- | --- |
| FSE'26 (`35107871516`, 1422 cases) | 756 | **510** (67.5%) | **yes** |
| `re1` (375) | 301 | **31** | no |
| `re1-noinject` (375) | 301 | **31** | no |
| `re2` (150) | 119 | **14** | `flip` yes / `rank` no |
| `re2-noinject` (150) | 119 | **14** | `flip` yes / `rank` no |
| `re3` (90, `traceWeight=1`) | 35 | **12** | no |
| `re3-noinject` (90) | 37 | **13** | no |
| `re3-novelty` (90) | 37 | **13** | no |

**On FSE'26 two thirds of the population the cap protects is a case the artifact cannot decide, and the
cap's own case is one of them** — so that window's right-hand end is not merely loose, it is set by a
pair the artifact renders as one number. On the golden the class is 31 / 14 / 13 and, for `re2`'s `flip`
shape, the binder is a member.

**A count is not a bound, so the class carries one.** How far the looseness can reach is derivable
rather than merely acknowledged: two services whose rendered `cv` is equal have unrounded values inside
one rounding cell, so their ranks are CONSECUTIVE among the cell's `g` members and their slope gap
cannot exceed `(g − 1)/(n − 1)`. The earliest weight at which such a pair can cost its case is therefore
`lead / span`, and the smallest of those over the class is the `lossFloor` the report prints beside the
cap. What it buys is a verdict per shape, measured on the same dumps:

| dump | shape | `lossFloor` | `cap` | verdict |
| --- | --- | --- | --- | --- |
| FSE'26 | `flip` | **0.003873** | 0.024882 | **BELOW** — the artifact permits an earlier loss |
| FSE'26 | `rank` | **0.003873** | 0.030480 | **BELOW** |
| `re1` / `re1-noinject` | `flip` | 0.008032 | 0.008032 | AT OR ABOVE |
| `re1` / `re1-noinject` | `rank` | **0.008032** | 0.015233 | **BELOW** |
| `re2` / `re2-noinject` | both | 0.069256 | 0.007528 / 0.012161 | AT OR ABOVE |
| `re3` / `re3-noinject` / `re3-novelty` | both | **0.016369** | 0.180534 / 0.316068 | **BELOW** |

**So the caveat was not a figure of speech, and it is not uniform.** On FSE'26 the recommended window's
right end `0.030480` sits **8× above** the lowest weight the artifact permits a protected case to be
cost; on `re1`'s `rank` shape (the one the engine comparison is read on) the floor is half the cap; on
`re2` the channel cannot bind at all. The floor is NOT a prediction of when a case will go: it is the
earliest the artifact *permits*, and the one engine measurement that exists says the permission is not
exercised — the FSE'26 candidate run delivered **+5 cases with 0 regressed fault types** at `0.030170`,
i.e. the engine's own cap is above that weight, **more than 8× the floor**. A bound that is loose by a
factor is still the difference between "the cap is the cap" and "the cap is the most the model can
claim", and only a run settles which.

**The class is a NECESSARY condition, and that is what makes it checkable**: the model and the engine are
free to disagree only inside it. Measured against the paired dispatch (`35181249060`, `stability_weight`
AND `diagnose_dump` together, engine read in its own `rank` shape):

| suite | class | model / engine correct at `0.030170` | engine lost | the engine lost, the model kept |
| --- | --- | --- | --- | --- |
| `re1` | 31 | 300 / **299** | 3 | `currencyservice_delay_4` — **in the class** |
| `re2` | 14 | 111 / 111 | 8 | (none: the two agree case for case) |
| `re3-noinject` | 13 | 37 / **38** | 0 | (none: the engine's one move is a GAIN, on the unreachable side) |

**Exactly one case on the satisfied side is a disagreement — and it is inside the class.** Every other
case the engine lost at that weight is one the model predicts losing as well (2 of the 3 on `re1`, all 8
on `re2`, where the two lists are the same eight names), so the class is a superset of the disagreements
rather than a prediction of the losses: 31 cases to distrust for 1 actual failure. That direction
matters. A class that MISSED a disagreement would be a defect; a class that is wider than the
disagreements is a statement of what the artifact cannot express.

Four things the work found:

- **The floor is shape-independent and the cap is not, so the verdict is per shape.** The floor is a
  BASE gap over the engine's own slope spacing; the cap is the shape's own reading of the same cases. So
  the same dump can read `AT OR ABOVE` for `flip` and `BELOW` for `rank` — `re1` does exactly that — and
  a single verdict printed above the two-row table would be a number about neither row. That is the same
  defect this document already records for `unreachable`, and the sentence carries the comparison rather
  than leaving it to a reader.
- **A degenerate tie group is the WIDEST possible span, and that is the honest bound.** `re1`'s floor is
  set by a case whose 53 weighed services all share one slope — every `cv` renders `0.000`, so `flip`
  reads one flat group and `rank` gives the whole group its single mean. The engine can still order those
  53 on the unrounded field, by up to a full `52/52 = 1` slope gap, so `span = 1` is the widest gap the
  artifact permits rather than a parsing artefact. Cases that render flat are the most exposed, not the
  least: the model has literally no term left to order them with.
- **A shape whose detail the menu does not print was stating its cap unqualified.** The menu renders a
  shape's detail only when that shape has something to advise, and summarises the rest in one line — so
  `re2`'s whole screen, and `re1`'s `rank` shape (the one the engine's own comparison is read on), showed
  a cap with no qualification at all. The sentence has ONE owner and both branches now print it, so the
  two cannot drift; what prevents the sentence from appearing twice for a shape is that the branches are
  mutually exclusive per shape, which the suite asserts by counting.
- **The membership is on the OBJECT, not in the report.** On FSE'26 the class holds 510 cases, so a
  printed list would be a page nobody reads. The report owes a reader the count with its DEFINITION
  (printed); a caller cross-checking a paired dispatch's own losses needs the membership, and
  `capUnrepresentable.datapacks` is where a reader — or a test — gets it.

### The second channel: the cap under the digits the dump discarded

`lossFloor` models the RENDER-TIE channel. There is a second one, and the screen had been silent about
it: the base itself is reconstructed from the same three-decimal dump (`selfAnomaly`, `logScore`,
`latRise`), so the cap — a MINIMUM over the cases the base gets right — is a function of which digits were
printed. `gainResolution` already resampled those digits, but it asks only whether the **gains** survive;
nobody asked whether the **protected cases** survive, which is the other half of the same claim. The
screen's own `lost at ship 0` was therefore a one-digit-set measurement.

`capResolution` draws the same box (100 draws, the same seed, every case jittered, the window re-solved
with the same solver — and the box is now the SCREEN's own, see §"The ensemble's box was ONE screen's")
and reports both readings — with the caveat that each is an extreme value of the ensemble, so each is
printed with what makes it readable:

| dump | shape | `cap` | cap over 100 draws | draws the window stays intact at `ship` | worst loss in a draw |
| --- | --- | --- | --- | --- | --- |
| FSE'26 | `flip` | 0.024882 | [0.021964, 0.025871] | **99** of 100 | 1 |
| FSE'26 | `rank` | 0.030480 | [0.010608, 0.033210] | **15** of 100 | 4 |
| `re1` / `re1-noinject` | `flip` | 0.008032 | [0.004600, 0.008740] | **50** of 100 | 2 |
| `re2` / `re2-noinject` | both | — | — | (no gain, so no weight to qualify) | — |
| `re3-noinject`, `re3`, `re3-novelty` | `flip` | 0.180534 | [0.008173, 0.183617] | **1** of 100 | 7 |
| `re3-noinject` | `rank` | 0.316068 | [0.018451, 0.288459] | **0** of 100 | 8 |

The cap's range sits LOW by construction — it is a minimum over hundreds of cases, and the minimum of
noisy quantities is below the minimum of their centres — and `intact` is an OR over those cases, so it
falls with how many the window protects. Neither is a probability. What the pair does say is how the
recommendation's own premise stands up: **on `re3-noinject` the window's `lost at ship 0` holds in
1 of 100 draws (up to 7 of its 37 protected cases go), and on `re1`'s `flip` shape — a POINT window at the
cap — in 50 of 100.** Those windows are inside the artifact's noise, and the sentence they print is a
property of the printed digits.

**And on FSE'26 the one measurement that exists rejects the reading, which is why the run stays the
arbiter.** The `rank` shape — the engine's own coefficient — holds in 15 of 100 draws, yet the candidate
run at `0.030170` delivered **+5 cases with 0 regressed fault types**. The real digit-set was one of the
15. A single draw cannot separate "the model over-states the noise" from "the run was lucky", so what is
recorded is the bound and not a probability: **85% of the digit-sets the artifact is consistent with would
cost a protected case at the recommended weight, and the engine's own run is the one reading that says
otherwise.**

### The ensemble's box was ONE screen's, and the onset screen reads a column it did not contain

`gainResolution` and `capResolution` have been resampling "the digits the dump discarded" since they were
written. What they actually drew was a FIXED set — `selfAnomaly`, `logScore`, `latRise` and `cv` — which is
the DECISIVE-STABILITY screen's input list. The temporal screen reads none of `cv` and all of
`onsetDelayMs`, and that field was never drawn: the ensemble held the term's only input fixed and reported
the resulting stillness as a result. Measured on run `35107871516`:

| dump | shape | the report said | under the term's own column |
| --- | --- | --- | --- |
| FSE'26 (1422 cases) | `earliest-only` (gain 4) | `4 in 100.0%` | **`4 in 56.0%, 3 in 44.0%`** |
| `re3` (90, `traceWeight=1`) | `earliest-only` (gain 1) | `1 in 100.0%` | **`1 in 60.5%, 0 in 39.5%`** |
| `re3` / `re1` / `re2` | `earliness`, `order`, `latest-only` | `100.0%` | `100.0%` — unchanged, see below |
| all five dumps | `cv` shapes | unchanged | **byte-identical** (the box is the same one) |

**On `re3` the window's single gain does not survive the artifact's own digits at all**: `0 of 1 gains hold
in every one`, in 39.5% of the draws. The line that read `every one of the 1 gains holds in all 400
resamplings` was a statement about the printed digits and nothing else.

**The mechanism is the tie, and it is why only ONE shape is exposed.** `earliest-only` credits the whole
group of services AT the minimum delay, deliberately — the shape is about simultaneity, so it does not let
the service-id comparator decide. The millisecond render is what CREATES those ties: two services at `5000`
stand for real delays anywhere in `[4999.5, 5000.5]`, and the engine's boundary group is an exact-equality
test on them. A sub-millisecond draw therefore does not nudge the slope vector, it REMOVES a member from it
— a discontinuous change, and the only one available to this term. `earliness` is min-max in the delay, so
it moves continuously and by far less than the base's own `±1.0e-3`; `order` and `latest-only` read ranks,
which adjacent integers cannot swap. All three read `100.0%` on every dump, which is a result rather than a
silence: the box is now the right one and the answer is that they are insensitive to it.

**Two things had to be right about the column itself, and one of them was wrong in the first draft.**

- **Its quantum is its own.** The renderer is `Math.round`, so the onset's half-quantum is **0.5 ms** —
  three orders of magnitude from the base's `5.0e-4`, and an ensemble drawing it at the base's resolution
  would be modelling a precision the artifact does not have. It is now an exported owner in the producer
  (`ONSET_FIELD_HALF_QUANTUM`), beside the decimals constant, pinned by the test that also asserts the
  renderer rounds rather than truncates. Measured limit: no behavioural fixture can separate the two
  magnitudes, because ANY nonzero draw breaks an exact tie — so the magnitude is pinned where it is defined
  rather than where it is used.
- **Its cell is ONE-SIDED at zero.** `fmtOnset` prints `-` for any negative delay, so a printed `0` stands
  for `[0, 0.5]` and nothing below it. An unclamped draw takes the service out of the engine's `delay >= 0`
  filter — a value the artifact would have had to spell DIFFERENTLY, not one it discarded. The first draft
  drew it symmetrically: **78 of 100 draws moved the window, against 34 of 60 once the draw stays inside the
  cell.** Half of the mobility the first probe measured was a modelling error of mine rather than a property
  of the dump, and the clamp is now its own exported function so that the boundary is testable.

The report was the third thing, and it was the one a reader acts on: its resolution line stated ONE quantum
for every screen (`the dump renders 3 decimals, so a lead between two services is only good to ±1.0e-3`),
which is the base's and the `cv`'s, and false of the onset. Both ensembles now carry the box they drew and
the report names each column with its own quantum — from one function, so the sentence and the arithmetic
cannot drift.

**The box is a function of the screen, not a superset.** `jitterFieldsFor(screen)` is the single owner,
and a family screen draws neither extra column: its slopes come from the `logic`/`http`/`both` COUNTS, which
are exact integers with no discarded fraction, so drawing one would model noise the format does not have. A
superset box would be the mirror error — noise from fields the screen cannot read.

### The verdict now consumes its own error bars — and on FSE'26 it refuses everything

Both menus carried the same rule, verbatim: `gain > 0 && lostAtShip === 0`. That is a test of the window
on ONE digit-set, blind to both resampling ensembles, and it printed only when the resulting list was
EMPTY — so a shape whose gain holds in **56 of 100 draws** was treated as admissible by a line sitting
under a report that said exactly that. The rule did not move when the error bars did, which is the same
defect as a count that travels without its frontier.

It is now one owner, `admissibilityOf`, generic over the four fields the two screens already compute
(`shape`, `solved`, `resolution`, `capNoise`), and it reports **every** bar that failed rather than the
first — a shape with no gain is a statement about the SIGNAL while an unresolved count is a statement
about the artifact, and the two have different fixes. The menu prints a line per shape when a candidate
exists, and keeps its one sentence when none does.

| dump | screen | shape | verdict |
| --- | --- | --- | --- |
| FSE'26 (1422 cases) | temporal | all four | **refused** — `earliest-only` at 56 of 100 draws |
| FSE'26 | stability | all four | **refused** — `flip` 2 of 3 gains hold in every draw, `rank` 2 of 6 |
| `re1` (375) | temporal | `earliness` | ADMISSIBLE (1 gain, 400 of 400 draws, cap intact 100 of 100) |
| `re2` (150) | temporal | `earliness`, `latest-only` | ADMISSIBLE |
| `re3` (90) | temporal | `earliness`, `order`, `latest-only` | ADMISSIBLE |
| `re3` | temporal | `earliest-only` | refused — the gain holds for the printed digits only (0 of 1) |
| `re1` | stability | `flip` (a POINT window at its own cap) | refused — the cap moves in 50 of 100 draws |
| `re3-noinject` | temporal | all four | refused — no shape has a gain at all |

**Two things follow, and the second is the one that matters.**

**The temporal axis does have admissible windows — on the golden, and they are worth exactly one case.**
`earliness`, the engine's own shape, is admissible on all three suites and its gain is 1 case per suite;
`re3`'s `earliest-only` — the shape with the widest window — is refused, and FSE'26's own shape gains
nothing.

**And the next question was answered by measurement, which REFUTED the answer first written here.** This
section first said the binding constraint on both axes was the dump's own resolution and that a finer render
would buy decidable windows. That is a claim about SCALE, so it was measured by moving the scale and nothing
else — the same dump, the same seed and trial counts, the same solved window, and a quantum `10^-k` smaller
in EVERY field (`refinementFrontier`: one function, `k = 0` short-circuited through the ensembles the report
already has, so nothing published moves). The result, on every dump whose windows the verdict refuses:

| dump | screen | shape | gain | refinement frontier |
| --- | --- | --- | --- | --- |
| FSE'26 (`35035314921`) | temporal | `earliest-only` | 4 | **`beyond`** — weakest survival **56.0% at every `k` up to 6** |
| `re1` | temporal | `earliness` | 2 | **`already`** — admissible at the artifact's own box |
| `re1` | temporal | `order` | 2 | **`beyond`** — the gain side RESOLVES (52.8% → 100.0%) and the cap still moves at `10^-6` |
| `re1` | stability | `flip` | 1 | **`beyond`** — plateau at 46.3% |
| `re3` | stability | `flip` | 7 | **`needs 1`** — one more digit admits it |
| `re3` | stability | `rank` | 4 | **`beyond`** — plateau at 26.8% |
| `re3-noinject` | stability | `flip` | 7 | **`needs 1`** — one more digit admits it |
| `re2` | both | all | 0 | **`structural`** — no gain, so precision is not the question and the sweep is not run |

**A survival rate that does not move is the signature of a rendered TIE.** `earliest-only` credits the root
together with whatever else prints its minimum, and two equal prints are re-ordered by any nonzero draw,
however small — so no refinement of the DRAW settles their order, and the plateau is exact: FSE'26's
`earliest-only` reads `56.0%` at the artifact's own box and `56.0%` at a quantum a million times smaller.
What a finer dump does there is CHANGE the tie rather than refine it, which is a different question from the
one the sweep asks: the sweep holds the print fixed, so it cannot model digits it does not have.

**So the honest form of the claim is narrower than the one first written.** The render IS the obstacle for
exactly two measured windows — `re3`'s and `re3-noinject`'s stability `flip`, both `needs 1` — and for the
rest the residue is either a rendered tie or the other channel. `re1`'s `order` is the case that keeps the
instrument honest: its weakest gain climbs to `100.0%` while the window is still refused, so a clause reading
every `beyond` as a tie would contradict its own evidence; the printed sentence reports BOTH readings and
names the bar still failing.

The pre-registered prediction follows, and it is cheap because it is bounded: **a dump rendered at four
decimals admits `re3`'s and `re3-noinject`'s stability `flip` windows.** That is a claim about a real
artifact, which is the one thing the sweep cannot decide for itself.

Two smaller things the work found, both measured:

- **The four shapes' verdicts are CORRELATED, which is why the menu now prints a block or a sentence and
  rarely a mix.** A printed tie destroys the `earliest-only` gain and `earliness`'s as well: for the
  continuous shape the tie's jitter leaves the pair with a slope difference of order `1e-5`, and the
  weight that would separate them then runs to `±100`. So a case set containing such a pair refuses all
  four shapes together — which is why the refusal rendering is asserted from two real screens rather than
  from a fixture, and why no fixture reaches a mixed menu.
- **A named weight's loss is not `lostAtShip`.** That field is measured at the SOLVED ship, which
  `--at-weight` does not move — the flag answers *"what happens at the weight I name"* BESIDE the
  window's own reading, so a loss there lives in the named verdict (`at.lost`). Reading `lostAtShip`
  reported the named weight as harmless, which is the one reading the flag exists to prevent.

### What this does and does not settle

Settled: the term is not inert, the zero-regression window exists on the whole population, the
**engine** delivered **+5 cases with zero regressed fault types** at the weight the solver named
(756 → 761, 53.16% → 53.5%), the **enrolment's** golden is untouched (`35125060855` at `0ab737f`
reproduces all nine cells, which it must at weight 0), the **weight itself is vetoed by the
golden** (§"The golden, measured AT the weight"), and the base the screens reconstruct now reads the
engine's own metric term on both sides of the threshold it turns on (§"The cause, and the fix").
Not settled:

- **Whether a narrower weight is golden-neutral.** 0.03017 is the weight the FSE'26 window solves for
  on the faithful (`rank`) shape, and it fails; the axis is not re-opened by a smaller number picked
  by hand. Any such candidate now has to clear both halves, and the flag exists to test it.
- **Whether a narrower weight is even worth a run now.** The base correction moved `re1`'s `rank` cap
  from `0.015112` to `0.015233` and its `flip` window to `[0.008032, 0.008032]`, so the golden's
  admissible set has to be re-read before the next dispatch — but the weight it would test is the
  same 0.03017 the golden has already vetoed, and a candidate inside the corrected window would be a
  different question, not a smaller one.
- 569 of 1422 cases (`flip`; 526 for `rank`) are unreachable at every weight, and the count now carries
  its causes (§"The unreachable count now says WHY"): **236 of the 569 (41.5%) read a deciding pair as
  EQUAL**, i.e. the `cv` field's three decimals decide whether the case is screenable at all; the rest
  are 333 out of the term's reach and 0 with no coefficient at all. On the golden the counts are 46 / 52
  for `re1`, of which 18 / 20 are the tie class.
- **The cap is an UPPER bound, and how far up is now measured** (§"The cap is an UPPER bound"): 31 of
  `re1`'s 301 satisfied cases, 14 of `re2`'s 119 and **510 of FSE'26's 756** hold a rival the artifact
  cannot order, and on FSE'26 the cap's own case is one of them. The bound is `lossFloor`, the earliest
  weight the artifact PERMITS a protected case to be cost — **0.003873 on FSE'26 against a cap of
  0.030480, 8× below it**; half the cap on `re1`'s `rank` shape; above the cap on `re2`, where the
  channel cannot bind at all. The SECOND channel — the base's own render — is measured as well
  (§"The second channel"), and it is the harsher of the two: on FSE'26's `rank` shape the window's own
  `lost at ship 0` survives in only **15 of 100 draws** (up to 4 protected cases go), on `re3-noinject`
  in 1 and 0 of 100, and on `re1`'s `flip` — a POINT window at the cap — in 50. What is still NOT settled
  is how far below the cap the engine actually goes: both instruments are bounds, and the one run that
  measured the engine (FSE'26 at `0.030170`, +5 cases and **0 regressed fault types**) REJECTS both
  permissions there, so a dispatched run remains the only instrument that answers it — the `--at-weight`
  verdict is what it is compared against.
- The `flip` shape reads the MAGNITUDE of a clamped bonus (§1), so `rank` is the faithful translation
  of the separator's rank-based rate. Any statement about this term has to name its shape — and any
  statement about the ENGINE has to use `rank`, which is why the comparison table in §"The golden,
  measured AT the weight" now says so.
- A paired preference is still not a term (`fse26-term-oracle-verdict.md` §9). What the candidate run
  settled is the term's admissibility at 0.03017 on FSE'26 — and the second benchmark then answered
  the question that admissibility left open.


## 5. Acceptance of the instrument itself

| gate | result |
| --- | --- |
| `benchmarks` tests | 685, 0 failures (was 671 before the per-screen box, 666 before the second channel, 656 before the satisfied-side class, 650 before that, 639 before the base correction; 575 at the first pass) |
| `benchmarks` coverage | **99.80 / 97.14 / 100 / 99.80**, the accumulator at 100 / 100 / 100 / 100 |
| root tests | 3163, 0 failures |
| `packages/kinetic` tests | 911, 0 failures |
| `packages/tree` tests | 650, **100 / 100 / 100 / 100** |
| `packages` typecheck | 15 projects (nx per-package **and** the workspace tsconfig) |
| lint / prettier | 0 warnings / clean |
| the base correction's own proof | the threshold is an exported OWNER with a test that pins BOTH sides on a real graph (`ANOMALY_NORMALIZE_NODE_THRESHOLD` at 19 raw vs 20 rescaled, and the flag provably inert below it); `blendScores` is asserted to score a row by `log1p` of ITS OWN `selfAnomaly`, with the gap pinned as the row's own `0.305` rather than the substitution's `0.693`; the new fidelity counter is asserted to FAIL on a case at the threshold carrying a value above 1 and to make NO such claim one candidate below, and its stronger twin is asserted NOT to be claimed (a tied top reads as the tie group's mean rank); and `metricSlopes` — the function whose whole job was to derive the printed column — no longer exists |
| the correction's GOLDEN | `35199445631` at `8bcf16c` (the engine's statements untouched, so this is the criterion's second half rather than a coincidence): **9 of 9 cells byte-identical** — `RE1 80.0 / 92.8 / 68.0`, `RE2 82.4 / 88.9 / 68.1`, `RE3 80.0 / 45.0 / 51.1` — with every job green (`rcaeval-re1`, `rcaeval-re2`, `rcaeval-re3`, `optimize-rcaeval`, `ablation-re1`, `ablation-re2`, `ablation-re3`, `dashboard`, `synthetic`) and `CI` + `Release` green on the same commit. The push that carried the change triggered it on its own, because the workflow's paths include `packages/*/src/**` and `benchmarks/src/**`. **A second run on the next commit** (`35200188245` at `6b36536`, a comment-only diff) reads the same nine cells to the tenth of a point, which matters for a reason beyond redundancy: the VETO and every re-opened axis here are read as *cells moved*, so a golden that drifted between two runs of one engine would make the whole scale meaningless |
| the split's golden | `35208713413` at `339bf39`: **9 of 9 cells byte-identical** — `RE1 80.0 / 92.8 / 68.0`, `RE2 82.4 / 88.9 / 68.1`, `RE3 80.0 / 45.0 / 51.1` — every job green plus `CI` and `Release` on the same commit. Same reason as the correction's own run: a benchmarks-side change CANNOT move the engine, which is precisely why the run is owed rather than assumed |
| the floor's golden | `35223783105` at `ccb76da` (the `lossFloor` derivation): **9 of 9 cells byte-identical** with every job green, `CI` and `Release` green on the same commit. The register/ratchet commit that followed (`93d4437`, which touches `packages/kinetic/__tests__` and `docs/`) triggered `CI` and `Release` and **no benchmark run at all** — the paths rule stating itself: `__tests__` is not a path that can move the engine, so no golden was owed and none was spent |
| the new counter, on its first real run | **it fired 34 times, and the claim was wrong rather than the dump**: 34 of the FSE'26 dump's 1422 rescaled cases carry a maximum of 0.95–0.99, because a TIED top anomaly takes its tie group's MEAN rank (`47.5 / 50` for a six-way tie). The check was split into the falsifiable half (`values above 1: 0` everywhere it was measured) and the population fact, which is what it should have been from the start — a counter that fires on the engine's own legal output is worse than no counter |
| the unreachable split — a REFINEMENT, not a new count | the five classes sum to the total by construction and the identity is asserted; measured before and after the split on the same dumps, every total is identical (`re1` 46/52, `re2` 25/24, `re3-noinject` 39/37, FSE'26 569/526). Each class has its own test, and the classifier was MUTATED rather than assumed: merging `unweighed` back into `tied at the render` fails exactly the two assertions on it, and (in the split's first version) sending `noSpread` to `outOfReach` failed exactly the two on that class |
| the satisfied-side class — a NECESSARY condition, checked against a run | every satisfied-side disagreement between the model and the engine at `0.030170` falls inside it (**1 of 1**: `re1ob_currencyservice_delay_4`), and the class does NOT claim to be a prediction — it holds 31 cases on `re1` for that one failure, because every other case the engine lost at that weight (2 of 3 on `re1`, all 8 on `re2`) is one the model predicts losing too. Both branches of the report print the sentence from ONE owner and the suite counts it, and the shape-independence the dumps show (31/31, 14/14, 13/13, 12/12) is asserted rather than noted |
| the class's own BOUND — a count is not a bound | `lossFloor` is derived, not asserted: `lead / span` with `span = (g − 1)/(n − 1)`, and it is the smallest such value over the class, so it is the earliest weight the artifact permits a protected case to be cost. Every dumps' verdict is measured (FSE'26 8× below its cap, `re1`'s `rank` half of it, `re2` above at both shapes, `re3*` 0.016 against 0.18/0.32), and the ONE engine measurement that exists rejects the permission: the FSE'26 candidate lost no fault type at `0.030170`, so the bound is loose by more than 8× there. MUTATIONS: reading the wording off the binder's existence instead of the comparison fails the report test, and `span = (g − 1)/n` fails three |
| the second channel — the `lost at ship 0` claim was a ONE-DIGIT-SET measurement | `gainResolution` resampled the discarded digits but asked only whether the GAINS survive, so nothing asked whether the PROTECTED cases do; `capResolution` does, over 100 draws of the same box. Measured: FSE'26 `rank` intact in **15 of 100** (up to 4 cases go), `re3-noinject` in 1 and 0 of 100 (up to 7 and 8), `re1` `flip` — a point window — in 50. Both readings are extreme values of the ensemble and are printed with what makes them readable (the cap's range sits low because it is a minimum; the loss count falls with the population the window protects, so its severity travels with it). MUTATIONS: disabling the loss counter fails the fragile fixture, and zeroing the draw fails it together with the gain ensemble's thin-lead test |
| the second channel's GOLDEN | `35232749251` at `d513781` (the `capResolution` instrument): **9 of 9 cells byte-identical** with every job green, plus `CI` and `Release` green on the same commit. Worth stating explicitly because this instrument makes a FRAGILITY claim about the window — 15 of 100 draws intact on FSE'26's `rank` shape — and a run is the only thing that can reject it: the engine at `0.030170` regressed **0 fault types**, so the reading is a bound and not a prediction |
| the ensemble's box was ONE screen's | a FIXED field set (the stability screen's) was drawn for every screen, so the temporal screen's ensemble held its OWN column fixed: on FSE'26 the `earliest-only` window's `4 in 100.0%` is **`4 in 56.0%, 3 in 44.0%`** under the term's own column, and on `re3` **`0 of 1 gains hold in every one`** (39.5% of draws lose it). The mechanism is the tie `earliest-only` credits at the minimum, which the millisecond render CREATES and the raw field does not have — so it is the only shape exposed, and `earliness`/`order`/`latest-only` read `100.0%` on all five dumps as a RESULT rather than a silence. `jitterFieldsFor(screen)` is the single owner of the box; a family screen draws neither column, and the cv screens' numbers are BYTE-IDENTICAL to the ones this document already published |
| the onset column's quantum and its one-sided cell | `Math.round` gives up half a MILLISECOND — three orders of magnitude from the base's `5.0e-4` — and it is now an exported owner in the producer; a printed `0` stands for `[0, 0.5]` and nothing below it, because the renderer spells a negative as `-`, so the draw is clamped. The first draft had neither: drawing it symmetrically moved the window in **78 of 100** draws against **34 of 60** once the draw stays inside the cell, i.e. half the mobility first measured was MY modelling error. The magnitude itself has no behavioural fixture that can separate it from the base's (any nonzero draw breaks an exact tie), and the test says so rather than pretending otherwise |
| the per-screen box's GOLDEN | `35242705643` at `1c47be6`: **9 of 9 cells byte-identical**, every job green, `CI` and `Release` green on the same commit. Owed rather than incidental — the change touches `benchmarks/src` and the producer's exported constant, so the paths rule bought the run — and it is the criterion's second half for an instrument that moved only what the instrument REPORTS |
| the verdict consumes the error bars | both menus carried the same `gain > 0 && lostAtShip === 0`, a one-digit-set test blind to both ensembles, printed only when the list was EMPTY — so a shape at **56 of 100 draws** was treated as admissible under a report saying so. One owner now (`admissibilityOf`, generic over the four shared fields), reporting EVERY failing bar. Measured: FSE'26 refuses all four shapes on BOTH screens; the golden's temporal `earliness` is admissible on all three suites at 1 gain; `re3`'s `earliest-only` and `re1`'s stability `flip` (a point window) are refused. **Every refusal is `gain not resolved` or `cap not resolved` — and that is true BY CONSTRUCTION rather than by measurement**: each reason is reachable only once the print already carries a gain and an intact cap. The inference first drawn from it here — that the artifact's three decimals were therefore the binding constraint on both axes — is **REFUTED by the next row** |
| the refinement sweep: is the RENDER the obstacle? | `refinementFrontier` moves the box and nothing else (a quantum `10^-k` smaller in EVERY field, same seed and trial counts, `k = 0` taken from the ensembles the report already has), answering `already` / `needs d` / `beyond` / `structural` (`structural` = no gain, so no sweep is run at all). Measured, `k` up to 6: FSE'26's `earliest-only` is **`beyond` with the weakest gain at 56.0% for EVERY k** — an unmoved survival rate is a rendered TIE, which a finer dump CHANGES rather than refines; `re1`'s `earliness` is `already`; `re1`'s `order` is `beyond` with its weakest gain CLIMBING 52.8% → 100.0% while the cap still moves; `re1`'s stability `flip` plateaus at 46.3% and `re3`'s at 26.8%; and exactly TWO windows — `re3`'s and `re3-noinject`'s stability `flip` — answer **`needs 1`**. So the render is the obstacle for those two and for nothing else measured, and the pre-registered prediction they license is **a dump at four decimals admits them** |
| the frontier's GOLDEN | `35299550262` at `2b3717c`: **9 of 9 cells byte-identical** — `RE1 80.0 / 92.8 / 68.0`, `RE2 82.4 / 88.9 / 68.1`, `RE3 80.0 / 45.0 / 51.1` — every job green, `CI` and `Release` green on the same commit. The expected outcome rather than a coincidence: the change is diagnostic-side and cannot move a ranking, and it is the criterion's second half for an instrument that only REPORTS. `k = 0` is inert at the level of the report too: on the FSE'26 dump the whole output differs from the pre-change text by **exactly one added line**, with every previously printed number byte-identical |
| the verdict's own GOLDEN, and the reader that said it was owed nothing | `35292724888` at `d2625d0`: **9 of 9 cells byte-identical** — `RE1 80.0 / 92.8 / 68.0`, `RE2 82.4 / 88.9 / 68.1`, `RE3 80.0 / 45.0 / 51.1` — every job green, `CI` and `Release` green on the same commit. Recorded with the caveat it earned: the reader answered **"no benchmark run: this push does not touch a path that can move the engine, so no golden is owed"** for this commit while the run was in flight. The commit changes `benchmarks/src/fse26-diagnose-analyze.ts`, so the paths rule DOES apply to it and the run was owed; the reader had asked GitHub with an abbreviated revision, which the `head_sha` filter answers with zero runs (`docs/golden-reader-audit.md`). The golden was owed, and it passed |
| the price of the class being a claim | a pair equal at `0` because the term weighed NEITHER side is excluded — that pair is equal in the engine too, so counting it would report a hidden ordering on the engine's own legal output. The exclusion is asserted by a test, and both directions are exercises of the same predicate: one requires the declaration of provenance, the other reads its absence as `weighed` |
| the split's own wiring hazard, caught by its first draft | the clause first carried a LEGEND line, and the menu's per-shape detail blocks are `formatCvScreenReport(...).split('\n').slice(4)` — so the new line leaked into every one of them and one sentence printed three times. The labels now carry their own meaning and the suite asserts the clause appears ONCE per menu, which is what fails if the report's head grows past four lines |
| regression proof | `--cv-screen` on the shipped dump differs from the pre-change output only by the new lines: the population line split, the two `margin:` lines, and the two `resolution:` lines. Every number the report printed before is byte-identical — `rank` gain 6, `[0.029860, 0.030480]`, ship 0.030170, `lostAtShip` 0 — so neither change moved a recommendation. The other two screens that share the solver are unmoved for the same reason (a monotone profile's plateau IS its `[floor, cap]`): `--onset-screen` still closes `earliness` at `[0, 0.005361]` and `order` at `[0, 0.005976]` with gain 0, and still ships the rejected `earliest-only` pair at **0.036552**; `--family-screen` still reports the pool family at its `0.010050` point and `protected at w=0: 756`, and both now print their own ensembles per row |
| the engine's half | candidate `35125277962` vs control `35125285784`: **+5 cases, 0 regressed fault types**, 756 → 761 |
| the enrolment's golden | `35125060855` at the enrolling commit `0ab737f`: **9 of 9 cells byte-identical** — the DEFAULT path, where the weight is 0 |
| the weight's golden | `35132525118` at `5233678` with `stability_weight=0.03017`: **4 of 9 cells move** (RE1 OB −0.8pp, RE1 TT −0.8pp, RE2 TT **−15.8pp**, RE3 SS +2.5pp) ⇒ the weight is rejected and the default stays 0 |
| the dump's completeness | the first dispatch's `re1` artifact held **125 of the 375 evaluated cases, all tagged `re1tt`**; after the fix all seven dumps hold every system — `re1` **375 (ob 125 / ss 125 / tt 125)**, `re2` **150 (50/50/50)**, `re3` **90 (30/30/30)** — and each opens with the banner's own signal line (the `re3-novelty` header reads `logSignalMode=novelty`, so it is per-run and not a constant). On a three-system fixture with the same input: pre-change **3 blocks, all `re1tt`, no header** against post-change **9 blocks, `re1ob 3 / re1ss 3 / re1tt 3`, header = the banner line** |
| the dump's fidelity | against each dump's OWN `prediction=` rank: **six of seven exact** (`re1` 301, `re1-noinject` 301, `re2` 119, `re2-noinject` 119, `re3-noinject` 37, `re3-novelty` 37) and divergent only on the `traceWeight=1` dump (48 → 35). RE1's 301 is checkable against the published table independently of the dump: `80.0% × 125 + 92.8% × 125 + 68.0% × 125 = 100 + 116 + 85` |

The tests that carry the design, and why each exists:

- **a gain narrower than the formatter's quantum is not decided by the dump** — the measurement the
  ensemble exists for: the fixture's lead is `7.2e-6` against a `5.0e-4` quantum, so the ensemble
  must report a split, and the report must say `0 of 1`. The mirror image is asserted too: at
  `2.147e-3` — wider than the `1.0e-3` a pairwise comparison of two three-decimal numbers can move
  by — **no** draw in the box can flip it, which is what makes this a measurement rather than a
  pessimism.
- **the ensemble is reproducible from the dump and the seed** — a statistic that moved between two
  runs of one dump would be a property of the draw.
- **the quantum comes from the producer** — a structural guard on the producer's source
  (`toFixed(SERVICE_FIELD_DECIMALS)`, and no `toFixed(3)` left anywhere in it), because a restated
  `3` goes stale exactly when the claim it qualifies becomes wrong.
- **the dump holds every group of one invocation, and refuses to be written twice** — the measurement
  the accumulator exists for: three groups must land in ONE file with the count reported against their
  names, a record arriving after the write must raise (that is the shipped defect, made unreachable
  rather than documented), a duplicate datapack must raise, and a second `write()` must raise. A
  POSITION check on the runner's source backs it up — one `write()`, after the group loop, and no
  `writeFileSync` on the flag's own path — because both ways to get it wrong are invisible in a
  single-group run.
- **every screen that names a weight prints its own resolution** — the wiring, asserted on all three
  reports, since a screen recommending a weight without saying what its own inputs can resolve is the
  defect the section exists for. The onset fixture carries an anchor and an onset ORDER, because the
  term's availability gate would otherwise suppress the line for a reason unrelated to the wiring.
- **the recommended weight satisfies every gain the report lists** — the invariant the profile
  exists for, asserted through the public solver. A midpoint taken between the outermost two
  samples of a peak state a gain its own interval arithmetic denies; two islands of one case's
  admissible set are the smallest input that shows it, and they are the reason the profile scans
  the intervals instead of counting their floors.
- **the profile can step DOWN** — the same fixture, stated as an observable: a cumulative count over
  the floors can only ever rise, so `[0, 1, 0, 1]` is the defect in one line.
- **the margin is reported, thinnest first, with the term's own rank step** — the number the
  dispatched run turned on. Its fixture is the smallest case whose gain is not a knife edge (a root
  capped from above AND floored from below), because a two-candidate case's floor is exactly
  `log1p(1) / slopeGap` and the margin there is exactly zero.
- **`unreachable` is not claimed shape-independent** — it is decided by the slopes, and the report
  names each shape's own count. Measured: 569 against 526.

- **`cvSlopes` does NOT credit an unmeasured service** — the load-bearing assertion of the family.
- **`cvScreen` satisfies at `w = 0` a case the LATENCY term decided**, and does not when the latency
  weight is zeroed. That is the base's proof: with two candidates the metric term's top-to-bottom gap
  is `log1p(1)`, which the latency term's own maximum cannot cross, so the fixture is a 26-candidate
  field. Measured, not argued.
- **the promotion weight is `log1p(1) / slopeGap` exactly** — the metric term is a RANK
  normalisation, not the raw anomaly, and a fixture written against `log1p(selfAnomaly)` would have
  pinned the wrong closed form (it did, on the first pass).
- **`--cv-screen` is enrolled in the weight guard as well as in the dispatch** — a flag wired into
  the dispatch but not the guard reconstructs `shippedScores` at a weight nobody chose.
- **every section the parser accepts renders through the dispatcher** — the census sections had no
  end-to-end test, which left the one place where a flag that parses and validates can still render
  nothing outside the gate.
- **the breakdown's public declaration documents every field and names each bonus's formula** — a
  structural guard on `packages/core/src/types/graph.ts` (a bare field fails whatever it is named),
  because the misreading this screen made was possible only while the formulas lived in one package
  and the public type named seven raw statistics. It failed first, as it should.
