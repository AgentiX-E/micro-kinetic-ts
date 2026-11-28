/**
 * Re-score the mechanical verifier's acceptance ledger against a supplied claims + fingerprint artifact pair.
 *
 * ## Usage
 *
 * ```bash
 * pnpm exec tsx benchmarks/src/run-verifier-replay-census.ts \
 *   --claims <claims.ndjson> --fingerprints <fingerprints.ndjson> [--out <report.json>]
 * ```
 *
 * The two inputs are the same pair a benchmark run writes. `claims.ndjson` carries each model claim with the case
 * (`datapack`) it was asked about; `fingerprints.ndjson` carries the posterior that case was scored against. The
 * runner joins them on `datapack`, pairs every claim with its posterior, and feeds the rows to the pure
 * {@link replayVerdicts}. The join deliberately uses the case id rather than `replayOf`'s digest check: the digest
 * is a property of the prompt template, which a bare artifact does not carry, and the verifier compares a claim to
 * a fingerprint's numbers, not to the prompt that solicited it.
 *
 * It prints the survival count and the per-family refusal decomposition, then compares them with the figures
 * `agentic-fusion.md` and `PROGRESS_2026-11-14a.md` recorded, so the reader can see whether the document still
 * matches the artifact. `run-*.ts` calls `main()` at import time and is outside the coverage allow-list, like every
 * other runner here; the census it calls is the measured module.
 *
 * @module benchmarks/run-verifier-replay-census
 */

import { createHash as hash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { parseClaimRecords } from './agentic-claims.js';
import { readFingerprintFile } from './agentic-fingerprint-file.js';
import { replayVerdicts, type ReplayRow, type VerdictCensus } from './verifier-replay-census.js';

interface Args {
  readonly claims: string;
  readonly fingerprints: string;
  readonly out?: string;
}

/** The figures the docs recorded, copied verbatim as the comparison baseline. */
const DOC = {
  claims: 5335,
  verified: 3321,
  refused: 2014,
  // iteration 284 split the old `unknown-channel = 1 774` into these two families.
  unknownChannelSplit: { 'unknown-channel': 1000, 'channel-not-observed-on-both': 774 },
} as const;

function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[i + 1] ?? '');
  }
  const claims = map.get('claims') ?? '';
  const fingerprints = map.get('fingerprints') ?? '';
  if (claims === '') throw new Error('--claims <claims.ndjson> is required');
  if (fingerprints === '') throw new Error('--fingerprints <fingerprints.ndjson> is required');
  return { claims, fingerprints, out: map.get('out') || undefined };
}

function digestOf(path: string): string {
  return hash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

interface Replay {
  readonly rows: readonly ReplayRow[];
  readonly unpaired: number;
  readonly malformed: number;
}

function loadReplay(claimsPath: string, fingerprintsPath: string): Replay {
  const records = parseClaimRecords(readFileSync(claimsPath, 'utf8'));
  const fingerprints = readFingerprintFile(fingerprintsPath);
  const byPack = new Map(fingerprints.map((f) => [f.datapack, f.candidates]));
  const rows: ReplayRow[] = [];
  let unpaired = 0;
  let malformed = 0;
  for (const record of records) {
    if (record.malformed !== undefined) malformed += 1;
    const candidates = byPack.get(record.datapack);
    if (candidates === undefined) {
      unpaired += 1;
      continue;
    }
    for (const claim of record.claims) rows.push({ claim, candidates });
  }
  return { rows, unpaired, malformed };
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0.0' : ((100 * part) / whole).toFixed(1);
}

function report(
  census: VerdictCensus,
  replay: Replay,
  claimsPath: string,
  fingerprintsPath: string,
): readonly string[] {
  const split = DOC.unknownChannelSplit;
  return [
    'Micro-Kinetic — verifier replay census',
    '═'.repeat(74),
    `Claims:      ${claimsPath}`,
    `Fingerprints:${fingerprintsPath}`,
    `Paired rows: ${census.claims} (unpaired ${replay.unpaired}, malformed ${replay.malformed})`,
    '',
    "Replay of verifyClaim over the model's real claims",
    `  claims scored   ${census.claims}`,
    `  verified        ${census.verified} (${pct(census.verified, census.claims)} %)`,
    `  refused         ${census.refused} (${pct(census.refused, census.claims)} %)`,
    '  refusals by family:',
    ...Object.entries(census.refusals)
      .filter(([, n]) => n > 0)
      .map(
        ([reason, n]) =>
          `    ${reason.padEnd(38)} ${String(n).padStart(5)}  ${pct(n, census.claims)} %`,
      ),
    '',
    'Document baseline (agentic-fusion.md / PROGRESS_2026-11-14a.md)',
    `  claims ${DOC.claims} · verified ${DOC.verified} · refused ${DOC.refused}`,
    `  unknown-channel split: ${split['unknown-channel']} + ${split['channel-not-observed-on-both']} = ` +
      `${split['unknown-channel'] + split['channel-not-observed-on-both']}`,
    '',
    `MATCH: claims ${census.claims === DOC.claims} · verified ${census.verified === DOC.verified} · ` +
      `refused ${census.refused === DOC.refused} · ` +
      `unknown-channel split ${census.refusals['unknown-channel'] === split['unknown-channel'] && census.refusals['channel-not-observed-on-both'] === split['channel-not-observed-on-both']}`,
  ];
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const replay = loadReplay(args.claims, args.fingerprints);
  const census = replayVerdicts(replay.rows);
  const lines = report(census, replay, args.claims, args.fingerprints);
  console.log(lines.join('\n'));
  if (args.out !== undefined) {
    const payload = {
      digest: {
        claims: digestOf(args.claims),
        fingerprints: digestOf(args.fingerprints),
      },
      paired: census.claims,
      unpaired: replay.unpaired,
      malformed: replay.malformed,
      census,
      docBaseline: DOC,
    };
    writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`);
  }
}

main();
