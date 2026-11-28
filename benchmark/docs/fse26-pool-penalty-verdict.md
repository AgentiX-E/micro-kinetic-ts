# The pool-dominance penalty — a candidate found by census, pre-screened for free

> The first candidate the term oracle produced rather than confirmed: a service whose own
> anomaly maximum was won by a `db.client.connections.*` series is penalised. Found by the
> dominant-family census (`fse26-term-oracle-verdict.md` §5), which put **128 wrong rank-1
> winners** on that family against **48 ground-truth sources** — the largest winner-side
> margin of any family, and the exact opposite of what a sampled verdict in this register
> claimed about the same series.
>
> The register requires a candidate to name its context feature and show it separates on a
> free read before any run. This document is that read, plus the enrolment, plus the
> measurement.

## 1. Why this is not one of the closed metric-layer shapes

The register has closed: any monotone transform or bound of a service's OWN score; the
fleet-relative baseline; global min-max normalisation; the anomaly dynamic range; and the
whole `dropMetrics` input-ablation family, by family and by label.

The penalty is none of them, and the two differences are each load-bearing:

- **It is a function of WHICH series won, not of the score.** `poolMetricScore(v) ∈ {0, 1}`
  is constant across a service's anomaly magnitude — a service at 0.90 and one at 0.30 with
  the same dominant series receive the same value — so it cannot be written as a reshaping
  of `A(v)`. The closest closed row ("any monotone transform or bound of a service's own
  score") is exactly what it is not.
- **It removes nothing.** A `dropMetrics` ablation deletes the series from the input, so the
  service's maximum recomputes and its SECOND metric takes the case over — the mechanism the
  register names for why the pool label drop recovered only **2 of the 56** cases its bound
  predicted. A constant subtraction leaves the maximum, the normalisation and every other
  term untouched.

It is also not the failed-edge-direction signal, which carries the direction of a CALL; this
one carries the identity of the EVIDENCE, and it is the only NEGATIVE term in the score
whose sign is not already inside the signal.

## 2. The free read: which family set, and at which weight

The pre-screen is exact for this shape: the oracle reconstruction reproduces the shipped
run's own rank-1 on 1422/1422 cases, and the term is a constant subtraction, so nothing else
in the score moves. **Twelve family sets were pre-registered and all twelve are reported** —
the source side credited, the winner side penalised, and both together:

| # | set | frontier w | gain at the frontier | first casualty at |
| --- | --- | --- | --- | --- |
| S1 | +{k8s, container} − {pool, client} | 0.0100 | **0** | 0.0125 `NetworkBandwidth` −2 |
| S2 | +{k8s, container, jvm} − {pool, client} | 0.0075 | **0** | 0.0100 `HTTPRequestReplaceMethod` −1 |
| S3 | +{k8s, container} − {pool, client, hubble} | 0.0100 | **0** | 0.0125 `NetworkBandwidth` −2 |
| S4 | +{k8s, container} | 0.0100 | **0** | 0.0125 `NetworkBandwidth` −2 |
| S5 | −{pool, client} | 0.0200 | +2 | 0.0225 `NetworkPartition` −1 |
| **S6** | **−{pool}** | **0.0925** | **+5** | **0.0950 `HTTPRequestReplaceMethod` −1** |
| S7 | −{client} | 0.0200 | +1 | 0.0225 `NetworkPartition` −1 |
| S8 | −{pool, client, hubble, server} | 0.0100 | +1 | 0.0125 `NetworkBandwidth` −2, `HTTPRequestDelay` −1 |
| S9 | +{k8s, container} − {pool} | 0.0100 | **0** | 0.0125 `NetworkBandwidth` −2 |
| S10 | +{k8s} | 0.0100 | **0** | 0.0125 `NetworkBandwidth` −2 |
| S11 | +{container} | 0.0200 | +3 | 0.0225 `ContainerKill` −1 |
| S12 | +{k8s, container, jvm} − {pool} | 0.0075 | **0** | 0.0100 `HTTPRequestReplaceMethod` −1 |

`pool` = `db.client.connections.*`, `client` = `http.client.request.duration*`,
`server` = `http.server.request.duration*`, `hubble` = `hubble_http_*`. The frontier is the
largest weight at which NO fault type loses a case; the gain is the count at that weight.

**The source-side bonus is dead, and that is the finding.** Every set that CREDITS the
resource families — S1, S2, S3, S4, S9, S10, S12, whether alone or against a penalty — has a
frontier of at most 0.01 and gains **nothing** before its first casualty. Its first loss
precedes its first win, which is the "wins and losses are one population" shape this register
already rejected for the failed-edge direction signal: the +85 census margin is real and does
not convert into a rule, because a resource-dominant service is the wrong answer often enough
to pay for the credit.

What converts is the WINNER-side penalty, and only for one family. S6 keeps a frontier
**9× wider** than S5 and gains **+5 against +2**: adding `http.client.request.duration` to
the set costs four fifths of the window, because that series is a genuine source signature in
some populations. That is why the shipped term names one family and not "the client-side
durations" — measured, not assumed. S11 (`+{container}`) is the one bonus with a non-zero
gain (+3), and it dies at 0.0225 on `ContainerKill`, the very type it was meant to help.

## 3. The window, solved rather than swept

Under the strictly stronger condition — **zero case-level regressions**, not merely zero
fault types whose Top@1 fell — the window is:

| w | cases correct | gained | lost |
| --- | --- | --- | --- |
| 0.0200 | 752 | 2 | 0 |
| 0.0400 | 755 | 5 | 0 |
| **0.048823** (plateau starts) | 756 | 6 | 0 |
| 0.0600 … 0.0850 | 756 | 6 | 0 |
| **0.087011** (first loss) | 756 | 6 | 1 |

The boundaries are bisected to 1e-6, not sampled: the gain plateau begins at **0.048823**
and the wall is at **0.087011**, where `HTTPResponseReplaceCode`
(`ts-security-service` → `ts-preserve-service`) is lost. The shipped candidate takes the
window's **midpoint, 0.0679** — 0.019 from either boundary, because a value chosen at an
edge is a value that a converter revision can move across it.

The per-type split is pre-registered, so the run tests the decomposition and not only the
total: **756, +6/−0**, with `ContainerKill` 4 → 6, `HTTPResponseReplaceCode` 159 → 160,
`JVMLatency` 5 → 6, `NetworkDelay` 19 → 20, `NetworkPartition` 48 → 49.

## 4. The mechanism, case by case

All six gained cases have the same shape — a pool-dominant wrong winner steps aside for a
service that is an acceptable root:

| fault type | wrong rank-1 (pool-dominant) | new rank-1 |
| --- | --- | --- |
| `ContainerKill` | `ts-station-service` (`use_time.max`) | `ts-consign-service` |
| `JVMLatency` | `ts-security-service` (`use_time.max`) | `ts-consign-service` |
| `NetworkDelay` | `ts-order-service` (`wait_time.max`) | `ts-travel-plan-service` |
| `NetworkPartition` | `ts-security-service` (`use_time.max`) | `ts-food-service` |
| `ContainerKill` | `ts-security-service` (`wait_time.max`) | `ts-auth-service` |
| `HTTPResponseReplaceCode` | `ts-travel-service` (`wait_time.max`) | `ts-basic-service` |

Six cases across five fault types, all of them a pool-dominant caller standing in front of
the real root: this is the census's +80 margin being spent where it was measured, not a
tuned nudge that happens to move the total.

## 5. What the classifier is, and the defect it had

`computePoolMetricScores` marks a service whose dominant metric starts with
`POOL_METRIC_PREFIX = 'db.client.connections.'` — **with its trailing dot**, which a test
pins. Without the dot a series named `db.client.connectionsTotal` would be classified as a
pool measurement, and the position of the boundary would be wherever a future converter
happens to put an unrelated name. On the shipped dump all three pool labels carry the dot
(`use_time.max` 2550 services, `wait_time.max` 3713, `timeouts` 1), so the stricter rule
classifies **6264 services either way**: the fix is a guard, and it changes no number here.

The prefix has ONE owner. The offline pre-screen imports it from the engine rather than
restating it — a screen that validates a different family than the engine penalises is a
screen that validates nothing.

## 6. Measurement

### 6.1 The control — the term is inert at its default (run `34949812666`)

Same commit as the candidate, with no `--pool-penalty` input:

```
Config: logWeight=1 logMode=logicHttp rankNormalization=true latWeight=0.561495 latMinRise=10.3 poolMetricPenaltyWeight=0
750 / 1422 = 52.74%;  Top@3 65.75%;  Top@5 70.11%
```

and the per-fault-type table is the published one case for case (`ReplaceCode` 159,
`ContainerKill` 4, `JVMLatency` 5, `NetworkDelay` 19, `NetworkPartition` 48, …). That is
the property the enrolment claimed, measured: at weight 0 the field changes nothing, so the
shipped ranking — and therefore the golden — is untouched by its presence. The config line
prints the field, which is how a reader can tell the shipped run and the ablation apart.

A **second** control (`34949809566`, dispatched separately and identically) returned the same
750 with a byte-identical per-type table and an identical config line, so the +6 below is a
difference between two configurations and not run-to-run variation.

### 6.2 The candidate — measured, and the split reproduced (run `34949854236`)

Same commit, `--pool-penalty 0.0679`:

```
Config: logWeight=1 logMode=logicHttp rankNormalization=true latWeight=0.561495 latMinRise=10.3 poolMetricPenaltyWeight=0.0679
756 / 1422 = 53.16%;  Top@3 66.46%;  Top@5 70.25%   (control: 750, 65.75%, 70.11%)
```

| fault type | control | candidate | Δ | prediction |
| --- | --- | --- | --- | --- |
| `ContainerKill` | 4 | **6** | +2 | +2 ✓ |
| `HTTPResponseReplaceCode` | 159 | **160** | +1 | +1 ✓ |
| `JVMLatency` | 5 | **6** | +1 | +1 ✓ |
| `NetworkDelay` | 19 | **20** | +1 | +1 ✓ |
| `NetworkPartition` | 48 | **49** | +1 | +1 ✓ |
| **REGRESSED** | — | — | **0** | 0 ✓ |

**Both halves of the criterion, on the candidate:** the second half is met by measurement —
**zero regressed fault types**, with every one of the 24 other types holding its count — and
the first half is re-run after the flip (§7), because the golden exercises the DEFAULT
configuration, which this run does not yet carry.

**The split was predicted and it reproduced case for case.** The register warns that a
reconstruction "can be exact in its NET and wrong in its SPLIT"; here the split is exact
too, which is a stronger claim than the total and the reason the reconstruction can be
trusted to pre-screen the next candidate. It did not have to hold: at `w = 0.75` on the
latency axis the same instrument predicted 785 as `+132/−20` where the engine reached
785 as `+121/−9`.

**The window's boundaries were left alone.** The candidate sits at 0.0679, and the measured
casualty at 0.087011 (`HTTPResponseReplaceCode`, `ts-security-service` →
`ts-preserve-service`) did not appear: the run gained that type rather than losing it,
which is consistent with the model and does not license moving the weight toward the
boundary. The next candidate that wants more than +6 has to widen the window, not spend it.

## 7. The flip, and the default path

The constant moves to 0.0679 in the same change that records both measured points, so the
shipped configuration is the measured one and the ablation stays reachable as
`--pool-penalty 0`. After the flip the DEFAULT path is re-measured with no flag at all —
the guard the register demands, because a flag path that works says nothing about the
configuration a dispatched run actually uses.

**Dispatching that default path immediately found a defect.** A bare `workflow_dispatch` of
the FSE'26 benchmark failed in four seconds at **"Verify cache provenance"** and never ran a
case: the workflow's declared default `shard_tag: rcabench-full` names a cache whose
converter digest predates this checkout, and the gate — which exists so a stale cache cannot
publish a wrong score with no error — refuses it. The gate is right; the default was a trap,
and it made the one dispatch every reader tries first fail with a message that reads like a
data problem. The default now names `rcabench-latency-full`, the cache every shipped run
uses and the one whose manifest digest matches HEAD (`7164c66`), and the input's description
says why it is pinned.

The default-path reading is therefore taken with the cache tag supplied — the tag is a
WORKFLOW-owned input, chosen by the operator, while "the default path" means the runner's own
constants — and it is read against the control: same commit, cache and no flag but
`--pool-penalty` differs nowhere, so the config line inside the artifact is the check that
the flip reached the runner's defaults rather than only the flag.

**Result (run `34953378651`, no flag):**

```
Config: logWeight=1 logMode=logicHttp rankNormalization=true latWeight=0.561495 latMinRise=10.3 poolMetricPenaltyWeight=0.0679
756 / 1422 = 53.16%;  Top@3 66.46%;  Top@5 70.25%
+6 gained / 0 lost;  zero regressed fault types
```

identical to the flagged candidate, and the config line shows the term at its new default —
which is the point of the re-measurement: the value a dispatched run uses is the value that
was measured, not the value a flag produced once.

## 8. The shared kill criterion, both halves, on the flip commit

| half | run | result |
| --- | --- | --- |
| RCAEval golden 9-cell byte-identical | `34952203632` (`e2d3b24`, no flag) | **all nine cells exact**: RE1 80.0 / 92.8 / 68.0, RE2 82.4 / 88.9 / 68.1, RE3 80.0 / 45.0 / 51.1 |
| FSE'26 zero regressed fault types | `34953378651` (`e2d3b24`, no flag) | **zero**, +6 cases, every one of the 24 other types holding its count |

Both were measured on the shipped configuration — the golden through the default path, which
is the only path it has — so the criterion is satisfied by measurement rather than by
argument. The previous headline 52.74% (750) remains reachable as `--pool-penalty 0`, and it
too was measured on this commit (`34949812666`, `34949809566`).

## 9. What this does not license

- **The window is not a budget.** Moving toward 0.087011 to buy more would spend the exact
  margin the measurement established, and the casualty there is named. A candidate wanting
  more than +6 has to WIDEN the window (a second family, a better classifier) or find a new
  axis, not move this weight.
- **The credit side stays closed as measured.** Every set that credits the resource families
  gained nothing before its first casualty; re-proposing one needs a reason the frontier
  table does not already refute.
- **One family is not a taxonomy.** The term names `db.client.connections.*` because that is
  what the census measured and what the window tolerates; adding a family is a new decision
  with its own row, and the prefix has one owner so the screen and the engine cannot drift.
- **The +6 is benchmark-specific.** It is a property of these 1422 cases and this cache, which
  is why the constant is guarded by a recorded run id rather than by a comment.
