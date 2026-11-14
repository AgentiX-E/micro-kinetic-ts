import { describe, expect, it } from 'vitest';

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ELIMINATOR_PROTOCOL, buildEliminatorPrompt } from '../../packages/ai/src/agent/index.js';
import { formatClaimRecord, parseClaimRecords } from '../src/agentic-claims.js';
import { parseEliminatorArgs, runStudy } from '../src/agentic-eliminator-study.js';
import { formatFingerprintRecord } from '../src/agentic-fingerprint-file.js';
import { digestsOf } from '../src/agentic-proposer.js';
import { formatPerCaseVerdict } from '../src/fse26-per-case.js';

describe('parseEliminatorArgs', () => {
  it('reads the two required artifacts and the defaults a study runs under', () => {
    expect(parseEliminatorArgs(['--fingerprints', 'f.ndjson', '--verdicts', 'v.ndjson'])).toEqual({
      fingerprints: 'f.ndjson',
      verdicts: 'v.ndjson',
      claims: '',
      propose: false,
      weight: 1,
      model: 'deepseek-chat',
      concurrency: 4,
      limit: 0,
      maxCandidates: 5,
      delta: 0.05,
    });
  });

  it('reads every optional flag', () => {
    const parsed = parseEliminatorArgs([
      '--fingerprints',
      'f',
      '--verdicts',
      'v',
      '--claims',
      'c',
      '--propose',
      '--model',
      'deepseek-reasoner',
      '--weight',
      '0.5',
      '--concurrency',
      '8',
      '--limit',
      '40',
      '--max-candidates',
      '20',
      '--delta',
      '0.01',
    ]);
    expect(parsed).toMatchObject({
      claims: 'c',
      propose: true,
      model: 'deepseek-reasoner',
      weight: 0.5,
      concurrency: 8,
      limit: 40,
      maxCandidates: 20,
      delta: 0.01,
    });
  });

  it('refuses a study that cannot be run, by name', () => {
    const base = ['--fingerprints', 'f', '--verdicts', 'v'];
    expect(() => parseEliminatorArgs([])).toThrow(
      '--fingerprints and --verdicts are both required',
    );
    expect(() => parseEliminatorArgs(['--fingerprints', 'f'])).toThrow('both required');
    expect(() => parseEliminatorArgs([...base, '--propose'])).toThrow('--propose needs --claims');
    expect(() => parseEliminatorArgs([...base, '--weight', '1.5'])).toThrow(
      '--weight must be inside [0, 1]',
    );
    expect(() => parseEliminatorArgs([...base, '--max-candidates', '1'])).toThrow('at least 2');
    expect(() => parseEliminatorArgs([...base, '--max-candidates', '2.5'])).toThrow('at least 2');
    expect(() => parseEliminatorArgs([...base, '--limit', '-1'])).toThrow(
      '--limit must be 0 or a count',
    );
    expect(() => parseEliminatorArgs([...base, '--concurrency', '0'])).toThrow('positive integer');
    expect(() => parseEliminatorArgs([...base, '--delta', '1'])).toThrow('strictly inside (0, 1)');
    expect(() => parseEliminatorArgs([...base, '--delta', '0'])).toThrow('strictly inside (0, 1)');
    expect(() => parseEliminatorArgs([...base, '--weight'])).toThrow('--weight needs a value');
    expect(() => parseEliminatorArgs([...base, '--nonsense', '1'])).toThrow(
      'unrecognised argument --nonsense',
    );
  });
});

describe('runStudy', () => {
  /** Write one study's two artifacts to a temporary directory and return their paths. */
  function artifacts(
    rows: readonly { datapack: string; faultType: string; accepted: string[]; ranked: string[] }[],
  ): { fingerprints: string; verdicts: string; dir: string; digests: Map<string, string> } {
    const dir = mkdtempSync(join(tmpdir(), 'eliminator-'));
    const fingerprints = join(dir, 'fingerprints.ndjson');
    const verdicts = join(dir, 'per-case.ndjson');
    writeFileSync(
      fingerprints,
      rows
        .map((row) =>
          formatFingerprintRecord({
            datapack: row.datapack,
            faultType: row.faultType,
            injectTimeMs: 1_700_000_000_000,
            candidates: row.ranked.map((service, rank) => ({
              service,
              rank,
              score: 2 - rank,
              channels: [
                {
                  label: 'latency_p99',
                  pre: 11,
                  post: 90 - rank * 10,
                  band: [11, 14.2],
                  rate: 0,
                  onset: 4000,
                },
              ],
            })),
            census: {
              considered: row.ranked.length,
              offered: row.ranked.length,
              unmeasurable: 0,
              unprofiled: 0,
              shadowed: 0,
              capped: 0,
            },
          }),
        )
        .join('\n') + '\n',
    );
    writeFileSync(
      verdicts,
      rows
        .map((row) =>
          formatPerCaseVerdict({
            datapack: row.datapack,
            faultType: row.faultType,
            accepted: row.accepted,
            ranked: row.ranked,
          }),
        )
        .join('\n') + '\n',
    );
    return { fingerprints, verdicts, dir, digests: digestsOf(casesOf(rows)) };
  }

  /** The join's own view of the fixtures, which is what the prompts are built from. */
  function casesOf(
    rows: readonly { datapack: string; faultType: string; accepted: string[]; ranked: string[] }[],
  ) {
    return rows.map((row) => ({
      datapack: row.datapack,
      faultType: row.faultType,
      accepted: row.accepted,
      candidates: row.ranked.map((service, rank) => ({
        service,
        rank,
        score: 2 - rank,
        channels: [
          {
            label: 'latency_p99',
            pre: 11,
            post: 90 - rank * 10,
            band: [11, 14.2] as [number, number],
            rate: 0,
            onset: 4000,
          },
        ],
      })),
    }));
  }

  const ROWS = [
    // Two cases the engine gets right and one it does not, over two families.
    { datapack: 'a', faultType: 'NetworkLoss', accepted: ['svc-a'], ranked: ['svc-a', 'svc-b'] },
    { datapack: 'b', faultType: 'NetworkLoss', accepted: ['svc-a'], ranked: ['svc-a', 'svc-b'] },
    { datapack: 'c', faultType: 'PodKill', accepted: ['svc-a'], ranked: ['svc-b', 'svc-a'] },
  ];

  it('prints the four-arm table over a real pair of artifacts', async () => {
    const files = artifacts(ROWS);
    const lines: string[] = [];
    await runStudy(['--fingerprints', files.fingerprints, '--verdicts', files.verdicts], (line) =>
      lines.push(line),
    );
    const text = lines.join('\n');
    expect(text).toContain('Paired:       3 cases');
    expect(text).toContain('3 cases · weight=1 · presentation=5');
    for (const arm of ['engine', 'oracle', 'evidence']) expect(text).toContain(arm);
    // The control's own reading: two of three cases, which the arm table states as a rate beside the count.
    expect(text).toMatch(/engine\s+0\.00\s+3\s+66\.7%/);
    // The oracle can reach the one case whose truth the posterior holds, so it answers all three.
    expect(text).toMatch(/oracle\s+\+\s+1 cases · ceiling, not a method/);
    expect(text).toContain(
      'recorded  not scored — no answer in the claims file belongs to this prompt',
    );
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('prices an arm the corpus can certify, and refuses to price one it cannot', async () => {
    const files = artifacts(ROWS);
    const lines: string[] = [];
    await runStudy(['--fingerprints', files.fingerprints, '--verdicts', files.verdicts], (line) =>
      lines.push(line),
    );
    // The evidence rule proposes nothing here, so it is the control's equal and its budget is the corpus floor.
    const evidence = lines.find((line) => line.startsWith('  evidence'));
    expect(evidence).toBeDefined();
    expect(evidence).toMatch(/\+   0 cases · budget +\d+ · worst /);
  });

  it('scores a recorded answer when one is in the claims file, and prices it', async () => {
    const files = artifacts(ROWS);
    const claimsPath = join(files.dir, 'claims.ndjson');
    const cases = [
      {
        datapack: 'c',
        faultType: 'PodKill',
        accepted: ['svc-a'],
        candidates: [
          {
            service: 'svc-b',
            rank: 0,
            score: 2,
            channels: [
              {
                label: 'latency_p99',
                pre: 11,
                post: 90,
                band: [11, 14.2] as [number, number],
                rate: 0,
                onset: 4000,
              },
            ],
          },
          {
            service: 'svc-a',
            rank: 1,
            score: 1,
            channels: [
              {
                label: 'latency_p99',
                pre: 11,
                post: 80,
                band: [11, 14.2] as [number, number],
                rate: 0,
                onset: 4000,
              },
            ],
          },
        ],
      },
    ];
    const digest = buildEliminatorPrompt('PodKill', cases[0]!.candidates).digest;
    writeFileSync(
      claimsPath,
      `${formatClaimRecord({
        datapack: 'c',
        model: 'deepseek-chat',
        protocol: ELIMINATOR_PROTOCOL,
        digest,
        claims: [
          {
            remove: 'svc-b',
            keep: 'svc-a',
            because: {
              channel: 'latency_p99',
              statistic: 'post',
              observed: 90,
              band: [11, 14.2],
              rate: 0,
            },
          },
        ],
        ms: 700,
        promptTokens: 900,
        completionTokens: 40,
      })}\n`,
    );

    const lines: string[] = [];
    await runStudy(
      ['--fingerprints', files.fingerprints, '--verdicts', files.verdicts, '--claims', claimsPath],
      (line) => lines.push(line),
    );
    const text = lines.join('\n');
    expect(text).toContain('Replay:       1 of 3 cases carry an answer to this prompt');
    expect(text).toContain('recorded');
    // Removing the leader promotes the truth on the only case the engine had wrong.
    expect(text).toMatch(/recorded\s+\+\s+1 cases/);
    // The nulls read the same artifact the arm was scored from, and they say the claims were not guessing:
    // `svc-a` is the kept service and it is the truth, against one truth in two candidates for the null.
    expect(text).toContain(
      'Was it reading the case? Two nulls, both computed from the same artifact:',
    );
    expect(text).toMatch(
      /uniform\s+1 of 1 claims keep a true service \(100\.0 %\) against 1 expected/,
    );
    expect(text).toMatch(/constant\s+promoting rank 1 on every case scores 1 of 3/);
    expect(text).toMatch(/and 1 are exactly remove rank 0 \/ keep rank 1/);
  });

  it('reports a claim naming a service the engine never presented, whether or not any claim scores', async () => {
    // The one shape where the nulls have nothing to say and the reason is the finding: a file whose every claim
    // names a stranger. Dropping it quietly would let a replay report perfect precision over zero claims.
    const files = artifacts(ROWS);
    const claimsPath = join(files.dir, 'claims.ndjson');
    const first = casesOf(ROWS)[0]!;
    const digest = buildEliminatorPrompt('NetworkLoss', first.candidates).digest;
    writeFileSync(
      claimsPath,
      `${formatClaimRecord({
        datapack: 'a',
        model: 'deepseek-chat',
        protocol: ELIMINATOR_PROTOCOL,
        digest,
        claims: [
          {
            remove: 'svc-a',
            keep: 'ghost',
            because: {
              channel: 'latency_p99',
              statistic: 'post',
              observed: 90,
              band: [11, 14.2],
              rate: 0,
            },
          },
        ],
        ms: 700,
        promptTokens: 900,
        completionTokens: 40,
      })}\n`,
    );

    const lines: string[] = [];
    await runStudy(
      ['--fingerprints', files.fingerprints, '--verdicts', files.verdicts, '--claims', claimsPath],
      (line) => lines.push(line),
    );
    const text = lines.join('\n');
    expect(text).toContain('outside   1 claims named a service the engine did not present');
    expect(text).not.toContain('uniform');
  });

  it('refuses to score two artifacts that disagree about a case ordering', async () => {
    const files = artifacts(ROWS);
    const mismatched = join(files.dir, 'other.ndjson');
    writeFileSync(
      mismatched,
      `${formatPerCaseVerdict({ datapack: 'a', faultType: 'NetworkLoss', accepted: ['svc-a'], ranked: ['svc-b', 'svc-a'] })}\n`,
    );
    const lines: string[] = [];
    const before = process.exitCode;
    await runStudy(['--fingerprints', files.fingerprints, '--verdicts', mismatched], (line) =>
      lines.push(line),
    );
    expect(lines.join('\n')).toContain('DISAGREEMENTS: 1');
    expect(process.exitCode).toBe(1);
    process.exitCode = before;
  });

  it('reports a missing client as a reason rather than as a crash, and fails the study', async () => {
    const files = artifacts(ROWS);
    const lines: string[] = [];
    const before = process.exitCode;
    await runStudy(
      [
        '--fingerprints',
        files.fingerprints,
        '--verdicts',
        files.verdicts,
        '--claims',
        join(files.dir, 'claims.ndjson'),
        '--propose',
      ],
      (line) => lines.push(line),
      { client: null },
    );
    expect(lines.join('\n')).toContain('MODEL ARM NOT MEASURED: this run supplied no client');
    expect(process.exitCode).toBe(1);
    process.exitCode = before;
  });

  it('proposes, writes the answers and scores them in one run', async () => {
    // The whole paid path over real files, with the transport replaced by a client that answers from a table: what
    // is under test is that an answer becomes a claim on disk and a row in the table, which is the chain iterations
    // 267 to 281 were missing from end to end.
    const files = artifacts(ROWS);
    const claimsPath = join(files.dir, 'claims.ndjson');
    const client = {
      model: 'deepseek-chat',
      endpoint: 'http://127.0.0.1:1/v1/chat/completions',
      complete: async (turn: { user: string }) => ({
        text: JSON.stringify({
          eliminate: [
            {
              remove: 'svc-b',
              keep: 'svc-a',
              channel: 'latency_p99',
              statistic: 'post',
              observed: Number(/\| latency_p99 \| 11 \| ([0-9.]+) \|/.exec(turn.user)?.[1]),
              band: [11, 14.2],
              rate: 0,
            },
          ],
        }),
        model: 'deepseek-chat',
        promptTokens: 700,
        completionTokens: 45,
        attempts: 1,
      }),
    };
    const lines: string[] = [];
    const before = process.exitCode;
    await runStudy(
      [
        '--fingerprints',
        files.fingerprints,
        '--verdicts',
        files.verdicts,
        '--claims',
        claimsPath,
        '--propose',
      ],
      (line) => lines.push(line),
      { client },
    );
    process.exitCode = before;
    const text = lines.join('\n');
    expect(text).toContain('Proposal: asked 3, reused 0, answered 3, declined 0, unreadable 0');
    expect(text).toContain('3 claims · 2100 prompt + 135 completion tokens');
    expect(text).toContain('Replay:       3 of 3 cases carry an answer to this prompt');
    expect(text).toMatch(/recorded\s+\+\s+1 cases · budget/);
    // The file on disk is the artifact a later run re-reads: one line per case, each with its own digest.
    const written = readFileSync(claimsPath, 'utf8').trim().split('\n');
    expect(written).toHaveLength(3);
    expect(parseClaimRecords(written.join('\n')).map((record) => record.datapack)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('prints every refusal the replay made, each by name', async () => {
    // Four ways an answer can belong to a different question, all in one file: a stale prompt digest, another
    // protocol version, a case the population does not hold, and a reply that could not be read. A replay that
    // pooled them would report one number for four different mistakes.
    const files = artifacts(ROWS);
    const claimsPath = join(files.dir, 'claims.ndjson');
    const good = {
      datapack: 'a',
      model: 'deepseek-chat',
      protocol: ELIMINATOR_PROTOCOL,
      digest: '0'.repeat(16),
      claims: [],
      ms: 1,
      promptTokens: 1,
      completionTokens: 1,
    };
    writeFileSync(
      claimsPath,
      [
        formatClaimRecord(good),
        formatClaimRecord({ ...good, datapack: 'b', digest: '1'.repeat(16), protocol: 99 }),
        formatClaimRecord({ ...good, datapack: 'gone' }),
        formatClaimRecord({
          ...good,
          datapack: 'c',
          digest: files.digests.get('c')!,
          malformed: 'the reply is not JSON',
        }),
      ].join('\n') + '\n',
    );
    const lines: string[] = [];
    await runStudy(
      ['--fingerprints', files.fingerprints, '--verdicts', files.verdicts, '--claims', claimsPath],
      (line) => lines.push(line),
    );
    const text = lines.join('\n');
    expect(text).toContain(
      'Replay:       1 of 3 cases carry an answer to this prompt — refused: 1 stale, ' +
        '1 from another protocol, 1 not in this population, 1 unreadable',
    );
    expect(text).toContain('  STALE a');
    expect(text).toContain('  UNKNOWN gone');
  });

  it('resumes a claims file instead of paying for the same answers twice', async () => {
    const files = artifacts(ROWS);
    const claimsPath = join(files.dir, 'claims.ndjson');
    const client = {
      model: 'deepseek-chat',
      endpoint: 'http://127.0.0.1:1/v1/chat/completions',
      complete: async () => ({
        text: '{"eliminate":[]}',
        model: 'deepseek-chat',
        promptTokens: 500,
        completionTokens: 4,
        attempts: 1,
      }),
    };
    const first: string[] = [];
    await runStudy(
      [
        '--fingerprints',
        files.fingerprints,
        '--verdicts',
        files.verdicts,
        '--claims',
        claimsPath,
        '--propose',
      ],
      (line) => first.push(line),
      { client },
    );
    expect(first.join('\n')).toContain('Proposal: asked 3, reused 0, answered 0, declined 3');

    const second: string[] = [];
    await runStudy(
      [
        '--fingerprints',
        files.fingerprints,
        '--verdicts',
        files.verdicts,
        '--claims',
        claimsPath,
        '--propose',
      ],
      (line) => second.push(line),
      { client },
    );
    // The same file, read back: nothing is asked again, and the answers already paid for are scored.
    expect(second.join('\n')).toContain('Proposal: asked 0, reused 3, answered 0, declined 0');
    expect(readFileSync(claimsPath, 'utf8').trim().split('\n')).toHaveLength(3);
  });

  it('reports an unreadable reply beside the cases it could not read', async () => {
    const files = artifacts(ROWS);
    const client = {
      model: 'deepseek-chat',
      endpoint: 'http://127.0.0.1:1/v1/chat/completions',
      complete: async (_turn: { user: string }, index?: number) => {
        void index;
        return {
          text: 'The source is svc-a.',
          model: 'deepseek-chat',
          promptTokens: 500,
          completionTokens: 4,
          attempts: 1,
        };
      },
    };
    const lines: string[] = [];
    await runStudy(
      [
        '--fingerprints',
        files.fingerprints,
        '--verdicts',
        files.verdicts,
        '--claims',
        join(files.dir, 'claims.ndjson'),
        '--propose',
      ],
      (line) => lines.push(line),
      { client },
    );
    const text = lines.join('\n');
    expect(text).toContain('unreadable 3');
    expect(text).toMatch(/UNREADABLE \S+: the reply is not JSON/);
  });

  it('states no budget for an arm that throws away answers it already had', async () => {
    // A recorded arm that removes the true answer everywhere loses the whole of a family, and no budget the corpus
    // can express certifies that: the ceiling of the bisection is checked, and the row says `none` rather than the
    // corpus's own size.
    const files = artifacts([
      { datapack: 'a', faultType: 'NetworkLoss', accepted: ['svc-a'], ranked: ['svc-a', 'svc-b'] },
      { datapack: 'b', faultType: 'NetworkLoss', accepted: ['svc-a'], ranked: ['svc-a', 'svc-b'] },
    ]);
    const claimsPath = join(files.dir, 'claims.ndjson');
    const cases = [
      {
        datapack: 'a',
        faultType: 'NetworkLoss',
        candidates: [
          {
            service: 'svc-a',
            rank: 0,
            score: 2,
            channels: [
              {
                label: 'latency_p99',
                pre: 11,
                post: 90,
                band: [11, 14.2] as [number, number],
                rate: 0,
                onset: 4000,
              },
            ],
          },
          {
            service: 'svc-b',
            rank: 1,
            score: 1,
            channels: [
              {
                label: 'latency_p99',
                pre: 11,
                post: 80,
                band: [11, 14.2] as [number, number],
                rate: 0,
                onset: 4000,
              },
            ],
          },
        ],
      },
    ];
    const digest = buildEliminatorPrompt('NetworkLoss', cases[0]!.candidates).digest;
    const dump = ['a', 'b'].map((datapack) =>
      formatClaimRecord({
        datapack,
        model: 'deepseek-chat',
        protocol: ELIMINATOR_PROTOCOL,
        digest,
        claims: [
          {
            remove: 'svc-a',
            keep: 'svc-b',
            because: {
              channel: 'latency_p99',
              statistic: 'post',
              observed: 90,
              band: [11, 14.2],
              rate: 0,
            },
          },
        ],
        ms: 1,
        promptTokens: 1,
        completionTokens: 1,
      }),
    );
    writeFileSync(claimsPath, dump.join('\n') + '\n');
    const lines: string[] = [];
    await runStudy(
      ['--fingerprints', files.fingerprints, '--verdicts', files.verdicts, '--claims', claimsPath],
      (line) => lines.push(line),
    );
    const text = lines.join('\n');
    // Two cases, one family, both lost: no rate below one is consistent with that, so the row states `none` and
    // names the refusal rather than printing the corpus's own size as a budget.
    expect(text).toMatch(/recorded\s+-2 cases · budget none · worst unprovable/);
  });

  it('reads the client from the environment when a caller supplies none, and reports what is missing', async () => {
    // The one path a test must take carefully: with a real key in the environment this would make a paid call, so
    // the variable is removed for the length of the assertion and put back. What is under test is that the study
    // NAMES the missing variable rather than failing somewhere inside a client that was never built.
    const saved = process.env['DEEPSEEK_API_KEY'];
    delete process.env['DEEPSEEK_API_KEY'];
    const before = process.exitCode;
    try {
      const files = artifacts(ROWS);
      const lines: string[] = [];
      await runStudy(
        [
          '--fingerprints',
          files.fingerprints,
          '--verdicts',
          files.verdicts,
          '--claims',
          join(files.dir, 'claims.ndjson'),
          '--propose',
        ],
        (line) => lines.push(line),
      );
      expect(lines.join('\n')).toContain(
        'MODEL ARM NOT MEASURED: DEEPSEEK_API_KEY is not set, so the model arm was not measured',
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = before;
      if (saved === undefined) delete process.env['DEEPSEEK_API_KEY'];
      else process.env['DEEPSEEK_API_KEY'] = saved;
    }
  });

  it('orders the scope by id, not by the order the artifacts were written in', async () => {
    // The limitation is a statement about WHICH cases: two runs naming the same `n` have to score the same ones,
    // whatever order the dumper happened to write them in.
    // Two cases written in the wrong order, so the comparator is handed the pair the other way round and has to
    // answer "descending" rather than falling through to the id comparison's first arm.
    const descending = [ROWS[1]!, ROWS[0]!];
    const shuffled = artifacts(descending);
    const lines: string[] = [];
    await runStudy(
      ['--fingerprints', shuffled.fingerprints, '--verdicts', shuffled.verdicts, '--limit', '2'],
      (line) => lines.push(line),
    );
    expect(lines.join('\n')).toContain(
      'SCOPE:        first 2 ids (not comparable with the corpus)',
    );
    // The two kept cases are a and b, the smallest two ids, so the engine answers both.
    expect(lines.join('\n')).toMatch(/engine\s+0\.00\s+2\s+100\.0%/);
  });

  it('scopes the population to the first ids when a limit is given, and says so', async () => {
    const files = artifacts(ROWS);
    const lines: string[] = [];
    await runStudy(
      ['--fingerprints', files.fingerprints, '--verdicts', files.verdicts, '--limit', '2'],
      (line) => lines.push(line),
    );
    const text = lines.join('\n');
    expect(text).toContain('SCOPE:        first 2 ids (not comparable with the corpus)');
    expect(text).toContain('2 cases · weight=1');
  });
});
