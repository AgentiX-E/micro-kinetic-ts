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
`temporalWeight × 2 × (earliness − 0.5)`, so with the shipped default `temporalWeight = 0`
**the shape cannot move any ranking at all** — including the RCAEval golden, whose runs do
not set it. So the golden 9-cell's inputs cannot change until the weight does, and the
whole risk of this candidate sits in the weight — which is exactly what the pair measures.

## 6. What the next iteration is

1. Enroll the shape + weight (`temporalWeight`, an `OnsetShape` selector) with the guard
   discipline the other shipped terms have: the value read out of source as text and
   required to be a key of the recorded-runs table.
2. Measure the pair on one commit at the shipped configuration: control `temporalWeight=0`
   against the candidate `0.036552` + `earliest-only`, and require **zero regressed fault
   types**.
3. Measure the RCAEval golden 9-cell on the same commit and require it byte-identical.
4. If either half fails, close the axis with those two numbers and this document becomes
   the row's evidence; if both pass, the term ships and the register gains the split.
