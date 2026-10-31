# The deduction's fourth question — which way the movement travelled

**Owner of:** `TopoPrecedence`, `--topo-precedence`, `topoprecedence=` (RCAEval `anomaly_knobs`),
`TreePrunerOptions.topoPrecedence`, `deductExplainedAnomalies`'s sixth argument.

**Status: implemented, tested, shipped `off`, arm dispatched.** The readback is §6; nothing in §1–§5 depends
on it.

---

## 1. What the operator assumed, and what it never asked

The topological deduction is an influx balance:

```
explained(v) = ⊕ over callees c with weight(v→c) > 0 of weight(v→c) × anomaly(c)
charged(v)   = min(a, e) >= gate × a  ?  rho × min(a, e)  :  0
anomaly′(v)  = anomaly(v) − charged(v)
```

`⊕` is `max` (shipped) or `sum`. The operator asks three questions about a call boundary and answers them in
three separate predicates: whether the callee's channel can be inherited (`topoDiscountScope`, callee side),
whether the caller's channel may be explained away (the same scope, caller side), and how much of the caller the
callees account for (`topoDiscountGate`). It has never asked the fourth: **when**.

`explained` is an influx, and an influx has a direction in time as well as in the graph. A callee whose movement
starts _after_ its caller's cannot be the reason the caller moved — the charge is a claim about a boundary
carrying a movement, and a boundary cannot carry a movement that has not happened yet.

The omission is not academic, and this is the corpus saying so rather than the theory:

## 2. The population, counted

Battery `41188083576` on `25b4279b`: 735 cases, 641 correct, 94 misses. Twelve of the ninety-four misses are
cases whose truth **is** a node of the case's graph and is **absent from the ranking**. Six of those twelve
carry a pre-deduction anomaly of **0.73 to 1.87** — a node that had plainly moved, deleted by an operator that
found a louder callee one hop away. The other six carry `0.0`, which is a different defect (nothing moved at the
origin, and no operator can restore a measurement that was never taken).

| cell               | fault   | truth             | anomaly before the deduction | winner            | winner's relation to the truth | pool |
| ------------------ | ------- | ----------------- | ---------------------------: | ----------------- | ------------------------------ | ---: |
| RE1:SockShop       | `loss`  | `orders`          |                       1.1440 | `payment`         | callee (1 hop)                 |   11 |
| RE1:SockShop       | `loss`  | `orders`          |                       1.4379 | `payment`         | callee (1 hop)                 |   13 |
| RE2:OnlineBoutique | `delay` | `checkoutservice` |                       1.8525 | `emailservice`    | callee (1 hop)                 |    7 |
| RE2:OnlineBoutique | `delay` | `checkoutservice` |                       1.8664 | `shippingservice` | unrelated                      |    7 |
| RE2:OnlineBoutique | `delay` | `checkoutservice` |                       1.8421 | `emailservice`    | callee (1 hop)                 |    9 |
| RE2:SockShop       | `delay` | `orders`          |                       0.7345 | `shipping`        | callee (1 hop)                 |    8 |

Read as a shape rather than as six rows: **in five of the six the truth is a caller and the winner is its own
callee**, and every truth is a caller that the operator charged in full (`rho = 1`, `gate = 1`, so a node whose
loudest callee is louder than itself is zeroed outright). The sixth has an unrelated winner, and its truth is
still absent — so its callee zeroed it and a third node then won.

This is the same phenomenon `docs/topo-share.md` §11 names for the _nine_ rank-2 observers
(`ts-admin-travel-service`, `front-end`), approached from the other end: there the false winner is a node that
calls everything, and here the _deleted_ truth is a node whose callee is louder than it. Both are cases where
"who calls whom" was read as "who caused whom".

## 3. The rule, and the two places it refuses to act

```ts
canCarry(caller, callee) = onset(callee) <= onset(caller);
```

with `onset` read from the graph's own `anomalyOnsetTimes`. Two abstentions are part of the definition rather
than of the implementation:

- **A tie is not an order.** Two services whose dominant metrics leave their baselines in the same sampling
  bucket cannot be told apart, and the shipped charge stands. Withholding on a tie would act on the _absence_ of
  an order, which is the class of inference this repository refuses everywhere else.
- **A missing onset is not lateness.** The graph writes `Number.MAX_SAFE_INTEGER` where a metric never left its
  baseline. Read as a number that sentinel is the latest possible onset, and the guard would then withhold a
  charge because of a gap in the telemetry. It is read as an absence, and the charge stands.

The `off` arm does not read the map at all, so the nine published cells are unchanged **by construction** rather
than by the guard happening to abstain on them.

### 3.1 The monotonicity proposition, and the test that holds it

> For any graph, any `rho`, any gate and either closure, `discounted_onset(v) >= discounted_off(v)` for every
> node `v`.

_Proof._ Each withheld edge removes one term from the fold that builds `explained`, and both folds (`max`, `sum`)
are monotone in their arguments, so `e_onset <= e_off`. The charge is `rho × min(a, e)` gated by
`min(a, e) >= gate × a`; a smaller `e` cannot make a refused node charged (the comparison can only move from
true to false), and it cannot make a charged node lose more. The subtraction is therefore bounded below by the
shipped one. ∎

The test asserts it exhaustively over a 288-point space (two nodes, an edge in each direction, anomalies
{1, 2, 4}, onsets {0, 1, 2, none}) and asserts that the sweep _ran_, because a loop that silently iterated
nothing would satisfy every assertion in it and measure nothing. `packages/tree/__tests__/causal/topo-precedence.test.ts`,
10 tests, `topo-deduction.ts` at 100/100/100/100.

**What monotonicity is worth, and what it is not.** It bounds the _charge_, not the accuracy: a released caller
comes back with more anomaly and can outrank the true root. So the arm's cost population is exactly the cases
where a charge was withheld — not "no cases", which is what a monotone operator would suggest if the sentence
stopped at the anomaly.

## 4. The arm

```
gh workflow run benchmark-rcaeval.yml -f scopes=golden \
  -f anomaly_knobs=topoprecedence=onset
```

The dispatch surface had to be repaired before it could be stated, and the repair found the same defect this
repository keeps recording one level up: the `anomaly_knobs` parser is a shell `case` block **copied into seven
jobs** of the workflow, so a key added to one job would have been accepted on `rcaeval-re1` and fail the step on
`rcaeval-re2` — a dispatch that reads as a configuration and is a third of one. All seven carry the branch.

**Pre-registered verdict.** Enrol only if `735 > 641` with **no cell down**. The cell to watch is
RE1:SockShop (117/125), where two of the six live; the risk is RE1:TrainTicket and RE2:TrainTicket, where the
deduction's thirteen fixes were bought and a released caller can take a case back.

## 5. What is deliberately not plumbed

The FSE'26 half (`fse26-cli`, `fse26-engine-options`, `fse26-report`) does not carry the knob, and the reason is
measured rather than assumed: the deduction is **inert on that corpus** — two dispatches (`41027467282` bare
against `41024050841` at `topo_discount=1, topo_discount_gate=1`) read `Top@1 60.5 % / Top@3 79.0 % / Top@5
82.2 %` and **25 of 25 fault types identical**. A knob there would be a second place to keep in sync with no
question it can answer on that population. What the comparison cannot say is _why_ it is inert (the share is
published in the RCAEval census and nowhere else), so this is a scope decision resting on an observed zero, and
it is recorded here rather than left to be inferred from an absent field.

## 6. Readback

**The verdict is NO ENROL.** The arm was run and it is `636/735 = 86.53 %` against the factory's
`641/735 = 87.21 %` — five cases down, two cells down, none up. The pre-registered criterion in §4 was
`735 > 641` with no cell down; it is not met, so `topoPrecedence` stays at its factory value `off` and nothing in
the engine changes. This section is the readback, and §1–§5 above were written before it, which is the only
reason it can be read as a test rather than as a story.

**Both runs, and why there are two.** The control is a dispatch of the same commit with the knob at its default,
so the comparison does not depend on a reading taken days earlier:

| run | commit | configuration | total |
| --- | --- | --- | --- |
| `41205151091` | `f97de4a0` | factory (`topoPrecedence=off`) | **641/735 = 87.21 %** |
| `41205245084` | `f97de4a0` | `anomaly_knobs=topoprecedence=onset` | **636/735 = 86.53 %** |

The control is also the fourth independent reproduction of the anchor: the nine cells it reads are
`107/117/106`, `83/88/75`, `25/18/22`, which are the numbers `docs/sota-comparison.md` §0p is held to. The arm
differs from it only in the knob — which is what makes the delta attributable, and is the reason this section
does not have to argue about whether the corpus moved underneath it.

| cell | `off` | `onset` | delta |
| --- | --- | --- | --- |
| RE1:OnlineBoutique | 107 | 107 | 0 |
| RE1:SockShop | 117 | 117 | 0 |
| RE1:TrainTicket | 106 | **104** | **−2** |
| RE2:OnlineBoutique | 83 | **80** | **−3** |
| RE2:SockShop | 88 | 88 | 0 |
| RE2:TrainTicket | 75 | 75 | 0 |
| RE3:OnlineBoutique | 25 | 25 | 0 |
| RE3:SockShop | 18 | 18 | 0 |
| RE3:TrainTicket | 22 | 22 | 0 |
| **RE1** | 330 | 328 | −2 |
| **RE2** | 246 | 243 | −3 |
| **RE3** | 65 | 65 | 0 |
| **TOTAL** | **641** | **636** | **−5** |

**The five cases, joined by `caseId` rather than by count.** Both census lines are read, so the delta is a set of
named cases and not the difference of two totals — `0` won and `5` lost, and the five are:

| case | truth | `off` predicted | `onset` predicted | truth's rank |
| --- | --- | --- | --- | --- |
| `re1tt_ts-train-service_loss_4` | `ts-train-service` | `ts-train-service` | `ts-travel-service` | 1 → 2 |
| `re1tt_ts-travel-service_delay_4` | `ts-travel-service` | `ts-travel-service` | `ts-admin-travel-service` | 1 → 2 |
| `re2ob_currencyservice_delay_3` | `currencyservice` | `currencyservice` | `checkoutservice` | 1 → 2 |
| `re2ob_productcatalogservice_delay_1` | `productcatalogservice` | `productcatalogservice` | `recommendationservice` | 1 → 2 |
| `re2ob_productcatalogservice_socket_1` | `productcatalogservice` | `productcatalogservice` | `recommendationservice` | 1 → 2 |

**What the five have in common is the mechanism, and it is the mechanism working as specified.** In every one the
truth was ranked FIRST and fell to SECOND, its own anomaly reading is unchanged (`truthAnomalyBefore` is equal to
the control's in all five — `1` and `1`, `2.214`, `2.21`, `2.29`), and the case is won by the truth's own
**callee** — `ts-train-service`'s and `ts-travel-service`'s callee on the PCA graph, `productcatalogservice`'s
recommender, `currencyservice`'s checkout. Withholding the edge does exactly one thing: the callee stops being
discounted by the caller and its charge rises past a truth that did not move. **§3.1's monotonicity proposition
predicted this direction and is not refuted by it** — `discounted_onset(v) >= discounted_off(v)` holds in all
735 cases, and that is precisely why five truths can be overtaken by their own dependents. The proposition is
about the bill; accuracy was never implied by it, and this document said so before the arm ran.

**So the rule is wrong in a way that is now priced.** `onset(callee) <= onset(caller)` was derived from "a
boundary cannot carry motion that has not happened yet", and on this corpus the premise fails where it matters:
the culprit is the caller in these five, and its callee is the service that visibly reacted first because it is the
one doing the work. **A callee that moves first is a victim, not a cause** — treating earlier-onset as license to
withhold the discount inverts the customer/supplier relation on exactly the cases the deduction was built to fix.
That is a statement about the ordering's SIGN, and no amount of tuning the gate can repair a sign.

**What is kept, and why not a revert.** The code stays with `off` as its default: the arm is reproducible from
one dispatch, `off` is proven identical to the pre-existing engine by construction (the `off` path never reads
`onsets`, and the test asserts it), and the alternative — deleting the axis — would remove the only quantified
answer to the fourth question the operator asks. What is NOT kept is any claim that this ordering helps: §4's
criterion was pre-registered, it failed, and the failure is recorded here rather than reframed as a finding about
the corpus. The one thing this readback buys is the constraint on the NEXT hypothesis: whatever replaces
`onset`-as-a-gate has to explain why `productcatalogservice` losing to `recommendationservice` is wrong, and
"the callee moved first" cannot be that explanation.

