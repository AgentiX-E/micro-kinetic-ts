/**
 * Competitor artefact availability — a claim that a comparison can be RUN must name an artefact that RESOLVES.
 *
 * ## What this fence replaces
 *
 * `docs/sota-comparison.md` §2b-ii planned work with a sentence — *"…and run their code on ours — the five
 * reproducible references have all been reproducible and none has been run"*. **Every part of that sentence
 * was unchecked**: the count is prose (the register's law 16), the membership is undecidable (which five, by
 * what test), and at least one of them does not resolve. Running the inventory in
 * `docs/competitor-artefact-availability.md` found five defects in our own record, and this file is what makes
 * the sixth impossible to write.
 *
 * ## The distinction it enforces
 *
 * The register's law 10 says a paper's own artefact statement is the authority on whether its artefact is
 * public. The corollary the record had collapsed is that **a statement that code is available is not evidence
 * that a code URL resolves** — and the corpus then showed a third depth: `EvanTian233/GALA-for-RCA` resolves,
 * is MIT, and its README *withholds the implementation* under a partner agreement while shipping other
 * people's baselines. So the fact the record needs is not "does a URL resolve" but **what the artefact
 * carries**, which is why the inventory's verdict distinguishes `RESOLVES-WITH-METHOD` from
 * `RESOLVES-WITHOUT-METHOD` and records the licence beside both.
 *
 * ## The four invariants
 *
 * 1. **Population, derived.** Every artefact token in `sota-comparison.md` has exactly one row in the
 *    inventory, and the inventory has no row for a token the document does not name — in both directions, so
 *    neither side can drift alone.
 * 2. **Row shape.** Every verdict is a member of the closed union, and every row carries what it was verified
 *    with and when. A verdict with no method is an opinion.
 * 3. **A non-runnable artefact may not be claimed available.** No SENTENCE naming a token whose verdict is not
 *    one of the two runnable ones may match the availability vocabulary. **This is the invariant that catches
 *    the defect**: the DecompRCA sentence carried its URL and the claim in the same sentence.
 * 4. **An availability claim must name the artefact.** Every sentence matching the vocabulary must contain a
 *    token — the direction that catches a claim whose artefact is one paragraph away, or nowhere.
 *
 * Sentence granularity rather than paragraph is measured, not chosen: at paragraph granularity the §0a
 * numbered list is ONE paragraph carrying five tokens and several claims, two of them negative, so the rule
 * reports the wrong rows; at sentence granularity it reports exactly the two real ones.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const COMPARISON = resolve(repoRoot, 'docs/sota-comparison.md');
const INVENTORY = resolve(repoRoot, 'docs/competitor-artefact-availability.md');

/**
 * The three unambiguous artefact grammars, plus the backticked `OWNER/REPO` shorthand.
 *
 * The shorthand needs the exclusion below or it reports our own repository's paths: `sota-comparison.md`
 * backticks `docs/benchmark-corpus-completeness.md` and `scripts/audit_input_schema.py`, and a rule that read
 * those as artifacts would report six rows that are ours.
 */
const ARTEFACT_TOKEN =
  /arXiv:\d{4}\.\d{4,5}|github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|10\.\d{4,}\/zenodo\.\d+|`([a-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+)`/g;

/** This repository's own top-level directories: a backticked path into one of these is not an artefact. */
const OWN_PATH_PREFIXES = [
  'docs/',
  'scripts/',
  'packages/',
  'benchmarks/',
  'integration-tests/',
  '.github/',
];

/**
 * Every artefact token in `text`, in first-appearance order.
 *
 * @param text - Markdown source.
 * @returns The distinct tokens, bare (no backticks).
 */
export function artefactTokens(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(ARTEFACT_TOKEN)) {
    const token = m[1] ?? m[0];
    if (m[1] !== undefined && OWN_PATH_PREFIXES.some((p) => token.startsWith(p))) continue;
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

/** The closed verdict union, and whether a member means a comparison can actually be run. */
export const VERDICTS = [
  'RESOLVES-WITH-METHOD',
  'RESOLVES-WITHOUT-METHOD',
  'NOT-RESOLVABLE',
  'NO-ARTEFACT',
  'NO-CLAIM',
] as const;

export type Verdict = (typeof VERDICTS)[number];

/** Whether a verdict licenses the claim that a comparison can be run from the artefact. */
export function isRunnable(verdict: Verdict): boolean {
  return verdict === 'RESOLVES-WITH-METHOD';
}

/**
 * The availability vocabulary: the phrases that assert an artefact can be obtained or a comparison run.
 *
 * Deliberately positive-only. `not reproducible`, `no code link found` and `no per-case results` are claims
 * the record makes ABOUT a non-artefact, and a rule matching them would demand a resolvable token for a
 * sentence whose whole point is that there is none — which is how the four-row population defect in
 * `fse26-reported-config.test.ts` happened (a fence whose population is a phrase only sees rows that use the
 * phrase, so the phrase has to be the CLAIM and not the topic).
 */
const AVAILABILITY_CLAIM =
  /is public\b|are public\b|available to run|can be run|left runnable|can become a measurement|can be turned into a measurement|run their code on ours/i;

/**
 * The sentences of a markdown document, with hard wrapping flattened first.
 *
 * Flattening is required, not cosmetic: the document is wrapped at ~100 columns, so the claim and the token
 * it is about land on different LINES — which is exactly why the defect survived a line-oriented reading.
 *
 * @param text - Markdown source.
 * @returns The sentences, whitespace-normalised.
 */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;])\s+(?=[A-Z*`"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** One row of the inventory: the tokens it covers, and the verdict. */
export interface InventoryRow {
  readonly tokens: readonly string[];
  readonly verdict: string;
  /** The `verified` cell, which must name a method and a date. */
  readonly verified: string;
}

/**
 * Parse the inventory table's rows.
 *
 * The verdict is the leading `[A-Z-]+` run of the second cell, so a row may qualify its verdict (`RESOLVES-WITH-METHOD,
 * NO LICENCE`) without the parser needing to know the qualifier. That is deliberate: the union stays closed
 * while the row stays readable.
 *
 * @param text - The inventory's markdown source.
 * @returns Every row that carries both a token column and a verdict.
 */
export function inventoryRows(text: string): InventoryRow[] {
  const rows: InventoryRow[] = [];
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
    rows.push({ tokens, verdict, verified: cells[3]! });
  }
  return rows;
}

const comparison = readFileSync(COMPARISON, 'utf8');
const inventory = readFileSync(INVENTORY, 'utf8');
const rows = inventoryRows(inventory);
const verdictOf = new Map<string, string>();
for (const row of rows) for (const t of row.tokens) verdictOf.set(t, row.verdict);

describe('every competitor artefact our record names is inventoried', () => {
  it('covers the population exactly, in both directions', () => {
    const named = artefactTokens(comparison).sort();
    const registered = [...verdictOf.keys()].sort();
    // A token named in the comparison and absent here is a claim nobody checked; a row for a token the
    // comparison does not name is a record of a claim the document no longer makes.
    expect(named).toEqual(registered);
    // A census over an empty or tiny population passes for the wrong reason.
    expect(named.length).toBeGreaterThanOrEqual(20);
  });

  it('carries a verdict from the closed union, a method and a date on every row', () => {
    for (const row of rows) {
      expect(VERDICTS as readonly string[], `${row.tokens[0]}`).toContain(row.verdict);
      // The method is what makes a verdict checkable rather than remembered: a row that says
      // `NOT-RESOLVABLE` and not what it probed is an opinion with a date on it.
      expect(row.verified.length, `${row.tokens[0]} has no verification`).toBeGreaterThan(10);
      expect(row.verified, `${row.tokens[0]} names no method`).toMatch(
        /GitHub API|DOI resolution|arXiv|paper text|README|record makes no availability claim/,
      );
      expect(row.verified, `${row.tokens[0]} carries no date`).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe('a claim that a comparison can be run names an artefact that can be', () => {
  it('reports no availability claim beside a non-runnable artefact', () => {
    // The defect: `Its code is public (github.com/cruiseresearchgroup/DecompRCA), so the comparison is
    // available to run.` — one sentence, one token, one claim, and the URL is a 404.
    const offenders: string[] = [];
    for (const sentence of sentences(comparison)) {
      if (!AVAILABILITY_CLAIM.test(sentence)) continue;
      for (const token of artefactTokens(sentence)) {
        const verdict = verdictOf.get(token) as Verdict | undefined;
        if (verdict === undefined || isRunnable(verdict)) continue;
        offenders.push(`${token} [${verdict}]: ${sentence.slice(0, 160)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reports no availability claim that names no artefact at all', () => {
    // The other direction, and the one that had never been stated: `…and run their code on ours` plans work
    // against an artefact the document does not name, so a reader cannot act on it and no row can be wrong.
    const offenders = sentences(comparison)
      .filter((s) => AVAILABILITY_CLAIM.test(s) && artefactTokens(s).length === 0)
      .map((s) => s.slice(0, 160));
    expect(offenders).toEqual([]);
  });
});

describe('the census reads the source it claims to read', () => {
  it('finds the artefacts, and excludes our own repository paths', () => {
    const tokens = artefactTokens(comparison);
    expect(tokens).toContain('arXiv:2609.36686');
    expect(tokens).toContain('github.com/cruiseresearchgroup/DecompRCA');
    expect(tokens).toContain('edgedelta/project-arena');
    // The shorthand grammar sees a backticked path into this repository, and the exclusion is what keeps it
    // out — without it the population would carry six rows about our own files.
    expect(tokens).not.toContain('docs/benchmark-corpus-completeness.md');
    expect(artefactTokens('see `edgedelta/project-arena` and `docs/x.md`')).toEqual([
      'edgedelta/project-arena',
    ]);
  });

  it('reports the exact defect it was written for', () => {
    const text =
      '**Its code is public** (`github.com/cruiseresearchgroup/DecompRCA`), so the comparison is available to run.';
    const [sentence] = sentences(text);
    expect(AVAILABILITY_CLAIM.test(sentence!)).toBe(true);
    expect(artefactTokens(sentence!)).toEqual(['github.com/cruiseresearchgroup/DecompRCA']);
  });

  it('separates a runnable artefact from a resolving one', () => {
    // The distinction the three depths of the defect turn on, asserted directly rather than through a map.
    expect(isRunnable('RESOLVES-WITH-METHOD')).toBe(true);
    expect(isRunnable('RESOLVES-WITHOUT-METHOD')).toBe(false);
    expect(isRunnable('NOT-RESOLVABLE')).toBe(false);
    expect(isRunnable('NO-ARTEFACT')).toBe(false);
    expect(isRunnable('NO-CLAIM')).toBe(false);
  });

  it('reads a qualified verdict by its leading token, and only from a real row', () => {
    const parsed = inventoryRows(
      [
        '| token | verdict | what | verified |',
        '| --- | --- | --- | --- |',
        '| `github.com/a/b` | **RESOLVES-WITH-METHOD, NO LICENCE** | x | 2026-10-13, GitHub API |',
        '| prose with no rows |',
        '| `github.com/c/d` | **NOT-A-VERDICT** | x | 2026-10-13 |',
      ].join('\n'),
    );
    expect(parsed.map((r) => [r.tokens[0], r.verdict])).toEqual([
      ['github.com/a/b', 'RESOLVES-WITH-METHOD'],
      ['github.com/c/d', 'NOT-A-VERDICT'],
    ]);
    // `NOT-A-VERDICT` parses and is then REFUSED by the union, which is the order that keeps a new verdict a
    // decision rather than a typo that reads as a pass.
    expect(VERDICTS as readonly string[]).not.toContain('NOT-A-VERDICT');
  });

  it('flattens the wrapper before splitting, or the claim and its token land on different lines', () => {
    // The document is wrapped at ~100 columns. A line-oriented rule reads `**Its code is` / `public (\`…\`)`
    // as two unrelated fragments, which is precisely how this defect survived every earlier reading.
    const wrapped =
      '**Its code is\n   public** (`github.com/cruiseresearchgroup/DecompRCA`), so it is available to run.';
    const [sentence] = sentences(wrapped);
    expect(sentence).toContain('github.com/cruiseresearchgroup/DecompRCA');
    expect(AVAILABILITY_CLAIM.test(sentence!)).toBe(true);
  });
});
