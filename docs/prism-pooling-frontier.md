# The PRISM fusion frontier, re-taken over the space it was claimed about

**Status:** instrument landed, dispatch out, readback pending. `docs/fusion-routing-verdict.md` closed the
deterministic-routing direction from three measurements, one of which was a weight sweep whose zero-regression
frontier read **`{0} only`** — i.e. *no single global `prismWeight` is both net-positive and costs no cell*.
That sweep swept one dimension, and the axis has two.

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

## 4. Readback

Dispatch: `benchmark-prism-sweep.yml` (three parallel jobs, one per suite; 16 columns ≈ 2× the 8-column
runtime of run `34319035277`, whose jobs took 7.1–10.2 min against a 60-minute bound).

**Pending.** The result is appended here rather than predicted, and it decides one of two things:

- **A zero-regression positive column exists** → that is a *shippable* configuration on the RCAEval half, and
  the criterion's other half (FSE'26 with zero regressed fault types) becomes the next measurement. Note that
  the FSE'26 engine options mention PRISM **nowhere**, so `prismWeight` there is the engine default `0`: a
  candidate on this axis must also be enrolled on the FSE'26 half before its gain half can be measured.
- **No column exists in either slice** → the fusion frontier is empty in the whole space, the per-context
  routing conclusion is strengthened (it would no longer rest on a slice), and this axis is closed with a
  number rather than a scope caveat.
