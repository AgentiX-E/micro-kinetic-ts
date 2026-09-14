# Adding per-edge latency evidence: feasibility and cost, before writing code

`docs/fse26-data-gap-verdict.md` lists two fields as dropped:
`attr.http.response.status_code` and the trace `duration`. Every signal tried on this
side of the benchmark has failed, and the register's reopening condition for that
axis is **new evidence** rather than a new use of old evidence — so this is the
candidate, and it is assessed here before any code is written.

## The framing is wrong: the fields are already read

`read_trace_edges` projects only `trace_id`/`span_id`/`parent_span_id`/`service_name`,
and its docstring says why (the engine needs the call graph, not the span list). But
the converter reads both fields already, for other outputs:

- `read_trace_derived_metrics` reads `duration` (converted ns → ms) and
  `attr.http.response.status_code`, and derives `http.server.request.duration` plus an
  error-rate series gated on status `>= 400`;
- `read_failed_trace_edges` uses `FAILED_STATUS_COLUMN = "attr.http.response.status_code"`
  and **already aggregates per edge**, with `group_by(["parent_service", "service"])`
  and `failed`/`baseline` counts either side of the injection.

So the gap is a **projection choice inside one reader**, not a missing input, a broken
export, or a pipeline change. The per-edge aggregation machinery this needs is
already written and already shipped.

## What the change is

1. extend the per-edge aggregation to carry a latency statistic per edge — the
   duration column is already in the same frame the `failed`/`baseline` group-by
   runs on;
2. widen the emitted edge row from `[caller, callee, failed, baseline]`;
3. bump `SCHEMA_VERSION` (3 → 4) and update the provenance digest — the record shape
   changes, and an old cache must not be read as a new one;
4. extend the loader and the engine's option type;
5. then, and only then, a signal.

## What it costs

The cache is built and published by `rcabench-data`'s workflow, which **clones this
repo at HEAD**, so any converter change requires a rebuild for the field to appear:

| path | cost | what it establishes |
| --- | --- | --- |
| **prefix rebuild** (`download_prefix_bytes`, already exercised: 500 MB → 7 min → 47 cases) | **~10 min** | whether the new observable separates source from victim, on a subset |
| full rebuild | ~3 h 17 m, of which 2 h 24 m is the cold-storage download | the benchmark number |

The prefix path is the reason this is affordable to test: **separability first, at
1/20th of the cost**, exactly as the last four candidates were settled. A prefix cache
cannot produce a comparable headline number, and it does not need to.

## The candidate it enables

The failed/baseline counts are a **count of failures**. A call that became *slow* but
still succeeded is invisible to them, and so is a case where no call failed at all —
which is 70 of the 291 stock cases and 160 of the 357 wrong cases in the last dump.

Per-edge latency is a continuous magnitude **measured by the caller about the callee**,
so it carries the same direction the failed-edge signal tried to encode, but it exists
where the counts are zero. Two properties make it worth the rebuild:

- it is a different observable, not a different transform of the same one, which is
  the only thing the register accepts as a reopening;
- it is attributed to the callee by construction (the caller wrote down how long
  *its* call took), so it needs no direction guess.

## The test, stated before the build

Take the prefix cache, run `--diagnose` over the affected types at the shipped config,
and ask the same question that settled the last candidate: **does the per-edge latency
rise separate the source from the victim?** Specifically, for the 58
`ts-ui-dashboard`-sourced cases and the JVMMemoryStress regressions, whether the
credited callee's inbound latency rise differs between the two populations. If it does
not, the field is recorded as measured-and-inert and the axis stays closed — for the
cost of one prefix rebuild rather than a full one.
