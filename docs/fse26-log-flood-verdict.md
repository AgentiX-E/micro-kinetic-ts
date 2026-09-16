# The log term's flood is a union, not a sum

The reconstruction in `benchmarks/src/fse26-term-oracle.ts` rebuilt the log term's
level-1 flood as `logic + http`. The engine admits a line **once**, so its flood is
`|logic ∪ http|` — and a line can carry both signature flags. The instrument therefore
divided by a number up to **twice** the engine's, on 109 services of the shipped
1422-case dump, and reported the disagreement as its own error bar.

Two defects in one function, both fixed in this commit; the second was written down as
a CONTRACT by the test that covered it.

## The proof needs no new run

Case `ts0-ts-basic-service-response-replace-body-2ntz4z`, the dump's own service line:

```
  ts-basic-service [GT] ... err=3499 fatal=0 logic=3495 http=3499
  ts-travel-service [#1] ... logScore=0.061 ... err=215 fatal=0 logic=0 http=215
```

`logic = 3495` and `http = 3499` are both counted independently, and both are **larger
than half of `err + fatal = 3499`**. Two disjoint subsets of 3499 lines cannot have
sizes 3495 and 3499, so the sets overlap — and the engine, whose gate is a boolean per
line, admitted 3499 of them, not 6994.

The dump also prints what the engine concluded, which is what makes this falsifiable
rather than a matter of reading the code: `ts-travel-service` scored **0.061** =
`215 / 3499`, and the sum would have produced `215 / 6994 = 0.0307`.

Scale, measured over the whole dump: **81 of 72527** service rows have a non-empty
overlap at all, and they are enough to make **109** re-derived scores disagree beyond
the 6e-4 tolerance and to move the rank-1 of **5** cases — because an overlapping
service that happens to be its case's flood maximum becomes that case's denominator, and
then every competing score in the case is deflated with it. The instrument already
reported both numbers — as "(the error bar for any mode row below)".

## A fidelity counter is a defect claim, not a tolerance

That line is the whole reason the defect survived two iterations. A reconstruction
built from the counts the engine itself used has no error bar: the only thing that can
make it disagree is a mistake in the reconstruction. The 5 cases were not rounding.

The rendered line now says which of the two readings applies — `EXACT` or `NON-ZERO — a
reconstruction defect, not a tolerance: do not read the mode rows below` — and there is
a second, sharper check with no extra data at all:

```
  self-check: the dump's own mode (`logicHttp`) re-derived as `logicHttp`
              reproduces the printed term: 0 service(s) differ, rank-1 moves +0/-0 over 1391 cases
```

The mode the run used **is** the mode the reader can rebuild, so the two must agree
service for service. This is the assertion that would have caught the double-count on
the day it was introduced, and it costs nothing: it is the same comparison, named.

## The second defect: the denominator is mode-dependent

`count` admits self-caused logic exceptions **only** — the engine's `isSourceSignature`
returns `false` for a purely framework-HTTP line in that mode. The reader divided by
`max(logic + http)` for every counting mode, so `count`'s scores were deflated by
whatever HTTP flood shared the case.

The previous test asserted the wrong value AS the contract:

> The denominator stays the level-1 maximum (`logic + http`), not the maximum of what
> `count` admits: 4 / 8, not 4 / 4.

The engine makes it `4 / 4`. Both halves are now guarded: the denominator is the
mode's own level-1 flood, and the numerator follows the same gate — plus a test that
subtracting the RAW http count under the `dominant` gate would delete the source's own
logic evidence with the cascade's.

## What the fix is, and how an old dump stays readable

1. The producer prints the overlap as a primitive: `both=<n>` on every service line,
   next to `logic=` and `http=`. Primitive rather than pre-combined, because the union
   differs per mode — `count` reads `logic`, the `logicHttp` family reads
   `logic + http − both`, and `all` would read `err + fatal`.
2. The reader takes the field when it is there.
3. For a dump that predates it, the reader **proves** the union:

   ```
   max(logic, http)  ≤  |logic ∪ http|  ≤  min(logic + http, err + fatal)
   ```

   The first bound holds because each set is contained in the union; the second because
   every admitted line is an ERROR/FATAL line. When the bracket is a point the value is
   proved. Measured on the shipped dump: **81 of 72527** service rows even have a
   non-empty overlap, and the bracket pins the union for **72496** of them; the 31 it
   cannot are one service each in 31 cases. When the bracket is not a point the reader
   **refuses** — a bound is not the value, and both ends of it are wrong in a direction.

The refusal is per mode, so `count` remains readable on a dump that cannot supply the
union at all. On the shipped dump, 31 of 1422 cases stay unpinned and every row that
needs the union is now measured on the other 1391, labelled `[1391/1422 cases]`.

## The corrected pre-screen, at the shipped configuration

1391 cases for the rows that rebuild the log term, 1422 for `count` and the baseline;
`--pool-penalty 0.0679`, the shipped latency PAIR, `temporalWeight=0`:

| configuration | correct | +/−cases | regressed types |
| --- | --- | --- | --- |
| recorded (baseline) | 756 | — | — |
| `count` | 531 | +130/−355 | 8 (`ReplaceCode` −146, `ReplaceMethod` −60, `RequestAbort` −42, `ReplacePath` −36, `ResponseAbort` −33, `Delay` −5, `ResponseDelay` −5, `PatchBody` −1) |
| `logicHttp` (self-check) | 730 | **+0/−0** | 0 |
| `dominant@0.2` | 731 | **+1**/−0 | 0 |
| `dominant@0.3` | 741 | +29/−18 | 5 |
| `dominant@0.4` | 753 | +60/−37 | 5 |
| `dominant@0.5` | 751 | +65/−44 | 5 |
| `dominant@0.6` | 749 | +82/−63 | 5 |
| `dominant@0.8` | 749 | +82/−63 | 5 |
| `dominant@0.95` | 597 | +89/−222 | 5 |

Three things follow, and all three change what the register may say:

- **`logicHttp` is `+0/−0`**, which is the internal-consistency proof that the
  reconstruction now IS the engine's own mode. It read `+5/−0` before.
- **`dominant@0.2`'s gain is exactly +1**, not the `+6` the register quoted with the
  caveat that 5 of them were the instrument's artefact. The caveat was right and is now
  unnecessary: the row is measured, and it is one case — inside any noise band, and
  nowhere near the reopening bar.
- The intermediate thresholds moved as well (`@0.3` was `+34/−18`), because the deflated
  denominator was distorting every row that divided by the flood.

The axis's status does not change: no mode beats the shipped one with a clean second
half. What changes is that the numbers are now exact, and the instrument's "error bar"
is gone rather than explained.

## Why the union is not an optimisation to be skipped

A reader that keeps the sum is not approximately right. It divides by the wrong
quantity, and the direction of its error is not uniform: it depends on how much of the
flood is shared between the two signatures, which varies per case and per service. On
this dump it reached a factor of two — enough to halve every competing score in the
cases where a framework-HTTP flood exists, which is exactly the population the
`logicHttp` mode was built for.
