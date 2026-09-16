/**
 * Which dump-visible signal prefers the TRUE source over the engine's wrong rank-1?
 *
 * The register's own instruction for this axis is explicit: the remaining lever is a
 * context feature finer than the fault type, and "a candidate here must name the context
 * feature and **show it separates, on a free read, before any run**". Every feature named
 * so far was measured one at a time against a marginal statistic — how often a source
 * carries a latency rise (9.3%), how much of its inventory a guard discards (44%) — and a
 * marginal statistic cannot say whether a feature prefers the source to the specific service
 * that beat it. Two services in one case can both carry the feature, or neither, and the
 * case is still decided one way.
 *
 * So this module asks the PAIRED question, for every signal a dump carries:
 *
 *   for each wrong case, does the signal rank the source above the engine's rank-1?
 *
 * Three properties make the answer usable rather than decorative:
 *
 * 1. **It is paired and within-type.** The unit is one case's `(source, winner)`, and the
 *    per-type table is printed beside the total, because a global rate says nothing about
 *    the type it is wrong on — and a fault type is the unit that can regress.
 * 2. **`unmeasurable` is a third outcome, never a loss.** A signal that cannot measure one
 *    side is reported as `n/a` and left OUT of the rate, with its count printed. Reading
 *    "not measured" as "the source lost" is the defect class this analyzer exists to catch.
 * 3. **The criterion is pre-registered, in the code, and applied as written.** A signal is a
 *    candidate only if it is not a `term` (the register closes every axis that is a function
 *    of a service's OWN score), it clears the AUC bar over enough pairs, and it points the
 *    right way on every fault type large enough to matter. Everything else is recorded as
 *    "does not separate", which is itself the measurement this axis needs.
 *
 * @module benchmarks/fse26-separator
 */

import { DEFAULT_LAT_MIN_RISE } from '../../packages/tree/src/index.js';

import type { DiagnosedCase, DiagnosedService } from './fse26-diagnose-analyze.js';
// The FOLD ASSIGNMENT is imported rather than re-derived: two modules that split the same dump
// differently would each hold out a different fifth of it while both calling it "held out".
import { foldOf } from './fse26-discriminator.js';
import { latencySlopes, onsetSlopes } from './fse26-term-oracle.js';

/**
 * Which class of evidence a signal belongs to.
 *
 * The distinction is load-bearing rather than cosmetic: `term` covers the quantities the
 * engine already scores, and the register's closing condition for those axes is "the
 * candidate is NOT a function of that service's own metric score" — so a screen that could
 * hand one back as a candidate would reopen them through the side door. The other four are
 * the context classes a per-case decision could legitimately read.
 */
export type SeparatorRole = 'term' | 'inventory' | 'evidence' | 'time' | 'topology';

/** What a signal may look at: the case, and the two maps the engine's terms are built from. */
export interface SeparatorSubject {
  readonly kase: DiagnosedCase;
  readonly latSlopes: ReadonlyMap<string, number>;
  readonly onsetSlopes: ReadonlyMap<string, number>;
}

/** One service, one number, plus the direction that makes the number evidence FOR the source. */
export interface SeparatorScalar {
  readonly name: string;
  readonly role: SeparatorRole;
  /** `1` when a LARGER value is the source's evidence, `-1` when a smaller one is. */
  readonly direction: 1 | -1;
  /**
   * The value, or `undefined` when the dump cannot answer for this service.
   *
   * `undefined` is reserved for a field that is genuinely absent — an older dump, or an
   * inventory the block did not render. A field the ENGINE scored is never `undefined`: the
   * ranking reads `latScore ?? 0` and `onsetSlope ?? 0`, so a reader that invented an `n/a`
   * there would be measuring a different engine from the one that produced the ranking.
   */
  readonly of: (service: DiagnosedService, subject: SeparatorSubject) => number | undefined;
}

/** The two services a wrong case is decided between. */
export interface SeparatorPair {
  readonly datapack: string;
  readonly faultType: string;
  /** The case's source, as {@link sourceOf} defines it. */
  readonly source: DiagnosedService;
  /** The engine's rank-1, which is NOT an acceptable root — the pair exists only for misses. */
  readonly winner: DiagnosedService;
}

/** Which side a signal's evidence favours, or why it cannot say. */
export type Preference = 'source' | 'winner' | 'tie' | 'unmeasurable';

/** A signal reduces a pair to a preference. Both kinds of feature end up here. */
export interface SeparatorSignal {
  readonly name: string;
  readonly role: SeparatorRole;
  readonly prefers: (pair: SeparatorPair, subject: SeparatorSubject) => Preference;
}

/**
 * Turn a per-service scalar into a pair preference.
 *
 * The comparison is by VALUE, not by rank: a signal is screened as a possible additive or
 * gating term, and both act on the number the dump prints. Equal values are a tie rather than
 * a win for whichever side happens to be listed first.
 */
export function fromScalar(scalar: SeparatorScalar): SeparatorSignal {
  return {
    name: scalar.name,
    role: scalar.role,
    prefers: (pair, subject) => {
      const source = scalar.of(pair.source, subject);
      const winner = scalar.of(pair.winner, subject);
      if (source === undefined || winner === undefined) return 'unmeasurable';
      const delta = (source - winner) * scalar.direction;
      if (delta > 0) return 'source';
      if (delta < 0) return 'winner';
      return 'tie';
    },
  };
}

/** The transient-return guard's word, as the engine writes it. */
const TRANSIENT_OUTCOME = 'transient-return';

/** A service's rendered inventory, reduced to the four numbers a signal can read. */
interface Inventory {
  readonly kept: number;
  readonly transient: number;
  /** The strongest deviation among the KEPT metrics — a lower bound, as the block is brief. */
  readonly bestDev: number;
  readonly bestRise: number;
}

/**
 * Read a service's rendered metric inventory.
 *
 * `undefined` when the block rendered none for this service, which is a different statement
 * from an inventory of nothing: `metricOutcomes` is absent when the formatter chose not to
 * print the line or the printed list was truncated, and a short list is reported as absent
 * rather than as a small one.
 */
function inventoryOf(service: DiagnosedService): Inventory | undefined {
  const outcomes = service.metricOutcomes;
  if (outcomes === undefined) return undefined;
  let kept = 0;
  let transient = 0;
  let bestDev = 0;
  let bestRise = 0;
  for (const outcome of outcomes) {
    if (outcome.outcome === TRANSIENT_OUTCOME) {
      transient++;
      continue;
    }
    if (outcome.outcome !== 'kept') continue;
    kept++;
    const deviation = outcome.breakdown?.deviation ?? 0;
    if (deviation > bestDev) bestDev = deviation;
    const rise = outcome.breakdown?.riseRatio ?? 0;
    if (rise > bestRise) bestRise = rise;
  }
  return { kept, transient, bestDev, bestRise };
}

/**
 * A case's SOURCE, by one rule.
 *
 * Multi-root cases exist — a fault declared on a group — and the source is the one the
 * engine itself would rank highest among them: self-anomaly descending, id ascending, the
 * same comparator the printer uses. Picking "the first" instead would make the answer depend
 * on the dump's row order, and two modules picking differently is how two documents come to
 * disagree about the same case.
 *
 * @param kase - One parsed case.
 * @returns The source, or `undefined` when no ground-truth service is in the dump's list.
 */
export function sourceOf(kase: DiagnosedCase): DiagnosedService | undefined {
  let best: DiagnosedService | undefined;
  for (const service of kase.services) {
    if (service.serviceId === '') continue;
    if (!kase.groundTruth.includes(service.serviceId)) continue;
    if (
      best === undefined ||
      service.selfAnomaly > best.selfAnomaly ||
      (service.selfAnomaly === best.selfAnomaly && service.serviceId < best.serviceId)
    ) {
      best = service;
    }
  }
  return best;
}

/** The call graph as caller → callees; `undefined` when the dump recorded no graph. */
function adjacencyOf(edges: readonly string[] | undefined): Map<string, string[]> | undefined {
  if (edges === undefined) return undefined;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const separator = edge.indexOf('>');
    if (separator <= 0) continue;
    const caller = edge.slice(0, separator);
    const callee = edge.slice(separator + 1);
    const list = adjacency.get(caller);
    if (list === undefined) adjacency.set(caller, [callee]);
    else list.push(callee);
  }
  return adjacency;
}

/**
 * Whether `from` reaches `to` by following call edges; `undefined` without a graph.
 *
 * `from` and `to` are the two sides of a miss, which are always different services: the pair is
 * built only when the engine's rank-1 is NOT an acceptable root, so a service can never be asked
 * about itself. There is deliberately no `from === to` arm — it would be code no caller could
 * reach, and the caller's invariant is stated here rather than defended twice.
 */
function reaches(
  from: string,
  to: string,
  adjacency: Map<string, string[]> | undefined,
): boolean | undefined {
  if (adjacency === undefined) return undefined;
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** A service's inbound call edges, or `undefined` when the dump recorded no graph. */
function inDegreeOf(
  serviceId: string,
  adjacency: Map<string, string[]> | undefined,
): number | undefined {
  if (adjacency === undefined) return undefined;
  let degree = 0;
  for (const callees of adjacency.values()) {
    for (const callee of callees) if (callee === serviceId) degree++;
  }
  return degree;
}

/**
 * The declared signals — everything a dump can say about one service's evidence.
 *
 * Stated as data so a report can name the signal it chose, and so the set can be diffed
 * against the fields the dump carries: a field nobody screens is a measurement nobody ran.
 */
export const SEPARATOR_SCALARS: readonly SeparatorScalar[] = [
  // The engine's own terms. Reported, never promotable — see `SeparatorRole`.
  { name: 'metric', role: 'term', direction: 1, of: (service) => service.selfAnomaly },
  { name: 'log', role: 'term', direction: 1, of: (service) => service.logScore },
  {
    name: 'lat',
    role: 'term',
    direction: 1,
    of: (service, subject) => subject.latSlopes.get(service.serviceId) ?? 0,
  },
  {
    name: 'temporal',
    role: 'term',
    direction: 1,
    of: (service, subject) => subject.onsetSlopes.get(service.serviceId) ?? 0,
  },
  { name: 'failedEdge', role: 'term', direction: 1, of: (service) => service.failedEdgeScore },
  // What the engine's guards DID to the service's own inventory.
  { name: 'kept', role: 'inventory', direction: 1, of: (service) => inventoryOf(service)?.kept },
  {
    name: 'transientDrops',
    role: 'inventory',
    // A source's signature should SURVIVE its own guards, so fewer drops is its evidence.
    direction: -1,
    of: (service) => inventoryOf(service)?.transient,
  },
  {
    name: 'bestDev',
    role: 'inventory',
    direction: 1,
    of: (service) => inventoryOf(service)?.bestDev,
  },
  {
    name: 'bestRise',
    role: 'inventory',
    direction: 1,
    of: (service) => inventoryOf(service)?.bestRise,
  },
  // The raw evidence the terms are computed FROM — a different quantity from the term.
  {
    name: 'sigLines',
    role: 'evidence',
    direction: 1,
    // The engine admits a line once, so the source-signature set is the UNION.
    of: (service) =>
      service.logicExceptionCount + service.httpExceptionCount - (service.bothExceptionCount ?? 0),
  },
  {
    name: 'errLines',
    role: 'evidence',
    direction: 1,
    of: (service) => service.errorCount + service.fatalCount,
  },
  { name: 'inLatEdges', role: 'evidence', direction: 1, of: (service) => service.latEdges },
  // The dump's only TIME. A smaller delay is the evidence, so the direction is inverted.
  { name: 'onset', role: 'time', direction: -1, of: (service) => service.onsetDelayMs },
  {
    name: 'inDegree',
    role: 'topology',
    direction: 1,
    of: (service, subject) => inDegreeOf(service.serviceId, adjacencyOf(subject.kase.edges)),
  },
];

/**
 * The one PAIR signal: does the call graph let the source reach the engine's rank-1?
 *
 * A statement about two services rather than about either of them — "the winner is a
 * downstream consequence of the source" is a direction, and no per-service scalar can express
 * it. It cannot become an additive bonus either, which is exactly why it is reported beside
 * the scalars rather than among them: a preference that holds is usable as a TIE-BREAK
 * between two candidates, not as a score.
 */
const REACHES_SIGNAL: SeparatorSignal = {
  name: 'reaches',
  role: 'topology',
  prefers: (pair, subject) => {
    const adjacency = adjacencyOf(subject.kase.edges);
    const forward = reaches(pair.source.serviceId, pair.winner.serviceId, adjacency);
    const backward = reaches(pair.winner.serviceId, pair.source.serviceId, adjacency);
    if (forward === undefined || backward === undefined) return 'unmeasurable';
    if (forward && !backward) return 'source';
    if (backward && !forward) return 'winner';
    // Neither direction, or both (two services that call each other): the graph does not order
    // them, and a signal that guessed would be inventing a mechanism.
    return 'tie';
  },
};

/** Every declared signal: the scalars, then the pair statement. */
export const SEPARATOR_SIGNALS: readonly SeparatorSignal[] = [
  ...SEPARATOR_SCALARS.map(fromScalar),
  REACHES_SIGNAL,
];

/**
 * The bar a signal must clear to be a candidate, stated in the code so the next reader cannot
 * re-negotiate it after seeing the numbers.
 *
 * `minAuc` is deliberately well above a coin flip: a signal at 0.55 would flip cases and lose
 * as many, and the kill criterion's second half counts fault types.
 */
export interface SeparatorCriterion {
  /** The minimum overall AUC. */
  readonly minAuc: number;
  /** The minimum measurable pairs, in the total and in any type the direction check counts. */
  readonly minCases: number;
}

/** The pre-registered bar. */
export const DEFAULT_SEPARATOR_CRITERION: SeparatorCriterion = { minAuc: 0.6, minCases: 10 };

/**
 * The fold count, matching the discriminator's default.
 *
 * Not configurable: it is the SAME split the discriminator fits on, and a second knob would let
 * the two modules report different held-out fifths of one dump.
 */
const FOLDS = 5;

/** One signal's outcome over one set of pairs. */
export interface SeparatorCell {
  readonly name: string;
  readonly role: SeparatorRole;
  /** Pairs where the signal prefers the true source. */
  readonly source: number;
  /** Pairs where it prefers the engine's rank-1. */
  readonly winner: number;
  readonly tie: number;
  /** Pairs where at least one side could not be measured. Outside the rate, never a loss. */
  readonly unmeasurable: number;
  /** `(source + tie/2) / (source + winner + tie)`, or `undefined` when nothing was measurable. */
  readonly auc: number | undefined;
  /** The exact two-sided permutation p-value over the NON-tie pairs, or `undefined`. */
  readonly p: number | undefined;
}

/** One cell that survives the multiplicity bar: a per-type claim that is worth a run. */
export interface SeparatorSurvivor {
  readonly faultType: string;
  readonly signal: string;
  readonly source: number;
  readonly loss: number;
  /** `(source + tie/2) / (source + winner + tie)`, or `undefined` when nothing was measurable. */
  readonly auc: number | undefined;
  readonly p: number;
  /**
   * The same rate per FOLD, in fold order, or `undefined` for a fold this signal could not
   * measure.
   *
   * A survivor was selected by scanning 250 cells, so its own p-value is the maximum of a search
   * and not an out-of-sample claim — the same objection the discriminator's module answers with
   * folds. The vector is what turns "this cell separates" into "this cell separates in every
   * fifth of the dump", which is the weakest statement a per-type claim can rest on.
   */
  readonly foldAuc: readonly (number | undefined)[];
  /**
   * Whether every fold the signal could measure points the SAME way the whole set does.
   *
   * Direction-consistent, not "above 0.5 in every fold": the flag is printed for the mirror list
   * too, where the whole-set rate is below 0.5 by construction — defined the other way, every
   * dominated cell printed as UNSTABLE, including one whose five folds are all 0.00, which is the
   * most uniform result in the table.
   */
  readonly stable: boolean;
}

/** One fault type's row, or the total. */
export interface SeparatorRow {
  /** The fault type, or `''` for the total row. */
  readonly faultType: string;
  readonly pairs: number;
  readonly cells: readonly SeparatorCell[];
}

/** The whole census. */
export interface SeparatorCensus {
  /** Every pair, in dump order — so a caller can name the cases behind a count. */
  readonly pairs: readonly SeparatorPair[];
  /** Wrong cases whose source the dump does not describe, so no question can be asked. */
  readonly unpaired: number;
  /** Per fault type, most pairs first. */
  readonly rows: readonly SeparatorRow[];
  readonly total: SeparatorRow;
  /** Pairs where no non-`term` signal prefers the source. */
  readonly noNonTermPreference: number;
  /** The signals that cleared {@link SeparatorCriterion}, best AUC first. */
  readonly candidates: readonly string[];
  readonly criterion: SeparatorCriterion;
  /**
   * How many non-`term` cells a reader of this report scans — the search space the
   * multiplicity bar is taken over.
   *
   * Only the signals that COULD become a candidate: the term signals are printed and can
   * never be promoted, so counting them would inflate the bar they are exempt from.
   */
  readonly readings: number;
  /** The per-test significance level after the Šidák correction over {@link readings}. */
  readonly adjustedAlpha: number;
  /**
   * Per-type cells that clear the bar IN THE SOURCE'S FAVOUR — a signal that prefers the source
   * more often than the winner, at the corrected level. The only per-type claims worth a run.
   */
  readonly survivors: readonly SeparatorSurvivor[];
  /**
   * The mirror class: cells that clear the bar with the WINNER preferred on almost every pair.
   *
   * Reported because it is the strongest statement the census can make about a block, and the
   * opposite of a candidate: it says the engine's rank-1 does not merely edge the source out on
   * that signal, it owns it. A screen that dropped these would print `0 candidates` and hide the
   * reason.
   */
  readonly dominated: readonly SeparatorSurvivor[];
}

/**
 * The exact two-sided permutation p-value of one cell.
 *
 * Under the null — the signal has no preference — every pair it can order is a coin flip, so
 * the number of pairs favouring the source is binomial. Ties are EXCLUDED rather than counted
 * as half: a tie is a statement about the two services being equal on that signal, and it
 * carries no direction, so including it in the test's sample size would report a signal that
 * mostly ties as though it had been measured on every pair.
 *
 * Exact rather than normal-approximated, because the whole question is whether a cell with
 * `n = 25` survives a bar set for hundreds of cells, and an approximation is at its worst
 * exactly there.
 *
 * @param wins - Measurable pairs the signal gives to the source.
 * @param losses - Measurable pairs it gives to the engine's rank-1.
 * @returns The p-value, or `undefined` when the signal ordered nothing (no test possible).
 */
export function separationPValue(wins: number, losses: number): number | undefined {
  const flips = wins + losses;
  if (flips === 0) return undefined;
  const deviation = Math.abs(wins - losses);
  // ln C(k, x) built incrementally, so the sum below stays finite for k in the hundreds:
  // C(666, 333) is ~1e199, and 2^666 overflows a double, so the ratio cannot be formed directly.
  const logChoose: number[] = [0];
  for (let x = 1; x <= flips; x++) {
    logChoose[x] = logChoose[x - 1]! + Math.log(flips - x + 1) - Math.log(x);
  }
  const logHalf = flips * Math.log(2);
  const start = Math.ceil((flips + deviation) / 2);
  let upper = 0;
  for (let x = start; x <= flips; x++) upper += Math.exp(logChoose[x]! - logHalf);
  // Doubled and clipped to 1: the null is symmetric, and a deviation small enough to put the
  // whole distribution in the tail is a p-value of exactly 1, not of 0.9999999999999998.
  return Math.min(1, 2 * upper);
}

/**
 * The Šidák correction over the cells a reader is scanning.
 *
 * Šidák rather than Bonferroni because the cells are meant to be independent draws — and a
 * reader who scans 338 cells for a 0.88 will find one whether or not any signal works. Stating
 * the corrected bar in the report is what lets a per-type AUC be read as evidence instead of as
 * a maximum.
 *
 * @param readings - The number of tests the bar is taken over.
 * @param alpha - The family-wise level; defaults to the conventional 0.05.
 * @returns The per-test level.
 */
export function adjustedAlphaOver(readings: number, alpha = 0.05): number {
  if (readings <= 0) return alpha;
  return 1 - (1 - alpha) ** (1 / readings);
}

/** The mutable tally behind one cell. */
interface Tally {
  source: number;
  winner: number;
  tie: number;
  unmeasurable: number;
}

/** Turn a tally into a cell, computing the rate once. */
function toCell(name: string, role: SeparatorRole, tally: Tally): SeparatorCell {
  const measurable = tally.source + tally.winner + tally.tie;
  return {
    name,
    role,
    source: tally.source,
    winner: tally.winner,
    tie: tally.tie,
    unmeasurable: tally.unmeasurable,
    auc: measurable === 0 ? undefined : (tally.source + tally.tie / 2) / measurable,
    p: separationPValue(tally.source, tally.winner),
  };
}

/** The measurable pairs behind a cell — the rate's own denominator. */
function measurableOf(cell: SeparatorCell): number {
  return cell.source + cell.winner + cell.tie;
}

/**
 * The per-fold tally for one signal over one set of pairs — the same fold split the
 * discriminator fits on, for the same reason: a claim selected from a scan has to be re-read on
 * a fifth of the dump it was not selected from.
 */
function foldTallies(
  subset: readonly SeparatorPair[],
  signalName: string,
  subjectOf: ReadonlyMap<string, SeparatorSubject>,
): Tally[] {
  const signal = SEPARATOR_SIGNALS.find((candidate) => candidate.name === signalName)!;
  const tallies: Tally[] = Array.from({ length: FOLDS }, () => ({
    source: 0,
    winner: 0,
    tie: 0,
    unmeasurable: 0,
  }));
  for (const pair of subset) {
    const tally = tallies[foldOf(pair.datapack, FOLDS)]!;
    const verdict = signal.prefers(pair, subjectOf.get(pair.datapack)!);
    if (verdict === 'unmeasurable') tally.unmeasurable++;
    else tally[verdict]++;
  }
  return tallies;
}

/**
 * Census every declared signal against the same pairs.
 *
 * @param cases - Parsed cases. A case with no ground truth, or whose ground-truth services are
 *   absent from the dump's list, cannot be asked the question and is COUNTED as unpaired.
 * @param criterion - The bar; defaults to {@link DEFAULT_SEPARATOR_CRITERION}.
 * @param latFloor - The rise the latency term must clear, so the `lat` signal is the engine's
 *   own term rather than a credited-everything variant; defaults to the shipped value.
 * @returns The census, per fault type and in total.
 */
export function separatorCensus(
  cases: readonly DiagnosedCase[],
  criterion: SeparatorCriterion = DEFAULT_SEPARATOR_CRITERION,
  latFloor: number = DEFAULT_LAT_MIN_RISE,
): SeparatorCensus {
  const pairs: SeparatorPair[] = [];
  let unpaired = 0;
  const subjectOf = new Map<string, SeparatorSubject>();
  for (const kase of cases) {
    subjectOf.set(kase.datapack, {
      kase,
      latSlopes: latencySlopes(kase.services, latFloor),
      // Anchored on the INJECTION time, at the engine's default shape: the shape is inert at
      // the shipped weight, but the signal is what the engine's theory says a source has.
      onsetSlopes: onsetSlopes(kase),
    });
    if (kase.groundTruth.every((name) => name === '')) continue;
    const source = sourceOf(kase);
    if (source === undefined) {
      unpaired++;
      continue;
    }
    const winnerId = kase.prediction[0];
    // A rank-1 that IS an acceptable root makes the case a hit, and comparing the source with
    // itself would print a structural tie as a measurement. A rank-1 the dump does not
    // describe cannot be compared at all.
    const winner = kase.services.find((service) => service.serviceId === winnerId);
    if (winnerId === undefined || kase.groundTruth.includes(winnerId) || winner === undefined) {
      continue;
    }
    pairs.push({ datapack: kase.datapack, faultType: kase.faultType, source, winner });
  }

  const build = (faultType: string, subset: readonly SeparatorPair[]): SeparatorRow => {
    const tallies = new Map<string, Tally>(
      SEPARATOR_SIGNALS.map((signal) => [
        signal.name,
        { source: 0, winner: 0, tie: 0, unmeasurable: 0 },
      ]),
    );
    for (const pair of subset) {
      const subject = subjectOf.get(pair.datapack)!;
      for (const signal of SEPARATOR_SIGNALS) {
        const tally = tallies.get(signal.name)!;
        const verdict = signal.prefers(pair, subject);
        if (verdict === 'unmeasurable') tally.unmeasurable++;
        else tally[verdict]++;
      }
    }
    return {
      faultType,
      pairs: subset.length,
      cells: SEPARATOR_SIGNALS.map((signal) =>
        toCell(signal.name, signal.role, tallies.get(signal.name)!),
      ),
    };
  };

  const byType = new Map<string, SeparatorPair[]>();
  for (const pair of pairs) {
    const list = byType.get(pair.faultType);
    if (list === undefined) byType.set(pair.faultType, [pair]);
    else list.push(pair);
  }
  const rows = [...byType.entries()]
    .map(([faultType, subset]) => build(faultType, subset))
    .sort((a, b) => b.pairs - a.pairs || (a.faultType < b.faultType ? -1 : 1));
  const total = build('', pairs);

  const cellOf = (row: SeparatorRow, name: string) => row.cells.find((cell) => cell.name === name)!;
  const noNonTermPreference = pairs.filter((pair) => {
    const subject = subjectOf.get(pair.datapack)!;
    return !SEPARATOR_SIGNALS.some(
      (signal) => signal.role !== 'term' && signal.prefers(pair, subject) === 'source',
    );
  }).length;

  const candidates = SEPARATOR_SIGNALS.filter((signal) => {
    // A term is not a candidate at any AUC: it cannot reopen an axis the register closed.
    if (signal.role === 'term') return false;
    const overall = cellOf(total, signal.name);
    if (measurableOf(overall) < criterion.minCases) return false;
    if ((overall.auc ?? 0) < criterion.minAuc) return false;
    // And never the wrong way on a type large enough to be counted: that is the half of the
    // kill criterion a global rate cannot see.
    return rows.every((row) => {
      const cell = cellOf(row, signal.name);
      return measurableOf(cell) < criterion.minCases || (cell.auc ?? 0) >= 0.5;
    });
  })
    .map((signal) => signal.name)
    .sort((a, b) => (cellOf(total, b).auc ?? 0) - (cellOf(total, a).auc ?? 0) || (a < b ? -1 : 1));

  // The multiplicity bar covers every non-term cell a reader scans: the term signals are
  // printed beside them but can never be promoted, so charging the candidate space for them
  // would set a bar for tests that are not being run.
  const readings = rows.reduce(
    (count, row) =>
      count +
      row.cells.filter((cell) => cell.role !== 'term' && cell.source + cell.winner + cell.tie > 0)
        .length,
    0,
  );
  const adjustedAlpha = adjustedAlphaOver(readings);
  const survivors: SeparatorSurvivor[] = [];
  const dominated: SeparatorSurvivor[] = [];
  const subsets = new Map([...byType.entries()]);
  for (const row of rows) {
    // The row's own pairs, carried rather than looked up behind a fallback: rows ARE the type map,
    // so a `?? []` there could only ever be dead code pretending to be defensive.
    const subset = subsets.get(row.faultType) ?? [];
    for (const cell of row.cells) {
      if (cell.role === 'term' || cell.p === undefined) continue;
      if (cell.p >= adjustedAlpha) continue;
      // The DIRECTION is what separates the two lists, and it is not cosmetic: a cell whose AUC
      // is 0.00 is as significant as one whose AUC is 1.00, and calling the first a `survivor`
      // would put the engine's best-argued loss on the candidate list.
      const perFold = foldTallies(subset, cell.name, subjectOf);
      const foldAuc = perFold.map((tally) => {
        const measurable = tally.source + tally.winner + tally.tie;
        return measurable === 0 ? undefined : (tally.source + tally.tie / 2) / measurable;
      });
      (cell.auc !== undefined && cell.auc > 0.5 ? survivors : dominated).push({
        faultType: row.faultType,
        signal: cell.name,
        source: cell.source,
        loss: cell.winner,
        auc: cell.auc,
        p: cell.p,
        foldAuc,
        stable: foldAuc.every(
          (auc) => auc === undefined || auc > 0.5 === (cell.auc !== undefined && cell.auc > 0.5),
        ),
      });
    }
  }
  const byP = (a: SeparatorSurvivor, b: SeparatorSurvivor) =>
    a.p - b.p || (a.faultType < b.faultType ? -1 : 1);
  survivors.sort(byP);
  dominated.sort(byP);

  return {
    pairs,
    unpaired,
    rows,
    total,
    noNonTermPreference,
    candidates,
    criterion,
    readings,
    adjustedAlpha,
    survivors,
    dominated,
  };
}

/** Render a rate with three decimals, or `n/a` for a signal that measured nothing. */
function aucText(auc: number | undefined): string {
  return auc === undefined ? 'n/a' : auc.toFixed(3);
}

/** Render a p-value in exponent form, or `n/a` where no test was possible. */
function pText(p: number | undefined): string {
  return p === undefined ? 'n/a' : p.toExponential(1);
}

/**
 * The non-`term` cell of a row that best supports the SOURCE, by AUC.
 *
 * By AUC and not by p-value: the p-value is symmetric, so ranking on it makes a cell at AUC 0.00
 * the row's `best` — which reads as a candidate and is the exact opposite of one. The p-value is
 * printed BESIDE the AUC so a large sample and a strong rate can both be seen.
 */
function bestNonTerm(row: SeparatorRow): SeparatorCell | undefined {
  const eligible = row.cells.filter((cell) => cell.role !== 'term' && cell.p !== undefined);
  if (eligible.length === 0) return undefined;
  return eligible.reduce((best, cell) =>
    (cell.auc ?? 0) > (best.auc ?? 0) ||
    ((cell.auc ?? 0) === (best.auc ?? 0) && cell.name < best.name)
      ? cell
      : best,
  );
}

/**
 * Render the census.
 *
 * The framing count comes first and the criterion is printed with the table, because both are
 * what make the rest readable: an AUC without its `n` and without the bar it is being compared
 * to invites the reader to supply their own. The per-type table carries the p-value AND the bar,
 * because a 0.88 at `n = 25` is a fact about the multiplicity of the scan before it is a fact
 * about the signal.
 */
export function formatSeparatorCensus(census: SeparatorCensus): string {
  const lines: string[] = [];
  lines.push(
    "Separator census — does any dump-visible signal prefer the TRUE source over the engine's rank-1?",
  );
  lines.push(
    `  ${census.total.pairs} wrong cases paired (source = the case's most anomalous ground-truth ` +
      `service, winner = the engine's rank-1); ${census.unpaired} wrong cases whose source the ` +
      'dump does not describe',
  );
  lines.push(
    `  criterion: a non-term signal is a candidate only if AUC >= ${census.criterion.minAuc} over ` +
      `>= ${census.criterion.minCases} measurable pairs, and never below 0.5 on a fault type with ` +
      `>= ${census.criterion.minCases}`,
  );
  lines.push(
    `  multiplicity: ${census.readings} non-term cells are scanned, so the per-test bar is ` +
      `Sidak(0.05, ${census.readings}) = p < ${census.adjustedAlpha.toExponential(1)}; ` +
      '`*` marks a cell that clears it',
  );
  lines.push(
    '  a tie counts as half a win; the p-value excludes ties, which carry no direction; `n/a` is',
  );
  lines.push('  a pair one side could not measure, and it is outside the rate rather than a loss');

  const labelWidth =
    Math.max(16, ...census.rows.map((row) => row.faultType.length), 'ALL'.length) + 2;
  lines.push('');
  lines.push(
    '  by fault type'.padEnd(labelWidth) +
      'n'.padStart(5) +
      '  metric      log      lat temporal   best non-term            AUC          p',
  );
  for (const row of [...census.rows, census.total]) {
    const label = row.faultType === '' ? 'ALL' : row.faultType;
    const columns = ['metric', 'log', 'lat', 'temporal']
      .map((name) => aucText(row.cells.find((cell) => cell.name === name)?.auc).padStart(9))
      .join('');
    const best = bestNonTerm(row);
    const mark =
      best !== undefined && best.p! < census.adjustedAlpha && best.p !== undefined ? ' *' : '  ';
    lines.push(
      `  ${label.padEnd(labelWidth - 2)}${String(row.pairs).padStart(5)}${columns}   ` +
        `${(best?.name ?? 'none measurable').padEnd(22)}${aucText(best?.auc).padStart(6)}` +
        `${pText(best?.p).padStart(12)}${mark}`,
    );
  }
  lines.push('');
  lines.push(
    '  by signal'.padEnd(labelWidth) +
      'role'.padEnd(11) +
      'n'.padStart(6) +
      'source'.padStart(8) +
      'winner'.padStart(8) +
      'tie'.padStart(6) +
      'n/a'.padStart(6) +
      'AUC'.padStart(8) +
      'p'.padStart(11),
  );
  for (const cell of [...census.total.cells].sort(
    (a, b) => (b.auc ?? -1) - (a.auc ?? -1) || (a.name < b.name ? -1 : 1),
  )) {
    lines.push(
      `  ${cell.name.padEnd(labelWidth - 2)}${cell.role.padEnd(11)}` +
        `${String(measurableOf(cell)).padStart(6)}` +
        `${String(cell.source).padStart(8)}${String(cell.winner).padStart(8)}` +
        `${String(cell.tie).padStart(6)}${String(cell.unmeasurable).padStart(6)}` +
        `${aucText(cell.auc).padStart(8)}${pText(cell.p).padStart(11)}`,
    );
  }
  lines.push('');
  if (census.candidates.length === 0) {
    const best = bestNonTerm(census.total);
    lines.push(
      '  no non-term signal passes' +
        (best === undefined ? '.' : `: the best is \`${best.name}\` at ${aucText(best.auc)}.`),
    );
  } else {
    lines.push(`  candidates: ${census.candidates.join(', ')}`);
  }
  const render = (list: readonly SeparatorSurvivor[]) =>
    list.length === 0
      ? '.'
      : `: ${list
          .slice(0, 6)
          .map(
            (cell) =>
              `${cell.faultType}/${cell.signal} ${cell.source}-${cell.loss} (p=${pText(cell.p)}, ` +
              `folds ${cell.foldAuc
                .map((auc) => (auc === undefined ? '-' : auc.toFixed(2)))
                .join('/')}${cell.stable ? ', stable' : ', UNSTABLE'})`,
          )
          .join(', ')}${list.length > 6 ? ', …' : ''}.`;
  lines.push(
    `  ${census.survivors.length}/${census.readings} non-term cells separate FOR the source at the ` +
      `bar${render(census.survivors)}`,
  );
  lines.push(
    `  ${census.dominated.length}/${census.readings} separate AGAINST it — the winner owns that ` +
      `signal, which is a fact about the block rather than a candidate${render(census.dominated)}`,
  );
  lines.push(
    `  ${census.noNonTermPreference}/${census.total.pairs} pairs carry no non-term preference for ` +
      'the source: only new evidence can reach them.',
  );
  return lines.join('\n');
}
