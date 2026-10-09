# Verdict provenance: a conclusion may not rest on a sample

**Status:** defect found, repaired and fenced — **three mutations killed**. The re-measurement the repair calls for
is dispatched, and §5 states what it has to show. **No published number moves.**

**Owner of:** which corpus each probe workflow ranks, and therefore which numbers a `*-verdict.md` is allowed to
cite. `docs/benchmark-corpus-completeness.md` owns the same question for the PUBLISHED cells; this document owns it
for the workflows whose output nothing publishes but three verdicts consume.

## 1. The defect

Iteration 75 removed `--max-cases 50` from the three invocations in `benchmark-rcaeval.yml`, on the rule that **a
benchmark claim cannot be weighted by a corpus it did not rank**. It left the same cap in two other workflows, and
its own fence named them as legitimate samplers:

| workflow | RE2 invocation | measured | consumed by |
| --- | --- | --- | --- |
| `benchmark-fusion-ceiling.yml` | `--suite re2 --max-cases 50 --fusion-ceiling …` | 150 of 270 | `fusion-routing-verdict.md` §1 (the union ceiling) |
| `benchmark-routing-probe.yml` | `--suite re2 --max-cases 50 --routing-probe …` | 150 of 270 | `fusion-routing-verdict.md` §2 (the routing frontier) |

`docs/fusion-routing-verdict.md` is a **register-tracked verdict**. Its §1 states the perfect-oracle ceiling as
**87.5% (538/615)** and its §2 reports the routing frontier over **615 cases** — so the number that closed the
roadmap's highest-value direction (panel B of `sota-roadmap-2026.md`) is a number over **615 of the benchmark's
735**, and `docs/delay-exhausted-verdict.md` §100 and `docs/rank-collapse-falsified.md` §58 both cite the same
87.5% as an *information ceiling*.

**The damage is not the 120 missing cases; it is which suites they are.** The repair in iteration 75 moved RE2's
cells most (OB 82.4 → 86.7, SS 88.9 → 92.2, TT 68.1 → 71.1) — and RE2 is where the two engines disagree most
(PRISM leads by +9.8 on RE2-OB and +13.0 on RE2-TT per the head-to-head). A union measured on a 150-case RE2 is
therefore a union measured on the suite that decides the answer.

## 2. Why the fence did not catch it, and this is the part worth keeping

The fence was an **exact set of four filenames**:

```ts
const MAY_SAMPLE = [
  '<a probe nothing reads>',        // still a member: a sweep whose artifact no document quotes
  'benchmark-fusion-ceiling.yml',   // <- the union ceiling's producer
  'benchmark-routing-probe.yml',    // <- the routing frontier's producer
  '<a second probe nothing reads>',
];
expect(sampling).toEqual([...MAY_SAMPLE].sort());
```

**The two live members are described rather than named here on purpose, and the reason is this document's own
subject.** The rule in §2 is a text check over `docs/*.md`, so quoting a sampler's filename in prose would make
*this* document the citation that removes its own exemption — and the entry would then look like a citation rather
than a quotation. The check fired on the first draft of this paragraph, for exactly that reason: a rule that reads
the repository's text must be written around the fact that explaining a rule reproduces its subject. This is the
same shape as the fence's own third mutation below — *a text assertion is satisfied by the comment explaining the
defect* — arriving in a `.md` instead of a `.ts`.

An enumeration cannot express *why* a workflow may sample, so it cannot distinguish a probe nobody reads from a
probe a verdict reads — and the two entries above are the second kind. **A probe may sample; a CONCLUSION may not
rest on one.** The list was maintained by the same author about to cite the number, which is the failure mode, not
an implementation detail.

The repair is a rule over the repository's own text:

> **A workflow that caps its corpus may not be named by any `docs/*.md`.**

The population is defined by the right predicate — *an invocation that carries `--max-cases`* — so the rule needs no
exemption list at all: `fse26-benchmark.yml` caps via a **dispatch input** rather than a literal on a command line,
so it was never a member, which is also why the set it replaced never listed it. And the rule cannot go stale
silently: the day a document starts citing a sampler, **the citation itself fails the assertion**.

## 3. The fence, and the three mutations that prove it is real

`benchmarks/__tests__/benchmark-rcaeval-trigger.test.ts`:

| mutation | expected | result |
| --- | --- | --- |
| restore `--max-cases 50` on the fusion-ceiling RE2 invocation | the absence fires | **killed** — `benchmark-fusion-ceiling.yml must not sample` |
| delete the probe from that invocation, leaving the comment that names the flag | the presence fires | **killed** — invocation-scoped regex, so the explanation cannot satisfy the check |
| move `perFaultType` inside the repetition loop (§4) | the order assertion fires | **killed** — `expected 66106 to be less than 66005` |

The middle row is the third occurrence of a law this repository has now paid for three times: **a text assertion is
satisfied by the comment that explains the defect.** Both probes are therefore asserted **invocation-scoped** — the
regex starts at the subcommand, which is the only place a flag can actually reach a runner.

## 4. The second defect, in the artifact the register counts samples from

`run-ablation.ts` allocates the per-fault-type accumulator **outside** the repetition loop and accumulates
**inside** it, so every printed count is `cases × REPETITIONS`:

| suite | loader prints | breakdown's `(n)` sums to | ratio |
| --- | ---: | ---: | ---: |
| RE1 | 125 cases/system | 375 | 3 |
| RE2 | 90 cases/system | 270 | 3 |
| RE3 | 30 cases/system | 90 | 3 |

**The number is right and its unit was missing.** It is exactly the population each percentage is a mean over, and
it is what makes the running weighted mean correct — `existing.cases` is in case-reps while `ftMetric.cases` is in
cases, and their 2:1 ratio after two repetitions is precisely the weight ratio a mean over three samples needs.

But it was printed as a bare `(n)` in a table whose sibling line prints `(n cases)`, three lines apart, differing by
exactly `REPETITIONS`. **Two quantities, one word** — the law the census and the golden's `[log]` line already cost
this repository, now in the artifact the register quotes its sample sizes from: `ABLATION_FINDINGS.md` v8 records
capped RE2 as `27/27/27/27/24/18` and full RE2 as `45×6`, which are **case-reps**, i.e. `9/9/9/9/8/6` and `15×6`
cases. The table now states the unit in its header, and the test pins both the statement **and its cause** — the
declaration's position relative to the loop — because a label would stay true if someone moved the allocation and
forgot to say so.

*This is the "unit-contract census over derived fields" the register has carried as a named next step since
iteration 75. It found one on its first field.*

## 5. What the re-measurement has to show

Three runs are dispatched from the repaired commit, and none of them is a formality:

1. **The golden** (`benchmark-rcaeval.yml`) — the nine cells must be **byte-identical** to run `37900344770`. Holds
   by construction: neither change touches `run-rcaeval.ts` or any ranking path. It is run to measure that rather
   than assert it.
2. **The fusion ceiling, uncapped** — the union and its four categories on **735** cases, replacing `538/615`. The
   both-wrong floor is the number that matters most: it caps every fusion strategy at `1 − floor`, and the verdict
   attributes it to RE3 "where both engines sit near chance".
3. **The routing probe, uncapped** — the zero-regression frontier on 735, replacing the 615-case one. If the
   conclusion holds, the three verdict documents get corrected numbers and the conclusion is *better* founded; if
   it does not, the roadmap's fusion direction reopens. **Both outcomes are worth the run, and neither may be
   assumed.**

Until those land, every figure in §1 is quoted from the 615-case measurement and **must be read as such** — which
is the only honest state for a document whose own subject is unstated provenance.
