/**
 * SOTA populations — which population each reference reports on, and who owns that fact.
 *
 * ## The defect this fence replaces
 *
 * `sota-comparison.md` §0a entry 5 carried this, for three iterations:
 *
 * > **Filed as a CANDIDATE ABOVE US WHOSE POPULATION IS NOT VERIFIED** … `375 = 3 × 125` is RE1's signature
 * > … **so if the cohort is RCAEval's RE1, this would be the first reference to exceed our 80.27% on a
 * > population we can name**, by **5.1pp**.
 *
 * **The reading it was waiting for took one fetch.** The paper's own full text evaluates *"the three RCAEval
 * diagnostic environments"* and its own project page names *"RCAEval RE1 failure cases (375)"* — so the
 * population is ours, the gap is real, and RE1 is a cell we had never been second on. Three iterations held a
 * **shape match** — a case count and a metric name agreeing with ours — where a population was needed.
 *
 * Both searches the record ran were ABSTRACT searches, and a population is in neither the abstract nor any
 * index of it. That is register law 10 (`a paper's own artefact statement is the authority on whether its
 * artefact is public`) one surface over, and it is now law 37: **the artefact that states a paper's population
 * is its own full text or its own project page.**
 *
 * ## The four invariants
 *
 * 1. **Population, derived, both directions.** Every artefact token `sota-comparison.md` names has exactly one
 *    row in `docs/sota-populations.md`, and the inventory has no row for a token the document does not name.
 *    The grammar is shared with the availability fence, so the two inventories cannot disagree about WHAT they
 *    are pricing — only about which question they answer.
 * 2. **Row shape.** The verdict is a member of the closed union; the population cell says something; and the
 *    `verified` cell carries a method and a date. A verdict with no method is an opinion.
 * 3. **An `UNVERIFIED` row is actionable, not a shrug.** It must name the artefact that would resolve it — and
 *    that artefact is the paper's own **full text** or its own **project page**, never an abstract or an index,
 *    because an abstract search is exactly what left this row unverified for three iterations.
 * 4. **A qualification travels with the number.** A §0a item that names a token whose verdict is not `OURS`
 *    must carry that verdict's own literal, so a reader meets the qualification where the figure is.
 *
 * ## What is NOT fenced, stated rather than implied
 *
 * The references' **affiliations**. The fifth entry's institution was stated in five places under two
 * attributions and is corrected in all five as part of this iteration — but no rule here can check one: an
 * affiliation is a fact only the paper carries, and a rule that compared our prose to our prose would agree
 * with itself. What IS fenced is the population, which the inventory now owns in one place.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { artefactTokens } from './support/artefact-grammar.js';
import { readRepoFile } from './support/repo-file.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/** The closed population-verdict union. */
export const POPULATION_VERDICTS = ['OURS', 'OTHER', 'UNVERIFIED'] as const;

export type PopulationVerdict = (typeof POPULATION_VERDICTS)[number];

/**
 * The literal each non-`OURS` verdict must carry inside the §0a item that names it.
 *
 * A `Record` over the non-`OURS` members rather than a `Map`, so adding a verdict to the union above fails
 * type-checking here until someone decides what its marker is — which is the decision, and not the spelling.
 */
export const VERDICT_MARKER: Record<Exclude<PopulationVerdict, 'OURS'>, string> = {
  OTHER: 'NOT OUR POPULATION',
  UNVERIFIED: 'POPULATION UNVERIFIED',
};

/** One row of the population inventory. */
export interface PopulationRow {
  readonly tokens: readonly string[];
  readonly verdict: string;
  readonly population: string;
  readonly verified: string;
}

/** The `### 0a.` heading and the one that ends its section. */
const SECTION_A = '### 0a.';
const SECTION_B = '### 0b.';

/**
 * Parse the inventory's rows.
 *
 * A row is a `|`-line with at least four cells whose FIRST cell carries an artefact token, so the document's
 * own three-column verdict-explainer table — whose first cell is the verdict itself — is not a row, and a
 * prose paragraph is not one either.
 *
 * @param text - The inventory's markdown source.
 * @returns Every row that carries a token column and a verdict.
 */
export function populationRows(text: string): PopulationRow[] {
  const rows: PopulationRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const tokens = artefactTokens(cells[0]!);
    if (tokens.length === 0) continue;
    const verdict = /^[A-Z][A-Z-]+/.exec(cells[1]!.replace(/\*/g, ''))?.[0];
    if (verdict === undefined) continue;
    rows.push({ tokens, verdict, population: cells[2]!, verified: cells[3]! });
  }
  return rows;
}

/**
 * The §0a section of `sota-comparison.md`, or `''` when its anchors are gone.
 *
 * Returned rather than thrown so the caller's own non-emptiness assertion is what fails: a section extractor
 * that threw would make every rule below unreachable instead of reporting the anchor that moved.
 *
 * @param text - The comparison document's markdown source.
 * @returns The slice between the two headings, or `''`.
 */
export function sectionA(text: string): string {
  const start = text.indexOf(SECTION_A);
  const end = text.indexOf(SECTION_B);
  return start < 0 || end <= start ? '' : text.slice(start, end);
}

/**
 * The numbered items of a section.
 *
 * Split on the ordinal at the start of a line, and filtered to the ones that are items — a continuation line
 * that begins with a digit would otherwise be read as a new item.
 *
 * @param section - A section's markdown source.
 * @returns Each item's full text, continuation lines included.
 */
export function sectionItems(section: string): string[] {
  return section
    .split(/\n(?=\d+\. \*\*)/)
    .filter((block) => /^\d+\. \*\*/.test(block))
    .map((block) => block.trim());
}

/**
 * The §0a items that name a token whose verdict they do not carry.
 *
 * @param items - The section's numbered items.
 * @param verdictOf - Each token's population verdict.
 * @returns One entry per offending item, naming the token and its verdict.
 */
export function markerOffenders(
  items: readonly string[],
  verdictOf: ReadonlyMap<string, string>,
): string[] {
  const offenders: string[] = [];
  for (const item of items) {
    const tokens = artefactTokens(item);
    for (const token of tokens) {
      const verdict = verdictOf.get(token);
      if (verdict === undefined || verdict === 'OURS') continue;
      const marker = VERDICT_MARKER[verdict as Exclude<PopulationVerdict, 'OURS'>];
      if (marker === undefined || item.includes(marker)) continue;
      offenders.push(`${token} [${verdict}]: ${item.slice(0, 120).replace(/\s+/g, ' ')}`);
    }
  }
  return offenders;
}

// Both documents are read through the prerequisite helper: a document a suite reads is part of what the
// commit MEANS, so a missing one must say so rather than raise a bare `ENOENT` (see `support/repo-file.ts`).
const comparison = readRepoFile(repoRoot, 'docs/sota-comparison.md');
const inventory = readRepoFile(repoRoot, 'docs/sota-populations.md');
const rows = populationRows(inventory);
const verdictOf = new Map<string, string>();
for (const row of rows) for (const t of row.tokens) verdictOf.set(t, row.verdict);
const items = sectionItems(sectionA(comparison));

describe('every reference our record names has exactly one population row', () => {
  it('covers the population exactly, in both directions', () => {
    const named = artefactTokens(comparison).sort();
    const registered = [...verdictOf.keys()].sort();
    // A token the comparison names and the inventory does not is a population nobody priced; a row for a
    // token the comparison does not name is a record of a claim the document no longer makes.
    expect(named).toEqual(registered);
    expect(named.length).toBeGreaterThanOrEqual(20);
  });

  it('carries a closed verdict, a population and a dated method on every row', () => {
    for (const row of rows) {
      expect(POPULATION_VERDICTS as readonly string[], `${row.tokens[0]}`).toContain(row.verdict);
      expect(
        row.population.length,
        `${row.tokens[0]} says nothing about its population`,
      ).toBeGreaterThan(12);
      expect(row.verified, `${row.tokens[0]} names no method`).toMatch(
        /full text|project page|paper text|paper's own tables|arXiv|GitHub API|DOI resolution|README|tables|baseline table|§/,
      );
      expect(row.verified, `${row.tokens[0]} carries no date`).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe('a verdict about a population is a reading, never a restatement', () => {
  it('requires an UNVERIFIED row to name the artefact that would resolve it', () => {
    // The invariant that makes the row a work item rather than a shrug — and the one thing three iterations
    // of the defect never had. The resolution artefact is the paper's own full text or its own project page:
    // an abstract search is exactly what left the row unverified, so the row may not point at one.
    const offenders = rows
      .filter((row) => row.verdict === 'UNVERIFIED')
      .filter(
        (row) => !/Resolution artefact:[^*]*\b(full text|project page)\b/.test(row.population),
      )
      .map((row) => row.tokens[0]!);
    expect(offenders).toEqual([]);
    // …and the rule is not vacuous: the inventory holds rows of this kind today.
    expect(rows.filter((row) => row.verdict === 'UNVERIFIED').length).toBeGreaterThanOrEqual(3);
  });

  it('requires an OURS verdict to rest on an external reading, not on our own document', () => {
    // `OURS` is a claim about somebody else's paper, so its `verified` cell must name the thing that was read.
    // A population read off our OWN table is a restatement: three §2b rows were exactly that, and they are
    // `UNVERIFIED` now — which is the distinction this rule exists to hold.
    const ours = rows.filter((row) => row.verdict === 'OURS');
    for (const row of ours) {
      expect(row.verified, `${row.tokens[0]} restates our own document`).not.toContain(
        'sota-comparison.md',
      );
      expect(row.verified, `${row.tokens[0]} names no external reading`).toMatch(
        /full text|project page|paper text|GitHub API|DOI resolution|README/,
      );
    }
    expect(ours.length).toBeGreaterThanOrEqual(8);
  });
});

describe('a qualification travels with the number it qualifies', () => {
  it('reports no §0a item that states a figure without its population verdict', () => {
    expect(markerOffenders(items, verdictOf)).toEqual([]);
  });

  it('applies its rules to a population that is actually read', () => {
    // Every rule above is a filter over a list, so an extractor that stopped reading would satisfy all of them
    // while checking nothing — the vacuous-assertion failure this repository has already paid for once. These
    // are not targets: they are what the tree holds, asserted so a broken read cannot read as a complete record.
    expect(sectionA(comparison).length).toBeGreaterThan(1000);
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.filter((row) => row.verdict === 'OTHER').length).toBeGreaterThanOrEqual(5);
  });

  it('makes the inventory the one owner of the question, from §0a itself', () => {
    // The owner statement, in the section whose numbers it governs. Without it the inventory is a document a
    // reader of §0a never sees — which is how a population fact came to live in five places at once.
    expect(sectionA(comparison)).toContain('sota-populations.md');
  });
});

describe('the census reads the source it claims to read', () => {
  it('excludes the three-column verdict explainer and prose from the row population', () => {
    const parsed = populationRows(
      [
        '| verdict | what it means | what a reader may do |',
        '| --- | --- | --- |',
        '| `OURS` | the reference reports on a population that is one of ours | quote a gap |',
        '| `arXiv:2610.05009` | **OURS** | RCAEval RE1, 375 | 2026-10-14, arXiv HTML full text |',
        '| a prose line with `arXiv:2608.08968` in it |',
      ].join('\n'),
    );
    // A row needs four cells AND a token in the first one, which is what keeps the explainer table — whose
    // first cell is a verdict — from being read as three rows about three verdicts.
    expect(parsed.map((r) => [r.tokens[0], r.verdict])).toEqual([['arXiv:2610.05009', 'OURS']]);
    // And an unknown verdict parses and is then refused by the union, which is the order that keeps a new
    // verdict a decision rather than a typo that reads as a pass.
    expect(POPULATION_VERDICTS as readonly string[]).not.toContain('MAYBE');
  });

  it('slices §0a by its headings, and its items by the ordinal at the start of a line', () => {
    const text = [
      '### 0a. A section',
      '',
      '1. **first** — line one',
      '   continued',
      '2. **second** — line one',
      '',
      '### 0b. The next section',
      '',
      '1. **not an item of 0a**',
    ].join('\n');
    const section = sectionA(text);
    expect(section).toContain('first');
    expect(section).not.toContain('not an item of 0a');
    // A continuation line that starts with a digit must not become an item, which is why the split anchors on
    // the ordinal AND the `**` that opens every real item.
    expect(sectionItems(section).length).toBe(2);
    expect(sectionItems(section)[0]).toContain('continued');
    // An extractor that has lost an anchor returns nothing rather than raising, so its caller's own
    // non-emptiness assertion is what fails and reports the anchor that moved.
    expect(sectionA('no headings here')).toBe('');
  });

  it('reports the exact defect it was written for', () => {
    // The real state, reproduced: entry 5's figure and its token, with the population still unplaced. The
    // literal is what a reader needs at the number, and its absence is the whole defect.
    const defect = [
      '5. **`Rethinking Tool Design for Agentic RCA`** (`arXiv:2610.05009`) — **85.4%** for its `L0`, so it is',
      '   the first reference to exceed our RE1 80.27% by 5.13pp.',
    ].join('\n');
    const unplaced = new Map([['arXiv:2610.05009', 'UNVERIFIED']]);
    expect(markerOffenders([defect], unplaced)).toEqual([
      expect.stringContaining('arXiv:2610.05009 [UNVERIFIED]'),
    ]);
    // And the same item once the reading is done and recorded: `OURS` owes no marker, because the qualification
    // for an `OURS` row is the population itself, which the item now states.
    expect(markerOffenders([defect], new Map([['arXiv:2610.05009', 'OURS']]))).toEqual([]);
    // An item that names a token the inventory does not know is neither excused nor reported by this rule: the
    // coverage assertion above is what owns an unregistered token, and two rules for one defect is one too many.
    expect(markerOffenders([defect], new Map())).toEqual([]);
  });

  it('keeps the union and its markers in step', () => {
    // A union member with no marker would make a non-`OURS` verdict unfenceable, so the two are asserted
    // together rather than left to whoever adds the next verdict.
    expect(Object.keys(VERDICT_MARKER).sort()).toEqual(['OTHER', 'UNVERIFIED']);
    expect(POPULATION_VERDICTS).toContain('OURS');
  });

  it('names every UNVERIFIED row in the paragraph that says which are left, and no others', () => {
    // That paragraph restated a COUNT and named two of the three rows the table marked — the register's law 16
    // (a count restated in a place that cannot derive it) arriving in prose, and iteration 104's own record
    // repeated the wrong number before this assertion existed. The enumeration is now held to the table in BOTH
    // directions, so neither a row added nor a row resolved can leave the sentence behind.
    const unverified = [
      ...new Set(rows.filter((r) => r.verdict === 'UNVERIFIED').flatMap((r) => r.tokens)),
    ].sort();
    expect(unverified.length, 'the table marks no row UNVERIFIED').toBeGreaterThan(0);
    const anchor = '**And the rows that remain `UNVERIFIED`**';
    const at = inventory.indexOf(anchor);
    expect(at, `the paragraph that says which rows are left is gone: ${anchor}`).toBeGreaterThan(0);
    const paragraph = inventory.slice(at, inventory.indexOf('\n\n', at));
    expect(paragraph.length, 'the paragraph is empty').toBeGreaterThan(0);
    expect(artefactTokens(paragraph).sort()).toEqual(unverified);
  });
});
