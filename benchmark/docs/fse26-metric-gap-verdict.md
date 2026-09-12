# FSE'26 — Metric-Gap Fix Verdict (P1c-metric readback)

> **Superseded in part — see `docs/fse26-metric-source-attribution.md` (P1c-abl).**
> The *numbers* below are correct and reproduced exactly by the later ablation. But
> §3's mechanism (victim-outranks-silent-source from trace-derived error rate) is
> **falsified**: the Network gains come from the **histogram `.max` peak** source, and
> the losses came from a **data-integrity defect** in `read_metrics` that was
> interleaving each metric's label fan-out into a synthetic sawtooth. With that
> defect fixed the benchmark goes 18.85% → 23.07% Top@1 (one regressed case), so §4's
> "the metric lever is exhausted / the source-silent ceiling is unchanged" also does
> not hold.

> Empirical readback of the derived-metric converter fix (`b811812` + `070f84f`) on
> the full 1422-case RCABench. **Net positive, direction-asymmetric** — the headline
> is a real +2.3pp, but the per-type split is the actual finding.

## 1. Headline (all-default inputs, reproduces the 16.5% baseline settings)

| metric | old (16.5%) | new (derived metrics) | Δ |
|---|---|---|---|
| Top@1 | 16.526% | **18.847%** | **+2.32pp** |
| Top@3 | 26.301% | 28.9% | +2.6pp |
| Top@5 | 34.740% | 39.0% | +4.3pp |
| Δ vs SOTA avg | −4.47pp | **−2.15pp** | narrowed 2.32pp |

Runs: old `34437225429` (head `fa8210e`), new `34501679949` (head `070f84f`).
Both clean: `loadErrors=0 engineErrors=0 emptyGraphs=0`. Case count 1422 both.
`logWeight=1 logMode=count rankNormalization=true` both.

## 2. Per-fault-type delta (exact correct counts)

Sorted by Δ. `+` = the added metrics helped, `−` = they hurt.

| fault type | old | new | Δ | total |
|---|---|---|---|---|
| NetworkPartition | 9 | 45 | **+36** | 97 |
| NetworkCorrupt | 5 | 16 | **+11** | 46 |
| NetworkLoss | 8 | 18 | **+10** | 48 |
| NetworkBandwidth | 4 | 13 | **+9** | 42 |
| NetworkDelay | 8 | 14 | **+6** | 21 |
| JVMReturn | 11 | 12 | +1 | 21 |
| HTTPResponsePatchBody | 1 | 2 | +1 | 4 |
| HTTPRequestDelay | 3 | 4 | +1 | 88 |
| HTTPResponseReplaceBody | 50 | 50 | 0 | 51 |
| TimeSkew / JVMMySQLLatency / DNSRandom | 0 | 0 | 0 | 2/2/1 |
| JVMException | 33 | 32 | −1 | 43 |
| PodKill | 1 | 0 | −1 | 10 |
| JVMCPUStress | 1 | 0 | −1 | 2 |
| HTTPResponseAbort | 3 | 1 | −2 | 44 |
| HTTPResponseDelay | 3 | 1 | −2 | 89 |
| PodFailure | 2 | 0 | −2 | 24 |
| JVMLatency | 2 | 0 | −2 | 7 |
| HTTPRequestReplaceMethod | 49 | 46 | −3 | 190 |
| JVMMemoryStress | 12 | 8 | −4 | 171 |
| HTTPRequestReplacePath | 4 | 0 | −4 | 39 |
| ContainerKill | 6 | 1 | −5 | 89 |
| HTTPResponseReplaceCode | 11 | 4 | −7 | 231 |
| HTTPRequestAbort | 9 | 1 | −8 | 60 |

**Totals: gains +75, losses −42, net +33.** (268 correct vs 235.)

## 3. The finding: direction-asymmetric interface signal

The gains and losses are **the same class of fault on opposite sides of one axis**:

- **Network faults (source = the error/latency emitter)** gained +75. The source's
  `http.response.error_rate` / `http.server.request.duration` (trace-derived) were
  previously dropped; restoring them makes the *source* rank #1.
- **Source-silent faults (JVMMemoryStress, ContainerKill, HTTPResponseReplaceCode,
  HTTPRequestAbort, PodFailure, ...)** lost −42. Here the *source* does not emit the
  error/latency — its **victims do** (they fail against a down/slow source). Restoring
  the same `http.response.error_rate` / `http.server.request.duration` therefore lifts
  the **victim** above the source.

This is the **metric-side twin of the falsified `logicHttp`** (framework-HTTP log
discriminator, `docs/fse26-framework-http-direction-verdict.md`): an interface error
signal is direction-ambiguous. It cannot distinguish "source emitting errors" from
"victim emitting errors" without a topology/callee-aware gate — and the log-side gate
(`logicHttpJoint`) was falsified because rank normalization defeats the relative
callee comparison.

### The JVM histogram signature did not move its target

`jvm.gc.duration.max` / `jvm.memory.used.max` (histogram, correctly attributed after
`070f84f`) did **not** rescue JVMMemoryStress — it fell 12→8. The GC-thrash signature
is too weak to outrank a victim whose restored error-rate now spikes. The
`k8s.service.name` coalesce fix is *correct* (the series now exists and is attributed),
but the signal it exposes is below the ranking noise floor for the source-silent
topology.

## 4. Conclusion

1. **The converter fix is data-correct and net-positive (+2.32pp).** It is not a
   revert candidate: the dropped fields (`_metrics_sum`, `_metrics_histogram`,
   trace `duration`/`status_code`) are exactly what the platform reference analyzer
   consumes, and the full data lifts Top@1 from 16.5% to 18.8% (Δ vs SOTA avg
   −4.5pp → −2.2pp).
2. **It is NOT zero-regression.** Under the strict net-positive + zero-regression
   gate, it fails on 13 fault types (−42 cases), concentrated in the source-silent
   cohort this work set out to fix.
3. **The source-silent ceiling is unchanged.** JVMMemoryStress ≈5%, ContainerKill
   ≈1%, HTTPResponseReplaceCode ≈1.7% — the interface error signal is emitted by the
   *victim* for these faults, so restoring it cannot make the source rank #1. The
   deterministic ceiling for source-silent types stands (cf. `docs/silent-source-ceiling.md`).
4. **The metric lever is now exhausted for the same reason the log lever was**
   (direction-ambiguity), not because of a data gap. The remaining interface-signal
   question is whether a *component-wise ablation* (histogram-only vs trace-derived-only)
   can isolate a clean, zero-regression subset — flagged as P1c-abl, not yet run.

## 5. Next steps

- **P1c-abl (optional, decisive):** re-run the converter emitting (a) histogram only,
  (b) trace-derived only, to attribute the +75/−42 to specific sources. Two ~20min
  runs; requires a converter emission toggle + TDD.
- **Strategic:** the source-silent types now have two independent falsifications
  (log `logicHttp`, metric error-rate) pointing at the same wall — interface error
  signals are victim-emitted for silent sources. The remaining lever is not "more
  interface signals" but a fundamentally different evidence class for silent sources
  (see `docs/silent-source-ceiling.md`).
