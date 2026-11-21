# What the log actually says: a truncated CSV, a serialized payload, and an I/O cause

**Status:** three defects found and repaired in one pass, and the two live ones were found only because the first
one was fixed. §4 is the four-state ablation and §5 is what is still wrong, case by case.

The RCAEval RE2/RE3 log channel is the only place the engine can see *who spoke and what they said*. Every
figure in this repository that involves `logic`, `err`, `stackTrace`, `deepestExceptionClass` or the log score was
computed through the code paths below.

## 1. The reader split on commas without knowing about quotes

RCAEval's `logs.csv` is `timestamp,container_name,message`, and the message is a **quoted** field whenever the
service emits JSON — which SockShop's and OnlineBoutique's services do constantly:

```
1705595459,front-end,"Posting Address: {""number"":""123"",""city"":""Paris""}"
```

The reader was `content.split('\n')` then `line.split(',')`. So that line's `message` became
`"Posting Address: {""number"":""123""` — cut at the first comma **inside the quotes**, with the tail handed to
columns that do not exist, and no error anywhere. Severity, stack-trace shape and exception class were then
derived from a prefix of what the author wrote.

## 2. How much was lost, counted rather than estimated

Twelve sampled cases, each file parsed twice — once the way the reader did, once with the replacement — comparing
record counts and measuring how many messages carry a comma:

| case                             | records  | rows the old reader produced | messages containing a comma |
| -------------------------------- | -------: | ---------------------------: | --------------------------: |
| `re2ss_carts_cpu_1`              |   86,592 |                       86,592 |                22,153 (25.6%) |
| `re2ss_orders_delay_3`           |   85,819 |                       85,819 |                21,913 (25.5%) |
| `re2ob_checkoutservice_disk_1`   |  171,176 |                      171,176 |                20,270 (11.8%) |
| `re2tt_ts-route-service_loss_2`  |  272,113 |                      272,113 |                85,455 (31.4%) |
| `re3ss_carts_f1_2`               |   85,307 |                   **91,197** |                25,634 (30.1%) |
| `re3ss_front-end_f3_1`           |   46,800 |                   **48,851** |                14,363 (30.7%) |
| `re3ob_emailservice_f1_2`        |   70,250 |                   **70,317** |                 7,577 (10.8%) |
| `re3tt_ts-auth-service_f1_3`     |   42,072 |                   **42,622** |                13,652 (32.5%) |

Two distinct corruptions, both silent:

- **truncation** — 11–32% of every sampled case's messages lost everything after their first comma. On the
  twelve cases measured, that is one message in four.
- **phantom rows** — RE3's messages carry embedded newlines inside quotes (a stack trace is one CSV record), so
  the old reader turned one record into several rows carrying a garbage timestamp and a garbage service.
  `re3ss_carts_f1_2` produced **5,890 rows that are not records** (6.5% of the file), every one of them
  attributed to whatever the split happened to leave in the service column.

The replacement (`packages/kinetic/src/benchmarks/loaders/csv-records.ts`) is byte-level and quote-aware:
per-cell UTF-8 decode, `""` unescaping, quoted commas and newlines kept inside their cell, CRLF, BOM, blank
lines skipped, ragged rows passed through, and lazy so a capped read stops at the cap. 22 unit tests, 100%
statement and branch coverage. It also removed the memory defect of
`docs/rcaeval-memory-bound.md` §7 as a side effect — a per-cell decode cannot pin the whole file.

## 3. The truncation had been MASKING a classifier defect

With faithful messages, `RE3:SockShop` fell from 19 of 30 cases to 15 of 30 (63.3% → 50.0% at case level, and
66.1% → 55.0% as published) and `RE2:SockShop` from 89 of 90 to 85 of 90. Case-level diffing (dumps on both
sides) named the winners: **every newly-wrong case predicts a victim**, never the injected service.

The reason is in the text the truncation had been hiding. Counted on the corpus:

```
re3ss_carts_f1_3   front-end  logic=290  (all of them relayed JSON)
re2ss_payment_loss_1 front-end logic=746  (all of them relayed JSON)
re2ss_payment_loss_1 orders    logic=373  (all of them "due to unspecified IO error")
```

and the two message shapes behind those counts:

```
front-end:  Order response: {"statusCode":500,"body":{"exception":"java.lang.IllegalStateException", …}}
orders:     Servlet.service() … nested exception is java.lang.IllegalStateException:
              Unable to create order due to unspecified IO error.
```

Both truncated to something with no class name in it. Both, once read whole, are counted as *the emitting
service's own* logic exception — 290 to 746 times per case, against a source that emits none at all.

### 3a. A serialized value is not a thrown exception

The first clause. The character **after** the class-name token decides it: a serializer must write a quote
(`"IllegalStateException"`, `'ValueError'`), a `toString()` cannot (`IllegalStateException: boom`), and a stack
frame writes `Class.method(`. So a match followed by a quote is a field of a document; anything else is an
occurrence in the text.

The walk matters: the classifiers match a FRAGMENT (`IllegalState` for `IllegalStateException`), so the check
must run past the end of the whole token, not the end of the match. That is the difference between the clause
working and looking like it works.

Implemented once (`hasThrownExceptionMatch`, `thrownMatches`) and used by every classifier —
`isLogicExceptionMessage`, `isHttpExceptionMessage`, `extractDeepestExceptionClass`, `extractExceptionNames`,
`classifyExceptionKind` — because a predicate that skipped quoted occurrences while the run's own census counted
them would make an artifact disagree with the score it explains.

### 3b. An exception that blames an I/O cause is not a programming error

The second clause. `orders` is not relaying a document; it is emitting its own framework wrapper around an
exception whose message names the cause:

```
Unable to create order due to unspecified IO error.        (373 rows in payment_loss_1)
Unable to create order due to timeout from one of the services.   (4 rows in user_loss_2, 1 in payment_loss_1)
```

`IllegalStateException` is on the logic whitelist, so the class alone credits a victim. The cause is the
discriminator: `due to` / `because of` / `caused by` followed by the corpus's own environmental vocabulary —
`I/O`, `IO`, `input/output`, `network`, `socket`, `connection`, `connect`, `timeout`, `timed out`, `unreachable`,
`unavailable`, `refused`, `reset`.

What the clause deliberately does **not** match is `nested exception is`. Every genuine RE3 source exception
arrives through that same dispatcher wrapper; a clause keyed on the wrapper would suppress the evidence the
signal exists for, and the tests pin that direction explicitly (`NullPointerException: null` inside the same
wrapper still counts).

The vocabulary is counted, not guessed, and one entry shows why the difference matters: `logNormalisation=max`
means a **single** logic entry, where every other service has none, takes the whole log score. The one
`due to timeout` row left in `payment_loss_1` after the first draft of the clause was enough to decide that
case — which is how `timeout` got into the list without a trailing `error`/`failure` noun.

## 4. What the clauses buy, measured

Four states, same host, same corpus, shipped flags, one cell per run. Every column is a **run of a patched
tree**, not a subtraction: `A` swaps in the upstream loader (`git show 4d8e852:packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts`),
`B` keeps the shipped reader with both clauses disabled, `C` re-enables 3a only, `D` is the shipped tree.

| cell                | A: old reader | B: faithful, no clause | C: + 3a | D: + 3a + 3b |
| ------------------- | ------------: | ---------------------: | ------: | -----------: |
| RE2:OnlineBoutique  |  93.1 (81/87) |           93.1 (81/87) |       – | 93.1 (81/87) |
| RE2:SockShop        |  98.9 (89/90) |           94.4 (85/90) | 94.4 (85/90) | **98.9 (89/90)** |
| RE3:OnlineBoutique  |  82.1 (23/28) |           85.7 (24/28) |       – | **85.7 (24/28)** |
| RE3:SockShop        |  63.3 (19/30) |           50.0 (15/30) | 56.7 (17/30) | **63.3 (19/30)** |

Cell figures are **case-level**; the published cells in `benchmarks/baselines/rcaeval-nine-cells.json` are the
per-fault-type average, which reads A 87.5 / D 90.0 on `RE3:OnlineBoutique` and 66.1 / 66.1 on `RE3:SockShop`.
Both readings are in the artifact; the case-level one is the honest one for an ablation because the fault types
hold unequal case counts.

What the columns say, one claim per number:

1. **3a alone recovers 2 of the 8 lost cases** — both in RE3:SockShop (50.0 → 56.7, 15 → 17 of 30).
2. **3b recovers the other 6** — 4 in RE2:SockShop (85 → 89 of 90) and 2 more in RE3:SockShop (17 → 19 of 30).
   The token walk alone leaves RE2:SockShop exactly where the unclaused reader left it, because the four cases
   there are decided by `orders`' I/O-cause rows, not by a quoted payload.
3. **The recovery is agreement, not a similar score.** Per-case `--loss-census` on both SockShop cells: the
   shipped tree predicts the *same* top-1 as the truncating reader on **120 of 120** cases — zero flips, in
   either direction — while the 8 cases the faithful reader had lost are precisely the ones recovered.
4. **Faithfulness alone pays for itself on RE3:OnlineBoutique** (+1 case, 23 → 24 of 28), and neither clause
   takes it back. So the repair's net effect against the truncating reader is **+1 case and no loss**.
5. **RE1 is untouched** — those cells carry no logs, so the loader's log path is never entered; they read
   90.4 / 95.0 / 90.0 before and after (`docs/rcaeval-memory-bound.md` §9). That is the control.

## 5. What is still wrong, named

Nothing on the cells this repair moved. The one remaining miss in `RE2:SockShop` is `re2ss_orders_delay_1`
(truth `orders`, predicted `shipping`), a **delay** case whose dominant metric is latency, so it is outside the
log channel altogether and was already wrong before this work.

The residual is `RE3:SockShop`, 11 of 30, and it is concentrated rather than diffuse: 7 cases whose truth is
`carts` and 4 whose truth is `orders`. The diagnostic dump for 10 of the 11:

| case              | truth  | predicted         | truth anomaly / max | truth rank | truth's dominant metric |
| ----------------- | ------ | ----------------- | ------------------: | ---------: | ----------------------- |
| `carts_f1_1`      | carts  | front-end         |      1.157 / 2.026  |  2 of 15   | error                   |
| `carts_f1_4`      | carts  | front-end         |      0.636 / 2.050  |  4 of 15   | diskio                  |
| `carts_f3_1`      | carts  | front-end         |      1.206 / 1.778  |  3 of 13   | error                   |
| `carts_f3_2`      | carts  | front-end         |      1.214 / 1.847  |  2 of 13   | cpu                     |
| `carts_f4_1`      | carts  | rabbitmq-exporter |      0.477 / 1.619  |  7 of 13   | error                   |
| `carts_f4_2`      | carts  | orders-db         |      0.483 / 0.570  |  2 of 12   | cpu                     |
| `carts_f4_3`      | carts  | rabbitmq-exporter |      0.538 / 1.573  |  3 of 12   | diskio                  |
| `orders_f3_3`     | orders | orders-db         |      1.280 / 1.482  |  2 of 13   | error                   |
| `orders_f4_1`     | orders | front-end         |      0.854 / 0.949  |  2 of 14   | error                   |
| `orders_f4_2`     | orders | carts-db          |      0.607 / 1.159  |  8 of 14   | workload                |

Three facts, and they say where the next iteration goes:

- **Retrieval is not the problem.** The truth is in the graph and in the pool in every one of the 11, ranked
  2nd–8th of 12–15.
- **The log channel is not wrong either.** The truth's own dominant metric is `error` in 5 of the 10 sampled —
  the source *is* lit. A **victim** is lit harder on the same channel: `front-end` fronts every failing call, so
  its error count is larger than the source's by construction.
- **The remaining misses are magnitude questions.** Truth anomaly 0.48–1.28 against a winner at 0.57–2.05.

So the candidate axes are the ones that separate a source from a victim that repeats it, and every one of them
already exists as a knob — which makes the next step a measurement rather than a build:

1. `topoPrecedence` (`off` → `onset`; ships `off`): an operator that reads the onset order and prefers the
   candidate that rose **first**. The diagnostics above say these are order failures — the truth is lit on the
   error channel in 5 of 10 and simply outvoted on magnitude — and this is the one existing term that reads order
   instead of size.
2. `victimWeight` (ships at `0`; at zero the symmetry map is not even built): PRISM's axiom as a bounded
   **discount** on a candidate's own evidence, `finalScore(v) −= victimWeight × (1 − symmetry(v)) ×
   log1p(selfAnomaly(v))`. Exactly the shape `front-end` needs, and it ships disabled for a measured reason:
   `prismWeight`'s six-arm sweep saw the additive form trade `RE3:TrainTicket` +9 against `RE1` −37. Any arm here
   is a two-cell measurement or it is not one.
3. `temporalWeight` (ships at `0`) with `onsetShape=earliness`: the same order information as (1), as an addend
   rather than as a precedence rule.
4. `dualFamily{Weight,Gate}` (0.25 / 0.25, `channel`): "two independent channels agree", which is the one shape a
   victim-driven error spike does not have.

Two axes are **not** on this list, and the reason is a measurement rather than a preference.
`logNormalisation` is a closed family: five arms were swept and every departure from `max` loses
(`docs/log-volume-scale.md`). And there is no `ratio` member of `LOG_SIGNAL_MODES` to switch to — its six members
(`count`, `novelty`, `logicHttp`, `logicHttpJoint`, `logicHttpDominant`, `all`) name **which** signals are
admitted, not how a count becomes a score. A clause that proposed either would be proposing a knob that does not
exist.

Rejected for now: a victim-shaped clause for `Request processing failed` **without** an environmental cause — it
would also suppress genuine RE3 sources, which arrive through the same wrapper.

The target is precise: 11 cases, one cell, three existing knobs, and an ablation that has to hold the other 8
cells flat.

### 5a. The first three arms, measured, and all three negative

Probed before writing the plan rather than after, on `ss:3` alone (30 cases), shipped defaults otherwise:

| arm | case-level AC@1 | published | Δ cases | what it says |
| --- | ---: | ---: | ---: | --- |
| shipped | 63.3% (19/30) | 66.1% | — | the residual as published |
| `--topo-precedence onset` | 63.3% | 66.1% | **0** | **inert at `topoWeight=0`**: the operator acts inside the topological deduction, and with the term switched off there is no vector for it to act through |
| `--topo-weight 0.2` | 60.0% (18/30) | 63.6% | **−1** | switching the term on at a fifth of a weight already costs a case |
| `--topo-weight 0.2 --topo-precedence onset` | 60.0% | 63.6% | −1 (vs shipped) / **0** (vs the weight alone) | the precedence operator changes **nothing** even with a live term — it is not the missing mechanism at this weight |
| `--victim-weight 0.1` | 60.0% | 63.6% | **−1** | the symmetry discount also costs a case at its first probe |

So the two order-shaped axes are not the answer at these magnitudes, and one of them is not the answer at all:
`topoPrecedence` is inert while `topoWeight` is 0, which is a property of where the operator lives rather than of
this corpus. What survives as a candidate is (a) a **magnitude sweep** of `victimWeight` under a two-cell guard —
the six-arm `prismWeight` sweep is the precedent for that shape of search — and (b) a mechanism that does not exist
yet: the error channel normalised by the service's own request volume, which is a new term rather than a knob.

Recorded here because a probe is a measurement, and the next iteration must not pay for it twice.

## 6. Reproduce

```bash
# the census of §2 (per case: records vs the rows the old reader produced)
npx tsx probes/log-census.ts /root/RCAEval-all/re2ss_carts_cpu_1 …

# the classifier clauses of §3, both directions
pnpm --filter @agentix-e/micro-kinetic test -- rcaeval-log-fidelity

# the cells of §4 (each state is a patched copy of the loader, restored afterwards)
npx tsx benchmarks/src/run-rcaeval.ts --data-dir /root/RCAEval-all --system ss --suite 2 --loss-census /tmp/c.jsonl
npx tsx benchmarks/src/run-rcaeval.ts --data-dir /root/RCAEval-all --system ss --suite 3 --loss-census /tmp/c.jsonl

# A: the upstream loader
git show 4d8e852:packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts > \
  packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts
# B: both clauses off — `yield match;` instead of the token walk, and drop `|| ENVIRONMENTAL_CAUSE_PATTERN…`
# C: 3b off only, keeping the token walk
```

Each state was measured on one cell per run, and the two states that a claim rests on were repeated: `D` on
`ss:2` twice, with **byte-identical** per-case censuses, and `A` on `ss:2` twice, 98.9% both times. The runner is
deterministic at this scale, which is what makes an 8-case movement attributable to a clause rather than to a
slice boundary.
