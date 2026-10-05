/**
 * The `? -1 : 1` comparator POPULATION, derived from the sources and checked against a record.
 *
 * ## The defect this exists for
 *
 * `docs/comparator-consistency-audit.md` (iteration 40) measured something real and expensive: a comparison
 * function is CONSISTENT iff `cmp(x, y) === -cmp(y, x)`, and a `key(a) - key(b) || (a.name < b.name ? -1 : 1)`
 * shape breaks that identity on exactly the pairs whose keys are EQUAL — it answers `1` in both directions. So
 * the audit patched `Array.prototype.sort`, asked every comparator BOTH ways without perturbing the sort, and
 * reported that all twenty sites were reached and none was ever handed such a pair.
 *
 * The measurement is sound. **Its population was not a measurement.** The twenty sites are a hand-written list
 * of `file:line` pairs in `.git/comparator_sites_40.py`, and the docstring says why that is the right shape for
 * a one-off join: "the census keys on the call site, the source keys on the tie-break, and the two differ by up
 * to five lines. Listing them once, in one place, is what makes the audit's table checkable against the code."
 *
 * That sentence was the design and also the failure. A list of LINE NUMBERS stops being checkable the moment
 * anything above it moves, and nothing was checking it:
 *
 * - **8 of the 20 line numbers are stale** in the tree this file was written against. The sites are still
 *   there; the coordinates are not. `fse26-diagnose-analyze.ts` lists 1201, 3479, 5812, 5828, 6946 while the
 *   tie-breaks sit at 1353, 3631, 5964, 5980, 7098; `fse26-separator.ts` lists 1124, 1156, 1355 against
 *   1126, 1158, 1357 — off by two, exactly the number of lines inserted above them.
 * - **A 21st comparator exists that the list has never held**: `rcaeval-loader.ts`, added in iteration 43, so
 *   it post-dates the census and nothing would ever have told the census.
 * - And it is the ONE site a per-line reading cannot see at all. The census's operand is the regex
 *   `/\?\s*-1\s*:\s*1/`, whose `\s` matches NEWLINES; the list was built by reading the pattern per LINE. The
 *   loader's comparator is wrapped by the formatter so that `? -1` and `: 1` sit on different lines, so it is
 *   invisible to the reading that produced the list and visible to the regex that the census runs. The operand
 *   and the population disagreed about what an occurrence IS.
 *
 * ## What this file asserts instead
 *
 * The population is DERIVED, and the record is keyed by something a line move cannot invalidate: the
 * tie-break's OWN comparison signature (`a.config < b.config`), which is what the audit actually reasons about
 * when it calls a key unique. Drift is then impossible by construction, and a new comparator fails this file
 * until it is enrolled with the population it sorts — in BOTH directions, so a record entry that no longer
 * exists also fails.
 *
 * @module __tests__/comparator-population
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

/**
 * The three projects whose sources hold this shape — the same three the audit's suite population covers.
 *
 * Named rather than discovered, because "every `.ts` in the repository" is a population that would silently
 * change with a new workspace, and the audit's suite run is scoped to exactly these three.
 */
const ROOTS: readonly string[] = ['packages/tree/src', 'packages/kinetic/src', 'benchmarks/src'];

/** The tie-break shape, written as the census writes it — with `\s`, which matches a newline. */
const TIE_BREAK = /\?\s*-1\s*:\s*1/g;

/** The comparison a tie-break applies to: `a.<something> <|>|- b.<something>`. */
const COMPARISON = /a[.[][\w$.[\]]*\s*(?:<|>|-)\s*b[.[]/g;

/** One recorded comparator: the signature a line move cannot change, and why its sort list is unique. */
interface RecordedComparator {
  /** The tie-break's own comparison, whitespace-collapsed, exactly as {@link signatureOf} derives it. */
  readonly signature: string;
  /**
   * The list the comparator sorts, and the property that makes its key unique IN THAT LIST.
   *
   * This is the field the audit argues from — a tie-break that cannot answer `0` is safe exactly where its key
   * is unique in the list it is handed — so it is recorded per site rather than stated once for all twenty.
   */
  readonly population: string;
}

/**
 * Every comparator in the three roots, keyed by the file that holds it.
 *
 * NO LINE NUMBERS APPEAR IN THIS TABLE, deliberately: that is the field that drifted, and the guard against a
 * record that rots is to stop recording the thing that rots. A count per signature carries the multiplicity —
 * `fse26-diagnose-analyze.ts` holds `a.faultType < b.faultType` twice, at two different sorts over two
 * different Maps, and collapsing them would hide one of them.
 */
const RECORDED: Readonly<Record<string, readonly RecordedComparator[]>> = {
  'benchmarks/src/fse26-diagnose-analyze.ts': [
    { signature: 'a.faultType < b.faultType', population: '`byType.entries()`, a Map' },
    { signature: 'a.id < b.id', population: '`one.scores`, a Map by service id' },
    { signature: 'a.family < b.family', population: '`rows`, one per screened family' },
    { signature: 'a.key < b.key', population: '`counter.entries()`, a Map' },
    { signature: 'a.faultType < b.faultType', population: '`byType.values()`, a Map' },
  ],
  'benchmarks/src/fse26-discriminator.ts': [
    { signature: 'a.config < b.config', population: '`configDeltas`, a `new Set` of names' },
  ],
  'benchmarks/src/fse26-report.ts': [
    { signature: 'a[0] < b[0]', population: '`perFaultType.entries()`, a Map' },
  ],
  'benchmarks/src/fse26-separator.ts': [
    { signature: 'a.row.faultType < b.row.faultType', population: '`byType.entries()`, a Map' },
    { signature: 'a.name < b.name', population: '`candidates`, one per signal' },
    { signature: 'a.name < b.name', population: '`census.total.cells`, one per signal' },
  ],
  'benchmarks/src/fse26-term-oracle.ts': [
    { signature: 'a.key < b.key', population: '`keys`, a `new Set` of family names' },
    { signature: 'a.key < b.key', population: '`counter.entries()`, a Map' },
    { signature: 'a.key < b.key', population: '`perType.entries()`, a Map' },
  ],
  'packages/kinetic/src/benchmarks/fse26-diagnose.ts': [
    { signature: 'a.label < b.label', population: '`kept` outcomes, one per metric' },
    { signature: 'a.label < b.label', population: '`withBreakdown`, one per metric' },
    { signature: 'a.label < b.label', population: '`dropped`, one per metric' },
    { signature: 'a.serviceId < b.serviceId', population: "the case's `services`" },
  ],
  'packages/kinetic/src/benchmarks/leaderboard/prism.ts': [
    { signature: 'a.serviceId < b.serviceId', population: '`scores`, one per service' },
  ],
  'packages/kinetic/src/benchmarks/loaders/rcaeval-loader.ts': [
    {
      signature: 'a.caller < b.caller',
      population:
        '`byEdge.values()`, a Map keyed by `caller\\u0000callee` — so no pair is ever equal, which is why ' +
        'the tie-break answers `0` for neither operand and the census measures `zeros=0`',
    },
  ],
  'packages/tree/src/pruning/pruner.ts': [
    { signature: 'a.serviceId < b.serviceId', population: '`scoredNodes`, one per `allNodes` key' },
    { signature: 'a.id < b.id', population: '`defined`, from `postInjectOnsetDelays`' },
  ],
};

/** Every `.ts` under a root, relative to the repository, sorted so two runs agree. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(join(repoRoot, root));
  return out.sort();
}

/**
 * The tie-break's own comparison, read from the text immediately before it.
 *
 * The LAST comparison in the preceding window rather than everything back to a delimiter, and that is a
 * measured choice: a delimiter walk swallows the statement or the comment above — on this population it
 * produced `d !== 0) return d; return a.serviceId < b.serviceId` for a site whose tie-break applies to
 * `a.serviceId < b.serviceId`. A signature that changes when a comment above it is reworded is not a
 * signature.
 *
 * @param text - The whole file.
 * @param at - The index of the `?` the tie-break starts at.
 * @returns The comparison, whitespace-collapsed, or the window's tail when no comparison precedes it.
 */
function signatureOf(text: string, at: number): string {
  const head = text.slice(Math.max(0, at - 220), at);
  const hits = [...head.matchAll(COMPARISON)];
  const last = hits.at(-1);
  const tail = last === undefined ? head : head.slice(last.index);
  return tail.replace(/\s+/g, ' ').trim();
}

/** The derived population: `file -> signatures`, with multiplicity, in file order. */
function derivedPopulation(files: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(join(repoRoot, file), 'utf8');
    const lines = text.split('\n');
    for (const match of text.matchAll(TIE_BREAK)) {
      const line = text.slice(0, match.index).split('\n').length;
      // A mention in prose is not a comparator. The audit's own census counted a COMMENT as one occurrence
      // and iteration 39's arithmetic paid for it; the exclusion is the first line of defence and the
      // signature is the second (a comment has no `a.<key> <|>|- b.<key>` before it).
      if (/^\s*(?:\/\/|\*)/.test(lines[line - 1] ?? '')) continue;
      const key = file.replace(`${repoRoot}/`, '');
      out.set(key, [...(out.get(key) ?? []), signatureOf(text, match.index)]);
    }
  }
  return out;
}

describe('the `? -1 : 1` comparator population is derived, not remembered', () => {
  const files: string[] = ROOTS.flatMap((root) =>
    sourceFiles(root).map((f) => f.replace(`${repoRoot}/`, '')),
  );
  const derived = derivedPopulation(files);

  // The explicit timeouts below are COST, not slack: this test re-reads every source under the three
  // roots to find which matches span a newline, and this sandbox charges ~34 ms per file read — measured
  // locally at 5.0 s, i.e. exactly the 5 s default. A census that reported its own I/O as a failure would
  // be reporting the wrong thing, which is the mistake the audit's suite run already made once.
  it('finds the population by a reading that can see a WRAPPED tie-break', () => {
    // The control, and it is the defect this file was written for. The census's operand is newline-tolerant
    // while the site list was built from a per-line reading, so the two disagreed about a site that exists.
    // A synthetic file is not needed: the assertion is that the derived total is the RECORDED total plus
    // nothing, and that at least one derived signature came from a match spanning a newline — which is
    // exactly the reading the old list could not perform.
    const all = [...derived.values()].flat();
    expect(all.length).toBeGreaterThan(15);
    const wrapped = files.filter((file) => {
      const text = readFileSync(join(repoRoot, file), 'utf8');
      return [...text.matchAll(TIE_BREAK)].some((m) => m[0].includes('\n'));
    });
    // Not decoration: if this ever reads zero the derivation has been rewritten into the per-line reading
    // that lost the site, and the count below would still pass while the instrument had gone blind.
    expect(wrapped.length).toBeGreaterThan(0);
  }, 120_000);

  it('records every derived comparator, and every recorded comparator is derived', () => {
    const missing: string[] = [];
    const extra: string[] = [];
    for (const [file, signatures] of derived) {
      const recorded = [...(RECORDED[file] ?? [])].map((r) => r.signature);
      for (const signature of signatures) {
        const at = recorded.indexOf(signature);
        if (at === -1) missing.push(`${file}  ${signature}`);
        else recorded.splice(at, 1);
      }
      // Whatever is left in `recorded` is a row the file no longer holds — the other direction, so a deleted
      // comparator cannot keep a record entry alive.
      for (const stale of recorded) extra.push(`${file}  ${stale}`);
    }
    for (const file of Object.keys(RECORDED)) {
      if (!derived.has(file)) extra.push(`${file}  (the file holds no comparator any more)`);
    }
    expect(missing, 'derived but NOT recorded').toEqual([]);
    expect(extra, 'recorded but NOT derived').toEqual([]);
  });

  it('states a population for every recorded comparator, so the uniqueness argument has a subject', () => {
    // The audit's argument is conditional — "safe exactly where its key is unique IN THE LIST" — so a row
    // without a list is a row whose condition cannot be checked. Non-vacuity for the whole record.
    for (const [file, rows] of Object.entries(RECORDED)) {
      expect(rows.length, `${file} must hold at least one comparator`).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.signature, `${file} signature`).toMatch(/^a[.[]/);
        expect(row.population.length, `${file} / ${row.signature} population`).toBeGreaterThan(8);
      }
    }
  });
});
