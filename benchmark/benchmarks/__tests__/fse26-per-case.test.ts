/**
 * The per-case verdict file's contract.
 *
 * These tests exist because the file is what makes a published average re-scorable: if a line loses its
 * accepted set, or truncates it, or reorders the ranking, then a judgement computed from it is a judgement
 * about a different corpus. Each case below names the property, not the implementation.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PER_CASE_RANK_LIMIT,
  formatPerCaseVerdict,
  writePerCaseVerdicts,
  type PerCaseVerdict,
} from '../src/fse26-per-case.js';

const verdict = (over: Partial<PerCaseVerdict> = {}): PerCaseVerdict => ({
  datapack: 'ts0-ts-basic-service-stress-abc123',
  faultType: 'JVMMemoryStress',
  accepted: ['ts-basic-service'],
  ranked: ['ts-basic-service', 'ts-station-service'],
  ...over,
});

describe('formatPerCaseVerdict', () => {
  it('writes one JSON object with no newline of its own', () => {
    const line = formatPerCaseVerdict(verdict());
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      datapack: 'ts0-ts-basic-service-stress-abc123',
      faultType: 'JVMMemoryStress',
      accepted: ['ts-basic-service'],
      ranked: ['ts-basic-service', 'ts-station-service'],
    });
  });

  it('keeps the four fields in a fixed order, so a diff is a diff of values', () => {
    const keys = Object.keys(JSON.parse(formatPerCaseVerdict(verdict())));
    expect(keys).toEqual(['datapack', 'faultType', 'accepted', 'ranked']);
  });

  it('carries the whole accepted set — a two-endpoint fault must not be truncated', () => {
    const parsed = JSON.parse(
      formatPerCaseVerdict(
        verdict({
          accepted: ['ts-basic-service', 'ts-station-service'],
        }),
      ),
    );
    expect(parsed.accepted).toEqual(['ts-basic-service', 'ts-station-service']);
  });

  it('preserves the accepted set in the corpus order, because the injected endpoint is not first by rule', () => {
    const parsed = JSON.parse(
      formatPerCaseVerdict(
        verdict({
          accepted: ['ts-station-service', 'ts-basic-service'],
        }),
      ),
    );
    expect(parsed.accepted).toEqual(['ts-station-service', 'ts-basic-service']);
  });

  it('truncates the ranking to the deepest At-K the suite reports', () => {
    const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const parsed = JSON.parse(formatPerCaseVerdict(verdict({ ranked })));
    expect(parsed.ranked).toHaveLength(PER_CASE_RANK_LIMIT);
    expect(parsed.ranked).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('preserves ranking order — a re-sorted ranking is a different answer', () => {
    const parsed = JSON.parse(formatPerCaseVerdict(verdict({ ranked: ['z', 'a', 'm'] })));
    expect(parsed.ranked).toEqual(['z', 'a', 'm']);
  });

  it('records an empty ranking as an empty array rather than dropping the field', () => {
    const parsed = JSON.parse(formatPerCaseVerdict(verdict({ ranked: [] })));
    expect(parsed.ranked).toEqual([]);
  });

  it('records an empty accepted set rather than dropping the field', () => {
    const parsed = JSON.parse(formatPerCaseVerdict(verdict({ accepted: [] })));
    expect(parsed.accepted).toEqual([]);
  });

  it('does not escape a service name into something the corpus would not recognise', () => {
    const name = 'ts-app.v2/service';
    const parsed = JSON.parse(formatPerCaseVerdict(verdict({ ranked: [name], accepted: [name] })));
    expect(parsed.ranked).toEqual([name]);
    expect(parsed.accepted).toEqual([name]);
  });
});

describe('writePerCaseVerdicts', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fse26-per-case-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes one line per case, in scoring order, and reports the count', () => {
    const path = join(dir, 'verdicts.jsonl');
    const rows = [
      verdict({ datapack: 'case-b' }),
      verdict({ datapack: 'case-a' }),
      verdict({ datapack: 'case-c' }),
    ];
    expect(writePerCaseVerdicts(path, rows)).toBe(3);
    const lines = readFileSync(path, 'utf8').split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');
    expect(lines.slice(0, 3).map((line) => JSON.parse(line).datapack)).toEqual([
      'case-b',
      'case-a',
      'case-c',
    ]);
  });

  it('writes an empty file for an empty run, so "no cases" is not "no file"', () => {
    const path = join(dir, 'empty.jsonl');
    expect(writePerCaseVerdicts(path, [])).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe('');
  });

  it('replaces a previous file instead of appending, so a row count belongs to one run', () => {
    const path = join(dir, 'verdicts.jsonl');
    writePerCaseVerdicts(path, [verdict(), verdict(), verdict()]);
    writePerCaseVerdicts(path, [verdict()]);
    expect(readFileSync(path, 'utf8').trimEnd().split('\n')).toHaveLength(1);
  });

  it("refuses to invent a directory — a missing parent is the caller's bug, not a silent success", () => {
    const path = join(dir, 'missing', 'verdicts.jsonl');
    expect(() => writePerCaseVerdicts(path, [verdict()])).toThrow();
  });
});
