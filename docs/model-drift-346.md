# The arm that was not an arm: a 236-case drift between two days, and three published signs that must flip

This entry exists because a run was read instead of trusted. Iteration 345 dispatched an arm, the job log said
`onset onset`, the flag parsed, 532 rows were written — and `err=` appears in **0 of 532** transcripts. The parameter
was never passed. `runQueryAgent` had gained an eleventh argument and its one call site still passed ten, so the arm
that ran was a **plain free arm**.

That mistake is cheap. What it exposed is not.

## 1. The same arm, the same ids, two days apart

The 345 run is a free arm by construction: `--schedule none --fleet-order none --evidence-order` absent. On the same 532
ids as every arm since 342b:

| arm                                     | when                | agent Top@1 |      share |
| --------------------------------------- | ------------------- | ----------: | ---------: |
| free                                    | 2026-11-23 09:21    |     **414** | **77.82 %** |
| schedule (342b)                         | 2026-11-24 14:27    |         184 |     34.59 % |
| shortlist (343)                         | 2026-11-24 16:27    |         209 |     39.29 % |
| free (dispatched as onset, 345)         | 2026-11-24 23:36    |     **178** | **33.46 %** |

The first and last rows are the **same arm**. McNemar on the paired cases:

| comparison                            | both | only first | only second |    Δ | p (exact, two-sided) |
| ------------------------------------- | ---: | ---------: | ----------: | ---: | -------------------: |
| free 11-23 → free 11-24               |  169 |    **245** |       **9** | −236 |             < 0.001 |
| free 11-24 → shortlist                |  162 |         16 |      **47** |  +31 |             < 0.001 |
| free 11-24 → schedule                 |  163 |         15 |          21 |   +6 |               0.405 |
| shortlist → schedule                  |  173 |         11 |          36 |  +25 |             < 0.001 |

**−236 cases in one day, with 245 wins collapsing and 9 appearing.** This is not sampling noise, not a prompt change
(the free arm's instruction is asserted byte-identical to the published one) and not a corpus change (every artifact in
this table carries the same `converterDigest`, `b7fca80e…`).

## 2. What it does to the three published readings

Every loss this programme has published since 342b was computed against the **11-23** free arm. Against the **same
day's** free arm the signs do not merely weaken, they flip:

| published                                 | measured against 11-23 | measured against 11-24 |
| ----------------------------------------- | ---------------------: | ---------------------: |
| 343 shortlist: "−38.53 pp, 60.15 % retention" |  209 vs 414 = **−205** |  209 vs 178 = **+31**  |
| 342b schedule: "52.26 % retention, −43 pp"     |  184 vs 414 = **−230** |  184 vs 178 = **+6**   |
| "three presentations, three losses"            |     all three negative |  **one positive (+5.8 pp), one null** |

So the honest state of the presentation axis is **not** "closed in three forms". It is:

- **shortlist: +31 cases (+5.8 pp), p < 0.001** against the free arm of the same day — the only arm in this entire line
  with a measured positive effect, and the one 343 published as the worst;
- **schedule: +6 cases (p = 0.405)** — indistinguishable from free;
- **shortlist vs schedule: +25, p < 0.001** — if either arm is real, it is the section inside `TOOL fleet`.

Neither half of that is safe to publish as an effect yet, because the day itself moves the baseline by 236 cases. But
"refused by every bar" is now **false**, and the register has to say so.

## 3. The standing is not comparable, and that is the larger problem

`sota-comparison.md` carries **1 328 / 1 422 = 93.39 %** at ¥0.0147/case as this system's standing. That number was
measured on 11-23, by the same arm that scored 77.82 % on the 532-case sample then and **33.46 %** on it now. If the
drift is a property of the endpoint rather than of the sample, the standing cannot be reproduced today at any price, and
every comparison in that file — including the field's 90.0 Acc@1 — is a comparison between a measurement and a memory.

This entry does **not** claim the drift is the endpoint's. The candidates, none of them verified:

1. **The supplier changed the model behind the name** (`deepseek-chat` is a target, not a version). The run records say
   the name; nothing anywhere records a version.
2. **The supplier routes by load**, and 11-24 was a heavy day in this account: three arms in ten hours plus two full
   RCAEval passes.
3. **Something in this harness changed** between the two runs in a way no test covers. The prompt is fenced; the tool
   renderers are fenced only where an arm was added (`fleet`, `metric`), which is not the same as being unchanged.

The first is the cheapest to test and the only one that would be invisible to every run in this repository, because
every run records the model's **name**.

## 4. What ships so the next reading can tell the difference

- **`<artifact>.meta.json`** — `startedAt`, `endedAt`, `durationSeconds`, `model`, `budget`, and `arms` as one string
  (`free`, or `seed=engine+gate=lag+…`). Written beside the rows rather than inside them: 532 copies of a header is a
  file that says it 532 times and is read zero times.
- **`agent-runner-wiring.test.ts`** — the call site and the signature must agree on the **count** of arguments, and the
  failure reports the missing parameter's **name**. A count says "−1"; a name says `onset`, which is the difference
  between a session spent debugging and a session spent reading.
- **The rule this session earned**: an arm's control is the free arm **dispatched in the same batch**, not the free arm
  in the file. Every comparison in §2 that crossed a day boundary was a comparison between two measurements of the
  world, not between two arms.

## 5. Falsifiers

1. **If a free arm dispatched now returns ≈ 178**, the drift is a level and not an excursion, and the 11-23 artifacts
   become historical records that may not be compared with anything current — including the standing.
2. **If it returns ≈ 414**, then 345's 178 is a single bad batch and the day-boundary argument in §2 is weaker: the
   three 11-24 arms would then all be depressed together, which makes their *relative* order (shortlist > schedule ≈
   free) the thing to trust and their absolute levels the thing to discard.
3. **If a free arm and a shortlist arm dispatched back-to-back differ by ≥ 20 cases**, the +31 in §2 survives as an
   effect and the presentation axis reopens — as a **positive** result this time, which no document in this repository
   currently says.

## 6. Cost

¥7.17 for the arm that turned out to be a control, ¥6.86 for the 345 dispatch that preceded it in this entry's
accounting. The free repeat now running is the falsifier for §5.1 and is the only piece of this entry that is not a
re-read.

## 7. The reading

To be filled in when the free repeat lands. Nothing in §1–§6 may be edited to fit it.
