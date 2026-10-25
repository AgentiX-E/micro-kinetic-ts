# The anomaly composition: three unnamed coefficients, one unnamed aggregation, and where RE1's gap actually is

Internal audit record. Iteration 135. It starts from a fact the previous iteration established and this one
acts on: **on RCAEval RE1 the ranking is not a ranking of terms — it is the anomaly score.** Every other
term is `WEIGHT_ZERO` or `INPUT_MAP_EMPTY` on all 374 analysable cases (run `40133362501`'s loss census),
so the `0.007352` stability tie-break and this composition are the whole of the one benchmark this engine
does not lead.

The composition was, until this iteration, four lines inside `computeAnomalyFeatures`:

```ts
const trendBonus = trendStrength > 0.1 ? trendStrength * 0.15 : 0;
const burstBonus = hasBurst ? deviation * 0.1 : 0;
const cvBonus = cv > 0.5 ? Math.min(cv, 1.5) * 0.05 : 0;
let featureScore = deviation + trendBonus + burstBonus + cvBonus;
```

and the per-service aggregation was a `max` over metrics. Three coefficients, three thresholds, and one
aggregation: none of them named, printed, tested against a value, or reachable from a dispatch.

## 1. What is now configurable, and what is printed

| coefficient | default | where it now appears |
| --- | ---: | --- |
| `anomalyTrendWeight` | 0.15 | config field, named constant, `--anomaly-trend-weight`, `signals:` line |
| `anomalyBurstWeight` | 0.1 | same |
| `anomalyCvWeight` | 0.05 | same |
| `anomalyBreadthWeight` | **0 (off)** | same — a NEW term, see §4 |

Validation is at the graph boundary, once, because these are properties of a configuration rather than of
a metric: `invariantFinite` first, then `invariantRange(…, 0, 10, …)`. `invariantFinite` first **because
`invariantRange` cannot see `NaN`** — `NaN < 0` and `NaN > max` are both false, so a `NaN` weight would have
passed a range check and poisoned every score downstream.

The dispatch surface gained `anomaly_knobs`, a `name=value` list (`trend=…,burst=…,cv=…,breadth=…`) parsed
by a `case` block in the workflow, for one reason: **`workflow_dispatch` accepts at most 25 inputs and this
workflow was at 25.** `topo_discount` gave up its slot — it had been measured and refused on all 735 cases
at two values (RE1 83.47 → 68.53 at ρ = 0.25, `docs/dispatch-forwarding.md` §7) — and its flag stays on the
runner for the successor measure's re-test.

## 2. The ablation, locally (RE1-OnlineBoutique, 125 cases, one variable each)

| configuration | AC@1 | cpu | delay | disk | loss | mem |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **shipped** | **82.4** | 92.0 | 88.0 | 92.0 | 48.0 | 92.0 |
| `trend = 0` | 80.8 | 92.0 | 84.0 | 92.0 | 48.0 | 88.0 |
| `burst = 0` | 83.2 | 92.0 | 88.0 | 92.0 | 48.0 | 96.0 |
| `cv = 0` | 82.4 | 92.0 | 88.0 | 92.0 | 48.0 | 92.0 |
| all three = 0 | 80.8 | 92.0 | 84.0 | 92.0 | 48.0 | 88.0 |
| `trend = 0.3` | 83.2 | 92.0 | 84.0 | 100.0 | 48.0 | 92.0 |
| `temporalWeight = 0.05` | 78.4 | 92.0 | 76.0 | 92.0 | 48.0 | 84.0 |
| `temporalWeight = 0.3` | 72.8 | 68.0 | 76.0 | 92.0 | 48.0 | 80.0 |

Three readings, and the first is the important one:

1. **The three shipped coefficients are at a local optimum on this cell.** Zeroing trend costs 2 cases,
   zeroing burst gains 1, zeroing cv changes nothing, and all three together cost 2. This is not where
   RE1's 1.93 pp lives, and the honest conclusion is that the composition is calibrated — not that it is
   wrong.
2. **`cv` is inert here** (`cv > 0.5` almost never fires on this corpus), which is worth knowing before it
   is used to explain anything.
3. **The temporal term is harmful at every weight tested**, down to the smallest: 0.05 already costs 4.8 pp.
   That is consistent with the term's recorded FSE'26 rejection and it closes the "onset order could
   resolve the one-step misses" hypothesis before it costs a dispatch.

## 3. Where the gap actually is: 26 cases, one rank step each

Of RE1's 62 misses (313/375 = 83.47%), the distance to the truth is not uniform:

| rank of the truth | RE1-OB | RE1-SS | RE1-TT | total |
| --- | ---: | ---: | ---: | ---: |
| **2 (one step)** | 7 | 1 | **18** | **26** |
| 3 | 2 | 3 | 3 | 8 |
| ≥ 4 | 13 | 5 | 10 | 28 |
| **misses** | 22 | 9 | 31 | **62** |

So 34 of the 62 are within three places, and **26 are exactly one rank step** — a population a bounded,
ordinal tie-break can reach, and one no weight (measured three times now) can.

The other 28 are not reachable by any term, and the reason is in the corpus rather than the ranking.
`re1ob_adservice_loss_2` is the clearest case, and `loss` is RE1's biggest miss block (25 of the 62):

| adservice (the truth) | head (first tenth) | tail (last tenth) |
| --- | ---: | ---: |
| `workload` | 4.333 | 4.021 |
| `latency-50` | 0.0027 | 0.0027 |
| `latency-90` | 0.0046 | 0.0048 |
| `cpu` | 0.376 | 0.378 |
| `mem` | 3.65e7 | 4.02e7 |

The injected service's own channels are **flat to three significant figures**. A packet-loss fault at
`adservice` means requests do not arrive: its server-side metrics barely move while its CALLER — which is
what the ranking picks, `checkoutservice` — carries the symptom. The identifying evidence is on the EDGE
`checkoutservice → adservice`, and RE1 ships no edges (`latency-routes[OnlineBoutique]: 0 rows` over 125
cases; `log-routes: no log file 125`). Those misses are **unidentifiable from what the suite carries**, by
any method that does not read the prior.

## 4. The new term, and the one property that matters

`max` over metrics cannot distinguish a source (three channels moved) from a symptom (one latency channel
moved) at the same magnitude. That is precisely the shape of the 26 one-step misses. The term:

```
breadth(v) = (Σ_i d_i)² / Σ_i d_i²  −  1        over v's KEPT metrics
score'(v)  = max_i d_i  +  w · breadth(v)
```

- **0 for a single moving channel**, `k−1` when `k` channels moved equally, and it is a **ratio** — after
  three iterations of scale defects (a guard reading two samples, a trend measured in absolute slope, an
  additive term worth six rank steps on one cell) that is the first thing to check, and there is a test for
  it: the same shape at ten times the magnitude earns the same reward.
- **added, not multiplied**, because a node-dependent multiplier was measured to replace the ordering it
  was meant to refine (`docs/dispatch-forwarding.md` §7–§8).
- **`w = 0` skips the arithmetic**, so the shipped ranking is bit-identical by construction rather than by
  comparison.

Locally, at `w = 0.05`: **RE1-OnlineBoutique 82.4 → 84.0, +2 cases, ZERO losses**, and both gains were
rank-2 misses (`currencyservice_mem_1`, `productcatalogservice_disk_4`). At 0.15 / 0.3 / 0.6 the cell falls
back to 82.4 / 80.8 / 80.0 — a maximum at the smallest weight, which is the signature that made the
additive topological term's weight undecidable. The difference here is the loss column: that term lost 64
cases at its first weight, this one loses none — and zero losses at the point where two one-step misses
flip is the only evidence that has ever pointed at RE1's gap rather than at its noise floor.

### 4a. The nine cells, dispatched (`40182461658`, `anomaly_knobs=breadth=0.05`)

| cell | shipped | breadth 0.05 | Δ |
| --- | ---: | ---: | ---: |
| RE1-OnlineBoutique | 103/125 | **105/125** | **+2** |
| RE1-SockShop | 116/125 | 116/125 | 0 |
| RE1-TrainTicket | 94/125 | **98/125** | **+4** |
| **RE1** | **313/375 = 83.47%** | **319/375 = 85.07%** | **+6** |
| RE2-OnlineBoutique | 76/90 | 76/90 | 0 |
| RE2-SockShop | 83/90 | **85/90** | **+2** |
| RE2-TrainTicket | 67/90 | **69/90** | **+2** |
| **RE2** | 226/270 = 83.70% | **230/270 = 85.19%** | **+4** |
| RE3-OnlineBoutique | 22/30 | 22/30 | 0 |
| RE3-SockShop | 12/30 | **13/30** | **+1** |
| RE3-TrainTicket | 15/30 | 15/30 | 0 |
| **RE3** | 49/90 = 54.44% | **50/90 = 55.56%** | **+1** |
| **all three** | **588/735** | **599/735** | **+11** |

**Six cells up, three unchanged, none down, +11 cases.** Four iterations of candidates have been measured
on this population — a transient-guard window (−2), an additive topological weight (−56), a multiplicative
topological discount (−68), three coefficient ablations (0 to +1 each) — and this is the first that moves
the total without costing a single cell. It also lands where it was aimed: RE1-TrainTicket, which holds 18
of the 26 one-step misses, gains the most (+4), and RE1 reaches **85.07%**, 0.33 pp — one case — below
`L0`'s 85.4%, the closest this engine has been to the only published arm ahead of it.

### 4b. The other half, and why 0.05 is still not enrolled

The kill criterion is an AND over two benchmarks, so the FSE'26 half had to be askable — it was not: the
composition had no FSE'26 flag. Four flags and four `ranking_knobs` arms later, the pair is attributable at
one commit (`4c4d2ee`), both runs' `Config:` lines naming the knob:

| FSE'26 (1422 cases) | shipped (`40189402677`) | `breadth=0.05` (`40189405012`) | Δ |
| --- | ---: | ---: | ---: |
| Top@1 | 56.12% | **56.61%** | **+0.49 pp (+7 cases)** |
| Top@3 | 69.48% | 69.55% | +1 case |
| **Top@5** | **72.01%** | **71.59%** | **−6 cases** |
| fault types regressed | — | `HTTPRequestDelay` −2, `NetworkLoss` −1 | 3 of 14 |

**It is a trade, not a free lunch, and this record does not book it as one.** On the golden half the term
is a strict improvement (+11 cases, no cell down); on FSE'26 it buys 7 Top@1 cases and pays 6 Top@5 cases,
with two fault types regressing. The pattern is interpretable — the bonus CONCENTRATES a ranking rather
than reordering its tail, which helps a Top-1 metric and slightly hurts a Top-5 one — but an interpretation
is not an acceptance criterion, and this repository's criterion is that no cell goes down.

So `DEFAULT_ANOMALY_BREADTH_WEIGHT` stays **0**. The named next experiments, in the order the evidence
supports them:

1. **A GATED breadth** — fire the bonus only when the node's runner-up is within one rank step, i.e. only
   where a tie is being broken. That is the shape the failed-edge term already ships (`admitsFailedEdgeTerm`),
   and it is aimed at exactly what the term did wrong on FSE'26: bonus cases it was not needed for, which
   is what moved a truth out of the top five.
2. **A smaller weight**, `0.02`, measured as a pair on both halves. Cheap, but the local curve (84.0 at
   0.05, 82.4 at 0.15) says the gain is concentrated near the smallest weight, which is the weak-signal
   signature that made this record refuse an earlier term.

## 5. What ships, and what is pending

| item | status |
| --- | --- |
| the three coefficients: named, configurable, printed, dispatched, validated | **shipped** |
| `anomaly_knobs` input, `topo_discount` retired to make room | **shipped** |
| the breadth term with `DEFAULT_ANOMALY_BREADTH_WEIGHT = 0` | **shipped, OFF** |
| `W = 0.05` | **measured on both halves, NOT enrolled** — RCAEval +11 with no cell down, but FSE'26 Top@5 −6 cases and two fault types regressed |
| every published cell | **unchanged**: all defaults are the shipped values, and the bit-identity test says so |

The next decision is the nine cells at `breadth=0.05`, read against the per-service table for TrainTicket
(18 of the 26 one-step misses are there) and the same no-loss condition that the local pair showed.
