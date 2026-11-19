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
| producer | `writePerCaseVerdicts`, `formatPerCaseVerdict`, `poolColumns`, `PER_CASE_RANK_LIMIT` (`benchmarks/src/fse26-per-case.ts`) |
| dispatch | `--per-case-out fse26-per-case.ndjson` in `Run FSE'26 benchmark`, uploaded with the other artefacts |
| reader | `scripts/compare_fse26_per_case.py` (`load`, `flips`, `per_type`, `render`) |
| tests | `scripts/test_compare_fse26_per_case.py` (17 cases, 100% branch), `benchmarks/__tests__/fse26-pool-columns.test.ts` |

## Iteration 310: three columns, because a five-wide row cannot say WHY the truth was missing

The file above answers "what did the engine answer". It could not answer "**was the truth in the pool at all**",
and the difference is not academic: measured on the control of iteration 310 (shipped configuration, 1 422 cases,
`$0`), **173 of 1 422 truths sit beyond rank 5** — 12.2 % of the corpus — and every one of them was written as
`absent` in exactly the same shape as a truth the topological deduction had deleted. The corpus whose published
cell every arm is scored against could not distinguish a deletion from a miss, which is why four arms on the
deduction operator were read by watching totals move instead of by reading a mechanism.

The same control also fixes the population the three columns describe, and two of its numbers belong here because
they bound what a future reader can conclude: the order holds **49 or 50 candidates** on a 50-node tree, and the
count of truths at `truthRank: 0` is **zero**. So on this corpus the pool is the graph minus the one node at a
*unique* minimum — and the reason it is a unique minimum, and why the deduction cannot create a second one, is
`docs/pool-admission.md` §10.

Three columns close it, written after `ranked` and in this fixed order:

```json
{"datapack":"ts0-mysql-container-kill-9t6n24","faultType":"ContainerKill","accepted":["mysql"],
 "ranked":["mysql","ts-ticket-office-service","ts-train-service","ts-auth-service","ts-security-service"],
 "truthRank":1,"pool":49,"truthAnomalyBefore":0.40816326530612246}
```

| column | what it is | what its absence means |
| --- | --- | --- |
| `truthRank` | the best rank among `accepted` over the **whole** order, `0` when the pool held none | the row predates the column → `unmeasured` |
| `pool` | how many candidates the order held — the set the deduction decided | same |
| `truthAnomalyBefore` | the accepted answer's anomaly **before** the deduction, `null` when no accepted id is a graph node | same |

Read against zero, they are the split `classifyTruthAbsence` already took on the RCAEval half: `truthRank: 0` with
`truthAnomalyBefore > 0` is `explained` (the operator deleted a node that had moved), `0` with `0` is `silent`
(the origin never deviated), a positive `truthRank` is `ranked` at a measured depth, and `null` is `not-in-graph`.

Three properties are load-bearing and each is pinned by a test:

1. **The order is taken at the pool's width, not the reporting width.** `analyze` is called with
   `max(PUBLISHED_TOP_K, |nodes|)`, and `ranked` is still the five-wide prefix. The published numbers are unchanged
   by construction — the control of iteration 310 reproduces **1 156 / 1 228 / 1 249** to the case — and the
   presentation dump's `published` field is sliced at the published width for the reason it exists: a dump that
   silently widened would break the join it was built to make.
2. **A column the row does not carry is not written.** A caller with no graph builds a re-serialisation or a
   fixture; a `0` on its behalf would report a measurement ("nothing moved") where the truth is an absence.
3. **`null` is a value and is written.** It says none of the accepted ids is a node of the graph, which is a
   different fact from the column being missing — and the parser refuses anything else by line number, so a row the
   format would never have written cannot be scored as a case with an odd answer.

An archived four-field file still parses, which is what keeps every number this repository has published
re-readable, and `parsePerCaseVerdicts` answers `undefined` for the three columns rather than inventing a zero.
