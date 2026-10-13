/**
 * The shipped default's OWNER — a value declared in more than one file must be declared by NAME.
 *
 * ## The class, and why this file is a census rather than a fourth instance
 *
 * `DEFAULT_LOG_WEIGHT` was extracted when the log weight was found to be a bare `1.0` in four files;
 * `DEFAULT_LOG_SIGNAL_MODE` was extracted one option over, for the same reason; `DEFAULT_TRACE_WEIGHT` was
 * extracted third, and its own docblock says so — "the THIRD instance of the class". Three iterations, three
 * hand-fixes, each of the instance somebody happened to notice. The count lived in prose, which is the shape
 * `docs/closed-axes-register.md` names as law 16: *a comment that COUNTS a growing list is a copy the list
 * does not own*. `docs/ranking-default-owners.md` is what replaced the count, and it found the class still
 * had members:
 *
 * - `topoWeight`, `collisionWeight`, `prismWeight`, `collapseDiscount`, `suppressIdleTransients` and
 *   `suppressNearZeroBaselineRise`: a bare literal in the engine's own defaults table AND in both parsers'
 *   option objects — eighteen declaration sites, zero names;
 * - `failedEdgeMode`, whose `'sum'` had FOUR sites and whose one name was exported by the package that does
 *   not own the value (`benchmarks/src/fse26-cli.ts`), while the type and the function that defaults it live
 *   in `packages/tree`;
 * - `failedEdgeMinRecords`: four sites, no name;
 * - `traceWeight` again — the class's own third instance, closed for the fallback and for the workflow
 *   description while **each parser's field default still wrote `0`**;
 * - `diagnoseLimit`, quoted as a NUMBER by the FSE'26 workflow and by the runner, with no owner.
 *
 * ## The two checks, and why both
 *
 * **Equality is checked BEHAVIOURALLY**, from the parsers themselves and the engine's own exported tables.
 * `parseRCAEvalArgs([])` and `parseFSE26Args([])` are the no-flag path, so every key they share with an
 * engine defaults table must equal that table's value — which is the property a reader of a published
 * configuration actually depends on, and it needs no source text at all. The population is DERIVED (the
 * intersection of the tables' own keys with the options the parsers return), so a new option cannot arrive
 * outside it and a hand-written list cannot shrink it.
 *
 * **Naming is checked TEXTUALLY**, because behaviour cannot see the difference between a value that is
 * *correct* and a value that is *repeated*: two literals that agree today are two answers tomorrow, and that
 * is the whole class. So each declaration of a shared key in a parser's option object must be an IDENTIFIER
 * that resolves to an export of the engine package equal to the shipped value. This is the half the earlier
 * guards missed — they read the `parseWeight` fallback and the workflow description, and the field default is
 * neither.
 *
 * ## Acceptance
 *
 * No number moves: every literal these names replace already held the same value, so the golden nine cells
 * and the whole `signals:` line are byte-identical by construction. What changes is that the class can no
 * longer grow one instance at a time.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFSE26Args } from '../../../../benchmarks/src/fse26-cli.js';
import { parseRCAEvalArgs } from '../../../../benchmarks/src/rcaeval-cli.js';
import * as TREE from '../../../../packages/tree/src/index.js';
import {
  DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG,
  DEFAULT_TREE_PRUNER_OPTIONS,
} from '../../../../packages/tree/src/index.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');

/** A `key: value` entry of an object literal, with the source text of its value. */
export interface Declaration {
  /** The property name, as written. */
  readonly key: string;
  /** The source text of the value, comments stripped and whitespace collapsed. */
  readonly value: string;
}

/** A declaration of an engine-owned default that is not the owner's name. */
export interface OwnerViolation {
  /** The property name. */
  readonly key: string;
  /** What the site wrote. */
  readonly value: string;
  /** Why it is a violation, in the words a reader of the failure needs. */
  readonly why: string;
}

/**
 * Remove `//` and block comments from TypeScript source.
 *
 * The extractors below brace-match and split on commas, and both are sensitive to a brace or a comma inside
 * a comment — of which the option objects here have many. Strings are left alone: the values in these
 * objects are identifiers, numbers and `join(homedir(), 'name')`, none of which contains a brace.
 *
 * @param source - TypeScript source text.
 * @returns The same text with comment bodies replaced by spaces, so line and column are preserved.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/**
 * The object literal that opens at `opener`, brace-matched to its close.
 *
 * @param source - TypeScript source text, comments already stripped.
 * @param opener - A regex whose match ENDS at the literal's opening brace.
 * @returns The literal's source text including both braces, or `undefined` when there is no match.
 */
export function objectLiteralAt(source: string, opener: RegExp): string | undefined {
  const m = opener.exec(source);
  if (!m) return undefined;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(m.index + m[0].length - 1, i + 1);
    }
  }
  return undefined;
}

/**
 * Every top-level `key: value` of an object literal.
 *
 * Top-level only: `propagationVelocity` is an object and is reported as ONE declaration whose value is the
 * nested literal, because that is what a reader of the site sees and what a rename would have to touch.
 *
 * @param literal - The object literal's source text, comments already stripped.
 * @returns The declarations, in source order.
 */
export function declarations(literal: string): Declaration[] {
  const body = literal.slice(1, -1);
  const out: Declaration[] = [];
  let depth = 0;
  let start = 0;
  const push = (chunk: string): void => {
    const colon = depthZeroColon(chunk);
    if (colon < 0) return;
    const key = chunk.slice(0, colon).trim();
    const value = chunk
      .slice(colon + 1)
      .replace(/\s+/g, ' ')
      .trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(key)) return;
    out.push({ key, value });
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
  }
  push(body.slice(start));
  return out;
}

/** The index of the first `:` at bracket depth zero in `chunk`, or `-1`. */
function depthZeroColon(chunk: string): number {
  let depth = 0;
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

/** Whether `value` is a source literal rather than a name. */
export function isLiteral(value: string): boolean {
  return (
    /^[-\d]/.test(value) ||
    value.startsWith("'") ||
    value.startsWith('"') ||
    /^(true|false|null)$/.test(value)
  );
}

/**
 * The declarations that hold an engine-owned default without naming its owner.
 *
 * @param engineDefaults - The engine's own defaults table for this option family.
 * @param engineExports - The engine package's public surface, to resolve a name against.
 * @param decls - The declarations of one parser's option object.
 * @returns One entry per offending declaration; empty means the parser names every shared default.
 */
export function ownerViolations(
  engineDefaults: Readonly<Record<string, unknown>>,
  engineExports: Readonly<Record<string, unknown>>,
  decls: readonly Declaration[],
): OwnerViolation[] {
  const out: OwnerViolation[] = [];
  for (const { key, value } of decls) {
    if (!Object.prototype.hasOwnProperty.call(engineDefaults, key)) continue;
    const shipped = engineDefaults[key];
    if (isLiteral(value)) {
      out.push({
        key,
        value,
        why:
          `writes the shipped default as a literal. It is declared in this file AND in the engine's own ` +
          `defaults table, so the two can drift with nothing to compare them — the class ` +
          `docs/ranking-default-owners.md records. Read the owner instead.`,
      });
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(engineExports, value)) {
      out.push({
        key,
        value,
        why: `names \`${value}\`, which the engine package does not export, so it is not an owner.`,
      });
      continue;
    }
    if (engineExports[value] !== shipped) {
      out.push({
        key,
        value,
        why: `names \`${value}\`, whose value is not the engine's shipped ${String(shipped)}.`,
      });
    }
  }
  return out;
}

const PARSERS = [
  {
    name: 'benchmarks/src/rcaeval-cli.ts',
    source: resolve(repoRoot, 'benchmarks/src/rcaeval-cli.ts'),
    options: (): Record<string, unknown> =>
      parseRCAEvalArgs([]) as unknown as Record<string, unknown>,
  },
  {
    name: 'benchmarks/src/fse26-cli.ts',
    source: resolve(repoRoot, 'benchmarks/src/fse26-cli.ts'),
    options: (): Record<string, unknown> =>
      parseFSE26Args([]) as unknown as Record<string, unknown>,
  },
] as const;

/**
 * The opener of each parser's option object.
 *
 * One regex for both, because the shapes differ only in the annotation — and the annotation is why the
 * pattern is written `[^={]*` rather than as a colon-group: `const opts = {` and
 * `const opts: CliOptions = {` differ by `: CliOptions `, and a group that demanded a colon absorbed the
 * space before the `=` in one case and none in the other. The first version of this regex matched only the
 * ANNOTATED parser and reported the other as having no option object at all.
 */
const OPTIONS_OPENER = /^[ \t]*const opts\b[^={]*= \{[ \t]*$/m;

const ENGINE_TABLES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  DEFAULT_TREE_PRUNER_OPTIONS: DEFAULT_TREE_PRUNER_OPTIONS as unknown as Record<string, unknown>,
  DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG: DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG as unknown as Record<
    string,
    unknown
  >,
};

/**
 * The union of the engine's defaults tables, with the table that owns each key.
 *
 * A `Record` rather than a `Map`, because `ownerViolations` asks the ownership question with
 * `Object.prototype.hasOwnProperty` — and a `Map` would answer `false` for every key, which is a census
 * that passes by checking nothing. Building the two together is what keeps the message and the check on the
 * same population.
 */
function engineOwnership(): {
  values: Record<string, unknown>;
  owners: Record<string, string>;
} {
  const values: Record<string, unknown> = {};
  const owners: Record<string, string> = {};
  for (const [table, entries] of Object.entries(ENGINE_TABLES)) {
    for (const [key, value] of Object.entries(entries)) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        // Two tables owning one key is itself a defect, and it would make the check below ambiguous.
        throw new Error(`\`${key}\` is declared by both ${owners[key]!} and ${table}`);
      }
      values[key] = value;
      owners[key] = table;
    }
  }
  return { values, owners };
}

describe('the shipped default has one owner', () => {
  it('exports each defaults table, so a caller cannot hold a second opinion', () => {
    // The privacy of these two tables is the ROOT CAUSE of the class rather than an incidental fact: a
    // parser needs the shipped value for its own field default and for its malformed-argument fallback, and
    // a module-private table leaves it no way to read one — so it wrote the number again. Asserted as a
    // VALUE rather than as a type, because an exported table that is empty would satisfy any type check.
    expect(Object.keys(DEFAULT_TREE_PRUNER_OPTIONS).length).toBeGreaterThan(15);
    expect(Object.keys(DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG).length).toBeGreaterThan(15);
  });

  it('agrees with the engine on every shared key, on the no-flag path', () => {
    // The BEHAVIOURAL half, and the stronger of the two: a published configuration is what the no-flag path
    // resolves to, so the parsers and the engine must not be able to disagree about it at all. The
    // population is the intersection the tables and the parsed options define between them — no list.
    const { values, owners } = engineOwnership();
    let shared = 0;
    for (const parser of PARSERS) {
      const opts = parser.options();
      for (const [key, shipped] of Object.entries(values)) {
        if (!Object.prototype.hasOwnProperty.call(opts, key)) continue;
        shared++;
        expect(
          opts[key],
          `${parser.name} defaults \`${key}\` away from ${owners[key]!}`,
        ).toStrictEqual(shipped);
      }
    }
    // A census over an empty population passes for the wrong reason, so the population is asserted.
    expect(shared).toBeGreaterThanOrEqual(20);
  });

  it('declares every shared default by NAME rather than repeating it', () => {
    const { values } = engineOwnership();
    const found: string[] = [];
    for (const parser of PARSERS) {
      const literal = objectLiteralAt(
        stripComments(readFileSync(parser.source, 'utf8')),
        OPTIONS_OPENER,
      );
      expect(literal, `${parser.name} has no option object to read`).toBeDefined();
      for (const violation of ownerViolations(values, TREE, declarations(literal!))) {
        found.push(`${parser.name}: ${violation.key} — ${violation.why}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('the census reads the source it claims to read', () => {
  it('finds both parsers option objects, and the keys inside them', () => {
    for (const parser of PARSERS) {
      const literal = objectLiteralAt(
        stripComments(readFileSync(parser.source, 'utf8')),
        OPTIONS_OPENER,
      );
      expect(literal, `${parser.name}`).toBeDefined();
      const keys = declarations(literal!).map((d) => d.key);
      // The extractor is a proxy for the file, and a proxy that found nothing would make the suite above
      // pass while reading no text at all.
      expect(keys.length, `${parser.name} yielded ${keys.length} declarations`).toBeGreaterThan(15);
      expect(keys).toContain('dataDir');
    }
  });

  it('reports the exact pre-change source it was written for', () => {
    // The arms, hand-asserted rather than reached through a sorted list. Each is a shape that WAS in the
    // tree at the commit before iteration 98, taken from `docs/ranking-default-owners.md`.
    const shipped = { traceWeight: 0, collapseDiscount: 0 };
    const decls = declarations(`{ traceWeight: 0, collapseDiscount: DEFAULT_COLLAPSE_DISCOUNT, }`);
    const violations = ownerViolations(shipped, { DEFAULT_COLLAPSE_DISCOUNT: 0 }, decls);
    expect(violations.map((v) => v.key)).toEqual(['traceWeight']);
    expect(violations[0]!.why).toContain('literal');
  });

  it('reports a name that is not the engine value', () => {
    // The other direction, and the one a substring check cannot see: `DEFAULT_STABILITY_WEIGHT` is a real
    // export of the engine, so a site could name it and still describe a configuration nobody ships.
    const violations = ownerViolations(
      { latWeight: 0.561495 },
      { DEFAULT_STABILITY_WEIGHT: 0.007352 },
      declarations('{ latWeight: DEFAULT_STABILITY_WEIGHT }'),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.why).toContain('not the engine');
  });

  it('reports a name the engine does not export', () => {
    const violations = ownerViolations(
      { collapseDiscount: 0 },
      { DEFAULT_COLLAPSE_DISCOUNT: 0 },
      declarations('{ collapseDiscount: DEFAULT_COLLAPSE }'),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.why).toContain('does not export');
  });

  it('leaves a key the engine does not own alone', () => {
    // `dataDir` is an operational option, not a ranking term, and the class does not reach it — the
    // distinction the dispatch-surface census keeps as `OPERATIONAL_OPTIONS`, asserted here so the check
    // cannot become "every declaration must be an identifier".
    expect(ownerViolations({}, {}, declarations("{ dataDir: '/tmp', maxCases: 0 }"))).toEqual([]);
  });

  it('reads a nested literal as ONE declaration', () => {
    // `propagationVelocity` is an object; a comma inside it must not split a declaration, or the census
    // would read a fragment as a key and silently check nothing.
    const decls = declarations(
      '{ propagationVelocity: { useBOCPD: false, expectedDirectLatency: 1.0 }, x: 1 }',
    );
    expect(decls.map((d) => d.key)).toEqual(['propagationVelocity', 'x']);
    expect(decls[0]!.value).toBe('{ useBOCPD: false, expectedDirectLatency: 1.0 }');
  });

  it('strips comments before matching braces', () => {
    // A comment is where a brace is most likely to be unbalanced, and the option objects here carry long
    // explanatory comments — including the one this iteration added beside `traceWeight`. Asserted as the
    // two PROPERTIES the matcher depends on rather than as an exact string, because the exact spaces are a
    // fact about the replacement and the properties are facts about the reader.
    const stripped = stripComments('a // {\nb /* } */ c');
    expect(stripped).not.toContain('{');
    expect(stripped).not.toContain('}');
    expect(stripped.split('\n')).toHaveLength(2);
    // The text on either side of a comment survives, or the extractor would read a fragment as a key.
    expect(stripped.startsWith('a ')).toBe(true);
    expect(stripped.split('\n')[1]!.trimEnd().endsWith('c')).toBe(true);
  });

  it('classifies literals by their own text', () => {
    for (const literal of ['0', '-1', '0.561495', "'sum'", '"x"', 'true', 'false', 'null']) {
      expect(isLiteral(literal), literal).toBe(true);
    }
    for (const name of ['DEFAULT_LAT_WEIGHT', 'TREE.DEFAULT_LOG_WEIGHT', "join(homedir(), 'x')"]) {
      expect(isLiteral(name), name).toBe(false);
    }
  });
});
