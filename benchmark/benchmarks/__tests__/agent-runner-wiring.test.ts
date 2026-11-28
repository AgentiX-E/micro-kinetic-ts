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

  it('carries the certainty floor the same road, because a saving dropped at a hop is a saved invoice', () => {
    // `--certainty-floor` is the first flag in this programme whose WRONG behaviour is invisible in the artifact: a
    // floor parsed and then defaulted spends the full budget and reads exactly like a run that never asked for it.
    // Iteration 345's `onset` is the proof — parsed, logged, and present in 0 of 532 transcripts.
    const passed = passedArguments();
    const declared = declaredParameters();
    const index = declared.indexOf('certaintyFloor');
    expect(index).toBeGreaterThan(0);
    expect(passed[index]).toBe('certaintyFloor');

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
    expect(args[signature.indexOf('certaintyFloor')]).toContain('certaintyFloor');
  });

  it('refuses a floor that is not a finite margin, rather than skipping the corpus or nothing', () => {
    const text = readFileSync(resolve(SRC, 'run-query-agent.ts'), 'utf8');
    // A typo in a ¥20 dispatch must be a throw and not a silent `NaN >= x`, which is false for every case and looks
    // exactly like a floor of zero.
    expect(text).toContain("number('certainty-floor', 0)");
    expect(text).toContain('Number.isFinite(certaintyFloor)');
  });

  it('prints the floor in the banner, because a run at 1.5 and a run at 0 spend different money', () => {
    // The banner is the only line a human reads before the tables, and the floor is the one flag that changes what the
    // arm SPENDS without changing what it answers. A banner that omitted it would print the same sentence for an ¥10.41
    // dispatch and a ¥7.76 one, which is the reading iteration 347 was published on.
    const text = readFileSync(resolve(SRC, 'run-query-agent.ts'), 'utf8');
    const banner = text.slice(text.indexOf('Free-investigation arm'));
    // Sliced to the end of the concatenation rather than to a fixed 900 characters: the banner has grown a clause per
    // iteration, and a width that has to be edited each time is a test measuring its own padding.
    expect(banner.slice(0, banner.indexOf('console.log', banner.indexOf('revision')))).toContain(
      'floor ${',
    );
  });

  it("prices the run with the audit's own function, at the column the run started under", () => {
    // The last line of a run is the only cost figure most readers see, and for four iterations it was computed inline
    // from two constants: `prompt × 2 + completion × 8`, the peak column with every prompt token billed as a miss.
    // Run `45595943761` cost 1.69 and the line said 15.55. Three things have to hold at the call site, and each fails
    // silently on its own: the number comes from `billLine`, the card comes from the clock (not from `new Date()`, which
    // would reprice the same artifact differently every time it is read), and the cache column reaches the line at all.
    const text = readFileSync(resolve(SRC, 'run-query-agent.ts'), 'utf8');
    expect(text).toContain('console.log(billLine(summary, rates, tariff))');
    expect(text).toContain('const rates = servedRatesAt(startedAtDate)');
    expect(text).toContain('const tariff = tariffAt(startedAtDate)');
    expect(text).toContain('const startedAtDate = new Date(startedAt)');
    // The two-constant table is gone: a runner that kept it could print a second, different bill in the same file.
    expect(text).not.toContain('PRICES');
    expect(text).not.toContain('at the declared prices');
  });

  it('states the transcript wall in the banner, because a capped run is a different arm', () => {
    // The cap decides how much of the investigation the model can still see, so two runs that differ only in it are
    // two arms. A banner that printed the same sentence for both would report the configuration the reader assumed
    // rather than the one that ran — which is what the floor's line was added for one iteration ago.
    const text = readFileSync(resolve(SRC, 'run-query-agent.ts'), 'utf8');
    expect(text).toContain('${args.budget.transcriptChars} transcript chars');
  });

  it('states the per-result cut beside the wall, because the two levers are not the same arm', () => {
    // Both decide what the prompt carries and they are not interchangeable: the wall drops old blocks from the front,
    // the cut renders each block once on entry. Iteration 354 measured the first (38.5 % fewer tokens, 1 % dearer), so a
    // banner that named only the wall would report the configuration the reader assumed for the lever that has not run.
    const text = readFileSync(resolve(SRC, 'run-query-agent.ts'), 'utf8');
    expect(text).toContain('result ${args.budget.resultChars === undefined');
  });

  it('records the incumbent NAME on both exits, because a boolean cannot be re-read as a name', () => {
    // Two row literals write an artifact: the one for a case that failed and the one for a case that ran. A column
    // added to one of them is the defect this file exists for — `incumbent` was already written twice, and the next
    // floor rule ("the prior and the engine name the same service") needs the name, not the flag.
    const text = readFileSync(resolve(SRC, 'run-query-agent.ts'), 'utf8');
    const writes = text.match(/^\s+priorTop: incumbentName,$/gm) ?? [];
    expect(writes).toHaveLength(2);
    // And read once, so the two rows cannot disagree about the case.
    expect(text.match(/const incumbentName = priorTopOf\(/g) ?? []).toHaveLength(1);
  });
});
