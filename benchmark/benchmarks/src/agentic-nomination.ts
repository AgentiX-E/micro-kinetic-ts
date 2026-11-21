/**
 * The nomination arm: a recorded ranking per case, verified, fused, and scored.
 *
 * ## What this file is for
 *
 * The elimination line measured a **protocol ceiling** — 79.4 % on the 1 422-case corpus, against a posterior whose
 * recall at five is 87.8 %. The 8.4-point difference is spent on expressing a promotion: an elimination has to
 * cite a channel printed on both rows and outside the removed row's band, and a case with one discriminating
 * channel but not three cannot say what it knows. This module scores the protocol that can.
 *
 * ## Three readings, and why the control is one of them
 *
 * | arm        | what it is                                                                 |
 * | ---------- | -------------------------------------------------------------------------- |
 * | `engine`   | the shipped ranking, untouched. The denominator every delta is against.     |
 * | `oracle`   | the best any nomination of this posterior can reach — the truth at rank 0.  |
 * | `nominate` | the model's ranking, verified and fused at the given weight.                 |
 *
 * The oracle arm is not a method. It is the number that separates "the protocol cannot express this" from "the
 * model did not see it": with a posterior of width 5 it is 87.8 %, and no protocol can beat it.
 *
 * ## Why refusals are counted rather than dropped
 *
 * A nomination naming a service the posterior does not carry is not an abstention, and pooling the two would let a
 * model that answers about another case score as a model that stayed silent. Every refusal is tallied by family
 * *and* the refused case keeps its engine answer, so the denominator stays the corpus under every reading.
 *
 * @module benchmarks/agentic-nomination
 */

import {
  NOMINATION_PROTOCOL,
  fuseNomination,
  gatePromotion,
  parseNominationReply,
  verifyNomination,
  type CandidateFingerprint,
  type EvidenceVariant,
  type NominationRejection,
  type PromotionDecision,
  type PromotionOptions,
  type PromotionOutcome,
  type PublishedCandidate,
  type RankStrategy,
} from '../../packages/ai/src/agent/index.js';

import type { HeadroomCase } from './agentic-headroom.js';
import type { ParsedTermCase } from './terms-dump.js';

/** One case's answer. `ranking: []` is a legitimate answer — the model agrees with the engine. */
export interface NominationRecord {
  readonly datapack: string;
  /** The model the endpoint reported serving. */
  readonly model: string;
  /** {@link NOMINATION_PROTOCOL} at the time of the call. */
  readonly protocol: number;
  /** The prompt digest the answer belongs to. */
  readonly digest: string;
  /** The services the model ranked, best first, exactly as it wrote them (before verification). */
  readonly ranking: readonly string[];
  /** Why the reply could not be read, when it could not. Mutually exclusive with a readable `ranking`. */
  readonly malformed?: string;
  readonly ms: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Render one record as a single JSON line, without its newline.
 *
 * Field order is fixed and `malformed` is omitted when absent, so two runs that produced the same answers produce
 * the same bytes — the property that lets a diff of two artifacts be a diff of two runs.
 *
 * @param record - The record.
 * @returns The JSON text of one line.
 */
export function formatNominationRecord(record: NominationRecord): string {
  return JSON.stringify({
    datapack: record.datapack,
    model: record.model,
    protocol: record.protocol,
    digest: record.digest,
    ranking: [...record.ranking],
    ...(record.malformed === undefined ? {} : { malformed: record.malformed }),
    ms: record.ms,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
  });
}

/**
 * Read a nominations file back, refusing anything the writer could not have produced.
 *
 * @param text - The file's contents.
 * @returns Records by case, or the first line that is not one.
 */
export function parseNominationRecords(
  text: string,
):
  | { readonly ok: true; readonly records: Map<string, NominationRecord> }
  | { readonly ok: false; readonly why: string } {
  const records = new Map<string, NominationRecord>();
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { ok: false, why: `line ${index + 1}: not JSON` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, why: `line ${index + 1}: not an object` };
    }
    const row = parsed as Record<string, unknown>;
    if (typeof row['datapack'] !== 'string' || row['datapack'] === '') {
      return { ok: false, why: `line ${index + 1}: datapack is not a name` };
    }
    if (typeof row['digest'] !== 'string') {
      return { ok: false, why: `line ${index + 1}: digest is not a string` };
    }
    if (typeof row['protocol'] !== 'number' || !Number.isFinite(row['protocol'])) {
      return { ok: false, why: `line ${index + 1}: protocol is not a number` };
    }
    const ranking = row['ranking'];
    if (!Array.isArray(ranking) || ranking.some((entry) => typeof entry !== 'string')) {
      return { ok: false, why: `line ${index + 1}: ranking is not an array of service names` };
    }
    const malformed = row['malformed'];
    if (malformed !== undefined && typeof malformed !== 'string') {
      return { ok: false, why: `line ${index + 1}: malformed is not a string` };
    }
    for (const key of ['ms', 'promptTokens', 'completionTokens'] as const) {
      const value = row[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, why: `line ${index + 1}: ${key} is not a number` };
      }
    }
    records.set(row['datapack'], {
      datapack: row['datapack'],
      model: typeof row['model'] === 'string' ? row['model'] : 'unknown',
      protocol: row['protocol'],
      digest: row['digest'],
      ranking: ranking as string[],
      ...(malformed === undefined ? {} : { malformed }),
      ms: row['ms'] as number,
      promptTokens: row['promptTokens'] as number,
      completionTokens: row['completionTokens'] as number,
    });
  }
  return { ok: true, records };
}

/** What one nomination arm did over one population. */
export interface NominationOutcome {
  readonly strategy: RankStrategy;
  readonly weight: number;
  readonly cases: number;
  readonly correct: number;
  readonly top1: number;
  /** Cases whose top-1 changed from the engine's. */
  readonly moved: number;
  /** Cases the model answered with a non-empty ranking. */
  readonly ranked: number;
  /** Cases the model left to the engine with an empty ranking. */
  readonly declined: number;
  /** Cases whose recorded reply could not be read. */
  readonly unreadable: number;
  /** Cases with no record at all. */
  readonly missing: number;
  /** Refusals by family. */
  readonly refused: Readonly<Record<NominationRejection, number>>;
  /** Cases where the truth is not in the posterior, so no arm could have reached it. */
  readonly truthAbsent: number;
  /** Correct answers, per fault family. */
  readonly byFamily: Readonly<Record<string, number>>;
  /** The gate's census, or `null` when the arm ran without one. */
  readonly promotion: PromotionTally | null;
}

/**
 * What the gate did, over and above what the arm scored.
 *
 * `census` is the exhaustive count, and the three outcome fields classify the overrides by what they were worth:
 * a `fix` turned a wrong engine answer into a right one, a `break` did the reverse, and a `neutral` left the case
 * wrong either way — the override was free, and counting it as a win is how a promotion arm reports precision it
 * does not have.
 */
export interface PromotionTally {
  /** The threshold the arm ran at. `null` is the control: the gate looked at nothing. */
  readonly threshold: number | null;
  /**
   * The admission rule this arm scored, or `null` for the band.
   *
   * Read by the two renderings so that neither has to infer the rule from `threshold`: an evidence arm's threshold
   * is whatever the caller passed and means nothing, and a table that printed it as the arm's name would be
   * labelling a rule with a number it does not use.
   */
  readonly admission: EvidenceVariant | null;
  /** Counts by outcome, over the cases the gate examined. Exhaustive by construction. */
  readonly census: Readonly<Record<PromotionOutcome, number>>;
  /**
   * Cases the gate measured inside its band, `relGap >= 0 && relGap < threshold`.
   *
   * `relGap >= 0` is the score-sorted condition stated as arithmetic: the spread is positive, so a non-negative
   * ratio is exactly "the published leader does not score below the second row".
   */
  readonly band: number;
  /** Of those, cases the engine got wrong — the base rate any override in the band is measured against. */
  readonly engineWrongInBand: number;
  /** Cases whose top-1 the gate changed. */
  readonly overrides: number;
  readonly fix: number;
  readonly breaks: number;
  readonly neutral: number;
  /**
   * Cases the gate could not examine because no full scored order was supplied for them.
   *
   * Not folded into `band` and not silently scored against a narrower spread: a spread read from a five-wide cut is
   * that cut's property, which is the defect `docs/agentic-promotion-gate.md` §3 records.
   */
  readonly orderMissing: number;
  /**
   * Cases where the full scored order disagrees with the population's own order.
   *
   * A non-zero reading means the two artifacts are not from the same run, and every gate figure over them describes
   * a join rather than an arm. Reported instead of thrown for the reason the refusals are counted: a reader who can
   * see the number can decide what it invalidates.
   */
  readonly orderDisagreement: number;
}

/** How to score a nomination arm. */
export interface NominationArmOptions {
  readonly strategy: RankStrategy;
  readonly weight: number;
  readonly rrfK?: number;
  /**
   * The gate. Absent means the arm is a fusion, which is what every arm before iteration 304 was.
   *
   * Present with `threshold: null` is the gate's own control: the same code path, the same verification, the same
   * counting, and no promotion. That is what makes the gate's delta a delta against the engine rather than against
   * a second implementation of it.
   */
  readonly promotion?: PromotionOptions;
  /**
   * The full scored order, by case, for the gate's spread.
   *
   * Required whenever `promotion.threshold` is a number. The published order's own `score` field is carried on the
   * candidate, but a population read from a five-wide fingerprint dump carries five candidates and therefore a
   * spread over five — so the caller states which artifact the denominator comes from instead of the module
   * inferring it from whatever it was handed.
   */
  readonly spreadOrder?: ReadonlyMap<string, readonly PublishedCandidate[]>;
  /**
   * The admission rule to score instead of the band, or `null`/absent for the band.
   *
   * The evidence rules read each case's own channels, which live on the fingerprint dump this loop already holds, so
   * they need no `spreadOrder` — and the gate they build must not be handed one, or a reader could not tell which
   * quantity an outcome came from.
   */
  readonly admission?: EvidenceVariant | null;
}

/** An empty refusal tally, as a fresh object so a caller cannot share one. */
function emptyRefusals(): Record<NominationRejection, number> {
  return { 'unknown-candidate': 0, 'duplicate-candidate': 0 };
}

/**
 * The tally while it is being accumulated.
 *
 * The published {@link PromotionTally} is read-only because a caller must not edit a reading. This is the shape the
 * loop needs, and it is kept local so the read-only one is what leaves the function.
 */
interface MutableTally {
  threshold: number | null;
  admission: EvidenceVariant | null;
  census: Record<PromotionOutcome, number>;
  band: number;
  engineWrongInBand: number;
  overrides: number;
  fix: number;
  breaks: number;
  neutral: number;
  orderMissing: number;
  orderDisagreement: number;
}

/** An empty census, as a fresh object so a caller cannot share one. */
function emptyCensus(): Record<PromotionOutcome, number> {
  return {
    off: 0,
    unranked: 0,
    agrees: 0,
    reversed: 0,
    degenerate: 0,
    'band-miss': 0,
    'evidence-none': 0,
    'evidence-tie': 0,
    'evidence-behind': 0,
    'rarity-miss': 0,
    promoted: 0,
  };
}

/** The engine's order, best first. */
export function engineOrderOf(candidates: readonly CandidateFingerprint[]): readonly string[] {
  return candidates.map((candidate) => candidate.service);
}

/** True when `order`'s first element is an accepted answer. */
function answered(order: readonly string[], accepted: readonly string[]): boolean {
  const first = order[0];
  return first !== undefined && accepted.includes(first);
}

/**
 * Score the nomination arm over a population.
 *
 * The control is this same function at `weight = 0` — or, when a gate is configured, at `threshold: null`. Not a
 * second loop: an arm's number and the control's number produced by one piece of code is what makes a delta mean
 * something.
 *
 * A case with no record is **not** dropped. It keeps its engine answer and is counted under `missing`, because a
 * run that answered 900 of 1 422 cases must not report an accuracy over 900.
 *
 * @param cases - The paired population.
 * @param records - Recorded answers, keyed by case.
 * @param options - Strategy and weight, or a promotion gate with the full scored order its spread comes from.
 * @returns Counts and rates. Fractions are over `cases`, never over the answered subset.
 * @throws TypeError when a promotion threshold is configured without `spreadOrder` — a programming error, not a
 *   reading, and the one failure here that must not be reported as a number.
 */
export function scoreNomination(
  cases: readonly HeadroomCase[],
  records: ReadonlyMap<string, NominationRecord>,
  options: NominationArmOptions,
): NominationOutcome {
  const gate = options.promotion;
  const admission = options.admission ?? null;
  if (
    gate !== undefined &&
    admission === null &&
    gate.threshold !== null &&
    options.spreadOrder === undefined
  ) {
    throw new TypeError(
      'scoreNomination: a promotion threshold needs `spreadOrder`. Without the full scored order the spread ' +
        'would be read from the width of whatever population the caller held, which is the defect ' +
        'docs/agentic-promotion-gate.md §3 records.',
    );
  }

  const refused = emptyRefusals();
  const byFamily: Record<string, number> = {};
  const tally: MutableTally | null =
    gate === undefined
      ? null
      : {
          threshold: gate.threshold,
          admission,
          census: emptyCensus(),
          band: 0,
          engineWrongInBand: 0,
          overrides: 0,
          fix: 0,
          breaks: 0,
          neutral: 0,
          orderMissing: 0,
          orderDisagreement: 0,
        };
  let correct = 0;
  let moved = 0;
  let ranked = 0;
  let declined = 0;
  let unreadable = 0;
  let missing = 0;
  let truthAbsent = 0;

  for (const oneCase of cases) {
    const engine = engineOrderOf(oneCase.candidates);
    const acceptedSet = new Set(oneCase.accepted);
    if (!engine.some((service) => acceptedSet.has(service))) truthAbsent += 1;
    const engineCorrect = answered(engine, oneCase.accepted);

    const record = records.get(oneCase.datapack);
    let order = engine;
    let decision: PromotionDecision | null = null;
    if (record === undefined) {
      missing += 1;
    } else if (record.malformed !== undefined) {
      unreadable += 1;
    } else {
      const verified = verifyNomination(record.ranking, oneCase.candidates);
      if (!verified.ok) {
        refused[verified.reason] += 1;
      } else if (verified.order.length === 0) {
        declined += 1;
      } else {
        ranked += 1;
        // A switched-off gate reads no score, so it needs no full order: it is handed the population's own order and
        // returns it unchanged, which is what makes the control's number the engine's number. Only a gate that
        // measures needs the artifact whose width its denominator is a property of.
        //
        // An evidence arm is the third case: it reads the case's own channels, so its order is the population's and
        // its options are the ONE object built below. Building it here rather than at each call site is what keeps
        // the rule and the population it is read against from acquiring two owners.
        const full =
          gate === undefined
            ? undefined
            : gate.threshold === null || admission !== null
              ? oneCase.candidates.map((row) => ({ service: row.service, score: row.score }))
              : options.spreadOrder?.get(oneCase.datapack);
        if (gate !== undefined && full !== undefined && tally !== null) {
          // The two artifacts must agree about the ANSWER, which is the first candidate and nothing else: `answered`
          // reads `order[0]`, and the gate reads `full[0]` and `full[1]` out of the one artifact it was handed.
          //
          // They need not agree about the tail. A structural pass permutes adjacent pairs of the list it is given,
          // so the pass over a 50-wide order and the pass over the same run's 5-wide top-5 are not one function of
          // one list: on this corpus 17 cases differ, 15 of them first at position 5 and 2 at position 4, and none
          // at position 1 or 2. Requiring the whole prefix would discard cases the gate can read perfectly well,
          // and would make the band's size a property of a comparison nobody needed.
          const agrees = full[0]?.service === engine[0];
          if (!agrees) {
            tally.orderDisagreement += 1;
          } else {
            // One construction, one owner: the band's options are the caller's, and an evidence arm's are the
            // caller's threshold plus this case's own channels. A `gate.evidence` supplied by a caller is not a
            // third path — the type allows it and no caller takes it, and a branch nothing can reach is a branch
            // nothing can test.
            const gateOptions =
              admission === null
                ? gate
                : {
                    threshold: gate.threshold,
                    evidence: { variant: admission, candidates: oneCase.candidates },
                  };
            decision = gatePromotion(full, verified.order, gateOptions);
            order = decision.order;
            tally.census[decision.outcome] += 1;
            if (
              decision.relGap !== null &&
              decision.relGap >= 0 &&
              gate.threshold !== null &&
              decision.relGap < gate.threshold
            ) {
              tally.band += 1;
              if (!engineCorrect) tally.engineWrongInBand += 1;
            }
            if (decision.promote) {
              tally.overrides += 1;
              const afterCorrect = answered(order, oneCase.accepted);
              if (!engineCorrect && afterCorrect) tally.fix += 1;
              else if (engineCorrect && !afterCorrect) tally.breaks += 1;
              else tally.neutral += 1;
            }
          }
        } else if (gate !== undefined) {
          // No full order for this case: it keeps the engine's answer, and the tally says so rather than scoring it
          // against a spread taken from whatever width the population happened to carry.
          if (tally !== null) tally.orderMissing += 1;
        } else {
          order = fuseNomination(engine, verified.order, {
            strategy: options.strategy,
            weight: options.weight,
            rrfK: options.rrfK ?? 60,
          });
        }
      }
    }

    if (answered(order, oneCase.accepted)) {
      correct += 1;
      byFamily[oneCase.faultType] = (byFamily[oneCase.faultType] ?? 0) + 1;
    }
    if (order[0] !== engine[0]) moved += 1;
  }

  return {
    strategy: options.strategy,
    weight: options.weight,
    cases: cases.length,
    correct,
    top1: cases.length === 0 ? 0 : correct / cases.length,
    moved,
    ranked,
    declined,
    unreadable,
    missing,
    refused,
    truthAbsent,
    byFamily,
    promotion: tally,
  };
}

/**
 * The oracle arm: the truth at rank 0 wherever the posterior holds it.
 *
 * Not a method — a bound. With a width-5 posterior on this corpus it reads 87.8 %, and any protocol that scores
 * above the `nominate` arm but below this one is limited by what it can *say*, not by what the model saw.
 *
 * @param cases - The paired population.
 * @returns The number of cases whose top-1 is an accepted answer under a perfect reader.
 */
export function oracleTop1(cases: readonly HeadroomCase[]): number {
  let correct = 0;
  for (const oneCase of cases) {
    if (oneCase.candidates.some((candidate) => oneCase.accepted.includes(candidate.service))) {
      correct += 1;
    }
  }
  return correct;
}

/** Format a percentage the way every table in this repository prints one. */
function pct(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

/**
 * Render the arm table.
 *
 * @param outcomes - One row per configuration, in publication order.
 * @param oracle - The ceiling, printed as its own row so no reader has to hold it in their head.
 * @param cases - The population size, for the oracle row's denominator.
 * @returns The table, as text.
 */
export function formatNominationTable(
  outcomes: readonly NominationOutcome[],
  oracle: number,
  cases: number,
): string {
  const lines = [
    'arm        strategy  weight  cases   top1    moved  ranked  declined  unreadable  missing  refused',
  ];
  lines.push(
    `oracle     -             -  ${String(cases).padStart(5)}  ${pct(cases === 0 ? 0 : oracle / cases)}` +
      '        -       -         -           -        -        -',
  );
  for (const outcome of outcomes) {
    const refused = outcome.refused['unknown-candidate'] + outcome.refused['duplicate-candidate'];
    lines.push(
      `nominate   ${outcome.strategy.padEnd(8)}  ${outcome.weight.toFixed(2).padStart(5)}  ` +
        `${String(outcome.cases).padStart(5)}  ${pct(outcome.top1).padStart(6)}  ` +
        `${String(outcome.moved).padStart(6)}  ${String(outcome.ranked).padStart(6)}  ` +
        `${String(outcome.declined).padStart(9)}  ${String(outcome.unreadable).padStart(10)}  ` +
        `${String(outcome.missing).padStart(7)}  ${String(refused).padStart(7)}`,
    );
  }
  return lines.join('\n');
}

/**
 * The refusal census, one line per family, with the fate of a refused case stated.
 *
 * @param outcomes - The scored arms; the first one's tally is reported, since verification does not depend on the
 *   fusion weight.
 * @returns The census, as text.
 */
export function formatNominationRefusals(outcomes: readonly NominationOutcome[]): string {
  const first = outcomes[0];
  if (first === undefined) return 'refusals: no arm was scored';
  const total = first.refused['unknown-candidate'] + first.refused['duplicate-candidate'];
  const lines = [
    `refusals: ${total} (each kept its engine answer, so the denominator stays the corpus)`,
  ];
  for (const [reason, count] of Object.entries(first.refused)) {
    lines.push(
      `  ${reason.padEnd(20)} ${String(count).padStart(6)}  ${pct(total === 0 ? 0 : count / total)} of refusals`,
    );
  }
  return lines.join('\n');
}

/** Re-exported so a CLI can parse a raw reply without importing the package's internals twice. */
export { NOMINATION_PROTOCOL, parseNominationReply };

/**
 * The full scored order of every case, read from a `--terms-dump` artifact, for the gate's spread.
 *
 * The dump's array order **is** the engine's answer and its `score` field is what the sort used, so this is a
 * transcription rather than a re-ranking: re-sorting by score would reproduce the pre-pass engine, which on this
 * corpus is 1 073 rather than 1 141 (see `terms-dump.ts`'s module docblock).
 *
 * @param cases - Cases parsed from a terms dump.
 * @returns The published order, with scores, by case id.
 * @throws Error when a candidate carries no score, because a margin rule cannot be computed over a candidate whose
 *   rank the producer never recorded a number for — and skipping it would silently stretch the spread.
 */
export function spreadOrdersOf(
  cases: readonly ParsedTermCase[],
): Map<string, readonly PublishedCandidate[]> {
  const orders = new Map<string, readonly PublishedCandidate[]>();
  for (const oneCase of cases) {
    const order: PublishedCandidate[] = [];
    for (const candidate of oneCase.candidates) {
      if (candidate.score === null) {
        throw new Error(
          `${oneCase.datapack}: candidate ${candidate.id} has no score, so no spread can be taken over this order`,
        );
      }
      order.push({ service: candidate.id, score: candidate.score });
    }
    orders.set(oneCase.datapack, order);
  }
  return orders;
}

/**
 * Render the gate table: one row per arm, with the band and what the overrides in it were worth.
 *
 * A row's `top1` is `correct / cases` — the same denominator as every other table in this file, so the control and
 * the treatment are differences of two numbers over one population rather than of two rates over two.
 *
 * @param outcomes - The scored arms, in publication order. Arms without a gate are skipped.
 * @returns The table, as text. A single line when no arm carried a gate.
 */
export function formatPromotionTable(outcomes: readonly NominationOutcome[]): string {
  const gated = outcomes.filter((outcome) => outcome.promotion !== null);
  if (gated.length === 0) return 'gate: no arm carried one';
  const lines = [
    'gate    cases    band  engineWrong  overrides   fix  break  neutral    top1  missing  disagree',
  ];
  for (const outcome of gated) {
    const tally = outcome.promotion;
    if (tally === null) continue;
    const name =
      tally.admission !== null
        ? tally.admission === 'count'
          ? 'count'
          : 'rarity'
        : tally.threshold === null
          ? 'off'
          : tally.threshold.toFixed(3);
    lines.push(
      `${name.padEnd(6)}  ${String(outcome.cases).padStart(5)}  ${String(tally.band).padStart(6)}  ` +
        `${String(tally.engineWrongInBand).padStart(11)}  ${String(tally.overrides).padStart(9)}  ` +
        `${String(tally.fix).padStart(4)}  ${String(tally.breaks).padStart(5)}  ` +
        `${String(tally.neutral).padStart(7)}  ${pct(outcome.top1).padStart(6)}  ` +
        `${String(tally.orderMissing).padStart(7)}  ${String(tally.orderDisagreement).padStart(8)}`,
    );
  }
  return lines.join('\n');
}

/**
 * State what an override in the band was worth, so the number cannot be read as a precision it does not have.
 *
 * @param outcome - One gated arm.
 * @returns The reading, as text.
 */
export function formatPromotionReadout(outcome: NominationOutcome): string {
  const tally = outcome.promotion;
  if (tally === null) return 'gate: this arm did not carry one';
  const decisive = tally.fix + tally.breaks;
  const lines = [
    tally.admission === null
      ? `band ${tally.band} of ${outcome.cases} cases, engine wrong inside it ${tally.engineWrongInBand}`
      : `rule evidence (${tally.admission}): no band — this rule reads channels, not a score gap`,
    `overrides ${tally.overrides}: ${tally.fix} fix, ${tally.breaks} break, ${tally.neutral} neutral`,
    decisive === 0
      ? 'conditional precision: no override changed an outcome, so there is no precision to state'
      : `conditional precision: ${tally.fix}/${decisive} = ${(100 * (tally.fix / decisive)).toFixed(1)}%`,
    `net ${tally.fix - tally.breaks > 0 ? '+' : ''}${tally.fix - tally.breaks}`,
  ];
  return lines.join('\n');
}
