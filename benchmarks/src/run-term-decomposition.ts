/**
 * `run-term-decomposition` — read a TERM dump and print the decomposition of the re-rankable misses.
 *
 * The pre-registered measurement of `docs/depth-reranking-preregistration.md` §2–§3, as a console: the population
 * with its three exclusions, then one table per fault family with the in-sample and held-out readings side by
 * side, then the verdict. `term-decomposition.ts` owns every number and `terms-dump.ts` owns the format; this
 * file owns the console and the one optional cross-check.
 *
 * The cross-check is what makes the join an attestation rather than a hope: `--depth` takes the depth artifact of
 * the SAME run, and the CLI exits non-zero when the two disagree about a case — because a report built on an
 * artifact pair that disagrees about which cases are misses is a report about a population neither recorded.
 *
 * It reads files and writes to the console: no corpus, no engine, so a table cannot be an accident of the data a
 * run happened to load.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-term-decomposition.ts --terms fse26-terms.ndjson [--depth depth.ndjson]
 *
 * @module benchmarks/run-term-decomposition
 */

import { readDepthDump } from './ranking-depth.js';
import {
  depthDisagreements,
  formatTermReport,
  parseTermReportArgs,
  summariseTerms,
  termVerdict,
} from './term-decomposition.js';
import { readTermsDump } from './terms-dump.js';

const args = parseTermReportArgs(process.argv.slice(2));
const cases = readTermsDump(args.terms);
const report = summariseTerms(cases);
const verdict = termVerdict(report);
console.log(formatTermReport(report, verdict));

if (report.undeclared.length > 0) {
  // A formula that grew a term after the pre-registration was written has an alpha that no longer bounds the
  // family: the correction is over 18 tests and this dump carries more. Refused rather than reported, and the
  // line above has already named the names.
  throw new Error(
    `the dump carries terms the pre-registration does not count: ${report.undeclared.join(', ')}`,
  );
}

if (args.depth !== '') {
  const derived = new Map<string, number | null>(
    cases.map((kase) => {
      const accepted = new Set(kase.accepted);
      const index = kase.candidates.findIndex((candidate) => accepted.has(candidate.id));
      return [kase.datapack, index === -1 ? null : index] as const;
    }),
  );
  const recorded = new Map<string, number | null>(
    readDepthDump(args.depth).map((row) => [row.datapack, row.depth] as const),
  );
  const { mismatched, missing } = depthDisagreements(derived, recorded);
  console.log('');
  console.log(
    `  depth cross-check: ${derived.size} derived, ${recorded.size} recorded, ` +
      `${mismatched.length} disagree, ${missing.length} absent from one side`,
  );
  if (mismatched.length > 0 || missing.length > 0) {
    for (const row of mismatched.slice(0, 5)) {
      console.log(`    ${row.datapack}: derived ${row.derived}, recorded ${row.recorded}`);
    }
    for (const datapack of missing.slice(0, 5)) console.log(`    ${datapack}: one artifact only`);
    throw new Error('the two artifacts do not describe the same population');
  }
}
