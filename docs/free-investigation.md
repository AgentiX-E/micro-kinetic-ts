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

