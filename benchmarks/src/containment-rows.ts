/**
 * The containment sweep's rows: one JSON line per case, carrying every adjacent pair the sweep examined.
 *
 * ## What this file is for
 *
 * H2 in the iteration-294 pre-registration asks whether the **factorisation residual** of a pair's out-of-band
 * indicators separates a propagating pair from a coincidental one:
 *
 *     ρ(a,b) = P(δa out of band ∧ δb out of band) − P(δa out of band) · P(δb out of band)
 *
 * ρ is a property of an EDGE over many observations, and no artifact this repository writes carries the
 * population it needs. The ranking ndjson records what a case ANSWERED; a pair that was never inverted leaves no
 * trace in an answer, and a pair whose inversion cancelled a later one leaves the trace of the cancellation
 * rather than of the examination. `inspectContainmentOrder` produces exactly the missing rows (iteration 294),
 * and this file is where a run writes them down.
 *
 * ## Why a dump and not a number
 *
 * ρ cannot be computed inside one run without deciding, at write time, what its population is: the residual is
 * an edge statistic, the label ("was this inversion a gain") is a case statistic, and the label only exists once
 * the case's accepted answers are beside it. Writing the rows keeps the two apart, lets the aggregation be a
 * local computation over one artifact, and lets a reader re-aggregate with a different population rule without
 * paying for a second corpus walk.
 *
 * ## Why the label is not in the file
 *
 * For the reason `agentic-fingerprint-file.ts` records: an arm that reads a measurement and a label in one
 * object can condition on the label by accident, and the failure is a suspiciously good number rather than a
 * stack trace. The accepted answers live in the run's per-case verdict file, and the two join on `datapack`.
 *
 * ## The arm difference is recorded, not reconstructed
 *
 * The shipped pass requires the pair's own interface to have carried a failed call (`failingEdges`); the arm
 * iteration 293 refused reads the excursions alone. Both sweeps are pure functions of one fusion order, so both
 * decisions are recorded per pair — and the difference between the two orders is what attributes an arm's move
 * to a pair rather than to a case. Recording only the shipped decision would make the refused arm unmeasurable
 * from the same bytes.
 *
 * @module benchmarks/containment-rows
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import type {
  ContainmentDecision,
  FailureAttribution,
  FailureFlow,
} from '../../packages/tree/src/index.js';
import { isFailureAttribution } from '../../packages/tree/src/index.js';

/** One adjacent pair that carried a call edge, and what the arm decided about it. */
export interface ContainmentPairRow {
  /** The candidate that sat higher in the arm's order when the pair was examined. */
  readonly upper: string;
  /** The candidate that sat lower. */
  readonly lower: string;
  /** The arm's decision. */
  readonly decision: ContainmentDecision;
  /** The upper candidate's excursion in band widths, when the profile could measure it. */
  readonly upperExcursion?: number | undefined;
  /** The lower candidate's excursion in band widths, when the profile could measure it. */
  readonly lowerExcursion?: number | undefined;
}

/**
 * Whether the observation replayed the production chain.
 *
 * The runner rebuilds the shipped order from the fusion order with the same two passes the pruner runs, and
 * compares the result against the ranking the engine actually published. `identical` is what makes the rows an
 * observation of the decision rather than a second computation near it; `differs` is recorded rather than thrown
 * because a mismatch is a measurement about the instrument, and a run that refused to publish would leave the
 * disagreement unreadable.
 */
export type ContainmentReplay = 'identical' | 'differs' | 'unavailable';

/**
 * The input the sweep and the flow pass consumed, stored so that an arm can be re-walked without the corpus.
 *
 * ## Why the row carries its own input
 *
 * The first version of this artifact recorded only the two decisions, which made it enough to AGGREGATE ρ over
 * and not enough to ask a different question of the same cases. H2's second criterion is exactly such a
 * question — plant the residual as the requirement in place of the interface record and re-read the corpus —
 * and a gate changes which pairs are inverted, which changes the adjacencies the walk examines next, so the
 * gated arm cannot be reconstructed from another arm's decisions. It has to be WALKED.
 *
 * Walking it needs what the two passes read and nothing else: the order the fusion published (the walk's
 * start), the directed call edges (which adjacencies qualify), the per-service excursions (the inequality), the
 * failed interfaces (the shipped arm's requirement) and the flow pass's own inputs (so the walk reaches the same
 * FINAL order the published number is read from). With those the whole chain replays from the file, and the
 * criterion is a local computation over an artifact rather than another corpus walk.
 *
 * ## What is NOT here
 *
 * Any accepted answer, any fault label, and any fitted statistic. The prior a gate consults is fitted by the
 * reader from the OTHER half of THIS file, which is why the file must not carry one: a row that arrived with its
 * own prior would have been judged by a number it helped compute.
 */
export interface ContainmentChain {
  /** The order the FUSION published — the sweep's input, not its output. */
  readonly order: readonly string[];
  /** The case's directed call edges, as `[from, to]`. */
  readonly edges: readonly (readonly [string, string])[];
  /** The per-service excursions. A service absent from this map could not be measured — it is not a zero. */
  readonly excursions: Readonly<Record<string, number>>;
  /**
   * The per-service fault-free surprise, in nats — the same candidates measured through every published channel.
   *
   * The second map the pass can be walked with, and a different measurement of the same case rather than a second
   * decision about it: the excursion reads latency only, this reads the whole channel set priced by each channel's
   * own fault-free rate. Optional on the same ground as {@link chain} itself — a dump written before this was
   * recorded must be readable, and the arm that needs it refuses with a sentence rather than treating absence as
   * an empty map, which would make a surprise-less dump indistinguishable from a case where nothing moved.
   */
  readonly surprises?: Readonly<Record<string, number>> | undefined;
  /**
   * The interfaces that reported more failed calls after the injection, keyed by `failureEdgeKey`.
   *
   * This is what the SHIPPED containment arm requires, and it is a different map from {@link failingEdges}
   * below: one counts failed calls on an interface, the other the net rise of a shape on an edge, and they feed
   * two different passes. The names are the graph's, kept rather than improved so that a reader can find them.
   */
  readonly failedInterfaces: Readonly<Record<string, number>>;
  /** The flow map the failure-flow pass reads. */
  readonly flows: Readonly<Record<string, FailureFlow>>;
  /** The edges that carried a net rise, which the FLOW pass requires. */
  readonly failingEdges: Readonly<
    Record<string, { readonly rise: number; readonly novel: number }>
  >;
  /** Which reading of the flow decides a pair. */
  readonly attribution: FailureAttribution;
}

/** One case's sweep rows. */
export interface ContainmentCaseRow {
  /** The case directory's name — the key the per-case verdict file joins on. */
  readonly datapack: string;
  readonly faultType: string;
  /** Band half-width in robust standard deviations the run measured against, so a reader can re-derive. */
  readonly sigma: number;
  /** The margin the run applied, in band widths. `0` is the shipped strict comparison. */
  readonly margin: number;
  /** The first candidate of the fusion order the sweep was given, or `null` when the case had none. */
  readonly fusionTop1: string | null;
  /** The first candidate after the shipped sweep, before the failure-flow pass. */
  readonly gatedTop1: string | null;
  /** The first candidate after the refused arm's sweep, before the failure-flow pass. */
  readonly ungatedTop1: string | null;
  /** The first candidate the engine actually published, for the replay check. */
  readonly shippedTop1: string | null;
  readonly replay: ContainmentReplay;
  /**
   * The shipped arm's sweep: one row per adjacent pair it examined.
   *
   * The two arms' traces are stored SEPARATELY rather than as two decisions on one row, because they are two
   * different walks. The moment one arm inverts a pair the other leaves alone, the two scans are looking at
   * different adjacencies and the next rows describe different pairs — zipping them by index would pair a row
   * with a decision taken about a different pair, and nothing in the file would show it.
   */
  readonly pairs: readonly ContainmentPairRow[];
  /** The refused arm's sweep, over the same fusion order. */
  readonly ungatedPairs: readonly ContainmentPairRow[];
  /**
   * The sweep's input, or absent on a dump written before it was recorded.
   *
   * Optional rather than required because the file outlives the code: a reader that refused a three-field dump
   * would have no way to say "this artifact predates the replay" other than failing to parse, and the arm that
   * needs the chain can refuse it with a sentence instead.
   */
  readonly chain?: ContainmentChain | undefined;
}

/** What a dump wrote, for the run's own log line. */
export interface ContainmentRowsSummary {
  readonly path: string;
  readonly cases: number;
  readonly pairs: number;
  readonly ungatedPairs: number;
  readonly measuredPairs: number;
  readonly inverted: number;
  readonly invertedUngated: number;
  /**
   * Pairs inverted because the case's interface record was silent THROUGHOUT.
   *
   * Zero on every arm this dump writes, because they all read the record per edge. It exists for the reason the
   * two prior refusals do: the dump's vocabulary is the sweep's, and a reader that later records a case-scoped
   * walk through this same class must not have the silence folded into `noFailedInterface` — which is the
   * opposite statement, that the record exists and this edge is not in it.
   */
  readonly recordSilent: number;
  readonly noFailedInterface: number;
  readonly unmeasured: number;
  readonly notLarger: number;
  readonly priorAbsent: number;
  readonly priorBelow: number;
  readonly replayIdentical: number;
  readonly replayDiffers: number;
  readonly replayUnavailable: number;
}

/**
 * A pair row as one JSON object, with the optional excursions PRESENT only when measured.
 *
 * The omission is the point: `{"upperExcursion": null}` would be read as a measurement of zero by every consumer
 * that does arithmetic on it, and the whole register's rule is that an unmeasured side is absent rather than
 * zero. `JSON.stringify` drops `undefined` values, so building the object with conditional spreads is what makes
 * that rule survive the serialisation boundary.
 *
 * @param row - The pair row.
 * @returns The serialisable object.
 */
function pairToJson(row: ContainmentPairRow): Record<string, unknown> {
  return {
    upper: row.upper,
    lower: row.lower,
    decision: row.decision,
    ...(row.upperExcursion === undefined ? {} : { upperExcursion: row.upperExcursion }),
    ...(row.lowerExcursion === undefined ? {} : { lowerExcursion: row.lowerExcursion }),
  };
}

/**
 * Render one case record as a single JSON line, **without** its newline.
 *
 * @param record - The case's sweep rows.
 * @returns The JSON text of one line.
 */
export function formatContainmentRow(record: ContainmentCaseRow): string {
  return JSON.stringify({
    datapack: record.datapack,
    faultType: record.faultType,
    sigma: record.sigma,
    margin: record.margin,
    fusionTop1: record.fusionTop1,
    gatedTop1: record.gatedTop1,
    ungatedTop1: record.ungatedTop1,
    shippedTop1: record.shippedTop1,
    replay: record.replay,
    pairs: record.pairs.map(pairToJson),
    ungatedPairs: record.ungatedPairs.map(pairToJson),
    // Omitted rather than nulled when absent, for the rule the excursions already follow: a reader must be able
    // to tell "this file predates the field" from "this case had an empty one".
    ...(record.chain === undefined ? {} : { chain: chainToJson(record.chain) }),
  });
}

/** One chain as the file spells it: tuples for edges, objects keyed by service for the maps. */
function chainToJson(chain: ContainmentChain): Record<string, unknown> {
  return {
    order: [...chain.order],
    edges: chain.edges.map((edge) => [edge[0], edge[1]]),
    excursions: { ...chain.excursions },
    // Written only when it was measured: an empty object here would say "every candidate was measured and none
    // moved", which is the one reading a dump from before this field cannot support.
    ...(chain.surprises === undefined ? {} : { surprises: { ...chain.surprises } }),
    failedInterfaces: { ...chain.failedInterfaces },
    flows: Object.fromEntries(
      Object.entries(chain.flows).map(([service, flow]) => [
        service,
        {
          knownIn: flow.knownIn,
          knownOut: flow.knownOut,
          novelIn: flow.novelIn,
          novelOut: flow.novelOut,
        },
      ]),
    ),
    failingEdges: Object.fromEntries(
      Object.entries(chain.failingEdges).map(([key, edge]) => [
        key,
        { rise: edge.rise, novel: edge.novel },
      ]),
    ),
    attribution: chain.attribution,
  };
}

/** The census fields, in the order every rendering writes them. */
const SUMMARY_FIELDS = [
  'pairs',
  'ungatedPairs',
  'measuredPairs',
  'inverted',
  'invertedUngated',
  'recordSilent',
  'noFailedInterface',
  'unmeasured',
  'notLarger',
  'priorAbsent',
  'priorBelow',
  'replayIdentical',
  'replayDiffers',
  'replayUnavailable',
] as const;

/**
 * The census field each decision adds to. A `Record` over the union, so a new decision fails to compile.
 *
 * The two prior refusals have counters of their own even though neither arm a run sweeps can produce them: the
 * dump's decision vocabulary is the sweep's, and a reader that later records a GATED arm through this same class
 * must not have its two reasons folded into `notLarger`.
 */
const DECISION_FIELD: Record<
  ContainmentDecision,
  | 'inverted'
  | 'recordSilent'
  | 'noFailedInterface'
  | 'unmeasured'
  | 'notLarger'
  | 'priorAbsent'
  | 'priorBelow'
> = {
  inverted: 'inverted',
  'record-silent': 'recordSilent',
  'no-failed-interface': 'noFailedInterface',
  unmeasured: 'unmeasured',
  'not-larger': 'notLarger',
  'prior-absent': 'priorAbsent',
  'prior-below': 'priorBelow',
};

/**
 * Append-only writer for the containment rows.
 *
 * Constructing it TRUNCATES the file, on the rule `TermDump` and `FingerprintDump` record: a dispatch that ran
 * twice into one path must not read as a single run with twice the cases, and the failure would be a plausible
 * number rather than an error.
 */
export class ContainmentRowDump {
  #cases = 0;
  #counts: Record<(typeof SUMMARY_FIELDS)[number], number> = {
    pairs: 0,
    ungatedPairs: 0,
    measuredPairs: 0,
    inverted: 0,
    invertedUngated: 0,
    recordSilent: 0,
    noFailedInterface: 0,
    unmeasured: 0,
    notLarger: 0,
    priorAbsent: 0,
    priorBelow: 0,
    replayIdentical: 0,
    replayDiffers: 0,
    replayUnavailable: 0,
  };

  /**
   * @param path - Where the ndjson is written.
   */
  constructor(readonly path: string) {
    writeFileSync(path, '');
  }

  /**
   * Write one case.
   *
   * The census counts DECISIONS rather than rows where it can: a pair contributes exactly one decision per arm,
   * so `inverted + noFailedInterface + unmeasured + notLarger` equals `pairs` for the shipped arm, and a census
   * that did not add up would be the first sign that a decision was dropped on the way out.
   *
   * @param record - The case's sweep rows.
   */
  record(record: ContainmentCaseRow): void {
    appendFileSync(this.path, `${formatContainmentRow(record)}\n`);
    this.#cases += 1;
    for (const pair of record.pairs) {
      this.#counts.pairs += 1;
      if (pair.upperExcursion !== undefined && pair.lowerExcursion !== undefined) {
        this.#counts.measuredPairs += 1;
      }
      this.#counts[DECISION_FIELD[pair.decision]] += 1;
    }
    this.#counts.ungatedPairs += record.ungatedPairs.length;
    for (const pair of record.ungatedPairs) {
      if (pair.decision === 'inverted') this.#counts.invertedUngated += 1;
    }
    if (record.replay === 'identical') this.#counts.replayIdentical += 1;
    else if (record.replay === 'differs') this.#counts.replayDiffers += 1;
    else this.#counts.replayUnavailable += 1;
  }

  /** What was written. */
  get summary(): ContainmentRowsSummary {
    return { path: this.path, cases: this.#cases, ...this.#counts };
  }
}

/** Refuses a value that is not a finite number, naming the field and the line. */
function finiteAt(value: unknown, field: string, line: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} on line ${line} is not a finite number: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Refuses a value that is not one of the six decisions. */
function decisionAt(value: unknown, field: string, line: number): ContainmentDecision {
  if (
    value === 'inverted' ||
    value === 'record-silent' ||
    value === 'no-failed-interface' ||
    value === 'unmeasured' ||
    value === 'not-larger' ||
    value === 'prior-absent' ||
    value === 'prior-below'
  ) {
    return value;
  }
  throw new Error(`${field} on line ${line} is not a containment decision: ${String(value)}`);
}

/** Refuses a value that is neither `null` nor a non-empty string. */
function serviceAt(value: unknown, field: string, line: number): string | null {
  if (value === null) return null;
  return nameAt(value, field, line);
}

/** Refuses a value that is not a non-empty service name, for the fields that cannot be `null`. */
function nameAt(value: unknown, field: string, line: number): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${field} on line ${line} is not a service name: ${String(value)}`);
  }
  return value;
}

/** Parses one pair row, refusing a side that is neither measured nor absent. */
function parsePair(raw: unknown, line: number): ContainmentPairRow {
  if (typeof raw !== 'object' || raw === null)
    throw new Error(`pair on line ${line} is not an object`);
  const pair = raw as Record<string, unknown>;
  const upper = nameAt(pair.upper, 'pair upper', line);
  const lower = nameAt(pair.lower, 'pair lower', line);
  const upperExcursion =
    pair.upperExcursion === undefined
      ? undefined
      : finiteAt(pair.upperExcursion, 'upperExcursion', line);
  const lowerExcursion =
    pair.lowerExcursion === undefined
      ? undefined
      : finiteAt(pair.lowerExcursion, 'lowerExcursion', line);
  if (upperExcursion !== undefined && upperExcursion < 0) {
    throw new Error(`upperExcursion on line ${line} is negative: ${upperExcursion}`);
  }
  if (lowerExcursion !== undefined && lowerExcursion < 0) {
    throw new Error(`lowerExcursion on line ${line} is negative: ${lowerExcursion}`);
  }
  return {
    upper,
    lower,
    decision: decisionAt(pair.decision, 'decision', line),
    ...(upperExcursion === undefined ? {} : { upperExcursion }),
    ...(lowerExcursion === undefined ? {} : { lowerExcursion }),
  };
}

/**
 * Read a dump back.
 *
 * Blank lines are skipped, so a file that ends with a newline is not an error; every other unrecognised shape is
 * refused by line number rather than defaulted. A zero or negative `sigma` is refused too: the excursion is
 * measured in band widths and a band of no width would make every row infinite.
 *
 * @param text - The ndjson contents.
 * @returns One record per non-blank line, in file order.
 * @throws Error when a line is not a record this module would have written.
 */
export function parseContainmentRows(text: string): ContainmentCaseRow[] {
  const records: ContainmentCaseRow[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === '') continue;
    const lineNumber = index + 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`line ${lineNumber} is not JSON`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new Error(`line ${lineNumber} is not an object`);
    const record = raw as Record<string, unknown>;
    if (typeof record.datapack !== 'string' || record.datapack === '') {
      throw new Error(`datapack on line ${lineNumber} is not a non-empty string`);
    }
    if (typeof record.faultType !== 'string') {
      throw new Error(`faultType on line ${lineNumber} is not a string`);
    }
    const sigma = finiteAt(record.sigma, 'sigma', lineNumber);
    if (!(sigma > 0)) throw new Error(`sigma on line ${lineNumber} is not positive: ${sigma}`);
    const replay = record.replay;
    if (replay !== 'identical' && replay !== 'differs' && replay !== 'unavailable') {
      throw new Error(`replay on line ${lineNumber} is not a replay verdict: ${String(replay)}`);
    }
    if (!Array.isArray(record.pairs)) {
      throw new Error(`pairs on line ${lineNumber} is not an array`);
    }
    // The refused arm's trace is REQUIRED rather than optional: an absent one would read as "the arm examined
    // nothing", which is a measurement, while the truth would be that the run did not write it.
    if (!Array.isArray(record.ungatedPairs)) {
      throw new Error(`ungatedPairs on line ${lineNumber} is not an array`);
    }
    const parsed: ContainmentCaseRow = {
      datapack: record.datapack,
      faultType: record.faultType,
      sigma,
      margin: finiteAt(record.margin, 'margin', lineNumber),
      fusionTop1: serviceAt(record.fusionTop1, 'fusionTop1', lineNumber),
      gatedTop1: serviceAt(record.gatedTop1, 'gatedTop1', lineNumber),
      ungatedTop1: serviceAt(record.ungatedTop1, 'ungatedTop1', lineNumber),
      shippedTop1: serviceAt(record.shippedTop1, 'shippedTop1', lineNumber),
      replay,
      pairs: record.pairs.map((pair: unknown) => parsePair(pair, lineNumber)),
      ungatedPairs: record.ungatedPairs.map((pair: unknown) => parsePair(pair, lineNumber)),
    };
    records.push(
      record.chain === undefined
        ? parsed
        : { ...parsed, chain: parseChain(record.chain, lineNumber) },
    );
  }
  return records;
}

/** Refuses a value that is not a plain object, which every map in the chain is spelled as. */
function objectAt(value: unknown, field: string, line: number): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} on line ${line} is not an object`);
  }
  return value as Record<string, unknown>;
}

/** Parses the sweep's stored input, refusing any shape the walk could not consume. */
function parseChain(raw: unknown, line: number): ContainmentChain {
  const chain = objectAt(raw, 'chain', line);
  if (!Array.isArray(chain.order)) throw new Error(`chain.order on line ${line} is not an array`);
  const order = chain.order.map((service: unknown) => nameAt(service, 'chain.order', line));
  if (!Array.isArray(chain.edges)) throw new Error(`chain.edges on line ${line} is not an array`);
  const edges: [string, string][] = chain.edges.map((edge: unknown) => {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new Error(`chain.edges on line ${line} is not a pair`);
    }
    return [nameAt(edge[0], 'chain.edges.from', line), nameAt(edge[1], 'chain.edges.to', line)];
  });
  const excursions = objectAt(chain.excursions, 'chain.excursions', line);
  const measuredExcursions: Record<string, number> = {};
  for (const [service, value] of Object.entries(excursions)) {
    const excursion = finiteAt(value, `chain.excursions.${service}`, line);
    // An excursion is a distance divided by a band width: negative is not a small measurement, it is a
    // sign error, and a reader that accepted one would fold it into the inequality as evidence.
    if (excursion < 0) {
      throw new Error(`chain.excursions.${service} on line ${line} is negative: ${excursion}`);
    }
    measuredExcursions[service] = excursion;
  }
  // Absent and empty are two different statements here, so the field is parsed only when it is present.
  let measuredSurprises: Record<string, number> | undefined;
  if (chain.surprises !== undefined) {
    const surprises = objectAt(chain.surprises, 'chain.surprises', line);
    measuredSurprises = {};
    for (const [service, value] of Object.entries(surprises)) {
      const surprise = finiteAt(value, `chain.surprises.${service}`, line);
      // Surprise is a surprisal: `log(1/q)` over a probability in `(0, 1)` is non-negative, and a negative value
      // would be folded into the pass's inequality as an inverted comparison rather than as a small measurement.
      if (surprise < 0) {
        throw new Error(`chain.surprises.${service} on line ${line} is negative: ${surprise}`);
      }
      measuredSurprises[service] = surprise;
    }
  }
  const flows = objectAt(chain.flows, 'chain.flows', line);
  const parsedFlows: Record<string, FailureFlow> = {};
  for (const [service, value] of Object.entries(flows)) {
    const flow = objectAt(value, `chain.flows.${service}`, line);
    parsedFlows[service] = {
      knownIn: finiteAt(flow.knownIn, `chain.flows.${service}.knownIn`, line),
      knownOut: finiteAt(flow.knownOut, `chain.flows.${service}.knownOut`, line),
      novelIn: finiteAt(flow.novelIn, `chain.flows.${service}.novelIn`, line),
      novelOut: finiteAt(flow.novelOut, `chain.flows.${service}.novelOut`, line),
    };
  }
  const interfaces = objectAt(chain.failedInterfaces, 'chain.failedInterfaces', line);
  const parsedInterfaces: Record<string, number> = {};
  for (const [key, value] of Object.entries(interfaces)) {
    parsedInterfaces[key] = finiteAt(value, `chain.failedInterfaces.${key}`, line);
  }
  const failingEdges = objectAt(chain.failingEdges, 'chain.failingEdges', line);
  const parsedFailing: Record<string, { rise: number; novel: number }> = {};
  for (const [key, value] of Object.entries(failingEdges)) {
    const edge = objectAt(value, `chain.failingEdges`, line);
    parsedFailing[key] = {
      rise: finiteAt(edge.rise, 'chain.failingEdges.rise', line),
      novel: finiteAt(edge.novel, 'chain.failingEdges.novel', line),
    };
  }
  if (!isFailureAttribution(chain.attribution)) {
    throw new Error(
      `chain.attribution on line ${line} is not a flow reading: ${String(chain.attribution)}`,
    );
  }
  return {
    order,
    edges,
    excursions: measuredExcursions,
    ...(measuredSurprises === undefined ? {} : { surprises: measuredSurprises }),
    failedInterfaces: parsedInterfaces,
    flows: parsedFlows,
    failingEdges: parsedFailing,
    attribution: chain.attribution,
  };
}

/**
 * Read a dump from disk.
 *
 * @param path - The ndjson file.
 * @returns One record per case.
 */
export function readContainmentRows(path: string): ContainmentCaseRow[] {
  return parseContainmentRows(readFileSync(path, 'utf8'));
}
