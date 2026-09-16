# The decisive-stability (cv) screen: the separator's rate turned into a term

**Status:** instrument shipped and gated; **the population measurement is PENDING** the run that
renders `metricDecisive` for every service. Deliberately NOT a `-verdict` document: the axis is
neither closed nor established, and the register's rows are for axes that have been measured to a
conclusion — one direction or the other. The verdict lands here, in §4, when the run does.

**Code:** `cvSlopes` + `cvAvailability` + `cvScreen` + `cvShapeMenu` + `formatCvScreenReport` +
`formatCvMenuReport`, behind `--cv-screen`. **Producer:** the `metricDecisive` line,
`packages/kinetic/src/benchmarks/fse26-diagnose.ts`.

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

### What this does and does not settle

Settled: the term is not inert, the zero-regression window exists on the whole population, the
**engine** delivered **+5 cases with zero regressed fault types** at the weight the solver named
(756 → 761, 53.16% → 53.5%), and the **golden is untouched** — `35125060855` at the enrolling commit
`0ab737f` reproduces all nine cells (`RE1 80 / 92.8 / 68`, `RE2 82.4 / 88.9 / 68.1`,
`RE3 80 / 45 / 51.1`), which it must, because the weight defaults to 0. Not settled:

- **The golden has not been measured at the WEIGHT.** The nine cells above are the default path,
  which the term cannot reach; the field exists on RCAEval too, so a default of 0.03017 would act
  there and would need its own flag-free run. That is the difference between *admitting the term* and
  *shipping it on*: `earliest-only` passed the FSE'26 half of this same criterion completely and then
  moved six of nine cells by up to 41pp, so the ordering — measure the second benchmark first — is the
  lesson of that revert, not an abundance of caution.
- 569 of 1422 cases (`flip`; 526 for `rank`) are unreachable at every weight — a case with no
  decisive composition, or none the term can separate.
- The `flip` shape reads the MAGNITUDE of a clamped bonus (§1), so `rank` is the faithful translation
  of the separator's rank-based rate. Any statement about this term has to name its shape.
- A paired preference is still not a term (`fse26-term-oracle-verdict.md` §9): this table licensed a
  candidate RUN, the run has been taken, and what it settled is the term's admissibility at 0.03017 —
  not a change to the default path.


## 5. Acceptance of the instrument itself

| gate | result |
| --- | --- |
| `benchmarks` tests | 612, 0 failures (was 575 at the first pass) |
| `benchmarks` coverage | **99.82 / 97.16 / 100 / 99.82** |
| `packages` typecheck | 15 projects (nx per-package **and** the workspace tsconfig) |
| lint / prettier | 0 warnings / clean |
| regression proof | `--cv-screen` on the shipped dump differs from the pre-change output in **three hunks and nothing else**: the population line split, and the two new `margin:` lines. Every number the report printed before is byte-identical — `rank` gain 6, `[0.029860, 0.030480]`, ship 0.030170, `lostAtShip` 0 — so the solver change moved no recommendation. The other two screens that share the solver are unmoved for the same reason (a monotone profile's plateau IS its `[floor, cap]`): `--onset-screen` still closes `earliness` at `[0, 0.005361]` and `order` at `[0, 0.005976]` with gain 0, and still ships the rejected `earliest-only` pair at **0.036552**; `--family-screen` still reports the pool family at its `0.010050` point and `protected at w=0: 756`. The register's guarded numbers are untouched |
| the engine's half | candidate `35125277962` vs control `35125285784`: **+5 cases, 0 regressed fault types**, 756 → 761 |
| the golden half | `35125060855` at the enrolling commit `0ab737f`: **9 of 9 cells byte-identical** (RE1 `80 / 92.8 / 68`, RE2 `82.4 / 88.9 / 68.1`, RE3 `80 / 45 / 51.1`) — the DEFAULT path, where the weight is 0 |

The tests that carry the design, and why each exists:

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
