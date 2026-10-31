# The metric inventory's two channels, and the truncation check the census asked for

Iteration 41. The artifact's own channel census declared one line as a channel that nothing reads, excluded it
from its field equality **by name**, and wrote down the way out in the same sentence. This iteration builds that
way out, measures first that it changes nothing, and follows the fences that were waiting for it.

---

## 1. The claim, in the repository's own words

`scripts/dump_capability.py` declares `metric-list` — the `    metrics(n): cpu,mem,…` line — as:

> the metric NAME list and its declared size. **RENDERED ON EVERY ROW AND PARSED BY NO READER** — the reader's
> inventory comes from the three lines below — **so a truncation check built on it would be the first thing to
> read it.** BODY-placed: the value here is the names, and the size is the complement a truncation check
> compares them against

and it is one of exactly three channels declared with **no field**, "excluded from the field equality by an
explicit set rather than by being forgotten, because an exclusion nobody decided is not an exclusion".

So the state was: known, decided, fenced — and the remedy named. **A record that names its own way out is a
record with an open axis in it**, and that is what this iteration closes.

Two things make it worth closing rather than merely tidy.

**The line is on every row of every artifact.** Measured over the 8 dumps the corpus holds: **41,426 services,
41,426 `metrics(n)` lines, none absent.** It is the artifact's only statement of what a service's metric
inventory IS, and the python census agrees — its `metric-list` channel is asserted at `reach == EVERY`.

**And the reader already refuses its neighbour silently.** `parseDiagnosticDumpWithReport` decides whether
`metricKept`+`metricDrop` is faithful and, when it is not, sets `metricOutcomes = undefined` — with **no
counter anywhere**. `DiagnosticParseReport` counts blocks (`shortBlocks`, `unclosedBlocks`) and the candidates
they declared (`missingServices`), and nothing counts a per-SERVICE field. `cases: 89` reads exactly like an
artifact that has 89 cases; "every service carries the inventory its block declares" read exactly like an
artifact where none of them did. That is `dump-population-audit.md`'s defect one scope down.

---

## 2. The measurement, before any code

The check this iteration adds was run FIRST, over every `metric(n)` line of every dump, as an independent
python census rather than through the code it would later justify:

| claim | checked | violated |
| --- | --- | --- |
| the names a line renders equal the size it declares | 41,426 | **0** |
| no name is repeated inside one line | 41,426 | **0** |
| the names are in the producer's declared order (sorted) | 41,426 | **0** |
| `metricKept(n)`'s body has `n` entries | 6,740 | **0** |
| `metricDrop(n)`'s body has `n` entries | 6,740 | **0** |
| `metricTop(n)`'s body has `n` entries | 6,736 | **0** |
| the declared size equals `kept + drop` | 6,740 | **0** |
| `metricTop` is the HEAD of `metricKept`, in order | 6,736 | **0** |
| `metricDecisive`'s label is one of the names the row carries | 36,313 | **0** |

**Zero violations in roughly 114,000 checks.** So the check is INERT on every artifact that exists — a reading
rather than a repair — and the corpus A/B in §7 is a measurement of that rather than a hope.

The population is worth reading too, because it is smaller than the first row suggests: the outcome channels are
rendered only for the ground truth and the engine's predictions, so **6,740 of 41,426 services have them**. A
check that compared the declared size against an outcome count on all 41,426 would refuse **34,686** of them for
having no `metricKept` line at all. That number is in the code as a comment because it is the reason the
cross-channel check sits INSIDE the same guard that opens the inventory, and it is not a guess.

---

## 3. The change

`benchmarks/src/fse26-diagnose-analyze.ts`:

1. **`METRIC_LIST_RE`** — the reader parses the line at last. `(?: (.*))?$` and not `(.+)`: an empty inventory
   is a real state, and the producer writes it as `metrics(0): ` **with a trailing space**.
2. **`DiagnosedService.metricNames`** — `readonly string[] | undefined`, the artifact's inventory. `undefined`
   for two provenances that a consumer cannot tell apart and should not have to: a block older than the line,
   and a line this reader REFUSED. They are one value; the report is what keeps them apart.
3. **The check, in two halves.** The line's own declared size against the names it rendered, at the line; and
   the declared size against the outcome channels' total, in `finalizeOutcomes` where both are in hand.
4. **`truncatedInventories` and `missingMetrics`** on `DiagnosticParseReport` — ONE count for ONE reason and
   the SIZE of the loss, exactly the shape `shortBlocks`/`missingServices` already has. The reason is the fact
   ("this service's inventory is not the inventory its block declares") and not the mechanism; the two ways of
   disagreeing are details of that one fact, which is the argument `unclosedBlocks` already makes for counting
   "the file ended" and "a further header began" as one.
5. **`hasParseLoss`** extended. Its contract is "whether the reader refused any part of the artifact", and a
   refused inventory is a part.
6. **`formatParseReport`** prints the per-service half beside the block half, at zero as well as above it —
   `0 services with a truncated metric inventory` is a measurement and an omitted clause is the different claim
   that nobody checked.

**The disposition is the FIELD, not the block.** A case whose inventory disagrees is a case whose candidates and
ranking are intact, so dropping it would lose real data to a display-channel defect. And `metricOutcomes` is NOT
refused with it: its own rule has already judged it, and a second refusal would punish a faithful channel for
its neighbour's defect. The spec asserts exactly that.

---

## 4. The fence, in three languages

The field is read by the reader and by no SEPARATOR SCALAR, and the repository has three separate structures
that each had to be told so. Every one of them failed the build or the suite until it was:

| structure | where | what it forced |
| --- | --- | --- |
| `SERVICE_FIELD_KIND` | the reader | `metricNames: 'absent-or-value'` — the field admits `undefined` and the producer renders no tripwire token into it |
| `SERVICE_FIELD_AUDIT` | `fse26-separator.ts` | the entry, with the reason it is `NOT read:` and *who does read it* |
| `unscreenedFields()` | `fse26-separator.test.ts` | the pinned list `['isGroundTruth','predictedRank']` → three entries, "a field moving between these lists is a decision, and the test is what forces it to be reviewed" |
| `metric-list`'s `fields` | `dump_capability.py` | `()` → `('metricNames',)`, and `NO_FIELD_CHANNELS` derived down to two |
| the committed projection | `dump_capability.channels.json` | regenerated — one line, `"fields": [] -> ["metricNames"]` |
| `NO_FIELD_CHANNELS`'s test | `test_dump_capability.py` | the expected set, three → two, with the departure written as a decision |
| the census' `noField` list | `fse26-capability-census.test.ts` | three → two |
| the census' per-row equality | same file | `NOT_FIELD_PRESENCE` gained a fifth entry, and §5 is why |

---

## 5. The one divergence the fences found

The per-row equality in `fse26-capability-census.test.ts` compares, for every field-carrying channel, what the
python census reads off a line against what the READER's field holds — row by row, on a block the real producer
wrote. `metric-list` is the first channel to fail it, and the failure is real rather than a gap on either side:

- the census's `absent` set is `["", "-"]`, so `metrics(0): ` — an empty body — is **unvalued**, because the
  census is asking which NAMES the row carries and it carries none;
- the reader stores `[]`, a **measured zero**, because it is asking what the service's inventory IS.

Both are right about the same line, and they are not the same claim. The map's own docstring says what to do:
"An exclusion by decision rather than by silence … a channel that can drop out of it unnamed is how a one-sided
test starts passing." So `metric-list` joined `NOT_FIELD_PRESENCE` with that reason, and the counts beside it
moved by one and by one — **not** by two, because the channel entered the population of 20 and left it again
into the excluded set, so `comparable` stayed at 15.

**That is the value of a fence that compares two instruments rather than checking one against itself**: the
census and the reader were both self-consistent, and the edge between them is where the interesting statement
was.

---

## 6. The sheets

**Sheet one — the reader's new arms, on the SUITE runner (7 rows, 0 mismatches).** Each row removes one
mechanism the change added; the anchors are asserted unique before the sheet runs.

| row | mechanism removed | verdict | ran | failed |
| --- | --- | --- | --- | --- |
| C1 | — (control) | SURVIVED | 450 | 0 |
| M1 | the declared size accepted unconditionally | KILLED | 450 | 2 |
| M2 | the cross-channel check removed | KILLED | 450 | 1 |
| M3 | the emptiness tested AFTER the split | KILLED | 450 | 1 |
| M4 | the field NOT refused (counted but left populated) | KILLED | 450 | 1 |
| M5 | the refusal left out of `hasParseLoss` | KILLED | 450 | 1 |
| M6 | the population line silent about it | KILLED | 450 | 1 |

Six of the seven kill exactly ONE test, and each of those is a different one of the four specs this iteration
adds — which is what makes the specs arms rather than a story. M1 kills two: the spec that isolates the size
check, and the spec that reads the population line, which are the field half and the report half of the same
refusal. M2 is the row the sheet is for: the cross-channel check is the half `metricKept` and `metricDrop` cannot
make on their own, because they declare their own counts and agree with each other; a body cut mid-write leaves
them intact and only the LIST disagrees.

M3 is the row that records a defect found while writing the specs: `''.split(',')` is `['']` — one empty NAME —
so a check that split first and filtered after would read `metrics(0): `, a measured zero, as a body one token
short of its size and refuse it.

### And the sheet found a defect in a SPEC, which is the most useful thing it did

The first version of the size-check spec declared three names over a body of one and gave the service a single
outcome. **That fixture is refused by BOTH halves**, so with the size check switched off (M1) the cross-channel
check refused it anyway, every assertion held, and the sheet reported `failed=1` where the fixture had been
written to depend on M1. The spec was green for a reason it did not state.

The repair is the fixture: the outcome channels now ADD UP to the declared size (one kept, one dropped, declared
two) while the BODY is one name short, so the cross-channel half is satisfied and the size half is the only
thing that can refuse it — and M1 then kills it. **A fixture can be masked by the guard beside it**, and the
only instrument that could see it was a sheet whose row was expected to be the one killed.

---

## 7. The A/B

The change adds a parsed field and a clause to a report line, so byte-identity of the whole reading is not
available and would not be the claim. What must not move is everything the reader COMPUTES: every case, every
field of every service except the new one, and the three block counters that already existed.

`.git/probe_inventory_41_ab.ts` prints exactly that projection, built at runtime from `Object.entries` with the
new field's name in a skip list — because the parent tree's TYPE does not have `metricNames`, and a probe that
spelled it would not compile there. A harness that cannot run on one of the two sides measures one side.

```
lines=747009
lines=747009
diff lines: 0
RESTORE VERIFIED
```

747,009 lines on both sides, zero differing. And the new surface is measured separately rather than folded in:
`.git/probe_inventory_41.ts` is the census of §2 as the READER now reports it —

```
population — re1.txt: 375 blocks kept, 0 dropped (…); 0 services with a truncated metric inventory, 0 names declared and not accounted for
NUMBERS services=41426 parsed=41426 (of which empty=100) absent=0 distinctNames=10
NUMBERS refusedPerReport=0
```

**Every service parsed, 100 of them a genuinely empty inventory, none refused.** The 100 empties are the
non-vacuity that matters most here: they are 50 services in each of `re2.txt` and `re2-noinject.txt`, so the
`metrics(0): ` arm is a state the corpus really produces rather than a shape invented for a test — and it is
the arm M3 exists for.

---

## 8. The gates

`prettier` clean over the repository's format glob, `oxlint` clean (340 files, 102 rules, 0 warnings and 0
errors), `tsc -p benchmarks/tsconfig.json` clean and `tsc -p tsconfig.workspace.json` clean. The three suites:
`benchmarks` **23 files / 935 tests**, `packages/tree` **15 / 650**, `packages/kinetic` **37 / 968** — all
passing. The python suite is **80 tests, OK** over the two files this change touches, and the committed JSON
projection is byte-equal to what its own generator writes.

Coverage on `benchmarks`: **statements 99.95, branches 99.88, functions 100.00, lines 99.95** — every dimension
above the 95% bar, and the branch dimension is the SAME value it had before the change. The uncovered surface is
read through `.git/cov_lines.py` rather than the reporter's column and is **3 arms and 3 statements**: the two
loop exits at 2967–2968 and the `'unbounded'` clause at 5236, all of them in `fse26-diagnose-analyze.ts` and all
of them carried over — the change adds no net uncovered arm.

**It added one on the first run, and that is worth recording because the fix was a fixture and not a comment.**
The refusal at the top of the cross-channel branch (`if (lastService.metricNames === undefined) return;`) is only
reached when a service has BOTH a refused inventory AND rendered outcome channels, and the first version of the
spec that refuses a truncated body used a non-ground-truth service — which renders no outcome channels at all, so
the branch was never entered and its arm read `0`. Making that spec's service the ground truth one AND giving it
an inventory puts the reader in the state the branch is about, and the count returned to 3. **A reader of the
coverage number would have seen 99.84 and no explanation; the arm it was hiding was one this iteration had just
written.**

The whole instrument and every number above is reproducible from `.git/probe_inventory_41.ts`,
`.git/probe_inventory_41_ab.ts`, `.git/probe_ab_41.sh` and `.git/mutation_pass_41.py`.

---

## 9. What is not claimed

- **The check is inert on the corpus and that is a measurement, not a proof.** 41,426 lines agree and 0 are
  refused; a different artifact could disagree, and the specs are what hold the arms until one does.
- **The field is read by the reader and by no signal.** `SERVICE_FIELD_AUDIT` says `NOT read:` and the entry
  says which reader does read it, because the audit classifies SCALARS and this is a different question.
- **The census's `metric-list` reading is not wrong.** It reports which names a row carries; the reader reports
  what the inventory is. §5 is the record of that, not a repair of either.
- **No claim is made about the FSE'26 bridge.** `merge_metric_maps` concatenates series per service without
  deduplicating names, and its docstring says a duplicate is harmless because the engine scores each series
  independently. That is true of the ENGINE and says nothing about the ARTIFACT, which renders a service's
  inventory as a label-keyed list — so a duplicate name would now be REFUSED by this check rather than read.
  The corpus has never produced one, and nothing here claims it cannot.
