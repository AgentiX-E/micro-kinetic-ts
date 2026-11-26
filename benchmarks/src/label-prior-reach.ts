/**
 * The label prior's REACH: what the margin gate could see on one corpus, read from the run's own term dump.
 *
 * ## What this answers that a cell table cannot
 *
 * The gate withholds the term wherever the ranking's head is separated by less than `τ`, so a gated arm that
 * reads *identical* to its control has two entirely different explanations: the gate withheld everywhere (the
 * term could not speak) or the term spoke and agreed with the engine. A cell table shows one number either way.
 * This module measures the gate's input on every case — the base `top1 − top2`, before the term is added — so
 * "the term is silent on this cell" becomes a median and a share rather than an inference.
 *
 * ## Why it reads the DUMP rather than re-running the engine
 *
 * The gate's margin is a property of the engine's own scores, and the dump records every candidate's total with
 * the `(weight, slope)` of each term. The base is therefore exact arithmetic on the artifact:
 *
 *     base(v) = score(v) − Σ wᵢ·slopeᵢ over the term's own rows
 *
 * A second engine invocation with the term removed would be a second implementation of the sum, which is the
 * defect every weight screen in this repository exists to avoid. The one thing the dump does NOT carry is the
 * gate's own decision, and that is deliberate: the decision is a comparison of two numbers this module can
 * reconstruct, so recording it would be a second copy of a fact.
 *
 * ## What it refuses to guess
 *
 * A case whose candidates carry no `labelPrior` row — the shipped run, where the weight is `0` — is
 * UNMEASURABLE, not withheld. Folding it into the withheld count would report the gate as the reason a run that
 * never armed the term showed no movement, which is a statement about the artifact being read as a statement
 * about the corpus.
 *
 * @module benchmarks/label-prior-reach
 */

import type { ParsedTermCandidate, ParsedTermCase } from './terms-dump.js';

/** The term's name in the dump, as `buildTerm` spells it. */
const PRIOR_TERM = 'labelPrior';

/** What one dump says about the gate. */
export interface PriorReach {
  /** The threshold the comparison was made at. */
  readonly gate: number;
  /** Cases read. */
  readonly cases: number;
  /** Cases whose head is separated by at least the gate — the term was allowed to speak. */
  readonly admitted: number;
  /** Cases whose head is separated by less than the gate — the term was withheld. */
  readonly withheld: number;
  /** Cases this dump cannot answer for, counted rather than assumed into either side. */
  readonly unmeasurable: number;
  /**
   * Median base `top1 − top2` over the measurable cases.
   *
   * The number the threshold is chosen against, and the reason a gate tuned on one corpus does not transfer: it
   * is a property of the ranking's head, not of the term.
   */
  readonly medianBaseMargin: number;
}

/**
 * One candidate's base score: its total minus the prior's own contribution.
 *
 * @param candidate - The dump's candidate row.
 * @returns The base, or `undefined` when the row cannot produce one.
 */
function baseOf(candidate: ParsedTermCandidate): number | undefined {
  if (candidate.score === null || !Number.isFinite(candidate.score)) return undefined;
  let base = candidate.score;
  let seen = false;
  for (const [name, weight, slope] of candidate.terms) {
    if (name !== PRIOR_TERM) continue;
    if (weight === null || slope === null || !Number.isFinite(weight) || !Number.isFinite(slope)) {
      return undefined;
    }
    // A zero weight is the shipped configuration: the row exists, its slope is zero by construction, and the
    // dump therefore cannot say what the term WOULD have added. Measured zero and unasked-for zero are two
    // statements, which is the distinction `null` in this format exists for.
    if (weight === 0) return undefined;
    base -= weight * slope;
    seen = true;
  }
  return seen ? base : undefined;
}

/**
 * The middle of a population of numbers.
 *
 * @param values - The population, in any order.
 * @returns The median; an even population averages its two middles, and an empty one answers `0`.
 */
function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Summarise the gate's reach over a dump.
 *
 * @param cases - The dump's cases, as `parseTermsDump` returns them.
 * @param gate - The threshold the run was armed with.
 * @returns The counts, and the median margin the gate was compared against.
 */
export function summarisePriorReach(cases: readonly ParsedTermCase[], gate: number): PriorReach {
  const margins: number[] = [];
  let admitted = 0;
  let withheld = 0;
  let unmeasurable = 0;
  for (const kase of cases) {
    const bases: number[] = [];
    for (const candidate of kase.candidates) {
      const base = baseOf(candidate);
      if (base === undefined) {
        bases.length = 0;
        break;
      }
      bases.push(base);
    }
    // Two candidates are the least a gap can be measured between. A single-candidate case has no head-versus-
    // runner-up question, so the gate never saw it and neither may this count.
    if (bases.length < 2) {
      unmeasurable++;
      continue;
    }
    bases.sort((a, b) => b - a);
    const margin = bases[0]! - bases[1]!;
    margins.push(margin);
    if (margin >= gate) admitted++;
    else withheld++;
  }
  return {
    gate,
    cases: cases.length,
    admitted,
    withheld,
    unmeasurable,
    medianBaseMargin: medianOf(margins),
  };
}

/**
 * Render the reach as the line a dispatch reads.
 *
 * @param reach - The summary.
 * @returns One line, naming the population beside the number on the rule the other censuses follow.
 */
export function formatPriorReach(reach: PriorReach): string {
  const pct = (value: number): string =>
    reach.admitted + reach.withheld === 0
      ? 'n/a'
      : `${((100 * value) / (reach.admitted + reach.withheld)).toFixed(1)}%`;
  return (
    `Label prior reach: gate=${reach.gate} admitted=${reach.admitted} (${pct(reach.admitted)}) ` +
    `withheld=${reach.withheld} (${pct(reach.withheld)}) unmeasurable=${reach.unmeasurable} ` +
    `of ${reach.cases} cases, median base margin=${reach.medianBaseMargin.toFixed(4)}`
  );
}

/** What the census command line accepts. */
export interface PriorReachArgs {
  /** The term dump to read. */
  readonly terms: string;
  /** The threshold the run was armed with. */
  readonly gate: number;
}

/**
 * Parse the census command line.
 *
 * The gate is REQUIRED rather than defaulted, and that is the whole point of the tool: the census reports what a
 * given threshold saw, so a default would publish a number about a gate the run may not have used. A dispatcher
 * that does not know which gate it armed is a dispatcher who has not read the artifact.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 * @throws Error when the dump or the gate is missing, or an argument is unrecognised.
 */
export function parsePriorReachArgs(argv: readonly string[]): PriorReachArgs {
  let terms = '';
  let gate: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--terms') terms = argv[++i] ?? '';
    else if (arg === '--gate') gate = Number.parseFloat(argv[++i] ?? '');
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (terms === '') throw new Error('--terms is required');
  if (gate === undefined || !Number.isFinite(gate) || gate < 0) {
    throw new Error('--gate is required and must be a non-negative margin');
  }
  return { terms, gate };
}
