import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderTopologyBrief } from '../../packages/ai/src/agent/index.js';

import {
  TopologyBriefDump,
  formatTopologyBriefRecord,
  parseTopologyBriefs,
  readOneTopologyBrief,
  type TopologyBriefRecord,
} from '../src/topology-brief-file.js';

const RENDERED = renderTopologyBrief({
  cases: 4,
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
  ],
});

function record(over: Partial<TopologyBriefRecord> = {}): TopologyBriefRecord {
  return {
    system: 'fse26',
    cases: RENDERED.text === '' ? 0 : 4,
    services: RENDERED.services,
    edges: RENDERED.edges,
    digest: RENDERED.digest,
    brief: RENDERED.text,
    ...over,
  };
}

describe('formatTopologyBriefRecord / parseTopologyBriefs', () => {
  it('round-trips one record unchanged', () => {
    const text = formatTopologyBriefRecord(record());
    expect(parseTopologyBriefs(`${text}\n`)).toEqual([record()]);
  });

  it('keeps the brief verbatim, newlines and all, because the bytes are what the prompt sends', () => {
    const text = formatTopologyBriefRecord(record());
    const parsed = parseTopologyBriefs(text)[0]!;
    expect(parsed.brief).toBe(RENDERED.text);
    expect(parsed.brief.split('\n').length).toBeGreaterThan(2);
  });

  it('refuses a record whose digest is not the digest of its own text', () => {
    // The digest is what a recorded answer is keyed by, so a file that disagrees with itself would let a replay
    // claim a topology nobody dispatched. Cheaper to refuse than to reason about.
    const line = formatTopologyBriefRecord(record({ digest: '0000000000000000' }));
    expect(() => parseTopologyBriefs(line)).toThrow(/digest/);
  });

  it('refuses an empty brief, because "no brief" is the absence of a file and not a record', () => {
    const line = formatTopologyBriefRecord(record({ brief: '' }));
    expect(() => parseTopologyBriefs(line)).toThrow(/brief/);
  });

  it('refuses a negative or fractional count', () => {
    for (const bad of [-1, 1.5]) {
      const line = formatTopologyBriefRecord(record({ edges: bad }));
      expect(() => parseTopologyBriefs(line)).toThrow(/edges/);
    }
  });

  it('refuses a line that is not JSON, by line number', () => {
    expect(() => parseTopologyBriefs('not json')).toThrow(/line 1/);
  });

  it('refuses every field a reader would otherwise default', () => {
    // Each of these is a value `JSON.parse` produces without complaint and a consumer would then act on: a count
    // that is a string, a record that is an array, a `system` that is empty, a digest of the wrong shape, a brief
    // that is not text. The reader names the field so a corrupt artifact is a message and not a number.
    const patch = (over: Record<string, unknown>): string =>
      JSON.stringify({ ...JSON.parse(formatTopologyBriefRecord(record())), ...over });
    expect(() => parseTopologyBriefs(patch({ cases: '4' }))).toThrow(
      /cases on line 1 is not a number/,
    );
    expect(() => parseTopologyBriefs('[]')).toThrow(/line 1 is not an object/);
    expect(() => parseTopologyBriefs(patch({ system: '' }))).toThrow(/system on line 1/);
    expect(() => parseTopologyBriefs(patch({ digest: 'ZZZZ' }))).toThrow(/digest on line 1/);
    expect(() => parseTopologyBriefs(patch({ brief: 42 }))).toThrow(
      /brief on line 1 is not a string/,
    );
  });

  it('walks past a blank line rather than counting it as a record', () => {
    const line = formatTopologyBriefRecord(record());
    expect(parseTopologyBriefs(`\n${line}\n\n`)).toEqual([record()]);
  });
});

describe('readOneTopologyBrief', () => {
  function write(text: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'topology-'));
    const path = join(dir, 'topology.ndjson');
    writeFileSync(path, text);
    return path;
  }

  it('reads the one brief a corpus-level file holds', () => {
    const path = write(`${formatTopologyBriefRecord(record())}\n`);
    const read = readOneTopologyBrief(path);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.brief).toBe(RENDERED.text);
    expect(read.record.system).toBe('fse26');
  });

  it('names the flag when the file holds no brief at all', () => {
    const read = readOneTopologyBrief(write('\n'));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.why).toContain('--topology-brief');
    expect(read.why).toContain('holds no brief');
  });

  it('reports an unreadable or missing file as a refusal rather than throwing at the caller', () => {
    // The caller is a runner whose next step is a 25-minute corpus pass or a bill; an exception here would be a
    // stack trace instead of the sentence that says which artifact is wrong.
    const corrupt = write('not json\n');
    const readCorrupt = readOneTopologyBrief(corrupt);
    expect(readCorrupt.ok).toBe(false);
    if (readCorrupt.ok) return;
    expect(readCorrupt.why).toContain(corrupt);
    expect(readCorrupt.why).toContain('not JSON');

    const missing = readOneTopologyBrief(join(corrupt, 'nope.ndjson'));
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.why).toContain('nope.ndjson');
  });

  it('refuses two briefs rather than guessing which case belongs to which system', () => {
    // The corpus declares no per-case system, so a file with two of them cannot be attributed. Guessing would be
    // attaching a topology to a case by name — the leak the whole instrument is built to make impossible.
    const path = write(
      `${formatTopologyBriefRecord(record({ system: 'a' }))}\n` +
        `${formatTopologyBriefRecord(record({ system: 'b' }))}\n`,
    );
    const read = readOneTopologyBrief(path);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.why).toContain('2 briefs');
    expect(read.why).toContain('per-case system');
  });
});

describe('TopologyBriefDump', () => {
  it('truncates on construction, so a second dispatch into one path cannot read as one run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'topology-dump-'));
    const path = join(dir, 'topology.ndjson');
    writeFileSync(path, 'stale\n');
    const dump = new TopologyBriefDump(path);
    dump.record(record());
    expect(readFileSync(path, 'utf8')).not.toContain('stale');
    expect(dump.summary.records).toBe(1);
    expect(dump.summary.chars).toBe(RENDERED.text.length);
    expect(dump.summary.path).toBe(path);
  });
});
