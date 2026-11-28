/**
 * The term arm's report: one block an operator can read and a step summary can grep.
 *
 * The shape follows the gate's report on purpose — the instrument first, then the fits, then the arms — because a
 * reader comparing the two arms should be reading the same columns rather than translating between two layouts.
 * The additions are the population census (the term fits on the fusion's own adjacency, the gate on a sweep's) and
 * the λ sweep, which is pre-committed: a single λ is a parameter, and the curve is the smallest object that can
 * distinguish a weight from a coincidence.
 *
 * @module benchmarks/containment-term-report
 */

import { STANDING_CRITERION, type GateCriterion } from './containment-gate.js';
import { termVerdict, type TermReading } from './containment-term-study.js';

/** What the command line asked for. */
export interface TermArgs {
  /** The containment dump. */
  readonly rows: string;
  /** The depth dump, which carries the fusion's score per candidate. */
  readonly depth: string;
  /** The per-case dump, which carries the accepted answers. */
  readonly perCase: string;
  /** The λ grid to read. */
  readonly lambdas: readonly number[];
  /** Where to write the JSON, or `''` for nowhere. */
  readonly output: string;
}

/** The λ grid the pre-registration commits to: a 16-fold range with the chosen value in it. */
export const DEFAULT_LAMBDAS: readonly number[] = [0.25, 0.5, 1, 2, 4];

/**
 * Parse the term report's arguments.
 *
 * A λ that is not a positive finite number is REFUSED rather than defaulted: the sweep is a pre-registered object,
 * and a run that silently substituted 1 for a typo would report a curve that is not the one that was asked for.
 *
 * @param argv - The arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseTermArgs(argv: readonly string[]): TermArgs {
  let rows = '';
  let depth = '';
  let perCase = '';
  let output = '';
  const lambdas: number[] = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const next = argv[i + 1];
    switch (flag) {
      case '--rows':
        rows = next ?? '';
        i += 1;
        break;
      case '--depth':
        depth = next ?? '';
        i += 1;
        break;
      case '--per-case':
        perCase = next ?? '';
        i += 1;
        break;
      case '--output':
        output = next ?? '';
        i += 1;
        break;
      case '--lambdas': {
        const raw = next ?? '';
        i += 1;
        for (const piece of raw.split(',')) {
          const value = Number(piece);
          if (piece.trim() === '' || !Number.isFinite(value) || value <= 0) {
            throw new Error(`--lambdas: "${piece}" is not a positive finite number`);
          }
          lambdas.push(value);
        }
        break;
      }
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (rows === '') throw new Error('--rows is required');
  if (depth === '') throw new Error('--depth is required');
  if (perCase === '') throw new Error('--per-case is required');
  return {
    rows,
    depth,
    perCase,
    lambdas: lambdas.length === 0 ? DEFAULT_LAMBDAS : lambdas,
    output,
  };
}

/** `+15/-0` — the gate's spelling, so the two reports' columns are the same column. */
function signed(reading: TermReading): string {
  return `+${reading.arms.graded.gains}/-${reading.arms.graded.losses}`;
}

/**
 * Format one λ's reading.
 *
 * @param reading - The reading.
 * @returns The lines, in the order a reader needs them: instrument, population, fits, transfers, arms.
 */
export function formatTermReading(reading: TermReading): string[] {
  const lines: string[] = [];
  lines.push(
    `  rows=${reading.cases} replayable=${reading.replayable} disagreements=${reading.disagreements} unordered=${reading.unordered}`,
  );
  lines.push(
    `  population fusion=${reading.population.fusion} ungated=${reading.population.ungated} same-length-cases=${reading.population.shared}`,
  );
  for (const fit of reading.fits) {
    lines.push(
      `  phi fitted-on=${fit.fittedOn} applies-to=${fit.appliesTo} edges=${fit.edges} fitted=${fit.fitted} positive=${fit.positive} observations=${fit.observations}`,
    );
  }
  const { qualified, unfitted, paid, silent, refused } = reading.census;
  lines.push(
    `  transfers qualified=${qualified} unfitted=${unfitted} paid=${paid} silent=${silent} refused=${refused}`,
  );
  lines.push(`  moved=${reading.moved} (graded head differs from the fusion head)`);
  // The reach census, on one line: an adjacent swap can only reach rank 2, and whether a longer lift is worth
  // taking is the question this arm was built to answer. Ranks that produced no change are absent rather than
  // printed as zeros, so the line shows where the bets were placed.
  lines.push(
    `  reach ${reading.reach.map((entry) => `rank=${entry.rank} +${entry.gains}/-${entry.losses}`).join(' ') || '(no published head moved)'}`,
  );
  lines.push(`  arm=fusion  top1=${reading.arms.fusion.top1}`);
  lines.push(
    `  arm=shipped top1=${reading.arms.shipped.top1} +${reading.arms.shipped.gains}/-${reading.arms.shipped.losses}`,
  );
  lines.push(
    `  arm=prior   top1=${reading.arms.prior.top1} +${reading.arms.prior.gains}/-${reading.arms.prior.losses}`,
  );
  lines.push(
    `  arm=graded  top1=${reading.arms.graded.top1} ${signed(reading)} lambda=${reading.lambda}`,
  );
  return lines;
}

/**
 * Format the λ sweep and the verdict.
 *
 * @param readings - One reading per λ, in the order the grid was given.
 * @param criterion - The standing gate.
 * @returns The sweep's table and the verdict line.
 */
export function formatTermSweep(
  readings: readonly TermReading[],
  criterion: GateCriterion = STANDING_CRITERION,
): string[] {
  const lines: string[] = ['  lambda sweep:'];
  for (const reading of readings) {
    const { verdict } = termVerdict(reading, criterion);
    lines.push(
      `    lambda=${String(reading.lambda).padEnd(5)} top1=${reading.arms.graded.top1} ${signed(reading)} moved=${reading.moved} ${verdict}`,
    );
  }
  lines.push(
    `  criterion: gains>=${criterion.gains} losses<=${criterion.losses} top1>${criterion.shippedTop1}`,
  );
  return lines;
}
