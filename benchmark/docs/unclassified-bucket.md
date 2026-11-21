# The unclassified bucket, by class name — the log channel's last hope, measured empty

**Status:** a CLOSURE, with an instrument that now ships. The TrainTicket RE3 log tier is empty because the mode's
gate refuses every retained row, and 8,482 of those rows are `unclassified` — the bucket the whitelist does not
know. This document reads the bucket by CLASS NAME and closes the direction: the rows are the platform's own
authentication noise, not the injected fault.

**Owner of:** the `unclassified classes:` census line, and of the log channel's standing for RE3-TrainTicket.

---

## 1. The question §8.5 left open

`docs/loss-decomposition.md` §8 answered "why is the log tier empty" down to four mechanisms, and left one of
them open: the case retains rows, the mode admits none, and the retained rows' taxonomy splits into
`logic 0 / propagated 68 / unclassified 8,482 / none 3,763`. The previous census printed the bucket's SIZE. What
decides whether the whitelist has headroom is its COMPOSITION — the class each row names.

The census now prints it, read through the loader's own `extractDeepestExceptionClass`, so it names the class a
`Caused by:` chain ends at rather than the wrapper every victim shares:

```
log-routes[TrainTicket]: 30 cases | … | admitted 0 | in-graph 0 | kinds: logic 0 | propagated 68 |
  unclassified 8482 | none 3763 | flag-disagreements 0
  unclassified classes: MalformedJwtException×3366 | TokenException×3366 | HttpServerErrorException×1750
```

## 2. What the number says

**The bucket is three classes, and 8,482 is exactly 3,366 + 3,366 + 1,750.** The two largest are TrainTicket's
own JWT validation failures, in equal counts — one per case per emitting service — and the third is Spring's
`HttpServerErrorException`, the framework wrapper a 5xx produces at every caller. None of the three is a
self-caused programming error, which is what a code-level fault looks like, and all three are emitted by services
that are healthy in the same case.

The other two systems make the contrast legible in the same run:

| system | retained | admitted | unclassified | composition |
| --- | ---: | ---: | ---: | --- |
| OnlineBoutique | 41,401 | **5,275** | 44 | `BindException×22 | IOException×22` |
| SockShop | 43,102 | **5,855** | 32,132 | `ProcessingException×29,831 | HttpServerErrorException×2,205 | …` |
| TrainTicket | 12,313 | **0** | 8,482 | `MalformedJwtException×3,366 | TokenException×3,366 | HttpServerErrorException×1,750` |

OnlineBoutique and Sock Shop carry 5,275 and 5,855 admitted rows — the whitelist finds their logic exceptions.
TrainTicket carries none, and its bucket is auth noise. The corpus, not the gate, is the difference.

## 3. The arm that prices "just admit them"

The blunt version of "extend the whitelist" is the `all` mode, which admits every ERROR/FATAL row and is
reachable from both dispatches. One input, everything else shipped (commit `5a661b8`, run `40671490249`):

| arm | RE1 | RE2 | RE3 OB / SS / TT | **RE3** |
| --- | ---: | ---: | --- | ---: |
| shipped (`count`) | 327 | 240 | 24 / 18 / 19 | **61** |
| `log_signal_mode=all` | 327 | — | **15 / 8 / 13** | **36** |

**−25 cases**, and the loss is uniform across all three systems: admitting every error line hands the ranking a
flood in which every service looks equally guilty. RE1 is untouched only because it has no log file at all.

So the direction closes twice over — once by composition (the rows are auth noise) and once by price (admitting
them costs a quarter of RE3). **The log channel cannot carry RE3-TrainTicket**, and the 11 misses that remain
there (5 shallow, 6 deep, 0 retrieval) are a RANKING problem, not an evidence problem.

## 4. What this changes in the route

The campaign's last structural hope for the blocking cell was that its evidence lived in a channel the engine
could not read. It does not: the channel is readable, the engine reads it, and what it contains is the platform
talking to itself. The remaining 13.4 pp to PRISM on RE3-TrainTicket has to come from ordering the evidence the
engine already has — which is the same conclusion `docs/re3-quiet-truth.md` §6 reached from the other side, now
with the last alternative closed.

## 5. The instrument's own properties

Each is a test in `benchmarks/__tests__/log-routes.test.ts`:

1. **Only unclassified rows contribute.** A logic row's class must not leak into the bucket, because the bucket's
   question is what the whitelist MISSES.
2. **The deepest class wins.** A wrapper heads every victim's message; a census that read the head would report a
   homogeneous bucket and answer the wrong question.
3. **A row whose deepest clause carries no class is filed under `(unnamed)`**, never dropped, so the bucket's
   parts sum to its size.
4. **The list is bounded (8) and ordered count-descending then name-ascending** — a tie broken by insertion order
   would make two runs of one corpus print different censuses.
