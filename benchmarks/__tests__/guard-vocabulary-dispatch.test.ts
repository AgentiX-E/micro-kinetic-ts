/**
 * Guards the ROUTE from a dispatch to the guard's vocabulary.
 *
 * The guard's question has one vocabulary in the engine (`TRANSIENT_GUARD_TESTS`) and it reaches a running
 * cell through two workflows. On the golden half the route was a passthrough — `transguard=*` forwards whatever
 * it was given and the CLI refuses an unknown word against the engine's own table, so a member added to the
 * union is dispatchable the day it lands. On the FSE'26 half the route carried a SECOND copy of the vocabulary,
 * a hand-written `case` list, and the copy was one member behind: iteration 239 added `hump` to the union and
 * the FSE'26 parser rejected it with `takes endpoint, level-window, …`, which is a refusal written by the copy
 * rather than by the engine.
 *
 * That is the defect this file exists to prevent, and it is the same shape the engine's own docblock warns
 * about for parsers: *"a parser that validates against a hand-written pair of literals, and a test that probes
 * the values it can think of, are two lists that drift."* Here the two lists are two workflows, and the drift
 * is silent in the direction that costs the most: the reading that is refused is a pre-registered one, and a
 * dispatch that cannot express an arm reads as a missing measurement rather than as a bug.
 *
 * Read as TEXT, because the failure mode is a LIST THAT SHOULD NOT EXIST. A structural assertion cannot see an
 * extra branch; the absence of the literal can.
 *
 * @module benchmarks/__tests__/guard-vocabulary-dispatch
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { TRANSIENT_GUARD_TESTS } from '../../packages/tree/src/index.js';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const FSE26 = readFileSync(resolve(repoRoot, '.github/workflows/fse26-benchmark.yml'), 'utf8');
const RCAEVAL = readFileSync(resolve(repoRoot, '.github/workflows/benchmark-rcaeval.yml'), 'utf8');
const FSE26_CLI = readFileSync(resolve(repoRoot, 'benchmarks/src/fse26-cli.ts'), 'utf8');
const RCAEVAL_CLI = readFileSync(resolve(repoRoot, 'benchmarks/src/rcaeval-cli.ts'), 'utf8');

const MEMBERS = Object.keys(TRANSIENT_GUARD_TESTS);

/**
 * The routing branch for one key, WITH the comment block that introduces it.
 *
 * The leading comment is inside the slice on purpose: the comment is where a stale claim about the vocabulary
 * lives — the seven golden branches each said `` `endpoint` … and ships ``, which stopped being true when the
 * shipped default moved to `evidence-trimmed`. A rule that only covered the shell would let the prose describe
 * a vocabulary the code no longer has, and the prose is what a dispatch author reads.
 */
function guardBranch(source: string, key: string): string {
  const lines = source.split('\n');
  const at = lines.findIndex((line) => {
    const head = line.trimStart();
    return head.startsWith(`${key})`) || head.startsWith(`${key}=*)`);
  });
  if (at < 0) throw new Error(`${key} is not routed by this workflow`);
  let first = at;
  while (first > 0) {
    const above = lines[first - 1] ?? '';
    if (!above.trimStart().startsWith('#')) break;
    first -= 1;
  }
  const last = lines.findIndex((line, index) => index >= at && line.trimEnd().endsWith(';;'));
  if (last < 0) throw new Error(`${key}'s branch has no terminator`);
  return lines.slice(first, last + 1).join('\n');
}

describe('the guard vocabulary has exactly one owner, and both dispatch halves read it', () => {
  it('the union is what a dispatch can ask for — no workflow restates a member', () => {
    // A member spelled inside the workflow is a second list whatever it is used for: an acceptance list, a
    // refusal message, or a sentence about which value ships. Each of the seven could be the one that lags.
    const branches: Array<[string, string, string]> = [
      ['FSE\u201926', FSE26, guardBranch(FSE26, 'transient_guard_test')],
      ['golden RE1', RCAEVAL, guardBranch(RCAEVAL, 'transguard')],
    ];
    for (const [label, , branch] of branches) {
      for (const member of MEMBERS) {
        expect(
          branch,
          `${label} names '${member}'; the engine's table is the only list`,
        ).not.toContain(member);
      }
    }
  });

  it('every route forwards the dispatched value instead of resolving it', () => {
    // Forwarding is what makes a new member dispatchable with no workflow edit. A branch that maps a value to
    // itself, or that falls back to a literal, is a resolver — and a resolver is a place where an unknown word
    // becomes the shipped one.
    expect(guardBranch(FSE26, 'transient_guard_test')).toContain('--transient-guard-test "$value"');
    expect(guardBranch(RCAEVAL, 'transguard')).toContain(
      '--transient-guard-test "${kv#transguard=}"',
    );
  });

  it('nothing else in either workflow pins the flag to a literal', () => {
    // The per-job branches are copies of one another, so the rule above is applied to every occurrence rather
    // than to the first: a literal added to the seventh golden job would otherwise be invisible to a test that
    // only read the first.
    for (const [label, source] of [
      ['FSE\u201926', FSE26],
      ['golden', RCAEVAL],
    ] as const) {
      const uses = source.split('\n').filter((line) => line.includes('--transient-guard-test'));
      expect(uses.length, `${label} routes no dispatch value`).toBeGreaterThan(0);
      for (const line of uses) {
        expect(line, `${label}: ${line.trim()}`).toContain('$');
      }
    }
  });

  it('both parsers refuse an unknown word against that table, so forwarding cannot publish a mislabelled run', () => {
    // The passthrough is only safe because the terminal check is derived. Both CLIs are read as text here for
    // the reason the union is: a parser that retyped the members would refuse `hump` again, one layer down.
    for (const [label, cli] of [
      ['fse26-cli', FSE26_CLI],
      ['rcaeval-cli', RCAEVAL_CLI],
    ] as const) {
      expect(cli, `${label} does not validate against the union`).toContain(
        'Object.keys(TRANSIENT_GUARD_TESTS)',
      );
    }
  });
});
