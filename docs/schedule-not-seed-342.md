# 342 — The schedule, not the seed: and the budget the arm actually spends is five, not ten

> **Read `schedule-dispatch-342.md` before quoting any number below.** Everything here is a **¥0 offline ceiling** read
> off an artifact that already existed. The dispatch that tested it (532 cases, ¥7.36) **refused the arm**: 45 repairs
> against the free arm's 153 on the same population, and 139 of 266 engine-correct cases retained against the free arm's
> 1 134 of 1 156. The ceiling was right about where the culprit sits and wrong about what a route costs; the entry that
> records the refusal is `schedule-dispatch-342.md`, and the lever "a schedule competes with the fleet read" is closed.

## 1. Two corrections before anything else

Both came out of building this iteration's instrument, and both change a number the register has been carrying.

### 1.1 The arm's budget is five calls, and it spends them to the last one

`DEFAULT_QUERY_BUDGET` states `maxRounds: 6` and `maxToolCalls: 10`. The loop gives its **last** turn to the answer
(`forcing` when `rounds === maxRounds`), so an arm configured that way executes at most **five** tool calls, however
many `maxToolCalls` allows. The artifact says so on every row:

```
$ jq -r .toolCalls /tmp/art328/query-agent.ndjson | sort -n | uniq -c
   6 4
1416 5
```

`6 × 4 + 1 416 × 5 = 7 104` calls, mean **4.9958** of a possible five. Iteration 341 read that as *"4.99 of ten, the
arm stops early with half its budget unspent"* — the sentence is withdrawn here, and the register's 341 entry and the
CARE-PO note it carried are corrected with it. Six rounds minus the forcing turn is the wall; `maxToolCalls: 10` never
binds and, on this configuration, never could.

The correction is not bookkeeping. It re-prices the whole schedule question, because the zero-cost width of a schedule
is the number of calls the arm can already spend — **five**, not ten.

```ts
/** benchmarks/src/investigation-schedule.ts */
export function usableCallsOf(budget: QueryBudget): number {
  return Math.max(0, Math.min(budget.maxToolCalls, budget.maxRounds - 1));
}
export const SCHEDULE_WIDTH = usableCallsOf(DEFAULT_QUERY_BUDGET); // 5
```

### 1.2 Where the arm's five calls actually went

The five calls spend on **1.888 distinct services** (mean over 1 422 rows, median 2): the other three calls are the
argument-free tools (`fleet`, `services`, `failed`). And of the 20 misses that *did* query the culprit, the culprit sat
at engine position **2** (median), against **9** for the 74 that never queried it:

| population | n | min | p25 | median | p75 | max | in top 5 | in top 10 |
| ---------- | -: | --: | --: | -----: | --: | --: | -------: | --------: |
| misses that queried the culprit | 20 | 1 | 1 | **2** | 2 | 26 | 17 (85 %) | 18 (90 %) |
| misses that never did | 74 | 2 | 3 | **9** | 20 | 44 | 29 (39 %) | 40 (54 %) |

Two facts follow, and they are the mechanism this iteration is about. **The model looks where the engine points** —
what it chose to query is the engine's top of the list, and it stopped after 1.888 of them. **And the unqueried misses
are not a hard population**: 29 of the 74 sit inside the engine's first five, which the arm could have reached with the
calls it already had.

## 2. Schedule ≠ seed

Iteration 318 measured a **seeded** prompt — the engine's order printed before the first turn — and it lost to the free
arm. The register has carried that as a mystery. It is not one, and the two mechanisms are what separate them:

| | seed | schedule |
| --- | --- | --- |
| who holds the order | the prompt | the harness |
| what the model sees | the whole list, numbered | one service per call |
| what it invites | anchoring, re-ranking a prior | spending a slot |
| what §318 measured | worse than free | never run, until now |

A printed list is a proposal to re-rank, and this repository has priced that shape at chance ten times over
(`z = −9.26` on 5 335 claims). A schedule hands the model one step and discloses no sequence, so there is nothing to
anchor on and no rank to defend.

### 2.1 `TOOL next`

One new directive, one new tool, and a prompt that does not move:

```ts
/** benchmarks/src/query-agent.ts */
export function executeTool(telemetry, call, schedule?: ScheduleCursor): ToolResult
```

Three refusals, each a statement:

* **No schedule** → `refused: this arm carries no schedule` — never an empty list, because an empty list teaches the
  model that a real service has nothing.
* **Past the end** → `refused: the schedule is exhausted after N services` — the investigation continues; the model
  names a service or answers.
* **A name the case does not carry** → skipped by `scheduleNames` before the count is printed, so the "3/5" the model
  reads is over servable slots and a skipped name cannot shift it.

A served slot is `TOOL metric <id>` executed by the harness, so the two reads cannot drift into two views of one
service, and it is recorded as **investigated**: a gate that refused an answer about a scheduled service would be
refusing evidence the harness itself handed over.

The free arm's prompt is byte-identical to the one every published number was taken under, and a test asserts it:

```
QUERY_SYSTEM_PROMPT       does not contain `TOOL next`
SCHEDULED_SYSTEM_PROMPT   = QUERY_SYSTEM_PROMPT + "\n" + SCHEDULE_TOOL_LINE
```

### 2.2 The product switch

`run-query-agent.ts` gained `--schedule none|engine`, defaulting to `none` so no earlier reading moves. The order it
walks is the verdict file's own `ranked` column — the same column a seed would read and the same width the artifact
carried, because a runner that recomputed an order would be scheduling a route no other artifact can reproduce. Every
row now records `scheduled: <width> | null`, beside `seeded`, so the two policies cannot be pooled by accident.

## 3. What a schedule is worth, at two prices

`npx tsx benchmarks/src/run-schedule-reading.ts --answers … --terms … --surface …`, on artifacts already paid for:

| width | extra budget | reachable of the 74 | ceiling | point estimate at 98.33 % |
| ----: | ------------ | ------------------: | ------: | ------------------------: |
| **5** | **none** | **29 (39.19 %)** | **2.04 pp** | **2.01 pp** (28.52 cases) |
| 10 | `--max-rounds 11` (2× model calls) | 40 (54.05 %) | 2.81 pp | 2.77 pp (39.33 cases) |

```
schedule reach at width 5 — 1 422 answers, 1 328 hits, 94 misses
  the 74 misses that never queried the culprit sit at: top 5 29, 6–10 11, 11–20 16, beyond 20 18, not in the pool 0
  inside the first 5: 29 of 74 (39.19 %) — a stated schedule reaches 2.04 pp of this corpus, and no more
  already queried it and still missed: 20 — a schedule cannot add these
  past the width: 45 inside the pool, 0 the pool never held
conversion on the investigations that DID query the culprit: 1 178 of 1 198 answered correctly (98.33 %)
  29 reachable × 98.33 % = 28.52 cases — 2.01 pp, a POINT estimate; 2.04 pp is the ceiling
```

The **ceiling** is structural: the misses whose culprit sits inside the first `width` positions, i.e. the ones a
schedule of that width would have queried. The **point estimate** applies the conversion — among the 1 198
investigations that *did* query the culprit, 1 178 answered correctly — and it is printed one line under the ceiling
because the two answer different questions. A reader who took 2.04 pp for an expectation would be claiming the 20
reasoning failures a schedule cannot touch.

The conversion's bias runs in the honest direction and is stated rather than corrected: a case the model chose to
investigate is not a random case, so 98.33 % is measured on investigations the model *wanted* to make. A schedule does
not change who the model is, only where it looks — which is exactly why that is the right conditioning — but the number
is a property of this artifact and not a law.

**The width-10 row is the honest version of 341's 2.81 pp.** It is reachable, and it costs a second model call per
case: 5 → 10 calls, so ¥0.0147 → ≈ ¥0.029 per case. Both readings are in the runner, one flag apart, because "what the
schedule buys for the budget already authorised" and "what the next five calls would buy" are two decisions.

### 3.1 The retrieval split, and why the field's "98–100 %" does not transfer

`--split-at 5` cuts the same corpus's `Retrieval@k` by the arm's own record:

```
retrieval at 5, split by what the arm's own record says it did
split           n   Retrieval@k   Rerank@1   hits
queried      1198       99.25 %    88.90 %   1178
unqueried     224       26.79 %    26.67 %    150
unrecorded      0     undefined  undefined      0
the two observed splits: 1249 of 1422 cases have the culprit inside the first 5 (87.83 %)
```

Three findings, in increasing order of consequence:

1. **The field's headline is one split of two.** `DecompRCA v2`'s "retrieval nearly solved (98–100 %)" is our **99.25 %**
   — on the population the arm actually investigated. On the population it did not, retrieval is **26.79 %**. A single
   number over the corpus (87.83 %) averages a solved problem with an unsolved one, which is why this is a split and not
   a refinement.
2. **The split is the mechanism.** `Retrieval@1` inside the queried split is 88.23 % and outside it 7.14 %: the arm looks
   where the engine points and spends its 1.888 distinct-service calls there. The misses it never investigated are
   therefore the ones the engine ranked third to fifth — exactly the slots a five-call schedule adds.
3. **The schedule is a selector, not a ranker.** Since the unqueried population is where retrieval fails, widening the
   *ranking* cannot reach it (the engine already ranked 29 of those 74 inside five); spending the *calls* on those
   positions can. That is the whole difference between the two levers this register keeps apart.

## 4. The instrument, and the defect it refused

`benchmarks/src/investigation-schedule.ts`, 36 tests, **100 / 100 / 100 / 100**; `query-agent-schedule.test.ts`, 17
tests over `TOOL next` and the loop that walks it.

Three properties are asserted rather than trusted:

* **Three miss populations, disjoint and exhaustive.** `queriedMisses + unqueriedMisses + unrecordedMisses = misses`,
  and the sum of the bucket counts is `unqueriedMisses`. A row with no `calls` column is in neither measured bucket —
  the defect 340's certainty census closed, in its third appearance.
* **`null` is not "infinitely far".** A truth the pool never held is `unreachable`, not position infinity: a pool
  failure cannot be fixed by any schedule, while a position of 21 can be fixed by a wider one.
* **Two numbers are never collapsed into one.** A test asserts `expected < reachableUnqueried` on the real reading, so
  a future edit that printed the ceiling as the estimate fails by name.

The dead branch this exposed is its own finding: `formatConversion` first guarded `cases === 0` on the point-estimate
denominator, which cannot be reached — `reachableUnqueried > 0` implies `cases > 0`, and the empty population returns
before that line. The guard is gone and the reason is written where it stood: an unreachable branch reported as
coverage is the shape this package refuses.

## 5. What this re-prices

| axis | population | reading now | verdict |
| ---- | ---------: | ----------- | ------- |
| reach — a schedule at the authorised budget | 29 of 74 (2.04 pp) | zero extra calls, zero extra tokens; the order is computable offline before any dispatch | **P0, runnable** |
| reach — a schedule at double the budget | 40 of 74 (2.81 pp) | 2× model calls per case, ≈ ¥0.029/case at the published rate | P1, priced |
| reasoning — queried and missed | 20 (1.41 pp) | a schedule cannot add these; this is the residue that needs a better reader | P1 |
| breadth — engine rank > 5 | 48 | the arm is free (`seeded: false` × 1 422); a seed it never reads cannot move it | retired |
| the "ten calls" reading of 341 | — | `maxToolCalls: 10` never binds; the wall is `maxRounds − 1 = 5` | **corrected** |

## 6. Falsifiers

1. **If the arm does not call `TOOL next`, nothing changes.** The schedule is a route the model may walk, not a harness
   that walks it; a run whose transcripts carry no `next` directive measures the prompt line's persuasive power and
   not the route's value. The artifact's `calls` column says which happened.
2. **If a scheduled run converts below 98.33 %**, the ceiling holds and the estimate falls by exactly that gap, and the
   next entry records the rate rather than re-quoting the ceiling. The 20 queried-and-missed cases are the prior for
   that number, not a surprise.
3. **If the 29 reachable cases do not move at width 5**, then position is not what decided the arm's attention — the
   1.888-distinct-service reading says it is, and the next entry records the refutation with its number instead of a
   wider schedule.
4. **If any of the 74 turns out to be a case whose culprit the engine ranked inside five but whose telemetry tools
   cannot describe** (a caller-only node, say), the reachable population shrinks by that case. `scheduleNames` filters
   the order against the case's own directory for exactly this reason, and the runner prints the skipped rows.

## 7. Reproduce

```bash
# both widths, from artifacts already paid for — no endpoint, no case re-run
npx tsx benchmarks/src/run-schedule-reading.ts \
  --answers /tmp/art328/query-agent.ndjson \
  --terms   /tmp/art328/terms.ndjson \
  --surface /tmp/art340/base-surface.ndjson            # width 5 (SCHEDULE_WIDTH)
npx tsx benchmarks/src/run-schedule-reading.ts … --width 10

# the budget the arm actually spends
jq -r .toolCalls /tmp/art328/query-agent.ndjson | sort -n | uniq -c

# the two position distributions in §1.2
python3 - <<'PY'
import json, statistics
order = {}
for l in open('/tmp/art328/terms.ndjson'):
    if l.strip():
        r = json.loads(l)
        order[r['datapack']] = [c['id'] for c in sorted(r['candidates'], key=lambda c: -c['score'])]
ans = {json.loads(l)['datapack']: json.loads(l) for l in open('/tmp/art328/query-agent.ndjson') if l.strip()}
surf = {json.loads(l)['datapack']: json.loads(l) for l in open('/tmp/art340/base-surface.ndjson') if l.strip()}
b = {'queried': [], 'unqueried': []}
for dp, s in surf.items():
    if s['correct']:
        continue
    a = ans[dp]
    truth = a['truth']
    o = order.get(dp) or []
    pos = next((i + 1 for i, n in enumerate(o) if n in truth), None)
    asked = any(c in truth for c in (a.get('calls') or []))
    if pos is not None:
        b['queried' if asked else 'unqueried'].append(pos)
for k, v in b.items():
    print(k, len(v), 'median', statistics.median(v), 'top5', sum(1 for x in v if x <= 5))
PY
```

## 8. Next

1. **P0, ¥0** — the run itself: `--schedule engine` over the corpus at the authorised budget, priced from the artifact
   that already exists (§3's ceiling is offline; the dispatch is the last step, not the first).
2. **P1, ≈¥2** — the double-budget arm (74 cases, `--max-rounds 11`), which converts 40 into a rate rather than a
   ceiling.
3. **P1, ¥0 — done in this iteration.** The `Retrieval@K`/`Rerank@1` split by the arm's own record is §3.1;
   `reach-decomposition.ts`, 18 tests, `100/100/100/100`.
4. **P1, ¥0** — whether `DecompRCA v2`'s "short system-description document" (+7…+18 points) can be derived from this
   corpus at all: the arm's brief is already written from case metadata, so the question is whether a *usage* description
   of the system exists anywhere in the artifacts or must be authored.

## 9. Field check, 342

Three movements, none of which changes a number here; two change what a comparison may claim.

* **ORCA Benchmark** (Traversal / Fireworks, updated 4 Nov 2026) — a **live-incident** hard-RCA ladder: 13 models,
  three passes, `avg@3`. Best is GPT-6 Astra at **50.2 %** ($4.00, 1 144 s per task), then Claude Opus 5 at 44.3 %
  ($5.33, 2 598 s), Kimi K3.1 Pro at 32.9 % ($0.71, 730 s); DeepSeek V4.1 Flash sits at **20.3 %** for **$0.17**.
  Live incidents are harder than injected ones, so this project's 93.39 % and ORCA's 50.2 % are **not comparable
  numbers**, and a table that put them in one column would be measuring the task. ORCA also varies the *model* and
  fixes the harness — the opposite trade to RCAtlas, which varies the harness and fixes the model class.
* **"Free to Look, Free to Reason"** now reports its method table: simple harnesses **65–77 % PR@1** over three
  mid-tier models, published LLM agents **16–53 %**, non-LLM methods **6–39 %**, random **5.5 %**; and its Pareto
  frontier over accuracy against *cost and time* has every optimal point on a simple harness. The overlap at the bottom
  is the fact to carry: **NSigma (38.9 %) beats DecompRCA and mABC**, so a statistical method with no model outranks two
  published agents.
* **The axis nobody scores.** CARE-PO counts *removable* calls, SRE-1 scores a cited chain, ORCA scores an answer at a
  price. **No public leaderboard scores the value of a call that was spent** — which is the axis this iteration prices.
  That is a gap in the measurement surface, not a novelty claim: the schedule's contribution can only be argued from
  this project's own artifacts, and the next competitor table must footnote it rather than rank us on it.

The column this project still owes is **wall-clock**: the archived per-case rows (`accepted, datapack, faultType, pool,
ranked, truthAnomalyBefore, truthRank`) carry no duration, so a cost/time Pareto point cannot be computed from them.

## 10. Pre-registration for the dispatch — written before the artifact exists

The run is `benchmark-agentic.yml` with `query_agent_sample=266, query_schedule=engine`, which is **532 cases**: every
one of the 266 cases the engine answers at rank ≠ 1, and 266 it answers at rank 1. The choice of 266 rather than a
round number is not cosmetic — it is the population that CONTAINS all 74, checked rather than assumed:

```
unqueried misses 74   with engine rank 1: 0   engine misses total 266
```

So the sample is exhaustive over the population this iteration is about, and its control stratum is the same size.

**H1 — the route is used.** Mean distinct services per investigation rises from the free arm's **1.888** to **≥ 3.0**,
and at least **50 %** of investigations carry one `TOOL next` in their transcript. Falsified if the mean stays below
2.5: the model read the line and chose the fleet read instead, which prices the prompt's persuasive power rather than
the route.

**H2 — the reach converts.** Of the 74, **≥ 10** (13.5 %) are repaired, i.e. the culprit is queried via the schedule and
the answer is right. Floor set at a third of the ceiling (29 × 98.33 % = 28.5), because a scheduled query is not the
same act as a chosen one and the 20 queried-and-missed cases are the prior for that discount. **< 5** is a failure of
the mechanism, not of the model.

**H3 — the route does not cost what it buys.** On the 266 engine-correct cases, the surface stays at **≥ 96 %** of its
published accuracy on that stratum. A schedule that repairs ten misses and breaks fifteen is a loss, and the
pre-registration says so before the number can be read as progress.

**The decision this pre-registers.** Net repair (repairs − breaks) **≥ 8 cases (0.56 pp)** justifies the full-corpus
dispatch; **< 3** closes the lever in the register with its number; between the two, the reading is "mechanism works,
magnitude insufficient" and the next step is a schedule of width ten with the doubling priced explicitly.

**What would falsify the *instrument* rather than the arm.** If `calls` in the new artifact records fewer services than
the transcript shows `next` directives, the recording rule is wrong (a served slot must be counted as investigated),
and the reading is void regardless of what the answers say.
