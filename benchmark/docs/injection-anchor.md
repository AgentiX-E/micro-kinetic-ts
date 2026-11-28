# The injection boundary, and the 16 cases that did not have one

**Status:** defect found, repaired and gated at the loading layer. Established 2026-11-06 (iteration 233).

---

## 0. The short version

The injection boundary is not one signal among many. It is **the axis every pre/post split in this repository is
taken on**: the failed-edge baseline, the latency views' cap sides, the trace-activity rise, and the engine's own
injection-anchored onset detection. A case whose boundary is `0` does not lose one channel — it loses the split.
Every observation falls on the post side, the pre side is empty, and each channel that needs a baseline reports a
**starved input as a measured zero**, which is the same output a channel with no input at all produces.

The corpus holds **16 such cases** (of the 723 case directories this machine has of the published 735):
**14 carry `inject_time.txt` = 0**, one is **truncated by two digits** (`re1ob_currencyservice_loss_1` reads
`16933142` for the epoch second `1693314200`), and one names a boundary **1 456 seconds after its own telemetry
ends** (`re1ob_productcatalogservice_cpu_3`, a 62-second window). The loader accepted all 16 without a word.

The repair is not a fallback constant. It is the corpus's own invariant, measured:

> **In 701 of the 707 cases whose boundary is readable, the boundary sits at the midpoint of the case's own
> telemetry span.** The remaining six are _truncated_ windows, and in those the **pre** side still equals the
> corpus's constant for that system — the window was cut on the post side, not moved.

| system / suite                |               full window | boundary at span midpoint | truncated windows |
| ----------------------------- | ------------------------: | ------------------------: | ----------------: |
| RE1 OnlineBoutique            |     720 s **and 4 200 s** |                   74 + 48 |                 1 |
| RE1 SockShop                  |                     720 s |                       115 |                 2 |
| RE1 TrainTicket               | 960 s (95) and 720 s (25) |                       120 |                 1 |
| RE2 (all three)               |                   1 440 s |                       262 |                 2 |
| RE3 OnlineBoutique / SockShop |                   1 440 s |                        52 |                 0 |
| RE3 TrainTicket               |                   1 800 s |                        30 |                 0 |
| **total**                     |                           |                   **701** |             **6** |

RE1-OnlineBoutique's two window lengths are the reason the rule is stated as _"the midpoint"_ rather than as a
constant: the corpus uses two different window sizes for one system, and in both of them the boundary is half the
span. A constant would have been right for one mode and silently wrong for the other.

---

## 1. What the loader does now

`resolveInjectionAnchor(declaredSeconds, span)` in `packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts`
returns the boundary **and where it came from**, in four classes:

| provenance | when                                                                                                                                         | the boundary                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `declared` | the file parsed and falls inside the case's own span                                                                                         | believed as written                                        |
| `rescaled` | it parsed but fell outside, and **exactly one** decimal slip (ms, µs, ns, or a value saved with one or two digits too many) places it inside | repaired                                                   |
| `centred`  | the corpus declared **nothing** (absent, zero, unparsable) and the span is a full corpus window                                              | the span's midpoint                                        |
| `unusable` | no boundary can be established without inventing one                                                                                         | the declared value, unchanged, and the case is **counted** |

Three of these four decisions are refusals, and each refusal is deliberate:

1. **A declared boundary that disagrees with its telemetry is not overruled.** `re1ob_productcatalogservice_cpu_3`
   declares a boundary 1 456 s after a 62-second window. No decimal slip explains that, so the value is left
   exactly where it was and the case is reported `unusable`. Inventing a midpoint for a truncated window would be
   an interpolation presented as a reading.
2. **An ambiguous repair is not attempted.** If two decimal factors both land inside the span, the case falls to
   `unusable` rather than to the first factor that fits: a coin toss recorded as a measurement is worse than a
   stated gap.
3. **A span below half the smallest full window is not a window.** `RCAEVAL_MIN_FULL_WINDOW_SECONDS = 720` is
   derived from the table above, not chosen: 720 s is the smallest complete window the corpus uses, so a 62-second
   span cannot be one, and its midpoint is not the convention.

The rule moves **nothing** on a well-formed case, and that is pinned rather than argued: `declared` is returned
verbatim and a unit test asserts the value is byte-identical on a case whose anchor is inside its span.

---

## 2. Why the provenance had to become a printed field

`latency-routes` has printed `no anchor N` since iteration 89, and until now that number was exact, because an
unusable boundary _was_ a zero boundary. It is not any more. A repair that stayed silent would convert fourteen
unanchored cases into anchored ones and the artifact would then report a corpus that never had the defect — the
same failure as the `32.28%` reading, one layer down: **an instrument improved, and the published description of
the population left behind.**

So every run prints, beside the channel census it explains:

```
anchor[RE1:OnlineBoutique]: 125 cases | declared 123 | derived 2 (rescaled 1, centred 1) | unusable 0
```

`derived` is the number a reader needs and the one that was invisible: those cells' split rests on an inference,
true on 15 of the corpus's 723 analysable cases, and stated rather than absorbed. `anchors` is a field of the
group's load statistics, and `formatInjectionAnchors` is its one renderer, printed unconditionally — a census that
appears only when something is wrong is a census nobody reads on the run that is wrong.

---

## 3. What this does and does not fix

**Does:** the 15 repairable cases now split at the boundary the corpus would have written. Before the change their
metric points were **100% post-injection**; after it they are split, which is what the failed-edge baseline, the
latency views and the onset detection read.

**Does not:** `re1ob_productcatalogservice_cpu_3` remains unanchored, and it is now _visibly_ unanchored. Its
telemetry file is 62 seconds long where the corpus's own window is 720, so what is defective is the case's
metrics artefact, not its boundary — a repair at this layer would be a fabrication.

**Does not:** change any published cell. Every well-formed case returns `declared`, and the two OnlineBoutique
cases the repair touches are measured separately in the iteration's report.

---

## 4. The gate

| what                                       | where                                           | what it refuses                                 |
| ------------------------------------------ | ----------------------------------------------- | ----------------------------------------------- |
| four provenance classes counted separately | `summarizeInjectionAnchors`                     | a total that cannot say how many were inferred  |
| the derived total named                    | `formatInjectionAnchors`                        | a repair indistinguishable from a reading       |
| printed on every cell, unconditionally     | `reportLatencyRoutes`                           | a census that hides on the run that needed it   |
| provenance carried out of the loader       | `loadSingleCase`                                | a resolved boundary the artifact never mentions |
| the resolver's five arms                   | `__tests__/unit/loaders/rcaeval-loader.test.ts` | a repair rule that is argued rather than tested |
