# 343 — The shortlist inside the fleet read, and the census that makes an arm readable

Two changes, and the second exists because the first would otherwise be unreadable.

The **arm** is the cheapest form of the premise 342 left open: the engine's own first five candidates printed inside
`TOOL fleet`. No new tool, no extra call, no extra round, and — the property everything here turns on — **no change to
the instruction**. A difference between this arm and the free one can only come from what the model was SHOWN.

The **instrument** answers a question 342b could not. That entry's per-tool table was computed from the artifact's
`trace`, which keeps its last 2 000 characters; `jq`'s 532 rows say **all 532 are elided** and keep 4.11 of 5 directives
on average. A count taken from a tail is a count of the tail. `QueryOutcome.tools` and `QueryOutcome.nextServed` are
counted as the directives run, so neither elision nor a 2 000-character cap can reach them.

## 1. What ships

| surface                                   | what it does                                                                                                             | why it is not the arms already refused                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `executeTool(…, shortlist)`               | `TOOL fleet` gains a section: the pipeline's own order, first `PIPELINE_LINES = 5` services the case carries, names only | It is a TOOL RESULT. The prompt is byte-identical to the published one (asserted), so it cannot be the 342b defect |
| `runQueryAgent(…, shortlist)`             | the harness holds the order and passes it to the tool; nothing is printed before the first turn                          | A **seed** prints the order into the prompt and measured worse than no order (§318); this prints nothing           |
| `--fleet-order none\|engine`              | the arm switch, default `none`, so every published number is reproducible byte for byte                                  | A **schedule** serves one service per call through a new tool; this spends no call and adds no directive           |
| `QueryOutcome.tools` / `.nextServed`      | every executed directive by tool name (refusals included), and how many `next` slots were actually served                | The trace cannot carry them: 100 % of 342b's rows are elided                                                       |
| row `tools` / `nextServed` / `fleetOrder` | the same, per case, in the artifact                                                                                      | An artifact that omits the column cannot be told from one written before it existed                                |
| job log `census:` line                    | distinct services, calls per case, next served, tools per case                                                           | 342b's gap: a reading that has to be inferred from a truncated field must be printed where it is produced          |

Five names, because five is the number of calls the loop can execute at the default budget (six rounds minus the forced
one). The section is truncated to that width and its header states both numbers, so a reader can see how much of the
order it is looking at: `pipeline order: the first 5 of 9 ranked services this case carries`.

What the section deliberately does **not** carry: a metric beside each name. A number there would put a second ranking
system inside a list whose entire claim is "this is the other system's order", and the two would then be read as one.

## 2. Tests

`benchmarks/__tests__/query-agent-shortlist.test.ts`, 10 tests, written before the code:

1. an arm with no shortlist renders **byte-identical** text to the two-argument call — every earlier reading stays
   reproducible;
2. the section prints the pipeline's order as given;
3. a name the case does not carry is skipped and the header counts what was printed;
4. a wide order is truncated to the width, and the section is exactly those names in that order;
5. an order naming nothing the case carries prints **no** section (a header about zero is noise);
6. the model receives the section inside `TOOL fleet` while `systems` equals `[QUERY_SYSTEM_PROMPT, …]` — the
   text-free property, asserted rather than described;
7. the census counts a directive the trace has already elided (5 `TOOL fleet` calls, fewer than 5 visible);
8. a refused tool is still counted (2 refusals of `next` on an arm with no schedule);
9. a served slot is separated from an asked-for one (3 asks, 1 served);
10. the terminal act is counted, so "answered" and "never answered" are distinguishable in the artifact.

Plus one wiring test in `agentic-workflow-wiring.test.ts` (`query_fleet_order` → `--fleet-order`), because a switch the
runner accepts and the form cannot express is an arm only its author can run.

## 3. Pre-registration

Written before the dispatch, against the same 532-case stratified sample 342b used (all 266 engine misses + 266 engine
hits), so the comparison is paired case by case and the free arm's number on exactly these ids is **414 / 532 = 77.78 %**.

| #   | hypothesis                                                 | bar                                                                                 | if it fails                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | the shortlist is read                                      | `tools.fleet ≥ 1` on **≥ 50 %** of rows                                             | below **10 %**, the model never opens the fleet read; the premise "the arm starts at `fleet`" is false and the shortlist must ride in the first result of any kind. Between 10 % and 50 %, the arm is weakly powered and the reading is reported as such |
| H2  | the reach converts                                         | agent Top@1 on the 532 **≥ 425** (414 + 11, the +2.01 pp point estimate rounded up) | +1…+10 is a partial reading and does not justify a full dispatch; **≤ 0** refuses the arm                                                                                                                                                                |
| H3  | it costs nothing                                           | retention of the engine's 266 hits **≥ 96 %** (255)                                 | any retention below 96 % closes the axis regardless of H2 — a shortlist that destroys correct answers is 342b's failure mode with a different name                                                                                                       |
| H4  | the census agrees with the trace where the trace can speak | `tools.logs / cases` ranks the same way as the tail's `TOOL logs` share did in 342b | a disagreement means the 342b tail table was not even a tail, and both readings are withdrawn                                                                                                                                                            |

The stopping rule: **H3 is a veto, H1 gates interpretation, H2 decides the arm.** A run whose H1 fails is not evidence
about the shortlist and will be reported as evidence about the harness.

## 4. Cost, and why this is the cheap arm

|                         |             per case |  532 cases |
| ----------------------- | -------------------: | ---------: |
| extra model calls       |                    0 |          0 |
| extra tool calls        |                    0 |          0 |
| extra prompt tokens     | 0 (prompt unchanged) |          0 |
| extra completion tokens |                    0 |          0 |
| the run itself          |             ≈ ¥0.014 | **≈ ¥7.4** |

The section costs nothing to _offer_; what it costs is the dispatch, because a paired comparison needs the 532 cases
investigated again under the new evidence. The output grows by up to six lines per `fleet` read, which is inside the
transcript the prompt already carries and is not charged twice.

## 5. Reproduce

```bash
# the arm (one dispatch, 532 cases)
gh workflow run benchmark-agentic.yml --ref master \
  -f query_agent_sample=266 -f query_fleet_order=engine -f model=deepseek-chat

# the reading, from the artifact the job leaves behind
jq -s '{cases: length,
        fleet: ([.[] | (.tools.fleet // 0)] | add),
        fleetCases: ([.[] | select((.tools.fleet // 0) > 0)] | length),
        nextServed: ([.[] | (.nextServed // 0)] | add),
        distinct: ([.[] | (.calls | length)] | add / length)}' \
  artifacts/agentic/query-agent.ndjson
```

## 6. What would make this the wrong instrument

1. **If `tools.fleet` is near zero**, the arm never fires and the reach premise is not about the fleet read at all — the
   shortlist would have to move into `TOOL services` or into a first result the investigation cannot avoid.
2. **If the arm repairs fewer cases than the free one while retaining its hits**, then showing the engine's order as
   evidence is worse than showing nothing, and the position-first analysis of `schedule-not-seed-342.md` §1.2 collapses
   for a third reason: not anchoring, not instruction contamination, but the order itself.
3. **If `tools` and the tail disagree about which tools were used**, the 342b table was not a tail either, and no
   per-tool claim taken from a `trace` in this repository may be used again — including the two that survived §4 of
   `schedule-dispatch-342.md`.

## 7. The reading

Run **45437298998**, `query_fleet_order=engine`, `query_agent_sample=266`, everything else empty; **532 cases**, the
_same_ 532 ids as 342b (verified by set equality, not by construction), **¥7.17**, 43 m 44 s for the workflow.
`fleetOrder: "engine"` on all 532 rows — the flag reached the arm.

```
cases 532 · answered 532 · stops {"answered":532}
census: distinct services 1.615 · calls per case 5.00 · next served 0
  tools per case metric 1.33 · edges 1.22 · failed 1.00 · fleet 1.00 · answer 1.00 · logs 0.44
agent Top@1 209 · engine Top@1 on the same cases 266
repairs 49 · breaks 106 · precision 0.316
retained 160/266 of the engine's own (0.602) · repaired 49/266 of its misses
```

| hypothesis                                                  | bar                                 | measured                                                                                                                                                                                           | verdict                                    |
| ----------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| H1 the section is read                                      | `tools.fleet ≥ 1` on ≥ 50 % of rows | **532 / 532 = 100 %**, exactly 1.00 fleet calls per case                                                                                                                                           | **passes**                                 |
| H2 the reach converts                                       | agent Top@1 ≥ 425                   | **209**; the free arm on the same ids is **414**                                                                                                                                                   | **fails — −205 cases, −38.53 pp**          |
| H3 it costs nothing                                         | retention ≥ 96 %                    | **60.15 %** (160/266)                                                                                                                                                                              | **fails, and is the veto**                 |
| H4 the census agrees with the tail where the tail can speak | rank order agrees                   | agrees **exactly** for the two late tools (`logs` 44.2 % both, `services` 0 % both) and disagrees for the early ones: `fleet` **0.0 % → 100 %**, `failed` 69.9 % → 95.1 %, `metric` 79.3 % → 100 % | **passes, and quantifies the 342b defect** |

H1 is the number that also settles 342b. `TOOL fleet` is called in **every** case, so the 0.5 % that entry published
for the fleet read was elision and nothing else. H4 puts a size on the rest of that table: the tail understated
`failed` by 25 points and `metric` by 21, and was accurate only for the tools a good investigation calls LAST.

### 7.1 The mechanism: a presented ranking is a candidate SET, and the model substitutes

The prompt was byte-identical to the free arm's, so this cannot be instruction contamination. The section was not
elided from the first turn. What the answers show is a substitution:

| where the arm's answer sits          |     arm | free arm |
| ------------------------------------ | ------: | -------: |
| = the engine's rank 1                |     198 |  **359** |
| another name inside the printed five | **140** |       64 |
| outside the five entirely            |     194 |      109 |

On the 266 cases the engine has RIGHT — where the truth _is_ the engine's rank 1 by definition — the arm answers
rank 1 in only **158** cases against the free arm's **261**, and answers a _sibling of the printed list_ in **44**
instead of 1. Every one of those 44 is a wrong answer manufactured by the section.

The section does not make the model follow the engine. It makes it **choose from the engine**, and its choice is worse
than either ranker: it investigates _less_ (1.615 distinct services against the free arm's 1.895), agrees with the
engine _less_ (37.2 % of answers are the engine's rank 1, against 67.5 %), and scores far worse (39.29 % against
77.82 %). Two rankings in one context — the fleet's surprise order and the pipeline's order — and the model reconciles
them into a third one that is the worst of the three.

### 7.2 Three presentations of the same order, three losses

This is the third time this programme has handed the engine's order to the arm. The three arms differ only in HOW:

| arm              | presentation                                 | pair-read                            |                                retention of the engine's correct answers |
| ---------------- | -------------------------------------------- | ------------------------------------ | -----------------------------------------------------------------------: |
| seed (§318)      | printed in the prompt, top-30                | 1 153 vs the engine's 1 156 on 1 422 | ~0 on the corpus, and 1 153 = **81.08 %** against the free arm's 93.39 % |
| schedule (342b)  | served one name per call through `TOOL next` | 184 vs 266 on these 532              |                                                              **52.26 %** |
| shortlist (this) | a five-name section inside `TOOL fleet`      | 209 vs 266 on these 532              |                                                              **60.15 %** |

Three forms, three losses, one factor in common: **the order**. The programme's remaining reach lever is therefore not
"show the arm where to look" — that instruction has now been priced three ways and refused three times — but "make the
arm's own investigation wider", which is a different purchase (rounds and calls) and has never been tested with the
engine's ranking absent.

**What closes.** "Give the arm the engine's ranking" is CLOSED in all three of its known forms, with the strongest form
(the one that adds no text and costs no call) measured last and refused hardest on retention. What stays open: raising
`maxRounds` with **no** order shown, which the 341 reach reading prices at 40 of 74 for 2× the model calls, and which
has never been run because every iteration since 318 has spent its dispatch on a presentation.

### 7.3 Falsifiers for this reading

1. If the arm's answers had clustered on the engine's rank 1 (≥ 90 % of hits retained), the section would have been
   read as a prior and the loss would have been "the engine was wrong on half this sample" — a sampling artefact. It
   did not: the arm answered a sibling of the printed five in 140 cases.
2. If `tools.logs` had risen, the loss could be read as the arm reading _more_ evidence and being misled by it. It
   fell: 0.44 log calls per case, less than the free arm's tail share implied.
3. If the same arm with `--fleet-order none` on the same 532 ids scored materially below 414, then this sample's free
   number would be stale and the −38.53 pp overstated. The free artifact is 5 days old, the ids are identical, and the
   model is the same string — the assumption is that the endpoint has not changed, which is stated and not measured.

## 8. Cost of the whole axis

|                 |       cash | what it bought                                                                        |
| --------------- | ---------: | ------------------------------------------------------------------------------------- |
| 342b (schedule) |      ¥7.36 | a refused route and a withdrawn mechanism                                             |
| 343 (shortlist) |      ¥7.17 | a refused presentation, a working census, and the crosstab that names the mechanism   |
| **the axis**    | **¥14.53** | "show the arm the engine's order" closed in three forms, each with a retention number |
