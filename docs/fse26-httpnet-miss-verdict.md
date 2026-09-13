# FSE'26 HTTP + Network misses — verdict: two mechanisms, and the metric layer is the bigger one

Run `34742498321` on `4dde4bc`, categories `HTTP,Network`, 1050 cases,
`diagnose_limit=0` so every case is dumped (149,680 lines). Top@1 59.33%, Top@3
74.00%, Top@5 77.71%. The per-fault-type cells reproduce the published full-set
numbers exactly (159/231, 123/190, 39/97, 39/88, 42/89, 12/48, 14/46, 12/42,
47/60, 34/44, 45/51, 16/21, 3/4, 38/39), so the dump is the full population for
these families and not a sample.

These two families hold **426 of the benchmark's 749 misses (57%)** and sit at
29–69% Top@1, against the 2% of the structural silent block. The question was
whether they share the block's mechanism.

## 1. They do not. The misses split roughly half and half

`finalScore = log1p(selfAnomaly) + logScore` reproduces the observed rank 1 in
**1046/1046** cases of this dump, so the two-term model is exact here as well.

| class | count | shape |
| ----- | ----- | ----- |
| **log-decided** | 208/426 (49%) | the winner emits accepted messages and the source emits fewer or none |
| **log-silent** | 218/426 (51%) | *neither* side emits an accepted message — the metric layer alone decides |

and within the log-decided half, **163/426 (38% of all misses) are cases where the
source's metric term ALONE is already larger than the winner's** — the log term is
the only obstacle. That pool is **eighteen times the silent block's entire
ceiling on the logWeight axis** (163 against 9), although it is the same wall:
the block's own verdict proved a log-silent source cannot overtake the case's top
emitter while both terms are bounded to `[0, 1]`.

Per type, the metric gap `D = log1p(winner) - log1p(source)` separates the two
classes cleanly:

| fault type | misses | source logged | winner logged | median winner logScore | median D |
| ---------- | ------ | ------------- | ------------- | ---------------------- | -------- |
| HTTPResponseReplaceCode | 72 | 14 | 14 | 0.00 | **0.4005** |
| HTTPRequestReplaceMethod | 67 | 20 | 26 | 0.00 | **0.2485** |
| HTTPRequestAbort | 13 | 3 | 3 | 0.00 | **0.3425** |
| NetworkPartition | 58 | 3 | 33 | 1.00 | 0.0305 |
| HTTPResponseDelay | 47 | 29 | 29 | 1.00 | 0.0513 |
| HTTPRequestDelay | 49 | 31 | 31 | 1.00 | 0.0305 |
| NetworkLoss | 36 | 3 | 20 | 1.00 | 0.0202 |
| NetworkCorrupt | 32 | 2 | 18 | 1.00 | 0.0202 |
| NetworkBandwidth | 30 | 0 | 21 | 1.00 | 0.0211 |
| HTTPResponseAbort | 10 | 6 | 6 | 1.00 | 0.2392 |

The replace/abort types are **log-silent metric failures**: no log signal on
either side, and the source loses by a wide metric margin (median `D` 0.25–0.40).
They are at 64–78% Top@1 precisely because the log signal is what normally wins
them, and these are the cases where it does not fire.

The network types and the two delay types are the **small-gap log contest**: the
metric gap is 0.02–0.05, i.e. one to three rank positions, and the winner takes it
by holding the maximum log term (median 1.00) while the source holds less.

## 2. What decides the log-silent half

For the 218 log-silent misses, grouping each service's `dominant=` label into
families:

| the SOURCE's own most-anomalous metric is | n | the WINNER's is | n |
| ----------------------------------------- | - | --------------- | - |
| http inbound latency | 110 | **db connection pool** | **75** |
| network io/errors | 30 | http inbound latency | 69 |
| cpu | 23 | otel collector internals | 16 |
| jvm cpu | 16 | node / pod-limits | 16 |
| db connection pool | 10 | jvm cpu | 14 |

Broken down by label, the winner's connection-pool wins are
`db.client.connections.use_time.max` **56** and
`db.client.connections.wait_time.max` **19**.

**That split is the reason the family-level ablation failed.** Those two labels do
opposite jobs: in the silent-block analysis `use_time.max` was the decisive metric
of 39 wrong winners (a *victim* signature) while `wait_time.max` was among the
sources' own beaters (a *source* signature). Dropping the whole family therefore
removed the source's own evidence at the same time as the victim's, which is
exactly the shape the measurement had: **+0.14pp with five regressed types**. The
apparent bound (68 cases flippable against 25 hurt) was optimistic for the same
reason the method always is — the bound ignores that the other side has a second
metric ready to take over.

The derived probe is therefore narrower: drop **`use_time.max` only** and keep
`wait_time.max`. Dispatched as a full 1422-case run.

## 3. What this changes about where the work is

The silent block is closed and provably so, but it was never the benchmark's
biggest lever — the sweep's own pricing said the metric term alone is 14.98% and
the log term adds 32.35pp. This diagnostic says the same thing from the miss side:

1. **218 misses (51% of these families, 29% of every miss in the benchmark) have
   no log signal at all.** They are pure metric failures, and they are not close:
   median `D` runs 0.25–0.40 for the log-silent types. No log-side change can
   touch them, and the metric layer is what has to improve.
2. **163 more are cases where the metric already ranks the source first** and the
   log term overrides it — the same bounded-terms wall, but on a pool eighteen
   times larger than the block's.
3. The `http inbound latency` family is the source's own decisive metric in
   110/218 log-silent misses, so the question is not "the source has no signal" —
   as it was for the block — but "why does an equivalent signal on the winner win".

So the next measurement is the narrow label ablation dispatched above, and its
kill criterion is unchanged: RCAEval golden 9-cell bit-identical, FSE'26 zero
regressed fault types. A narrower drop than a family is the only form of this
ablation that has not already been rejected.

## 4. The narrow label drop — mechanism confirmed, and still rejected

Run `34743282955` on `1f68021`, full 1422 cases, `drop_metrics` = the single label
`db.client.connections.use_time.max`.

| run | drop set | Top@1 | delta | Top@3 | Top@5 | regressed types |
| --- | -------- | ----- | ----- | ----- | ----- | --------------- |
| control | — | 47.33% | — | 60.69% | 65.75% | — |
| family drop | all 7 `db.client.connections.*` | 47.47% | +0.14pp | 61.11% | 65.89% | 5 |
| **label drop** | **`use_time.max` only** | **47.61%** | **+0.28pp** | 61.11% | 65.96% | **2** |

**The mechanism is confirmed.** Dropping the family cost `NetworkDelay` five cases
(16/21 → 10/21) because it also removed `wait_time.max`, which is the *source's*
own signature; dropping only the victim-side label recovers four of those five
(15/21) and simultaneously beats the family drop on the headline (+0.28pp against
+0.14pp). So "ablate the label that wins, not the family it belongs to" is now a
measured rule and not a hypothesis — and it is the reason the family's
necessary-condition bound read 68-against-25 while the ablation delivered
+0.14pp.

**It is still rejected**, by the pre-declared criterion and for consistency with
everything else: two single-case regressions (`HTTPResponseReplaceCode` 159 → 158,
`NetworkDelay` 16 → 15). The same rule rejected `metricFleetBaseline` at +0.49pp
with six, and the family drop at +0.14pp with five; a smaller number of regressions
is a smaller violation, not a different rule. It stays an off-by-default probe.

### What that also measures

The winner's decisive metric in the log-silent half is `use_time.max` in 56 cases
and `wait_time.max` in 19. Removing **only** the first recovered **two** cases of
the 56 expected by the necessary-condition bound. So when the winner's top metric
is deleted, its second metric takes the case over almost every time. That is the
same optimism measured on the family, now with the label isolated: **the metric
layer's deficit is distributed across the inventory, not attributable to one bad
series**, which is why every input ablation in this benchmark has produced a small
net gain and type regressions rather than a block of recovered cases.

It also closes the input-ablation family completely: every form of it — five
families by bound, the connection pool by family, the connection pool by label —
has now been measured.

## 5. The next evidence class, and the two free checks that located it

The verdict above says the obstacle is the direction ambiguity: 163 misses where
the source's metric already wins and the log term overrides it, and 208 more where
the winner is the case's top log emitter. Removing the winner's decisive metric
does not help (two cases recovered of 56 expected), so the fix has to change *who*
the interface evidence is attributed to — which needs to know which callee a
service's failed calls were against. Two free checks were run before designing
anything.

**Check 1 — the captured error messages cannot supply it.** The diagnostic already
carries up to three post-injection error messages per service. Across the whole
dump there are **19,522 `ERR:` lines**, and of those:

- **0** mention any peer service (`ts-*-service` matches zero times);
- **0** carry a URL, host, or port.

They are truncated to 160 characters and generic: `HikariPool-1 - Connection is
not available, request timed out after 30001ms`, `Communications link failure`,
`Servlet.service() for servlet [dispatcherServlet] ... threw exception`. So a
message-based direction signal is dead on arrival: the target is not in the text.
The same read is corroborating rather than useless, though — `HikariPool ...
request timed out` says *I am waiting on a shared resource*, which is a victim's
signature, and the winner's decisive metric in the log-silent half is
`db.client.connections.*` in 75 cases. That mechanism is already measured out by
the two ablations above, so it closes rather than opens a lever.

**Check 2 — the converter drops it, and the raw data has it.** `scripts/fse26_convert.py`
emits `traceEdges` as **distinct `[caller, callee]` pairs only** — no status, no
duration, no time, and therefore no attribution of *which* callee a failed call
went to:

    "traceEdges": [ ["ts-ui-dashboard", "ts-order-service"] ]

while `read_trace_derived_metrics` in the same file already reads
`attr.http.response.status_code` and `duration` per span, bucketed by service and
window. The span-level information the engine needs is therefore present in the
archive and is being aggregated away one level too early: the aggregation is
per-service instead of per-edge.

So the next iteration is a converter revision rather than an engine change:
`read_failed_trace_edges` — the same polars self-join as `read_trace_edges`,
filtered to spans whose HTTP response status is >= 400 — emitting
`[[caller, callee, failed, baseline], ...]`, where `baseline` is the same count
over the pre-injection window (an edge that was already failing is a deployment
property, not fault evidence; merging the two would make a permanently broken
edge read as the fault's signature). That is the only evidence class that can
say "this service's failures were *against* that one", which is what "whose
failure explains whose" needs, and it is what the 163 overridden cases and the 208
log-decided ones lack.

Its cost is the pipeline, not the algorithm: a converter revision changes the
digest the provenance gate checks, so the shards must be rebuilt and republished
before a benchmark can use them (§6 — the rebuild path exists and is dispatched),
and the local path cannot do it (the sandbox proxy is rate-limited to a few MB per
twenty minutes). The kill criterion is
unchanged — RCAEval golden 9-cell bit-identical, FSE'26 zero regressed fault
types — and the signal is opt-in until it clears it.

## 6. The rebuild path exists, in the data repository — and disk was never the constraint

**Retraction first.** An earlier version of this section claimed (a) no workflow
builds the shard cache, (b) the pipeline's peak disk is ~3.5× what a hosted runner
has, and (c) the cheap prefix check needs an archive URL that is not recorded in
the repository. All three are false, and all three were false for the same reason:
the search was run over the *consumer* repository only. `AgentiX-E/rcabench-data`
is the producer, and it was never opened. What follows replaces them.

### The build path is `rcabench-data/.github/workflows/build-cache.yml`

It is a `workflow_dispatch` job that (1) clones the converter and sharder from
`micro-kinetic-ts` — recording `git rev-parse HEAD` as `CONVERTER_REVISION`, so a
dispatch always builds with the converter at the code repository's current
`HEAD`; (2) installs `requirements-fse26.txt`; (3) downloads the archive; (4)
runs `fse26_convert_tar.py` (streaming); (5) deletes the archive; (6) runs
`fse26_shard.py`; and (7) uploads the 7 shards plus `manifest.json` to a Release
with the repo's own token. The data repository's own `README.md` documents this
under **Build**, and the workflow file states outright that consumers pin an
explicit tag because `--clobber` does not refresh `published_at`. The earlier
`grep` over `.github/workflows/` was searching the wrong repository's workflows;
finding no converter reference there is exactly what a correctly separated
producer/consumer pair looks like.

**It has succeeded six times out of six**, including the full build whose output
we currently ship — run `34586313254`, 2026-09-11 09:51→13:09, converter
`6a15947dc55cc7eb9b6a2480ac528d6f068c024c`, `totalCases 1422`, HTTP shard
1,610,114,253 bytes: byte-identical to `rcabench-full`'s manifest. "Built out of
band" is not true; it was built by this workflow, and every published number can
be traced to a run id.

### The disk arithmetic was wrong by an order of magnitude

The workflow logs its own `df -h "$HOME"` twice. From run `34586313254`:

```
after the 13.4 GB archive download   /dev/root  145G  71G  74G  50% /
after converting the whole tree
and deleting the archive             /dev/root  145G  96G  50G  66% /
```

So the runner's root volume is **145 GB** and had **74 GB free** with the archive
down, and **50 GB free with the entire ~48.9 GB converted tree on disk**. The true
peak is the archive and the tree coexisting during conversion — roughly 110 GB of
145 GB, i.e. ~35 GB of headroom. The "~14 GB" figure used previously is the
*documented workspace-SSD* allowance for a GitHub-hosted runner, not the size of
the root volume; those are different mounts, and conflating them is what produced
a "3.5× over" conclusion about a pipeline that has in fact completed end to end.

### The prefix check is not a workaround either — it is an input of the same job

`download_prefix_bytes` (default `0` = full 13.4 GB) turns the download into a
`Range` request, and it has been exercised: run `34490555117` passed
`-r 0-524288000` (500 MB), finished in **7 minutes** with 47 cases
(HTTP 22 / Pod 1 / Resource 24), and published them to `rcabench-verify-v1`. The
archive URL is recorded there too —
`https://zenodo.org/api/records/17105974/files/rcabench-absolute_anomaly.tar.gz/content`
(Zenodo record 17105974, CC-BY-4.0) — along with `-C -` resume and 30 retries,
because Zenodo serves from cold storage.

### Options, ranked by cost and by what they are actually for

| # | Option | Status |
|---|---|---|
| 1 | Dispatch `build-cache.yml` with `release_tag` + `download_prefix_bytes: 0` | **The shipped path.** No code. 6/6 green, including a full 1422-case build. ~3h17m, of which 2h24m is the Zenodo download. |
| 2 | The same job with a byte prefix | Already implemented and exercised (run `34490555117`). Not a rebuild — but it is the cheap real-data check, and it needs no out-of-band URL. |
| 3 | Stream the shards per category (peak = largest category) | **Not needed** — the disk constraint it removes does not exist. It would be an unmotivated change: run time is unchanged, because the cost is the archive download, not the tree. |
| 4 | A larger or self-hosted runner | **Not needed**, for the same reason. |
| 5 | Re-host the archive to kill the cold-storage download | The only option with a real measured argument: it saves ~2h20m **per rebuild** forever (2h24m of the 3h17m is Zenodo at ~1.5 MB/s). Cost is one upload, split because release assets cap at 2 GiB per file, plus a digest gate so a re-hosted archive cannot go stale silently. Worth doing once converter revisions are expected to keep landing — not before this rebuild proves the field. |

So the answer to "is streaming the only option" is that it is **not an option at
all** — it was a fix for a constraint that measurement had not established. What
gates the next measurement is the dispatch itself, and nothing else.

### Action taken

The converter half is already done and verified: 13 new tests written red first,
`scripts/` at 193 tests with 100.00% statements *and* branches on every module,
the golden 9-cell byte-identical at `debf820`, and `SCHEMA_VERSION` bumped 2 → 3
so a cache built before the field is distinguishable rather than silently missing
it.

Run **`34752201606`** was then dispatched against `rcabench-data` with
`release_tag: rcabench-full-v3` and `download_prefix_bytes: 0`. A new tag rather
than a `--clobber` of `rcabench-full`, so that the 47.33% headline stays
reproducible from the tag it names: clobbering destroys the ability to re-derive
an already-published figure by checking out the commit it was measured on. The
`v3` tag will carry `schemaVersion 3`, the new `converterRevision`, and a fresh
`converterDigest`; the consumer's provenance gate then passes against the current
checkout instead of failing loudly, which is what it does today.

The remaining work while it builds is the engine-side consumer of
`failedTraceEdges` — the field is data only, and no scoring signal reads it yet.

