/**
 * The ancestry bound: the rise stops at the source, so the source lies on the path to the deepest rung.
 *
 * ## The question this module answers, and the one it refuses
 *
 * 329 measured, on the population the front door's gate addresses, that the deepest rising service is the truth on
 * **36 of 39** cases the answer gets wrong and **1 of 52** cases it gets right. That is a 60-point gap and it is
 * worth nothing as a rule, because the two populations were told apart by already knowing the answer. What 329 left
 * open is whether a statement the CASE carries separates them.
 *
 * This module prices exactly one such statement, and it is a relation rather than a threshold:
 *
 * > if `r` is the deepest service whose departure clears a bar, the source lies on the path from the entry to `r`.
 *
 * The generator's law is what licenses it, and 329 measured the law on the truth side rather than assuming it: an
 * error rate rises on the path from the entry down to the source and **stops there**, so a service deeper than the
 * source cannot rise. `r` is therefore at or above the source, and the source is on the path to `r`, inclusive. The
 * claim is a bound from above on where the source can be, checked from the case's own columns — the call graph, the
 * entry, and the per-service profiles — with no truth read at all.
 *
 * ## Why the rule refuses instead of choosing
 *
 * The bound can only ever EXCLUDE an answer; it cannot name the source. So the rule has two outcomes and both are
 * refusals of a kind this programme already uses: an answer **on** the path is left alone (the law does not exclude
 * it), and an answer **off** the path is contradicted and renamed to the rung. That is why the rule is silent on the
 * population it cannot speak about rather than confident everywhere, and it is why the control in
 * {@link crossValidateAncestry} matters: a rule about a graph has to be shown to need the graph.
 *
 * ## The defect the path's direction guards against
 *
 * A rise is not directional: `http.server.request.duration` rising at a hop says a retry storm passed through it.
 * What is directional is the BOUND — a descendant of the rung is not on the path to it, so a rule that ignored the
 * edge direction would read the rung's own children as candidates and contradict answers the law permits.
 *
 * @module benchmarks/channel-ancestry
 */

import type { ChannelDeparture } from './channel-kind.js';
import {
  KAPPA_GRID,
  MIN_CHANNEL_GAIN,
  foldAssignments,
  gateHolds,
  resolvedUnder,
  stableHash,
  type Profiles,
  type SplitCase,
} from './channel-split.js';

/**
 * The gain, in cases, the bound must produce on EACH held-out fold.
 *
 * The same reference improvement the channel split is held to, kept as its own constant rather than read from that
 * module: two axes that shared one bar could be moved by editing the other's hypothesis, and the register states each
 * refusal against the number it was pre-registered with.
 */
export const MIN_ANCESTRY_GAIN = MIN_CHANNEL_GAIN;

/** A call graph as the corpus writes it: directed caller → callee edges. */
export interface CallGraph {
  readonly edges: readonly (readonly [string, string])[];
}

/** Which member of the rising set the rule renames to. `shuffled` is the control, not a candidate policy. */
export type RungPolicy = 'deepest' | 'shuffled';

/**
 * Which cases the rule is allowed to speak about.
 *
 * `addressed` is the population every resolver in this pipeline is defined on: the front door's premise holds, which
 * is the condition under which the pipeline consults a prior at all. `all` exists because the difference between the
 * two is a measurement worth having — it is the relation's REACH, and on this corpus it is the difference between a
 * rule that contradicts 963 correct answers and one that contradicts 52.
 */
export type Population = 'addressed' | 'all';

/** The bound one case yields, or `null` when the case carries none. */
export interface Rung {
  /** The deepest rising service the entry reaches. */
  readonly rung: string;
  /** Hops from the entry to the rung. */
  readonly distance: number;
  /** The rung, its ancestors, and the entry: the set an answer may be in without being contradicted. */
  readonly path: ReadonlySet<string>;
  /** Every rising service, sorted, so the control draws from the same population the rule chose from. */
  readonly rising: readonly string[];
}

/** Distance from the entry to every service it reaches, by breadth-first search over the call edges. */
export function distancesFrom(graph: CallGraph, entry: string): Map<string, number> {
  const out = new Map<string, readonly string[]>();
  for (const [caller, callee] of graph.edges) {
    const list = out.get(caller);
    if (list === undefined) out.set(caller, [callee]);
    else if (!list.includes(callee)) (list as string[]).push(callee);
  }
  const distances = new Map<string, number>([[entry, 0]]);
  let frontier: readonly string[] = [entry];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const one of frontier) {
      for (const callee of out.get(one) ?? []) {
        if (distances.has(callee)) continue;
        distances.set(callee, depth);
        next.push(callee);
      }
    }
    frontier = next;
  }
  return distances;
}

/** The loudest of the three standardised channels, or `null` when the service carries none of them. */
function loudestOf(one: ChannelDeparture): number | null {
  let best: number | null = null;
  for (const value of [one.resource, one.traffic, one.other]) {
    if (value === null) continue;
    if (best === null || value > best) best = value;
  }
  return best;
}

/**
 * Every service whose departure clears the bar, sorted by id.
 *
 * Sorted rather than in profile order so that two readings of one corpus — and the control's draw — depend on the
 * data and not on the order a map happened to be written in. The bar is inclusive for the reason
 * {@link import('./channel-split.js').KAPPA_GRID} gives: a unit of standardised surprise is coarser than the grid.
 */
export function risingUnder(
  services: ReadonlyMap<string, ChannelDeparture>,
  kappa: number,
): readonly string[] {
  const rising: string[] = [];
  for (const [id, one] of services) {
    const loudest = loudestOf(one);
    if (loudest !== null && loudest >= kappa) rising.push(id);
  }
  // Two-way because ids are unique: a comparator with an equality arm carries a branch no corpus can reach, and a
  // branch no corpus can reach is a branch that hides in a coverage report forever.
  return rising.sort((a, b) => (a < b ? -1 : 1));
}

/**
 * The deepest rising service the entry reaches, or `null`.
 *
 * Depth rather than magnitude, and that is the whole hypothesis: 329 measured the LOUDEST rising error rate as the
 * truth on 12 of 160 and the DEEPEST rising service as the truth on 36 of 39 where it can act. Ties go to the
 * smallest id, a deterministic choice that carries no preference for the truth.
 */
export function rungUnder(
  services: ReadonlyMap<string, ChannelDeparture>,
  distances: ReadonlyMap<string, number>,
  kappa: number,
): string | null {
  let rung: string | null = null;
  let deepest = -1;
  for (const id of risingUnder(services, kappa)) {
    const distance = distances.get(id);
    if (distance === undefined) continue;
    if (distance > deepest) {
      rung = id;
      deepest = distance;
    }
  }
  return rung;
}

/**
 * The path from the entry to one service, inclusive, walked back through the search tree.
 *
 * `null` when the entry cannot reach it — absence of a path and an empty path are different statements, and a rule
 * that read the first as the second would contradict every answer on a case whose graph it failed to read.
 */
export function pathTo(
  graph: CallGraph,
  entry: string,
  target: string,
): ReadonlySet<string> | null {
  const parent = new Map<string, string>();
  const seen = new Set<string>([entry]);
  let frontier: readonly string[] = [entry];
  while (frontier.length > 0 && !seen.has(target)) {
    const next: string[] = [];
    for (const one of frontier) {
      for (const [caller, callee] of graph.edges) {
        if (caller !== one || seen.has(callee)) continue;
        seen.add(callee);
        parent.set(callee, one);
        next.push(callee);
      }
    }
    frontier = next;
  }
  if (!seen.has(target)) return null;
  const path = new Set<string>([target]);
  for (let at = target; at !== entry;) {
    // Every service on the chain was discovered by the search, so it has a parent: the guard this replaces could not
    // fire, and a guard that cannot fire is a claim about the code that no test can confirm.
    at = parent.get(at)!;
    path.add(at);
  }
  return path;
}

/**
 * The bound one case yields.
 *
 * Refuses a case with no entry, no profile, or a rung the entry cannot reach: in each of the three the case carries
 * no bound, and a rule that spoke anyway would be contradicting an answer on no evidence.
 */
export function rungOf(
  one: { readonly datapack: string; readonly entry: string | null },
  profiles: Profiles,
  graph: CallGraph,
  kappa: number,
): Rung | null {
  if (one.entry === null) return null;
  const services = profiles.get(one.datapack);
  if (services === undefined) return null;
  const distances = distancesFrom(graph, one.entry);
  const rung = rungUnder(services, distances, kappa);
  if (rung === null) return null;
  // The rung is a member of `distances` by construction, so the path exists: `rungUnder` only returns services the
  // search reached.
  const path = pathTo(graph, one.entry, rung)!;
  return { rung, distance: distances.get(rung)!, path, rising: risingUnder(services, kappa) };
}

/** A pseudo-random member of the rising set, drawn from the case's own digest and the bar. */
export function shuffledRung(
  rising: readonly string[],
  datapack: string,
  kappa: number,
): string | null {
  if (rising.length === 0) return null;
  return rising[stableHash(`${datapack}|${kappa}`) % rising.length]!;
}

/**
 * The name the bound puts on a case, or `null` when it has nothing to say.
 *
 * Three silences, each of them a statement: the case carries no rung; the case has no answer to contradict; the
 * answer is on the path and the law does not exclude it. What is left is an answer the graph contradicts, and the
 * rule renames it to the rung — never to a service the case does not carry.
 *
 * @param one - The case.
 * @param profiles - Every case's service profiles.
 * @param graph - The case's call graph.
 * @param kappa - The bar a departure must clear to be a rung.
 * @param policy - `deepest` for the rule, `shuffled` for the control.
 * @returns The renamed answer, or `null` to leave the case where it is.
 */
export function renamedUnder(
  one: SplitCase,
  profiles: Profiles,
  graph: CallGraph,
  kappa: number,
  policy: RungPolicy = 'deepest',
): string | null {
  const reading = rungOf(one, profiles, graph, kappa);
  if (reading === null) return null;
  if (one.answer === null) return null;
  if (reading.path.has(one.answer)) return null;
  if (policy === 'deepest') return reading.rung;
  return shuffledRung(reading.rising, one.datapack, kappa);
}

/** One bar of the ancestry sweep. */
export interface AncestryCell {
  readonly kappa: number;
  /** Correct cases in each fold, in fold order, under this bar. */
  readonly correct: readonly [number, number];
  /** Cases the rule spoke on: an answer off the path to the rung. */
  readonly fires: number;
  readonly repairs: number;
  readonly breaks: number;
}

/** What the ancestry bound's cross-validation concluded. */
export interface AncestryValidation {
  readonly sizes: readonly [number, number];
  /** The shipped surface's correct count per fold, read through the shipped resolvers. */
  readonly mixed: readonly [number, number];
  readonly sweep: readonly AncestryCell[];
  /** The bar each fold chose, in fold order. */
  readonly selected: readonly [number, number];
  readonly heldOut: readonly [number, number];
  readonly deltas: readonly [number, number];
  readonly passes: boolean;
}

/** A graph carrying no edges, for a case the caller supplied no graph for: the bound then refuses by construction. */
const NO_EDGES: CallGraph = { edges: [] };

/**
 * Price the bound on both folds, then swap them.
 *
 * The protocol is 328's and 329's, unchanged, so three iterations' refusals are stated against one decision rule:
 * the bar is chosen on one fold and read once on the other, a reading must clear the bar on **both** folds, and the
 * two folds' choices must lie within one grid step. The baseline is the shipped resolvers' own output rather than the
 * artifact's column, so the delta is a delta from the surface this repository ships.
 *
 * @param rows - The corpus.
 * @param profiles - Every case's service profiles.
 * @param graphs - Each case's call graph.
 * @param grid - The bars to sweep, ascending.
 * @param minGain - The gain each held-out fold must show.
 * @param policy - `deepest` for the rule, `shuffled` for the control.
 * @param population - Which cases the rule may speak about; see {@link Population}.
 * @returns The report, whose `passes` is the only field that decides whether the bound ships.
 */
export function crossValidateAncestry(
  rows: readonly SplitCase[],
  profiles: Profiles,
  graphs: ReadonlyMap<string, CallGraph>,
  grid: readonly number[] = KAPPA_GRID,
  minGain: number = MIN_ANCESTRY_GAIN,
  policy: RungPolicy = 'deepest',
  population: Population = 'addressed',
): AncestryValidation {
  const folds = foldAssignments(rows);
  const sizes: [number, number] = [0, 0];
  for (const fold of folds) sizes[fold] += 1;

  const settled = rows.map((one) => resolvedUnder(one, profiles, null));
  const base = rows.map(
    (one, index) => settled[index] !== null && one.truth.includes(settled[index]!),
  );
  const mixed: [number, number] = [0, 0];
  rows.forEach((_, index) => {
    if (base[index]!) mixed[folds[index]!] += 1;
  });

  const sweep: AncestryCell[] = grid.map((kappa) => {
    const correct: [number, number] = [0, 0];
    let fires = 0;
    let repairs = 0;
    let breaks = 0;
    rows.forEach((one, index) => {
      // The POPULATION, not the hypothesis: every resolver in this pipeline is defined on the cases the front door
      // addresses, and a rule that rewrote answers outside that premise would be a different product. The first
      // reading of this axis applied the relation to all 1 422 cases and it contradicted 963 correct answers while
      // repairing 2 — which is a measurement of the relation's REACH, and the reason the two readings are reported
      // as two rather than as one.
      const speaks = population === 'all' || gateHolds(one);
      const renamed = speaks
        ? renamedUnder(one, profiles, graphs.get(one.datapack) ?? NO_EDGES, kappa, policy)
        : null;
      if (renamed !== null) fires += 1;
      const answer = renamed ?? settled[index]!;
      const hit = answer !== null && one.truth.includes(answer);
      if (hit) correct[folds[index]!] += 1;
      if (renamed === null) return;
      if (hit && !base[index]!) repairs += 1;
      if (!hit && base[index]!) breaks += 1;
    });
    return { kappa, correct, fires, repairs, breaks };
  });

  const choose = (fold: 0 | 1): number => {
    let best = sweep[0]!;
    for (const one of sweep) if (one.correct[fold] > best.correct[fold]) best = one;
    return best.kappa;
  };
  const selected: [number, number] = [choose(0), choose(1)];
  const at = (kappa: number, fold: 0 | 1): number =>
    sweep.find((one) => one.kappa === kappa)!.correct[fold];
  const heldOut: [number, number] = [at(selected[1], 0), at(selected[0], 1)];
  const deltas: [number, number] = [heldOut[0] - mixed[0], heldOut[1] - mixed[1]];
  const step = Math.abs(grid.indexOf(selected[0]) - grid.indexOf(selected[1]));
  const passes =
    sizes[0] > 0 && sizes[1] > 0 && deltas[0] >= minGain && deltas[1] >= minGain && step <= 1;
  return { sizes, mixed, sweep, selected, heldOut, deltas, passes };
}
