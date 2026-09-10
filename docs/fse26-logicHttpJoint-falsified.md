# FSE'26 `logicHttpJoint` — falsified (relative callee-anomaly gate)

## Verdict

The `logicHttpJoint` mode — a topology gate that suppresses the framework-HTTP
half of the log signal for a service whose callee is MORE anomalous — is
**falsified**. It over-corrects the 15-case `logicHttp` regression so hard that
it forfeits most of the +30pp gain:

| mode               | Top@1     | vs count | vs logicHttp |
| ------------------ | --------- | -------- | ------------ |
| `count` (baseline) | 16.5%     | —        | −30.0pp      |
| `logicHttp`        | **46.5%** | +30.0pp  | —            |
| `logicHttpJoint`   | 27.1%     | +10.6pp  | **−19.4pp**  |

`logicHttpJoint` recovers ~11 of the 15 regressed cases but loses **~98**
replace-code cases (`HTTPResponseReplaceCode` 69.7% → 27.3%), for a net
**−276 correct cases** vs `logicHttp` (661 → 385). The gate is a net negative.

## Root cause — rank-normalised anomaly defeats the relative comparison

The gate's predicate is `callee.anomaly > emitter.anomaly` (relative). But the
`anomalyScores` fed to the joint context are **rank-normalised**
(`rankNormalization=true` on TrainTicket's 50-service topologies), so the score
is the service's rank position `i/(n−1)`, evenly spaced in [0, 1] — NOT an
absolute deviation magnitude.

In a replace-code case the cascade raises _every_ service's latency, so the
source's callees often sit HIGHER in the rank than the source itself:

```
replace-code 4vn4gg (GT=ts-basic-service):
  ts-train-service  [#1] selfAnomaly=1.000   (rank 1)
  ts-config-service [#2] selfAnomaly=0.980   (rank 2)
  ts-food-service   [#3] selfAnomaly=0.959   (rank 3)
  ts-basic-service  [GT] selfAnomaly=0.878   (rank 8)  ← the SOURCE
  mysql                    selfAnomaly=0.184  (rank 41, healthy callee)
```

`basic-service` (the source) floods 1560 `HttpServerErrorException` lines but
sits at rank #8, below several of its own callees (`config`/`food`). The gate
reads "a more-anomalous callee exists → basic is a victim" and suppresses the
very signal that lifts the replace-code type. The rank position is a symptom of
the cascade, not evidence about who broke whom.

## Corrected understanding of the 15-case `logicHttp` regression

The 25-case regression diagnostic (run 34471223487, `log_mode=logicHttp`)
shows the source-silent regressions split into TWO distinct mechanisms, not the
single "framework-HTTP victim" mechanism the joint gate assumed:

1. **Metric-rank loss (not a log-signal regression).** In the sampled
   `JVMMemoryStress` cases the silent source is NOT rank #1 (e.g.
   `ts-auth-service` at 0.980 loses to `ts-consign-service` at 1.000), and the
   victims flood AMQP/business text — which `logicHttp` already excludes. The
   log signal is EMPTY (identical under `count` and `logicHttp`), so these
   cases are wrong under BOTH modes: they are a _metric_ ceiling, not a
   framework-HTTP misfire. The joint gate cannot fix them and should not try.

2. **Framework-HTTP victim (the true log-signal regression).** The remaining
   source-silent regressions are cases where a victim DOES flood a
   framework-HTTP exception (`HttpServerErrorException`/`ResourceAccessException`)
   while the source stays silent. These are the cases the gate must separate
   from the replace-code source, but with a discriminator that survives rank
   normalisation — an **absolute** callee anomaly, not a relative rank.

## Why the direction is genuinely symmetric

`HttpServerErrorException` ("received a 5xx from a downstream dependency") and
`ResourceAccessException` ("could not reach a downstream dependency") are
DIRECTION-SYMMETRIC by construction:

- replace-code source: its own downstream calls return the replaced 5xx, so it
  floods the exception (10–16× the victim rate — a _dominant_ emitter).
- source-silent victim: it calls the broken source, which returns 5xx/timeouts,
  so it floods the SAME exception (a _spread_ cascade across many callers).

The distinguishing feature is not "which service is more anomalous" but "is the
framework-HTTP flood CONCENTRATED on one emitter (source) or SPREAD across many
callers (cascade)". A rank-based callee comparison cannot see this; an absolute
callee anomaly or an emitter-dominance ratio can.

## Next step

Add a per-service framework-HTTP exception COUNT to the diagnostic (currently
it reports only DISTINCT exception classes), re-run the diagnostic over ALL
cases of the three source-silent types (`JVMMemoryStress`/`ContainerKill`/
`NetworkBandwidth`), and read back the framework-HTTP count distribution to
select the discriminator: absolute callee-anomaly threshold vs emitter-dominance
ratio. The joint gate stays OFF until the discriminator is ablated zero-regression.
