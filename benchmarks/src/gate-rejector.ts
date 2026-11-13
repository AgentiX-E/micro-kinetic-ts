/**
 * The gate's decision as a calibrated rejector: what the baseline's own lead says about overriding it.
 *
 * ## What iteration 277 left open
 *
 * The shipped gate admits a case when the rank-1 service's dominant metric is a duration series AND its raw inbound
 * rise clears an absolute bar. Read off the dump, that predicate admits 108 cases, fixes 44 and breaks 2, and
 * refuses 1 114 of which 111 were fixable and 88 would have broken — a decision worth +42 net and a
 * **+113 ceiling** it leaves on the table. The question 277 wrote down was: *which observable separates the 111 from
 * the 88?*
 *
 * It is not the fault type, not the metric name, not the rise, and not the failed-call channel: the channel's own
 * score is max-normalised, so its maximum is 1.000 on **every** case in the corpus and carries no information at all
 * (measured: the top slope is 1.000 at every decile of every outcome). What separates them is the **lead**: the gap
 * between the baseline's first and second candidate, in the score units the term itself moves in.
 *
 * ## Chow's rule, and why the statistic is the lead
 *
 * A reject option is a decision with a cost. With `p` the posterior probability that acting is right, acting is
 * optimal when `p · benefit > (1 − p) · cost`; for two outcomes worth one case each that is `p > 1/2`, and more
 * generally the bound sits at `1 − c` for a cost ratio `c` (Chow, *On optimum recognition error and reject tradeoff*,
 * IEEE IT-16, 1970). The rule is a threshold on a **calibrated** posterior, so the two things it needs are a
 * statistic the posterior is monotone in, and a calibration measured rather than assumed.
 *
 * The lead is that statistic for a mechanical reason. The direction term adds `weight × slope` to one candidate, and
 * every slope is max-normalised, so the largest move the term can ever make is `weight` score units. A lead beyond
 * that is beyond what the term can close **on the runner-up**, which is why the calibration falls off a cliff there;
 * it is not a proof of impossibility, because the candidate the term promotes need not be the runner-up — and the
 * corpus says exactly that: above one span the term still flips **11** of the 245 decision cases, and it is right
 * once. {@link RejectorCase} therefore carries the lead divided by that span — dimensionless, free of the corpus's
 * score scale, and comparable across weights and corpora. The measured calibration is abrupt where the arithmetic
 * says it should be:
 *
 * | lead bracket | cases | fixed | broken | `p(fixed)` |
 * | --- | ---: | ---: | ---: | ---: |
 * | `[0.00, 0.05)` | 68 | 61 | 7 | 0.897 |
 * | `[0.10, 0.20)` | 40 | 30 | 10 | 0.750 |
 * | `[0.30, 0.50)` | 25 | 16 | 9 | 0.640 |
 * | `[0.75, 1.00)` | 4 | 4 | 0 | 1.000 |
 * | `[1.00, 1.50)` | 11 | 1 | 10 | **0.091** |
 * | `[2.00, ∞)` | 39 | 0 | 39 | **0.000** |
 *
 * Below one unit of lead the term is right roughly three times in four whatever the bracket; above it the term is
 * right once in eleven and then never. Nine of the ten brackets do not even violate monotonicity, and the isotonic
 * fit of {@link calibrationOf} pools the one that does.
 *
 * ## What this module measures, and what it does not decide
 *
 * It reads the frontier — every bound, the cases answered, and the fault families that lose a case — and the
 * out-of-fold reading of the Chow bound chosen on four folds and spent on the fifth. It does **not** adopt a bound:
 * the frontier shows that no point of this statistic clears the engine's standing acceptance condition (no regressed
 * fault type), so adopting one is a decision about the condition, not about the statistic. {@link constrainedOf}
 * prices that condition instead of hiding it.
 *
 * @module benchmarks/gate-rejector
 */

import type { StrictReading } from './gate-fit.js';
import { readScores } from './gate-fit.js';
import { foldOf } from './fse26-discriminator.js';
import type { ParsedTermCase } from './terms-dump.js';
import { scoresUnder, weightCensusOf } from './conditional-weight.js';

/** One case, as the rejector reads it: what the baseline held, and what the term did. */
export interface RejectorCase {
  readonly datapack: string;
  readonly faultType: string;
  /**
   * The baseline's first candidate minus its second, in score units.
   *
   * `+Infinity` when the ranking lists one candidate: a case with no rival cannot be reordered, so no amount of
   * reach overturns it and the term's action there is a pure risk. That is a VALUE and not a missing measurement —
   * the difference between "the lead is unbeatable" and "the lead was never computed" is the difference between a
   * refusal and a bug.
   */
  readonly lead: number;
  /**
   * `lead / (configured × the largest slope any candidate measured for the term)`.
   *
   * The number of "reaches" the baseline leads by: below 1 the term can still change the answer, above 1 it cannot.
   * `+Infinity` when the lead is, or when no candidate measured the term — a case the term cannot act on is one
   * every bound refuses, and reporting it as `0` would admit it at every bound instead.
   */
  readonly reach: number;
  /** The coefficient the run wrote for the term: the gate admitted this case. */
  readonly shipped: boolean;
  /** The baseline answered: the best accepted candidate beat the best rejected one outright, with the term off. */
  readonly off: boolean;
  /** The same, with the configured coefficient forced on. */
  readonly on: boolean;
}

/** One fault family that loses a case, and by how many. */
export interface FamilyLoss {
  readonly faultType: string;
  /** Negative: the number of cases the family no longer answers, relative to the run. */
  readonly delta: number;
}

/**
 * One operating point of the rejector: everything a bound buys and everything it costs.
 *
 * The baseline every delta is read against is the RUN — the coefficients the dump recorded — and not the term held
 * off. A gate change is a change to a deployed configuration, so the thing it must not damage is that configuration,
 * and the `off` arm is a different engine that this module is not proposing.
 */
export interface FrontierPoint {
  /** The bound on {@link RejectorCase.reach}: the term may act on a case whose lead is under this many reaches. */
  readonly bound: number;
  /** Cases answered strictly, over the whole corpus. */
  readonly cases: number;
  /** `cases` minus the run's own total. */
  readonly delta: number;
  /** Cases the rejector admits, the run's own admissions included. */
  readonly admitted: number;
  /** Of the admissions the run did NOT make, the ones that fix a case. */
  readonly helps: number;
  /** Of the admissions the run did NOT make, the ones that break a case. */
  readonly hurts: number;
  /** The families that lose at least one case against the run, worst first, then by name. */
  readonly regressed: readonly FamilyLoss[];
  /** `Σ |delta|` over {@link regressed}: the price of the standing acceptance condition at this bound. */
  readonly loss: number;
}

/** One block of the isotonic fit: a plateau of constant `p` over a reach interval. */
export interface CalibrationBlock {
  readonly lo: number;
  readonly hi: number;
  /** Pooled mean of the block's outcomes, weighted by the cases it covers. */
  readonly p: number;
  /** Cases in the block. */
  readonly cases: number;
}

/** One fold's verdict: the bound it chose on the other folds, and what that bound did on this one. */
export interface ChowFold {
  readonly fold: number;
  /** The bound chosen on the training folds; `-1` when the calibration refused the term everywhere. */
  readonly bound: number;
  readonly heldOut: number;
  readonly baseline: number;
  readonly delta: number;
  readonly regressed: readonly FamilyLoss[];
  readonly loss: number;
}

/** The out-of-fold reading of the Chow bound. */
export interface ChowReport {
  readonly folds: readonly ChowFold[];
  /** One bound per fold, in fold order: the STABILITY the bar of `holdoutDirectionReport` is about. */
  readonly bounds: readonly number[];
  readonly heldOut: number;
  readonly baseline: number;
  readonly delta: number;
  readonly loss: number;
}

/**
 * The bounds {@link frontierOf} reads when a caller names none.
 *
 * A log-spaced ladder from a fiftieth of a reach to two: fine where the calibration moves (either side of one
 * reach), coarse where it cannot (the term's action is impossible above one reach and the total is flat by
 * construction). The ladder is stated here rather than defaulted in the signature so an artifact records the grid it
 * was read on.
 */
export const DEFAULT_REACH_BOUNDS: readonly number[] = [
  0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.75, 1, 1.5, 2,
];

/**
 * The lead of a score array: its first value minus its second, over the baseline ordering.
 *
 * @param scores - One score per candidate, in the dump's order.
 * @returns The lead, or `+Infinity` when fewer than two candidates are listed.
 */
function leadOf(scores: Float64Array): number {
  let top = -Infinity;
  let second = -Infinity;
  for (const score of scores) {
    if (score > top) {
      second = top;
      top = score;
    } else if (score > second) {
      second = score;
    }
  }
  if (second === -Infinity) return Infinity;
  return top - second;
}

/**
 * The largest slope any candidate measured for one name.
 *
 * @param kase - One case.
 * @param name - The term.
 * @returns The largest measured slope, or `0` when no candidate measured it.
 */
function reachOfTerm(kase: ParsedTermCase, name: string): number {
  let max = 0;
  for (const candidate of kase.candidates) {
    for (const [term, , slope] of candidate.terms) {
      if (term !== name || slope === null) continue;
      if (slope > max) max = slope;
    }
  }
  return max;
}

/**
 * Read a dump as rejector cases.
 *
 * The configured weight comes from {@link weightCensusOf}, which owns the theorem that a gated name's recorded zero
 * is a decision and its recorded maximum is the configuration. Reading it here a second way would be a third
 * definition of the number every arm is measured against.
 *
 * @param cases - The dump.
 * @param term - The gated term's name.
 * @returns One row per case, in dump order.
 * @throws When the dump does not record the term at all, because a frontier over a term no case carries is not a
 * measurement of zero.
 */
export function rejectorCasesOf(cases: readonly ParsedTermCase[], term: string): RejectorCase[] {
  const row = weightCensusOf(cases).names.find((name) => name.name === term);
  if (row === undefined || row.recorded === 0) throw new Error(`no case records ${term}`);
  const configured = row.configured;
  return cases.map((kase) => {
    const ids = kase.candidates.map((candidate) => candidate.id);
    const accepted = new Set(kase.accepted);
    const offScores = scoresUnder(kase, term, 'off', configured);
    const onScores = scoresUnder(kase, term, 'on', configured);
    const off: StrictReading = readScores(ids, accepted, offScores);
    const on: StrictReading = readScores(ids, accepted, onScores);
    const lead = leadOf(offScores);
    const reachOfSlope = reachOfTerm(kase, term);
    const span = configured * reachOfSlope;
    // The denominator is the term's own reach. A zero span is not a small reach: it is the absence of one, and
    // `lead / 0` would be `Infinity` only by accident of the division rather than by the statement being made.
    const reach = span > 0 ? lead / span : Infinity;
    let shipped = false;
    for (const candidate of kase.candidates) {
      for (const [name, weight] of candidate.terms) if (name === term && weight === configured) shipped = true;
    }
    return {
      datapack: kase.datapack,
      faultType: kase.faultType,
      lead,
      reach,
      shipped,
      off: off.answers,
      on: on.answers,
    };
  });
}

/**
 * For one case, whether a bound admits it: the run's own admissions are a FLOOR, not a competitor.
 *
 * This composition is the whole design of the arm. A gate change that had to re-earn the run's admissions would be
 * measured on a different population than the one it ships to, and the run's own decisions are already paid for.
 *
 * The comparison is INCLUSIVE, and the arithmetic is why: {@link boundOf} returns a block's own upper reach, so a rule
 * that excluded equality would refuse the very cases the block was fitted on. A reach that is not finite is excluded
 * outright — a case with no rival, or one whose term was never measured, is not a case a reach bound has an opinion
 * about, and `Infinity <= Infinity` would otherwise admit it.
 *
 * @param row - One case.
 * @param bound - The largest reach the term may act on.
 * @returns Whether the term acts here.
 */
function admitsAt(row: RejectorCase, bound: number): boolean {
  return row.shipped || (Number.isFinite(row.reach) && row.reach <= bound);
}

/**
 * Tally one partition of cases under one admission rule.
 *
 * @param rows - The cases.
 * @param admits - The admission rule.
 * @returns The per-family [cases, answers] of the whole partition, and the [cases, answers] of the run.
 */
function tally(
  rows: readonly RejectorCase[],
  admits: (row: RejectorCase) => boolean,
): { total: number; families: Map<string, { cases: number; answers: number; run: number }> } {
  const families = new Map<string, { cases: number; answers: number; run: number }>();
  let total = 0;
  for (const row of rows) {
    const tallyOf = families.get(row.faultType) ?? { cases: 0, answers: 0, run: 0 };
    tallyOf.cases += 1;
    const answer = admits(row) ? row.on : row.off;
    if (answer) {
      total += 1;
      tallyOf.answers += 1;
    }
    // The run's own reading is per case: an admission the run did not make cannot have contributed to it.
    if (row.shipped ? row.on : row.off) tallyOf.run += 1;
    families.set(row.faultType, tallyOf);
  }
  return { total, families };
}

/**
 * The families that lose a case against the run, worst first.
 *
 * @param families - One partition's tally, from {@link tally}.
 * @returns The regressed families and their total cost.
 */
function regressionsOf(families: Map<string, { cases: number; answers: number; run: number }>): {
  regressed: FamilyLoss[];
  loss: number;
} {
  const regressed: FamilyLoss[] = [];
  let loss = 0;
  for (const [faultType, entry] of families) {
    const delta = entry.answers - entry.run;
    if (delta >= 0) continue;
    regressed.push({ faultType, delta });
    loss += -delta;
  }
  // Worst first, then by name: two runs of the same command must print the same table, and a tie in magnitude is
  // otherwise resolved by `Map` insertion order, which is dump order.
  regressed.sort((a, b) => a.delta - b.delta || (a.faultType < b.faultType ? -1 : 1));
  return { regressed, loss };
}

/**
 * The run's own total: the cases the coefficients the dump recorded answer.
 *
 * Exported because three readers print it — the frontier's deltas, the out-of-fold table's baseline and the CLI's
 * header — and a baseline computed three ways is a baseline that can disagree with itself.
 *
 * @param rows - The cases.
 * @returns The cases the run answered.
 */
export function runTotalOf(rows: readonly RejectorCase[]): number {
  return tally(rows, (row) => row.shipped).total;
}

/**
 * The whole frontier: one point per bound.
 *
 * @param rows - The cases, from {@link rejectorCasesOf}.
 * @param bounds - The bounds to read; {@link DEFAULT_REACH_BOUNDS} when omitted.
 * @returns One point per bound, in the order given.
 */
export function frontierOf(
  rows: readonly RejectorCase[],
  bounds: readonly number[] = DEFAULT_REACH_BOUNDS,
): FrontierPoint[] {
  const runTotal = runTotalOf(rows);
  return bounds.map((bound) => {
    const { total, families } = tally(rows, (row) => admitsAt(row, bound));
    const { regressed, loss } = regressionsOf(families);
    let admitted = 0;
    let helps = 0;
    let hurts = 0;
    for (const row of rows) {
      if (!admitsAt(row, bound)) continue;
      admitted += 1;
      // The run's own admissions are not this rule's doing, so their outcomes are counted neither way: a point that
      // took credit for what already shipped would report a gain no bound can be held to.
      if (row.shipped) continue;
      if (row.on && !row.off) helps += 1;
      else if (row.off && !row.on) hurts += 1;
    }
    return { bound, cases: total, delta: total - runTotal, admitted, helps, hurts, regressed, loss };
  });
}

/**
 * The best point the standing acceptance condition allows, and the best point outright.
 *
 * "No regressed fault type" is the condition every term in this repository was admitted under, so a point that
 * violates it is not a candidate however many cases it buys. When no point satisfies it, the caller must see that as
 * a MEASUREMENT — `allowed: null` plus the cheapest violation — rather than as an empty list, because "the condition
 * could not be met" and "the grid was empty" are different findings.
 *
 * @param frontier - The points.
 * @returns The best admissible point (most cases, earliest on a tie) and the best point of any kind.
 */
export function constrainedOf(frontier: readonly FrontierPoint[]): {
  allowed: FrontierPoint | null;
  best: FrontierPoint | null;
} {
  let allowed: FrontierPoint | null = null;
  let best: FrontierPoint | null = null;
  for (const point of frontier) {
    if (best === null || point.cases > best.cases) best = point;
    if (point.regressed.length > 0) continue;
    if (allowed === null || point.cases > allowed.cases) allowed = point;
  }
  return { allowed, best };
}

/**
 * The isotonic calibration of `p(fixes | reach)`, by pool-adjacent-violators.
 *
 * The statistic is the reach, the outcome is "the term fixed this case", the fitted curve is non-increasing in
 * the reach, and only the DECISION cases contribute:
 * a case both arms answer, or neither, says nothing about whether acting was right and would drag every block toward
 * the corpus's base rate. Ties are aggregated by reach before pooling, so a block is a set of cases rather than a
 * set of rows.
 *
 * @param rows - The cases.
 * @returns The blocks, in reach order. Empty when no case's outcome depends on the term.
 */
export function calibrationOf(rows: readonly RejectorCase[]): CalibrationBlock[] {
  const byReach = new Map<number, { fixes: number; cases: number }>();
  for (const row of rows) {
    if (!Number.isFinite(row.reach)) continue;
    if (row.off === row.on) continue;
    const entry = byReach.get(row.reach) ?? { fixes: 0, cases: 0 };
    entry.cases += 1;
    if (row.on) entry.fixes += 1;
    byReach.set(row.reach, entry);
  }
  const points = [...byReach.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([reach, entry]) => ({ lo: reach, hi: reach, fixes: entry.fixes, cases: entry.cases }));
  // Pooling: `p` must not RISE with the reach — a term that acts on a case it cannot overturn is acting on nothing —
  // so a block below its successor is the violation and the two merge. `fixes` and `cases` are sums, so the pooled
  // value is the block's own mean and not a mean of means; the index steps BACK after a merge, because the merged
  // block can now be above the one before it.
  let index = 0;
  while (index < points.length - 1) {
    const here = points[index]!;
    const next = points[index + 1]!;
    if (here.fixes / here.cases >= next.fixes / next.cases) {
      index += 1;
      continue;
    }
    points[index] = {
      lo: here.lo,
      hi: next.hi,
      fixes: here.fixes + next.fixes,
      cases: here.cases + next.cases,
    };
    points.splice(index + 1, 1);
    if (index > 0) index -= 1;
  }
  return points.map((block) => ({ lo: block.lo, hi: block.hi, p: block.fixes / block.cases, cases: block.cases }));
}

/**
 * The Chow bound for one exchange rate: the largest reach whose calibrated posterior still clears the bar.
 *
 * Chow's rule, in the form this module uses it: acting is optimal when `p · benefit > (1 − p) · cost`, i.e. when
 * `p > cost / (1 + cost)` — so a rate of `1` is the symmetric verdict, a rate of `3` demands three quarters
 * confidence, and a rate of `0` admits everything. The parameter is the price of one broken case in units of one
 * fixed case, which is the only quantity the decision depends on.
 *
 * `-1` when the first block already fails the bar, which is the honest encoding of "act on nothing": a bound of `0`
 * would admit the cases at reach `0`, and those are exactly the cases the calibration refused.
 *
 * @param blocks - The calibration.
 * @param rate - The cost of a wrong action in units of a right one; see above.
 * @returns The bound, or `-1` when no reach clears the bar.
 */
export function boundOf(blocks: readonly CalibrationBlock[], rate: number): number {
  const exchange = Number.isFinite(rate) && rate >= 0 ? rate : 1;
  const bar = exchange / (1 + exchange);
  let bound = -1;
  for (const block of blocks) if (block.p >= bar) bound = block.hi;
  return bound;
}

/**
 * Fit the bound on four folds and spend it on the fifth, with the fold assignment the discriminator already uses.
 *
 * Two splits of one corpus is the defect class this record keeps finding, so the assignment is
 * `foldOf(datapack, folds)` — the same one `holdoutDirectionReport` and the discriminator read.
 *
 * @param rows - The cases.
 * @param folds - How many folds; 5 by default.
 * @param rate - The exchange rate handed to {@link boundOf}; `1` by default, which is the symmetric verdict.
 * @returns The per-fold verdicts and their totals.
 */
export function chowReport(rows: readonly RejectorCase[], folds = 5, rate = 1): ChowReport {
  const verdicts: ChowFold[] = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const training = rows.filter((row) => foldOf(row.datapack, folds) !== fold);
    const testing = rows.filter((row) => foldOf(row.datapack, folds) === fold);
    const bound = boundOf(calibrationOf(training), rate);
    const { total, families } = tally(testing, (row) => admitsAt(row, bound));
    const { regressed, loss } = regressionsOf(families);
    // The run's total comes off the same tally that produced the answers, so a fold cannot be read against a baseline
    // a different loop computed.
    let baseline = 0;
    for (const entry of families.values()) baseline += entry.run;
    verdicts.push({ fold, bound, heldOut: total, baseline, delta: total - baseline, regressed, loss });
  }
  return {
    folds: verdicts,
    bounds: verdicts.map((verdict) => verdict.bound),
    heldOut: verdicts.reduce((sum, verdict) => sum + verdict.heldOut, 0),
    baseline: verdicts.reduce((sum, verdict) => sum + verdict.baseline, 0),
    delta: verdicts.reduce((sum, verdict) => sum + verdict.delta, 0),
    loss: verdicts.reduce((sum, verdict) => sum + verdict.loss, 0),
  };
}

/**
 * A delta with its sign, which is the only rendering this module ever needs of one.
 *
 * @param value - The delta.
 * @returns `+3`, `-1` or `0`.
 */
function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

/**
 * Render the frontier as the table a reader can check the claim against.
 *
 * @param frontier - The points.
 * @param runTotal - The run's own total, for the header that says what every delta is against.
 * @returns The report.
 */
export function formatFrontier(frontier: readonly FrontierPoint[], runTotal: number): string {
  const lines = [`run ${runTotal}   bounds ${frontier.length}`, '', '  reach  cases   delta  admitted  helps  hurts  loss  regressed'];
  for (const point of frontier) {
    const families = point.regressed.map((loss) => `${loss.faultType} ${loss.delta}`).join(', ');
    lines.push(
      `  ${point.bound.toFixed(2).padStart(5)}  ${String(point.cases).padStart(5)}  ` +
        `${signed(point.delta).padStart(6)}  ${String(point.admitted).padStart(8)}  ` +
        `${String(point.helps).padStart(5)}  ${String(point.hurts).padStart(5)}  ` +
        `${String(point.loss).padStart(4)}  ${families}`,
    );
  }
  const { allowed, best } = constrainedOf(frontier);
  lines.push('');
  // An admissible point cannot have a negative delta: the total is a sum over families, so every family at or above
  // the run's count forces the sum to be too. The line still prints through `signed`, so the two renderings of a
  // delta have one owner rather than two.
  lines.push(
    allowed === null
      ? 'no bound clears the standing condition (no regressed fault type)'
      : `admissible best: reach < ${allowed.bound} answers ${allowed.cases} (${signed(allowed.delta)})`,
  );
  if (best !== null && best !== allowed) {
    lines.push(
      `unconstrained best: reach < ${best.bound} answers ${best.cases} (${signed(best.delta)}), ` +
        `price ${best.loss}`,
    );
  }
  return lines.join('\n');
}

/**
 * Render the out-of-fold reading.
 *
 * @param report - The report.
 * @returns The report text.
 */
export function formatChow(report: ChowReport): string {
  const lines = [
    `folds ${report.folds.length}   held-out ${report.heldOut}   run ${report.baseline}   ` +
      `delta ${signed(report.delta)}   loss ${report.loss}`,
    `bounds chosen: ${report.bounds.map((bound) => (bound < 0 ? 'none' : bound.toFixed(3))).join(', ')}`,
    '',
    '  fold  bound  held-out   run  delta  loss  regressed',
  ];
  for (const verdict of report.folds) {
    const families = verdict.regressed.map((loss) => `${loss.faultType} ${loss.delta}`).join(', ');
    lines.push(
      `  ${String(verdict.fold).padStart(4)}  ${(verdict.bound < 0 ? 'none' : verdict.bound.toFixed(2)).padStart(5)}  ` +
        `${String(verdict.heldOut).padStart(8)}  ${String(verdict.baseline).padStart(4)}  ` +
        `${signed(verdict.delta).padStart(5)}  ${String(verdict.loss).padStart(4)}  ${families}`,
    );
  }
  return lines.join('\n');
}

/** The command's flags, after parsing. */
interface RejectorArgs {
  readonly terms: string;
  readonly term: string;
  readonly folds: number;
  readonly rate: number;
}

/**
 * Parse the command line.
 *
 * @param argv - The arguments after the script name.
 * @returns The flags.
 * @throws When a required flag is missing or a number is not one.
 */
export function parseRejectorArgs(argv: readonly string[]): RejectorArgs {
  let terms = '';
  let term = 'failedEdge';
  let folds = 5;
  let rate = 1;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    const value = argv[index + 1];
    switch (flag) {
      case '--terms':
        if (value === undefined) throw new Error('--terms needs a path');
        terms = value;
        index += 1;
        break;
      case '--term':
        if (value === undefined) throw new Error('--term needs a name');
        term = value;
        index += 1;
        break;
      case '--folds': {
        if (value === undefined) throw new Error('--folds needs a number');
        folds = Number.parseInt(value, 10);
        if (!Number.isInteger(folds) || folds < 1) throw new Error('--folds must be a positive integer');
        index += 1;
        break;
      }
      case '--rate': {
        if (value === undefined) throw new Error('--rate needs a number');
        rate = Number.parseFloat(value);
        if (!Number.isFinite(rate) || rate < 0) throw new Error('--rate must be a non-negative number');
        index += 1;
        break;
      }
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  if (terms === '') throw new Error('--terms is required');
  return { terms, term, folds, rate };
}
