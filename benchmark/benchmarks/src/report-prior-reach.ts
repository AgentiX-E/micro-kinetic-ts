/**
 * `report-prior-reach` — read a TERM dump and print what the label prior's margin gate could see.
 *
 * The measurement `docs/label-prior-fse26.md` §1 pre-registers as the instrument: a gated arm that reads the same
 * as its control is either a term the gate withheld everywhere or a term that spoke and agreed, and a cell table
 * cannot tell them apart. `label-prior-reach.ts` owns every number and `terms-dump.ts` owns the format; this file
 * owns the console.
 *
 * It reads a file and writes to the console: no corpus, no engine, so the census cannot be an accident of the data
 * a run happened to load.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/report-prior-reach.ts --terms fse26-terms.ndjson --gate 0.02
 *
 * @module benchmarks/report-prior-reach
 */

import { formatPriorReach, parsePriorReachArgs, summarisePriorReach } from './label-prior-reach.js';
import { readTermsDump } from './terms-dump.js';

const args = parsePriorReachArgs(process.argv.slice(2));
console.log(formatPriorReach(summarisePriorReach(readTermsDump(args.terms), args.gate)));
