/**
 * Merge per-suite routing-probe JSON artifacts and recompute the joint
 * zero-regression routing frontier.
 *
 * Each `--routing-probe` run emits one JSON with a `records` array (per-case
 * engine ranking scores + PRISM M-scores + fault type). The zero-regression
 * frontier is NOT decomposable across suites — a router that never regresses a
 * cell on RE1 may regress one on RE2 — so the joint frontier must be derived
 * from the concatenated record set, exactly as the PRISM weight sweep was
 * merged. This script performs that merge and prints the joint frontier.
 *
 * Usage:
 *   node --import tsx/esm benchmarks/src/merge-routing-probe.ts \
 *     <re1.json> <re2.json> <re3.json> <merged-out.json>
 *
 * @module benchmarks/merge-routing-probe
 */

import { readFileSync, writeFileSync } from 'node:fs';

import {
  analyzeRoutingProbe,
  type RoutingProbeRecord,
} from '../../packages/kinetic/src/benchmarks/leaderboard/routing-probe.js';

interface SuiteReport {
  suite?: string;
  records: RoutingProbeRecord[];
  aggregate?: unknown;
  bestZeroRegression?: unknown;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('usage: merge-routing-probe.ts <input.json>... <merged-out.json>');
    process.exit(1);
  }
  const outPath = args[args.length - 1]!;
  const inputPaths = args.slice(0, -1);

  const records: RoutingProbeRecord[] = [];
  for (const path of inputPaths) {
    const report = JSON.parse(readFileSync(path, 'utf-8')) as SuiteReport;
    records.push(...report.records);
  }

  const analysis = analyzeRoutingProbe(records);

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        total: analysis.total,
        aggregate: {
          total: analysis.total,
          engineCorrect: analysis.engineCorrect,
          prismCorrect: analysis.prismCorrect,
          disagreement: analysis.disagreement,
          engineOnly: analysis.engineOnly,
          prismOnly: analysis.prismOnly,
          bothWrong: analysis.bothWrong,
          union: analysis.union,
          unionRate: analysis.unionRate,
          baselineAccuracy: analysis.baselineAccuracy,
        },
        bestZeroRegression: analysis.bestZeroRegression,
        zeroRegressionRules: analysis.zeroRegressionRules,
      },
      null,
      2,
    ),
  );

  console.log('════════════════════════════════════════════════════════════');
  console.log(`Merged routing probe — ${analysis.total} cases`);
  console.log('════════════════════════════════════════════════════════════');
  console.log(
    `  engine=${analysis.engineCorrect} prism=${analysis.prismCorrect} ` +
      `disagree=${analysis.disagreement}`,
  );
  console.log(
    `  engineOnly=${analysis.engineOnly} prismOnly=${analysis.prismOnly} ` +
      `bothWrong=${analysis.bothWrong}`,
  );
  console.log(`  UNION=${analysis.union} (${(analysis.unionRate * 100).toFixed(1)}%)`);
  console.log(`  baseline(always-engine)=${(analysis.baselineAccuracy * 100).toFixed(1)}%`);
  console.log('  reference rules:');
  const refNames = ['always-prism', 'resource-fault->prism', 'per-cell-oracle'];
  for (const r of analysis.rules) {
    if (!refNames.includes(r.name)) continue;
    const reg = r.regressingCells.length > 0 ? ` [regress ${r.regressingCells.length}]` : '';
    console.log(
      `    ${r.name.padEnd(26)} acc=${(r.accuracy * 100).toFixed(1)}%` +
        ` (gain ${(r.gain >= 0 ? '+' : '') + (r.gain * 100).toFixed(1)}pp)${reg}`,
    );
  }
  console.log(
    `  zero-regression rules: ${analysis.zeroRegressionRules.length} / ${analysis.rules.length}`,
  );
  if (analysis.bestZeroRegression) {
    const b = analysis.bestZeroRegression;
    console.log(
      `  BEST zero-regression: ${b.name} = ${(b.accuracy * 100).toFixed(1)}% ` +
        `(gain ${(b.gain >= 0 ? '+' : '') + (b.gain * 100).toFixed(1)}pp)`,
    );
  } else {
    console.log('  BEST zero-regression: none (empty input)');
  }
  console.log('════════════════════════════════════════════════════════════');
}

main();
