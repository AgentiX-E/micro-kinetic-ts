# The shipped default's owner — the class that was closed one instance at a time

## What this document is

`DEFAULT_LOG_WEIGHT` was extracted when the log weight was found to be a bare `1.0` in four files.
`DEFAULT_LOG_SIGNAL_MODE` was extracted one option over. `DEFAULT_TRACE_WEIGHT` was extracted third, and its
own docblock says so — *"the THIRD instance of the class"*. Three iterations, three hand-fixes, each of the
instance somebody happened to notice, and a **count kept in prose** — which is the shape
`docs/closed-axes-register.md` names as law 16: *a comment that COUNTS a growing list is a copy the list does
not own.*

This document is what replaced the count. It is a **census**, it was run against the tree as it stood before
iteration 98, and it found the class still had **nineteen declaration sites across twelve knobs**.

The class itself is one sentence: **a value declared in more than one file must be declared by NAME, and the
name must be the owner's.** The failure it prevents is not a wrong number — it is that *two copies agree until
the day they do not*, and nothing can see the day. The observable consequence, already recorded once for
`traceWeight`, is that a workflow input's description cannot quote its default as a number because there is
no constant to read one from.

## Finding 1 — the size of the class, measured rather than counted

`packages/kinetic/__tests__/unit/ranking-default-owners.test.ts` reads each parser's option object out of its
source text, resolves every declaration of an engine-owned key against the engine's own exported defaults
table and the package's own export namespace, and reports the sites that are neither. Reverted to the commit
that preceded iteration 98 (`git checkout`, md5-verified), it reports:

| file | declarations of an engine default that repeat it |
| --- | ---: |
| `benchmarks/src/fse26-cli.ts` | **11** |
| `benchmarks/src/rcaeval-cli.ts` | **8** |
| **total** | **19**, over **12 distinct knobs** |

The twelve: `traceWeight`, `topoWeight`, `collisionWeight`, `prismWeight`, `collapseDiscount`,
`suppressIdleTransients`, `suppressNearZeroBaselineRise`, `metricRiseCeiling`, `metricFleetBaseline`,
`failedEdgeWeight`, `failedEdgeMinRecords`, `logSignalMode`.

**Six of them had no owner at all** — `topoWeight`, `collisionWeight`, `prismWeight`, `collapseDiscount`,
`suppressIdleTransients`, `suppressNearZeroBaselineRise` — each a bare literal in the engine's own defaults
table **and** in both parsers' option objects. That is eighteen sites, zero names, and both workflows'
descriptions already quoted the numbers at a reader.

## Finding 2 — the class's own third instance was closed for three of its four owners

`DEFAULT_TRACE_WEIGHT`'s docblock states the class exactly: *"It shipped as a bare literal in **four** places
— the engine's own `DEFAULT_TREE_PRUNER_OPTIONS`, each parser's field default, and each parser's
`parseWeight` fallback — none of which was a name."* Iteration 97 added the constant and moved the fallbacks
and the descriptions onto it. **Each parser's field default was left as a bare `0`**
(`rcaeval-cli.ts:362`, `fse26-cli.ts:395`), and the same docblock claims *"One owner for the value"*.

Nothing could see it, and the reason is worth keeping: the guards written in that iteration read the
`parseWeight` **fallback** (`not.toMatch(/parseWeight\([^;]*,\s*\d/)`) and the workflow **description**'s
number. The field default is neither. It is the value the **no-flag path** resolves to — the path every
published number was measured through — so the site that mattered most was the one site no fence read.

Two of the nineteen violations belong to this, and they are the finding rather than an instance: **a closure
that names its own four owners and fixes three of them is a closure whose count was never recomputed.**

## Finding 3 — one of the names was owned by the wrong package

`failedEdgeMode`'s shipped value `'sum'` had **four** sites: the engine's defaults table, the function that
defaults it (`computeFailedEdgeScores`, in `ranking-signals.ts`), the FSE'26 runner's option object, and that
runner's malformed-argument fallback. Its one name, `DEFAULT_FAILED_EDGE_MODE`, was exported from
**`benchmarks/src/fse26-cli.ts`** — the package that does not own the value — while the TYPE it is typed by
(`FailedEdgeMode`) and the function that defaults it live in `packages/tree`. A reader could reach a name for
this value and still not reach its owner.

`failedEdgeMinRecords` had the same shape without even the consolation of a name.

Both owners now live beside the type in `packages/tree/src/pruning/ranking-signals.ts`, which is also the only
legal home: `pruner.ts` already imports from that module, so a constant placed in `pruner.ts` could be read
back by `computeFailedEdgeScores` only through a cycle.

## Finding 4 — the description guard's population was a PHRASE, and four rows were outside it

`fse26-reported-config.test.ts` carries a table of inputs whose description quotes the runner's shipped value,
and a population guard whose stated purpose is *"this keeps it honest: an input claiming 'the runner default,
which is &lt;something with a digit&gt;' must be in the table or fail the suite."* The predicate was that
phrase:

```
/runner default, which is (?!empty)[^)]*\d/
```

Four inputs state the same claim in the other words the workflows also use — `empty = the runner default, the
SHIPPED 0 = disabled` — and were therefore **outside the population**: `topo_weight`, `collision_weight`,
`prism_weight`, `collapse_discount`. None was ever registered, and that is why `trace_weight`'s own comment
could call itself *"the LAST input in this workflow whose default could not be stated as a NUMBER"* while four
rows beside it were in exactly that state.

**A fence whose population is a phrase can only see rows that use the phrase.** The population predicate is
now the workflow's own convention for stating a default — the `empty =` clause — and it is asserted per
workflow, so the counted set went from **15 registered rows to 41**, covering every input in both workflows
that states a default.

## Finding 5 — the guard's own table carried two bare literals

`DESCRIBES_SHIPPED` — the table whose existence is the argument against literals — contained
`failed_edge_weight: 0`, `failed_edge_min_records: 1` and `diagnose_limit: 3` as bare numbers, because none of
the three had an owner to read them from. All three do now (`DEFAULT_FAILED_EDGE_WEIGHT`,
`DEFAULT_FAILED_EDGE_MIN_RECORDS` in the engine; `DEFAULT_DIAGNOSE_LIMIT` beside `SERVICE_FIELD_DECIMALS` in
the module that renders the blocks it caps), and every row of the table is now derived from its owner —
`String(DEFAULT_LAT_WEIGHT)`, `DEFAULT_RANK_NORMALIZATION ? 'ON' : 'OFF'` — so a constant can move and the
table follows.

## Finding 6 — the input whose drift cost 24.2pp did not name its own default

`log_mode`'s description read *"empty = the runner default, which is **the best-measured mode**"*. The value is
`logicHttp`, and `DEFAULT_FSE26_LOG_MODE` has owned it all along. This is the input whose drift — a workflow
defaulting `log_mode: count` against a measured best of `logicHttp` — is the incident this entire family of
guards exists for, and **it was the one row the guard could not check**, because "the best-measured mode" is a
phrase no assertion can compare against a constant.

The same input has a second description in the golden workflow, and that one has always said the shipped
value out loud. **One input, two descriptions, one of them checkable** — `no_rank_normalization`'s FSE'26
description said `(empty = the runner default).` while its golden counterpart said `which is ON`.

Both descriptions now name their value, and the guard fails on both of the previous texts.

## Finding 7 — the whole-description check is unsound for every string-valued option

Registering four string-valued rows exposed a second `toContain('0')`, one regime over. The first version of
the check looked for the token anywhere in the description, and reported `log_mode` as satisfied by its
**pre-98 text** — which contains `logicHttp` as a **vocabulary definition**:

```
(empty = the runner default, which is the best-measured mode; count = …; logicHttp = logic + framework HTTP; …)
```

A string-valued option's description necessarily lists the option's own union, so containment cannot tell a
definition from the default. The check now looks inside the **claim clause** — the text between `empty =` and
the end of that clause — and the two rows whose description names its value *outside* the clause
(`failed_edge_mode`, which names `sum` first; `latency_view`, which names `shipped` first) are admitted by a
declared map with a reason, so the tight window is the default and widening it must be asked for.

## Finding 8 — an alias is a name, not an owner

`DEFAULT_RCAEVAL_LOG_SIGNAL_MODE` was one line — `= DEFAULT_LOG_SIGNAL_MODE` — exported beside the parser,
used twice inside it, and imported by nothing. The record counted it as an owner because it is a name. The
census resolves names, so it reported it, and the resolution is the honest one: **an alias resolves to another
name, not to a value.** The alias is deleted; both sites read `DEFAULT_LOG_SIGNAL_MODE`.

## The change, and why the acceptance is exact

Engine side: `DEFAULT_TOPO_WEIGHT`, `DEFAULT_COLLISION_WEIGHT`, `DEFAULT_PRISM_WEIGHT`, `DEFAULT_RISE_WEIGHT`,
`DEFAULT_FAILED_EDGE_WEIGHT` (`pruner.ts`); `DEFAULT_FAILED_EDGE_MODE`, `DEFAULT_FAILED_EDGE_MIN_RECORDS`
(`ranking-signals.ts`); `DEFAULT_COLLAPSE_DISCOUNT`, `DEFAULT_SUPPRESS_IDLE_TRANSIENTS`,
`DEFAULT_SUPPRESS_NEAR_ZERO_BASELINE_RISE`, `DEFAULT_METRIC_RISE_CEILING`, `DEFAULT_METRIC_FLEET_BASELINE`
(`topology-fault-graph.ts`); `DEFAULT_DIAGNOSE_LIMIT` (`fse26-diagnose.ts`). The two defaults tables are now
**exported** (`DEFAULT_TREE_PRUNER_OPTIONS`, `DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG`), because their privacy is
the root cause of the class rather than an incidental fact: a parser needs the shipped value for its own field
default and for its malformed-argument fallback, and a private table leaves it no way to read one — so it
wrote the number again.

Benchmark side: every one of the nineteen sites reads a name, plus the three `Number.isFinite(...) ? x :
literal` fallbacks in `fse26-cli.ts` (`metricRiseCeiling`, `failedEdgeMinRecords`, `failedEdgeWeight`).

**The acceptance is exact rather than argued.** Every literal these names replace already held the same
number, so nothing can move: the golden nine cells and the whole `signals:` line are byte-identical, and the
change's own dispatch is a confirmation rather than a measurement. What the names buy is that the class can no
longer grow one instance at a time — the census requires the property of every knob declared in more than one
file, and it fails on the pre-98 tree with nineteen findings.

## What this does not claim

The census's population is the intersection of the engine's two defaults tables with the two parsers' option
objects. A knob that is declared in the engine and in a **third** file — a DI container, a factory, a search
harness — is outside it, and the two tables' union is checked for one key owned twice (which the census raises
on) but not for a reader that hard-codes a value without declaring it as a default. The description guard's
population is the `empty =` clause, so a description stating its default with no such clause is outside it:
`shard_tag` and `ranking_knobs` are today's two, and both are named in the test rather than left implied.

## Acceptance, VERIFIED on the run this iteration's source triggered

Run **`38384459815`** (Benchmark — RCAEval Full Dataset, `62f8dbf`, **conclusion `success`**). Nine cells,
read from the AVERAGE column of each suite's own table:

| suite | OnlineBoutique | SockShop | TrainTicket | recorded |
| --- | ---: | ---: | ---: | --- |
| RE1 | **80.0%** | **92.8%** | **68.0%** | 80.0 / 92.8 / 68.0 |
| RE2 | **86.7%** | **92.2%** | **71.1%** | 86.7 / 92.2 / 71.1 |
| RE3 | **80.0%** | **45.0%** | **51.1%** | 80.0 / 45.0 / 51.1 |

**Nine of nine byte-identical**, and so is the whole `signals:` line in all three suites — the full shipped
configuration, with the RE3 job's own `--trace-weight 1` pin the only token that differs between the halves
(`stabilityWeight=0.007352 collisionWeight=0 topoWeight=0 logWeight=1 logSignalMode=count latWeight=0.561495
latMinRise=10.3 poolMetricPenaltyWeight=0.0679 collapseDiscount=0 traceWeight=0 prismWeight=0
prismPooling=additive rankNormalization=true anomalyNormalizeNodeThreshold=20 suppressIdleTransients=false
suppressNearZeroBaselineRise=false temporalWeight=0 onsetShape=earliness`). That is the acceptance this
iteration claimed **by construction**, and it is now measured rather than argued.

**Two supporting readings came back with it, and both reproduce a recorded mechanism rather than merely
passing**: RE1's `log-routes` reads `read 0` on all three systems — the exact control `docs/log-channel-mechanism.md`
names for the log gate — and RE3-TrainTicket reads `VERDICT: GATE BLIND — 12313 rows retained in 30/30 cases and
the mode's source-signature gate admits NONE of them — composed of 68 propagated / …`, which is it.92/93's gate
finding on the same numbers.

**And one correction to the reporting of this run**, recorded because it is this project's own recurring class:
the first pass over the RE1 and RE3 tables read the **first percentage** it saw in the AC@1 row and reported
`83.3%` for RE3-OnlineBoutique against a recorded `80.0%` — a false discrepancy. The AVERAGE column is the
**last** one, and `83.3%` is a per-fault-type column. The artifact makes this avoidable: every table carries
its own header row, and the header is the thing to read before the number.
