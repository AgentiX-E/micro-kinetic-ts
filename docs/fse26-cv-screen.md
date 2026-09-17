# The decisive-stability (cv) screen: the separator's rate turned into a term

**Status:** instrument shipped and gated; the population measurement is **done on both benchmarks**,
and the first weight anyone solved for it **fails the golden**. §4 records a weight-level veto, not a
term-level one: the term is admitted behind `--stability-weight` and the default does not move.
Deliberately NOT a `-verdict` document: the register's rows are for axes measured to a conclusion,
and what closed here is a WEIGHT — the statistic the row names (`decisiveCv` on the matched
stratum) is still the only non-term candidate above the criterion.

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

| dump | cases | groups | `traceWeight` | dump `prediction=` | screen `correct at 0` | Δ |
| --- | --- | --- | --- | --- | --- | --- |
| `re1` | 375 | ob 125 / ss 125 / tt 125 | 0 | 301 | **301** | 0 |
| `re1-noinject` | 375 | ob 125 / ss 125 / tt 125 | 0 | 301 | **301** | 0 |
| `re2` | 150 | ob 50 / ss 50 / tt 50 | 0 | 119 | **119** | 0 |
| `re2-noinject` | 150 | ob 50 / ss 50 / tt 50 | 0 | 119 | **119** | 0 |
| `re3` | 90 | ob 30 / ss 30 / tt 30 | **1** | 48 | 35 | **−13** |
| `re3-noinject` | 90 | ob 30 / ss 30 / tt 30 | 0 | 37 | **37** | 0 |
| `re3-novelty` | 90 | ob 30 / ss 30 / tt 30 | 0 | 37 | **37** | 0 |

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
  at 0.030170: correct 295, gained 7, lost 13
    lost: rcaeval-re1_re1tt_ts-auth-service_delay_4, ... (13 named)
    gained: rcaeval-re1_re1ob_productcatalogservice_cpu_3, ... (7 named)
```

Measured on the dumps the fixed runner produced (`35175577233` at `ecfc439`), for the weight FSE'26
solves for and the golden vetoes:

| dump | cases | correct at 0 | at `0.030170` | gained | lost |
| --- | --- | --- | --- | --- | --- |
| `re1` | 375 | 301 | **295** | **7** | **13** |
| `re2` | 150 | 119 | **107** | **0** | **12** |
| `re3-noinject` | 90 | 37 | 37 | 0 | 0 |

So the trade the veto rests on, in the units the FSE'26 side reported (`+5 cases, 0 regressed fault
types`), is **+5 there against `+7 / −13` on RE1 and `+0 / −12` on RE2** — a net −18 on the golden,
and every one of the 25 given-up cases is NAMED rather than inferred from a rounded cell. Note too
that the window on `re1` closes at `0.015112`, so `0.030170` is twice past the cap the screen would
have shipped under: the recommendation and the veto are not in tension, they are two readings of one
model at two different weights.

Two properties make the number usable, and both are asserted. It is absent from the report when no
weight is named, so the default output is byte-identical to what it was before the flag existed. And
the flag is REFUSED unless `--cv-screen` or `--onset-screen` was also requested — the file's own
`--log-weight` rule, applied to the other side of the same question, because a flag accepted and
rendered nowhere is how a flag becomes ritual.

**One open question this instrument now makes askable, and it is why a paired dispatch is in flight.**
The screen reads `re1` at 295 — six cases below its own 301 — while the dispatched run's RE1 cells move
by about two cases (`OnlineBoutique 80.0 → 79.2`, `TrainTicket 68.0 → 67.2`, `SockShop` unchanged, and
those are averages of six per-fault-type rates, so they round). The analyzer's `rank` shape is written
to BE the engine's function — `(n − 1 − avgRank) / (n − 1)` with ascending `cv`, ties averaged, `n` the
MEASURED services, unmeasured services scoring 0 — and at `w = 0` it reproduces the run's own pooled
count exactly, which is what the fidelity line checks. Whether it also reproduces it AT a positive
weight is not the same claim: it needs a run dispatched with `stability_weight` AND `diagnose_dump`
together, so that the dump's own `prediction=` list is the engine's ranking at that weight and
`correct at 0` on it becomes the engine's count there. If the two agree, the −6 is the truth and the
cell averages were hiding four cases; if they disagree, the `rank` translation is not the engine's
function and that is a defect with a number rather than a doubt.

### What this does and does not settle

Settled: the term is not inert, the zero-regression window exists on the whole population, the
**engine** delivered **+5 cases with zero regressed fault types** at the weight the solver named
(756 → 761, 53.16% → 53.5%), the **enrolment's** golden is untouched (`35125060855` at `0ab737f`
reproduces all nine cells, which it must at weight 0), and the **weight itself is vetoed by the
golden** (§"The golden, measured AT the weight"). Not settled:

- **Whether a narrower weight is golden-neutral.** 0.03017 is the weight the FSE'26 window solves for
  on the faithful (`rank`) shape, and it fails; the axis is not re-opened by a smaller number picked
  by hand. Any such candidate now has to clear both halves, and the flag exists to test it.
- 569 of 1422 cases (`flip`; 526 for `rank`) are unreachable at every weight — a case with no
  decisive composition, or none the term can separate.
- The `flip` shape reads the MAGNITUDE of a clamped bonus (§1), so `rank` is the faithful translation
  of the separator's rank-based rate. Any statement about this term has to name its shape.
- A paired preference is still not a term (`fse26-term-oracle-verdict.md` §9). What the candidate run
  settled is the term's admissibility at 0.03017 on FSE'26 — and the second benchmark then answered
  the question that admissibility left open.


## 5. Acceptance of the instrument itself

| gate | result |
| --- | --- |
| `benchmarks` tests | 639, 0 failures (was 575 at the first pass; 633 before the dump accumulator) |
| `benchmarks` coverage | **99.81 / 97.18 / 100 / 99.81**, the accumulator at 100 / 100 / 100 / 100 |
| root tests | 3150, 0 failures |
| `packages/kinetic` tests | 901, 0 failures |
| `packages` typecheck | 15 projects (nx per-package **and** the workspace tsconfig) |
| lint / prettier | 0 warnings / clean |
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
