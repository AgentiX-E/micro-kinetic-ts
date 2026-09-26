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
 * The metric term is READ off the row rather than rebuilt. The engine ranks on `log1p` of its
 * own per-service anomaly (`pruner.ts` 1400 and 1575) and the formatter prints that value on
 * every row, so a reconstruction has no business re-deriving it. It used to: it rebuilt the
 * engine's rank rescale from the printed order, which is the same quantity ONLY where the
 * engine rescaled, i.e. at or above `ANOMALY_NORMALIZE_NODE_THRESHOLD` nodes. Below that
 * threshold the row carries a RAW deviation, and the substitution silently handed the
 * reconstruction the engine's ORDER (any rescale here is strictly monotone) and not its gaps.
 * Measured on the RCAEval dumps that is 407 of 615 cases, and on the paired dispatch which
 * cases the reconstruction got wrong was exactly the two below the threshold.
 *
 * Two details do have to be got right, and both are REPORTED rather than assumed:
 *
 * 1. Whether a case was rescaled is a property of its node count, and the header's `services=`
 *    carries it. So the instrument counts the cases on each side of the threshold and checks the
 *    side it can: at or above it no value may EXCEED 1, because both of the engine's rescales map
 *    the case maximum to 1 and neither can produce anything above it. Below it no claim is made —
 *    a raw deviation is unbounded in the rise direction. The stronger form of that check ("the
 *    maximum IS exactly 1.000") was written first and the first REAL dump falsified it: a tied top
 *    anomaly takes its tie group's MEAN rank, so 34 of the FSE'26 dump's 1422 rescaled cases carry
 *    0.95–0.99. The falsifiable half and the tie count are two lines, and neither is a claim about
 *    the other.
 * 2. The printed order is re-derived from the printed values through the printer's own
 *    comparator, not taken from the array order, so a caller that has re-sorted the services
 *    still gets the engine's ranks. Whether the two agree is itself a reported number: a dump
 *    where they disagree is a defect, not a nuance. It disagrees where the three-decimal
 *    render collapses two distinct anomalies onto one string, which is a resolution limit of
 *    the artifact and NOT a statement about the engine.
 *
 * An EMPTY service id is a real candidate and not a parse artefact. In 1421 of the
 * 1422 cases one printed row has no service name — it carries the ten unlabelled
 * `k8s.*` series (`k8s.container.*`, `k8s.pod.phase`, …) and nothing else — and it
 * participates in the engine's normalisation: it is one of the candidates the header's
 * `services=` counts, which is exactly what the rescale threshold above is read against.
 * Dropping it silently, as an id-requiring regex does, also makes the parsed row count
 * disagree with that header.
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

import {
  ANOMALY_NORMALIZE_NODE_THRESHOLD,
  computeOnsetSlopes,
  computeTemporalEarliness,
  DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  DEFAULT_LOG_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  POOL_METRIC_PREFIX,
  type OnsetShape,
} from '../../packages/tree/src/index.js';

import type { DiagnosedCase } from './fse26-diagnose-analyze.js';

/**
 * The three terms the shipped score sums that have an ORDER of their own.
 *
 * Two shipped terms are deliberately absent, on ONE rule: a term whose own order is a
 * TIE broken by id, which would add arbitrary service ids to a tally of causal claims.
 *
 * - the pool-dominance PENALTY: its own order is every non-pool service, tied.
 * - the injection-anchored temporal prior: its credit is a mask ({@link OnsetShape}), so
 *   in the shipped `earliest-only` shape its own order is the first mover followed by
 *   everybody else, tied.
 *
 * Both exclusions are stated rather than silent, and neither term is unmeasured:
 * {@link OracleFidelity.poolFlips} and {@link OracleFidelity.temporalFlips} count the
 * cases each one reorders, and the miss attribution carries a `temporal` contribution.
 */
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
export type LogTermSource =
  'recorded' | 'count' | 'logicHttp' | 'logicHttpJoint' | 'dominant' | 'all';

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
  /**
   * The run's DB-connection-pool dominance penalty — the score's FOURTH term.
   *
   * Required, like every other weight here, and imported by the caller from the engine:
   * the shipped configuration has this term ON, so a reconstruction that omits it
   * describes an engine that does not exist and would report the shipped run's own
   * decisions as the instrument disagreeing with itself.
   */
  readonly poolWeight: number;
  /**
   * The run's injection-anchored temporal prior — the score's FIFTH term, and the most
   * recent one to ship.
   *
   * Required for the reason the pool penalty is: the reconstruction is the run's score,
   * and a missing live term turns every one of ITS decisions into the instrument
   * disagreeing with itself. That is not hypothetical — the pool penalty produced exactly
   * that footprint, and this term's own footprint on the 1422-case dump is
   * {@link OracleFidelity.temporalFlips} cases.
   */
  readonly temporalWeight: number;
  /**
   * Which shape the temporal prior reads the onset delays in.
   *
   * A weight is a claim about a shape, so a reconstruction that carried one without the
   * other is not a configuration — and this field is why `blendScores` takes the pair
   * rather than a factor.
   */
  readonly onsetShape: OnsetShape;
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
 * Reproduced rather than assumed, which is what makes the fidelity check below
 * independent of the array order the parser happened to produce. `''` sorts first among
 * equals, which is also what the ENGINE's comparator does with an empty id.
 */
function printedOrder(services: DiagnosedCase['services']): DiagnosedCase['services'][number][] {
  return [...services].sort((a, b) => {
    if (b.selfAnomaly !== a.selfAnomaly) return b.selfAnomaly - a.selfAnomaly;
    return a.serviceId < b.serviceId ? -1 : 1;
  });
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
 * The level-1 flood for one countable mode: the lines the engine's
 * `isSourceSignature` gate ADMITS, recovered from the counts the dump prints.
 *
 * The gate is a boolean per line, so a line that carries both source-signature
 * flags is admitted ONCE — the flood is the union, not the sum of the two sets.
 * Measured on the shipped dump (`35035314921`), a framework-HTTP flood overlaps
 * almost completely with the logic set: one case's source carries `logic=3495`
 * inside `http=3499`, out of `err=3499` lines. Adding the counts makes the flood
 * 6994 instead of 3499, and every reconstructed score in that case is then half
 * the engine's — 109 services, which the instrument reported as its "error bar"
 * rather than as the defect it was.
 *
 * The admitted SET is mode-dependent, which is why the union is computed here
 * rather than printed pre-combined: `count` admits logic lines alone (a purely
 * framework-HTTP line is not a `count`-mode source signature), the `logicHttp`
 * family admits both, and `all` would admit every ERROR/FATAL. The denominator
 * must follow the same gate as the numerator, or the ratio is between two
 * different sets — and for `count` that means the HTTP half is not consulted at
 * all, so the overlap cannot move it either.
 *
 * Two ways to learn the union, in order:
 *
 * 1. the printed `both=` count, which is the primitive and needs no argument;
 * 2. for a dump that predates it, the arithmetic ({@link recoveredFlood}). The union is bracketed by
 *    `max(logic, http) ≤ |logic ∪ http| ≤ min(logic + http, err + fatal)` — the first because each set is
 *    contained in the union, the second because every admitted line is an ERROR/FATAL line. When the bracket
 *    collapses to a point the value is PROVED, not guessed: measured on the shipped dump, **72496 of the
 *    72527 service rows** pin it. When it does not collapse the value is genuinely unknown, and this returns
 *    `undefined` rather than a bound — which is the state of **31 rows in 31 cases** of that dump, refused
 *    over an interval 1 to 7 lines wide. The claim this paragraph used to carry ("all 71105 services pin
 *    it") was false twice: 71105 is the count a parser that drops the UNLABELLED rows produces, and 31 rows
 *    do not pin. The reach is a printed quantity now ({@link logFloodReach}, one row of the mode screen),
 *    because a comment is a copy and a copy drifts.
 *
 * @param service - One service's printed counts.
 * @param mode - Which signature set this mode admits.
 * @returns The number of lines the mode's level-1 gate lets through, or
 *   `undefined` when the union cannot be recovered from this service's fields.
 */
function levelOneFlood(
  service: DiagnosedCase['services'][number],
  mode: Exclude<LogTermSource, 'recorded'>,
): number | undefined {
  if (mode === 'count') return service.logicExceptionCount;
  // `all` admits EVERY ERROR/FATAL line, so its level-1 flood is the whole error count and
  // there is no union to recover — which is why this is the one counting mode measurable on a
  // dump that predates `both=`, and it is read straight off `err`/`fatal`.
  if (mode === 'all') return service.errorCount + service.fatalCount;
  const recovered = recoveredFlood(service);
  return recovered.proved ? recovered.value : undefined;
}

/**
 * The modes whose gate needs the case's call graph.
 *
 * `logicHttpJoint` withdraws the framework-HTTP half for an emitter with a more anomalous callee,
 * which is a statement about an EDGE. A dump that recorded no graph cannot be rebuilt in it.
 */
const MODE_NEEDS_GRAPH: ReadonlySet<LogTermSource> = new Set<LogTermSource>(['logicHttpJoint']);

/**
 * The services the `logicHttpJoint` gate withdraws the framework-HTTP half from.
 *
 * Mirrored from the engine's `computeHttpVictimSet`, adapted to what a dump carries: the predicate
 * is `anomaly(callee) > anomaly(emitter)`, read by ORDER only, so the rank-normalised
 * `selfAnomaly` a block prints yields exactly the set the engine's raw scores do — a strictly
 * monotone rescale cannot change a strict inequality, which the engine's own invariance suite
 * asserts for both of its rescales. That is what makes this rebuild faithful rather than similar.
 *
 * The predicate is EXISTENTIAL over a service's callees, and that is the leading explanation for
 * the mode's historical loss: on a dense cascade most emitters have at least one more-anomalous
 * callee, so the victim set approaches the whole graph and the mode degenerates toward `count`
 * (`docs/fse26-logicHttpJoint-falsified.md`). This function is where that set is now countable.
 *
 * @param services - One case's services.
 * @param edges - The case's call graph (`caller>callee`), or `undefined` for a dump without one.
 * @returns The victim services; empty when the dump recorded no graph.
 */
function httpVictims(
  services: DiagnosedCase['services'],
  edges: readonly string[] | undefined,
): Set<string> {
  const victims = new Set<string>();
  if (edges === undefined) return victims;
  const anomaly = new Map(services.map((service) => [service.serviceId, service.selfAnomaly]));
  for (const edge of edges) {
    const separator = edge.indexOf('>');
    if (separator <= 0) continue;
    const from = edge.slice(0, separator);
    const to = edge.slice(separator + 1);
    // A service the block does not describe reads as 0, which is what the engine's own `?? 0`
    // does for a node it has no score for.
    if ((anomaly.get(to) ?? 0) > (anomaly.get(from) ?? 0)) victims.add(from);
  }
  return victims;
}

/**
 * The union `levelOneFlood` recovers, and how wide the interval it had to be chosen from is.
 *
 * One owner for the arithmetic, because two questions are asked of it — may this be read at all, and what
 * does a refusal cost — and a second copy of the bracket is how the two come to disagree. A `proved` result
 * is the union; a refused one carries the interval's width, i.e. how many lines the value is UNKNOWN within.
 * Naming the width is what makes a refusal quantifiable, and it is why the refusal is not merely conservative:
 * measured on the shipped FSE'26 dump (`35035314921`), the 31 refused rows are refused over intervals of
 * **1 to 32 lines**, and relative to the floods they divide (31 to 12809) that is one line in seventeen of
 * them but **a third of the flood** in the smallest (`logic=22 http=11 err=33`, refused over 11) — so the
 * reader is refusing where the answer would actually move. The cause is that the artifact predates the
 * printed `both=`, and a fresh dispatch ends the question entirely.
 *
 * @param service - One service's printed counts.
 * @returns The union when the bracket collapsed, or the width of the interval when it did not.
 */
function recoveredFlood(
  service: DiagnosedCase['services'][number],
):
  | { readonly proved: true; readonly value: number }
  | { readonly proved: false; readonly width: number } {
  const logic = service.logicExceptionCount;
  const http = service.httpExceptionCount;
  const declared = service.bothExceptionCount;
  if (declared !== undefined) return { proved: true, value: logic + http - declared };
  const lower = Math.max(logic, http);
  const upper = Math.min(logic + http, service.errorCount + service.fatalCount);
  return lower === upper ? { proved: true, value: lower } : { proved: false, width: upper - lower };
}

/** What a mode's reconstruction reaches on a set of services. */
export interface LogFloodReach {
  /** Services whose union is proved, or comes from the printed `both=`. */
  readonly proved: number;
  /** Services the reconstruction must refuse. */
  readonly unproved: number;
  /**
   * The widest interval a refusal was made over, in lines — `0` when nothing was refused.
   *
   * The cost of the refusal, in the units the flood is counted in, so a reader can tell "refused over one
   * line of a 12802-line flood" from "refused over half of it".
   */
  readonly widestRefusal: number;
}

/**
 * What a mode's reconstruction reaches on a set of services — the number its readers are entitled to.
 *
 * `levelOneFlood`'s doc used to assert that every service of the shipped dump pinned its union, and the
 * assertion was false twice over: the population it named (71105) was the count a parser that DROPS the
 * unlabelled rows produces — the artifact's own `services=` sums to **72527** — and even at that population
 * 31 rows do not pin, in 31 distinct cases, over intervals of 1 to 32 lines. The report showed the
 * consequence without the mechanism (`[1391/1422 cases]`); this function is the mechanism, and the row prints
 * both. The modes that need no union (`count`, `all`) are reachable by construction, so their failures are
 * zero and are returned as such rather than walked.
 *
 * @param services - The services a reconstruction would be run over.
 * @param mode - The mode whose reconstruction is being attempted.
 * @returns How many services it reaches, how many it must refuse, and the widest refusal.
 */
export function logFloodReach(
  services: DiagnosedCase['services'],
  mode: Exclude<LogTermSource, 'recorded'>,
): LogFloodReach {
  if (mode === 'count' || mode === 'all') {
    // Neither consults the union, so neither can be refused — by construction, not by luck.
    return { proved: services.length, unproved: 0, widestRefusal: 0 };
  }
  let unproved = 0;
  let widestRefusal = 0;
  for (const service of services) {
    const recovered = recoveredFlood(service);
    if (recovered.proved) continue;
    unproved += 1;
    widestRefusal = Math.max(widestRefusal, recovered.width);
  }
  return { proved: services.length - unproved, unproved, widestRefusal };
}

/**
 * Whether the log term can be reconstructed for a mode from a case's printed fields.
 *
 * Per-mode, because the modes need different quantities: `count` divides by the logic
 * count alone and is always recoverable, while the `logicHttp` family needs the union
 * and is recoverable only when the dump prints the overlap or the error total pins it.
 *
 * @param services - One case's services.
 * @param mode - The mode whose reconstruction is being attempted.
 * @returns `true` when every service's flood is recoverable.
 */
export function canReconstructLogFlood(
  services: DiagnosedCase['services'],
  mode: Exclude<LogTermSource, 'recorded'>,
): boolean {
  return logFloodReach(services, mode).unproved === 0;
}

/**
 * Rebuild the log term for one of the engine's countable modes.
 *
 * The engine's numerator is the level-1 flood minus the lines its direction gate
 * withdraws, and its denominator is the level-1 MAXIMUM — which stays on level 1
 * even when the gate withdraws the framework-HTTP half, because a denominator taken
 * from the post-suppression counts would promote a mid-tier emitter to 1.0 and let a
 * subtractive gate manufacture a rank. That asymmetry is reproduced here, and it is
 * the whole content of the `dominant` reconstruction.
 *
 * @param services - One case's services.
 * @param mode - `count`, `logicHttp` or `dominant`.
 * @param dominance - Threshold for `dominant`; ignored by the other two.
 * @returns The log term per positively-scored service. A service at 0 is ABSENT
 *   rather than present with a 0 — for ranking the two are the same, and the engine's
 *   own map assigns 0 to every node, so the density is not lost.
 * @throws When a service's flood is unrecoverable (see {@link levelOneFlood});
 *   guard with {@link canReconstructLogFlood} when reading an unknown dump.
 */
export function logSlopesForMode(
  services: DiagnosedCase['services'],
  mode: Exclude<LogTermSource, 'recorded'>,
  dominance: number,
  edges?: readonly string[],
): Map<string, number> {
  if (mode === 'logicHttpJoint' && edges === undefined) {
    // Not a default. With no graph the joint gate cannot withdraw anything, so defaulting would
    // rebuild the UNJOINTED term and label it `logicHttpJoint` — the same shape of defect as
    // defaulting an unpinned flood, and the reason this mode's row is drawn only for a dump that
    // carries a graph.
    throw new Error(
      "the `logicHttpJoint` gate needs the case's call graph to decide which framework-HTTP " +
        'counts to withdraw, and this dump recorded none. Only a dump produced with the graph can ' +
        'be rebuilt in this mode.',
    );
  }
  const numerator = new Map<string, number>();
  const denominator = new Map<string, number>();
  const concentrated = mode === 'dominant' && httpDominance(services) >= dominance;
  const victims = mode === 'logicHttpJoint' ? httpVictims(services, edges) : undefined;
  for (const service of services) {
    // The denominator is the mode's own level-1 flood, whatever the gate decides.
    const flood = levelOneFlood(service, mode);
    if (flood === undefined) {
      // A bound is not the value: defaulting to it would reproduce the double-count
      // (upper) or silently understate the flood (lower), and the resulting scores
      // would read exactly like measured ones.
      throw new Error(
        `cannot recover the level-1 flood for ${service.serviceId}: logic=${service.logicExceptionCount} ` +
          `http=${service.httpExceptionCount} err=${service.errorCount} fatal=${service.fatalCount} ` +
          'bracket the union without pinning it, and the dump carries no `both=` count. ' +
          'Re-run with the current producer, whose service lines print the overlap.',
      );
    }
    denominator.set(service.serviceId, flood);
    if (mode === 'count') numerator.set(service.serviceId, flood);
    else if (mode === 'logicHttp' || mode === 'all') numerator.set(service.serviceId, flood);
    else if (mode === 'logicHttpJoint') {
      // A logic exception is self-evidently a source signature and is never withdrawn; only the
      // framework-HTTP half goes, and only for an emitter whose callee is more anomalous.
      const overlap = Math.max(0, service.logicExceptionCount + service.httpExceptionCount - flood);
      const httpOnly = service.httpExceptionCount - overlap;
      numerator.set(
        service.serviceId,
        service.logicExceptionCount + (victims!.has(service.serviceId) ? 0 : httpOnly),
      );
    } else {
      // `dominant` withdraws exactly the framework-HTTP lines that are NOT logic
      // lines, so what survives the gate is the logic set plus the http-only set.
      // Subtracting the overlap is what makes the withdrawal a subtraction rather
      // than a replacement of one set by another.
      const overlap = Math.max(0, service.logicExceptionCount + service.httpExceptionCount - flood);
      numerator.set(
        service.serviceId,
        service.logicExceptionCount + (concentrated ? service.httpExceptionCount - overlap : 0),
      );
    }
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
/**
 * Whether a service's dominant metric belongs to the pool family.
 *
 * The PREFIX is the engine's, imported; the RULE is restated here, because the dump
 * carries a bare label while the engine's classifier takes its own metric objects. A
 * restatement is a risk, so the tests validate it against the engine's own classifier
 * rather than assuming it: a screen that penalises a different family than the engine
 * does is a screen that validates nothing, and it would fail silently — both sides still
 * producing numbers.
 *
 * A service with NO dominant metric is not penalised. The engine credits only a MEASURED
 * dominance, and a fabricated penalty would be a finding that grows with the weight.
 *
 * @param dominantMetric - The label the dump printed for the service.
 * @returns Whether the penalty applies to it.
 */
export function isPoolDominantLabel(dominantMetric: string): boolean {
  return dominantMetric.startsWith(POOL_METRIC_PREFIX);
}

/**
 * The engine's earliness map for one parsed case, rebuilt from the dump.
 *
 * Deliberately EMPTY, never neutral-filled, when the term cannot act — that is the
 * engine's own spelling and it is the one thing a screen must not paper over: a map
 * filled with 0.5 for every service would make "no usable onsets" and "every service
 * equally early" the same object, and the first is a data gap while the second is a
 * result. Callers that want a value per service use {@link onsetSlopes}.
 *
 * @param kase - One parsed case.
 * @returns Earliness in [0, 1] per service; empty when the term is inert.
 */
export function onsetEarliness(kase: DiagnosedCase): Map<string, number> {
  const delays = new Map<string, number>();
  for (const service of kase.services) {
    if (service.onsetDelayMs !== undefined) delays.set(service.serviceId, service.onsetDelayMs);
  }
  return computeTemporalEarliness(delays, kase.injectTimeMs ?? 0);
}

/**
 * The shapes the screen sweeps — the ENGINE's own declaration, imported.
 *
 * Not restated here: a local copy could drift to a shape the ranking does not
 * implement, and every row below would stay green while the screen measured a term
 * that does not exist. `ONSET_SHAPES` is the single list the CLI documents, the
 * workflow accepts and the screen iterates.
 */

/**
 * One case's onset slope per service, in one shape — TOTAL over the case.
 *
 * A thin adapter, and deliberately no more than one: the shape arithmetic lives in the
 * engine's {@link computeOnsetSlopes} so the ranking and this reconstruction cannot
 * disagree about what a shape means, and all this adds is the one thing a summation
 * needs and the engine does not — an entry for EVERY service. An omitted entry would be
 * a missing slope in a score, and a term that credits whoever it failed to look up.
 *
 * @param kase - One parsed case.
 * @param shape - Which shape to build; defaults to the engine's own.
 * @returns The slope per service; total over the case's services.
 */
export function onsetSlopes(
  kase: DiagnosedCase,
  shape: OnsetShape = DEFAULT_ONSET_SHAPE,
): Map<string, number> {
  const delays = new Map<string, number>();
  for (const service of kase.services) {
    if (service.onsetDelayMs !== undefined) delays.set(service.serviceId, service.onsetDelayMs);
  }
  const measured = computeOnsetSlopes(delays, kase.injectTimeMs ?? 0, shape);
  const slopes = new Map<string, number>();
  for (const service of kase.services) {
    // 0 for a service the engine left out, which is the same value the engine's own
    // `?? 0` at the ranking reads: no credit, not "neutral credit".
    slopes.set(service.serviceId, measured.get(service.serviceId) ?? 0);
  }
  return slopes;
}

/**
 * The score the shipped engine ranks by, per service.
 *
 * `log1p(selfAnomaly) + logWeight·log + latWeight·lat + temporalWeight·onset
 * − poolWeight·[pool-dominant]`, which is the engine's own `finalScore` with the priors
 * this benchmark leaves off.
 *
 * The first term is the row's OWN `selfAnomaly`, because that is what the engine ranked
 * on: `selfScores` is filled with the node's anomaly score as the topology builder left
 * it (`pruner.ts` 1400/1575), which is RAW below `ANOMALY_NORMALIZE_NODE_THRESHOLD` nodes
 * and rescaled to [0, 1] at or above it. Reading the printed value is faithful on BOTH
 * sides of that boundary without the reconstruction having to know where it is — and a
 * reconstruction that instead rebuilt the rescale from the printed order would have the
 * engine's ORDER and invent its gaps on every case below the threshold.
 *
 * Exported because a candidate penalty's zero-regression window is solved from SCORE
 * GAPS between two services, and a solver that re-derived the blend would be a second
 * implementation of the very quantity being measured — the defect this module exists to
 * find. It is also what makes the pool term's own contribution an exact number rather
 * than an ordering claim.
 *
 * @param kase - One parsed case.
 * @param opts - The configuration to reconstruct at.
 * @param logSource - Which log term to use.
 * @param latSlopes - The case's latency term, from {@link latencySlopes}.
 * @returns Every candidate's score; total, so a lookup asserts rather than defaulting.
 */
export function blendScores(
  kase: DiagnosedCase,
  opts: TermOracleOptions,
  logSource: LogTermSource,
  latSlopes: ReadonlyMap<string, number>,
): Map<string, number> {
  const log =
    logSource === 'recorded'
      ? new Map(kase.services.filter((s) => s.logScore > 0).map((s) => [s.serviceId, s.logScore]))
      : logSlopesForMode(kase.services, logSource, opts.dominance, kase.edges);
  // TOTAL over the case's services, like the latency term below and for the same reason:
  // the map is built from `kase.services`, so a lookup cannot miss and an `?? 0` on it
  // could never fire — and if it ever did it would fabricate a slope of zero, i.e. a term
  // that silently stopped voting.
  const onset = onsetSlopes(kase, opts.onsetShape);
  const scores = new Map<string, number>();
  for (const service of kase.services) {
    // The metric term needs no map at all any more: it is a field of the row it scores,
    // which is the whole point — the map that used to sit here existed only to hold a
    // value the reconstruction had substituted for this one.
    scores.set(
      service.serviceId,
      Math.log1p(service.selfAnomaly) +
        opts.logWeight * (log.get(service.serviceId) ?? 0) +
        opts.latWeight * (latSlopes.get(service.serviceId) ?? 0) +
        opts.temporalWeight * onset.get(service.serviceId)! -
        (isPoolDominantLabel(service.dominantMetric) ? opts.poolWeight : 0),
    );
  }
  return scores;
}

/** The five weights the shipped score has — everything {@link shippedScores} needs. */
export interface ShippedScoreWeights {
  readonly logWeight: number;
  readonly latWeight: number;
  readonly latFloor: number;
  readonly poolWeight: number;
  /**
   * The temporal prior's pair, which the caller passes EXPLCITLY even at weight 0.
   *
   * Not optional: a consumer that wants "the shipped configuration minus this term" —
   * an onset screen, say — must say `0` rather than omit the field, because omitting it
   * would make the term's own ablation the same call as the shipped configuration.
   */
  readonly temporalWeight: number;
  readonly onsetShape: OnsetShape;
}

/**
 * The score the engine ranks by, per service, for one case.
 *
 * A thin wrapper over {@link blendScores} with the RECORDED log term, which is the term the
 * dump's own ranking was produced with: a consumer asking "what does the engine score this
 * case at" should not have to know about the mode pre-screen's inputs. The dominance
 * threshold is the engine's own constant and the grid is empty because neither is READ for
 * the recorded source; passing a restated default here would be a second owner of a
 * constant, which is how this module's own defects have started.
 *
 * @param kase - One parsed case.
 * @param weights - The run's five weights.
 * @returns Every candidate's score; total, so a lookup asserts rather than defaulting.
 */
export function shippedScores(
  kase: DiagnosedCase,
  weights: ShippedScoreWeights,
): Map<string, number> {
  return blendScores(
    kase,
    {
      logWeight: weights.logWeight,
      latWeight: weights.latWeight,
      latFloor: weights.latFloor,
      poolWeight: weights.poolWeight,
      temporalWeight: weights.temporalWeight,
      onsetShape: weights.onsetShape,
      dominance: DEFAULT_HTTP_DOMINANCE_THRESHOLD,
      dominanceGrid: [],
    },
    'recorded',
    latencySlopes(kase.services, weights.latFloor),
  );
}

/**
 * Rank-1 under the configuration under study, rebuilt from a dump.
 *
 * THE single owner of "which service does the modelled score put first", so the
 * census, the mode pre-screen and the miss reconciliation cannot disagree about one
 * configuration: three callers that each took their own `argmax` is exactly how a
 * report came to print 750, 756 and 672 for the same run on the same page.
 *
 * The tiebreak is the engine's own — score descending, then service id ascending —
 * because a rank-1 that a tie resolves differently is a different prediction, not a
 * rounding detail.
 *
 * @param kase - One parsed case.
 * @param weights - The run's four weights.
 * @returns The rank-1 service id, or `undefined` for a case with no candidates.
 */
export function shippedRank1(
  kase: DiagnosedCase,
  weights: ShippedScoreWeights,
): string | undefined {
  const scores = shippedScores(kase, weights);
  return rankScored(
    kase.services.map((service) => ({
      serviceId: service.serviceId,
      score: scores.get(service.serviceId)!,
    })),
  )[0];
}

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
 * The blended order is `log1p(selfAnomaly) + logWeight·log + latWeight·lat`, which is the
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
  const log =
    logSource === 'recorded'
      ? new Map(kase.services.filter((s) => s.logScore > 0).map((s) => [s.serviceId, s.logScore]))
      : logSlopesForMode(kase.services, logSource, opts.dominance, kase.edges);
  // The blend comes from `blendScores`, so the score this ranks by IS the score the
  // solver measures — one implementation, not two.
  const scores = blendScores(kase, opts, logSource, latSlopes);
  const blended: ScoredService[] = kase.services.map((service) => ({
    serviceId: service.serviceId,
    score: scores.get(service.serviceId)!,
  }));
  return {
    order: rankScored(blended),
    byTerm: {
      // The metric term's own order, scored through the same `log1p` the blend applies to
      // it — not by the row's raw value, so that a term order and the blend agree about
      // which of two services the term prefers even when their anomalies are close.
      metric: rankScored(
        kase.services.map((s) => ({ serviceId: s.serviceId, score: Math.log1p(s.selfAnomaly) })),
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
  /**
   * Cases at or above the engine's rescale threshold, where its own rescale ran.
   *
   * Counted per case rather than per service because the decision is per case: the
   * threshold reads the graph's NODE count, so every service in one case is on the same
   * side of it. Reported as a population because it is what a reader needs in order to
   * know which quantity the `selfAnomaly` column holds — a rescaled position in [0, 1],
   * or a raw deviation that is unbounded in the rise direction.
   */
  readonly rescaledCases: number;
  /**
   * Cases BELOW that threshold, where no rescale ran and the column holds a raw deviation.
   *
   * The population on which a reconstruction must NOT rebuild the metric term from the
   * printed order: it would inherit the engine's order (any rescale here is strictly
   * monotone) and invent its gaps. Measured on the RCAEval dumps this is 407 of 615 cases
   * — two thirds of the population every window figure in `fse26-cv-screen.md` rests on.
   */
  readonly rawCases: number;
  /**
   * Cases at or above the threshold that carry a value ABOVE 1.000 — a DEFECT claim.
   *
   * The check that replaces the deviation line, and its direction is the one that can actually
   * be falsified: BOTH of the engine's rescales map the case maximum to 1, so a case this large
   * carrying a value above 1 is a case whose scores were NOT rescaled — the threshold moved, or
   * something else wrote the dump. Zero on every dump measured so far.
   *
   * The mirror claim — "at or above the threshold the maximum IS exactly 1.000" — was written
   * first and is FALSE, which the first dump it was pointed at said in one line: 34 of the 1422
   * FSE'26 cases carry a maximum of 0.95–0.99. A tie at the top is why. `rankNormalizeScores`
   * gives a value's TIE GROUP the mean of the ranks it occupies, so six services sharing the
   * largest anomaly take ranks 45..50 and all read `47.5 / 50 = 0.95`; only a STRICTLY unique
   * maximum maps to exactly 1. A counter that fires on the engine's own legal output is worse
   * than no counter, because it teaches its reader to ignore it.
   */
  readonly aboveOneAtOrAboveThreshold: number;
  /**
   * Cases at or above the threshold whose maximum is BELOW 1.000 — a population fact, not a
   * defect: the largest anomaly is TIED in them, so the rescale gives the tie group its mean
   * rank. Reported because it is the number that falsified the stronger claim above, and
   * because a reader who sees a 0.95 maximum needs to know it is arithmetic rather than a
   * missing rescale.
   */
  readonly subUnitMaximumCases: number;
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
   *
   * `0` is the only acceptable value: the derived term is built from the same counts
   * the engine used, so any disagreement is a defect in the reconstruction and not a
   * tolerance. It read **5** for two iterations, and the number was attributed to
   * rounding instead of being read as the defect claim it was — the cause was the
   * `logic + http` flood double-counting lines that carry both flags.
   */
  readonly recordedLogFlips: number;
  /**
   * Cases whose level-1 flood could not be reconstructed because the dump predates
   * the overlap count (`both=`).
   *
   * Non-zero makes {@link recordedLogViolations} and the mode pre-screen meaningless
   * rather than zero: the union `|logic ∪ http|` is then knowable only as an
   * interval, so those counters are reported as UNAVAILABLE, not as clean.
   */
  readonly unreconstructableCases: number;
  /**
   * Cases whose rank-1 the POOL penalty moves, measured against the same terms with the
   * penalty off. The term has no order of its own (see {@link TermName}), so this is how
   * its footprint is reported: a reconstruction that carried the term but never applied
   * it would otherwise read exactly like one that did.
   */
  readonly poolFlips: number;
  /**
   * Cases whose rank-1 the TEMPORAL prior moves, measured against the same terms with its
   * weight at 0.
   *
   * The term has no order of its OWN ({@link TermName} excludes it for the same reason as
   * the pool penalty), but it does have a footprint, and this is it: the number of cases
   * the shipped weight reorders. A reconstruction that carried the term but never applied
   * it would otherwise read exactly like one that did, and this is the only number that
   * separates the two — the term has no order of its own to be counted in the census
   * above.
   *
   * It is NOT the term's cost. A reorder can move the rank-1 between two wrong services,
   * or between the root and a wrong one; only the second kind loses a case, and the count
   * that measures it is `broken` in `reconcileConfigurations`. On the shipped dump this
   * count is 4 while `broken` is 0 — every reorder was either a gain or one wrong winner
   * replaced by another.
   */
  readonly temporalFlips: number;
}

/** Measure the instrument against the dump it is reading. */
export function oracleFidelity(
  cases: readonly DiagnosedCase[],
  opts: TermOracleOptions,
): OracleFidelity {
  let services = 0;
  let rescaledCases = 0;
  let rawCases = 0;
  let aboveOneAtOrAboveThreshold = 0;
  let subUnitMaximumCases = 0;
  let orderConsistent = 0;
  let top1Matches = 0;
  let top1Correct = 0;
  let recordedLogViolations = 0;
  let recordedLogFlips = 0;
  let unreconstructableCases = 0;
  let poolFlips = 0;
  let temporalFlips = 0;
  for (const kase of cases) {
    const ordered = printedOrder(kase.services);
    if (ordered.every((service, i) => service.serviceId === kase.services[i]?.serviceId)) {
      orderConsistent++;
    }
    // The engine's own condition, read from the ONE owner of the threshold and from the
    // node count the header declares (the parser refuses a block whose row count
    // disagrees with it). At or above it the engine rescaled, so no value can EXCEED 1 —
    // the falsifiable half, and the counter that would have caught a consumer assuming a
    // rescale that never ran. Below it the column is raw and no claim is made: a raw
    // deviation is unbounded in the rise direction, and in both directions it is whatever
    // the case's data made it.
    const n = kase.services.length;
    let max = Number.NEGATIVE_INFINITY;
    let over = 0;
    for (const service of kase.services) {
      services++;
      if (service.selfAnomaly > max) max = service.selfAnomaly;
      if (service.selfAnomaly > 1) over++;
    }
    if (n >= ANOMALY_NORMALIZE_NODE_THRESHOLD) {
      rescaledCases++;
      if (over > 0) aboveOneAtOrAboveThreshold++;
      // Not a claim, a measurement: a tied maximum reads as the tie group's MEAN rank over
      // `n - 1`, which is below 1 for every group of two or more. Measured on the FSE'26
      // dump, 34 of 1422 cases — one of them a six-way tie at the top reading `47.5/50`.
      if (max < 1) subUnitMaximumCases++;
    } else {
      rawCases++;
    }
    const lat = latencySlopes(kase.services, opts.latFloor);
    const recorded = rankCase(kase, opts, 'recorded', lat);
    // A case whose flood cannot be recovered is COUNTED, not skipped silently: the
    // counters below are then about a subset of the dump, and reporting that subset
    // as though it were all of it is how an error bar reads as exactness.
    const reconstructable = canReconstructLogFlood(kase.services, 'logicHttp');
    if (!reconstructable) unreconstructableCases++;
    const derived = reconstructable ? rankCase(kase, opts, 'logicHttp', lat) : undefined;
    const root = new Set(kase.groundTruth.filter((name) => name !== ''));
    const winner = recorded.order[0];
    if (winner !== undefined && winner === kase.prediction[0]) top1Matches++;
    if (winner !== undefined && root.has(winner)) top1Correct++;
    if (derived !== undefined && derived.order[0] !== winner) recordedLogFlips++;
    if (rankCase(kase, { ...opts, poolWeight: 0 }, 'recorded', lat).order[0] !== winner) {
      poolFlips++;
    }
    if (rankCase(kase, { ...opts, temporalWeight: 0 }, 'recorded', lat).order[0] !== winner) {
      temporalFlips++;
    }
    if (reconstructable) {
      const derivedLog = logSlopesForMode(kase.services, 'logicHttp', opts.dominance);
      for (const service of kase.services) {
        if (Math.abs((derivedLog.get(service.serviceId) ?? 0) - service.logScore) > 6e-4) {
          recordedLogViolations++;
        }
      }
    }
  }
  return {
    cases: cases.length,
    services,
    rescaledCases,
    rawCases,
    aboveOneAtOrAboveThreshold,
    subUnitMaximumCases,
    orderConsistent,
    top1Matches,
    top1Correct,
    recordedLogViolations,
    recordedLogFlips,
    unreconstructableCases,
    poolFlips,
    temporalFlips,
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
    // The engine's own family, imported rather than restated: this screen validates
    // the term the engine ships, and a second copy of the prefix could drift to a
    // family the engine does not penalise while every number here stayed green.
    [POOL_METRIC_PREFIX, 'db.client.connections'],
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
  /**
   * Cases the configuration UNDER STUDY gets right — the modelled weights' own
   * rank-1, not the dump's recorded one.
   *
   * Modelled rather than recorded because every other number in this census is
   * modelled, and a report that mixes the two prints two different scores for one
   * run: read from `kase.prediction` this read 750 on a page whose mode pre-screen
   * said 756, which is the same run under the same flags. The two agree exactly
   * whenever the flags are the dump's own (the fidelity line measures that), so
   * nothing a faithful reconstruction reports can move because of this.
   */
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
    { name: 'log only', logWeight: DEFAULT_LOG_WEIGHT, latWeight: 0 },
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
    const lat = latencySlopes(kase.services, opts.latFloor);
    const rankings = rankCase(kase, opts, 'recorded', lat);
    if (root.has(rankings.order[0] ?? '')) shippedCorrect++;
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
  /**
   * The cases this row was measured on.
   *
   * A mode that re-derives the log term can only be measured on the cases whose flood
   * it can recover, and the baseline is re-measured on the same list — so this is the
   * row's own population, not the dump's size. A row smaller than the dump is a
   * partial measurement and must say so.
   */
  readonly cases: number;
  /**
   * Service rows this row's reconstruction had to REFUSE across the scorable cases.
   *
   * The mechanism behind a short row: a mode that re-derives the log term can only be read where the union
   * between the logic and framework-HTTP signature sets is recoverable, and that union is recoverable only
   * where the dump prints `both=` or where the printed counts pin it. Measured on the shipped FSE'26 dump
   * (`35035314921`): **31 rows in 31 cases** are refused, which is exactly why the `logicHttp` rows read
   * `[1391/1422 cases]` — the reach at the row level, next to the population at the case level.
   *
   * `undefined` for the baseline row, which reconstructs nothing and therefore refuses nothing: a `0` there
   * would read as "every service was proved", a claim about a reconstruction that never ran.
   */
  readonly unprovedRows: number | undefined;
  /**
   * The widest interval a refusal above was made over, in lines, or `undefined` for the baseline.
   *
   * The COST of the refusal in the units the flood is counted in: `[31 rows unproved over ≤ 7 lines]` is a
   * rounding-error refusal, while the same count over thousands of lines would be a signal the artifact
   * cannot carry at all. Printed with the count so the number cannot be read as either without the other.
   */
  readonly widestRefusal: number | undefined;
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
  /**
   * The dump's own log mode, re-derived from the counts, against the printed one.
   *
   * This is the instrument's sharpest self-check and it needs no extra data: the mode
   * the run used is the mode the reader can rebuild, so the two must agree CASE FOR
   * CASE — `+0/-0`. Any other value is a reconstruction defect, and it is not a small
   * one: while the flood double-counted overlapping signature sets this row read
   * `+5/-0` and was written off as an error bar, which is how the defect survived.
   *
   * `undefined` when the dump's mode is not one this reader rebuilds (e.g. `novelty`,
   * which needs per-class line counts the dump does not carry).
   */
  readonly selfCheck: ModeScreenSelfCheck | undefined;
  /**
   * The mode the dump declares. Carried rather than re-read by the renderer, so the line about
   * the self-check can name it — including when it is the reason there is no check.
   */
  readonly dumpMode: string;
  /**
   * What the joint gate's withdrawal footprint looks like on this dump, or `undefined` when the
   * joint row is not drawn.
   *
   * A row's NET is not a mechanism, and this is the gate's: the victim predicate is EXISTENTIAL
   * over a service's callees, so on a dense cascade most emitters have at least one more-anomalous
   * callee and the withdrawal reaches most of the graph. The decisive number is the last one —
   * how often the emitter that OWNS the framework-HTTP flood is itself withdrawn, which is the
   * gate deleting the evidence it was built to keep.
   */
  readonly jointFootprint: JointFootprint | undefined;
}

/** The `logicHttpJoint` gate's reach on one dump. */
export interface JointFootprint {
  readonly services: number;
  readonly victims: number;
  /** Median share of a case's services that the gate withdraws. */
  readonly medianCaseDensity: number;
  /** Cases whose most framework-HTTP-heavy service has at least one such line. */
  readonly ownerCases: number;
  /** Of those, the ones where that owner is a victim — i.e. its own flood is withdrawn. */
  readonly ownerSuppressed: number;
}

/**
 * One row to pre-screen: the baseline, or a mode that has to be RE-DERIVED.
 *
 * Discriminated on `source` so a branch that requires a rebuildable mode can prove it
 * is not looking at the baseline.
 */
type ModeScreenEntry =
  | { readonly source: 'recorded'; readonly dominance: undefined }
  | {
      readonly source: Exclude<LogTermSource, 'recorded'>;
      readonly dominance: number | undefined;
    };

/** The dump's own mode, re-derived, against the printed one. */
export interface ModeScreenSelfCheck {
  /** What the block declares as its mode. */
  readonly dumpMode: string;
  readonly source: LogTermSource;
  readonly cases: number;
  /**
   * Services whose RE-DERIVED score differs from the printed one by more than 6e-4.
   *
   * The sharp half of the check, and the one that fires first: two reconstructions can
   * rank identically while disagreeing numerically — which is exactly how a
   * double-counted flood survived, because the ranks happened to hold on most cases.
   */
  readonly violations: number;
  /**
   * Cases whose rank-1 the re-derived term moves against the printed one.
   *
   * The half that decides whether the difference MATTERS: a score disagreement that
   * never changes a winner is a rounding-scale statement, while one that does is a
   * different prediction.
   */
  readonly gained: number;
  readonly regressed: number;
}

/**
 * Pre-screen the log term's alternative modes against the run's own, from one dump.
 *
 * Every row is compared against the BASELINE ROW's per-case outcome, not against an
 * absolute count. That was originally because the derived `logicHttp` row scored 5
 * cases above the run it was derived from — an artefact, since the row IS the run's
 * own mode. Those 5 were a reconstruction defect (the flood added two overlapping
 * signature sets), now fixed, so the derived row reproduces the baseline exactly and
 * the row-by-row difference is a mode's effect and nothing else. The per-case
 * comparison stays: it is what makes the difference a difference of OUTCOMES rather
 * than of rounding.
 *
 * @param cases - Parsed cases.
 * @param opts - The configuration to reconstruct at.
 * @returns The rows, baseline first; baseline only when the flood is unavailable.
 */
export function modeScreen(cases: readonly DiagnosedCase[], opts: TermOracleOptions): ModeScreen {
  // One list of scorable cases, built ONCE: a per-source rebuild of the type list
  // would pair each source's outcomes with a growing list of fault types and the
  // per-type tallies would silently read the wrong case's type.
  const scorable = cases.filter((kase) => kase.groundTruth.some((name) => name !== ''));
  const latSlopes = new Map(
    scorable.map((kase) => [kase, latencySlopes(kase.services, opts.latFloor)]),
  );
  // A DISCRIMINATED pair rather than one record with a wide `source`: the rows below
  // branch on whether the source is the baseline, and a union that cannot narrow would
  // let `'recorded'` reach a function that requires a RE-DERIVABLE mode.
  const sources: readonly ModeScreenEntry[] = [
    { source: 'recorded', dominance: undefined },
    { source: 'count', dominance: undefined },
    { source: 'logicHttp', dominance: undefined },
    // The mode that admits every error line. Measured here because the separator census found
    // the population where the gate is what discards the source's own evidence: in the network
    // partition cases the source has MORE total error lines (30-3) and more SIGNATURE lines in
    // none of 29 (`fse26-separator-verdict.md`).
    { source: 'all', dominance: undefined },
    // The joint gate: `logicHttp` minus the framework-HTTP half for an emitter whose callee is
    // more anomalous. Re-measured here because the engine's own doc requires a FRESH ablation on
    // current data before the mode is re-attempted, and the offline rebuild costs nothing.
    { source: 'logicHttpJoint', dominance: undefined },
    ...opts.dominanceGrid.map((dominance) => ({ source: 'dominant' as const, dominance })),
  ];
  const rows: ModeScreenRow[] = [];
  for (const entry of sources) {
    // The ROW's population. A row that re-derives the log term can only be measured on
    // the cases whose flood it can recover, and the BASELINE must be re-measured on the
    // same list — comparing against a baseline computed on a different population would
    // book the population difference as the mode's effect. The row therefore carries its
    // own size, so a partial row is labelled rather than passed off as the whole dump.
    const rowCases =
      entry.source === 'recorded'
        ? scorable
        : scorable.filter(
            (kase) =>
              canReconstructLogFlood(kase.services, entry.source) &&
              // The joint gate is the one mode that needs a SECOND piece of data: a dump with no
              // graph cannot decide which framework-HTTP counts to withdraw, so its row is dropped
              // rather than drawn from an unjointed reconstruction.
              (!MODE_NEEDS_GRAPH.has(entry.source) || kase.edges !== undefined),
          );
    // A reconstruction with no case to measure is OMITTED, because an empty row would
    // print as a mode that scored nothing rather than as one that could not be
    // measured. The baseline is kept even when it is empty: it is the table's own
    // shape, and a dump with nothing scorable is a real input whose report should still
    // say so rather than vanish.
    if (rowCases.length === 0 && entry.source !== 'recorded') continue;
    // The REACH, which is a different number from the row's size: the row says how many cases survived the
    // reconstruction, this says how many service rows it refused — the mechanism behind a short row. Measured
    // per mode over the whole scorable population rather than over `rowCases`, because the refusals are
    // exactly the cases the row cannot show.
    const refusals =
      entry.source === 'recorded'
        ? undefined
        : scorable.reduce(
            (acc, kase) => {
              const reach = logFloodReach(kase.services, entry.source);
              return {
                rows: acc.rows + reach.unproved,
                widest: Math.max(acc.widest, reach.widestRefusal),
              };
            },
            { rows: 0, widest: 0 },
          );
    const unprovedRows = refusals?.rows;
    const widestRefusal = refusals?.widest;
    // The ROW's threshold, not the options': reading `opts.dominance` here rendered a
    // sweep whose every point was computed at the same threshold — a grid that printed
    // seven identical rows and read as a plateau the mode does not have. The threshold
    // has exactly one owner per row, and it is the row.
    const forRow: TermOracleOptions =
      entry.dominance === undefined ? opts : { ...opts, dominance: entry.dominance };
    const hits = rowCases.map((kase) => {
      const root = new Set(kase.groundTruth.filter((name) => name !== ''));
      return root.has(rankCase(kase, forRow, entry.source, latSlopes.get(kase)!).order[0] ?? '');
    });
    const baselineHits = rowCases.map((kase) => {
      const root = new Set(kase.groundTruth.filter((name) => name !== ''));
      return root.has(rankCase(kase, opts, 'recorded', latSlopes.get(kase)!).order[0] ?? '');
    });
    const perType = new Map<string, { correct: number; total: number }>();
    const baseByType = new Map<string, number>();
    let correct = 0;
    let gainedCases = 0;
    let regressedCases = 0;
    for (let i = 0; i < hits.length; i++) {
      const faultType = rowCases[i]!.faultType;
      const cell = perType.get(faultType) ?? { correct: 0, total: 0 };
      cell.total++;
      if (hits[i] === true) {
        cell.correct++;
        correct++;
      }
      perType.set(faultType, cell);
      if (baselineHits[i] === true) baseByType.set(faultType, (baseByType.get(faultType) ?? 0) + 1);
      if (hits[i] === true && baselineHits[i] !== true) gainedCases++;
      if (baselineHits[i] === true && hits[i] !== true) regressedCases++;
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
      cases: rowCases.length,
      unprovedRows,
      widestRefusal,
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
  return {
    rows,
    selfCheck: selfCheck(cases, rows),
    dumpMode: cases[0]?.logSignalMode ?? '',
    jointFootprint: jointFootprint(scorable, rows),
  };
}

/**
 * The dump's own log mode, as a row this reader can rebuild.
 *
 * The block declares the engine's mode name; only some of them are countable modes
 * this reader reconstructs. `novelty` is deliberately absent: it is IDF-weighted and
 * needs per-class line counts the dump does not carry, so it cannot be re-derived at
 * all — claiming a self-check for it would be claiming a measurement that does not
 * exist.
 */
const SELF_CHECK_MODE: Readonly<Record<string, Exclude<LogTermSource, 'recorded'> | undefined>> = {
  count: 'count',
  logicHttp: 'logicHttp',
  all: 'all',
  logicHttpJoint: 'logicHttpJoint',
  logicHttpDominant: 'dominant',
  // `logicHttpJoint` is mapped again, and it is legitimate NOW because the gate is rebuilt: the
  // entry was removed while this reader could not withdraw the framework-HTTP half for an emitter
  // with a more anomalous callee, at which point "checking" a joint dump would have compared the
  // mode against its own unjointed half. A mode this reader cannot rebuild still says so
  // (`selfCheck === undefined` plus a line naming the mode), which the `novelty` test pins.
};

/**
 * Measure what the joint gate's withdrawal reaches on this dump.
 *
 * The gate is `logicHttp` minus the framework-HTTP half of every emitter that has a
 * more-anomalous callee. That predicate is EXISTENTIAL over a service's callees, so its reach
 * depends on graph density in a way a row's net cannot show: on a dense cascade it approaches the
 * whole graph, and the row's loss is then not a signal decision but a near-total withdrawal. The
 * last two fields are the decisive pair — how often the service that OWNS the framework-HTTP flood
 * is itself withdrawn, i.e. how often the gate deletes the evidence it was built to keep.
 *
 * `undefined` when no row for the joint mode was drawn, so a dump without a graph cannot report a
 * footprint of zero.
 *
 * @param cases - The cases the joint row was measured on.
 * @param rows - The rows the screen built.
 * @returns The footprint, or `undefined` when the joint row is absent.
 */
function jointFootprint(
  cases: readonly DiagnosedCase[],
  rows: readonly ModeScreenRow[],
): JointFootprint | undefined {
  if (!rows.some((row) => row.source === 'logicHttpJoint')) return undefined;
  let services = 0;
  let victims = 0;
  let ownerCases = 0;
  let ownerSuppressed = 0;
  const densities: number[] = [];
  for (const kase of cases) {
    const victimSet = httpVictims(kase.services, kase.edges);
    victims += victimSet.size;
    services += kase.services.length;
    densities.push(victimSet.size / Math.max(1, kase.services.length));
    let owner: DiagnosedCase['services'][number] | undefined;
    for (const service of kase.services) {
      if (service.httpExceptionCount === 0) continue;
      if (owner === undefined || service.httpExceptionCount > owner.httpExceptionCount) {
        owner = service;
      }
    }
    if (owner === undefined) continue;
    ownerCases++;
    if (victimSet.has(owner.serviceId)) ownerSuppressed++;
  }
  const sorted = [...densities].sort((a, b) => a - b);
  return {
    services,
    victims,
    medianCaseDensity: sorted[sorted.length >> 1] ?? 0,
    ownerCases,
    ownerSuppressed,
  };
}

/**
 * Compare the re-derived row for the dump's own mode against the printed one.
 *
 * @param cases - The parsed dump, for the declared mode.
 * @param rows - The rows the screen built.
 * @returns The check, or `undefined` when the mode is not rebuildable or has no row.
 */
function selfCheck(
  cases: readonly DiagnosedCase[],
  rows: readonly ModeScreenRow[],
): ModeScreenSelfCheck | undefined {
  const dumpMode = cases[0]?.logSignalMode ?? '';
  const source = SELF_CHECK_MODE[dumpMode];
  if (source === undefined) return undefined;
  // A `dominant` dump is checked at the ENGINE's default threshold, because the row for
  // the threshold the run used is not identifiable from the dump — the block records
  // the mode, not the threshold. The check is therefore exact for the countable modes
  // and informative for `dominant`; saying which is being checked is the caller's job.
  const row = rows.find((entry) => entry.source === source && entry.dominance === undefined);
  if (row === undefined) return undefined;
  let violations = 0;
  for (const kase of cases) {
    if (!canReconstructLogFlood(kase.services, source)) continue;
    if (kase.logSignalMode !== dumpMode) continue;
    const derived = logSlopesForMode(
      kase.services,
      source,
      DEFAULT_HTTP_DOMINANCE_THRESHOLD,
      kase.edges,
    );
    for (const service of kase.services) {
      if (Math.abs((derived.get(service.serviceId) ?? 0) - service.logScore) > 6e-4) violations++;
    }
  }
  return {
    dumpMode,
    source,
    cases: row.cases,
    violations,
    gained: row.gainedCases,
    regressed: row.regressedCases,
  };
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
      `logWeight=${opts.logWeight} latWeight=${opts.latWeight} latFloor=${opts.latFloor} ` +
      `poolWeight=${opts.poolWeight}`,
  );
  // The metric term's line reports the POPULATION the threshold decides, not a deviation
  // between two quantities. It used to report `max |recomputed - printed|` with a `5e-4`
  // count, which is a number with no unit and no interpretation: it read `2.51e+0` and
  // `3500 of 11557` on the RCAEval dump for as long as the reconstruction substituted a rank
  // rescale for the engine's own value, and a reader had no way to tell "the last printed
  // digit" from "a different quantity". The threshold is a fact about the input, so the line
  // states the input's own split and then the check that can FAIL — plus the one measurement
  // that falsified the stronger form of that check, so a 0.95 maximum reads as arithmetic.
  lines.push(
    `  metric term: read from each row (${fidelity.rawCases} cases raw, below the engine’s ` +
      `rescale at ${ANOMALY_NORMALIZE_NODE_THRESHOLD} nodes; ${fidelity.rescaledCases} rescaled); ` +
      `values above 1: ${fidelity.aboveOneAtOrAboveThreshold} cases`,
  );
  lines.push(
    `  rescaled cases whose maximum is BELOW 1.000 (a TIED top anomaly, so the rescale gives ` +
      `the tie group its mean rank): ${fidelity.subUnitMaximumCases}`,
  );
  lines.push(
    `  printed order reproduced from the printed values: ` +
      `${fidelity.orderConsistent}/${fidelity.cases} cases ` +
      `(${fidelity.cases - fidelity.orderConsistent} where the three-decimal render ties two distinct anomalies)`,
  );
  lines.push(
    `  rank-1 same as the dump’s own recorded: ${fidelity.top1Matches}/${fidelity.cases} cases; ` +
      `an acceptable root: ${fidelity.top1Correct}`,
  );
  // Each shipped term that has no order of its own gets its own footprint line, because
  // the number is the only thing that distinguishes a term the model APPLIED from one it
  // merely carried. Two lines rather than one sum: the terms are separate axes and a
  // combined count would be attributable to neither.
  lines.push(
    `  moved by the pool penalty: ${fidelity.poolFlips}; ` +
      `moved by the temporal prior: ${fidelity.temporalFlips}`,
  );
  // The line above is a FIDELITY check only when these flags name the configuration the
  // dump was scored at — and the tool cannot know that, because a dump does not record
  // its weights. Left unsaid, a reader seeing a shortfall concludes the reconstruction
  // drifted: measured here, the pool penalty alone moves the winner in 103 of 1422 cases,
  // so at any other weight the same line reads 1319/1422 for a perfectly faithful
  // reconstruction. Naming which reading applies is cheaper than a caveat in a document
  // nobody reads next to the number.
  lines.push(
    '  (a rank-1 differing from the recorded one is the CONFIGURATION moving the winner whenever ' +
      'these flags are not the dump’s own; the pool footprint above is measured, not inferred)',
  );
  // TWO independent facts, and the first version of this line printed only one of
  // them: how many cases cannot be reconstructed at all, and whether the ones that
  // CAN agree with the engine. Reporting the first alone hides a defect in the rest
  // (a non-zero violation count would never be shown), and reporting the second alone
  // claims a clean reconstruction of a partial dump. Both, on one line, always.
  const reconstructable = fidelity.cases - fidelity.unreconstructableCases;
  const verdict =
    reconstructable === 0
      ? // No case to be exact about. "0 violations over 0 cases" is vacuously true and
        // must not be rendered as EXACT, which is a claim about measurements taken.
        'n/a — no case in this dump is reconstructable'
      : fidelity.recordedLogViolations === 0 && fidelity.recordedLogFlips === 0
        ? // The count is an EXACTNESS claim, not a tolerance: the derived term is built
          // from the counts the engine itself used, so a non-zero value is a defect in
          // the reconstruction. It read 5 while the flood double-counted overlapping
          // lines, and `0` here is what says the mode rows below are exact.
          'EXACT — the flood is the level-1 union, so the mode rows below carry no error bar'
        : 'NON-ZERO — a reconstruction defect, not a tolerance: do not read the mode rows below';
  lines.push(
    `  log term: services above 6e-4: ${fidelity.recordedLogViolations}; ` +
      `cases whose rank-1 moves: ${fidelity.recordedLogFlips} (${verdict})`,
  );
  if (fidelity.unreconstructableCases > 0) {
    // Not a caveat but a status: the counters above are about the OTHER cases only, so
    // printing them without this line would read as a reconstruction of the whole dump.
    lines.push(
      `  log term: ${fidelity.unreconstructableCases}/${fidelity.cases} cases predate the overlap count ` +
        `(\`both=\`), so |logic ∪ http| is bracketed but not pinned there; the counters above are over the ` +
        `other ${reconstructable}, and no mode row is drawn from an unpinned case`,
    );
  }
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
  // The self-check prints FIRST among the findings, because everything below it is
  // measured through the same reconstruction: a reader who cannot see that the reader
  // reproduces the run's own mode has no reason to read the rest.
  const check = screen.selfCheck;
  if (check !== undefined) {
    const exact = check.violations === 0;
    lines.push(
      `  self-check: the dump's own mode (\`${check.dumpMode}\`) re-derived as \`${check.source}\` ` +
        `${exact ? 'reproduces the printed term' : 'DISAGREES with the printed term'}: ` +
        `${check.violations} service(s) differ, rank-1 moves +${check.gained}/-${check.regressed} ` +
        `over ${check.cases} cases` +
        (exact ? '' : ' — a reconstruction defect: do not read the rows below'),
    );
  } else {
    // Printed rather than omitted: a missing check and a check that found nothing look exactly
    // alike in a report that only prints the second.
    lines.push(
      `  self-check: none — this reader does not rebuild the dump's mode ` +
        `(\`${screen.dumpMode}\`), so no row above is verified against the printed term`,
    );
  }
  // The joint gate's footprint prints with the table, because its ROW cannot explain itself: a
  // net loss of a quarter of the dataset reads as a signal decision, and the footprint says it is
  // the withdrawal reaching most of the graph — including the emitter that owns the flood.
  const footprint = screen.jointFootprint;
  if (footprint !== undefined) {
    lines.push(
      `  joint gate footprint: withdraws ${pct(footprint.victims, footprint.services)} of all ` +
        `services (median case ${footprint.medianCaseDensity.toFixed(2)}); the framework-HTTP flood ` +
        `OWNER is itself withdrawn in ${footprint.ownerSuppressed}/${footprint.ownerCases} cases ` +
        `(${pct(footprint.ownerSuppressed, footprint.ownerCases)})`,
    );
  }
  lines.push('  configuration           correct   +/-cases   regressed types');
  const full = baseline?.cases ?? 0;
  for (const row of screen.rows) {
    const name = label(row.source, row.dominance).padEnd(22);
    // A row measured on fewer cases than the baseline is a PARTIAL measurement, and the
    // count that says so prints next to the number it qualifies: the +/- values are
    // differences of outcomes, and a reader who cannot see the population cannot tell a
    // mode's effect from the subset it was allowed to see.
    const partial = row.cases < full ? ` [${row.cases}/${full} cases]` : '';
    // The refusals print beside the population, because a short row without them sends a reader looking
    // for a defect in the mode rather than for the primitive the artifact does not carry. `both=` absent
    // is the ONLY way to be refused (a printed overlap is returned directly), so the cause is derivable
    // from the count and is named rather than guessed.
    const refused =
      row.unprovedRows === undefined || row.unprovedRows === 0
        ? ''
        : ` [${row.unprovedRows} service row(s) unproved over ≤ ${row.widestRefusal} line(s): ` +
          'no `both=` in this dump, so the union is bracketed]';
    const regressed =
      row.regressedTypes.length === 0
        ? '0  (PASSES the second half)'
        : `${row.regressedTypes.length}  ${row.regressedTypes
            .map((t) => `${t.key} ${t.cases}`)
            .join(', ')}`;
    lines.push(
      `  ${name}${String(row.correct).padStart(5)}   ` +
        `+${row.gainedCases}/-${row.regressedCases}`.padEnd(10) +
        `  ${regressed}${partial}${refused}`,
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
