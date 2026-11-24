# 342b — The dispatch: the schedule arm is refused by its own measurement

## 1. What ran

`benchmark-agentic.yml` dispatch **45414380350**, `query_agent_sample=266`, `query_schedule=engine`, everything else
empty: `deepseek-chat`, six rounds (five executable calls), `--seed none --gate none --fallback none`, concurrency 6.
**532 cases** = every one of the 266 cases the engine answers at rank ≠ 1, plus 266 it answers at rank 1 — a stratified
sample, so its Top@1 is an exchange rate and not a corpus accuracy.

Cost: **¥7.36** (3 611 158 prompt + 17 199 completion tokens, at the declared prices). Wall clock 37 m 20 s for the
whole workflow, of which the arm is 3 m 40 s.

The pre-registration in `schedule-not-seed-342.md` §10 was written before the artifact existed. This entry judges
against it.

## 2. The reading, against the floor it did not choose

```
cases 532 · answered 532 · stops {"answered":532}
agent Top@1 184 · engine Top@1 on the same cases 266
repairs 45 · breaks 127 · precision 0.262
retained 139/266 of the engine's own (0.523) · repaired 45/266 of its misses
```

| hypothesis | pre-registered | measured | verdict |
| ---------- | -------------- | -------- | ------- |
| H1 the route is used | mean distinct ≥ 3.0, ≥ 50 % of transcripts carrying a `next` | **not measured** — the artifact download is blocked in this sandbox (§6) | unknown |
| H2 the reach converts | ≥ 10 of the 74 repaired | 45 repairs over the whole 266; the 74-case subset is not yet separable | **fails at the aggregate** |
| H3 the route does not cost what it buys | retention ≥ 96 % | **52.26 %** | **fails, decisively** |
| the decision rule | net ≥ +8 to justify a full dispatch; < 3 closes the lever | **−82 against the engine** (184 vs 266), **−127/+45** within the sample | **lever closed** |

## 3. The control that decides it, at the same denominator

The free arm's own artifact (`/tmp/art328/query-agent.ndjson`, 1 422 rows) read on the same two populations the sample
is drawn from:

| arm | repairs on the 266 engine misses | retention on the engine's hits |
| --- | -------------------------------: | -----------------------------: |
| free (shipped, no schedule) | **153 / 266 = 57.52 %** | **1 134 / 1 156 = 98.10 %** |
| schedule (this dispatch) | **45 / 266 = 16.92 %** | **139 / 266 = 52.26 %** |

Projected onto this stratified sample, the free arm's exchange rate is `(266 × 0.575 + 266 × 0.981) / 532 = 77.8 %`
against the schedule arm's **34.6 %** — a **−43 pp** movement on the same 532 cases. The retention column is the one
that cannot be explained away: a prompt line that only ADDS an optional tool has no business destroying half of the
engine's correct answers.

The prediction that would have been made from the artifact was **+2.01 pp**. The measurement is **−43 pp**. The
difference is not a magnitude error; it is a sign error, and it comes from a mechanism the analysis never modelled.

## 4. Root cause, from the diff rather than from the result

The arm differs from the shipped one in exactly two bytes-classes of text: four lines appended to the standing
instruction, and one tool. Three mechanisms follow from that diff, and all three push the same way.

1. **The v1 line sold the schedule as a replacement for the fleet read.** It said *"…so ten calls reach ten distinct
   services instead of whatever the `fleet` read happened to surface"*. `TOOL fleet` is the free arm's single most
   valuable call: eight services, each with its strongest rise, in ONE call. A route that argues against it converts a
   five-call budget from "1.888 distinct + three fleet reads" into "five single-service reads", i.e. **strictly less
   evidence for the same money**. The measured retention — half the engine's correct answers lost — is what "less
   evidence" costs.
2. **A served slot carries fewer channels than a fleet line.** `TOOL next` returns `TOOL metric <id>` verbatim: the six
   largest rises on one service. It carries no `ERROR`/`FATAL` lines and no failed-interface counts, which are the two
   channels that separate a source from a victim (`leadsEvidence`, `lagLeads`). The schedule spends the budget on the
   weakest view of the most-promising services.
3. **The line stated a number that is not true.** It said *ten* calls; the loop executes five (§1.1 of
   `schedule-not-seed-342.md`). A prompt that misstates the budget teaches the model to plan against a wall that is not
   there.

None of the three is a coding defect in the sense of a wrong branch. They are a **design defect in the instruction**,
and the mechanism is what the pre-registration's H3 was for: it asked "does the route cost what it buys" precisely
because a route that competes with exploration had no reason to be free.

## 5. What this does NOT refute

* **The 74-case reach reading stands.** 29 of the 74 unqueried misses really are inside the engine's first five
  positions, and the model really did spend 4.99 calls on 1.888 distinct services. Those are properties of the
  artifact, not of this arm.
* **`Retrieval@k` split stands** (99.25 % queried against 26.79 % unqueried): the arm looks where the engine points.
* **What is refuted is the implementation, not the premise.** "Give the model a route it may walk" was implemented as
  "replace the fleet read with a single-service walk", and that is the thing the measurement refuses. A schedule that
  *adds* engine-ranked services to what the fleet read already shows is a different instrument and remains untested.

## 6. The instrument's own gap, stated as a gap

The per-case artifact of run 45414380350 could not be downloaded in this environment (the archive endpoint stalls at
zero bytes while the 10 KB `agentic-headroom` archive from the same run downloads in a second), so H1 — whether the
model actually issued `next` directives — has **no measurement in this entry**. Two consequences are recorded rather
than papered over:

1. the conclusion is drawn from the OUTCOME columns, which are measured, and the mechanism in §4 is a reading of the
   diff plus the outcome, not of the transcripts;
2. the next dispatch of this line must print the census the reading needs (`distinct services`, `next` share) into the
   job log, because an artifact that cannot be fetched is an artifact that does not exist.

## 7. What ships, and what is closed

* **`TOOL next` and `--schedule none|engine` ship**, default `none`, because the instrument is what makes the negative
  result reproducible; the register's practice is to keep a measured arm beside its number rather than delete it.
* **The v1 prompt is repaired** (`SCHEDULE_TOOL_LINE` v2): no call count, and a sentence that says what the route costs
  in width — *"`TOOL fleet` shows eight services at once for one call, so an investigation that spends every call here
  sees FEWER services than one that does not"*. v2 has **not** been dispatched; a reading taken under it is a new arm
  and says so.
* **The lever "a schedule competes with the fleet read" is CLOSED** with its number: −43 pp against the free arm.

## 8. Next, and why it is not another schedule

The premise survives, the implementation does not, and the cheapest test of the premise no longer touches the budget at
all: **`TOOL fleet` should print an engine-order section** — the first five services in the engine's order, in the same
call, in the same tool, with no extra call and no `next` directive. The free arm then sees the engine's shortlist and
its own surprise ranking side by side, at zero extra cost, and the 29 reachable cases are inside the five it would now
read. That is a harness change of about twenty lines and a `fleet` test; its dispatch is ¥7 at this sample size.

Two things are deliberately not proposed: a wider `next` (the same defect at a larger width), and a seeded prompt
(refuted in §318 for a different reason — anchoring).

## 9. Falsifiers for this entry

1. **If the transcripts of run 45414380350 contain no `next` directive at all**, then the schedule was never used and
   the −43 pp is a **prompt side-effect** (four lines of text changing a model's behaviour with no tool involved),
   which would be a different and more alarming finding. The reading above would then be about instruction length
   rather than about the route, and this entry would be corrected by name.
2. **If the free arm re-run on this exact 266/266 sample scores materially below the 77.8 % projection**, the projection
   is wrong and the −43 pp is overstated by the difference. The projection assumes the free arm's rates transfer across
   strata, which is stated here as an assumption rather than measured.
3. **If a `fleet` with an engine-order section moves accuracy negatively too**, then the engine's order is
   counterproductive when shown as *evidence*, not only when shown as *instruction* — and the whole position-first
   analysis of §1.2 collapses for a third reason.
