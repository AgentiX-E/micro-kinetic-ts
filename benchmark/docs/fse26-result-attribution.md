# The result artifact must carry the configuration that produced it

> Status: **closed** for the FSE'26 benchmark. A result artifact that omits a
> field which changes the number is not a weaker artifact, it is an
> **unattributable** one: two runs can be compared, diffed and cited while the
> difference between them is invisible.

## The defect, as measured

The runs of 2026-09-11 published:

| run | `log_mode` | Top@1 | `config` block in `fse26-results.json` |
|---|---|---|---|
| 34604119657 | `count` | 23.1% (328/1422) | `{"logWeight":1,"rankNormalization":true}` |
| 34604105028 | `logicHttp` | **47.3%** (673/1422) | `{"logWeight":1,"rankNormalization":true}` |

The two `config` blocks are **byte-identical**, and the numbers differ by
24.2pp. The log-signal mode — the single most consequential field, and the one
the whole reporting-integrity investigation of 2026-09-11 turned on — was absent
from the machine-readable artifact. The `dropMetrics` ablation was absent for
the same reason, so an ablated run was indistinguishable from a full one too.

The text report was fine: its header line printed `logMode=…`. The two
renderings of the same configuration were written out **independently**, a few
lines apart, in `run-fse26.ts`:

```ts
console.log(`Config: logWeight=${opts.logWeight} logMode=${opts.logMode} rankNormalization=${opts.rankNormalization}`);
// ...
config: { logWeight: opts.logWeight, rankNormalization: opts.rankNormalization },
```

Nothing could check them against each other, because both sat inside `main()` —
which runs on import and cannot be called from a test. That is the same shape as
the earlier defect where a workflow `default` duplicated a runner `default`: a
decision with two copies and no execution path between them.

## The fix

- **One object, both renderings.** `FSE26RunConfig` holds every field that can
  change the number; `run-fse26.ts` builds it once and passes it to
  `formatFSE26ConfigLine` (the header) and to `buildFSE26Report` (the JSON).
- **Completeness is a type error, not a convention.** `buildFSE26Report` takes
  `config: FSE26RunConfig`, so the previous partial literal no longer compiles at
  the call site. The regression guard is the compiler.
- **The assembly moved out of `main()`** into `benchmarks/src/fse26-report.ts`,
  so it is testable. This is what makes the guard above meaningful: an
  unverifiable object could always drift again.
- **A reusable audit for artifacts that already exist.**
  `missingReportedConfigFields(config: unknown)` reports which required fields a
  record omits. It takes `unknown` deliberately — its input is a JSON file read
  back from a workflow, so describing it with a type that assumes the answer
  would defeat the purpose. Run against the two artifacts above, it reports:

  ```
  run 34604105028: missing attributable fields: [logSignalMode, dropMetrics]
  run 34604119657: missing attributable fields: [logSignalMode, dropMetrics]
  ```

- **The diagnostic block names its mode.** `DIAG … services=N logMode=logicHttp`.
  The block's per-service `logic` and `http` counts are *gated* by that mode, so
  a block lifted out of a log — which is exactly what a diagnosis does — was
  previously unreadable on its own. The field is required, not optional, so a
  producer cannot omit it; a parser treats an absent mode as `''` so an older
  dump is detectable rather than silently accepted.

## The generalisable rule

**An artifact must carry every input that changes its output.** The test for
"every" is not taste, it is counterfactual: for each configuration field, ask
whether some alternate value would change the published number. `logMode` (24.2pp),
`dropMetrics` (an ablation), `logWeight`, `rankNormalization` all pass that test;
`dataset` and `anchor` are constants of the harness and do not.

Two corollaries, both of which bit here:

1. **Rendering the same thing twice is a defect waiting to fire.** If two outputs
   both describe the configuration, they must be derived from one object and a
   test must be able to compare them.
2. **Anything assembled inside `main()` cannot be checked.** Extracting a pure
   builder is not tidiness; it is what makes the guard possible.

## Verification

- 12 new tests in `benchmarks/__tests__/fse26-report.test.ts`, including the
  verbatim published `config` block pinned as unattributable
  (`['logSignalMode', 'dropMetrics']`) and a test that the header line and the
  JSON config report the same four fields.
- 1 new test in the diagnostic formatter's suite pinning that the block renders
  the mode it was produced under.
- `pnpm typecheck`: 0 errors over 15 nx projects plus the workspace project.
- lint 0/0 over 280 files; format:check green; benchmarks 89 → 101 tests.

The regression-set analysis that this unblocks is in
`docs/fse26-logicHttp-regression-diagnosis.md`.
