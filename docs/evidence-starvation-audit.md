# The 74 misses that need new evidence: what they are starved of, and why the one channel that carries them cannot be scoped to them

**Status:** measured, and the direction is CLOSED. **Instruments:** `.git/probe_evidence_46.ts`,
`.git/probe_onset_46.ts`, `.git/probe_proxy_46.ts` (probes; no shipped code changed).

The register frames the remaining headroom precisely: of **666 misses** at the shipped configuration, **74
(11.1%)** have the winner strictly ahead on the metric, the log AND the latency, so no non-negative reweighting
can put the source first — those need new EVIDENCE. The other 592 are individually reachable by reweighting.
Until now the 74 have been COUNTED and labelled (`metric+log+lat`); nothing had said what they are starved OF.

Everything below is read from `dump-35035314921.txt` with the repository's own reader (`parseDiagnosticDump`)
and its own classifier (`classifyMiss`). **The register's numbers reproduce exactly**: 1,422 cases, 666 misses,
and the attribution tally (`metric` 261, `log` 109, `metric+log` 106, **`metric+log+lat` 73**, `metric+lat` 50,
`log+lat` 21, …), with `metric+log+lat+pool` supplying the 74th.

---

## 1. The asymmetry is total, and it is not a matter of degree

Per side, out of the 74:

| channel | source carries it | winner carries it |
| --- | --- | --- |
| error text (`err + fatal > 0`) | **4 / 74** | **74 / 74** |
| a latency rise (`latRise > 0`) | **22 / 74** | **74 / 74** |
| failed-edge records (`failedEdgeRecords > 0`) | **2 / 74** | **74 / 74** |
| an onset (`onsetDelayMs` rendered) | **74 / 74** | 73 / 74 |

And the magnitudes are uniformly against the source, not mixed: on these cases `latRise` is higher for the
source in **0** and lower in **74**; `err + fatal` is higher for the source in **1** and lower in **73**.

**The engine is not misweighting these cases. Every channel it has is telling it, in all 74 cases, that the
winner is the cause.** That is the sharpest form the documented "silent source" reading has taken: `4/74`,
`22/74`, `2/74` against `74/74`, `74/74`, `74/74`.

Their fault types are dominated by network faults — `NetworkPartition` 18, `NetworkBandwidth` 17,
`NetworkCorrupt` 9, `NetworkLoss` 7 = **51 of 74 (69%)** — with `PodFailure` 9 and `JVMMemoryStress` 7.

## 2. The only channel that DOES carry the source separates — but only inside the label's population

`onsetDelayMs` is the dump's only TIME; every other per-service field is a magnitude. Paired, source against
the winner it lost to:

| population | n | source earlier | later | tie | AUC |
| --- | --- | --- | --- | --- | --- |
| **starved (the 74)** | 74 | **60** | **13** | 0 | **0.822** |
| the other 592 misses | 592 | 288 | 257 | 13 | 0.528 |
| all misses | 666 | 348 | 270 | 13 | 0.562 |

**0.822 inside the 74 against 0.528 outside it** is exactly the shape the register asks for — a population
where a context feature separates, and a control showing it does not separate globally. It is also the
independent confirmation of why the temporal lever is capped: a GLOBAL onset weight is a coin flip (0.528), and
the register already measured that the golden caps it at `0.004717`, below the `0.010257` at which FSE'26 gains
anything.

## 3. And then the population turns out not to be deployable, which closes the direction

`classifyMiss` compares the SOURCE — the ground truth — to the winner. So "the 74" is a LABEL-defined set, and
a deployment does not know the source. AUC 0.822 inside it is therefore not yet a candidate. Three LABEL-FREE
proxies were tested for whether they reproduce it, each with the onset's separation measured inside it:

| label-free proxy | selected | of which starved | precision | onset inside it |
| --- | --- | --- | --- | --- |
| the engine's own top-1 leads its own runner-up on all three terms | 131 | 14 | **0.107** | **28–26, AUC 0.508** |
| no service in the case carries error evidence | **0** | 0 | — | — |
| the winner itself carries no error evidence | 317 | **0** | 0.000 | 155–97, AUC 0.596 |

**The separation does not survive any of them.** The rank-level proxy — the only one that selects anything like
the right size — keeps **14 of 74** and its onset reads **0.508, a coin flip**, i.e. the 0.822 is a property of
"the cases whose source happens to sit behind on all three magnitudes" and not of any condition a deployment
can evaluate. And `no error evidence anywhere` selects **zero** cases, which is itself the finding: the winner
carries error evidence in all 74, so that condition can never hold when a case is starved.

**Conclusion, and it is a closure rather than a candidate.** The 74 need evidence that is **not a magnitude**.
The only non-magnitude channel the artifact records is `onset`, it is present for the source in **74 of 74**,
and it separates **60–13** inside the population the register named — but the population is **not recognisable
without the label**, so a per-population temporal prior cannot be scoped to it, and a global one is a coin flip
(0.528). That is the same reason the register gives for the lever being closed, arrived at from the other end:
it is not that the onset is weak, it is that **the cases where it is strong cannot be told apart from the cases
where it is worthless until the case is scored against an answer.**

## 4. What this does NOT say, and one correction to the instrument's own output

It does not say the 74 are unreachable — they are the cases that need evidence this artifact does not carry,
and a second artifact (the RCAEval half's traces, which iteration 43 gave a direction channel) is a different
question that this census does not answer. It also does not re-open anything: `onsetEarliness` and the temporal
pair remain as their own rows record them.

**And a correction to this iteration's own instrument, recorded because it is the failure mode this repository
audits.** The proxy probe's two combination rows were labelled the wrong way round — the `||` row read
`BOTH of the first two` and the `&&` row `EITHER` — so the first run printed a `BOTH` row with 131 selected and
an `EITHER` row with 0. Both were corrected before any of the numbers above were written down. The two
conditions select 131 and 0 respectively, and the conclusion does not depend on their names; it would have
depended on them if the table had been copied from the first run.
