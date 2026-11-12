import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FingerprintDump,
  formatFingerprintRecord,
  parseFingerprintDump,
  readFingerprintFile,
  type FingerprintRecord,
} from '../src/agentic-fingerprint-file.js';

const CENSUS = {
  considered: 6,
  offered: 4,
  unmeasurable: 1,
  unprofiled: 1,
  shadowed: 0,
  capped: 0,
};

/** One record with a channel that fired and one that did not, so both `onset` shapes are exercised. */
function record(overrides: Partial<FingerprintRecord> = {}): FingerprintRecord {
  return {
    datapack: 'ts0-example-1',
    faultType: 'stress',
    injectTimeMs: 1_000_000,
    candidates: [
      {
        service: 'svc-a',
        rank: 0,
        score: 1.25,
        channels: [
          { label: 'cpu', pre: 0.2, post: 0.9, band: [0.05, 0.35], rate: 0, onset: 3000 },
          { label: 'mem', pre: 0.1, post: 0.11, band: [0.05, 0.15], rate: 0.25 },
        ],
      },
    ],
    census: CENSUS,
    ...overrides,
  };
}

/** A temporary directory per test, so two dumps cannot collide. */
function tempPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'fingerprint-')), name);
}

describe('formatFingerprintRecord', () => {
  it('writes the keys in a fixed order, with `onset` absent rather than null', () => {
    const text = formatFingerprintRecord(record());
    expect(
      text.startsWith('{"datapack":"ts0-example-1","faultType":"stress","injectTimeMs":1000000'),
    ).toBe(true);
    expect(text).toContain(
      '{"label":"cpu","pre":0.2,"post":0.9,"band":[0.05,0.35],"rate":0,"onset":3000}',
    );
    // The quiet channel carries no `onset` key at all: `null` would read as a value the reader has to interpret.
    expect(text).toContain('{"label":"mem","pre":0.1,"post":0.11,"band":[0.05,0.15],"rate":0.25}');
    expect(text).not.toContain('null');
  });

  it('round-trips through the reader unchanged', () => {
    const text = formatFingerprintRecord(record());
    expect(parseFingerprintDump(`${text}\n`)).toEqual([record()]);
  });
});

describe('FingerprintDump', () => {
  it('truncates on construction, so a second dispatch into one path is not one longer run', () => {
    const path = tempPath('dump.ndjson');
    writeFileSync(path, 'stale\n');
    const dump = new FingerprintDump(path);
    expect(readFileSync(path, 'utf8')).toBe('');
    dump.record(record());
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('sums the census over cases and counts candidates and channels', () => {
    const dump = new FingerprintDump(tempPath('dump.ndjson'));
    dump.record(record());
    dump.record(record({ datapack: 'ts0-example-2' }));
    const summary = dump.summary;
    expect(summary).toMatchObject({ cases: 2, candidates: 2, channels: 4 });
    expect(summary.census).toEqual({
      considered: 12,
      offered: 8,
      unmeasurable: 2,
      unprofiled: 2,
      shadowed: 0,
      capped: 0,
    });
  });

  it('reads back from disk what it wrote', () => {
    const path = tempPath('dump.ndjson');
    const dump = new FingerprintDump(path);
    dump.record(record());
    expect(readFingerprintFile(path)).toEqual([record()]);
  });
});

describe('parseFingerprintDump', () => {
  const good = formatFingerprintRecord(record());

  it('skips blank lines, so a file that ends with a newline is not an error', () => {
    expect(parseFingerprintDump(`\n${good}\n\n`)).toHaveLength(1);
  });

  it('refuses a line that is not JSON', () => {
    expect(() => parseFingerprintDump('{oops}\n')).toThrow(/line 1 is not JSON/);
  });

  it('refuses a line that is not an object', () => {
    // A JSON array passes `typeof === 'object'`, so the case that reaches this refusal is a scalar.
    expect(() => parseFingerprintDump('4\n')).toThrow(/line 1 is not an object/);
  });

  it('refuses a record with no datapack, and names the line', () => {
    expect(() =>
      parseFingerprintDump(`${JSON.stringify({ ...record(), datapack: '' })}\n`),
    ).toThrow(/datapack on line 1/);
  });

  it('refuses a record whose faultType is missing', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    delete raw.faultType;
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(/faultType on line 1/);
  });

  it('refuses a candidates field that is not an array', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    raw.candidates = {};
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(/candidates on line 1/);
  });

  it('refuses a non-finite injection time', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    raw.injectTimeMs = 'soon';
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /injectTimeMs on line 1 is not a finite number/,
    );
  });

  it('refuses a band that `JSON` rendered as null, which is what a non-finite bound becomes', () => {
    const raw = JSON.parse(good) as {
      candidates: Array<{ channels: Array<Record<string, unknown>> }>;
    };
    raw.candidates[0]!.channels[0]!.band = [null, 0.35];
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /channel band\[0\] on line 1 is not a finite number/,
    );
  });

  it('refuses a band that is not a pair', () => {
    const raw = JSON.parse(good) as {
      candidates: Array<{ channels: Array<Record<string, unknown>> }>;
    };
    raw.candidates[0]!.channels[0]!.band = [0.05];
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /band on line 1 is not a pair/,
    );
  });

  it('refuses a rate outside [0, 1]', () => {
    const raw = JSON.parse(good) as {
      candidates: Array<{ channels: Array<Record<string, unknown>> }>;
    };
    raw.candidates[0]!.channels[0]!.rate = 1.5;
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /rate on line 1 is outside/,
    );
  });

  it('refuses a negative rank', () => {
    const raw = JSON.parse(good) as { candidates: Array<Record<string, unknown>> };
    raw.candidates[0]!.rank = -1;
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /candidate rank on line 1 is not a non-negative integer/,
    );
  });

  it('refuses a candidate with no service', () => {
    const raw = JSON.parse(good) as { candidates: Array<Record<string, unknown>> };
    raw.candidates[0]!.service = '';
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /candidate service on line 1 is not a non-empty string/,
    );
  });

  it('refuses a channel label that is empty', () => {
    const raw = JSON.parse(good) as {
      candidates: Array<{ channels: Array<Record<string, unknown>> }>;
    };
    raw.candidates[0]!.channels[0]!.label = '';
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /channel label on line 1 is not a non-empty string/,
    );
  });

  it('refuses a census that is missing a counter, so a new counter cannot arrive unread', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    const census = { ...CENSUS } as Record<string, unknown>;
    delete census.capped;
    raw.census = census;
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /census.capped on line 1 is not a non-negative integer/,
    );
  });

  it('refuses a candidate that is not an object', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    raw.candidates = ['svc-a'];
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /candidate on line 1 is not an object/,
    );
  });

  it('refuses a channel that is not an object', () => {
    const raw = JSON.parse(good) as { candidates: Array<Record<string, unknown>> };
    raw.candidates[0]!.channels = [1];
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /channel on line 1 is not an object/,
    );
  });

  it('refuses a candidate whose channels field is not an array', () => {
    const raw = JSON.parse(good) as { candidates: Array<Record<string, unknown>> };
    raw.candidates[0]!.channels = 'cpu';
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /candidate channels on line 1 is not an array/,
    );
  });

  it('refuses a census that is not an object', () => {
    const raw = JSON.parse(good) as Record<string, unknown>;
    raw.census = 4;
    expect(() => parseFingerprintDump(`${JSON.stringify(raw)}\n`)).toThrow(
      /census on line 1 is not an object/,
    );
  });
});
