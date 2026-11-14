/**
 * The elimination layer's ceiling, measured offline against a fingerprint dump and a verdict file.
 *
 * ## The question this module exists to answer before anything is paid for
 *
 * An elimination arm can only move a case whose answer the agentic layer is able to see and able to remove: the
 * truth must be inside the posterior, and every candidate ranked above it must carry evidence a **verifiable
 * claim** can cite — a channel outside its own fault-free band, present on both the candidate being removed and
 * the one being kept. When those conditions do not hold, no model, however good, can help, and the layer's
 * contribution is bounded at zero for that case.
 *
 * That bound is arithmetic over the dump, so it is computed here for nothing. It is the number a spending
 * decision has to be made against: an arm whose ceiling is 0.5 pp cannot justify a corpus-wide model bill, and
 * an arm whose ceiling is 15 pp has room to be wrong 90 % of the time and still win. Reporting the arm's
 * accuracy without the ceiling would leave a reader unable to tell a method that failed from a population that
 * had nothing to give.
 *
 * ## Two arms, and why the second one is not a toy
 *
 * - `oracle` removes every candidate above the truth until the truth leads. It is not a method — it is the
 *   ceiling, and it is the only arm here that is allowed to read the label.
 * - `evidence` is the deterministic hypothesis the expected-outlier baseline was built for, stated as a claim
 *   rather than as a weight: *the leader's evidence is ordinary — its channels leave their fault-free bands in
 *   most clean windows — while a lower-ranked candidate's evidence is rare*. It reads no label, so it is a
 *   candidate method; `docs/agentic-layer-plan.md` §2 records why the same quantity as a slope moved nothing in
 *   iteration 265, and why removing a candidate is a different presentation of it rather than the same one
 *   weighted differently.
 *
 * ## Split, and why a sweep is reported twice
 *
 * A threshold swept over the corpus and reported on the same corpus is an in-sample maximum. Every sweep here is
 * therefore also reported on the half of the corpus whose id hash puts it out of sample, and the two columns are
 * printed together — a threshold that wins in sample and loses out of sample is a threshold that won on noise,
 * and the second column is the only thing that can say so.
 *
 * Zero IO: the caller reads the two files. No truth is passed to the runner — this module is where truth and
 * fingerprint meet, and it runs after the fact, on files.
 *
 * @module benchmarks/agentic-headroom
 */

import {
  CLAIM_REJECTIONS,
  DEFAULT_CONSULTATION_OPTIONS,
  GATE_TRIPS,
  SKIP_REASONS,
  applyClaims,
  decideConsultation,
  verifyClaim,
  type CandidateFingerprint,
  type ClaimRejection,
  type EliminationClaim,
  type SkipReason,
} from '../../packages/ai/src/agent/index.js';

import type { FingerprintRecord } from './agentic-fingerprint-file.js';
import { hashId } from './agentic-sampling.js';
import type { PerCaseVerdict } from './fse26-per-case.js';
import { certifyLosses, type LossCount } from './risk-control.js';

/** One case, joined: the fingerprint a layer would have seen and the labels the run scored against. */
export interface HeadroomCase {
  readonly datapack: string;
  readonly faultType: string;
  /** The accepted answers, as the corpus states them. */
  readonly accepted: readonly string[];
  /** The posterior, exactly as the dump recorded it. */
  readonly candidates: readonly CandidateFingerprint[];
}

/** What the join could not pair, and why. Both are refusals, not warnings. */
export interface HeadroomJoin {
  readonly cases: readonly HeadroomCase[];
  /** Fingerprints with no verdict line. */
  readonly unpairedFingerprints: readonly string[];
  /** Verdicts with no fingerprint line. */
  readonly unpairedVerdicts: readonly string[];
  /** Cases whose dumped order disagrees with the order the run published. */
  readonly disagreements: readonly string[];
}

/**
 * Join the two artifacts on `datapack`, and refuse to silently reconcile them.
 *
 * The fingerprint is a copy of the ranking the run produced, so the two files' orders must agree case for case.
 * When they do not, the two artifacts are from different runs — a dump left over from an earlier commit, or a
 * verdict file from a second dispatch — and scoring one against the other would report an accuracy for a
 * configuration neither of them ran.
 *
 * @param fingerprints - The dump, in file order.
 * @param verdicts - The per-case verdict file, in file order.
 * @returns The paired cases and every refusal.
 */
export function joinHeadroom(
  fingerprints: readonly FingerprintRecord[],
  verdicts: readonly PerCaseVerdict[],
): HeadroomJoin {
  const byId = new Map<string, PerCaseVerdict>();
  for (const verdict of verdicts) byId.set(verdict.datapack, verdict);

  const cases: HeadroomCase[] = [];
  const unpairedFingerprints: string[] = [];
  const disagreements: string[] = [];
  for (const record of fingerprints) {
    const verdict = byId.get(record.datapack);
    if (verdict === undefined) {
      unpairedFingerprints.push(record.datapack);
      continue;
    }
    byId.delete(record.datapack);
    const dumped = record.candidates.map((candidate) => candidate.service);
    const published = verdict.ranked;
    const width = Math.min(dumped.length, published.length);
    let agrees = true;
    for (let index = 0; index < width; index++) {
      if (dumped[index] !== published[index]) {
        agrees = false;
        break;
      }
    }
    if (!agrees) {
      disagreements.push(record.datapack);
      continue;
    }
    cases.push({
      datapack: record.datapack,
      faultType: record.faultType,
      accepted: verdict.accepted,
      candidates: record.candidates,
    });
  }
  return {
    cases,
    unpairedFingerprints,
    unpairedVerdicts: [...byId.keys()],
    disagreements,
  };
}

/** A case's first ranked candidate that the corpus accepts, or `-1` when the posterior does not hold one. */
function truthRankOf(
  candidate: readonly CandidateFingerprint[],
  accepted: readonly string[],
): number {
  const set = new Set(accepted);
  for (let index = 0; index < candidate.length; index++) {
    if (set.has(candidate[index]!.service)) return index;
  }
  return -1;
}

/** True when `service` appears among the accepted answers. */
function accepts(accepted: readonly string[], service: string | undefined): boolean {
  return service !== undefined && accepted.includes(service);
}

/** How far a channel's post value sits outside its band, zero when inside. */
function departureOf(channel: {
  readonly post: number;
  readonly band: readonly [number, number];
}): number {
  if (channel.post < channel.band[0]) return channel.band[0] - channel.post;
  if (channel.post > channel.band[1]) return channel.post - channel.band[1];
  return 0;
}

/**
 * The channel of `candidate` that is furthest outside its band AND labelled on `other`.
 *
 * The second half of that condition is the verifier's, not a convenience: a claim whose channel does not exist
 * on the kept candidate is refused as `unknown-channel`, so an arm that proposed one would be measuring its own
 * refusal rate rather than the ceiling.
 */
function loudestShared(
  candidate: CandidateFingerprint,
  other: CandidateFingerprint,
): CandidateFingerprint['channels'][number] | undefined {
  const labels = new Set(other.channels.map((channel) => channel.label));
  let best: CandidateFingerprint['channels'][number] | undefined;
  let bestDeparture = 0;
  for (const channel of candidate.channels) {
    if (!labels.has(channel.label)) continue;
    const departure = departureOf(channel);
    if (departure > bestDeparture) {
      best = channel;
      bestDeparture = departure;
    }
  }
  return best;
}

/** One claim that removes `candidate`, citing `channel`. */
function claimOf(
  candidate: CandidateFingerprint,
  channel: CandidateFingerprint['channels'][number],
  keep: string,
  withRate: boolean,
): EliminationClaim {
  return {
    remove: candidate.service,
    keep,
    because: {
      channel: channel.label,
      statistic: 'post',
      observed: channel.post,
      band: [channel.band[0], channel.band[1]],
      ...(withRate ? { rate: channel.rate } : {}),
    },
  };
}

/**
 * The oracle's claims: remove every candidate above the truth, first to last.
 *
 * @param candidates - The posterior.
 * @param accepted - The corpus's labels. This is the ONLY arm allowed to read them.
 * @returns One claim per candidate above the truth, or `[]` when the truth is absent or unreachable.
 */
export function oracleClaims(
  candidates: readonly CandidateFingerprint[],
  accepted: readonly string[],
): EliminationClaim[] {
  const truthRank = truthRankOf(candidates, accepted);
  if (truthRank <= 0) return [];
  const truth = candidates[truthRank]!;
  const claims: EliminationClaim[] = [];
  for (let index = 0; index < truthRank; index++) {
    const candidate = candidates[index]!;
    const channel = loudestShared(candidate, truth);
    if (channel === undefined) return [];
    claims.push(claimOf(candidate, channel, truth.service, false));
  }
  return claims;
}

/** The evidence arm's two thresholds. */
export interface EvidenceThresholds {
  /**
   * The rate at or above which the leader's evidence counts as ORDINARY.
   *
   * A leader whose decisive channel leaves its fault-free band in a third of clean windows has, on this corpus,
   * not produced evidence; one at 5 % has. Zero disables the test — every leader with any out-of-band channel
   * then qualifies, which is the arm's most permissive reading and is measured as its own row.
   */
  readonly rateFloor: number;
  /** How much rarer a rival's evidence must be, as an absolute difference in rate. Zero admits a strict tie. */
  readonly margin: number;
}

/**
 * The evidence arm: demote a leader whose evidence is ordinary, in favour of a candidate whose evidence is rare.
 *
 * The comparison is over each candidate's **weakest out-of-band channel** — the least ordinary thing it can
 * point at — because that is the strongest argument the candidate can make for itself. A leader whose strongest
 * argument is still ordinary has no case, and a rival whose strongest argument is rarer has a better one.
 *
 * @param candidates - The posterior.
 * @param thresholds - See {@link EvidenceThresholds}.
 * @returns At most one claim: this arm demotes the leader once and stops.
 */
export function evidenceClaims(
  candidates: readonly CandidateFingerprint[],
  thresholds: EvidenceThresholds,
): EliminationClaim[] {
  const leader = candidates[0];
  if (leader === undefined) return [];
  const rivals = candidates.slice(1);
  if (rivals.length === 0) return [];

  // The least ordinary thing the leader can point at, restricted to channels a rival also carries: a channel only
  // the leader has cannot support a claim (`unknown-channel`), so citing it would measure the verifier.
  let citation: CandidateFingerprint['channels'][number] | undefined;
  for (const channel of leader.channels) {
    if (departureOf(channel) <= 0) continue;
    if (!rivals.some((rival) => rival.channels.some((other) => other.label === channel.label)))
      continue;
    if (citation === undefined || channel.rate < citation.rate) citation = channel;
  }
  if (citation === undefined) return [];
  if (citation.rate < thresholds.rateFloor) return [];

  for (const rival of rivals) {
    const shared = rival.channels.find((channel) => channel.label === citation!.label);
    // A rival that never left the band on the cited channel has no case either: the comparison is between two
    // pieces of evidence, and one of them is absent.
    if (shared === undefined || departureOf(shared) <= 0) continue;
    if (shared.rate < citation.rate - thresholds.margin) {
      return [claimOf(leader, citation, rival.service, true)];
    }
  }
  return [];
}

/** What one arm did, over one population. */
export interface ArmOutcome {
  readonly arm: string;
  readonly weight: number;
  readonly cases: number;
  readonly correct: number;
  readonly top1: number;
  /** Cases whose top-1 changed. */
  readonly moved: number;
  /** Claims the arm proposed. */
  readonly claims: number;
  /** Claims the verifier accepted, by reason. */
  readonly refused: Readonly<Record<ClaimRejection, number>>;
  /** Cases where the arm proposed nothing. */
  readonly abstained: number;
  /** Cases the deterministic skip rule would have resolved without a model, by reason. */
  readonly skipped: Readonly<Record<SkipReason, number>>;
  /** Cases where the truth was outside the posterior, so no layer could have moved them. */
  readonly truthAbsent: number;
  /** Oracle only: cases where every candidate above the truth could be removed by a verifiable claim. */
  readonly reachable: number;
  /** Cases that crossed a budget gate before the arm could act. Never non-zero for a one-round arm. */
  readonly gateTrips: Readonly<Record<string, number>>;
  /**
   * Cases answered correctly, per fault family.
   *
   * The per-family view of {@link correct}, produced by the same increment, so a certified budget computed from it
   * cannot disagree with the `top1` printed beside it. Kept on the outcome rather than recomputed by a caller:
   * two implementations of "was this case answered" is how a table and a ledger end up describing two runs.
   */
  readonly byFamily: Readonly<Record<string, number>>;
}

/** How an arm is asked to behave on one case. */
export interface ArmSpec {
  /**
   * `engine` proposes nothing (the control); `oracle` reads the label; `evidence` reads the rates; `recorded`
   * replays claims somebody else proposed, which is how a model's answers are scored without calling it again.
   */
  readonly arm: 'engine' | 'oracle' | 'evidence' | 'recorded';
  /** How far a verified claim may move the posterior, in `[0, 1]`. */
  readonly weight: number;
  /** Whether the deterministic skip rule is applied before the arm is consulted. */
  readonly useSkipRule: boolean;
  readonly thresholds?: EvidenceThresholds;
  /** The claims a `recorded` arm replays, keyed by `datapack`. Ignored by every other arm. */
  readonly recorded?: ReadonlyMap<string, readonly EliminationClaim[]>;
}

/** An empty rejection tally, as a fresh object so a caller cannot share one. */
function emptyRejections(): Record<ClaimRejection, number> {
  return Object.fromEntries(CLAIM_REJECTIONS.map((reason) => [reason, 0])) as Record<
    ClaimRejection,
    number
  >;
}

/** An empty skip tally. */
function emptySkips(): Record<SkipReason, number> {
  return Object.fromEntries(SKIP_REASONS.map((reason) => [reason, 0])) as Record<
    SkipReason,
    number
  >;
}

/**
 * Score one arm over a population.
 *
 * The control (`arm: 'engine'`) is not a special case of the others — it runs the same loop with a proposer that
 * returns nothing, so an arm's number and the control's number are produced by one piece of code. That is the
 * property that makes a delta mean something: two implementations of "score this ordering" would let a difference
 * in the scoring be reported as a difference in the method.
 *
 * @param cases - The paired population.
 * @param spec - Which arm, at which weight, under which skip rule.
 * @returns Counts and rates. Fractions are over `cases`, never over the subset that was consulted.
 */
export function scoreArm(cases: readonly HeadroomCase[], spec: ArmSpec): ArmOutcome {
  const refused = emptyRejections();
  const skipped = emptySkips();
  const gateTrips: Record<string, number> = Object.fromEntries(GATE_TRIPS.map((gate) => [gate, 0]));

  const byFamily: Record<string, number> = {};
  let correct = 0;
  let moved = 0;
  let claims = 0;
  let abstained = 0;
  let truthAbsent = 0;
  let reachable = 0;

  for (const oneCase of cases) {
    const candidates = oneCase.candidates;
    const decision = decideConsultation(candidates, DEFAULT_CONSULTATION_OPTIONS);
    skipped[decision.reason] += 1;

    const engineTop = candidates[0]?.service;
    if (accepts(oneCase.accepted, engineTop)) {
      correct += 1;
      byFamily[oneCase.faultType] = (byFamily[oneCase.faultType] ?? 0) + 1;
    }

    if (spec.arm === 'engine') continue;
    if (truthRankOf(candidates, oneCase.accepted) < 0) truthAbsent += 1;

    let proposed: EliminationClaim[] = [];
    if (spec.useSkipRule && !decision.consult) {
      // The skip rule resolves the case on margin or evidence. The agent's claims are still computed for the
      // ORACLE arm — the ceiling is a property of the population, not of a cost rule — but a method arm is not
      // consulted, which is the whole point of the rule.
      if (spec.arm !== 'oracle') {
        abstained += 1;
        continue;
      }
    }
    if (spec.arm === 'oracle') {
      proposed = oracleClaims(candidates, oneCase.accepted);
      if (proposed.length > 0) reachable += 1;
    } else if (spec.arm === 'recorded') {
      proposed = [...(spec.recorded?.get(oneCase.datapack) ?? [])];
    } else {
      proposed = evidenceClaims(candidates, spec.thresholds ?? { rateFloor: 0, margin: 0 });
    }

    if (proposed.length === 0) {
      abstained += 1;
      continue;
    }
    claims += proposed.length;
    const verdicts = proposed.map((claim) => verifyClaim(claim, candidates));
    for (const verdict of verdicts) if (!verdict.ok) refused[verdict.reason] += 1;
    if (verdicts.every((verdict) => !verdict.ok)) {
      abstained += 1;
      continue;
    }

    const order = applyClaims(candidates, verdicts, spec.weight);
    if (order[0]?.service !== engineTop) {
      moved += 1;
      // The engine's answer was already counted above; a move replaces it rather than adding to it.
      if (accepts(oneCase.accepted, engineTop)) {
        correct -= 1;
        byFamily[oneCase.faultType] = (byFamily[oneCase.faultType] ?? 0) - 1;
      }
      if (accepts(oneCase.accepted, order[0]?.service)) {
        correct += 1;
        byFamily[oneCase.faultType] = (byFamily[oneCase.faultType] ?? 0) + 1;
      }
    }
  }

  return {
    arm: spec.arm,
    weight: spec.weight,
    cases: cases.length,
    correct,
    top1: cases.length === 0 ? 0 : correct / cases.length,
    moved,
    claims,
    refused,
    abstained,
    skipped,
    truthAbsent,
    reachable,
    gateTrips,
    byFamily,
  };
}

/** Which half of the corpus a case belongs to, by id hash. Stable across machines and independent of order. */
export function splitOf(datapack: string): 'in' | 'out' {
  return hashId(datapack) % 2 === 0 ? 'in' : 'out';
}

/**
 * Take one half of the population.
 *
 * @param cases - The paired population.
 * @param half - `all` for the whole corpus, or one of the two hash halves.
 * @returns The selected cases, in their original order.
 */
export function takeSplit(
  cases: readonly HeadroomCase[],
  half: 'all' | 'in' | 'out',
): HeadroomCase[] {
  if (half === 'all') return [...cases];
  return cases.filter((oneCase) => splitOf(oneCase.datapack) === half);
}

/** One point of the skip rule's own grid: what it would resolve without a model, and what that costs. */
export interface GatePoint {
  readonly marginThreshold: number;
  readonly decisiveChannels: number;
  /** Cases the rule would resolve without consulting an agent. */
  readonly skipped: number;
  /** …of which the engine's answer was already right. Those are the cases the rule is FOR. */
  readonly skippedRight: number;
  /** …of which the engine was wrong and a perfect eliminator could have fixed it. Those are the cost. */
  readonly skippedFixable: number;
  /** Cases the rule would consult. */
  readonly consulted: number;
}

/**
 * Census the skip rule over a grid, counting the cases it would skip by what skipping them costs.
 *
 * The rule's whole purpose is to resolve a case the engine has already got right, cheaply. A rule that also
 * skips a case the engine got WRONG and an agent could have fixed is not saving money — it is lowering the
 * ceiling, and the number that says so is `skippedFixable`. Iteration 267 measured the shipped thresholds
 * (`margin 0.05`, `decisive 3`) on RCABench and they skipped 710 of 711 cases while the oracle ceiling was
 * 16.6 pp, i.e. the rule was discarding most of what the layer exists to win.
 *
 * @param cases - The paired population.
 * @param grid - Margin thresholds and decisive-channel counts to measure.
 * @returns One point per pair, in grid order.
 */
export function gateCensus(
  cases: readonly HeadroomCase[],
  grid: {
    readonly margins: readonly number[];
    readonly decisiveChannels: readonly number[];
  },
): GatePoint[] {
  const fixed = cases.map((oneCase) => ({
    engineRight: accepts(oneCase.accepted, oneCase.candidates[0]?.service),
    fixable:
      !accepts(oneCase.accepted, oneCase.candidates[0]?.service) &&
      oracleClaims(oneCase.candidates, oneCase.accepted).length > 0,
    candidates: oneCase.candidates,
  }));

  const points: GatePoint[] = [];
  for (const marginThreshold of grid.margins) {
    for (const decisiveChannels of grid.decisiveChannels) {
      let skipped = 0;
      let skippedRight = 0;
      let skippedFixable = 0;
      for (const one of fixed) {
        const decision = decideConsultation(one.candidates, { marginThreshold, decisiveChannels });
        if (decision.consult) continue;
        skipped += 1;
        if (one.engineRight) skippedRight += 1;
        if (one.fixable) skippedFixable += 1;
      }
      points.push({
        marginThreshold,
        decisiveChannels,
        skipped,
        skippedRight,
        skippedFixable,
        consulted: fixed.length - skipped,
      });
    }
  }
  return points;
}

/** One point of the evidence arm's threshold sweep. */
export interface SweepPoint {
  readonly rateFloor: number;
  readonly margin: number;
  readonly outcome: ArmOutcome;
}

/** What a sweep varies. */
export interface SweepSpec {
  /** Rates at which the leader's evidence stops counting as ordinary. Zero is the most permissive arm. */
  readonly floors: readonly number[];
  /** How much rarer a rival's evidence must be. */
  readonly margins: readonly number[];
  readonly weight: number;
  readonly useSkipRule: boolean;
}

/**
 * Score the evidence arm at every threshold pair.
 *
 * The sweep exists because the two thresholds are not free parameters to be tuned but a *hypothesis* to be
 * located: if the arm's contribution is flat in both, the boundary the expected-outlier rate draws is not where
 * the ranking is wrong, and no value of it would have helped. The caller reports the best point IN SAMPLE and
 * that same point OUT OF SAMPLE, because a maximum over a grid is an upward-biased estimate of the thing the
 * grid was maximised over.
 *
 * @param cases - The population.
 * @param spec - The grid and the weight.
 * @returns One point per threshold pair, in grid order.
 */
export function sweepEvidence(cases: readonly HeadroomCase[], spec: SweepSpec): SweepPoint[] {
  const points: SweepPoint[] = [];
  for (const rateFloor of spec.floors) {
    for (const margin of spec.margins) {
      points.push({
        rateFloor,
        margin,
        outcome: scoreArm(cases, {
          arm: 'evidence',
          weight: spec.weight,
          useSkipRule: spec.useSkipRule,
          thresholds: { rateFloor, margin },
        }),
      });
    }
  }
  return points;
}

/**
 * The point with the highest Top@1, earliest in grid order on a tie.
 *
 * @param points - The sweep, in grid order.
 * @returns The best point, or `undefined` for an empty sweep.
 */
export function bestSweepPoint(points: readonly SweepPoint[]): SweepPoint | undefined {
  let best: SweepPoint | undefined;
  for (const point of points) {
    if (best === undefined || point.outcome.top1 > best.outcome.top1) best = point;
  }
  return best;
}

/**
 * The smallest budget the corpus permits for an arm's per-family regression against the control.
 *
 * `lost` is `control − arm` per family: a family the arm answers fewer cases for is a family the claim has to cover.
 * The level is split across every family in the population, not only the ones that lost — a claim covers the corpus
 * it is about, and narrowing it to the families that happened to move would buy a smaller number by saying less.
 *
 * @param cases - The population.
 * @param control - Correct answers per family for the engine's own ranking.
 * @param arm - Correct answers per family for the arm.
 * @param delta - The family-wise level.
 * @returns The certified budget and the family that binds it, or `null` when no budget certifies.
 */
export function certifiedBudgetOf(
  cases: readonly HeadroomCase[],
  control: Readonly<Record<string, number>>,
  arm: Readonly<Record<string, number>>,
  delta: number,
): { budget: number | null; worst: string } {
  const families = [...new Set(cases.map((oneCase) => oneCase.faultType))].sort();
  const ledger: LossCount[] = families.map((faultType) => ({
    faultType,
    lost: (control[faultType] ?? 0) - (arm[faultType] ?? 0),
  }));
  const claim = certifyLosses(ledger, { n: cases.length, families }, delta, 'holm');
  if (claim === null) return { budget: null, worst: 'unprovable' };
  return { budget: claim.budget, worst: `${claim.worst.faultType} −${claim.worst.lost}` };
}
