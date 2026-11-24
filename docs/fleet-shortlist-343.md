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

Filled in after the dispatch, against the four hypotheses above. Nothing in §1–§6 may be edited to fit it.
