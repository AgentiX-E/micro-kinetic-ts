# The latency channel — three views of one array, and two suppressors

**Status:** the defect is identified, the mechanism is now printed by the artifact, and the view a run ranks
on is stated at every call site. The published cells keep the composed view, because a repair that silently
moved their input would move a published number.

## 1. The question this document answers

Iteration 73 left one item in the register open, and it was the sharpest one there: on **RE3 OnlineBoutique**
the input census read

```
direction-coverage[OnlineBoutique]: 30 cases | failedTraceEdges 15/30 cases, 30 edges | edgeLatency 0/30 cases, 0 edges | STARVED: edgeLatency — any weight on it measures nothing
```

Two outputs of one relation, one populated and one empty, **in the same cases, from the same file**. `latWeight`
is `0.561495` in the shipped configuration — one of the three terms that dominate the ranking — and an empty
array under a non-zero weight is the register's first invariant inverted: *a signal that received nothing reports
the same headline as a signal with no effect.*

The question was not whether the zero was real. It was **why**, because two mechanisms predict the same zero and
they differ in everything a decision needs:

| mechanism | signature in the capped span list | what it means |
| --- | --- | --- |
| **no anchor** | every span on the "after" side | `inject_time.txt` absent or unparsable ⇒ `injectTime` degrades to `0` ⇒ every span is after it |
| **double scale** | every span on the "after" side | a start time already in milliseconds is multiplied by 1000 again |
| **truncating cap** | every span on the "before" side | the byte-prefix read ends before the post-injection window |

The first two are indistinguishable from a single number, which is why the answer had to be an instrument.

## 2. The unit contract, and the expression that violates it

`BenchmarkTraceSpan.startTime` is declared `// Unix milliseconds`, and the loader goes to some trouble to make
that true: `normalizeTraceStartTime` reads `startTimeMillis` directly, divides a microsecond `startTime` by 1000,
and magnitude-infers a bare `timestamp`. Its duration docblock states the contract for the neighbouring column by
contrast:

> The value's UNIT is deliberately not normalised. The only consumer reads the RATIO of a post-injection mean to
> a pre-injection mean on the same edge, so a uniform scale cancels — unlike `startTime`, whose unit is compared
> against `injectTimeMs` and therefore does have to be normalised above.

The assembly scaled it again:

```ts
startTime: t.startTime * 1000,      // t.startTime is ALREADY milliseconds
rawCase.injectTime * 1000,          // seconds → milliseconds: correct
```

One call, two conventions for one quantity, and `toBenchmarkCase` — the owner of the injection conversion —
multiplies by 1000 too. So the injection side is right, the span side is off by 10³, and `after` is true for
**every** span: no edge can have a pre-injection mean, and `toEngineDirectionalInputs` returns `[]` on every
case of every suite. The comment above the expression stated the mismatch with the wrong sign ("would put every
span **before** the injection"), which is the same failure this repository keeps finding: the justification
outlives the code it was written for.

**This is entailed by the code, and §7.1 measures that it is NOT what emptied the channel on the corpus**: the
cap truncates first, so the same array is empty for a second reason. Both defects are real; only one of them is
binding, and the artifact is what says which.

## 3. The third route was already computed and thrown away

`countDirectionalInputs` streams the **whole** file and returns **both** arrays. The assembly kept only one:

```ts
const streaming = await countDirectionalInputs(join(meta.dirPath, 'traces.csv'), injectTimeMs);
benchCase = { ...benchCase, failedTraceEdges: streaming.failedTraceEdges };
//                                          streaming.edgeLatency ── dropped, at zero saving
```

That is the route the earlier battery measured through, and the one the ledger then discarded when it was
re-pointed at the shipped composition. `countTraceActivityByService`'s own docblock already records what the
other route cannot see — that `tryLoadTraces` "truncates before the post-injection window" — so on RCAEval the
capped route was never going to hold a pair, with or without the unit defect.

## 4. The three views

`benchmarks/src/rcaeval-corpus.ts` derives all three in ONE assembly and owns the selection:

| view | input | start time | what it is |
| --- | --- | --- | --- |
| `shipped` | the capped span list | scaled twice | **the composition that published the nine cells** |
| `capped` | the capped span list | as the loader normalises it | the same cap, unit repaired |
| `whole-file` | the streaming pass | as the loader normalises it | the only view that can hold both sides |

The view is a **corpus** property and is stated at every call site rather than defaulted (`corpus-assembly.test.ts`
asserts each of the three runners names one), for the reason `prismPooling` exists: *an option a caller can name
and a call site omits is an open axis.* The published cells' view is `shipped`.

## 5. The census, and the verdict its counts earn

`latency-routes[<system>]` is printed beside the input census and counts, per population: the cases with no
usable anchor, the capped list's spans and its pre/post split, how many cases the cap put entirely on one side,
how many hold both, and the row count of each of the three views. Its `VERDICT` names the mechanism, and the arms
are ordered so the strongest available reading decides:

| verdict | when | reads as |
| --- | --- | --- |
| `LIVE (shipped)` | the published view produced a row | the channel is fed; nothing else needs saying |
| `STARVED` | the capped list holds no spans | the corpus is the answer |
| `NO ANCHOR` | a case has no usable injection time | the split cannot exist; **not** a defect in the scale |
| `ALL-AFTER` | every capped span is at/after the anchor | no edge can have a pre-side mean |
| `CAP TRUNCATES` | every capped span is before the anchor | the prefix ends before the window |
| `LIVE (capped)` | the repaired-unit view produced a row | the cap was not the binding constraint |
| `UNEXPLAINED` | both sides present and no route emitted a row | the derivation is the only suspect left |

`NO ANCHOR` is deliberately read **before** `ALL-AFTER`: both empty the pre side, and only one of them implies a
unit defect. The `whole-file` clause is appended rather than made its own arm, because it is not a competing
explanation — it is the same population seen by the one derivation that reads the whole file, and its presence is
what separates *"the corpus cannot express this"* from *"the input never arrived"*.

## 6. What the nine published cells therefore contain

`latWeight = 0.561495` multiplied an empty array on every RCAEval cell. That is consistent with, and explains,
the ledger row that reads `Δ+0.0%` for `LAT OFF`, `LAT NO FLOOR` and both — a fact measured five iterations
before its cause was found. The earlier ledger's signed readings for this channel (RE3-TT +16.7, RE3-OB −13.3,
RE2 −2.0 twice) were attributed at the time to "an artefact of the study's own `edgeLatency` derivation"; that
attribution is **withdrawn here**. The whole-file derivation was not the artefact — it was the only route that
could express the input, and the composition that replaced it is the one that cannot.

**And it is worth something.** §7.2 measures the channel at **+1.9pp** on RE2 (OnlineBoutique +3.7,
TrainTicket +1.8) when its input is supplied, with **`delay` +11pp and `loss` +11pp** and every other fault type
unchanged — so the published nine cells are a corpus in which a dominant term is starved, not a corpus in which
the term does nothing.

## 7. Measured acceptance

**Run `37858643162` on `95fedbc` — 10/10 jobs success, the nine cells byte-identical** (`80.0 / 92.8 / 68.0` ·
`82.4 / 88.9 / 68.1` · `80.0 / 45.0 / 51.1`, every per-fault-type column unchanged). The ablation jobs' new bound
was **not** forced: `ablation-re2` came in at **54.3 min** against the old 60, with 5.7 min of headroom — the
projection in the workflow's comment (~59) was conservative, and the number is recorded here because a comment is
not a record.

### 7.1 The census names the mechanism — and it is not the one predicted

| cell | `no anchor` | capped spans (pre / post) | cap all-before | rows: shipped / capped / whole-file | verdict |
| --- | ---: | --- | ---: | --- | --- |
| RE1 ×3 | 0 | 0 | 0 | 0 / 0 / 0 | `STARVED` (RE1 carries no traces) |
| RE2 SS · RE3 SS | 0 | 0 | 0 | 0 / 0 / 0 | `STARVED` (SockShop carries no traces) |
| RE2 OB | 0 | 500 000 (500 000 / **0**) | **50/50** | 0 / 0 / **600** | `CAP TRUNCATES` + whole-file clause |
| RE2 TT | 0 | 500 000 (500 000 / **0**) | **50/50** | 0 / 0 / **3 712** | `CAP TRUNCATES` + whole-file clause |
| RE3 OB | 0 | 300 000 (300 000 / **0**) | **30/30** | 0 / 0 / **356** | `CAP TRUNCATES` + whole-file clause |
| RE3 TT | 0 | 300 000 (300 000 / **0**) | **30/30** | 0 / 0 / **2 006** | `CAP TRUNCATES` + whole-file clause |

**This refutes the binding mechanism this document predicted.** §2 argued the double scale was why the published
view is empty; the census shows the capped list carries **exactly 10 000 spans per case — the cap — and every one
of them is BEFORE the anchor**, so `post = 0` and no edge can have an after-side mean. The prefix ends before the
post-injection window, exactly as `countTraceActivityByService`'s docblock claimed and as nothing had ever
measured. `no anchor 0` on all nine cells also eliminates the third mechanism.

The unit defect of §2 is still **entailed by the code** — the published expression scales a millisecond value by
1000 — but the cap **binds first and masks it**: the `capped` view (unit repaired) is empty on this corpus too, so
no measurement here isolates the scale. What the artifact states is the mechanism that emptied the channel, and it
states it with the counts that decide it.

### 7.2 The channel is not starved, and it is worth something

| row | RE1 | RE2 | RE3 |
| --- | --- | --- | --- |
| `LAT WHOLE FILE` (corpus `whole-file`) | Δ+0.0 | **Δ+1.9** | Δ+0.0 |
| `LAT CAPPED` (corpus `capped`) | Δ+0.0 | Δ+0.0 | Δ+0.0 |
| `LAT WHOLE FILE + LAT OFF` (control) | Δ+0.0 | **Δ+0.0** | Δ+0.0 |

RE2, per system and per fault type:

| system | baseline | whole-file | Δ | fault types that moved |
| --- | ---: | ---: | ---: | --- |
| OnlineBoutique | 82.4 | **86.1** | **+3.7** | `delay` 67 → **78**, `loss` 56 → **67** |
| TrainTicket | 68.1 | **69.9** | **+1.8** | `delay` 56 → **67** |
| SockShop | 88.9 | 88.9 | 0.0 | — (no traces at all) |
| **mean over systems** | 79.8 | **81.6** | **+1.9** | |

Three things follow, and the third is the one that matters.

1. **The control worked.** Switching `latWeight` off on the same corpus returns to the baseline **exactly**, so
   the movement belongs to `latWeight` and to nothing else about the corpus rows.
2. **The cap is the suppressor, and the unit repair alone recovers nothing** (`LAT CAPPED` = `Δ+0.0`, and its
   verdict is `STARVED` because the corpus it ran on holds no rows). The two defects are real; only the second is
   binding, and only the whole-file route has the input.
3. **The movement lands on the network-class faults.** `delay` +11pp on two systems and `loss` +11pp on one, with
   every other fault type unchanged — and `loss` is precisely the class the held-out misses were attributed to,
   and `delay`/`loss` are the two fault types that block **every** global PRISM weight on RE1. The propagation
   channel — the one place the Deng-Yu mathematics enters the ranking — is not worthless; it has never been fed.

On RE3 the whole-file corpus **is** supplied (356 and 2 006 rows) and the ranking does **not** move: the verdict is
`INERT`, which is a statement about the term there. Whether `latMinRise = 10.3` is what masks it is the next row
this instrument makes cheap (`LAT WHOLE FILE + NO FLOOR`), and it is named rather than assumed.

### 7.3 What this does NOT decide

The nine published cells keep the composed view, because moving them is a **re-baseline** and not a repair: the
shipped corpus starves its own dominant latency term, and supplying it moves RE2's OnlineBoutique and TrainTicket
cells by +3.7 and +1.8. That is a decision to be taken on the numbers above, deliberately, with the published
comparison re-stated — not taken silently inside a unit fix. The measure is now in the artifact; the decision is
the next iteration's.

## 8. Fences

- `benchmarks/__tests__/corpus-owner.test.ts` — a real case directory, the real loader, the real owner: the
  `shipped` view is empty and the other two hold `{preMeanMs: 10, postMeanMs: 500}` on the same corpus, with
  `anchorPresent: true`, `capSpans: 3`, `capPre: 2`, `capPost: 1`. It also covers the arms only a corpus can
  reach (no traces, no anchor, no augmentation, a suite that is not RE3).
- `benchmarks/__tests__/latency-routes.test.ts` — every verdict arm, the summariser, the selection, and the
  source-shape assertions: the published expression is kept verbatim as a recorded value, the capped view passes
  the loader's value through unscaled, all three call sites state their view, and the census is printed.
- `benchmarks/__tests__/coverage-scope.test.ts` — `rcaeval-corpus.ts` was imported by a test as SOURCE TEXT and
  by nothing as code, so every number in this repository went through a module outside the coverage denominator.
  It is in the allow-list now.
