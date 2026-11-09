# The emission term's jurisdiction: an absence is not a zero, and the seven cases say so

**Status:** instrument shipped, ENROLLED at `w = 0.5`. **Code:** `packages/tree/src/pruning/emission-jurisdiction.ts`,
wired in `packages/tree/src/pruning/pruner.ts`; test: `packages/tree/__tests__/unit/emission-jurisdiction.test.ts`
(11 tests). **Measured on:** the nine cells, three arms from one tree, 735 cases.

`docs/emission-intensity.md` closed this term at weight `0` on an argument that looked like a theorem: on every
case the arm lost, the truth does not emit, and "telling a source from a caller emitting on a dead dependency's
behalf is a DIRECTION question, and this corpus does not carry the direction channel it needs". The direction
half of that sentence is true and stays true. The step from it to "the term cannot ship" was wrong, and this
document is the measurement that separates the two claims.

## 1. The defect was representational

`computeEmissionScores` is SPARSE, and its own docblock says what a missing entry means: no `error` channel, no
aligned denominator, a window with zero traffic, or a rate that did not rise. Absence is the instrument's word
for *this case cannot answer for this node*.

The term is additive. A lookup that misses returns the neutral `0`:

```
finalScore(v) += emissionWeight × (emissionScores.get(v) ?? 0)
```

and a share of `0` loses to every node the term could measure. So a node the instrument never measured was
ranked as if it had been measured at zero — which is the one inference this repository refuses everywhere else.
It refuses it for spans (`docs/span-name-join.md`: a rejected span is absent, and its traffic is dropped with
it), for channels (`metricDrop` files a refusal under a REASON rather than a zero), and for the term's own
empty case (a case below the floor yields an EMPTY map, "an absence and not a measured zero").

Seven cases paid for that inconsistency. In every one of them the node the arm overturned had **no emission
reading at all**:

| case | cell | truth (and shipped rank-1) | arm's rank-1 | truth's emission reading |
| --- | --- | --- | --- | --- |
| `re2ob_currencyservice_loss_1` | RE2:OB | `currencyservice` | `frontend-external` 0.346 | `0.000` — 0 errors over 13,217 post-window requests |
| `re2ss_payment_loss_1` | RE2:SS | `payment` | `orders` 0.510 | `0.000` — 0 errors over 710 |
| `re3ob_cartservice_f1_1` | RE3:OB | `cartservice` | `frontend-external` 0.124 | no `error` channel at all |
| `re3ob_cartservice_f1_2` | RE3:OB | `cartservice` | `frontend` 0.120 | no `error` channel at all |
| `re3tt_ts-route-service_f1_2` | RE3:TT | `ts-route-service` | `ts-travel-service` 0.025 | no `error` channel at all |
| `re3tt_ts-route-service_f1_3` | RE3:TT | `ts-route-service` | `ts-admin-travel-service` 0.104 | no `error` channel at all |
| `re3tt_ts-route-service_f3_6` | RE3:TT | `ts-route-service` | `ts-admin-travel-service` 0.125 | no `error` channel at all |

Two of the seven are silence (a `loss` fault leaves the source with zero emissions), five are a MISSING CHANNEL.
Both are absences of the same kind, and neither is a statement that the node emitted nothing while others
emitted more.

## 2. The rule

> The term may reorder the candidates it MEASURED. It may not move one of them across a candidate it could not
> measure.

Stated as an ORDER rather than as a score, because a score would need a magnitude for the absence and any
constant chosen for it would be a free parameter deciding the answer:

1. Take the base order — the ranking without the term — and the final order — the ranking with it.
2. The MEASURED stratum keeps the POSITIONS the base ranking gave it.
3. Inside that stratum, the final score decides.

`orderWithEmissionJurisdiction` implements exactly that, in nine lines, and it degenerates correctly at both
ends: with an empty map, or with every node measured, it is the ordinary sort.

Two consequences are worth stating because they are what the corpus measured:

- A measured node can still rise above an UNMEASURED one when another measured node falls below it: the stratum
  keeps its positions, not its members' places. Where the stratum sits is the base ranking's business, which is
  the same division of labour every other term in this sum obeys.
- The rule is a statement about pairs, so it costs the term nothing where the term was right. It is not a
  shrinkage of the weight, and it cannot be tuned: `w = 0.5` still buys `RE3:SockShop` its nine cases.

## 3. The measurement: three arms, one tree, nine cells

| arm | RE1:OB | RE1:SS | RE1:TT | RE2:OB | RE2:SS | RE2:TT | RE3:OB | RE3:SS | RE3:TT | total |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| `w = 0` (shipped before this) | 113 | 119 | 112 | 84 | 89 | 76 | 26 | 19 | 22 | **660** |
| `w = 0.5`, no jurisdiction | 113 | 119 | 113 | 83 | 88 | 76 | 24 | **28** | 19 | 663 |
| `w = 0.5`, jurisdiction (shipped) | 113 | 119 | **113** | 84 | 89 | 76 | 26 | **24** | 22 | **666** |

`+6` with **no cell down**: `RE1:TrainTicket +1`, `RE3:SockShop +5`, and the five cells the ungated arm moved
the wrong way all return to their shipped values. The paired sign test over the six cases that changed is `6–0`
(`p = 0.0156`, one-sided).

**The replay predicted this before the engine ran.** A case-level version of the rule ("if the shipped leader
carries no emission entry, do not open the arm at all") prices exactly from the two existing dumps, because such
a gate only switches the term on or off. That replay reads `666`, with `RE1:TT 113` and `RE3:SS 24` — the same
total and the same two cells the node-level rule produced in the engine. The agreement is not luck: on this
corpus no case has a measured node rise above an unmeasured one while a DIFFERENT measured node falls, which is
the only situation the two rules treat differently.

## 4. Sensitivity, and why the weight did not move

`0.5` was pre-registered in `docs/rcaeval-error-scale.md` §6 before the code existed, so it is the value that
ships. The two cells that move were re-measured at two neighbours to show the gain is not a knife edge:

| weight | RE3:SockShop | RE1:TrainTicket |
| --- | --: | --: |
| `0.35` | 22 | 113 |
| `0.50` (shipped) | **24** | **113** |
| `0.65` | 24 | 113 |

The gain is monotone in the weight and flat from `0.5` upward, and even at `0.35` — where the term is weakest —
both cells are above their shipped values (`19` and `112`). No grid was searched for a larger number, on the
rule that a weight selected by its own result is not a weight.

## 5. What this does NOT fix

- **Four gains are forfeited by the rule, deliberately.** On `re3ss_carts_f4_2`, `orders_f3_3`, `orders_f4_2`
  and `orders_f4_3` the shipped leader (`orders-db`, `carts-db`, `user`) carries no emission entry either, and
  the truth IS the largest emitter. The term could have taken all four; the jurisdiction refuses to speak about
  a node it cannot measure, so it does not. That is the honest price of the rule, and it is why the total is
  `666` rather than `670`.
- **The direction question is still open.** A gate that could tell "the leader is a caller of a dead dependency"
  from "the leader is a silent source" would take those four back. This corpus does not carry that channel
  (`docs/emission-intensity.md` §6.1: 26 records in 23,105 node-reads), and the FSE'26 half is where it exists.
- **`RE3:TrainTicket`'s three error-value cases are untouched** (`22` before and after). They are not emission
  failures at all: the truth emits nothing and ranks first, and the term never had a case against it.
- **The intake hypothesis was measured and REFUTED.** The first candidate for a direction channel was the
  corpus's `workload`: in the kinetic reading a source loses its INTAKE while a caller keeps its own. Measured
  on the same 735 cases, it does not hold — on `RE3:SockShop` the winning source's intake ratio is `1.010`,
  `1.001`, `0.977`, i.e. UNCHANGED, because the source there is the service nearest a dead dependency and it
  keeps answering while failing. Of the six cases the term gained, the truth's intake drop separates at
  AUC `0.667` — below the `0.60` bar's usefulness and computed on six pairs, which is not a population. The
  hypothesis is recorded here so it is not re-derived: **a source does not lose its intake on this corpus.**

## 6. Reproduce

```bash
# the rule, on the two orders (no engine)
npx vitest run packages/tree/__tests__/unit/emission-jurisdiction.test.ts

# the three arms, one cell at a time (the corpus is 38 GB of per-case JSON)
npx tsx benchmarks/src/run-rcaeval.ts --suite re3 --system ss --data-dir <corpus>
npx tsx benchmarks/src/run-rcaeval.ts --suite re3 --system ss --data-dir <corpus> --emission-weight 0 \
  --diagnose-dump /tmp/w0.txt
```

The `w = 0` arm is bit-identical to the pre-254 table because a weight of zero never builds the map, which is
also why the ungated column above is the arm `docs/emission-intensity.md` published and not a re-derivation.
