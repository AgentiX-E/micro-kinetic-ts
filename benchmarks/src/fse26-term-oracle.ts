/**
 * Reconstruct the engine's three scored terms from a diagnostic dump, and rank a
 * case under each of them.
 *
 * The dump carries more than a record: the printed service order IS the metric
 * term's order (the formatter sorts by self-anomaly), the log score is printed per
 * service, and the raw logic/framework-HTTP counts are printed next to it. So the
 * shipped score can be recomputed — and recomputing it reproduces the dump's own
 * rank-1 for every case (1422/1422 on the shipped `rcabench-full-v3` dump), which is
 * what makes this module an INSTRUMENT rather than a model. Every number it reports
 * is a free read: no run, no cache rebuild.
 *
 * Two details make it exact, and both are easy to get wrong:
 *
 * 1. `rankNormalizeScores` assigns the AVERAGE 0-indexed rank of a value's TIE
 *    GROUP, divided by `n - 1`. Reading a rank off a service's POSITION instead is
 *    wrong wherever two services share a printed anomaly — the rows then receive the
 *    distinct ranks the engine collapsed into their mean, and the error is largest
 *    exactly where the ordering is tightest. The groups are recoverable because the
 *    printed value IS the group's mean, so the reconstruction reproduces the printed
 *    value to 5e-4 on every service of every case; the report CHECKS that rather
 *    than assuming it.
 * 2. The printed order is re-derived from the printed values through the printer's
 *    own comparator, not taken from the array order, so a caller that has re-sorted
 *    the services still gets the engine's ranks. Whether the two agree is itself a
 *    reported number: a dump where they disagree is a defect, not a nuance.
 *
 * An EMPTY service id is a real candidate and not a parse artefact. In 1421 of the
 * 1422 cases one printed row has no service name — it carries the ten unlabelled
 * `k8s.*` series (`k8s.container.*`, `k8s.pod.phase`, …) and nothing else — and it
 * participates in the engine's normalisation: it is one of the `n` candidates, which
 * is what puts the metric term's step at exactly `1/50`. Dropping it silently, as an
 * id-requiring regex does, shifts `n` and therefore every service's metric term, so
 * this module keeps it and reports its occurrence.
 *
 * The LOG term has a precision limit that the report prints rather than hides: the
 * dump prints `logScore` at three decimals while the counts behind it reach
 * thousands, so RE-DERIVING the log term from the counts — which is what comparing
 * log MODES requires — can move a case whose margin is below 5e-4. That is 5 cases
 * on the shipped dump, all `HTTPResponseReplaceBody`, and it is why a mode's
 * pre-screen is a filter and never a measurement: a predicted gain inside that band
 * is not evidence.
 *
 * @module benchmarks/fse26-term-oracle
 */

import type { DiagnosedCase } from './fse26-diagnose-analyze.js';

/** The three terms the shipped score sums. */
export type TermName = 'metric' | 'log' | 'lat';

/**
 * Which log term to rank with.
 *
 * `recorded` is the run's OWN term, read from the dump's `logScore` field: it is the
 * measurement, and it is deliberately distinguishable from the three reconstructions
 * so no report can present a re-derived number as the run's. The other three are the
 * engine's `LogSignalMode`s that can be rebuilt from the printed raw counts —
 * `novelty` cannot, because it needs per-class line counts the dump does not carry.
 */
export type LogTermSource = 'recorded' | 'count' | 'logicHttp' | 'dominant';

/** A service and the score a given configuration gives it. */
interface ScoredService {
  readonly serviceId: string;
  readonly score: number;
}

/**
 * The configuration a ranking is reconstructed at.
 *
 * Every field is required, including the dominance threshold: the shipped values
 * live in the engine's package and are imported by the caller, so a report cannot
 * describe a configuration the engine does not have. A default restated here would
 * be a second owner of a shipped constant — how the diagnosis module once came to
 * report the shipped signal's decisions as engine anomalies.
 */
export interface TermOracleOptions {
  readonly logWeight: number;
  readonly latWeight: number;
  readonly latFloor: number;
  readonly dominance: number;
  /**
   * The dominance thresholds to pre-screen, in ascending order. Data rather than a
   * literal inside the renderer, so the frontier a report shows is the grid the
   * caller asked for and a test can drive it with two points.
   */
  readonly dominanceGrid: readonly number[];
}

/**
 * The latency term's per-service score, rebuilt from the dump.
 *
 * Deliberately the same shape as the engine's `computeEdgeLatencyScores`, because the
 * point is to predict what the ENGINE would do: the raw `latRise` on the service line
 * is a ratio, and the term applies `log1p(max(0, rise − 1))` to it and then
 * max-normalises across the case. An unmeasured service is ABSENT from the result
 * rather than present with a 0, which is the same distinction the engine keeps.
 *
 * Lives here rather than in the analysis module because this module owns "rebuild a
 * term from a dump"; the analysis module imports it and re-exports it, so existing
 * callers keep their import path.
 *
 * @param services - One case's services, as parsed.
 * @param minRise - Rise a service must clear to be credited at all; default 1, the
 *   shipped shape. A rise **above 1 but below this** is dropped, so the service reads
 *   as unmeasured. A rise **at or below 1** is always kept, because the engine's rule
 *   is that such a service is present with magnitude 0, and redefining that here
 *   would break the `minRise = 1` identity with the shipped term.
 * @returns The normalised slope per measured service; empty when no measurement
 *   carries a rise, in which case every slope is 0 and the term cannot reorder.
 */
export function latencySlopes(
  services: DiagnosedCase['services'],
  minRise = 1,
): Map<string, number> {
  const magnitudes = new Map<string, number>();
  for (const service of services) {
    const rise = service.latRise;
    if (rise === undefined || !Number.isFinite(rise)) continue;
    // The floor is a MASK, not a compression, and that is what makes it a different
    // axis from any pointwise reshaping of the slope. It can only delete a service's
    // vote: the surviving maximum is always the case maximum, so the divisor never
    // moves and no slope is ever raised. It therefore cannot remove a spurious
    // COMPETITOR without also removing that same service as a CREDITEE, so its net
    // effect is decided entirely by whether those two roles share a service.
    if (rise > 1 && rise < minRise) continue;
    magnitudes.set(service.serviceId, Math.log1p(Math.max(0, rise - 1)));
  }
  let max = 0;
  for (const magnitude of magnitudes.values()) if (magnitude > max) max = magnitude;
  // Every measurable edge got faster (or nothing was measured), so there is no rise
  // to normalise against and the term is 0 for everyone.
  if (max <= 0) return new Map();
  const slopes = new Map<string, number>();
  for (const [serviceId, magnitude] of magnitudes) {
    slopes.set(serviceId, magnitude / max);
  }
  return slopes;
}

/**
 * The printer's comparator: self-anomaly descending, service id ascending.
 *
 * Reproduced rather than assumed, which is what makes the metric term's
 * reconstruction independent of the array order. `''` sorts first among equals,
 * which is also what the ENGINE's comparator does with an empty id.
 */
function printedOrder(services: DiagnosedCase['services']): DiagnosedCase['services'][number][] {
  return [...services].sort((a, b) => {
    if (b.selfAnomaly !== a.selfAnomaly) return b.selfAnomaly - a.selfAnomaly;
    return a.serviceId < b.serviceId ? -1 : 1;
  });
}

/**
 * The metric term, exactly as `rankNormalizeScores` computes it.
 *
 * The tie-group mean is recovered from the printed values: the printed value IS that
 * mean, so consecutive services sharing a value are one group and receive the average
 * of the ranks they occupy. With distinct values this reduces to `(n - 1 - i) / (n - 1)`
 * for position `i`, which is the shipped shape.
 *
 * @param services - One case's services.
 * @returns The metric term per service, in [0, 1].
 */
export function metricSlopes(services: DiagnosedCase['services']): Map<string, number> {
  const ordered = printedOrder(services);
  const n = ordered.length;
  const slopes = new Map<string, number>();
  // A single candidate is its own maximum; `n - 1` would divide by zero. The engine
  // returns the raw scores unchanged in that case, and a raw score is not in [0, 1],
  // but with one candidate nothing can reorder, so the value is never decisive.
  if (n < 2) {
    for (const service of ordered) slopes.set(service.serviceId, service.selfAnomaly);
    return slopes;
  }
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && ordered[j + 1]!.selfAnomaly === ordered[i]!.selfAnomaly) j++;
    const mean = (n - 1 - (i + j) / 2) / (n - 1);
    for (let k = i; k <= j; k++) slopes.set(ordered[k]!.serviceId, mean);
    i = j + 1;
  }
  return slopes;
}

/**
 * The top emitter's share of the case's framework-HTTP flood.
 *
 * `max(http) / sum(http)` over the parsed services — the engine's
 * `computeHttpEmitterDominance().dominance`, whose inputs the dump prints as raw
 * per-service counts. `0` means no framework-HTTP line survived the run's own
 * filtering, which is why the gate below reads `share >= threshold` only when there
 * is a flood: a threshold of 0 must not turn "no line at all" into "fully
 * concentrated".
 *
 * @param services - One case's services.
 * @returns The share in [0, 1].
 */
export function httpDominance(services: DiagnosedCase['services']): number {
  let total = 0;
  let top = 0;
  for (const service of services) {
    total += service.httpExceptionCount;
    if (service.httpExceptionCount > top) top = service.httpExceptionCount;
  }
  return total === 0 ? 0 : top / total;
}

/**
 * Rebuild the log term for one of the engine's countable modes.
 *
 * The engine's denominator is the level-1 maximum — `max(logic + http)` — and it stays
 * there even when the direction gate withdraws the framework-HTTP half, because a
 * denominator taken from the post-suppression counts would promote a mid-tier emitter
 * to 1.0 and let a subtractive gate manufacture a rank. That asymmetry is reproduced
 * here, and it is the whole content of the `dominant` reconstruction.
 *
 * @param services - One case's services.
 * @param mode - `count`, `logicHttp` or `dominant`.
 * @param dominance - Threshold for `dominant`; ignored by the other two.
 * @returns The log term per positively-scored service. A service at 0 is ABSENT
 *   rather than present with a 0 — for ranking the two are the same, and the engine's
 *   own map assigns 0 to every node, so the density is not lost.
 */
export function logSlopesForMode(
  services: DiagnosedCase['services'],
  mode: Exclude<LogTermSource, 'recorded'>,
  dominance: number,
): Map<string, number> {
  const numerator = new Map<string, number>();
  const denominator = new Map<string, number>();
  const concentrated = mode === 'dominant' && httpDominance(services) >= dominance;
  for (const service of services) {
    const logic = service.logicExceptionCount;
    // The level-1 flood: logic exceptions plus framework HTTP, for every counting
    // mode. It is the denominator whatever the gate below decides.
    denominator.set(service.serviceId, logic + service.httpExceptionCount);
    if (mode === 'count') numerator.set(service.serviceId, logic);
    else if (mode === 'logicHttp')
      numerator.set(service.serviceId, logic + service.httpExceptionCount);
    else numerator.set(service.serviceId, logic + (concentrated ? service.httpExceptionCount : 0));
  }
  let max = 0;
  for (const value of denominator.values()) if (value > max) max = value;
  // No admitted line anywhere: the engine returns an empty map, not zeros, and a
  // term that credited everyone equally by dividing by zero would reorder nothing but
  // would read as a measurement.
  if (max <= 0) return new Map();
  const slopes = new Map<string, number>();
  for (const [serviceId, value] of numerator) {
    if (value > 0) slopes.set(serviceId, value / max);
  }
  return slopes;
}

/** Rank scored services with the engine's comparator. */
function rankScored(scored: readonly ScoredService[]): string[] {
  return [...scored]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.serviceId < b.serviceId ? -1 : 1;
    })
    .map((entry) => entry.serviceId);
}

/** One case's reconstructed terms and the orders they induce. */
export interface CaseRankings {
  /** The shipped score's order, for the log source requested. */
  readonly order: readonly string[];
  /** Each term's OWN order, which is what a single-term question asks about. */
  readonly byTerm: Readonly<Record<TermName, readonly string[]>>;
}

/**
 * Rebuild one case's terms and the orderings they induce.
 *
 * The blended order is `log1p(metric) + logWeight·log + latWeight·lat`, which is the
 * shipped formula with the priors this benchmark leaves off. The per-term orders are
 * separate because "which term alone would have named the root" is a different
 * question from "what does the blend say", and conflating them is how a blend's
 * success gets credited to a term that never voted for the root.
 *
 * @param kase - One parsed case.
 * @param opts - The configuration to reconstruct at.
 * @param logSource - Which log term to use.
 * @param latSlopes - The case's latency term, from {@link latencySlopes}.
 * @returns The blended order and one order per term.
 */
export function rankCase(
  kase: DiagnosedCase,
  opts: TermOracleOptions,
  logSource: LogTermSource,
  latSlopes: ReadonlyMap<string, number>,
): CaseRankings {
  const metric = metricSlopes(kase.services);
  const log =
    logSource === 'recorded'
      ? new Map(kase.services.filter((s) => s.logScore > 0).map((s) => [s.serviceId, s.logScore]))
      : logSlopesForMode(kase.services, logSource, opts.dominance);
  const blended: ScoredService[] = kase.services.map((service) => ({
    serviceId: service.serviceId,
    // The metric term's map is TOTAL — {@link metricSlopes} assigns an entry to every
    // service — so its lookup asserts rather than falling back. A `?? 0` here could
    // never fire, and if it ever did it would fabricate a metric term of zero for a
    // service the map cannot be missing: the term would silently stop voting.
    score:
      Math.log1p(metric.get(service.serviceId)!) +
      opts.logWeight * (log.get(service.serviceId) ?? 0) +
      opts.latWeight * (latSlopes.get(service.serviceId) ?? 0),
  }));
  return {
    order: rankScored(blended),
    byTerm: {
      metric: rankScored(
        kase.services.map((s) => ({ serviceId: s.serviceId, score: metric.get(s.serviceId)! })),
      ),
      log: rankScored(
        // The log term's own order is over the log term ALONE, so a service with no
        // log evidence scores 0 and is ranked by id — the same degenerate order the
        // engine would produce with only this term switched on.
        kase.services.map((s) => ({ serviceId: s.serviceId, score: log.get(s.serviceId) ?? 0 })),
      ),
      lat: rankScored(
        kase.services.map((s) => ({
          serviceId: s.serviceId,
          score: latSlopes.get(s.serviceId) ?? 0,
        })),
      ),
    },
  };
}

/**
 * Instrument fidelity, measured on the dump being read.
 *
 * Every field is a comparison against something the ENGINE wrote, so a drift shows up
 * as a number rather than as a silent assumption. `top1Matches` is the one that
 * matters: if the reconstruction reproduces the dump's own rank-1 for every case, the
 * terms it rebuilds are the terms the run scored with.
 */
export interface OracleFidelity {
  readonly cases: number;
  readonly services: number;
  /** Largest |reconstructed metric term − printed selfAnomaly|. */
  readonly metricMaxDeviation: number;
  /** Services where that deviation exceeds 5e-4 — the printed precision. */
  readonly metricViolations: number;
  /** Cases whose array order is the order the printer's comparator induces. */
  readonly orderConsistent: number;
  /** Cases where the reconstruction reproduces the dump's own rank-1. */
  readonly top1Matches: number;
  /** Cases where the reconstruction's rank-1 is an acceptable root. */
  readonly top1Correct: number;
  /** Services where the counts-derived `logicHttp` log term differs from the printed one by > 6e-4. */
  readonly recordedLogViolations: number;
  /**
   * Cases whose rank-1 the counts-derived log term moves — the instrument's error
   * bar for every mode comparison, stated as a count rather than as a caveat.
   */
  readonly recordedLogFlips: number;
}

/** Measure the instrument against the dump it is reading. */
export function oracleFidelity(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
): OracleFidelity {
  let services = 0;
  let metricMaxDeviation = 0;
  let metricViolations = 0;
  let orderConsistent = 0;
  let top1Matches = 0;
  let top1Correct = 0;
  let recordedLogViolations = 0;
  let recordedLogFlips = 0;
  for (const kase of cases) {
    const metric = metricSlopes(kase.services);
    const ordered = printedOrder(kase.services);
    if (ordered.every((service, i) => service.serviceId === kase.services[i]?.serviceId)) {
      orderConsistent++;
    }
    for (const service of kase.services) {
      services++;
      // Total by construction, as in `rankCase`.
      const deviation = Math.abs(metric.get(service.serviceId)! - service.selfAnomaly);
      if (deviation > metricMaxDeviation) metricMaxDeviation = deviation;
      if (deviation > 5e-4) metricViolations++;
    }
    const lat = latencySlopes(kase.services, opts.latFloor);
    const recorded = rankCase(kase, opts, 'recorded', lat);
    const derived = rankCase(kase, opts, 'logicHttp', lat);
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    const winner = recorded.order[0];
    if (winner !== undefined && winner === kase.prediction[0]) top1Matches++;
    if (winner !== undefined && root.has(winner)) top1Correct++;
    if (derived.order[0] !== winner) recordedLogFlips++;
    const derivedLog = logSlopesForMode(kase.services, 'logicHttp', opts.dominance);
    for (const service of kase.services) {
      if (Math.abs((derivedLog.get(service.serviceId) ?? 0) - service.logScore) > 6e-4) {
        recordedLogViolations++;
      }
    }
  }
  return {
    cases: cases.length,
    services,
    metricMaxDeviation,
    metricViolations,
    orderConsistent,
    top1Matches,
    top1Correct,
    recordedLogViolations,
    recordedLogFlips,
  };
}

/** One cell of a tally keyed by the terms that named the root. */
export interface Tally {
  readonly key: string;
  readonly cases: number;
}

/**
 * The family a dominant metric belongs to.
 *
 * Ordered PREFIX rules on purpose, and the order is load-bearing: `http.server`
 * duration has both a bare and a `.max` variant in the inventory, and a classifier
 * keyed on the FULL name reports them as two families — which is how a 47-case
 * separation becomes two 30-case ones that look like noise. Anything the rules do not
 * claim is returned as its OWN name rather than bucketed into `other`: an unclassified
 * series that is silently pooled cannot be noticed, and noticing it is the point.
 *
 * The families are the ones a reader of this benchmark needs to tell apart — a
 * network/HTTP symptom the service merely serves, a client-side duration it measured,
 * the DB pool, and the service's OWN resource series — not a canonical metric taxonomy.
 *
 * @param dominantMetric - The metric that won the service's anomaly maximum, or `''`.
 * @returns The family name.
 */
export function dominantFamily(dominantMetric: string): string {
  if (dominantMetric === '') return 'none';
  const rules: readonly (readonly [string, string])[] = [
    ['hubble_http', 'hubble_http'],
    ['http.server.request.duration', 'http.server.duration'],
    ['http.client.request.duration', 'http.client.duration'],
    ['db.client.connections', 'db.client.connections'],
    ['container.', 'container'],
    ['k8s.', 'k8s'],
    ['jvm.', 'jvm'],
    ['queueSize', 'queueSize'],
    ['otlp', 'trace'],
    ['processedSpans', 'trace'],
    ['processedLogs', 'trace'],
  ];
  for (const [prefix, family] of rules) {
    if (dominantMetric.startsWith(prefix)) return family;
  }
  return dominantMetric;
}

/** One family's presence on the two sides of a miss. */
export interface FamilyCensusCell {
  readonly key: string;
  /** Misses whose (first) root's dominant metric is this family. */
  readonly source: number;
  /** Misses whose wrong rank-1 winner's dominant metric is this family. */
  readonly winner: number;
}

/**
 * Census the dominant-metric FAMILY of the source against the wrong winner, over the
 * misses.
 *
 * This exists because a shipped verdict asserted the opposite from ten sampled rows:
 * `docs/fse26-data-gap-verdict.md` read "the source's dominant metric is almost always
 * `hubble_http_request_duration_pXX`", and the population says that family separates the
 * two sides by 2 cases out of 672. A feature screen is only usable if it can be
 * recomputed, so it lives here rather than in a session's throwaway probe.
 *
 * `source` is the MOST ANOMALOUS acceptable root, because the parsed service list is in
 * the printer's anomaly order — not `groundTruth[0]`, which is the order the LABEL lists
 * its roots in. The two differ only for a case with two acceptable roots
 * (`NetworkPartition` labels `mysql` AND its co-located service), and for those the
 * anomalous one is the side the ranking actually weighed.
 *
 * @param cases - Parsed cases.
 * @returns One cell per family, sorted by the larger of the two counts, descending.
 */
export function dominantFamilyCensus(cases: readonly DiagnosedCase[]): readonly FamilyCensusCell[] {
  const source = new Map<string, number>();
  const winner = new Map<string, number>();
  for (const kase of cases) {
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    const top = kase.prediction[0];
    if (root.size === 0 || top === undefined || root.has(top)) continue;
    const sourceService = kase.services.find((service) => root.has(service.serviceId));
    const winnerService = kase.services.find((service) => service.serviceId === top);
    if (sourceService === undefined || winnerService === undefined) continue;
    bump(source, dominantFamily(sourceService.dominantMetric));
    bump(winner, dominantFamily(winnerService.dominantMetric));
  }
  const keys = [...new Set([...source.keys(), ...winner.keys()])];
  return keys
    .map((key) => ({ key, source: source.get(key) ?? 0, winner: winner.get(key) ?? 0 }))
    .sort(
      (a, b) =>
        Math.max(b.source, b.winner) - Math.max(a.source, a.winner) || (a.key < b.key ? -1 : 1),
    );
}

/**
 * Render the dominant-family census.
 *
 * The delta column is `winner − source`, signed, because that is the direction a rule
 * would have to exploit: a family the SOURCE owns is a candidate for crediting, and a
 * family the WINNER owns is a candidate for discounting. A cell near zero is the
 * finding that a sampled claim missed.
 *
 * @param cells - The census.
 * @returns The section text.
 */
export function formatFamilyCensus(cells: readonly FamilyCensusCell[]): string {
  const lines: string[] = [];
  const misses = cells.reduce((sum, cell) => sum + cell.source, 0);
  lines.push(`Dominant-metric family of the source vs the wrong winner (${misses} misses):`);
  if (cells.length === 0) {
    lines.push('  (no miss carries both a root and a winner row)');
    return lines.join('\n');
  }
  lines.push('  family                        source  winner   delta');
  for (const cell of cells) {
    const delta = cell.winner - cell.source;
    lines.push(
      `  ${cell.key.padEnd(26)}${String(cell.source).padStart(6)}` +
        `${String(cell.winner).padStart(8)}${`${delta >= 0 ? '+' : ''}${delta}`.padStart(8)}`,
    );
  }
  return lines.join('\n');
}
/** What each term would have decided on its own, and what that bounds. */
export interface OracleCensus {
  readonly cases: number;
  /** Keyed by the `+`-joined terms whose OWN order names a root, or `none`. */
  readonly rootsFirst: readonly Tally[];
  /** Keyed by `<terms that are right> beats <terms that are wrong>`. */
  readonly conflicts: readonly Tally[];
  /** The metric rank of a root (the best-ranked one), histogrammed. */
  readonly rootMetricRank: readonly Tally[];
  readonly shippedCorrect: number;
  /**
   * Cases the best single term names — the ceiling for any pure-term ranker. The
   * metric base cannot be switched off in the shipped formula, so this bounds a
   * hypothetical rather than an implementable menu; it is reported because a
   * discriminator that cannot reach it cannot reach the blend either.
   */
  readonly singleTermCeiling: number;
  /** Cases no single term names. */
  readonly singleTermUnreachable: number;
  /** Cases the best BLEND CONFIGURATION names — the implementable menu's ceiling. */
  readonly menuCeiling: number;
  /** Keyed by the configuration names that cover a case; overlapping by construction. */
  readonly menuCoverage: readonly Tally[];
}

/**
 * The blend configurations a per-case chooser could pick from.
 *
 * Each is a POINT of the shipped formula with one term switched off, and the latency
 * point carries the SHIPPED weight: a chooser deciding "is the latency term helping
 * this case" switches the shipped term on or off, it does not also invent a weight.
 * Deriving the row from the options rather than typing `1` here keeps the menu in
 * agreement with the configuration under study — a menu point the engine cannot take
 * would make the ceiling a statement about a configuration that does not exist.
 */
function menuConfigurations(
  opts: TermOracleOptions,
): readonly { readonly name: string; readonly logWeight: number; readonly latWeight: number }[] {
  return [
    { name: 'log only', logWeight: 1, latWeight: 0 },
    { name: 'metric only', logWeight: 0, latWeight: 0 },
    { name: 'lat only', logWeight: 0, latWeight: opts.latWeight },
  ];
}

/** Tally a counter into a descending, deterministic list. */
function tally(counter: ReadonlyMap<string, number>): Tally[] {
  return [...counter.entries()]
    .map(([key, cases]) => ({ key, cases }))
    .sort((a, b) => b.cases - a.cases || (a.key < b.key ? -1 : 1));
}

/** Increment a counter entry, which is the only mutation any tally performs. */
function bump(counter: Map<string, number>, key: string, by = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + by);
}

/**
 * Census the shipped dump: which term is right, which pairs disagree, and what a
 * perfect per-case choice would be worth.
 *
 * The conflict tally is the point. Two terms can each be right on a large population
 * and wrong on another, which no single weight can serve at once — so the tally is
 * the direct measurement of the obstacle a per-case discriminator would have to
 * resolve, and its size is the headroom that discriminator would be spending.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration to reconstruct at.
 * @returns The census.
 */
export function oracleCensus(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
): OracleCensus {
  const rootsFirst = new Map<string, number>();
  const conflicts = new Map<string, number>();
  const rootMetricRank = new Map<string, number>();
  const menuCoverage = new Map<string, number>();
  const terms: readonly TermName[] = ['metric', 'log', 'lat'];
  let counted = 0;
  let shippedCorrect = 0;
  let singleTermCeiling = 0;
  let menuCeiling = 0;
  for (const kase of cases) {
    // EVERY acceptable root, never `groundTruth[0]`: the benchmark's labels are a
    // list and a ranking that puts any of them first is correct.
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    if (root.size === 0) continue;
    counted++;
    if (kase.prediction[0] !== undefined && root.has(kase.prediction[0])) shippedCorrect++;
    const lat = latencySlopes(kase.services, opts.latFloor);
    const rankings = rankCase(kase, opts, 'recorded', lat);
    const right = terms.filter((term) => root.has(rankings.byTerm[term][0] ?? ''));
    const wrong = terms.filter((term) => {
      const top = rankings.byTerm[term][0];
      return top !== undefined && !root.has(top);
    });
    bump(rootsFirst, right.length === 0 ? 'none' : right.join('+'));
    if (right.length > 0 && wrong.length > 0)
      bump(conflicts, `${right.join('+')} beats ${wrong.join('+')}`);
    if (right.length > 0) singleTermCeiling++;
    const bestRank = Math.min(
      ...kase.services
        .filter((service) => root.has(service.serviceId))
        .map((service) => rankings.byTerm.metric.indexOf(service.serviceId) + 1),
    );
    if (Number.isFinite(bestRank)) bump(rootMetricRank, String(bestRank));
    const covered: string[] = [];
    for (const configuration of menuConfigurations(opts)) {
      const menuRankings = rankCase(
        kase,
        { ...opts, logWeight: configuration.logWeight, latWeight: configuration.latWeight },
        'recorded',
        lat,
      );
      if (root.has(menuRankings.order[0] ?? '')) covered.push(configuration.name);
    }
    if (root.has(rankings.order[0] ?? '')) covered.push('shipped');
    if (covered.length > 0) menuCeiling++;
    bump(menuCoverage, covered.join('+'));
  }
  return {
    cases: counted,
    rootsFirst: tally(rootsFirst),
    conflicts: tally(conflicts),
    rootMetricRank: tally(rootMetricRank),
    shippedCorrect,
    singleTermCeiling,
    singleTermUnreachable: counted - singleTermCeiling,
    menuCeiling,
    menuCoverage: tally(menuCoverage),
  };
}

/** One log term's pre-screen row. */
export interface ModeScreenRow {
  readonly source: LogTermSource;
  /** The dominance threshold, or `undefined` for the sources that do not read one. */
  readonly dominance: number | undefined;
  readonly correct: number;
  readonly gainedCases: number;
  readonly regressedCases: number;
  /** Fault types with a strictly higher Top@1 than the baseline. */
  readonly gainedTypes: readonly Tally[];
  /** Fault types with a strictly lower Top@1 — the kill criterion's second half. */
  readonly regressedTypes: readonly Tally[];
  readonly perFaultType: readonly {
    readonly key: string;
    readonly correct: number;
    readonly total: number;
  }[];
}

/** A pre-screen of the log term's alternative modes, all from one dump. */
export interface ModeScreen {
  /** The baseline row (`recorded`) first, then the reconstructions. */
  readonly rows: readonly ModeScreenRow[];
}

/**
 * Pre-screen the log term's alternative modes against the run's own, from one dump.
 *
 * Every row is compared against the BASELINE ROW's per-case outcome, not against an
 * absolute count, because the instrument's own error bar moves the absolute count:
 * the counts-derived `logicHttp` row scores 5 cases above the run it is derived from,
 * and reporting that difference as a gain would be reporting a rounding artefact as a
 * mode's effect. Regressions are therefore counted per FAULT TYPE, which is what the
 * shared kill criterion asks about.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration to reconstruct at.
 * @returns The rows, baseline first.
 */
export function modeScreen(cases: readonly DiagnosedCase[], opts: TermOracleOptions): ModeScreen {
  const sources: readonly { source: LogTermSource; dominance: number | undefined }[] = [
    { source: 'recorded', dominance: undefined },
    { source: 'count', dominance: undefined },
    { source: 'logicHttp', dominance: undefined },
    ...opts.dominanceGrid.map((dominance) => ({ source: 'dominant' as const, dominance })),
  ];
  // One list of scorable cases, built ONCE: a per-source rebuild of the type list
  // would pair each source's outcomes with a growing list of fault types and the
  // per-type tallies would silently read the wrong case's type.
  const scorable = cases.filter((kase) => kase.groundTruth.some((name) => name !== ''));
  const latSlopes = new Map(
    scorable.map((kase) => [kase, latencySlopes(kase.services, opts.latFloor)]),
  );
  const rows: ModeScreenRow[] = [];
  const outcomes = new Map<string, boolean[]>();
  for (const entry of sources) {
    // The ROW's threshold, not the options': reading `opts.dominance` here rendered a
    // sweep whose every point was computed at the same threshold — a grid that printed
    // seven identical rows and read as a plateau the mode does not have. The threshold
    // has exactly one owner per row, and it is the row.
    const forRow: TermOracleOptions =
      entry.dominance === undefined ? opts : { ...opts, dominance: entry.dominance };
    outcomes.set(
      `${entry.source}@${entry.dominance ?? ''}`,
      scorable.map((kase) => {
        const root = new Set(kase.groundTruth.filter((name) => name !== ''));
        const rankings = rankCase(kase, forRow, entry.source, latSlopes.get(kase)!);
        return root.has(rankings.order[0] ?? '');
      }),
    );
  }
  const baseline = outcomes.get('recorded@')!;
  for (const entry of sources) {
    const hits = outcomes.get(`${entry.source}@${entry.dominance ?? ''}`)!;
    const perType = new Map<string, { correct: number; total: number }>();
    const baseByType = new Map<string, number>();
    let correct = 0;
    let gainedCases = 0;
    let regressedCases = 0;
    for (let i = 0; i < hits.length; i++) {
      const faultType = scorable[i]!.faultType;
      const cell = perType.get(faultType) ?? { correct: 0, total: 0 };
      cell.total++;
      if (hits[i] === true) {
        cell.correct++;
        correct++;
      }
      perType.set(faultType, cell);
      if (baseline[i] === true) baseByType.set(faultType, (baseByType.get(faultType) ?? 0) + 1);
      if (hits[i] === true && baseline[i] !== true) gainedCases++;
      if (baseline[i] === true && hits[i] !== true) regressedCases++;
    }
    const gainedTypes = new Map<string, number>();
    const regressedTypes = new Map<string, number>();
    for (const [faultType, cell] of perType) {
      const baseCorrect = baseByType.get(faultType) ?? 0;
      if (cell.correct > baseCorrect) gainedTypes.set(faultType, cell.correct - baseCorrect);
      if (cell.correct < baseCorrect) regressedTypes.set(faultType, cell.correct - baseCorrect);
    }
    rows.push({
      source: entry.source,
      dominance: entry.dominance,
      correct,
      gainedCases,
      regressedCases,
      gainedTypes: tally(gainedTypes),
      regressedTypes: tally(regressedTypes),
      perFaultType: [...perType.entries()]
        .map(([key, cell]) => ({ key, correct: cell.correct, total: cell.total }))
        .sort((a, b) => (a.key < b.key ? -1 : 1)),
    });
  }
  return { rows };
}

/** Render a percentage with two decimals, for a report a human compares. */
function pct(value: number, total: number): string {
  return total === 0 ? 'n/a' : `${((100 * value) / total).toFixed(2)}%`;
}

/** The shared header: which dump, and at which configuration. */
export type LogTermSourceLabel = (source: LogTermSource, dominance: number | undefined) => string;

const defaultSourceLabel: LogTermSourceLabel = (source, dominance) =>
  dominance === undefined ? source : `${source}@${dominance}`;

/**
 * Render the instrument's fidelity section.
 *
 * Printed FIRST and unconditionally, because every later section is a claim about the
 * engine made through this reconstruction: a reader who cannot see that the
 * reconstruction reproduces the run's own rank-1 has no reason to read the rest, and
 * a fidelity check that is only run when someone remembers to run it is not a check.
 *
 * @param fidelity - The measured fidelity.
 * @param opts - For the configuration the check ran at.
 * @returns The section text.
 */
export function formatFidelity(fidelity: OracleFidelity, opts: TermOracleOptions): string {
  const lines: string[] = [];
  lines.push('Instrument fidelity (reconstruction vs the dump it reads):');
  lines.push(
    `  cases ${fidelity.cases}; services ${fidelity.services}; ` +
      `logWeight=${opts.logWeight} latWeight=${opts.latWeight} latFloor=${opts.latFloor}`,
  );
  lines.push(
    `  metric term: max |recomputed - printed| = ${fidelity.metricMaxDeviation.toExponential(2)}; ` +
      `services above 5e-4: ${fidelity.metricViolations}`,
  );
  lines.push(
    `  printed order reproduced from the printed values: ` +
      `${fidelity.orderConsistent}/${fidelity.cases} cases`,
  );
  lines.push(
    `  rank-1 reproduced: ${fidelity.top1Matches}/${fidelity.cases} cases; ` +
      `rank-1 an acceptable root: ${fidelity.top1Correct}`,
  );
  lines.push(
    `  log term: counts-derived vs printed, services above 6e-4: ${fidelity.recordedLogViolations}; ` +
      `cases whose rank-1 moves: ${fidelity.recordedLogFlips} (the error bar for any mode row below)`,
  );
  return lines.join('\n');
}

/**
 * Render the term-oracle census.
 *
 * @param census - The census.
 * @param opts - The configuration.
 * @returns The section text.
 */
export function formatOracleCensus(census: OracleCensus, opts: TermOracleOptions): string {
  const lines: string[] = [];
  lines.push(`Term oracle (which term's OWN order names a root; ${census.cases} cases):`);
  lines.push(`  ${census.rootsFirst.map((t) => `${t.key} ${t.cases}`).join('; ')}`);
  lines.push(
    `  single-term ceiling ${census.singleTermCeiling} (${pct(census.singleTermCeiling, census.cases)}); ` +
      `unreachable by any single term ${census.singleTermUnreachable}`,
  );
  lines.push(
    `  menu ceiling (best of ${menuConfigurations(opts).length} blends + shipped) ${census.menuCeiling} ` +
      `(${pct(census.menuCeiling, census.cases)}); shipped ${census.shippedCorrect} ` +
      `(${pct(census.shippedCorrect, census.cases)})`,
  );
  lines.push('  conflicts (terms that are right beats terms that are wrong):');
  for (const conflict of census.conflicts.slice(0, 8)) {
    lines.push(`    ${conflict.key}: ${conflict.cases}`);
  }
  lines.push('  metric rank of a root (best-ranked root):');
  const ranks = [...census.rootMetricRank].sort((a, b) => Number(a.key) - Number(b.key));
  lines.push(`    ${ranks.map((t) => `#${t.key} ${t.cases}`).join('  ')}`);
  lines.push('  menu coverage (which configurations name a root; a case can appear twice):');
  for (const coverage of census.menuCoverage) {
    lines.push(`    ${coverage.key}: ${coverage.cases}`);
  }
  return lines.join('\n');
}

/**
 * Render the log-mode pre-screen.
 *
 * Every row is annotated with whether it passes the shared kill criterion's second
 * half, so the report cannot be read as "this mode gains more" without also reading
 * how many fault types it costs.
 *
 * @param screen - The pre-screen.
 * @param label - How to name a row's configuration.
 * @returns The section text.
 */
export function formatModeScreen(
  screen: ModeScreen,
  label: LogTermSourceLabel = defaultSourceLabel,
): string {
  const lines: string[] = [];
  const baseline = screen.rows[0];
  lines.push('Log-term mode pre-screen (every row against the recorded log term, per fault type):');
  if (baseline !== undefined) {
    lines.push(
      `  baseline ${label(baseline.source, baseline.dominance)}: ${baseline.correct} correct`,
    );
  }
  lines.push('  configuration           correct   +/-cases   regressed types');
  for (const row of screen.rows) {
    const name = label(row.source, row.dominance).padEnd(22);
    const regressed =
      row.regressedTypes.length === 0
        ? '0  (PASSES the second half)'
        : `${row.regressedTypes.length}  ${row.regressedTypes
            .map((t) => `${t.key} ${t.cases}`)
            .join(', ')}`;
    lines.push(
      `  ${name}${String(row.correct).padStart(5)}   ` +
        `+${row.gainedCases}/-${row.regressedCases}`.padEnd(10) +
        `  ${regressed}`,
    );
  }
  return lines.join('\n');
}

/**
 * Render the whole term-oracle section for one dump.
 *
 * @param cases - Parsed cases.
 * @param label - The dump's path, echoed so a pasted report is traceable.
 * @param opts - The configuration.
 * @returns The report text.
 */
export function formatTermOracleReport(
  cases: readonly DiagnosedCase[],
  label: string,
  opts: TermOracleOptions,
): string {
  const sections = [
    formatFidelity(oracleFidelity(cases, opts), opts),
    formatOracleCensus(oracleCensus(cases, opts), opts),
    formatFamilyCensus(dominantFamilyCensus(cases)),
    formatModeScreen(modeScreen(cases, opts)),
  ];
  return [`Term oracle — ${label}`, ...sections].join('\n');
}
