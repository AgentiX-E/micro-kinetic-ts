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
  /**
   * The `DiagnosedService` fields this scalar reads.
   *
   * Declared rather than inferred, because TypeScript types do not exist at runtime and an audit
   * needs a list. It is what makes "which fields does NO signal read" answerable, and it is checked
   * in both directions: every key here must be a real field, and every field is either read by a
   * scalar or classified in {@link SERVICE_FIELD_AUDIT}.
   */
  readonly reads: readonly (keyof DiagnosedService)[];
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

/** The composition of the metric that drove a service's anomaly score. */
interface Composition {
  readonly trend: number;
  readonly cv: number;
  readonly burst: number;
  /** Its pre-anomaly baseline — the denominator the two ratios are measured against. */
  readonly baselineMean: number;
}

/** One rendered metric outcome, as the parser produces it. */
type Outcome = NonNullable<DiagnosedService['metricOutcomes']>[number];

/** The four numbers a RENDERED inventory contributes. */
interface RenderedInventory {
  readonly kept: number;
  readonly transient: number;
  /**
   * The strongest deviation among the DECOMPOSED kept metrics — a lower bound, as the block is brief.
   *
   * `undefined` when the block rendered an inventory and no decomposition for any of its kept metrics:
   * the maximum is then over an EMPTY set, and `0` is a measurement — a metric whose deviation is
   * zero — rather than the absence of one. The distinction is not cosmetic and it was measured:
   * `artifacts/diag-34684319273` renders 2095 inventories and **zero** decompositions, 2094 of them on
   * labelled rows that kept at least one metric, and with a zero sentinel the screen printed
   * `bestDev inventory 319 0 0 319 0 0.500` — 319 pairs decided as TIES at 0.500 where the honest
   * reading is `unmeasurable`, so the `n/a` discipline ("a pair one side cannot be measured on is out
   * of the rate, and counted") never fired. The rule was already stated for the three `decisive*`
   * signals by the test on exactly this fixture; it had been applied to the numbers' CONTAINER
   * (`rendered` is `undefined` when no inventory was rendered) and not to the two numbers inside it.
   */
  readonly bestDev: number | undefined;
  readonly bestRise: number | undefined;
}

/** A service's signal inventory, reduced to the numbers a signal can read. */
interface Inventory {
  /**
   * The rendered competition, or `undefined` when the block rendered none for this service.
   *
   * An object rather than four loose numbers so "not rendered" stays distinguishable from a count of
   * zero — the same rule the parser follows for the inventory itself, and the reason `kept` cannot be
   * defaulted: the block prints the competition for the ground truth and the engine's predictions
   * only, so every other service would otherwise report having kept nothing.
   */
  readonly rendered: RenderedInventory | undefined;
  /**
   * The composition of the metric that DROVE the score, or `undefined` when nothing stated it.
   *
   * Nested rather than spread into four numbers so that "no composition was rendered" is
   * representable: a zero `cv` is a measurement (a perfectly stable series), and reporting it for a
   * metric nobody decomposed would turn an absent field into a tie between the two sides.
   */
  readonly decisive: Composition | undefined;
}

/**
 * Read a service's rendered metric inventory.
 *
 * `undefined` only when the block rendered NEITHER an inventory nor a decisive composition for this
 * service. The two are separate provenances and either can be absent alone: the competition is
 * rendered for the pairs the table compares, while `metricDecisive` is rendered for every service,
 * so a service outside the table has a composition and no counts.
 */
function inventoryOf(service: DiagnosedService): Inventory | undefined {
  const renderedComposition = service.decisiveOutcome;
  const outcomes = service.metricOutcomes;
  if (outcomes === undefined && renderedComposition === undefined) return undefined;

  let kept = 0;
  let transient = 0;
  // The two maxima start ABSENT rather than at zero, and the first decomposition INITIALISES them: a
  // zero sentinel cannot tell "no kept metric was decomposed" from "a decomposed metric carries a zero
  // deviation", and the block renders a decomposition for at most three of the kept metrics, so the
  // empty case is ordinary rather than exotic. No finiteness guard is needed at the assignment —
  // `parseTopEntry` refuses an entry whose seven numbers are not all finite, so a breakdown that
  // reached this list is finite by construction, and a guard here would be unreachable code.
  let bestDev: number | undefined;
  let bestRise: number | undefined;
  // Which metric drove the score, when the block did not state it. Two candidates, because the dump
  // answers the question once by name and once by order: the engine NAMES the metric it maximised
  // over (`dominant`), and the block renders that metric first because the list is sorted by score —
  // but it renders at most three of them, and sorted by score rather than by rise. The name is the
  // primary answer (it survives the truncation); the score ordering is the fallback for a dump that
  // recorded no name. Reading the largest `riseRatio` instead — which this did — measures a
  // different metric in 751 of the 7,733 rows the shipped dump decomposes (9.7%), i.e. not the
  // metric that decided the ranking.
  let named: Outcome | undefined;
  let highest: Outcome | undefined;
  for (const outcome of outcomes ?? []) {
    if (outcome.outcome === TRANSIENT_OUTCOME) {
      transient++;
      continue;
    }
    if (outcome.outcome !== 'kept') continue;
    kept++;
    const breakdown = outcome.breakdown;
    if (breakdown === undefined) continue;
    bestDev = bestDev === undefined ? breakdown.deviation : Math.max(bestDev, breakdown.deviation);
    bestRise =
      bestRise === undefined ? breakdown.riseRatio : Math.max(bestRise, breakdown.riseRatio);
    if (outcome.label === service.dominantMetric) named = outcome;
    if (highest === undefined || outcome.score > highest.score) highest = outcome;
  }

  // The dump's OWN line wins when it is there. It is a READ of the engine's answer rather than a
  // re-derivation, and it is the only source that covers every service; the fallback exists for
  // blocks that predate the line, and it selects by the same rule the producer uses.
  const composition = renderedComposition?.breakdown ?? (named ?? highest)?.breakdown;
  return {
    rendered: outcomes === undefined ? undefined : { kept, transient, bestDev, bestRise },
    decisive:
      composition === undefined
        ? undefined
        : {
            trend: composition.trend,
            cv: composition.cv,
            burst: composition.burst,
            baselineMean: composition.baselineMean,
          },
  };
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
  { name: 'metric', role: 'term', reads: ['selfAnomaly'], direction: 1, of: (s) => s.selfAnomaly },
  { name: 'log', role: 'term', reads: ['logScore'], direction: 1, of: (s) => s.logScore },
  {
    name: 'lat',
    role: 'term',
    reads: ['latRise'],
    direction: 1,
    of: (service, subject) => subject.latSlopes.get(service.serviceId) ?? 0,
  },
  {
    name: 'temporal',
    role: 'term',
    reads: ['onsetDelayMs'],
    direction: 1,
    of: (service, subject) => subject.onsetSlopes.get(service.serviceId) ?? 0,
  },
  {
    name: 'failedEdge',
    role: 'term',
    reads: ['failedEdgeScore'],
    direction: 1,
    of: (s) => s.failedEdgeScore,
  },
  // What the engine's guards DID to the service's own inventory.
  {
    name: 'kept',
    role: 'inventory',
    reads: ['metricOutcomes'],
    direction: 1,
    of: (s) => inventoryOf(s)?.rendered?.kept,
  },
  {
    name: 'transientDrops',
    role: 'inventory',
    reads: ['metricOutcomes'],
    // A source's signature should SURVIVE its own guards, so fewer drops is its evidence.
    direction: -1,
    of: (s) => inventoryOf(s)?.rendered?.transient,
  },
  {
    name: 'bestDev',
    role: 'inventory',
    reads: ['metricOutcomes'],
    direction: 1,
    of: (s) => inventoryOf(s)?.rendered?.bestDev,
  },
  {
    name: 'bestRise',
    role: 'inventory',
    reads: ['metricOutcomes'],
    direction: 1,
    of: (s) => inventoryOf(s)?.rendered?.bestRise,
  },
  // The COMPOSITION of the metric that drove the score. Read from the same decomposition the two
  // maxima come from, and SELECTED by the engine's own `dominant` name — so a candidate built on it
  // can be gated on the same evidence, and cannot silently describe a different metric from the one
  // that decided the ranking.
  {
    name: 'decisiveTrend',
    role: 'inventory',
    reads: ['metricOutcomes', 'dominantMetric', 'decisiveOutcome'],
    direction: 1,
    of: (s) => inventoryOf(s)?.decisive?.trend,
  },
  {
    name: 'decisiveCv',
    role: 'inventory',
    reads: ['metricOutcomes', 'dominantMetric', 'decisiveOutcome'],
    // An unstable series is a noisier measurement of the same excursion, so a lower coefficient
    // of variation is the source's evidence.
    direction: -1,
    of: (s) => inventoryOf(s)?.decisive?.cv,
  },
  {
    name: 'decisiveBurst',
    role: 'inventory',
    reads: ['metricOutcomes', 'dominantMetric', 'decisiveOutcome'],
    direction: -1,
    of: (s) => inventoryOf(s)?.decisive?.burst,
  },
  {
    name: 'decisiveBaseline',
    role: 'inventory',
    reads: ['metricOutcomes', 'dominantMetric', 'decisiveOutcome'],
    // The wrong winner rises from a LOWER baseline (median 0.86 against the source's 1.67), so a
    // higher baseline is the source's evidence: an absolute-level excursion, not a ratio on noise.
    direction: 1,
    of: (s) => inventoryOf(s)?.decisive?.baselineMean,
  },
  // The raw evidence the terms are computed FROM — a different quantity from the term.
  {
    name: 'sigLines',
    role: 'evidence',
    reads: ['logicExceptionCount', 'httpExceptionCount', 'bothExceptionCount'],
    direction: 1,
    // The engine admits a line once, so the source-signature set is the UNION.
    of: (s) => s.logicExceptionCount + s.httpExceptionCount - (s.bothExceptionCount ?? 0),
  },
  {
    name: 'errLines',
    role: 'evidence',
    reads: ['errorCount', 'fatalCount'],
    direction: 1,
    of: (s) => s.errorCount + s.fatalCount,
  },
  {
    name: 'inLatEdges',
    role: 'evidence',
    reads: ['latEdges'],
    direction: 1,
    of: (s) => s.latEdges,
  },
  {
    name: 'edgeRecords',
    role: 'evidence',
    reads: ['failedEdgeRecords'],
    direction: 1,
    // The VOLUME behind `failedEdgeScore`, which the engine's direction gate treats as a mask. The
    // register closes the weight on the score; the raw count is a different quantity and was only
    // ever measured as a marginal rate.
    of: (s) => s.failedEdgeRecords,
  },
  // The dump's only TIME. A smaller delay is the evidence, so the direction is inverted.
  {
    name: 'onset',
    role: 'time',
    reads: ['onsetDelayMs'],
    direction: -1,
    of: (s) => s.onsetDelayMs,
  },
  {
    name: 'inDegree',
    role: 'topology',
    reads: ['serviceId'],
    direction: 1,
    of: (service, subject) => inDegreeOf(service.serviceId, adjacencyOf(subject.kase.edges)),
  },
];

/**
 * Every field a `DIAG` service line carries, and who reads it.
 *
 * The map is `Record<keyof DiagnosedService, string>`, so **adding a field to the reader breaks the
 * build until it is classified here** — a compile-time guard rather than a comment, and the same
 * discipline as the coverage allow-list that had three holes. A field is either read by a scalar
 * (named here) or carries the reason it is not: the reason is the deliverable, because "nobody
 * screened this" and "this was screened and closed" are different statements and only one of them
 * should stop a proposal.
 */
export const SERVICE_FIELD_AUDIT: Readonly<Record<keyof DiagnosedService, string>> = {
  serviceId: 'read: every scalar addresses a service BY it (`inDegree` reads it as a graph node)',
  isGroundTruth: 'NOT read: it is the label — a scalar that read it would be reading the answer',
  predictedRank:
    'NOT read: degenerate — the winner is rank 1 by construction, so the comparison would restate the pairing',
  selfAnomaly: 'read: `metric`',
  logScore: 'read: `log`',
  failedEdgeScore: 'read: `failedEdge`',
  failedEdgeRecords: 'read: `edgeRecords`',
  latRise: 'read: `lat`',
  latEdges: 'read: `inLatEdges`',
  onsetDelayMs: 'read: `onset`, and `temporal` through the engine’s own slope map',
  dominantMetric:
    'read: `decisiveTrend`, `decisiveCv`, `decisiveBurst` and `decisiveBaseline` use it as the SELECTOR of which rendered decomposition is the decisive one. The label is still not screened as a VALUE — the label/family axis is closed by `fse26-family-screen-verdict.md`, which scanned every family hand-registered and measured — but which metric drove a score is data the engine already answered, and reading it is what stops those four from measuring a different metric from the one that decided the ranking',
  errorCount: 'read: `errLines`',
  fatalCount: 'read: `errLines`',
  logicExceptionCount: 'read: `sigLines`',
  httpExceptionCount: 'read: `sigLines`',
  bothExceptionCount: 'read: `sigLines`',
  metricOutcomes:
    'read: `kept`, `transientDrops`, `bestDev`, `bestRise` and the four composition scalars — but only for the four numbers and the decisive metric’s decomposition, not for the per-metric fate WORDS, which are a separate axis (the guard census). The two KINDS of number carry different absent cases and the readers see both: `kept`/`transientDrops` are counts, so a rendered `metricKept(0):` is a MEASURED zero, while `bestDev`/`bestRise` are maxima over the DECOMPOSED metrics and are `undefined` when the block rendered an inventory and no decomposition — a pair with no bound at all is `unmeasurable` rather than a tie at 0',
  decisiveOutcome:
    'read: `decisiveTrend`, `decisiveCv`, `decisiveBurst` and `decisiveBaseline` — the composition the block states for EVERY service, which is what lets a term built on it be simulated over every candidate rather than only over the pairs the table compares. It wins over the `dominantMetric` + rendered-list rule when present, and `metricOutcomes` remains the fallback for blocks that predate it',
};

/**
 * The fields no scalar reads, with the reason each is not screened.
 *
 * @returns One entry per field whose audit text is not a `read:`.
 */
export function unscreenedFields(): readonly (keyof DiagnosedService)[] {
  return (Object.keys(SERVICE_FIELD_AUDIT) as (keyof DiagnosedService)[]).filter(
    (field) => !SERVICE_FIELD_AUDIT[field].startsWith('read:'),
  );
}

/**
 * The fields at least one scalar reads, as the scalars declare them.
 *
 * @returns The union of every scalar's `reads`.
 */
export function screenedFields(): readonly (keyof DiagnosedService)[] {
  return [...new Set(SEPARATOR_SCALARS.flatMap((scalar) => scalar.reads))].sort();
}

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
 * The inventory band a COARSENED match uses, as a ratio between the two sides' kept counts.
 *
 * Exact equality is the ideal conditioning and the one with no power: on the shipped dump the two
 * sides render the same number of kept metrics in only 26 of 662 pairs, so a check built on strict
 * equality can only ever conclude "the confound is saturated". Two — the smallest band that keeps a
 * majority of the population (484 of 662) — is the coarsened match reported beside it, stated as a
 * ratio so "comparable" is a number the reader can disagree with.
 */
export const INVENTORY_MATCH_BAND = 2;

/**
 * Whether two services' inventories are comparable, i.e. within `band` of each other.
 *
 * A side that kept nothing is comparable only to another side that kept nothing: `kept` is a count
 * whose zero is a boundary, and a ratio from zero is undefined rather than large.
 *
 * @param sourceKept - Kept-metric count of the true source.
 * @param winnerKept - Kept-metric count of the engine's rank-1.
 * @param band - The largest ratio between the two counts that still counts as comparable.
 * @returns Whether the pair can be conditioned on inventory size.
 */
export function inventoryComparable(
  sourceKept: number,
  winnerKept: number,
  band: number = INVENTORY_MATCH_BAND,
): boolean {
  const low = Math.min(sourceKept, winnerKept);
  const high = Math.max(sourceKept, winnerKept);
  if (low === 0) return high === 0;
  return high / low <= band;
}

/**
 * The fold count, matching the discriminator's default.
 *
 * Not configurable: it is the SAME split the discriminator fits on, and a second knob would let
 * the two modules report different held-out fifths of one dump.
 */
const FOLDS = 5;

/** A cell's counts over the inventory-MATCHED subset of its row's pairs. */
export interface SeparatorNearCell {
  /** Matched pairs the signal could order — this rate's own denominator. */
  readonly pairs: number;
  readonly source: number;
  readonly winner: number;
  readonly tie: number;
  readonly auc: number | undefined;
}

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
  /**
   * The same counts over the pairs whose two sides have COMPARABLE inventories.
   *
   * A decomposition-based signal is confounded with how many metrics each side keeps, and the
   * confound is not hypothetical: `kept` and `decisiveCv` correlate at r = 0.436 across the pairs'
   * services, and the source keeps fewer metrics than the winner in 511 of 662. Exact equality
   * cannot condition that away (26 pairs), so the band-matched subset is reported beside the
   * headline rate — descriptive, with its size, rather than a second claim selected from a scan.
   */
  readonly near: SeparatorNearCell;
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
  /**
   * Pairs whose two sides render the SAME NUMBER of kept metrics — the only pairs a
   * decomposition-based signal can be conditioned on.
   *
   * The count is printed because a confound check has to state its power: the block renders a
   * decomposition in proportion to how many metrics a service keeps, so "does this composition
   * signal survive the rendering?" can only be asked where the two sides agree. In the weak block
   * that is 1 pair of 159 and 0 of 83 — the confound is SATURATED rather than excluded, and this
   * column is how a reader sees it without running anything else.
   */
  readonly sameInventoryPairs: number;
  /**
   * Pairs whose two sides are within {@link INVENTORY_MATCH_BAND} of each other on kept metrics.
   *
   * The coarsened twin of {@link sameInventoryPairs}, and the one with power: it is what turns "the
   * confound is saturated" into a rate on a stratum, at the price of that stratum not being the
   * whole population (the pairs it drops are the ones where the two inventories differ most).
   */
  readonly nearInventoryPairs: number;
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
  /**
   * Pairs where no non-`term` signal prefers the source.
   *
   * **A menu-relative statistic, and the menu size must be printed with it.** It read 43/666 over
   * ten non-term signals and 0/666 over fifteen: adding better signals does not mean the earlier 43
   * pairs stopped being hard, it means the question "is there any evidence at all" is answered by
   * the MENU. Printed as a bare count it invites exactly the wrong reading, so
   * {@link formatSeparatorCensus} names the menu beside it.
   */
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
  /** The ratio band the matched column uses; see {@link INVENTORY_MATCH_BAND}. */
  readonly inventoryBand: number;
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
function toCell(name: string, role: SeparatorRole, tally: Tally, near: Tally): SeparatorCell {
  const measurable = tally.source + tally.winner + tally.tie;
  const nearMeasurable = near.source + near.winner + near.tie;
  return {
    name,
    role,
    source: tally.source,
    winner: tally.winner,
    tie: tally.tie,
    unmeasurable: tally.unmeasurable,
    auc: measurable === 0 ? undefined : (tally.source + tally.tie / 2) / measurable,
    p: separationPValue(tally.source, tally.winner),
    near: {
      pairs: nearMeasurable,
      source: near.source,
      winner: near.winner,
      tie: near.tie,
      auc: nearMeasurable === 0 ? undefined : (near.source + near.tie / 2) / nearMeasurable,
    },
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

  /** Whether the two sides' inventories are comparable within `band`. */
  const comparable = (pair: SeparatorPair, band: number): boolean => {
    const source = inventoryOf(pair.source)?.rendered;
    const winner = inventoryOf(pair.winner)?.rendered;
    // A pair whose block rendered no competition cannot be conditioned on one: the counts are
    // absent, not zero, and `inventoryComparable(0, 0)` would call two unrendered sides comparable.
    return (
      source !== undefined &&
      winner !== undefined &&
      inventoryComparable(source.kept, winner.kept, band)
    );
  };

  const build = (faultType: string, subset: readonly SeparatorPair[]): SeparatorRow => {
    const empty = (): Tally => ({ source: 0, winner: 0, tie: 0, unmeasurable: 0 });
    const tallies = new Map<string, Tally>(
      SEPARATOR_SIGNALS.map((signal) => [signal.name, empty()]),
    );
    const nearTallies = new Map<string, Tally>(
      SEPARATOR_SIGNALS.map((signal) => [signal.name, empty()]),
    );
    for (const pair of subset) {
      const subject = subjectOf.get(pair.datapack)!;
      const matched = comparable(pair, INVENTORY_MATCH_BAND);
      for (const signal of SEPARATOR_SIGNALS) {
        const verdict = signal.prefers(pair, subject);
        const tally = tallies.get(signal.name)!;
        if (verdict === 'unmeasurable') tally.unmeasurable++;
        else tally[verdict]++;
        if (!matched) continue;
        const near = nearTallies.get(signal.name)!;
        if (verdict === 'unmeasurable') near.unmeasurable++;
        else near[verdict]++;
      }
    }
    return {
      faultType,
      pairs: subset.length,
      sameInventoryPairs: subset.filter((pair) => comparable(pair, 1)).length,
      nearInventoryPairs: subset.filter((pair) => comparable(pair, INVENTORY_MATCH_BAND)).length,
      cells: SEPARATOR_SIGNALS.map((signal) =>
        toCell(signal.name, signal.role, tallies.get(signal.name)!, nearTallies.get(signal.name)!),
      ),
    };
  };

  const byType = new Map<string, SeparatorPair[]>();
  for (const pair of pairs) {
    const list = byType.get(pair.faultType);
    if (list === undefined) byType.set(pair.faultType, [pair]);
    else list.push(pair);
  }
  // The rows CARRY their subsets. A second lookup by fault type would need a fallback that cannot
  // fire (rows are the type map), and a fallback that cannot fire is dead code pretending to be
  // defensive — the same reason the earlier `?? []` was removed.
  const built = [...byType.entries()].map(([faultType, subset]) => ({
    row: build(faultType, subset),
    subset,
  }));
  built.sort((a, b) => b.row.pairs - a.row.pairs || (a.row.faultType < b.row.faultType ? -1 : 1));
  const rows = built.map((entry) => entry.row);
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
  for (const { row, subset } of built) {
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
    inventoryBand: INVENTORY_MATCH_BAND,
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
    '  `kept=` is how many pairs render the same number of kept metrics on both sides — the only',
  );
  lines.push(
    '  pairs a decomposition-based signal can be conditioned on, so a confound check can state its',
  );
  lines.push(
    `  power: saturated (few) is not the same as excluded (many). \`kept<=\` is the COARSENED match ` +
      `(within a factor of ${census.inventoryBand}), which is the stratum the matched columns are ` +
      'read on:',
  );
  lines.push(
    '  it is not the whole population, because the pairs it drops are the ones whose inventories',
  );
  lines.push('  differ most');
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
      '  kept='.padStart(7) +
      ' kept<='.padStart(7) +
      '  metric      log      lat temporal   best non-term            AUC          p' +
      '  AUC(matched)',
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
      `  ${label.padEnd(labelWidth - 2)}${String(row.pairs).padStart(5)}` +
        `${String(row.sameInventoryPairs).padStart(7)}` +
        `${String(row.nearInventoryPairs).padStart(7)}${columns}   ` +
        `${(best?.name ?? 'none measurable').padEnd(22)}${aucText(best?.auc).padStart(6)}` +
        `${pText(best?.p).padStart(12)}${mark}` +
        `${aucText(best?.near.auc).padStart(14)}`,
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
      'p'.padStart(11) +
      `  n(kept<=${census.inventoryBand})`.padStart(15) +
      '  AUC(matched)'.padStart(14),
  );
  for (const cell of [...census.total.cells].sort(
    (a, b) => (b.auc ?? -1) - (a.auc ?? -1) || (a.name < b.name ? -1 : 1),
  )) {
    lines.push(
      `  ${cell.name.padEnd(labelWidth - 2)}${cell.role.padEnd(11)}` +
        `${String(measurableOf(cell)).padStart(6)}` +
        `${String(cell.source).padStart(8)}${String(cell.winner).padStart(8)}` +
        `${String(cell.tie).padStart(6)}${String(cell.unmeasurable).padStart(6)}` +
        `${aucText(cell.auc).padStart(8)}${pText(cell.p).padStart(11)}` +
        `${String(cell.near.pairs).padStart(15)}${aucText(cell.near.auc).padStart(14)}`,
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
      `the source, over the ${census.total.cells.filter((cell) => cell.role !== 'term').length} ` +
      'non-term signals screened — menu-relative by construction, so compare it only against the ' +
      'same menu',
  );
  return lines.join('\n');
}
