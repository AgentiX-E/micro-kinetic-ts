# Which cache a run consumes — selected by digest, not by name

**Iteration 258.** The FSE'26 benchmark consumes pre-converted shards that live as Release assets on
`AgentiX-E/rcabench-data`. Nothing inside the data says which converter produced it, so the consumer's only
defence is `scripts/fse26_provenance.py`: it recomputes the converter digest from its own checkout and refuses a
manifest that records a different one. That gate is correct and it has caught three separate mistakes.

What it could not do is tell the operator **which** cache to consume. That was a workflow input with a
human-maintained default — `shard_tag: rcabench-latency-full` — and the default went stale the moment the
converter changed:

| date | event |
| --- | --- |
| 2026-09-14 | `rcabench-latency-full` built, converter `f83af14d…` |
| 2026-11-08 | converter gains the pod-lifecycle channel (`cc26232d`), so the checkout now computes `f72899e5…` |
| 2026-11-09 | every bare dispatch is refused by the gate; the refusal names two digests and no tag |
| 2026-11-10 | cache rebuilt as `rcabench-pod-v1`; a dispatch that pins it succeeds |

The failure mode is not that the gate fired — it is that the gate's message did not contain the answer, and that
the answer was a **name**. `rcabench-pod-v1` describes the converter change; nothing about it says "this is the
one your checkout can read".

## What replaces it

> The identification of a cache is its `converterDigest`. A tag that has to be remembered is a second copy of
> that fact, and a second copy drifts.

`shard_tag` now defaults to **empty**, which means *resolve*. The workflow lists every tag on `rcabench-data`
(`git ls-remote`, not the releases API: the runner's token is scoped to this repository, and an unauthenticated
API listing shares a 60/hour budget with every other job on the host's IP), downloads each tag's `manifest.json`
(a few hundred bytes each), and hands the pairs to `scripts/fse26_cache_select.py`, which returns the single tag
whose digest equals this checkout's.

Three outcomes, and the two refusals are the point:

| candidates | outcome |
| --- | --- |
| exactly one carries this checkout's digest | that tag is consumed |
| none does | **exit 1**, listing every tag and its digest — the operator learns a rebuild is needed |
| two or more do | **exit 3**, naming them — the operator pins `shard_tag`, because two caches built by one converter may still differ in their source data and a name cannot choose between them |

A manifest that predates provenance (no `converterDigest`) is listed as `unknown` and **never** matches: an
unknown cache is not a matching cache.

## The inventory this produced

Read 2026-11-10 through the release API; `—` means the manifest carries no digest (schema 2 or earlier).

| tag | schema | converter digest | built | cases |
| --- | --: | --- | --- | --: |
| `rcabench-pod-v1` | 3 | `f72899e5…` **(= this checkout)** | 2026-11-10T00:28:21Z | 1422 |
| `rcabench-latency-full` | 3 | `f83af14d…` | 2026-09-14T13:42:44Z | 1422 |
| `rcabench-prefix-latency` | 3 | `f83af14d…` | 2026-09-14T11:45:27Z | 48 |
| `rcabench-full-v3` | 3 | `92927553…` | 2026-09-13T12:09:01Z | 1422 |
| `rcabench-full` | 2 | `00d9656a…` | 2026-09-11T13:08:40Z | 1422 |
| `rcabench-verify-v1` | — | — | — | 47 |
| `rcabench-subset` | — | — | — | 47 |
| `rcabench-full-v2` | — | — | — | 1422 |

**Two tags share `f83af14d…`**, and that is the ambiguity branch of the selector measured rather than imagined:
`rcabench-prefix-latency` is a deliberate 48-case subset of the same conversion. It is unambiguous today only
because the current digest is `f72899e5…`; on the day a rebuild reuses an old converter, the selector refuses and
the dispatch pins. That is the intended behaviour — a subset and a superset are both "built by this converter" and
they are not the same experiment.

## What this does not fix

`rcabench-pod-v1` carries all 1422 cases and its name describes the converter change that made it necessary. It
is a fine cache with a bad name, and the name no longer decides anything, which is the whole point. Renaming a
released tag would break every recorded run id in this repository's documents, and record-keeping beats tidiness.

## Where it is owned

| layer | symbol |
| --- | --- |
| selection | `select_cache`, `parse_candidates`, `describe` (`scripts/fse26_cache_select.py`) |
| this checkout's digest | `--digest` (`scripts/fse26_provenance.py`) |
| gate | `verify_provenance` … `--cache-label`, which now names the tag in a mismatch |
| wiring | `Resolve the cache tag from this checkout's converter digest` (`.github/workflows/fse26-benchmark.yml`) |
| tests | `scripts/test_fse26_cache_select.py` (18 cases, 100% branch), `scripts/test_fse26_provenance.py` |
