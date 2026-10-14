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

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { artefactTokens, sentences } from './support/artefact-grammar.js';
import { readRepoFile } from './support/repo-file.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/**
 * The grammar, the population it derives from, and the sentence splitter live in
 * `./support/artefact-grammar.ts`, because TWO fences now read the same population — this one asks whether an
 * artefact RESOLVES, and `sota-population-claims.test.ts` asks which POPULATION a reference reports on. A
 * copy per fence would hold them to each other and to nothing else (register law 7), so the population is
 * derived once. This cross-reference is the whole statement of that relationship.
 */

/**
 * A sentence that CITES the rule rather than making a claim about an artefact — it names the law it quotes.
 *
 * The vocabulary's own phrase appears inside the RULE (`… the authority on whether its artefact is public`), so
 * a document that quotes law 10 is indistinguishable from one that claims an artefact is public unless the
 * citation is recognised — the register's law 21 arriving in this fence: a containment test over a PHRASE is
 * unsound when the phrase necessarily appears in the definition of the thing being tested. Applied only to the
 * direction that requires the sentence to NAME an artefact, so a sentence citing the law while naming a
 * non-runnable token is still reported: the exemption is for a restatement, not for an excuse.
 */
const CITES_THE_RULE = /\blaw \d+\b/i;

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

// Read through the prerequisite helper: the document this fence is about is part of what this commit
// MEANS, and a missing one must say so rather than raise a bare `ENOENT` (see `support/repo-file.ts`).
const comparison = readRepoFile(repoRoot, 'docs/sota-comparison.md');
const inventory = readRepoFile(repoRoot, 'docs/competitor-artefact-availability.md');
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
    // A sentence that quotes the rule itself is excluded, because its subject is the definition rather than an
    // artefact — and that exclusion is asserted below rather than trusted.
    const offenders = sentences(comparison)
      .filter((s) => AVAILABILITY_CLAIM.test(s) && !CITES_THE_RULE.test(s))
      .filter((s) => artefactTokens(s).length === 0)
      .map((s) => s.slice(0, 160));
    expect(offenders).toEqual([]);
  });

  it('excuses a restatement of the rule, and still reports a claim that cites it', () => {
    // Both directions of the exclusion, so it cannot become a hole: a sentence quoting law 10 and naming no
    // artefact is the definition restated, and the same sentence with a non-runnable artefact in it is the
    // defect the fence exists for.
    const quoted =
      "The register's law 10 says a paper's own artefact statement is the authority on whether its artefact is public.";
    expect(CITES_THE_RULE.test(quoted)).toBe(true);
    expect(AVAILABILITY_CLAIM.test(quoted)).toBe(true);
    expect(artefactTokens(quoted)).toEqual([]);
    const claiming =
      'Per law 10 its code is public (`github.com/cruiseresearchgroup/DecompRCA`), so it is available to run.';
    expect(CITES_THE_RULE.test(claiming)).toBe(true);
    expect(artefactTokens(claiming)).toEqual(['github.com/cruiseresearchgroup/DecompRCA']);
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

  it('sees the one hosting shape a method-less artefact uses', () => {
    // A project page is where a paper that ships NOTHING puts its figures, and it matched none of the four
    // grammars — so the inventory could not judge it. `arXiv:2610.05009` is the case that made it matter: its
    // own header prints a `github.io` page, the page resolves and carries no code, weights, dataset or
    // per-case results, and the population could say none of that because it could not see the token.
    expect(
      artefactTokens('see luoyu100.github.io/projects/toolrca/project for the figures'),
    ).toEqual(['luoyu100.github.io/projects/toolrca/project']);
    // Backticked too, and the shorthand must not swallow it: `` `a/b` `` closes on the backtick, and this
    // token has a third segment after the second slash, so the shorthand cannot match it at all.
    expect(artefactTokens('`luoyu100.github.io/projects/toolrca/project`')).toEqual([
      'luoyu100.github.io/projects/toolrca/project',
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
