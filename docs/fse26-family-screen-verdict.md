# The family screen: the hand-registered sets, made systematic — and the answer is no

**Status:** instrument shipped, axis measured. **Code:** `familyScreen` +
`formatFamilyScreenReport` in `benchmarks/src/fse26-diagnose-analyze.ts`, behind
`--family-screen`.

The pool penalty was chosen from **twelve hand-registered family sets**, measured one at a
time. This replaces that with a **solved scan**: for every dominant-metric family the dump
carries, the admissible weight window, the gain inside it, the weight profile of that gain,
and the fault types it moves — all closed forms, no sweep. It reproduces the pool family's
recorded window exactly, and it closes the axis: **no family is worth shipping.**

---

## 1. The model, and why the base matters

```
score_F(v) = shipped(v) + w × (−1 when v's dominant family is F else 0),   w ≥ 0
```

`shipped(v)` is the engine's own four-term score, taken from `shippedScores` (one
implementation of the blend, not a second one). The term is a family penalty added ON TOP of
the shipped configuration, so the base must be that configuration — including the pool
penalty already shipped.

That is not pedantry, and the screen measures it: the pool family's own window at the
shipped weight is `[0, 0.019111]`, which is exactly `0.087011 − 0.067917` — the budget the
shipped weight has already spent. The family's recorded window is therefore measured at
`--pool-penalty 0`, and a screen that ignored the base term would report a window every
zero-regression measurement contradicts.

## 2. Solved, not swept — and the structural fact that made it a one-liner

Each case's requirement is a union of half-lines in `w`, so the machinery is the one already
there for weights (`caseWeightInterval`), pointed at a different slope: **the family
indicator instead of the failed-edge score**. The window, the cap, the binder and the gain
are then exact ratios.

A gain's satisfying set can be proved to be exactly `[floor, ∞)`:

- a gain is a case NOT satisfied at `w = 0`, so no root's interval covers 0;
- a root that is NOT a family member keeps its score while members drop, so once it is first
  it stays first — its interval is `[floor, ∞)` with `floor > 0`;
- a root that IS a member is capped above by every non-member ahead of it, so its interval
  either covers 0 (the case is then not a gain) or is empty.

So the gain is a cumulative count over the floors, and the profile is monotone. The
finite-far-end handling that seemed necessary was **unreachable** and is deleted rather than
tested — the project's rule for an arm no input can reach. A property test asserts the
monotonicity anyway, because if it ever breaks, the reasoning about which weights are
admissible is what broke, not the printing.

## 3. Validation: the pool family, from a checked-in command

```
--dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0 --family-screen
  db.client.connections *   6  [0.048823, 0.087011]   width 0.038188   ship 0.067917
    +6 (ContainerKill +2, HTTPResponseReplaceCode +1, JVMLatency +1, NetworkDelay +1, NetworkPartition +1)
    profile 0.010050→2, 0.020058→3, 0.020203→4, 0.030459→5, 0.048823→6
    cap bound by ts4-ts-security-service-response-replace-code-szv8qk: ts-security-service
      overtaken by ts-preserve-service (lead 0.087011, slope gap 1.000000)
```

Every number matches the recorded measurement: the window `(0.048823, 0.087011)`, the
midpoint `0.0679`, the +6, the per-type split, and the same binding case and pair. Last
iteration solved that window with a **throwaway probe**; it is now solved by a signed-in
command, which is the standing this project requires of a published number.

Two structural invariants were checked on the real dump rather than assumed: the case that
caps a window is never one of its gains (the cap comes from a case correct at `w = 0`), and
every gain's reconstructed rank-1 at `w = 0` belongs to the family being screened (the
mechanism the model describes). Both hold for all four gaining families.

## 4. The screen, at the shipped configuration (756 protected)

| family | gain | window | width | ship |
| --- | --- | --- | --- | --- |
| `http.server.duration` | **4** | `[0.010050, 0.010050]` | **point** | 0.010050 |
| `jvm` | **2** | `[0.010050, 0.010050]` | **point** | 0.010050 |
| `trace` | 1 | `[0.010050, 0.256611]` | 0.246561 | 0.133331 |
| `container` | 1 | `[0.061875, 0.101897]` | 0.040022 | 0.081886 |
| `http.client.duration` | 1 | `[0.016807, 0.022416]` | 0.005609 | 0.019612 |
| `db.client.connections` (shipped) | 0 | `[0, 0.019111]` | 0.019111 | — |
| `hubble_http`, `queueSize`, `k8s`, `none`, 5 × `hubble_*` | 0 | — | ≤ 0.057 | — |

**The answer is no, and it is not "there is nothing there".** The two families with the
largest gains cannot be shipped: their maximal gain arrives at a **single weight** whose
value is *also* the weight at which a currently-correct case loses — the window has no
interior, so one float above it is a regression. The families with interior windows gain
**one case each**.

The gain **profile** is what makes this readable, and it earns its keep on the point rows:
`http.server.duration` at the shipped configuration reads `0.008418→1, 0.010050→4` — four
cases arrive only at the wall, but **one is reachable on an interior step**. A report that
printed only "gain 4, window a point" would recommend nothing and hide the shippable single
case; a report that printed only the widest window would hide the four.

## 5. Why the axis is blocked — the reward and the wall are the same constant

`0.010050` is not a coincidence, and it is worth naming because it explains the whole table:
it is the metric term's **top step**, `log1p(1) − log1p(0.98)`, which is a constant for
every case with 51 candidates — the benchmark's common size. A family penalty that must
demote a member-winner to win a case, and must not demote a member-root in a case that is
already correct, is bounded by that **same** number whenever both cases have equal log
credit. So the wall and the reward coincide, and the window collapses to a point.

This is the register's "the obstacle is CONFLICT between cases", made concrete: the census
margins are real (`k8s`/`container`/`jvm`-driven sources +85; client/pool-driven winners
+131), the cases exist, and the term still cannot separate them, because the population that
must be demoted and the population that must not be share one margin distribution.

## 6. What this closes

1. **The winner-side family-penalty axis is measured-exhausted.** Every family was screened,
   including the ones with no gain (a row with a zero, not an omission, because whether an
   axis was screened and found worthless is the difference between a closed question and an
   open one). Only one family was worth a term, and it is shipped.
2. **The register's reopening condition is unchanged and now has a sharper form**: a set or
   shape that gains more than +6 with no case-level regression, or a window wider than
   0.038 — plus the new clause, that a window of width ZERO is not a window.
3. **Not closed:** a per-case discriminator (the lever the ceiling analysis named), and any
   candidate that is not a function of a service's own dominant family.

## 7. Two defects found while building this, and the test methods that caught them

1. **A `Set` collapsed two gains into one.** The profile collected the arrival weights in a
   set; two of the pool family's six gains arrive at exactly the same weight (`0.010050`),
   so the screen reported **five** gains where the solver had found six — while the
   per-type split, which counts CASES, still said six. Two counts of one population
   disagreed on the printed page, which is how it was caught. It is the same collapse the
   metric term's tie-group mean exists to avoid, one layer out.
2. **An assertion passed off a fixture's own name.** The single-point branch's test asserted
   `toContain('point')` while the gaining fixture was named `gain-point`, so the branch had
   never executed. The assertion is now anchored to the column (`/\]\s+point\s/`), the
   fixture is renamed, and the coverage report — not the test — said the branch was
   untouched.

## 8. Reproduce

```bash
# the validation: the pool family's recorded window, solved (6, 0.048823..0.087011, 0.067917)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --pool-penalty 0 --family-screen

# the screen at the shipped configuration (the table above)
npx tsx benchmarks/src/analyze-fse26-diagnose.ts \
  --dump artifacts/r34928980425/fse26-results.txt --log-weight 1 --family-screen
```
