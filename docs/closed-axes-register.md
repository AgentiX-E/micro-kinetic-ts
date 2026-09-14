# Closed axes — read this before proposing an experiment

Every row is an axis that has been **measured and closed**. The purpose is not
bookkeeping: three times now an axis has been re-derived from totals and proposed
again, most recently a monotone transform of the metric term, which
`fse26-metric-competition-verdict.md` had already excluded by name after building
and measuring both surviving shapes.

**A proposal must say which rows it does not touch, and why it is not one of
them.** If it cannot, the first thing to do is read that row's document.

| axis | where | the number that closed it | reopens only if |
| --- | --- | --- | --- |
| reweighting the log term (`logWeight`) | `fse26-logweight-sweep-verdict.md` | control 47.33%; `0.5` → 46.84% (−0.49pp); per-fault-type **oracle ceiling +2.67pp → 50.00%** | a per-type oracle that exceeds 50% exists, i.e. the metric term itself changes |
| log-signal mode (`count` / `logicHttp` / `all`) | `fse26-framework-http-direction-verdict.md` | `count` 16.5%, `logicHttp` 46.5% — the shipped mode is the best measured | a new mode is both measured and better on the same cache |
| metric term: any monotone transform or bound of a service's OWN score | `fse26-metric-competition-verdict.md`, `fse26-logweight-sweep-verdict.md` | both surviving shapes built and rejected; a bound/rescale can only shrink a margin or tie, and the metric term is bounded in `[0,1]` while one log step is a full `1.0` | the candidate is **not** a function of that service's own metric score |
| metric term: fleet-relative baseline | `fse26-metric-competition-verdict.md` | `metricFleetBaseline` measured, rejected (+0.49pp / 6 type regressions) | a different cross-service statistic than the median |
| global min-max normalisation of ranks | `fse26-metric-competition-verdict.md` | measured **+0.00pp** | never — it is the same ordering rescaled |
| monotone compression of the TOTAL score | `fse26-metric-competition-verdict.md` | proved non-reordering; measured **−2.67pp** | never — non-reordering is a proof, not a measurement |
| anomaly dynamic range (rise ceiling) | `fse26-metric-competition-verdict.md` | dynamic-range ablations measured and rejected | a bound that is **not** monotone in the service's own score |
| `rankNormalization` (reverting it) | `bothwrong-evidence-verdict.md` | load-bearing: TT RE3 **3.6% → 51.1%** | never — this is the largest single measured effect in the repo |
| failed-edge direction signal | `fse26-failed-edge-verdict.md` | +5.8pp but 2 regressed types; the evidence floor recovers them and spends all +82 | a discriminator that separates source from victim on a *different* signal |
| metric-gap repair (per-service baseline selection) | `fse26-metric-gap-verdict.md` | 18.85% → 23.07% Top@1 with one regressed case | the regression is repaired without spending the gain |
| network-loss deterministic crack | `loss-weak-source-verdict.md` | union ceiling 66.7% vs engine 55.9% / PRISM 52.0% | a signal that closes part of the 66.7% ceiling |
| delay deterministic crack | `delay-exhausted-verdict.md` | engine 80.4% vs union ceiling 90.2%; the 10.0pp gap is all bothWrong | the bothWrong population changes shape |
| fusion / deterministic routing | `fusion-routing-verdict.md` | engine 76.1%, PRISM 76.7%; routing cannot reach the union ceiling | a router whose input is not the two scores being routed |
| bothWrong evidence probe (RCAEval RE2/RE3) | `bothwrong-evidence-verdict.md` | 12.5% of 615 is the deterministic ceiling | a new evidence class for both-wrong cases |
| the weak-fault-type gap, as a block | `fse26-data-gap-verdict.md` | 579 cases / 40.7% of the dataset; HTTPResponseReplaceCode 231 @ 4.8% is the signal gap and the top lever | a candidate that names which of the two mechanisms it addresses |

## The shared kill criterion

Any candidate that changes the shipped ranking must move **both**:

1. **RCAEval golden 9-cell byte-identical** (RE1 80 / 92.8 / 68, RE2 82.4 / 88.9 /
   68.1, RE3 80 / 45 / 51.1), and
2. **FSE'26 with zero regressed fault types.**

A headline gain does not buy silence about regressions — that rule has rejected
+0.14pp, +0.28pp, +0.49pp and +5.8pp alike, and it is what the two above it are
for.

## The two invariants that make a measurement trustworthy

Before reading any number, check that the input was counted:

- the FSE'26 run prints **`Data: failed edges in …`** — a signal that received
  nothing reports the same headline as a signal with no effect;
- a diagnostic dump's miss attribution prints **`unexplained`** and **`tie`** — a
  healthy engine has zero `unexplained`, because that category means the order is
  inconsistent with the terms the dump carries (`docs/fse26-stock-attribution.md`).

## What is left

`docs/fse26-httpnet-miss-verdict.md` and `docs/fse26-stock-attribution.md` agree
that the metric layer is the larger of the remaining mechanisms, and
`fse26-metric-competition-verdict.md` says the next candidate must be **not a
function of a service's own metric score**. Those two statements together are the
door: the constraint is on the SHAPE of the problem, and it excludes a whole
family rather than pointing at one candidate.
