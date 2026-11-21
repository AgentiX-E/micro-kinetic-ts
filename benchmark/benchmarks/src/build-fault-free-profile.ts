/**
 * The fault-free profile builder's ENTRY POINT.
 *
 * Four lines, and the split is the same one `run-*.ts` earned the hard way: the logic lives in
 * `fault-free-profile-build.ts`, which a test can import and measure, and this file only decides that the
 * process asked for it. Keeping them together would put the parser behind a `main()` call at import time —
 * the defect `fse26-engine-options.ts` records — and put it outside the coverage denominator with it.
 *
 *     pnpm exec tsx benchmarks/src/build-fault-free-profile.ts \
 *       --data-dir <corpus> --out <profile.json> [--max-cases N] [--sigma 3]
 *
 * @module benchmarks/build-fault-free-profile
 */

import { isEntryPoint } from './cell-baseline.js';
import { main } from './fault-free-profile-build.js';

if (isEntryPoint(process.argv[1], import.meta.url)) main(process.argv.slice(2));
