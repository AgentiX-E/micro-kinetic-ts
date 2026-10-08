# The PRISM fusion frontier, re-taken over the space it was claimed about

**Status:** measured (run `37764918754`, three jobs all `success`). The frontier has been re-taken over the
whole space and **H1 is refuted**: `conjunctive` does not rescue the fusion frontier, it regresses *earlier and
more* (11 cells at `w=1` against additive's 8). The merged frontier is `{w=0}` under both poolings — but read
**per suite** it is wide on two of the three, and the single suite that closes it is RE1, on its `delay`/`loss`
cells. `docs/fusion-routing-verdict.md` closed the deterministic-routing direction from three measurements, one
of which was a weight sweep whose zero-regression frontier read **`{0} only`** — i.e. *no single global
`prismWeight` is both net-positive and costs no cell*. That sweep swept one dimension, and the axis has two.

## 1. The defect the re-take repairs, stated as a scope rather than as an error

The engine's PRISM call site read

```ts
computePrismScores(metrics, new Set(callGraph.nodes.keys()), injectTimeMs)   // pooling omitted
```

`computePrismScores` took the pooling as its fourth parameter; the call site did not pass it. So every point of
the weight ladder — `[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0]` — was measured with `additive`, and
`conjunctive` was reachable only from the standalone evaluator. **The frontier that closed the axis is
therefore a statement about one slice of the space the decision is made in**, which is a different claim from
the one it was read as. The enrolment (`docs/prism-pooling-axis.md`) makes the second dimension an engine
option; this document re-takes the frontier over both.

This is the register's own named failure mode — *a summary outlives its own correction* — in the mildest form
it takes: the number was right and its scope was narrower than the sentence it supported.

## 2. Why the second dimension is not a rounding

The fusion verdict's own mechanism for the 5 regressing cells is *"PRISM's max-normalised score overrides the
engine's correct top-1"*, in **delay/socket + already-100% cells**. `conjunctive` changes exactly the score
that overrides: a component anomalous in the external channel **only** is gated to `min(S^I, 0) = 0`, so an
external-only symptom cannot displace the engine's choice. That makes the hypothesis specific and falsifiable:

> **H1** — the cells that made the weight ladder's frontier `{0}` are additive-pooling artefacts, so some
> positive weight is zero-regression under `conjunctive`.

It is a hypothesis and not a prediction: `conjunctive` also *promotes* services that are anomalous in both
channels, which can displace the engine just as `additive` did — and the ablation already shows it losing on
`delay`/`loss` in 4 of 15 RE1 (system, fault-type) cells (`ABLATION_FINDINGS.md` v4). The sweep is the
measurement either hypothesis has to survive.

## 3. The axis, and the three things the analyzer refuses

`packages/kinetic/src/benchmarks/leaderboard/prism-sweep.ts` now takes the axis as a list of **points**, each
naming its own `(weight, pooling)`, and produces the frontier over that list. The swept set is the cross
product

```
w ∈ {0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1.0}  ×  pooling ∈ {additive, conjunctive}   = 16 columns
```

with three refusals, each of which is a way to report a frontier that is not one:

1. **An axis that does not start at the shipped configuration** (`weight 0`, `DEFAULT_PRISM_POOLING`). The
   whole output is "no cell fell below the baseline", so the baseline is not a point among points — it is the
   definition of the comparison and it has exactly one value. An axis starting elsewhere reports a frontier
   against a run nobody ships, and it is indistinguishable in the artifact from one that can be acted on.
2. **A duplicated point.** Two columns of one measurement double-count a cell in the weighted overall and name
   one configuration twice on the frontier.
3. **A label that disagrees with the point it labels.** The label is derived from the configuration, so a
   hand-written one that differs prints a column as a configuration it was not measured at.

`bestZeroRegression` names its **point**, not just its weight: the weight alone is ambiguous between two
configurations, one of which can regress and one of which does not. And the runner asserts the sweep's own
**no-op control from the data** — the two weight-0 columns must agree in every cell, because `prismWeight = 0`
multiplies the signal away whatever the pooling; if they ever differ, a column is not the configuration its
label claims.

## 4. Readback — run `37764918754` (three jobs, all success, 12.5 min)

The reader cross-checks the artifact's own `analysis` against the frontier recomputed from its own `cells`
before reporting anything, and the runner asserts its no-op control from the data. Both fired:

```
cross-check  : 3 artifacts, each one's own analysis equals its own cells
no-op control: OK — 2 weight-0 columns, w=0/additive = 76.42% agrees with all others   (merged)
```

### 4.1 H1 is REFUTED

**The merged zero-regression frontier is `{w=0}` under BOTH poolings.** Under `conjunctive` the frontier is
not merely empty for positive weights — the regressions arrive *earlier and grow faster*: 4 cells at `w=0.1`
and **11 cells at `w=1`**, against additive's 2 and 8. The cells that made the additive frontier `{0}` are
therefore **not** additive-pooling artefacts, and the mechanism I proposed for them (an external-only symptom
being promoted over the engine's choice, which `conjunctive` should gate away) does not carry: gating does
not remove the promotion, it moves it.

| column | merged overall | Δ vs baseline | regressing cells |
| --- | ---: | ---: | ---: |
| `w=0/additive` (baseline) | 76.42% | — | 0 |
| `w=0/conjunctive` (inert control) | 76.42% | +0.00 | 0 |
| `w=0.4/additive` | **82.60%** | **+6.18** | 2 |
| `w=0.4/conjunctive` | 78.37% | +1.95 | 7 |
| `w=1/additive` | 80.00% | +3.58 | 8 |
| `w=1/conjunctive` | 76.42% | +0.00 | 11 |

### 4.2 …and the merge is what hid the finding: the frontier is PER-SUITE, and two of three suites are open

The merged population is the union of 46 cells; a column is excluded if **any** cell regresses. Read per
suite — which is how the workflow measures it, one job per suite — the same 16 columns give:

| suite | corpus | baseline | zero-regression columns (positive weight) | best |
| --- | --- | ---: | --- | --- |
| RE1 | full (15 cells × 25) | 80.27% | **none**, either pooling | — |
| RE2 | **capped at 50 cases/system** (18 cells) | 80.67% | **additive `w ∈ {0.1 … 0.5}`** | **`w=0.4/0.5` → 90.00% (+9.33)** |
| RE3 | full (13 cells × 30) | 53.33% | **additive `w ∈ {0.1 … 0.75}`**; **conjunctive `w ∈ {0.1 … 0.75}`** | **`w=0.75` conj → 70.00% (+16.67)** |

**Three readings, and each one is a different kind of statement:**

1. **One suite closes it for all of them.** RE1 admits **no** positive weight under either pooling, and its
   excluders are `delay` and `loss`. So the sentence *"no single global weight can ship"* is true and is
   **caused by one suite's two fault types**, not by a property of the corpus — which is a strictly more
   useful statement than the merged `{0}`, and it is the one the merged frontier had been hiding.
2. **RE2 + RE3 together admit `additive w ∈ {0.1 … 0.5}`** (the intersection of their windows), and RE3 alone
   admits `conjunctive` up to `w=0.75` — the largest gain on the board, **+16.67pp on the suite the register
   names as the weakest of the published nine**.
3. **The RE2 window is measured on a capped corpus** (`--max-cases 50`, 3 repetitions). A +9.33pp
   zero-regression window is the most promising number here and it is the one least supported by its corpus,
   so it is the immediate follow-up rather than a finding: re-take it without the cap before anything is built
   on it.

### 4.3 The obstacle is named, and it is the same population as before

Every excluder in every window is a `delay` or `loss` cell — `re1/{SockShop,TrainTicket}/delay`,
`re1/TrainTicket/loss`, `re2/SockShop/delay`, `re3/SockShop/f2` — i.e. the external-only signatures, on the
suite whose `loss` cell is the weakest in the grid (44–68%). That is the same population
`fusion-routing-verdict.md` §2 found unfixable by any of the three inference-time signals it tested, and this
run does not add a fourth: it **removes** the hope that the pooling was the missing one.

## 5. What this closes, and what it opens

**Closed, with a number over the whole space:** no single global `(prismWeight, prismPooling)` is
net-positive and zero-regression on the merged 615-case population. The deterministic-routing conclusion now
rests on the space rather than on a slice, and the **pooling is not the missing discriminator** — measured,
not assumed.

**Open, and named:** the frontier is *per-suite* wide on RE2 and RE3, and the blocker is one suite's
`delay`/`loss` cells. A candidate therefore has to be a **discriminator over that population**, and the two
available cheap next steps are, in order:

1. **Re-take RE2 without the case cap.** A zero-regression `+9.33pp` window worth ~nine cases per system is
   the largest number this instrument has produced; on a 50-case corpus it is the least trustworthy one.
2. **Ask whether `delay`/`loss` on RE1 is separable at inference** — the question the routing probe closed for
   three signals and this run has now closed for a fourth (the pooling). The register's requirement stands: a
   candidate must name the context feature and show it separates, on a free read, before any run.

## 6. A discrepancy this instrument makes reproducible, and a hypothesis for it

The sweep's RE3 baseline is **53.33%**, and it is not the golden's RE3. This is the *third* instrument to
disagree with the golden on RE3 and the *second* to agree with the others:

| instrument | RE3 OB / SS / TT | RE3 mean |
| --- | --- | ---: |
| golden `rcaeval-re3-results` (run `37736529560`) | 80.0 / 45.0 / 51.1 | **58.70%** |
| ablation `+Log +Trace Activity +Rank` row (same run) | 73.3 / 36.7 / 50.0 | 53.33% |
| this sweep, `w=0/additive` (run `37764918754`) | 73.3 / 36.7 / 49.9 | **53.33%** |

Two independent instruments reproduce each other to the rounding and neither reproduces the golden. RE1 agrees
**exactly** (80.27% in both, and per cell), so the disagreement is confined to the one suite where the shipped
configuration sets `traceWeight=1`.

**Hypothesis, stated as one because it is not verified:** the golden's RE3 path attaches per-case trace spans
while the study's does not. `traceWeight` is a *weight*; the spans are the *input*, and in `run-ablation.ts`
they are attached only when the `traceAugmentation` flag is set — a different flag from `traceSignal`. If that
is the cause, then the study's RE3 rows and the golden's RE3 rows are **two different configurations**, and
every RE3 Δ in `ABLATION_FINDINGS.md` v4 is a Δ within the study rather than against the golden. The cheap
first read is to print whether a case carried spans on each path. This is registered rather than resolved: it
belongs to the input path, not to the pooling axis, and it is now reproducible from two artifacts.
