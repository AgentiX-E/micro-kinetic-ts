# RE1/RE2 ceiling: the residual failures share RE3's structural root cause

## Motivation

All prior falsification work (drop/rise asymmetry, collision/ratioContrib
topology-dependence, temporal reverse, LLM code-level) was driven by RE3. This
document extends the ceiling characterization to RE1/RE2, whose residual
failures had never been systematically read. The failure diagnostics already
emitted by `run-rcaeval.ts` (per-case `dev`/`trend`/`cv`/`burst` breakdown,
`topoSource`, `ratioContrib`, `onset`/`injectDelay`, `Top-K`) contain everything
needed — no new dump was required; the readback is from the revert-confirm run
`34176635640` (head `3044b29f`, bit-identical golden baseline).

## Measurement scope

| Suite | Fault types | Golden AVERAGE | Residual headroom |
|---|---|---|---|
| OB RE1 | cpu/delay/disk/loss | 80.0% | 20.0% |
| SS RE1 | cpu/delay/disk/loss | 92.8% | 7.2% |
| TT RE1 | cpu/delay/disk | 68.0% | 32.0% |
| OB RE2 | cpu/delay/disk/loss | 82.4% | 17.6% |
| SS RE2 | cpu/delay/disk/loss | 88.9% | 11.1% |
| TT RE2 | cpu/delay/disk/loss | 68.1% | 31.9% |

## The uniform failure signature (observed across all three systems)

For essentially every RE1/RE2 failure, the ground-truth source is a fan-in
callee whose injected fault (cpu / delay / disk / loss) manifests as a *gentle*
metric change, while a downstream victim exhibits a *near-zero-baseline spike*
that wins the deviation race:

| Case | GT `dev` | GT `trend` | top1 `dev` | top1 `trend` | GT topoSource | top1 topoSource | onset |
|---|---|---|---|---|---|---|---|
| TT RE1 auth cpu_1 | 0.562 | 0.222 | 0.973 | 0.047 | 0.035 | 0.095 | later ✗ |
| TT RE1 train cpu_3 | 1.196 | 0.413 | 1.940 | 0.034 | 0.048 | 0.166 | later ✗ |
| TT RE1 auth delay_2 | 0.617 | 0.275 | 1.422 | 0.278 | 0.016 | 0.456 | later ✗ |
| TT RE1 auth disk_4 | 0.275 | 0.091 | (spike) | — | 0.077 | 0.151 | later ✗ |
| TT RE2 auth cpu_3 | 0.651 | 0.262 | 1.162 | 0.118 | **1.000** | **1.000** | later ✗ |
| TT RE2 order cpu_1 | 1.115 | 0.341 | 1.810 | 0.574 | 0.111 | 0.213 | later ✗ |
| TT RE2 auth loss_2 | 0.200 | 0.036 | 0.676 | 0.027 | **1.000** | 0.310 | later ✗ |
| OB RE1 currency cpu_1 | 1.402 | 0.542 | 1.878 | 0.533 | 0.000 | 0.000 | later ✗ |
| OB RE1 pcat delay_1 | 1.817 | 0.466 | 1.849 | 0.496 | 0.000 | **1.000** | tie |
| OB RE1 cart disk_3 | 0.793 | 0.285 | 1.062 | 0.000 | 0.597 | 0.637 | later ✗ |
| OB RE1 adsvc loss_2 | 0.717 | 0.000 | 0.769 | 0.000 | **0.989** | 0.295 | tie |

Three structural causes recur, identical to RE3:

### 1. Metric: drop/rise (near-zero-spike) asymmetry

The victim's `workload` (and sometimes `latency`) rises from a near-zero baseline
(`head=[0,0,0,0,0,0]`, `tail=[0.2..37]`), producing an unbounded `log10`-compressed
deviation (`dev` up to 1.94, `rise` 9×–86×). The source's fault raises its own
`latency` gently (`rise` 1.2×–3×, `dev` 0.2–1.4) or, for `loss` faults, almost
not at all (`dev` 0.20–0.32). The 5× gap is not bridgeable by any monotone
transform — same root cause as `docs/re3-fault-ceiling.md`.

### 2. Topology: `topoSource` direction is topology-dependent

`topoSource` is unstable across the same fault class:
- TT RE2 gives `GT=1.000 top1=1.000` (no discrimination — both are roots of a
  40-node subgraph after trace augmentation).
- TT RE1 gives `GT≈0.02–0.22 vs top1≈0.09–0.68` (reversed — the fan-in callee
  source is "explained" by its parent).
- OB RE1 `pcat delay_1` gives `GT=0.000 vs top1=1.000` (reversed), while
  `adsvc loss_2` gives `GT=0.989 vs top1=0.295` (correct).

A signal whose sign flips with topology cannot be a default on-signal — the same
conclusion that falsified `collision/ratioContrib` (direction 9).

### 3. Temporal: source later

Nearly every failure reports `onset ... (source later ✗)` or
`injectDelay ... (source later ✗)`. The victim's spike is detected before the
source's gentle rise, so "earliest onset = source" is inverted — the same
conclusion that falsified `temporalWeight` (direction 8).

## Why this is not a new lever

The one nominally promising signal is `trend`: in TT RE1 the source's `trend`
(0.22–0.43, monotonic latency rise) beats the victim's (0.00–0.28, burst), but
in TT RE2/OB RE1 the margin collapses or inverts (e.g. `order cpu_1` top1
`trend=0.574 > 0.341`; `pcat delay_1` top1 `0.496 > 0.466`). Raising `trend`'s
weight to flip the dev gap would need `trend` weighted ≈2.3× `dev` in RE1 while
simultaneously regressing RE2/RE3 where the margin is reversed. That is not a
robust signal; it is the same "no monotone transform bridges the gap" wall.

## Conclusion

RE1/RE2 residual failures are **not** a fresh frontier — they share RE3's exact
structural root cause (fan-in propagation amplification + drop/rise asymmetry +
topology-dependent direction + temporal reverse). Combined with
`re3-fault-ceiling.md` (metric) and `re3-log-ceiling.md` (log), the RCAEval
ceiling is now characterized on every axis of every suite: **~77.4% Top-1 is the
limit of the metric-agnostic, deterministic framework**. Closing the remaining
~11 points to a commercial multi-modal system requires architecture-level
decisions (domain knowledge, callee→caller propagation direction, or
multi-modal LLM) — all outside the current framework and each carrying a prior
falsification record.
