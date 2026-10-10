# Why `logicHttp` loses 41 of the cases it wins

> Scope: attribute the 41 regressions of the `logicHttp` log-signal mode — 8 of
> the 25 fault types — and decide whether a direction gate can recover them
> without giving back the 386 it gains. **Diagnosis first: no mode is added here.**
> Three direction gates are already falsified by measurement
> (`logicHttpJoint` −19.4pp, `logicHttpDominant`, `all`), so a fourth needs
> evidence, not a plausible mechanism.

## The set to explain

From the two full runs of 2026-09-11 on one commit and one provenance-verified
cache (34604105028 `logicHttp` 47.3%, 34604119657 `count` 23.1%):

| fault type | `count` | `logicHttp` | Δ |
|---|---|---|---|
| HTTPResponseReplaceCode | 11/231 | **159/231** | +148 |
| HTTPRequestReplaceMethod | 52/190 | **123/190** | +71 |
| HTTPRequestAbort | 7/60 | **47/60** | +40 |
| HTTPRequestReplacePath | 1/39 | **38/39** | +37 |
| HTTPResponseAbort | 1/44 | **34/44** | +33 |
| HTTPResponseDelay | 12/89 | **42/89** | +30 |
| HTTPRequestDelay | 13/88 | **39/88** | +26 |
| HTTPResponsePatchBody | 2/4 | 3/4 | +1 |
| *8 more types* | | | 0 |
| JVMMemoryStress | 13/171 | 4/171 | **−9** |
| NetworkPartition | 47/97 | 39/97 | **−8** |
| NetworkBandwidth | 18/42 | 12/42 | **−6** |
| NetworkLoss | 17/48 | 12/48 | **−5** |
| HTTPResponseReplaceBody | 50/51 | 45/51 | **−5** |
| JVMException | 34/43 | 30/43 | **−4** |
| NetworkCorrupt | 17/46 | 14/46 | **−3** |
| ContainerKill | 2/89 | 1/89 | **−1** |

Net **+345** (+386 gained, −41 lost). The gains are all HTTP-request-side types;
the losses are the resource / network / kill types plus one HTTP type.

## What the shipped code does

`packages/tree/src/pruning/ranking-signals.ts`, `computeLogScores`, in
`logicHttp`:

- **Level 1** (`isSourceSignature`) admits a line if it is a self-caused logic
  exception **or** a framework HTTP exception. Both are treated as source
  signatures.
- **Level 2** (`isSuppressed`) is `false` for every line in this mode, because
  only `logicHttpJoint` and `logicHttpDominant` implement a direction gate.
- The denominator is the level-1 maximum, so the signal is the emitter's share of
  the admitted flood.

So in this mode the score is "who emitted the most logic-or-framework-HTTP
exceptions, after the injection time". The mechanism under test is that this
measure is **direction-symmetric**: a framework HTTP exception means "a call I
made failed", which is emitted by the source when its own outgoing calls break
and by the caller when the callee breaks. If the silent-source types put the
flood on the caller, the argument surfaces: the source emits nothing, the caller
emits hundreds, the caller takes rank 1, and `count` — which does not admit
framework HTTP at all — could not lose the case that way.

## How the evidence is produced

Two CI runs, same commit, same cache, same case set, **only the mode differs**,
each dumping a per-service signal inventory for the 41 affected cases and for
`HTTPResponseReplaceCode` as a control:

    tsx benchmarks/src/run-fse26.ts --log-mode count     --diagnose <9 types> --diagnose-limit 0
    tsx benchmarks/src/run-fse26.ts --log-mode logicHttp --diagnose <9 types> --diagnose-limit 0

then

    tsx benchmarks/src/analyze-fse26-diagnose.ts --before <count-dump> --after <logicHttp-dump>

which pairs the dumps by datapack, classifies every case as regressed / gained /
unchanged, and for each regression prints the ground-truth service's and the
winning service's `http`, `logic` and `selfAnomaly` side by side, with the
per-case verdict on the claim "the winner out-floods a source that emits no
framework HTTP at all".

Two things make this trustworthy rather than merely convenient:

- **The dump reproduces CI exactly.** The `logicHttp` dump parsed to 818 blocks,
  and all nine diagnosed fault types matched the published per-type counts to the
  case (ReplaceCode 159/231, JVMMemoryStress 4/171, NetworkPartition 39/97,
  ContainerKill 1/89, ReplaceBody 45/51, NetworkLoss 12/48, NetworkCorrupt 14/46,
  JVMException 30/43, NetworkBandwidth 12/42). Without this check a dump read
  locally cannot be attributed to the number it is supposed to explain.
- **The dump names its own mode.** `DIAG … services=N logMode=logicHttp`. This is
  not decoration: the `logic`/`http` counts it prints are gated by the mode, and
  the two runs have to be distinguishable. The first attempt at this comparison
  failed precisely there, in two independent ways — see below.

## Two defects found while building the evidence

Both are recorded in full at `docs/fse26-result-attribution.md` and in the commit
messages; they belong here because each one, uncorrected, would have produced a
confident wrong answer to the question above.

1. **`--log-mode count` silently ran `logicHttp`.** The accepted-mode set was a
   hand-written `||` chain that had lost `count` when the default was flipped, so
   the value matched nothing and fell back to `logicHttp`. Dispatching `count`
   ran `logicHttp` and reported 47.3% for a configuration nobody chose. It was
   caught only because the two dumps came back byte-identical — a comparison
   between two identical things is not a comparison. Fixed structurally: the
   accepted set is now a `Record<LogSignalMode, true>`, and the guard asserts that
   every mode with a recorded measurement is dispatchable.
2. **A truncated artifact download leaves the previous run's archive in place.**
   The downloader wrote to a fixed path, so a `curl` failure (exit 18) left the
   earlier archive and the reader attributed it to the new run — which is what
   made the two dumps look identical in the first place. Now namespaced by run id
   and verified as a zip before use, with a non-zero exit on failure.

The generalisable pair: **an artifact must carry what produced it** (mode in the
dump, configuration in the JSON result), and **a reader must be able to tell two
artifacts apart** (per-run filenames, verified downloads). Either omission turns
a measurement into an assertion.

## Findings

Command: `--before` = the `count` dump (run 34679583391), `--after` = the
`logicHttp` dump (run 34678188226). 818 cases are diagnosed (the 8 regressed types
plus `HTTPResponseReplaceCode` as a control); the runs differ in nothing else.

    cases compared: 818   regressed: 57   gained: 164
    unchanged-correct: 152   unchanged-wrong: 445

Three results, in order of how much they constrain a fix.

### 1. In all 57 regressions the new winner had NO log signal under `count`

| quantity | count |
|---|---|
| winner's logic-exception lines == 0 | **57 / 57** |
| winner's framework-HTTP lines > 0 | 57 / 57 |
| source's framework-HTTP lines == 0 | 51 / 57 |
| winner out-floods a source that emits none | 51 / 57 |

Whether a line counts as a *logic* exception is a property of the line, not of the
mode, so a winner with zero of them scores 0 under `count` and a positive number
under `logicHttp`. That is the necessary condition, and it holds for every single
regression: **the mode does not re-weight the case, it introduces a signal where
there was none**, and the new signal is enough to take rank 1.

### 2. The signal needed to flip a case is tiny

Winner's framework-HTTP line count:

| lines | 1 | 2–4 | 5–9 | 10–19 | 20–49 | 50–99 | ≥100 |
|---|---|---|---|---|---|---|---|
| cases | 5 | 3 | 13 | 18 | 8 | 4 | 6 |

**Five cases flip on a single line.** The mode is weight-1.0 additive against a
margin that is frequently under one score unit, so there is no threshold to tune:
the distribution starts at 1.

### 3. The mechanism is not "the victim floods"

`logicHttp` was hypothesised to regress these types by rewarding the VICTIM:
the faulting service emits no exception of its own, its callers observe the broken
calls and flood `HttpServerErrorException`, and the caller's count exceeds the
source's. That is confirmed for 51 of 57 cases, but it is **not** what makes them
regress — the 6 cases it does not fit show why:

| datapack | type | source http/logic | winner http/logic | source selfAnomaly | winner selfAnomaly |
|---|---|---|---|---|---|
| ts4-…-response-replace-body-jbn747 | HTTPResponseReplaceBody | 26/23 | 27/0 | 0.640 | 0.940 |
| ts4-…-response-replace-body-wpxp9b | HTTPResponseReplaceBody | **269**/265 | 192/0 | 0.340 | 0.940 |
| ts4-…-response-replace-body-bfsdhx | HTTPResponseReplaceBody | 89/85 | 91/0 | 0.620 | 0.760 |
| ts5-…-response-replace-body-cjm68r | HTTPResponseReplaceBody | 119/118 | 119/0 | 0.770 | 0.800 |
| ts8-…-response-replace-body-l4k72c | HTTPResponseReplaceBody | 53/51 | 54/0 | 0.900 | 0.880 |
| ts7-…-partition-g88vxv | NetworkPartition | 5/0 | 5/0 | 0.900 | 0.940 |

In the ReplaceBody family the SOURCE is itself a framework-HTTP emitter (its own
outgoing calls see replaced bodies), so it is not "silent"; in one case it emits
**more** than the winner (269 vs 192) and still loses. And the winner's
`selfAnomaly` is higher than the source's in 4 of the 6. So the harm is not "the
victim out-emits the source" but the weaker, and much more general: **any service
that emitted framework HTTP and no logic exception receives a positive term it
did not have, and the ranking it lands on was decided by less than that term**.
The self-anomaly split confirms the margin: the source is already ahead on
self-anomaly in **25 of 57** cases, so in 25 cases the log term alone moved it.

## What this implies for a fix — and what it rules out

- **A threshold on the framework-HTTP count cannot work.** Five cases flip on one
  line, and the same quantity is what produces the 386 gains.
- **The log inventory alone cannot separate a source from a victim.** The winners
  of the 57 regressions and the sources of the `HTTPResponseReplaceCode` gains
  have the SAME inventory signature: framework HTTP lines, zero logic exceptions.
  Every mode that tried to gate on this inventory (`logicHttpJoint`'s
  "more-anomalous callee", `logicHttpDominant`'s concentration) is measuring a
  property that both sets share, which is why each was falsified by measurement
  rather than by argument.
- **This also explains `logicHttpJoint`'s failure quantitatively.** Its predicate
  fires when the emitter has a more-anomalous callee. That condition is false for
  exactly the cases that need it: the victim's `selfAnomaly` EXCEEDS the source's
  in 32 of 57, so "callee more anomalous than me" does not hold. The predicate is
  orthogonal to the harm, and it additionally suppressed legitimate replace-code
  sources (hence the −19.4pp).
- **The missing information is direction, and the dump does not carry it.** The
  relation that would separate the two sets is which service the emitter's FAILING
  CALLS point at, and whether that callee is in the anomalous set — the
  `HTTPResponseReplaceCode` source's failing calls point at healthy callees, the
  victim's point at the faulting source. No field in the current `DIAG` block
  records that.

**Next diagnostic, not next patch:** extend the diagnostic dump with per-service
edge provenance (for each emitter, the callees its failing calls target) and
re-run this same 818-case comparison. The question to answer is whether "the
emitter's failing calls target a service in the anomalous set" separates the 57
regressions from the ~148 `HTTPResponseReplaceCode` gains. If it does not, the
direction hypothesis is dead too and the 41 net cases are the price of the 386.

## Appendix — the 57 regressions, as measured

Re-run with `tsx benchmarks/src/analyze-fse26-diagnose.ts --before <count-dump>
--after <logicHttp-dump>`; this is its verbatim output for the two runs above.

```text
Regressions (57) — source vs the service that took rank 1:
  datapack                             faultType            GT              top1(before→after)             src http/logic  win http/logic  out-flooded
  ts0-mysql-corrupt-jkgn5j             NetworkCorrupt       mysql           ts-order-service→ts-seat-service 0/0             5/0             YES
  ts0-mysql-corrupt-kwx8n5             NetworkCorrupt       mysql           ts-station-service→ts-basic-service 0/0             18/0            YES
  ts0-mysql-loss-67k278                NetworkLoss          mysql           ts-train-service→ts-travel-plan-service 0/0             1/0             YES
  ts0-mysql-loss-k9xrkf                NetworkLoss          mysql           ts-travel-service→ts-preserve-service 0/0             1/0             YES
  ts0-mysql-partition-5pf26g           NetworkPartition     mysql           ts-order-other-service→ts-seat-service 0/0             5/0             YES
  ts0-mysql-partition-jh4jkt           NetworkPartition     mysql           ts-train-service→ts-travel-plan-service 0/0             3/0             YES
  ts0-mysql-partition-k9q6lq           NetworkPartition     mysql           ts-train-service→ts-basic-service 0/0             5/0             YES
  ts0-ts-config-service-corrupt-qjwhfb NetworkCorrupt       ts-config-service ts-config-service→ts-seat-service 0/0             18/0            YES
  ts0-ts-order-service-stress-64c8cv   JVMMemoryStress      ts-order-service ts-order-service→ts-seat-service 0/0             46/0            YES
  ts0-ts-payment-service-stress-56jvjc JVMMemoryStress      ts-payment-service ts-payment-service→ts-inside-payment-service 0/0             20/0            YES
  ts0-ts-train-service-corrupt-gkddzp  NetworkCorrupt       ts-train-service ts-train-service→ts-travel-plan-service 0/0             9/0             YES
  ts1-mysql-corrupt-66nt6d             NetworkCorrupt       mysql           ts-station-food-service→ts-food-service 0/0             15/0            YES
  ts1-ts-route-plan-service-exception-jc7cxv JVMException         ts-route-plan-service ts-route-plan-service→ts-travel-plan-service 0/0             128/0           YES
  ts2-mysql-bandwidth-bbk2d4           NetworkBandwidth     mysql           ts-station-service→ts-basic-service 0/0             18/0            YES
  ts2-mysql-bandwidth-fws9rx           NetworkBandwidth     mysql           ts-travel2-service→ts-route-plan-service 0/0             9/0             YES
  ts2-mysql-bandwidth-jlzd96           NetworkBandwidth     mysql           ts-config-service→ts-seat-service 0/0             18/0            YES
  ts2-mysql-partition-995nz4           NetworkPartition     mysql           ts-config-service→ts-seat-service 0/0             18/0            YES
  ts2-mysql-partition-thlr8h           NetworkPartition     mysql           ts-station-food-service→ts-food-service 0/0             17/0            YES
  ts2-ts-order-service-stress-967z6d   JVMMemoryStress      ts-order-service ts-order-service→ts-seat-service 0/0             47/0            YES
  ts2-ts-order-service-stress-jfmrnw   JVMMemoryStress      ts-order-service ts-order-service→ts-seat-service 0/0             31/0            YES
  ts2-ts-station-service-partition-vr7btm NetworkPartition     ts-station-service ts-station-service→ts-basic-service 0/0             18/0            YES
  ts2-ts-train-service-loss-j2w694     NetworkLoss          ts-train-service ts-train-service→ts-basic-service 0/0             10/0            YES
  ts2-ts-train-service-partition-lb8gv4 NetworkPartition     ts-train-service ts-train-service→ts-travel-plan-service 0/0             7/0             YES
  ts2-ts-user-service-stress-dgfnzl    JVMMemoryStress      ts-user-service ts-user-service→ts-preserve-service 0/0             1/0             YES
  ts3-mysql-partition-w2m4gr           NetworkPartition     mysql           ts-station-service→ts-basic-service 0/0             18/0            YES
  ts3-mysql-partition-xgmtkl           NetworkPartition     mysql           ts-station-service→ts-basic-service 0/0             18/0            YES
  ts3-ts-config-service-container-kill-52d5j7 ContainerKill        ts-config-service ts-config-service→ts-seat-service 0/0             131/0           YES
  ts3-ts-config-service-corrupt-rvz9sf NetworkCorrupt       ts-config-service ts-config-service→ts-seat-service 0/0             17/0            YES
  ts3-ts-contacts-service-loss-cdzjg5  NetworkLoss          ts-contacts-service ts-contacts-service→ts-preserve-service 0/0             1/0             YES
  ts3-ts-order-other-service-loss-5ldf2c NetworkLoss          ts-order-other-service ts-order-other-service→ts-seat-service 0/0             2/0             YES
  ts3-ts-train-service-partition-r58pxm NetworkPartition     ts-train-service ts-train-service→ts-basic-service 0/0             4/0             YES
  ts3-ts-travel-service-loss-dpcd4n    NetworkLoss          ts-travel-service ts-travel-service→ts-travel-plan-service 0/0             11/0            YES
  ts4-mysql-bandwidth-kplll7           NetworkBandwidth     mysql           ts-train-food-service→ts-food-service 0/0             19/0            YES
  ts4-mysql-corrupt-kgjmhg             NetworkCorrupt       mysql           ts-train-service→ts-basic-service 0/0             9/0             YES
  ts4-mysql-partition-2757fv           NetworkPartition     mysql           ts-train-food-service→ts-food-service 0/0             20/0            YES
  ts4-mysql-partition-7rd6jh           NetworkPartition     mysql           ts-station-food-service→ts-food-service 0/0             20/0            YES
  ts4-ts-basic-service-response-replace-body-jbn747 HTTPResponseReplaceBody ts-basic-service ts-basic-service→ts-travel-service 26/23           27/0            no
  ts4-ts-basic-service-response-replace-body-wpxp9b HTTPResponseReplaceBody ts-basic-service ts-basic-service→ts-travel-service 269/265         192/0           no
  ts4-ts-consign-price-service-stress-98g97q JVMMemoryStress      ts-consign-price-service ts-consign-price-service→ts-consign-service 0/0             9/0             YES
  ts4-ts-route-plan-service-response-replace-body-bfsdhx HTTPResponseReplaceBody ts-route-plan-service ts-route-plan-service→ts-travel-plan-service 89/85           91/0            no
  ts4-ts-security-service-stress-2q5qsb JVMMemoryStress      ts-security-service ts-security-service→ts-preserve-service 0/0             39/0            YES
  ts5-mysql-bandwidth-2ctlcv           NetworkBandwidth     mysql           ts-train-service→ts-route-plan-service 0/0             8/0             YES
  ts5-mysql-bandwidth-mt84s2           NetworkBandwidth     mysql           ts-train-service→ts-route-plan-service 0/0             10/0            YES
  ts5-mysql-loss-xck255                NetworkLoss          mysql           ts-order-other-service→ts-travel2-service 0/0             6/0             YES
  ts5-mysql-partition-rpgnbb           NetworkPartition     mysql           ts-travel2-service→ts-route-plan-service 0/0             10/0            YES
  ts5-ts-order-other-service-partition-7kf2j2 NetworkPartition     ts-order-other-service ts-order-other-service→ts-travel2-service 0/0             5/0             YES
  ts5-ts-order-service-exception-wtdxfx JVMException         ts-order-service ts-order-service→ts-preserve-service 0/119           119/0           YES
  ts5-ts-order-service-stress-8z9vgj   JVMMemoryStress      ts-order-service ts-order-service→ts-travel-service 0/0             68/0            YES
  ts5-ts-route-plan-service-exception-k9h7sr JVMException         ts-route-plan-service ts-route-plan-service→ts-travel-plan-service 0/79            79/0            YES
  ts5-ts-seat-service-response-replace-body-cjm68r HTTPResponseReplaceBody ts-seat-service ts-seat-service→ts-travel2-service 119/118         119/0           no
  ts5-ts-security-service-exception-kprxw5 JVMException         ts-security-service ts-security-service→ts-preserve-service 0/174           174/0           YES
  ts5-ts-security-service-partition-sq49d2 NetworkPartition     ts-security-service ts-security-service→ts-preserve-service 0/0             8/0             YES
  ts6-ts-price-service-partition-87jdxn NetworkPartition     ts-price-service ts-price-service→ts-basic-service 0/0             10/0            YES
  ts7-mysql-partition-5tkb2h           NetworkPartition     mysql           ts-order-service→ts-seat-service 0/0             1/0             YES
  ts7-ts-route-plan-service-partition-g88vxv NetworkPartition     ts-route-plan-service ts-travel-service→ts-travel-plan-service 5/0             5/0             no
  ts7-ts-seat-service-stress-tzxh2f    JVMMemoryStress      ts-seat-service ts-seat-service→ts-route-plan-service 0/0             17/0            YES
  ts8-ts-route-plan-service-response-replace-body-l4k72c HTTPResponseReplaceBody ts-route-plan-service ts-route-plan-service→ts-travel-plan-service 53/51           54/0            no

Mechanism 'the winner is a victim flooding framework HTTP while the source emits none': 51/57 regressions.
  6 regression(s) need a different explanation — see the rows marked 'no'.
```
