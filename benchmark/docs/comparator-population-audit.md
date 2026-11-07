# The comparator census had a measurement and a remembered population

**Status:** defect found, measured, fixed, and fenced. **Code:**
`packages/kinetic/__tests__/unit/comparator-population.test.ts`.

`docs/comparator-consistency-audit.md` (iteration 40) asked a question worth asking and answered it properly:
a comparison function is *consistent* iff `cmp(x, y) === -cmp(y, x)`, a `key(a) - key(b) || (a.name < b.name ?
-1 : 1)` shape breaks that identity on exactly the pairs whose keys are EQUAL, and so patching
`Array.prototype.sort` to ask every comparator **both ways** is a site-independent witness. It reported that
all twenty sites were reached and that none was ever handed such a pair.

That measurement is sound and this document does not touch it. What it touches is the **population**, which
was never a measurement at all.

---

## 1. The population was a list of line numbers, and 8 of its 20 entries no longer point at anything

`.git/comparator_sites_40.py` holds the twenty sites as `(file, tie-break line, sort-call line, key,
population)`, and its docstring defends the choice: the census keys on the call site, the source keys on the
tie-break, "and the two differ by up to five lines. Listing them once, in one place, is what makes the audit's
table checkable against the code."

That sentence is the design and also the failure, because a line number is a coordinate in a file that other
iterations keep editing. Checked against the tree this iteration ran on:

| file | listed tie-break lines | where the tie-breaks actually are |
| --- | --- | --- |
| `benchmarks/src/fse26-diagnose-analyze.ts` | 1201, 3479, 5812, 5828, 6946 | **1353, 3631, 5964, 5980, 7098** |
| `benchmarks/src/fse26-separator.ts` | 1124, 1156, 1355 | **1126, 1158, 1357** |

**8 of the 20 entries are stale.** The sites are all still there; the coordinates are not. The
`fse26-separator.ts` pair is off by exactly two — the number of lines inserted above them — and the
`fse26-diagnose-analyze.ts` group has drifted by 152 at its last entry. The relationship the docstring calls
"checkable against the code" is checkable only while nothing above it moves, and **nothing was checking it**.

## 2. A 21st comparator exists that the list has never held, and it is the one a per-line reading cannot see

`rcaeval-loader.ts` gained a comparator in iteration 43 — one iteration after the census — so the census
post-dates nothing and knows nothing about it. That alone would be ordinary staleness. What makes it a defect
about the INSTRUMENT is how it is written. The census's operand is the regex `/\?\s*-1\s*:\s*1/`, whose `\s`
matches **newlines**. The list was built by reading the pattern **per line**. Prettier wraps this site, so
`? -1` and `: 1` sit on different lines:

```ts
      a.caller !== b.caller
        ? a.caller < b.caller
          ? -1
          : 1
        : a.callee < b.callee
          ? -1
          : a.callee > b.callee
            ? 1
            : 0
```

Measured: over the three roots, the pattern has **21 same-line matches and 1 across-lines match**, and the
across-lines one is this site. So **the operand and the population disagreed about what an occurrence is** —
the regex can see it, the reading that produced the list could not — and neither the format nor the count would
ever have said so.

## 3. The measurement the census had never taken for it

The site list's staleness did not make the census's *verdict* wrong; it made the verdict incomplete. So the
missing comparator was asked both ways with the audit's OWN instrument, not a re-derivation of it
(`.git/probe_loader_comparator_45.ts` installs `installComparatorCensus` and drives `countFailedTraceEdges`
over a six-edge fixture):

```
SITE | rcaeval-loader.ts:1287:6 | lists=1 | elements=6 | calls=10 | unordered=0 | zeros=0 | thrown=0
  SOURCE (a,b)=>a.caller!==b.caller?a.caller<b.caller?-1:1:a.callee<b.callee?-1:a.callee>b.callee?1:0
```

**`unordered=0`**: it is never handed a pair it cannot order, so its tie-break is consistent. Two readings of
its callee arm agree that it answers `0` in both directions — `a.callee < b.callee ? -1 : a.callee > b.callee ?
1 : 0` — and `zeros=0` says the census never observed a comparison answering `0`, which is the same fact the
coverage gate reports from the other side: the `: 0` arm is unreachable because the rows come from a `Map`
keyed by `caller\u0000callee`.

Note the site key above: `1287:6` is the `.sort(` CALL, while the tie-break is at `1290` — the "up to five
lines" of the docstring, and the reason the hand list carried two numbers per site and both of them could
drift.

## 4. The fix: derive the population, and key the record by something a line move cannot invalidate

`comparator-population.test.ts` DERIVES the population from `packages/tree/src`, `packages/kinetic/src` and
`benchmarks/src`, and checks it against a record in BOTH directions, so a comparator that is added fails until
it is enrolled and a record entry whose comparator was deleted also fails. Three decisions make it
drift-proof rather than merely new:

1. **No line numbers anywhere in the record.** The field that rotted is not recorded any more; that is the
   whole guard. Each row holds the tie-break's OWN comparison — `a.config < b.config` — which is what the audit
   reasons about when it calls a key unique, and `count` carries the multiplicity that a per-file grouping
   would otherwise hide (`fse26-diagnose-analyze.ts` holds `a.faultType < b.faultType` **twice**, over two
   different Maps).
2. **A signature is the LAST comparison before the tie-break, not everything back to a delimiter.** A delimiter
   walk was measured first and it swallows the statement or the comment above: on this population it produced
   `d !== 0) return d; return a.serviceId < b.serviceId` for a site whose tie-break applies to
   `a.serviceId < b.serviceId`. A signature that changes when a comment above it is reworded is not a
   signature.
3. **The reading is newline-tolerant and comments are excluded, and both are asserted.** The first test finds
   which matches span a newline and requires that count to be non-zero — if the derivation is ever rewritten
   into the per-line reading that lost the 21st site, the count assertions would still pass while the
   instrument had gone blind.

## 5. What this changes, and what it does not

It does **not** reopen the audit's verdict: `unordered=0` on the site that had never been asked is the same
answer the other twenty gave, so the population is now complete AND the answer is unchanged. It does change
what the answer rests on — the census's completeness was a remembered list of coordinates, and it is now a
derivation with a control.
