# The onset axis, measured on FSE'26 for the first time

**Verdict.** The axis the register's closing paragraph points at is now measured on the
benchmark it was never measured on, from a free read rather than a sweep. Two of the four
declared shapes have **no admissible weight at all** — and they are the two that exist in
the engine. One has an admissible window worth **+4 cases, 0 lost**, which is the first
candidate this register has produced in three iterations that satisfies its own
pre-registered bar. And the run that made it measurable is, as a side effect, the
1422-case **pool-ON** dump the register has been missing, which re-validates the previous
fix on data the instrument had never read.

Everything below is one command:

```
analyze-fse26-diagnose --dump artifacts/r35006947938/fse26-results.txt \
  --log-weight 1 --onset-screen
```

## 0. The dump, and the two validations it carries

Run `35006947938`: the shipped configuration (`logWeight=1 logMode=logicHttp
rankNormalization=true latWeight=0.561495 latMinRise=10.3 poolMetricPenaltyWeight=0.0679`),
`diagnose` over all 25 fault types, `diagnose_limit=0`. **1422 blocks**; `onset=` on
**72,527** service rows (exactly one per row, no row without it) and `inject=` on all 1422
headers, never `-`.

Read at its own configuration, the instrument now reproduces it exactly:

| quantity | value |
| --- | --- |
| rank-1 same as the dump's own recorded | **1422/1422** |
| acceptable root (the shipped headline) | **756** |
| miss attribution | `wrong cases: 666` — the dump's own rank-1 |
| reconciliation | both-correct 756 / both-wrong 666 / fixed 0 / broken 0 / rank-1 moved **0** |
| `unexplained` | **0** |

Two things follow, both of which were previously *predictions*:

1. **`fse26-fourth-term-verdict.md`'s claim is confirmed by the run it predicted.** That
   verdict reconstructed the shipped configuration from a **pool-off** dump at
   `--pool-penalty 0.0679` and reported 756. This dump was produced by a pool-ON run, and
   reads 756 — so the fourth term's reconstruction is now validated against a real
   pool-ON run rather than against the run that motivated it.
2. **The register's "the routing map at the shipped configuration is still unmeasured" is
   closed**, and with it the second invariant: `unexplained` is 0 at the dump's own
   configuration, which is what the fixed report claims it should be.

## 1. The evidence is present, so a zero is a result

```
evidence: 1422 cases; with an injection anchor 1422; with an onset 1422;
          with an ORDER the term can act on 1422
services carrying an onset: 63489/72527 (87.5%)
```

Every case carries an anchor, every case has at least one onset, and every case has
enough onsets to establish a **before/after order** — the engine's own precondition for the
term to act. So the zeros in §2 and §3 are measurements, not a data gap, which is why
availability is printed *before* the window.

## 2. The engine's own shape: no admissible weight

```
earliness   gain 0   window [0.000000, 0.005361]   cap 0.005361
cap bound by ts4-ts-security-service-bandwidth-cs99dm:
  ts-preserve-service overtaken by ts-food-service (lead 0.010050, slope gap 1.874678)
```

**The binder's lead is `0.010050` — the metric term's TOP STEP for a 51-candidate case**,
the same constant the family screen named when it closed the family axis. The wall and the
reward are again the same number: a currently-correct case decided by the metric term's top
two ranks leads by exactly `log1p(1) − log1p(0.98)`, so any weight large enough to matter
hands it away. This is now the **second independent axis** to close on that constant, and
it is a property of the metric term's rank spacing rather than of the signal tested — worth
saying plainly, because it means the next candidate on any new key will meet the same wall
unless it arrives with a slope gap that beats the spacing.

## 3. The order shape (`order`): no admissible weight either

```
order       gain 0   window [0.000000, 0.005976]   cap 0.005976
cap bound by the same case (lead 0.010050, slope gap 1.681818)
```

Declared because the engine's shape is min-max **in the delay**, and one service that
moves a minute late can compress everyone else onto earliness ≈ 1 — the order shape reads
the **rank** instead and cannot be flattened that way. It does not change the verdict, and
screening it is what makes the verdict "no shape that reads the onset order works" rather
than "this one weight on this one shape fails".

## 4. `earliest-only`: the candidate

```
earliest-only  gain 4  window [0.034920, 0.038183]  width 0.003263  ship 0.036552
lost at ship 0
profile 0.010257→1, 0.020409→2, 0.020619→3, 0.034920→4
gains ts1-ts-inside-payment-service-stress-6qq6f6, ts2-ts-route-plan-service-return-xw84fv,
      ts4-ts-ui-dashboard-request-delay-cm5wdn, ts5-ts-basic-service-request-delay-4qpvfj
by fault type: HTTPRequestDelay +2, JVMMemoryStress +1, JVMReturn +1
cap bound by ts2-mysql-partition-nx5c29: ts-auth-service overtaken by ts-ui-dashboard
  (lead 0.038183, slope gap 1.000000)
```

The shape is the theory in its sharpest form: **credit only the service(s) that moved
first**, and nothing else. The register says a mask on the rise cannot do this — it cannot
delete a spurious competitor without deleting the same service as a credited source — but
this mask is on the **onset**, where the two roles are not the same quantity.

**It is sharp, and that is measured, not asserted.** Over the dump, the number of services
attaining the case's minimum onset is:

| tied at the minimum | 1 | 2 | 3 | 4 | 5 | 7 | 11 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| cases | **1088** | 230 | 69 | 27 | 6 | 1 | 1 |

**1088/1422 = 76.5%** of cases have a unique first mover and the mean tied set is **1.34**,
so the credit lands on one service in three cases out of four. A diffuse mask would be a
reweighting in disguise; a near-singleton one is a claim that can be wrong.

**Its window is thin, and its edges are named.** Width `0.003263`; the fourth gain arrives
at `0.034920`, the first casualty at `0.038183` — a correct case with a lead of `0.038183`
and a slope gap of exactly `1.000000`. It is admissible (a width-zero window is not a
window, which is the rule that rejected `http.server.duration`'s +4 on the family axis) but
it is not wide, and the honesty of the number is that the two edges are one constant apart.

**The direction is not arbitrary.** `latest-only` — the reversed control — has gain **0**:
crediting whoever moved last buys nothing. A screen without that arm could not tell a
working term from one whose sign had been flipped.

## 5. What is closed, and what is a candidate

- **Closed by measurement:** the engine's own `earliness` shape and the `order` shape. No
  weight on either fixes a case without losing one, and the binding case is named.
- **A CANDIDATE, bar met:** `earliest-only` at `w = 0.036552`, +4 with zero losses on the
  free read. The pre-registered bar this register set on the axis was "a window with a
  gain and zero case-level losses"; this meets it.
- **Not yet shippable**, and the reason is structural rather than evidential: the engine's
  `temporalWeight` renders min-max earliness, so shipping this needs *both* a shape
  selector and a weight in the ranking path (core types → tree signal → pruner →
  kinetic/runner options → the workflow input), and then the pair.

One property makes the shape half of that provably safe: the term is
`temporalWeight × slope`, so while the weight is 0 **the shape cannot move any ranking at
all**, including the RCAEval golden — at weight 0 the two are the same function. So the
whole risk of this candidate sits in the weight, which is exactly what the pair measures.

**The RCAEval half of that was a claim, not a fact, and the first draft of this section
got it backwards.** It said the golden "does not set" the shape. True, and irrelevant:
`run-rcaeval.ts` also pinned the *weight* to a literal `0` — the term's ABLATION — while
carrying the engine's defaults for the latency weight and the pool penalty. Had the flip
shipped on that basis, the golden 9-cell would have stayed byte-identical because the
gate never ran the configuration, and the register would have recorded "zero movement" as
evidence for the signal. RCAEval has no dispatch inputs, so its configuration can only
follow the engine's defaults; the runner now reads both constants (§7), which is what
makes the gate able to see the term at all.

## 6. What the next iteration is

1. Enroll the shape + weight (`temporalWeight`, an `OnsetShape` selector) with the guard
   discipline the other shipped terms have: the value read out of source as text and
   required to be a key of the recorded-runs table.
2. Measure the pair on one commit at the shipped configuration: control `temporalWeight=0`
   against the candidate `0.036552` + `earliest-only`, and require **zero regressed fault
   types**.
3. Measure the RCAEval golden 9-cell at the candidate and require it byte-identical.
4. If either half fails, close the axis with those two numbers and this document becomes
   the row's evidence; if both pass, the term ships and the register gains the split.

## 7. The pair, and what it took to make the gate able to see it

> **Outcome: REVERTED.** The FSE'26 half of the criterion passed here, completely and at
> case granularity; the RCAEval half failed by ~41pp on one cell, so the weight is 0 again
> and the axis is closed by a rejection rather than left open. §8 is the measurement.


Three commits, in this order, because the third cannot be measured without the first:

| commit | what |
| --- | --- |
| `ea8884b` | the shape becomes a first-class engine option (`computeOnsetSlopes` is the one owner; the screen's copy is deleted and the old rows reproduce byte for byte) |
| `0612025` | **one owner for the pair**: `run-rcaeval` reads `DEFAULT_TEMPORAL_WEIGHT` / `DEFAULT_ONSET_SHAPE` instead of pinning the ablation, takes `--onset-shape`, and prints both; `parseWeight` becomes one shared rule, so a malformed flag reproduces a published configuration instead of running an unrecorded one |
| the flip | `0.036552` + `earliest-only`, with the recorded-runs pair table as the guard |

Measured on one commit, 1422 cases, `rcabench-latency-full`, the shipped base minus this
term as the control:

| | control (`temporalWeight=0`) | candidate (`0.036552`, `earliest-only`) |
| --- | --- | --- |
| Top@1 | 53.16% (756) | **53.45% (760)** |
| Top@3 / Top@5 | 66.46% / 70.25% | 66.53% / 70.25% |
| runs | `35021503281` | `35021510164` |
| per-type | — | `HTTPRequestDelay` 54→56, `JVMMemoryStress` 12→13, `JVMReturn` 12→13, **22 types unchanged, 0 regressed** |

### The case-level split, measured rather than inferred

"0 regressed fault types" is a claim about 25 types — the weaker claim the pool penalty's
own row was written to stop repeating — and the run's artifact is a summary, so the pair
alone does not settle it. Two independent readings do:

- **The solver**, on the control dump: `gain 4, lostAtShip 0` at `w = 0.036552`, with the
  four datapacks named in advance.
- **The reconstruction**, added in the same iteration as this section, reading the same
  control dump at the SHIPPED model (the oracle rebuilds the score, which now includes this
  term with its recorded shape):

  ```
  configuration vs the dump's recorded rank-1 (1422 cases):
    both-correct 756  both-wrong 662  fixed 4  broken 0  net +4
    correct: recorded 756 / modelled 760; rank-1 moved 17
  ```

  `broken 0` is the case-level statement, and `modelled 760` is the candidate's headline
  reproduced from the CONTROL dump. `rank-1 moved 17` is larger than the four because the
  other thirteen move between wrong services — which is also why `unexplained 4` appears:
  the model now includes a term the dump's run did not have, so four cases' modelled order
  disagrees with the recorded winner. That is the mirror image of §2 of
  `fse26-shipped-config-verdict.md`, and the note under the count says so.

### The prediction, checked against the run

The solver named its four datapacks BEFORE the confirming run existed. The run's dump
(`35029055764`, the shipped configuration with no override — so this is the DEFAULT path,
not a flag path) lets the two lists be diffed case by case:

```
correct: pre 756 → post 760 (net 4)      rank-1 moved: 17
FIXED   (4): ts1-ts-inside-payment-service-stress-6qq6f6  ts2-ts-route-plan-service-return-xw84fv
             ts4-ts-ui-dashboard-request-delay-cm5wdn     ts5-ts-basic-service-request-delay-4qpvfj
PREDICTED(4): the same four, in the same order once sorted
BROKEN  (0): none
```

`PICKED = ACTUAL, BROKEN = 0`. A count that agreed while the NAMES did not would have been
a coincidence of two counts; this is the same four cases.

Reading that dump at its own configuration is also the last fidelity check the instrument
needs: `rank-1 same as the dump's own recorded: 1422/1422`, `an acceptable root: 760`,
`moved by the pool penalty: 97; moved by the temporal prior: 17`, `rank-1 moved 0` and
`unexplained 0` in the attribution. `temporalFlips = 17` is the same 17 the offline
reconciliation measured on the pre-flip dump, from two independent paths.

### What the term's SIGN means, stated precisely

The miss decomposition carries a `temporal` contribution, and the first draft of this
section called a positive one "the term's case-level cost". It is not, and the numbers say
so: **35 of the 662 misses** have a positive contribution while `broken` is **0**. A
positive contribution means the term widened the WRONG winner's margin — it is working
against the root in a case that is ALREADY lost, i.e. a barrier rather than a cause. The
cost is `broken`, which is a different measurement. Both numbers are worth keeping: the
barrier count is what a future change to the other terms would have to work against.

### The instrument had to grow with the term

`blendScores` did not model the temporal prior at all, which was invisible while the term
was off and fatal the moment it shipped: reading the NEW dump would have printed `rank-1
moved` and `unexplained` for the shipped configuration's own decisions. The term is now in
`TermOracleOptions` (weight AND shape — a weight without the shape it was measured on is
not a configuration), in `shippedScores`, in the fidelity report as `temporalFlips`, and in
the miss decomposition as a `temporal` contribution whose SIGN is a finding: positive means
the term promoted the wrong winner, i.e. its case-level cost.

Two things this shook out, both of which are the repo's recurring defect in a new place:

1. **The CLI dispatch hand-assembled a subset of the section's fields.** Passing
   `--temporal-weight 0` printed a banner claiming `0.036552`: `undefined` reached the
   `?? SHIPPED` fallback inside. Three call sites did this (the miss report, the family
   screen, the onset screen); all three now pass the section itself, so a field added to
   the section cannot be forgotten at a call site.
2. **A term being SOLVED must not be in its own base.** `--onset-screen` now pins
   `temporalWeight: 0` where it builds its base, because inheriting the shipped weight
   while adding `w·slope` would measure an ADDITIONAL term on top of one already applied.
   Its menu output is byte-identical to the pre-ship run, which is the check.

Verified inert on the dumps that predate the term: with `--temporal-weight 0` the report is
byte-identical to the same command before this change, apart from the banner clause that
states the ablation.

## 8. Rejected by the golden: the measurement that undid it

The pair shipped at `0.036552` + `earliest-only`, and the RCAEval suite — which had just
been taught to read the engine's constants (§5) — ran the shipped configuration for the
first time in the signal's history. Six of the nine cells moved, two of them by ~41pp:

| cell | recorded | at the shipped pair | Δ |
| --- | --- | --- | --- |
| RE1 TrainTicket | 68.0 | **27.2** | −40.8 |
| RE2 TrainTicket | 68.1 | **25.7** | −42.4 |
| RE1 OnlineBoutique | 80.0 | 79.2 | −0.8 |
| RE3 SockShop | 45.0 | **47.5** | +2.5 |
| RE1 SockShop, RE2 OB, RE2 SS, RE3 OB, RE3 TT | — | unchanged | 0 |

Reproduced **identically to the decimal on a second run of the same engine**
(`35029285379`, `35030365430`) — `35029285379`'s banner reads
`temporalWeight: 0.036552 | onsetShape: earliest-only`, which is the only reason we know
the gate ran the shipped configuration at all rather than its own pin.

**Why it failed is the mechanism already on record, now measured.** The engine's own doc
says it: on RCAEval the injection-anchored onset anchors to the SOURCE's slow-responding
dominant metric — latency and socket cross the 30% threshold LATE — while a symptom's fast
metrics cross it EARLY. So "whoever moved first" is systematically a symptom there. That is
the same fact that left the two-sided shapes with no admissible weight at all
(`pruner.ts`, `OnsetShape`), and it should have been read as a warning: a one-sided MASK
cannot be punished for demoting the late-mover source, but it can still *promote* the early
symptom, and on TrainTicket it does, almost always.

The two benchmarks therefore disagree about this signal, and the criterion has no tie-break
for that: FSE'26 +4 cases / 0 regressed types, RCAEval −40.8pp on a cell. The criterion says
no, and the criterion is the one thing on this page that is not up for negotiation.

### What the revert changed, and what it deliberately left standing

- `DEFAULT_TEMPORAL_WEIGHT` is back to `0`; `DEFAULT_ONSET_SHAPE` is back to `'earliness'`.
  The shape is inert at weight 0, so this restores the pre-flip engine exactly — and the
  next RCAEval run is what proves it, by reproducing all nine recorded cells. It did
  (below), and it is in the recorded-runs table as `defaultPath`, so the proof is looked up
  where the weight is.
- The SHAPE MACHINERY stays: `computeOnsetSlopes`, the `onsetShape` option, the
  `--onset-shape` flags, the `--onset-screen` menu, and the dump's `onset=`/`inject=`
  fields. They are inert at weight 0, they are what made this measurable, and deleting
  them would make the rejection unre-measurable.
- The **instrument** stays, and this is the part that would have hurt to lose: `blendScores`
  models the term, so a dump produced with it on reads back at `rank-1 1422/1422` with
  `unexplained 0`.

### The revert, verified on both halves

A revert is the one change that gets to claim it restores an engine without adding a
feature, so it is also the one change whose claim is checkable against a measurement that
already exists — the recorded 9-cell and the recorded fault-type table. Both were re-run on
`301c430` **through the default path**, no `--temporal-weight`, no `--onset-shape`:

| | run | result |
| --- | --- | --- |
| RCAEval (`re1/re2/re3`) | `35035309768` | **9 of 9 cells identical** to the record — RE1 80.0/92.8/68.0, RE2 82.4/88.9/68.1, RE3 80.0/45.0/51.1 |
| FSE'26 (1422 cases) | `35035314921` | 756/1422 = **53.16%**; per-fault-type table **identical to the control `35021503281`, 25 of 25 types**, zero cells moved |

The FSE'26 run's own banner reads
`temporalWeight=0 onsetShape=earliness` with `logWeight=1 latWeight=0.561495 latMinRise=10.3
poolMetricPenaltyWeight=0.0679` — the shipped pair from §6 of the sibling verdict, quoted
back by the engine rather than by a document.

The comparison is worth stating the other way round, because that is where its information
is: against the **rejected** pair, exactly three types differ and all three are the pair's
gain.

```
HTTPRequestDelay  56/88 → 54/88
JVMMemoryStress   13/171 → 12/171
JVMReturn         13/21  → 12/21
```

Four cases, three types, named in advance by the solver, all of them given back. The revert
did not quietly cost something else.

### The guard that let this ship had one half

`MEASURED_TEMPORAL_PAIRS` recorded `regressedTypes` — an FSE'26, fault-TYPE claim — and had
no field for the golden at all. A candidate could therefore be recorded as "measured" with
the other half of the criterion unmeasured, which is exactly what happened. It now carries
`golden: 'identical' | 'moved'` per point, the shipped weight is required to be an
`'identical'` point, and the rejected candidate is kept in the table **as data** with both
of its numbers. The description check was hardened at the same time: it compared text, so
`toContain('0')` passed against a description naming `0.036552` — the moment a value
reverts to 0 the check stopped checking. Descriptions are now compared by numeric token.

Two sentences from §4 and §5 are worth re-reading in this light, because both were right in
a way that did not help: the screen's own note that "a mask on the onset, where the
competitor and the credited source are not the same quantity" (true — and the competitor is
on the other benchmark), and §5's insistence that the gate had to be able to SEE the term
before any of this could be believed. It saw it, and it said no.

## 9. The criterion, intersected: the golden's `earliest-only` ceiling, and what it explains

Every weight above was solved on ONE artifact. The criterion is a comparison between two, so the object it
asks for is the **intersection of two sets of weights** — and `criterionReadings` / `criterionVerdicts` /
`formatCriterionReport` now compute it, reached by repeating `--dump` (the FIRST artifact is the one a
candidate must IMPROVE; every other is one it must leave untouched). Each artifact is solved on its own
population and in its own rounding box.

Measured with FSE'26 (`dump-35035314921`) named first and the golden's three suites protected:

```
  artifact                 shape          role     gains from      loses from      permits a loss from
  …/dump-35035314921.txt   earliness      gain        0.007722        0.005361              never
  …/dump-35035314921.txt   order          gain        0.006700        0.005976              never
  …/dump-35035314921.txt   earliest-only  gain        0.010257        0.038183              never
  …/dump-35035314921.txt   latest-only    gain        0.281658        0.010050              never
  …/rcaeval-dumps/re1.txt earliness      protect     0.004348        0.010108              never
  …/rcaeval-dumps/re1.txt order          protect     0.005870        0.003931              never
  …/rcaeval-dumps/re1.txt earliest-only  protect     0.016129        0.004717              never
  …/rcaeval-dumps/re1.txt latest-only    protect     0.443976        0.040848              never
  …/rcaeval-dumps/re2.txt earliness      protect     0.010589        0.026349              never
  …/rcaeval-dumps/re2.txt order          protect     0.015537        0.006775              never
  …/rcaeval-dumps/re2.txt earliest-only  protect     0.122616        0.007528              never
  …/rcaeval-dumps/re2.txt latest-only    protect     0.017757        0.274495              never
  …/rcaeval-dumps/re3.txt earliness      protect     0.001664        0.026130              never
  …/rcaeval-dumps/re3.txt order          protect     0.001664        0.015049              never
  …/rcaeval-dumps/re3.txt earliest-only  protect     0.003328        0.022757              never
  …/rcaeval-dumps/re3.txt latest-only    protect     0.003328        0.052260              never
```

**Three facts follow, and the second is what §8 could only describe as nine moved cells.**

1. **`earliest-only` is the ONE temporal shape whose FSE'26 gain is free on FSE'26** — its own cap
   (`0.038183`) sits ABOVE the floor of its own window (`0.034920`), which is why the pair passed that half
   completely in §7. Every other shape's first gain is at or above its own cap: `earliness` `0.007722`
   against `0.005361`, `order` `0.006700` against `0.005976`, `latest-only` `0.281658` against `0.010050`.
2. **And the golden closes it at `0.004717`.** `re1`'s cap on that shape is `0.004717`, so the criterion's
   intersection is empty for every weight at which FSE'26 gains anything at all on `earliest-only`
   (`0.010257` is the first, so the golden is binding from **2.2× below** it). The weight the solver
   recommended, `0.036552`, is **7.7× above that ceiling** — which is the number §8 was missing when it
   recorded "six of the nine golden cells moved, two of them by ~41pp". The revert was not a surprise; it was
   a vertical drop against a ceiling a third of a rank step wide, and the screen cannot see the ceiling's
   *position* on another artifact without being told to look.
3. **`earliness`, the engine's own shape, is open on the golden and paid for on FSE'26.** Its intersection is
   `[0.007722, 0.010108)` — width `0.002386`, worth one case — and the weight that buys that case sits at or
   above FSE'26's own cap (`0.005361`), so it costs a case on the benchmark it was supposed to improve. That
   half is a fault-TYPE count, which a screen cannot make, so the report PRINTS it rather than applying it:
   the region is admissible on what a screen can decide, and the bar that remains is named.

**So the temporal axis does not convert.** Its golden-side windows stay exactly as §5 recorded them — open,
one case each, `re1` `earliness`, `re2` `earliness`+`latest-only`, `re3` three of four — and that is a
statement about the GOLDEN. What the intersection adds is the other half: **no temporal weight gains a case
on FSE'26 without costing a case somewhere**, either on the golden (every shape but `earliest-only`) or on
FSE'26 itself (`earliest-only` is the exception, and the golden closes it first). A gain on the protected
half is worth nothing, which is the asymmetry the instrument had to be taught — its first version credited
exactly that and reported `earliness` admissible from `0.001664`, a weight at which FSE'26 gains nothing.

**The pre-screen is free and is now the first thing a temporal proposal must run.** One command, four
populations, no dispatch: a candidate that has not intersected has not stated what it buys where.

## 10. The one region the intersection left open — dispatched, and REJECTED by a run

§9 left exactly one temporal region open: `earliness` `[0.007722, 0.010108)`, worth one case, with a bar the
screen could not settle — `costsOnGainSide`, because the gain is bought at or above FSE'26's own cap
(`0.005361`), so whether a case is cost there is a **fault-type count**, and a screen does not make those.

That is the same bar the stability axis carried into its dispatch, and there the run **rejected the caveat**
(zero regressed types). Here it did not. Dispatched at the midpoint the solver's own rule recommends
(`0.008915`), with a control on the same commit ablating the term (`temporalWeight=0`):

| arm | run | config | measured |
| --- | --- | --- | --- |
| candidate | `35420303504` | `temporalWeight=0.008915 onsetShape=earliness` | **757/1422** |
| control, same commit | `35420305720` | `temporalWeight=0` | **757/1422** |

Net **zero** cases, and the composition of that zero is the finding:

- `HTTPResponseDelay 52 → 53` (**+1**)
- `NetworkBandwidth 13 → 12` (**−1**)

**One fault type regressed, so the FSE'26 half of the kill criterion fails — and the criterion is an AND.**
No golden run was bought to confirm it: a run spent to learn that a rejection holds is a run spent to learn
nothing, and recording the other half as `moved` would be a measurement nobody took. The row is in
`MEASURED_TEMPORAL_PAIRS` with `golden: 'unmeasured'`, and the guard requires `identical` on anything that
ships, so an unmeasured row can never be green — which is the only property it needs.

**Two caveats, two verdicts, and they are not the same claim.** `costsOnGainSide` was loose on the stability
axis and correct on this one: the same instrument produced both warnings, and only a run can tell which is
which. That is the reason the instrument prints the caveat instead of applying it.

**The temporal axis is now closed by a RUN rather than by a screen.** `earliest-only` was closed by the
intersection (the golden caps it at `0.004717`, 2.2× below FSE'26's first gain there); `earliness` was
admissible on everything a screen can decide and is closed by one fault type at the midpoint; `order` and
`latest-only` were closed on both sides by the intersection. Reopening needs either a discriminator on the
onset itself (§"What this does and does not settle") or a weight the intersection does not currently admit —
and by the register's rule, a narrower number is not that.

## 11. The four shapes' own laws, and the class the screen computed and did not print

The screen said `no step stated` for all four shapes, and a previous iteration recorded why rather than
inventing a law: `CellLaw`'s branches described the DECISIVE-COMPOSITION screen's normalisations (`rank`
steps by `1/(n − 1)`, the value shape divides by `10^-decimals` of a service field), and the temporal
shapes have their own. Reading them off `computeOnsetSlopes` rather than choosing them:

| shape | the engine's arithmetic | the law | one position |
|---|---|---|---|
| `order` | `1 − 2·index/(n − 1)` | `rank`, range **2** | `2/(n − 1)` — the decisive screen's rank law hardcodes 1 and would halve it |
| `earliness` | `2 × (earliness − 0.5)` = `(max − delay)/(span/2) − 1` | `value`, field `onset delay (ms)`, quantum **1 ms**, scale `span/2`, range 2 | `1/(span/2 − 1)` in slope units |
| `earliest-only` | credits `1`, reads `0` for everyone else | `indicator`, range 1 | the whole range |
| `latest-only` | credits `−1`, reads `0` for everyone else | `indicator`, range 1 | the whole range |

Two of the three quantities the law needs were IMPLICIT and both were wrong outside the
decisive-composition screen:
- **the RANGE**, because a shape normalised to `[0, 1]` steps by `1/(n − 1)` and one normalised to
  `[−1, 1]` steps by `2/(n − 1)`;
- **the QUANTUM**, because an artifact has a resolution per COLUMN: `MeasurementProvenance.decimals`
  describes the service magnitude fields, while `fmtOnset` prints the onset in WHOLE MILLISECONDS. The
  resampler has drawn that column at its own resolution since before the law existed
  (`ONSET_FIELD_HALF_QUANTUM`), so a law reading its cell off `decimals` disagreed with the ensemble
  measuring the same artifact. Measured on FSE'26 (4 decimals, `ts5-ts-basic-service-request-delay-4qpvfj`,
  47 measured onsets over a 202307 ms span):

| shape | step the screen printed | step its own law gives | apart |
|---|---|---|---|
| `earliest-only` | `w/46 = 2.174e-2` (rank law) | `1.000e0` | **46×** |
| `earliness` | `w/46 = 2.174e-2` (rank law) | `9.886e-6` | **2200×** |
| `order` | — | `2/46 = 4.348e-2` | 2× the rank law's |

So the margin line became a reading instead of an absence, and the direction is the ALARMING one — which
is the honest direction here:

```
before:  margin: thinnest 1.632e-3 (…) vs ts-travel-service); no step stated; 0 of 4 gains inside one step (4 without a law)
after:   margin: thinnest 1.632e-3 (…) vs ts-travel-service); one crediting step 3.655e-2; 4 of 4 gains inside one step
```

Every gained case is within one crediting FLIP at the shipped weight, which is what the screen's own
resolution line was already saying in prose (`3 of 4 gains hold in every draw`) without naming a yardstick.
A binary shape's positions are coarse by construction: the shape either credits a service or does not, so
"one position" is the whole range and `4 of 4` is the correct count rather than an over-statement.

**And the cap's class, which the screen computed and never printed.** The onset screen has carried
`capUnrepresentable` since the class existed, and it was empty for exactly one reason — the builder stated
no law — so no line was due. With the law stated it holds **15 of FSE'26's 756 satisfied cases at BOTH
boxes** (a threshold's membership is the PRINTED boundary, and its tie groups did not move across the two
renders), and the sentence that prints it names the pair and the law:

```
cap UPPER bound: 15 of 756 satisfied cases hold a rival the term reads as EQUAL, and the cap's own case is
not one of them; the lowest weight at which one of them can be lost is 0.026668
(ts3-ts-contacts-service-partition-g7s7mn: mysql / ts-payment-service, a tie inside the credited set,
worth its whole 1.000000) — BELOW the cap 0.038183, so the engine can lose one first
```

`0.026668` is below the window's cap `0.038183` **and below the `0.036552` the solver recommended** — so
on this screen's own arithmetic the recommendation sits in a region where the artifact permits the engine
to lose a case the model keeps, which is the same story as `3 of 4 gains hold in every draw` told as a
weight. It does not reopen anything: the AXIS is closed by the golden at `0.004717`, well below the
`0.010257` at which FSE'26 gains its first case, and the criterion's verdict for `earliest-only` is
`NO ADMISSIBLE WEIGHT` before and after. What changed in the intersection is one COLUMN — the FSE'26 side's
own `permits a loss from`:

| shape | permits a loss from, 4 dec | 3 dec |
|---|---|---|
| `earliest-only` | **0.026668** | **0.026668** |
| `earliness` | 216.414837 | 216.531973 |
| `order` | never | never |
| `latest-only` | never | never |

Every one of those read `never` before this change, because an unstated law makes the class empty and
`lossFloor` infinite. **A tie at an INDICATOR's CREDITED value is a frontier** — a sub-millisecond draw
decides which of the tied services is the earliest — while **a tie at its NEUTRAL value is not**, and the
class drops it: two services the render ties away from the boundary cannot be credited in ANY realisation
(a service tied with the boundary differs from it by less than a whole cell, so it cannot be the earliest),
so no weight separates them. That is the class's OWN stated exclusion — "a pair the term weighed on neither
side… is equal in the engine too, so it hides no ordering" — reached by a second mechanism, and the first
version of these laws would have granted the neutral tie the shape's whole range: a hazard no weight can
produce, reported as a bound.

**Two more things fell out of the same seam.** The three laws need `n ≥ 2` (one onset cannot establish an
order, and `shapeStep` would divide by `n − 1 = 0`), so both builders now state no law for such a case —
the class reports it as uncountable rather than as empty. Measured on the whole dump: 1422 of 1422 cases
carry two or more onsets AND two or more compositions, so this predicate moves no printed number; it
removes a state the type would otherwise admit. And the criterion's temporal table now reads
`permits a loss from` for the FSE'26 side as a number where it read `never` — the same "computed and not
printed" defect, one layer up, in the table the axis is decided from.
