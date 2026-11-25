/**
 * The runner must pass every argument the loop accepts.
 *
 * Iteration 345 built an arm whose whole claim was "one field added to an existing line and nothing else", dispatched it,
 * and READ THE ARTIFACT: `err=` appeared in **0 of 532** transcripts. The flag parsed, the log line said `onset onset`,
 * and the field never reached a tool — because `runQueryAgent` gained an eleventh parameter and the one call site in
 * `run-query-agent.ts` still passed ten. Positional arguments do not fail; they silently take the default.
 *
 * The consequence was larger than a wasted dispatch: that run was a **free arm**, and it scored **178 / 532** where the
 * free arm scored **414** two days earlier on the same ids. Every loss this programme has attributed to a presentation
 * (343's −38.53 pp, 342b's 52.26 % retention) sits inside that drift, which means the comparisons were between
 * *different days*, not between *different arms*.
 *
 * So this guard is not about one parameter. It asserts that a call site and a signature agree on the COUNT of arguments,
 * and it fails with the missing parameter's name in the message. A future parameter added to the loop without being
 * passed is a reading error waiting to be published, and this is the cheapest place to stop it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = resolve(fileURLToPath(new URL('.', import.meta.url)), '../src');

/** Split an argument list on commas, with comment lines removed first (their prose carries commas). */
function argsOf(block: string): string[] {
  return block
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join(' ')
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '');
}

/** The parameter names of `runQueryAgent`, read from its own declaration. */
function declaredParameters(): string[] {
  const text = readFileSync(resolve(SRC, 'query-agent.ts'), 'utf8');
  const start = text.indexOf('export async function runQueryAgent(');
  expect(start).toBeGreaterThan(0);
  const open = text.indexOf('(', start);
  const close = text.indexOf('): Promise<QueryOutcome>', open);
  return argsOf(text.slice(open + 1, close)).map((one) => one.split(':')[0]!.split('=')[0]!.trim());
}

/** The argument expressions of the one call to `runQueryAgent` in the runner. */
function passedArguments(): string[] {
  const text = readFileSync(resolve(SRC, 'run-query-agent.ts'), 'utf8');
  const start = text.indexOf('await runQueryAgent(');
  expect(start).toBeGreaterThan(0);
  const open = text.indexOf('(', start);
  const close = text.indexOf(');', open);
  return argsOf(text.slice(open + 1, close));
}

describe('the runner-to-loop wiring', () => {
  it('passes exactly the arguments the loop declares, and names any that are missing', () => {
    const declared = declaredParameters();
    const passed = passedArguments();
    // The diff is reported as a set difference rather than a count, because a count tells a reader "-1" and a name
    // tells them which knob was silently defaulted.
    const missing = declared.slice(passed.length);
    expect(missing).toEqual([]);
    expect(passed).toHaveLength(declared.length);
  });

  it('passes the onset flag in its own position at BOTH hops, not as a default of something else', () => {
    // The loop is reached through `investigate`, so one count is not enough: the chain is
    // `args.evidenceOrder` -> `investigate(onset)` -> `runQueryAgent(onset)`, and the defect this file exists for was a
    // break in the second hop while the first one was correct.
    const passed = passedArguments();
    const declared = declaredParameters();
    const index = declared.indexOf('onset');
    expect(index).toBeGreaterThan(0);
    expect(passed[index]).toBe('onset');

    const text = readFileSync(resolve(SRC, 'run-query-agent.ts'), 'utf8');
    const sigStart = text.indexOf('async function investigate(');
    const sigOpen = text.indexOf('(', sigStart);
    const sigClose = text.indexOf('): Promise<QueryArmRow | null>', sigOpen);
    const signature = argsOf(text.slice(sigOpen + 1, sigClose)).map((one) =>
      one.split(':')[0]!.trim(),
    );
    const callStart = text.indexOf('await investigate(');
    const callOpen = text.indexOf('(', callStart);
    const callClose = text.indexOf(');', callOpen);
    const args = argsOf(text.slice(callOpen + 1, callClose));
    expect(args[signature.indexOf('onset')]).toContain('evidenceOrder');
  });
});
