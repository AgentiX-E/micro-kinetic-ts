# The term-weight landscape: what the 237 misses are worth, measured before anything is changed

**Written 2026-11-13 (iteration 271); §2–§3 rewritten at iteration 272 from the screen itself.** Read
`docs/closed-axes-register.md`'s iteration-271 entry first: this document is the second half of that measurement,
and it closes the axis the entry left open. The iteration-272 rewrite is not a cosmetic one — promoting the screen
from a 60-line script into `benchmarks/src/term-weight-screen.ts` changed three of this document's own statements,
and §3 is the record of which and why.

## 0. What this is

Iteration 271's decomposition found a stable corpus-level structure — `stability` and `lat` pay the *truth* more
than the winner on ~68 % of the 237 re-rankable misses, `selfAnomalyLog1p` and `log` pay the *symptom* more — and
refused the family-level correction the pre-registration would have licensed, because one cell in a 114-cell grid
is not evidence. The obvious next question is not statistical but arithmetic: **at what weight does a term win a
case back, and what does that weight cost?**

That question needs no engine. Every term's contribution is `w × slope`, so changing a weight from `w` to `w′`
moves a candidate's score by exactly `(w′ − w) × slope(candidate, term)` — one multiplication per candidate per
term, over a dump that already holds every candidate of every case. So the whole landscape is a **screen over one
40 MB artifact**, and the confirmation is one dispatch rather than one dispatch per grid point.

## 1. The method, stated so it can be checked

For each of the 1 422 cases, the terms dump of run `43334354978` carries the full ranking; for each candidate, its
`finalScore` and the `(name, weight, slope)` triples. The screen:

1. reconstructs every candidate's score as `Σ w × slope` and **refuses the case if the reconstruction differs from
   the recorded score by more than 1e-9** — the same tolerance `term-decomposition.ts` refuses on, because two
   readers of one dump disagreeing about which cases are usable is the defect both exist to prevent. On this dump
   **0 of 1 422 cases are refused**: the identity holds exactly, worst residual `0.0`;
2. re-scores every candidate with the moved weights **replaced rather than adjusted** — a moved name's
   contribution becomes `w′ × Σ slope`, which is exact even if the triples carrying that name recorded different
   weights — and re-sorts with the original index as the tie-break, so two candidates at equal score keep the
   engine's order;
3. counts `Top@1` over all 1 422 cases, and **per fault family**, because the gate is a family gate.

**The gate is the one the pre-registration fixed before any of this was computed:** `Top@1` must not fall, and **no
fault family with n ≥ 20 may lose a case that the shipped run answered**. A change that gains 13 cases by taking
one from each of two families is refused, which is the rule the register has applied since iteration 262 refused a
fitted vector worth `+114` held out.

**Baseline check, and it is the whole reason the screen can be trusted:** at `Δw = 0` the screen returns
**1 073 / 1 422 = 75.46 %**, which is the published number, case for case. A screen that did not reproduce the
measurement it re-derives would be describing a different engine.

## 2. The landscape, all 28 points

Shipped weights as the dump recorded them, heaviest first: `podState 8`, `log 1`, `selfAnomalyLog1p 1`,
`lat 0.561495`, `dualFamily 0.25`, `pool −0.0679`, `stability 0.007352`. **Twelve of the formula's nineteen terms
carry weight 0** — seven of them recorded as `0` in the dump (`collision`, `failedEdge`, `prism`, `rise`, `source`,
`temporal`, `topo`) and five absent from it entirely (`trace`, `faultFree`, `selfTime`, `emission`, `victim`). So the
shipped ranking is a sum of **seven terms that carry weight** — `source` is not one of them — and the grid below
moves three of those seven. (The 271 entry uses "live" in a different sense: a term whose contribution *separates*
on the 237 misses, of which there are also seven, and the two lists are not the same list — `podState` carries
weight 8 and separates on none of them.)

Every point in the grid is printed. The previous version of this table printed "the best of each row" of its
two-dimensional moves, which is a selection whose rule was whoever wrote the script.

| move | Top@1 | Δ | gained/lost | families above the floor that lose |
| ---- | ----: | -: | ----------: | ---------------------------------- |
| `stability 0` | 1 073 | 0 | 0/0 | nothing moved in either direction — **NO-OP** |
| `stability 0.02` | 1 073 | 0 | 0/0 | nothing moved in either direction — **NO-OP** |
| `stability 0.05` | 1 074 | +1 | 2/1 | HTTPRequestDelay −1 (n=88) |
| `stability 0.1` | 1 075 | +2 | 6/4 | HTTPRequestDelay −2 (n=88), HTTPResponseReplaceCode −1 (n=231), NetworkPartition −1 (n=97) |
| `stability 0.2` | 1 077 | +4 | 14/10 | HTTPRequestDelay −2 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPRequestReplacePath −1 (n=39), HTTPResponseReplaceCode −2 (n=231), JVMException −2 (n=43), NetworkPartition −1 (n=97) |
| `stability 0.3` | 1 079 | +6 | 23/17 | HTTPRequestDelay −2 (n=88), HTTPRequestReplaceMethod −2 (n=190), HTTPRequestReplacePath −3 (n=39), HTTPResponseDelay −1 (n=89), HTTPResponseReplaceCode −3 (n=231), JVMException −2 (n=43), JVMReturn −1 (n=21), NetworkPartition −1 (n=97) |
| `stability 0.4` | 1 074 | +1 | 29/28 | HTTPRequestAbort −1 (n=60), HTTPRequestDelay −4 (n=88), HTTPRequestReplaceMethod −2 (n=190), HTTPRequestReplacePath −3 (n=39), HTTPResponseDelay −3 (n=89), HTTPResponseReplaceCode −5 (n=231), JVMException −4 (n=43), JVMReturn −1 (n=21), NetworkDelay −1 (n=21), NetworkLoss −1 (n=48), NetworkPartition −1 (n=97) |
| `stability 0.8` | 1 046 | -27 | 36/63 | HTTPRequestAbort −2 (n=60), HTTPRequestDelay −8 (n=88), HTTPRequestReplaceMethod −8 (n=190), HTTPRequestReplacePath −5 (n=39), HTTPResponseDelay −3 (n=89), HTTPResponseReplaceBody −2 (n=51), HTTPResponseReplaceCode −14 (n=231), JVMException −5 (n=43), JVMReturn −3 (n=21), NetworkCorrupt −4 (n=46), NetworkDelay −1 (n=21), NetworkLoss −2 (n=48), NetworkPartition −3 (n=97) |
| `stability 1.6` | 934 | -139 | 43/182 | HTTPRequestAbort −11 (n=60), HTTPRequestDelay −12 (n=88), HTTPRequestReplaceMethod −32 (n=190), HTTPRequestReplacePath −13 (n=39), HTTPResponseAbort −7 (n=44), HTTPResponseDelay −5 (n=89), HTTPResponseReplaceBody −6 (n=51), HTTPResponseReplaceCode −46 (n=231), JVMException −8 (n=43), JVMReturn −5 (n=21), NetworkBandwidth −2 (n=42), NetworkCorrupt −11 (n=46), NetworkDelay −5 (n=21), NetworkLoss −7 (n=48), NetworkPartition −6 (n=97) |
| `lat 0` | 1 015 | -58 | 4/62 | HTTPRequestDelay −12 (n=88), HTTPRequestReplaceMethod −2 (n=190), HTTPResponseDelay −13 (n=89), NetworkBandwidth −3 (n=42), NetworkCorrupt −8 (n=46), NetworkDelay −9 (n=21), NetworkLoss −6 (n=48), NetworkPartition −6 (n=97) |
| `lat 0.2` | 1 050 | -23 | 4/27 | HTTPRequestDelay −7 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPResponseDelay −7 (n=89), NetworkBandwidth −1 (n=42), NetworkCorrupt −4 (n=46), NetworkDelay −4 (n=21), NetworkLoss −2 (n=48) |
| `lat 0.4` | 1 067 | -6 | 2/8 | HTTPRequestDelay −4 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPResponseDelay −1 (n=89), NetworkCorrupt −1 (n=46), NetworkLoss −1 (n=48) |
| `lat 0.8` | 1 041 | -32 | 2/34 | HTTPRequestAbort −3 (n=60), HTTPRequestReplaceMethod −10 (n=190), HTTPRequestReplacePath −1 (n=39), HTTPResponseAbort −2 (n=44), HTTPResponseDelay −1 (n=89), HTTPResponseReplaceBody −2 (n=51), HTTPResponseReplaceCode −13 (n=231), JVMException −1 (n=43) |
| `lat 1.2` | 896 | -177 | 10/187 | HTTPRequestAbort −15 (n=60), HTTPRequestDelay −2 (n=88), HTTPRequestReplaceMethod −45 (n=190), HTTPRequestReplacePath −14 (n=39), HTTPResponseAbort −14 (n=44), HTTPResponseDelay −5 (n=89), HTTPResponseReplaceBody −14 (n=51), HTTPResponseReplaceCode −60 (n=231), JVMException −11 (n=43), JVMReturn −6 (n=21) |
| `log 0.3` | 848 | -225 | 29/254 | HTTPRequestAbort −21 (n=60), HTTPRequestDelay −4 (n=88), HTTPRequestReplaceMethod −58 (n=190), HTTPRequestReplacePath −18 (n=39), HTTPResponseAbort −18 (n=44), HTTPResponseDelay −5 (n=89), HTTPResponseReplaceBody −26 (n=51), HTTPResponseReplaceCode −85 (n=231), JVMException −12 (n=43), JVMReturn −7 (n=21) |
| `log 0.5` | 920 | -153 | 13/166 | HTTPRequestAbort −15 (n=60), HTTPRequestDelay −3 (n=88), HTTPRequestReplaceMethod −39 (n=190), HTTPRequestReplacePath −12 (n=39), HTTPResponseAbort −13 (n=44), HTTPResponseDelay −3 (n=89), HTTPResponseReplaceBody −13 (n=51), HTTPResponseReplaceCode −57 (n=231), JVMException −6 (n=43), JVMReturn −5 (n=21) |
| `log 0.8` | 1 044 | -29 | 4/33 | HTTPRequestAbort −2 (n=60), HTTPRequestReplaceMethod −10 (n=190), HTTPRequestReplacePath −1 (n=39), HTTPResponseAbort −1 (n=44), HTTPResponseDelay −1 (n=89), HTTPResponseReplaceBody −2 (n=51), HTTPResponseReplaceCode −15 (n=231), JVMException −1 (n=43) |
| `log 1.2` | 1 073 | 0 | 6/6 | HTTPRequestDelay −4 (n=88), HTTPResponseDelay −1 (n=89) |
| `log 1.6` | 1 066 | -7 | 11/18 | HTTPRequestDelay −6 (n=88), HTTPResponseDelay −2 (n=89), NetworkBandwidth −1 (n=42), NetworkCorrupt −2 (n=46), NetworkLoss −2 (n=48), NetworkPartition −4 (n=97) |
| `stability 0.1 + log 1.2` | 1 077 | +4 | 11/7 | HTTPRequestDelay −3 (n=88), HTTPResponseDelay −1 (n=89), HTTPResponseReplaceCode −1 (n=231), NetworkPartition −1 (n=97) |
| `stability 0.2 + log 1.2` | 1 079 | +6 | 17/11 | HTTPRequestDelay −3 (n=88), HTTPRequestReplacePath −1 (n=39), HTTPResponseDelay −2 (n=89), HTTPResponseReplaceCode −1 (n=231), JVMException −1 (n=43), NetworkPartition −1 (n=97) |
| `stability 0.3 + log 1.2` | 1 086 | +13 | 27/14 | HTTPRequestDelay −2 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPRequestReplacePath −2 (n=39), HTTPResponseDelay −3 (n=89), HTTPResponseReplaceCode −1 (n=231), JVMException −1 (n=43), JVMReturn −1 (n=21), NetworkPartition −1 (n=97) |
| `stability 0.4 + log 1.2` | 1 085 | +12 | 33/21 | HTTPRequestDelay −5 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPRequestReplacePath −2 (n=39), HTTPResponseDelay −3 (n=89), HTTPResponseReplaceCode −1 (n=231), JVMException −3 (n=43), JVMReturn −1 (n=21), NetworkDelay −1 (n=21), NetworkLoss −1 (n=48), NetworkPartition −1 (n=97) |
| `stability 0.1 + lat 0.4` | 1 071 | -2 | 7/9 | HTTPRequestDelay −4 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPResponseDelay −1 (n=89), HTTPResponseReplaceCode −1 (n=231), NetworkCorrupt −1 (n=46), NetworkPartition −1 (n=97) |
| `stability 0.2 + lat 0.4` | 1 075 | +2 | 13/11 | HTTPRequestDelay −4 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPRequestReplacePath −1 (n=39), HTTPResponseDelay −1 (n=89), HTTPResponseReplaceCode −1 (n=231), JVMException −1 (n=43), NetworkPartition −1 (n=97) |
| `stability 0.3 + lat 0.4` | 1 076 | +3 | 23/20 | HTTPRequestDelay −5 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPRequestReplacePath −2 (n=39), HTTPResponseDelay −2 (n=89), HTTPResponseReplaceCode −2 (n=231), JVMException −1 (n=43), JVMReturn −1 (n=21), NetworkCorrupt −1 (n=46), NetworkDelay −1 (n=21), NetworkLoss −1 (n=48), NetworkPartition −1 (n=97) |
| `stability 0.2 + lat 0.4 + log 1.2` | 1 076 | +3 | 17/14 | HTTPRequestDelay −5 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPRequestReplacePath −1 (n=39), HTTPResponseDelay −3 (n=89), HTTPResponseReplaceCode −1 (n=231), JVMException −1 (n=43), NetworkPartition −1 (n=97) |
| `stability 0.3 + lat 0.4 + log 1.2` | 1 078 | +5 | 25/20 | HTTPRequestDelay −5 (n=88), HTTPRequestReplaceMethod −1 (n=190), HTTPRequestReplacePath −2 (n=39), HTTPResponseDelay −3 (n=89), HTTPResponseReplaceCode −1 (n=231), JVMException −1 (n=43), JVMReturn −1 (n=21), NetworkCorrupt −1 (n=46), NetworkDelay −1 (n=21), NetworkLoss −1 (n=48), NetworkPartition −1 (n=97) |

## 3. Three things the screen changed when it became code

### 3.1 The admissible set was not empty — it held two points that change nothing

The iteration-271 version of this document said "the shipped weights are the only point measured that loses
nothing", and closed the axis on "the admissible set is empty". Both are wrong as stated, and the screen says why:
`stability → 0` and `stability → 0.02` **also** lose nothing, because they change nothing — 0 gained, 0 lost, the
same 1 073 cases in the same order. A gate written as "`Top@1` must not fall" is satisfied by the identity, so the
set of points that pass it always contains the identity's neighbourhood. And the third zero row is not a no-op:
`log → 1.2` is 6 gained against 6 lost, a wash that takes four cases from `HTTPRequestDelay` — which is why the
no-op test has to be the gross counts and not the net.

`term-weight-screen.ts` therefore reports two things separately and refuses to conflate them: a point that gains
and loses nothing is **ADMISSIBLE**, and a point that neither gains nor loses is **NO-OP** — passing by doing
nothing at all. Under that split the verdict for this dump is:

```
ADMISSIBLE SET: EMPTY — no point gains a case without taking one from a family with n >= 20
  and 2 point(s) pass the gate by changing nothing (worth 0 cases): stability 0, stability 0.02
```

That is the iteration-271 conclusion, correctly stated for the first time. It cost nothing to find and it would
have cost a proposal to miss: a future session reading "the admissible set is empty" would not know whether the
gate had been applied or merely mis-written.

### 3.2 Every gain is an exchange, and the gross is 3 to 57 times the net

`Δ` is a net, and a net is exactly what the gate exists to distrust. The `gained/lost` column is the gross, and it
makes the shape of this landscape visible in a way the net column hid:

- **13 of the 28 points gain at least one case, and every one of the 13 loses at least one.** There is no point on
  the grid that is a strict improvement — not one case gained for free;
- the best net on the board, `stability 0.3 + log 1.2` at `+13`, is **27 gained against 14 lost**: 41 cases change
  hands to move the total by 13, and it is not the worst trade on the grid but the second best;
- the ratio of gross exchange to net gain runs from **3.0** (`stability 0.05`, 2/1) to **57** (`stability 0.4`,
  29/28 over one case of net) — the median is exactly **6.0**, and the two best rows sit at the bottom of the
  range: `+13` exchanges 41 cases (ratio 3.2), `+12` exchanges 54 (4.5).

This is the strongest form of the negative result the register needs, and it is stronger than "the admissible set
is empty" because it is quantitative: the population does not contain a direction of improvement with a slope, it
contains a near-cancellation. Gains and losses are of the same order at every point of the grid, which is why no
weight vector can be found by searching harder — moving along the grid trades one set of cases for another at a
rate of roughly 4 to 1, and the residual is what a corpus-level rate calls a result.

### 3.3 The published loss column was incomplete, and it understated every refusal

The iteration-271 table listed **two** families losing under `stability 0.3 + log 1.2` (`HTTPRequestDelay −1`,
`HTTPResponseReplacePath −2`) and concluded the point "fails the gate by three cases across two families". The
screen says **eight** families lose **14** cases:

```
HTTPRequestDelay −2, HTTPRequestReplaceMethod −1, HTTPRequestReplacePath −2, HTTPResponseDelay −3,
HTTPResponseReplaceCode −1, JVMException −1, JVMReturn −1, NetworkPartition −1
```

The old column was produced by a script that printed the losses it happened to collect first, and three cases
against two families and fourteen against eight are different refusals: the first reads as a near miss worth
arguing about, the second as a point that moves two thirds of the corpus's fault families in the wrong direction.
The same defect runs through the whole column — `stability → 0.2` was published as three families and is six,
`stability → 0.4` as "five families, −8 in total" and is eleven families and −26, `lat → 0.4` as four and is five.

The mechanism is worth naming because it is the argument for putting a screen in the tree rather than beside it: a
script that aggregates into a printed string can only print what it was written to collect, and nothing about the
printed string says which part it left out. The module returns a `losses` array and the formatter has no way to
print a family it was not given, so the column cannot understate a row without the row being wrong.

## 4. What this closes, and what it does not

**Closed: the global weight axis, under the pre-registered gate.** No point on the grid gains a case without
losing one, and the points that lose nothing are the points that do nothing. That is not a failure of the search;
it is the same conclusion `DEFAULT_LAT_WEIGHT` and `DEFAULT_STABILITY_WEIGHT` already carry in their doc comments
("the measured zero-regression point", "the midpoint of the CRITERION INTERSECTION"), now reproduced independently
over a wider grid, from an artifact rather than a run, and in the repository's own code.

**Closed, and it falsifies the decomposition's own most striking reading.** The `log` term pays the *symptom* more
than the source on 89.5 % of the misses where it is measurable, at `p < 1e-4` — and yet **cutting its weight is
the single most destructive move on the board** (−29 at 0.8, −153 at 0.5, −225 at 0.3). A term can be wrong about
the cases you are looking at and still be worth its weight on the cases you are not. The decomposition is a
description of the misses; it is not a gradient, and this document is the measurement that says so.

**Not closed: why every direction is an exchange.** The gate fails because the same 237 misses want different
things — raising `stability` recovers cases in `HTTPResponseReplaceCode` and `NetworkBandwidth` while costing
`HTTPRequestDelay` and `NetworkPartition`. §3.2 adds that the two sides are of the same size at every point of the
grid, which is a stronger statement than "they conflict": it says the conflict is not resolvable by magnitude,
because the corpus has no direction in which the gains dominate.

A **single** weight vector cannot have both, which is the definition of a population that needs a *conditional*
rule — and the only conditional rules this project admits are ones with a mechanism, not a fitted per-family
constant (that is what iteration 271 refused one register entry above).

So the remaining 237 misses are, on this evidence, **not reachable by re-weighting the terms the formula already
has**. That is a strong negative result and it redirects the roadmap: what is left is either a term that does not
exist yet (a new observable), or a reader that sees more than a weighted sum of the current seven — which is what
the model arm is, and why the depth window matters.

**Recorded as a candidate, NOT shipped:** `stability 0.3 + log 1.2` is worth **+13 cases (76.37 %)** and fails the
family gate in eight families, by 14 cases. It is recorded because a future decision to relax the gate — an
explicit decision, argued on its own terms — should start from a measured point with its gross cost attached
rather than from a new search. It is not a proposal, and nothing in the repository uses it.

## 5. Reproducing it

Input: `fse26-terms.ndjson` from a `terms_dump` dispatch (artifact `fse26-results`, ~40 MB). Then:

```
pnpm exec tsx benchmarks/src/run-term-weight-screen.ts --terms fse26-terms.ndjson
```

The grid is a literal in `term-weight-screen.ts` (`DEFAULT_GRID`, 28 points) and `--grid <file.json>` takes a
different one: `[{ "label"?: "...", "weights": { "stability": 0.3, "log": 1.2 } }]`. The screen refuses a grid that
is not JSON, a point with no weights, a weight that is not a finite number, and a point that moves nothing — a
typo in a grid is otherwise a table of questions that were never asked.

Four properties make the numbers checkable rather than asserted: the baseline reproduces 1 073 exactly, the
residual is 0.0 on every case (0 refused), the gross counts are printed beside every net, and every "loss" column
names the family and the count, so a reader can re-derive any single row by hand from the dump. The three
statements in §3.3 that this document contradicts are the ones its own previous version got wrong; they are
corrected rather than deleted, because a register that quietly drops a wrong number teaches nothing about how it
was made.
