/**
 * The dump accumulator.
 *
 * One `--diagnose-dump <path>` run evaluates several case GROUPS — `--suite re1` covers three systems
 * — and there is one file to put them in. The shipped runner built the text per group and wrote it
 * inside the group loop, so every system but the last was thrown away by the next `writeFileSync`,
 * and the console printed the same `125 cases, 125 blocks` three times while it happened. These
 * tests are about the two properties that make that unrepeatable: the accumulator owns the whole
 * file, and it refuses to be written twice.
 *
 * @module benchmarks/__tests__/fse26-diagnose-dump
 */

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DiagnoseDump, formatDiagnoseDumpLine } from '../src/fse26-diagnose-dump.js';

/** A block in the shape the sink renders — the accumulator never looks inside one. */
function blockOf(datapack: string): string {
  return `DIAG datapack=${datapack} faultType=cpu GT=[a] services=2 logMode=count inject=1\n  a [#1] selfAnomaly=1.000\n`;
}

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'mk-dump-')), 'dump.txt');
}

const HEADER = 'signals: logWeight=1 traceWeight=0';

describe('DiagnoseDump — one file per invocation, however many groups it covers', () => {
  it('accumulates every group into ONE file, and says which', () => {
    // The measurement this exists for: the shipped runner wrote the file once per system, so the
    // `re1` dump held 125 TrainTicket blocks and no OnlineBoutique or SockShop case at all — while
    // the console printed the same count three times and the artifact looked complete.
    const path = tempPath();
    const dump = new DiagnoseDump(path, HEADER);
    dump.record('OnlineBoutique:RE1', 'ob-1', blockOf('ob-1'));
    dump.record('SockShop:RE1', 'ss-1', blockOf('ss-1'));
    dump.record('SockShop:RE1', 'ss-2', blockOf('ss-2'));
    dump.record('TrainTicket:RE1', 'tt-1', blockOf('tt-1'));

    const summary = dump.write();
    const text = readFileSync(path, 'utf-8');

    expect(summary.path).toBe(path);
    expect(summary.cases).toBe(4);
    expect(text).toContain('ob-1');
    expect(text).toContain('ss-2');
    expect(text).toContain('tt-1');
    // The count travels with its population: `4 cases` means one thing spread over three systems
    // and another concentrated in one, and the summary has to be readable without opening the file.
    expect(summary.coverage).toEqual([
      { group: 'OnlineBoutique:RE1', cases: 1 },
      { group: 'SockShop:RE1', cases: 2 },
      { group: 'TrainTicket:RE1', cases: 1 },
    ]);
    expect(formatDiagnoseDumpLine(summary)).toBe(
      `${path} (4 cases: OnlineBoutique:RE1 1, SockShop:RE1 2, TrainTicket:RE1 1)`,
    );
  });

  it('refuses a record made after the write', () => {
    // The defect, made unreachable rather than documented. Writing inside the group loop is what
    // discarded two systems; with the file owned by one object, the next group's first record
    // raises instead of overwriting in silence — the failure moves to where the mistake is made.
    const dump = new DiagnoseDump(tempPath(), HEADER);
    dump.record('OnlineBoutique:RE1', 'ob-1', blockOf('ob-1'));
    dump.write();

    expect(() => dump.record('SockShop:RE1', 'ss-1', blockOf('ss-1'))).toThrow(
      /after it was written/,
    );
  });

  it('refuses the same datapack twice, and the same file written twice', () => {
    // Two records for one case would double-count it in every screen downstream, which reads as a
    // case that was evaluated twice rather than one that was written twice. A second write is the
    // truncation that lost the systems; both are refused for the same reason: the artifact has to
    // be a function of what was recorded.
    const dump = new DiagnoseDump(tempPath(), HEADER);
    dump.record('OnlineBoutique:RE1', 'ob-1', blockOf('ob-1'));

    expect(() => dump.record('OnlineBoutique:RE1', 'ob-1', blockOf('ob-1'))).toThrow(/twice/);

    dump.write();
    expect(() => dump.write()).toThrow(/already been written/);
  });

  it('leads with the configuration, so the artifact states what produced it', () => {
    // Measured: none of the seven dumps the first dispatch produced carried a configuration line,
    // while the FSE'26 dump does — so a reader of the artifact could not tell a trace-augmented
    // ranking from a plain one, and the `re3` dump reconstructs to `correct at 0 1` against its own
    // `prediction=` 15 with nothing in the file to explain it. The header is passed in rather than
    // derived, because the runner already prints that exact string in its banner: one owner, so the
    // two cannot disagree about the mode.
    const path = tempPath();
    const dump = new DiagnoseDump(path, HEADER);
    dump.record('OnlineBoutique:RE1', 'ob-1', blockOf('ob-1'));
    dump.write();

    const lines = readFileSync(path, 'utf-8').split('\n');
    expect(lines[0]).toBe(HEADER);
    // The header's own line, then the block's two — nothing else was inserted into the file.
    expect(lines).toHaveLength(4);
  });

  it('writes an empty file rather than no file when every group failed', () => {
    // A run that produced no case still has to leave evidence that it ran: a missing file is
    // indistinguishable from a flag that was never passed, which is how the first dispatch's empty
    // input looked.
    const path = tempPath();
    const summary = new DiagnoseDump(path, HEADER).write();

    expect(existsSync(path)).toBe(true);
    expect(summary.cases).toBe(0);
    expect(summary.coverage).toEqual([]);
    // No groups to name, so the line stops at the count rather than trailing an empty colon.
    expect(formatDiagnoseDumpLine(summary)).toBe(`${path} (0 cases)`);
    expect(readFileSync(path, 'utf-8')).toBe(`${HEADER}\n`);
  });

  it('is wired into the runner so that ONE write follows the last group', () => {
    // The behaviour above is the guard; this is the wiring, and it is checked by POSITION because
    // the two ways to get it wrong are invisible at runtime in a single-group run: keeping a
    // `writeFileSync` on the flag's own path would bypass the accumulator entirely, and calling
    // `write()` inside the group loop would look correct on `--system onlineboutique`. The
    // accumulator's own refusal is the real defence — this fails earlier, with a name.
    const source = readFileSync(new URL('../src/run-rcaeval.ts', import.meta.url), 'utf-8');

    expect(source).toContain('new DiagnoseDump(opts.diagnoseDump, formatSignalLine(opts))');
    expect(source).not.toMatch(/writeFileSync\(\s*opts\.diagnoseDump/);
    expect(source.match(/\.write\(\)/g) ?? []).toHaveLength(1);
    expect(source.indexOf('.write()')).toBeGreaterThan(
      source.indexOf('for (const [groupKey, metas] of groups) {'),
    );
    // And the header is the banner's own line, so the two cannot state different modes.
    expect(source.match(/formatSignalLine\(opts\)/g) ?? []).toHaveLength(2);
  });
});
