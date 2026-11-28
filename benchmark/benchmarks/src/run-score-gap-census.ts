/**
 * Re-score `docs/rank-depth.md` §5's calibration curve against a supplied per-case artifact.
 *
 * ## Usage
 *
 * ```bash
 * pnpm exec tsx benchmarks/src/run-score-gap-census.ts \
 *   --cases <fse26-per-case.ndjson> [--out <report.json>]
 * ```
 *
 * The runner reads the artifact's own `top1Score`/`top2Score` columns — never a dump re-sorted by score — and
 * feeds them to the pure {@link buildCensus}. It prints the band histogram, the sub-0.02 truth-rank histogram,
 * the negative-gap count and the twin direction, then compares them with the figures §5 recorded against the
 * OLD engine (1 141 rank-1 answers) so the drift is an artifact-backed finding rather than an assertion.
 *
 * `run-*.ts` calls `main()` at import time and is deliberately outside the coverage allow-list, like every
 * other runner here; the census it calls is the measured module.
 *
 * @module benchmarks/run-score-gap-census
 */

import { createHash as hash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  STRATUM_GAP,
  buildCensus,
  twinDirection,
  type GapCensus,
  type ScoredGap,
} from './score-gap-census.js';

interface Args {
  readonly cases: string;
  readonly out?: string;
}

/** The §5 figures, copied verbatim as the comparison baseline — labelled by the engine that produced them. */
const DOC5 = {
  engineRank1: 1141,
  strataBelowGap: 103,
  strataTop1: 20,
  rank2: 9,
  rank3: 18,
  twin: 'rank3',
} as const;

function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[i + 1] ?? '');
  }
  const cases = map.get('cases') ?? '';
  if (cases === '') throw new Error('--cases <fse26-per-case.ndjson> is required');
  return { cases, out: map.get('out') || undefined };
}

/** One line of a per-case verdict file, narrowed to the columns the census needs. */
interface CaseLine {
  readonly datapack: string;
  readonly truthRank?: number;
  readonly top1Score?: number | null;
  readonly top2Score?: number | null;
}

function readRows(path: string): { rows: ScoredGap[]; missingScores: number; absent: number } {
  const rows: ScoredGap[] = [];
  let missingScores = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const c = JSON.parse(line) as CaseLine;
    if (typeof c.top1Score !== 'number' || typeof c.top2Score !== 'number') {
      missingScores += 1;
      continue;
    }
    rows.push({ top1Score: c.top1Score, top2Score: c.top2Score, truthRank: c.truthRank ?? 0 });
  }
  return { rows, missingScores, absent: rows.filter((r) => r.truthRank === 0).length };
}

function digestOf(path: string): string {
  return hash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

function format(
  census: GapCensus,
  twin: ReturnType<typeof twinDirection>,
  artifact: string,
): string {
  const lines: string[] = [];
  lines.push(`score-gap census — ${artifact}`);
  lines.push(`  cases: ${census.total}`);
  lines.push('');
  lines.push('  band                         cases   top1   accuracy');
  for (const b of census.bands) {
    lines.push(
      `  ${b.label.padEnd(27)}${String(b.cases).padStart(5)}${String(b.top1).padStart(7)}` +
        `  ${(b.accuracy * 100).toFixed(1).padStart(6)}%`,
    );
  }
  lines.push('');
  lines.push(`  negative-gap (permuted) rows: ${census.negativeGaps}`);
  const s = census.stratum;
  lines.push(
    `  stratum gap < ${STRATUM_GAP}: ${s.cases} cases, ${s.top1} top1 ` +
      `(${s.cases === 0 ? '0.0' : ((s.top1 / s.cases) * 100).toFixed(1)}%)`,
  );
  lines.push(
    `    truth ranks 1/2/3/4/5/deeper/absent: ` +
      `${s.ranks[1]}/${s.ranks[2]}/${s.ranks[3]}/${s.ranks[4]}/${s.ranks[5]}/${s.ranks.deeper}/${s.ranks.absent}`,
  );
  lines.push(`    twin direction: ${twin}`);
  lines.push('');
  lines.push('  comparison with docs/rank-depth.md §5 (written against the 1 141-rank-1 engine):');
  lines.push(
    `    §5 recorded: ${DOC5.strataBelowGap} cases below ${STRATUM_GAP}, ${DOC5.strataTop1} top1, ` +
      `rank2=${DOC5.rank2} rank3=${DOC5.rank3}, twin=${DOC5.twin}`,
  );
  lines.push(
    `    this artifact: ${s.cases} cases below ${STRATUM_GAP}, ${s.top1} top1, ` +
      `rank2=${s.ranks[2]} rank3=${s.ranks[3]}, twin=${twin}`,
  );
  lines.push('');
  lines.push(
    `  verdict: §5's curve is ${s.cases === DOC5.strataBelowGap && twin === DOC5.twin ? 'reproduced' : 'NOT reproduced'} on this artifact.`,
  );
  return lines.join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { rows, missingScores, absent } = readRows(args.cases);
  const census = buildCensus(rows);
  const twin = twinDirection(census);
  const report = format(census, twin, `${args.cases} sha256:${digestOf(args.cases)}`);
  console.log(report);
  console.log(`\nrows without both score columns: ${missingScores}; absent-truth rows: ${absent}`);
  if (args.out) {
    writeFileSync(
      args.out,
      JSON.stringify({ artifact: args.cases, digest: digestOf(args.cases), census, twin }, null, 2),
    );
  }
}

main();
