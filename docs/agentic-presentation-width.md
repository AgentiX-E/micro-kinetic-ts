# The presentation width — one flag, one artifact, and the arm it prices

`--fingerprint-top-k` widens the elimination fingerprint and changes nothing else. This document records the
instrument, the proof that it changes nothing else, what it already costs, and the arm it was built for.

## 1. Why the width needed an instrument at all

`docs/agentic-promotion-gate.md` §10 put the gate into the failure decomposition `Top@1 = Retrieval@K × Rerank@1`
and read three numbers off the FSE'26 corpus:

| quantity | reading |
| --- | ---: |
| `Retrieval@5` | 1 249 / 1 422 = 87.83 % |
| `Rerank@1 ∣ Retrieval@5` | 1 156 / 1 249 = 92.55 % |
| `Retrieval@20` | 1 310 / 1 422 = 92.12 % |

The first two say the presentable ceiling at width 5 is **87.83 %**, 2.17 pp below the published best. The third
says the ceiling at width 20 is **92.12 %**, above it. So "is the width axis real" is not a matter of taste: it is
the difference between a ceiling below the target and a ceiling above it, and it is answerable by one arm.

The arm has one requirement, and it is the only reason this flag exists: **the model has to be shown twenty
candidates.** The recorded nominations were asked at five (`DEFAULT_NOMINATION_OPTIONS.maxCandidates`), and a
prompt cannot be widened after the fact — the table is rendered from the fingerprint, and a five-wide fingerprint
has five rows.

## 2. Two ways to widen, and why only one of them is an arm

| | widen the RUN | widen the ARTIFACT |
| --- | --- | --- |
| what changes | `analyze(graph, 5)` → `analyze(graph, 20)` | a second pass at 20, for the dump only |
| `Top@1` | unchanged (positions 1 and 2 never differ) | unchanged |
| `Top@3`, `Top@5` | **can move** — a structural pass permutes the list it is handed | unchanged |
| `per-case` rows, terms dump, results file | different | **byte-identical** (verified, §3) |
| interpretable against arm G | no: two things moved | yes: one thing moved |

A width arm is differenced against arm G, and arm G's control is `1 156 / 1 422`. If widening the run also moved
`Top@5`, the two arms would differ by the presentation window **and** by the published answer, and no reading of
the delta would say which. So the flag widens the artifact.

## 3. The proof that it changes nothing else, and why a proof was needed

The first implementation did not work, and the way it failed is the reason this section exists.

`--fingerprint-top-k 20` produced a twenty-wide order and the run printed `requested width 20` — while the dump
it wrote held **7 110 candidates over 1 422 cases, exactly five each**. The width had a second owner:
`buildCandidateFingerprints` capped at `DEFAULT_FINGERPRINT_OPTIONS.maxCandidates = 5`, and the cap was applied
after the widest order the runner could hand it. The flag lost, silently, and the log printed the number it had
asked for.

> **This is `closed-axes-register.md` §307's shape one layer down.** There the missing input was a profile file
> the record could not see; here it was a default inside the consumer of the flag. In both cases the run reported a
> configuration it had not measured.

The cap is removed rather than passed through: the builder now carries **the order it is given**, so the width has
exactly one owner — the caller's slice — and `--fingerprint-top-k` is the only way to state it. The builder's own
test counted candidates before this and counts them still; what changed is that it now asserts *every* candidate of
the order is carried, which is the assertion that would have caught the defect.

With one owner, the instrument was verified by running both widths and comparing the artifacts:

| artifact | width 5 | width 20 | |
| --- | --- | --- | --- |
| `per-case.ndjson` | `2778b294de9f…` | `2778b294de9f…` | identical |
| `terms.ndjson` | `4b1dadd057f4…` | `4b1dadd057f4…` | identical |
| `results.json` | `068d1af8d96f…` | `068d1af8d96f…` | identical |
| `Top@1` / `Top@3` / `Top@5` | 1 156 / 1 228 / 1 249 | 1 156 / 1 228 / 1 249 | identical |
| `fingerprints.ndjson` | 7 110 candidates | **28 440 candidates** | 20 per case |

That is the check a reader should demand: not "the flag should not affect the ranking" but "two runs that differ
only in this flag wrote the same three files to the byte".

## 4. What the widened population does and does not move

The dump is the engine's answer **at that width**, and a structural pass (`containmentOrder`, the failure flow)
permutes *the list it is handed*. So the widened order is not "the published five plus fifteen": it is a second
permutation of a longer list.

| comparison, width 5 vs width 20 | cases |
| --- | ---: |
| position 1 differs | **0** |
| position 2 differs | **0** |
| first difference at position 4 | 2 |
| first difference at position 5 | 15 |
| **any of the first five differs** | **17** |

Seventeen cases in 1 422 — 1.2 % — and the same 17 that `agentic-promotion-gate.md` §9.3 found between the
five-wide fingerprint and the fifty-wide terms dump, at the same positions. It is a property of the width, not of
either writer.

Two consequences, both stated rather than discovered later:

- **The control is untouched.** `engineOrderOf` reads the array order, whose first element never differs, so a
  gate-off arm over this population reads `1 156 / 1 422` — the same number as arm G's.
- **The prompts are not identical to arm G's.** On those 17 cases the model is shown a table whose rows 4 and 5
  are in a different order. The arm therefore varies the window *and*, on 1.2 % of the corpus, the order of the
  last two rows it can see. That is disclosed here because a reader who assumed the prompts were a strict
  superset would be reading a cleaner experiment than the one that ran.

## 5. What it costs

The preregistration estimated `~4.0 M` prompt tokens from the width-5 measurement of 2 743–2 876 tokens per case.
That estimate assumed the per-case cost was a constant of the corpus. It is not: **it is a function of the table**,
and the table is what the flag changes.

| | width 5 | width 20 |
| --- | ---: | ---: |
| table rows over the corpus | 63 897 | 255 181 |
| ratio | 1.00 | **3.99** |
| measured prompt tokens per case | 2 772 mean (median 2 777) | — |
| projected prompt tokens per case | — | ~11 071 |
| projected total, 1 422 cases | 3.94 M | **15.74 M** |

So the arm costs about **4×** what was registered, and the error is the same one this line of work keeps making:
a quantity measured at one width, applied at another. It is corrected here rather than at the end of the arm,
because the point of pricing an arm before dispatch is to be able to decline it — and at `deepseek-chat` pricing
this one is ~$4.6, which is worth paying for a 4.3 pp ceiling difference, but only while the number is stated
honestly.

## 6. The flag, as a user of this project sees it

```bash
# the shipped width: an artifact of five candidates, the width the run publishes
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> \
  --fault-free-profile <profile> --fingerprint-out fingerprints.ndjson

# a wider artifact, and NOTHING else about the run changes
pnpm exec tsx benchmarks/src/run-fse26.ts --data-dir <corpus> \
  --fault-free-profile <profile> --fingerprint-out fingerprints.ndjson \
  --fingerprint-top-k 20
```

| value | meaning |
| --- | --- |
| absent | 5 — the width the run publishes, and the code path that existed before the flag |
| `n` | the first `n` candidates of the engine's total order, or a second pass at `n` when `n` exceeds it |
| `0` | every candidate — the same sentence `--containment-depth` uses for the same word |
| negative / fractional / non-numeric | refused by name, not clamped |

`--fingerprint-top-k` without `--fingerprint-out` is refused, because a width that widens no file is a flag that
does nothing: an arm dispatched that way would read a five-wide artifact and report the width it asked for.

## 7. What this instrument does not do

- **It does not widen the ranking.** There is no flag that does, and this document is the reason: a run whose
  published width could be dispatched would print `Top@5` for a five-wide answer and a five-wide answer for a
  twenty-wide one.
- **It does not change the prompt's channel budget.** `maxChannels` stays at eight, so a wider table is a table of
  more rows and not of richer ones. An arm that varied both would be two arms.
- **It does not make width free.** Sixty-one cases in this corpus have their answer at ranks 6–20 and 112 at rank 21
  or deeper; the first group is what a width-20 arm can reach and the second is what no width this side of 50 does.
