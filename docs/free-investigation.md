# The table was the constraint, and the width was not the table

Iteration 315 priced the **width** of a reranker's presentation and found that every arm this project has run was
measured under a ceiling below the target. This iteration prices the second half of the same question — the
**shape** of the presentation — and runs the arm the width analysis implied, at a width where the ceiling finally
clears the leader.

The arm is reported in §3. The result is not the one the registration predicted, and the difference is the finding.

## 1. Two 2026 papers price the shape this repository has been using

`arXiv:2608.21310` (He's group, October 2026) runs ten framework–backbone configurations on RCABench and prints
Acc@1 per configuration. Four rows are enough:

| framework | backbone | Acc@1 | what it does |
| --- | --- | ---: | --- |
| OpsAgent | Qwen | **45.8 %** | **issues no telemetry queries of its own — reasons over a pre-extracted feature set** |
| OpenRCA | Qwen | 46.6 % | commits as soon as it can emit an answer |
| AIQ | Qwen | 77.6 % | open-ended, requeries telemetry as evidence emerges |
| ThinkDepth.ai | Sonnet | **90.0 %** | the same, with the strongest backbone |

Every arm in this repository is **OpsAgent's row**: a table of candidates, one row of features each, and a model
asked to choose. That is the row the paper measures last, and the paper names the mechanism — a prescription decides
where to look before the incident reveals what matters.

`RCAtlas` ("Free to Look, Free to Reason", 26 October 2026) reaches the same conclusion from the other side. On 90
validated cases drawn from eight public datasets, it compares three harnesses that prescribe none of the model's
calls against five published agents that prescribe between a tenth and all of them:

| method | prescribed-call ratio | PR@1 |
| --- | ---: | ---: |
| Codex CLI, writing its own shell and Python in the case folder | 0.00 | **77.2 %** |
| SQL agent (ReAct over DuckDB, 100 calls) | 0.00 | 72.8 % |
| one call over a rule-selected evidence package | 0.00 | 65.3 % |
| best published agent (FoA) | 0.51 | 53.3 % |
| NSigma (a statistical, non-LLM baseline) | — | 38.9 % |
| random | — | 5.5 % |

Two ablations in that paper are prices rather than claims: **a stronger model mainly buys reliability, more rounds
mainly buy aptitude, and reasoning effort buys a few points for up to seven times the runtime.** The paper's own
summary of the mechanism is the sentence this repository's ten refutations were circling: *an investigation that
stops asking is indistinguishable from one that cannot.*

## 2. What this repository has, and what it does not

`packages/ai/src/agent/` holds nine modules — `nomination`, `elimination`, `evidence`, `table`, `promotion`,
`fusion`, `hypothesis-space`, `budget`, `topology-brief` — and every one of them reads a **`table.ts`**. There is no
tool surface, no query, no round in which the model decides what to look at. That is not an oversight in any single
module; it is the shape of the whole layer, and it is OpsAgent's shape.

So the gap between 83.40 % and 90.0 % is not a gap in the model, and this iteration can now say what it is a gap in.

## 3. Arm W30: the width the ceiling analysis asked for

Registered in `preregistration-315.md` with five thresholds and five predictions, run at `--fingerprint-top-k 30`,
`deepseek-chat`, `--promotion off`, one pass over all 1 422 cases. The model's own ranking is the arm; the fusion
weights are reported beside it.

| arm | weight | Top@1 | cases moved |
| --- | ---: | ---: | ---: |
| engine (control, this dispatch) | 0.00 | **81.3 %** (1 156) | — |
| **model's own order (the arm)** | — | **81.08 % (1 153)** | **61** |
| rrf fusion | 0.10 | 81.0 % (1 152) | 26 |
| rrf fusion | 0.30 | 81.2 % (1 155) | 41 |
| rrf fusion | 1.00 | 81.1 % (1 153) | 50 |
| borda fusion | 1.00 | 81.1 % (1 153) | 48 |
| **oracle (engine ∪ arm)** | — | **94.5 %** | — |

The arm moves 61 cases and nets **−3**. The oracle says the information is there: on 94.5 % of cases either the
engine or the model names the truth first, and no weighting of the two recovers the choice.

### 3.1 The number the registration was really asking for

`preregistration-315.md` §3 says two readings come from one artifact, and the second one is the interesting one. On
the 1 422 cases:

| quantity | value |
| --- | ---: |
| engine correct | 1 156 |
| model correct | 1 153 |
| **repairs** (engine wrong, model right) | **29** |
| **breaks** (engine right, model wrong) | **32** |
| **repair precision** `29 / (29 + 32)` | **0.475** |
| headroom the width promised (cases the engine has wrong whose truth is inside 30) | 237 |

The precision the 90.02 % target needs at this width is **0.543** (§324.3). The arm delivers **0.475** — six point
eight percentage points short, and, critically, **above the 0.30 the pre-committed falsifier named**.

That distinction decides the next iteration. Before this run, the record said a model shown a feature table cannot
choose (`z = −9.26` on 5 335 claims, ten arms at 30–35 %). At width 30 it can: **29 of the 61 cases it moved it
moved correctly**, which is not chance and is not enough. So the layer is **not** closed by its own falsifier, and
the remaining gap is a precision gap of 0.068 rather than a capability gap.

### 3.2 Thresholds, adjudicated

| # | threshold | reading | verdict |
| --- | --- | --- | --- |
| B1 | Top@1 ≥ 1 216 | 1 153 | **fail** — and it is 3 below its own control, so the failure is not about the 30 cases between the two containment scopes |
| B2 | precision ≥ 0.55 | 0.475 | **fail**, but by 0.075 rather than by the margin the ten earlier arms implied |
| B3 | no family pays more than 5 net | ReplaceMethod **−7**, ResponseAbort **−6** | **fail** |
| B4 | ≤ ¥25, from the provider's own counts | 20 616 533 prompt + 28 267 completion tokens | **not established**: ¥41.46 at the list input price, ¥10.53 at the cache-hit price. The envelope was written against the ten earlier arms' ~2 k-token tables; a 30-wide table costs 14.5 k prompt tokens per case |
| B5 | the switch is honoured | `--agent` off reproduces the engine's own column; the configuration line names the width | **pass** |

The family table is worth reading beside B3, because it is where the precision goes:

| family | repairs | breaks | net |
| --- | ---: | ---: | ---: |
| `HTTPResponseReplaceCode` | 8 | — | **+8** |
| `JVMException` | 8 | — | **+8** |
| `HTTPResponseDelay` | 4 | 1 | +3 |
| `HTTPRequestDelay` | 2 | — | +2 |
| `NetworkLoss` | 2 | 6 | −4 |
| `NetworkPartition` | — | 4 | −4 |
| `HTTPRequestAbort` | — | 2 | −2 |
| `HTTPResponseAbort` | — | 6 | −6 |
| `HTTPRequestReplaceMethod` | — | 7 | **−7** |

The two families the failed-edge channel was built for split: `ReplaceCode` gains 8 and `ReplaceMethod` loses 7. That
is the register's recurring shape one more time, now at the level of the MODEL's decisions rather than a term's.

### 3.3 Two smaller readings

- **The model's list is a lossy read of the presentation.** The 30-wide ceiling is 95.57 % (1 359 cases); the model's
  own ordering contains the truth somewhere on **1 254 (88.19 %)**. It drops 105 cases the table carried before any
  choice is made — so a harness that asks the model to *rank* is paying twice: once for the table, once for the
  ranking.
- **The endpoint served `deepseek-flash`** for every one of the 1 422 requests that named `deepseek-chat`. That is
  the model `RCAtlas` calls DeepSeek V4.1 Flash, one of its three mid-tier models, where its SQL agent reads 72.8 %
  PR@1. The record now says which model produced every number, from the response rather than from the request.

## 4. The shape, built

`benchmarks/src/query-agent.ts` (100/96.52/100/100, 62 tests) is the surface §1 and §2 say is missing:

| tool | what the model gets |
| --- | --- |
| `TOOL services` | the case's service directory |
| `TOOL fleet` | every service ranked by its strongest rise, in **one** call, with the deepest collapses beside it (added in v2; §7) |
| `TOOL metric <service>` | that service's strongest metric rises against **its own** pre-injection baseline |
| `TOOL logs <service>` | its `ERROR`/`FATAL` lines after the injection, oldest first, with the first offset |
| `TOOL edges <service>` | callers, callees, and the latency either side of the injection on those edges |
| `TOOL failed` | the failing interfaces by callee, ordered by net rise |
| `ANSWER <service>` | the terminal act |

Four properties are asserted rather than trusted, because each one is a way a measurement could record something
that did not happen:

1. a directive the grammar does not admit is **not** a call — prose around a directive is tolerated, a malformed
   directive line is not;
2. a service the case does not carry is refused **by name**, never answered with an empty list, because an empty
   list teaches the model that a real service has no metrics;
3. the budget **stops** the loop instead of being consulted, and a refused call still costs the call — otherwise a
   model could mine free refusals;
4. an answer must resolve to a service the case contains, case-insensitively, and is recorded as the resolved id.

It deliberately does **not** show the engine's ranking. Seeding an investigation with the strongest prior in the
repository makes the arm a reranker of that prior, which is the shape already measured eleven times; seeding is a
separate arm with its own registration.

## 5. What the next reading will decide

The pilot runs 80 engine-misses and 80 engine-hits (`preregistration-316.md`), and it is registered before the
artifact exists. Three outcomes are pre-committed, and the middle one is the likely one:

| reading | consequence |
| --- | --- |
| precision ≥ 0.55 **and** the arm's Top@1 above the engine's on the sample | the query surface is the mechanism; scale to the full corpus and price the full arm |
| precision in 0.35…0.55 | the surface works and the free investigation is not yet better than the engine's order; the next lever is what the model is TOLD, not what it can ask |
| precision < 0.30 | the table was never the obstacle, and the remaining 6.6 pp goes back to the base term's definition |

The second row is where the two papers point: `RCAtlas`'s own ablation says a stronger model buys reliability and
more rounds buy aptitude, and its winning harnesses spend 100 calls per case against this arm's six.

## 6. The first pilot measured the wall, not the model

Run `44692141852`, `query_agent_sample=80` (80 engine-misses + 80 engine-hits), `deepseek-chat`, budget 6 rounds /
10 calls. The artifact is `query-agent.ndjson` and its own summary reads:

| quantity | value |
| --- | ---: |
| cases | 160 |
| **answered** | **5** |
| stops | `{"rounds": 155, "answered": 5}` |
| agent Top@1 | 4 |
| engine Top@1 on the same 160 | 80 |
| repairs / breaks | 2 / 78 |
| precision | **0.025** |
| tokens | 685 150 prompt + 6 507 completion = **¥1.42** |

**A precision computed over this artifact is not a reading of the model.** 155 of 160 investigations ended on the
round cap without naming a service at all; the harness scored those as breaks because the engine had been right.
The number measures one thing: the model spent every turn it had asking, and was never told the last turn was the
last. Median rounds is 6 and median calls 6 — the budget was consumed exactly, by every case, and the four correct
answers came from the two cases that happened to reach `ANSWER` on turn six.

The pre-registered predictions are therefore adjudicated by the artifact's SHAPE rather than by its score:

| # | prediction | reading | verdict |
| --- | --- | --- | --- |
| P1 | ≥ 90 % of investigations end on an answer rather than on the budget | **3.1 %** | **falsified** — and it is the instrument, not the arm |
| P2 | precision 0.35–0.55 | 0.025 | **not adjudicable**: 78 of 80 breaks are cases with no answer to be wrong |
| P3 | the arm beats the engine on the sample | 4 against 80 | **not adjudicable**, same reason |
| P4 | repairs land in `ReplaceCode` / `ReplaceMethod` / `JVM*`, breaks in the network families | — | **not adjudicable** |
| P5 | the falsifier: precision < 0.30 closes the axis | 0.025 | **NOT TRIGGERED** — a falsifier cannot be fired by a run that measured nothing |

That last row is the one worth stating in full. §5 pre-committed `precision < 0.30` as the reading that would close
the evidence-shape axis. Firing it here would be the exact error this document spends its length arguing against:
**a case the arm could not measure is reported, not scored.** The row stays open, and the run is filed as an
instrument failure with two named causes.

### 6.1 Two causes, both in the harness

**The budget was invisible.** Nothing in the prompt said how many turns were left, and nothing said that an
unanswered case scores zero. A model told "you have a small budget" answers when it believes it is done; a model
told "round 5 of 6, 1 tool call left, an unanswered case scores zero" plans. The completion side of the bill is the
proof of the shape: **6.8 tokens per turn** — every reply was one bare directive, for six turns, forty thousand
times.

**The surface was one service wide against a fifty-service case.** A zero-cost census of the corpus
(`/tmp` probe, 60 cases, `buildTelemetry` only, no model) reads:

| what the tools would return | reading |
| --- | --- |
| services per case | median **50**, max 50 |
| at least one service with metric series | 100 % |
| the TRUTH service has metric series | 100 % |
| failed-interface edges non-empty | 90 % (median 2 edges) |
| edge-latency edges non-empty | 100 % (median 54 edges) |
| any service with an `ERROR` line | 100 % |
| the TRUTH service has an `ERROR` line | **65 %** |
| truth wins a max-ratio read over the whole fleet | **38.3 %** |

The information is there — and the last row is the ceiling of the cheapest possible investigation: rank every
service by its strongest rise, answer the top one, and 38.3 % of cases are right. But `TOOL metric <service>` and
`TOOL logs <service>` each spend one call on one service, so ten calls cover a fifth of the directory. The arm was
asked to investigate fifty suspects with ten questions.

## 7. Surface v2: three changes, and none of them is a model change

1. **The budget is rendered into every prompt.** `renderBudget` states the round, the calls left, and that an
   unanswered case scores zero; on the last turn it stops being a status line and becomes an order (`LAST turn …
   the only accepted reply is ANSWER`).
2. **Running out of runway no longer ends the investigation.** A turn taken with the call budget spent is a turn
   that only accepts an answer, so the calls already paid for are not thrown away by a loop that terminates itself.
   The stop reason still distinguishes `tool-calls` from `rounds`, because which wall was hit is a fact about the
   arm's appetite.
3. **`TOOL fleet` reads the whole directory in one call**, and every metric answer now carries the collapses as
   well as the rises. The second half is a consistency repair: the system prompt tells the model that a service
   which stopped receiving traffic can be the root cause, while a rise-sorted `metric` answer sorted exactly those
   services last by construction.

All three are instrument fixes, so the next run's first threshold is not accuracy — it is whether the instrument
works: **≥ 90 % of investigations must end on an answer.** Only after that does a precision mean anything, and the
0.55 / 0.35 / 0.30 thresholds of §5 stand unchanged behind it.

### 7.1 What `TOOL fleet` does not fix, stated before the reading rather than after

The ranking is by **ratio**, and a ratio is not comparable across metric labels: a series whose baseline is 0.004
and whose peak is 0.4 reads 100 beside a `cpu` that doubled. The census's 38.3 % is exactly that read's ceiling, so
`fleet` inherits a known error mode rather than removing it — a loud, small-baseline series can outrank the fault.
Two things follow, and neither is a defence:

- the tool is an **entry point**, not an answer: `metric <service>` and `edges <service>` are what confirm a
  candidate, and the arm's precision will say whether the model used them;
- if the v2 reading lands at the fleet ceiling rather than above it, the finding is that the arm **replaced** its
  judgement with the tool's ordering, which is a different failure from the table's and would need its own arm
  (`fleet` ranked by deviation from each series' own pre-injection variance, rather than by ratio).



## 8. Surface v2, read

Run `44704530268`, same sample (80 misses + 80 hits), same budget, `deepseek-chat`. The instrument worked and the
arm did not close the gap.

| quantity | v1 | **v2** |
| --- | ---: | ---: |
| **answered share (I1, ≥ 0.90)** | 0.031 | **1.000** |
| rounds per case (I2, ≥ 2.5) | 6.00 | 6.00 |
| agent Top@1 on the 160 | 4 | **54** |
| engine Top@1 on the same 160 | 80 | 80 |
| repairs / breaks | 2 / 78 | **11 / 37** |
| decided | 80 | **48** |
| precision (Q1, ≥ 0.55) | 0.025 *(not adjudicable)* | **0.229** |
| tokens | 685 150 + 6 507 | 928 610 + 5 145 |
| cost (Q4, ≤ ¥10) | ¥1.42 | **¥1.90** |
| completion tokens per turn | 6.8 | **5.4** |

### 8.1 Thresholds, adjudicated

| # | threshold | reading | verdict |
| --- | --- | --- | --- |
| I1 | answered ≥ 0.90 | **1.000** | **pass** — the harness now ends on a decision, and the pilot's 3.1 % was the instrument |
| I2 | rounds ≥ 2.5 | 6.00 | **pass formally, and the number is not the one it was meant to be**: every case reached the cap and the cap is a forcing turn, so the model never chose to stop early |
| Q1 | precision ≥ 0.55 | **0.229** | **fail**, by more than the width-30 arm failed it (0.475) |
| Q2 | arm beats the engine on its sample | 54 against 80 | **fail** |
| Q3 | no family worse than −5 net | `HTTPRequestReplaceMethod` **−8** | **fail** |
| Q4 | ≤ ¥10 | ¥1.90 | **pass** |
| Q5 | the switches are honoured | sample, model and both budgets named in the artifact's own header | **pass** |
| P5 | the falsifier: precision < 0.30 on ≥ 20 decided | 0.229 on 48 | **TRIGGERED** |

**The falsifier fired this time, and it is allowed to.** With 160 of 160 cases answered and 48 decided, the arm's
choices are the arm's; a precision of 0.229 says a query surface **as built here** does not repair more than it
breaks. The register's evidence-shape row closes on that reading.

### 8.2 What the number is, exactly — and why 0.229 is not the whole finding

Two readings sit beside the verdict and neither is decoration.

**The arm's accuracy sits just above the fleet read's ceiling — measured on the arm's own cases.** On these 160
cases the arm answers **54 (33.75 %)**. The §6.1 census priced a fleet-wide max-ratio answer at 38.3 % on 60 corpus
cases in the corpus's natural class balance, which is **not** the arm's denominator: the arm was measured on 80
misses plus 80 hits. Recomputed on the arm's own 160 cases (same probe, no model), the ladder reads:

| read, on the pilot's own 160 cases | correct |
| --- | ---: |
| fleet max-ratio, answer the top service | **30.6 %** |
| fleet max-ratio, truth inside the top 3 | 41.9 % |
| fleet max-ratio, truth inside the top 8 | **63.1 %** |
| **this arm, five investigative turns** | **33.75 %** |
| the engine, same 160 | 50.0 % |

Three statements follow, and only the first is comfortable for the shape.

1. **The queries bought 3.1 pp over a read that investigates nothing** — the arm is above the max-ratio floor, so it
   is not simply copying the first ordering it saw. The gain is small and it is positive.
2. **The information is reachable and the arm does not reach it.** The truth is inside the fleet's top 8 on **63.1 %**
   of these cases; the arm answers 33.75 %. The 29.4-point distance is a **selection** gap, not an evidence gap.
3. **No transcript was recorded for this run**, so *why* the selection fails cannot be recovered from it: `TOOL fleet`
   called first with the follow-up tools rarely used is the hypothesis that fits two independent readings (the small
   gain over the floor, the large distance to the ceiling), and it is the hypothesis `QueryArmRow.trace` (§8.3) is
   there to test next time.

**The family profile is the complement of the table arm's.** Net repairs by family:

| family | this arm | width-30 table arm |
| --- | ---: | ---: |
| `NetworkLoss` | **+3** | −4 |
| `NetworkBandwidth` / `NetworkCorrupt` | **+1 / +1** | — |
| `JVMMemoryStress` | −4 | — |
| `HTTPResponseDelay` | −3 | +3 |
| `HTTPResponseReplaceCode` | −2 | **+8** |
| `JVMException` | 0 | **+8** |
| `HTTPRequestReplaceMethod` | **−8** | **−7** |

The two shapes lose on different families and gain on different families: the network families are this arm's only
clear gain, and they are the table arm's clearest loss. That is what two different evidence channels should look
like — and it means the missing mechanism is not a better harness but a **meta-decision about which channel a case
wants**, which no arm in this repository has.

### 8.3 What closed, and what did not

**Closed:** a free-investigation surface with six rounds, ten calls, a fleet-first prompt and this model does not
beat the engine on this corpus. The register records the precision and the sample.

**Not closed, and named rather than implied:** the budget. `RCAtlas`'s winning harnesses spend **100 calls per case**
against this arm's six, and its own ablation says more rounds buy aptitude. This arm spent five investigative turns
on cases with a median of **fifty** services, and the family table says it found something in the network families
anyway. `query_max_rounds` and `query_max_tool_calls` now exist as dispatch inputs; a 100-call arm at 160 cases costs
roughly **¥25–40** and is the next purchase if this axis is reopened.

**A record gap, closed in this iteration.** The artifact carried rounds, calls and tokens and **not one exchange**, so
"the model ignored the evidence" had to be inferred from a model we cannot see. `QueryArmRow.trace` now carries the
last 2 000 characters of each investigation, and `ANSWER` is rendered with its own keyword rather than as
`TOOL answer`, so a transcript can be read to say when the investigation stopped.

## 9. Why the arm reads below a free engine — two censuses, ¥0

§8 left the most uncomfortable number in this document unexplained: **54 correct against the engine's 80**, on the
same cases, at ¥1.90. The two readings below come from artifacts iterations 315–317 already paid for and cost
nothing. Neither explanation is about the model.

### 9.1 The echo census — the arm is a copy of whatever it is shown first

Run `44704530268`'s own artifact, 160 cases, all answered:

| the arm's answer equals | share of the answered cases |
| --- | ---: |
| `TOOL fleet`'s first line, i.e. the largest ratio | **55.0 %** |
| the engine's rank-1 | **36.3 %** |

The arm scored **33.75 %** between a max-ratio first line worth **30.6 %** and an engine first line worth
**50.0 %**. That is a noisy reranker of the *weaker* list, and it is what the design asked for: §4 makes `TOOL fleet`
the first move, so the first thing the model ever sees is a max-ratio ranking — a prescribed answer, which is the
exact shape `arXiv:2610.35767` prices at 16–53 % against 65–77 % for harnesses that prescribe none of the model's
calls. A free arm whose first tool prints a ranking is not free; it is seeded with the wrong prior.

The table arm reads the same way by arithmetic rather than by census. Width 30 moved **61 of 1 422** cases, so
**1 361 picks (95.7 %) were identical to the engine's rank-1**, and the 61 edits were 29 repairs against 32 breaks.
A copy with 61 noisy edits scores **1 153** against its source's **1 156**.

> **"LLM accuracy below the non-LLM engine" is not counterintuitive and not a mystery.** It is the arithmetic of
> copying: an arm can only beat the list it is shown by making edits whose precision exceeds the share it needs, and
> no arm in this repository has ever been shown the strongest list it has.

### 9.2 The normalisation census — and the claim it appeared to support, withdrawn

The same 160 cases, five single reads, no model. Top-1 is "answer the first element"; top-8 is "does the list carry
the truth", which is the question a candidate list is actually asked:

| ordering | top-1 | top-3 | top-8 |
| --- | ---: | ---: | ---: |
| the engine | **50.0 %** | 62.5 % | — |
| max **ratio** to the pre-injection level | 30.6 % | 41.9 % | 63.1 % |
| max **z** against the pre-window's σ | 13.1 % | 35.6 % | 71.9 % |
| max **robust z** — median / MAD | 25.0 % | 48.8 % | **76.9 %** |
| how far outside the pre-window's own envelope | 13.1 % | 35.6 % | 66.9 % |
| max absolute rise | 20.0 % | 23.8 % | 34.4 % |

The whole corpus, top-8 lists, 1 422 cases: engine **88.8 %**, robust z 84.9 %, ratio 74.3 %, union **96.6 %**; and of
the engine's **159 misses**, robust z was reported to carry the truth on **69.2 %** against the ratio's **25.8 %**.

**That reading was withdrawn the same day, and the withdrawal is the useful part.** The first implementation floored
the pre-window spread at a thousandth of the *level* and let the level be zero, so the floor became `1e-9` and a
series that sat at zero and became 50 scored a surprise of **5e10**. A census over the arm's own 160 cases:

| | |
| --- | ---: |
| cases carrying a zero-baseline series | **160 of 160** |
| cases where such a series owns the top of the fleet list | **160 of 160** |
| of the 1 280 top-8 slots, slots held by a `z > 1e6` series | **1 133 (88.5 %)** |

Those series are error rates and class-loading counters, and they belong to **victims**: a caller that starts
erroring is where the fault arrived, not where it started. So the ordering that scored 76.9 % was, in substance, an
**error-rate sort** — and the prompt itself tells the model to distrust exactly that ("a caller that reports errors
is usually a victim"). The statistic did not measure dispersion; it measured "was silent, then was not", and it
scored well on a *recall* metric while pointing at the blast radius rather than at the source.

**The shipped statistic refuses that reading instead of flooring it.** When the pre-window's median is zero there is
no level to standardise against, `surprise` is `undefined`, and `bySurprise` orders it last and falls back to the
ratio. A standardised amplitude needs a level; without one the honest statement is "it went from silence to noise",
which is the ratio's own statement and is now the one printed.

> This is the second time in three iterations that a defect let a row escape closure, and the register says so in as
> many words. A third would be a pattern rather than a coincidence, which is why the next arm is registered with the
> corrected statistic AND with a rule that its instrument checks precede its thresholds.

### 9.3 What was changed, and why the two changes do not confound

1. **A prior.** The engine's own top-5 is printed before the first turn, labelled a prior and not an answer. Off by
   default; `--seed engine` turns it on and `query_seed` states it at dispatch. The arm's **floor becomes the engine's
   accuracy** instead of the first list a tool printed.
2. **The fleet and metric lists are ordered by the dispersion-normalised surprise**, and every metric line prints
   both statistics so the model can see them disagree. One rule for the surface rather than two. §9.2 records what
   the first version of that statistic actually measured, and why it now refuses a zero level.

They act on **disjoint populations**, and the reading is decomposed:

| stratum | size | question | which change acts |
| --- | ---: | --- | --- |
| the engine's own hits | 80 | retention — does the arm keep what it was given? | the prior |
| the engine's misses | 80 | repair — does it find what it was not given? | the fleet ordering |

`QueryArmSummary` now reports `retained X/80 · repaired Y/80` beside the average, because one number called accuracy
averages two populations whose floors differ and can hide either.

### 9.4 Registered before the artifact

`docs-repository:preregistration-318.md`, with **I3 retention ≥ 0.90** as a new threshold and two falsifiers:
retention below 0.90 kills the prior (showing a model an order is not a way to keep it), and precision below 0.30 on
at least 20 decided cases closes the free-investigation row for good — at which point the remaining 6.6 pp is not a
channel problem at all, and the base term's definition is the only thing left.

### 9.5 The seeded arm, read

Run `44724631904`, the same 160 cases (80 engine misses + 80 engine hits), the same 6-round / 10-call budget,
`deepseek-chat`, `--seed engine`.

| quantity | v2 free | **v3 seeded** | threshold |
| --- | ---: | ---: | --- |
| answered share (I1) | 1.000 | **1.000** | ≥ 0.90 — **pass** |
| **retention over the engine's 80 hits (I3)** | 0.538 (43/80) | **0.650** (52/80) | ≥ 0.90 — **fail** |
| agent Top@1 | 54 | **62** | ≥ 80 (Q2) — **fail** |
| repairs / breaks | 11 / 37 | **10 / 28** | — |
| precision (Q1) | 0.229 | **0.263** on 38 decided | ≥ 0.55 — **fail** |
| rounds per case (P4) | 6.00 | 6.00 | ≤ 4.50 — **fail** |
| cost (Q4) | ¥1.90 | **¥2.16** | ≤ ¥10 — **pass** |

**Both pre-registered falsifiers fired.** Retention **0.650** is below 0.90: on **28 of the 80 cases the engine had
right**, the arm answered something else and was wrong — with the correct service printed at position 1 of the
prior. Precision **0.263** is below 0.30 on 38 decided cases.

**The arm improved by eight cases (54 → 62), almost all of it retention (+9 kept, −1 repaired), and the improvement
is not the one that was registered.** The registered
mechanism was the dispersion statistic, and §9.2 shows that statistic was measuring an error-rate sort. What the
reading actually shows is behavioural and is worth more than the eight cases:

> **The model does not copy the list it is shown. It overrides it, and its overrides are worse than copying.**
> Seeded with the engine's top-5, agreement with the engine's rank-1 rose only from 36.3 % to **45.0 %** — the model
> still substituted its own answer on **55 %** of cases — and the substitutions had precision 0.263 against a
> break-even of 0.500. The width-30 table arm, asked only to RANK, moved **4.3 %** of cases at precision 0.475. So
> the two surfaces differ by **13× in how often they intervene**, and precision falls as intervention rises.

That is a law this repository can act on, and it inverts the design question. "Free investigation" was registered as
the opposite of a prescription; what it is, in this implementation, is an **ungated override** of the strongest prior
the repository has. The next surface is therefore not freer or more seeded — it is **gated**: an override is
accepted only when the model names the evidence that discriminates it from the prior, and a case where it cannot is
answered with the prior.

**One caveat that must not be used as an excuse, and is stated to be checked later.** The surface this arm ran on
carried the zero-baseline defect of §9.2, and a fleet list that sorts by error rate gives the model a reason to look
away from a correct prior. So the falsifiers fire **against this implementation**, and the row is closed *as built* —
but a corrected statistic is a different surface and will be measured as one, once, under a pre-registration that
puts its instrument checks before its thresholds.

## 10. The institution, not the capability: an override admitted only against a record

Iteration 318 closed the seeded arm and left one sentence that is not about the model:

> The model does not copy the list it is shown. It overrides it, and its overrides are worse than copying — 55 % of
> cases substituted, at precision 0.263, against 4.3 % substitution at precision 0.475 for the table arm.

Two surfaces, **13× apart in how often they intervene**, and precision falls as intervention rises. That is not a
capability observation, so the next surface is neither freer nor more seeded. It is **gated**.

### 10.1 Three 2026 papers make the gate a law rather than a metaphor

**`arXiv:2611.05390`** (*Who May Overrule the Agent? Evidence-Gated Authority in LLM Review Institutions*, September
2026) studies exactly this decision — a second party that may replace a prior decision, and the institution that
governs when the replacement is binding. It compares **broad override authority** with an **evidence gate**:
replacement permitted only after *"a mechanically valid record of a binding-constraint violation and a compliant
repair"*. Two of its numbers are the two this iteration has to pay:

* the gate *"sharply reduces corruption of correct proposals while retaining most repairs of violations"* — the
  exchange rate a regime of 28 breaks against 10 repairs needs;
* and it is **not a model-independent safeguard**: in the prospective arm, Qwen's corruption of correct proposals
  falls to zero while *"Mistral still replaces all 48 correct proposals"*. **A rule that lives in a prompt is a
  request, not a gate.**

**`arXiv:2611.05662`** (November 2026) says why, from the reviewer's side: a judge that has *already gathered the
decisive evidence* still reverses up to **40 %** of correct verdicts when one authority-toned sentence is inserted
into its context, and **over-trust** is the dominant mechanism for the stronger models. Grounding does not immunise
a decision against a prior; jurisdiction does.

The **SPLIT** paper (October 2026) supplies the arithmetic that makes the gate a threshold rather than a hope:
*verified success saturates at the verifier's precision* — more attempts raise **coverage** and leave the **ceiling**
where the verifier put it. An arm whose overrides are admitted by a gate is that object exactly: its accuracy is
`engine + (admitted repairs − admitted breaks)`, so the ratio governing those two terms is a **precision**, and that
is why this iteration registered `G1` on precision rather than on accuracy.

### 10.2 What is mechanically checkable in an RCA case

The paper's gate needs a "mechanically valid record". An RCA case gives this repository one that a review setting
does not have: **the transcript**. Every claim the model makes about a service is either backed by an executed tool
result about that service or it is not, and the harness knows which. So the rule is enforced after the model has
spoken, against a record the harness already owns, at zero extra tokens:

| policy | an override is admitted when | what it prices |
| --- | --- | --- |
| `none` | always | the control: 318's ungated surface |
| `cited` | the investigation executed `metric`/`logs`/`edges` on the service it names | does **effort** select? |
| `cone` | `cited`, and the service sits on the prior's **callee-side cone** | does effort **plus direction** select? |

The third is the topological statement used everywhere else here: a fault propagates **down** the call graph, so a
root cause is reached by descending and a caller that reports errors is the victim. It is an `O(V+E)` walk over
`callees` that terminates on cycles, and it is a property of the case, not of the model.

**A refused override falls back to the prior.** That is the design's spine: the arm becomes **monotone**, because a
case the engine had right can now be lost only by an override that was *admitted* and wrong — never by a refusal.
Retention stops measuring the model's willingness to intervene and starts measuring the gate's selectivity.

**The rule is printed in every gated prompt**, because `renderBudget`'s lesson from iteration 316 applies unchanged
to a rule that discards answers: a wall the model cannot see is an ambush, and 155 of 160 investigations once ended
without an answer because nothing said the answer was compulsory.

### 10.3 One run, three policies, ¥2.48

The artifact records, per case, the model's **first** resolved answer before any gate, every service it executed a
query against, and whether that answer sits on the prior's cone — so the two policies that were not dispatched are
re-scored from the same file at **¥0**. A test asserts the online surface equals the priced one, because a table in
a document that describes an arm nobody ran is the defect this register exists to prevent.

Registered in `docs-repository:preregistration-319.md` with `I6` (answered ≥ 0.99), `G1` (admitted precision ≥ 0.50
on ≥ 12 decided) and `G2` (retention ≥ 0.95), five predictions and two falsifiers, before the artifact existed.

### 10.4 The read — run `44749523006`

The same 160 cases as 317 and 318 (80 engine misses by stride, 80 engine hits by stride; the engine's Top@1 on the
sample is 80 in both readings), `deepseek-chat`, 6 rounds, 10 calls, `--seed engine`, `--gate cited`.

| quantity | 318 seeded | **319 gated, dispatched** | threshold |
| --- | ---: | ---: | --- |
| answered (I6) | 1.000 | **1.000** (160/160) | ≥ 0.99 — **pass** |
| agent Top@1 | 62 | **73** | — |
| repairs / breaks | 10 / 28 | **9 / 16** | — |
| precision (G1) | 0.263 | **0.360** | ≥ 0.50 — **fail** |
| retention (G2) | 0.650 | **0.800** | ≥ 0.95 — **fail** |
| rounds per case | 6.00 | 6.00 | — |
| cost | ¥2.16 | **¥2.48** | ≤ ¥10 — pass |

And the three policies, re-scored from the same artifact:

| policy | admitted | refused | repairs | breaks | precision | Top@1 | retention |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `none` | 51 | 0 | 9 | 17 | 0.346 | 72 | 0.787 |
| **`cited`** (dispatched) | 50 | **1** | 9 | 16 | 0.360 | 73 | 0.800 |
| **`cone`** | 30 | **21** | **9** | **11** | **0.450** | **78** | **0.863** |

Three findings, and the third is the one worth the ¥2.48.

**1. The effort gate is inert, by measurement.** Of the 51 overrides, **50 had been cited**: told that an override
must be investigated first, the model investigates what it names **98 %** of the time. "Being investigated" is
therefore nearly a constant on this surface, not a signal — the first policy is priced and refused by its own data,
which is a stronger statement than the paper's warning that a prompt-level gate can fail.

**2. The direction gate is selective in the one direction that matters.** `cone` refuses 21 of the 51 overrides, and
of those 21, **0 were repairs** and 6 were breaks: it discarded **none** of the 9 edits that gained a case while
discarding 6 of the 17 that lost one. Under random removal of 21 from 51, losing no repair has probability
**0.0047**. Note what it does *not* do: breaks are 33 % of the override population and 29 % of the refused set, so
the test does not *find* breaks — it **never vetoes a repair**, and with the fallback that is the only property a
gate needs.

**3. Announcing the jurisdiction moved the behaviour more than exercising it did.** The whole run contains **one**
refusal. Yet the model's own answers moved **62 → 72** against 318's ungated arm on the same cases — the raw column
of the table above — for one extra refusal and 0.3 s of extra prompt per turn. The rule was read and complied with
before it ever had to fire, which is the opposite of what the enforcement-only reading of `arXiv:2611.05390`
predicts, and it is measurable only because the artifact keeps the ungated answer beside the gated one.

### 10.5 Thresholds, adjudicated

`I6` passes at 1.000. **`G1` fails for every policy** — 0.346, 0.360, 0.450 against 0.50 — and **`G2` fails for
every policy**, best 0.863 against 0.95. **Neither falsifier fired**: `G1` is not below 0.35 for every policy (two
of three are above it), and no policy is inert (30–51 admitted). So the registered shipping rule — clearest
`G1`/`G2` reader wins — **selects nothing**, and this iteration ships no default change.

What it does ship is a **dominance**: `cone` is better than `cited` on all three axes at once (precision 0.450 vs
0.360, Top@1 78 vs 73, retention 0.863 vs 0.800) while admitting 20 fewer overrides, which is the direction the
measured law points — precision falls as intervention rises. Choosing it *now* would be a post-hoc selection, so it
is **registered as the primary surface of the next iteration** and not adopted from this artifact.

### 10.6 The law this iteration produces

> **A gate is judged by the repairs it refuses, not by the breaks it catches.** A fallback makes every refusal free
> unless the refused edit was a repair, so a gate's gain is `breaks refused − repairs refused`, and a gate that
> never refuses a repair has non-negative gain by construction. Precision is the wrong lens on a refunded refusal.

That inverts the usual reading of a verifier. `SPLIT`'s precision ceiling is a ceiling on an **irrevocable**
verifier: a rejected candidate is gone. Here a rejected candidate is replaced by a prior that is right on half the
population, so the relevant quantity is the **composition of the refused set** — and the composition this gate
produced is `0 repairs, 6 breaks, 15 neutral`.

### 10.7 What is left, exactly

`cone` reads 78 against the engine's 80 on the same cases, so the arm is **two cases short of its own floor**, and
both are visible in the artifact: the 80 engine hits were overridden 17 times, `cone` admitted 11 of those 17, and
**all 11 were wrong**. Every one of them was cited and in-cone — the model descended from a correct prior into a
callee and blamed the callee.

That is a **downstream misattribution**, and topology cannot separate "the callee is the cause" from "the callee is
fine". The next surface is therefore a **contrast**, not another map: admit a step down the cone only when the
callee's own evidence is *louder* than the prior's on a statistic that resists victimhood, or when the failing edge
`prior → answer` carries the loss. Both are already in the tool surface (`TOOL failed` prints `net=` per interface,
`TOOL metric` prints `z=` per series), so recording one boolean per row — *did a failing edge run from the prior into
the answer* — prices the whole hypothesis from the next run at ¥0, the way this one priced its three policies.

One caveat, stated rather than used as an excuse: every number above is one run of 160 cases at temperature 0. The
62 → 72 movement is one paired comparison on one sample; a repetition costs ¥2.5 and was not in this iteration's
purchase, and the register lists it as the cheapest open item.

### 10.8 What the budget and the deference actually did — four censuses on the same ¥2.48

The artifact answers three questions this document has been guessing at, and the third one reframes the next
purchase.

**The round cap binds; the call cap does not.** Every one of the 160 cases ran **6 rounds and 5 tool calls**, with
`rounds = calls + 1` exactly: the arm answered on the **forcing turn** every time and never earlier, leaving **5 of
its 10** calls unused. So "the arm needs more calls" was never the constraint — the dispatch input that would double
this investigation's depth is `query_max_rounds`, and it costs about ¥5 rather than the ¥6–10 a 100-call arm was
priced at.

**The named investigation is one to three services wide.** Distinct services named in `metric`/`logs`/`edges`: **1**
on 45 cases, **2** on 110, **3** on 5, against ~50 services per case. `TOOL fleet` is what supplies the breadth, and
the model reads it; the increase in depth would have to come from rounds, not from a wider single call.

**The rule turned an overrider into a verifier.** The model queried the prior's own rank-1 on **141 of 160** cases
(75/80 engine hits, 66/80 misses), kept it on **109** — a **31.9 %** override rate against 318's **55 %** — and the
10 extra correct cases are exactly what that deference is worth when the prior is right half the time. This is the
mechanism behind the +10, and it is the opposite of a capability change: the same model, one sentence, half the
interventions.

**And the same deference is what a miss costs.** On the engine's 80 misses the arm kept the **wrong** prior on
**46** of them. A gate with a symmetric fallback protects a hit and protects a miss equally, so it can only trade
repair against retention at a fixed exchange rate; 318 bought repairs and paid breaks, 319 bought retention and paid
repairs. Breaking that symmetry is the whole content of the next design: on a miss the prior's own evidence is weak
by construction, so the predicate that separates the two cases cannot be "how much did you look" — it is **whether
the callee's evidence beats the prior's on a statistic the victim cannot inflate, or whether a failing edge carries
the loss**. That is a contrast, it is computable from two tool results this arm already prints, and it is the one
thing no competitor's paper supplies.

## 11. A gate judged by the evidence it demands, not by the position it checks

§10 closed at "two cases short of its own floor", and the sentence that named the cause was:

> `cone` admitted 11 of the 17 overrides on engine hits, and **all 11 were wrong**. Every one was cited and in-cone
> — the model descended from a correct prior into a callee and blamed the callee.

Position is necessary and not sufficient. This iteration replaces it with **evidence**.

### 11.1 The theory, from the paper that named the failure mode first

**LagRCA** (*Bridging the Delay: Lag-Aware Spatio-Temporal Causal Inference for Microservice Root Cause Analysis*,
FSE Companion '26, Industry Track Distinguished Paper, Nankai × Alibaba × Tsinghua, `10.1145/3803437.3805219`, code
public at `github.com/kjhjk566/LagRCA`, **88.3 % AC@5**) states it exactly:

> upstream failures rarely trigger downstream alerts immediately … methods still analyze service interactions
> synchronously and fail to explicitly account for such multi-lag propagation, **which misaligns causes and symptoms
> and can dilute true upstream culprits while over-ranking downstream victims**.

Its industrial measurement decides the **shape** of the predicate: **18.49 %** of incidents erupt synchronously, so
**81.5 %** carry a lag of ≥ 2 minutes (up to > 6). A conjunction would refuse every override in a fifth of cases;
the rule therefore has to be a **disjunction**.

The mechanism is confirmed from a second direction, and more sharply. `arXiv:2608.21310` codes all 50 failed
trajectories of the **Sonnet arm that reaches 90.0 Acc@1**, and two of its twelve codes are this iteration's whole
subject:

| code | what it names | prevalence (Sonnet, n = 50) |
| --- | --- | ---: |
| `MIS3` | *"Fault direction reversed between caller and callee sides"* | **86.0 %** |
| `OMIT6` | *"No check that proposed cause precedes the symptom"* | **4.0 %** |
| `MIS2` | *"Loudest anomaly over-trusted without cause–symptom distinction"* | 42.0 % |

So the strongest published agent reverses the caller/callee direction in **86 %** of its failures, and almost never
checks whether its cause precedes its symptom. **Neither of those is a model capability; both are procedure**, which
is why they are imposed by the harness here.

### 11.2 What a gate can demand that a model cannot fake

`contrast` = `cone` ∧ (E1 ∨ E2), both read off the **case**, not the transcript:

* **E1, the interface.** Net failures on `prior → answer` exceed those on `answer → prior`. A failing interface is a
  *call that failed*, and the callee is the end the call reached — so the side the failure ran into is a source
  before it is a victim.
* **E2, the lag.** The candidate logged its first `ERROR`/`FATAL` **strictly earlier** than the prior. A caller
  cannot report a callee's failure before the callee produces it. A prior that logged nothing is not
  counter-evidence, and is therefore not a veto.

A third axis was **pre-registered and then dropped**: the deepest series collapse. This package's own fixture refutes
it — `checkout`'s traffic falls from 100 to 20 *because* `payment` is down — so a deeper collapse admits the victim.
The negative result is asserted in the suite (`leadsEvidence` refuses that exact pair) so it cannot be re-invented.

**The degenerate form is also rejected in writing.** LagRCA's score is $s_{t,i}=\mathrm{ReLU}(r_{t,i}-\beta p_{t,i})$
over a *reconstruction residual*; this repository's statistic is a robust z against a service's own pre-window, and
under amplification a victim's z exceeds its source's. A predicate `z(answer) > z(prior)` would therefore admit
almost everything and collapse `contrast` into `cone` — priced as a rejection before the run rather than explained
away after it.

### 11.3 Two arms, ¥7.67, and the first paired reading above the engine

Run `44773762451` dispatched `--gate contrast` at 6 rounds; run `44773776750` dispatched `--gate cited` at
**12 rounds** (§10.8 showed the round cap, not the call cap, is what binds). Both on the same 160 cases,
`deepseek-chat`, `--seed engine`, engine Top@1 = 80 on the sample.

**Six rounds, `contrast` dispatched:**

| policy | admitted | refused | repairs | breaks | precision | Top@1 | retention |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `none` | 41 | 0 | 13 | 11 | 0.542 | 82 | 0.863 |
| `cited` | 40 | 1 | 13 | 10 | 0.565 | 83 | 0.875 |
| `cone` | 35 | 6 | 13 | 10 | 0.565 | 83 | 0.875 |
| **`contrast`** | 19 | **22** | 11 | **4** | **0.733** | **87** | **0.950** |

**Twelve rounds, `cited` dispatched, `contrast` re-scored from the same artifact at ¥0:**

| policy | admitted | refused | repairs | breaks | precision | Top@1 | retention |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `none` | 51 | 0 | 11 | 9 | 0.550 | 82 | 0.887 |
| `cited` | 51 | 0 | 11 | 9 | 0.550 | 82 | 0.887 |
| `cone` | 33 | 18 | 11 | 6 | 0.647 | 85 | 0.925 |
| **`contrast`** | 12 | **39** | 10 | **0** | **1.000** | **90** | **1.000** |

**What this says, in the order the evidence supports it.**

**1. The predicate selects, and selects in the direction it was built for.** Precision moves `0.542 → 0.733` at six
rounds and `0.550 → 1.000` at twelve, on **fewer** admissions each time (19 of 41; 12 of 51). The measured law from
§10 — precision falls as intervention rises — is inverted here, which is the first time in four iterations that a
change moved both axes the right way at once.

**2. The 22 refusals at six rounds cost 2 repairs and bought 7 breaks.** Composition of the refused set:
`2 repairs, 7 breaks, 13 neutral`. Net **+5** on the sample (82 → 87), and the two refused repairs are visible in
the artifact:

| case | prior (wrong) | answer (right, refused) | onset prior | onset answer |
| --- | --- | --- | ---: | ---: |
| `ts4-…-basic-service-response-delay` | `ts-route-plan-service` | `ts-basic-service` | **+0.7 s** | +90.5 s |
| `ts4-…-seat-service-response-delay` | `ts-travel-plan-service` | `ts-seat-service` | **+0.8 s** | +8.9 s |

Both are the predicate's **designed** behaviour and both are **wrong** on this data: the prior logged first and was
still the wrong service. That is `MIS2` from the table above — salience, not direction — and no ordering of the two
onsets can settle it, because in a TrainTicket case a healthy callee can log an upstream timeout later than the
upstream service logs its own. **This is the honest cost of the predicate, named rather than hidden.**

**3. The twelve-round artifact prices a stronger claim that this iteration does not own.** Re-scored, `contrast`
reads **90 against the engine's 80, retention 1.000, zero breaks** — McNemar `+10/−0`, p = 0.0044. But it was **not
dispatched**, so its 51 overrides are the ones a `cited` prompt produced; §10.8 already measured that the
*announcement* of a rule moves the override rate (55 % → 31.9 %), so a `contrast` prompt would produce a different
population. **90 is therefore a re-score of another arm's behaviour, not a reading of this one**, and it is reported
as an upper bound with its confound stated.

**4. The dispatched reading is not yet statistically separable from the engine.** 87 against 80 is McNemar
`+11/−4`, **p = 0.121**; Wilson 95 % interval on 87/160 is `[0.466, 0.619]`. The gain is in the predicted direction
and is worth +5 over the ungated arm on the same cases, and it is **not** a significant advantage over the engine on
160 cases. Saying otherwise would be the exact error this register exists to prevent.

### 11.4 Thresholds, adjudicated against the numbers registered before them

| id | threshold | six rounds | twelve rounds | verdict |
| --- | --- | ---: | ---: | --- |
| **C1** | precision ≥ 0.50 | 0.733 | 1.000 | **pass** |
| **C2** | retention ≥ 0.95 | 0.950 | 1.000 | **pass** |
| **C3** | Top@1 ≥ 84 | **87** | **90** | **pass** |
| **C4** | repairs refused = 0 | **2** | **1** | **FAIL** |
| **D1** | 12-round repairs ≥ 11 | — | **11** | **pass (at the line)** |
| **D2** | 12-round precision ≥ 0.50 | — | 0.550 | **pass** |
| **F1** | Top@1 ≤ 78 | 87 | 90 | does not fire |
| **F2** | ≥ 1 repair refused | **2** | **1** | **FIRES** |
| **F3** | repairs < 11 ∧ cost > ¥4 | — | 11, ¥5.19 | does not fire |

**`F2` fires and `C4` fails, so the registered shipping rule selects nothing and no default changes.** That is the
rule working as designed: the adjudication line was fixed before the number, and a reading that is good is not a
reading that is exempt.

Predictions: **P1** (15–30 refusals) → 22, **hit**. **P2** (≥ 8 of cone's admitted breaks refused) → 6 of 10,
**miss**. **P3** (better than cone's 78) → 87 > 83, **hit**. **P4** (12-round repairs > 6-round, precision not
significantly better) → repairs 11 vs 11 and precision 0.550 vs 0.550, **hit**; rounds 6.00 → 9.72. **P5**
(announcing E1/E2 moves the raw column by ≥ 3) → raw 82 against 319's 72 and 318's 62, **hit**.

### 11.5 The law this iteration corrects

§10 stated: *a gate is judged by the repairs it refuses, not by the breaks it catches*, and priced a gate that
refuses no repair as having non-negative gain by construction. This iteration shows that the first half is right and
the second half is too strong:

> **A gate's gain is `breaks refused − repairs refused`, and the only gate with gain ≥ 0 by construction is one that
> refuses nothing at all.** The useful question is not whether a refusal was free but whether the exchange rate
> beats the fallback — and the fallback is the prior, which is right on 50 % of this population, so a gate needs
> `repairs refused < breaks refused` and nothing stronger.

Under that reading the six-round arm is `+7 − 2 = +5` and the twelve-round re-score is `+9 − 1 = +8`; both positive,
neither free. **`C4 = 0` was the wrong threshold to register**, and the correction is recorded here rather than
applied retroactively to a threshold that had already been published.

### 11.6 Depth, priced

The 12-round arm cost **¥5.19** and moved `none` from 82 to 82, `repairs` from 13 to 11, and `rounds` from 6.00 to
9.72. Depth bought **more overrides (41 → 51) and no more repairs**. This is RCAtlas's finding reproduced
(`arXiv`, October 2026: *"reasoning budget does not predict quality"*; simple harnesses at 65–77 % PR@1 beating
published agents at 16–53 %): a multi-turn harness buys the **ceiling**, and this arm's ceiling was not the binding
constraint. What depth did buy is worth stating: the twelve-round artifact's override population is *more*
filterable — 39 of 51 refused — which is why its re-scored `contrast` reads higher. **Depth made the gate look
better by making the model's overrides worse**, which is not the same as making the arm better.

### 11.7 What is left

The predicate now reads `precision 0.733` and `retention 0.950` at six rounds with **2 repairs refused**, and both
of those repairs are `MIS2` cases where the prior logged first and was still wrong. So the remaining error is not
temporal and not directional: it is **salience** — deciding whether the loudest rise belongs to the source or to the
victim. LagRCA solves that with a trained residual model; the cheapest thing this repository can try that no
competitor's paper supplies is the **base term** (236 misses, 126 never repaired) rather than another gate, because
the gate's own numbers now say the gate is doing what it can.

## 12. The base rate decides, and the axis that was dropped is the one that was admitting victims

§11 ended with a reading — **87 against the engine's 80** on 160 cases — and a sentence naming the residue as
*salience*. This iteration re-read the same artifact and found that the sentence was wrong about where the error is,
and the reading was wrong about what it measures. Neither the model nor the predicate was re-run to find that out: the
artifact carries both onsets, both interface nets, both answers and the trace, so every policy is priced from it at
¥0, and the two errors are arithmetic.

### 12.1 The law: what precision an override needs is the population's number, not 0.5

The arm is measured on a sample drawn **80 engine-misses and 80 engine-hits**, because the two quantities that decide
it are repairs and breaks and a sample drawn from the misses alone has no denominator for precision. That
construction is an **exchange rate**. It is not the population: this corpus is **1 156 hits in 1 422 cases**
(81.29 %), so a case is 4.35 times likelier to be one the engine already had right.

For a gate admitting overrides at rate `a_m` on misses and `a_h` on hits, with precision `p` among the decided:

```
net = m · a_m · p − (1 − m) · a_h · (1 − p)   ⇒   net ≥ 0  ⟺  p ≥ (1 − m)·a_h / ( m·a_m + (1 − m)·a_h )
```

and with `a_m = a_h` this is **`p ≥ 1 − m` = the engine's own accuracy**. Here that is **0.813**. The break-even
registered in §11 (`C1`: precision ≥ 0.50) is the *balanced sample's* break-even and it is 31 points too low.

Transferring the measured per-stratum rates to the corpus:

| policy | admitted / refused / repairs / breaks | precision | sample Top@1 | net@corpus | corpus Top@1 |
| --- | --- | ---: | ---: | ---: | ---: |
| `none` | 41 / 0 / 13 / 11 | 0.542 | 82 | −115.7 | 73.16 % |
| `cited` | 40 / 1 / 13 / 10 | 0.565 | 83 | −101.3 | 74.17 % |
| `cone` | 35 / 6 / 13 / 10 | 0.565 | 83 | −101.3 | 74.17 % |
| `contrast` (§11's arm) | 19 / 22 / 11 / 4 | 0.733 | **87** | **−21.2** | **79.80 %** |
| **`lag`** | **14 / 27 / 10 / 0** | **1.000** | **90** | **+33.2** | **83.63 %** |

**§11's +7 is real as an exchange rate and negative as an effect.** That is the answer to the question asked since
318 — *why does enabling the model read below the engine?* — and the answer is not the model: it is that a gate at
precision 0.73 buys repairs in the 18.7 % stratum and pays for them in the 81.3 % stratum. `projectOntoCorpus` now
computes this for every policy on every run, and refuses a stratum the sample did not carry rather than inventing a
zero for it.

### 12.2 `E1` is a reachability test, and it was admitting the prior's victims

`contrast` is `E1 ∨ E2`, and a disjunction cannot say which term did the work. The artifact can:

| term | admitted | repairs | breaks | precision |
| --- | ---: | ---: | ---: | ---: |
| `E1` only — the interface `prior → answer` failed | 5 | 1 | **4** | 0.200 |
| `E2` only — the answer's first error is strictly earlier | 14 | **10** | **0** | **1.000** |
| both | 19 | 11 | 4 | 0.733 |

The reason is structural. **An interface that fails from the prior into the answer is what a failing caller produces
on every callee it has left**, so `E1` points at the prior's victims exactly when the prior is the source — the case
where an override is most expensive. It measures whether the call got through, and on a system whose caller has
failed, calls do not get through.

`E2` has no such ambiguity: a caller cannot report a callee's failure before the callee produces it. That is the
collision model's $\tau$ used as an **ordering**, and it admits ten repairs and no break.

So the policy is now **`lag` = `cited ∧ cone ∧ E2`**, strictly narrower than `contrast`, which stays unchanged
because a rule that changes under a published name invalidates every number taken under it. The pricing table prints
all five policies per artifact, in strictness order, for ¥0.

### 12.3 The three axes proposed for the residue, and what the artifact says about each

**Lag decay (LagRCA's exponential kernel) — no information in the magnitude.** Swept at `τ_min ∈ {1, 2, 5, 10, 20,
30, 60}` s the reading is **identical through 30 s** (18 admitted, 11 repairs, 4 breaks) and at 60 s it **loses a
repair and buys no break** (16 / 9 / 4). The gaps are not small — median `prior − answer` is **0 ms**, p90 **9.4 s**
— so the decay has nothing to weigh. What carries the information is the **sign**. Closed as an admission axis.

**Fault-free self-residual — refuted, and pointing backwards.** The healthy band exists (2 080 channels over the
corpus, from `build-fault-free-profile`), so each service's departure from its own healthy shape is computable for
free. The strongest self-channel residual of each side, by stratum:

| stratum | truth | engine's answer | model's answer |
| --- | ---: | ---: | ---: |
| engine misses (80) | p50 **32.1** | 79.4 | 55.9 |
| engine hits (80) | p50 **220.8** | 210.4 | 193.9 |

**The cases the engine misses are the cases whose root cause is quiet in its own channels.** A silent source cannot
be found by a salience threshold, and every variant of the axis (absolute 3…50, with and without "leads the prior")
added breaks faster than repairs: the best reads 22 / 9 / 5 (precision 0.643, net@corpus −42.3). §11 called this "the
single most promising untried use"; it is now closed, with the numbers that closed it.

**The prior's own margin — a hint, registered rather than shipped.** A small engine margin is a licence to override.
At the 10 % quantile the gate reads **91 / 0 breaks / precision 1.000 (p = 0.0010, net@corpus +36.6)**; at the 20 %,
30 % and 50 % cuts it degrades to 89 / 2, 90 / 3, 88 / 5. Four cuts were swept on the same 160 rows, so the 91 is the
best of four draws — it is registered for iteration 322 as a **single pre-committed threshold**, to be priced on the
1 422-row corpus artifact instead of on 160.

### 12.4 What the miss census says the arm actually does wrong

A dozen traces read by hand produced every sentence this document has written about "what is left". `2608.21310`
codes 154 wrong trajectories and finds one code accounts for **86.0 %** of the strongest model's failures; the same
instrument restricted to what a row and a graph can prove (`benchmarks/src/agentic-failure-codes.ts`) codes the 73
misses of the 160-case artifact:

| code | misses | share |
| --- | ---: | ---: |
| `answered-downstream` — the answer is a CALLEE of the truth | 28 | 38.4 % |
| `answered-other-branch` — another branch, truth never queried | 23 | 31.5 % |
| `refused-fallback` — refused, and the prior was wrong | 15 | 20.5 % |
| `answered-upstream` — the answer is a CALLER of the truth (reversed) | 7 | 9.6 % |
| `answered-elsewhere-truth-queried` | 0 | 0 % |
| `never-answered` | 0 | 0 % |

**The largest bucket is overshoot**, which is neither of the two causes the register had been naming: the model does
not go up (9.6 %) and does not stop (0 %), it goes one hop too far down. And `0 %` on "queried the truth and answered
elsewhere" says the salience story is **not** what the misses are made of: where the investigation reached the
truth's branch it either answered correctly or was refused.

The repair that census suggests — prefer the **shallowest leader** on the path from the prior to the answer — was
priced at ¥0 and buys nothing: 2 rewrites under the ungated control and **0** under `lag`, because an overshoot's
answer is usually not reachable from the prior at all. Recorded as refuted rather than shipped.

### 12.5 The corroboration from outside, and what it costs

`arXiv:2609.13463` (Continual Search, Scale AI) reports the mirror of §11.6 from the other side: on **short-flow**
populations, *additional search rounds do not help and actively hurt — they force the judge to re-examine an answer
it has already read and overturn correct judgments into wrong ones*. §11.6 measured exactly that shape from inside
(9 breaks at twelve rounds against 6 at six, `none` 82 → 82). Two independent measurements now say the round cap is
not where this population's headroom is, which is why the depth of the next run stays at 6.

### 12.6 The corpus, all 1 422 cases: −97 ungated, +18 gated

Dispatch `44834190491`, `--gate lag`, six rounds, ten tool calls, **every** case. Cost **¥23.07** (11.33 M prompt +
52 k completion tokens), rounds per case **6.00**, answered **1 422 of 1 422**.

| policy | admitted | refused | repairs | breaks | precision | Top@1 | retention | net vs engine |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| engine (paired baseline) | — | — | — | — | — | 1 156 (81.29 %) | — | 0 |
| `none` | 214 | 0 | 37 | 134 | 0.216 | 1 059 (74.47 %) | 0.884 | **−97** (p = 4e−14) |
| `cited` | 213 | 1 | 37 | 133 | 0.218 | 1 060 (74.54 %) | 0.885 | −96 |
| `cone` | 189 | 25 | 37 | 115 | 0.243 | 1 078 (75.81 %) | 0.901 | −78 |
| `contrast` | 58 | 156 | 32 | 16 | 0.667 | 1 172 (82.42 %) | 0.986 | +16 (p = 0.029) |
| **`lag`** | **54** | **160** | **31** | **13** | **0.705** | **1 174 (82.56 %)** | **0.989** | **+18 (p = 0.0096)** |

**The project's central anomaly is now measured at corpus scale and fully accounted for.** An ungated arm makes 214
overrides at precision 0.216 and lands **97 cases below** the engine it was seeded from, at p = 4e−14. Nothing about
that is a failure to investigate: the arm answered every case and spent the full budget. It is a model whose every
edit is net-negative on a population where 81.3 % of cases are already right — the arithmetic of §12.1, measured
rather than projected. **The gate is the entire difference between −97 and +18, and it costs ¥0**: it is a re-score of
the same artifact.

The ladder is monotone in strictness and every rung is priced from one run: `none` 74.47 → `cited` 74.54 → `cone`
75.81 → `contrast` 82.42 → `lag` 82.56. Wilson 95 % on 1 174/1 422 is `[80.5, 84.4]`; McNemar `+18/−13`, p = 0.0096.
This is the first corpus-scale reading in this repository in which an LLM arm beats its own non-LLM engine, and the
first whose advantage is statistically separable from it.

**What it does not do is reach the target.** 90.0 % of 1 422 is 1 280 cases; the arm has 1 174. The remaining **+106**
is 40 % of the engine's 266 misses, while the arm currently repairs **31 (11.65 %)**. No gate can supply that: a gate
can only refuse an override, and 160 of the arm's 214 overrides are already refused. The gap is **coverage**, and coverage is the
base term.

**By fault family the net is not uniform**: `NetworkBandwidth` 8/0, `NetworkPartition` 6/3, `NetworkLoss` 5/0,
`HTTPRequestReplaceMethod` 4/0, `JVMException` 4/0 against `JVMMemoryStress` **0/4**. A family-conditional rule is
visible in that table and is **not** taken: four breaks in one family is a sample of four, and the register's rule is
that a per-family knob needs a mechanism before it needs a threshold.

**And the axis that was registered to be tested here failed.** The prior's own margin, at the pre-committed 10 %
quantile, buys **one repair and eleven breaks** at corpus scale (1 164, net +8, p = 0.35) — worse than doing nothing
extra, and worse in the direction the 160-row sweep had hidden. Register §325.13b has the four cuts.

### 12.7 The census at corpus scale: the arm does not fail to look, it looks one hop too far

The same instrument over the corpus artifact's **248 misses** (17.4 % of 1 422):

| code | 160-case sample | 1 422-case corpus |
| --- | ---: | ---: |
| `answered-downstream` — the answer is a CALLEE of the truth | 28 (38.4 %) | **100 (40.3 %)** |
| `answered-other-branch` — another branch, truth never queried | 23 (31.5 %) | 73 (29.4 %) |
| `answered-upstream` — the answer is a CALLER of the truth | 7 (9.6 %) | 38 (15.3 %) |
| `refused-fallback` — refused, and the prior was wrong | 15 (20.5 %) | 36 (14.5 %) |
| `answered-elsewhere-truth-queried` | 0 | **1 (0.4 %)** |
| `never-answered` | 0 | 0 |

Two things follow, and the first one sets the next iteration's target.

**`answered-elsewhere-truth-queried` is 1 in 1 422.** The salience story — the model looked at the truth's own
telemetry and preferred a loud victim — accounts for **one case in the corpus**. §11's residue was not salience.

**Overshoot is 40.3 % of every miss the arm makes**, and it is the one bucket a harness can reach without a better
model: if the arm answered the truth in those 100 cases it would read **1 274/1 422 = 89.6 %**, against a target of
1 280. So the base term is not "more evidence" and not "more rounds" (12.6 measures rounds at 6.00 with 100 %
answered). It is **one decision: where in the chain to stop.**

The cheap form of that decision was priced and refuted (§12.4): prefer the shallowest leader *on the path from the
prior*, which needs a path that usually does not exist. The form the corpus supports is **local and needs no path**:
an answer is not a source if one of its own **ancestors** logged its first error at least as early — a minimal-element
test over the ancestor chain, which is the collision model read one hop up instead of across the whole graph. The
artifact does not carry ancestor onsets today, so this is the first axis in this project whose *precondition* is a new
artifact field rather than a new threshold, and it is registered for iteration 322 with a pre-committed threshold:

> **`E5`** — an override is refused when some ancestor of the candidate (strictly above it, within the prior's cone)
> has a first-error offset **≤** the candidate's own. Predicted: it converts a majority of the 100 overshoots into
> fallbacks, and it costs the cases where the truth is itself an intermediate node that logged *later* than its callee
> — which the corpus says is the minority, since only 38 misses answer a caller of the truth.

`E5` is not shipped on that prediction: it is registered, and it will be priced at ¥0 on this artifact's rows plus the
corpus's ancestor onsets before any dispatch spends a token on it.

## 13. The root cause is silent, and the corpus is one-seventh "the answer is the noisy one"

§12 closed with a registered axis — `E5`, "refuse the override when an ancestor logged its first error no later" —
and a prediction that it would convert a majority of the 100 overshoots into fallbacks. It was priced on the same
1 422-row artifact at ¥0, and **it failed**. This section is about why, because the reason is worth more than the axis.

### 13.1 `E5` refuted, and the number that refutes it

| axis | repairs | breaks | net | comparator |
| --- | ---: | ---: | ---: | --- |
| `E5` ancestor refusal | 20 | 7 | **+13** | `lag` is **+18** |
| promotion to the earliest ancestor | 23 | **92** | **−69** | — |
| promotion to the nearest earlier ancestor | 23 | 90 | −67 | — |

Across the arm's 248 misses: **180 answer a transitive ancestor of the truth** (122 at hop 1), and of those 180,
**170 have a truth that never logged an error at all**, while **one** has a truth that logged earlier than the answer.
`E5` assumed the ordering it needed was present and small; it is **absent**. The same census says **230 of 248 misses
have an entirely silent truth** — and so do 865 of the engine's 1 156 hits, which is why silence alone separates
nothing.

### 13.2 The one asymmetry the corpus does carry

A fault at the entry sabotages the entry's own inbound API: nothing below it fails. A fault below reaches the entry
through the callee on the failed path: that callee's error rate rises. So

* `entryChildErrors` — the largest **error-rate** rise among the entry's own callees — is the direction test;
* `answerSurprise` — the answer's largest departure in a channel that is **not** an error rate — is the source test.

The split matters because an error rate rising means *calls are failing here* (true of every hop on a failure's path)
while a resource rising means *this service is working harder* (true only of the service doing the work). Priced with
and without, on the same rows:

| rule | fires | repairs | breaks | net |
| --- | ---: | ---: | ---: | ---: |
| children quiet → entry | 134 | 63 | 71 | −8 |
| `∧ surprise ≤ 300` | 114 | 77 | 37 | **+45** |
| `∧ surprise ≤ 1000` | 160 | 92 | 68 | +33 |

**`entryChildErrors = 0` alone has precision 0.393**, because 222 non-entry cases are quiet below the entry too — a
silent deep source raises no error rate anywhere. The resource condition is what separates a quiet *victim* from a
quiet *source*.

### 13.3 The two strata the whole gap lives in

| stratum | cases | engine correct |
| --- | ---: | ---: |
| the truth is the entry (`ts-ui-dashboard`) | **186** | **13 — 7.0 %** |
| the truth is deep and leaves the entry's children quiet | 227 | **218 — 96.0 %** |

The 186 entry cases are 13.1 % of the corpus and the engine finds **seven per cent** of them; the arm finds 11. On the
other 227 the engine is nearly perfect and the arm matches it. Nothing in between: this corpus's difficulty is
concentrated in one question — *is the fault at the top, or below it?* — and every method here answers it by salience,
which is exactly the quantity that cannot distinguish them, because the entry is the loudest service in every case.

`--resolve entry-prior` applies a deterministic reader to that question after the gate settles an answer: no prompt
change, no round, no token. It is priced from one artifact at ¥0 (`correctResolved` beside every policy), and its
corpus reading is in §13.4.

### 13.4 The corpus reading: 86.01 %, and a defect the first dispatch found

The first dispatch of `--resolve entry-prior` (run `44856454924`, ¥23.08) reported `resolved 0` **on every policy**:
the resolver never fired. `entryOf` had asked for a graph with exactly one root, and this corpus has **fourteen** —
`ts-admin-*`, `ts-avatar-service`, `ts-delivery-service`, `ts-food-delivery-service`, `ts-preserve-other-service`,
`ts-rebook-service`, `ts-wait-order-service`, `rabbitmq`, `kubernetes-endpoints` all carry metrics and were never
called inside the captured window. The call graph is **broader than the traffic**, so the predicate returned `null` on
1 422 of 1 422 cases.

The fix is the mechanism the rule should have had: the entry is the root that reaches **strictly more** of the system
than every other root — the front door is what the rest sits behind — and a tie fails closed. That names
`loadgenerator`, which reaches 49 of 50 services and calls exactly one: `ts-ui-dashboard`.

Re-scored over the same artifact (the resolver needs no model, so this is a re-read and not a second purchase):

| reading | Top@1 | net vs engine | moves | kept | lost | precision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| engine | 1 156 (81.29 %) | — | — | — | — | — |
| `lag` | 1 173 (82.49 %) | +17 | — | — | — | — |
| **`lag` + `entry-prior`** | **1 223 (86.01 %)** | **+67** | 87 | 67 | 20 | **0.770** |

Wilson 95 % `[84.1, 87.7]`; sign test against the engine **67/17, p = 3.5 × 10⁻⁸**; against `lag` **67/20,
p = 4.3 × 10⁻⁷**; engine hits retained **1 139/1 156 = 0.985**.

**The rule is one decision, and it is the decision the corpus is about.** 67 of the 87 moves land on a case whose truth
is the entry, and the 20 that do not are the price of a condition stated structurally rather than fitted. It costs
nothing to run: no prompt change, no round, no token — the same artifact that produced 82.49 % produces 86.01 % when
its answers are read a second time.

**And the defect is the more useful result.** The pre-registration predicted ≥ 90 moves; the implementation produced
87, because the ¥0 pricing read the children's rise from `http.response.error_rate` while the code reads every
`/error/i` label — including `k8s.pod.network.errors`, which rises on victims. The stricter predicate fires less and
scores better per move (0.770 against 0.675). A re-pricing in another language is a second definition of every term,
and §325.14e records the difference rather than reconciling it away.
