/**
 * Engineering laws — a rule this repository cites BY NUMBER must be DEFINED here, and the numbering is load-bearing.
 *
 * ## The defect this fence replaces
 *
 * `packages/tree/src/pruning/pruner.ts` carries a docblock that says, in as many words, that
 * *"`docs/closed-axes-register.md` names as law 16"*. **The register did not name it, and neither did any other
 * document in either repository.** Measured on 2026-10-14, before the register's law section existed:
 *
 * - **7 distinct law numbers were cited** — `7`, `10`, `16`, `18`, `21`, `30`, `37`;
 * - in **10 files**, production source and five fences among them;
 * - and **15 of the 37 laws had no occurrence of their own text anywhere in either repository**.
 *
 * **The defect materialised rather than merely threatening to.** The list lived in a session working index, and
 * iteration 101's own compression of that index silently dropped eight of the thirty-seven — which is what a
 * record whose only copy is a session file does, eventually. The register is the owner now.
 *
 * ## What is asserted
 *
 * 1. **Every cited law number is defined.** The population is DERIVED from the files, not listed: every `law N`
 *    in the root and `docs/` Markdown, and in the `.ts` under `packages`, `benchmarks`, `scripts` and
 *    `integration-tests`.
 * 2. **The numbering is dense, unique and in order.** The numbers are cited in prose that outlives the list —
 *    this register's own row records that law 30 was *"written in iteration 99 and fulfilled by iteration 100's
 *    own repair"* — so **a gap or a reordering silently retro-targets every later citation**.
 * 3. **Every law carries a provenance** from the closed vocabulary `it.NN` or the literal `UNRECORDED`, so a law
 *    is a measurement rather than an assertion. That is this register's own rule for an axis, one artefact over.
 * 4. **An `UNRECORDED` law is NAMED where work is planned**, because an absence with no name is the thing law 3
 *    is about — a missing map, an empty tier and a missing entry are three different claims.
 * 5. **No two laws share a text.** Two numbers saying one thing is a renumbering waiting to happen, and the
 *    numbering is what citations travel by.
 *
 * ## The anti-vacuity rule, which is not decoration
 *
 * A law's own row is **not** a citation of itself, so the DEFINITION lines are removed from the citation
 * population before it is counted. Without that, the definitions would satisfy their own coverage assertion and
 * the whole fence would pass while citing nothing — the failure this repository has paid for more than once.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readRepoFile } from './support/repo-file.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/** The heading that opens the definitions, and the one that ends them. */
const LAWS_HEADING = '## The laws';

/** The provenance vocabulary: an iteration, or the literal that says no document records one. */
export const UNRECORDED = 'UNRECORDED';

/** A citation of a law by number, in any of the forms the repository uses. */
export const LAW_CITATION = /\blaw[s]?\s+(\d+)\b/g;

/** A line whose FIRST table cell is a number: a definition row, which is not a citation of itself. */
const LAW_ROW_LINE = /^\|\s*\d+\s*\|/;

/** One row of the register's law table. */
export interface LawRow {
  readonly n: number;
  readonly text: string;
  readonly provenance: string;
}

/**
 * The register's law section, or `''` when the heading is gone.
 *
 * @param register - The register's markdown source.
 * @returns The section, from its heading to the next heading of the same level.
 */
export function lawsSection(register: string): string {
  const start = register.indexOf(LAWS_HEADING);
  if (start < 0) return '';
  const next = register.indexOf('\n## ', start + 1);
  return next < 0 ? register.slice(start) : register.slice(start, next);
}

/**
 * The register's law table, parsed.
 *
 * A row needs THREE cells and a numeric first one, which is what keeps this document's other tables — the
 * measurement table above has two cells, the axes tables four — out of the population.
 *
 * The `provenance` cell has its BACKTICKS stripped, for the reason `competitor-artefact-availability.test.ts`
 * strips `*` from its verdict cell: **the row carries a value and the markup is not part of it**, and a rule
 * that compared `` `UNRECORDED` `` against `UNRECORDED` would report every law as unprovenanced while the table
 * said otherwise. That failure was measured, not imagined — this parser had it for one run.
 *
 * @param register - The register's markdown source.
 * @returns Every definition row, in file order.
 */
export function lawRows(register: string): LawRow[] {
  const rows: LawRow[] = [];
  for (const line of lawsSection(register).split('\n')) {
    if (!LAW_ROW_LINE.test(line)) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 3) continue;
    const n = Number(cells[0]);
    if (!Number.isInteger(n) || n <= 0) continue;
    rows.push({ n, text: cells[1]!, provenance: cells[2]!.replace(/`/g, '') });
  }
  return rows;
}

/**
 * The register with its definition lines removed — the text a citation may be counted in.
 *
 * @param register - The register's markdown source.
 * @returns The register minus every law-definition line.
 */
export function citationBearingText(register: string): string {
  return register
    .split('\n')
    .filter((line) => !LAW_ROW_LINE.test(line))
    .join('\n');
}

/**
 * Every law number `text` cites.
 *
 * @param text - A file's source.
 * @returns The numbers, in order, duplicates kept so a caller can count citations rather than numbers.
 */
export function lawCitations(text: string): number[] {
  const found: number[] = [];
  for (const m of text.matchAll(LAW_CITATION)) found.push(Number(m[1]));
  return found;
}

/** Repository paths to scan, relative to the root. */
function scannedFiles(): string[] {
  const SKIP = new Set(['node_modules', 'dist', 'coverage', '.nx', 'tmp', '.turbo']);
  const out: string[] = [];
  const walk = (dir: string, name: string, extensions: readonly string[]): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(resolve(dir, e.name), `${name}/${e.name}`, extensions);
      } else if (extensions.some((x) => e.name.endsWith(x))) {
        out.push(`${name}/${e.name}`);
      }
    }
  };
  for (const e of readdirSync(repoRoot, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.md')) out.push(e.name);
  }
  walk(resolve(repoRoot, 'docs'), 'docs', ['.md']);
  for (const pkg of ['packages', 'benchmarks', 'scripts', 'integration-tests']) {
    walk(resolve(repoRoot, pkg), pkg, ['.ts']);
  }
  return out.sort();
}

const register = readRepoFile(repoRoot, 'docs/closed-axes-register.md');
const rows = lawRows(register);
const defined = new Set(rows.map((r) => r.n));
const cited = new Map<number, string[]>();
for (const path of scannedFiles()) {
  const text =
    path === 'docs/closed-axes-register.md'
      ? citationBearingText(register)
      : readFileSync(resolve(repoRoot, path), 'utf8');
  for (const n of lawCitations(text)) {
    const where = cited.get(n) ?? [];
    if (!where.includes(path)) where.push(path);
    cited.set(n, where);
  }
}
const citedNumbers = [...cited.keys()].sort((a, b) => a - b);

/** A section's text, from its heading to the next one of the same level — `''` when the heading is gone. */
function sectionText(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + 1);
  return next < 0 ? text.slice(start) : text.slice(start, next);
}

const workPlan = sectionText(register, '## What is left');

describe('every law this repository cites by number is defined here', () => {
  it('resolves every citation', () => {
    // The defect, in one assertion: `pruner.ts` says the register names law 16 and the register did not.
    const dead = citedNumbers
      .filter((n) => !defined.has(n))
      .map((n) => `${n} cited by ${(cited.get(n) ?? []).join(', ')}`);
    expect(dead).toEqual([]);
    // …and the population is not empty: a census over no citations passes for the wrong reason.
    expect(citedNumbers.length).toBeGreaterThanOrEqual(5);
  });

  it('numbers them densely, uniquely and in order', () => {
    // A gap is a retargeted citation: every reference to a later law still RESOLVES, to a different rule.
    expect(rows.map((r) => r.n)).toEqual(rows.map((_, i) => i + 1));
    expect(rows.length).toBeGreaterThanOrEqual(37);
  });

  it('gives every law a provenance from the closed vocabulary', () => {
    // `\d{2,3}` because the ledger's own iterations are three digits from `it.100` on, and a `\d{2}` rule
    // reported the newest laws as malformed — measured, on this very table.
    for (const row of rows) {
      expect(row.provenance, `law ${row.n}`).toMatch(
        new RegExp(`^(it\\.\\d{2,3}|${UNRECORDED})(, confirmed it\\.\\d{2,3})?$`),
      );
    }
    // A table where every origin is `UNRECORDED` would satisfy the rule while recording nothing.
    expect(rows.filter((r) => /^it\.\d{2,3}/.test(r.provenance)).length).toBeGreaterThanOrEqual(15);
  });

  it('names every unrecorded law where work is planned', () => {
    // An absence has THREE levels, and a law whose measurement is not recorded is the middle one: the row exists
    // and its origin does not. Naming it is what stops it being invisible — and the check is per-law, so a law
    // added with an unknown origin cannot pass by having a sibling named.
    const unnamed = rows
      .filter((r) => r.provenance === UNRECORDED)
      .filter((r) => !new RegExp(`\\b${r.n}\\b`).test(workPlan))
      .map((r) => r.n);
    expect(unnamed).toEqual([]);
    expect(rows.filter((r) => r.provenance === UNRECORDED).length).toBeGreaterThanOrEqual(5);
  });

  it('never gives two numbers the same law', () => {
    const texts = rows.map((r) => r.text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const row of rows) expect(row.text.length, `law ${row.n} is empty`).toBeGreaterThan(20);
  });
});

describe('the census reads the source it claims to read', () => {
  it('finds the citations, in the files that make them', () => {
    // Named rather than counted: an extractor that stopped reading would leave `citedNumbers` empty and every
    // rule above would pass. These are the numbers and files measured before the law section existed.
    expect(citedNumbers).toEqual(expect.arrayContaining([7, 10, 16, 18, 21, 30, 37]));
    expect(cited.get(16) ?? []).toContain('packages/tree/src/pruning/pruner.ts');
    expect(cited.get(10) ?? []).toContain('docs/sota-populations.md');
    expect(scannedFiles().length).toBeGreaterThan(300);
  });

  it('does not count a DEFINITION as a citation of itself', () => {
    // The anti-vacuity rule. A row's own number is a definition, and a census that read it as a citation would be
    // satisfied by the table alone — the fence would then pass while resolving nothing.
    const registerText =
      '## The laws\n\n| # | the law | measured by |\n| --- | --- | --- |\n| 1 | **A rule.** | `it.01` |\n';
    expect(lawCitations(citationBearingText(registerText))).toEqual([]);
    expect(lawCitations(registerText)).toEqual([]);
    // …while a citation in the section's PROSE is still counted, so the exclusion is of rows and not of the
    // section: the prose is where a cross-reference to another law lives.
    const withProse = `${registerText}\nSee law 4 for the partition rule.\n`;
    expect(lawCitations(citationBearingText(withProse))).toEqual([4]);
  });

  it('reports the exact defect it was written for', () => {
    // The real state, reproduced: a citation of a law the register does not define.
    //
    // **The undefined number is a COMPUTED value, and this fence needed THREE rounds to get here.** This census
    // reads source text, so (1) the first version wrote the number as a LITERAL and the census found the fixture
    // and reported the fence as its own unresolvable citation; (2) the fix used a template literal and the
    // COMMENT that documented round one still carried the literal form, so the census found the comment; and
    // (3) the parser compared a markdown-quoted provenance against a bare one, so every law read as
    // unprovenanced while the table said otherwise. Rounds one and two are **law 29 inside the fence that
    // quotes it** — a fence that reads source text sees the text that documents it — and the third is the same
    // reason `competitor-artefact-availability.test.ts` strips `*` from its verdict cell.
    const undefinedLaw = 99;
    const text = ` * counts a growing list is a copy the list does not own (the register law ${undefinedLaw}), so the inventory lives in`;
    expect(lawCitations(text)).toEqual([undefinedLaw]);
    const definedHere = new Set([16]);
    const dead = lawCitations(text).filter((n) => !definedHere.has(n));
    expect(dead).toEqual([undefinedLaw]);
    // And the same sentence once the number is a defined one: nothing to report.
    expect(
      lawCitations(text.replace(`law ${undefinedLaw}`, 'law 16')).filter(
        (n) => !definedHere.has(n),
      ),
    ).toEqual([]);
  });

  it('reads the section between its heading and the next one', () => {
    const text = [
      '## The laws',
      '',
      '| # | the law | measured by |',
      '| --- | --- | --- |',
      '| 1 | **A.** | `it.01` |',
      '| 2 | only two cells |',
      '',
      '## What is left',
      '',
      '| 3 | **B.** | `it.03` | a FOURTH cell makes it an axes row, not a law',
    ].join('\n');
    // The provenance is the VALUE: the backticks are markup and are stripped, which is why the row reads
    // `it.01` and not `` `it.01` ``.
    expect(lawRows(text).map((r) => [r.n, r.text, r.provenance])).toEqual([[1, '**A.**', 'it.01']]);
    // A missing heading returns nothing rather than raising, so the caller's own floor is what fails.
    expect(lawsSection('no heading here')).toBe('');
    expect(lawRows('no heading here')).toEqual([]);
  });
});
