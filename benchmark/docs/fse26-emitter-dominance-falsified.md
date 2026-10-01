# FSE'26 `logicHttpDominant` — falsified before ablation (emitter-dominance ≠ source)

> **Correction (2026-09-10)**: this doc's source-silent evidence (Facts 1-3) is
> correct, but the _replace-code cross-check_ implied the source is also
> log-silent there — that was wrong. The diagnostic parser dropped every
> `[GT,#N]` service line, fabricating `gt_http=0` on the source-active side. The
> replace-code source actually floods framework-HTTP at 10-100x the source-silent
> victim and is the top emitter 94% of the time. See
> `docs/fse26-framework-http-direction-verdict.md` for the clean re-parse. The
> core verdict (concentration carries no directional information) is unchanged.

## Verdict

The emitter-dominance discriminator — the hypothesis that a framework-HTTP flood
is a SOURCE signature when it is CONCENTRATED on one emitter and a VICTIM
cascade when it is SPREAD — is **falsified** by the diagnostic readback of the
three source-silent fault types. It never reached ablation.

## Evidence — run 34482091814 (diagnose_limit=0, 302 cases)

The per-service framework-HTTP count (`http=N`) was added to the diagnostic and
dumped for every case of `JVMMemoryStress` (171), `ContainerKill` (89) and
`NetworkBandwidth` (42). Three facts emerge:

### 1. The GT source is ALWAYS log-silent

Across all 302 cases, the ground-truth service emits **zero** framework-HTTP
lines (`gt_http = 0`) and **zero** logic-exception lines (`gt_logic = 0`). The
memory-stressed / killed / bandwidth-limited source leaves NO exception trace;
the log signal — under `count`, `logicHttp`, or any framework-HTTP variant —
can never point at it.

### 2. The framework-HTTP flood is VICTIM-emitted

Every framework-HTTP flood in these types is emitted by the source's CALLERS
(services whose call to the broken source returned 5xx / failed to connect):

```
JVMMemoryStress ts0-ts-order-service-stress-64c8cv  GT=[ts-order-service]
  ts-seat-service [#1] selfAnomaly=1.000 logScore=1.000 http=46  ← victim
  ts-route-plan-service         http=2   ← victim
  ts-travel-plan-service        http=3   ← victim
  ts-travel-service             http=2   ← victim
  ts-order-service  [GT]        http=0   ← the silent source
```

The top emitter is always a high-fan-out mid-graph service (`ts-seat-service`,
`ts-basic-service`, `ts-travel-service`, `ts-consign-service`, `ts-food-service`,
`ts-route-plan-service`, …) whose many downstream calls all hit the broken
source.

### 3. The victim flood is often CONCENTRATED

`dominance = topEmitterHttpCount / totalHttpCount`:

| fault type       | http-active | concentrated (dom ≥ 0.5) | dominance med |
| ---------------- | ----------- | ------------------------ | ------------- |
| JVMMemoryStress  | 105 / 171   | 77 (73%)                 | 0.94          |
| ContainerKill    | 43 / 89     | 30 (70%)                 | 0.94          |
| NetworkBandwidth | 21 / 42     | 12 (57%)                 | 0.50          |

~70% of framework-HTTP floods are concentrated on a single **victim**. The
"concentrated = source, spread = victim" premise is therefore wrong: a
high-traffic victim dominates the flood just as a source would.

## Why this kills the discriminator, not just the threshold

Concentration is a property of the CASCADE, not the fault direction. Whether the
source floods (its own downstream calls fail) or the victims flood (their call
to the source fails), the framework-HTTP volume concentrates on whichever
service sits highest in the affected call path. No threshold on the dominance
ratio separates the two directions, because both are concentrated.

## Corrected conclusion — the framework-HTTP log signal is EXHAUSTED

Combined with `logicHttpJoint` (falsified — rank-normalised scores defeat the
relative callee comparison), all three log-signal discriminators are now closed:

1. `logicHttp` — +30.0pp on the HTTP category, but −15 cases in source-silent
   types where a victim floods the direction-symmetric exception.
2. `logicHttpJoint` — topology gate defeated by rank-normalisation (the
   replace-code source sits below its own callees).
3. `logicHttpDominant` — emitter-dominance gate defeated because the victim
   flood is itself concentrated.

The source-silent regression is a **metric ceiling**, not a log-signal misfire:
the source is log-silent, so no exception-based discriminator can recover it.
The 15-case regression cannot be removed by further log-signal engineering.

## Next step — P1c (metric re-convert), the real lever

The framework-HTTP signal's entire +30pp gain is confined to the HTTP category
(replace-code/delay), and it is harmless-but-useless elsewhere. The highest-value
remaining lever is the documented data gap (see docs/fse26-data-gap-verdict.md):
the converter drops `_metrics_sum` / `_metrics_histogram` (count/sum/min/max,
`jvm.gc`) and trace `duration` / `attr.http.response.status_code`, from which the
platform's reference analyzer derives `http.response.error_rate` and
`http.server.request.duration`. Extending the converter to consume those fields
and TDD-ing a latency/saturation metric signal is the path to the source-silent
types that the log signal cannot reach.
