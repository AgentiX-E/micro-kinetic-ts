# FSE'26 `logicHttpJoint` — falsified (relative callee-anomaly gate)

## Correction (2026-09-11) — the recorded root cause is impossible

This doc's verdict stands: the mode was measured at 27.1% and is a net negative.
Its **explanation** does not. §"Root cause" attributes the −19.4 pp to
`rankNormalization` — "the score is the service's rank position `i/(n−1)`, NOT an
absolute deviation magnitude". That cannot be the mechanism.

`computeHttpVictimSet` evaluates exactly one thing: `calleeAnomaly >
emitterAnomaly`. Both rescales the builder ships are **strictly monotone**:

- min-max (`rankNormalization=false`) is strictly increasing, and
- `rankNormalizeScores` sorts then assigns the **average rank of each tie group**,
  so equal inputs map to equal outputs and ordered inputs keep their order.

A strictly monotone transform cannot change any strict inequality, and
`computeHttpVictimSet` reads nothing else. The victim set is therefore
**provably identical** under raw, min-max and rank inputs. Verified empirically
with the shipped implementation over 20,000 randomised orderings (0 mismatches)
and on the two documented topologies; the proof is kept as the invariance suite
in `packages/tree/__tests__/unit/ranking-signals.test.ts` and exported as the
`HttpSourceJointContext.anomalyScores` contract.

**What survives.** The §"Root cause" observation is real — in that replace-code
case the source (`ts-basic-service`) does sit below several of its own callees,
so the gate does flag it. But that shape is a property of the **raw** scores; rank
normalisation only displays it as "rank #8". Feeding the gate absolute deviations
instead of ranks is a **no-op**, so the two places this doc recommends "an
absolute callee anomaly" (below) are dead ends and must not be attempted.

**What was actually fixed** (same commit as this notice):
`computeLogScores` derived its max-normalisation denominator from the
**post-suppression** counts, so withdrawing the top emitter shrank the
denominator and **promoted a mid-tier emitter to 1.0** — a supposedly subtractive
gate could re-rank a case onto a service it had just rejected. The denominator is
now taken from the level-1 source-signature counts, making withdrawal monotone
(a suppressing mode can only lower a score, never raise one). The fix is inert
for `count`/`all`/`logicHttp`, which perform no suppression.

**Status of the real cause: open.** The leading candidate is now the predicate's
_shape_ rather than its input — "∃ any callee more anomalous" is existential over
the callee set, so on a dense cascade it approaches the whole graph. That needs
the diagnostic in §"Next step", not a code change.

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

## Root cause — ~~rank-normalised anomaly defeats the relative comparison~~ (superseded)

> **Superseded by the correction notice above.** The observation below is real
> (the source does sit below its own callees in that case); the _mechanism_ it
> attributes to `rankNormalization` is impossible, and the fix it implies —
> feeding absolute deviations — is a no-op. Kept for the record.

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
   from the replace-code source. The discriminator must NOT be "an absolute
   callee anomaly": that is provably the same predicate as the relative one (see
   the correction notice), so switching to deviations would change nothing.

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
callers (cascade)".

> **Both discriminators proposed here were then tested and rejected.**
> "An absolute callee anomaly" is the same predicate as the relative one
> (correction notice above) — a no-op. The emitter-dominance ratio was built as
> `logicHttpDominant` and diagnosed _before_ ablation: the victim flood in the
> source-silent types is itself concentrated ~70% of the time (dominance ≥ 0.5 on
> a high-traffic victim), so concentration carries no directional information
> either. See `docs/fse26-emitter-dominance-falsified.md`.

## Next step

Add a per-service framework-HTTP exception COUNT to the diagnostic (currently
it reports only DISTINCT exception classes), re-run the diagnostic over ALL
cases of the three source-silent types (`JVMMemoryStress`/`ContainerKill`/
`NetworkBandwidth`), and read back the framework-HTTP count distribution to
select the discriminator: absolute callee-anomaly threshold vs emitter-dominance
ratio. The joint gate stays OFF until the discriminator is ablated zero-regression.

> **Revised (2026-09-11).** "Absolute callee-anomaly threshold vs
> emitter-dominance ratio" is no longer the choice — the first is a no-op and the
> second is falsified (see the notices above). The diagnostic is still the right
> instrument, but the question it must answer is now: **how large is the victim
> set on a real case, and is the flagged set the source's callers or the whole
> graph?** `computeHttpVictimSet` is existential over a service's callees, so on a
> dense cascade the set can approach every node in the graph — which would make
> the gate indiscriminate regardless of how the scores are scaled. Measure that
> first (a flagged-fraction histogram per fault type); only then design a
> predicate. Also note the 27.1% figure predates the denominator fix, so any
> re-attempt must be re-measured, not compared against it.
