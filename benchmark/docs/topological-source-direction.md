# The topological-source term explained a node by its caller; a caller is what waits

`computeTopoSourceScores` answers one question, and it is the right question: **whose anomaly is this
node's anomaly?** A source generates its own; a symptom inherits it. The term has shipped at weight 0
since it was written, carrying a case verdict of **−42.4 / −37.8 / −3.1** on FSE'26's three suites — i.e.
enabling it destroys 42 cases on one suite — and its own option docblock had recorded the doubt:

> *"The direction of the call-graph edges is a known assumption to validate via ablation — resource
> faults can propagate callee → caller, in which case this directed penalty would misfire."*

It misfires, and the direction is now measured rather than argued.

## 1. Two readings of `u → v`

An edge in these topologies is a **call**: `frontend → adservice` means frontend calls adservice. When
adservice is slow, frontend *waits*, so frontend's latency is the symptom and adservice's is the source.

| reading | formula | what it does on a delay at the callee |
| --- | --- | --- |
| the code | `1 − max over parents p of (w(p→v) × a(p))` | **penalises the source** (its caller is anomalous) and rewards the caller |
| the corpus | `1 − max over callees c of (w(v→c) × a(c))` | penalises the caller (its callee's anomaly explains it) and leaves the source unexplained |

Both are formulas a reader can defend in the abstract; only one of them is about *this* graph. The code
had the other one for its entire life, and the same arrays were read with opposite conventions in two
places — the corpus's own configurations say `from` calls `to`, while the ranking fixture assumed `from`
was upstream. Nothing declared the convention, which is how both survived.

## 2. The measurement

RCAEval RE1-OnlineBoutique, 125 cases, one variable at a time:

| weight | 0 (shipped) | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 1 | 2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| caller explains callee (**the code**) | 82.4 | — | — | — | — | **57.6** | 50.4 | 40.0 |
| **callee explains caller (the corpus)** | 82.4 | **85.6** | 84.8 | 84.8 | 83.2 | 82.4 | 80.0 | 77.6 |

At weight 0.5 the old direction costs **24.8 pp**; the corrected one costs nothing at that weight and
reads **+3.2 pp at 0.1**. Per fault type at 0.1, against the shipped cells:

| | CPU | DELAY | DISK | LOSS | MEM | AVERAGE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| shipped | 92.0 | 88.0 | 92.0 | 48.0 | 92.0 | 82.4 |
| **corrected, weight 0.1** | 92.0 | **92.0** | **100.0** | 48.0 | **96.0** | **85.6** |

**No fault type regressed.** Six cells move up, none down, and the two that stay put are the two whose
evidence the corpus does not carry (loss) and the one already saturated at 92 (cpu).

## 3. What the correction does and does not decide

**It decides the sign.** `1 − explained-by-callee` is the term the corpus's graphs describe, and the old
sign is refuted by 24.8 pp on a cell with 125 cases.

**It does not decide the weight.** The corrected curve has no plateau — 85.6, 84.8, 84.8, 83.2, 82.4 —
and a maximum at the smallest positive weight tested is the signature of a weak signal rather than of a
robust one. This repository's rule for that shape is that a single point is a fit and a plateau is a
range; a fit is not enrolled on one cell. The nine-cell and FSE'26 readings are the dispatch's, and the
weight is enrolled only if it holds on populations this cell cannot see.

**The correction is behaviour-neutral where it ships.** `DEFAULT_TOPO_WEIGHT` is 0, and at weight zero
every direction is the same function: measured 82.4% before and after, cell for cell. A reader of the
published numbers is therefore unaffected, and the change is a correction to a term that is off — the
condition under which this repository allows a sign to be fixed without a dispatch.

## 4. It also explains the −42.4

The FSE'26 verdict on this term was taken with the sign this document calls backwards. That does not make
the verdict wrong — FSE'26 injects network faults on *edges*, and an edge fault's propagation may well
follow the other direction — but it does mean the verdict is about a **specific sign on a specific
corpus** rather than about the term. The two corpora are dispatched separately, and the FSE'26 arm is
what decides whether the correction travels or whether the direction is a corpus property that has to be
named at the call site.

## 5. What ships

| the change | where |
| --- | --- |
| the explanation comes from the callee (`edge.to`) and is charged to the caller (`edge.from`) | `packages/tree/src/pruning/ranking-signals.ts` |
| the convention written down at the option, with the measurement table | `packages/tree/src/pruning/pruner.ts` |
| four unit tests re-expressed in the call-graph convention, and the ranking fixture with them | `packages/tree/__tests__/unit/ranking-signals.test.ts`, `__tests__/unit/pruner.test.ts` |

## Gates

`packages/tree` **709/709** at 100 / 99.76 / 100 / 100. `zsh .git/check_fences.sh` → FENCES CLEAR.
