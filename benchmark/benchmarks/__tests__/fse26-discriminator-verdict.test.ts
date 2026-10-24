/**
 * The discriminator verdict's own arithmetic, held to a test.
 *
 * ## The defect this fence replaces
 *
 * `docs/fse26-discriminator-verdict.md` §4 reported the shipped configuration's `lat only` row as
 * `+13` net with a held-out split of `25 / 11`. **The held-out net IS `fixed − broken`**, so
 * `25 / 11` is a net of `+14` — the row contradicted itself by one, in the one document that states
 * the BAR a future discriminator must clear.
 *
 * The number was not invented: `25 / 11` is the **pre-pool** measurement, and the row's other
 * columns (`119 / 462` fixed/broken-if-applied-to-everything) are the **shipped** one. One cell had
 * been carried over from the neighbouring measurement, and nobody added the row up.
 *
 * ## What this asserts, and what it deliberately does not
 *
 * **The invariant, not the values.** Every row of the §4 table must satisfy
 * `net == held-out fixed − held-out broken`, for whatever numbers the table holds. Re-taking a
 * measurement onto `25 / 12`, or a future one onto `30 / 4`, passes; a row that mixes two
 * measurements fails. Pinning today's literals would turn progress into a red — the same mistake as
 * the population fence's floor, which had to be lowered twice because it recorded a count instead of
 * a rule.
 *
 * @module benchmarks/__tests__/fse26-discriminator-verdict
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Read a repository file, so a moved document reports the path it looked for. */
const read = (rel: string): string => readFileSync(resolve(HERE, '..', '..', rel), 'utf8');

/** One row of the §4 table: the config, what it does applied everywhere, and what it does held out. */
interface SplitRow {
  readonly name: string;
  readonly net: number;
  readonly heldOutFixed: number;
  readonly heldOutBroken: number;
}

/**
 * The `| config | fixed / broken | net | held-out split | rule |` rows.
 *
 * Parsed by CELL rather than by one regular expression over the line, because the table's emphasis is not uniform:
 * `lat only`'s two numbers are bold and `log only`'s are not, and `metric only`'s split is an em dash. A regex
 * requiring `**` around either cell finds no rows at all on this table — which is how a "table" fence passes on an
 * empty table, and it is why the first version of this parser did exactly that.
 *
 * A row whose split cell is not two numbers is SKIPPED rather than failed: `metric only` reports no held-out
 * measurement on most folds, and a row that measures nothing asserts nothing.
 */
function splitRows(doc: string): SplitRow[] {
  const rows: SplitRow[] = [];
  for (const line of doc.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 5) continue;
    const name = /^`([^`]+)`$/.exec(cells[0]!)?.[1];
    if (name === undefined) continue;
    const net = Number(cells[2]!.replace(/\*/g, '').replace('\u2212', '-'));
    if (!Number.isFinite(net)) continue;
    const split = /^(\d+)\s*\/\s*(\d+)$/.exec(cells[3]!.replace(/\*/g, ''));
    if (split === null) continue;
    rows.push({
      name,
      net,
      heldOutFixed: Number(split[1]!),
      heldOutBroken: Number(split[2]!),
    });
  }
  return rows;
}

describe('the discriminator verdict states a split its own net supports', () => {
  const doc = read('docs/fse26-discriminator-verdict.md');

  it('parses the §4 table rather than trusting that it is there', () => {
    // **Two** of the three configurations report a held-out split: `metric only` prints an em dash on most folds and
    // the parser skips it by design. Asserting three names here would test the parser's tolerance rather than the
    // table, so the population of PARSED rows is stated as what it is — and the table's own three config rows are
    // asserted separately, so a deleted row cannot pass either.
    expect(splitRows(doc).map((r) => r.name)).toEqual(['lat only', 'log only']);
    const configs = [...doc.matchAll(/^\| `(lat only|log only|metric only)` \|/gm)].map(
      (m) => m[1],
    );
    expect(configs).toEqual(['lat only', 'log only', 'metric only']);
  });

  it('holds net == held-out fixed − held-out broken on every row', () => {
    for (const row of splitRows(doc)) {
      expect(
        row.net,
        `${row.name}: a net of ${row.net} cannot come from ${row.heldOutFixed} fixed and ` +
          `${row.heldOutBroken} broken — one of the two cells is from another measurement`,
      ).toBe(row.heldOutFixed - row.heldOutBroken);
    }
  });

  it('and the arithmetic is what would have caught the shipped row', () => {
    // The regression, stated as the arithmetic rather than as the number: the row this document
    // carried as `25 / 11` beside `+13`. If the invariant above is ever weakened to a literal, this
    // assertion is what remembers WHY it was an invariant.
    expect(25 - 11, 'the value the table carried').toBe(14);
    expect(14).not.toBe(13);
  });
});
