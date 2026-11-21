/**
 * The console entry for the recorded-weight census and the conditional-term ablation.
 *
 * Two readings of one dump, both of which the screens used to get wrong: what coefficients the dump actually recorded
 * (so a gated term is visible as a decision rather than as a configuration), and what the term is worth as a
 * three-arm ablation — the arm that ran, the term switched off, and the term forced on.
 *
 * Usage: `--terms <dump.ndjson> [--term <name>] [--all]`.
 */

import { ablateTerm, formatAblation, formatCensus, weightCensusOf } from './conditional-weight.js';
import { readTermsDump } from './terms-dump.js';

/** The flags this console reads. */
interface AblationArgs {
  readonly terms: string;
  /** The names to ablate: an explicit `--term`, or every conditional name, or nothing when neither is given. */
  readonly ablations: readonly string[];
}

/**
 * Read the command line.
 *
 * @param argv - The arguments after the script name.
 * @returns The dump's path and the names to ablate.
 * @throws When `--terms` is missing, because a census of no dump is not an empty census.
 */
export function parseAblationArgs(argv: readonly string[]): AblationArgs {
  let terms: string | undefined;
  const named: string[] = [];
  let all = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === '--terms') {
      terms = argv[index + 1];
      index += 1;
    } else if (flag === '--term') {
      const name = argv[index + 1];
      if (name === undefined) throw new Error('--term needs a name');
      named.push(name);
      index += 1;
    } else if (flag === '--all') {
      all = true;
    } else {
      throw new Error(`unknown argument ${flag}`);
    }
  }
  if (terms === undefined) throw new Error('--terms <dump.ndjson> is required');
  return { terms, ablations: all ? [] : named };
}

function main(): void {
  const args = parseAblationArgs(process.argv.slice(2));
  const cases = readTermsDump(args.terms);
  const census = weightCensusOf(cases);
  process.stdout.write(`${formatCensus(census)}\n`);
  // The dump's own answers, read with the coefficients it recorded. This is the number the run published, and it is
  // NOT what any single weight vector scores: a vector cannot reproduce a fusion that contains a decision.
  const recorded = cases.filter((kase) => {
    const winner = kase.candidates[0];
    return winner !== undefined && kase.accepted.includes(winner.id);
  }).length;
  process.stdout.write(`\nthe dump's own top-1 answers ${recorded} of ${cases.length}\n`);
  const targets = args.ablations.length > 0 ? args.ablations : census.conditional;
  for (const term of targets) {
    process.stdout.write(`\n${formatAblation(ablateTerm(cases, term))}\n`);
  }
}

main();
