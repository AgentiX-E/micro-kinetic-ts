/**
 * Print the Cloud-OpsBench census: the comparable population, the evidence reach, and the replay audit.
 *
 * Run against a checkout of `github.com/LLM4Ops/Cloud-OpsBench`:
 *
 * ```
 * pnpm --filter @agentix-e/micro-kinetic-benchmarks exec tsx src/run-cloudopsbench-census.ts /path/to/checkout
 * ```
 *
 * Three tables, and each answers a question the register had been carrying as prose:
 *
 * 1. **Population** — how many of the 754 cases carry `raw_data/metrics.csv` (iteration 310 said 76; it is 170),
 *    and how many of those name an answer the case's own series can express.
 * 2. **Reach** — how much of the published evidence labels a metric/log/edge arm can produce at all, per tool.
 * 3. **Replay audit** — how much of those labels the competitor's own `tool_cache.json` can check.
 *
 * Nothing here spends a token: the input is files they published and the output is counting.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ClosureLabel } from './closure-labels.js';
import {
  listCaseIds,
  readCaseLabel,
  readCloudOpsCase,
  type CloudOpsCase,
} from './cloudopsbench-case.js';
import {
  cacheConsistency,
  evidenceReach,
  readToolCache,
  summariseCases,
  type ToolCache,
} from './cloudopsbench-census.js';

const root = process.argv[2];
if (root === undefined || root === '') {
  process.stderr.write('usage: run-cloudopsbench-census.ts <checkout-root> [out.json]\n');
  process.exit(2);
}

const ids = listCaseIds(root);
const cases: CloudOpsCase[] = [];
const labels: ClosureLabel[] = [];
const caches = new Map<string, ToolCache>();
const refused: string[] = [];
for (const id of ids) {
  const read = readCloudOpsCase(root, id);
  if (!read.ok) {
    refused.push(read.reason);
    continue;
  }
  cases.push(read.value);
  const label = readCaseLabel(root, id);
  // A case with no label is a case with no truth to score against; it still counts in the population census,
  // because "the corpus ships 754 cases" and "754 cases carry a label" are two different claims.
  if (label.ok) labels.push(label.label);
  else refused.push(label.reason);
  if (read.value.hasToolCache) {
    caches.set(
      id,
      readToolCache(readFileSync(join(root, 'benchmark', id, 'tool_cache.json'), 'utf8')),
    );
  }
}

const census = summariseCases(cases);
const reach = evidenceReach(labels);
const replay = cacheConsistency(labels, caches);

const pct = (part: number, whole: number): string =>
  whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)} %`;

const lines = [
  `cases (directories)            ${String(ids.length)}`,
  `  read                        ${String(census.cases)}`,
  `  refused                     ${String(refused.length)}`,
  `  labels                      ${String(labels.length)}`,
  `  tool_cache                  ${String(census.withToolCache)}`,
  `  metrics.csv                 ${String(census.metricReadable)}  (${pct(census.metricReadable, census.cases)})`,
  `  alert window                ${String(census.withAlert)}`,
  `  truth in own series         ${String(census.resolvable)}  (${pct(census.resolvable, census.metricReadable)} of readable)`,
  `  rows / services per case    ${String(census.rows.min)}–${String(census.rows.max)} / ${String(census.services.min)}–${String(census.services.max)}`,
  '',
  'category                     cases  metrics',
  ...census.categories.map(
    (one) =>
      `${one.category.padEnd(28)} ${String(one.cases).padStart(5)}  ${String(one.metricReadable).padStart(7)}`,
  ),
  '',
  `milestones                   ${String(reach.milestones)}`,
  `  reachable (metric/log/edge) ${String(reach.reachable)}  (${pct(reach.reachable, reach.milestones)})`,
  `  cases all / some / none     ${String(reach.casesAll)} / ${String(reach.casesSome)} / ${String(reach.casesNone)}`,
  '  reachable uses by tool',
  ...reach.byTool.map(([tool, count]) => `    ${tool.padEnd(26)} ${String(count).padStart(5)}`),
  '',
  `admissible uses              ${String(replay.uses)}`,
  `  in their own cache          ${String(replay.satisfied)}  (${pct(replay.satisfied, replay.uses)})`,
  `  milestones closed by cache  ${String(replay.milestonesSatisfied)}  (${pct(replay.milestonesSatisfied, replay.milestones)})`,
  `  cases all / some / none     ${String(replay.casesAll)} / ${String(replay.casesSome)} / ${String(replay.casesNone)}`,
  '  unsatisfied uses by tool',
  ...replay.missingByTool.map(
    ([tool, count]) => `    ${tool.padEnd(26)} ${String(count).padStart(5)}`,
  ),
];
if (refused.length > 0) {
  lines.push('', `first refusals`, ...refused.slice(0, 5).map((one) => `  ${one}`));
}
process.stdout.write(`${lines.join('\n')}\n`);

const out = process.argv[3];
if (out !== undefined && out !== '') {
  writeFileSync(
    out,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), root, census, reach, replay, refused }, null, 2)}\n`,
  );
}
