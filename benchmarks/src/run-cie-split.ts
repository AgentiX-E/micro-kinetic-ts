/**
 * Re-price the CIE propagated-victim probe with a GENUINE internal/external channel split.
 *
 * §1.28.4 counted 103 of 204 misses as CIE's victim shape using the row's all-channel surprise as the "internal"
 * axis — a max that includes latency, the external channel. This runner joins the containment dump to the
 * fingerprint dump (which carries per-channel labels) and the per-case verdicts, and calls `readCieSplit` to count
 * the SAME misses under a disjoint split. The difference between the two columns is the contamination.
 *
 * Read-only: no re-ranking, no engine run, no model call, ¥0.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-cie-split.ts \
 *     --rows <containment.ndjson> --fingerprints <fingerprints.ndjson> --per-case <per-case.ndjson> \
 *     [--output <json>]
 *
 * @module benchmarks/run-cie-split
 */

import { writeFileSync } from 'node:fs';

import { readFingerprintFile } from './agentic-fingerprint-file.js';
import {
  cieSplitVerdict,
  readCieSplit,
  type CieCaseInput,
  type FingerprintChannel,
} from './cie-split-study.js';
import { readContainmentRows } from './containment-rows.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** Exit code for "the three files are not one run, so nothing was measured". */
const EXIT_UNMEASURED = 3;

interface Args {
  readonly rows: string;
  readonly fingerprints: string;
  readonly perCase: string;
  readonly output: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[i + 1] ?? '');
  }
  const rows = map.get('rows') ?? '';
  const fingerprints = map.get('fingerprints') ?? '';
  const perCase = map.get('per-case') ?? '';
  if (rows === '' || fingerprints === '' || perCase === '')
    throw new Error('--rows, --fingerprints and --per-case are all required');
  return { rows, fingerprints, perCase, output: map.get('output') || undefined };
}

/** Join the three artifacts by datapack into the study's input. */
function join(
  rows: ReturnType<typeof readContainmentRows>,
  fingerprints: ReturnType<typeof readFingerprintFile>,
  verdicts: ReturnType<typeof readPerCaseVerdicts>,
): { readonly input: CieCaseInput[]; readonly unjoined: number } {
  const acceptedBy = new Map(verdicts.map((v) => [v.datapack, v.accepted]));
  const fingerprintsBy = new Map(fingerprints.map((f) => [f.datapack, f]));
  const input: CieCaseInput[] = [];
  let unjoined = 0;
  for (const row of rows) {
    const accepted = acceptedBy.get(row.datapack);
    const fingerprint = fingerprintsBy.get(row.datapack);
    if (accepted === undefined || fingerprint === undefined || row.chain === undefined) {
      unjoined += 1;
      continue;
    }
    const channels: Record<string, readonly FingerprintChannel[]> = {};
    for (const candidate of fingerprint.candidates) {
      channels[candidate.service] = candidate.channels.map((c) => ({
        label: c.label,
        post: c.post,
        band: [c.band[0], c.band[1]] as const,
      }));
    }
    if (row.shippedTop1 === null) {
      unjoined += 1;
      continue;
    }
    input.push({
      datapack: row.datapack,
      winner: row.shippedTop1,
      accepted,
      external: row.chain.excursions,
      surprise: row.chain.surprises,
      channels,
    });
  }
  return { input, unjoined };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const rows = readContainmentRows(opts.rows);
  const fingerprints = readFingerprintFile(opts.fingerprints);
  const verdicts = readPerCaseVerdicts(opts.perCase);
  const { input, unjoined } = join(rows, fingerprints, verdicts);

  console.log('');
  console.log('═'.repeat(72));
  console.log('  CIE, corrected — the propagated-victim probe with disjoint channels');
  console.log('═'.repeat(72));
  console.log(
    `  rows=${rows.length} fingerprints=${fingerprints.length} verdicts=${verdicts.length} joined=${input.length} unjoined=${unjoined}`,
  );

  if (rows.length !== verdicts.length || rows.length !== fingerprints.length) {
    console.error(
      `  CIE-split: UNMEASURED — the three files have different case counts and are not one run (exit 3)`,
    );
    process.exitCode = EXIT_UNMEASURED;
    return;
  }

  const reading = readCieSplit(input);
  const g = reading.genuine;
  const c = reading.contaminated;
  console.log('─'.repeat(72));
  console.log(
    `  cases=${reading.cases}  hits=${reading.hits}  misses=${reading.misses}  scored=${reading.scored}`,
  );
  console.log(
    '  axis                 victim-shape  no-shape  unmeasured  truth>winner  winner>truth  tie',
  );
  console.log(
    `  genuine (disjoint)   ${String(g.victimShape).padStart(12)}  ${String(g.noShape).padStart(8)}  ${String(g.unmeasured).padStart(10)}  ${String(g.truthHigher).padStart(12)}  ${String(g.winnerHigher).padStart(12)}  ${String(g.tie).padStart(3)}`,
  );
  console.log(
    `  contaminated (all)   ${String(c.victimShape).padStart(12)}  ${String(c.noShape).padStart(8)}  ${String(c.unmeasured).padStart(10)}  ${String(c.truthHigher).padStart(12)}  ${String(c.winnerHigher).padStart(12)}  ${String(c.tie).padStart(3)}`,
  );
  console.log(`  measured disagreements between the two axes: ${reading.contamination}`);

  const { verdict, reason } = cieSplitVerdict(reading);
  console.log('─'.repeat(72));
  console.log(`  verdict ${verdict} — ${reason}`);
  if (verdict === 'unmeasured') {
    console.log('  (exit 3)');
    process.exitCode = EXIT_UNMEASURED;
  }
  console.log('═'.repeat(72));

  if (opts.output !== undefined) {
    writeFileSync(opts.output, JSON.stringify({ verdict, reason, unjoined, reading }, null, 2));
  }
}

main();
