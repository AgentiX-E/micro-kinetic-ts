# The deviation window's anchor — the level a fault is measured against

**Status:** mechanism **IMPLEMENTED**, tested (8 tests in
`packages/tree/__tests__/causal/baseline-anchor.test.ts`), and **dispatchable on both halves**
(`--baseline-anchor`, `anomaly_knobs=anchor=…` on the golden half, `ranking_knobs=baseline_anchor=…`
on FSE'26). Ships at **`whole-file`**, i.e. OFF. Measured on the two cells this sandbox can assemble:
**the axis alone is a wash (−2/+2 cases, §4a), and shipping it beside the same commit's log-vocabulary
clause is +1 case on RE3-SS with RE1-OB unmoved in count.** The five golden cells it has not been
measured on are named in §6.

**Owner of:** `--baseline-anchor`, `BaselineAnchor` / `BASELINE_ANCHORS` /
`DEFAULT_BASELINE_ANCHOR` in `topology-fault-graph.ts`, and the `baselineAnchor` field on all three
artifact lines (`signals:` on the golden half, `Config:` on FSE'26, `signals:` on the ablation's).

---

## 1. The defect the axis is about

Every metric's deviation is measured from a baseline **and** against an extremum:

```
riseRatio = |max − base| / base
dropRatio = |base − min| / base
deviation = log₁₀(1 + max(riseRatio, dropRatio × (1 − collapseDiscount)))
```

`max`, `min` and `base` were all taken over the **whole file** — the extremum over the entire
series, the baseline from change-point detection or `computeRobustBaseline`. That is only correct if
the series is stationary before the injection. It is not: a container that is still warming up opens
far above the level it settles at, and the whole-file window then divides the fault by the warm-up.

Measured, on `re3ss_carts_f4_2` (RE3 SockShop, truth `carts`, the fault is its own `cpu`), the truth's
decisive metric under the shipped configuration:

```
carts [GT,#2]   cpu=0.442{dev=0.301 rise=0.00 drop=1.00 base=2.999e+1}
```

`base = 30.0` is the warm-up level. The service actually runs at `4.41`, and the fault drives `cpu`
from `4.41` **up** to `30.0`. Anchored to the segment before the injection, the same series reads:

```
carts [GT,#3]   cpu=0.974{dev=0.833 rise=5.81 drop=1.00 base=4.413e+0}
```

A 5.8× rise was being scored as a **drop with ratio 1.00**, which is the capped end of the drop side
(`log₁₀2 ≈ 0.301`) — so the truth's own fault was reported at the smallest number the formula can
produce for a total loss, on a case where it rose sixfold. This is the same cap
`docs/drop-deviation-symmetry.md` measured, reached from the opposite direction: there the cap was
hit because the metric really collapsed; here it is hit **because the warm-up was mistaken for the
baseline**.

The competitor on that case was `orders-db` at `0.570`, from `diskio` — a victim two hops away. It won
by 0.09.

## 2. Why this is a WINDOW and not a lever

A lever changes how one term is weighted; a window changes the inputs of **every** term at once. That
is the cost and the point: `pre-injection` re-anchors the baseline, `max` **and** `min` of every
metric of every service on every case, so

- nothing it does can be attributed to a single term, and
- no weight sweep can imitate it, which is why it is a mode rather than a number.

It also means the blast radius is the whole fold, so the acceptance criterion cannot be "RE3-SS is up".
It has to be **RE3-SS up and every other cell read case by case**, which is what §4 does and §6 states
as still owed.

## 3. The form

```ts
const anchored = cfg.baselineAnchor === 'pre-injection'
  ? preInjectionWindow(ts.values, ts.timestamps, cfg.injectTimeMs ?? 0)
  : undefined;
const deviationBaseline = anchored?.baseline ?? baselineMean;
const deviationMax      = anchored?.max      ?? max;
const deviationMin      = anchored?.min      ?? min;
```

`preInjectionWindow` finds the first sample with `timestamps[i] >= injectTimeMs`, and refuses — falling
back to the whole-file window — unless **all** of these hold:

| guard | why |
| --- | --- |
| `injectTimeMs > 0` | a corpus without an injection time is a corpus with no split to find |
| `split >= 0` | every sample precedes the injection: no post segment exists to measure |
| `split >= floorWidth && n − split >= floorWidth`, `floorWidth = max(3, ⌈0.1·n⌉)` | a baseline of one sample is that sample, and a tail of one sample has no extremum |
| `baseline > 0` | the ratio is undefined, and the shipped path's `nonZeroBaseline` guards already treat this case as unmeasurable |

The baseline is the **median** of `[0, split)`, not the mean: a single 6.0 spike in a pre-injection
segment that runs at 3.5 moves the mean by 70% and the median not at all, and the baseline is a level
rather than a sum. `max`/`min` are taken over `[split, n)` — the post segment — because that is the
window the fault lives in.

Two consequences that are asserted rather than assumed:

1. **A warm-up with nothing after it is not a deviation.** If the series opens at 30 and settles at 3.5
   with no post-injection movement, both anchors find the same extremum and the same level within the
   post segment, so the score is 0 either way; the arm does not invent deviations out of drift.
2. **It is inert on a stationary series.** When the first sample is at the running level, the two
   windows agree to within the median's own noise, so the arm cannot move a case that had no warm-up —
   which is why §4's swaps are one-for-one rather than a reshuffle of the cell.

The breakdown record reports `baselineMean: deviationBaseline`, not the inference's own — a record that
echoed the whole-file mean would name a level the score never used, which is the class of defect
`docs/fse26-metric-source-attribution.md` exists for.

## 4. The measurement — the two cells this sandbox can assemble

Both cells were **rebuilt locally** from the published artifact (RCAEval, `phamquiluan/RCAEval`,
`re1ob_*` 125 cases and `re3ss_*` 30 cases), converted with `scripts/convert-parquet-to-json.py`, and
run at one input each with everything else at its shipped value. The shipped arm reproduces the
published cells exactly (RE1-OB 107/125, RE3-SS 18/30), which is the control that says the local
corpus is the same corpus.

| cell | cases | shipped `whole-file` | `pre-injection` | Δ cases | AC@1 | Avg@5 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| RE1 OnlineBoutique | 125 | 107 (85.6%) | **107 (85.6%)** | 0 | 85.6% → 85.6% | 92.8% → **93.1%** |
| RE3 SockShop | 30 | 18 (60.0%) | **19 (63.3%)** | **+1** | 63.6% → **67.1%** | 87.4% → **90.3%** |

Per fault type, RE3 SockShop — this is where the +1 lives:

| type | n | shipped | `pre-injection` |
| --- | ---: | ---: | ---: |
| f1 | 10 | 8 (80.0%) | 7 (70.0%) |
| f2 | 3 | 3 (100%) | 3 (100%) |
| f3 | 10 | 6 (60.0%) | **7 (70.0%)** |
| f4 | 7 | 1 (14.3%) | **2 (28.6%)** |

### 4a. The 2×2, because the arm alone is a WASH

The same commit carries a second, orthogonal change — the log loader's Node-dialect clause
(`rcaeval-loader.ts`, `ERR_INVALID_ARG_TYPE … Received undefined`) — and quoting "18 → 19" without
separating the two would attribute an interaction to a window. Both were measured on the same 30
cases, four arms, one input each:

| arm | log clause | anchor | hits | f1 | f2 | f3 | f4 | AC@1 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A — shipped before this iteration | – | `whole-file` | 18/30 | 8 | 3 | 6 | 1 | 63.6% |
| B — anchor only | – | `pre-injection` | 18/30 | 7 | 3 | 7 | 1 | 63.6% |
| C — clause only (**the new shipped configuration**) | ✓ | `whole-file` | 18/30 | 8 | 3 | 6 | 1 | 63.6% |
| D — both (the arm dispatched) | ✓ | `pre-injection` | **19/30** | 7 | 3 | 7 | **2** | **67.1%** |

Five cases move, and the per-case reading is the only place the interaction is visible:

| case | type | A | B | C | D | what moved it |
| --- | --- | :-: | :-: | :-: | :-: | --- |
| `re3ss_carts_f3_4` | f3 | · | ✓ | ✓ | ✓ | either change alone |
| `re3ss_orders_f3_2` | f3 | · | ✓ | · | ✓ | the anchor (and the clause alone does not reach it) |
| `re3ss_orders_f4_2` | f4 | · | · | · | ✓ | **neither alone — the pair** |
| `re3ss_carts_f1_2` | f1 | ✓ | · | ✓ | · | lost by the ANCHOR |
| `re3ss_carts_f3_3` | f3 | ✓ | · | · | · | lost by either |

So the **axis' own contribution is −2/+2, a wash in cases**, and the +1 belongs to the pair: the
anchor re-prices the truth's channel on `orders_f4_2` (its `error` count against the pre-injection
level) and only then does the clause's reclassification of the entry point change who wins. **The
honest number for the axis alone is 0, and the number for shipping both is +1** — this is written down
because the alternative is a table that credits a window with a log vocabulary's work, which is the
exact error `term-gap.md` was built to stop one level down.

**The count, not the mean.** AC@1 moves by +3.5pp on RE3-SS and 0.0pp on RE1-OB, and AC@1 is the mean
of the per-type rates, so it re-weights cases by how many of their type exist: on RE3-SS the gain lands
in f3/f4 (17 cases) and the loss in f1 (10 cases), which is why the mean moves more than the count.
**The case count is the number quoted**, and it is the reason this is dispatched to the other five
cells rather than enrolled on this evidence.

**What it is not.** This is not the drop-cap axis reopened. `drop-deviation-symmetry.md` §4 measured
that every lever moving RE3 down moved RE1 down with it, and the exchange rate it recorded is the
reason. This arm does not touch the shape of `deviation` at all — it fixes which segment the existing
shape is evaluated on — and on RE1-OB the two cases it moves are one each way, which is what "no
regression" looks like at 125 cases.

## 5. The worked case, and the mechanism it names

`re3ss_carts_f4_2` is worth keeping because it shows the arm doing exactly one thing:

| | baseline | rise | drop | deviation | rank |
| --- | ---: | ---: | ---: | ---: | ---: |
| `whole-file` | 29.99 | 0.00 | 1.00 | 0.301 | 2 |
| `pre-injection` | 4.41 | 5.81 | 1.00 | **0.833** | 3 |

The truth's cpu rose 5.8× and the shipped window called it a total collapse. The arm does not fix the
case — `front-end`'s own `error` channel rises 40× on the same fault and takes rank 1 at `1.755` — but
it corrects the number, and the remaining gap is a *different* mechanism (the entry point's error
channel, named in `docs/term-gap.md`'s account of the cell). A window cannot fix a competitor that is
also rising; it can only stop the truth from being scored as a drop.

## 6. What this does NOT license

- **Three cells regress, and the axis is therefore not enrolled.** All nine are now measured (§7):
  RE1-SS `116 → 119`, RE3-TT `21 → 25`, RE3-SS `18 → 19` against RE2-TT `75 → 72`, RE2-OB `80 → 79`
  and RE3-OB `25 → 24`. The corpus total improves by three cases; `RE2:TrainTicket` loses three on its
  own. A cell regression is refused on measurement even when the total improves, so the default stays
  `whole-file` and this document's title stays "an axis", not "a default".
- **The regression hypothesis was half wrong, and the half that survived is the sharper one.** It
  predicted losses inside the warm-up population — `mem`/`cpu` series that open high. What the nine
  cells show is that the concentration is on injection **index**: five of the ten losses are `_1`
  cases, and on RE2-TT *all five* of the arm's moves are `_1` (four losses, one gain), while the
  families are `disk`×3, `loss`×2, `delay`, `cpu` and three RE3 `f*` cases. The index is the variable
  because the *first* injection is the one whose pre-injection window is the container's own ramp: the
  anchored baseline becomes the ramp's median instead of a plateau, which deflates the truth's rise
  exactly where the whole-file window was already right. What that predicts is a **stationarity test on
  the pre-window**, not a family mask, and until that test exists the losses cannot be separated from
  the rescues.
- **It does not compose with `dropdev=log`.** The drop arm's explosion was measured against the
  whole-file window; re-anchoring moves the denominator of every ratio in that arm, so its numbers
  cannot be carried over. If the pair is ever proposed, it is a new measurement of four cells, not two.
- **`pre-injection` is not a default candidate on this evidence.** It ships OFF, and §4's +1 case is one
  case, of which the axis alone owns **zero**. Enrolling it means the nine-cell dispatch, not this table.

## 7. The nine-cell measurement — three arms, and the two mechanisms priced apart

The two-cell reading in §4 was the arm as far as this sandbox reaches. The nine-cell dispatch is the
measurement, and it needed a third arm: a branch at the parent of the log clause (`control/pre-clause-187`,
`e79c0b61`), so that the window's price is not a difference of totals over a change that landed beside it.

| cell | pre-clause `e79c0b61` | control (clause, `whole-file`) | anchored | Δ anchor |
| --- | ---: | ---: | ---: | ---: |
| RE1:OnlineBoutique | 105 | 107 | 107 | 0 |
| RE1:SockShop | 117 | 116 | **119** | **+3** |
| RE1:TrainTicket | 101 | 104 | 104 | 0 |
| RE2:OnlineBoutique | 80 | 80 | 79 | −1 |
| RE2:SockShop | 85 | 85 | 85 | 0 |
| RE2:TrainTicket | 75 | 75 | 72 | **−3** |
| RE3:OnlineBoutique | 25 | 25 | 24 | −1 |
| RE3:SockShop | 18 | 18 | 19 | +1 |
| RE3:TrainTicket | 21 | 21 | **25** | **+4** |
| **735** | **627** | **631** | **634** | **+3** |

| move | gains | losses | net |
| --- | ---: | ---: | ---: |
| the log clause (`pre → control`) | 11 | 7 | +4 |
| **this axis** (`control → anchored`) | **13** | **10** | **+3** |
| both | 24 | 17 | +7 |

**The two move-sets do not intersect.** Not one of the 735 cases is moved by both mechanisms, so the
effects are additive on the nose: `627 + 4 + 3 = 634`. That is the first time this project has been able
to state a two-change iteration that way, and it is what the third arm was for — one arm would have
split +7 between a vocabulary and a window by assertion, which is the same error as quoting §4a's pair
total for the axis.

The shape of the axis' own ledger is the part that matters for what comes next:

| | gains (13) | losses (10) |
| --- | --- | --- |
| truth's rank before | 2 ×6, 3 ×3, 4, 7, 13, **20** | 1 ×10 |
| truth's rank after | 1 ×13 | 2 ×6, 3 ×3, 4 ×1 |
| Δ on the truth's `finalScore` | median **+0.164**, max +0.484 | median **−0.016**, min −0.113 |
| injection index | 1 ×2, 2 ×3, 3 ×2, 4 ×4, 5 ×2 | **1 ×5**, 2 ×2, 3 ×1, 5 ×2 |

`finalScore` is a sum whose self-anomaly term is the truth's **rank fraction inside the pool**
(`rankNormalization` is on), so a delta on it is a rank effect as much as a magnitude effect — which is
the right thing to read here, because Top@1 is a rank count and the table's third row exists to show
that the two populations sit on opposite sides of zero with very different amplitude.

Four deep rescues (`ts-route-service_f4_3` 20 → 1, `f2_2` 13 → 1, `f2_1` 7 → 1, `f1_3` 4 → 1) bought
with ten one-step demotions whose median cost to the truth's own score is `0.016`. On Top@1 that is +3.
On a rank-sensitive metric it would be a large win, and the project does not report one — so the +3 is
the number and the asymmetry is an argument, not a result.

### 7a. FSE'26, where the clause cannot reach

| arm | Top@1 | Top@3 | Top@5 |
| --- | ---: | ---: | ---: |
| pre-clause `e79c0b61` | 60.478% | 79.044% | 82.208% |
| control (clause, `whole-file`) | 60.478% | 79.044% | 82.208% |
| **anchored** | **61.181%** | **79.606%** | **82.630%** |

`+10` cases of 1422, and the clause's row is identical to the pre-clause row to sixteen digits because
`PROPAGATED_EXCEPTION_PATTERN` is reachable from `rcaeval-loader.ts` only — the clause is not "neutral"
on this suite, it is absent from it. The gains are `HTTPResponseDelay +4`, `HTTPRequestReplaceMethod +4`,
`HTTPResponseReplaceCode +2` and four single cases; the losses are `HTTPRequestDelay −1`,
`NetworkCorrupt −1`, a four-case cell (`HTTPResponsePatchBody 3 → 2`) and a **one-case** cell
(`DNSRandom 1 → 0`, which prints as −100.0 pp and means nothing).

### 7b. What the run did not instrument — and now does

The anchor falls back per series — short window, non-positive baseline, a side narrower than
`max(3, ⌈0.1n⌉)` — and no artifact said how often. "This cell did not move" could not be told apart from
"the guard refused the anchor on every series in this cell", which is the whole question on RE2:SockShop.
**That counter now exists** (§8), it took two tries to build, and its first reading changed the next axis.

### 7c. The second value — the window gated on the level it rests on

The ten losses' concentration on injection index 1 is a statement about the PRE-SEGMENT, not about a fault
family: the first injection of a run is the one whose pre-window is the container's own ramp, so its median
is a level the service never held. That is a condition the segment can be asked about directly, and
`pre-injection-stationary` is the same window with one extra refusal:

```
drift = |median(second half of the pre-segment) − median(first half)| / |median(pre-segment)|
anchors iff  drift is defined  ∧  drift ≤ DEFAULT_MAX_PRE_WINDOW_DRIFT (0.25)
             ∧  the pre-segment holds ≥ MIN_STATIONARY_PRE_SAMPLES (6) samples
```

Three decisions are in those two lines, and each has a reason that is not a taste:

- **Both halves are medians**, the same estimator the baseline uses. A guard that judged a median with a
  mean would refuse windows the baseline reads correctly, and vice versa.
- **The denominator is the segment's own median**, so `0.25` means "a quarter of the level". Against the
  mean a single start-up spike deflates the statistic and a real ramp reads as flat.
- **Length is a separate condition from shape.** Six samples is three per half, and below that the guard
  refuses a window whose halves *agree*, because two-sample halves agree by accident far more often than a
  hundred-sample halves do.

The 30-case cell that carries the axis' deepest rescue is the local check, and it reads as a guard should:

| arm | hits | moves against `whole-file` |
| --- | ---: | --- |
| `whole-file` (shipped) | 18/30 | — |
| `pre-injection` | 19/30 | **+3 / −2** (`carts_f3_4` 2→1, `orders_f3_2` 2→1, `orders_f4_2` 3→1 / `carts_f1_2` 1→3, `carts_f3_3` 1→2) |
| `pre-injection-stationary` | 19/30 | **+2 / −1** (`carts_f4_2` 2→1, `orders_f3_2` 2→1 / `carts_f3_3` 1→2) |

**Same total, one loss instead of two, and the loss it avoids is the one the unguarded arm created**
(`carts_f1_2` 1→3). It also gives up the `carts_f3_4` gain, which was the swap half of that pair — so the
guard is doing what it says on this cell: it refuses the anchoring on the cases where the anchoring was a
wash and keeps the two rescues that were not. It does **not** fix `carts_f3_3`, whose loss survives the
guard, and one cell of thirty is not the enrolment evidence — the nine-cell dispatch is.

**Measured on all nine cells and on FSE'26, the guard is worth +1 case on the golden half and −6 on
FSE'26, so it is a third VALUE and not a new default:**

| arm | RE1-OB | RE1-SS | RE1-TT | RE2-OB | RE2-SS | RE2-TT | RE3-OB | RE3-SS | RE3-TT | 735 | FSE'26 Top@1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `whole-file` (shipped) | 107 | 116 | 104 | 80 | 85 | 75 | 25 | 18 | 21 | **631** | 60.478% |
| `pre-injection` | 107 | **119** | 104 | 79 | 85 | 72 | 24 | **19** | **25** | **634** | **61.181%** |
| `pre-injection-stationary` | 107 | **118** | 104 | 79 | 85 | **73** | **25** | **19** | **25** | **635** | 60.759% |

Against the unguarded arm the guard is `+5 / −4` on the golden half and it recovers exactly the losses it
was built for — **both remaining RE2:TrainTicket `_1` cases** (`ts-order-service_disk_1` 2→1,
`ts-travel-service_cpu_1` 2→1) and the RE3:OnlineBoutique loss (`cartservice_f1_1` 2→1) — while giving back
four of the unguarded arm's near-swaps (`carts_f3_4` 1→2, `orders_f4_2` 1→2, `re2tt_order-service_mem_1`
1→2, and a new one, `re1ss_user_mem_5` 1→2). On FSE'26 it is the other way round: `864` cases against the
unguarded arm's `870`, closing `HTTPRequestDelay +2`, `NetworkCorrupt +1` and two single cases against
`HTTPRequestReplaceMethod −4`, `HTTPResponseDelay −4` and three singles.

**The two suites disagree, and that is the result.** The stationarity condition is the right discriminator
for the golden half's first-injection losses and the wrong one for FSE'26's transport faults, where the
anchoring is doing real work on pre-segments that are *also* non-stationary. So the condition cannot be
"stationary" alone: the statistic already computes a SIGNED difference (`median(second half) −
median(first half)`) and the guard throws the sign away. A declining pre-segment — the container that opens
at 30 and settles to 3.5, which is this axis' founding case — and a rising one are both "non-stationary"
to the current test, and the corpus says they must be separated before either value can be a default.

## 8. The census, and what it says about the guard's own population

§7b recorded a counter as owed; §8 is that counter, its first reading on 735 cases, and the arm the
reading produced.

### 8a. One function, two callers

`probePreInjectionWindow(values, timestamps, t₀, guard)` answers "would a window be placed here, and if
not, why" — and it is what the engine calls to place the window. The benchmark's `anchor-census` module
calls the same function on the same `TimeSeries` the engine receives, so a refusal counted in an artifact
is a refusal that happened. Nothing here re-derives the comparison: `judgePreWindowDrift` owns
`|drift| ≤ tolerance` and `drift ≤ tolerance`, and a source-shape fence fails if a second copy appears.

Six reasons, one per mechanism that can refuse:

| reason | mechanism | whose property |
| --- | --- | --- |
| `no-injection-time` | `t₀ ≤ 0`, the graph builder's default | the case |
| `no-boundary` | no sample reaches `t₀` | the case |
| `narrow-segment` | a side narrower than `max(3, ⌈n/10⌉)` | the series |
| `non-positive-baseline` | a level of zero is not a denominator | the series |
| `undecidable-drift` | the pre-segment is too short to halve | the series |
| `drift` | the guard read the drift and refused it | the guard |

The first four are **guard-independent** and are reported as `unplaceable`, because merging them with the
last two is what made the old single bit useless: "this cell has short series" and "this cell is a corpus
of ramps" are different repairs.

One defect was found by reading the artifact's own output rather than by a test: `drift` was
`number | undefined`, and `JSON.stringify` **drops** an undefined property, so the field vanished from
exactly the series whose drift could not be read — a well-formed file with a field silently missing.
It is now `number | null` at the point of writing, and a test round-trips the record to prove the key
survives for a series whose reading does not exist.

### 8b. What the corpus actually contains

735 cases, 90 990 series, on the unguarded arm (the census is a property of the series, so this table is
the same under every value):

| cell | series | placeable | level | rising | settling |
| --- | ---: | ---: | ---: | ---: | ---: |
| RE1:OnlineBoutique | 6 800 | 6 243 | 6 060 (97.1%) | 108 (1.7%) | 75 (1.2%) |
| RE1:SockShop | 7 370 | 6 750 | 6 430 (95.3%) | 212 (3.1%) | 108 (1.6%) |
| RE1:TrainTicket | 26 694 | 24 114 | 22 878 (94.9%) | 815 (3.4%) | 421 (1.7%) |
| RE2:OnlineBoutique | 6 603 | 5 848 | 5 804 (99.2%) | 36 (0.6%) | 8 (0.1%) |
| RE2:SockShop | 6 895 | 6 303 | 6 020 (95.5%) | 127 (2.0%) | 156 (2.5%) |
| RE2:TrainTicket | 32 592 | 31 144 | 29 154 (93.6%) | 1 535 (4.9%) | 455 (1.5%) |
| RE3:OnlineBoutique | 2 110 | 1 920 | 1 838 (95.7%) | 73 (3.8%) | 9 (0.5%) |
| RE3:SockShop | 2 491 | 2 220 | 2 002 (90.2%) | 177 (8.0%) | 41 (1.8%) |
| RE3:TrainTicket | 9 455 | 8 687 | 7 334 (84.4%) | **1 097 (12.6%)** | 256 (2.9%) |

**The guard's reach varies by a factor of 21 across cells** — 0.6% of RE2:OnlineBoutique's series are
rising against 12.6% of RE3:TrainTicket's — and no threshold can be right at both ends. That is a
measurement, and it is the first time this project has been able to state it: before this instrument, a
cell where the guard refused nothing and a cell where it refused everything were the same artifact.

### 8c. The fourth value — `pre-injection-non-rising`, and it ties

`|drift| ≤ 0.25` refuses both shapes; `drift ≤ 0.25` refuses only the rising one. Both were dispatched on
all nine cells and on FSE'26 at the same commit as the census:

| arm | RE1-OB | RE1-SS | RE1-TT | RE2-OB | RE2-SS | RE2-TT | RE3-OB | RE3-SS | RE3-TT | 735 | FSE'26 Top@1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `whole-file` (shipped) | 107 | 116 | 104 | 80 | 85 | 75 | 25 | 18 | 21 | **631** | 60.478% (860) |
| `pre-injection` | 107 | **119** | 104 | 79 | 85 | 72 | 24 | 19 | **25** | **634** | **61.181% (870)** |
| `pre-injection-stationary` | 107 | **118** | 104 | 79 | 85 | **73** | **25** | 19 | **25** | **635** | 60.759% (864) |
| `pre-injection-non-rising` | 107 | **118** | 104 | 79 | 85 | **73** | 24 | **20** | **25** | **635** | 60.900% (866) |

Two properties hold before any reading. **The census is inert**: dispatched at `pre-injection` the
instrumented build returns `634` and every cell matches §7's arm case for case, so the instrument
measures and does not perturb. **The two guarded values tie at 635 and are not the same arm**: they agree
on seven cells and swap one each on RE3:OnlineBoutique (25 vs 24) and RE3:SockShop (19 vs 20), and
`stationary → non-rising` is `+4 / −4` at the case level.

Locally, on the two cells this sandbox assembles, RE3:SockShop is the sharpest reading — `18 / 19 / 19 / 20`
for the four values, i.e. the signed guard is the only one that gains a case over the unguarded arm *and*
keeps the founding case. RE1:OnlineBoutique is `107 / 107 / 107 / 107` with one-for-one swaps in every arm.

### 8d. The sign was worth zero, and the reason is that each half buys a different case

`stationary → non-rising` closes `+4 / −4`, and the four gains and four losses name the two sub-mechanisms:

| case | `stationary` | `non-rising` | what the case needs |
| --- | ---: | ---: | --- |
| `re3ss_carts_f4_2` | **1** | 3 | the SETTLING refusal — its truth's `cpu` opens at 30 and settles to 3.5, `drift = −0.82` |
| `re3ss_carts_f1_2` | **1** | 3 | the SETTLING refusal |
| `re2tt_ts-travel-service_cpu_1` | **1** | 2 | the SETTLING refusal |
| `re3ob_cartservice_f1_1` | **1** | 2 | the SETTLING refusal |
| `re3ss_orders_f4_3` | 2 | **1** | the RISING allowance |
| `re3ss_orders_f4_2` | 2 | **1** | the RISING allowance |
| `re3ss_carts_f3_4` | 2 | **1** | the RISING allowance |
| `re2tt_ts-order-service_mem_1` | 2 | **1** | the RISING allowance |

So the two guard kinds are not two thresholds on one phenomenon: refusing a settling pre-segment buys four
cases and loses four, and the signed guard simply moves the trade. **A single threshold on a single
statistic cannot have both halves**, which is why the value ties rather than wins — and the tie is the
measurement that closes the "sign is the missing discriminator" hypothesis §188 left open.

On FSE'26 the order is the opposite of the golden half's: `870` unguarded, `866` signed, `864` symmetric.
Refusing any pre-segment costs that suite, and the signed guard costs less than the symmetric one
(`HTTPRequestReplaceMethod −4` in both, `HTTPResponseDelay −4` in both, offset by `HTTPRequestDelay +2`,
`JVMMemoryStress +1`, `ContainerKill +1` in the signed arm).

### 8e. What DOES separate the axis' gains from its losses

The 23 moves of the unguarded arm (§7.4) were re-read through the census, and the pre-window is not the
discriminator:

| feature (median) | gains (13) | losses (10) | all 735 |
| --- | ---: | ---: | ---: |
| placeable series / series | 0.915 | 0.930 | 0.918 |
| rising share of placeable | 0.054 | 0.029 | 0.019 |
| settling share of placeable | 0.014 | 0.004 | 0.005 |
| max \|drift\| in the case | 1.004 | 0.993 | 0.640 |
| **candidate pool** | **15** | **39** | **13** |

The truth's own drift sign is the same in both populations — gains `{level 4, settling 8, rising 1}`,
losses `{level 4, settling 6}` — so no test on the truth's pre-window can tell them apart. The candidate
pool can: **a loss is nearly three times as likely in a large graph as in a small one** (median 39 against
15), which is the arithmetic of a one-step demotion. With 39 candidates, a perturbation of the truth's
score by `0.016` (the measured median) reorders it; with 15, it often does not. The axis' losses are
therefore a property of the RANKING's density and not of the window's admissibility.

That is the next lever, and it is not this axis: it is `rankNormalization` and the score-gap distribution
at the top of a large graph.

### 8f. Verdict

`baselineAnchor` ships at `whole-file`. The four values are priced — `631 / 634 / 635 / 635` on 735 cases,
`860 / 870 / 864 / 866` on FSE'26 — and **no value clears the per-cell bar**: every anchored arm regresses
RE2:OnlineBoutique `80 → 79`, and every guarded one regresses RE2:TrainTicket `75 → 73`. The unguarded
arm is the best on FSE'26 and second on the golden half; the guarded arms are the opposite. A default
cannot be the argmax of one corpus and the loser of the other, so the default stays where every published
number was measured.

## 9. How to re-measure

```bash
# golden half, one input, everything else shipped
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=anchor=pre-injection
# ... or the guarded value, which is the same input with a different value — never a second knob
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=anchor=pre-injection-stationary
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=anchor=pre-injection-non-rising
# FSE'26 half
gh workflow run fse26-benchmark.yml -f ranking_knobs=baseline_anchor=pre-injection
gh workflow run fse26-benchmark.yml -f ranking_knobs=baseline_anchor=pre-injection-stationary
gh workflow run fse26-benchmark.yml -f ranking_knobs=baseline_anchor=pre-injection-non-rising
# any of the four, and the census rides in the loss-census artifact either way
gh workflow run benchmark-rcaeval.yml -f anomaly_knobs=anchor=pre-injection --ref master
# locally, on an assembled corpus
pnpm exec tsx benchmarks/src/run-rcaeval.ts --data-dir <dir> --suite re3 --system ss \
  --baseline-anchor pre-injection --diagnose-dump /tmp/dump.json
```

The configuration lines state the anchor unconditionally on all three artifacts — `baselineAnchor=whole-file`
is printed at the shipped value — because an omitted-when-default field would render the shipped run
and a run that re-anchored every metric **byte-identically**, which is the defect the lines exist to
prevent. `dispatch-surface-census.test.ts` requires the flag, its owner (this file), and its presence in
the packed input blocks of both workflows, so the axis cannot become unreachable by omission.
