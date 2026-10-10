/**
 * Census of the SHIPPED-VALUE DECLARATIONS on the option surface.
 *
 * ## Why this exists
 *
 * An option's shipped value lives in two places that nothing joins: the constant the
 * constructor FILLS, and the doc comment that TELLS A READER what ships. The comment is the
 * only place a proposer learns the value, and this repository has a named failure mode for
 * exactly this shape — **a summary outlives its own correction** — which one change committed
 * five times over.
 *
 * `DEFAULT_STABILITY_WEIGHT` was `0` when five doc blocks were written. The constant became
 * `0.007352` when the decisive-stability term was enrolled and BOTH halves of the shared kill
 * criterion were measured on it (`35411806524` FSE'26 `757/1422`, `35411810992` golden 9 of 9
 * byte-identical, `35416576350` the DEFAULT path). The comments did not move, so five shipped
 * declarations — one of them in the `@agentix-e/micro-kinetic-core` declaration file, one in
 * the FSE'26 report writer, one in the runner that PRODUCES the golden — still told a reader
 * the term was off; one of them named `0.03017`, the FSE'26 window's midpoint, as "its weight"
 * although that value had been REJECTED for moving four golden cells, one by 15.8pp.
 *
 * This matters more than documentation tidiness because the register's rule is that a knob is
 * found by its NAME and owned by a document — and for a comment-only knob the owner IS the doc
 * comment. A stale comment there presents a closed axis as open, which is the one thing the
 * register exists to prevent, and it did so in five places at once.
 *
 * ## What is derived rather than remembered
 *
 * 1. The SHIP-ON population is the constructor's own defaults, read out of
 *    `DEFAULT_TREE_PRUNER_OPTIONS` in the engine's source with spreads resolved, so an option
 *    added later is enrolled without editing this file. Ship-ON is a number that is not `0`,
 *    or the boolean `true`.
 * 2. The declaration sites are every `.ts` under `packages/*\/src` and `benchmarks/src`,
 *    WALKED, so a fourth surface is enrolled automatically. Only `node_modules` and build
 *    output are skipped, by name, and the walk's own size is asserted below.
 * 3. A claim is judged NUMERICALLY. `Default: 0.8` is a claim of 0.8 and not of zero, while
 *    `Default 0.` at the end of a sentence IS a claim of zero — so a character-class lookahead
 *    is wrong in BOTH directions and the captured number is what must be compared. That
 *    correction is a positive control below, not a comment about one.
 *
 * ## What it does NOT cover, stated rather than implied
 *
 * A stale claim phrased with no number and none of the five spellings is invisible here. The
 * five sites this census found were therefore repaired by NAMING the constant
 * (`{@link DEFAULT_STABILITY_WEIGHT}`) rather than restating its value: a declaration that
 * names the constant cannot drift from it, which is the only permanence a prose guard can buy.
 *
 * @module __tests__/unit/shipped-declaration-census
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../');
const PRUNER = resolve(repoRoot, 'packages/tree/src/pruning/pruner.ts');

/** The engine's own option surface — the one place a numeric `Default:` IS the shipped value. */
const ENGINE_OPTION_SURFACE = relative(repoRoot, PRUNER);

/**
 * A zero claim, with the numeric arms CAPTURING their number.
 *
 * The captured group is compared numerically by {@link zeroClaimOf}. `ships-inert` carries no
 * number because the word is the claim: "it ships inert" states a shipped value of zero without
 * ever writing one, and that phrasing is not hypothetical — it is one of the five sites.
 */
const ZERO_CLAIMS: readonly (readonly [string, RegExp])[] = [
  ['ships-at-zero', /Ships?\s+at\s+[`*']{0,2}([0-9]+(?:\.[0-9]+)?)/i],
  ['zero-is-shipped', /[`*']{0,2}([0-9]+(?:\.[0-9]+)?)[`*']{0,2}\s+is\s+the\s+SHIPPED\s+value/i],
  ['enrolled-at-zero', /enrolled\s+at\s+(?:weight\s+|the\s+)?[`*']{0,2}([0-9]+(?:\.[0-9]+)?)/i],
  ['default-zero', /Default:?\s*[`*']{0,2}([0-9]+(?:\.[0-9]+)?)/i],
  ['ships-inert', /ships?\s+(?:inert|disabled|off)\b/i],
];

/**
 * Arm `default-zero` states a claim about an INTERFACE's own default.
 *
 * That is the shipped value exactly where the constructor fills the option, and nowhere else:
 * `RankingWeights` is the optimizer's serializable SEARCH-SPACE contract, whose documented
 * convention is "0 disables", so a `Default 0` there is a statement about the cube rather than
 * about the engine. Scoping the arm rather than widening the exemption keeps the three
 * engine-level arms applied to every surface.
 */
const NUMERIC_DEFAULT_SURFACE: readonly string[] = [ENGINE_OPTION_SURFACE];

/**
 * The first zero claim a doc block makes, or `null`.
 *
 * @param block - The doc comment's body, without its delimiters.
 * @param numericDefaultAllowed - Whether the `default-zero` arm applies at this site.
 * @returns The arm's name and the matched text, or `null`.
 */
function zeroClaimOf(
  block: string,
  numericDefaultAllowed: boolean,
): { readonly arm: string; readonly quote: string } | null {
  for (const [arm, re] of ZERO_CLAIMS) {
    if (arm === 'default-zero' && !numericDefaultAllowed) continue;
    const m = re.exec(block);
    if (m === null) continue;
    // A numeric arm that captured a number which is not zero is a claim about a value, and
    // about a different one. `ships-inert` captures nothing because the word is the claim.
    if (m[1] !== undefined && Number(m[1]) !== 0) continue;
    return { arm, quote: m[0] };
  }
  return null;
}

/** The walked file list, read once. `shippedSources` is a declaration and therefore hoisted. */
const SOURCES: readonly string[] = shippedSources();

/** Text by file, so a literal that resolves a dozen constants reads each file once. */
const TEXT_BY_FILE = new Map<string, string>();

/** The text of a shipped source, read once. */
function textOf(file: string): string {
  const cached = TEXT_BY_FILE.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(file, 'utf8');
  TEXT_BY_FILE.set(file, text);
  return text;
}

/** Memo for {@link declaringFile}. */
const DECLARING_FILE = new Map<string, string | undefined>();

/**
 * Every `const` declaration across the shipped sources, indexed once.
 *
 * The form is allowed to be `const X = …` as well as `export const X: T = …`, because the object
 * this census reads (`DEFAULT_TREE_PRUNER_OPTIONS`) is deliberately NOT exported — a fact the
 * first version of this resolver got wrong and reported as "declared zero times". The scan is
 * LINE-based so a `const` inside a function body is indexed by its own line rather than by a
 * walk that could span a declaration it does not own.
 */
const DECLARED_IN = ((): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  for (const file of SOURCES) {
    for (const line of textOf(file).split('\n')) {
      const m = /^\s*(?:export )?const ([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=\n]+)?=(?!=)/.exec(line);
      if (m === null) continue;
      index.set(m[1]!, [...(index.get(m[1]!) ?? []), file]);
    }
  }
  return index;
})();

/**
 * The single shipped file that declares `const <name>`.
 *
 * A spread crosses files — `DEFAULT_TREE_PRUNER_OPTIONS` spreads `DEFAULT_RCA_OPTIONS`, which the
 * core package declares — so a resolver bound to one file would silently drop the spread's keys.
 * A name declared in MORE THAN ONE file is REFUSED rather than resolved by order, because "which
 * of the two did this read?" is the question a census must never have to ask.
 *
 * @param name - The constant's name.
 * @returns The declaring file's path, or `undefined` when no shipped source declares it.
 */
function declaringFile(name: string): string | undefined {
  if (DECLARING_FILE.has(name)) return DECLARING_FILE.get(name);
  const hits = DECLARED_IN.get(name) ?? [];
  expect(hits.length, `${name} is declared exactly once across the shipped sources`).toBe(1);
  DECLARING_FILE.set(name, hits[0]);
  return hits[0];
}

/** The value a scalar literal spells, or `undefined` when the token is not a scalar literal. */
function scalarValue(raw: string): number | boolean | string | undefined {
  if (/^-?[0-9.]+$/.test(raw)) return Number(raw);
  if (/^'([^']*)'$/.test(raw)) return raw.slice(1, -1);
  if (/^(true|false)$/.test(raw)) return raw === 'true';
  return undefined;
}

/** The value a constant is DECLARED with, when its declaration is a scalar. */
function constantValue(name: string): number | boolean | string | undefined {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return undefined;
  const file = declaringFile(name);
  if (file === undefined) return undefined;
  const text = textOf(file);
  // Anchored on the line, and never on `indexOf` alone: `const DEFAULT_X` is a PREFIX of
  // `const DEFAULT_XY`, and a prefix read is how a lookup finds the wrong declaration.
  const m = new RegExp(`^\\s*(?:export )?const ${name}\\s*(?::[^=\\n]+)?=([^;\\n]*)`, 'm').exec(
    text,
  );
  return m === null ? undefined : scalarValue(m[1]!.trim());
}

/**
 * Resolve the `<name>: <value>` pairs of an object literal, following spreads across files.
 *
 * @param literalName - The `const` whose literal is read.
 * @returns One entry per resolvable key, in declaration order.
 */
function filledDefaults(literalName: string): Map<string, number | boolean | string> {
  const out = new Map<string, number | boolean | string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    // A cycle would be a defect in the source rather than in the census, but a walker that
    // recursed forever on one would hang the suite instead of failing it.
    if (visited.has(name)) return;
    visited.add(name);
    const scalar = constantValue(name);
    if (scalar !== undefined) {
      // A SCALAR constant reached through a spread: a value, not a literal to enumerate.
      out.set(name, scalar);
      return;
    }
    const file = declaringFile(name);
    if (file === undefined) return;
    const text = textOf(file);
    const open = text.indexOf('{', text.indexOf(`const ${name}`));
    const end = text.indexOf('\n};', open);
    expect(end, `${name} is a multi-line object literal`).toBeGreaterThan(open);
    for (const line of text.slice(open, end).split('\n')) {
      // A spread is FOLLOWED rather than skipped: `DEFAULT_TREE_PRUNER_OPTIONS` spreads the
      // engine's base options, and a census that ignored the spread would carry a population
      // smaller than the object it claims to read.
      const spread = /^\s*\.\.\.([A-Za-z_][A-Za-z0-9_]*),\s*$/.exec(line);
      if (spread !== null) visit(spread[1]!);
      const entry = /^\s{2}([A-Za-z][A-Za-z0-9]*):\s*(.+?),\s*$/.exec(line);
      if (entry === null) continue;
      const value = scalarValue(entry[2]!) ?? constantValue(entry[2]!);
      if (value !== undefined) out.set(entry[1]!, value);
    }
  };
  visit(literalName);
  return out;
}

/** Every `.ts` under a directory, skipping dependency and build directories by name. */
function shippedSources(): string[] {
  const walk = (dir: string, acc: string[]): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, acc);
      else if (entry.name.endsWith('.ts')) acc.push(path);
    }
    return acc;
  };
  const files: string[] = [];
  for (const pkg of readdirSync(join(repoRoot, 'packages'))) {
    try {
      walk(join(repoRoot, 'packages', pkg, 'src'), files);
    } catch {
      // A workspace package with no `src` — a docs-only or config-only entry.
    }
  }
  walk(join(repoRoot, 'benchmarks/src'), files);
  return files;
}

const filled = filledDefaults('DEFAULT_TREE_PRUNER_OPTIONS');
/** An option is SHIP-ON when the constructor fills it with a number that is not 0, or `true`. */
const shipOn = new Map(
  [...filled].filter(([, v]) => v === true || (typeof v === 'number' && v !== 0)),
);

const sources: readonly string[] = SOURCES;

/** A doc block and the member declaration it documents. */
interface DeclarationSite {
  readonly file: string;
  readonly line: number;
  readonly member: string;
  readonly block: string;
}

/** Every doc block whose first following non-blank line declares a member. */
function declarationSites(): DeclarationSite[] {
  const out: DeclarationSite[] = [];
  for (const file of sources) {
    const text = textOf(file);
    for (const m of text.matchAll(/\/\*\*([\s\S]*?)\*\/\n([^\n]*)/g)) {
      const member =
        /^\s*(?:readonly\s+|private\s+|public\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/.exec(m[2]!);
      if (member === null) continue;
      out.push({
        file: relative(repoRoot, file),
        line: text.slice(0, m.index).split('\n').length,
        member: member[1]!,
        block: m[1]!,
      });
    }
  }
  return out;
}

const sites = declarationSites();

describe('the shipped-value declarations agree with what the constructor fills', () => {
  it('reads a non-empty ship-ON population out of the constructor defaults', () => {
    // A floor, not an equality, so adding an option is allowed — but a spread the resolver
    // failed to follow would SHRINK the population silently, which is the failure this whole
    // family of guards keeps finding. The four shipped weights below are the named evidence
    // that the spread was followed and the named constants were resolved.
    expect(filled.size).toBeGreaterThanOrEqual(20);
    expect(shipOn.size).toBeGreaterThanOrEqual(6);
    for (const shippedOn of [
      'latWeight',
      'latMinRise',
      'poolMetricPenaltyWeight',
      'stabilityWeight',
      'logWeight',
    ]) {
      expect(shipOn.has(shippedOn), `${shippedOn} is ship-ON`).toBe(true);
    }
    // And the population is not "everything": an opt-in signal at 0 must be OFF, or this guard
    // would be checking a set that cannot distinguish a shipped term from an ablation.
    expect(shipOn.has('prismWeight'), 'prismWeight ships 0').toBe(false);
    expect(shipOn.has('failedEdgeWeight'), 'failedEdgeWeight ships 0').toBe(false);
  });

  it('examines a non-empty population of declaration sites on the shipped surfaces', () => {
    // Non-vacuity of the WALK, which is the half a hand list would replace: a walk that finds
    // no file, or an extractor that pairs no doc block with a member, passes every assertion
    // below while measuring nothing.
    expect(sources.length).toBeGreaterThanOrEqual(100);
    const documented = sites.filter(
      (site) => typeof filled.get(site.member) === 'number' || filled.get(site.member) === true,
    );
    expect(documented.length).toBeGreaterThanOrEqual(30);
    // Every declaration site names a file that exists on a shipped surface, so a site cannot be
    // reported against something outside the population. The set is built ONCE: comparing each
    // site against a freshly mapped array is O(sites x files) and was measured at 542ms of the
    // suite's own time before this line existed.
    const shipped = new Set(sources.map((file) => relative(repoRoot, file)));
    for (const site of sites) expect(shipped.has(site.file), site.file).toBe(true);
  });

  it('finds no shipped declaration asserting a ship-ON option is off', () => {
    const violations: string[] = [];
    for (const site of sites) {
      if (!shipOn.has(site.member)) continue;
      const claim = zeroClaimOf(site.block, NUMERIC_DEFAULT_SURFACE.includes(site.file));
      if (claim !== null) {
        violations.push(
          `${site.file}:${site.line} documents ${site.member}=${String(shipOn.get(site.member))} ` +
            `as shipping ${JSON.stringify(claim.quote)} (${claim.arm})`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('fires every arm on a positive control, so a quiet arm is a measured quiet', () => {
    // The arms are a hand-written vocabulary, and the repository's rule for such a set is that
    // each member must be shown to FIRE. An arm that cannot fire would make the guard above
    // pass on a population it never actually asked about.
    const controls: readonly (readonly [string, string])[] = [
      ['ships-at-zero', '/** Ships at **0** — the window is solved. */'],
      ['zero-is-shipped', '/** `0` is the SHIPPED value and the candidate is reached by flag. */'],
      ['enrolled-at-zero', '/** the term was enrolled at weight 0 — */'],
      ['default-zero', '/** Default: 0 (opt-in). */'],
      ['ships-inert', '/** so it ships inert and is evaluated by passing the flag. */'],
    ];
    for (const [arm, block] of controls) {
      const claim = zeroClaimOf(block, NUMERIC_DEFAULT_SURFACE.length > 0);
      expect(claim, `${arm} must fire on its own control`).not.toBeNull();
      expect(claim!.arm).toBe(arm);
    }
    // Non-vacuity in the other direction: the control set must exercise EVERY declared arm, or
    // a new arm could be added and never demonstrated.
    expect(new Set(controls.map(([arm]) => arm))).toEqual(new Set(ZERO_CLAIMS.map(([arm]) => arm)));
  });

  it('reads a captured number numerically, so 0.8 is not a claim of zero', () => {
    // The correction this test exists to keep: a lookahead that excludes `.` reads `Default: 0.8`
    // as a zero claim, and the same lookahead rejects the sentence-final `Default 0.` — wrong in
    // both directions. Both halves are asserted, because only a two-sided control can tell a
    // numeric comparison from a pattern that happens to agree with it on the current tree.
    expect(zeroClaimOf('/** 1-hop decay factor α ∈ (0, 1]. Default: 0.8 */', true)).toBeNull();
    expect(zeroClaimOf('/** Weight of a thing shipped on. Default 0. */', true)?.arm).toBe(
      'default-zero',
    );
    expect(zeroClaimOf('/** Ship it. Ships at 0.03, the measured point. */', true)).toBeNull();
  });

  it('scopes the numeric-default arm to the surface the constructor fills', () => {
    // The engine's option surface is where a `Default:` IS the shipped value. `RankingWeights`
    // is the optimizer's serializable search-space contract, whose convention is that 0 means
    // disabled — so the same spelling is a claim about the cube there, and the scope is asserted
    // rather than the exemption left implicit.
    expect(NUMERIC_DEFAULT_SURFACE).toEqual([ENGINE_OPTION_SURFACE]);
    const onASearchSpace: DeclarationSite = {
      file: 'packages/core/src/types/ranking-weights.ts',
      line: 1,
      member: 'logWeight',
      block: '/** Log-signal prior ... Default 0. */',
    };
    expect(
      zeroClaimOf(onASearchSpace.block, NUMERIC_DEFAULT_SURFACE.includes(onASearchSpace.file)),
    ).toBeNull();
  });
});
