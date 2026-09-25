# Declarations that are not connected to what they name

Two defects, measured on **2026-09-25**, in two layers that share no code: an artifact's cache key,
and a command's coverage flag. They are one defect. A declaration that reads like a claim — a name, a
flag — while nothing connects it to the thing it names. **Both instruments reported success the whole
time**, which is why neither was visible from a log.

| | the declaration | what it was meant to name | what it was actually connected to |
| --- | --- | --- | --- |
| the converted artifact | `key: RCAEvalJSON`, 26 times in 11 workflows | which bridge produced the dataset every RCAEval cell is read from | nothing: a constant, so a change to the bridge could not invalidate the bridge's own output |
| the coverage request | `-- --coverage`, 1 root script and 2 CI steps | whether the suites are measured against their thresholds | the package manager's willingness to forward an argument |

The two halves are worth reading together because the remedies are the same shape, and because the
fences that already existed for both were — in each case — **checks on the spelling**. A fence that
reads a command's text cannot see a flag that was dropped; a fence that reads a cache key's name
everywhere cannot see that the name is a constant. Both fences passed while neither subject worked.

## 1. The law

**A declaration is a claim only when something connects it to the thing it names, and the connection
must be checkable from the repository rather than from the environment.**

The failure mode is not a wrong value. It is a value that is *unrelated* to its subject and looks
right: `RCAEvalJSON` is a plausible name for a cache key, and `-- --coverage` is the documented way to
pass a flag through a task runner. Both are correct-looking, and in each case whether the declaration
reached its subject depended on something outside the repository — on nobody editing the bridge, and
on the package manager's argument handling.

So the rule applied in both places is the same three-part shape:

1. **derive** the declaration from the thing it names, so the two cannot disagree;
2. **state** it in the artifact and **verify** it at the point of use, so a mismatch refuses rather
   than degrades;
3. **fence** the derivation, not the spelling — including the reverse direction, so no half can drift
   alone.

## 2. Site 1 — the artifact's key named nothing, and eleven runs proved it

`cache-datasets.yml` declares its own trigger as *run when the bridge changes*:

```yaml
on:
  push:
    paths:
      - 'scripts/convert-parquet-to-json.py'
```

and then keyed the artifact on a constant:

```yaml
      - name: Restore cached JSON
        with:
          key: RCAEvalJSON
```

A constant cannot notice a change in what it caches, so the trigger could never act. Measured from the
run log of eleven runs, each of which reached the conversion step:

| run | commit | `Restore cached JSON` | `Convert Parquet to JSON` |
| --- | --- | --- | --- |
| `35505798520` | **`2b15f6e` — the commit that FIXED the bridge** | hit, 2 min 27 s | **skipped** |
| `35496563670` | `1990ee74` | hit | skipped |
| `34744258810` | `debf820c` | hit | skipped |
| `34017255876` | `dc1b418b` | hit | skipped |
| `33299890322` | `2770096b` | hit | skipped |
| `32614070810` | `58ea21a8` | hit | skipped |
| `32103694992` | `913dbffd` | hit | skipped |
| `31922943703` | `15a8f1d8` | hit | skipped |
| `31292437613` | `f2fd7c51` | hit | skipped |
| `31244207795` | `27e93e17` | hit | skipped |
| `31241391695` | `6b72cbf8` | hit | cancelled |

**Ten `skipped` and one cancelled, eight of the eleven from the weekly schedule** whose own declaration
is `# Weekly refresh (Sunday 2am UTC)`. The last conversion that actually ran was `31242187872` on
**2026-08-08**, and its log is the only record anywhere of what produced the artifact:

```
Successfully installed numpy-2.5.1 pandas-3.0.5 pyarrow-25.0.0 python-dateutil-2.9.0.post0 six-1.17.0
Complete: 735/736 cases converted, 1 failed in 1244s (20.7 min)
Case dirs: 736   JSON files: 735   CSV files: 599   Size: 39G
```

Those versions were **unpinned** and appear in no key, no workflow and no data. The 39 GB artifact the
golden nine-cell was read from was 48 days old and its producer was unrecoverable; the commit that was
supposed to invalidate it could not.

**Two more faults in the same eleven declarations.** The constant was typed at **26 sites in 11
workflows** — `benchmark-rcaeval.yml` alone restored this path in seven jobs — and **25 of the 26**
carried `restore-keys: RCAEval-json-`, a fallback that can never fire: a restore key matches by
PREFIX, and `RCAEvalJSON` does not begin with `RCAEval-json-`.

### The fix

`scripts/rcaeval_provenance.py` owns the key, and one declaration produces all four consequences:

| consequence | from `PRODUCER_FILES` |
| --- | --- |
| the cache key | `RCAEvalJSON-<16 hex of the digest>`, derived from the bridge and its pin file |
| the artifact's stamp | `~/RCAEval-json/.rcaeval-provenance`, written by the producer |
| the refusal at use time | `--verify` refuses an artifact whose stamp names another bridge |
| the workflow's `paths:` trigger | checked EQUAL to the same file set, both directions |

The digest law itself is not restated: `fse26_provenance.digest_over` is its single owner and the new
module supplies only its file set, so the two caches cannot disagree about what a digest is. The stamp
is a dot-file with no counted extension because **nine** TypeScript walkers descend
`~/RCAEval-json` and every one of them admits an entry only when it is a directory whose name does not
start with a dot — checked by reading those walkers, not by assuming it.

`.github/actions/rcaeval-json/action.yml` is the one owner of the path, the key, the restore and the
trust, in three named roles — `prepare` (a miss is expected; the caller converts), `consume` (a hit is
required, and a miss fails), `save` (publish). All **26 sites** across the 11 workflows invoke it, so
the artifact's name is spelled once. The pinning that `coverage-gate-audit.md` §9 left open is closed
in the same move: `scripts/requirements-rcaeval.txt` owns `pandas`/`pyarrow`, the bridge installs from
it, `PRODUCER_FILES` digests it, and `requirements-fse26-dev.txt` pulls it in instead of repeating it.

### What the first push proved, live rather than by fixture

The mechanism was verified by the push that carried it, not by a fixture:

- `Cache Benchmark Datasets` (run `36114115026`) shows the derived key **MISSING** and `Convert Parquet
  to JSON` **running** — the first conversion since 2026-08-08. The constant could not have produced
  that line, and the trigger now has the effect it always declared.
- `Benchmark — RCAEval Full Dataset` (run `36114115010`, the workflow's own push trigger) shows the
  action doing all three of its jobs on the first attempt:

```
[start-action] Derive the key from the bridge that produces the artifact
[start-action] Restore the converted artifact
[start-action] Refuse an artifact this checkout's bridge did not produce
ERROR: no stamp at /home/runner/RCAEval-json/.rcaeval-provenance: the artifact's producer is unknown,
       which is what this check refuses
```

### The ordering this exposed, which is a property of the TRIGGERS

That refusal made four jobs of the push-triggered benchmark **red**, and it is correct: the artifact
whose producer is this commit's bridge did not exist yet, because the workflow that produces it was
started by the SAME push. The alternative — reading another bridge's artifact and reporting it as a
measurement of this tree — is the defect this iteration removes.

What it exposes is that `benchmark-rcaeval.yml` is started by **two independent events on one push** —
its own `paths` trigger, and later `workflow_run: Cache Benchmark Datasets` — and only the second has
the artifact. Measured: the push run's four `rcaeval-*` jobs `failure`, its three `ablation-*` jobs
`skipped`, `dashboard` `success`.

`consume` cannot distinguish *the artifact does not exist YET* from *the artifact does not exist*, and
that distinction is not the consumer's to make. Named rather than papered over: the remedies are a
bounded wait in the consumer (the key is derivable, so the wait is checkable) or a sequenced trigger
graph — **not** a loosening of the refusal.

One consequence of content-addressing is worth recording because it removes a whole class of this
problem: the artifact's identity is its PRODUCER, not its commit, so a later commit that does not touch
the bridge or its pin inherits the artifact the earlier commit's run converted. That is why the
conversion this push started remains valid for the commit that fixed the test CI caught.


## 3. Site 2 — the coverage request was a flag that travelled

`package.json` asked for coverage by APPENDING it:

```
nx run-many --target=test --all --exclude=… --parallel=1 --skip-nx-cache -- --coverage
```

and an appended argument travels **nx → package manager → the script**. Whether it arrives is a
property of the package manager, not of this repository. Measured here:

| | |
| --- | --- |
| `pnpm coverage` (this environment) | 14 projects, every suite green, **exit 0**, **no coverage table**, and `packages/core/coverage/coverage-final.json` **not rewritten** (mtime 2026-09-20 13:58 across a run at 16:16) |
| the mechanism | nx's `test` target is `nx:run-script` with `vitest run`; the package manager here is a shim whose last line is `PATH="$bins$PATH" exec sh -c "$cmd"`, which runs the script's command string and drops every argument after the script name |
| the same form on CI (run `35505798486`, job `test (core)`) | `> vitest run "--coverage"`, `Coverage enabled with v8`, `All files 99.88 / 96.61 / 100 / 99.88`, and a **100,684-byte** `coverage-core` artifact |

So the CI gate was real and the local command was a **silent no-op that reported success** — the same
shape as the cache, one layer over. And the fence that guarded it could not see this:

```ts
expect(script).toMatch(/nx\s+run-many\s+--target=test\s+--all/);
expect(script).toContain('--coverage');
```

Both assertions **pass on the broken command**. A check on the spelling is satisfied by the spelling.

### The fix

The request is a **target whose script body holds the flag**, so there is no layer to lose it in:

| | |
| --- | --- |
| the root script | `nx run-many --target=test:coverage --all … --skip-nx-cache` |
| the target | `test:coverage` = `vitest run --coverage`, declared in **all 14** projects — seven had none |
| CI | `pnpm nx run <name>:test:coverage` (the matrix job and `benchmark-tests`) |

**The local reading the old command could not produce**, from the retargeted command: **14 projects,
56 dimensions, 3,998 tests, zero threshold violations, exit 0, worst dimension 95.00**.

| project | stmts | branch | funcs | lines |
| --- | --- | --- | --- | --- |
| wave | 99.61 | **95.00** | 100 | 99.61 |
| cutting | 98.43 | 95.17 | 100 | 98.43 |
| scaling | 100 | 95.49 | 100 | 100 |
| core | 99.88 | 96.61 | 100 | 99.88 |
| benchmarks | 99.84 | 97.46 | 100 | 99.84 |
| kinetic | 100 | 99.44 | 100 | 100 |
| tree · noise · causal · ai · optimize · storage-fs · storage-browser · storage-remote | 100 | 100 | 100 | 100 |

## 4. The fences, and what they may not be

| fence | what it checks |
| --- | --- |
| `scripts/test_rcaeval_provenance.py` (44) | the key moves for a one-byte change to the bridge and does NOT move for a test-only change; the stamp refuses absent, foreign-digest, stale-schema and unreadable; every `key:` under `.github/` is the derivation or a recorded upstream constant, and every recorded constant is still used; no workflow may name the artifact's path in a cache step; every site uses the action, asks for a declared mode, and has checked out first; a caller may only read an output the action declares; the trigger equals the producer set; the pin has one owner; the stamp is invisible to all nine readers |
| `coverage-population.test.ts` (8) | every coverage config states `include` and four thresholds ≥95; the root script targets `test:coverage` and never appends the flag; **every project with a bar declares a `test:coverage` script that HOLDS the flag, and a project without a bar declares none**; **no workflow appends `--coverage` after `--`**, and CI invokes the target at least twice; the excluded set equals the barless set |

Three of those exist because the first version of the fence was written in the wrong currency:

- **`key: RCAEvalJSON` was deleted from 26 sites and a fence checking for its absence would have been
  satisfied by deleting a comment.** The rule is over the `key:` VALUE and over the recorded list, in
  both directions, which is what makes the upstream constant (`RCAEval-datasets-v2-pq`) a *decision*
  rather than an oversight.
- **The action's outputs were changed and one caller kept asking for `cache-hit`** — the shape
  `actions/cache` uses and not one this action declares. A condition reading empty takes the same
  branch for a hit and a miss, so the producer would have converted nothing while looking correct.
  Found by re-reading the change; fenced by comparing every `steps.<action-id>.outputs.<name>` a
  workflow reads against the names the action declares.
- **A substring assertion is defeated by a suffix**: `expect(text).toContain('path: ~/RCAEval-json')`
  accepts `path: ~/RCAEval-json-old`. The path rule is a whole-line match over every spelling of the
  directory, and the mutation row that appends a suffix is what proved it.

## 5. What is deliberately NOT fixed, with its measurement

**The Parquet layer's key is still a hand-bumped constant** (`RCAEval-datasets-v2-pq`), and it has the
same defect one layer up: its identity is an upstream Hugging Face revision, which neither the bridge
nor this repository computes, and this environment cannot resolve it. Deriving it would force a 3.3 GB
re-download whose effect on the golden cannot be measured from here. It is recorded on
`rcaeval_provenance.UPSTREAM_CONSTANT_KEYS` with that reason, and the fence requires every key to be
either derived or on that list — so it is a stated boundary rather than an omission.

**The producer and the gate run the bridge on different interpreters**: `cache-datasets.yml` uses
Python 3.12 and `ci.yml`'s `converter-tests` uses 3.13. Held this iteration because the artifact is
already moving twice (the bridge's behaviour and its newly pinned reader) and a third moving part
would make a golden reading unattributable. `PRODUCER_PYTHON` records it and the fence fails if the
workflow drifts from the record.

## 6. Why this is one record and not two

Both sites produced the same evidence: **an instrument that reported success**. `Cache Benchmark
Datasets` concluded `success` while converting nothing for eleven runs; `pnpm coverage` concluded
`success` while measuring nothing. Neither is detectable by reading its own output, because in both
cases the output was correct for the work that was actually done — the wrong work.

What makes them findable is comparing the declaration against its subject: the trigger's `paths`
against the key, and the flag against what the runner received. **A claim that nothing connects to its
subject cannot be falsified from a log, only from the connection.**

## 7. What the fix measured, on a re-converted artifact

The derived key made the next `Cache Benchmark Datasets` run a MISS **by construction**, so it converted
for the first time since 2026-08-08 — and every count that existed before is unchanged while the
producer is now named:

| | before — 2026-08-08, **pandas 3.0.5 / pyarrow 25.0.0**, installed unpinned | after — 2026-09-25, **pandas 3.0.6 / pyarrow 25.0.1**, from the file the key digests |
|---|---|---|
| `Complete:` | 735/736 converted, 1 failed | **735/736 converted, 1 failed** |
| `Case dirs` · `JSON files` · `CSV files` · `Size` | 736 · 735 · 599 · 39G | **736 · 735 · 599 · 39G** |
| `carried no columns` refusals | — | **zero** |
| the key | `RCAEvalJSON` | `Cache saved with key: **RCAEvalJSON-80520ccbbc8ffb70**` |

Two facts, measured rather than argued:

- **The bridge's `dataframe_is_readable` guard removes nothing on the real dataset** — no case's
  `traces.parquet` or `logs.parquet` is a directory, so it refuses only a case the data does not contain.
  It is a guard, not an output change.
- **The reader's patch bump does not move the artifact's shape.**

And the benchmark read from that NEW artifact reproduces the shipped battery **9 of 9 cells
byte-identical** (`RE1 80 / 92.8 / 68`, `RE2 82.4 / 88.9 / 68.1`, `RE3 80 / 45 / 51.1`), with the
consumer's own log showing the whole path rather than a claim about it:

```
[start-action] Derive the key from the bridge that produces the artifact
Cache restored from key: RCAEvalJSON-80520ccbbc8ffb70
stamp OK: /home/runner/RCAEval-json was produced by sha256:80520ccbbc8ffb70…
```

**So this is the strongest of the six golden readings.** The previous five were taken from one 39 GB
artifact produced on 2026-08-08; this one was taken from a dataset converted twenty minutes earlier by
the fixed bridge under the pinned reader, whose stamp states its producer. The claim that the fix and
the pin bump leave the published benchmark alone is now a measurement of a new artifact, not a
derivation from the shape of a change.

