# The latency channel — three views of one array, and two suppressors

**Status:** the defect is identified, the mechanism is now printed by the artifact, and the view a run ranks
on is stated at every call site. The published cells keep the composed view, because a repair that silently
moved their input would move a published number.

## 1. The question this document answers

Iteration 73 left one item in the register open, and it was the sharpest one there: on **RE3 OnlineBoutique**
the input census read

```
direction-coverage[OnlineBoutique]: 30 cases | failedTraceEdges 15/30 cases, 30 edges | edgeLatency 0/30 cases, 0 edges | STARVED: edgeLatency — any weight on it measures nothing
```

Two outputs of one relation, one populated and one empty, **in the same cases, from the same file**. `latWeight`
is `0.561495` in the shipped configuration — one of the three terms that dominate the ranking — and an empty
array under a non-zero weight is the register's first invariant inverted: *a signal that received nothing reports
the same headline as a signal with no effect.*

The question was not whether the zero was real. It was **why**, because two mechanisms predict the same zero and
they differ in everything a decision needs:

| mechanism | signature in the capped span list | what it means |
| --- | --- | --- |
| **no anchor** | every span on the "after" side | `inject_time.txt` absent or unparsable ⇒ `injectTime` degrades to `0` ⇒ every span is after it |
| **double scale** | every span on the "after" side | a start time already in milliseconds is multiplied by 1000 again |
| **truncating cap** | every span on the "before" side | the byte-prefix read ends before the post-injection window |

The first two are indistinguishable from a single number, which is why the answer had to be an instrument.

## 2. The unit contract, and the expression that violates it

`BenchmarkTraceSpan.startTime` is declared `// Unix milliseconds`, and the loader goes to some trouble to make
that true: `normalizeTraceStartTime` reads `startTimeMillis` directly, divides a microsecond `startTime` by 1000,
and magnitude-infers a bare `timestamp`. Its duration docblock states the contract for the neighbouring column by
contrast:

> The value's UNIT is deliberately not normalised. The only consumer reads the RATIO of a post-injection mean to
> a pre-injection mean on the same edge, so a uniform scale cancels — unlike `startTime`, whose unit is compared
> against `injectTimeMs` and therefore does have to be normalised above.

The assembly scaled it again:

```ts
startTime: t.startTime * 1000,      // t.startTime is ALREADY milliseconds
rawCase.injectTime * 1000,          // seconds → milliseconds: correct
```

One call, two conventions for one quantity, and `toBenchmarkCase` — the owner of the injection conversion —
multiplies by 1000 too. So the injection side is right, the span side is off by 10³, and `after` is true for
**every** span: no edge can have a pre-injection mean, and `toEngineDirectionalInputs` returns `[]` on every
case of every suite. The comment above the expression stated the mismatch with the wrong sign ("would put every
span **before** the injection"), which is the same failure this repository keeps finding: the justification
outlives the code it was written for.

**This is entailed by the code, and §7.1 measures that it is NOT what emptied the channel on the corpus**: the
cap truncates first, so the same array is empty for a second reason. Both defects are real; only one of them is
binding, and the artifact is what says which.

## 3. The third route was already computed and thrown away

`countDirectionalInputs` streams the **whole** file and returns **both** arrays. The assembly kept only one:

```ts
const streaming = await countDirectionalInputs(join(meta.dirPath, 'traces.csv'), injectTimeMs);
benchCase = { ...benchCase, failedTraceEdges: streaming.failedTraceEdges };
//                                          streaming.edgeLatency ── dropped, at zero saving
```

That is the route the earlier battery measured through, and the one the ledger then discarded when it was
re-pointed at the shipped composition. `countTraceActivityByService`'s own docblock already records what the
other route cannot see — that `tryLoadTraces` "truncates before the post-injection window" — so on RCAEval the
capped route was never going to hold a pair, with or without the unit defect.

## 4. The three views

`benchmarks/src/rcaeval-corpus.ts` derives all three in ONE assembly and owns the selection:

| view | input | start time | what it is |
| --- | --- | --- | --- |
| `shipped` | the capped span list | scaled twice | **the composition that published the nine cells** |
| `capped` | the capped span list | as the loader normalises it | the same cap, unit repaired |
| `whole-file` | the streaming pass | as the loader normalises it | the only view that can hold both sides |

The view is a **corpus** property and is stated at every call site rather than defaulted (`corpus-assembly.test.ts`
asserts each of the three runners names one), for the reason `prismPooling` exists: *an option a caller can name
and a call site omits is an open axis.* The published cells' view is `shipped`.

## 5. The census, and the verdict its counts earn

`latency-routes[<system>]` is printed beside the input census and counts, per population: the cases with no
usable anchor, the capped list's spans and its pre/post split, how many cases the cap put entirely on one side,
how many hold both, and the row count of each of the three views. Its `VERDICT` names the mechanism, and the arms
are ordered so the strongest available reading decides:

| verdict | when | reads as |
| --- | --- | --- |
| `LIVE (shipped)` | the published view produced a row | the channel is fed; nothing else needs saying |
| `STARVED` | the capped list holds no spans | the corpus is the answer |
| `NO ANCHOR` | a case has no usable injection time | the split cannot exist; **not** a defect in the scale |
| `ALL-AFTER` | every capped span is at/after the anchor | no edge can have a pre-side mean |
| `CAP TRUNCATES` | every capped span is before the anchor | the prefix ends before the window |
| `LIVE (capped)` | the repaired-unit view produced a row | the cap was not the binding constraint |
| `UNEXPLAINED` | both sides present and no route emitted a row | the derivation is the only suspect left |

`NO ANCHOR` is deliberately read **before** `ALL-AFTER`: both empty the pre side, and only one of them implies a
unit defect. The `whole-file` clause is appended rather than made its own arm, because it is not a competing
explanation — it is the same population seen by the one derivation that reads the whole file, and its presence is
what separates *"the corpus cannot express this"* from *"the input never arrived"*.

## 6. What the nine published cells therefore contain

`latWeight = 0.561495` multiplied an empty array on every RCAEval cell. That is consistent with, and explains,
the ledger row that reads `Δ+0.0%` for `LAT OFF`, `LAT NO FLOOR` and both — a fact measured five iterations
before its cause was found. The earlier ledger's signed readings for this channel (RE3-TT +16.7, RE3-OB −13.3,
RE2 −2.0 twice) were attributed at the time to "an artefact of the study's own `edgeLatency` derivation"; that
attribution is **withdrawn here**. The whole-file derivation was not the artefact — it was the only route that
could express the input, and the composition that replaced it is the one that cannot.

**And whether it is worth something is now a measured question whose first answer did not survive.** §7.2 measured
the channel at **+1.9 pp** on RE2 when its input was supplied — and then RE2's corpus was corrected from 150 to 270
cases, on which the same row reads **Δ+0.0** (§7.4). So the published nine cells are a corpus in which a dominant
term is starved rather than a corpus in which the term does nothing; **what feeding it would buy is not yet
established**, and the one figure that claimed to establish it is withdrawn.

## 7. Measured acceptance

**Run `37858643162` on `95fedbc` — 10/10 jobs success, the nine cells byte-identical** (`80.0 / 92.8 / 68.0` ·
`82.4 / 88.9 / 68.1` · `80.0 / 45.0 / 51.1`, every per-fault-type column unchanged). The ablation jobs' new bound
was **not** forced: `ablation-re2` came in at **54.3 min** against the old 60, with 5.7 min of headroom — the
projection in the workflow's comment (~59) was conservative, and the number is recorded here because a comment is
not a record.

### 7.1 The census names the mechanism — and it is not the one predicted

| cell | `no anchor` | capped spans (pre / post) | cap all-before | rows: shipped / capped / whole-file | verdict |
| --- | ---: | --- | ---: | --- | --- |
| RE1 ×3 | 0 | 0 | 0 | 0 / 0 / 0 | `STARVED` (RE1 carries no traces) |
| RE2 SS · RE3 SS | 0 | 0 | 0 | 0 / 0 / 0 | `STARVED` (SockShop carries no traces) |
| RE2 OB | 0 | 500 000 (500 000 / **0**) | **50/50** | 0 / 0 / **600** | `CAP TRUNCATES` + whole-file clause |
| RE2 TT | 0 | 500 000 (500 000 / **0**) | **50/50** | 0 / 0 / **3 712** | `CAP TRUNCATES` + whole-file clause |
| RE3 OB | 0 | 300 000 (300 000 / **0**) | **30/30** | 0 / 0 / **356** | `CAP TRUNCATES` + whole-file clause |
| RE3 TT | 0 | 300 000 (300 000 / **0**) | **30/30** | 0 / 0 / **2 006** | `CAP TRUNCATES` + whole-file clause |

**This refutes the binding mechanism this document predicted.** §2 argued the double scale was why the published
view is empty; the census shows the capped list carries **exactly 10 000 spans per case — the cap — and every one
of them is BEFORE the anchor**, so `post = 0` and no edge can have an after-side mean. The prefix ends before the
post-injection window, exactly as `countTraceActivityByService`'s docblock claimed and as nothing had ever
measured. `no anchor 0` on all nine cells also eliminates the third mechanism.

The unit defect of §2 is still **entailed by the code** — the published expression scales a millisecond value by
1000 — but the cap **binds first and masks it**: the `capped` view (unit repaired) is empty on this corpus too, so
no measurement here isolates the scale. What the artifact states is the mechanism that emptied the channel, and it
states it with the counts that decide it.

### 7.2 The channel is not starved, and on the CAPPED corpus it read +1.9 — superseded by §7.4

> **Read §7.4 with this.** Every number below is measured on RE2's **capped 150-case** corpus, because that was the
> corpus the run of §7 carried. It is retained as the record of that run, not as a statement about RE2.

| row | RE1 | RE2 | RE3 |
| --- | --- | --- | --- |
| `LAT WHOLE FILE` (corpus `whole-file`) | Δ+0.0 | **Δ+1.9** | Δ+0.0 |
| `LAT CAPPED` (corpus `capped`) | Δ+0.0 | Δ+0.0 | Δ+0.0 |
| `LAT WHOLE FILE + LAT OFF` (control) | Δ+0.0 | **Δ+0.0** | Δ+0.0 |

RE2, per system and per fault type:

| system | baseline | whole-file | Δ | fault types that moved |
| --- | ---: | ---: | ---: | --- |
| OnlineBoutique | 82.4 | **86.1** | **+3.7** | `delay` 67 → **78**, `loss` 56 → **67** |
| TrainTicket | 68.1 | **69.9** | **+1.8** | `delay` 56 → **67** |
| SockShop | 88.9 | 88.9 | 0.0 | — (no traces at all) |
| **mean over systems** | 79.8 | **81.6** | **+1.9** | |

Three things follow, and the third is the one that matters.

1. **The control worked.** Switching `latWeight` off on the same corpus returns to the baseline **exactly**, so
   the movement belongs to `latWeight` and to nothing else about the corpus rows.
2. **The cap is the suppressor, and the unit repair alone recovers nothing** (`LAT CAPPED` = `Δ+0.0`, and its
   verdict is `STARVED` because the corpus it ran on holds no rows). The two defects are real; only the second is
   binding, and only the whole-file route has the input.
3. **The movement lands on the network-class faults.** `delay` +11pp on two systems and `loss` +11pp on one, with
   every other fault type unchanged — and `loss` is precisely the class the held-out misses were attributed to,
   and `delay`/`loss` are the two fault types that block **every** global PRISM weight on RE1. The propagation
   channel — the one place the Deng-Yu mathematics enters the ranking — is not worthless; it has never been fed.
   **On the corrected corpus this third point is the one that does not survive: see §7.4.**

On RE3 the whole-file corpus **is** supplied (356 and 2 006 rows) and the ranking does **not** move: the verdict is
`INERT`, which is a statement about the term there. Whether `latMinRise = 10.3` is what masks it is the next row
this instrument makes cheap (`LAT WHOLE FILE + NO FLOOR`), and it is named rather than assumed.

### 7.3 What this does NOT decide

The nine published cells keep the composed view, because moving them is a **re-baseline** and not a repair: the
shipped corpus starves its own dominant latency term, and supplying it moved RE2's OnlineBoutique and TrainTicket
cells by +3.7 and +1.8 *on the capped corpus*. That is a decision to be taken on the numbers, deliberately, with
the published comparison re-stated — not taken silently inside a unit fix. **And §7.4 lowers the stakes of that
decision rather than raising them**: on the corrected corpus the mean movement is zero.

### 7.4 The same rows on the corrected corpus — run `37872246084`

RE2's benchmark invocations were capped at 50 of its 90 cases per system, so §7.2's RE2 cells are means over
**150** of 270 cases. Commit `b5f0951` removed the cap (`docs/benchmark-corpus-completeness.md`) and run
`37872246084` re-measured every row on the full corpus. RE1 and RE3 are byte-identical, as they must be for a
change that grows RE2 alone.

| row | RE1 | RE2 | RE3 |
| --- | --- | --- | --- |
| `LAT WHOLE FILE` (corpus `whole-file`) | Δ+0.0 | **Δ+0.0** (was Δ+1.9) | Δ+0.0 |
| `LAT CAPPED` (corpus `capped`) | Δ+0.0 | Δ+0.0 | Δ+0.0 |
| `LAT WHOLE FILE + LAT OFF` (control) | Δ+0.0 | **Δ+0.0** | Δ+0.0 |

RE2 per system, corrected:

| system | baseline | whole-file | Δ | was (capped) |
| --- | ---: | ---: | ---: | ---: |
| OnlineBoutique | 86.7 | **84.4** | **−2.3** | +3.7 |
| SockShop | 93.3 | 93.3 | 0.0 | 0.0 |
| TrainTicket | 71.1 | **73.3** | **+2.2** | +1.8 |
| **mean over systems** | 83.7 | **83.7** | **+0.0** | +1.9 |

Three things, and the first is why the other two matter.

1. **The +1.9 does not survive, and it is not a contradiction of §7.2 — it is §7.2's own law applied to §7.2.** The
   movement was real on the corpus it was measured on; that corpus was 56% of RE2. Two of the three systems move,
   **in opposite directions**, and the published convention — a mean over fault types — absorbs both. So the honest
   state of this channel is: *not starved, demonstrably able to move two cells, worth 0.0 in the published
   convention on the corrected corpus.*
2. **The control still returns to the baseline exactly** (`+0.0` on all three suites), so the zero belongs to
   `latWeight` and not to the corpus row — the instrument's own check is unaffected by the correction.
3. **The mechanism verdict is unaffected and is now stronger.** `latency-routes` on the full corpus reads
   `CAP TRUNCATES` on **every** trace-bearing cell — RE2-OB (1080 whole-file rows over 90/90 cases), RE2-TT (6781
   over 89/90), RE3-OB (356), RE3-TT (2006) — with `no anchor 0` everywhere and `cap all-before = cases/cases`. The
   150-case run's RE2-TT count (3712 rows) scales to 6781 at 270, as it should.

**What is therefore still owed is unchanged and now cheaper**: `latMinRise = 10.3` may mask the supplied channel on
RE3 (`LAT WHOLE FILE + NO FLOOR`), and on RE2 the channel's worth is a per-system question rather than a mean —
OnlineBoutique loses 2.3 pp when fed, TrainTicket gains 2.2. Whether that is a re-baseline worth taking is a
decision on those two numbers, not on the 1.9 that is gone.

> **Read §7.5 with this.** The owed row was added in iteration 88 and MEASURED, and the answer is that the floor
> does mask the supplied channel — as an **interaction** no single-axis row could have shown.

### 7.5 The missing fourth cell — and the interaction only it could read (run `38157023328` on `47cc5e4`)

§7.4 named one row as owed: `LAT WHOLE FILE + NO FLOOR`. The battery's propagation-channel rows are **two groups
that never met** — the weight × floor 2×2 on the PUBLISHED corpus, and the corpus rows that vary only which
derivation `edgeLatency` comes from — and their cross product over `{corpus, floor}` held **three of its four
cells**. Iteration 88 adds the fourth. It is not a duplicate of either neighbour, and the measurement below is the
reason: it is the only row that can read an **interaction**.

**RE1 is the control, and every one of its cells is `Δ+0.0`.** The suite carries **no `traces.csv` at all** — the
census reads `STARVED … the capped list holds no spans at all` — so none of the four cells can move, and none does.
That is what makes the RE3 column below a statement about the term rather than about the battery.

**RE3 — the suite §7.4 named** (the battery runs every row with **all twelve feature flags OFF**, so these are the
term's numbers and **not** the published cells):

| row | `{corpus × floor}` | RE3-OB | RE3-SS | RE3-TT | mean |
| --- | --- | ---: | ---: | ---: | ---: |
| `BASELINE` | shipped × default | 72.2 | 46.1 | 3.6 | — |
| `LAT NO FLOOR` | shipped × **no floor** | **+0.0** | +0.0 | **+0.0** | +0.0 |
| `LAT WHOLE FILE` | **whole-file** × default | **+0.0** | +0.0 | **+0.0** | +0.0 |
| **`LAT WHOLE FILE + NO FLOOR`** | **whole-file × no floor** | **−16.7** | +0.0 | **+13.6** | **−1.0** |
| `LAT WHOLE FILE + LAT OFF` | whole-file × default, `latWeight = 0` | +0.0 | +0.0 | +0.0 | +0.0 |
| `LAT CAPPED` | capped × default | +0.0 | +0.0 | +0.0 | +0.0 |

**The movement is an INTERACTION, and that is the whole finding.**

- **The floor alone moves nothing** (`LAT NO FLOOR`, Δ+0.0) — and it cannot: on the shipped corpus the array it
  would unmask is **empty**, which is §7.1's `CAP TRUNCATES`.
- **The supplied input alone moves nothing** (`LAT WHOLE FILE`, Δ+0.0) — it.74's `INERT` verdict, reproduced
  exactly on the full 270-case corpus.
- **Together they move two cells and nothing else.**

So **§7.4's `INERT` was an artefact of the floor.** The channel is not inert on RE3; it is masked, and neither
axis predicts the movement on its own — which is precisely why an incomplete cross product is a **defect rather
than an untidiness**, and why this row could not be inferred from any of the three that existed.

**And the movement is a RE-ORDERING, not a level shift.** Per fault type, against the baseline:

| system | fault types that moved |
| --- | --- |
| RE3-OB | `f3` 83.3 → **33.3** · `f4` 66.7 → **16.7** · `f5` 100.0 → 83.3 · `f1` 11.1 → **44.4** |
| RE3-TT | `f2` 0.0 → **14.3** · `f3` 0.0 → **40.0** |
| RE3-SS | *nothing* — the suite can never hold a latency pair (census `STARVED`) |

Two systems pull in **opposite directions** and the published convention — a mean over fault types — then absorbs
them into `−1.0`. **The mean is not the finding; the ±15 pp per-cell swing is.** RE3-TT gains 13.6 pp on the cell
that is the weakest of the published nine, and RE3-OB gives up 16.7.

**The 2×2 is its own control and it is now complete.** A fifth cell (`latWeight = 0` on the whole-file corpus with
no floor) would be `Δ+0.0` **by construction** — a zero weight makes the input irrelevant — so it is not owed and
its absence is not a hole. What the four cells do say, together, is that the movement belongs to the term and to
nothing else about the corpus or the flags.

**RE2's fourth cell landed, and it is a second interaction of the same polarity** (`ablation-re2` completed in the
same run; the bound that had to move for it is in the workflow). RE2 carries traces, so unlike RE1 none of its four
cells is forced to zero:

| row | `{corpus × floor}` | RE2-OB | RE2-SS | RE2-TT | mean |
| --- | --- | ---: | ---: | ---: | ---: |
| `BASELINE` | shipped × default | 86.7 | 93.3 | 71.1 | — |
| `LAT NO FLOOR` | shipped × **no floor** | **+0.0** | +0.0 | **+0.0** | +0.0 |
| `LAT WHOLE FILE` | **whole-file** × default | **−2.2** | +0.0 | **+2.2** | **+0.0** |
| **`LAT WHOLE FILE + NO FLOOR`** | **whole-file × no floor** | **−10.0** | +0.0 | **+10.0** | **+0.0** |
| `LAT WHOLE FILE + LAT OFF` | whole-file × default, `latWeight = 0` | +0.0 | +0.0 | +0.0 | +0.0 |
| `LAT CAPPED` | capped × default | +0.0 | +0.0 | +0.0 | +0.0 |

Three things RE2 adds, and the first is about the CONVENTION rather than about the term.

- **The mean is `+0.0` in ALL FOUR cells.** On RE3 it was `−1.0` in the crossed cell alone, so a reader could still
  have seen that something moved. Here a configuration that moves a published cell by **10 pp** has a mean of
  exactly zero, in every cell, including the two that move. The summary statistic is not merely uninformative at
  this resolution: it is **identically zero for both of the cells that are not**. That is the strongest available
  argument for reading the nine cells and never the fold.
- **The floor alone is inert here too** (`LAT NO FLOOR`, Δ+0.0) — the same mechanism, since RE2's shipped array is
  empty for the same reason — and the **corpus alone is NOT inert**: `LAT WHOLE FILE` moves two cells by ±2.2,
  where on RE3 the same row read Δ+0.0. So the floor's role differs by suite: on RE2 the interaction **amplifies**
  a movement the corpus already makes alone (×4.5), while on RE3 the corpus alone is genuinely inert and the floor
  is what **reveals** the channel.
- **The polarity is the same in both suites** — OnlineBoutique loses, TrainTicket gains, SockShop is untouched in
  both — which is what makes it a property of the term rather than of one corpus. The per-fault-type reading is
  sharper on RE2 than on RE3: against the baseline, RE2-OB `delay` **80.0 → 40.0** and `mem` 100.0 → 80.0, while
  RE2-TT `loss` **40.0 → 73.3**, `socket` 80.0 → 93.3 and `cpu`/`disk` +6.7 each. The single-axis row moves RE2-OB
  `delay` by −13.3 and RE2-TT `delay`/`mem` by +6.7 each, so the crossed cell is the same re-ordering with the
  mask lifted rather than a different one.

**The 2×2 is its own control and it is now complete on all three suites.** A fifth cell (`latWeight = 0` on the
whole-file corpus with no floor) would be `Δ+0.0` **by construction** — a zero weight makes the input irrelevant —
so it is not owed and its absence is not a hole. What the four cells do say, together, is that the movement
belongs to the term and to nothing else about the corpus or the flags.

### 7.6 The half that DECIDES could not state the knob it had to state (iteration 89, on `47cc5e4`)

**What §7.5 does NOT decide, and why it could not.** Every row above ran in the ablation battery, whose
configuration is **all twelve feature flags OFF** — not the published one. So no number in §7.5 says the nine
published cells would move by those amounts: what is established is that the term is **LIVE** on a corpus where it
was read as inert, and the **direction** of its movement per cell. Whether the published corpus should be re-based
onto the whole-file derivation, and whether `latMinRise = 10.3` should be lowered, is a decision on **those cells
and not on a mean** — and it needs both axes measured **in the published configuration**. This section is about why
that was impossible, and what was done about it.

**The measurement, and the defect it found.** Read mechanically out of the two files — 27 branches of the golden
argument chain, against the 17 options `buildRCAEvalEngineOptions` hands the engine:

| engine option | shipped value | written by |
| --- | ---: | --- |
| 14 others | *(each non-empty)* | one branch each |
| `latWeight` | **0.561495** | **— no branch at all** |
| `latMinRise` | **10.3** | **— no branch at all** |
| `poolMetricPenaltyWeight` | **0.0679** | **— no branch at all** |

All three were declared in `CliOptions`, defaulted from the **engine's own constants**, forwarded to the engine's
constructor and named on **every** golden artifact's `signals:` line — while **no arm of the parser wrote any of
them**. So the artifact asserted a configuration no invocation, dispatch or otherwise, could state, and the largest
weight in the ranking multiplied an array the golden half could not displace. The FSE'26 runner had all three arms
all along, so **the same knob was reachable in one workflow and not in the other** — the one direction the
`no_rank_normalization` input's own description says must not happen.

**The corpus axis was a literal, and that is the half that matters.** The golden call site passed
`latencyFrom: 'shipped'` — stated rather than omitted, with a reason, but not displaceable. Since `latWeight`
multiplies `edgeLatency` and the shipped view's array is **empty** (§7.1), the golden half could vary **neither**
axis of §7.5's interaction — and an interaction is invisible to each of its axes alone. A candidate measurable on
one instrument and judged on another has an undecidable other half, which is the sentence the `log_weight`
dispatch input already carries about the REJECTED temporal candidate.

**Why the golden half and not the FSE'26 one — measured, not assumed.** The two runners reach the engine through
different shapes, and the difference decides what "unreachable" even means. `buildFse26EngineOptions` **maps**: its
parser holds `logMode` while the engine takes `logSignalMode`, so "no branch writes it" is false there for a field
that is perfectly reachable. The golden's builder **copies**, one-for-one under the same names — which is what let
three fields ship, print and stay unreachable, and what makes the reach fence the right question on this half and a
false-positive generator on the other.

**What was corrected, and why each piece is one.** Four knobs and one line:

- `--lat-weight`, `--lat-min-rise`, `--pool-penalty` — the **FSE'26 runner's own spellings and semantics**, so that
  one value means one thing in both workflows. The floor keeps its own domain (floored at 1) rather than sharing
  `parseWeight`'s, because a floor below 1 suppresses nothing and would report a configuration the operator
  believes changed something.
- `--latency-view` — the corpus axis, accepted **by the union's own guard** (`isLatencySource`, declared beside the
  union it reads, which is the repair `--prism-pooling` carries) so all three views are expressible from a
  dispatch. The default is the SHIPPED view, so a bare dispatch reproduces the published cells.
- A **`corpus:` line** in the banner and in the diagnose dump's header, from one string, because the `signals:`
  line cannot carry it: that line's membership is held **in both directions** to the options the engine's
  constructor receives, and the view is a property of the INPUT rather than a term. Two runs whose `signals:` lines
  are byte-identical and whose corpora are not would be two measurements filed under one configuration.

**The gap was already recorded, which is the part worth keeping.** `dispatch-surface-census.test.ts` holds a table
whose `rcaeval` column was `null` for exactly these three rows — the register's inventory of open axes — so this
iteration **closed three rows of a census rather than discovering a fact**. That is the right relationship between
a census and a repair: the census made the absence legible enough to be scheduled.

**The nine cells are untouched, by construction.** Every new default is the shipped value and every workflow input
is empty, so a push passes no flag at all. This section is an instrument change, and its acceptance criterion is
the **byte-identical nine cells**. What it buys is that §7.5's decision — which of the two RE3 cells to accept, and
whether the corpus or the floor is the axis to move — is at last measurable on the half that judges it.

## 8. Fences

- `benchmarks/__tests__/corpus-owner.test.ts` — a real case directory, the real loader, the real owner: the
  `shipped` view is empty and the other two hold `{preMeanMs: 10, postMeanMs: 500}` on the same corpus, with
  `anchorPresent: true`, `capSpans: 3`, `capPre: 2`, `capPost: 1`. It also covers the arms only a corpus can
  reach (no traces, no anchor, no augmentation, a suite that is not RE3).
- `benchmarks/__tests__/latency-routes.test.ts` — every verdict arm, the summariser, the selection, and the
  source-shape assertions: the published expression is kept verbatim as a recorded value, the capped view passes
  the loader's value through unscaled, the deciding call site states its view **from the parsed option** rather
  than as a constant, the census is printed, the whole union is accepted by the union's own guard, the artifact's
  `corpus:` line is rendered from the one string the banner prints, and all four knobs are forwarded from dispatch
  inputs into **every** golden invocation — counted against the invocations the workflow actually has, so a job
  added without them fails here instead of running at the shipped value under a dispatch's name.
- `benchmarks/__tests__/cli-argument-rejection.test.ts` — the **reach** fence, which is the direction nothing
  asked: every other flag→effect assertion starts from a flag, and this one starts from the **option** and asks
  whether any branch of the chain writes it. Both sides are derived (the chain's own spans; the options the
  engine's constructor receives), and the property is asserted twice — structurally, and behaviourally by moving
  each option with probes taken from the **engine's own vocabularies** rather than from a list this file keeps.
  A companion assertion pins the premise that makes the reading valid on this half: the builder **copies** rather
  than maps.
- `packages/kinetic/__tests__/unit/dispatch-surface-census.test.ts` — the three names of every knob (input, flag,
  engine option) and their owners. Its `rcaeval` column carried `null` for `latWeight`, `latMinRise` and
  `poolMetricPenaltyWeight`; the census now records them as dispatchable on both halves, which grows
  `DISPATCHABLE_ON_BOTH` from six axes to nine, and `latencyView` is classified as **operational** — a property of
  the input rather than a term — so it belongs in that reason table and not in the knob table.
- `packages/kinetic/__tests__/unit/fse26-reported-config.test.ts` — the workflow descriptions that quote a runner
  default. The three new inputs quote one each, and all three ship **non-zero**, which is what made their absence
  from this half expensive: the description's number and the run's configuration could disagree about the largest
  weight in the ranking with nothing in the pipeline to notice.
- `benchmarks/__tests__/coverage-scope.test.ts` — `rcaeval-corpus.ts` was imported by a test as SOURCE TEXT and
  by nothing as code, so every number in this repository went through a module outside the coverage denominator.
  It is in the allow-list now.
