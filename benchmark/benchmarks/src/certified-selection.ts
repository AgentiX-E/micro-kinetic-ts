/**
 * The certificate a selection can carry: what a ranking table may claim about the row it tells you to ship.
 *
 * ## What this module refuses to do
 *
 * A screen prints every row and a reader ships one. The row was named **after looking at the data**, so a certificate
 * computed for it as though it had been named in advance is a certificate about a hypothesis nobody formulated — the
 * winner's curse, and the one defect a ranking table cannot show you, because the table's own best row is the row the
 * bias is about.
 *
 * The correction is multiplicity, on the axis the previous module did not have. `risk-control.ts` pays for the `F`
 * families a claim covers; this module also pays for the `M` candidates the selection looked at, by reading the level
 * at `δ/M` — Bonferroni's adjustment, which is what Benjamini & Yekutieli (JRSS-B 67, 2005) apply to intervals built
 * around selected parameters, and which is exact rather than asymptotic. It is also the conservative end: the same
 * family of procedures has tighter members (false-coverage-rate control with selection performed on the calibration
 * set, Bao, Huo, Ren & Zou, *Biometrika* 111, 2024), and they buy their tightness by splitting the corpus rather than
 * by a better inequality. A split has a cost this repository can measure — `floorOf` in `risk-control.ts` shows the
 * count a family costs is nearly invariant to `n` — so the split is the next step rather than this one, and the level
 * this module reads is the one that needs no split.
 *
 * ## What it measures
 *
 * Three different "best" rows, because a table has three readers and they are not the same reader:
 *
 *   - **most cases** — the point estimate, which is what a table sorted by accuracy already tells you;
 *   - **tightest claim** — the row whose certified budget is smallest, which is the row a reader who must not regress a
 *     family can defend;
 *   - **best price** — cases bought per budget unit conceded, which is the only one of the three that says what the
 *     concession bought. On the fixture this is what separates a row worth +20 for 8 budget units (2.50 each) from a
 *     row worth +5 for 1 (5.00 each): the table's best row is the first, the best buy is the second.
 *
 * ## What it does not do
 *
 * It does not choose. The verdict on each row is a statement about the corpus — `improvement`, `concession`, `regress`,
 * `flat`, or `unclaimed` when the population states no claim — and which of them to ship stays a decision with a cost
 * the caller owns. That is the same division `gate-rejector.ts` keeps between the frontier and the gate: this module
 * prices, nothing here adopts.
 *
 * @module benchmarks/certified-selection
 */

import type { Correction, FamilyRisk, LossCount, RiskPopulation } from './risk-control.js';
import { DEFAULT_DELTA, certifyLosses } from './risk-control.js';

/** What one row is, relative to the row that ships today. */
export type Verdict =
  /** More cases at a claim no wider than the shipped row's. Nothing was conceded. */
  | 'improvement'
  /** More cases at a wider claim. `price` says what each conceded budget unit bought. */
  | 'concession'
  /** Fewer cases. */
  | 'regress'
  /** The same cases for a wider claim: no gain and something given away. */
  | 'flat'
  /** The row that ships today: the comparison everything else is against. */
  | 'unchanged'
  /** The population states no claim, so no verdict about a claim can be given. */
  | 'unclaimed';

/** One candidate as the instrument measured it: what it answers, and which families it pays. */
export interface CandidateReading {
  /** What the row is called in the table it came from. */
  readonly label: string;
  /** Cases answered, over the whole corpus. */
  readonly cases: number;
  /** Families that lose a case, every family — not only those above a verdict's floor. */
  readonly losses: readonly LossCount[];
}

/** One candidate, priced. */
export interface Certification {
  readonly label: string;
  readonly cases: number;
  /** Cases minus the shipped row's cases. */
  readonly delta: number;
  /** The smallest per-family loss budget the corpus cannot refute, or `null` when no claim can be stated. */
  readonly budget: number | null;
  /** The family that binds at that budget. */
  readonly worst: FamilyRisk | null;
  /** Cases bought per budget unit conceded; `null` unless the row is a `concession`. */
  readonly price: number | null;
  readonly verdict: Verdict;
}

/** A whole selection, priced. */
export interface CertifiedSelection {
  /** The family-wise level the selection was read at. */
  readonly delta: number;
  /** The rule the level was split by. */
  readonly correction: Correction;
  /** How many candidates the level paid for. */
  readonly examined: number;
  /** The corpus the rows were measured on: what every budget in the table is a share of. */
  readonly population: RiskPopulation;
  /** The shipped row first, then the candidates in the order they arrived. */
  readonly readings: readonly Certification[];
  /** The row answering the most cases, ties to the tighter claim. */
  readonly pointBest: Certification | null;
  /** The row with the smallest certified budget, ties to the more cases. */
  readonly tightest: Certification | null;
  /** The row buying the most cases per budget unit conceded. */
  readonly bestValue: Certification | null;
}

/** How a selection is read. */
export interface SelectionOptions {
  /** The family-wise level. Defaults to the module-wide one. */
  readonly delta?: number;
  /** The rule the level is split by. Holm by default: exact, and never wider than the union bound. */
  readonly correction?: Correction;
  /**
   * How many candidates the selection looked at, which the level pays for.
   *
   * Defaults to the number of candidates supplied, because a caller that hands over `M` rows and takes one has looked
   * at `M`. A caller that selected on one part of the corpus and certifies on another states `1` here — that is what
   * makes the second reading a certificate rather than a second look at the same data.
   */
  readonly examined?: number;
}

/** A count of looks, read the way `risk-control.ts` reads one: malformed is one, not zero. */
function looksOf(supplied: number | undefined, fallback: number): number {
  if (supplied === undefined) return fallback < 1 ? 1 : Math.floor(fallback);
  if (!Number.isFinite(supplied) || supplied < 1) return 1;
  return Math.floor(supplied);
}

/**
 * Price one row against the shipped one.
 *
 * The shipped row needs no case of its own: it answers its own count, so its delta is zero and the rule below returns
 * `unchanged` for it — which is why there is no "is this the shipped row" parameter here. There used to be one, and it
 * was dead: a row told apart by its identity rather than by its numbers cannot say anything the numbers do not.
 */
function verdictOf(
  cases: number,
  budget: number | null,
  shippedCases: number,
  shippedBudget: number | null,
): { verdict: Verdict; price: number | null } {
  // The claim is checked before the row is: a corpus that cannot state one leaves nothing to be unchanged about, and a
  // shipped row reported as `unchanged` inside a table of unclaimed rows reads as the one row that was priced. The two
  // nulls are separated because they mean different things — a shipped row no corpus can price leaves every other row
  // without a reference, while an unpriced candidate still has one.
  if (shippedBudget === null) return { verdict: 'unclaimed', price: null };
  if (budget === null) return { verdict: 'unclaimed', price: null };
  const delta = cases - shippedCases;
  if (delta < 0) return { verdict: 'regress', price: null };
  if (delta === 0) return { verdict: budget > shippedBudget ? 'flat' : 'unchanged', price: null };
  if (budget <= shippedBudget) return { verdict: 'improvement', price: null };
  return { verdict: 'concession', price: delta / (budget - shippedBudget) };
}

/**
 * Price a selection.
 *
 * The shipped row is part of the selection rather than a reference outside it: "ship what already ships" is one of the
 * rows a reader may take, and leaving it out of the level's denominator would let a table pay for `M − 1` looks while
 * having taken `M`.
 *
 * @param population - The corpus the rows were measured on.
 * @param shipped - The row that ships today.
 * @param candidates - Every other row the screen printed.
 * @param options - The level, the rule and how many looks the level pays for.
 * @returns The selection, priced: shipped first, then the candidates in order.
 */
export function selectCertified(
  population: RiskPopulation,
  shipped: CandidateReading,
  candidates: readonly CandidateReading[],
  options: SelectionOptions = {},
): CertifiedSelection {
  const delta = options.delta ?? DEFAULT_DELTA;
  const correction = options.correction ?? 'holm';
  const examined = looksOf(options.examined, candidates.length);
  const price = (reading: CandidateReading): Certification => {
    const claim = certifyLosses(reading.losses, population, delta, correction, examined);
    return {
      label: reading.label,
      cases: reading.cases,
      delta: reading.cases - shipped.cases,
      budget: claim === null ? null : claim.budget,
      worst: claim === null ? null : claim.worst,
      price: null,
      verdict: 'unclaimed',
    };
  };
  const rows = [shipped, ...candidates];
  const priced = rows.map(price);
  const [shippedRow] = priced;
  const readings = priced.map((entry) => {
    const verdict = verdictOf(entry.cases, entry.budget, shipped.cases, shippedRow!.budget);
    return { ...entry, verdict: verdict.verdict, price: verdict.price };
  });

  // A table with no claim names no winner: "most cases" over rows nothing was certified for is the reading this module
  // exists to refuse, and a footer that names one anyway would be the only part of the report left to misread.
  const claimless = readings.every((entry) => entry.verdict === 'unclaimed');
  let pointBest: Certification | null = null;
  let tightest: Certification | null = null;
  let bestValue: Certification | null = null;
  for (const entry of claimless ? [] : readings) {
    // An unclaimed row wins nothing: it is a row the corpus could not price, so it cannot be the tightest claim or the
    // most cases, and letting it hold a slot would make the winner a function of what could not be measured.
    if (entry.budget === null) continue;
    // `!` on the budgets because the guard above dropped every row that has none, and a default here would be an order
    // invented for a row the corpus refused to price.
    if (
      pointBest === null ||
      entry.cases > pointBest.cases ||
      (entry.cases === pointBest.cases && entry.budget! < pointBest.budget!)
    ) {
      pointBest = entry;
    }
    if (
      tightest === null ||
      entry.budget! < tightest.budget! ||
      (entry.budget === tightest.budget && entry.cases > tightest.cases)
    ) {
      tightest = entry;
    }
    if (entry.price === null) continue;
    if (
      bestValue === null ||
      entry.price > bestValue.price! ||
      (entry.price === bestValue.price! && entry.cases > bestValue.cases)
    ) {
      bestValue = entry;
    }
  }
  return { delta, correction, examined, population, readings, pointBest, tightest, bestValue };
}

/** A count rendered with its sign, the way every table in this repository renders one. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** A row's price, at the precision a comparison needs and no more. */
function priceText(price: number | null): string {
  return price === null ? '—' : price.toFixed(3);
}

/**
 * Render a selection.
 *
 * The claim comes first — level, correction, corpus and the number of looks it paid for — because a budget without its
 * level is a number, and a level without its multiplicity is the estimate this module was written to stop publishing.
 *
 * @param selection - The selection, from {@link selectCertified}.
 * @returns The table, newline-separated, no trailing newline.
 */
export function formatSelection(selection: CertifiedSelection): string {
  const lines = [
    `selective certificate — n ${selection.population.n}   families ${selection.population.families.length}   ` +
      `delta ${selection.delta}   correction ${selection.correction}   examined ${selection.examined}`,
    '',
    '  candidate        cases   delta  budget  worst            lost     upper  price   verdict',
  ];
  for (const entry of selection.readings) {
    const worst = entry.worst;
    lines.push(
      `  ${entry.label.padEnd(15)} ${String(entry.cases).padStart(6)} ${signed(entry.delta).padStart(6)}  ` +
        `${(entry.budget === null ? '—' : String(entry.budget)).padStart(6)}  ` +
        `${(worst === null ? '—' : worst.faultType).padEnd(15)}  ` +
        `${(worst === null ? '—' : String(worst.lost)).padStart(4)}  ` +
        `${(worst === null ? '—' : worst.upper.toFixed(6)).padStart(8)}  ` +
        `${priceText(entry.price).padStart(6)}  ${entry.verdict}`,
    );
  }
  lines.push('');
  const winners: string[] = [];
  if (selection.pointBest !== null) {
    winners.push(`most cases: ${selection.pointBest.label} (${selection.pointBest.cases})`);
  }
  if (selection.tightest !== null && selection.tightest.budget !== null) {
    winners.push(`tightest claim: ${selection.tightest.label} (${selection.tightest.budget})`);
  }
  if (selection.bestValue !== null) {
    winners.push(
      `best price: ${selection.bestValue.label} (${priceText(selection.bestValue.price)} cases per budget unit)`,
    );
  }
  if (winners.length > 0) lines.push(winners.join('   '));
  const improved = selection.readings.filter((entry) => entry.verdict === 'improvement');
  if (improved.length > 0) {
    const best = improved.reduce((most, entry) => (entry.cases > most.cases ? entry : most));
    lines.push(
      `certified improvement: ${best.label} answers ${signed(best.delta)} at the shipped claim of ` +
        `${best.budget} — nothing was conceded`,
    );
  } else if (selection.readings.some((entry) => entry.verdict === 'unclaimed')) {
    lines.push('no claim can be stated: the population names no family to hold a budget against');
  } else {
    lines.push('no certified improvement: no candidate buys a case without conceding budget');
  }
  return lines.join('\n');
}
