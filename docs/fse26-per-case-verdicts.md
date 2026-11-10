# The verdict file: an average that can be re-scored, and two runs that can be compared as cases

**Iteration 258.** `perFaultType` counts are the unit every table in this repository quotes, and they cannot
distinguish two runs that differ by a swap:

| | gained | lost | a count table reports |
| --- | --: | --: | --- |
| run A | 2 | 0 | `+2` |
| run B | 2 | 2 | **`0`** |

Run B is not a stale copy of run A's number, it is a different result, and this project has already paid for
confusing the two: iteration 257's joint arm moved `TREND` and `CV` in opposite directions, printed `+2 − 2 = 0`,
and the decision that followed (`anomalyCvWeight = 0` is not shipped) rested on fault-type rows rather than on the
aggregate. The per-case verdict file is what makes that reading available without a second dispatch.

## The capability existed and was not published

`run-fse26.ts` has taken `--per-case-out` since the judgement question came up, and the workflow never passed it.
The census in `packages/kinetic/__tests__/unit/dispatch-surface-census.test.ts` had it listed as an
operational flag no workflow reaches, with this reason:

> an output path the workflow does not read back, and the FSE'26 dispatch needs no second file because the
> ranking it exports is the one the run already counted.

Both halves were wrong. The file is not a convenience — it is the only artefact that lets a published average be
(a) re-scored under a judgement chosen after the run (`Top@1` vs `Top@3` over the same bytes, see `--depth`) and
(b) compared with another run **case by case**. The census caught the change on the first push that wired the
flag, and the entry is removed rather than reworded: that list only moves by removal when a flag becomes
reachable.

## What the artefact now carries

One JSON line per case, in scoring order:

```json
{"datapack":"ts2-mysql-pod-kill-xvzmxb","faultType":"PodKill","accepted":["mysql"],"ranked":["mysql","ts-admin-order-service","…"]}
```

`accepted` is the corpus's own label set, `ranked` the engine's first five, and there is no stored judgement: a
reader computes `Top@1`, `Top@3` or `MRR` from the same file, and two engines' files are comparable row by row.

## Reading two runs as cases

```
python3 scripts/compare_fse26_per_case.py base=fse26-per-case.ndjson arm=fse26-per-case.ndjson --depth 1
```

It reports `gained`, `lost`, the cases present in only one run (EXCLUDED, because a corpus difference is not a
flip), and a per-fault-type table with `gained` and `lost` in separate columns. The section that matters is the
last one:

> **NET-ZERO BUT NOT IDENTICAL** names every fault type whose count is unchanged and whose case set is not.

That sentence is the one this repository could not write before this iteration, and the caveat in
`docs/pod-state-term.md` §11 — "twenty-one fault types did not move at the count level, which is not the same
sentence as *no case moved*" — is now a measurement rather than an apology.

## Where it is owned

| layer | symbol |
| --- | --- |
| producer | `writePerCaseVerdicts`, `formatPerCaseVerdict`, `PER_CASE_RANK_LIMIT` (`benchmarks/src/fse26-per-case.ts`) |
| dispatch | `--per-case-out fse26-per-case.ndjson` in `Run FSE'26 benchmark`, uploaded with the other artefacts |
| reader | `scripts/compare_fse26_per_case.py` (`load`, `flips`, `per_type`, `render`) |
| tests | `scripts/test_compare_fse26_per_case.py` (17 cases, 100% branch) |
