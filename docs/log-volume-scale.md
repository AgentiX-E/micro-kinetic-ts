# The log term's scale — three shapes, five arms, and why the axis closes as a family

Status: **closed**. `max` ships. `saturating` and `share` are built, dispatchable, measured and
rejected. This document exists so the axis is not re-derived a fifth time.

Read `docs/closed-axes-register.md` first: the row for the log-signal mode is what this one
extends, and §4 below is the same conflict that row reports, seen from the term's other side.

## 0. Verdict

`computeLogScores` divides each service's admitted count by the case's largest admitted count.
That divisor is the only thing a "scale" can change, and it was changed three ways and measured
on the shipped corpus (FSE'26 wave B2, 711 datapacks, `--log-mode logicHttp`, everything else at
the enrolled default):

| arm                       | divisor                  |            Top@1 | Δ vs shipped |  Top@3 |  Top@5 |
| ------------------------- | ------------------------ | ---------------: | -----------: | -----: | -----: |
| **`max` (shipped)**       | the case's largest count | **484 (68.07%)** |            — | 82.98% | 84.81% |
| `saturating`, κ = 100     | `1 − e^(−c/100)`         |     460 (64.70%) |      **−24** | 79.18% | 81.72% |
| `saturating`, κ = 25      | `1 − e^(−c/25)`          |     450 (63.29%) |      **−34** | 80.03% | 83.54% |
| `saturating`, κ = 10      | `1 − e^(−c/10)`          |     437 (61.46%) |      **−47** | 80.31% | 83.97% |
| `saturating`, κ = 5       | `1 − e^(−c/5)`           |     437 (61.46%) |      **−47** | 80.31% | 83.97% |
| `share`                   | the case's total count   |     474 (66.67%) |      **−10** | 80.59% | 83.40% |
| `logWeight = 0` (control) | — (term removed)         |     362 (50.91%) |     **−122** | 61.04% | 66.95% |

Top@3 and Top@5 move far less than Top@1 in every arm, which is the shape of a _decoration_
change rather than an _evidence_ change: the candidates the arms disagree about are at rank 1, and
the truth is usually still inside the top five. The control is what makes the rest legible — the
term is worth 122 cases, and it is worth them at exactly one scale.

## 1. What "scale" can mean, and why there are only three answers

A counting mode admits a multiset of lines per service, `c(v)`, and the term contributes
`logWeight × s(v)` to `finalScore(v)`. Every normalisation of the form `s(v) = g(c(v)) / h(case)`
with `g` strictly increasing leaves the case's log ORDER untouched, so the arm cannot be a new
statistic wearing a scale's name — it can only change **how much weight the term claims in this
case**, and (for non-uniform divisors) **how the case's ratios between services survive**. There
are exactly three things a per-case divisor can be:

1. **the case's maximum** (`max`) — the divisor makes the top emitter `1.0`, so the term claims a
   full weight on every case and preserves every within-case ratio exactly. That is a statement
   about the ORDER of the candidates and about nothing else.
2. **a fixed constant** (`saturating`) — the divisor is absolute, so the term's weight follows the
   champion's own volume: loud cases keep the weight, quiet ones surrender it. The `exp` keeps the
   score in `[0, 1]` and strictly increasing, so again no ordering moves — but the ratios are
   compressed toward `1` as the counts rise above the scale.
3. **the case's total** (`share`) — the flood is read as a distribution over services, so
   `s(v) = c(v) / Σc` is the case's emitter CONCENTRATION. Algebraically `share` is `max` ×
   `max / Σc`: a _uniform_ per-case scale, so it preserves every ratio exactly and the term claims
   as much weight as the flood is concentrated. It is the mirror image of `saturating` — `share`
   keeps full weight where the evidence is pinpoint and withdraws it where the flood is diffuse.

`max`, `saturating` and `share` are therefore the whole family, and that is the point of measuring
all three rather than one: a single failing alternative is a failed guess, while the three
together separate the two properties a divisor can carry — **magnitude** and **ratio** — and say
which of them the ranking is actually reading.

## 2. The census: what a `1.0` is worth

Measured with the engine's own level-1 admission rule (`logLineAdmittedByMode('logicHttp', …)`
plus the level and window filters), over all 711 datapacks:

| statistic                                                             |           value |
| --------------------------------------------------------------------- | --------------: |
| cases with no admitted line at all                                    | 230 (**32.3%**) |
| cases whose top emitter has ≤ 1 line                                  | 245 (**34.5%**) |
| admitted top count, p50                                               |           **8** |
| admitted top count, p75                                               |              74 |
| admitted top count, p90                                               |             216 |
| admitted top count, p99                                               |           3 042 |
| cases where several services TIE at the top (all paid `1.0` by `max`) | 112 (**15.8%**) |
| cases where the GROUND TRUTH is the top emitter                       | 271 (**38.1%**) |
| cases where a flood exists and the ground truth emits **nothing**     | 120 (**16.9%**) |

Two sentences follow, and they frame everything below.

**A case's `1.0` usually stands for a handful of lines.** The median case admits eight lines
fleet-wide, so `max`-normalisation hands the term's entire weight to a service on the strength of
one to eight lines — and in 15.8% of cases it hands that weight to several services at once,
because they tie.

**The term cannot point at the truth in more than 38% of the corpus, and it actively points away
from it in 17%.** That is a coverage ceiling no divisor can lift: in the 120 truth-silent cases the
ground truth's score is `0` under _every_ member of the family, because its count is `0`. The only
weight that helps there is `0`, which is the control arm.

## 3. The measurement

### 3.1 `saturating` loses, and its own ordering is not the magnitude ordering

Four scales spanning a factor of 20. The mean champion score — the weight the term actually claims
on a case with a flood — is computable from the census, so each arm can be placed on the weight
axis it is (whatever else it is) moving along:

| arm                   | mean champion score | Top@1 |    Δ |
| --------------------- | ------------------: | ----: | ---: |
| `max`                 |               1.000 |   484 |    — |
| `saturating`, κ = 5   |               0.850 |   437 |  −47 |
| `saturating`, κ = 10  |               0.753 |   437 |  −47 |
| `saturating`, κ = 25  |               0.622 |   450 |  −34 |
| `saturating`, κ = 100 |               0.399 |   460 |  −24 |
| `logWeight = 0`       |               0.000 |   362 | −122 |

The column that matters is the second against the third, and it is **not monotone**. If the arm
were merely a weight dial, the reading would fall smoothly from 484 (weight 1) toward 362 (weight
0), and a weight of 0.85 would be close to the shipped number — `logWeight` has been swept, and its
optimum is at 1 with a shallow neighbourhood (`docs/fse26-logweight-sweep-verdict.md`). Instead
0.85 is the WORST of the four, and the best of the four is the one closest to `max` in _ratio_:
κ = 100 leaves the champion at 0.98 for a 400-line flood while the runner-up keeps 0.077 of it,
where `max` gives 0.02 and κ = 5 gives 0.80.

So the ordering of the arms is explained by **ratio distortion**, not by magnitude: the divisor's
real work is to decide how much of the champion's lead survives, and the corpus wants that lead
intact. `saturating` cannot split the two properties apart, which is why `share` had to be built.

### 3.2 The sign flips across families, and that is the conflict

Per-fault-type correct counts, deltas against the shipped arm:

| fault type               |   n |  `max` |       κ=100 |     κ=25 |     κ=10 |      κ=5 | `logWeight=0` |
| ------------------------ | --: | -----: | ----------: | -------: | -------: | -------: | ------------: |
| HTTPResponseReplaceCode  |  95 | **51** |    38 (−13) | 37 (−14) | 33 (−18) | 33 (−18) |       7 (−44) |
| HTTPRequestReplaceMethod |  78 | **43** |    32 (−11) | 33 (−10) | 31 (−12) | 31 (−12) |      11 (−32) |
| HTTPRequestAbort         |  23 | **13** |      9 (−4) |   9 (−4) |   9 (−4) |   9 (−4) |       3 (−10) |
| HTTPResponseAbort        |  18 | **11** |      8 (−3) |   7 (−4) |   6 (−5) |   6 (−5) |       1 (−10) |
| HTTPResponseReplaceBody  |  15 |  **9** |      8 (−1) |   6 (−3) |   5 (−4) |   5 (−4) |        0 (−9) |
| HTTPRequestReplacePath   |  17 | **16** |     17 (+1) |  15 (−1) |  12 (−4) |  12 (−4) |       1 (−15) |
| NetworkPartition         |  69 |     42 | **50 (+8)** |  44 (+2) |   42 (0) |   42 (0) |   **51 (+9)** |
| NetworkBandwidth         |  25 |     12 | **15 (+3)** |  13 (+1) |   12 (0) |   12 (0) |   **16 (+4)** |
| NetworkLoss              |  31 |     18 |     19 (+1) |  19 (+1) |   18 (0) |   18 (0) |       20 (+2) |
| NetworkCorrupt           |  29 |     22 |      22 (0) |   22 (0) |   22 (0) |   22 (0) |       23 (+1) |
| JVMMemoryStress          |  80 |     80 |          80 |       80 |       80 |       80 |    **80 (0)** |
| ContainerKill            |  55 |     55 |          55 |       55 |       55 |       55 |    **55 (0)** |
| PodKill / PodFailure     |  14 |     14 |          14 |       14 |       14 |       14 |        14 (0) |

The two families move in **opposite directions**, monotonically in the weight the arm removes:

- the HTTP replace/abort families lose every time the log term claims less weight, all the way to
  −44 and −32 at zero;
- the network families GAIN, +8 and +3 at κ = 100, +9 and +4 at zero;
- the lifecycle families (JVM memory, container kill, pod kill/failure) are **byte-identical in all
  six arms**, because their sources are log-silent (16.9% row above) and the term is already zero
  there — which is also why `podStateWeight` carries them alone.

A single per-case weight cannot serve a population in which the same term must claim MORE weight in
one family and LESS in another. This is the register's conflict — "demands for opposite weightings
from cases that a global weight cannot serve at once" — measured on the term's scale instead of its
weight, and it is the reason no member of the family wins on total.

### 3.3 `share` — the arm that isolates magnitude from ratio

`share` is the decisive arm, because it is the only member that changes the term's magnitude while
preserving every within-case ratio exactly. Its reading therefore separates the two explanations
§3.1 could not:

- if the ranking reads **ratio**, `share` must stay close to `max` on the HTTP families and track
  concentration elsewhere, landing near the shipped total;
- if the ranking reads **magnitude**, `share` must behave like a weight dial and lose roughly in
  proportion to the mean concentration it removes.

**Measured: 474 (66.67%), −10 — every within-case ratio intact, and still a loss.**

That reading is the sharpest one on the axis, because it comes with a control the other arms do not
have. `share`'s champion score IS the case's emitter concentration, measured over the 481 flooding
cases at a mean of **0.609** (median 0.500; 36.2% of those cases are above 0.9, 41.4% below 0.5).
So `share` and `saturating` κ = 25 claim almost the same weight — 0.609 against 0.622 — and differ
by 24 cases:

| arm                  | mean weight the term claims | within-case ratios  |   Top@1 |
| -------------------- | --------------------------: | ------------------- | ------: |
| `saturating`, κ = 25 |                   **0.622** | compressed toward 1 |     450 |
| `share`              |                   **0.609** | **exact**           | **474** |

Same magnitude, different ratio treatment, 24 cases apart. That is the isolation the axis needed:
the loss was never about how much weight the term claims — it is about how much of the case's
internal structure the divisor preserves. `share` also loses the least of any departure, and
whatever is left of its 10 is **magnitude alone**, because its ratios are untouched:

| population                                                                                                |   n | `max` | `share` |       Δ |
| --------------------------------------------------------------------------------------------------------- | --: | ----: | ------: | ------: |
| replacement (`ReplaceCode` / `ReplaceMethod` / `ReplaceBody` / `ReplacePath`)                             | 205 |   119 |     106 | **−13** |
| abort (`HTTPRequestAbort` / `HTTPResponseAbort`)                                                          |  41 |    24 |      20 |  **−4** |
| delay (`HTTPRequestDelay` / `HTTPResponseDelay`)                                                          | 119 |    68 |      74 |  **+6** |
| network partition / loss / corrupt / bandwidth                                                            | 154 |    94 |      95 |  **+1** |
| lifecycle (JVM memory stress, exception, return, latency, CPU, MySQL, container kill, pod kill / failure) | 175 |   161 |     161 |   **0** |

The residual 10 are the family conflict of §3.2, and with the ratio term removed they do not merely
persist, they sharpen: the replacement population still wants more log weight and the delay
population still wants less. A divisor is a **case-level** scalar; this is a **label-level**
disagreement. No member of the family can express it, which is the precise sense in which the axis
is closed rather than merely unanswered.

## 4. Why the objective function has no interior optimum on this axis

The census gives the oracle weight per case directly, and it is **bimodal**:

- in 271 cases (38.1%) the ground truth is the top emitter, so the term's ideal weight there is
  `≥ 1` (it is what puts the truth first);
- in 120 cases (16.9%) a flood exists and the ground truth emits NOTHING, so the term's ideal
  weight there is exactly `0` — every non-zero weight hands `logWeight × 1.0` to a service that is
  not the answer;
- in 230 cases (32.3%) there is no flood, the term is identically zero, and the weight is
  irrelevant;
- the remainder the term is neither the cause of the win nor of the loss.

A per-case schedule can only help if it can tell the first group from the second, and the only
observable that has been proposed for that split — the flood's emitter CONCENTRATION — was measured
and refuted before it reached ablation: `logicHttpDominant` (a hard gate at concentration ≥ 0.5)
reaches 749–753 on the 1 422-case dump with **five regressed fault types**, and sweeping its
threshold from 0.2 to 0.95 leaves exactly one point that regresses nothing, at +1 case. The
mechanism is this section's conflict again: the flood is a source signature in the replace-code
population (one emitter owns 90–100% of it) and a victim cascade in the network population
(spread) — and `share` is the CONTINUOUS version of that same gate. Its reading (§3.3) is
therefore the second independent refutation of concentration as a discriminator, from the soft
side, and it is why the axis closes as a family rather than as a knob.

What would lift the 16.9%? Not a divisor. A different observation about the same lines: something
that says "these 400 lines are all the same propagated wrapper" rather than "this service emitted
400 lines". The novelty mode (`computeLogNoveltyScores`) is that idea and it is measured — the
register's log-mode row holds its verdict. The term's remaining defects are of that kind, and this
document deliberately does not propose another one.

## 5. What ships

`DEFAULT_LOG_NORMALISATION = 'max'`. The two alternatives remain in the tree as vocabulary
members, reachable as `--log-normalisation` on the FSE'26 and RCAEval chains, as
`logNormalisation` on the `ranking_knobs` workflow block, and printed on every artifact's
configuration line — because an arm that cannot be re-run is a claim, and a claim that cannot be
re-run is not evidence. `packages/tree/__tests__/unit/ranking-signals.test.ts` holds the three
properties each member must keep (order preserved, silent services zero, a direction gate may only
subtract), and `benchmarks/__tests__/cli-argument-rejection.test.ts` holds the vocabulary at both
ends of both chains.

## 6. Reproduce

```bash
# the arms (§3), identical except for the scale:
npx tsx benchmarks/src/run-fse26.ts --data-dir <waveB2> --output base.json
npx tsx benchmarks/src/run-fse26.ts --data-dir <waveB2> --log-normalisation saturating --output sat.json
npx tsx benchmarks/src/run-fse26.ts --data-dir <waveB2> --log-normalisation share --output share.json
npx tsx benchmarks/src/run-fse26.ts --data-dir <waveB2> --log-weight 0 --output logw0.json
```

`--log-normalisation saturating` reads `LOG_SATURATION_COUNT` (25) as its half-saturation point; the κ = 5, 10
and 100 arms in §3.1 were produced by editing that constant between runs, which is recorded here because the
constant is deliberately not a knob — a κ a dispatch could set would turn one falsified axis into an infinite one.

The census (§2) is `benchmarks/src/log-flood-census.ts`, a pure module with no entry point so that it can be
tested; wire it to a corpus in six lines:

```ts
// npx tsx /tmp/census.mts <waveB2>
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { censusLogFlood, summariseLogFlood } from './benchmarks/src/log-flood-census.js';
import { FSE26Loader, toFaultGraphOptions } from './packages/kinetic/src/benchmarks/index.js';

const root = process.argv[2]!;
const loader = new FSE26Loader({});
const rows = [];
for (const name of readdirSync(root).sort()) {
  const dir = join(root, name);
  if (!statSync(dir).isDirectory() || !statSync(join(dir, 'case.json')).isFile()) continue;
  const raw = loader.loadCase(dir);
  const bench = loader.toBenchmarkCase(raw);
  const graph = toFaultGraphOptions(bench, bench.injectTime);
  rows.push(
    censusLogFlood({
      id: bench.id,
      faultType: bench.groundTruth.faultType ?? 'unknown',
      logs: graph.logs,
      nodeIds: new Set(bench.callGraph.nodes.keys()),
      injectTimeMs: bench.injectTime,
      groundTruth:
        raw.groundTruthServices.length > 0
          ? raw.groundTruthServices
          : [bench.groundTruth.serviceId],
    }),
  );
}
console.log(JSON.stringify(summariseLogFlood(rows), null, 2));
```
