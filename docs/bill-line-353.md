# The bill the runner printed was not the bill

**One sentence was 9.2× wrong, and it was the sentence everybody reads.** Every run of the free-investigation arm ends
with a cost line, and that line was `promptTokens × 2 + completionTokens × 8` — the card's **peak** column, with every
prompt token billed as a cache **miss**. Run `45595943761` cost **1.69 CNY** and its own last line said **15.55**.

The audit had been pricing the same artifact correctly since iteration 352. The two arithmetics never met: `costOf`
lived in `cost-model.ts`, the line lived in `run-query-agent.ts`, and nothing compared them. This is the same class of
defect iteration 351 fixed in the floor — *one rule priced, another shipped* — except that here the second rule was a
constant typed into the runner.

## 1. Where the 9.2× came from, in three parts

| # | the line did | the card says | what it cost the reading |
| - | ------------ | ------------- | ------------------------ |
| 1 | `P × 2 + C × 8` — the peak column, unconditionally | two columns, **1 / 4** off-peak and **2 / 8** peak, peak exactly double | the run was taken at 10:54 UTC on a Wednesday: off-peak. Half of the 9.2× is the wrong column |
| 2 | billed **every** prompt token at the miss price | 6 204 649 of 7 636 769 prompt tokens were hits, at **1/50th** of the miss price | the other half. The cache column existed in the artifact since 352 and never reached the summary |
| 3 | called the result "the declared prices" | there is no single declared price | the phrase made the number unfalsifiable: no reader could tell which table it came from |

(2) is why (1) survived a whole iteration. A line that prices the cache at the miss rate is *conservative*, and being
conservative is exactly the excuse that keeps an error in place — the audit's table said 1.69 three lines below it.

## 2. The sentence is now the audit's own function

`billLine(totals, rates, tariff)` composes the line from `costOf`, which is what `auditCost` prices its strata and its
total with. There is one arithmetic now, and the printed figure and the table can only disagree if the line stops being
called.

```ts
// benchmarks/src/query-agent.ts — the summary carries the column the bill needs
readonly cacheHitTokens: number | null; // null = no row declared it, which is not zero
```

```ts
// benchmarks/src/run-query-agent.ts — the constant is gone, and so is the phrase that named it
const startedAtDate = new Date(startedAt);
const rates = servedRatesAt(startedAtDate);
const tariff = tariffAt(startedAtDate);
...
console.log(billLine(summary, rates, tariff));
const billCaveat = billNote(summary, rates);
if (billCaveat !== null) console.log(billCaveat);
```

Three decisions are in those five lines, and each fails silently on its own:

1. **The number comes from `costOf`, not from a restatement of it.** A hand-written product is a second rule, and a
   second rule is what this file is about.
2. **The card comes from `servedRatesAt(startedAt)`, not from `new Date()`.** The tier is a property of the *run*, not of
   the reading: an artifact repriced in December must land on the column it was billed under in November. `startedAt` is
   already in the record for exactly this kind of question.
3. **The cache column reaches the line at all.** `summariseQueryArm` sums it, clamped per row and reported as `null`
   rather than `0` when no row declares it — because `0` says *the cache served nothing*, which is a measurement, and
   `null` says *this artifact cannot say*, which is not.

`billNote` prints the counterfactual — *with every prompt at the miss price the same run would read ¥7.77* — because
that is the number every report before this one carried. A reader comparing two reports has to be able to see where the
difference went, and a silent correction is the thing that makes a series untrustworthy.

## 3. The tier is a clock

The card has two columns and a schedule: peak is **weekdays 01:00–04:00 and 06:00–10:00 UTC**, and everything else is
off-peak. So `token-rates.ts` grows three functions and no new table:

| function | answers |
| -------- | ------- |
| `isPeakTariff(when)` | whether the peak column applies at an instant — windows **half-open**, `[from, to)` |
| `tariffAt(when)` | the column's **name**, for a line that has to say which one it used |
| `servedRatesAt(when)` | the card at that tier — identity to `DEEPSEEK_CHAT_RATES` (peak) or `DEEPSEEK_FLASH_RATES` (off-peak) |

Half-open is not pedantry. A closed interval bills `04:00:00` at both tariffs, which is a 2× disagreement at exactly the
boundary — the one place in a price table nobody looks. And `servedRatesAt` returns the existing constants by identity
rather than a third object, so a change to either card cannot leave the served table quoting a price nothing bills from.

**Why not simply default to off-peak?** Because a run dispatched at 02:00 UTC is billed at the peak column, and a default
that guessed would be wrong in the same way the old constant was wrong — confidently, and only for half the day.

## 4. What the two artifacts print now

Both are existing runs, repriced by the new code. No dispatch was spent on this iteration.

```
run 45595943761  tokens 7636769+34277 · 81.25 % served from cache · est. ¥1.69 at the off-peak column (1 / 4 / hit 0.02)
                 with every prompt at the miss price the same run would read ¥7.77 — the number the two-number line printed
run 45531140696  tokens 10221261+46085 · cache unrecorded · est. ¥10.41 at the off-peak column (1 / 4 / hit 0.02)
                 no row recorded a cache, so ¥10.41 bills every prompt at the miss price — a bound, not an invoice
```

The old lines were **15.55** and **20.81**. Both new figures match `run-cost-audit.ts --input-price 1 --output-price 4`
on the same files to the digit, which is the property the tests hold rather than a coincidence worth quoting.

**And one floor column stops printing one floor twice.** `ruleEdges` answers with the corpus's own margin
(`0.8629602…`); a report that also asked for `0.863` printed the same reading under two spellings, which reads as a step
in a curve that has none. `distinctFloors` dedupes at the printed resolution — `5e-4` — and is a tested function rather
than an inline loop in a CLI, which is where it started.

## 5. What the tests hold

Twenty new cases across three files, and one of them is the reason this cannot come back:

> **`bill-line.test.ts` — "prints the number the audit computes, on rows the audit also sees."** The test builds rows
> with a cache split, prices them with `auditCost`, then parses the `¥` figure **back out of the printed string** and
> asserts equality at both columns. Not the arithmetic restated — the arithmetic *and* the formatting, compared with the
> function the table uses.

The rest: the two windows at every boundary and at both weekend days (`token-tariff.test.ts`, 6 cases); a corrupt hit
count that clamps instead of paying a negative input; a run that called nothing priced at ¥0.00 with a `0.00 %` share
instead of a `NaN`; a table with no hit price, which must bill the miss price and say *bound*; the summary reporting
`null` rather than zero when no row carries the column; and the wiring itself — that the runner calls `billLine` with
`servedRatesAt(startedAt)`, and that neither `PRICES` nor the phrase `at the declared prices` survives in the file.

`cost-model.ts` and `token-rates.ts` are at **100 %** on statements, branches, functions and lines; `query-agent.ts` is at
98.15 % branch, with the residue in `entryChildErrors` (pre-existing, unrelated to this change).

## 6. What this does not fix

- **The windows are transcribed from the card, not queried.** A supplier that moves them moves the price silently, and
  `probe-endpoint.yml` — the workflow that exists to notice a supplier moving — does not read them. That is a one-line
  addition to a probe this programme already pays for, and it is not made here.
- **The line prices the artifact, not a case.** Which stratum is expensive is the audit's reading (`certainty 360 ·
  0.00 CNY`), and a runner that printed a per-stratum bill would be re-deriving a table it can just be asked for.
- **The transcript is still unpriced.** 84.6 % of the bill is uncached input, 1 349 tokens a call — the largest lever
  this programme has, and one that needs an accuracy reading before it can be pulled. That is the next iteration's first
  item, as `cache-hit-352.md` §3 already said.
- **A peak-hour run has never been observed here.** Every artifact in hand was taken off-peak, so the peak column is
  covered by tests and by the card, not by an invoice. Saying so is cheaper than discovering it on a Tuesday morning.
